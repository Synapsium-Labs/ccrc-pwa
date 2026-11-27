//go:build !windows

package hook

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ccrc/core/internal/adapter/regfs"
)

// loaderFS is a fixture loader tree: the /lib patterns it answers a glob with, as a box's /lib would.
type loaderFS struct {
	FS
	have map[string]bool
}

func (m loaderFS) Glob(p string) ([]string, error) {
	if strings.HasPrefix(p, "/lib") {
		if m.have[p] {
			return []string{p}, nil
		}
		return nil, nil
	}
	return m.FS.Glob(p)
}

const (
	muslLd  = "/lib/ld-musl-*.so.1"
	glibc64 = "/lib64/ld-linux-*"
	glibcML = "/lib/*-linux-gnu/ld-linux-*"
)

func loaders(names ...string) func() FS {
	have := map[string]bool{}
	for _, n := range names {
		have[n] = true
	}
	return func() FS { return loaderFS{regfs.OS{}, have} }
}

func fireWide(home string, fsys FS, env map[string]string) {
	env["HOME"], env["TMUX_PANE"], env["CCRC_SESSION_GENERATION"], env["CLAUDE_CODE_SESSION_ID"] = home, "%1", spoolGen, "uuid-1"
	payload := `{"hook_event_name":"PreToolUse","session_id":"` + spoolSID + `","tool_name":"Agent","tool_use_id":"toolu_01","cwd":"/` +
		strings.Repeat("c", 500) + `","transcript_path":"/` + strings.Repeat("t", 500) + `","tool_input":{"model":"sonnet"}}`
	Main(strings.NewReader(payload), IO{Stdout: &bytes.Buffer{}, Getenv: func(k string) string { return env[k] }, FS: fsys, Pid: 1, GOOS: "linux",
		LookupEnv:   func(k string) (string, bool) { v, ok := env[k]; return v, ok },
		NowMs:       func() int64 { return 1700000000500 },
		TmuxSession: func(string, string, string) string { return "cc-" + spoolID }})
}

// The line cap follows the libc: 4096 on Linux unless OSTYPE says otherwise or the box is musl alone (a musl loader with
// no glibc loader; Debian and Ubuntu install musl's beside glibc's, where bash says glibc). A ~1.1 KiB line is whole under
// 4096 and shed under 1008.
func TestLineCapFollowsTheLibc(t *testing.T) {
	for _, c := range []struct {
		name      string
		fs        func() FS
		env       map[string]string
		truncated bool
	}{
		{"glibc Linux", func() FS { return regfs.OS{} }, map[string]string{}, false},
		{"a musl loader alone", loaders(muslLd), map[string]string{}, true},
		{"musl beside glibc (lib/<triplet>)", loaders(muslLd, glibcML), map[string]string{}, false},
		{"musl beside glibc (lib64)", loaders(muslLd, glibc64), map[string]string{}, false},
		{"OSTYPE says darwin", func() FS { return regfs.OS{} }, map[string]string{"OSTYPE": "darwin23"}, true},
		{"an exported empty OSTYPE", func() FS { return regfs.OS{} }, map[string]string{"OSTYPE": ""}, true},
		{"OSTYPE says glibc on a musl-only box (bash tests its build too)", loaders(muslLd), map[string]string{"OSTYPE": "linux-gnu"}, true},
		{"OSTYPE says glibc beside glibc", loaders(muslLd, glibcML), map[string]string{"OSTYPE": "linux-gnu"}, false},
	} {
		home, dir := spoolHome(t)
		fireWide(home, c.fs(), c.env)
		es, _ := os.ReadDir(dir)
		var got string
		for _, e := range es {
			b, _ := os.ReadFile(filepath.Join(dir, e.Name()))
			got += string(b)
		}
		if got == "" {
			t.Errorf("%s: no line", c.name)
		} else if has := strings.Contains(got, `"truncated":true`); has != c.truncated {
			t.Errorf("%s: truncated=%v, want %v (line %d bytes)", c.name, has, c.truncated, len(got))
		}
	}
}

// A worktrees directory that cannot be listed gives the line no `listing` key (unmeasured), never `"listing":[]`; one that
// is absent gives a measured `[]`. (A mode-000 directory: skipped as root, which reads anything.)
func TestUnlistableWorktreesWritesNoListingKey(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("root reads anything")
	}
	run := func(prep func(wt string)) string {
		home, dir := spoolHome(t)
		repo := filepath.Join(home, "repo")
		wt := filepath.Join(repo, ".git", "worktrees")
		if err := os.MkdirAll(filepath.Join(repo, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
		prep(wt)
		env := map[string]string{"HOME": home, "TMUX_PANE": "%1", "CCRC_SESSION_GENERATION": spoolGen, "CLAUDE_CODE_SESSION_ID": "uuid-1"}
		payload := `{"hook_event_name":"PreToolUse","session_id":"` + spoolSID + `","tool_name":"Bash","tool_use_id":"toolu_01","cwd":"` + repo +
			`","tool_input":{"command":"git worktree list"}}`
		Main(strings.NewReader(payload), IO{Stdout: &bytes.Buffer{}, Getenv: func(k string) string { return env[k] }, FS: regfs.OS{}, Pid: 1, GOOS: "linux",
			NowMs:       func() int64 { return 1700000000500 },
			TmuxSession: func(string, string, string) string { return "cc-" + spoolID }})
		var got string
		es, _ := os.ReadDir(dir)
		for _, e := range es {
			b, _ := os.ReadFile(filepath.Join(dir, e.Name()))
			got += string(b)
		}
		return got
	}
	if got := run(func(string) {}); !strings.Contains(got, `"listing":[]`) {
		t.Errorf("an absent worktrees directory: want a measured [], got %q", got)
	}
	got := run(func(wt string) {
		if err := os.MkdirAll(filepath.Join(wt, "a"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(wt, 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(wt, 0o755) })
	})
	if got == "" || strings.Contains(got, `"listing"`) {
		t.Errorf("an unlistable worktrees directory: want a line with no listing key, got %q", got)
	}
}
