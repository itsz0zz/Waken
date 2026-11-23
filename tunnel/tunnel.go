// Package tunnel is Waken's private network, built into the apps: an embedded Tailscale node (tsnet)
// that carries the stream between the user's own devices, from anywhere, with nothing else to install.
//
// A host (the Mac or PC that streams) exposes Sunshine and the Waken agent to the owner's other devices only.
// A client (iPhone, iPad, Android) forwards the same ports from 127.0.0.1 to the chosen host, so the stream
// code connects to 127.0.0.1 exactly as it does on a local network.
//
// A computer is a host and plays too: its own Sunshine already holds those ports on 127.0.0.1, so it forwards
// them from the IPv6 loopback instead (PlayBind, "::1"). Same port numbers, another address: the stream code
// connects to ::1 and reaches the chosen computer, as moonlight takes the ports Sunshine announces as they are.
package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
)

const (
	RoleHost   = "host"
	RoleClient = "client"

	// HostPrefix marks the nodes that stream: clients list them as the user's computers.
	HostPrefix   = "waken-host-"
	clientPrefix = "waken-"
	// HelloPort answers who the host is and hands its agent token to the owner's devices.
	HelloPort = 47101
	// AgentPort is the Waken agent on a host.
	AgentPort = 47100
	// ProxyPort is where a client reaches any host's agent: http://127.0.0.1:47102/h/<host name>/games.
	// The stream ports follow one chosen host (SetPeer); agent calls name their host in the URL.
	ProxyPort = 47102
)

// States reported to the apps.
const (
	StateStarting   = "starting"
	StateNeedsLogin = "needs-login"
	StateRunning    = "running"
	StateStopped    = "stopped"
	StateError      = "error"
)

type Config struct {
	Role string `json:"role"`
	// Dir keeps the node's identity: signing in is needed once per device.
	Dir string `json:"dir"`
	// Name is the device's own name ("Mac de Enzo"), shown on the other devices.
	Name string `json:"name"`
	// ControlURL is the coordination server; empty means Tailscale's.
	ControlURL string `json:"controlUrl,omitempty"`
	// AuthKey signs the device in without a web page: a single-use key from the Waken accounts (Headscale).
	// Only used while the device has no identity yet; never written to disk by Waken.
	AuthKey string `json:"authKey,omitempty"`
	// AgentToken is given by a host to its owner's devices (Hello).
	AgentToken string `json:"agentToken,omitempty"`
	// Target is where a host's Sunshine and agent listen.
	Target string `json:"target,omitempty"`
	// Bind is where a client forwards from, and where any device serves the agent proxy.
	Bind string `json:"bind,omitempty"`
	// PlayBind is where a host forwards the stream ports of the computer it plays on (SetPeer). Default "::1".
	PlayBind string `json:"playBind,omitempty"`
	TCPPorts []int  `json:"tcpPorts,omitempty"`
	UDPPorts []int  `json:"udpPorts,omitempty"`
}

type Node struct {
	// Name is the hostname on the network, "waken-host-mac-de-enzo".
	Name   string `json:"name"`
	IP     string `json:"ip"`
	OS     string `json:"os,omitempty"`
	Online bool   `json:"online"`
	// Direct is true once packets go straight between the two devices. Otherwise they go through a
	// Tailscale relay (DERP): fine for the menus, too slow and too narrow for a full quality stream.
	Direct bool   `json:"direct"`
	Relay  string `json:"relay,omitempty"`
}

type Status struct {
	State    string `json:"state"`
	LoginURL string `json:"loginUrl,omitempty"`
	Error    string `json:"error,omitempty"`
	// Control is the coordination server the tunnel runs on: "" for Tailscale's.
	Control string `json:"control,omitempty"`
	Self     *Node  `json:"self,omitempty"`
	// Hosts are the owner's computers running Waken, online or not.
	Hosts []Node `json:"hosts"`
	// Peer is the host a client forwards to.
	Peer string `json:"peer,omitempty"`
	// Play is the address the stream code connects to, to reach Peer: 127.0.0.1 on a client, ::1 on a computer.
	// Empty while this device cannot play (a computer whose IPv6 loopback could not be used).
	Play string `json:"play,omitempty"`
}

// Hello is what a host tells its owner's devices.
type Hello struct {
	Name       string `json:"name"`
	OS         string `json:"os"`
	AgentToken string `json:"agentToken"`
}

type Tunnel struct {
	cfg     Config
	baseDir string
	server *tsnet.Server
	lc     *local.Client
	ctx    context.Context
	cancel context.CancelFunc

	mu        sync.Mutex
	status    Status
	peer      string
	forwarded bool
	// playing: the stream ports of the chosen computer are forwarded (always on a client, on ::1 on a host).
	playing bool
}

var nameUnsafe = regexp.MustCompile(`[^a-z0-9-]+`)

// HostnameFor turns a device name into a network name: "Mac de Enzo" becomes "waken-host-mac-de-enzo".
func HostnameFor(role, name string) string {
	slug := strings.Trim(nameUnsafe.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		slug = "device"
	}
	prefix := clientPrefix
	if role == RoleHost {
		prefix = HostPrefix
	}
	if len(slug) > 40 {
		slug = slug[:40]
	}
	return prefix + slug
}

// Start brings the node up in the background. Status tells when it needs the user to sign in, then when it runs.
func Start(cfg Config) (*Tunnel, error) {
	if cfg.Role != RoleHost && cfg.Role != RoleClient {
		return nil, fmt.Errorf("rôle inconnu %q", cfg.Role)
	}
	if cfg.Dir == "" {
		return nil, errors.New("dossier d'état manquant")
	}
	if cfg.Role == RoleHost && len(cfg.AgentToken) < 24 {
		return nil, errors.New("jeton de l'agent manquant")
	}
	if cfg.Target == "" {
		cfg.Target = "127.0.0.1"
	}
	if cfg.Bind == "" {
		cfg.Bind = "127.0.0.1"
	}
	if cfg.PlayBind == "" {
		cfg.PlayBind = "::1"
	}
	if len(cfg.TCPPorts) == 0 {
		cfg.TCPPorts = DefaultTCPPorts
		if cfg.Role == RoleClient {
			cfg.TCPPorts = streamTCPPorts()
		}
	}
	if len(cfg.UDPPorts) == 0 {
		cfg.UDPPorts = DefaultUDPPorts
	}

	// One identity per coordination server: the Tailscale one stays as it was when the device moves to its
	// Waken account, and coming back to it needs no new sign-in.
	baseDir := cfg.Dir
	cfg.Dir = StateDirFor(cfg.Dir, cfg.ControlURL)

	t := &Tunnel{cfg: cfg, baseDir: baseDir, status: Status{State: StateStarting, Hosts: []Node{}}}
	t.server = &tsnet.Server{
		Hostname:   HostnameFor(cfg.Role, cfg.Name),
		Dir:        cfg.Dir,
		ControlURL: cfg.ControlURL,
		AuthKey:    cfg.AuthKey,
		Logf:       func(string, ...any) {},
		UserLogf:   func(string, ...any) {},
	}
	t.ctx, t.cancel = context.WithCancel(context.Background())
	if err := t.server.Start(); err != nil {
		t.cancel()
		return nil, err
	}
	lc, err := t.server.LocalClient()
	if err != nil {
		t.Stop()
		return nil, err
	}
	t.lc = lc
	go t.watch()
	return t, nil
}

// StateDirFor is where a node keeps its identity for one coordination server: the base folder for Tailscale's,
// a sub-folder named after the server otherwise ("net-net.wakenplay.fr").
func StateDirFor(base, controlURL string) string {
	if controlURL == "" {
		return base
	}
	name := controlURL
	if u, err := url.Parse(controlURL); err == nil && u.Host != "" {
		name = u.Host
	}
	return filepath.Join(base, "net-"+nameUnsafe.ReplaceAllString(strings.ToLower(name), "-"))
}

// ControlURL is the coordination server this tunnel runs with ("" for Tailscale's).
func (t *Tunnel) ControlURL() string { return t.cfg.ControlURL }

// Config is what the tunnel was started with, minus its single-use key.
func (t *Tunnel) Config() Config {
	c := t.cfg
	c.AuthKey = ""
	c.Dir = t.baseDir
	return c
}

// Status is a snapshot, safe to call often.
func (t *Tunnel) Status() Status {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := t.status
	// Never nil: JSON would say null where the apps expect a list.
	s.Hosts = append([]Node{}, t.status.Hosts...)
	s.Peer = t.peer
	s.Control = t.cfg.ControlURL
	if t.playing {
		s.Play = t.playAddress()
	}
	return s
}

// playAddress is where the stream code finds the chosen computer.
func (t *Tunnel) playAddress() string {
	if t.cfg.Role == RoleHost {
		return t.cfg.PlayBind
	}
	return t.cfg.Bind
}

// SetPeer chooses the computer this device plays on: its network name or IP.
func (t *Tunnel) SetPeer(peer string) error {
	t.mu.Lock()
	host, playing := t.cfg.Role == RoleHost, t.playing
	t.mu.Unlock()
	if host && !playing {
		return errors.New("cet ordinateur ne peut pas encore jouer sur un autre : le réseau Waken démarre, ou son adresse locale IPv6 (::1) est indisponible")
	}
	ip, err := t.resolve(peer)
	if err != nil {
		return err
	}
	t.mu.Lock()
	t.peer = ip
	t.mu.Unlock()
	// A ping makes both sides look for a direct path now, before the stream needs it.
	if addr, err := netip.ParseAddr(ip); err == nil {
		go func() {
			ctx, cancel := context.WithTimeout(t.ctx, 5*time.Second)
			defer cancel()
			t.lc.Ping(ctx, addr, tailcfg.PingDisco)
		}()
	}
	return nil
}

// Hello asks a host who it is and for its agent token. The host answers its owner's devices only.
func (t *Tunnel) Hello(ctx context.Context, peer string) (*Hello, error) {
	ip, err := t.resolve(peer)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://%s/hello", net.JoinHostPort(ip, fmt.Sprint(HelloPort))), nil)
	if err != nil {
		return nil, err
	}
	res, err := t.server.HTTPClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("l'hôte a refusé (%d)", res.StatusCode)
	}
	var h Hello
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&h); err != nil {
		return nil, err
	}
	return &h, nil
}

// Logout forgets this device's sign-in. The next start asks to sign in again.
func (t *Tunnel) Logout(ctx context.Context) error {
	return t.lc.Logout(ctx)
}

func (t *Tunnel) Stop() {
	t.cancel()
	t.server.Close()
	t.mu.Lock()
	t.status.State = StateStopped
	t.mu.Unlock()
}

func (t *Tunnel) resolve(peer string) (string, error) {
	if ip, err := netip.ParseAddr(peer); err == nil {
		return ip.String(), nil
	}
	for _, h := range t.Status().Hosts {
		if strings.EqualFold(h.Name, peer) {
			return h.IP, nil
		}
	}
	return "", fmt.Errorf("aucun ordinateur « %s » sur ton réseau Waken", peer)
}

// watch follows the node's state, starts the forwarding once it runs, and asks for a sign-in after a logout.
func (t *Tunnel) watch() {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	loginAsked := time.Time{}
	for {
		st, err := t.lc.Status(t.ctx)
		if t.ctx.Err() != nil {
			return
		}
		t.mu.Lock()
		if err != nil {
			t.status.State, t.status.Error = StateError, err.Error()
		} else {
			t.status.Error = ""
			t.status.LoginURL = st.AuthURL
			switch st.BackendState {
			case "Running":
				t.status.State = StateRunning
			case "NeedsLogin", "NeedsMachineAuth":
				t.status.State = StateNeedsLogin
			default:
				t.status.State = StateStarting
			}
			if st.Self != nil && len(st.Self.TailscaleIPs) > 0 {
				t.status.Self = &Node{Name: st.Self.HostName, IP: st.Self.TailscaleIPs[0].String(), OS: st.Self.OS, Online: true}
			}
			hosts := []Node{}
			for _, p := range st.Peer {
				// Only this account's own machines: a node shared by someone else is not one of "your computers".
				if !strings.HasPrefix(p.HostName, HostPrefix) || len(p.TailscaleIPs) == 0 || (st.Self != nil && p.UserID != st.Self.UserID) {
					continue
				}
				hosts = append(hosts, Node{Name: p.HostName, IP: p.TailscaleIPs[0].String(), OS: p.OS, Online: p.Online, Direct: p.CurAddr != "", Relay: p.Relay})
			}
			sort.Slice(hosts, func(i, j int) bool { return hosts[i].Name < hosts[j].Name })
			t.status.Hosts = hosts
		}
		state, hasURL, forwarded := t.status.State, t.status.LoginURL != "", t.forwarded
		t.mu.Unlock()

		// On the Waken account network (or with a key) the app brings a key: a web login would replace it.
		if state == StateNeedsLogin && !hasURL && t.cfg.AuthKey == "" && t.cfg.ControlURL == "" && time.Since(loginAsked) > 30*time.Second {
			loginAsked = time.Now()
			if err := t.lc.StartLoginInteractive(t.ctx); err != nil {
				log.Printf("login: %v", err)
			}
		}
		if state == StateRunning && !forwarded {
			if err := t.startForwarding(); err != nil {
				t.mu.Lock()
				t.status.State, t.status.Error = StateError, err.Error()
				t.mu.Unlock()
			} else {
				t.mu.Lock()
				t.forwarded = true
				t.mu.Unlock()
			}
		}

		select {
		case <-t.ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (t *Tunnel) startForwarding() error {
	ip4, _ := t.server.TailscaleIPs()
	if !ip4.IsValid() {
		return errors.New("pas encore d'adresse sur le réseau Waken")
	}
	var tsDial dialFunc = t.server.Dial
	var localDial dialFunc = (&net.Dialer{}).DialContext

	if t.cfg.Role == RoleHost {
		target := func() string { return t.cfg.Target }
		for _, p := range t.cfg.TCPPorts {
			if err := forwardTCP(t.ctx, t.server.Listen, netip.AddrPortFrom(ip4, uint16(p)).String(), localDial, target, p, t.isOwner); err != nil {
				return fmt.Errorf("port %d : %w", p, err)
			}
		}
		for _, p := range t.cfg.UDPPorts {
			if err := forwardUDP(t.ctx, t.server.ListenPacket, netip.AddrPortFrom(ip4, uint16(p)).String(), localDial, target, p, t.isOwner); err != nil {
				return fmt.Errorf("port %d : %w", p, err)
			}
		}
		if err := t.serveHello(ip4); err != nil {
			return err
		}
		// A computer plays on the owner's other computers too. Without its IPv6 loopback it still hosts.
		if err := t.forwardPlay(t.cfg.PlayBind, streamTCPPorts(), tsDial); err != nil {
			log.Printf("jouer sur un autre ordinateur : %v", err)
		} else {
			t.mu.Lock()
			t.playing = true
			t.mu.Unlock()
		}
		// A desktop app hosts and also browses the owner's other computers: their agents through the same proxy.
		return t.serveAgentProxy()
	}

	if err := t.forwardPlay(t.cfg.Bind, t.cfg.TCPPorts, tsDial); err != nil {
		return err
	}
	t.mu.Lock()
	t.playing = true
	t.mu.Unlock()
	return t.serveAgentProxy()
}

// forwardPlay forwards the stream ports from bind (on this device) to the chosen computer.
func (t *Tunnel) forwardPlay(bind string, tcpPorts []int, tsDial dialFunc) error {
	peer := func() string {
		t.mu.Lock()
		defer t.mu.Unlock()
		return t.peer
	}
	listen := func(network, address string) (net.Listener, error) { return net.Listen(network, address) }
	listenPacket := func(network, address string) (net.PacketConn, error) { return net.ListenPacket(network, address) }
	for _, p := range tcpPorts {
		if err := forwardTCP(t.ctx, listen, net.JoinHostPort(bind, fmt.Sprint(p)), tsDial, peer, p, nil); err != nil {
			return fmt.Errorf("port %d : %w", p, err)
		}
	}
	for _, p := range t.cfg.UDPPorts {
		if err := forwardUDP(t.ctx, listenPacket, net.JoinHostPort(bind, fmt.Sprint(p)), tsDial, peer, p, nil); err != nil {
			return fmt.Errorf("port %d : %w", p, err)
		}
	}
	return nil
}

// streamTCPPorts are the default ports without the agent's: a client reaches agents through the proxy.
func streamTCPPorts() []int {
	var out []int
	for _, p := range DefaultTCPPorts {
		if p != AgentPort {
			out = append(out, p)
		}
	}
	return out
}

// serveAgentProxy forwards http://127.0.0.1:47102/h/<host>/<path> to that host's agent over the network.
// The agent still checks its own token: the proxy only carries requests.
func (t *Tunnel) serveAgentProxy() error {
	ln, err := net.Listen("tcp", net.JoinHostPort(t.cfg.Bind, fmt.Sprint(ProxyPort)))
	if err != nil {
		return fmt.Errorf("port %d : %w", ProxyPort, err)
	}
	transport := &http.Transport{DialContext: t.server.Dial, MaxIdleConnsPerHost: 4, IdleConnTimeout: 90 * time.Second}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			host, rest := splitHostPath(r.In.URL.Path)
			ip, _ := t.resolve(host)
			r.Out.URL.Scheme = "http"
			r.Out.URL.Host = net.JoinHostPort(ip, fmt.Sprint(AgentPort))
			r.Out.URL.Path = rest
			r.Out.URL.RawPath = ""
			r.Out.Host = r.Out.URL.Host
		},
		Transport: transport,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "ordinateur injoignable : "+err.Error(), http.StatusBadGateway)
		},
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _ := splitHostPath(r.URL.Path)
		if _, err := t.resolve(host); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		proxy.ServeHTTP(w, r)
	})
	srv := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() { <-t.ctx.Done(); srv.Close() }()
	go srv.Serve(ln)
	return nil
}

// splitHostPath reads "/h/waken-host-mac/games/x" as ("waken-host-mac", "/games/x").
func splitHostPath(path string) (string, string) {
	rest, ok := strings.CutPrefix(path, "/h/")
	if !ok {
		return "", path
	}
	host, tail, _ := strings.Cut(rest, "/")
	return host, "/" + tail
}

// isOwner accepts the devices signed in with the same account as this host, nobody else.
func (t *Tunnel) isOwner(remote net.Addr) bool {
	ctx, cancel := context.WithTimeout(t.ctx, 5*time.Second)
	defer cancel()
	who, err := t.lc.WhoIs(ctx, remote.String())
	if err != nil || who.UserProfile == nil {
		return false
	}
	st, err := t.lc.StatusWithoutPeers(ctx)
	if err != nil || st.Self == nil {
		return false
	}
	return who.UserProfile.ID == st.Self.UserID
}

func (t *Tunnel) serveHello(ip4 netip.Addr) error {
	ln, err := t.server.Listen("tcp", netip.AddrPortFrom(ip4, HelloPort).String())
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /hello", func(w http.ResponseWriter, r *http.Request) {
		addr, err := net.ResolveTCPAddr("tcp", r.RemoteAddr)
		if err != nil || !t.isOwner(addr) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		st := t.Status()
		os := ""
		if st.Self != nil {
			os = st.Self.OS
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Hello{Name: t.cfg.Name, OS: os, AgentToken: t.cfg.AgentToken})
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { <-t.ctx.Done(); srv.Close() }()
	go srv.Serve(ln)
	return nil
}
