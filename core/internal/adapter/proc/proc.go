// Package proc is ring L3: the child processes the session hook reaches through PATH, as ccd/session-hook.sh reaches them
// (so a test's stand-in on PATH bites in both implementations): git, for the graph measurement, and `ccrc test
// --classify-shell`, the test route's one reader. Each answers what a shell's `$( )` keeps of its stdout and whether it
// exited 0; a process that cannot start or is cut at its bound is a failure, never a partial answer.
package proc

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// sub is `$( … )`: no NUL byte, no trailing newline.
func sub(b []byte) string {
	return strings.TrimRight(strings.ReplaceAll(string(b), "\x00", ""), "\n")
}

// run starts name with args, with no stdin and stderr discarded (`2>/dev/null`), within bound when it is positive.
func run(bound time.Duration, name string, args ...string) (string, bool) {
	ctx := context.Background()
	if bound > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, bound)
		defer cancel()
	}
	cmd := Command(ctx, name, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	if bound > 0 {
		bindGroup(cmd)
		cmd.WaitDelay = 100 * time.Millisecond // a grandchild holding the pipe open does not outlive the bound
	}
	if err := cmd.Run(); err != nil {
		return "", false
	}
	return sub(out.Bytes()), true
}

// Git is `git -C dir args…`: unbounded, as the bash's calls are.
func Git(dir string, args ...string) (string, bool) {
	return run(0, "git", append([]string{"-C", dir}, args...)...)
}

// JQ is `jq args… <<<"$payload"` (the module the mail hold keeps as a jq process): stdin given, stderr discarded,
// unbounded as the bash's call is; the raw stdout, which the caller reads as the bash does.
//
// On Windows every `--arg name value` goes to jq as `--rawfile name <file>` (D-TBD-go-hook-windows-jq-arg): MSYS2 cuts a
// command-line argument at 8186 characters and a quote-dense one past about 16 KB cannot start at all (measured), where
// the bash hook hands jq the whole text MSYS2 to MSYS2. jq reads a --rawfile value into its variable and $ARGS.named as
// it reads an --arg one. handed is false when jq was never asked because a value's file could not be written (fix round
// 2, re-review N2): the bash needs no disk for them, so the caller must not read that as jq's answer.
func JQ(stdin []byte, args ...string) (out []byte, ok, handed bool) {
	if runtime.GOOS == "windows" {
		args = append([]string(nil), args...)
		for i := 0; i+2 < len(args); i++ {
			if args[i] != "--arg" {
				continue
			}
			name, err := tempInput([]byte(args[i+2]))
			if err != nil {
				return nil, false, false
			}
			defer os.Remove(name)
			args[i], args[i+2] = "--rawfile", name
			i += 2
		}
	}
	cmd := Command(context.Background(), "jq", args...)
	cmd.Stdin = bytes.NewReader(stdin)
	var b bytes.Buffer
	cmd.Stdout = &b
	err := cmd.Run()
	return b.Bytes(), err == nil, true
}

// classifyBound is the 5 s of `timeout 5` (a variable so the test can shorten it).
var classifyBound = 5 * time.Second

// ClassifyShell is `${hooktmo:+"$hooktmo" 5} ccrc test --classify-shell -- "$cmd"`: bounded at 5 s when the caller says the bash
// would hold a `timeout` (a session identified by its pane has one), unbounded when not (the job-directory fallback has none).
func ClassifyShell(cmd string, bounded bool) string {
	var bound time.Duration
	if bounded {
		bound = classifyBound
	}
	if runtime.GOOS == "windows" {
		// D-TBD-go-hook-windows-argmax: on Windows a native program's argument travels in its command line, where the bash
		// hook's (MSYS2 to MSYS2) does not: a command past 8186 characters reached the classifier cut there, its tail lost,
		// and a quote-dense one past about 16 KB (CygwinQuoteArg doubles its quotes) reached none (final review finding 3,
		// measured). So every command goes on stdin to MSYS2's bash, which hands it to ccrc as the bash does, its trailing
		// newlines kept: one path on Windows, never a length threshold. `read -d ''` is a builtin: `c=$(cat)` forked a
		// subshell and a cat, and measured 2.5 s at the median against the argument path's 0.54 s on a loaded box, past
		// half the 5 s bound; the builtin measured 0.64 s (a second probe: 0.09 s against 0.68 s, p95 4.7 s).
		// The bound starts where the bash hook's does, at ccrc: MSYS2's `timeout` inside the shell, as `"$hooktmo" 5 ccrc`,
		// so the extra bash start is not charged to it; the Go bound outside is only a backstop, twice as long, and it too
		// starts when the shell is up (classifyOnWindows).
		// The answer is the bash's `$( … ) || tverdict=""`: anything but a clean exit is no answer.
		return classifyOnWindows(strings.NewReader(cmd), bound)
	}
	out, _ := run(bound, "ccrc", "test", "--classify-shell", "--", cmd)
	return out
}

// classifyOnWindows is ClassifyShell's Windows path, the command read from stdin (a reader, so a test can hold the start
// back). The answer is the bash's `$( … ) || tverdict=""`: anything but a clean exit is no answer.
//
// The backstop counts from where the bash hook's own bound starts (fix round 2, re-review N4): the shell prints one byte
// on stderr when it has read the command, just before it execs `timeout` around ccrc, and the Go timer starts there.
// The MSYS2 bash start before it is Go's alone (the bash hook's `timeout` starts in a shell already running), so it is
// never charged to the bound. ccrc's stderr is dropped, as the bash's `2>/dev/null` drops it.
//
// D-TBD-go-hook-windows-classify-slow: the classifier itself answers slowly on Windows, in both hooks (about 5 to 18 s
// over a 9 KB command, measured in the fix wave), past the 5 s a paned session gives it. Cut there, it answers nothing,
// and the test route fails open: the command runs as written, outside `ccrc test`'s slice and queue. That routes
// nothing; it is not a deny the hook owes for safety (no account, child, merge or build row reads the classifier).
func classifyOnWindows(stdin io.Reader, bound time.Duration) string {
	script := `IFS= read -r -d '' c; exec "$0" test --classify-shell -- "$c" 2>/dev/null`
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var up sync.Once
	backstop := time.AfterFunc(time.Hour, cancel) // armed at the shell's byte, below
	backstop.Stop()
	if bound > 0 {
		script = `IFS= read -r -d '' c; printf . >&2; exec timeout ` + strconv.FormatFloat(bound.Seconds(), 'f', -1, 64) +
			` "$0" test --classify-shell -- "$c" 2>/dev/null`
	}
	c := Command(ctx, "bash", "-c", script, "ccrc")
	c.Stdin = stdin
	var out bytes.Buffer
	c.Stdout = &out
	if bound > 0 {
		c.Stderr = writerFunc(func(p []byte) (int, error) {
			up.Do(func() { backstop.Reset(2 * bound) })
			return len(p), nil
		})
		bindGroup(c)
		c.WaitDelay = 100 * time.Millisecond
	}
	err := c.Run()
	backstop.Stop()
	if err != nil && !errors.Is(err, exec.ErrWaitDelay) {
		return ""
	}
	return sub(out.Bytes())
}

// writerFunc is an io.Writer from a function.
type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }
