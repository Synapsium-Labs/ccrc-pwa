// Package host is ring L3: facts about the machine and the user the core runs as, spelled as bash spells them.
package host

import (
	"os/exec"
	"runtime"
	"strings"
)

// UserName is bash's `$(id -un)`: the same program, so the name matches bash's on every platform (os/user answers
// DOMAIN\user on Windows, where MSYS2's id answers the bare name). Empty when id cannot run, as bash's substitution is.
func UserName() string {
	out, _ := exec.Command("id", "-un").Output()
	return strings.TrimRight(string(out), "\n")
}

// BashPath is p as bash prints it. On Windows the core is a native program, so MSYS2 hands it HOME in Windows form
// while bash holds the POSIX one: `cygpath -u` is MSYS2's own answer, mounts included. Asked only for a message, so a
// verb that succeeds pays no fork. Unchanged elsewhere, or when cygpath cannot answer.
func BashPath(p string) string {
	if runtime.GOOS != "windows" {
		return p
	}
	out, err := exec.Command("cygpath", "-u", "--", p).Output()
	if s := strings.TrimRight(string(out), "\n"); err == nil && s != "" {
		return s
	}
	return p
}
