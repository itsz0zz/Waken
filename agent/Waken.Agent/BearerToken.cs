using System.Security.Cryptography;
using System.Text;

namespace Waken.Agent;

/// <summary>The shared secret of this service. It cannot be built from an empty, short or sample value.</summary>
internal sealed class BearerToken
{
    private const int MinimumLength = 24;
    private const string Scheme = "Bearer ";
    private static readonly string[] SampleMarkers = ["change-me", "changeme", "change_me", "remplace"];

    private readonly byte[] _expected;

    public BearerToken(string? value)
    {
        var token = value?.Trim() ?? "";
        if (token.Length < MinimumLength || SampleMarkers.Any(marker => token.Contains(marker, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException(
                $"Agent:Token doit contenir un secret aléatoire d'au moins {MinimumLength} caractères (exemple : openssl rand -hex 32).");
        }

        _expected = Encoding.UTF8.GetBytes(token);
    }

    public bool Matches(string authorizationHeader) =>
        authorizationHeader.StartsWith(Scheme, StringComparison.Ordinal)
        && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(authorizationHeader[Scheme.Length..]), _expected);

    /// <summary>
    /// The signature that opens one picture of one game, and nothing else: an image request cannot always carry the
    /// token (React Native Windows drops the headers of an image). Derived from the token, which it never reveals.
    /// </summary>
    public string SignArt(string gameId, string kind) =>
        Convert.ToHexStringLower(HMACSHA256.HashData(_expected, Encoding.UTF8.GetBytes($"art\n{gameId}\n{kind.ToLowerInvariant()}")));

    public bool MatchesArt(string gameId, string kind, string? signature) =>
        signature is { Length: 64 }
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(signature.ToLowerInvariant()), Encoding.ASCII.GetBytes(SignArt(gameId, kind)));
}
