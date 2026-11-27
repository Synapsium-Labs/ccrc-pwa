// Package units is ring L3: the service manager's files (systemd's user units, which the Windows manager emulates).
package units

import (
	"os"
	"path/filepath"
)

// PoolSyncInstalled is bash's _pool_sync_installed on a systemd box: `[ -f ]` of the pool-sync timer, so a regular
// file through a link; a directory, anything else, or a path that cannot be examined is not a timer.
func PoolSyncInstalled(home string) bool {
	st, err := os.Stat(filepath.Join(home, ".config", "systemd", "user", "ccd-pool-sync.timer"))
	return err == nil && st.Mode().IsRegular()
}
