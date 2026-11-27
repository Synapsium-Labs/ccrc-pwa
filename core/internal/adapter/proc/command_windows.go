//go:build windows

package proc

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"ccrc/core/internal/kernel"
)

// Command is how MSYS2's bash starts name, which is what the bash hook does on Windows (Claude Code runs hooks in MSYS2's
// bash, ccd's _pane_shell_env). Go's own lookup reads PATHEXT, so it never finds an extensionless script (the
// `~/.local/bin/ccrc-api` and `ccrc` launchers, a test's PATH stub) and picks `ccrc.cmd` beside `ccrc`, run by cmd.exe.
// So name is looked up as bash looks it up (look): a Windows program (.exe, or a file that starts MZ) is run directly,
// and anything else MSYS2 calls executable (a `#!` or `:\n` script) is run by bash, `exec "$0" "$@"`, which reads the
// script's own `#!` as bash would. Every argument is quoted, so the MSYS2 runtime of the program started never globs
// one: kernel.CygwinQuoteArg for a program MSYS2's runtime runs (msysRuntime), kernel.MsysQuoteArg for any other. A name not found, or found but not executable, is left to exec to fail (127).
func Command(ctx context.Context, name string, args ...string) *exec.Cmd {
	p, x, _ := look(name)
	if !x {
		return refused(ctx, name, args)
	}
	argv := append([]string{p}, args...)
	if !native(p) {
		if interp := shebang(p); interp != nil {
			argv = append(append(interp, filepath.ToSlash(p)), args...)
		} else {
			bash, bx, _ := look("bash")
			if !bx {
				return refused(ctx, name, args)
			}
			argv = append([]string{bash, "-c", `exec "$0" "$@"`, filepath.ToSlash(p)}, args...)
		}
	}
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Path, cmd.Err = argv[0], nil // an MZ file with no .exe is run as it is, which exec's own lookup refuses
	quote := kernel.MsysQuoteArg
	if msysRuntime(argv[0]) {
		quote = kernel.CygwinQuoteArg
	}
	q := make([]string, len(argv))
	for i, a := range argv {
		q[i] = quote(a)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: strings.Join(q, " ")}
	return cmd
}

// msysRuntime is whether p is a program MSYS2's runtime runs, which reads its command line by Cygwin's rule: its
// directory holds the runtime (msys-2.0.dll), as MSYS2's own /usr/bin does. A native program beside no runtime reads
// the Microsoft rule.
func msysRuntime(p string) bool {
	_, err := os.Stat(filepath.Join(filepath.Dir(p), "msys-2.0.dll"))
	return err == nil
}

// refused is a command that fails to start (127 to its runner), never one exec's own PATHEXT lookup would find: with
// no MSYS2-executable name, Go would otherwise pick a `name.cmd` and run the arguments through cmd.exe where bash says
// "command not found" (bash answers 126 for a found file it cannot run; this answers 127 there too).
func refused(ctx context.Context, name string, args []string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Err = &exec.Error{Name: name, Err: exec.ErrNotFound}
	return cmd
}

// Found is `command -v name` in MSYS2's bash: some file stands at name (or name.exe) in a PATH directory, executable or
// not (bash answers the first non-executable one when no executable one is found, measured).
func Found(name string) bool {
	_, _, ok := look(name)
	return ok
}

// look is bash's PATH search under MSYS2: for a name with no separator each PATH directory in order (an empty one is
// the current directory), for one with a separator the name itself; at each, the file, or the file with .exe (the
// MSYS2 runtime's suffix rule). It answers the first executable file (kernel.MsysExecutable), else the first file
// found, which bash would name and refuse to run.
func look(name string) (path string, executable, found bool) {
	var cands []string
	if strings.ContainsAny(name, `/\`) {
		cands = []string{name}
	} else {
		for _, d := range filepath.SplitList(os.Getenv("PATH")) {
			if d == "" {
				d = "."
			}
			cands = append(cands, filepath.Join(d, name))
		}
	}
	first := ""
	for _, c := range cands {
		for _, f := range []string{c, c + ".exe"} {
			st, err := os.Stat(f)
			if err != nil || st.IsDir() {
				continue
			}
			if kernel.MsysExecutable(f, head(f)) {
				return f, true, true
			}
			if first == "" {
				first = f
			}
			break
		}
	}
	return first, false, first != ""
}

// shebang is the interpreter a `#!` line names, as MSYS2's exec runs it (the interpreter, its one optional argument, then
// the script): `#!/bin/sh`, `#!/usr/bin/bash -e` or `#!/usr/bin/env node`, the program looked up by its base name (env's
// operand by name) on PATH, where a hook has MSYS2's /usr/bin first, so one process starts where `bash -c 'exec …'` would start two (measured: a `#!/bin/sh` stand-in for
// tmux run through bash outran the hook's 2 s pane lookup on a loaded box). nil when the line names nothing found here,
// and the caller lets bash read it.
func shebang(p string) []string {
	f, err := os.Open(p)
	if err != nil {
		return nil
	}
	defer f.Close()
	b := make([]byte, 256)
	n, _ := io.ReadFull(f, b)
	line, _, _ := strings.Cut(string(b[:n]), "\n")
	if !strings.HasPrefix(line, "#!") {
		return nil
	}
	w := strings.Fields(strings.TrimSuffix(line[2:], "\r"))
	if len(w) == 0 || len(w) > 2 {
		return nil
	}
	prog, rest := filepath.Base(filepath.FromSlash(w[0])), w[1:]
	if prog == "env" {
		if len(rest) != 1 || strings.HasPrefix(rest[0], "-") {
			return nil
		}
		prog, rest = rest[0], nil
	}
	exe, x, _ := look(prog)
	if !x || !native(exe) {
		return nil
	}
	return append([]string{exe}, rest...)
}

// native is whether CreateProcess runs p itself: a .exe, or a file that starts MZ.
func native(p string) bool {
	return strings.HasSuffix(strings.ToLower(p), ".exe") || strings.HasPrefix(string(head(p)), "MZ")
}

// head is a file's first three bytes, nothing when it cannot be read.
func head(p string) []byte {
	f, err := os.Open(p)
	if err != nil {
		return nil
	}
	defer f.Close()
	b := make([]byte, 3)
	n, _ := io.ReadFull(f, b)
	return b[:n]
}
