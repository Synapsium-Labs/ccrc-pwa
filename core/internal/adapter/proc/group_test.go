//go:build linux

package proc

import (
	"strconv"
	"strings"
	"syscall"
	"testing"
)

// An unbounded run (the approval wait's client and verifier) stays in the hook's own process group, as a bash foreground
// child does, so a TERM to the hook's tree reaches it; a bounded run leads a group of its own, as `timeout` makes it.
func TestRunProcessGroup(t *testing.T) {
	pgid := func(bound bool) int {
		var r Result
		const prog = `read -r _ _ _ _ g _ < /proc/$$/stat; echo "$g"`
		if bound {
			r = Run(5_000_000_000, nil, nil, false, "sh", "-c", prog)
		} else {
			r = Run(0, nil, nil, false, "sh", "-c", prog)
		}
		n, err := strconv.Atoi(strings.TrimSpace(string(r.Out)))
		if err != nil {
			t.Fatalf("pgid: %q %+v", r.Out, r)
		}
		return n
	}
	if got := pgid(false); got != syscall.Getpgrp() {
		t.Errorf("unbounded child's group %d, the hook's %d", got, syscall.Getpgrp())
	}
	if got := pgid(true); got == syscall.Getpgrp() {
		t.Errorf("a bounded child shares the hook's group %d", got)
	}
}
