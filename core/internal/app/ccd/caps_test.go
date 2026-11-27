package ccd

import (
	"bytes"
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"
)

// capsIO: a home whose roster is a readable regular file, and a body at /b that reads as body or fails with readErr.
func capsIO(out, errb *bytes.Buffer, body string, readErr error, verbs []string) IO {
	return IO{Stdout: out, Stderr: errb, Home: "/h", BodyPath: "/b", GoVerbs: verbs,
		ReadFile: func(p string) ([]byte, error) {
			if p == "/b" {
				return []byte(body), readErr
			}
			return nil, nil
		},
		Stat:              func(string) (fs.FileInfo, error) { return fstest.MapFS{"r": {}}.Stat("r") },
		UserName:          func() string { return "u" },
		BashPath:          func(p string) string { return p },
		PoolSyncInstalled: func(string) bool { return false }}
}

// Bash dies at its module top level, before any verb's own checks, when the roster is not there: so does the core.
func TestCapsMeetsTheRosterBeforeItsUsage(t *testing.T) {
	var out, errb bytes.Buffer
	x := capsIO(&out, &errb, "", nil, nil)
	x.Stat = func(string) (fs.FileInfo, error) { return nil, fs.ErrNotExist }
	want := "ccd: no account roster at /h/.ccrc/accounts.sh — generate it from ~/.ccrc/accounts.json (deploy/deploy.sh, or `ccrc install`)\n"
	if rc := Main([]string{"caps", "--json"}, x); rc != 1 || out.Len() != 0 || errb.String() != want {
		t.Fatalf("rc=%d out=%q err=%q", rc, out.String(), errb.String())
	}
}

// An empty HOME is refused before any path is built from it: never read against the working directory.
func TestAnEmptyHomeIsRefusedBeforeAnyRead(t *testing.T) {
	var out, errb bytes.Buffer
	x := capsIO(&out, &errb, "x\ncmd_caps() {\n  echo a\n}\n", nil, nil)
	read := false
	x.Home = ""
	x.Stat = func(string) (fs.FileInfo, error) { read = true; return nil, fs.ErrNotExist }
	x.ReadFile = func(string) ([]byte, error) { read = true; return nil, nil }
	x.PoolSyncInstalled = func(string) bool { read = true; return false }
	want := "ccd: HOME is empty or unset, so there is no home to read ccd's files under; nothing was run\n"
	if rc := Main([]string{"caps"}, x); rc != 1 || out.Len() != 0 || read || errb.String() != want {
		t.Fatalf("rc=%d read=%v out=%q err=%q", rc, read, out.String(), errb.String())
	}
}

func TestCapsPrintsTheListThenItsGoVerbs(t *testing.T) {
	var out, errb bytes.Buffer
	body := "x\ncmd_caps() {\n  echo a\n}\n"
	if rc := Main([]string{"caps"}, capsIO(&out, &errb, body, nil, []string{"caps"})); rc != 0 {
		t.Fatalf("rc=%d err=%q", rc, errb.String())
	}
	if out.String() != "a\ngo:caps\n" {
		t.Fatalf("out=%q", out.String())
	}
}

func TestCapsRefusesAnArgumentAsBashDoes(t *testing.T) {
	var out, errb bytes.Buffer
	if rc := Main([]string{"caps", "--json"}, capsIO(&out, &errb, "", nil, nil)); rc != 1 || errb.String() != "ccd: usage: ccd caps\n" || out.Len() != 0 {
		t.Fatalf("rc=%d out=%q err=%q", rc, out.String(), errb.String())
	}
}

func TestCapsReportsAnUnreadableBody(t *testing.T) {
	var out, errb bytes.Buffer
	if rc := Main([]string{"caps"}, capsIO(&out, &errb, "", errors.New("gone"), nil)); rc != 1 || out.Len() != 0 {
		t.Fatalf("rc=%d out=%q", rc, out.String())
	}
}
