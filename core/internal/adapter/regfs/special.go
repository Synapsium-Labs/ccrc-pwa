package regfs

import "os"

// special is a positive non-regular type at p (a link, a directory, a FIFO, a socket or a device), as the bash's
// `-L || -d || -p || -S || -b || -c` reads it; linkOnly asks the link test alone. Absent is not special.
// D-TBD-go-hook-windows-fifo: on Windows an MSYS2 FIFO (mkfifo) is not there for a native program at all (Lstat answers
// not-exist, measured with Node and attrib), so where the bash sees `-p` this sees absent and may create a regular file
// at the name; nothing in ccrc makes a FIFO, so only a hand-made one is affected.
func special(p string, linkOnly bool) bool {
	st, err := os.Lstat(native(p))
	if err != nil {
		return false
	}
	if st.Mode()&os.ModeSymlink != 0 {
		return true
	}
	return !linkOnly && !st.Mode().IsRegular()
}
