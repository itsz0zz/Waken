// The Waken tunnel as a helper process, for the desktop apps (host side).
// The configuration comes on stdin as JSON (it holds the agent token, so never on the command line).
// Each status change is printed on stdout as one line: STATUS {json}.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"waken/tunnel"
)

func main() {
	log.SetOutput(os.Stderr)
	raw, err := io.ReadAll(io.LimitReader(bufio.NewReader(os.Stdin), 64<<10))
	if err != nil {
		log.Fatal(err)
	}
	var cfg tunnel.Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		log.Fatalf("configuration : %v", err)
	}
	t, err := tunnel.Start(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer t.Stop()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	last := ""
	for {
		if b, err := json.Marshal(t.Status()); err == nil && string(b) != last {
			last = string(b)
			fmt.Printf("STATUS %s\n", b)
		}
		select {
		case <-stop:
			return
		case <-tick.C:
		}
	}
}
