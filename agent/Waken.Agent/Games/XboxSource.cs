using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;

namespace Waken.Agent.Games;

/// <summary>
/// Xbox app and Game Pass games: installed under X:\XboxGames\&lt;game&gt;\Content, each with its appxmanifest.xml.
/// They start as Store apps, shell:AppsFolder\&lt;package family&gt;!&lt;app id&gt;.
/// </summary>
public sealed class XboxSource(IEnumerable<string> xboxGamesFolders) : IGameSource
{
    public IEnumerable<GameEntry> Scan()
    {
        foreach (var root in xboxGamesFolders.Where(Directory.Exists))
        {
            foreach (var gameDir in Directory.EnumerateDirectories(root))
            {
                var manifest = Path.Combine(gameDir, "Content", "appxmanifest.xml");
                if (!File.Exists(manifest)) continue;
                GameEntry? entry = null;
                try
                {
                    entry = Read(manifest, Path.GetFileName(gameDir));
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Xml.XmlException)
                {
                    // An update in progress: the next scan reads it.
                }
                if (entry is not null) yield return entry;
            }
        }
    }

    private static GameEntry? Read(string manifest, string folderName)
    {
        var doc = XDocument.Load(manifest);
        var identity = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "Identity");
        var app = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "Application");
        var name = identity?.Attribute("Name")?.Value;
        var publisher = identity?.Attribute("Publisher")?.Value;
        var appId = app?.Attribute("Id")?.Value;
        if (name is null || publisher is null || appId is null) return null;

        // The display name may be a resource reference ("ms-resource:..."): the folder name is the readable one then.
        var display = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "DisplayName")?.Value;
        var title = string.IsNullOrWhiteSpace(display) || display.StartsWith("ms-resource:", StringComparison.OrdinalIgnoreCase) ? folderName : display.Trim();
        var family = $"{name}_{PublisherId(publisher)}";
        return new GameEntry($"xbox:{family}", title, "Xbox", null, $"shell:AppsFolder\\{family}!{appId}");
    }

    /// <summary>
    /// Windows' publisher id: SHA-256 of the publisher (UTF-16LE), its first 8 bytes, padded to 65 bits,
    /// written as 13 Crockford base32 characters. "CN=Microsoft Corporation, ..." gives 8wekyb3d8bbwe.
    /// </summary>
    public static string PublisherId(string publisher)
    {
        const string alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
        var hash = SHA256.HashData(Encoding.Unicode.GetBytes(publisher));
        var bits = new StringBuilder(65);
        foreach (var b in hash.AsSpan(0, 8)) bits.Append(Convert.ToString(b, 2).PadLeft(8, '0'));
        bits.Append('0');
        var id = new StringBuilder(13);
        for (var i = 0; i < 65; i += 5) id.Append(alphabet[Convert.ToInt32(bits.ToString(i, 5), 2)]);
        return id.ToString();
    }

    /// <summary>XboxGames folders at the root of every fixed drive.</summary>
    public static IEnumerable<string> DefaultFolders() =>
        DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady).Select(d => Path.Combine(d.RootDirectory.FullName, "XboxGames"));
}
