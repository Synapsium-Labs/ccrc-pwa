package proc

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestGit(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		if out, err := exec.Command("git", append([]string{"-C", dir, "-c", "user.email=f@example.invalid", "-c", "user.name=fixture"}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	run("init", "-q")
	if err := os.WriteFile(filepath.Join(dir, "a"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "-A")
	run("commit", "-q", "-m", "a")
	sha, ok := Git(dir, "rev-parse", "HEAD")
	if !ok || len(sha) != 40 || strings.ContainsAny(sha, "\r\n") {
		t.Errorf("rev-parse HEAD = %q %v: a command substitution keeps no trailing newline", sha, ok)
	}
	// an answer git gives with a failing exit is a failure, whatever it printed
	if out, ok := Git(dir, "rev-parse", "--verify", "-q", "nope^{tree}"); ok || out != "" {
		t.Errorf("a missing ref = %q %v", out, ok)
	}
	if _, ok := Git(filepath.Join(dir, "gone"), "rev-parse", "HEAD"); ok {
		t.Error("a directory that is not there answered")
	}
}

// The classifier is reached through PATH, as the bash reaches it: a stand-in named ccrc on PATH answers.
func TestClassifyShellThroughPath(t *testing.T) {
	// On Windows too: proc.Command starts a `#!` script through MSYS2's bash, and the classifier's stdin path is Windows'
	// only path, so its answers are held to the same rules here (final review finding 3's fix round).
	bin := t.TempDir()
	script := "#!/bin/sh\n[ \"$1 $2 $3\" = \"test --classify-shell --\" ] || exit 2\ncase \"$4\" in *slow*) sleep 30;; *fail*) echo wrapped; exit 1;; esac\nprintf 'heavy:%s\\n\\n' \"$4\"\n"
	if err := os.WriteFile(filepath.Join(bin, "ccrc"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	if got := ClassifyShell("npm test", true); got != "heavy:npm test" {
		t.Errorf("verdict %q: the argv words arrive whole, the trailing newlines are cut", got)
	}
	if got := ClassifyShell("a fail b", true); got != "" {
		t.Errorf("a classifier that exits 1 gave %q: its answer is dropped", got)
	}
	if !Found("ccrc") || Found("no-such-tool-here") {
		t.Error("Found")
	}
}
