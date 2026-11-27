//go:build windows

package lock

import (
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"ccrc/core/internal/kernel"
)

// D-TBD-go-hook-windows-lock-split (ruled out, not taken): on Windows the row's lock is MSYS2's flock, Cygwin's own
// emulation, which ccd's bash takes on the same inode (`_compact_lock_acquire`: ws-rm, ws-reap, ws-gc --prune, forget,
// ws-reclaim and start, all bash on Windows in this wave) and which a native lock (LockFileEx) cannot see (spec
// 2026-11-22 §4). A native lock would split the Go hook from ccd for good, not only for the moment a box switches
// mode. So the Go hook takes the SAME lock: a child `flock -w <wait> <alias> cat` holds it for the hold's length, as
// lock.With holds ccd's, and the hook's release (or its death, which closes the pipe) ends it. The child opens the
// private alias by name before the alias is unlinked, so the lock is taken before the identity proofs rather than
// between them, and an acquisition in flight keeps its alias on disk for up to its wait (arm a of the vanished rule
// reads that as a holder, which it is).

// openAlias is `exec {fd}<>"$al"` (write) or `exec {fd}<"$p"`: a descriptor that, as MSYS2's own, lets the name be
// unlinked while it is open (FILE_SHARE_DELETE; Go's os.Open does not share delete, so the alias would stay).
func openAlias(p string, write bool) (*os.File, error) {
	u, err := syscall.UTF16PtrFromString(p)
	if err != nil {
		return nil, err
	}
	access, disp := uint32(syscall.GENERIC_READ), uint32(syscall.OPEN_EXISTING)
	if write {
		access, disp = access|syscall.GENERIC_WRITE, syscall.OPEN_ALWAYS
	}
	h, err := syscall.CreateFile(u, access, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE, nil,
		disp, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: p, Err: err}
	}
	return os.NewFile(uintptr(h), p), nil
}

// preLock takes the row's lock on the alias (Hold).
func preLock(al string, wait time.Duration) (release func(), ok bool) { return Hold(al, wait) }

// Hold is `flock -w <wait> <path>` (`flock -n` at a zero wait) held for as long as the caller keeps it: on Windows
// through MSYS2's flock, Cygwin's lock that the bash on the box takes and a native descriptor cannot reach (spec
// 2026-11-22 §4), as a child `flock … <path> cat` whose stdin the release closes (lock.With's way); the caller's death
// closes it too. The child opens path by name, so it holds what the name pointed at when it opened it.
func Hold(path string, wait time.Duration) (release func(), ok bool) {
	argv := []string{"flock", "-n", path, "cat"}
	if wait > 0 {
		argv = []string{"flock", "-w", strconv.FormatFloat(wait.Seconds(), 'f', -1, 64), path, "cat"}
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	q := make([]string, len(argv))
	for i, a := range argv {
		q[i] = kernel.CygwinQuoteArg(a) // MSYS2's flock reads Cygwin's rule (kernel.CygwinQuoteArg)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: strings.Join(q, " ")}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, false
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, false
	}
	if cmd.Start() != nil {
		return nil, false
	}
	release = func() { _ = stdin.Close(); _ = cmd.Wait() }
	if _, err := stdin.Write([]byte("L\n")); err != nil {
		release()
		return nil, false
	}
	if _, err := io.ReadFull(stdout, make([]byte, 2)); err != nil { // flock gave up at its bound, or could not start cat
		release()
		return nil, false
	}
	return release, true
}

// flockWait: the lock is already the flock child's (preLock).
func flockWait(*os.File, time.Duration) bool { return true }

// ProcNames is `_hook_lock_vanished`'s arm (b) on Windows: never named, which is what the bash hook's own arm answers
// there. Measured on MSYS2 (Task 9b, row_test.go#TestProcNamesWindowsAsBash): the hook's exact `find /proc … -lname`
// run from one process names no descriptor another process holds on an unlinked alias (MSYS2's /proc shows a process
// only its own and its ancestors' descriptors), so on Windows, as on Darwin, a canonical that vanished under a live
// holder reads as a first-ever mint in both modes (the bash's recorded platform residue, `_hook_lock_vanished`).
func ProcNames(string) bool { return false }
