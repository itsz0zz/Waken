using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Waken.Cloud;

// Waken accounts: an e-mail and a password, and the apps get onto the Waken network without ever seeing
// Tailscale. Behind, Headscale (open source coordination server) keeps one user per account.
var builder = WebApplication.CreateBuilder(args);
var cloud = builder.Configuration.GetSection("Cloud").Get<CloudOptions>() ?? new CloudOptions();
cloud.Validate();
builder.Services.AddSingleton(cloud);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

Directory.CreateDirectory(cloud.DataDir);
builder.Services.AddDbContext<CloudDb>(o => o.UseSqlite($"Data Source={Path.Combine(cloud.DataDir, "waken.db")}"));
// Tokens are signed with these keys: kept on the volume, a restart does not sign everybody out.
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(cloud.DataDir, "keys")))
    .SetApplicationName("waken-cloud");

builder.Services.AddAuthentication(IdentityConstants.BearerScheme)
    .AddBearerToken(IdentityConstants.BearerScheme, o =>
    {
        o.BearerTokenExpiration = TimeSpan.FromHours(1);
        // The apps refresh on their own: signing in again only after two months without opening Waken.
        o.RefreshTokenExpiration = TimeSpan.FromDays(60);
    });
builder.Services.AddAuthorization();
builder.Services.AddIdentityCore<WakenUser>(o =>
    {
        o.User.RequireUniqueEmail = true;
        // Length over composition rules (NIST 800-63B).
        o.Password.RequiredLength = 10;
        o.Password.RequireDigit = false;
        o.Password.RequireLowercase = false;
        o.Password.RequireUppercase = false;
        o.Password.RequireNonAlphanumeric = false;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
    })
    .AddEntityFrameworkStores<CloudDb>()
    .AddApiEndpoints();

builder.Services.AddHttpClient<IHeadscale, HeadscaleClient>(c =>
{
    c.BaseAddress = new Uri(cloud.HeadscaleUrl.TrimEnd('/') + "/api/v1/");
    c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", cloud.HeadscaleApiKey);
    c.Timeout = TimeSpan.FromSeconds(15);
});
builder.Services.AddScoped<NetworkService>();
builder.Services.AddSingleton<Notifier>();
builder.Services.AddSingleton<NetworkWatcher>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<NetworkWatcher>());
if (cloud.Apns.Configured)
{
    builder.Services.AddSingleton(cloud.Apns);
    builder.Services.AddHttpClient<ApnsSender>(c => c.Timeout = TimeSpan.FromSeconds(15));
    builder.Services.AddSingleton<IPushSender>(sp => sp.GetRequiredService<ApnsSender>());
}
else
{
    builder.Services.AddSingleton<IPushSender, LogPushSender>();
}

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Per account: a signed-in client looping on /network cannot fill Headscale with keys.
    o.AddPolicy("account", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "?",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = cloud.NetworkRequestsPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "?",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = cloud.AuthRequestsPerMinute, Window = TimeSpan.FromMinutes(1) }));
});
if (cloud.TrustForwardedHeaders)
{
    builder.Services.Configure<ForwardedHeadersOptions>(o =>
    {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        // The proxy's address changes with the stack: trust the header only when this flag says it is behind one.
        o.KnownIPNetworks.Clear();
        o.KnownProxies.Clear();
    });
}

var app = builder.Build();
using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<CloudDb>().Database.EnsureCreated();

if (cloud.TrustForwardedHeaders) app.UseForwardedHeaders();
app.UseAuthentication();
// After authentication: the "account" policy counts per signed-in account.
app.UseRateLimiter();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { ok = true, version = "0.1.0" }));

// /account/register, /account/login (?useCookies=false: bearer tokens), /account/refresh, /account/manage/info...
app.MapGroup("/account").MapIdentityApi<WakenUser>().RequireRateLimiting("auth");

var network = app.MapGroup("/network").RequireAuthorization().RequireRateLimiting("account");

// Called by an app before starting its network: it gets the address and a key for this device only.
network.MapPost("/join", async (ClaimsPrincipal me, UserManager<WakenUser> users, NetworkService net, CancellationToken ct) =>
{
    var user = await users.GetUserAsync(me);
    if (user is null) return Results.Unauthorized();
    try
    {
        return Results.Ok(await net.JoinAsync(user, ct));
    }
    catch (TooManyDevicesException)
    {
        return Results.Problem($"Ton compte a déjà {cloud.MaxDevices} appareils : retires-en un dans les réglages.", statusCode: StatusCodes.Status409Conflict);
    }
    catch (HeadscaleException e)
    {
        return Unavailable(e);
    }
});

network.MapGet("/devices", async (ClaimsPrincipal me, UserManager<WakenUser> users, NetworkService net, CancellationToken ct) =>
{
    var user = await users.GetUserAsync(me);
    if (user is null) return Results.Unauthorized();
    return await Headscale(() => net.DevicesAsync(user, ct));
});

network.MapDelete("/devices/{id}", async (string id, ClaimsPrincipal me, UserManager<WakenUser> users, NetworkService net, CancellationToken ct) =>
{
    var user = await users.GetUserAsync(me);
    if (user is null) return Results.Unauthorized();
    try
    {
        return await net.RemoveDeviceAsync(user, id, ct) ? Results.NoContent() : Results.NotFound();
    }
    catch (HeadscaleException e)
    {
        return Unavailable(e);
    }
});

// Deleting the account takes its password again: a stolen token alone cannot wipe it.
app.MapPost("/account/delete", async (DeleteAccount body, ClaimsPrincipal me, UserManager<WakenUser> users, SignInManager<WakenUser> signIn, NetworkService net, CloudDb db, ILogger<NetworkService> logger, CancellationToken ct) =>
{
    var user = await users.GetUserAsync(me);
    if (user is null) return Results.Unauthorized();
    // Counts toward the lockout like a sign-in: a stolen token cannot guess the password here either.
    var check = await signIn.CheckPasswordSignInAsync(user, body.Password ?? "", lockoutOnFailure: true);
    if (check.IsLockedOut) return Results.Problem("Compte bloqué 5 minutes après trop d'essais", statusCode: StatusCodes.Status423Locked);
    if (!check.Succeeded) return Results.Problem("Mot de passe incorrect", statusCode: StatusCodes.Status403Forbidden);
    try
    {
        await net.ForgetAsync(user, logger, ct);
    }
    catch (HeadscaleException e)
    {
        return Unavailable(e);
    }
    await db.PushDevices.Where(d => d.UserId == user.Id).ExecuteDeleteAsync(ct);
    var deleted = await users.DeleteAsync(user);
    return deleted.Succeeded ? Results.NoContent() : Results.Problem("Compte non supprimé");
}).RequireAuthorization().RequireRateLimiting("auth");

// Notifications: each signed-in device gives its APNs token; the account's events reach all of them.
var push = app.MapGroup("/push").RequireAuthorization().RequireRateLimiting("account");

push.MapPost("/register", async (PushRegistration body, ClaimsPrincipal me, CloudDb db, CancellationToken ct) =>
{
    var userId = me.FindFirstValue(ClaimTypes.NameIdentifier);
    if (userId is null) return Results.Unauthorized();
    if (!PushRegistration.ValidToken(body.Token) || body.Platform is not ("ios" or "macos"))
        return Results.Problem("Jeton de notification invalide", statusCode: StatusCodes.Status400BadRequest);
    var device = await db.PushDevices.FirstOrDefaultAsync(d => d.Token == body.Token, ct);
    if (device is null)
    {
        device = new PushDevice { Token = body.Token, CreatedAt = DateTimeOffset.UtcNow };
        db.PushDevices.Add(device);
    }
    device.UserId = userId;
    device.Platform = body.Platform;
    device.Name = (body.Name ?? "").Trim() is { Length: > 0 } n ? n[..Math.Min(n.Length, 80)] : "Appareil";
    await db.SaveChangesAsync(ct);
    return Results.NoContent();
});

// Signing out: this device stops receiving the account's notifications.
push.MapPost("/unregister", async (PushToken body, ClaimsPrincipal me, CloudDb db, CancellationToken ct) =>
{
    var userId = me.FindFirstValue(ClaimTypes.NameIdentifier);
    await db.PushDevices.Where(d => d.Token == body.Token && d.UserId == userId).ExecuteDeleteAsync(ct);
    return Results.NoContent();
});

// A computer of the account tells a game session ended: the recap goes to the account's devices.
app.MapPost("/events/session-ended", async (SessionEnded body, ClaimsPrincipal me, Notifier notifier, CancellationToken ct) =>
{
    var userId = me.FindFirstValue(ClaimTypes.NameIdentifier);
    if (userId is null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(body.Game) || body.Seconds is < 60 or > 7 * 86_400) return Results.NoContent();
    var game = body.Game.Trim()[..Math.Min(body.Game.Trim().Length, 80)];
    var streak = body.StreakDays > 1 ? $" {body.StreakDays} jours de suite !" : "";
    await notifier.NotifyAsync(userId, new PushMessage($"Fin de partie : {game}", $"{SessionEnded.Duration(body.Seconds)} de jeu.{streak}", "session"), ct);
    return Results.NoContent();
}).RequireAuthorization().RequireRateLimiting("account");

app.Run();

async Task<IResult> Headscale<T>(Func<Task<T>> call)
{
    try
    {
        return Results.Ok(await call());
    }
    catch (HeadscaleException e)
    {
        return Unavailable(e);
    }
}

IResult Unavailable(HeadscaleException e)
{
    // Headscale's details stay in the logs: the apps only need to know the network is not reachable now.
    app.Logger.LogError("Headscale : {Message}", e.Message);
    return Results.Problem("Le réseau Waken ne répond pas, réessaie dans un instant.", statusCode: StatusCodes.Status502BadGateway);
}

public sealed record DeleteAccount(string Password);

public sealed record PushRegistration(string Token, string Platform, string? Name)
{
    /// <summary>APNs tokens are hex, 64 characters today; room left for longer ones.</summary>
    public static bool ValidToken(string? token) => token is { Length: >= 32 and <= 200 } && token.All(char.IsAsciiHexDigit);
}

public sealed record PushToken(string Token);

public sealed record SessionEnded(string Game, long Seconds, int StreakDays)
{
    public static string Duration(long seconds)
    {
        var minutes = seconds / 60;
        return minutes < 60 ? $"{minutes} min" : minutes % 60 == 0 ? $"{minutes / 60} h" : $"{minutes / 60} h {minutes % 60:00}";
    }
}

public partial class Program;
