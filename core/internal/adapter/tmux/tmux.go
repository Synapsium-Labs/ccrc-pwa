// Package tmux is ring L3: the session hook's one tmux question, asked as ccd/session-hook.sh asks it.
package tmux

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"ccrc/core/internal/kernel/vocab"
)

var socketName = regexp.MustCompile(vocab.TmuxSocketNameRe)

// Argv is the hook's `_TMX_ARGV` (the D-8270 socket lookup): tmux, then `-L <name>` when ~/.ccrc/tmux-socket names a
// socket, or on Windows `-S <socket>` from $TMUX when it names none (Git Bash hands MSYS2's tmux no $TMUX). ok is false
// where the setting cannot be used: the bash then asks no tmux at all.
func Argv(home, tmuxEnv string) ([]string, bool) {
	f := filepath.Join(home, filepath.FromSlash(vocab.TmuxSocketFile))
	sock := ""
	if _, err := os.Lstat(f); err == nil {
		st, err := os.Stat(f)
		if err != nil || !st.Mode().IsRegular() {
			return nil, false
		}
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, false
		}
		sock, _, _ = strings.Cut(string(b), "\n")
		if sock != "" && !socketName.MatchString(sock) {
			return nil, false
		}
	}
	switch {
	case sock != "":
		return []string{"tmux", "-L", sock}, true
	case runtime.GOOS == "windows" && tmuxEnv != "":
		s, _, _ := strings.Cut(tmuxEnv, ",")
		return []string{"tmux", "-S", s}, true
	}
	return []string{"tmux"}, true
}

// SessionName is `timeout 2 tmux … display-message -p -t <pane> '#S'` (D-TBD-go-hook-tmux-bound-kill: a tmux that outlives
// the bound while ignoring TERM is waited for by `timeout` and killed here at the bound), answered as `$( )` keeps it: stdout whatever
// the exit status, "" when it cannot run. The bash skips the question when PATH holds neither `timeout` nor
// `gtimeout`, and so does this, though the bound here is Go's own (2 s, with any grandchild holding the pipe cut too).
// found and command are the core's `command -v` and process start (proc.Found, proc.Command), which on Windows look a
// name up and start it as MSYS2's bash does.
func SessionName(home, pane, tmuxEnv string, found func(string) bool, command func(context.Context, string, ...string) *exec.Cmd) string {
	if !found("timeout") && !found("gtimeout") {
		return ""
	}
	argv, ok := Argv(home, tmuxEnv)
	if !ok {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := command(ctx, argv[0], append(argv[1:], "display-message", "-p", "-t", pane, "#S")...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.WaitDelay = 100 * time.Millisecond
	_ = cmd.Run()
	return strings.TrimRight(out.String(), "\n")
}
