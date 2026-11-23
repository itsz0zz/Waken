using Waken.Agent.Games;

namespace Waken.Agent.Tests;

public sealed class GameStatsTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("waken-stats-").FullName;
    private DateTimeOffset _now = new(2026, 11, 23, 20, 0, 0, TimeSpan.FromHours(1));

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private GameStats Stats() => new(_dir, () => _now);

    [Fact]
    public void Adds_the_time_of_a_streamed_session_when_it_ends()
    {
        var stats = Stats();
        stats.Begin("steam:620", "Portal 2");
        _now = _now.AddMinutes(90);
        stats.End();

        var portal = stats.Of("steam:620")!;
        Assert.Equal(90 * 60, portal.Seconds);
        Assert.Equal(1, portal.Sessions);
        Assert.Equal(new DateTimeOffset(2026, 11, 23, 20, 0, 0, TimeSpan.FromHours(1)), portal.LastPlayed);
    }

    [Fact]
    public void Counts_a_running_session_already()
    {
        var stats = Stats();
        stats.Begin("steam:620", "Portal 2");
        _now = _now.AddMinutes(10);

        Assert.Equal(600, stats.Of("steam:620")!.Seconds);
        Assert.Equal(600, stats.Summary().MonthSeconds);
    }

    [Fact]
    public void A_new_game_closes_the_running_one()
    {
        var stats = Stats();
        stats.Begin("a", "A");
        _now = _now.AddMinutes(5);
        stats.Begin("b", "B");

        Assert.Equal(300, stats.Of("a")!.Seconds);
        Assert.Equal("b", stats.Open!.Value.GameId);
    }

    [Fact]
    public void A_game_started_on_the_machine_counts_a_session_but_no_time()
    {
        var stats = Stats();
        stats.Begin("mac:hytale", "Hytale", tracked: false);

        Assert.Null(stats.Open);
        Assert.Equal(1, stats.Of("mac:hytale")!.Sessions);
        Assert.Equal(0, stats.Of("mac:hytale")!.Seconds);
    }

    [Fact]
    public void Counts_days_in_a_row_up_to_yesterday_when_today_is_not_played_yet()
    {
        var stats = Stats();
        foreach (var daysAgo in new[] { 4, 2, 1 })
        {
            _now = new DateTimeOffset(2026, 11, 23, 20, 0, 0, TimeSpan.FromHours(1)).AddDays(-daysAgo);
            stats.Begin("a", "A", tracked: false);
        }
        _now = new DateTimeOffset(2026, 11, 23, 9, 0, 0, TimeSpan.FromHours(1));

        Assert.Equal(2, stats.Summary().StreakDays);
        stats.Begin("a", "A", tracked: false);
        Assert.Equal(3, stats.Summary().StreakDays);
    }

    [Fact]
    public void Keeps_the_history_across_restarts_and_survives_a_broken_file()
    {
        var first = Stats();
        first.Begin("a", "A");
        _now = _now.AddMinutes(30);
        first.End();

        Assert.Equal(1800, Stats().Of("a")!.Seconds);

        File.WriteAllText(Path.Combine(_dir, "stats.json"), "{ broken");
        Assert.Null(Stats().Of("a"));
    }

    [Fact]
    public void Time_goes_to_the_month_the_session_started_in()
    {
        _now = new DateTimeOffset(2026, 10, 31, 23, 30, 0, TimeSpan.FromHours(1));
        var stats = Stats();
        stats.Begin("a", "A");
        _now = _now.AddHours(1);
        stats.End();

        Assert.Equal(0, stats.Summary().MonthSeconds);
    }
}
