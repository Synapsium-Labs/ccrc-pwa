// Package registry is ring L1 for C1 Fleet Registry & Accounts (ccd/contexts.tsv): pure deciders, no IO.
package registry

// RosterFacts are what bash's module top level asks of ~/.ccrc/accounts.sh before any verb runs, in its order: `-e`
// (stat succeeds, through a link), `-f` (a regular file), `-r` (readable). A later fact is only asked once the earlier
// ones hold, so a FIFO is never opened.
type RosterFacts struct{ Exists, Regular, Readable bool }

// RosterRefusal is bash's die line for the roster rung that fails, without its "ccd: " prefix, or "" when all three
// hold. path is the roster's path as bash prints it and user is `id -un`: each is asked only for a refusal that names
// it, as bash forks `id` only for the unreadable rung.
func RosterRefusal(path func() string, f RosterFacts, user func() string) string {
	switch {
	case !f.Exists:
		return "no account roster at " + path() + " — generate it from ~/.ccrc/accounts.json (deploy/deploy.sh, or `ccrc install`)"
	case !f.Regular:
		return "account roster " + path() + " exists but is not a regular file — something else (a FIFO, a device node, a UNIX socket, or a directory) is sitting at that path; remove it, then regenerate: ccrc install. Regenerating it will not help until the path is clear."
	case !f.Readable:
		return "account roster " + path() + " exists but is not readable by " + user() + " — fix its permissions (it must be readable by the user ccd runs as; the deploy installs it 644). Regenerating it will not help."
	}
	return ""
}
