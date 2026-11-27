//go:build windows

package attention

import (
	"syscall"
	"time"
)

// cpuNow is this process's user and kernel CPU time: the work a run did, not the time it waited (D-8334's measure).
func cpuNow() time.Duration {
	h, err := syscall.GetCurrentProcess()
	if err != nil {
		return 0
	}
	var c, e, k, u syscall.Filetime
	if syscall.GetProcessTimes(h, &c, &e, &k, &u) != nil {
		return 0
	}
	ticks := func(f syscall.Filetime) int64 { return (int64(f.HighDateTime)<<32 | int64(f.LowDateTime)) * 100 } // 100 ns units
	return time.Duration(ticks(k) + ticks(u))
}
