using System.Diagnostics;

namespace Waken.Agent.Games;

/// <summary>macOS games found by Spotlight: any app whose category is a game, wherever it is installed.</summary>
public sealed class MacAppSource(Func<string, string[], string> run) : IGameSource
{
    private const string Query = "kMDItemAppStoreCategoryType == \"public.app-category.*games\"";

    /// <summary>Apps in the games category that are not games to stream.</summary>
    private static readonly string[] Excluded = ["com.moonlight-stream.Moonlight", "com.apple.games", "com.valvesoftware.steam", "fr.wakenplay."];

    public static string RunProcess(string file, string[] args)
    {
        using var process = Process.Start(new ProcessStartInfo(file, args) { RedirectStandardOutput = true, UseShellExecute = false })
            ?? throw new InvalidOperationException($"{file} n'a pas démarré.");
        var output = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        return output;
    }

    public IEnumerable<GameEntry> Scan()
    {
        if (!OperatingSystem.IsMacOS()) yield break;
        foreach (var app in run("/usr/bin/mdfind", [Query]).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!app.EndsWith(".app", StringComparison.OrdinalIgnoreCase) || app.StartsWith("/System/", StringComparison.Ordinal)) continue;
            var bundleId = run("/usr/bin/mdls", ["-raw", "-name", "kMDItemCFBundleIdentifier", app]).Trim();
            if (bundleId is "" or "(null)" || Excluded.Any(e => bundleId.StartsWith(e, StringComparison.OrdinalIgnoreCase))) continue;
            var title = run("/usr/bin/mdls", ["-raw", "-name", "kMDItemDisplayName", app]).Trim();
            if (title is "" or "(null)") title = Path.GetFileNameWithoutExtension(app);
            if (title.EndsWith(".app", StringComparison.OrdinalIgnoreCase)) title = title[..^4];

            var icon = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconFile", Path.Combine(app, "Contents", "Info.plist")]).Trim();
            var iconPath = icon.Length == 0 ? null : Path.Combine(app, "Contents", "Resources", icon.EndsWith(".icns", StringComparison.Ordinal) ? icon : icon + ".icns");

            yield return new GameEntry($"mac:{bundleId}", title, "Mac", null, $"open -a \"{app}\"", File.Exists(iconPath) ? iconPath : null);
        }
    }
}
