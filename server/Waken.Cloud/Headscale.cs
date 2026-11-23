using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Waken.Cloud;

/// <summary>
/// The parts of Headscale's REST API (v0.29, /api/v1) the accounts need. Headscale numbers its users and nodes
/// with uint64 that travel as JSON strings: they stay strings here.
/// </summary>
public interface IHeadscale
{
    Task<HeadscaleUser?> FindUserAsync(string name, CancellationToken ct);
    Task<HeadscaleUser> CreateUserAsync(string name, CancellationToken ct);
    Task DeleteUserAsync(string userId, CancellationToken ct);
    /// <summary>A single-use key that signs one device in to the user's network.</summary>
    Task<HeadscalePreAuthKey> CreatePreAuthKeyAsync(string userId, DateTimeOffset expiration, CancellationToken ct);
    /// <summary>The user's devices only, whatever Headscale's filter does with the name.</summary>
    Task<IReadOnlyList<HeadscaleNode>> ListNodesAsync(HeadscaleUser user, CancellationToken ct);
    /// <summary>Every node of every user (the network watcher sorts them by account).</summary>
    Task<IReadOnlyList<HeadscaleNode>> ListAllNodesAsync(CancellationToken ct);
    Task DeleteNodeAsync(string nodeId, CancellationToken ct);
}

public sealed record HeadscaleUser(string Id, string Name);

public sealed record HeadscalePreAuthKey(string Key, DateTimeOffset? Expiration);

public sealed record HeadscaleNode(
    string Id,
    string Name,
    string? GivenName,
    HeadscaleUser? User,
    bool Online,
    DateTimeOffset? LastSeen,
    string[]? IpAddresses);

/// <summary>Headscale answered with an error, or did not answer. Its message never goes back to the apps.</summary>
public sealed class HeadscaleException(string message, int? status = null) : Exception(message)
{
    public int? Status { get; } = status;
}

public sealed class HeadscaleClient(HttpClient http) : IHeadscale
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task<HeadscaleUser?> FindUserAsync(string name, CancellationToken ct)
    {
        var res = await SendAsync<UsersResponse>(HttpMethod.Get, $"user?name={Uri.EscapeDataString(name)}", null, ct);
        // The filter is Headscale's: check the name again rather than trust it.
        return res.Users?.FirstOrDefault(u => u.Name == name);
    }

    public async Task<HeadscaleUser> CreateUserAsync(string name, CancellationToken ct)
    {
        var res = await SendAsync<UserResponse>(HttpMethod.Post, "user", new { name }, ct);
        return res.User ?? throw new HeadscaleException("Headscale n'a pas renvoyé l'utilisateur créé");
    }

    public Task DeleteUserAsync(string userId, CancellationToken ct) =>
        SendAsync<JsonElement>(HttpMethod.Delete, $"user/{Uri.EscapeDataString(userId)}", null, ct);

    public async Task<HeadscalePreAuthKey> CreatePreAuthKeyAsync(string userId, DateTimeOffset expiration, CancellationToken ct)
    {
        var body = new { user = userId, reusable = false, ephemeral = false, expiration = expiration.UtcDateTime };
        var res = await SendAsync<PreAuthKeyResponse>(HttpMethod.Post, "preauthkey", body, ct);
        if (string.IsNullOrEmpty(res.PreAuthKey?.Key)) throw new HeadscaleException("Headscale n'a pas renvoyé de clé");
        return res.PreAuthKey;
    }

    public async Task<IReadOnlyList<HeadscaleNode>> ListNodesAsync(HeadscaleUser user, CancellationToken ct)
    {
        var res = await SendAsync<NodesResponse>(HttpMethod.Get, $"node?user={Uri.EscapeDataString(user.Name)}", null, ct);
        return (res.Nodes ?? []).Where(n => n.User?.Id == user.Id).ToList();
    }

    public async Task<IReadOnlyList<HeadscaleNode>> ListAllNodesAsync(CancellationToken ct) =>
        (await SendAsync<NodesResponse>(HttpMethod.Get, "node", null, ct)).Nodes ?? [];

    public Task DeleteNodeAsync(string nodeId, CancellationToken ct) =>
        SendAsync<JsonElement>(HttpMethod.Delete, $"node/{Uri.EscapeDataString(nodeId)}", null, ct);

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: Json);
        HttpResponseMessage res;
        try
        {
            res = await http.SendAsync(req, ct);
        }
        catch (HttpRequestException e)
        {
            throw new HeadscaleException($"Headscale injoignable : {e.Message}");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new HeadscaleException("Headscale ne répond pas");
        }
        using (res)
        {
            if (!res.IsSuccessStatusCode)
                throw new HeadscaleException($"Headscale {method} {path} : HTTP {(int)res.StatusCode}", (int)res.StatusCode);
            return await res.Content.ReadFromJsonAsync<T>(Json, ct) ?? throw new HeadscaleException("Réponse vide de Headscale");
        }
    }

    private sealed record UsersResponse(List<HeadscaleUser>? Users);
    private sealed record UserResponse(HeadscaleUser? User);
    private sealed record PreAuthKeyResponse(HeadscalePreAuthKey? PreAuthKey);
    private sealed record NodesResponse(List<HeadscaleNode>? Nodes);
}
