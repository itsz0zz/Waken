using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Waken.Cloud;

/// <summary>A Waken account. Its devices live in Headscale, under the Headscale user it owns.</summary>
public sealed class WakenUser : IdentityUser
{
    /// <summary>Set the first time a device joins: the account's user in Headscale.</summary>
    public string? HeadscaleUserId { get; set; }

    /// <summary>The Headscale user's name, derived from the account id: no e-mail in the network.</summary>
    public string HeadscaleUserName => "waken-" + Id.Replace("-", "").ToLowerInvariant();
}

public sealed class CloudDb(DbContextOptions<CloudDb> options) : IdentityDbContext<WakenUser>(options)
{
    public DbSet<PushDevice> PushDevices => Set<PushDevice>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<PushDevice>(e =>
        {
            // One row per token: a phone moving to another account takes its notifications with it.
            e.HasIndex(d => d.Token).IsUnique();
            e.HasIndex(d => d.UserId);
            e.Property(d => d.Token).HasMaxLength(200);
            e.Property(d => d.Name).HasMaxLength(80);
            e.Property(d => d.Platform).HasMaxLength(10);
        });
    }
}

public sealed class CloudOptions
{
    /// <summary>Where Headscale's API answers this service (inside the stack: http://headscale:8080).</summary>
    public string HeadscaleUrl { get; set; } = "";
    /// <summary>A Headscale API key (headscale apikeys create). Never sent to the apps.</summary>
    public string HeadscaleApiKey { get; set; } = "";
    /// <summary>Headscale's public address, the one the devices use (https://net.wakenplay.fr).</summary>
    public string ControlUrl { get; set; } = "";
    /// <summary>The database and the token signing keys.</summary>
    public string DataDir { get; set; } = "/data";
    /// <summary>A device key is good for this long: enough to start the network, too short to be worth stealing.</summary>
    public int JoinKeyMinutes { get; set; } = 10;
    /// <summary>Sign-in, sign-up and refresh calls per minute and per address.</summary>
    public int AuthRequestsPerMinute { get; set; } = 10;
    /// <summary>Network calls (join, devices) per minute and per account.</summary>
    public int NetworkRequestsPerMinute { get; set; } = 30;
    /// <summary>Devices on one account: plenty for a household, a wall against a runaway client.</summary>
    public int MaxDevices { get; set; } = 20;
    /// <summary>How often the network is checked for new devices and computers coming online.</summary>
    public int WatchSeconds { get; set; } = 30;
    /// <summary>Apple Push Notification service; empty: notifications are only logged.</summary>
    public ApnsOptions Apns { get; set; } = new();
    /// <summary>Behind the homelab's reverse proxy: take the client address from X-Forwarded-For.</summary>
    public bool TrustForwardedHeaders { get; set; }

    public void Validate()
    {
        if (!Uri.TryCreate(HeadscaleUrl, UriKind.Absolute, out var api) || api.Scheme is not ("http" or "https"))
            throw new InvalidOperationException("Cloud:HeadscaleUrl doit être une adresse http(s) complète");
        if (!Uri.TryCreate(ControlUrl, UriKind.Absolute, out var control) || control.Scheme is not ("http" or "https"))
            throw new InvalidOperationException("Cloud:ControlUrl doit être une adresse http(s) complète");
        if (string.IsNullOrWhiteSpace(HeadscaleApiKey) || HeadscaleApiKey.Length < 20)
            throw new InvalidOperationException("Cloud:HeadscaleApiKey manquant (headscale apikeys create)");
        if (JoinKeyMinutes is < 1 or > 60)
            throw new InvalidOperationException("Cloud:JoinKeyMinutes doit être entre 1 et 60");
    }
}
