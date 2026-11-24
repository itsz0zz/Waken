using System.Diagnostics;
using System.Text.Json;
using Waken.Agent;
using Waken.Agent.Games;
using Waken.Agent.Host;

var builder = WebApplication.CreateBuilder(args);
// Started at boot as SYSTEM (apps\windows\scripts\install-service.ps1): its settings in a file readable by SYSTEM and
// administrators only. Started by the app instead, it gets them in its environment and never reads that file.
if (OperatingSystem.IsWindows() && Environment.GetEnvironmentVariable("Agent__Token") is null)
{
    var configFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Waken", "agent.json");
    builder.Configuration.AddJsonFile(configFile, optional: true);
}
var options = builder.Configuration.GetSection("Agent").Get<AgentOptions>() ?? new AgentOptions();
var bearerToken = new BearerToken(options.Token);
builder.Services.AddSingleton(options);
// The Windows app: the agent runs Sunshine and the Waken network itself.
var hostOptions = builder.Configuration.GetSection("Agent:Host").Get<HostServicesOptions>() ?? new HostServicesOptions();
builder.Services.AddSingleton(hostOptions);
builder.Services.AddSingleton<HostSupervisor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<HostSupervisor>());
builder.Services.AddSingleton<GameStreamClient>();
builder.Services.AddSingleton(_ => new GameLibrary(GameLibrary.DefaultSources()));
builder.Services.AddSingleton(_ => new GameStats(options.DataDir));
builder.Services.AddHostedService<StatsTracker>();
builder.Services.AddSingleton(sp => new SunshineAppSync(
    sp.GetRequiredService<GameStreamClient>().CreateAdminClient,
    sp.GetRequiredService<ILogger<SunshineAppSync>>()));
builder.Services.AddSingleton<WakeOnLan>();
builder.Services.AddHttpClient(WakeOnLan.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(WakeOnLan.Ipv4Handler);
builder.Services.AddHttpClient(nameof(ArtworkService), c =>
{
    c.Timeout = TimeSpan.FromSeconds(20);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Waken/1.0");
});
builder.Services.AddSingleton(sp => new ArtworkService(
    sp.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(ArtworkService)),
    Path.Combine(options.DataDir, "artwork"),
    options.SteamGridDbKey));
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();

// Every answer is live state: never kept by a client's HTTP cache. Windows' own (the Windows app's fetch) kept the
// first /host/status, sent before Sunshine was up, and showed it forever. Covers stay cacheable.
app.Use(async (ctx, next) =>
{
    ctx.Response.OnStarting(() =>
    {
        if (!ctx.Response.Headers.ContainsKey("Cache-Control") && ctx.Response.ContentType?.StartsWith("image/", StringComparison.Ordinal) != true)
            ctx.Response.Headers.CacheControl = "no-store";
        return Task.CompletedTask;
    });
    await next();
});

app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/health")) { await next(); return; }
    // A game's picture opens with its own signature too (the cover, hero, logo and icon URLs of /games).
    var signedArt = HttpMethods.IsGet(ctx.Request.Method) && ArtRequest(ctx.Request.Path) is { } art
        && bearerToken.MatchesArt(art.GameId, art.Kind, ctx.Request.Query["sig"]);
    if (!signedArt && !bearerToken.Matches(ctx.Request.Headers.Authorization.ToString()))
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    await next();
});

// Answers as soon as Windows has booted, before Sunshine: the app uses it for the "Le PC répond" step.
app.MapGet("/health", () => Results.Ok(new { ok = true, machine = Environment.MachineName, uptimeSeconds = Environment.TickCount64 / 1000 }));

// The desktop app's view of its own services (Windows: the agent runs them).
app.MapGet("/host/status", (HostSupervisor supervisor) => Results.Ok(supervisor.Status()));

app.MapPost("/host/tunnel", async (TunnelCommand command, HostSupervisor supervisor, CancellationToken ct) =>
{
    try
    {
        return Results.Ok(new { result = await supervisor.TunnelCommandAsync(command, ct) });
    }
    catch (TunnelException e)
    {
        return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
    }
    catch (TimeoutException)
    {
        return Results.Problem("Le réseau Waken ne répond pas.", statusCode: StatusCodes.Status504GatewayTimeout);
    }
});

app.MapPost("/host/restart-sunshine", (HostSupervisor supervisor) =>
{
    supervisor.RestartSunshine();
    return Results.NoContent();
});

app.MapGet("/apps", (GameStreamClient gs, CancellationToken ct) =>
    CallSunshine(async () => Results.Ok((await gs.AppsAsync(ct)).Select(a => new { id = a.Id, title = a.Title }))));

app.MapPost("/launch", async (LaunchRequest req, GameStreamClient gs, GameLibrary library, SunshineAppSync sync, GameStats stats, CancellationToken ct) =>
{
    var timer = new LaunchTimer();
    var games = await library.GetAsync(refresh: false, ct);
    timer.Mark("bibliothèque");
    return await CallSunshine(async () =>
    {
        GameStreamClient.LaunchResult launched;
        try
        {
            launched = await gs.LaunchAsync(req.App, req.Width, req.Height, req.Fps, ct, req.Replace, timer);
        }
        catch (SunshineAppMissingException)
        {
            // Syncing Sunshine's apps costs several admin calls: only for a game installed since the last sync
            // (the list of games syncs them too).
            await TrySyncAsync(sync, games, ct);
            timer.Mark("synchro des apps");
            launched = await gs.LaunchAsync(req.App, req.Width, req.Height, req.Fps, ct, req.Replace, timer);
        }
        app.Logger.LogInformation("Launch of {App}: {Timings}", req.App, timer);
        // Sunshine apps are named after the games: the session is counted for that game.
        if (games.FirstOrDefault(g => string.Equals(g.Title, req.App, StringComparison.OrdinalIgnoreCase)) is { } game) stats.Begin(game.Id, req.App);
        return Results.Ok(launched);
    });
});

// Totals for the home and game screens: days in a row, time this month, sessions.
app.MapGet("/stats", (GameStats stats) => Results.Ok(stats.Summary()));

// The games installed on this machine, whatever the store. Pictures are fetched on demand by the routes below.
app.MapGet("/games", async (bool? refresh, GameLibrary library, SunshineAppSync sync, GameStats stats, CancellationToken ct) =>
{
    var games = await library.GetAsync(refresh == true, ct);
    await TrySyncAsync(sync, games, ct);
    return Results.Ok(games.Select(g => (g, played: stats.Of(g.Id))).Select(e => new
    {
        lastPlayed = e.played?.LastPlayed,
        playSeconds = e.played?.Seconds ?? 0,
        sessions = e.played?.Sessions ?? 0,
        id = e.g.Id,
        title = e.g.Title,
        store = e.g.Store,
        cover = ArtUrl(e.g.Id, "cover"),
        hero = ArtUrl(e.g.Id, "hero"),
        logo = ArtUrl(e.g.Id, "logo"),
        icon = ArtUrl(e.g.Id, "icon"),
    }));
});

app.MapGet("/games/{id}/{kind}", async (string id, string kind, string? size, GameLibrary library, ArtworkService artwork, CancellationToken ct) =>
{
    if (!Enum.TryParse<ArtworkKind>(kind, ignoreCase: true, out var artworkKind) || !Enum.IsDefined(artworkKind)) return Results.NotFound();
    if (await library.FindAsync(id, ct) is not { } game) return Results.NotFound();
    var file = await artwork.GetAsync(game, artworkKind, ct, small: size == "small");
    if (file is null) return Results.NotFound();
    var type = Path.GetExtension(file) switch { ".png" => "image/png", ".webp" => "image/webp", _ => "image/jpeg" };
    return Results.File(file, type, enableRangeProcessing: false);
});

// The library as the account's server keeps it: the machine's own app sends it there, every other device reads it
// from there. Pictures are public addresses (SteamGridDB, Steam): nothing to fetch from this machine.
app.MapGet("/library", async (GameLibrary library, SunshineAppSync sync, GameStats stats, ArtworkService artwork, WakeOnLan wol, CancellationToken ct) =>
{
    var games = await library.GetAsync(refresh: false, ct);
    await TrySyncAsync(sync, games, ct);
    var list = new List<object>(games.Count);
    foreach (var game in games)
    {
        var played = stats.Of(game.Id);
        list.Add(new
        {
            id = game.Id,
            title = game.Title,
            store = game.Store,
            lastPlayed = played?.LastPlayed,
            playSeconds = played?.Seconds ?? 0,
            sessions = played?.Sessions ?? 0,
            cover = await artwork.PublicUrlAsync(game, ArtworkKind.Cover, ct),
            coverSmall = await artwork.PublicUrlAsync(game, ArtworkKind.Cover, ct, small: true),
            hero = await artwork.PublicUrlAsync(game, ArtworkKind.Hero, ct),
            heroSmall = await artwork.PublicUrlAsync(game, ArtworkKind.Hero, ct, small: true),
            logo = await artwork.PublicUrlAsync(game, ArtworkKind.Logo, ct),
            icon = await artwork.PublicUrlAsync(game, ArtworkKind.Icon, ct),
        });
    }
    return Results.Ok(new { games = list, stats = stats.Summary(), wake = await wol.InfoAsync(ct) });
});

// Another computer of the account asks this one, on the same network as itself, to wake it (Wake-on-LAN): the
// magic packet goes out on this network's broadcast and to the addresses given.
app.MapPost("/wake", async (WakeRequest request, WakeOnLan wol, CancellationToken ct) =>
{
    try
    {
        var sent = await wol.SendAsync(request, ct);
        return Results.Ok(new { sent });
    }
    catch (ArgumentException e)
    {
        return Results.Problem(e.Message, statusCode: StatusCodes.Status400BadRequest);
    }
});

// Starts a game of this machine's library right here, for the desktop app playing on its own machine.
// Only ids from the library: the command is the one the scan found, never one sent by the caller.
app.MapPost("/games/{id}/start", async (string id, GameLibrary library, GameStats stats, CancellationToken ct) =>
{
    if (await library.FindAsync(id, ct) is not { } game) return Results.NotFound();
    try
    {
        StartLocally(game.Detached);
        stats.Begin(game.Id, game.Title, tracked: false);
        return Results.Accepted();
    }
    catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
    {
        return Results.Problem($"Impossible de lancer {game.Title} : {e.Message}", statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/quit", (GameStreamClient gs, CancellationToken ct) =>
    CallSunshine(async () =>
    {
        await gs.QuitAsync(ct);
        return Results.NoContent();
    }));

// Absolute paths: this runs as SYSTEM. No delay on shutdown: any /t above 0 implies /f, which discards unsaved work.
app.MapPost("/shutdown", () => Run(Path.Combine(Environment.SystemDirectory, "shutdown.exe"), "/s /t 0"));
app.MapPost("/sleep", () => Run(Path.Combine(Environment.SystemDirectory, "rundll32.exe"), "powrprof.dll,SetSuspendState 0,1,0"));

// Sunshine's app list is slow to answer (15 s on the first real PC): read once Sunshine is up, before any launch.
app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(async () =>
{
    var gs = app.Services.GetRequiredService<GameStreamClient>();
    var stopping = app.Lifetime.ApplicationStopping;
    for (var attempt = 0; attempt < 60 && !stopping.IsCancellationRequested; attempt++)
    {
        if (await gs.RefreshAppsAsync(stopping)) return;
        try { await Task.Delay(TimeSpan.FromSeconds(5), stopping); } catch (OperationCanceledException) { return; }
    }
}));

app.Run();

// The app shows this detail: "Application introuvable" is more useful than a bare 500.
async Task<IResult> CallSunshine(Func<Task<IResult>> call)
{
    try
    {
        return await call();
    }
    catch (GameRunningException e)
    {
        return Results.Problem(e.Message, statusCode: StatusCodes.Status409Conflict, extensions: new Dictionary<string, object?> { ["running"] = e.Title });
    }
    catch (Exception e)
    {
        app.Logger.LogError(e, "Sunshine call failed");
        return Results.Problem(e.Message, statusCode: StatusCodes.Status502BadGateway);
    }
}

// The game list stays useful when Sunshine is down: the sync is retried on the next call.
async Task TrySyncAsync(SunshineAppSync sync, IReadOnlyList<GameEntry> games, CancellationToken ct)
{
    try
    {
        if (await sync.SyncAsync(games, ct)) app.Services.GetRequiredService<GameStreamClient>().ForgetApps();
    }
    catch (Exception e) when (e is not OperationCanceledException)
    {
        app.Logger.LogWarning(e, "Sunshine apps sync failed");
    }
}

// macOS commands are shell lines ("open -a ..."); on Windows a store URL or an executable path goes to the shell.
// A picture's address, signed: it opens without the token, for clients that cannot send it with an image.
string ArtUrl(string gameId, string kind) => $"/games/{Uri.EscapeDataString(gameId)}/{kind}?sig={bearerToken.SignArt(gameId, kind)}";

// "/games/{id}/{kind}" with a picture kind: the game (unescaped) and the kind. Null for any other path.
static (string GameId, string Kind)? ArtRequest(PathString path)
{
    var parts = (path.Value ?? "").Split('/');
    if (parts.Length != 4 || parts[0] != "" || parts[1] != "games" || parts[2] == "") return null;
    if (!Enum.TryParse<ArtworkKind>(parts[3], ignoreCase: true, out var kind) || !Enum.IsDefined(kind)) return null;
    return (Uri.UnescapeDataString(parts[2]), parts[3]);
}

void StartLocally(string command)
{
    // Started at boot as SYSTEM: the game goes to whoever is signed in on the monitor, not to session 0.
    var host = app.Services.GetRequiredService<HostServicesOptions>();
    if (host.ConsoleSession && OperatingSystem.IsWindows())
    {
        if (!ConsoleSession.StartAsUser(Path.Combine(Environment.SystemDirectory, "cmd.exe"), ["/c", "start", "", command.Trim('"')]))
            throw new InvalidOperationException("Personne n'est connecté à Windows sur ce PC.");
        return;
    }
    var start = OperatingSystem.IsWindows()
        ? new ProcessStartInfo(command.Trim('"')) { UseShellExecute = true }
        : new ProcessStartInfo("/bin/sh", ["-c", command]) { UseShellExecute = false };
    Process.Start(start)?.Dispose();
}

static IResult Run(string file, string args)
{
    if (!OperatingSystem.IsWindows()) return Results.Problem("Windows uniquement", statusCode: 501);
    Process.Start(new ProcessStartInfo(file, args) { CreateNoWindow = true, UseShellExecute = false });
    return Results.Accepted();
}

namespace Waken.Agent
{
    public sealed class AgentOptions
    {
        private const string Loopback = "127.0.0.1";
        private string _sunshineHost = Loopback;

        public string Token { get; set; } = "";
        /// <summary>Never "localhost": it resolves to [::1] first, which Sunshine does not bind and any process can take.</summary>
        public string SunshineHost
        {
            get => _sunshineHost;
            set => _sunshineHost = string.Equals(value?.Trim(), "localhost", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(value) ? Loopback : value.Trim();
        }

        /// <summary>Sunshine's base port. HTTPS is base - 5, the admin API base + 1.</summary>
        /// <summary>Sunshine ignores a launch while the previous one still waits for its stream (ping_timeout, 10 s).</summary>
        public double LaunchWindowSeconds { get; set; } = 10.5;
        public int SunshinePort { get; set; } = 47989;
        public string SunshineUser { get; set; } = "admin";
        public string SunshinePassword { get; set; } = "";
        /// <summary>Sunshine's certificate file, when it is not in the default installation folder.</summary>
        public string SunshineCertPath { get; set; } = "";
        /// <summary>SteamGridDB API key: official covers, banners and logos for every game, Steam or not.</summary>
        public string SteamGridDbKey { get; set; } = "";
        public string DataDir { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Waken");
        /// <summary>The account's server: it tells the home's public address, kept for waking this computer from outside.</summary>
        public string CloudUrl { get; set; } = "https://api.wakenplay.fr";
    }

    public sealed record LaunchRequest(string App, int Width, int Height, int Fps, bool Hevc, bool Replace = false);
}
