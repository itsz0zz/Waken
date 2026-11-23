using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Waken.Agent.Games;

namespace Waken.Agent.Tests;

public sealed class SunshineAppSyncTests : IDisposable
{
    private readonly string _dataDir = Directory.CreateTempSubdirectory("waken-sync-tests-").FullName;
    private readonly CancellationTokenSource _timeout = new(TimeSpan.FromSeconds(15));

    public void Dispose()
    {
        _timeout.Dispose();
        Directory.Delete(_dataDir, recursive: true);
    }

    private static readonly GameEntry Portal = new("steam:620", "Portal 2", "Steam", 620, "steam://rungameid/620");
    private static readonly GameEntry Hades = new("steam:1145360", "Hades", "Steam", 1145360, "steam://rungameid/1145360");
    private static readonly GameEntry Hytale = new("mac:com.hypixel.hytale.client", "Hytale", "Mac", null, "open -a \"/Applications/Hytale.app\"");

    private SunshineAppSync Sync(FakeSunshine sunshine)
    {
        var certificate = Path.Combine(_dataDir, "sunshine.pem");
        File.WriteAllText(certificate, sunshine.CertificatePem);
        var client = new GameStreamClient(new AgentOptions
        {
            SunshineHost = "127.0.0.1",
            SunshinePort = sunshine.Port,
            SunshineCertPath = certificate,
            SunshineUser = FakeSunshine.User,
            SunshinePassword = FakeSunshine.Password,
            DataDir = _dataDir,
        }, NullLogger<GameStreamClient>.Instance);
        return new SunshineAppSync(client.CreateAdminClient, NullLogger<SunshineAppSync>.Instance);
    }

    private static string[] Names(FakeSunshine sunshine) => sunshine.AppsFile.Select(a => a["name"]!.GetValue<string>()).ToArray();

    [Fact]
    public async Task Adds_one_detached_entry_per_game_and_keeps_desktop()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);

        await Sync(sunshine).SyncAsync([Portal, Hytale], _timeout.Token);

        Assert.Equal(["Desktop", "Hytale", "Portal 2"], Names(sunshine));
        var portal = sunshine.AppsFile.Single(a => a["name"]!.GetValue<string>() == "Portal 2");
        Assert.Equal("steam://rungameid/620", portal["detached"]![0]!.GetValue<string>());
        Assert.Equal("steam:620", portal[SunshineAppSync.MarkerField]!.GetValue<string>());
        Assert.True(portal["auto-detach"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Removes_uninstalled_games_whatever_their_position_after_sorting()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        var sync = Sync(sunshine);
        await sync.SyncAsync([Portal, Hades, Hytale], _timeout.Token);

        await Sync(sunshine).SyncAsync([Hytale], _timeout.Token);

        Assert.Equal(["Desktop", "Hytale"], Names(sunshine));
    }

    [Fact]
    public async Task Never_touches_an_entry_the_user_made()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        sunshine.AppsFile.Add(new JsonObject { ["name"] = "Portal 2", ["cmd"] = "my-own-launcher.sh" });
        sunshine.AppsFile.Add(new JsonObject { ["name"] = "Emulator", ["cmd"] = "retroarch" });

        await Sync(sunshine).SyncAsync([Portal, Hades], _timeout.Token);
        await Sync(sunshine).SyncAsync([], _timeout.Token);

        Assert.Equal(["Desktop", "Emulator", "Portal 2"], Names(sunshine).Order());
        var portal = sunshine.AppsFile.Single(a => a["name"]!.GetValue<string>() == "Portal 2");
        Assert.Equal("my-own-launcher.sh", portal["cmd"]!.GetValue<string>());
    }

    [Fact]
    public async Task Writes_nothing_when_the_library_did_not_change()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        var sync = Sync(sunshine);
        await sync.SyncAsync([Portal, Hytale], _timeout.Token);
        var writes = sunshine.AppWrites;
        var reads = sunshine.AdminRequests;

        await sync.SyncAsync([Hytale, Portal], _timeout.Token);
        await Sync(sunshine).SyncAsync([Portal, Hytale], _timeout.Token); // a restarted agent: one read, no write

        Assert.Equal(writes, sunshine.AppWrites);
        Assert.Equal(reads + 1, sunshine.AdminRequests);
    }

    [Fact]
    public async Task Updates_a_game_whose_launch_command_changed()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        await Sync(sunshine).SyncAsync([Hytale], _timeout.Token);

        await Sync(sunshine).SyncAsync([Hytale with { Detached = "open -a \"/Users/me/Applications/Hytale.app\"" }], _timeout.Token);

        var entry = Assert.Single(sunshine.AppsFile, a => a["name"]!.GetValue<string>() == "Hytale");
        Assert.Contains("/Users/me/", entry["detached"]![0]!.GetValue<string>());
    }

    [Fact]
    public async Task Lists_the_same_game_from_two_stores_once()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);

        await Sync(sunshine).SyncAsync([Hades, Hades with { Id = "epic:Min", Store = "Epic", SteamAppId = null, Detached = "epic://x" }], _timeout.Token);

        Assert.Equal(["Desktop", "Hades"], Names(sunshine));
    }
}
