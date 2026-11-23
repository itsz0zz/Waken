using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Waken.Api.Tests;

public sealed class AuthenticationTests
{
    private const string ValidToken = "test-token-0123456789-abcdefghij";
    private const string StatusPath = "/devices/none/status";

    private static WebApplicationFactory<Program> Api(string token) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(host => host.UseSetting("Waken:Token", token));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("short")]
    [InlineData("change-me-change-me-change-me")]
    public void Refuses_to_start_with_an_unsafe_token(string token)
    {
        using var api = Api(token);
        Assert.ThrowsAny<Exception>(() => api.CreateClient());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("wrong-token-0123456789-abcdefghi")]
    public async Task Rejects_a_missing_or_wrong_token(string? token)
    {
        using var api = Api(ValidToken);
        using var client = api.CreateClient();
        if (token is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(StatusPath)).StatusCode);
    }

    [Fact]
    public async Task Rejects_a_token_in_the_query_string()
    {
        using var api = Api(ValidToken);
        using var client = api.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"{StatusPath}?token={ValidToken}")).StatusCode);
    }

    [Fact]
    public async Task Accepts_the_configured_token()
    {
        using var api = Api(ValidToken);
        using var client = api.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ValidToken);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(StatusPath)).StatusCode);
    }

    [Fact]
    public async Task Health_stays_open()
    {
        using var api = Api(ValidToken);
        using var client = api.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
    }
}
