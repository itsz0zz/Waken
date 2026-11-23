// C interface of the Waken tunnel, built as a static library (c-archive) for the iOS app.
// Every function returns a JSON string the caller frees with WakenTunnelFree: {"ok":true,...} or {"error":"..."}.
package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"encoding/json"
	"sync"
	"time"
	"unsafe"

	"waken/tunnel"
)

var (
	mu      sync.Mutex
	current *tunnel.Tunnel
)

func reply(v any, err error) *C.char {
	var out []byte
	if err != nil {
		out, _ = json.Marshal(map[string]string{"error": err.Error()})
	} else {
		out, _ = json.Marshal(v)
	}
	return C.CString(string(out))
}

//export WakenTunnelStart
func WakenTunnelStart(configJSON *C.char) *C.char {
	mu.Lock()
	defer mu.Unlock()
	if current != nil {
		return reply(current.Status(), nil)
	}
	var cfg tunnel.Config
	if err := json.Unmarshal([]byte(C.GoString(configJSON)), &cfg); err != nil {
		return reply(nil, err)
	}
	t, err := tunnel.Start(cfg)
	if err != nil {
		return reply(nil, err)
	}
	current = t
	return reply(t.Status(), nil)
}

//export WakenTunnelStatus
func WakenTunnelStatus() *C.char {
	mu.Lock()
	defer mu.Unlock()
	if current == nil {
		return reply(tunnel.Status{State: tunnel.StateStopped, Hosts: []tunnel.Node{}}, nil)
	}
	return reply(current.Status(), nil)
}

//export WakenTunnelSetPeer
func WakenTunnelSetPeer(peer *C.char) *C.char {
	t := running()
	if t == nil {
		return reply(nil, errStopped)
	}
	return reply(map[string]bool{"ok": true}, t.SetPeer(C.GoString(peer)))
}

//export WakenTunnelHello
func WakenTunnelHello(peer *C.char) *C.char {
	t := running()
	if t == nil {
		return reply(nil, errStopped)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return reply(t.Hello(ctx, C.GoString(peer)))
}

//export WakenTunnelLogout
func WakenTunnelLogout() *C.char {
	t := running()
	if t == nil {
		return reply(nil, errStopped)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return reply(map[string]bool{"ok": true}, t.Logout(ctx))
}

//export WakenTunnelStop
func WakenTunnelStop() {
	mu.Lock()
	defer mu.Unlock()
	if current != nil {
		current.Stop()
		current = nil
	}
}

//export WakenTunnelFree
func WakenTunnelFree(s *C.char) {
	C.free(unsafe.Pointer(s))
}

type stoppedError struct{}

func (stoppedError) Error() string { return "le réseau Waken n'est pas démarré" }

var errStopped = stoppedError{}

func running() *tunnel.Tunnel {
	mu.Lock()
	defer mu.Unlock()
	return current
}

func main() {}
