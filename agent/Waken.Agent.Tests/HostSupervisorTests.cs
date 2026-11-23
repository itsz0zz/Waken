using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Waken.Agent.Host;

namespace Waken.Agent.Tests;

/// <summary>
/// The Windows app's services, driven by the agent. Fake Sunshine and network helper (small scripts) stand in for
/// the real executables: the same process plumbing runs on the Mac, where these tests run.
/// </summary>
public sealed class HostSupervisorTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "waken-host-" + Guid.NewGuid().ToString("N"));
    private string Root => Path.Combine(_dir, "data");
    private string CredsFile => Path.Combine(_dir, "creds.txt");
    private string TunnelConfigFile => Path.Combine(_dir, "tunnel-config.json");
    private string TunnelCommandsFile => Path.Combine(_dir, "tunnel-commands.txt");

    public HostSupervisorTests()
    {
        Directory.CreateDirectory(_dir);
        Script("sunshine", $$"""
            #!/bin/sh
            if [ "$2" = "--creds" ]; then echo "$3 $4" > "{{CredsFile}}"; exit 0; fi
            sleep 30
            """);
        Script("tunnel", $$"""
            #!/usr/bin/env python3
            import json, sys
            config = sys.stdin.readline()
            open("{{TunnelConfigFile}}", "w").write(config)
            print("STATUS " + json.dumps({"state": "running", "hosts": []}), flush=True)
            for line in sys.stdin:
                c = json.loads(line)
                open("{{TunnelCommandsFile}}", "a").write(line)
                if c["cmd"] == "hello" and c.get("peer") == "absent":
                    print("REPLY " + json.dumps({"id": c["id"], "error": "hôte introuvable"}), flush=True)
                else:
                    print("REPLY " + json.dumps({"id": c["id"], "result": "ok:" + c["cmd"]}), flush=True)
            """);
    }

    private void Script(string name, string body)
    {
        var path = Path.Combine(_dir, name);
        File.WriteAllText(path, body.Replace("\r\n", "\n"));
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private HostSupervisor Supervisor(bool enabled = true) => new(
        new HostServicesOptions { Enabled = enabled, Root = Root, SunshineExe = Path.Combine(_dir, "sunshine"), TunnelExe = Path.Combine(_dir, "tunnel"), DeviceName = "PC de test" },
        new AgentOptions { Token = "jeton-de-l-agent-0123456789abcdef", SunshineUser = "admin", SunshinePassword = "mot-de-passe-sunshine", SunshinePort = 1 },
        NullLogger<HostSupervisor>.Instance);

    private static async Task Until(Func<bool> condition)
    {
        var watch = Stopwatch.StartNew();
        while (!condition())
        {
            if (watch.Elapsed > TimeSpan.FromSeconds(10)) throw new TimeoutException("condition jamais remplie");
            await Task.Delay(50);
        }
    }

    [Fact]
    public async Task Configures_sunshine_for_this_computer_only()
    {
        var supervisor = Supervisor();
        await supervisor.StartAsync(default);
        await Until(() => File.Exists(CredsFile));
        await supervisor.StopAsync(default);

        var config = File.ReadAllText(supervisor.SunshineConfig);
        Assert.Contains("bind_address = 127.0.0.1", config);
        Assert.Contains("sunshine_name = PC de test", config);
        Assert.Contains("upnp = disabled", config);
        Assert.Contains($"credentials_file = {Path.Combine(Root, "sunshine", "credentials.json")}", config);
        Assert.True(File.Exists(Path.Combine(Root, "sunshine", "apps.json")));
        Assert.Equal("admin mot-de-passe-sunshine", File.ReadAllText(CredsFile).Trim());
    }

    [Fact]
    public async Task Starts_the_network_as_host_with_the_agent_token_on_stdin()
    {
        var supervisor = Supervisor();
        await supervisor.StartAsync(default);
        await Until(() => File.Exists(TunnelConfigFile) && File.ReadAllText(TunnelConfigFile).Length > 0);
        await supervisor.StopAsync(default);

        var config = JsonNode.Parse(File.ReadAllText(TunnelConfigFile))!;
        Assert.Equal("host", config["role"]!.GetValue<string>());
        Assert.Equal("jeton-de-l-agent-0123456789abcdef", config["agentToken"]!.GetValue<string>());
        Assert.Equal("PC de test", config["name"]!.GetValue<string>());
        Assert.Null(config["controlUrl"]);
    }

    [Fact]
    public async Task Reports_the_network_status()
    {
        var supervisor = Supervisor();
        await supervisor.StartAsync(default);
        await Until(() => JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(supervisor.Status()))!["tunnel"] is not null);
        var status = JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(supervisor.Status()))!;
        await supervisor.StopAsync(default);
        Assert.Equal("running", status["tunnel"]!["state"]!.GetValue<string>());
    }

    [Fact]
    public async Task Commands_go_to_the_network_and_come_back()
    {
        var supervisor = Supervisor();
        await supervisor.StartAsync(default);
        await Until(() => File.Exists(TunnelConfigFile));

        var reply = await supervisor.TunnelCommandAsync(new TunnelCommand("hello", "waken-host-mac"), default);
        Assert.Equal("ok:hello", reply!.GetValue<string>());
        var error = await Assert.ThrowsAsync<TunnelException>(() => supervisor.TunnelCommandAsync(new TunnelCommand("hello", "absent"), default));
        Assert.Equal("hôte introuvable", error.Message);
        await Assert.ThrowsAsync<TunnelException>(() => supervisor.TunnelCommandAsync(new TunnelCommand("rm -rf"), default));
        await supervisor.StopAsync(default);
    }

    [Fact]
    public async Task Joining_the_account_network_is_kept_for_the_next_launch()
    {
        var supervisor = Supervisor();
        await supervisor.StartAsync(default);
        await Until(() => File.Exists(TunnelConfigFile));
        await supervisor.TunnelCommandAsync(new TunnelCommand("join", ControlUrl: "https://net.wakenplay.fr", AuthKey: "cle-unique"), default);
        await supervisor.StopAsync(default);

        var sent = JsonNode.Parse(File.ReadAllLines(TunnelCommandsFile).Last())!;
        Assert.Equal("https://net.wakenplay.fr", sent["controlUrl"]!.GetValue<string>());
        Assert.Equal("cle-unique", sent["authKey"]!.GetValue<string>());
        Assert.Equal("https://net.wakenplay.fr", File.ReadAllText(supervisor.ControlFile));

        // Next launch: the network starts on the account's server, no key needed.
        File.Delete(TunnelConfigFile);
        var next = Supervisor();
        await next.StartAsync(default);
        await Until(() => File.Exists(TunnelConfigFile) && File.ReadAllText(TunnelConfigFile).Length > 0);
        await next.StopAsync(default);
        Assert.Equal("https://net.wakenplay.fr", JsonNode.Parse(File.ReadAllText(TunnelConfigFile))!["controlUrl"]!.GetValue<string>());
    }

    [Fact]
    public async Task Does_nothing_when_the_app_runs_its_services_itself()
    {
        var supervisor = Supervisor(enabled: false);
        await supervisor.StartAsync(default);
        await Task.Delay(500);
        await supervisor.StopAsync(default);
        Assert.False(Directory.Exists(Root));
        await Assert.ThrowsAsync<TunnelException>(() => supervisor.TunnelCommandAsync(new TunnelCommand("hello", "x"), default));
    }
}
