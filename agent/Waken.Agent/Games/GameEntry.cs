namespace Waken.Agent.Games;

/// <summary>A game installed on this machine, whatever store it comes from.</summary>
/// <param name="Id">Stable id: "steam:620", "epic:Fortnite", "gog:1207658924", "mac:com.hypixel.hytale.client".</param>
/// <param name="SteamAppId">Known Steam id, the best key to the official artwork.</param>
/// <param name="Detached">Command that starts the game and returns (Sunshine "detached").</param>
/// <param name="IconPath">Local icon used when no artwork is found (macOS .icns).</param>
public sealed record GameEntry(string Id, string Title, string Store, int? SteamAppId, string Detached, string? IconPath = null);

/// <summary>One source of installed games. Returns nothing when its launcher is not installed.</summary>
public interface IGameSource
{
    IEnumerable<GameEntry> Scan();
}
