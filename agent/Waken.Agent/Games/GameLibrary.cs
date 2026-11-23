namespace Waken.Agent.Games;

/// <summary>Every installed game on this machine, merged from all stores and kept for a short while.</summary>
public sealed class GameLibrary(IEnumerable<IGameSource> sources)
{
    private static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(5);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IReadOnlyList<GameEntry> _games = [];
    private DateTime _scannedAt = DateTime.MinValue;

    public async Task<IReadOnlyList<GameEntry>> GetAsync(bool refresh, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (refresh || DateTime.UtcNow - _scannedAt > MaxAge)
            {
                _games = await Task.Run(Scan, ct);
                _scannedAt = DateTime.UtcNow;
            }
            return _games;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<GameEntry?> FindAsync(string id, CancellationToken ct) =>
        (await GetAsync(refresh: false, ct)).FirstOrDefault(g => g.Id == id);

    private IReadOnlyList<GameEntry> Scan()
    {
        var games = new List<GameEntry>();
        foreach (var source in sources)
        {
            try
            {
                games.AddRange(source.Scan());
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                // One broken launcher must not hide the games of the others.
            }
        }
        return games
            .GroupBy(g => g.Id)
            .Select(g => g.First())
            .OrderBy(g => g.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    /// <summary>The sources that make sense on this operating system.</summary>
    public static IEnumerable<IGameSource> DefaultSources()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (OperatingSystem.IsWindows())
        {
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            yield return new SteamSource([Path.Combine(programFilesX86, "Steam")], id => $"steam://rungameid/{id}");
            yield return new EpicSource(Path.Combine(programData, "Epic", "EpicGamesLauncher", "Data", "Manifests"), url => url);
            yield return new GogSource();
        }
        else if (OperatingSystem.IsMacOS())
        {
            yield return new SteamSource([Path.Combine(home, "Library", "Application Support", "Steam")], id => $"open steam://rungameid/{id}");
            yield return new EpicSource(Path.Combine(home, "Library", "Application Support", "Epic", "EpicGamesLauncher", "Data", "Manifests"), url => $"open \"{url}\"");
            yield return new MacAppSource(MacAppSource.RunProcess);
        }
    }
}
