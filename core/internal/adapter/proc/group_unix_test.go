//go:build !windows

package proc

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// A bounded classifier is cut as `timeout` cuts its command: the whole process group, so a child it started does not outlive
// the bound; and with no bound it runs to its end.
func TestClassifyShellBoundKillsTheGroup(t *testing.T) {
	bin, pidfile := t.TempDir(), filepath.Join(t.TempDir(), "pid")
	script := "#!/bin/sh\ncase \"$4\" in *slow*) sleep 30 & echo $! > '" + pidfile + "'; wait;; *late*) sleep 1; echo wrapped; exit 0;; esac\necho light\n"
	if err := os.WriteFile(filepath.Join(bin, "ccrc"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	old := classifyBound
	classifyBound = 300 * time.Millisecond
	defer func() { classifyBound = old }()
	if got := ClassifyShell("a slow b", true); got != "" {
		t.Errorf("a cut classifier answered %q", got)
	}
	b, err := os.ReadFile(pidfile)
	if err != nil {
		t.Fatal(err)
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	for i := 0; i < 50 && syscall.Kill(pid, 0) == nil; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if syscall.Kill(pid, 0) == nil {
		t.Errorf("the child %d outlived the bound", pid)
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
	if got := ClassifyShell("a late b", true); got != "" {
		t.Errorf("a classifier past its bound answered %q", got)
	}
	if got := ClassifyShell("a late b", false); got != "wrapped" {
		t.Errorf("unbounded, it runs to its end: %q", got)
	}
}

// A grandchild that ignores TERM does not outlive the bound either: the group is killed 100 ms after the TERM.
func TestClassifyShellBoundKillsAStubbornGrandchild(t *testing.T) {
	bin, pidfile := t.TempDir(), filepath.Join(t.TempDir(), "pid")
	script := "#!/bin/sh\n(trap '' TERM; exec sleep 30) &\necho $! > '" + pidfile + "'\nwait\n"
	if err := os.WriteFile(filepath.Join(bin, "ccrc"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	old := classifyBound
	classifyBound = 300 * time.Millisecond
	defer func() { classifyBound = old }()
	_ = ClassifyShell("x", true)
	b, err := os.ReadFile(pidfile)
	if err != nil {
		t.Fatal(err)
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	for i := 0; i < 50 && syscall.Kill(pid, 0) == nil; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if syscall.Kill(pid, 0) == nil {
		t.Errorf("the TERM-ignoring child %d outlived the bound", pid)
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
}
