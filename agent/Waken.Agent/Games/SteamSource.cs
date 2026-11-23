namespace Waken.Agent.Games;

/// <summary>Installed Steam games, from each library's appmanifest_*.acf files.</summary>
public sealed class SteamSource(IEnumerable<string> steamRoots, Func<int, string> launchCommand) : IGameSource
{
    private const int InstalledFlag = 4;

    /// <summary>Steam's own runtimes and tools, installed like games.</summary>
    private static readonly string[] NotGames = ["Steamworks", "Steam Linux Runtime", "Proton", "SteamVR", "Steam Audio"];

    public IEnumerable<GameEntry> Scan()
    {
        var seen = new HashSet<int>();
        foreach (var library in Libraries())
        {
            var steamapps = Path.Combine(library, "steamapps");
            if (!Directory.Exists(steamapps)) continue;

            foreach (var manifest in Directory.EnumerateFiles(steamapps, "appmanifest_*.acf"))
            {
                GameEntry? entry = null;
                try
                {
                    var state = KeyValues.Parse(File.ReadAllText(manifest)).Block("AppState");
                    if (state is null || !int.TryParse(state.Text("appid"), out var appId) || state.Text("name") is not { Length: > 0 } name) continue;
                    if (!int.TryParse(state.Text("StateFlags"), out var flags) || (flags & InstalledFlag) == 0) continue;
                    if (NotGames.Any(prefix => name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))) continue;
                    if (seen.Add(appId)) entry = new GameEntry($"steam:{appId}", name, "Steam", appId, launchCommand(appId));
                }
                catch (Exception e) when (e is IOException or FormatException or UnauthorizedAccessException)
                {
                    // A manifest being rewritten by Steam: skip it, the next scan will see it.
                }
                if (entry is not null) yield return entry;
            }
        }
    }

    private IEnumerable<string> Libraries()
    {
        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in steamRoots.Where(Directory.Exists))
        {
            if (found.Add(Path.GetFullPath(root))) yield return root;
            foreach (var candidate in new[] { Path.Combine(root, "steamapps", "libraryfolders.vdf"), Path.Combine(root, "config", "libraryfolders.vdf") })
            {
                if (!File.Exists(candidate)) continue;
                Dictionary<string, object>? folders;
                try
                {
                    folders = KeyValues.Parse(File.ReadAllText(candidate)).Block("libraryfolders");
                }
                catch (FormatException)
                {
                    continue;
                }
                if (folders is null) continue;
                foreach (var value in folders.Values)
                {
                    // Current format: "0" { "path" "D:\\SteamLibrary" }. Old format: "1" "D:\\SteamLibrary".
                    var path = value is Dictionary<string, object> block ? block.Text("path") : value as string;
                    if (path is { Length: > 0 } && Directory.Exists(path) && found.Add(Path.GetFullPath(path))) yield return path;
                }
            }
        }
    }
}
