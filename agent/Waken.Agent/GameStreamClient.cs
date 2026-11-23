using System.Formats.Asn1;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Xml.Linq;

namespace Waken.Agent;

/// <summary>
/// Talks to Sunshine through the GameStream protocol (HTTP 47989 / HTTPS 47984) as a paired client.
/// Because the agent runs on the PC itself, it can also type the pairing PIN into Sunshine through
/// Sunshine's admin API (47990), which makes pairing fully automatic.
/// </summary>
public sealed class GameStreamClient
{
    private readonly AgentOptions _o;
    private readonly ILogger<GameStreamClient> _log;
    private readonly string _uniqueId;
    private X509Certificate2 _clientCert;
    private X509Certificate2? _serverCert;
    private readonly SemaphoreSlim _pairLock = new(1, 1);
    private readonly SemaphoreSlim _launchLock = new(1, 1);
    private DateTime _lastLaunch = DateTime.MinValue;

    public GameStreamClient(AgentOptions o, ILogger<GameStreamClient> log)
    {
        _o = o;
        _log = log;
        Directory.CreateDirectory(o.DataDir);
        _uniqueId = LoadOrCreate(Path.Combine(o.DataDir, "uniqueid.txt"), () => Convert.ToHexString(RandomNumberGenerator.GetBytes(8)));
        _clientCert = LoadOrCreateClientCert();
        var serverPem = Path.Combine(o.DataDir, "server.pem");
        if (File.Exists(serverPem)) _serverCert = X509Certificate2.CreateFromPem(File.ReadAllText(serverPem));
    }

    private const int HttpsPortOffset = -5;
    private const int AdminPortOffset = 1;
    private const int Unauthorized = 401;
    private static readonly string[] InstalledProducts = ["Sunshine", "Apollo"];
    private static readonly TimeSpan PairingTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan LegacyPinDelay = TimeSpan.FromMilliseconds(1500);

    private string HttpBase => $"http://{_o.SunshineHost}:{_o.SunshinePort}";
    private string HttpsBase => $"https://{_o.SunshineHost}:{_o.SunshinePort + HttpsPortOffset}";
    private string AdminBase => $"https://{_o.SunshineHost}:{_o.SunshinePort + AdminPortOffset}";
    private string ServerPemPath => Path.Combine(_o.DataDir, "server.pem");
    private string Common => $"uniqueid={_uniqueId}&uuid={Guid.NewGuid():N}";

    // ---------- Identity ----------

    private static string LoadOrCreate(string path, Func<string> create)
    {
        if (File.Exists(path)) return File.ReadAllText(path).Trim();
        var v = create();
        File.WriteAllText(path, v);
        return v;
    }

    private string ClientCertPath => Path.Combine(_o.DataDir, "client.pfx");

    private X509Certificate2 LoadOrCreateClientCert()
    {
        if (!File.Exists(ClientCertPath)) CreateClientCertFile();
        return LoadClientCert();
    }

    /// <summary>
    /// A new identity for every pairing: Sunshine refuses a certificate it has paired twice, so pairing the same one again
    /// would lock the agent out for good.
    /// </summary>
    private void CreateClientCertFile()
    {
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest("CN=NVIDIA GameStream Client", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(20));
        File.WriteAllBytes(ClientCertPath, cert.Export(X509ContentType.Pfx));
    }

    private X509Certificate2 LoadClientCert()
    {
        // SChannel needs the key in the machine store; without PersistKeySet it is removed when the certificate is released.
        var flags = OperatingSystem.IsWindows() ? X509KeyStorageFlags.MachineKeySet : X509KeyStorageFlags.Exportable;
        return X509CertificateLoader.LoadPkcs12FromFile(ClientCertPath, null, flags);
    }

    /// The raw signature bytes of a certificate (the BIT STRING after tbsCertificate and the algorithm).
    private static byte[] Signature(X509Certificate2 cert)
    {
        var reader = new AsnReader(cert.RawData, AsnEncodingRules.DER).ReadSequence();
        reader.ReadEncodedValue(); // tbsCertificate
        reader.ReadEncodedValue(); // signatureAlgorithm
        return reader.ReadBitString(out _);
    }

    // ---------- Trust ----------

    /// <summary>
    /// Sunshine's certificate, read from its own folder (writable by administrators only), so that the first contact
    /// is already authenticated. A port alone proves nothing: any process can listen on it while Sunshine is stopped.
    /// </summary>
    private X509Certificate2 ExpectedCertificate()
    {
        if (!string.IsNullOrWhiteSpace(_o.SunshineCertPath)) return X509Certificate2.CreateFromPem(File.ReadAllText(_o.SunshineCertPath));

        if (OperatingSystem.IsWindows())
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            foreach (var product in InstalledProducts)
            {
                var path = Path.Combine(programFiles, product, "config", "credentials", "cacert.pem");
                if (File.Exists(path)) return X509Certificate2.CreateFromPem(File.ReadAllText(path));
            }
        }

        return _serverCert ?? throw new InvalidOperationException(
            "Certificat de Sunshine introuvable. Lance Sunshine une première fois, ou indique Agent:SunshineCertPath (…\\config\\credentials\\cacert.pem).");
    }

    // ---------- HTTP ----------

    private HttpClient PlainClient() => new() { Timeout = TimeSpan.FromMinutes(2) };

    private HttpClient TlsClient() => new(CreateTlsHandler()) { Timeout = TimeSpan.FromSeconds(30) };

    /// <summary>
    /// TLS resumption is off: Sunshine verifies client certificates without a session id context, so OpenSSL answers a
    /// resumed session with a fatal "internal error" alert (the failure of the first real test, reproduced with OpenSSL 3.6).
    /// </summary>
    internal SocketsHttpHandler CreateTlsHandler()
    {
        var expected = ExpectedCertificate().RawData;
        return new SocketsHttpHandler
        {
            SslOptions =
            {
                AllowTlsResume = false,
                ClientCertificates = new X509CertificateCollection { _clientCert },
                LocalCertificateSelectionCallback = (_, _, _, _, _) => _clientCert,
                RemoteCertificateValidationCallback = (_, cert, _, _) => cert?.GetRawCertData().AsSpan().SequenceEqual(expected) == true,
            },
        };
    }

    private static async Task<XElement> GetXml(HttpClient http, string url, CancellationToken ct)
    {
        var xml = XElement.Parse(await http.GetStringAsync(url, ct));
        var status = (int?)xml.Attribute("status_code") ?? 200;
        if (status != 200) throw new InvalidOperationException($"Sunshine: {status} {(string?)xml.Attribute("status_message")}");
        return xml;
    }

    // ---------- Pairing ----------

    /// <summary>
    /// False only when Sunshine says it does not know this client. Any other failure is thrown: pairing again after a passing
    /// network error would create a second identity for nothing.
    /// </summary>
    public async Task<bool> IsPairedAsync(CancellationToken ct)
    {
        if (_serverCert is null && !File.Exists(ServerPemPath)) return false;
        using var http = TlsClient();
        var info = XElement.Parse(await http.GetStringAsync($"{HttpsBase}/serverinfo?{Common}", ct));
        var status = (int?)info.Attribute("status_code") ?? 200;
        if (status == Unauthorized) return false;
        if (status != 200) throw new InvalidOperationException($"Sunshine: {status} {(string?)info.Attribute("status_message")}");
        return (string?)info.Element("PairStatus") == "1";
    }

    public async Task EnsurePairedAsync(CancellationToken ct)
    {
        await _pairLock.WaitAsync(ct);
        try
        {
            if (await IsPairedAsync(ct)) return;
            await PairAsync(ct);
        }
        finally { _pairLock.Release(); }
    }

    private async Task PairAsync(CancellationToken ct)
    {
        using var attempt = CancellationTokenSource.CreateLinkedTokenSource(ct);
        attempt.CancelAfter(PairingTimeout);
        try
        {
            await RunPairingAsync(attempt.Token);
        }
        catch (HttpRequestException e) when (e.InnerException is AuthenticationException)
        {
            throw new InvalidOperationException("Le service qui répond à la place de Sunshine n'a pas son certificat. Rien ne lui a été envoyé : redémarre Sunshine, puis l'agent.", e);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new InvalidOperationException($"Appairage avec Sunshine sans réponse après {PairingTimeout.TotalSeconds:0} s.");
        }
        finally
        {
            // Releases whichever request is still waiting on Sunshine when a phase failed.
            await attempt.CancelAsync();
        }
    }

    private async Task RunPairingAsync(CancellationToken ct)
    {
        CreateClientCertFile();
        var previous = _clientCert;
        _clientCert = LoadClientCert();
        previous.Dispose();

        var expectedCert = ExpectedCertificate();
        using var admin = new SunshineAdminClient(new Uri(AdminBase), _o.SunshineUser, _o.SunshinePassword, expectedCert);
        var usesPairingIds = await admin.UsesPairingIdsAsync(ct);

        var pin = RandomNumberGenerator.GetInt32(0, 10000).ToString("D4");
        var salt = RandomNumberGenerator.GetBytes(16);
        var aesKey = SHA256.HashData([.. salt, .. Encoding.UTF8.GetBytes(pin)])[..16];
        using var aes = Aes.Create();
        aes.Key = aesKey;
        var clientPem = Encoding.UTF8.GetBytes(_clientCert.ExportCertificatePem());
        using var http = PlainClient();

        // Recent Sunshine answers 409 while an earlier attempt with the same uniqueid is pending, so each attempt gets its own.
        // Older versions give the PIN to the first pending session, where a stable id is what replaces a stale one.
        var pairingClientId = usesPairingIds ? Convert.ToHexString(RandomNumberGenerator.GetBytes(8)) : _uniqueId;
        var deviceName = $"waken-{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8))}";
        var pairUrl = $"{HttpBase}/pair?uniqueid={pairingClientId}&uuid={Guid.NewGuid():N}&devicename={deviceName}&updateState=1";

        // 1. getservercert: blocks until the PIN is entered in Sunshine. We enter it ourselves.
        var getCert = GetXml(http, $"{pairUrl}&phrase=getservercert&salt={Convert.ToHexString(salt)}&clientcert={Convert.ToHexString(clientPem)}", ct);
        string? pairingId = null;
        if (usesPairingIds) pairingId = await admin.WaitForPairingIdAsync(deviceName, getCert, ct);
        else await Task.Delay(LegacyPinDelay, ct);

        // Not awaited yet: recent Sunshine only answers it after phase 4.
        var pinAccepted = admin.SubmitPinAsync(pin, pairingId, ct);
        if (await Task.WhenAny(getCert, pinAccepted) == pinAccepted) await pinAccepted;
        var certXml = await getCert;
        if ((string?)certXml.Element("paired") != "1") throw new InvalidOperationException("Sunshine a refusé l'appairage (getservercert).");
        var serverCert = X509Certificate2.CreateFromPem(Encoding.UTF8.GetString(Convert.FromHexString((string)certXml.Element("plaincert")!)));
        if (!serverCert.RawData.AsSpan().SequenceEqual(expectedCert.RawData)) throw new CryptographicException("Le certificat reçu n'est pas celui de Sunshine.");

        // 2. client challenge
        var clientChallenge = RandomNumberGenerator.GetBytes(16);
        var chXml = await GetXml(http, $"{pairUrl}&clientchallenge={Convert.ToHexString(aes.EncryptEcb(clientChallenge, PaddingMode.None))}", ct);
        var resp = aes.DecryptEcb(Convert.FromHexString((string)chXml.Element("challengeresponse")!), PaddingMode.None);
        var serverResponseHash = resp[..32];
        var serverChallenge = resp[32..48];

        // 3. answer the server challenge
        var clientSecret = RandomNumberGenerator.GetBytes(16);
        var answer = SHA256.HashData([.. serverChallenge, .. Signature(_clientCert), .. clientSecret]);
        var secXml = await GetXml(http, $"{pairUrl}&serverchallengeresp={Convert.ToHexString(aes.EncryptEcb(answer, PaddingMode.None))}", ct);
        var pairingSecret = Convert.FromHexString((string)secXml.Element("pairingsecret")!);
        var serverSecret = pairingSecret[..16];
        var serverSig = pairingSecret[16..];

        // Verify the server really knows the PIN and owns its certificate.
        var expected = SHA256.HashData([.. clientChallenge, .. Signature(serverCert), .. serverSecret]);
        using var serverKey = serverCert.GetRSAPublicKey()!;
        if (!expected.AsSpan().SequenceEqual(serverResponseHash) || !serverKey.VerifyData(serverSecret, serverSig, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
        {
            await http.GetAsync($"{HttpBase}/unpair?uniqueid={pairingClientId}", ct);
            throw new CryptographicException("Vérification du serveur échouée (PIN incorrect ou attaque MITM).");
        }

        // 4. our pairing secret, signed with our key
        using var clientKey = _clientCert.GetRSAPrivateKey()!;
        var clientSig = clientKey.SignData(clientSecret, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var doneXml = await GetXml(http, $"{pairUrl}&clientpairingsecret={Convert.ToHexString([.. clientSecret, .. clientSig])}", ct);
        if ((string?)doneXml.Element("paired") != "1") throw new InvalidOperationException("Appairage refusé (clientpairingsecret).");
        await pinAccepted;

        // 5. confirm over TLS with our client certificate
        _serverCert = serverCert;
        File.WriteAllText(ServerPemPath, serverCert.ExportCertificatePem());
        using var tls = TlsClient();
        var final = await GetXml(tls, $"{HttpsBase}/pair?{Common}&devicename=waken&updateState=1&phrase=pairchallenge", ct);
        if ((string?)final.Element("paired") != "1") throw new InvalidOperationException("Appairage TLS final refusé.");
        _log.LogInformation("Paired with Sunshine");
    }

    /// <summary>Sunshine's admin API, trusting only Sunshine's own certificate. The caller disposes it.</summary>
    internal SunshineAdminClient CreateAdminClient() =>
        new(new Uri(AdminBase), _o.SunshineUser, _o.SunshinePassword, ExpectedCertificate());

    // ---------- Apps & launch ----------

    public async Task<List<(int Id, string Title)>> AppsAsync(CancellationToken ct)
    {
        await EnsurePairedAsync(ct);
        using var http = TlsClient();
        // localAudioPlayMode=1: the computer keeps its own sound. With 0, Sunshine moves Windows' default outputs
        // (normal and communication) to its virtual speaker during the stream, and apps like Discord stay stuck
        // on it afterwards.
        var xml = await GetXml(http, $"{HttpsBase}/applist?{Common}", ct);
        return xml.Elements("App").Select(a => ((int)a.Element("ID")!, (string)a.Element("AppTitle")!)).ToList();
    }

    /// <summary>The title of the app Sunshine is streaming, or null when nothing runs.</summary>
    public async Task<string?> CurrentAppAsync(CancellationToken ct)
    {
        await EnsurePairedAsync(ct);
        using var http = TlsClient();
        var info = await GetXml(http, $"{HttpsBase}/serverinfo?{Common}", ct);
        var running = (int?)info.Element("currentgame") ?? 0;
        if (running == 0) return null;
        return (await AppsAsync(ct)).FirstOrDefault(a => a.Id == running).Title;
    }

    public sealed record LaunchResult(string AppVersion, string? GfeVersion, string RtspSessionUrl, int ServerCodecModeSupport, string RiKey, int RiKeyId);

    public async Task<LaunchResult> LaunchAsync(string appTitle, int width, int height, int fps, CancellationToken ct, bool replace = false)
    {
        await EnsurePairedAsync(ct);
        await _launchLock.WaitAsync(ct);
        try
        {
            // Sunshine ignores a launch while the previous one waits for its stream, yet answers 200: the new key would be lost.
            var window = TimeSpan.FromSeconds(_o.LaunchWindowSeconds);
            if (DateTime.UtcNow - _lastLaunch < window) await Task.Delay(window - (DateTime.UtcNow - _lastLaunch), ct);
            return await LaunchOnceAsync(appTitle, width, height, fps, replace, ct);
        }
        finally
        {
            _launchLock.Release();
        }
    }

    private async Task<LaunchResult> LaunchOnceAsync(string appTitle, int width, int height, int fps, bool replace, CancellationToken ct)
    {
        using var http = TlsClient();
        var info = await GetXml(http, $"{HttpsBase}/serverinfo?{Common}", ct);
        var apps = await AppsAsync(ct);
        var app = apps.FirstOrDefault(a => string.Equals(a.Title, appTitle, StringComparison.OrdinalIgnoreCase));
        // No fallback to Desktop: launching another app would close the game that is running.
        if (app == default) throw new InvalidOperationException($"Application « {appTitle} » introuvable dans Sunshine. Disponibles : {string.Join(", ", apps.Select(a => a.Title))}.");

        var running = (int?)info.Element("currentgame") ?? 0;
        if (running != 0 && running != app.Id)
        {
            // Closing a game loses what was not saved: only on an explicit request.
            if (!replace) throw new GameRunningException(apps.FirstOrDefault(a => a.Id == running).Title ?? "Un jeu");
            await GetXml(http, $"{HttpsBase}/cancel?{Common}", ct);
            running = 0;
        }

        var riKey = RandomNumberGenerator.GetBytes(16);
        var riKeyId = RandomNumberGenerator.GetInt32(int.MaxValue);
        var verb = running == app.Id ? "resume" : "launch";
        _lastLaunch = DateTime.UtcNow;
        var xml = await GetXml(http,
            $"{HttpsBase}/{verb}?{Common}&appid={app.Id}&mode={width}x{height}x{fps}&additionalStates=1&sops=0" +
            $"&rikey={Convert.ToHexString(riKey)}&rikeyid={riKeyId}&corever=1&localAudioPlayMode=1&surroundAudioInfo=196610&remoteControllersBitmap=0&gcmap=0", ct);

        return new LaunchResult(
            AppVersion: (string?)info.Element("appversion") ?? "7.1.431.-1",
            GfeVersion: (string?)info.Element("GfeVersion"),
            RtspSessionUrl: (string?)xml.Element("sessionUrl0") ?? "",
            ServerCodecModeSupport: (int?)info.Element("ServerCodecModeSupport") ?? 0,
            RiKey: Convert.ToHexString(riKey),
            RiKeyId: riKeyId);
    }

    public async Task QuitAsync(CancellationToken ct)
    {
        await EnsurePairedAsync(ct);
        using var http = TlsClient();
        await GetXml(http, $"{HttpsBase}/cancel?{Common}", ct);
    }
}

/// <summary>Another game runs on the PC: the caller has to ask before closing it.</summary>
public sealed class GameRunningException(string title) : Exception($"{title} tourne sur le PC. Le lancer ici le fermera.")
{
    public string Title { get; } = title;
}
