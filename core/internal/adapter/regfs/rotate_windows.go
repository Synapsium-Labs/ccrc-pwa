//go:build windows

package regfs

import (
	"io"
	"os"
)

// RotateLocked is the join record's rotation (`_hook_join_record`) on Windows, under the lock the bash takes there:
// MSYS2's `flock -n` on src (o.Flock, lock.Hold), which a native descriptor cannot take (spec 2026-11-22 §4). Held, and
// only while src is still a regular file, not a link, and over says its first readMax bytes are past the cap, and
// neither path became a link nor dst a non-file, src is renamed onto dst whole. A lock held elsewhere, a path renamed
// away or any failure skips; nothing is rewritten. Go's own descriptor is closed before the rename, which the holder's
// MSYS2 descriptor allows (it shares delete).
// D-TBD-go-hook-join-rotation-flock: here the lock is the flock child's descriptor, opened by name, and the content is
// read through a second open by name, so a src replaced between the two is read but not the one locked; the bash reads
// the locked descriptor itself. With no Flock wired nothing rotates, as on a box with no flock.
func (o OS) RotateLocked(src, dst string, readMax int, over func([]byte) bool) {
	if o.Flock == nil || special(dst, false) {
		return
	}
	if st, err := os.Lstat(native(src)); err != nil || !st.Mode().IsRegular() {
		return
	}
	release, ok := o.Flock(native(src), 0)
	if !ok {
		return
	}
	defer release()
	f, err := os.Open(native(src))
	if err != nil {
		return
	}
	cur, err := io.ReadAll(io.LimitReader(f, int64(readMax)))
	_ = f.Close()
	if err != nil || !over(cur) || special(src, true) || special(dst, false) {
		return
	}
	_ = os.Rename(native(src), native(dst))
}
