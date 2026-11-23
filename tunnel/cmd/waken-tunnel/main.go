// The Waken tunnel as a helper process, for the desktop apps.
//
// Protocol, one JSON object per line:
//   stdin, first line : the configuration (it holds the agent token, so never on the command line).
//   stdin, then       : commands {"id":1,"cmd":"hello"|"setPeer"|"logout","peer":"..."}.
//   stdout            : STATUS {status} on every change, REPLY {"id":1,"result":...} or {"id":1,"error":"..."}.
// The helper stops when stdin closes, so it never outlives the app.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"waken/tunnel"
)

type command struct {
	ID   int    `json:"id"`
	Cmd  string `json:"cmd"`
	Peer string `json:"peer,omitempty"`
}

var out sync.Mutex

func emit(prefix string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	out.Lock()
	defer out.Unlock()
	fmt.Printf("%s %s\n", prefix, b)
}

func main() {
	log.SetOutput(os.Stderr)
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 64<<10), 64<<10)
	if !in.Scan() {
		log.Fatal("configuration manquante")
	}
	var cfg tunnel.Config
	if err := json.Unmarshal(in.Bytes(), &cfg); err != nil {
		log.Fatalf("configuration : %v", err)
	}
	t, err := tunnel.Start(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer t.Stop()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for in.Scan() {
			var c command
			if err := json.Unmarshal(in.Bytes(), &c); err != nil {
				continue
			}
			go run(t, c)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	last := ""
	for {
		if b, err := json.Marshal(t.Status()); err == nil && string(b) != last {
			last = string(b)
			emit("STATUS", json.RawMessage(b))
		}
		select {
		case <-stop:
			return
		case <-done:
			return
		case <-tick.C:
		}
	}
}

func run(t *tunnel.Tunnel, c command) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var result any
	var err error
	switch c.Cmd {
	case "hello":
		result, err = t.Hello(ctx, c.Peer)
	case "setPeer":
		err = t.SetPeer(c.Peer)
		result = true
	case "logout":
		err = t.Logout(ctx)
		result = true
	default:
		err = fmt.Errorf("commande inconnue %q", c.Cmd)
	}
	if err != nil {
		emit("REPLY", map[string]any{"id": c.ID, "error": err.Error()})
		return
	}
	emit("REPLY", map[string]any{"id": c.ID, "result": result})
}
