package regfs

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// A shell's `*` never matches a name led by a dot; filepath.Glob's does, so Glob drops them (the job-dir fallback's
// `$REG/*.uuid`, the capture's `*.cap`).
func TestGlobSkipsDotNames(t *testing.T) {
	d := t.TempDir()
	for _, n := range []string{"a.uuid", ".x.uuid", "b.uuid"} {
		if err := os.WriteFile(filepath.Join(d, n), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := OS{}.Glob(filepath.Join(d, "*.uuid"))
	if err != nil || len(got) != 2 || filepath.Base(got[0]) != "a.uuid" || filepath.Base(got[1]) != "b.uuid" {
		t.Errorf("got %v %v", got, err)
	}
}

func TestReadTail(t *testing.T) {
	p := filepath.Join(t.TempDir(), "f")
	if err := os.WriteFile(p, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	for n, want := range map[int]string{4: "6789", 10: "0123456789", 64: "0123456789", 1: "9"} {
		if got, err := (OS{}).ReadTail(p, n); err != nil || string(got) != want {
			t.Errorf("ReadTail(%d) = %q, %v; want %q", n, got, err, want)
		}
	}
	if _, err := (OS{}).ReadTail(p+"x", 4); err == nil {
		t.Error("an absent file read")
	}
}

// ReadRange is `tail -c +<off+1> | head -c n`: what is there of the range, short at the end, none past it.
func TestReadRange(t *testing.T) {
	p := filepath.Join(t.TempDir(), "t")
	if err := os.WriteFile(p, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		off, n int64
		want   string
	}{{0, 4, "0123"}, {3, 4, "3456"}, {8, 5, "89"}, {10, 3, ""}, {12, 3, ""}} {
		if b, err := (OS{}).ReadRange(p, c.off, c.n); err != nil || string(b) != c.want {
			t.Errorf("%d+%d: %q %v", c.off, c.n, b, err)
		}
	}
	if _, err := (OS{}).ReadRange(p+"x", 0, 1); err == nil {
		t.Error("an absent file reads")
	}
}

// Executable is `-x`: a mode without an execute bit is not (the client gate's `no-client`).
func TestExecutable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("-x on Windows is Task 9's (any file that exists)")
	}
	d := t.TempDir()
	x, n := filepath.Join(d, "x"), filepath.Join(d, "n")
	_ = os.WriteFile(x, nil, 0o755)
	_ = os.WriteFile(n, nil, 0o644)
	if !(OS{}).Executable(x) || (OS{}).Executable(n) || (OS{}).Executable(filepath.Join(d, "absent")) {
		t.Error("-x: 0755 yes, 0644 and absent no")
	}
}

// Walk names what it finds as find does: the dir as given, then "/" and the name below it (Windows too, where
// WalkDir would join with a backslash).
func TestWalkSpellsFindsNames(t *testing.T) {
	d := t.TempDir()
	if err := os.MkdirAll(filepath.Join(d, "subagents"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "subagents", "agent-a.jsonl"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	root := d + "/subagents"
	var got []string
	OS{}.Walk(root, func(p string, _ time.Time) { got = append(got, p) })
	if len(got) != 2 || got[0] != root || got[1] != root+"/agent-a.jsonl" {
		t.Fatalf("Walk named %q", got)
	}
}

// GoOff with an empty HOME reads the path the bash's `$HOME/.cc-sessions/ccd-go-off` names, `/.cc-sessions/ccd-go-off`,
// never one relative to the working directory, where a project's own `.cc-sessions` would decide (final review finding 14).
func TestGoOffEmptyHomeIsRooted(t *testing.T) {
	if _, err := os.Lstat("/.cc-sessions/ccd-go-off"); err == nil {
		t.Skip("this box has a /.cc-sessions/ccd-go-off")
	}
	d := t.TempDir()
	if err := os.MkdirAll(filepath.Join(d, ".cc-sessions"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, ".cc-sessions", "ccd-go-off"), []byte("hook\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Chdir(d)
	if (OS{}).GoOff("", "hook") {
		t.Fatal("an empty HOME read the working directory's .cc-sessions/ccd-go-off")
	}
	if !(OS{}).GoOff(d, "hook") {
		t.Fatal("the CONTROL: the switch file names hook")
	}
}
