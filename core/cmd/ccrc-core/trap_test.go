//go:build !windows

package main

import (
	"os/signal"
	"syscall"
	"testing"
	"time"
)

// The approval wait's trap: a signal ignored when the process started (nohup's HUP) stays ignored, as bash's `trap`
// leaves it; one that is not ends the wait.
func TestArmTrapKeepsAnIgnoredSignalIgnored(t *testing.T) {
	signal.Ignore(syscall.SIGHUP)
	defer signal.Reset(syscall.SIGHUP, syscall.SIGINT)
	hit := make(chan struct{}, 2)
	armTrap(func() { hit <- struct{}{} })
	_ = syscall.Kill(syscall.Getpid(), syscall.SIGHUP)
	select {
	case <-hit:
		t.Fatal("an ignored HUP ran the trap")
	case <-time.After(300 * time.Millisecond):
	}
	_ = syscall.Kill(syscall.Getpid(), syscall.SIGINT)
	select {
	case <-hit:
	case <-time.After(2 * time.Second):
		t.Fatal("an INT did not run the trap")
	}
}
