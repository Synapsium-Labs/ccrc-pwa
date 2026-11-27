// Package ccd is ring L4 for the `ccd` entry point: argv in, a domain decision, acts through the adapters it is
// handed, output and exit code out. It decides nothing itself and never imports an adapter (spec 2026-11-24 §3).
package ccd

import (
	"fmt"
	"io"
	"io/fs"

	"ccrc/core/internal/domain/registry"
)

// IO is what the composition root hands the entry point.
type IO struct {
	Stdout, Stderr    io.Writer
	Home              string                            // $HOME, exactly as the environment holds it ("" when unset)
	BodyPath          string                            // the installed bash body, read where a verb reads it
	GoVerbs           []string                          // entries in go mode on this platform, sorted
	ReadFile          func(string) ([]byte, error)      // os.ReadFile
	Stat              func(string) (fs.FileInfo, error) // os.Stat (through a link, as bash's tests)
	UserName          func() string                     // bash's $(id -un)
	BashPath          func(string) string               // a path as bash prints it (MSYS2's POSIX form on Windows)
	PoolSyncInstalled func(home string) bool            // bash's _pool_sync_installed
}

var verbs = map[string]func([]string, IO) int{"caps": caps}

// Main runs one ccd verb. 125 is the launcher's refusal status, kept for "this implementation has no such verb".
// A verb then meets what bash's module top level checks before its dispatch (the roster ladder), in bash's order.
func Main(args []string, x IO) int {
	if len(args) == 0 {
		fmt.Fprint(x.Stderr, "ccd: the go core has no verb (none)\n")
		return 125
	}
	v, ok := verbs[args[0]]
	if !ok {
		fmt.Fprintf(x.Stderr, "ccd: the go core has no verb %s\n", args[0])
		return 125
	}
	// Bash reads an empty HOME as "/" (and dies on an unset one); Go would read every path against the working
	// directory instead. Neither is a home, so the core refuses rather than read either.
	if x.Home == "" {
		fmt.Fprint(x.Stderr, "ccd: HOME is empty or unset, so there is no home to read ccd's files under; nothing was run\n")
		return 1
	}
	roster := x.Home + "/.ccrc/accounts.sh" // bash's "$HOME/.ccrc/accounts.sh"
	said := func() string { return x.BashPath(roster) }
	if msg := registry.RosterRefusal(said, rosterFacts(x, roster), x.UserName); msg != "" {
		fmt.Fprintf(x.Stderr, "ccd: %s\n", msg)
		return 1
	}
	return v(args[1:], x)
}

// rosterFacts asks the roster's three facts in bash's order, each only when the one before holds (a FIFO is never read).
func rosterFacts(x IO, p string) registry.RosterFacts {
	var f registry.RosterFacts
	st, err := x.Stat(p)
	if f.Exists = err == nil; !f.Exists {
		return f
	}
	if f.Regular = st.Mode().IsRegular(); !f.Regular {
		return f
	}
	_, err = x.ReadFile(p)
	f.Readable = err == nil
	return f
}
