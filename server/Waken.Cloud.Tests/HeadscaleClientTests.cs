using System.Net;
using System.Text;
using System.Text.Json;

namespace Waken.Cloud.Tests;

/// <summary>The exact requests Headscale v0.29 expects (gen/openapiv2/headscale/v1/headscale.swagger.json).</summary>
public sealed class HeadscaleClientTests
{
    private sealed class Recorder(Func<HttpRequestMessage, string> answer, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public List<(HttpMethod Method, string Url, string? Body, string? Auth)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            Calls.Add((request.Method, request.RequestUri!.ToString(), body, request.Headers.Authorization?.ToString()));
            return new HttpResponseMessage(status) { Content = new StringContent(answer(request), Encoding.UTF8, "application/json") };
        }
    }

    private static (HeadscaleClient, Recorder) Client(Func<HttpRequestMessage, string> answer, HttpStatusCode status = HttpStatusCode.OK)
    {
        var rec = new Recorder(answer, status);
        var http = new HttpClient(rec) { BaseAddress = new Uri("http://headscale.test:8080/api/v1/") };
        http.DefaultRequestHeaders.Authorization = new("Bearer", "hs-key");
        return (new HeadscaleClient(http), rec);
    }

    [Fact]
    public async Task Pre_auth_key_names_the_user_by_its_id_as_a_string_and_is_single_use()
    {
        var (client, rec) = Client(_ => """{"preAuthKey":{"user":{"id":"7","name":"waken-x"},"id":"3","key":"abc123","reusable":false,"ephemeral":false,"used":false,"expiration":"2026-11-23T15:10:00Z"}}""");
        var key = await client.CreatePreAuthKeyAsync("7", new DateTimeOffset(2026, 11, 23, 15, 10, 0, TimeSpan.Zero), default);

        Assert.Equal("abc123", key.Key);
        var call = Assert.Single(rec.Calls);
        Assert.Equal(HttpMethod.Post, call.Method);
        Assert.Equal("http://headscale.test:8080/api/v1/preauthkey", call.Url);
        Assert.Equal("Bearer hs-key", call.Auth);
        var body = JsonDocument.Parse(call.Body!).RootElement;
        Assert.Equal(JsonValueKind.String, body.GetProperty("user").ValueKind);
        Assert.Equal("7", body.GetProperty("user").GetString());
        Assert.False(body.GetProperty("reusable").GetBoolean());
        Assert.False(body.GetProperty("ephemeral").GetBoolean());
        Assert.Equal("2026-11-23T15:10:00Z", body.GetProperty("expiration").GetString());
    }

    [Fact]
    public async Task Find_user_checks_the_name_again()
    {
        var (client, rec) = Client(_ => """{"users":[{"id":"1","name":"waken-autre"},{"id":"2","name":"waken-moi"}]}""");
        var user = await client.FindUserAsync("waken-moi", default);
        Assert.Equal(new HeadscaleUser("2", "waken-moi"), user);
        Assert.Equal("http://headscale.test:8080/api/v1/user?name=waken-moi", rec.Calls[0].Url);
        Assert.Null(await client.FindUserAsync("waken-absent", default));
    }

    [Fact]
    public async Task Create_user_sends_only_its_name()
    {
        var (client, rec) = Client(_ => """{"user":{"id":"9","name":"waken-abc"}}""");
        Assert.Equal("9", (await client.CreateUserAsync("waken-abc", default)).Id);
        Assert.Equal("""{"name":"waken-abc"}""", rec.Calls[0].Body);
    }

    [Fact]
    public async Task List_nodes_keeps_the_user_s_nodes_only()
    {
        var (client, _) = Client(_ => """
            {"nodes":[
              {"id":"1","name":"waken-host-mac","givenName":"waken-host-mac","user":{"id":"7","name":"waken-moi"},"online":true,"ipAddresses":["100.64.0.1"],"lastSeen":"2026-11-23T14:00:00Z"},
              {"id":"2","name":"waken-host-pc","user":{"id":"8","name":"waken-autre"},"online":true}
            ]}
            """);
        var nodes = await client.ListNodesAsync(new HeadscaleUser("7", "waken-moi"), default);
        var node = Assert.Single(nodes);
        Assert.Equal("1", node.Id);
        Assert.True(node.Online);
        Assert.Equal("100.64.0.1", node.IpAddresses![0]);
    }

    [Fact]
    public async Task Delete_node_uses_its_id_in_the_path()
    {
        var (client, rec) = Client(_ => "{}");
        await client.DeleteNodeAsync("42", default);
        Assert.Equal(HttpMethod.Delete, rec.Calls[0].Method);
        Assert.Equal("http://headscale.test:8080/api/v1/node/42", rec.Calls[0].Url);
    }

    [Fact]
    public async Task An_error_status_becomes_a_headscale_exception()
    {
        var (client, _) = Client(_ => """{"code":16,"message":"Unauthorized"}""", HttpStatusCode.Unauthorized);
        var e = await Assert.ThrowsAsync<HeadscaleException>(() => client.CreateUserAsync("x", default));
        Assert.Equal(401, e.Status);
    }
}
