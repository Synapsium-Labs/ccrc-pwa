// ccrc-core is ccrc's Go core (spec 2026-11-24): one binary, its first argument (or the name it runs under) the entry point.
// This file is ring L5, the only place adapters meet the entry points.
package main

import (
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	core "ccrc/core"
	"ccrc/core/internal/adapter/host"
	"ccrc/core/internal/adapter/lock"
	"ccrc/core/internal/adapter/proc"
	"ccrc/core/internal/adapter/regfs"
	"ccrc/core/internal/adapter/tmux"
	"ccrc/core/internal/adapter/units"
	"ccrc/core/internal/app/ccd"
	"ccrc/core/internal/app/hook"
	"ccrc/core/internal/kernel"
)

func main() {
	args := os.Args[1:]
	name := strings.TrimSuffix(filepath.Base(os.Args[0]), ".exe")
	if name == "ccrc-core" {
		if len(args) == 0 {
			fmt.Fprint(os.Stderr, "usage: ccrc-core <entry> [args...]\n")
			os.Exit(2)
		}
		name, args = args[0], args[1:]
	}
	switch name {
	case "ccd":
		os.Exit(ccd.Main(args, ccdIO()))
	case "hook": // the event is stdin's hook_event_name, so any argv is ignored, as bash ignores it
		// A closed reader of stdout is a failed write (EPIPE), never a SIGPIPE death. Where the bash traps PIPE (the
		// refusal's block, the steer print) both read the failure and go on; where it does not, the bash dies at its
		// print, and the Go hook mirrors that where anything follows the print: the SessionStart card stops the run there
		// (hook.go's SessionStart arm). Every other print the bash leaves untrapped is the last act of its event (the
		// PreToolUse envelope, the prompt's, the approval's), and the Go hook writes its held output at the end, so the
		// effects match. D-TBD-go-hook-sigpipe-status: the bash's exit status there is 141, the Go hook's 0 (the wave's
		// exit-0 contract); Claude Code, whose read end is gone, sees neither.
		// D-TBD-go-hook-closed-stdout (ruled accepted): a stdout CLOSED at start cannot be seen here. Go's runtime reopens a closed fd 1 on
		// /dev/null read-write before main, which is also what a caller's `stdio: 'ignore'` (Node) or DEVNULL (Python)
		// hands a process (all O_RDWR, measured), so no test tells them apart; the print reads as delivered where the
		// bash's printf fails with EBADF: the refusal's line stands with no pre line after it, the steer receipt is
		// written, and a compact SessionStart publishes its served marker for a card that reached no one (the false
		// positive the bash's emit-then-mark order exists to avoid). Ruled accepted (Task 8b review): out of contract,
		// since Claude Code always reads the hook's stdout through a pipe. On Windows the difference does not arise: a native
		// program MSYS2's bash starts with fd 1 closed has no usable stdout handle, so this print fails as the bash's does
		// (measured in the refusal and steer suites, Task 9b gate round).
		// The operator's way back is effective at once: a `hook` line in ccd-go-off hands this very call to the bash hook,
		// whatever settings.json registers (no installer run), with this process's stdin, environment and status.
		if h := os.Getenv("HOME"); (regfs.OS{}).GoOff(h, kernel.HookEntry) {
			os.Exit(hookBash(h))
		}
		signal.Ignore(syscall.SIGPIPE)
		os.Exit(hook.Main(os.Stdin, hook.IO{Stdout: hookStdout{os.Stdout}, Stderr: os.Stderr, Getenv: os.Getenv, LookupEnv: os.LookupEnv, FS: regfs.OS{Flock: lock.Hold}, TmuxSession: func(home, pane, env string) string {
			return tmux.SessionName(home, pane, env, proc.Found, proc.Command)
		},
			NowMs: func() int64 { return time.Now().UnixMilli() }, Pid: os.Getpid(), GOOS: runtime.GOOS,
			Git: proc.Git, Classify: proc.ClassifyShell, Found: proc.Found, JQ: proc.JQ, LibDir: hookLib(),
			Run: hookRun, Rand: func() int { return rand.Intn(32768) }, RunWith: hookRunWith,
			Trap: hookTrap, Nonce: hookNonce, Sleep: time.Sleep, LocaleInstalled: host.LocaleInstalled, Lock: rowLock{}}))
	default:
		fmt.Fprintf(os.Stderr, "ccrc-core: no entry point %s\n", name)
		os.Exit(2)
	}
}

// hookTrap is the approval wait's `trap 'exit 0' TERM INT HUP`: from then on each ends the process at once, exit 0, and
// the hook's held output goes with it (it prints nothing).
func hookTrap() { armTrap(func() { os.Exit(0) }) }

// armTrap catches TERM, INT and HUP for exit, but a signal the process was started with ignored stays ignored, as bash
// leaves a signal ignored on entry to a non-interactive shell untouched by `trap`.
// D-TBD-go-hook-apr-trap-at-once: what still differs is the timing. Bash runs the trap only once its foreground child (the
// client, the verifier) has exited; this exits at once. Neither prints. The wait's children run unbounded, so in the hook's
// own process group, as bash's are, and a TERM to the hook's group reaches an in-flight request either way; one sent to the
// hook alone leaves the child running here, where bash would wait for it, so a held row stays pending (bash's documented
// cost).
// D-TBD-go-hook-windows-signals: on Windows MSYS2's `kill -TERM` (or INT, HUP) ends a native program at once
// (TerminateProcess; its MSYS2 parent reads 143, measured with a TERM handler that never ran), so this trap never runs
// there and the wait ends with that status, where the bash's trap exits 0; both print nothing, and a held row stays
// pending either way. Go's own Windows events (Ctrl+C, a console close) still reach it as INT and TERM.
func armTrap(exit func()) {
	c := make(chan os.Signal, 1)
	for _, s := range []os.Signal{syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP} {
		if !signal.Ignored(s) {
			signal.Notify(c, s)
		}
	}
	go func() { <-c; exit() }()
}

// hookNonce is the approval request's nonce: 16 bytes from the system's cryptographic source, as lowercase hex.
// D-TBD-go-hook-nonce-source: the bash reads them through `od` on PATH, so a box whose od fails answers `nonce-failed`
// there and sends here; the request is only a request (a ruling is still verified before anything prints).
func hookNonce() (string, bool) {
	b := make([]byte, 16)
	if _, err := crand.Read(b); err != nil {
		return "", false
	}
	return hex.EncodeToString(b), true
}

// hookLib is the lib/ directory beside the core, which the hook reads first (as the bash reads its own directory's lib/).
func hookLib() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), "lib")
	}
	return ""
}

func ccdIO() ccd.IO {
	home := os.Getenv("HOME") // as bash reads it: an empty or unset one is the entry point's to refuse, never a fallback
	body := ""
	if exe, err := os.Executable(); err == nil {
		body = filepath.Join(filepath.Dir(exe), "..", "ccd") // installed: ~/.local/libexec/ccrc/core/ccrc-core -> ../ccd
	}
	goVerbs, err := kernel.GoVerbs(core.EntriesJSON, runtime.GOOS)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ccrc-core: %v\n", err)
		os.Exit(2)
	}
	return ccd.IO{Stdout: os.Stdout, Stderr: os.Stderr, Home: home, BodyPath: body, GoVerbs: goVerbs,
		ReadFile: os.ReadFile, Stat: os.Stat, UserName: host.UserName, BashPath: host.BashPath,
		PoolSyncInstalled: units.PoolSyncInstalled}
}

// hookRun is the hook's bounded process, the adapter's answer in the hook's own type.
func hookRun(bound time.Duration, stdin []byte, extra []string, merge bool, name string, args ...string) hook.RunResult {
	r := proc.Run(bound, stdin, extra, merge, name, args...)
	return hook.RunResult{Out: r.Out, Rc: r.Rc, Hung: r.Hung}
}

// hookRunWith is hookRun with data handed to the process as files.
func hookRunWith(bound time.Duration, inputs [][]byte, name string, args ...string) hook.RunResult {
	r := proc.RunWith(bound, inputs, name, args...)
	return hook.RunResult{Out: r.Out, Rc: r.Rc, Hung: r.Hung}
}

// rowLock is the hook's stable row lock port over adapter/lock (the one owner of the mechanism ccd takes too).
type rowLock struct{}

func (rowLock) row(reg, id string) lock.Row {
	return lock.Row{Reg: reg, ID: id, Pid: os.Getpid(), Rand: func() int { return rand.Intn(32768) }}
}

func (l rowLock) Acquire(reg, id string, wait time.Duration, vanished func() bool) (hook.Held, bool, bool) {
	h, o := l.row(reg, id).Acquire(wait, vanished)
	if o != lock.Acquired {
		return nil, false, o == lock.Vanished
	}
	return h, true, false
}

func (l rowLock) Generation(reg, id string) (string, bool) { return l.row(reg, id).Generation() }

func (rowLock) Open(p string) (hook.Held, error) {
	h, err := lock.OpenRead(p)
	if err != nil {
		return nil, err
	}
	return h, nil
}

func (rowLock) ProcNames(prefix string) bool        { return lock.ProcNames(prefix) }
func (rowLock) Mktemp(prefix string) (string, bool) { return lock.Mktemp(prefix) }

// hookBash runs the bash hook (`~/.cc-sessions/session-hook.sh`) in place of the core's, as the bash mode's registered
// command `bash "$HOME/.cc-sessions/session-hook.sh"` runs it: `bash` from PATH, the same stdin, stdout, stderr and
// environment, and the status a shell would answer. So a missing script is bash's own message and 127, what Claude Code
// sees from that command (N5); a bash killed by a signal is 128+n (N4); a bash that cannot start is a shell's
// `command not found`, 127. D-TBD-go-hook-off-status: these are the one path where the Go hook exits non-zero, because
// it is the bash hook's status, passed through.
func hookBash(home string) int {
	script := filepath.Join(home, ".cc-sessions", "session-hook.sh")
	c := proc.Command(context.Background(), "bash", script)
	c.Stdin, c.Stdout, c.Stderr = os.Stdin, os.Stdout, os.Stderr
	err := c.Run()
	var ee *exec.ExitError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &ee):
		if ws, ok := ee.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
			return 128 + int(ws.Signal())
		}
		// On Windows an MSYS2 bash a signal ended reaches a native parent as the signal shifted left 8 (TERM: 3840; a
		// status of its own is never above 255). The bash mode's `bash -c 'bash …'` hands Claude Code that 3840, but
		// this process is started by MSYS2's bash too, which keeps 8 bits of its status (3840 would arrive as 0, a
		// success): so 128+n, what MSYS2's shell reads. D-TBD-go-hook-off-status: 143 here where the bash mode's 3840.
		if c := ee.ExitCode(); runtime.GOOS == "windows" && c > 255 && c&0xff == 0 && c>>8 < 128 {
			return 128 + c>>8
		}
		return ee.ExitCode()
	default:
		fmt.Fprintf(os.Stderr, "ccrc-core: bash: command not found (%v)\n", err)
		return 127
	}
}

// hookStdout is the hook's stdout, its closed-reader failure spelled as on Linux: Windows answers a write to a pipe
// whose reader is gone with ERROR_NO_DATA (232, measured) or ERROR_BROKEN_PIPE (109), never EPIPE, so the SessionStart
// card's stop (D-TBD-go-hook-sigpipe-status) would not see it, where MSYS2's bash dies at that print as Linux's does.
type hookStdout struct{ f *os.File }

func (w hookStdout) Write(b []byte) (int, error) {
	n, err := w.f.Write(b)
	if en := syscall.Errno(0); runtime.GOOS == "windows" && errors.As(err, &en) && (en == 232 || en == 109) {
		err = syscall.EPIPE
	}
	return n, err
}
