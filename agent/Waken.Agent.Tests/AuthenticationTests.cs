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
}
