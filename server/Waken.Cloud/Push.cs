using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Waken.Cloud;

/// <summary>A device that receives the account's notifications (an APNs token: iPhone, iPad, Mac).</summary>
public sealed class PushDevice
{
    public int Id { get; set; }
    public string UserId { get; set; } = "";
    public string Token { get; set; } = "";
    /// <summary>ios | macos.</summary>
    public string Platform { get; set; } = "ios";
    public string Name { get; set; } = "";
    /// <summary>Apple's sandbox (development builds) or production: learnt from Apple's answer, see ApnsSender.</summary>
    public bool? Sandbox { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>A notification kept for the account: the app lists them (the bell), push or not.</summary>
public sealed class AccountNotification
{
    public long Id { get; set; }
    public string UserId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string Kind { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public bool Read { get; set; }
}

/// <summary>What a notification says. Kind lets the app route a tap (device, machine, session).</summary>
public sealed record PushMessage(string Title, string Body, string Kind);

public enum PushResult { Sent, Gone, Failed }

public interface IPushSender
{
    Task<PushResult> SendAsync(PushDevice device, PushMessage message, CancellationToken ct);
}

/// <summary>No APNs key configured: notifications are only logged (development, tests).</summary>
public sealed class LogPushSender(ILogger<LogPushSender> log) : IPushSender
{
    public Task<PushResult> SendAsync(PushDevice device, PushMessage message, CancellationToken ct)
    {
        log.LogInformation("Notification ({Kind}) pour {Device} : {Title}", message.Kind, device.Name, message.Title);
        return Task.FromResult(PushResult.Sent);
    }
}

public sealed class ApnsOptions
{
    /// <summary>The .p8 key from developer.apple.com (Keys, Apple Push Notifications service).</summary>
    public string KeyPath { get; set; } = "";
    public string KeyId { get; set; } = "";
    public string TeamId { get; set; } = "";
    /// <summary>The apps' bundle id: iPhone and Mac each have theirs.</summary>
    public string IosTopic { get; set; } = "";
    public string MacTopic { get; set; } = "";

    public bool Configured => KeyPath != "" && KeyId != "" && TeamId != "" && IosTopic != "";
}

/// <summary>
/// Apple Push Notification service over HTTP/2, signed with a token key (JWT ES256, renewed every 50 minutes).
/// A token from a development build only works on the sandbox: the first answer tells which, it is kept.
/// </summary>
public sealed class ApnsSender : IPushSender, IDisposable
{
    private const string Production = "https://api.push.apple.com";
    private const string Sandbox = "https://api.sandbox.push.apple.com";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly ApnsOptions _options;
    private readonly ECDsa _key;
    private readonly ILogger<ApnsSender> _log;
    private readonly TimeProvider _clock;
    private (string Jwt, DateTimeOffset At)? _jwt;
    private readonly Lock _jwtLock = new();

    public ApnsSender(HttpClient http, ApnsOptions options, ILogger<ApnsSender> log, TimeProvider clock)
    {
        _http = http;
        _options = options;
        _log = log;
        _clock = clock;
        _key = ECDsa.Create();
        _key.ImportFromPem(File.ReadAllText(options.KeyPath));
    }

    public void Dispose() => _key.Dispose();

    public async Task<PushResult> SendAsync(PushDevice device, PushMessage message, CancellationToken ct)
    {
        var first = await PostAsync(device, message, device.Sandbox == true, ct);
        if (first.Result != PushResult.Gone || device.Sandbox is not null || first.Reason != "BadDeviceToken") return first.Result;
        // Never sent before: a development build's token is "bad" for production, try the sandbox once.
        var second = await PostAsync(device, message, sandbox: true, ct);
        if (second.Result == PushResult.Sent) device.Sandbox = true;
        return second.Result;
    }

    private async Task<(PushResult Result, string? Reason)> PostAsync(PushDevice device, PushMessage message, bool sandbox, CancellationToken ct)
    {
        var topic = device.Platform == "macos" && _options.MacTopic != "" ? _options.MacTopic : _options.IosTopic;
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{(sandbox ? Sandbox : Production)}/3/device/{Uri.EscapeDataString(device.Token)}")
        {
            Version = HttpVersion.Version20,
            VersionPolicy = HttpVersionPolicy.RequestVersionExact,
            Content = JsonContent.Create(new
            {
                aps = new { alert = new { title = message.Title, body = message.Body }, sound = "default" },
                kind = message.Kind,
            }, options: Json),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("bearer", Jwt());
        req.Headers.Add("apns-topic", topic);
        req.Headers.Add("apns-push-type", "alert");
        req.Headers.Add("apns-priority", "10");
        try
        {
            using var res = await _http.SendAsync(req, ct);
            if (res.IsSuccessStatusCode)
            {
                device.Sandbox ??= sandbox;
                return (PushResult.Sent, null);
            }
            var reason = (await res.Content.ReadFromJsonAsync<ApnsError>(Json, ct))?.Reason;
            // 410: the app was removed. BadDeviceToken: not a token of this environment (or not a token).
            if (res.StatusCode == HttpStatusCode.Gone || reason is "BadDeviceToken" or "Unregistered") return (PushResult.Gone, reason);
            _log.LogWarning("APNs {Status} {Reason} pour {Device}", (int)res.StatusCode, reason, device.Name);
            return (PushResult.Failed, reason);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            _log.LogWarning("APNs injoignable : {Message}", e.Message);
            return (PushResult.Failed, null);
        }
    }

    /// <summary>Apple refuses a token key JWT older than an hour, and one renewed more than every 20 minutes.</summary>
    private string Jwt()
    {
        lock (_jwtLock)
        {
            var now = _clock.GetUtcNow();
            if (_jwt is { } cached && now - cached.At < TimeSpan.FromMinutes(50)) return cached.Jwt;
            var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "ES256", kid = _options.KeyId }));
            var claims = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { iss = _options.TeamId, iat = now.ToUnixTimeSeconds() }));
            var signature = _key.SignData(Encoding.ASCII.GetBytes($"{header}.{claims}"), HashAlgorithmName.SHA256);
            var jwt = $"{header}.{claims}.{Base64Url(signature)}";
            _jwt = (jwt, now);
            return jwt;
        }
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record ApnsError(string? Reason);
}

/// <summary>Sends a message to every device of an account, forgetting the tokens Apple says are gone.</summary>
public sealed class Notifier(IServiceScopeFactory scopes, IPushSender sender, TimeProvider clock, ILogger<Notifier> log)
{
    /// <summary>An account keeps its last notifications only: older ones go.</summary>
    public const int Kept = 50;

    /// <summary>The last messages, for the tests and the logs.</summary>
    public ConcurrentQueue<(string UserId, PushMessage Message)> Sent { get; } = new();

    public async Task NotifyAsync(string userId, PushMessage message, CancellationToken ct, string? exceptToken = null)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CloudDb>();
        var devices = await db.PushDevices.Where(d => d.UserId == userId && d.Token != exceptToken).ToListAsync(ct);
        log.LogInformation("Notification {Kind} pour le compte {UserId} ({Devices} appareils) : {Title}", message.Kind, userId, devices.Count, message.Title);
        Sent.Enqueue((userId, message));
        while (Sent.Count > 100) Sent.TryDequeue(out _);
        db.Notifications.Add(new AccountNotification { UserId = userId, Title = message.Title, Body = message.Body, Kind = message.Kind, CreatedAt = clock.GetUtcNow() });
        foreach (var device in devices)
        {
            var result = await sender.SendAsync(device, message, ct);
            if (result == PushResult.Gone)
            {
                log.LogInformation("Jeton de notification oublié : {Device}", device.Name);
                db.PushDevices.Remove(device);
            }
        }
        await db.SaveChangesAsync(ct);
        var old = db.Notifications.Where(n => n.UserId == userId).OrderByDescending(n => n.Id).Skip(Kept);
        await db.Notifications.Where(n => old.Select(o => o.Id).Contains(n.Id)).ExecuteDeleteAsync(ct);
    }
}

/// <summary>Device names on the network ("waken-host-mac-de-enzo") as people read them ("Mac de Enzo").</summary>
public static class DeviceNames
{
    public const string HostPrefix = "waken-host-";

    public static bool IsHost(string name) => name.StartsWith(HostPrefix, StringComparison.Ordinal);

    public static string Display(string name)
    {
        var slug = IsHost(name) ? name[HostPrefix.Length..] : name.StartsWith("waken-", StringComparison.Ordinal) ? name[6..] : name;
        var words = slug.Replace('-', ' ').Trim();
        return words.Length == 0 ? "Un appareil" : char.ToUpperInvariant(words[0]) + words[1..];
    }
}
