// Package regfs is ring L3: the files the session hook reads and writes under ~/.cc-sessions and ~/.ccrc, through
// the operating system, keeping every distinction the OS answers (absent, unreadable and not-regular stay apart).
package regfs

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// OS is the registry on the real filesystem.
type OS struct {
	// Flock holds `flock -w <wait> <path>` until release (lock.Hold, wired by the composition root). Only the Windows
	// rotation asks it (rotate_windows.go), where the lock must be MSYS2's; nil there skips the rotation.
	Flock func(path string, wait time.Duration) (release func(), ok bool)
}

// ReadFile reads at most max bytes of path (max <= 0: all of it), following a link as a shell redirection does.
func (OS) ReadFile(path string, max int) ([]byte, error) {
	f, err := os.Open(native(path))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if max <= 0 {
		return io.ReadAll(f)
	}
	return io.ReadAll(io.LimitReader(f, int64(max)))
}

// Lstat is os.Lstat.
func (OS) Lstat(path string) (fs.FileInfo, error) { return os.Lstat(native(path)) }

// Stat is os.Stat (through a link, as a shell's -e and -f test).
func (OS) Stat(path string) (fs.FileInfo, error) { return os.Stat(native(path)) }

// WriteFile is a shell's `> path`: created with perm less the umask, or truncated.
func (OS) WriteFile(path string, data []byte, perm fs.FileMode) error {
	return os.WriteFile(native(path), data, perm)
}

// AppendFile is a shell's `>> path`: one write(2) to an O_APPEND descriptor, created 0666 less the umask.
func (OS) AppendFile(path string, data []byte) error {
	f, err := os.OpenFile(native(path), os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o666)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

// Rename is `mv -f` of one file onto another name.
func (OS) Rename(oldpath, newpath string) error { return os.Rename(native(oldpath), native(newpath)) }

// Remove is `rm -f` of one name.
func (OS) Remove(path string) error { return os.Remove(native(path)) }

// Rmdir is `rmdir`: it removes an empty directory and nothing else (a file or a non-empty directory is an error).
func (OS) Rmdir(path string) error { return syscall.Rmdir(native(path)) }

// Symlink is `ln -sn -- target link`: an error when anything stands at link.
func (OS) Symlink(target, link string) error { return os.Symlink(native(target), native(link)) }

// Readlink is a link's own text.
func (OS) Readlink(path string) (string, error) { return os.Readlink(native(path)) }

// EvalSymlinks is the physical path, every link resolved and each `..` taken after the link before it.
func (OS) EvalSymlinks(path string) (string, error) { return filepath.EvalSymlinks(native(path)) }

// MkdirAll is `mkdir -p`, each new directory perm less the umask.
func (OS) MkdirAll(path string, perm fs.FileMode) error { return os.MkdirAll(native(path), perm) }

// Glob (D-TBD-go-hook-glob-order: Go's byte order, where bash's is the locale's collation, which matters only when two
// rows hold the same uuid) is a shell glob with nullglob and without dotglob: the matches, sorted, less every name led by a dot, which a
// shell's `*` never matches and filepath.Glob's does.
func (OS) Glob(pattern string) ([]string, error) {
	all, err := filepath.Glob(native(pattern))
	out := all[:0]
	for _, p := range all {
		if !strings.HasPrefix(filepath.Base(p), ".") {
			out = append(out, p)
		}
	}
	return out, err
}

// ReadDirNames is every name under a directory but . and .., in byte order (a shell glob's order in the C locale).
func (OS) ReadDirNames(path string) ([]string, error) {
	es, err := os.ReadDir(native(path)) // sorted by filename
	names := make([]string, 0, len(es))
	for _, e := range es {
		names = append(names, e.Name())
	}
	return names, err
}

// seams for the append's tests: a node swapped in between the guard and the open, and between the open and the check.
var afterGuard, afterOpen = func() {}, func() {}

// AppendRegular is the history spool's append (`_hook_history_spool_append`, D-4418 and D-7503): refuse a path that is
// a POSITIVE non-regular type (a link, dangling or not, a directory, a FIFO, a socket, a device), open it once for
// append (creating it), and write the line through that descriptor only when what it opened is not a positive
// non-regular type either and the path is still not a link. The refusal is never "not a regular file": a drain moves
// the path between absent and regular, and a guard that probes both halves loses a line. Every failure is silent.
func (OS) AppendRegular(path string, data []byte) error {
	if st, err := os.Lstat(native(path)); err == nil && !st.Mode().IsRegular() {
		return nil
	}
	afterGuard()
	f, err := os.OpenFile(native(path), os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o666)
	if err != nil {
		return err
	}
	defer f.Close()
	afterOpen()
	if st, err := f.Stat(); err != nil || !st.Mode().IsRegular() {
		return nil
	}
	if st, err := os.Lstat(native(path)); err == nil && st.Mode()&os.ModeSymlink != 0 {
		return nil
	}
	_, err = f.Write(data)
	return err
}

// ReadTail is `tail -c n path`: the last n bytes (all of a shorter file), through a link; the error is an open or read failure.
func (OS) ReadTail(path string, n int) ([]byte, error) {
	f, err := os.Open(native(path))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if st, err := f.Stat(); err == nil && st.Mode().IsRegular() && st.Size() > int64(n) {
		if _, err := f.Seek(st.Size()-int64(n), io.SeekStart); err != nil {
			return nil, err
		}
	}
	return io.ReadAll(f)
}

// ReadRange is `tail -c +<off+1> path | head -c n`: at most n bytes from offset off, through a link; the error is an
// open or read failure.
func (OS) ReadRange(path string, off, n int64) ([]byte, error) {
	f, err := os.Open(native(path))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.NewSectionReader(f, off, n))
}

// Link is POSIX `link old new`: a hard link, created exactly at new or not at all (EEXIST changes nothing).
func (OS) Link(oldpath, newpath string) error { return os.Link(native(oldpath), native(newpath)) }

// CreateExcl is `( umask …; set -C; : > p )`: a new empty file with perm, refused when anything stands at p.
func (OS) CreateExcl(path string, perm fs.FileMode) error {
	f, err := os.OpenFile(native(path), os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return err
	}
	return f.Close()
}

// Touch is `touch p` of a file that exists: its access and modification times set to now.
func (OS) Touch(path string) error {
	now := time.Now()
	return os.Chtimes(native(path), now, now)
}

// Walk is `find dir`: f for every name under dir, dir itself first, with its lstat modification time; a link is never
// followed (a dir that is a link is itself the only name), and a directory that cannot be read is passed over.
func (OS) Walk(dir string, f func(path string, mtime time.Time)) {
	_ = filepath.WalkDir(native(dir), func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // the root that cannot be lstat'ed, or a directory's second call reporting its unreadable listing
		}
		if st, e := d.Info(); e == nil {
			// find spells what it found as dir + "/" + the name, dir as given: on Windows WalkDir joins with `\`,
			// which the scope's base-name match and the transcript the set records would read differently
			if rel, e := filepath.Rel(native(dir), p); e == nil && runtime.GOOS == "windows" {
				if p = dir; rel != "." {
					p = strings.TrimSuffix(dir, "/") + "/" + filepath.ToSlash(rel)
				}
			}
			f(p, st.ModTime())
		}
		return nil
	})
}
