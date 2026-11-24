using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Waken.Agent.Games;

/// <summary>The pictures shown for a game: vertical cover, wide banner, transparent logo, square icon.</summary>
public enum ArtworkKind { Cover, Hero, Logo, Icon }

/// <summary>
/// Official game art, saved once on disk.
/// SteamGridDB (one free key for the whole product) covers every store, including games that are not on Steam:
/// a Steam game is looked up by its app id, any other game by its title. Without a key, or when SteamGridDB has
/// nothing, Steam's own library art is used for Steam games and the app icon for local apps.
/// </summary>
public sealed class ArtworkService(HttpClient http, string cacheDir, string? steamGridDbKey, Func<string, string, bool>? convertIcon = null)
{
    private const string SteamGridDb = "https://www.steamgriddb.com/api/v2/";
    private const long MaxImageBytes = 15 * 1024 * 1024;
    /// <summary>A game SteamGridDB did not know may be added later: ask again after this delay.</summary>
    private static readonly TimeSpan RetryMissAfter = TimeSpan.FromDays(7);

    /// <summary>Image hosts we accept to download from, so a search result can never point the agent elsewhere.</summary>
    private static readonly string[] AllowedHosts = ["cdn2.steamgriddb.com", "cdn.steamgriddb.com", "shared.steamstatic.com", "cdn.cloudflare.steamstatic.com", "steamcdn-a.akamaihd.net"];

    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();
    /// <summary>SteamGridDB id found for each title: one search per game, not one per picture.</summary>
    private readonly ConcurrentDictionary<string, int?> _gameIds = new(StringComparer.OrdinalIgnoreCase);
    private readonly Func<string, string, bool> _convertIcon = convertIcon ?? ConvertIcnsWithSips;

    public bool HasSteamGridDbKey => !string.IsNullOrWhiteSpace(steamGridDbKey);

    /// <summary>Path of the cached picture, fetched on first use. Null when no source has one.</summary>
    /// <param name="small">SteamGridDB's light JPEG version (a few hundred KB instead of several MB), for phones.</param>
    public async Task<string?> GetAsync(GameEntry game, ArtworkKind kind, CancellationToken ct, bool small = false)
    {
        var folder = Path.Combine(cacheDir, SafeName(game.Id));
        var name = kind.ToString().ToLowerInvariant() + (small ? "-small" : "");
        var gate = _locks.GetOrAdd($"{game.Id}/{name}", _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var cached = Directory.Exists(folder)
                ? Directory.EnumerateFiles(folder, name + ".*").Where(f => Path.GetFileNameWithoutExtension(f) == name).FirstOrDefault(f => !f.EndsWith(".miss", StringComparison.Ordinal) && !f.EndsWith(".part", StringComparison.Ordinal) && !f.EndsWith(UrlSuffix, StringComparison.Ordinal))
                : null;
            if (cached is not null) return cached;

            // A miss is only remembered after a real lookup: adding the key later must bring the art back.
            var miss = Path.Combine(folder, name + ".miss");
            var lookedUp = HasSteamGridDbKey || game.SteamAppId is not null;
            if (!lookedUp || !File.Exists(miss) || DateTime.UtcNow - File.GetLastWriteTimeUtc(miss) >= RetryMissAfter)
            {
                Directory.CreateDirectory(folder);
                foreach (var url in await CandidatesAsync(game, kind, small, ct))
                {
                    if (await DownloadAsync(url, Path.Combine(folder, name), ct) is { } saved)
                    {
                        File.Delete(miss);
                        await File.WriteAllTextAsync(Path.Combine(folder, name + UrlSuffix), url, ct);
                        return saved;
                    }
                }
                if (lookedUp) await File.WriteAllTextAsync(miss, "", ct);
            }
            return kind is ArtworkKind.Icon or ArtworkKind.Cover ? AppIcon(game, folder) : null;
        }
        finally
        {
            gate.Release();
        }
    }

    private const string UrlSuffix = ".url";

    /// <summary>
    /// The public address of the picture (SteamGridDB's or Steam's CDN), for the account's library on the server:
    /// the other devices load it without reaching this machine. Null when the only picture is the app's own icon.
    /// </summary>
    public async Task<string?> PublicUrlAsync(GameEntry game, ArtworkKind kind, CancellationToken ct, bool small = false)
    {
        var file = await GetAsync(game, kind, ct, small);
        if (file is null || Path.GetFileNameWithoutExtension(file) == "app-icon") return null;
        var sidecar = Path.Combine(Path.GetDirectoryName(file)!, Path.GetFileNameWithoutExtension(file) + UrlSuffix);
        if (File.Exists(sidecar)) return (await File.ReadAllTextAsync(sidecar, ct)).Trim() is { Length: > 0 } known ? known : null;
        // Downloaded before the addresses were kept: the first candidate is the one that was taken.
        var first = (await CandidatesAsync(game, kind, small, ct)).FirstOrDefault();
        if (first is not null) await File.WriteAllTextAsync(sidecar, first, ct);
        return first;
    }

    /// <summary>The app's own icon as PNG, kept apart from the official art so it never hides it.</summary>
    private string? AppIcon(GameEntry game, string folder)
    {
        if (game.IconPath is not { } icns || !File.Exists(icns)) return null;
        var png = Path.Combine(folder, "app-icon.png");
        if (File.Exists(png)) return png;
        Directory.CreateDirectory(folder);
        return _convertIcon(icns, png) && File.Exists(png) ? png : null;
    }

    private async Task<IReadOnlyList<string>> CandidatesAsync(GameEntry game, ArtworkKind kind, bool small, CancellationToken ct)
    {
        var urls = new List<string>();
        if (HasSteamGridDbKey)
        {
            try
            {
                var key = game.SteamAppId is { } steamId ? $"steam/{steamId}" : await FindGameAsync(game.Title, ct) is { } id ? $"game/{id}" : null;
                if (key is not null && await FirstAssetAsync(kind, key, ct) is { } asset)
                {
                    // Logos are small already: their thumbnail is a heavier PNG.
                    if (small && kind != ArtworkKind.Logo && asset.Thumb is not null) urls.Add(asset.Thumb);
                    urls.Add(asset.Url);
                }
            }
            catch (Exception e) when (e is HttpRequestException or JsonException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                // SteamGridDB unreachable or changed: fall back to Steam's art, and retry next time (no miss saved for a Steam game).
            }
        }
        if (game.SteamAppId is { } appId)
        {
            var file = kind switch
            {
                ArtworkKind.Cover => "library_600x900_2x.jpg",
                ArtworkKind.Hero => "library_hero.jpg",
                ArtworkKind.Logo => "logo.png",
                _ => null,
            };
            if (file is not null) urls.Add($"https://shared.steamstatic.com/store_item_assets/steam/apps/{appId}/{file}");
        }
        return urls;
    }

    /// <summary>SteamGridDB game id for a title: the exact name when listed, else the best match.</summary>
    private async Task<int?> FindGameAsync(string title, CancellationToken ct)
    {
        if (_gameIds.TryGetValue(title, out var known)) return known;
        var found = await SearchGameAsync(title, ct);
        _gameIds[title] = found;
        return found;
    }

    private async Task<int?> SearchGameAsync(string title, CancellationToken ct)
    {
        using var json = await GetJsonAsync($"search/autocomplete/{Uri.EscapeDataString(title)}", ct);
        if (json is null || !json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return null;
        var games = data.EnumerateArray().Where(g => g.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number).ToList();
        var exact = games.FirstOrDefault(g => g.TryGetProperty("name", out var n) && Normalize(n.GetString()) == Normalize(title));
        var chosen = exact.ValueKind == JsonValueKind.Object ? exact : games.FirstOrDefault();
        return chosen.ValueKind == JsonValueKind.Object ? chosen.GetProperty("id").GetInt32() : null;
    }

    private async Task<(string Url, string? Thumb)?> FirstAssetAsync(ArtworkKind kind, string game, CancellationToken ct)
    {
        var path = kind switch
        {
            ArtworkKind.Cover => $"grids/{game}?dimensions=600x900&types=static&nsfw=false&humor=false",
            ArtworkKind.Hero => $"heroes/{game}?types=static&nsfw=false&humor=false",
            ArtworkKind.Logo => $"logos/{game}?types=static&nsfw=false&humor=false",
            _ => $"icons/{game}?types=static&nsfw=false&humor=false",
        };
        using var json = await GetJsonAsync(path, ct);
        if (json is null || !json.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return null;
        foreach (var asset in data.EnumerateArray())
        {
            var url = asset.TryGetProperty("url", out var u) ? u.GetString() : null;
            if (url is null || !IsAllowed(url)) continue;
            var thumb = asset.TryGetProperty("thumb", out var t) ? t.GetString() : null;
            return (url, thumb is not null && IsAllowed(thumb) ? thumb : null);
        }
        return null;
    }

    private async Task<JsonDocument?> GetJsonAsync(string path, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, SteamGridDb + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", steamGridDbKey);
        using var response = await http.SendAsync(request, ct);
        // 404: unknown game or no asset of that kind. Anything else unexpected is an error worth retrying later.
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
    }

    private async Task<string?> DownloadAsync(string url, string pathWithoutExtension, CancellationToken ct)
    {
        if (!IsAllowed(url)) return null;
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode || !IsAllowed(response.RequestMessage?.RequestUri?.ToString() ?? url)) return null;
        var extension = response.Content.Headers.ContentType?.MediaType switch
        {
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            _ => null,
        };
        if (extension is null || response.Content.Headers.ContentLength > MaxImageBytes) return null;

        var target = pathWithoutExtension + extension;
        var partial = target + ".part";
        await using (var output = File.Create(partial))
        await using (var input = await response.Content.ReadAsStreamAsync(ct))
        {
            var buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await input.ReadAsync(buffer, ct)) > 0)
            {
                total += read;
                if (total > MaxImageBytes) break;
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            if (total > MaxImageBytes || total == 0)
            {
                output.Close();
                File.Delete(partial);
                return null;
            }
        }
        File.Move(partial, target, overwrite: true);
        return target;
    }

    private static bool IsAllowed(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && AllowedHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase);

    private static string Normalize(string? name) =>
        new((name ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    /// <summary>File-system safe folder name for a game id ("mac:com.x" becomes "mac_com.x").</summary>
    public static string SafeName(string id) =>
        new(id.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' ? c : '_').ToArray());

    private static bool ConvertIcnsWithSips(string icns, string png)
    {
        if (!OperatingSystem.IsMacOS()) return false;
        using var process = Process.Start(new ProcessStartInfo("/usr/bin/sips", ["-s", "format", "png", "-Z", "512", icns, "--out", png])
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        });
        if (process is null) return false;
        process.WaitForExit(10_000);
        return process.HasExited && process.ExitCode == 0;
    }
}
