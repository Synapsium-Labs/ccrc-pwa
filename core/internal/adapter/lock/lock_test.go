package lock

import (
	"bufio"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Spec 2026-11-24 §6: bash's flock(1) and Go exclude each other on one file, both ways.
func TestBashAndGoExcludeEachOther(t *testing.T) {
	if _, err := exec.LookPath("flock"); err != nil {
		t.Skip("no flock(1) on PATH")
	}
	f := filepath.Join(t.TempDir(), "l")
	holder := exec.Command("flock", "-x", f, "sh", "-c", "echo held; sleep 1")
	out, err := holder.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := holder.Start(); err != nil {
		t.Fatal(err)
	}
	if _, err := bufio.NewReader(out).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	t0 := time.Now()
	if err := With(f, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(t0); d < 500*time.Millisecond {
		t.Fatalf("Go entered after %v while flock(1) held the lock", d)
	}
	if err := holder.Wait(); err != nil {
		t.Fatal(err)
	}
	err = With(f, func() error {
		if exec.Command("flock", "-n", f, "true").Run() == nil {
			t.Error("flock(1) entered while Go held the lock")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
