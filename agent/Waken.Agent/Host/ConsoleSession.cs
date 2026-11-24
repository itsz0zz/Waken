using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;

namespace Waken.Agent.Host;

/// <summary>
/// Started at boot as SYSTEM (the Waken start task), the agent lives in session 0, which has no screen. Sunshine has
/// to run in the session shown on the monitor, as SYSTEM still, to capture the sign-in screen too: what Sunshine's
/// own Windows service does. A game started on the computer itself goes to the signed-in user instead.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class ConsoleSession
{
    private const uint NoSession = 0xFFFFFFFF;
    private const uint TokenAllAccess = 0xF01FF;
    private const int SecurityImpersonation = 2;
    private const int TokenPrimary = 1;
    private const int TokenSessionId = 12;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint CreateNoWindow = 0x08000000;

    /// <summary>The session on the monitor, null while none is (the computer starting up).</summary>
    public static uint? ActiveId => WTSGetActiveConsoleSessionId() is var id && id != NoSession ? id : null;

    /// <summary>Starts a program as SYSTEM in the session on the monitor.</summary>
    public static Process StartAsSystem(string exe, IEnumerable<string> args)
    {
        var session = ActiveId ?? throw new InvalidOperationException("Pas encore de session à l'écran");
        if (!OpenProcessToken(Process.GetCurrentProcess().Handle, TokenAllAccess, out var own)) throw new Win32Exception();
        try
        {
            if (!DuplicateTokenEx(own, TokenAllAccess, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out var token)) throw new Win32Exception();
            try
            {
                if (!SetTokenInformation(token, TokenSessionId, ref session, sizeof(uint))) throw new Win32Exception();
                return Start(token, exe, args);
            }
            finally
            {
                CloseHandle(token);
            }
        }
        finally
        {
            CloseHandle(own);
        }
    }

    /// <summary>Starts a program as the user signed in on the monitor. False when nobody is.</summary>
    public static bool StartAsUser(string exe, IEnumerable<string> args)
    {
        if (ActiveId is not { } session || !WTSQueryUserToken(session, out var token)) return false;
        try
        {
            Start(token, exe, args).Dispose();
            return true;
        }
        finally
        {
            CloseHandle(token);
        }
    }

    private static Process Start(IntPtr token, string exe, IEnumerable<string> args)
    {
        var command = new StringBuilder(Quote(exe));
        foreach (var arg in args) command.Append(' ').Append(Quote(arg));
        if (!CreateEnvironmentBlock(out var environment, token, false)) environment = IntPtr.Zero;
        try
        {
            var startup = new StartupInfo { cb = Marshal.SizeOf<StartupInfo>(), lpDesktop = @"winsta0\default" };
            if (!CreateProcessAsUserW(token, exe, command, IntPtr.Zero, IntPtr.Zero, false, CreateUnicodeEnvironment | CreateNoWindow, environment,
                    Path.GetDirectoryName(exe), ref startup, out var info))
                throw new Win32Exception();
            CloseHandle(info.hThread);
            try
            {
                return Process.GetProcessById(info.dwProcessId);
            }
            catch (ArgumentException)
            {
                throw new InvalidOperationException($"{Path.GetFileName(exe)} s'est arrêté aussitôt");
            }
            finally
            {
                CloseHandle(info.hProcess);
            }
        }
        finally
        {
            if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
        }
    }

    /// <summary>One argument as CommandLineToArgvW reads it back.</summary>
    private static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny([' ', '\t', '"']) < 0) return arg;
        var quoted = new StringBuilder("\"");
        var slashes = 0;
        foreach (var c in arg)
        {
            if (c == '\\')
            {
                slashes++;
                continue;
            }
            quoted.Append('\\', c == '"' ? slashes * 2 + 1 : slashes).Append(c);
            slashes = 0;
        }
        return quoted.Append('\\', slashes * 2).Append('"').ToString();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(IntPtr existing, uint access, IntPtr attributes, int impersonation, int type, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(IntPtr token, int infoClass, ref uint info, uint length);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUserW(IntPtr token, string? application, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string? directory, ref StartupInfo startup, out ProcessInformation info);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
