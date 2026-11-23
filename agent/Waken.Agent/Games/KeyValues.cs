using System.Text;

namespace Waken.Agent.Games;

/// <summary>
/// Valve's KeyValues text format (libraryfolders.vdf, appmanifest_*.acf):
/// quoted keys and values, nested { } blocks, // comments, backslash escapes.
/// </summary>
public static class KeyValues
{
    public static Dictionary<string, object> Parse(string text)
    {
        var position = 0;
        return ReadBlock(text, ref position, topLevel: true);
    }

    public static string? Text(this Dictionary<string, object> node, string key) =>
        node.FirstOrDefault(e => string.Equals(e.Key, key, StringComparison.OrdinalIgnoreCase)).Value as string;

    public static Dictionary<string, object>? Block(this Dictionary<string, object> node, string key) =>
        node.FirstOrDefault(e => string.Equals(e.Key, key, StringComparison.OrdinalIgnoreCase)).Value as Dictionary<string, object>;

    private static Dictionary<string, object> ReadBlock(string text, ref int position, bool topLevel)
    {
        var node = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        while (true)
        {
            var key = ReadToken(text, ref position);
            if (key is null || key == "}")
            {
                if (key is null && !topLevel) throw new FormatException("Bloc KeyValues non fermé.");
                return node;
            }
            if (key == "{") throw new FormatException("Accolade inattendue.");

            var value = ReadToken(text, ref position) ?? throw new FormatException($"Valeur manquante pour « {key} ».");
            node[key] = value == "{" ? ReadBlock(text, ref position, topLevel: false) : value;
        }
    }

    private static string? ReadToken(string text, ref int position)
    {
        while (position < text.Length)
        {
            var c = text[position];
            if (char.IsWhiteSpace(c))
            {
                position++;
            }
            else if (c == '/' && position + 1 < text.Length && text[position + 1] == '/')
            {
                while (position < text.Length && text[position] != '\n') position++;
            }
            else
            {
                break;
            }
        }
        if (position >= text.Length) return null;

        var current = text[position];
        if (current is '{' or '}')
        {
            position++;
            return current.ToString();
        }

        var builder = new StringBuilder();
        if (current == '"')
        {
            position++;
            while (position < text.Length && text[position] != '"')
            {
                if (text[position] == '\\' && position + 1 < text.Length)
                {
                    position++;
                    builder.Append(text[position] switch { 'n' => '\n', 't' => '\t', var other => other });
                }
                else
                {
                    builder.Append(text[position]);
                }
                position++;
            }
            position++;
            return builder.ToString();
        }

        while (position < text.Length && !char.IsWhiteSpace(text[position]) && text[position] is not ('{' or '}' or '"'))
        {
            builder.Append(text[position++]);
        }
        return builder.ToString();
    }
}
