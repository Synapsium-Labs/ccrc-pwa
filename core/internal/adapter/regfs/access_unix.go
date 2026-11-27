//go:build !windows

package regfs

import "syscall"

// Searchable is `-r p && -x p`: the caller may list the directory and enter it.
func (OS) Searchable(path string) bool { return syscall.Access(path, 0x4|0x1) == nil } // R_OK|X_OK

// Executable is `-x p`: the caller may execute the file (or search the directory).
func (OS) Executable(path string) bool { return syscall.Access(path, 0x1) == nil } // X_OK

// Readable is `-r p`.
func (OS) Readable(path string) bool { return syscall.Access(path, 0x4) == nil } // R_OK
