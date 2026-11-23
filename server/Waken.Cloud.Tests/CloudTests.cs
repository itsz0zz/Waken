using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Waken.Cloud.Tests;

public sealed class CloudTests : IDisposable
{
    private const string Password = "un mot de passe long";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "waken-cloud-" + Guid.NewGuid().ToString("N"));
    private readonly FakeHeadscale _headscale = new();
    private ManualClock Clock { get; } = new();
    private readonly WebApplicationFactory<Program> _api;

    public CloudTests()
    {
        _api = Api();
    }

    private WebApplicationFactory<Program> Api(Action<IWebHostBuilder>? more = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
        {
            host.UseSetting("Cloud:HeadscaleUrl", "http://headscale.test:8080");
            host.UseSetting("Cloud:HeadscaleApiKey", "hs-api-key-0123456789abcdef");
            host.UseSetting("Cloud:ControlUrl", "https://reseau.waken.test");
            host.UseSetting("Cloud:DataDir", _dir);
            host.UseSetting("Cloud:AuthRequestsPerMinute", "1000");
            host.UseSetting("Cloud:NetworkRequestsPerMinute", "1000");
            host.UseSetting("Cloud:WatchSeconds", "0");
            host.ConfigureTestServices(s =>
            {
                s.AddSingleton<IHeadscale>(_headscale);
                s.AddSingleton<TimeProvider>(Clock);
            });
            more?.Invoke(host);
        });

    public void Dispose()
    {
        _api.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    /// <summary>A new account, signed in: the client carries its bearer token.</summary>
    private async Task<HttpClient> SignedInAsync(string email)
    {
        var client = _api.CreateClient();
        var reg = await client.PostAsJsonAsync("/account/register", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, reg.StatusCode);
        var login = await client.PostAsJsonAsync("/account/login?useCookies=false", new { email, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var token = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<string> HeadscaleUserIdAfterJoinAsync(HttpClient client)
    {
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/network/join", null)).StatusCode);
        return _headscale.Keys.Last().UserId;
    }

    [Fact]
    public async Task Join_gives_the_control_address_and_a_short_single_use_key()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var res = await client.PostAsync("/network/join", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var ticket = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("https://reseau.waken.test", ticket.GetProperty("controlUrl").GetString());
        var key = ticket.GetProperty("authKey").GetString();
        Assert.StartsWith("hskey-", key);
        var issued = Assert.Single(_headscale.Keys);
        Assert.Equal(key, issued.Key);
        Assert.Equal(TimeSpan.FromMinutes(10), issued.Expiration - Clock.GetUtcNow());
    }

    [Fact]
    public async Task An_account_keeps_one_network_user_across_devices()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        await client.PostAsync("/network/join", null);
        await client.PostAsync("/network/join", null);
        Assert.Equal(1, _headscale.UsersCreated);
        var user = Assert.Single(_headscale.Users.Values);
        // No e-mail in the network: the name comes from the account id.
        Assert.StartsWith("waken-", user.Name);
        Assert.DoesNotContain("enzo", user.Name);
        Assert.All(_headscale.Keys, k => Assert.Equal(user.Id, k.UserId));
    }

    [Fact]
    public async Task Two_accounts_get_two_network_users()
    {
        using var a = await SignedInAsync("a@waken.test");
        using var b = await SignedInAsync("b@waken.test");
        Assert.NotEqual(await HeadscaleUserIdAfterJoinAsync(a), await HeadscaleUserIdAfterJoinAsync(b));
    }

    [Theory]
    [InlineData("POST", "/network/join")]
    [InlineData("GET", "/network/devices")]
    [InlineData("DELETE", "/network/devices/1")]
    public async Task The_network_needs_a_signed_in_account(string method, string path)
    {
        using var client = _api.CreateClient();
        var res = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Empty(_headscale.Keys);
    }

    [Fact]
    public async Task A_forged_token_is_refused()
    {
        using var client = _api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "CfDJ8-pas-un-vrai-jeton");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/network/join", null)).StatusCode);
    }

    [Fact]
    public async Task Devices_lists_only_the_account_s_own()
    {
        using var a = await SignedInAsync("a@waken.test");
        using var b = await SignedInAsync("b@waken.test");
        var aUser = await HeadscaleUserIdAfterJoinAsync(a);
        var bUser = await HeadscaleUserIdAfterJoinAsync(b);
        _headscale.AddNode(aUser, "waken-host-mac-de-enzo");
        _headscale.AddNode(aUser, "waken-iphone", online: false);
        _headscale.AddNode(bUser, "waken-host-pc-de-quelqu-un");

        var devices = await a.GetFromJsonAsync<JsonElement>("/network/devices");
        var names = devices.EnumerateArray().Select(d => d.GetProperty("name").GetString()).ToList();
        Assert.Equal(["waken-host-mac-de-enzo", "waken-iphone"], names);
    }

    [Fact]
    public async Task Devices_is_empty_before_the_first_join()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var devices = await client.GetFromJsonAsync<JsonElement>("/network/devices");
        Assert.Equal(0, devices.GetArrayLength());
        Assert.Empty(_headscale.Users);
    }

    [Fact]
    public async Task Removing_someone_else_s_device_is_not_found()
    {
        using var a = await SignedInAsync("a@waken.test");
        using var b = await SignedInAsync("b@waken.test");
        await HeadscaleUserIdAfterJoinAsync(a);
        var theirs = _headscale.AddNode(await HeadscaleUserIdAfterJoinAsync(b), "waken-host-pc");

        Assert.Equal(HttpStatusCode.NotFound, (await a.DeleteAsync($"/network/devices/{theirs.Id}")).StatusCode);
        Assert.True(_headscale.Nodes.ContainsKey(theirs.Id));
    }

    [Fact]
    public async Task Removing_one_s_own_device_takes_it_off_the_network()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var mine = _headscale.AddNode(await HeadscaleUserIdAfterJoinAsync(client), "waken-iphone-perdu");
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/network/devices/{mine.Id}")).StatusCode);
        Assert.False(_headscale.Nodes.ContainsKey(mine.Id));
    }

    [Fact]
    public async Task Headscale_down_is_a_502_without_its_details()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        _headscale.Down = true;
        var res = await client.PostAsync("/network/join", null);
        Assert.Equal(HttpStatusCode.BadGateway, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.DoesNotContain("injoignable", body);
        Assert.DoesNotContain("headscale.test", body);
    }

    [Theory]
    [InlineData("court")]
    [InlineData("123456789")]
    public async Task A_short_password_is_refused(string password)
    {
        using var client = _api.CreateClient();
        var res = await client.PostAsJsonAsync("/account/register", new { email = "enzo@waken.test", password });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_does_not_sign_in()
    {
        using var _ = await SignedInAsync("enzo@waken.test");
        using var client = _api.CreateClient();
        var res = await client.PostAsJsonAsync("/account/login?useCookies=false", new { email = "enzo@waken.test", password = "pas le bon mot de passe" });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task The_account_locks_after_five_wrong_passwords()
    {
        using var _ = await SignedInAsync("enzo@waken.test");
        using var client = _api.CreateClient();
        for (var i = 0; i < 5; i++)
            await client.PostAsJsonAsync("/account/login?useCookies=false", new { email = "enzo@waken.test", password = "mauvais mot de passe" });
        var res = await client.PostAsJsonAsync("/account/login?useCookies=false", new { email = "enzo@waken.test", password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Deleting_the_account_needs_its_password()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var res = await client.PostAsJsonAsync("/account/delete", new { password = "pas le bon mot de passe" });
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Guessing_the_password_on_delete_locks_the_account()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        for (var i = 0; i < 5; i++)
            await client.PostAsJsonAsync("/account/delete", new { password = "devinette numéro " + i });
        var res = await client.PostAsJsonAsync("/account/delete", new { password = Password });
        Assert.Equal((HttpStatusCode)423, res.StatusCode);
    }

    [Fact]
    public async Task An_account_has_a_device_limit()
    {
        using var api = Api(h => h.UseSetting("Cloud:MaxDevices", "2"));
        var client = api.CreateClient();
        await client.PostAsJsonAsync("/account/register", new { email = "enzo@waken.test", password = Password });
        var login = await client.PostAsJsonAsync("/account/login?useCookies=false", new { email = "enzo@waken.test", password = Password });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString());
        var hsUser = await HeadscaleUserIdAfterJoinAsync(client);
        _headscale.AddNode(hsUser, "waken-a");
        _headscale.AddNode(hsUser, "waken-b");
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync("/network/join", null)).StatusCode);
    }

    [Fact]
    public async Task Deleting_the_account_removes_its_devices_and_network_user()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var hsUser = await HeadscaleUserIdAfterJoinAsync(client);
        _headscale.AddNode(hsUser, "waken-host-mac");
        _headscale.AddNode(hsUser, "waken-iphone");

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/account/delete", new { password = Password })).StatusCode);
        Assert.Empty(_headscale.Nodes);
        Assert.Empty(_headscale.Users);
        using var again = _api.CreateClient();
        var login = await again.PostAsJsonAsync("/account/login?useCookies=false", new { email = "enzo@waken.test", password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Fact]
    public async Task Sign_in_calls_are_rate_limited()
    {
        using var api = Api(h => h.UseSetting("Cloud:AuthRequestsPerMinute", "3"));
        using var client = api.CreateClient();
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 4; i++)
            codes.Add((await client.PostAsJsonAsync("/account/login?useCookies=false", new { email = "x@waken.test", password = "peu importe ici" })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, codes[^1]);
    }

    [Theory]
    [InlineData("Cloud:HeadscaleApiKey", "")]
    [InlineData("Cloud:HeadscaleUrl", "pas-une-adresse")]
    [InlineData("Cloud:ControlUrl", "")]
    public void Refuses_to_start_without_its_headscale_settings(string key, string value)
    {
        using var api = Api(h => h.UseSetting(key, value));
        Assert.ThrowsAny<Exception>(() => api.CreateClient());
    }

    private const string Token = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    private Notifier Notifier => _api.Services.GetRequiredService<Notifier>();
    private NetworkWatcher Watcher => _api.Services.GetRequiredService<NetworkWatcher>();

    [Fact]
    public async Task A_device_registers_for_notifications()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var res = await client.PostAsJsonAsync("/push/register", new { token = Token, platform = "ios", name = "iPhone de Enzo" });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/push/register", new { token = "pas-un-jeton", platform = "ios" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _api.CreateClient().PostAsJsonAsync("/push/register", new { token = Token, platform = "ios" })).StatusCode);
    }

    [Fact]
    public async Task A_token_follows_the_account_that_registered_it_last()
    {
        using var a = await SignedInAsync("a@waken.test");
        using var b = await SignedInAsync("b@waken.test");
        await a.PostAsJsonAsync("/push/register", new { token = Token, platform = "ios", name = "iPhone" });
        await b.PostAsJsonAsync("/push/register", new { token = Token, platform = "ios", name = "iPhone" });
        await a.PostAsJsonAsync("/events/session-ended", new { game = "Hytale", seconds = 3600, streakDays = 1 });
        // Account A has no device any more: its recap reaches nobody (the token is B's now).
        using var scope = _api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CloudDb>();
        var device = Assert.Single(db.PushDevices);
        var bId = db.Users.Single(u => u.Email == "b@waken.test").Id;
        Assert.Equal(bId, device.UserId);
    }

    [Fact]
    public async Task A_finished_session_sends_a_recap()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var res = await client.PostAsJsonAsync("/events/session-ended", new { game = "Hytale", seconds = 4800, streakDays = 4 });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        var (_, message) = Assert.Single(Notifier.Sent);
        Assert.Equal("Fin de partie : Hytale", message.Title);
        Assert.Equal("1 h 20 de jeu. 4 jours de suite !", message.Body);
    }

    [Fact]
    public async Task A_session_under_a_minute_sends_nothing()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        await client.PostAsJsonAsync("/events/session-ended", new { game = "Hytale", seconds = 20, streakDays = 1 });
        Assert.Empty(Notifier.Sent);
    }

    [Fact]
    public async Task A_new_device_on_the_account_is_notified_to_its_owner_only()
    {
        using var a = await SignedInAsync("a@waken.test");
        using var b = await SignedInAsync("b@waken.test");
        var aUser = await HeadscaleUserIdAfterJoinAsync(a);
        await HeadscaleUserIdAfterJoinAsync(b);
        _headscale.AddNode(aUser, "waken-host-mac-de-enzo");
        await Watcher.CheckAsync(default);
        Assert.Empty(Notifier.Sent);

        _headscale.AddNode(aUser, "waken-ipad");
        await Watcher.CheckAsync(default);
        var (userId, message) = Assert.Single(Notifier.Sent);
        using var scope = _api.Services.CreateScope();
        Assert.Equal(scope.ServiceProvider.GetRequiredService<CloudDb>().Users.Single(u => u.Email == "a@waken.test").Id, userId);
        Assert.Equal("Nouvel appareil sur ton compte", message.Title);
        Assert.Contains("Ipad", message.Body);
    }

    [Fact]
    public async Task A_computer_back_online_is_ready_but_not_after_a_blip()
    {
        using var client = await SignedInAsync("enzo@waken.test");
        var mac = _headscale.AddNode(await HeadscaleUserIdAfterJoinAsync(client), "waken-host-mac-de-enzo");
        await Watcher.CheckAsync(default);

        _headscale.SetOnline(mac.Id, false);
        await Watcher.CheckAsync(default);
        Clock.Advance(TimeSpan.FromSeconds(30));
        _headscale.SetOnline(mac.Id, true);
        await Watcher.CheckAsync(default);
        Assert.Empty(Notifier.Sent);

        _headscale.SetOnline(mac.Id, false);
        await Watcher.CheckAsync(default);
        Clock.Advance(TimeSpan.FromMinutes(10));
        _headscale.SetOnline(mac.Id, true);
        await Watcher.CheckAsync(default);
        var (_, message) = Assert.Single(Notifier.Sent);
        Assert.Equal("Mac de enzo est prête", message.Title);
    }

    [Fact]
    public async Task Health_is_open()
    {
        using var client = _api.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
    }
}

public sealed class ManualClock : TimeProvider
{
    private DateTimeOffset _now = new(2026, 11, 23, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan by) => _now += by;
}
