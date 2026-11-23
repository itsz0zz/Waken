using Microsoft.Win32;

namespace Waken.Agent.Games;

/// <summary>One entry of Windows' installed programs (the Uninstall keys behind "Apps and features").</summary>
public sealed record InstalledProgram(string Key, string DisplayName, string? Publisher, string? InstallLocation, string? DisplayIcon, string? UninstallString)
{
    /// <summary>The executable a DisplayIcon points to: quotes and the ",0" icon index taken off.</summary>
    public string? IconExecutable()
    {
        if (string.IsNullOrWhiteSpace(DisplayIcon)) return null;
        var path = DisplayIcon.Trim();
        var comma = path.LastIndexOf(',');
        if (comma > 1 && int.TryParse(path[(comma + 1)..].Trim(), out _)) path = path[..comma];
        path = path.Trim().Trim('"');
        return path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? path : null;
    }
}

/// <summary>Reads the installed programs. Tests give their own list.</summary>
public interface IInstalledPrograms
{
    IReadOnlyList<InstalledProgram> List();
    /// <summary>Subkeys of HKLM\SOFTWARE (32 and 64 bit views) with one string value each, e.g. Ubisoft's installs.</summary>
    IReadOnlyList<(string SubKey, string Value)> Values(string keyPath, string valueName);
}

/// <summary>The real registry, machine wide (both views) and for the current user.</summary>
public sealed class WindowsInstalledPrograms : IInstalledPrograms
{
    private const string Uninstall = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

    public IReadOnlyList<InstalledProgram> List()
    {
        var programs = new List<InstalledProgram>();
        if (!OperatingSystem.IsWindows()) return programs;
        foreach (var (hive, view) in new[] { (RegistryHive.LocalMachine, RegistryView.Registry64), (RegistryHive.LocalMachine, RegistryView.Registry32), (RegistryHive.CurrentUser, RegistryView.Default) })
        {
            using var root = RegistryKey.OpenBaseKey(hive, view);
            using var uninstall = root.OpenSubKey(Uninstall);
            if (uninstall is null) continue;
            foreach (var name in uninstall.GetSubKeyNames())
            {
                using var key = uninstall.OpenSubKey(name);
                if (key?.GetValue("DisplayName") is not string display || string.IsNullOrWhiteSpace(display)) continue;
                programs.Add(new InstalledProgram(name, display, key.GetValue("Publisher") as string, key.GetValue("InstallLocation") as string,
                    key.GetValue("DisplayIcon") as string, key.GetValue("UninstallString") as string));
            }
        }
        return programs;
    }

    public IReadOnlyList<(string SubKey, string Value)> Values(string keyPath, string valueName)
    {
        var values = new List<(string, string)>();
        if (!OperatingSystem.IsWindows()) return values;
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            using var parent = root.OpenSubKey(keyPath);
            if (parent is null) continue;
            foreach (var name in parent.GetSubKeyNames())
            {
                using var key = parent.OpenSubKey(name);
                if (key?.GetValue(valueName) is string value && !values.Any(v => v.Item1 == name)) values.Add((name, value));
            }
        }
        return values;
    }
}
