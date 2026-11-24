using System.Net;
using Waken.Agent.Host;

namespace Waken.Agent.Tests;

public sealed class WakeOnLanTests
{
    [Theory]
    [InlineData("AA:BB:CC:DD:EE:FF")]
    [InlineData("aa-bb-cc-dd-ee-ff")]
    [InlineData("aabbccddeeff")]
    public void The_magic_packet_is_six_ff_then_the_card_sixteen_times(string mac)
    {
        var packet = WakeOnLan.MagicPacket(mac);

        Assert.Equal(102, packet.Length);
        Assert.All(packet[..6], b => Assert.Equal(0xFF, b));
        for (var i = 0; i < 16; i++) Assert.Equal(new byte[] { 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF }, packet[(6 + i * 6)..(12 + i * 6)]);
    }

    [Theory]
    [InlineData("AA:BB:CC")]
    [InlineData("pas une adresse")]
    public void A_bad_card_address_is_refused(string mac) => Assert.Throws<ArgumentException>(() => WakeOnLan.MagicPacket(mac));

    [Theory]
    [InlineData("192.168.1.42", "255.255.255.0", "192.168.1.255")]
    [InlineData("10.0.3.7", "255.255.0.0", "10.0.255.255")]
    [InlineData("192.168.1.42", null, "192.168.1.255")]
    public void The_network_s_broadcast_follows_its_mask(string address, string? mask, string expected) =>
        Assert.Equal(expected, WakeOnLan.Broadcast(IPAddress.Parse(address), mask is null ? null : IPAddress.Parse(mask)).ToString());

    [Theory]
    [InlineData("192.168.1.42", true)]
    [InlineData("10.1.2.3", true)]
    [InlineData("172.20.0.1", true)]
    [InlineData("100.101.102.103", false)] // the Waken network
    [InlineData("8.8.8.8", false)]
    public void Only_a_home_address_names_the_card(string address, bool home) => Assert.Equal(home, WakeOnLan.IsHome(IPAddress.Parse(address)));
}
