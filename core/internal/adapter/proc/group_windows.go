//go:build windows

package proc

import "os/exec"

// bindGroup is the context's kill of the child alone: Windows has no process group to signal, as `timeout` has none to
// signal there either.
func bindGroup(cmd *exec.Cmd) {}
