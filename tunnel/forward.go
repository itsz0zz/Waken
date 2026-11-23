package tunnel

import (
	"context"
	"io"
	"log"
	"net"
	"strconv"
	"sync"
	"time"
)

// A UDP flow without traffic for this long is closed (a stream sends dozens of packets per second).
const udpIdle = 60 * time.Second

// Default ports: Sunshine (HTTPS, HTTP, RTSP), the Waken agent, and the stream's UDP ports.
// Sunshine's admin API (47990) is never carried: it stays on the host only.
var (
	DefaultTCPPorts = []int{47984, 47989, 48010, 47100}
	DefaultUDPPorts = []int{47998, 47999, 48000}
)

type (
	listenFunc       func(network, address string) (net.Listener, error)
	listenPacketFunc func(network, address string) (net.PacketConn, error)
	dialFunc         func(ctx context.Context, network, address string) (net.Conn, error)
	// allowFunc says whether a remote address may use the tunnel (host side: only the owner's devices).
	allowFunc func(remote net.Addr) bool
	// targetFunc gives where to send a new connection, or "" when there is nowhere to go yet.
	targetFunc func() string
)

func pipe(a, b net.Conn) {
	var once sync.Once
	done := func() { once.Do(func() { a.Close(); b.Close() }) }
	go func() { io.Copy(a, b); done() }()
	io.Copy(b, a)
	done()
}

// forwardTCP accepts on listenAddr and connects each client to target:port.
func forwardTCP(ctx context.Context, listen listenFunc, listenAddr string, dial dialFunc, target targetFunc, port int, allow allowFunc) error {
	ln, err := listen("tcp", listenAddr)
	if err != nil {
		return err
	}
	go func() { <-ctx.Done(); ln.Close() }()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				host := target()
				if host == "" || (allow != nil && !allow(c.RemoteAddr())) {
					c.Close()
					return
				}
				dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				t, err := dial(dctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
				if err != nil {
					log.Printf("tcp %d: %v", port, err)
					c.Close()
					return
				}
				pipe(c, t)
			}()
		}
	}()
	return nil
}

// forwardUDP keeps one outgoing socket per remote sender, so that answers go back to the right one:
// Sunshine sends the video to whoever pinged it.
func forwardUDP(ctx context.Context, listen listenPacketFunc, listenAddr string, dial dialFunc, target targetFunc, port int, allow allowFunc) error {
	pc, err := listen("udp", listenAddr)
	if err != nil {
		return err
	}
	go func() { <-ctx.Done(); pc.Close() }()
	go func() {
		var mu sync.Mutex
		flows := map[string]net.Conn{}
		buf := make([]byte, 65535)
		for {
			n, from, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			key := from.String()
			mu.Lock()
			out, ok := flows[key]
			mu.Unlock()
			if !ok {
				host := target()
				if host == "" || (allow != nil && !allow(from)) {
					continue
				}
				dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
				out, err = dial(dctx, "udp", net.JoinHostPort(host, strconv.Itoa(port)))
				cancel()
				if err != nil {
					log.Printf("udp %d: %v", port, err)
					continue
				}
				mu.Lock()
				flows[key] = out
				mu.Unlock()
				go func(out net.Conn, from net.Addr, key string) {
					b := make([]byte, 65535)
					for {
						out.SetReadDeadline(time.Now().Add(udpIdle))
						m, err := out.Read(b)
						if err != nil {
							mu.Lock()
							delete(flows, key)
							mu.Unlock()
							out.Close()
							return
						}
						pc.WriteTo(b[:m], from)
					}
				}(out, from, key)
			}
			out.Write(buf[:n])
		}
	}()
	return nil
}
