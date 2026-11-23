using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Waken.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.Configure<WakenOptions>(builder.Configuration.GetSection("Waken"));
builder.Services.AddHttpClient<SteamGridDb>(c =>
{
    c.BaseAddress = new Uri("https://www.steamgriddb.com/api/v2/");
    c.Timeout = TimeSpan.FromSeconds(15);
});
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();
var opts = app.Configuration.GetSection("Waken").Get<WakenOptions>() ?? new WakenOptions();
var bearerToken = new BearerToken(opts.Token);

// Bearer header only (a token in a URL ends up in logs and caches). /health stays open for reachability checks.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/health")) { await next(); return; }
    if (!bearerToken.Matches(ctx.Request.Headers.Authorization.ToString()))
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    await next();
});

app.MapGet("/health", () => Results.Ok(new { ok = true, version = "0.2.0" }));

// Wake-on-LAN relay. The Livebox 6 cannot send WoL itself and forgets the PC's ARP entry once it is off,
// so the packet must come from a machine on the LAN: this one (host networking required in Docker).
app.MapPost("/devices/{id}/wake", async (string id) =>
{
    var d = opts.Devices.FirstOrDefault(x => x.Id == id);
    if (d is null) return Results.NotFound();
    await MagicPacket.SendAsync(d.Mac, d.Broadcast);
    app.Logger.LogInformation("Magic packet sent to {Id} ({Mac})", d.Id, d.Mac);
    return Results.Accepted();
});

app.MapGet("/devices/{id}/status", async (string id) =>
{
    var d = opts.Devices.FirstOrDefault(x => x.Id == id);
    if (d is null) return Results.NotFound();
    var sunshine = await TcpProbe.IsOpenAsync(d.Host, 47989, TimeSpan.FromSeconds(1));
    var agent = await TcpProbe.IsOpenAsync(d.Host, 47100, TimeSpan.FromSeconds(1));
    return Results.Ok(new { online = sunshine || agent, sunshine });
});

// Game art from SteamGridDB, cached on disk. style=hero (wide banner) | grid (920x430 tile).
app.MapGet("/covers", async (string title, string? style, SteamGridDb sgdb, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(opts.SteamGridDbApiKey)) return Results.Problem("SteamGridDbApiKey manquant", statusCode: 503);
    style = style == "grid" ? "grid" : "hero";
    Directory.CreateDirectory(opts.CacheDir);
    var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{style}:{title.ToLowerInvariant()}")))[..24];
    var cached = Directory.EnumerateFiles(opts.CacheDir, key + ".*").FirstOrDefault();
    if (cached is null)
    {
        var (bytes, ext) = await sgdb.FetchAsync(title, style, opts.SteamGridDbApiKey, ct);
        if (bytes is null) return Results.NotFound();
        cached = Path.Combine(opts.CacheDir, key + ext);
        await File.WriteAllBytesAsync(cached, bytes, ct);
    }
    var mime = cached.EndsWith(".png") ? "image/png" : cached.EndsWith(".webp") ? "image/webp" : "image/jpeg";
    return Results.File(cached, mime, enableRangeProcessing: false);
});

app.Run();

namespace Waken.Api
{
    public sealed class WakenOptions
    {
        public string Token { get; set; } = "";
        public string SteamGridDbApiKey { get; set; } = "";
        public string CacheDir { get; set; } = "/data/covers";
        public List<DeviceOptions> Devices { get; set; } = [];
    }

    public sealed class DeviceOptions
    {
        public string Id { get; set; } = "";
        public string Mac { get; set; } = "";
        public string Broadcast { get; set; } = "255.255.255.255";
        public string Host { get; set; } = "";
    }

    public static class MagicPacket
    {
        /// 6 × 0xFF then the MAC 16 times, sent to UDP 9 and 7, three times (UDP can drop).
        public static async Task SendAsync(string mac, string broadcast)
        {
            var macBytes = Convert.FromHexString(mac.Replace(":", "").Replace("-", ""));
            if (macBytes.Length != 6) throw new ArgumentException($"MAC invalide : {mac}");
            var packet = new byte[102];
            for (var i = 0; i < 6; i++) packet[i] = 0xFF;
            for (var i = 0; i < 16; i++) macBytes.CopyTo(packet, 6 + i * 6);

            using var udp = new UdpClient { EnableBroadcast = true };
            var addr = IPAddress.Parse(broadcast);
            for (var attempt = 0; attempt < 3; attempt++)
            {
                await udp.SendAsync(packet, new IPEndPoint(addr, 9));
                await udp.SendAsync(packet, new IPEndPoint(addr, 7));
                await Task.Delay(100);
            }
        }
    }

    public static class TcpProbe
    {
        public static async Task<bool> IsOpenAsync(string host, int port, TimeSpan timeout)
        {
            using var tcp = new TcpClient();
            using var cts = new CancellationTokenSource(timeout);
            try { await tcp.ConnectAsync(host, port, cts.Token); return true; }
            catch { return false; }
        }
    }

    public sealed class SteamGridDb(HttpClient http)
    {
        public async Task<(byte[]? Bytes, string Ext)> FetchAsync(string title, string style, string apiKey, CancellationToken ct)
        {
            http.DefaultRequestHeaders.Authorization = new("Bearer", apiKey);
            using var search = JsonDocument.Parse(await http.GetStringAsync($"search/autocomplete/{Uri.EscapeDataString(title)}", ct));
            var games = search.RootElement.GetProperty("data");
            if (games.GetArrayLength() == 0) return (null, "");
            var gameId = games[0].GetProperty("id").GetInt32();

            var path = style == "grid" ? $"grids/game/{gameId}?dimensions=920x430,460x215&types=static" : $"heroes/game/{gameId}?types=static";
            using var assets = JsonDocument.Parse(await http.GetStringAsync(path, ct));
            var list = assets.RootElement.GetProperty("data");
            if (list.GetArrayLength() == 0) return (null, "");
            var url = list[0].GetProperty("url").GetString()!;
            var bytes = await http.GetByteArrayAsync(url, ct);
            return (bytes, Path.GetExtension(new Uri(url).AbsolutePath) is { Length: > 0 } e ? e : ".jpg");
        }
    }
}
