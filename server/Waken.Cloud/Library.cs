using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace Waken.Cloud;

/// <summary>
/// The games of one computer of the account, as its own app last sent them: every other device reads them here,
/// even with the computer off, and only reaches the computer to wake it and to play.
/// </summary>
public sealed class MachineLibrary
{
    public long Id { get; set; }
    public string UserId { get; set; } = "";
    /// <summary>The computer's name on the Waken network, lower case: the one the other devices know it by.</summary>
    public string Machine { get; set; } = "";
    /// <summary>The computer's JSON as received (games, stats), checked for shape and size only.</summary>
    public string Payload { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
}

public static partial class LibraryEndpoints
{
    /// <summary>A few thousand games with their picture addresses fit; a runaway client does not.</summary>
    public const int MaxBytes = 1_000_000;
    public const int MaxGames = 5000;

    // A network host name: what Tailscale (and so Headscale) accepts.
    [GeneratedRegex("^[a-z0-9][a-z0-9-]{0,62}$")]
    private static partial Regex MachineName();

    public static void MapLibrary(this WebApplication app, CloudOptions cloud)
    {
        var library = app.MapGroup("/library").RequireAuthorization().RequireRateLimiting("account");

        library.MapGet("", async (ClaimsPrincipal me, CloudDb db, CancellationToken ct) =>
        {
            var userId = me.FindFirstValue(ClaimTypes.NameIdentifier);
            var rows = await db.Libraries.Where(l => l.UserId == userId).ToListAsync(ct);
            return Results.Ok(rows.OrderBy(r => r.Machine, StringComparer.Ordinal).Select(r =>
            {
                var payload = JsonNode.Parse(r.Payload)!.AsObject();
                return new JsonObject
                {
                    ["machine"] = r.Machine,
                    ["updatedAt"] = r.UpdatedAt.ToString("O"),
                    ["games"] = payload["games"]?.DeepClone(),
                    ["stats"] = payload["stats"]?.DeepClone(),
                    // How to wake it (Wake-on-LAN: its card's address, the home network's broadcast and public
                    // address): what the other devices need to start it while it sleeps.
                    ["wake"] = payload["wake"]?.DeepClone(),
                };
            }));
        });

        // Sent by the computer's own app (signed in to the account), each time its library changes.
        library.MapPut("/{machine}", async (string machine, HttpRequest request, ClaimsPrincipal me, CloudDb db, TimeProvider clock, CancellationToken ct) =>
        {
            var userId = me.FindFirstValue(ClaimTypes.NameIdentifier);
            if (userId is null) return Results.Unauthorized();
            var name = machine.ToLowerInvariant();
            if (!MachineName().IsMatch(name)) return Results.Problem("Nom de machine invalide", statusCode: StatusCodes.Status400BadRequest);
            if (request.ContentLength is > MaxBytes) return TooLarge();

            using var body = new MemoryStream();
            await request.Body.CopyToAsync(body, ct);
            if (body.Length > MaxBytes) return TooLarge();
            if (Validate(body.ToArray()) is { } problem) return Results.Problem(problem, statusCode: StatusCodes.Status400BadRequest);

            var row = await db.Libraries.FirstOrDefaultAsync(l => l.UserId == userId && l.Machine == name, ct);
            if (row is null)
            {
                if (await db.Libraries.CountAsync(l => l.UserId == userId, ct) >= cloud.MaxDevices)
                    return Results.Problem($"Ton compte a déjà {cloud.MaxDevices} machines", statusCode: StatusCodes.Status409Conflict);
                row = new MachineLibrary { UserId = userId, Machine = name };
                db.Libraries.Add(row);
            }
            row.Payload = System.Text.Encoding.UTF8.GetString(body.ToArray());
            row.UpdatedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // A computer taken off the account: its games go with it.
        library.MapDelete("/{machine}", async (string machine, ClaimsPrincipal me, CloudDb db, CancellationToken ct) =>
        {
            var userId = me.FindFirstValue(ClaimTypes.NameIdentifier);
            var name = machine.ToLowerInvariant();
            await db.Libraries.Where(l => l.UserId == userId && l.Machine == name).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        });
    }

    private static IResult TooLarge() => Results.Problem("Bibliothèque trop grande", statusCode: StatusCodes.Status413PayloadTooLarge);

    /// <summary>
    /// An object with a "games" array of objects (each with a string id and title) and an optional "stats" object.
    /// The rest is the apps' business: kept as sent.
    /// </summary>
    internal static string? Validate(byte[] json)
    {
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(json);
        }
        catch (JsonException)
        {
            return "JSON invalide";
        }
        if (root is not JsonObject obj || obj["games"] is not JsonArray games) return "Il manque la liste des jeux";
        if (games.Count > MaxGames) return "Trop de jeux";
        foreach (var game in games)
        {
            if (game is not JsonObject g || g["id"]?.GetValueKind() != JsonValueKind.String || g["title"]?.GetValueKind() != JsonValueKind.String)
                return "Chaque jeu a un id et un titre";
        }
        if (obj["stats"] is { } stats && stats is not JsonObject) return "Statistiques invalides";
        return null;
    }
}
