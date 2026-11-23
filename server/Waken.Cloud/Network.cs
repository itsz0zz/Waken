using Microsoft.AspNetCore.Identity;

namespace Waken.Cloud;

/// <summary>What the apps need to start the Waken network: where it is and a key for this device.</summary>
public sealed record JoinTicket(string ControlUrl, string AuthKey, DateTimeOffset ExpiresAt);

/// <summary>One of the account's devices, as the apps show it.</summary>
public sealed record AccountDevice(string Id, string Name, bool Online, DateTimeOffset? LastSeen, string? Ip);

public sealed class TooManyDevicesException() : Exception("Trop d'appareils sur ce compte");

/// <summary>An account's devices on the Waken network (Headscale behind).</summary>
public sealed class NetworkService(IHeadscale headscale, UserManager<WakenUser> users, CloudOptions options, TimeProvider clock)
{
    /// <summary>A single-use key, short-lived, that signs one more device in to the account's network.</summary>
    public async Task<JoinTicket> JoinAsync(WakenUser user, CancellationToken ct)
    {
        var hsUser = await EnsureHeadscaleUserAsync(user, ct);
        if ((await headscale.ListNodesAsync(hsUser, ct)).Count >= options.MaxDevices) throw new TooManyDevicesException();
        var expires = clock.GetUtcNow().AddMinutes(options.JoinKeyMinutes);
        var key = await headscale.CreatePreAuthKeyAsync(hsUser.Id, expires, ct);
        return new JoinTicket(options.ControlUrl, key.Key, key.Expiration ?? expires);
    }

    public async Task<IReadOnlyList<AccountDevice>> DevicesAsync(WakenUser user, CancellationToken ct)
    {
        if (user.HeadscaleUserId is null) return [];
        var nodes = await headscale.ListNodesAsync(new HeadscaleUser(user.HeadscaleUserId, user.HeadscaleUserName), ct);
        return nodes
            .Select(n => new AccountDevice(n.Id, string.IsNullOrEmpty(n.GivenName) ? n.Name : n.GivenName, n.Online, n.LastSeen, n.IpAddresses?.FirstOrDefault()))
            .OrderBy(d => d.Name, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Takes a device off the account (lost phone, sold PC). False when it is not one of the account's.</summary>
    public async Task<bool> RemoveDeviceAsync(WakenUser user, string nodeId, CancellationToken ct)
    {
        if (user.HeadscaleUserId is null) return false;
        var nodes = await headscale.ListNodesAsync(new HeadscaleUser(user.HeadscaleUserId, user.HeadscaleUserName), ct);
        if (nodes.All(n => n.Id != nodeId)) return false;
        await headscale.DeleteNodeAsync(nodeId, ct);
        return true;
    }

    /// <summary>Every device off the network, then the Headscale user. The account itself is the caller's to delete.</summary>
    public async Task ForgetAsync(WakenUser user, ILogger logger, CancellationToken ct)
    {
        if (user.HeadscaleUserId is null) return;
        var hsUser = new HeadscaleUser(user.HeadscaleUserId, user.HeadscaleUserName);
        foreach (var node in await headscale.ListNodesAsync(hsUser, ct))
            await headscale.DeleteNodeAsync(node.Id, ct);
        try
        {
            await headscale.DeleteUserAsync(hsUser.Id, ct);
        }
        catch (HeadscaleException e)
        {
            // Its devices are gone and its name came from a deleted account: an empty user left behind harms nobody.
            logger.LogWarning("Utilisateur Headscale {Id} non supprimé : {Message}", hsUser.Id, e.Message);
        }
    }

    private async Task<HeadscaleUser> EnsureHeadscaleUserAsync(WakenUser user, CancellationToken ct)
    {
        if (user.HeadscaleUserId is not null) return new HeadscaleUser(user.HeadscaleUserId, user.HeadscaleUserName);
        var name = user.HeadscaleUserName;
        HeadscaleUser hsUser;
        try
        {
            hsUser = await headscale.FindUserAsync(name, ct) ?? await headscale.CreateUserAsync(name, ct);
        }
        catch (HeadscaleException)
        {
            // Two devices joining at the same moment: the other one created it in between.
            hsUser = await headscale.FindUserAsync(name, ct) ?? throw new HeadscaleException("Utilisateur Headscale introuvable après création");
        }
        user.HeadscaleUserId = hsUser.Id;
        var saved = await users.UpdateAsync(user);
        if (!saved.Succeeded)
        {
            // Another device of the account saved it first (same user, its concurrency stamp won): theirs is ours.
            var fresh = await users.FindByIdAsync(user.Id);
            if (fresh?.HeadscaleUserId != hsUser.Id)
                throw new InvalidOperationException("Compte non enregistré : " + string.Join(", ", saved.Errors.Select(e => e.Code)));
            user.HeadscaleUserId = fresh.HeadscaleUserId;
        }
        return hsUser;
    }
}
