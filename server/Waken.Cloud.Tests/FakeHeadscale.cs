using System.Collections.Concurrent;

namespace Waken.Cloud.Tests;

/// <summary>Headscale in memory: users, single-use keys and nodes, with an id counter like the real one.</summary>
public sealed class FakeHeadscale : IHeadscale
{
    private int _next = 1;
    public ConcurrentDictionary<string, HeadscaleUser> Users { get; } = new();
    public ConcurrentQueue<(string UserId, string Key, DateTimeOffset Expiration)> Keys { get; } = new();
    public ConcurrentDictionary<string, HeadscaleNode> Nodes { get; } = new();
    public bool Down { get; set; }
    public int UsersCreated;

    private string NextId() => Interlocked.Increment(ref _next).ToString();

    private void Check()
    {
        if (Down) throw new HeadscaleException("Headscale injoignable : test");
    }

    public Task<HeadscaleUser?> FindUserAsync(string name, CancellationToken ct)
    {
        Check();
        return Task.FromResult(Users.Values.FirstOrDefault(u => u.Name == name));
    }

    public Task<HeadscaleUser> CreateUserAsync(string name, CancellationToken ct)
    {
        Check();
        if (Users.Values.Any(u => u.Name == name)) throw new HeadscaleException("exists", 500);
        var user = new HeadscaleUser(NextId(), name);
        Users[user.Id] = user;
        Interlocked.Increment(ref UsersCreated);
        return Task.FromResult(user);
    }

    public Task DeleteUserAsync(string userId, CancellationToken ct)
    {
        Check();
        Users.TryRemove(userId, out _);
        return Task.CompletedTask;
    }

    public Task<HeadscalePreAuthKey> CreatePreAuthKeyAsync(string userId, DateTimeOffset expiration, CancellationToken ct)
    {
        Check();
        var key = "hskey-" + Guid.NewGuid().ToString("N");
        Keys.Enqueue((userId, key, expiration));
        return Task.FromResult(new HeadscalePreAuthKey(key, expiration));
    }

    public Task<IReadOnlyList<HeadscaleNode>> ListNodesAsync(HeadscaleUser user, CancellationToken ct)
    {
        Check();
        return Task.FromResult<IReadOnlyList<HeadscaleNode>>(Nodes.Values.Where(n => n.User?.Id == user.Id).ToList());
    }

    public Task<IReadOnlyList<HeadscaleNode>> ListAllNodesAsync(CancellationToken ct)
    {
        Check();
        return Task.FromResult<IReadOnlyList<HeadscaleNode>>(Nodes.Values.ToList());
    }

    public void SetOnline(string nodeId, bool online) => Nodes[nodeId] = Nodes[nodeId] with { Online = online };

    public Task DeleteNodeAsync(string nodeId, CancellationToken ct)
    {
        Check();
        Nodes.TryRemove(nodeId, out _);
        return Task.CompletedTask;
    }

    /// <summary>What a device signing in with one of the user's keys leaves in Headscale.</summary>
    public HeadscaleNode AddNode(string userId, string name, bool online = true)
    {
        var node = new HeadscaleNode(NextId(), name, null, Users[userId], online, DateTimeOffset.UtcNow, ["100.64.0." + _next]);
        Nodes[node.Id] = node;
        return node;
    }
}
