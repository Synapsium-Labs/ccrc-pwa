package regfs

import (
	"io"
	"os"

	"ccrc/core/internal/kernel"
)

// Searchable is `-r p && -x p` for a directory (D-TBD-go-hook-searchable-windows: a stat elsewhere, as the MSYS bash's
// test answers the same for a directory the user can list): on Windows it is one the caller can open and read a name from (EOF, an
// empty directory, is fine). A stat alone passes a directory whose listing then fails.
func (OS) Searchable(path string) bool {
	f, err := os.Open(native(path))
	if err != nil {
		return false
	}
	defer f.Close()
	_, err = f.Readdirnames(1)
	return err == nil || err == io.EOF
}

// Executable is `-x p` as MSYS2's bash answers it: a directory the caller can stat, or a file MSYS2 calls executable
// (kernel.MsysExecutable: a .exe or .lnk name, or a `#!`, `MZ` or `:\n` head), the rule proc.Command runs a file by.
func (OS) Executable(path string) bool {
	st, err := os.Stat(native(path))
	if err != nil {
		return false
	}
	if st.IsDir() {
		return true
	}
	f, err := os.Open(native(path))
	if err != nil {
		return false
	}
	defer f.Close()
	b := make([]byte, 3)
	n, _ := io.ReadFull(f, b)
	return kernel.MsysExecutable(path, b[:n])
}

// Readable is `-r p`: on Windows, a file the caller can open for reading.
func (OS) Readable(path string) bool {
	f, err := os.Open(native(path))
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}
