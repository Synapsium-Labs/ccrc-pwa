package proc

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"time"
)

// Result is one bounded run: what it printed, how it ended and whether the bound cut it.
type Result struct {
	Out  []byte // stdout (stderr too when merged)
	Rc   int    // the exit status; 124 when the bound cut it (as GNU `timeout` answers), 127 when it could not start
	Hung bool   // the bound cut it, or it exited 124 itself (`(( $? == 124 ))`, the bash's one hung test)
}

// D-TBD-go-hook-net-group-kill: the bound's expiry signals the group TERM, then KILL 100 ms later (the classify group kill's
// reasoning, group_unix.go); GNU `timeout` signals TERM only.
// Run is `timeout <bound> name args…` with stdin given, stderr dropped (merged into Out when merge: `2>&1`), the
// process's own environment plus extra (NAME=value), and a process group of its own that the bound's expiry signals as a
// whole (bindGroup). bound <= 0 is unbounded. It keeps every distinction a caller needs: the exit status, and the cut.
func Run(bound time.Duration, stdin []byte, extra []string, merge bool, name string, args ...string) Result {
	return runFull(bound, stdin, extra, merge, nil, name, args)
}

// RunWith is Run with data handed to the process as files, as bash's `<( … )` hands it: an argument that is exactly
// "@fd<N>" names input N. Where the platform has /dev/fd the data goes through a pipe the process opens as /dev/fd/<n>,
// so nothing of it is written to disk; elsewhere (no /dev/fd) it goes through a temporary file, removed when the run ends.
func RunWith(bound time.Duration, inputs [][]byte, name string, args ...string) Result {
	args = append([]string(nil), args...)
	var files []*os.File
	var writers []func()
	defer func() {
		for _, f := range files {
			_ = f.Close()
		}
	}()
	for i, data := range inputs {
		tok := "@fd" + strconv.Itoa(i)
		at := -1
		for j, a := range args {
			if a == tok {
				at = j
			}
		}
		if at < 0 {
			continue
		}
		if runtime.GOOS == "windows" {
			// D-TBD-go-hook-runwith-temp-windows: a native program cannot hand an MSYS2 one a pipe past fd 2, so the
			// data is a file in the user's %TEMP% (the profile's own ACL; Go's 0600 is only read-only-or-not there),
			// removed when the run ends; a hook killed mid-run leaves it. The bash's `<( … )` puts nothing on disk.
			name, err := tempInput(data)
			if err != nil {
				return Result{Rc: 127}
			}
			defer os.Remove(name)
			args[at] = name
			continue
		}
		r, w, err := os.Pipe()
		if err != nil {
			return Result{Rc: 127}
		}
		files = append(files, r)
		args[at] = "/dev/fd/" + strconv.Itoa(3+len(files)-1)
		writers = append(writers, func() { _, _ = w.Write(data); _ = w.Close() })
		defer w.Close() // closes the write end on every path (a process that never reads does not hold the writer)
	}
	for _, w := range writers {
		go w()
	}
	return runFull(bound, nil, nil, false, files, name, args)
}

func runFull(bound time.Duration, stdin []byte, extra []string, merge bool, files []*os.File, name string, args []string) Result {
	ctx := context.Background()
	if bound > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, bound)
		defer cancel()
	}
	cmd := Command(ctx, name, args...)
	if len(extra) > 0 {
		cmd.Env = append(os.Environ(), extra...)
	}
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	cmd.ExtraFiles = files
	var out bytes.Buffer
	cmd.Stdout = &out
	if merge {
		cmd.Stderr = &out
	}
	if bound > 0 {
		bindGroup(cmd)
		cmd.WaitDelay = 100 * time.Millisecond
	}
	err := cmd.Run()
	if err == nil || errors.Is(err, exec.ErrWaitDelay) { // a child that exited 0 with a grandchild holding the pipe is a success
		return Result{Out: out.Bytes()}
	}
	if ctx.Err() != nil {
		return Result{Out: out.Bytes(), Rc: 124, Hung: true}
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		rc := ee.ExitCode()
		if rc < 0 {
			rc = 128 + 9 // killed by a signal
		}
		return Result{Out: out.Bytes(), Rc: rc, Hung: rc == 124}
	}
	return Result{Rc: 127}
}

// Sub is what a shell's `$( )` keeps of a Result's stdout: no NUL byte, no trailing newline.
func (r Result) Sub() string { return sub(r.Out) }

// tempInput writes data to a new file in the user's %TEMP% and names it: how a Windows run hands an MSYS2 program data
// a pipe or its command line cannot carry (RunWith's inputs, JQ's --arg values). The caller removes it.
func tempInput(data []byte) (string, error) {
	f, err := os.CreateTemp("", "ccrc-hook-*")
	if err != nil {
		return "", err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}
