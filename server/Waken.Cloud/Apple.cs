using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Waken.Cloud;

/// <summary>Sign in with Apple: the apps' identifiers, and the key that revokes Apple's tokens on account deletion.</summary>
public sealed class AppleOptions
{
    /// <summary>The apps allowed to sign in (the "aud" of Apple's identity tokens).</summary>
    public string[] ClientIds { get; set; } = ["fr.wakenplay.app", "fr.wakenplay.mac"];
    /// <summary>A key with "Sign in with Apple" enabled (developer.apple.com, Keys): it may be the APNs key.</summary>
    public string KeyPath { get; set; } = "";
    public string KeyId { get; set; } = "";
    public string TeamId { get; set; } = "";

    public bool CanRevoke => KeyPath != "" && KeyId != "" && TeamId != "";
}

/// <summary>Who Apple says signed in, from a verified identity token.</summary>
public sealed record AppleIdentity(string Subject, string? Email, bool EmailVerified, string ClientId);

public sealed class AppleTokenException(string message) : Exception(message);

public interface IAppleSignIn
{
    /// <summary>Checks the token's signature (Apple's published keys), issuer, audience and expiry.</summary>
    Task<AppleIdentity> ValidateAsync(string identityToken, CancellationToken ct);
    /// <summary>The one-time code from the app, exchanged for a refresh token kept to revoke later. Null without a key.</summary>
    Task<string?> ExchangeCodeAsync(string code, string clientId, CancellationToken ct);
    /// <summary>Apple requires it when the account is deleted: the app no longer appears in the user's Apple ID.</summary>
    Task RevokeAsync(string refreshToken, string clientId, CancellationToken ct);
}

/// <summary>
/// Sign in with Apple, server side. Identity tokens are RS256 JWTs signed by one of Apple's keys
/// (https://appleid.apple.com/auth/keys), checked here without any extra library.
/// </summary>
public sealed class AppleSignIn(HttpClient http, AppleOptions options, TimeProvider clock, ILogger<AppleSignIn> log) : IAppleSignIn
{
    public const string Issuer = "https://appleid.apple.com";
    private static readonly TimeSpan KeysFor = TimeSpan.FromHours(12);
    private static readonly TimeSpan Skew = TimeSpan.FromMinutes(2);

    private Dictionary<string, RSAParameters> _keys = [];
    private DateTimeOffset _keysAt;
    private readonly SemaphoreSlim _keysLock = new(1, 1);

    public async Task<AppleIdentity> ValidateAsync(string identityToken, CancellationToken ct)
    {
        var parts = identityToken.Split('.');
        if (parts.Length != 3) throw new AppleTokenException("Jeton Apple mal formé");
        JsonObject header, claims;
        try
        {
            header = JsonNode.Parse(Base64Url(parts[0]))!.AsObject();
            claims = JsonNode.Parse(Base64Url(parts[1]))!.AsObject();
        }
        catch (Exception e) when (e is JsonException or FormatException or InvalidOperationException)
        {
            throw new AppleTokenException("Jeton Apple mal formé");
        }
        if (header["alg"]?.GetValue<string>() != "RS256") throw new AppleTokenException("Algorithme inattendu");
        var kid = header["kid"]?.GetValue<string>() ?? throw new AppleTokenException("Clé absente du jeton");

        var key = await KeyAsync(kid, ct) ?? throw new AppleTokenException("Clé Apple inconnue");
        using var rsa = RSA.Create(key);
        if (!rsa.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), Base64Url(parts[2]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
            throw new AppleTokenException("Signature invalide");

        if (claims["iss"]?.GetValue<string>() != Issuer) throw new AppleTokenException("Émetteur inattendu");
        var aud = claims["aud"]?.GetValue<string>();
        if (aud is null || !options.ClientIds.Contains(aud, StringComparer.Ordinal)) throw new AppleTokenException("Jeton émis pour une autre app");
        var now = clock.GetUtcNow();
        if (claims["exp"]?.GetValue<long>() is not { } exp || DateTimeOffset.FromUnixTimeSeconds(exp) + Skew < now) throw new AppleTokenException("Jeton expiré");
        var sub = claims["sub"]?.GetValue<string>();
        if (string.IsNullOrEmpty(sub)) throw new AppleTokenException("Jeton sans identifiant");
        var email = claims["email"]?.GetValue<string>();
        // Apple sends it as a boolean or as "true".
        var verified = claims["email_verified"] is JsonValue v && (v.TryGetValue<bool>(out var b) ? b : v.ToString() == "true");
        return new AppleIdentity(sub, email, verified, aud);
    }

    /// <summary>Apple's keys, read again every 12 hours, and at once when a token names one not seen yet.</summary>
    private async Task<RSAParameters?> KeyAsync(string kid, CancellationToken ct)
    {
        if (_keys.TryGetValue(kid, out var known) && clock.GetUtcNow() - _keysAt < KeysFor) return known;
        await _keysLock.WaitAsync(ct);
        try
        {
            if (_keys.TryGetValue(kid, out known) && clock.GetUtcNow() - _keysAt < KeysFor) return known;
            var jwks = await http.GetFromJsonAsync<JsonObject>($"{Issuer}/auth/keys", ct) ?? throw new AppleTokenException("Clés Apple illisibles");
            var keys = new Dictionary<string, RSAParameters>();
            foreach (var k in jwks["keys"]?.AsArray() ?? [])
            {
                if (k?["kty"]?.GetValue<string>() != "RSA" || k["kid"]?.GetValue<string>() is not { } id) continue;
                keys[id] = new RSAParameters { Modulus = Base64Url(k["n"]!.GetValue<string>()), Exponent = Base64Url(k["e"]!.GetValue<string>()) };
            }
            _keys = keys;
            _keysAt = clock.GetUtcNow();
            return keys.TryGetValue(kid, out var found) ? found : null;
        }
        catch (HttpRequestException e)
        {
            log.LogWarning("Clés Apple injoignables : {Message}", e.Message);
            throw new AppleTokenException("Apple ne répond pas, réessaie");
        }
        finally
        {
            _keysLock.Release();
        }
    }

    public async Task<string?> ExchangeCodeAsync(string code, string clientId, CancellationToken ct)
    {
        if (!options.CanRevoke) return null;
        using var res = await http.PostAsync($"{Issuer}/auth/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = ClientSecret(clientId),
            ["code"] = code,
            ["grant_type"] = "authorization_code",
        }), ct);
        if (!res.IsSuccessStatusCode)
        {
            log.LogWarning("Code Apple refusé : HTTP {Status}", (int)res.StatusCode);
            return null;
        }
        return (await res.Content.ReadFromJsonAsync<JsonObject>(ct))?["refresh_token"]?.GetValue<string>();
    }

    public async Task RevokeAsync(string refreshToken, string clientId, CancellationToken ct)
    {
        if (!options.CanRevoke) return;
        using var res = await http.PostAsync($"{Issuer}/auth/revoke", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = ClientSecret(clientId),
            ["token"] = refreshToken,
            ["token_type_hint"] = "refresh_token",
        }), ct);
        if (!res.IsSuccessStatusCode) log.LogWarning("Révocation Apple refusée : HTTP {Status}", (int)res.StatusCode);
    }

    /// <summary>Apple's client secret: a JWT (ES256) signed with the team's key, valid a few minutes.</summary>
    private string ClientSecret(string clientId)
    {
        using var key = ECDsa.Create();
        key.ImportFromPem(File.ReadAllText(options.KeyPath));
        var now = clock.GetUtcNow();
        var header = B64(JsonSerializer.SerializeToUtf8Bytes(new { alg = "ES256", kid = options.KeyId }));
        var claims = B64(JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss = options.TeamId,
            iat = now.ToUnixTimeSeconds(),
            exp = now.AddMinutes(5).ToUnixTimeSeconds(),
            aud = Issuer,
            sub = clientId,
        }));
        var signature = key.SignData(Encoding.ASCII.GetBytes($"{header}.{claims}"), HashAlgorithmName.SHA256);
        return $"{header}.{claims}.{B64(signature)}";
    }

    private static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    internal static byte[] Base64Url(string text)
    {
        var s = text.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }
}
