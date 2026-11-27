package lock

import (
	"crypto/rand"
	"io"
	"os"
	"strconv"
	"time"
)

// The session hook's stable row lock (ccd/session-hook.sh, `_hook_lock_acquire` and its family, spec 2026-09-09 §3.4):
// ONE permanent mutex per registry row, `$REG/.<id>.compactions.lock`, published once by `link` off a private source and
// never opened at its own pathname; every acquisition opens a private hard-link alias, unlinks it, and proves the
// descriptor still names canonical around its bounded flock(2). ccd's bash takes the same file the same way, so the two
// exclude each other. With (above) is ccd's plain blocking lock; this is the hook's protocol over the same mechanism, and
// its caller policy (every refusal is silent, the hook exits 0) is the hook's own, decided in its L1.

// Held is a descriptor this process keeps open on a row file: the lock's alias, a PostCompact claim, a journal.
type Held struct {
	f       *os.File
	release func() // Windows: the flock child that holds the row's lock (row_windows.go#preLock)
}

// OpenRead is `exec {fd}<"$p"`: a read descriptor on p, through a link.
func OpenRead(p string) (*Held, error) {
	f, err := openAlias(p, false)
	if err != nil {
		return nil, err
	}
	return &Held{f: f}, nil
}

// Same is `_hook_lock_same <fd> <p>`: the descriptor's file is a regular file, p is a regular file and no link, and the
// two are one inode (device and inode, as `-ef` compares them through /proc/self/fd).
// D-TBD-go-hook-lock-same-dev: where the bash has no /proc (Darwin) it reads /dev/fd, whose `-ef` fails on the fdesc
// device, and falls back to comparing `ls -i` inode numbers alone; this compares the device too. Stricter: only an
// inode number shared across two filesystems differs, and that refuses where the bash would proceed.
func (h *Held) Same(p string) bool {
	if h == nil || h.f == nil {
		return false
	}
	a, err := h.f.Stat()
	if err != nil || !a.Mode().IsRegular() {
		return false
	}
	b, err := os.Lstat(p)
	if err != nil || !b.Mode().IsRegular() {
		return false
	}
	return os.SameFile(a, b)
}

// ReadAll is `cat <&fd`: the rest of the file from the descriptor's offset.
func (h *Held) ReadAll() ([]byte, error) { return io.ReadAll(h.f) }

// Close is `exec {fd}<&-`; closing a closed or nil Held is a no-op, as closing a closed descriptor is rc 0.
func (h *Held) Close() {
	if h != nil && h.f != nil {
		_ = h.f.Close()
		h.f = nil
	}
	if h != nil && h.release != nil {
		h.release()
		h.release = nil
	}
}

// Outcome is how an acquisition ended. Refused and Vanished are both a refusal to the hook; Vanished is the named one
// (`HOOK_LOCK_WHY=canonical-vanished`), kept apart so no adapter narrows it.
type Outcome int

const (
	Acquired Outcome = iota
	Refused
	Vanished
)

// Row is one registry row's names: `$REG`, the id, and what the bash spells `$$` and `$RANDOM` in its private names.
type Row struct {
	Reg, ID string
	Pid     int
	Rand    func() int
}

func (r Row) name(s string) string { return r.Reg + "/." + r.ID + "." + s }

// Canonical is `$REG/.<id>.compactions.lock`.
func (r Row) Canonical() string { return r.name("compactions.lock") }

// OpenPrefix is the exact family of an acquisition's alias, `$REG/.<id>.compactions.lock-open.`.
func (r Row) OpenPrefix() string { return r.Canonical() + "-open." }

// fresh is the bash's absent-name loop: `<stem>.<pid>.<r>.<r><tail>`, eight tries, a name nothing stands at (no
// precreate); "" when every try collided.
func (r Row) fresh(stem, tail string) string {
	for i := 0; i < 8; i++ {
		p := stem + "." + strconv.Itoa(r.Pid) + "." + strconv.Itoa(r.Rand()) + "." + strconv.Itoa(r.Rand()) + tail
		if _, err := os.Lstat(p); err != nil {
			return p
		}
	}
	return ""
}

// Fresh is the absent-name loop for a family under this row, `$REG/.<id>.<family>.<pid>.<r>.<r><tail>`.
func (r Row) Fresh(family, tail string) string { return r.fresh(r.name(family), tail) }

// regularNoLink is `[[ -f p && ! -L p ]]`.
func regularNoLink(p string) bool {
	st, err := os.Lstat(p)
	return err == nil && st.Mode().IsRegular()
}

// present is `[ -e p ] || [ -L p ]`.
func present(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// Acquire is `_hook_lock_acquire <wait>` past its mechanism probe (the caller's: whether flock, mktemp and link are on
// PATH): a canonical that is absent where vanished says a holder lost it refuses before anything is minted; else
// canonical is validated or published (`_hook_lock_init`), a private alias linked off it, opened, unlinked, proved the
// same inode, locked within wait, and proved again.
func (r Row) Acquire(wait time.Duration, vanished func() bool) (*Held, Outcome) {
	lock := r.Canonical()
	if !present(lock) && vanished() {
		return nil, Vanished
	}
	if !r.init(lock) {
		return nil, Refused
	}
	al := r.fresh(r.OpenPrefix()[:len(r.OpenPrefix())-1], "")
	if al == "" || !regularNoLink(lock) {
		return nil, Refused
	}
	if os.Link(lock, al) != nil {
		return nil, Refused
	}
	if !regularNoLink(al) {
		_ = os.Remove(al)
		return nil, Refused
	}
	f, err := openAlias(al, true) // `<>`
	if err != nil {
		_ = os.Remove(al)
		return nil, Refused
	}
	release, ok := preLock(al, wait)
	_ = os.Remove(al)
	h := &Held{f: f, release: release}
	if !ok {
		h.Close()
		return nil, Refused
	}
	if !h.Same(lock) || !flockWait(f, wait) || !h.Same(lock) {
		h.Close()
		return nil, Refused
	}
	return h, Acquired
}

// init is `_hook_lock_init`: an incumbent is validated, never opened or recreated; an absent canonical is published by
// `link` off a private 0600 source, which goes on every result.
func (r Row) init(lock string) bool {
	if present(lock) {
		return regularNoLink(lock)
	}
	src, ok := Mktemp(r.name("compactions.lock-init."))
	if !ok {
		return false
	}
	if !regularNoLink(src) {
		_ = os.Remove(src)
		return false
	}
	_ = os.Link(src, lock)
	_ = os.Remove(src)
	return regularNoLink(lock)
}

// Mktemp is `( umask 077; mktemp "<prefix>XXXXXX" )`: a new 0600 file whose name ends in six letters and digits.
func Mktemp(prefix string) (string, bool) {
	const set = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for try := 0; try < 100; try++ {
		b := make([]byte, 6)
		if _, err := rand.Read(b); err != nil {
			return "", false
		}
		for i := range b {
			b[i] = set[int(b[i])%len(set)]
		}
		p := prefix + string(b)
		f, err := os.OpenFile(p, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			_ = f.Close()
			return p, true
		}
		if !os.IsExist(err) {
			return "", false
		}
	}
	return "", false
}

// Generation is `_hook_generation_ok`'s read: `$REG/<id>.generation` through a private hard-link alias (linked, opened,
// unlinked), read as `read -r -N 37` reads it (NUL bytes dropped: the first 37 others), and proved still the same inode
// as the pathname. false on any failure.
func (r Row) Generation() (string, bool) {
	p := r.Reg + "/" + r.ID + ".generation"
	al := r.Fresh("generation-read", "")
	if al == "" || os.Link(p, al) != nil {
		return "", false
	}
	if !regularNoLink(al) {
		_ = os.Remove(al)
		return "", false
	}
	h, err := OpenRead(al)
	if err != nil {
		_ = os.Remove(al)
		return "", false
	}
	_ = os.Remove(al)
	defer h.Close()
	var got []byte
	buf := make([]byte, 512)
	for len(got) < 37 {
		n, err := h.f.Read(buf)
		for _, c := range buf[:n] {
			if c != 0 && len(got) < 37 {
				got = append(got, c)
			}
		}
		if err != nil {
			break
		}
	}
	if !h.Same(p) {
		return "", false
	}
	return string(got), true
}
