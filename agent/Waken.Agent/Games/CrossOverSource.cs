namespace Waken.Agent.Games;

/// <summary>
/// Windows games installed in CrossOver bottles on a Mac. A bottle is a fake C: drive: its Steam and Epic are read
/// with the same code as on Windows, and the games start through CrossOver's wine, in that bottle.
/// </summary>
public sealed class CrossOverSource(string bottlesFolder, string wine) : IGameSource
{
    public const string DefaultWine = "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine";

    public IEnumerable<GameEntry> Scan()
    {
        if (!Directory.Exists(bottlesFolder)) yield break;
        foreach (var bottleDir in Directory.EnumerateDirectories(bottlesFolder))
        {
            var bottle = Path.GetFileName(bottleDir);
            var driveC = Path.Combine(bottleDir, "drive_c");
            if (!Directory.Exists(driveC)) continue;
            var run = $"{Quote(wine)} --bottle {Quote(bottle)}";

            var steamDir = Path.Combine(driveC, "Program Files (x86)", "Steam");
            var steamExe = @"C:\Program Files (x86)\Steam\steam.exe";
            foreach (var g in new SteamSource([steamDir], id => $"{run} {Quote(steamExe)} -applaunch {id}").Scan())
            {
                yield return g with { Id = $"crossover:{bottle}:{g.Id}", Store = "CrossOver" };
            }

            var epicManifests = Path.Combine(driveC, "ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
            foreach (var g in new EpicSource(epicManifests, url => $"{run} start {Quote(url)}").Scan())
            {
                yield return g with { Id = $"crossover:{bottle}:{g.Id}", Store = "CrossOver" };
            }

            if (File.Exists(Path.Combine(steamDir, "steam.exe")))
            {
                yield return new GameEntry($"crossover:{bottle}:launcher:steam", $"Steam ({bottle})", "Launcher", null, $"{run} {Quote(steamExe)} -bigpicture");
            }
        }
    }

    /// <summary>Double quotes for a shell line: paths and bottle names may hold spaces.</summary>
    internal static string Quote(string value) => $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("$", "\\$").Replace("`", "\\`")}\"";
}
