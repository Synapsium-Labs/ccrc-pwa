//go:build windows

package proc

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"ccrc/core/internal/kernel"
)

// msysPath puts MSYS2's /usr/bin first on PATH (as a hook's PATH has it), or skips where there is none.
func msysPath(t *testing.T, first ...string) {
	t.Helper()
	bin := `C:\msys64\usr\bin`
	if _, err := os.Stat(filepath.Join(bin, "bash.exe")); err != nil {
		t.Skip("no MSYS2 at " + bin)
	}
	t.Setenv("PATH", strings.Join(append(first, bin, os.Getenv("PATH")), string(os.PathListSeparator)))
}

// Every argument reaches an MSYS2 program as written, glob characters, quotes and backslashes included (Go's own quoting
// leaves `*` bare, which the MSYS2 runtime expands as file names).
func TestCommandArgumentsReachAnMsysProgramExactly(t *testing.T) {
	msysPath(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "match.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	// The runs of two and more backslashes are what the Microsoft rule loses for an MSYS2 program (MSYS2 halves them;
	// kernel.CygwinQuoteArg; the cases from feat/go-core-w3 37fdab42a among them).
	args := []string{"*", "*.txt", "[m]atch.txt", "a b", `a"b`, `a\b`, `a\`, `a\"b`, `C:\x\y\`, "", "?", "{a,b}", "~", "$HOME", "'q'", "l1\nl2", "x\n", "cat <<'EOF'\nnpm test\nEOF", `a\\b`, `\\\$(npm test)`, "cat <<EOF\n\\\\\\$(npm test)\nEOF",
		`\\\\`, `a b\\ c`, `x\\\"y`, `$'\303'`}
	cmd := Command(context.Background(), "printf", append([]string{`%s\0`}, args...)...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00")
	if strings.Join(got, "|") != strings.Join(args, "|") {
		t.Fatalf("an MSYS2 program read %q, want %q", got, args)
	}
	// CONTROL: Go's own quoting hands `*` bare, and the MSYS2 runtime globs it
	ctl := exec.Command(cmd.Path, `%s\0`, "*.txt")
	ctl.Dir = dir
	if b, _ := ctl.Output(); string(b) != "match.txt\x00" {
		t.Fatalf("control: Go's own quoting no longer globs (%q); the case above proves nothing", b)
	}
}

// An extensionless `#!` script on PATH (the ccrc-api and ccrc launchers, a test's stub) is found and run as bash runs it,
// and a .cmd beside it is never picked; a file MSYS2 does not call executable is found by `command -v` and not run.
func TestCommandRunsAScriptAsBashDoes(t *testing.T) {
	dir := t.TempDir()
	msysPath(t, dir)
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(dir, "tool"), []byte("#!/bin/sh\nprintf 'sh:%s|' \"$@\"\n"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "tool.cmd"), []byte("@echo cmd\r\n"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "plain"), []byte("echo plain\n"), 0o644))
	out, err := Command(context.Background(), "tool", "a b", "*", "l1\nl2").Output()
	if err != nil || string(out) != "sh:a b|sh:*|sh:l1\nl2|" {
		t.Fatalf("tool: %q, %v", out, err)
	}
	out, err = Command(context.Background(), filepath.Join(dir, "tool"), "x").Output()
	if err != nil || string(out) != "sh:x|" {
		t.Fatalf("tool by path: %q, %v", out, err)
	}
	if !Found("tool") || !Found("plain") || Found("absent-tool") {
		t.Fatal("Found is not `command -v`")
	}
	if err := Command(context.Background(), "plain").Run(); err == nil {
		t.Fatal("a file MSYS2 does not call executable ran")
	}
	// a `#!` script starts its interpreter directly (one process), `env` and one interpreter argument included
	must(os.WriteFile(filepath.Join(dir, "viaenv"), []byte("#!/usr/bin/env sh\nprintf 'env:%s|' \"$@\"\n"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "witharg"), []byte("#!/bin/sh -e\nfalse\necho not-reached\n"), 0o755))
	if out, err := Command(context.Background(), "viaenv", "a b").Output(); err != nil || string(out) != "env:a b|" {
		t.Fatalf("viaenv: %q, %v", out, err)
	}
	if out, _ := Command(context.Background(), "witharg").Output(); string(out) != "" {
		t.Fatalf("witharg: the interpreter's -e was dropped: %q", out)
	}
	if sb := shebang(filepath.Join(dir, "tool")); len(sb) != 1 || !strings.EqualFold(filepath.Base(sb[0]), "sh.exe") {
		t.Fatalf("shebang(tool) = %q, want the sh program alone", sb)
	}
	// a name only a .cmd answers is not found, as bash says it, and never reaches cmd.exe
	must(os.WriteFile(filepath.Join(dir, "onlycmd.cmd"), []byte("@echo ran\r\n"), 0o755))
	if out, err := Command(context.Background(), "onlycmd").Output(); err == nil || string(out) != "" {
		t.Fatalf("a name only a .cmd answers ran: %q %v", out, err)
	}
	if _, err := exec.LookPath("onlycmd"); err != nil {
		t.Fatalf("control: exec.LookPath does not find onlycmd.cmd (%v); the case above proves nothing", err)
	}
	// CONTROL: exec's own lookup picks the .cmd (or nothing), never the script bash runs
	if p, err := exec.LookPath("tool"); err == nil && !strings.HasSuffix(strings.ToLower(p), ".cmd") {
		t.Fatalf("control: exec.LookPath found %s", p)
	}
}

// A command past a Windows command line's length reaches the classifier whole, trailing newlines kept, as the bash hook
// hands it (MSYS2 to MSYS2); exec's own command line refused it (D-TBD-go-hook-windows-argmax).
func TestClassifyShellPastTheCommandLine(t *testing.T) {
	dir := t.TempDir()
	msysPath(t, dir)
	if err := os.WriteFile(filepath.Join(dir, "ccrc"), []byte("#!/bin/bash\nprintf '%s:%s' \"$1 $2 $3\" \"${#4}\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := strings.Repeat("x", 40000) + "\n\n"
	if got := ClassifyShell(cmd, true); got != "test --classify-shell --:40002" {
		t.Fatalf("the classifier read %q", got)
	}
	if got := ClassifyShell("npm test", true); got != "test --classify-shell --:8" {
		t.Fatalf("a short command: %q", got)
	}
}

// A command between 8 KB and the command line's limit reached the classifier cut at 8186 characters, its tail lost (final
// review finding 3, measured with both stub kinds), and a quote-dense one past about 16 KB reached none: CygwinQuoteArg
// doubles its quotes past 32767. The bash hook hands the classifier the whole text, so the Go hook takes the stdin path
// for every command on Windows. Both stub kinds: a `#!/bin/sh` script and a `#!/usr/bin/env bash` one.
func TestClassifyShellLongAndQuoteDense(t *testing.T) {
	for _, shebang := range []string{"#!/bin/sh", "#!/usr/bin/env bash"} {
		dir := t.TempDir()
		msysPath(t, dir)
		stub := shebang + "\nc=$4\nprintf '%s:%s:%s' \"$1 $2 $3\" \"${#c}\" \"${c#\"${c%???????}\"}\"\n"
		if err := os.WriteFile(filepath.Join(dir, "ccrc"), []byte(stub), 0o755); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct{ name, cmd string }{
			{"9 KB ending in npm test", strings.Repeat("y", 9000) + " && npm test"},
			{"17000 quotes", strings.Repeat(`"`, 17000) + " npm test"},
			{"a dense mix", strings.Repeat(`"a\b' `, 3000) + "npm test"},
		} {
			want := fmt.Sprintf("test --classify-shell --:%d:%s", len(tc.cmd), tc.cmd[len(tc.cmd)-7:])
			// unbounded: under load the stub's starts can pass the 5 s bound, which TestClassifyShell's cases pin on their own
			if got := ClassifyShell(tc.cmd, false); got != want {
				t.Errorf("%s, %s: the classifier read %.120q, want %q", shebang, tc.name, got, want)
			}
		}
	}
}

// A native program (node.exe) reads its command line by MSVCRT's rule, so it gets Go's own quoting: a backslash run and a
// glob character reach it exactly.
func TestCommandNativeProgramArguments(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("no node")
	}
	args := []string{`a\\b`, `C:\x\`, `*`, `q"t`}
	out, err := Command(context.Background(), "node", "-e", "process.stdout.write(process.argv.slice(1).join('|'))", "--",
		args[0], args[1], args[2], args[3]).Output()
	if err != nil || string(out) != strings.Join(args, "|") {
		t.Fatalf("node read %q (%v), want %q", out, err, strings.Join(args, "|"))
	}
}

// JSON naming a Windows path (a transcript_path, a cwd) reaches MSYS2's jq as `--argjson` text exactly: its escaped
// backslashes are runs of two, which MSYS2's runtime halves under the Microsoft rule, so the JSON jq parsed named
// another path, or no JSON at all (the wave-2 defect feat/go-core-w3 37fdab42a fixed there; kernel.CygwinQuoteArg).
func TestCommandHandsMsysJqAWindowsPathInJSON(t *testing.T) {
	msysPath(t)
	if _, _, ok := look("jq"); !ok {
		t.Skip("no jq in MSYS2's /usr/bin")
	}
	const tp = `C:\Users\op\.claude\projects\C--work\0189abcd.jsonl`
	obj := `{"transcript_path":"C:\\Users\\op\\.claude\\projects\\C--work\\0189abcd.jsonl","cwd":"D:\\\\share\\x"}`
	out, err := Command(context.Background(), "jq", "-nr", "--argjson", "o", obj, `$o.transcript_path + "|" + $o.cwd`).Output()
	if err != nil || string(out) != tp+`|D:\\share\x`+"\n" {
		t.Fatalf("jq read %q (%v), want %q", out, err, tp+`|D:\\share\x`)
	}
	// CONTROL: the Microsoft rule, which doubles a backslash only before a quote, hands MSYS2's jq other JSON
	p, _, _ := look("jq")
	ctl := exec.Command(p)
	ctl.SysProcAttr = &syscall.SysProcAttr{CmdLine: strings.Join([]string{kernel.MsysQuoteArg(p), `"-nr"`, `"--argjson"`, `"o"`,
		kernel.MsysQuoteArg(obj), kernel.MsysQuoteArg(`$o.transcript_path`)}, " ")}
	if b, _ := ctl.Output(); string(b) == tp+"\n" {
		t.Fatal("control: the Microsoft rule reached MSYS2's jq whole; the case above proves nothing")
	}
}

// The mail hold's `--arg strip <command>` carried the merge-stripped command in jq's command line, where MSYS2 cuts an
// argument at 8186 characters and a quote-dense one past about 16 KB cannot start at all (measured with jq.exe through
// Command); the bash hook hands jq the whole text. So on Windows JQ hands every `--arg` value over as a file
// (`--rawfile`), which jq reads into $ARGS.named and the variable alike.
func TestJQArgsReachJqWhole(t *testing.T) {
	msysPath(t)
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("no jq")
	}
	for _, s := range []string{strings.Repeat("y", 9000) + "END", strings.Repeat(`"`, 20000) + "END", "short", "", "a\nb\r\n"} {
		out, ok, _ := JQ([]byte(`{"x":1}`), "-j", "--arg", "s", s, "--arg", "t", "two", `"\($ARGS.named.s|length):\($s|.[-3:]):\($t):\(.x)"`)
		want := fmt.Sprintf("%d:%s:two:1", len(s), s[max(0, len(s)-3):])
		if !ok || string(out) != want {
			t.Errorf("len %d: jq read %.80q (ok %v), want %q", len(s), out, ok, want)
		}
	}
}

// On Windows the classifier's bound is MSYS2's `timeout` around ccrc, as the bash hook's `"$hooktmo" 5 ccrc`: a classifier
// that runs past it answers nothing, and well before the Go backstop (twice the bound) would cut it.
func TestClassifyShellBoundOnWindows(t *testing.T) {
	dir := t.TempDir()
	msysPath(t, dir)
	if err := os.WriteFile(filepath.Join(dir, "ccrc"), []byte("#!/bin/sh\nsleep 30\necho wrapped\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := classifyBound
	classifyBound = 2 * time.Second
	defer func() { classifyBound = old }()
	s := time.Now()
	if got := ClassifyShell("npm test", true); got != "" {
		t.Fatalf("a classifier past its bound answered %q", got)
	}
	if d := time.Since(s); d >= 2*classifyBound {
		t.Fatalf("cut after %v: the backstop, not the bound", d)
	}
}

// slowReader holds its first read back for d: the shell's start as the Go hook sees it, before the bash hook's bound.
type slowReader struct {
	d    time.Duration
	r    io.Reader
	once sync.Once
}

func (s *slowReader) Read(p []byte) (int, error) {
	s.once.Do(func() { time.Sleep(s.d) })
	return s.r.Read(p)
}

// The backstop counts from where the bash hook's own bound starts, at ccrc inside the shell (fix round 2, re-review N4):
// the extra MSYS2 bash start is Go's alone, so a slow one (here the command reaching the shell late, past twice the bound)
// must not cut an answer ccrc gives at once, which the bash hook would read.
func TestClassifyBackstopStartsAtTheShell(t *testing.T) {
	dir := t.TempDir()
	msysPath(t, dir)
	if err := os.WriteFile(filepath.Join(dir, "ccrc"), []byte("#!/bin/sh\necho routed\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	bound := 3 * time.Second // wide enough that ccrc's own start under MSYS2's timeout is not what is measured (1 s flaked)
	if got := classifyOnWindows(&slowReader{d: 2*bound + 500*time.Millisecond, r: strings.NewReader("npm test")}, bound); got != "routed" {
		t.Fatalf("a classifier that answered at once behind a slow shell start read %q, want routed", got)
	}
}

// The mail hold's jq call hands each --arg value over in a temporary file on Windows (TestJQArgsReachJqWhole); when that
// file cannot be written, jq is never asked, and JQ says so apart from a jq failure (fix round 2, re-review N2), so the
// mail hold refuses instead of reading an empty answer as "no hold".
func TestJQSaysWhenItsArgumentsCannotBeHanded(t *testing.T) {
	msysPath(t)
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("no jq")
	}
	gone := filepath.Join(t.TempDir(), "gone")
	t.Setenv("TMP", gone)
	t.Setenv("TEMP", gone)
	if _, ok, handed := JQ([]byte(`{}`), "-j", "--arg", "s", "x", `$s`); ok || handed {
		t.Errorf("an unwritable temporary directory: ok %v, handed %v; want both false", ok, handed)
	}
	if out, ok, handed := JQ([]byte(`{}`), "-j", `"no args"`); !ok || !handed || string(out) != "no args" {
		t.Errorf("no --arg needs no temporary file: %q ok %v handed %v", out, ok, handed)
	}
	if _, ok, handed := JQ([]byte(`{}`), "-j", `error("x")`); ok || !handed {
		t.Errorf("a jq failure is jq's answer, its arguments handed: ok %v handed %v", ok, handed)
	}
}
