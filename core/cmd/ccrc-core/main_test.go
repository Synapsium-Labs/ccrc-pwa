package main

import (
	"errors"
	"os"
	"syscall"
	"testing"
)

// HOME is taken as the environment holds it: no fallback to the platform's home lookup (USERPROFILE on Windows), so an
// empty HOME reaches the entry point as "" and is refused there, never quietly replaced by the real profile.
func TestCcdIOTakesHomeAsTheEnvironmentHoldsIt(t *testing.T) {
	t.Setenv("HOME", "")
	t.Setenv("USERPROFILE", t.TempDir())
	if h := ccdIO().Home; h != "" {
		t.Fatalf("Home = %q, want the empty HOME itself", h)
	}
}

// A write to a pipe whose reader is gone is EPIPE on every platform, as the SessionStart card's stop reads it (Windows
// answers ERROR_NO_DATA there, measured).
func TestHookStdoutClosedReaderIsEPIPE(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	r.Close()
	if _, err := (hookStdout{w}).Write([]byte("x")); !errors.Is(err, syscall.EPIPE) {
		t.Fatalf("a closed reader answered %v, want EPIPE", err)
	}
}
