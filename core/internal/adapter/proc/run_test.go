package proc

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Run is `timeout <bound> cmd`: the exit status and the cut are two answers, stdin is given, stderr is dropped or merged.
func TestRun(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a #!/bin/sh stand-in cannot be exec'd by a native Windows program")
	}
	bin := t.TempDir()
	script := "#!/bin/sh\ncase \"$1\" in\n sleep) sleep 30;;\n exit) echo out; echo err >&2; exit \"$2\";;\n cat) cat;;\n env) echo \"$CCRC_T\";;\nesac\n"
	if err := os.WriteFile(filepath.Join(bin, "stub"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	stub := filepath.Join(bin, "stub")
	if r := Run(0, nil, nil, false, stub, "exit", "0"); r.Rc != 0 || r.Hung || string(r.Out) != "out\n" {
		t.Errorf("stderr is dropped: %+v", r)
	}
	if r := Run(0, nil, nil, true, stub, "exit", "2"); r.Rc != 2 || r.Hung || string(r.Out) != "out\nerr\n" {
		t.Errorf("a status that is the client's own refusal, stderr merged: %+v", r)
	}
	if r := Run(0, nil, nil, false, stub, "exit", "124"); r.Rc != 124 || !r.Hung {
		t.Errorf("a child that exits 124 reads as hung, as the bash's `$? == 124` does: %+v", r)
	}
	if r := Run(0, []byte("in"), nil, false, stub, "cat"); string(r.Out) != "in" {
		t.Errorf("stdin: %+v", r)
	}
	if r := Run(0, nil, []string{"CCRC_T=x"}, false, stub, "env"); r.Sub() != "x" {
		t.Errorf("extra environment: %+v", r)
	}
	if r := Run(0, nil, nil, false, filepath.Join(bin, "absent")); r.Rc != 127 || r.Hung {
		t.Errorf("a program that cannot start: %+v", r)
	}
	t0 := time.Now()
	r := Run(300*time.Millisecond, nil, nil, false, stub, "sleep")
	if !r.Hung || r.Rc != 124 || time.Since(t0) > 5*time.Second {
		t.Errorf("a cut: %+v after %v", r, time.Since(t0))
	}
	if !strings.HasSuffix(Result{Out: []byte("a\x00b\n\n")}.Sub(), "ab") {
		t.Error("Sub is `$( )`")
	}
}

// RunWith hands the process its data as files, a pipe where the platform has /dev/fd, and keeps nothing on disk.
func TestRunWith(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no /dev/fd and no #!/bin/sh stand-in")
	}
	before, _ := os.ReadDir(os.TempDir())
	big := strings.Repeat("x", 3<<20) // more than a pipe holds: the writer goroutine feeds it as the process reads
	r := RunWith(5*time.Second, [][]byte{[]byte("one"), []byte(big), nil}, "sh", "-c", `cat "$0"; echo; cat "$1" | wc -c; wc -c < "$2"`, "@fd0", "@fd1", "@fd2")
	if got := strings.Fields(string(r.Out)); len(got) != 3 || got[0] != "one" || got[1] != "3145728" || got[2] != "0" || r.Rc != 0 {
		t.Errorf("%+v", r)
	}
	if after, _ := os.ReadDir(os.TempDir()); len(after) != len(before) {
		t.Errorf("a file was left in the temporary directory: %d before, %d after", len(before), len(after))
	}
	// a process that never reads its input does not hold the run past its end
	if r := RunWith(5*time.Second, [][]byte{[]byte(big)}, "sh", "-c", "echo done", "@fd0"); strings.TrimSpace(string(r.Out)) != "done" {
		t.Errorf("%+v", r)
	}
}

// A child that exits 0 while a grandchild holds its stdout open is a success with what it printed, never "could not start".
func TestRunLingeringPipeHolderIsSuccess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no sh")
	}
	r := Run(5*time.Second, nil, nil, false, "sh", "-c", "echo out; (sleep 3 >/dev/null 2>&1 &) ; exit 0")
	if r.Rc != 0 || r.Hung || strings.TrimSpace(string(r.Out)) != "out" {
		t.Errorf("%+v", r)
	}
}
