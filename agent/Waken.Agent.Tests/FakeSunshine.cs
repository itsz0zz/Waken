using System.Collections.Concurrent;
using System.Formats.Asn1;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Microsoft.Extensions.Logging;

namespace Waken.Agent.Tests;

internal enum SunshineApi
{
    /// <summary>Up to v2026.516: POST /api/pin { pin, name } answers immediately.</summary>
    Legacy,

    /// <summary>From v2026.906: pairing_id is required and the POST answers once the client has finished every phase.</summary>
    PairingId,
}

/// <summary>
/// The pairing and launch contract of Sunshine, transcribed from nvhttp.cpp and confighttp.cpp (v2026.914.233613).
/// It really checks the challenge, the signature and the TLS client certificate.
/// </summary>
internal sealed class FakeSunshine : IAsyncDisposable
{
    public const string User = "admin";
    public const string Password = "fake-sunshine-password";
    private static readonly TimeSpan CompletionTimeout = TimeSpan.FromSeconds(4);

    private sealed class Session
    {
        public required string Id { get; init; }
        public required string Name { get; init; }
        public byte[] Salt { get; init; } = [];
        public byte[] ClientCertPem { get; init; } = [];
        public TaskCompletionSource<string> Pin { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool> Completed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public byte[] Key { get; set; } = [];
        public byte[] ServerSecret { get; set; } = [];
        public byte[] ServerChallenge { get; set; } = [];
        public byte[] ClientHash { get; set; } = [];
    }

    private readonly SunshineApi _api;
    private readonly X509Certificate2 _certificate;
    private readonly ConcurrentDictionary<string, Session> _sessions = new();
    // A list, like Sunshine's: pairing the same certificate twice locks it out.
    private readonly ConcurrentQueue<string> _pairedCertificates = new();
    private DateTime _pendingLaunchUntil;
    private readonly WebApplication _app;
    private int _pairingsStarted;
    private int _adminRequests;

    public int Port { get; }
    public int PairingsStarted => _pairingsStarted;
    public string CertificatePem => _certificate.ExportCertificatePem();
    public int AdminRequests => _adminRequests;
    public List<string> ApprovedIds { get; } = [];
    public List<string> Verbs { get; } = [];
    public int CurrentGame { get; set; }
    public int TransientFailures { get; set; }
    public TimeSpan PendingLaunchWindow { get; set; } = TimeSpan.Zero;
    public int IgnoredLaunches { get; private set; }
    public void ForgetClients() => _pairedCertificates.Clear();

    /// <summary>apps.json, as saved by confighttp.cpp: entries kept verbatim, sorted by name after each POST.</summary>
    public List<System.Text.Json.Nodes.JsonObject> AppsFile { get; } = [new() { ["name"] = "Desktop", ["image-path"] = "desktop.png" }];
    public int AppWrites { get; private set; }

    private FakeSunshine(SunshineApi api)
    {
        _api = api;
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=Sunshine Gamestream Host", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var created = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        _certificate = X509CertificateLoader.LoadPkcs12(created.Export(X509ContentType.Pfx), null, X509KeyStorageFlags.Exportable);

        Port = FindFreeBasePort();
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseKestrelHttpsConfiguration();
        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            kestrel.Listen(IPAddress.Loopback, Port);
            kestrel.Listen(IPAddress.Loopback, Port - 5, listen => listen.UseHttps(https =>
            {
                https.ServerCertificate = _certificate;
                https.ClientCertificateMode = ClientCertificateMode.AllowCertificate;
                https.AllowAnyClientCertificate();
            }));
            kestrel.Listen(IPAddress.Loopback, Port + 1, listen => listen.UseHttps(_certificate));
        });
        _app = builder.Build();
        _app.Run(HandleAsync);
    }

    public static async Task<FakeSunshine> StartAsync(SunshineApi api)
    {
        var fake = new FakeSunshine(api);
        await fake._app.StartAsync();
        return fake;
    }

    /// <summary>Another device waiting for a PIN, with a name chosen to look like the agent.</summary>
    public string AddForeignPairingRequest(string name)
    {
        var id = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        _sessions["foreign"] = new Session { Id = id, Name = name };
        return id;
    }

    private Task HandleAsync(HttpContext context)
    {
        var port = context.Connection.LocalPort;
        if (port == Port + 1)
        {
            Interlocked.Increment(ref _adminRequests);
            return HandleAdminAsync(context);
        }

        var path = context.Request.Path.Value;
        if (path == "/pair") return HandlePairAsync(context);
        if (port != Port - 5) return XmlAsync(context, 404);
        if (TransientFailures > 0)
        {
            TransientFailures--;
            return XmlAsync(context, 503);
        }
        if (context.Connection.ClientCertificate is not { } client || _pairedCertificates.Count(c => c == client.Thumbprint) != 1) return XmlAsync(context, 401);

        switch (path)
        {
            case "/serverinfo":
                return XmlAsync(context, 200,
                    new XElement("PairStatus", 1), new XElement("appversion", "7.1.431.-1"), new XElement("GfeVersion", "3.23.0.74"),
                    new XElement("ServerCodecModeSupport", 257), new XElement("currentgame", CurrentGame));
            case "/applist":
                return XmlAsync(context, 200,
                    App("Desktop", 1), App("Steam Big Picture", 2));
            case "/launch":
            case "/resume":
                Verbs.Add(path[1..]);
                if (DateTime.UtcNow < _pendingLaunchUntil) IgnoredLaunches++; // answers 200, but keeps the previous key
                else _pendingLaunchUntil = DateTime.UtcNow + PendingLaunchWindow;
                if (path == "/launch") CurrentGame = int.Parse(context.Request.Query["appid"].ToString());
                var scheme = int.TryParse(context.Request.Query["corever"], out var core) && core >= 1 ? "rtspenc" : "rtsp";
                return XmlAsync(context, 200, new XElement("sessionUrl0", $"{scheme}://127.0.0.1:48010"));
            case "/cancel":
                Verbs.Add("cancel");
                CurrentGame = 0;
                return XmlAsync(context, 200);
            default:
                return XmlAsync(context, 404);
        }
    }

    private async Task HandleAppsAsync(HttpContext context)
    {
        var path = context.Request.Path.Value!;
        if (path == "/api/apps" && HttpMethods.IsGet(context.Request.Method))
        {
            await context.Response.WriteAsJsonAsync(new { apps = AppsFile, env = new { } });
            return;
        }
        if (path == "/api/apps" && HttpMethods.IsPost(context.Request.Method))
        {
            if (context.Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) != true)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            var input = (await System.Text.Json.Nodes.JsonNode.ParseAsync(context.Request.Body))!.AsObject();
            var index = input["index"]!.GetValue<int>();
            input.Remove("index");
            if (index == -1) AppsFile.Add(input);
            else AppsFile[index] = input;
            AppsFile.Sort((a, b) => string.CompareOrdinal(a["name"]!.GetValue<string>(), b["name"]!.GetValue<string>()));
            AppWrites++;
            await context.Response.WriteAsJsonAsync(new { status = true });
            return;
        }
        if (HttpMethods.IsDelete(context.Request.Method) && int.TryParse(path["/api/apps/".Length..], out var remove))
        {
            if (remove < 0 || remove >= AppsFile.Count)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            AppsFile.RemoveAt(remove);
            AppWrites++;
            await context.Response.WriteAsJsonAsync(new { status = true });
            return;
        }
        context.Response.StatusCode = StatusCodes.Status404NotFound;
    }

    private async Task HandleAdminAsync(HttpContext context)
    {
        var expected = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes($"{User}:{Password}"));
        if (context.Request.Headers.Authorization.ToString() != expected)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (context.Request.Path.StartsWithSegments("/api/apps"))
        {
            await HandleAppsAsync(context);
            return;
        }

        if (context.Request.Path != "/api/pin" || (HttpMethods.IsGet(context.Request.Method) && _api == SunshineApi.Legacy))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        if (HttpMethods.IsGet(context.Request.Method))
        {
            var waiting = _sessions.Values.Where(s => !s.Pin.Task.IsCompleted).Select(s => new { id = s.Id, name = s.Name, address = "127.0.0.1" });
            await context.Response.WriteAsJsonAsync(new { pairings = waiting });
            return;
        }

        if (context.Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) != true)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        using var body = await JsonDocument.ParseAsync(context.Request.Body);
        var pin = body.RootElement.GetProperty("pin").GetString() ?? "";
        Session? session;
        if (_api == SunshineApi.Legacy)
        {
            session = _sessions.Values.FirstOrDefault(s => !s.Pin.Task.IsCompleted);
        }
        else
        {
            if (!body.RootElement.TryGetProperty("pairing_id", out var id) || id.GetString() is not { Length: 32 } pairingId)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            ApprovedIds.Add(pairingId);
            session = _sessions.Values.FirstOrDefault(s => s.Id == pairingId);
        }

        if (session is null)
        {
            await context.Response.WriteAsJsonAsync(new { status = false });
            return;
        }

        session.Pin.TrySetResult(pin);
        var paired = true;
        if (_api == SunshineApi.PairingId)
        {
            if (await Task.WhenAny(session.Completed.Task, Task.Delay(CompletionTimeout)) == session.Completed.Task)
            {
                paired = await session.Completed.Task;
            }
            else
            {
                // Like Sunshine: the session is erased when the client did not finish in time.
                foreach (var entry in _sessions.Where(e => e.Value == session)) _sessions.TryRemove(entry.Key, out _);
                paired = false;
            }
        }

        await context.Response.WriteAsJsonAsync(new { status = paired });
    }

    private async Task HandlePairAsync(HttpContext context)
    {
        var query = context.Request.Query;
        var uniqueId = query["uniqueid"].ToString();

        if (query["phrase"] == "pairchallenge")
        {
            await XmlAsync(context, 200, new XElement("paired", 1));
            return;
        }

        if (query["phrase"] == "getservercert")
        {
            var created = new Session
            {
                Id = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)),
                Name = query["devicename"].ToString(),
                Salt = Convert.FromHexString(query["salt"].ToString()),
                ClientCertPem = Convert.FromHexString(query["clientcert"].ToString()),
            };
            if (!_sessions.TryAdd(uniqueId, created))
            {
                await XmlAsync(context, 409);
                return;
            }

            Interlocked.Increment(ref _pairingsStarted);
            try
            {
                var pin = await created.Pin.Task.WaitAsync(TimeSpan.FromSeconds(30), context.RequestAborted);
                created.Key = SHA256.HashData([.. created.Salt, .. Encoding.UTF8.GetBytes(pin)])[..16];
            }
            catch (Exception e) when (e is OperationCanceledException or TimeoutException)
            {
                _sessions.TryRemove(uniqueId, out _);
                return;
            }

            await XmlAsync(context, 200, new XElement("paired", 1),
                new XElement("plaincert", Convert.ToHexString(Encoding.UTF8.GetBytes(_certificate.ExportCertificatePem()))));
            return;
        }

        if (!_sessions.TryGetValue(uniqueId, out var session))
        {
            await XmlAsync(context, 400);
            return;
        }

        using var aes = Aes.Create();
        aes.Key = session.Key;

        if (query.ContainsKey("clientchallenge"))
        {
            var challenge = aes.DecryptEcb(Convert.FromHexString(query["clientchallenge"].ToString()), PaddingMode.None);
            session.ServerSecret = RandomNumberGenerator.GetBytes(16);
            session.ServerChallenge = RandomNumberGenerator.GetBytes(16);
            var hash = SHA256.HashData([.. challenge, .. SignatureOf(_certificate), .. session.ServerSecret]);
            var answer = aes.EncryptEcb([.. hash, .. session.ServerChallenge], PaddingMode.None);
            await XmlAsync(context, 200, new XElement("paired", 1), new XElement("challengeresponse", Convert.ToHexString(answer)));
        }
        else if (query.ContainsKey("serverchallengeresp"))
        {
            session.ClientHash = aes.DecryptEcb(Convert.FromHexString(query["serverchallengeresp"].ToString()), PaddingMode.None);
            using var key = _certificate.GetRSAPrivateKey()!; // created with an RSA key in the constructor
            var signature = key.SignData(session.ServerSecret, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            await XmlAsync(context, 200, new XElement("paired", 1), new XElement("pairingsecret", Convert.ToHexString([.. session.ServerSecret, .. signature])));
        }
        else if (query.ContainsKey("clientpairingsecret"))
        {
            var secret = Convert.FromHexString(query["clientpairingsecret"].ToString());
            using var client = X509Certificate2.CreateFromPem(Encoding.UTF8.GetString(session.ClientCertPem));
            var expected = SHA256.HashData([.. session.ServerChallenge, .. SignatureOf(client), .. secret[..16]]);
            using var key = client.GetRSAPublicKey()!; // the agent always sends an RSA certificate
            var valid = expected.SequenceEqual(session.ClientHash)
                && key.VerifyData(secret[..16], secret[16..], HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

            if (valid) _pairedCertificates.Enqueue(client.Thumbprint);
            _sessions.TryRemove(uniqueId, out _);
            session.Completed.TrySetResult(valid);
            await XmlAsync(context, 200, new XElement("paired", valid ? 1 : 0));
        }
        else
        {
            await XmlAsync(context, 400);
        }
    }

    private static byte[] SignatureOf(X509Certificate2 certificate)
    {
        var reader = new AsnReader(certificate.RawData, AsnEncodingRules.DER).ReadSequence();
        reader.ReadEncodedValue();
        reader.ReadEncodedValue();
        return reader.ReadBitString(out _);
    }

    private static XElement App(string title, int id) => new("App", new XElement("AppTitle", title), new XElement("ID", id));

    private static Task XmlAsync(HttpContext context, int status, params XElement[] elements) =>
        context.Response.WriteAsync(new XElement("root", new XAttribute("status_code", status), elements).ToString());

    private static int FindFreeBasePort()
    {
        while (true)
        {
            var port = Random.Shared.Next(20000, 40000);
            if (IsFree(port) && IsFree(port - 5) && IsFree(port + 1)) return port;
        }
    }

    private static bool IsFree(int port)
    {
        try
        {
            using var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _app.DisposeAsync();
        _certificate.Dispose();
    }
}
