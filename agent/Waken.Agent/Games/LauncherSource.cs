namespace Waken.Agent.Games;

/// <summary>
/// The launchers themselves, so they can be opened from Waken like a game: Steam (Big Picture, made for a TV or a
/// controller), Epic, GOG Galaxy, EA app, Ubisoft Connect, Battle.net, CrossOver. Only those installed here.
/// </summary>
public sealed class LauncherSource(IEnumerable<(string Path, string Title, string Command)> candidates, Func<string, bool> exists) : IGameSource
{
    public IEnumerable<GameEntry> Scan()
    {
        foreach (var (path, title, command) in candidates)
        {
            if (!exists(path)) continue;
            yield return new GameEntry($"launcher:{EaSource.Slug(title.ToLowerInvariant().Replace(' ', '-'))}", title, "Launcher", null, command);
        }
    }

    public static IEnumerable<(string, string, string)> Windows(string programFiles, string programFilesX86)
    {
        string X86(params string[] parts) => Path.Combine([programFilesX86, .. parts]);
        string Pf(params string[] parts) => Path.Combine([programFiles, .. parts]);
        yield return (X86("Steam", "steam.exe"), "Steam Big Picture", "steam://open/bigpicture");
        var epic = X86("Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe");
        yield return (epic, "Epic Games", $"\"{epic}\"");
        var gog = X86("GOG Galaxy", "GalaxyClient.exe");
        yield return (gog, "GOG Galaxy", $"\"{gog}\"");
        var ea = Pf("Electronic Arts", "EA Desktop", "EA Desktop", "EADesktop.exe");
        yield return (ea, "EA app", $"\"{ea}\"");
        var ubisoft = X86("Ubisoft", "Ubisoft Game Launcher", "UbisoftConnect.exe");
        yield return (ubisoft, "Ubisoft Connect", $"\"{ubisoft}\"");
        var bnet = X86("Battle.net", "Battle.net.exe");
        yield return (bnet, "Battle.net", $"\"{bnet}\"");
    }

    public static IEnumerable<(string, string, string)> Mac(string home)
    {
        foreach (var apps in new[] { "/Applications", Path.Combine(home, "Applications") })
        {
            var steam = Path.Combine(apps, "Steam.app");
            yield return (steam, "Steam Big Picture", "open steam://open/bigpicture");
            foreach (var (bundle, title) in new[] { ("Epic Games Launcher.app", "Epic Games"), ("Battle.net.app", "Battle.net"), ("CrossOver.app", "CrossOver"), ("GOG Galaxy.app", "GOG Galaxy") })
            {
                var path = Path.Combine(apps, bundle);
                yield return (path, title, $"open -a {CrossOverSource.Quote(path)}");
            }
        }
    }
}
