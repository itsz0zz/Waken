using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;

namespace Waken.Cloud.Tests;

public sealed class ApnsSenderTests : IDisposable
{
    private readonly string _keyFile = Path.Combine(Path.GetTempPath(), $"apns-{Guid.NewGuid():N}.p8");
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public ApnsSenderTests() => File.WriteAllText(_keyFile, _key.ExportPkcs8PrivateKeyPem());

    public void Dispose()
    {
        _key.Dispose();
        File.Delete(_keyFile);
    }

    private sealed class Apple(Func<HttpRequestMessage, (HttpStatusCode, string)> answer) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request);
            Bodies.Add(await request.Content!.ReadAsStringAsync(ct));
            var (status, body) = answer(request);
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private ApnsSender Sender(Apple apple) => new(
        new HttpClient(apple),
        new ApnsOptions { KeyPath = _keyFile, KeyId = "KEY1234567", TeamId = "TEAM123456", IosTopic = "app.waken.ios", MacTopic = "app.waken.mac" },
        NullLogger<ApnsSender>.Instance,
        TimeProvider.System);

    private static PushDevice Device(string platform = "ios", bool? sandbox = null) => new() { Token = "abcd", Platform = platform, Name = "iPhone", Sandbox = sandbox };

    [Fact]
    public async Task Sends_an_alert_over_http2_with_a_signed_token()
    {
        var apple = new Apple(_ => (HttpStatusCode.OK, ""));
        var device = Device();
        Assert.Equal(PushResult.Sent, await Sender(apple).SendAsync(device, new PushMessage("Titre", "Texte", "device"), default));

        var req = Assert.Single(apple.Requests);
        Assert.Equal("https://api.push.apple.com/3/device/abcd", req.RequestUri!.ToString());
        Assert.Equal(HttpVersion.Version20, req.Version);
        Assert.Equal("app.waken.ios", req.Headers.GetValues("apns-topic").Single());
        Assert.Equal("alert", req.Headers.GetValues("apns-push-type").Single());
        var body = JsonDocument.Parse(apple.Bodies[0]).RootElement;
        Assert.Equal("Titre", body.GetProperty("aps").GetProperty("alert").GetProperty("title").GetString());
        Assert.Equal("device", body.GetProperty("kind").GetString());
        Assert.False(device.Sandbox);

        // ES256 over "header.claims", checked with the public half of the key.
        var parts = req.Headers.Authorization!.Parameter!.Split('.');
        static byte[] Decode(string s) => Convert.FromBase64String(s.Replace('-', '+').Replace('_', '/').PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
        Assert.Equal("KEY1234567", JsonDocument.Parse(Decode(parts[0])).RootElement.GetProperty("kid").GetString());
        Assert.Equal("TEAM123456", JsonDocument.Parse(Decode(parts[1])).RootElement.GetProperty("iss").GetString());
        Assert.True(_key.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), Decode(parts[2]), HashAlgorithmName.SHA256));
    }

    [Fact]
    public async Task A_development_token_falls_back_to_the_sandbox_once_and_remembers()
    {
        var apple = new Apple(r => r.RequestUri!.Host == "api.push.apple.com" ? (HttpStatusCode.BadRequest, """{"reason":"BadDeviceToken"}""") : (HttpStatusCode.OK, ""));
        var device = Device();
        Assert.Equal(PushResult.Sent, await Sender(apple).SendAsync(device, new PushMessage("t", "b", "k"), default));
        Assert.True(device.Sandbox);
        Assert.Equal(2, apple.Requests.Count);
        await Sender(apple).SendAsync(device, new PushMessage("t", "b", "k"), default);
        Assert.Equal("api.sandbox.push.apple.com", apple.Requests[2].RequestUri!.Host);
    }

    [Fact]
    public async Task A_removed_app_is_gone()
    {
        var apple = new Apple(_ => (HttpStatusCode.Gone, """{"reason":"Unregistered"}"""));
        Assert.Equal(PushResult.Gone, await Sender(apple).SendAsync(Device(sandbox: false), new PushMessage("t", "b", "k"), default));
    }

    [Fact]
    public async Task The_mac_app_uses_its_own_topic()
    {
        var apple = new Apple(_ => (HttpStatusCode.OK, ""));
        await Sender(apple).SendAsync(Device("macos", sandbox: false), new PushMessage("t", "b", "k"), default);
        Assert.Equal("app.waken.mac", apple.Requests[0].Headers.GetValues("apns-topic").Single());
    }

    [Theory]
    [InlineData("waken-host-mac-de-enzo", "Mac de enzo")]
    [InlineData("waken-iphone-15", "Iphone 15")]
    [InlineData("waken-", "Un appareil")]
    public void Device_names_read_like_names(string node, string shown) => Assert.Equal(shown, DeviceNames.Display(node));
}
