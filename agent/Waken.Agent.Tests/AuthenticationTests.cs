using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Waken.Agent.Tests;

public sealed class AuthenticationTests
{
    private const string ValidToken = "test-token-0123456789-abcdefghij";
    // Never an existing route: these tests must not be able to shut a machine down.
    private const string ProtectedPath = "/does-not-exist";

    private static WebApplicationFactory<Program> Agent(string token) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(host => host.UseSetting("Agent:Token", token));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("short")]
    [InlineData("change-me-change-me-change-me")]
    public void Refuses_to_start_with_an_unsafe_token(string token)
    {
        using var agent = Agent(token);
        Assert.ThrowsAny<Exception>(() => agent.CreateClient());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("wrong-token-0123456789-abcdefghi")]
    public async Task Rejects_a_missing_or_wrong_token(string? token)
    {
        using var agent = Agent(ValidToken);
        using var client = agent.CreateClient();
        if (token is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(ProtectedPath)).StatusCode);
    }

    [Fact]
    public async Task Accepts_the_configured_token()
    {
        using var agent = Agent(ValidToken);
        using var client = agent.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ValidToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(ProtectedPath)).StatusCode);
    }

    [Fact]
    public async Task Opens_a_game_picture_with_its_own_signature_only()
    {
        using var agent = Agent(ValidToken);
        using var client = agent.CreateClient();
        var signer = new BearerToken(ValidToken);
        // No such game here: 404 means the request got through, 401 that it was refused.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/games/steam%3A1/cover?sig={signer.SignArt("steam:1", "cover")}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/games/steam%3A1/cover")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/games/steam%3A1/hero?sig={signer.SignArt("steam:1", "cover")}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/games/steam%3A2/cover?sig={signer.SignArt("steam:1", "cover")}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/games/steam%3A1/cover?sig={new BearerToken("other-token-0123456789-abcdefgh").SignArt("steam:1", "cover")}")).StatusCode);
        // The signature opens the picture, never the rest of the agent.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/games?sig={signer.SignArt("steam:1", "cover")}")).StatusCode);
    }
}
