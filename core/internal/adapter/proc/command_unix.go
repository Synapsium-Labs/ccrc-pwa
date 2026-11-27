//go:build !windows

package proc

import (
	"context"
	"errors"
	"os/exec"
)

// Command is how bash starts name: through PATH, as exec does.
func Command(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

// Found is `command -v name`.
func Found(name string) bool {
	_, err := exec.LookPath(name)
	// a binary found through a relative or empty PATH entry is found for `command -v` too (LookPath answers ErrDot for it)
	return err == nil || errors.Is(err, exec.ErrDot)
}
