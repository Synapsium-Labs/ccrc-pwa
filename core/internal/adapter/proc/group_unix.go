//go:build !windows

package proc

import (
	"os/exec"
	"syscall"
	"time"
)

// bindGroup (D-TBD-go-hook-classify-group: `timeout` sends TERM to its group and waits forever for a command that ignores it; this
// sends TERM to the group and, 100 ms later, KILL to the group, so a classifier or a grandchild of it that ignores TERM cannot hold
// the hook past its bound as it could hold `timeout`) makes a bounded child what GNU `timeout` makes of its command: the leader of a process group of its own, which
// the bound's expiry signals as a whole (TERM, then the WaitDelay's kill), so a grandchild does not outlive it.
func bindGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		pgid := cmd.Process.Pid
		time.AfterFunc(100*time.Millisecond, func() { _ = syscall.Kill(-pgid, syscall.SIGKILL) })
		return syscall.Kill(-pgid, syscall.SIGTERM)
	}
}
