//go:build !windows

package attention

import (
	"syscall"
	"time"
)

// cpuNow is this process's user and system CPU time: the work a run did, not the time it waited (D-8334's measure).
func cpuNow() time.Duration {
	var r syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &r) != nil {
		return 0
	}
	return time.Duration(r.Utime.Nano() + r.Stime.Nano())
}
