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
}
