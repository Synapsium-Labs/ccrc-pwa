//go:build !windows

package lock

import (
	"os"
	"strings"
	"syscall"
	"time"
)

// openAlias is `exec {fd}<>"$al"` (write) or `exec {fd}<"$p"`.
func openAlias(p string, write bool) (*os.File, error) {
	if write {
		return os.OpenFile(p, os.O_RDWR|os.O_CREATE, 0o666)
	}
	return os.Open(p)
}

// preLock: flock(2) is taken on the descriptor after the alias is gone (flockWait), so nothing is held before.
func preLock(string, time.Duration) (func(), bool) { return nil, true }

// Hold is `flock -w <wait> <path>` held until release: flock(2) on a descriptor of path, polled as flockWait polls.
func Hold(path string, wait time.Duration) (release func(), ok bool) {
	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	if !flockWait(f, wait) {
		_ = f.Close()
		return nil, false
	}
	return func() { _ = f.Close() }, true
}

// flockWait is `flock -w <wait> <fd>`: LOCK_EX on the descriptor, given up once wait has passed.
// shortcut: it polls every 5 ms where flock(1) blocks in the kernel and is woken on release, so a Go waiter beside
// kernel-queued bash waiters can lose releases to them; measured (row_cross_test.go#TestBashAndGoWaitersAllGetIn: six
// of each on a held row, all in within the bash's own 5 s bound). Upgrade to a blocking flock bounded by a deadline if a
// mixed fleet's waits ever reach the bound.
func flockWait(f *os.File, wait time.Duration) bool {
	end := time.Now().Add(wait)
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return true
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EINTR {
			return false
		}
		if !time.Now().Before(end) {
			return false
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// ProcNames is `_hook_lock_vanished`'s arm (b), the one expensive read: whether any process's descriptor under
// /proc/<pid>/fd names a target starting with prefix (`find /proc -mindepth 3 -maxdepth 3 -path '/proc/[0-9]*/fd/*'
// -lname "<prefix>*" -print -quit`; an unlinked file reads `<path> (deleted)`, so the prefix still matches). A directory
// it cannot read is passed over, as find passes it with its message dropped. The verdict that asks it is the hook's L1.
// A prefix compare stands in for find's glob, exact where the prefix holds no glob character. Where it holds one (a `*`,
// `?`, `[` or `\` in $HOME, which find would read as a pattern) the answer is "named":
// D-TBD-go-hook-proc-glob: stricter than the bash, which may match fewer names there; the acquisition then refuses a
// first-ever mint on such a HOME (no compaction artifact), never mints a second canonical. No fleet HOME holds one.
func ProcNames(prefix string) bool {
	if strings.ContainsAny(prefix, `*?[\`) {
		return true
	}
	ps, err := os.ReadDir("/proc")
	if err != nil {
		return false
	}
	for _, p := range ps {
		if n := p.Name(); n == "" || n[0] < '0' || n[0] > '9' {
			continue
		}
		dir := "/proc/" + p.Name() + "/fd"
		fds, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, fd := range fds {
			if t, err := os.Readlink(dir + "/" + fd.Name()); err == nil && strings.HasPrefix(t, prefix) {
				return true
			}
		}
	}
	return false
}
