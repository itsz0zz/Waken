using Microsoft.Win32;

namespace Waken.Agent.Games;

/// <summary>Installed GOG games, from the registry keys GOG Galaxy and the GOG installers write.</summary>
public sealed class GogSource : IGameSource
{
    private const string GamesKey = @"SOFTWARE\WOW6432Node\GOG.com\Games";

    public IEnumerable<GameEntry> Scan()
    {
        if (!OperatingSystem.IsWindows()) yield break;
        using var games = Registry.LocalMachine.OpenSubKey(GamesKey);
        if (games is null) yield break;
        foreach (var id in games.GetSubKeyNames())
        {
            using var game = games.OpenSubKey(id);
            if (game?.GetValue("gameName") is not string title || game.GetValue("exe") is not string exe || !File.Exists(exe)) continue;
            yield return new GameEntry($"gog:{id}", title, "GOG", null, $"\"{exe}\"");
        }
    }
}
