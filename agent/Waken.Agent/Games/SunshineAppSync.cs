using System.Text.Json;

namespace Waken.Agent.Games;

/// <summary>
/// Keeps one Sunshine application per installed game, so any of them can be streamed.
/// Entries Waken adds carry a "waken-id" field (Sunshine keeps unknown fields): only those are ever changed or removed,
/// never an application the user added by hand.
/// </summary>
internal sealed class SunshineAppSync(Func<SunshineAdminClient> connect, ILogger<SunshineAppSync> log)
{
    public const string MarkerField = "waken-id";
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _lastSynced;

    public async Task SyncAsync(IReadOnlyList<GameEntry> games, CancellationToken ct)
    {
        var wanted = Wanted(games);
        var fingerprint = string.Join("\n", wanted.Select(g => $"{g.Id}\t{g.Title}\t{g.Detached}"));
        await _gate.WaitAsync(ct);
        try
        {
            if (fingerprint == _lastSynced) return;
            using var admin = connect();
            var current = await admin.GetAppsAsync(ct);

            // Highest index first: deleting does not re-sort, so the lower indexes stay valid.
            var stale = current
                .Select((app, index) => (app, index))
                .Where(e => Marker(e.app) is { } id && !wanted.Any(g => g.Id == id && g.Title == Text(e.app, "name") && Detached(e.app) == g.Detached))
                .Select(e => e.index)
                .OrderDescending()
                .ToList();
            foreach (var index in stale) await admin.DeleteAppAsync(index, ct);

            var kept = current.Where((_, index) => !stale.Contains(index)).ToList();
            var taken = kept.Select(a => Text(a, "name")).Where(n => n is not null).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var managed = kept.Select(Marker).Where(id => id is not null).ToHashSet();
            var added = 0;
            foreach (var game in wanted.Where(g => !managed.Contains(g.Id)))
            {
                // The user already has an entry with this name: theirs wins, the app launches it by name.
                if (!taken.Add(game.Title)) continue;
                await admin.AddAppAsync(Entry(game), ct);
                added++;
            }

            _lastSynced = fingerprint;
            if (stale.Count > 0 || added > 0) log.LogInformation("Sunshine apps synced: {Added} added, {Removed} removed", added, stale.Count);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>One entry per title: the same game bought on two stores appears once.</summary>
    private static List<GameEntry> Wanted(IReadOnlyList<GameEntry> games) =>
        games.Where(g => g.Detached.Length > 0)
            .GroupBy(g => g.Title, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderBy(g => g.Id, StringComparer.Ordinal)
            .ToList();

    private static Dictionary<string, object?> Entry(GameEntry game) => new()
    {
        ["name"] = game.Title,
        // The launcher returns at once: Sunshine keeps the session until the stream ends.
        ["detached"] = new[] { game.Detached },
        ["auto-detach"] = true,
        ["wait-all"] = true,
        ["exit-timeout"] = 5,
        [MarkerField] = game.Id,
    };

    private static string? Marker(JsonElement app) => Text(app, MarkerField);

    private static string? Text(JsonElement app, string name) =>
        app.ValueKind == JsonValueKind.Object && app.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string? Detached(JsonElement app) =>
        app.TryGetProperty("detached", out var d) && d.ValueKind == JsonValueKind.Array && d.GetArrayLength() == 1 ? d[0].GetString() : null;
}
