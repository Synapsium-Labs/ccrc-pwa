//go:build windows

package regfs

import (
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// native is a path as Windows opens it. A path a bash on the box wrote into a file (ccd's `.workdir`, ccd-graph's
// meta.json `store`) is MSYS2's spelling, which the bash hook opens and a native program cannot: `/c/...` is drive C,
// any other `/...` under MSYS2's own root (the directory above the usr/bin that holds the bash on PATH; `/tmp` too,
// measured with cygpath -w on this box). A Windows path, a relative one, and a `//server` one are unchanged.
// shortcut: the default mounts only (no /etc/fstab of the box is read); a box with its own mounts reads those paths as
// missing, as a bash-only box with no such mount would. D-TBD-go-hook-windows-msys-paths.
func native(p string) string {
	if !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") {
		return p
	}
	if len(p) >= 2 && (p[1] >= 'a' && p[1] <= 'z' || p[1] >= 'A' && p[1] <= 'Z') && (len(p) == 2 || p[2] == '/') {
		return strings.ToUpper(p[1:2]) + ":" + "/" + strings.TrimPrefix(p[2:], "/")
	}
	if r := msysRoot(); r != "" {
		return r + p
	}
	return p
}

var msysRoot = sync.OnceValue(func() string {
	b, err := exec.LookPath("bash")
	if err != nil {
		return ""
	}
	usr := filepath.Dir(filepath.Dir(b)) // <root>/usr/bin/bash.exe -> <root>/usr
	if !strings.EqualFold(filepath.Base(usr), "usr") {
		return ""
	}
	return filepath.ToSlash(filepath.Dir(usr))
})
