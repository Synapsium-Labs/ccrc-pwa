//go:build windows

package regfs

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A path a bash on the box wrote (MSYS2's spelling) is read as MSYS2's bash reads it: measured against `cygpath -w`.
func TestNativeReadsMsysPathsAsBashDoes(t *testing.T) {
	cyg, err := exec.LookPath("cygpath")
	if err != nil || !strings.Contains(strings.ToLower(cyg), "msys64") {
		t.Skip("no MSYS2 cygpath on PATH")
	}
	f := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(f, []byte(`{"schema":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	u, err := exec.Command(cyg, "-u", "--", f).Output()
	if err != nil {
		t.Fatal(err)
	}
	msys := strings.TrimRight(string(u), "\n")
	if !strings.HasPrefix(msys, "/") {
		t.Fatalf("cygpath -u answered %q", msys)
	}
	b, err := OS{}.ReadFile(msys, 0)
	if err != nil || string(b) != `{"schema":1}` {
		t.Fatalf("ReadFile(%q) = %q, %v: an MSYS2 path a bash wrote is not read", msys, b, err)
	}
	for _, p := range []string{"/c/Windows", "/usr/bin", "/tmp"} {
		w, err := exec.Command(cyg, "-w", "--", p).Output()
		if err != nil {
			t.Fatal(err)
		}
		want := filepath.Clean(strings.TrimRight(string(w), "\r\n"))
		if got := filepath.Clean(native(p)); !strings.EqualFold(got, want) {
			t.Errorf("native(%q) = %q, MSYS2 reads it as %q", p, got, want)
		}
	}
	for _, p := range []string{`C:\x`, "C:/x", "rel/x", "//srv/x"} {
		if native(p) != p {
			t.Errorf("native(%q) changed a path that is not MSYS2's", p)
		}
	}
}
