package tmux

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

// Argv is the D-8270 lookup: no setting is the default server (or, on Windows, the socket $TMUX names), a socket name
// is `-L <name>`, and anything else asks no tmux at all.
func TestArgv(t *testing.T) {
	home := t.TempDir()
	want := []string{"tmux"}
	if runtime.GOOS == "windows" {
		want = []string{"tmux", "-S", "/tmp/tmux-1/default"}
	}
	if got, ok := Argv(home, "/tmp/tmux-1/default,12,0"); !ok || !reflect.DeepEqual(got, want) {
		t.Errorf("no setting: %v %v", got, ok)
	}
	if err := os.MkdirAll(filepath.Join(home, ".ccrc"), 0o755); err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(home, ".ccrc", "tmux-socket")
	_ = os.WriteFile(f, []byte("fleet\n"), 0o644)
	if got, ok := Argv(home, "/tmp/x,1,0"); !ok || !reflect.DeepEqual(got, []string{"tmux", "-L", "fleet"}) {
		t.Errorf("a socket name: %v %v", got, ok)
	}
	_ = os.WriteFile(f, []byte("-bad\n"), 0o644)
	if _, ok := Argv(home, ""); ok {
		t.Error("a setting that is not a socket name asks no tmux")
	}
	_ = os.Remove(f)
	_ = os.Mkdir(f, 0o755)
	if _, ok := Argv(home, ""); ok {
		t.Error("a setting that cannot be read asks no tmux")
	}
}
