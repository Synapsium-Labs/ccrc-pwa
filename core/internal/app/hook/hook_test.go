package hook

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

type reader struct {
	r    *strings.Reader
	read *bool
}

func (x reader) Read(p []byte) (int, error) {
	n, err := x.r.Read(p)
	if err != nil {
		*x.read = true
	}
	return n, err
}

type failing struct{}

func (failing) Read([]byte) (int, error) { return 0, errors.New("EIO") }

// The header contract: exit 0 on every path, stdout only the event's own envelope (none here). With no pane and no job
// directory the hook finds no session, so it ends having read its payload and written nothing.
func TestNoSessionExitsZeroSilently(t *testing.T) {
	env := map[string]string{"HOME": "/h"}
	for name, e := range map[string]map[string]string{
		"no pane, no job dir":          env,
		"no HOME":                      {},
		"a job dir with no session id": {"HOME": "/h", "CLAUDE_JOB_DIR": "/j"},
	} {
		var out bytes.Buffer
		drained := false
		in := reader{strings.NewReader(`{"hook_event_name":"Stop","session_id":"s"}`), &drained}
		if rc := Main(in, IO{Stdout: &out, Getenv: func(k string) string { return e[k] }}); rc != 0 || out.Len() != 0 {
			t.Errorf("%s: rc %d, stdout %q", name, rc, out.String())
		}
		if name != "no HOME" && !drained {
			t.Errorf("%s: stdin was not read to its end, as bash's payload=$(cat) reads it", name)
		}
	}
	if rc := Main(failing{}, IO{Stdout: &bytes.Buffer{}, Getenv: func(k string) string { return env[k] }}); rc != 0 {
		t.Errorf("an unreadable stdin: rc %d", rc)
	}
}

// A Go panic exits 2, which Claude Code reads as a blocking answer: the entry recovers it, answers 0 and prints
// nothing on stdout (controller ruling, wave 2 Task 2; stdout is held in a buffer until the run ends, then written whole).
// It says so on stderr, one line, so a panic inside a deny arm, which allows where the bash would answer, is not silent
// (final review finding 10).
func TestPanicExitsZeroSilently(t *testing.T) {
	env := map[string]string{"HOME": "/h", "TMUX_PANE": "%1", "CCRC_DOOR_NONCE_SHA256": strings.Repeat("a", 64)}
	var out, errw bytes.Buffer
	x := IO{Stdout: &out, Stderr: &errw, Getenv: func(k string) string { return env[k] }, Pid: 1,
		TmuxSession: func(string, string, string) string { panic("tmux adapter blew up") }}
	if rc := Main(strings.NewReader(`{"hook_event_name":"Stop"}`), x); rc != 0 || out.Len() != 0 {
		t.Errorf("rc %d, stdout %q", rc, out.String())
	}
	if errw.String() != "ccrc-core: hook panic: tmux adapter blew up\n" {
		t.Errorf("stderr %q", errw.String())
	}
	// a multi-line value is still one line: its newlines (and the backslash that escapes them) are escaped (fix round 2)
	errw.Reset()
	x.TmuxSession = func(string, string, string) string { panic("first\nsecond\r\nthird \\n") }
	if rc := Main(strings.NewReader(`{"hook_event_name":"Stop"}`), x); rc != 0 || out.Len() != 0 {
		t.Errorf("multi-line: rc %d, stdout %q", rc, out.String())
	}
	if errw.String() != `ccrc-core: hook panic: first\nsecond\r\nthird \\n`+"\n" {
		t.Errorf("multi-line: stderr %q is not one line with its newlines escaped", errw.String())
	}
	x.Stderr = nil // an IO without one still answers 0
	if rc := Main(strings.NewReader(`{"hook_event_name":"Stop"}`), x); rc != 0 {
		t.Errorf("rc %d with no stderr", rc)
	}
}
