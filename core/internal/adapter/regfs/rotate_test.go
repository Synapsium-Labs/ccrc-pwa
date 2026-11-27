// An external test: the rotation is wired with lock.Hold as the composition root wires it.
package regfs_test

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ccrc/core/internal/adapter/lock"
	"ccrc/core/internal/adapter/regfs"
)

// The rotation renames the whole file when over says so, and leaves it when not, and while flock(1) holds src (as
// another bash or Go hook rotating does) it leaves it too. On Windows the lock is MSYS2's (o.Flock), so it is
// wired as the composition root wires it; with none wired nothing rotates there.
func TestRotateLocked(t *testing.T) {
	if _, err := exec.LookPath("flock"); err != nil && runtime.GOOS == "windows" {
		t.Skip("no MSYS2 flock on PATH: the Windows rotation's lock")
	}
	o := regfs.OS{Flock: lock.Hold}
	d := t.TempDir()
	src, dst := filepath.Join(d, "x.joined"), filepath.Join(d, "x.joinedprev")
	if err := os.WriteFile(src, []byte("a\nb\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	o.RotateLocked(src, dst, 1024, func(b []byte) bool { return strings.Count(string(b), "\n") > 5 })
	if _, err := os.Stat(dst); err == nil {
		t.Fatal("rotated under the cap")
	}
	if runtime.GOOS == "windows" {
		regfs.OS{}.RotateLocked(src, dst, 1024, func([]byte) bool { return true })
		if _, err := os.Stat(dst); err == nil {
			t.Fatal("rotated with no lock wired")
		}
	}
	if _, err := exec.LookPath("flock"); err == nil {
		holder := exec.Command("flock", "-x", src, "sh", "-c", "echo held; sleep 1")
		out, _ := holder.StdoutPipe()
		if err := holder.Start(); err != nil {
			t.Fatal(err)
		}
		_, _ = bufio.NewReader(out).ReadString('\n')
		o.RotateLocked(src, dst, 1024, func([]byte) bool { return true })
		_ = holder.Wait()
		if _, err := os.Stat(dst); err == nil {
			t.Fatal("rotated while flock(1) held src")
		}
	}
	o.RotateLocked(src, dst, 1024, func(b []byte) bool { return string(b) == "a\nb\n" })
	_, srcErr := os.Stat(src)
	b, dstErr := os.ReadFile(dst)
	if srcErr == nil || dstErr != nil || string(b) != "a\nb\n" {
		t.Errorf("not renamed whole: src %v, dst %q %v", srcErr, b, dstErr)
	}
}
