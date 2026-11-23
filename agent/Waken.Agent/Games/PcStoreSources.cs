namespace Waken.Agent.Games;

/// <summary>EA app games: installed programs published by Electronic Arts, started by their own executable.</summary>
public sealed class EaSource(IInstalledPrograms programs, Func<string, bool> fileExists) : IGameSource
{
    /// <summary>EA's own tools, installed like games.</summary>
    private static readonly string[] NotGames = ["EA app", "EA Desktop", "Origin", "EA Anti-Cheat", "EA Javelin"];

    public IEnumerable<GameEntry> Scan()
    {
        foreach (var p in programs.List())
        {
            if (p.Publisher?.Contains("Electronic Arts", StringComparison.OrdinalIgnoreCase) != true) continue;
            if (NotGames.Any(n => p.DisplayName.StartsWith(n, StringComparison.OrdinalIgnoreCase))) continue;
            if (p.IconExecutable() is not { } exe || !fileExists(exe)) continue;
            yield return new GameEntry($"ea:{Slug(p.Key)}", p.DisplayName, "EA", null, $"\"{exe}\"");
        }
    }

    internal static string Slug(string key) => new(key.Where(c => char.IsLetterOrDigit(c) || c is '-' or '.').ToArray());
}

/// <summary>Ubisoft Connect games: its registry lists each install by id, launched through uplay://.</summary>
public sealed class UbisoftSource(IInstalledPrograms programs, Func<string, bool> directoryExists) : IGameSource
{
    private const string Installs = @"SOFTWARE\Ubisoft\Launcher\Installs";

    public IEnumerable<GameEntry> Scan()
    {
        // Each game also has an uninstall entry named "Uplay Install <id>" that carries its real title.
        var titles = programs.List()
            .Where(p => p.Key.StartsWith("Uplay Install ", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(p => p.Key["Uplay Install ".Length..].Trim(), p => p.DisplayName, StringComparer.OrdinalIgnoreCase);
        foreach (var (id, dir) in programs.Values(Installs, "InstallDir"))
        {
            if (!int.TryParse(id, out _) || !directoryExists(dir)) continue;
            // Windows paths: split on both separators, whatever system runs the tests.
            var title = titles.TryGetValue(id, out var t) ? t : dir.TrimEnd('/', '\\').Split('/', '\\')[^1];
            if (string.IsNullOrWhiteSpace(title)) continue;
            yield return new GameEntry($"ubisoft:{id}", title, "Ubisoft", null, $"uplay://launch/{id}/0");
        }
    }
}

/// <summary>
/// Battle.net games: installed programs published by Blizzard. Battle.net starts a known game by its product code;
/// a game without a known code starts from its executable (Battle.net takes over from there).
/// </summary>
public sealed class BattleNetSource(IInstalledPrograms programs, string battleNetExe, Func<string, bool> fileExists) : IGameSource
{
    /// <summary>Battle.net product codes ("--exec=launch CODE"), by a word of the game's name.</summary>
    private static readonly (string Name, string Code)[] Codes =
    [
        ("Overwatch", "Pro"),
        ("World of Warcraft", "WoW"),
        ("Diablo IV", "Fen"),
        ("Diablo III", "D3"),
        ("Diablo II", "OSI"),
        ("Diablo Immortal", "ANBS"),
        ("Hearthstone", "WTCG"),
        ("Heroes of the Storm", "Hero"),
        ("StarCraft II", "S2"),
        ("StarCraft", "S1"),
        ("Warcraft III", "W3"),
        ("Call of Duty", "Fore"),
    ];

    public IEnumerable<GameEntry> Scan()
    {
        var launcher = fileExists(battleNetExe);
        foreach (var p in programs.List())
        {
            if (p.Publisher?.Contains("Blizzard", StringComparison.OrdinalIgnoreCase) != true) continue;
            if (p.DisplayName.StartsWith("Battle.net", StringComparison.OrdinalIgnoreCase)) continue;
            var code = Codes.FirstOrDefault(c => p.DisplayName.Contains(c.Name, StringComparison.OrdinalIgnoreCase)).Code;
            string? command = launcher && code is not null ? $"\"{battleNetExe}\" --exec=\"launch {code}\"" : null;
            if (command is null && p.IconExecutable() is { } exe && fileExists(exe)) command = $"\"{exe}\"";
            if (command is null) continue;
            yield return new GameEntry($"battlenet:{EaSource.Slug(p.Key)}", p.DisplayName, "Battle.net", null, command);
        }
    }
}
