package regfs

import (
	"errors"
	"io/fs"
	"os"

	"ccrc/core/internal/kernel"
)

// GoOff is whether `<home>/.cc-sessions/ccd-go-off` sends verb back to bash, the file's states kept apart as the launcher
// keeps them: absent is on (false); a link, a directory, a FIFO or an unreadable file is off (true), never opened when it
// is not a regular file; a regular file is read by kernel.GoOffNames. The path is spelled as the bash's
// `$HOME/.cc-sessions/ccd-go-off`, so an empty HOME names `/.cc-sessions/ccd-go-off`, never a file relative to the working
// directory (filepath.Join drops the empty element).
func (OS) GoOff(home, verb string) bool {
	p := home + "/.cc-sessions/ccd-go-off"
	fi, err := os.Lstat(p)
	if err != nil {
		return !errors.Is(err, fs.ErrNotExist)
	}
	if !fi.Mode().IsRegular() {
		return true
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return true
	}
	return kernel.GoOffNames(b, verb)
}
