using Microsoft.EntityFrameworkCore;

namespace Waken.Cloud;

/// <summary>
/// Watches the network for what the accounts want to know, without any app open:
/// a new device on an account (a warning if it was not them), a computer coming online (ready to play).
/// </summary>
public sealed class NetworkWatcher(IHeadscale headscale, IServiceScopeFactory scopes, Notifier notifier, CloudOptions options, TimeProvider clock, ILogger<NetworkWatcher> log)
    : BackgroundService
{
    /// <summary>A computer offline for less than this is a blip, not "ready to play" again.</summary>
    public static readonly TimeSpan OfflineBeforeReady = TimeSpan.FromMinutes(2);

    private sealed record Seen(string UserId, bool Online, DateTimeOffset? OfflineSince);

    private Dictionary<string, Seen>? _seen;

    private readonly SemaphoreSlim _pass = new(1, 1);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // 0: off (tests drive the passes themselves).
        if (options.WatchSeconds <= 0) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.WatchSeconds), clock);
        do
        {
            try
            {
                await CheckAsync(ct);
            }
            catch (Exception e) when (e is HeadscaleException or DbUpdateException)
            {
                log.LogWarning("Surveillance du réseau : {Message}", e.Message);
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }

    /// <summary>One pass: compares the network with the previous pass and notifies the differences.</summary>
    public async Task CheckAsync(CancellationToken ct)
    {
        await _pass.WaitAsync(ct);
        try
        {
            await CheckOnceAsync(ct);
        }
        finally
        {
            _pass.Release();
        }
    }

    private async Task CheckOnceAsync(CancellationToken ct)
    {
        Dictionary<string, string> owners;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CloudDb>();
            owners = await db.Users.Where(u => u.HeadscaleUserId != null).ToDictionaryAsync(u => u.HeadscaleUserId!, u => u.Id, ct);
        }
        var now = clock.GetUtcNow();
        var next = new Dictionary<string, Seen>();
        foreach (var node in await headscale.ListAllNodesAsync(ct))
        {
            if (node.User is null || !owners.TryGetValue(node.User.Id, out var userId)) continue;
            var before = _seen?.GetValueOrDefault(node.Id);
            var offlineSince = node.Online ? null : before is { Online: false } ? before.OfflineSince : now;
            next[node.Id] = new Seen(userId, node.Online, offlineSince);
            // The first pass only learns the network: nothing is new yet.
            if (_seen is null) continue;
            var name = DeviceNames.Display(string.IsNullOrEmpty(node.GivenName) ? node.Name : node.GivenName);
            if (before is null || before.UserId != userId)
            {
                await notifier.NotifyAsync(userId, new PushMessage(
                    "Nouvel appareil sur ton compte",
                    $"{name} vient de rejoindre ton réseau Waken. Si ce n'est pas toi, retire-le dans Réglages.",
                    "device"), ct);
            }
            else if (node.Online && !before.Online && DeviceNames.IsHost(node.Name) && before.OfflineSince is { } since && now - since >= OfflineBeforeReady)
            {
                await notifier.NotifyAsync(userId, new PushMessage($"{name} est prête", "Ta machine est en ligne : lance un jeu quand tu veux.", "machine"), ct);
            }
        }
        _seen = next;
    }
}
