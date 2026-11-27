package units

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPoolSyncInstalledReadsAsBashTestF(t *testing.T) {
	home := t.TempDir()
	p := filepath.Join(home, ".config", "systemd", "user", "ccd-pool-sync.timer")
	if PoolSyncInstalled(home) {
		t.Fatal("absent must be false")
	}
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
	if PoolSyncInstalled(home) {
		t.Fatal("a directory is not a timer")
	}
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if !PoolSyncInstalled(home) {
		t.Fatal("a regular file is a timer")
	}
}
