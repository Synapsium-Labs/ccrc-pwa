//go:build windows

// Package lock is ring L3: the exclusive lock ccd's bash takes with flock(1).
package lock

import (
	"fmt"
	"io"
	"os"
	"os/exec"
)

// With takes the lock through MSYS2's own flock binary, held as a child for fn's length: MSYS2's flock is Cygwin's
// emulation, which a native process cannot reach (measured in spec 2026-11-22 §4). One process per lock.
func With(file string, fn func() error) error {
	cmd := exec.Command("flock", "-x", file, "cat")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() { stdin.Close(); cmd.Wait() }()
	if _, err := stdin.Write([]byte("L\n")); err != nil {
		return err
	}
	if _, err := io.ReadFull(stdout, make([]byte, 2)); err != nil {
		return fmt.Errorf("flock exited before the lock was held: %w", err)
	}
	return fn()
}
