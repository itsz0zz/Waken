using Microsoft.Extensions.Logging.Abstractions;

namespace Waken.Agent.Tests;

public sealed class GameStreamClientTests : IDisposable
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(15);
    private readonly string _dataDir = Directory.CreateTempSubdirectory("waken-agent-tests-").FullName;
    private readonly CancellationTokenSource _timeout = new(TestTimeout);

    private GameStreamClient Client(FakeSunshine sunshine, string password = FakeSunshine.Password, string? certificate = null, string host = "127.0.0.1") => new(
        new AgentOptions
        {
            SunshineHost = host,
            SunshineCertPath = WriteCertificate(certificate ?? sunshine.CertificatePem),
            SunshinePort = sunshine.Port,
            LaunchWindowSeconds = sunshine.PendingLaunchWindow.TotalSeconds,
            SunshineUser = FakeSunshine.User,
            SunshinePassword = password,
            DataDir = _dataDir,
        },
        NullLogger<GameStreamClient>.Instance);

    [Theory]
    [InlineData(nameof(SunshineApi.PairingId))]
    [InlineData(nameof(SunshineApi.Legacy))]
    public async Task Pairs_then_lists_the_apps(string api)
    {
        await using var sunshine = await FakeSunshine.StartAsync(Enum.Parse<SunshineApi>(api));

        var apps = await Client(sunshine).AppsAsync(_timeout.Token);

        Assert.Equal(["Desktop", "Steam Big Picture"], apps.Select(app => app.Title));
    }

    [Fact]
    public async Task Never_approves_the_pairing_request_of_another_device()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        var foreignId = sunshine.AddForeignPairingRequest("waken");

        await Client(sunshine).AppsAsync(_timeout.Token);

        Assert.DoesNotContain(foreignId, sunshine.ApprovedIds);
    }

    [Fact]
    public async Task Pairs_only_once()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);

        await Client(sunshine).AppsAsync(_timeout.Token);
        await Client(sunshine).AppsAsync(_timeout.Token);

        Assert.Equal(1, sunshine.PairingsStarted);
    }

    [Fact]
    public async Task A_wrong_admin_password_fails_quickly_and_says_so()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Client(sunshine, "wrong").AppsAsync(_timeout.Token));

        Assert.Contains("SunshinePassword", error.Message);
    }

    [Fact]
    public async Task Launches_then_resumes_the_same_app_without_closing_it()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        var client = Client(sunshine);

        var launched = await client.LaunchAsync("Steam Big Picture", 1920, 1080, 60, _timeout.Token);
        await client.LaunchAsync("Steam Big Picture", 1920, 1080, 60, _timeout.Token);

        Assert.Equal("rtspenc://127.0.0.1:48010", launched.RtspSessionUrl);
        Assert.Equal(257, launched.ServerCodecModeSupport);
        Assert.Equal(["launch", "resume"], sunshine.Verbs);
    }

    [Fact]
    public async Task An_unknown_app_does_not_close_the_running_game()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        var client = Client(sunshine);
        await client.LaunchAsync("Steam Big Picture", 1920, 1080, 60, _timeout.Token);

        await Assert.ThrowsAsync<SunshineAppMissingException>(() => client.LaunchAsync("Not configured", 1920, 1080, 60, _timeout.Token));

        Assert.Equal(["launch"], sunshine.Verbs);
    }

    [Fact]
    public async Task A_launch_reports_the_time_of_each_step()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        var client = Client(sunshine);

        var launched = await client.LaunchAsync("Steam Big Picture", 1920, 1080, 60, _timeout.Token, timer: new LaunchTimer());

        Assert.Equal(["appairage", "attente lancement précédent", "état de Sunshine", "lancement"], launched.Timings!.Keys);
    }

    [Fact]
    public async Task A_passing_error_does_not_pair_again()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        await Client(sunshine).AppsAsync(_timeout.Token);

        sunshine.TransientFailures = 1;
        await Assert.ThrowsAnyAsync<Exception>(() => Client(sunshine).AppsAsync(_timeout.Token));
        await Client(sunshine).AppsAsync(_timeout.Token);

        Assert.Equal(1, sunshine.PairingsStarted);
    }

    [Fact]
    public async Task Recovers_when_its_saved_pairing_is_lost()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        await Client(sunshine).AppsAsync(_timeout.Token);

        File.Delete(Path.Combine(_dataDir, "server.pem"));

        Assert.NotEmpty(await Client(sunshine).AppsAsync(_timeout.Token));
    }

    [Fact]
    public async Task Recovers_when_Sunshine_forgot_it()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        await Client(sunshine).AppsAsync(_timeout.Token);

        sunshine.ForgetClients();

        Assert.NotEmpty(await Client(sunshine).AppsAsync(_timeout.Token));
    }

    [Fact]
    public async Task Never_closes_a_running_game_unless_asked_to()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        var client = Client(sunshine);
        await client.LaunchAsync("Steam Big Picture", 1920, 1080, 60, _timeout.Token);

        var error = await Assert.ThrowsAnyAsync<Exception>(() => client.LaunchAsync("Desktop", 1920, 1080, 60, _timeout.Token));
        Assert.Contains("Steam Big Picture", error.Message);
        Assert.Equal(["launch"], sunshine.Verbs);

        await client.LaunchAsync("Desktop", 1920, 1080, 60, _timeout.Token, replace: true);
        Assert.Equal(["launch", "cancel", "launch"], sunshine.Verbs);
    }

    [Fact]
    public async Task A_quick_relaunch_still_gets_a_key_Sunshine_uses()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        sunshine.PendingLaunchWindow = TimeSpan.FromSeconds(1);
        var client = Client(sunshine);

        await client.LaunchAsync("Desktop", 1920, 1080, 60, _timeout.Token);
        await client.LaunchAsync("Desktop", 1280, 720, 60, _timeout.Token);

        Assert.Equal(0, sunshine.IgnoredLaunches);
    }

    [Fact]
    public async Task Never_resumes_TLS_sessions_which_Sunshine_rejects()
    {
        await using var sunshine = await FakeSunshine.StartAsync(SunshineApi.PairingId);

        using var handler = Client(sunshine).CreateTlsHandler();

        Assert.False(handler.SslOptions.AllowTlsResume);
    }

    private string WriteCertificate(string pem)
    {
        var path = Path.Combine(_dataDir, "sunshine-cacert.pem");
        File.WriteAllText(path, pem);
        return path;
    }

    [Fact]
    public async Task Never_gives_the_admin_password_to_an_impostor()
    {
        await using var impostor = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        await using var real = await FakeSunshine.StartAsync(SunshineApi.PairingId);

        await Assert.ThrowsAnyAsync<Exception>(() => Client(impostor, certificate: real.CertificatePem).AppsAsync(_timeout.Token));

        Assert.Equal(0, impostor.AdminRequests);
    }

    [Fact]
    public async Task Quit_never_talks_to_an_impostor()
    {
        await using var impostor = await FakeSunshine.StartAsync(SunshineApi.PairingId);
        await using var real = await FakeSunshine.StartAsync(SunshineApi.PairingId);

        await Assert.ThrowsAnyAsync<Exception>(() => Client(impostor, certificate: real.CertificatePem).QuitAsync(_timeout.Token));

        Assert.Equal(0, impostor.AdminRequests);
        Assert.Empty(impostor.Verbs);
    }

    [Fact]
    public void Localhost_means_IPv4_loopback_only()
    {
        // Sunshine listens on IPv4 only: anyone can take [::1], which "localhost" resolves to first.
        Assert.Equal("127.0.0.1", new AgentOptions().SunshineHost);
        Assert.Equal("127.0.0.1", new AgentOptions { SunshineHost = "localhost" }.SunshineHost);
    }

    public void Dispose()
    {
        _timeout.Dispose();
        Directory.Delete(_dataDir, recursive: true);
    }
}
