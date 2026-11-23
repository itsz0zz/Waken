using System.Text.Json;

namespace Waken.Agent.Games;

/// <summary>What one game has been played on this machine.</summary>
public sealed record PlayRecord(DateTimeOffset? LastPlayed, long Seconds, int Sessions);

/// <summary>Totals shown on the home and game screens.</summary>
public sealed record PlaySummary(int StreakDays, long MonthSeconds, int Sessions, SessionEnd? LastSession = null);

/// <summary>The last streamed session that ended: the desktop app sends its recap to the account's devices.</summary>
public sealed record SessionEnd(string GameId, string Title, long Seconds, DateTimeOffset EndedAt);

/// <summary>
/// Play history of this machine, kept by its agent: every device reads the same figures, no server needed.
/// A session starts when the agent starts a game and ends when Sunshine no longer runs it.
/// </summary>
public sealed class GameStats
{
    private sealed class Data
    {
        public Dictionary<string, PlayRecord> Games { get; set; } = new();
        /// <summary>Days with at least one game started, local dates, "yyyy-MM-dd".</summary>
        public SortedSet<string> Days { get; set; } = new(StringComparer.Ordinal);
        /// <summary>Seconds played per month, "yyyy-MM".</summary>
        public Dictionary<string, long> Months { get; set; } = new();
        public SessionEnd? LastSession { get; set; }
    }

    private readonly string _file;
    private readonly Func<DateTimeOffset> _now;
    private readonly object _lock = new();
    private readonly Data _data;
    private (string GameId, string Title, DateTimeOffset Started)? _open;

    public GameStats(string dataDir, Func<DateTimeOffset>? now = null)
    {
        _file = Path.Combine(dataDir, "stats.json");
        _now = now ?? (() => DateTimeOffset.Now);
        _data = Load(_file);
    }

    /// <summary>The game being streamed, with the Sunshine title to watch for, if any.</summary>
    public (string GameId, string Title)? Open
    {
        get
        {
            lock (_lock) return _open is { } o ? (o.GameId, o.Title) : null;
        }
    }

    /// <summary>A game starts: one more session, today counts for the streak. A running one is closed first.</summary>
    public void Begin(string gameId, string title, bool tracked = true)
    {
        lock (_lock)
        {
            CloseLocked();
            var now = _now();
            var record = _data.Games.GetValueOrDefault(gameId) ?? new PlayRecord(null, 0, 0);
            _data.Games[gameId] = record with { LastPlayed = now, Sessions = record.Sessions + 1 };
            _data.Days.Add(now.ToString("yyyy-MM-dd"));
            // A game started on this machine directly is not streamed: Sunshine cannot tell when it ends.
            if (tracked) _open = (gameId, title, now);
            Save();
        }
    }

    /// <summary>The streamed game stopped: its time is added.</summary>
    public void End()
    {
        lock (_lock)
        {
            CloseLocked();
            Save();
        }
    }

    private void CloseLocked()
    {
        if (_open is not { } open) return;
        _open = null;
        var now = _now();
        var seconds = (long)Math.Max(0, (now - open.Started).TotalSeconds);
        var record = _data.Games.GetValueOrDefault(open.GameId) ?? new PlayRecord(open.Started, 0, 1);
        _data.Games[open.GameId] = record with { Seconds = record.Seconds + seconds };
        var month = open.Started.ToString("yyyy-MM");
        _data.Months[month] = _data.Months.GetValueOrDefault(month) + seconds;
        _data.LastSession = new SessionEnd(open.GameId, open.Title, seconds, now);
    }

    public PlayRecord? Of(string gameId)
    {
        lock (_lock)
        {
            if (!_data.Games.TryGetValue(gameId, out var record)) return null;
            // A session still running counts already: the screens show it growing.
            return _open is { } o && o.GameId == gameId ? record with { Seconds = record.Seconds + (long)(_now() - o.Started).TotalSeconds } : record;
        }
    }

    public PlaySummary Summary()
    {
        lock (_lock)
        {
            var now = _now();
            var month = _data.Months.GetValueOrDefault(now.ToString("yyyy-MM"));
            if (_open is { } o) month += (long)(now - o.Started).TotalSeconds;
            // Days in a row up to today, or up to yesterday when nothing was played yet today.
            var day = DateOnly.FromDateTime(now.Date);
            if (!_data.Days.Contains(day.ToString("yyyy-MM-dd"))) day = day.AddDays(-1);
            var streak = 0;
            while (_data.Days.Contains(day.ToString("yyyy-MM-dd")))
            {
                streak++;
                day = day.AddDays(-1);
            }
            return new PlaySummary(streak, month, _data.Games.Values.Sum(g => g.Sessions), _data.LastSession);
        }
    }

    private static Data Load(string file)
    {
        try
        {
            return File.Exists(file) ? JsonSerializer.Deserialize<Data>(File.ReadAllText(file)) ?? new Data() : new Data();
        }
        catch (Exception e) when (e is JsonException or IOException)
        {
            // A broken history must not stop the agent: it starts again from zero.
            return new Data();
        }
    }

    /// <summary>Written beside, then moved: a crash never leaves half a file.</summary>
    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_file)!);
        var temp = _file + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(_data));
        File.Move(temp, _file, overwrite: true);
    }
}

/// <summary>Ends the streamed session when Sunshine no longer runs its game (checked every 30 seconds while one is open).</summary>
public sealed class StatsTracker(GameStats stats, GameStreamClient sunshine, ILogger<StatsTracker> log) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(ct))
        {
            if (stats.Open is not { } open) continue;
            try
            {
                var running = await sunshine.CurrentAppAsync(ct);
                if (!string.Equals(running, open.Title, StringComparison.OrdinalIgnoreCase)) stats.End();
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Sunshine restarting: ask again at the next tick rather than closing the session too early.
                log.LogDebug(e, "Sunshine current game unknown");
            }
        }
    }
}
