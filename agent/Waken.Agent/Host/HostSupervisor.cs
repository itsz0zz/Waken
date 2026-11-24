using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Waken.Agent.Host;

/// <summary>Where the desktop app ships the stream server and the network, and keeps their data.</summary>
public sealed class HostServicesOptions
{
    /// <summary>The agent runs Sunshine and the Waken network itself (the Windows app). Off on the Mac, whose app does it.</summary>
    public bool Enabled { get; set; }
    /// <summary>The app's data folder (%LOCALAPPDATA%\Waken): sunshine\, tunnel\, the network choice.</summary>
    public string Root { get; set; } = "";
    public string SunshineExe { get; set; } = "";
    public string TunnelExe { get; set; } = "";
    /// <summary>This computer's name, shown on the other devices.</summary>
    public string DeviceName { get; set; } = Environment.MachineName;
}

/// <summary>
/// The host side of the Windows app: Sunshine (the stream server) and the Waken network helper, started with the
/// agent, restarted if they stop, stopped with it. The app itself only starts the agent (one small native module)
/// and asks it: GET /host/status, POST /host/tunnel, POST /host/restart-sunshine.
/// </summary>
public sealed class HostSupervisor(HostServicesOptions host, AgentOptions agent, ILogger<HostSupervisor> log) : BackgroundService
{
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(15);

    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonNode?>> _pending = new();
    private readonly Lock _lock = new();
    private Process? _sunshine;
    private Process? _tunnel;
    private string? _tunnelStatus;
    private string? _error;
    private int _nextCommand;
    private CancellationToken _stopping;

    public string SunshineFolder => Path.Combine(host.Root, "sunshine");
    public string SunshineConfig => Path.Combine(SunshineFolder, "sunshine.conf");
    public string TunnelFolder => Path.Combine(host.Root, "tunnel");
    /// <summary>The coordination server once the computer joined the account's network; absent: Tailscale's.</summary>
    public string ControlFile => Path.Combine(host.Root, "network-control.txt");

    public bool SunshineRunning => _sunshine is { HasExited: false } && IsListening(agent.SunshinePort);

    public object Status()
    {
        lock (_lock)
        {
            return new
            {
                sunshine = SunshineRunning,
                tunnel = _tunnelStatus is null ? null : JsonNode.Parse(_tunnelStatus),
                error = _error ?? (OtherSunshineListening(agent.SunshinePort) ? OtherSunshine : null),
                gamepadDriver = GamepadDriverInstalled(),
            };
        }
    }

    /// <summary>
    /// Sunshine plays a controller on Windows through a virtual gamepad driver (ViGEmBus), installed apart with
    /// administrator rights: without it, controllers from the other devices do nothing. Null off Windows.
    /// </summary>
    public static bool? GamepadDriverInstalled()
    {
        if (!OperatingSystem.IsWindows()) return null;
        using var service = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\ViGEmBus");
        return service is not null;
    }

    public const string OtherSunshine =
        "Un autre Sunshine tourne sur ce PC (installé à part) et prend les ports du stream : arrête-le et désactive-le "
        + "(service « SunshineService »), puis relance Waken.";

    /// <summary>
    /// Waken's Sunshine listens on 127.0.0.1 only: a listener on every address (0.0.0.0 or ::) on its ports is
    /// another Sunshine, installed apart, that takes the stream's connections.
    /// </summary>
    public static bool OtherSunshineListening(int port) =>
        IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()
            .Any(e => (e.Port == port || e.Port == port + 1) && (e.Address.Equals(IPAddress.Any) || e.Address.Equals(IPAddress.IPv6Any)));

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        if (!host.Enabled) return;
        _stopping = stopping;
        try
        {
            Directory.CreateDirectory(SunshineFolder);
            Directory.CreateDirectory(TunnelFolder);
            WriteSunshineConfig();
            await SetSunshineCredentialsAsync(stopping);
            StartSunshine();
            StartTunnel();
        }
        catch (Exception e) when (e is IOException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            lock (_lock) _error = e.Message;
            log.LogError(e, "Démarrage des services");
        }

        // Restarted when they stop (a crash, a driver update): a few seconds apart, never in a tight loop.
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stopping);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            if (_sunshine is { HasExited: true }) Restart("Sunshine", StartSunshine);
            if (_tunnel is { HasExited: true }) Restart("le réseau", StartTunnel);
        }
        Stop();
    }

    private void Restart(string what, Action start)
    {
        log.LogWarning("{What} s'est arrêté, redémarrage", what);
        try
        {
            start();
        }
        catch (Exception e) when (e is IOException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            lock (_lock) _error = e.Message;
        }
    }

    public void WriteSunshineConfig()
    {
        string P(string name) => Path.Combine(SunshineFolder, name);
        var lines = new[]
        {
            $"sunshine_name = {host.DeviceName}",
            $"file_apps = {P("apps.json")}",
            $"credentials_file = {P("credentials.json")}",
            $"pkey = {P(Path.Combine("credentials", "cakey.pem"))}",
            $"cert = {P(Path.Combine("credentials", "cacert.pem"))}",
            $"file_state = {P("state.json")}",
            $"log_path = {P("sunshine.log")}",
            // Waken drives Sunshine: no tray icon of its own, admin page for this computer only, no router changes.
            "system_tray = disabled",
            "origin_web_ui_allowed = pc",
            "upnp = disabled",
            // This computer only: the other devices come in through Waken's encrypted network, never from the LAN.
            "bind_address = 127.0.0.1",
            "notify_pre_releases = disabled",
            // The PC's screen takes the size the other device asks for (its window's shape: no black bars), as
            // Parsec does, and gets its own back when that device disconnects. The refresh rate stays the screen's.
            "dd_configuration_option = verify_only",
            "dd_resolution_option = auto",
            "dd_refresh_rate_option = disabled",
            "dd_config_revert_on_disconnect = enabled",
        };
        File.WriteAllText(SunshineConfig, string.Join('\n', lines) + "\n");
        var apps = P("apps.json");
        if (!File.Exists(apps)) File.WriteAllText(apps, """{"env":{},"apps":[{"name":"Desktop","image-path":"desktop.png"}]}""");
    }

    /// <summary>The embedded Sunshine's admin account: generated by the app, only the agent uses it.</summary>
    private async Task SetSunshineCredentialsAsync(CancellationToken ct)
    {
        using var creds = Process.Start(Info(host.SunshineExe, [SunshineConfig, "--creds", agent.SunshineUser, agent.SunshinePassword]))
            ?? throw new InvalidOperationException("Sunshine n'a pas démarré");
        await creds.WaitForExitAsync(ct);
    }

    private void StartSunshine()
    {
        var process = Process.Start(Info(host.SunshineExe, [SunshineConfig])) ?? throw new InvalidOperationException("Sunshine n'a pas démarré");
        process.StandardOutput.BaseStream.CopyToAsync(Stream.Null, _stopping);
        process.StandardError.BaseStream.CopyToAsync(Stream.Null, _stopping);
        lock (_lock) _sunshine = process;
    }

    /// <summary>Picks up a change that only applies to a new process (a permission, a display).</summary>
    public void RestartSunshine()
    {
        if (_sunshine is { HasExited: false } running)
        {
            running.Kill(entireProcessTree: true);
            running.WaitForExit(5000);
        }
        StartSunshine();
    }

    /// <summary>
    /// The Waken network: its stdin carries the configuration (with the agent token, never on a command line),
    /// then the commands; its stdout, STATUS and REPLY lines.
    /// </summary>
    private void StartTunnel()
    {
        var info = Info(host.TunnelExe, []);
        info.RedirectStandardInput = true;
        var process = Process.Start(info) ?? throw new InvalidOperationException("Le réseau Waken n'a pas démarré");
        // What the helper says about itself (sign-in, control server, paths): tunnel\tunnel.log, rewritten at each start.
        Directory.CreateDirectory(TunnelFolder);
        var tunnelLog = new FileStream(Path.Combine(TunnelFolder, "tunnel.log"), FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
        _ = process.StandardError.BaseStream.CopyToAsync(new AutoFlushStream(tunnelLog), _stopping).ContinueWith(_ => tunnelLog.Dispose(), TaskScheduler.Default);
        lock (_lock) _tunnel = process;
        _ = Task.Run(() => ReadTunnelAsync(process), _stopping);
        var config = new JsonObject
        {
            ["role"] = "host",
            ["dir"] = TunnelFolder,
            ["name"] = host.DeviceName,
            ["agentToken"] = agent.Token,
        };
        if (File.Exists(ControlFile) && File.ReadAllText(ControlFile).Trim() is { Length: > 0 } control) config["controlUrl"] = control;
        Send(process, config);
    }

    private async Task ReadTunnelAsync(Process process)
    {
        while (await process.StandardOutput.ReadLineAsync(_stopping) is { } line)
        {
            if (line.StartsWith("STATUS ", StringComparison.Ordinal))
            {
                lock (_lock) _tunnelStatus = line[7..];
            }
            else if (line.StartsWith("REPLY ", StringComparison.Ordinal) && JsonNode.Parse(line[6..]) is JsonObject reply
                && reply["id"]?.GetValue<int>() is { } id && _pending.TryRemove(id, out var waiting))
            {
                if (reply["error"]?.GetValue<string>() is { } error) waiting.TrySetException(new TunnelException(error));
                else waiting.TrySetResult(reply["result"]?.DeepClone());
            }
        }
        // The helper ended: whoever still waits gets an answer.
        foreach (var id in _pending.Keys)
            if (_pending.TryRemove(id, out var waiting)) waiting.TrySetException(new TunnelException("Le réseau Waken s'est arrêté"));
    }

    /// <summary>hello, setPeer, logout, or join (another network, a key to sign in with).</summary>
    public async Task<JsonNode?> TunnelCommandAsync(TunnelCommand command, CancellationToken ct)
    {
        if (command.Cmd is not ("hello" or "setPeer" or "logout" or "join")) throw new TunnelException($"Commande inconnue : {command.Cmd}");
        var process = _tunnel;
        if (process is not { HasExited: false }) throw new TunnelException("Le réseau Waken n'est pas démarré.");
        if (command.Cmd == "join")
        {
            // Kept for the next launches: the network starts again on the account's server.
            if (string.IsNullOrEmpty(command.ControlUrl)) File.Delete(ControlFile);
            else File.WriteAllText(ControlFile, command.ControlUrl);
        }
        var id = Interlocked.Increment(ref _nextCommand);
        var waiting = new TaskCompletionSource<JsonNode?>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = waiting;
        var message = new JsonObject { ["id"] = id, ["cmd"] = command.Cmd };
        if (command.Peer is not null) message["peer"] = command.Peer;
        if (command.Cmd == "join")
        {
            message["controlUrl"] = command.ControlUrl ?? "";
            message["authKey"] = command.AuthKey ?? "";
        }
        Send(process, message);
        try
        {
            return await waiting.Task.WaitAsync(CommandTimeout, ct);
        }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    private static void Send(Process process, JsonNode message)
    {
        lock (process)
        {
            process.StandardInput.WriteLine(message.ToJsonString());
            process.StandardInput.Flush();
        }
    }

    private void Stop()
    {
        foreach (var process in new[] { _tunnel, _sunshine })
        {
            if (process is not { HasExited: false }) continue;
            try
            {
                // Closing stdin stops the network helper cleanly (it signs nothing out); Sunshine is ended at once.
                if (process == _tunnel)
                {
                    process.StandardInput.Close();
                    if (process.WaitForExit(3000)) continue;
                }
                process.Kill(entireProcessTree: true);
            }
            catch (InvalidOperationException)
            {
                // Already gone.
            }
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        Stop();
    }

    private static ProcessStartInfo Info(string exe, string[] args)
    {
        var info = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // Sunshine finds its assets beside its exe.
            WorkingDirectory = Path.GetDirectoryName(exe) ?? "",
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        return info;
    }

    private static bool IsListening(int port)
    {
        try
        {
            using var client = new TcpClient();
            return client.ConnectAsync("127.0.0.1", port).Wait(300) && client.Connected;
        }
        catch (AggregateException)
        {
            return false;
        }
        catch (SocketException)
        {
            return false;
        }
    }
}

public sealed record TunnelCommand(string Cmd, string? Peer = null, string? ControlUrl = null, string? AuthKey = null);

public sealed class TunnelException(string message) : Exception(message);

/// <summary>Writes through at once: the log is readable while the helper runs, and complete if it dies.</summary>
internal sealed class AutoFlushStream(Stream inner) : Stream
{
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => inner.Length;
    public override long Position { get => inner.Position; set => throw new NotSupportedException(); }
    public override void Flush() => inner.Flush();
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count)
    {
        inner.Write(buffer, offset, count);
        inner.Flush();
    }
    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default)
    {
        await inner.WriteAsync(buffer, ct);
        await inner.FlushAsync(ct);
    }
}
