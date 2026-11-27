//go:build !windows

// Package lock is ring L3: the exclusive lock ccd's bash takes with flock(1).
package lock

import (
	"os"
	"syscall"
)

// With holds flock(2) LOCK_EX on file for fn's length: the lock flock(1) takes, so bash and Go exclude each other.
// The file is created as flock(1) creates it (0666 less the umask); closing it releases the lock.
func With(file string, fn func() error) error {
	f, err := os.OpenFile(file, os.O_RDONLY|os.O_CREATE, 0o666)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	return fn()
}
