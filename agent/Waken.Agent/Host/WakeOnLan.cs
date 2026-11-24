using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;

namespace Waken.Agent.Host;

/// <summary>
/// What another device needs to wake this computer with a magic packet, kept on the account's server with the
/// library (it must be known while the computer is off): its network card, its address and its network's broadcast,
/// and the home's public address (a port forwarded on the box to this computer reaches it from the Internet).
/// </summary>
public sealed record WakeInfo(string Mac, string Address, string Broadcast, string? PublicAddress);

/// <summary>Wakes the computer with this card, through these addresses as well as this network's broadcast.</summary>
public sealed record WakeRequest(string Mac, string[]? Targets = null);

public sealed class WakeOnLan(IHttpClientFactory http, AgentOptions options, ILogger<WakeOnLan> log)
{
    /// <summary>The usual port: what the network card listens to does not matter, the box forwards this one.</summary>
    public const int Port = 9;
    public const string HttpClientName = "cloud-ipv4";
    private static readonly TimeSpan PublicAddressAge = TimeSpan.FromMinutes(15);

    private string? _publicAddress;
    private DateTime _publicAddressAt = DateTime.MinValue;

    public async Task<WakeInfo?> InfoAsync(CancellationToken ct)
    {
        if (LocalCard() is not { } card) return null;
        return card with { PublicAddress = await PublicAddressAsync(ct) };
    }

    /// <summary>
    /// The card that reaches the box: up, with a real hardware address and a private IPv4 address (not the Waken
    /// network's 100.64/10), wired before Wi-Fi (most cards only wake on the wire).
    /// </summary>
    public static WakeInfo? LocalCard()
    {
        var candidates = new List<(NetworkInterface Card, UnicastIPAddressInformation Address, bool Gateway)>();
        foreach (var card in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (card.OperationalStatus != OperationalStatus.Up || card.GetPhysicalAddress().GetAddressBytes().Length != 6) continue;
            if (card.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel or NetworkInterfaceType.Ppp) continue;
            IPInterfaceProperties properties;
            try
            {
                properties = card.GetIPProperties();
            }
            catch (NetworkInformationException)
            {
                continue;
            }
            var address = properties.UnicastAddresses.FirstOrDefault(a => a.Address.AddressFamily == AddressFamily.InterNetwork && IsHome(a.Address));
            if (address is null) continue;
            var gateway = false;
            try
            {
                gateway = properties.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
            }
            catch (PlatformNotSupportedException)
            {
                // Not reported here: the private address decides.
            }
            candidates.Add((card, address, gateway));
        }
        var best = candidates
            .OrderBy(c => c.Gateway ? 0 : 1)
            .ThenBy(c => c.Card.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? 1 : 0)
            .FirstOrDefault();
        if (best.Card is null) return null;
        var mac = string.Join(':', best.Card.GetPhysicalAddress().GetAddressBytes().Select(b => b.ToString("X2")));
        return new WakeInfo(mac, best.Address.Address.ToString(), Broadcast(best.Address.Address, best.Address.IPv4Mask).ToString(), null);
    }

    /// <summary>A home network's address: 10/8, 172.16/12, 192.168/16.</summary>
    public static bool IsHome(IPAddress address)
    {
        var b = address.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
    }

    public static IPAddress Broadcast(IPAddress address, IPAddress? mask)
    {
        var a = address.GetAddressBytes();
        // Without a mask, the usual home /24.
        var m = mask is { AddressFamily: AddressFamily.InterNetwork } && !mask.Equals(IPAddress.Any) ? mask.GetAddressBytes() : [255, 255, 255, 0];
        return new IPAddress(a.Select((x, i) => (byte)(x | ~m[i])).ToArray());
    }

    /// <summary>6 bytes 0xFF, then the card's address 16 times.</summary>
    public static byte[] MagicPacket(string mac)
    {
        var hex = new string(mac.Where(Uri.IsHexDigit).ToArray());
        if (hex.Length != 12) throw new ArgumentException("Adresse matérielle invalide", nameof(mac));
        var card = Convert.FromHexString(hex);
        var packet = new byte[6 + 16 * 6];
        Array.Fill(packet, (byte)0xFF, 0, 6);
        for (var i = 0; i < 16; i++) card.CopyTo(packet, 6 + i * 6);
        return packet;
    }

    /// <summary>
    /// The packet on every way that may reach the computer: this network's broadcast (the computer is on the same one)
    /// and the addresses given (another network's broadcast, the computer's own address, the home's public address).
    /// </summary>
    public async Task<int> SendAsync(WakeRequest request, CancellationToken ct)
    {
        var packet = MagicPacket(request.Mac);
        var targets = new List<IPAddress> { IPAddress.Broadcast };
        if (LocalCard() is { } here) targets.Add(IPAddress.Parse(here.Broadcast));
        foreach (var target in request.Targets ?? [])
        {
            if (IPAddress.TryParse(target, out var address) && address.AddressFamily == AddressFamily.InterNetwork) targets.Add(address);
        }
        using var udp = new UdpClient(AddressFamily.InterNetwork) { EnableBroadcast = true };
        var sent = 0;
        foreach (var target in targets.Distinct())
        {
            try
            {
                await udp.SendAsync(packet, new IPEndPoint(target, Port), ct);
                sent++;
            }
            catch (SocketException e)
            {
                log.LogInformation("Paquet de réveil vers {Target} non envoyé : {Message}", target, e.Message);
            }
        }
        return sent;
    }

    /// <summary>The home's IPv4 address as the account's server sees it: the address a box forwards a port from.</summary>
    private async Task<string?> PublicAddressAsync(CancellationToken ct)
    {
        if (_publicAddress is not null && DateTime.UtcNow - _publicAddressAt < PublicAddressAge) return _publicAddress;
        if (string.IsNullOrWhiteSpace(options.CloudUrl)) return null;
        try
        {
            using var client = http.CreateClient(HttpClientName);
            using var json = JsonDocument.Parse(await client.GetStringAsync($"{options.CloudUrl.TrimEnd('/')}/network/address", ct));
            var address = json.RootElement.GetProperty("address").GetString();
            if (IPAddress.TryParse(address, out var parsed) && parsed.AddressFamily == AddressFamily.InterNetwork)
            {
                _publicAddress = parsed.ToString();
                _publicAddressAt = DateTime.UtcNow;
            }
        }
        catch (Exception e) when (e is HttpRequestException or JsonException or TaskCanceledException or KeyNotFoundException or InvalidOperationException && !ct.IsCancellationRequested)
        {
            log.LogInformation("Adresse publique inconnue : {Message}", e.Message);
        }
        return _publicAddress;
    }

    /// <summary>IPv4 only: over IPv6 the server would see this computer's own address, not the box's.</summary>
    public static SocketsHttpHandler Ipv4Handler() => new()
    {
        ConnectCallback = async (context, ct) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, AddressFamily.InterNetwork, ct);
            var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };
}
