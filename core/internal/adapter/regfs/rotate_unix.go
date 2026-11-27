//go:build !windows

package regfs

import (
	"io"
	"os"
	"syscall"
)

// RotateLocked is the join record's rotation (`_hook_join_record`; D-TBD-go-hook-join-rotation-flock: flock(2) in-process,
// no `flock` binary needed here): src opened on its own descriptor and locked with a
// non-blocking flock; only while the path still names that inode (a second descriptor of it, compared by device and
// inode) and over says its first readMax bytes are past the cap, and neither path became a link nor dst a non-file,
// src is renamed onto dst whole. A lock held elsewhere, a path renamed away or any failure skips; nothing is rewritten.
func (OS) RotateLocked(src, dst string, readMax int, over func([]byte) bool) {
	if special(dst, false) {
		return
	}
	f, err := os.Open(src)
	if err != nil {
		return
	}
	defer f.Close()
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return
	}
	if st, err := os.Lstat(src); err != nil || !st.Mode().IsRegular() {
		return
	}
	g, err := os.Open(src)
	if err != nil {
		return
	}
	a, err1 := f.Stat()
	b, err2 := g.Stat()
	g.Close()
	if err1 != nil || err2 != nil || !os.SameFile(a, b) {
		return
	}
	cur, err := io.ReadAll(io.LimitReader(f, int64(readMax)))
	if err != nil || !over(cur) || special(src, true) || special(dst, false) {
		return
	}
	_ = os.Rename(src, dst)
}
