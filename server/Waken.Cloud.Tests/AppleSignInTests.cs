using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;

namespace Waken.Cloud.Tests;

/// <summary>Apple's identity tokens checked like Apple signs them: RS256 with a key from its published set.</summary>
public sealed class AppleSignInTests : IDisposable
{
    private readonly RSA _apple = RSA.Create(2048);
    private readonly RSA _other = RSA.Create(2048);
    private readonly ManualClock _clock = new();
    public void Dispose()
    {
        _apple.Dispose();
        _other.Dispose();
    }

    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed class Keys(RSA key) : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            var p = key.ExportParameters(false);
            var body = JsonSerializer.Serialize(new { keys = new[] { new { kty = "RSA", kid = "K1", alg = "RS256", n = B64(p.Modulus!), e = B64(p.Exponent!) } } });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private string Token(RSA signer, string aud = "fr.wakenplay.app", string iss = "https://appleid.apple.com", long? exp = null, string kid = "K1")
    {
        var header = B64(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", kid }));
        var claims = B64(JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss, aud, sub = "001234.abcd", email = "x@privaterelay.appleid.com", email_verified = "true",
            iat = _clock.GetUtcNow().ToUnixTimeSeconds(), exp = exp ?? _clock.GetUtcNow().AddMinutes(10).ToUnixTimeSeconds(),
        }));
        var sig = signer.SignData(Encoding.ASCII.GetBytes($"{header}.{claims}"), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return $"{header}.{claims}.{B64(sig)}";
    }

    private (AppleSignIn, Keys) Apple()
    {
        var keys = new Keys(_apple);
        return (new AppleSignIn(new HttpClient(keys), new AppleOptions(), _clock, NullLogger<AppleSignIn>.Instance), keys);
    }

    [Fact]
    public async Task Accepts_a_token_signed_by_apple_for_the_app()
    {
        var (apple, keys) = Apple();
        var id = await apple.ValidateAsync(Token(_apple), default);
        Assert.Equal(("001234.abcd", "x@privaterelay.appleid.com", true, "fr.wakenplay.app"), (id.Subject, id.Email, id.EmailVerified, id.ClientId));
        await apple.ValidateAsync(Token(_apple), default);
        Assert.Equal(1, keys.Calls);
    }

    [Fact]
    public async Task Refuses_a_token_signed_by_someone_else()
    {
        var (apple, _) = Apple();
        await Assert.ThrowsAsync<AppleTokenException>(() => apple.ValidateAsync(Token(_other), default));
    }

    [Fact]
    public async Task Refuses_another_app_another_issuer_an_expired_token_or_an_unknown_key()
    {
        var (apple, _) = Apple();
        await Assert.ThrowsAsync<AppleTokenException>(() => apple.ValidateAsync(Token(_apple, aud: "com.autre.app"), default));
        await Assert.ThrowsAsync<AppleTokenException>(() => apple.ValidateAsync(Token(_apple, iss: "https://faux.example"), default));
        await Assert.ThrowsAsync<AppleTokenException>(() => apple.ValidateAsync(Token(_apple, exp: _clock.GetUtcNow().AddMinutes(-10).ToUnixTimeSeconds()), default));
        await Assert.ThrowsAsync<AppleTokenException>(() => apple.ValidateAsync(Token(_apple, kid: "K9"), default));
        await Assert.ThrowsAsync<AppleTokenException>(() => apple.ValidateAsync("pas.un.jeton", default));
    }
}
