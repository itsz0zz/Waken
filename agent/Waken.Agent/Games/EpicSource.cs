using System.Text.Json;

namespace Waken.Agent.Games;

/// <summary>Installed Epic Games Store games, from the launcher's *.item manifests.</summary>
public sealed class EpicSource(string manifestsFolder, Func<string, string> launchCommand) : IGameSource
{
    public IEnumerable<GameEntry> Scan()
    {
        if (!Directory.Exists(manifestsFolder)) yield break;
        foreach (var file in Directory.EnumerateFiles(manifestsFolder, "*.item"))
        {
            GameEntry? entry = null;
            try
            {
                using var json = JsonDocument.Parse(File.ReadAllText(file));
                var root = json.RootElement;
                string? Text(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                bool Flag(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

                var categories = root.TryGetProperty("AppCategories", out var c) && c.ValueKind == JsonValueKind.Array
                    ? c.EnumerateArray().Select(x => x.GetString()).ToArray()
                    : [];
                if (Flag("bIsIncompleteInstall") || (categories.Length > 0 && !categories.Contains("games"))) continue;
                if (Text("DisplayName") is not { Length: > 0 } title || Text("AppName") is not { Length: > 0 } app) continue;
                if (Text("CatalogNamespace") is not { Length: > 0 } ns || Text("CatalogItemId") is not { Length: > 0 } item) continue;

                var launch = launchCommand($"com.epicgames.launcher://apps/{Uri.EscapeDataString($"{ns}:{item}:{app}")}?action=launch&silent=true");
                entry = new GameEntry($"epic:{app}", title, "Epic", null, launch);
            }
            catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
            {
                // Corrupt or locked manifest: ignore it.
            }
            if (entry is not null) yield return entry;
        }
    }
}
