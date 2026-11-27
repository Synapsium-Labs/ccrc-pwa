package regfs

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// Searchable says yes to a directory that can be listed (empty or not) and no to a missing path and to a file.
func TestSearchable(t *testing.T) {
	d := t.TempDir()
	if !(OS{}).Searchable(d) {
		t.Error("an empty directory")
	}
	if err := os.WriteFile(filepath.Join(d, "f"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if !(OS{}).Searchable(d) {
		t.Error("a directory with a file")
	}
	if (OS{}).Searchable(filepath.Join(d, "nope")) {
		t.Error("a missing path")
	}
	if runtime.GOOS == "windows" && (OS{}).Searchable(filepath.Join(d, "f")) {
		t.Error("a file is not a directory that can be listed")
	}
}

// A directory with mode 000 is not searchable (unix: access(2); skipped as root, which reads anything).
func TestSearchableRefusesAnUnlistableDirectory(t *testing.T) {
	if runtime.GOOS == "windows" || os.Getuid() == 0 {
		t.Skip("needs a unix non-root user")
	}
	d := filepath.Join(t.TempDir(), "w")
	if err := os.Mkdir(d, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(d, 0); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(d, 0o755)
	if (OS{}).Searchable(d) {
		t.Error("a mode-000 directory passed")
	}
}
