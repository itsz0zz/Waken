package tunnel

import (
	"context"
	"encoding/json"
	"strings"
	"io"
	"net"
	"strconv"
	"testing"
	"time"
)

var (
	plainListen       = func(network, address string) (net.Listener, error) { return net.Listen(network, address) }
	plainListenPacket = func(network, address string) (net.PacketConn, error) { return net.ListenPacket(network, address) }
	plainDial         = (&net.Dialer{}).DialContext
)

func freePort(t *testing.T, network string) int {
	t.Helper()
	if network == "udp" {
		pc, err := net.ListenPacket("udp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer pc.Close()
		return pc.LocalAddr().(*net.UDPAddr).Port
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// The forwarder listens on one loopback address and sends to the same port on another: 127.0.0.1 to 127.0.0.2
// would need an alias on macOS, so the target is reached through "localhost" on [::1] instead.
func TestForwardTCPCarriesBothWays(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	port := freePort(t, "tcp")
	echo, err := net.Listen("tcp", net.JoinHostPort("::1", strconv.Itoa(port)))
	if err != nil {
		t.Skip("no IPv6 loopback:", err)
	}
	defer echo.Close()
	go func() {
		c, err := echo.Accept()
		if err == nil {
			io.Copy(c, c)
			c.Close()
		}
	}()
	if err := forwardTCP(ctx, plainListen, net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), plainDial, func() string { return "::1" }, port, nil); err != nil {
		t.Fatal(err)
	}

	c, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write([]byte("rtsp"))
	buf := make([]byte, 4)
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.ReadFull(c, buf); err != nil || string(buf) != "rtsp" {
		t.Fatalf("got %q, %v", buf, err)
	}
}

func TestForwardTCPRefusesStrangersAndWaitsForAPeer(t *testing.T) {
	for name, tc := range map[string]struct {
		target string
		allow  allowFunc
	}{
		"not the owner": {"::1", func(net.Addr) bool { return false }},
		"no host chosen": {"", nil},
	} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			port := freePort(t, "tcp")
			dialed := make(chan struct{}, 1)
			dial := func(ctx context.Context, network, address string) (net.Conn, error) {
				dialed <- struct{}{}
				return plainDial(ctx, network, address)
			}
			if err := forwardTCP(ctx, plainListen, net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), dial, func() string { return tc.target }, port, tc.allow); err != nil {
				t.Fatal(err)
			}
			c, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			c.SetReadDeadline(time.Now().Add(2 * time.Second))
			if _, err := c.Read(make([]byte, 1)); err == nil {
				t.Fatal("connection should be closed")
			}
			select {
			case <-dialed:
				t.Fatal("must not reach the target")
			default:
			}
		})
	}
}

// Sunshine answers each sender on its own socket: two clients must each get their own replies.
func TestForwardUDPKeepsOneFlowPerSender(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	port := freePort(t, "udp")
	server, err := net.ListenPacket("udp", net.JoinHostPort("::1", strconv.Itoa(port)))
	if err != nil {
		t.Skip("no IPv6 loopback:", err)
	}
	defer server.Close()
	go func() {
		buf := make([]byte, 1500)
		for {
			n, from, err := server.ReadFrom(buf)
			if err != nil {
				return
			}
			server.WriteTo(append([]byte("ack:"), buf[:n]...), from)
		}
	}()
	if err := forwardUDP(ctx, plainListenPacket, net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), plainDial, func() string { return "::1" }, port, nil); err != nil {
		t.Fatal(err)
	}

	for _, msg := range []string{"video", "audio"} {
		c, err := net.Dial("udp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		c.Write([]byte(msg))
		buf := make([]byte, 64)
		c.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, err := c.Read(buf)
		if err != nil || string(buf[:n]) != "ack:"+msg {
			t.Fatalf("%s: got %q, %v", msg, buf[:n], err)
		}
	}
}

func TestStatusAlwaysListsHosts(t *testing.T) {
	tun := &Tunnel{}
	b, err := json.Marshal(tun.Status())
	if err != nil || !strings.Contains(string(b), `"hosts":[]`) {
		t.Fatalf("hosts must be an empty list, got %s", b)
	}
}

func TestHostnameFor(t *testing.T) {
	for _, tc := range []struct{ role, name, want string }{
		{RoleHost, "Mac de Enzo", "waken-host-mac-de-enzo"},
		{RoleClient, "iPhone d'Enzo", "waken-iphone-d-enzo"},
		{RoleHost, "PC Gaming ★", "waken-host-pc-gaming"},
		{RoleClient, "", "waken-device"},
	} {
		if got := HostnameFor(tc.role, tc.name); got != tc.want {
			t.Errorf("HostnameFor(%q, %q) = %q, want %q", tc.role, tc.name, got, tc.want)
		}
	}
}

func TestStartRejectsAHostWithoutToken(t *testing.T) {
	if _, err := Start(Config{Role: RoleHost, Dir: t.TempDir(), Name: "Mac"}); err == nil {
		t.Fatal("a host must refuse to start without the agent token")
	}
	if _, err := Start(Config{Role: "server", Dir: t.TempDir()}); err == nil {
		t.Fatal("unknown role must fail")
	}
}

func TestSplitHostPath(t *testing.T) {
	for _, tc := range []struct{ in, host, rest string }{
		{"/h/waken-host-mac/games/mac%3Ax/cover", "waken-host-mac", "/games/mac%3Ax/cover"},
		{"/h/waken-host-mac", "waken-host-mac", "/"},
		{"/games", "", "/games"},
	} {
		host, rest := splitHostPath(tc.in)
		if host != tc.host || rest != tc.rest {
			t.Errorf("splitHostPath(%q) = %q, %q", tc.in, host, rest)
		}
	}
}

func TestClientsReachAgentsThroughTheProxyOnly(t *testing.T) {
	for _, p := range streamTCPPorts() {
		if p == AgentPort {
			t.Fatal("the agent port must not follow the stream peer")
		}
	}
}

func TestStateDirFor(t *testing.T) {
	if got := StateDirFor("/s", ""); got != "/s" {
		t.Fatalf("Tailscale: %q", got)
	}
	if got := StateDirFor("/s", "https://net.wakenplay.fr"); got != "/s/net-net-wakenplay-fr" {
		t.Fatalf("Waken: %q", got)
	}
	if got := StateDirFor("/s", "https://net.wakenplay.fr:443/"); got != "/s/net-net-wakenplay-fr-443" {
		t.Fatalf("port: %q", got)
	}
}

func TestComputersPlayOnTheIPv6Loopback(t *testing.T) {
	host := &Tunnel{cfg: Config{Role: RoleHost, Bind: "127.0.0.1", PlayBind: "::1"}}
	if err := host.SetPeer("100.64.0.2"); err == nil {
		t.Fatal("a computer cannot choose a peer before its stream ports are forwarded")
	}
	if host.Status().Play != "" {
		t.Fatal("no play address before the forwarding")
	}
	host.playing = true
	if got := host.Status().Play; got != "::1" {
		t.Fatalf("a computer plays on ::1 (its Sunshine holds 127.0.0.1), got %q", got)
	}
	client := &Tunnel{cfg: Config{Role: RoleClient, Bind: "127.0.0.1"}, playing: true}
	if got := client.Status().Play; got != "127.0.0.1" {
		t.Fatalf("a client plays on 127.0.0.1, got %q", got)
	}
}

func TestForwardTCPOnTheIPv6Loopback(t *testing.T) {
	ln, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skip("no IPv6 loopback here")
	}
	ln.Close()
	echo, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	go func() {
		c, err := echo.Accept()
		if err == nil {
			io.Copy(c, c)
			c.Close()
		}
	}()
	port := echo.Addr().(*net.TCPAddr).Port
	free, _ := net.Listen("tcp", "[::1]:0")
	listenAddr := free.Addr().String()
	free.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	listen := func(network, address string) (net.Listener, error) { return net.Listen(network, address) }
	if err := forwardTCP(ctx, listen, listenAddr, (&net.Dialer{}).DialContext, func() string { return "127.0.0.1" }, port, nil); err != nil {
		t.Fatal(err)
	}
	c, err := net.Dial("tcp", listenAddr)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write([]byte("ping"))
	buf := make([]byte, 4)
	if _, err := io.ReadFull(c, buf); err != nil || string(buf) != "ping" {
		t.Fatalf("got %q, %v", buf, err)
	}
}
