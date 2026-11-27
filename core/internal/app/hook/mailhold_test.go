package hook

import (
	"os"
	"path/filepath"
	"testing"

	"ccrc/core/internal/adapter/regfs"
	"ccrc/core/internal/domain/attention"
)

// The shadow log's rotation tests the name itself, as `find "$log" -size +1024k` does with no -L (review F6): a link at
// the log's name to a file past 1 MiB is not moved to `.1`, and a regular file past it is.
func TestMailHoldRotationNeverFollowsALink(t *testing.T) {
	for _, link := range []bool{true, false} {
		home := t.TempDir()
		reg := filepath.Join(home, ".cc-sessions")
		ccrc := filepath.Join(home, ".ccrc")
		for _, d := range []string{reg, ccrc} {
			if err := os.MkdirAll(d, 0o755); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(reg, "lane-a-project-a.mailhold"), []byte("1:coordinator.7"), 0o644); err != nil {
			t.Fatal(err)
		}
		big := make([]byte, 1024*1024+1)
		logf := filepath.Join(ccrc, "mail-hold-shadow.log")
		target := logf
		if link {
			target = filepath.Join(home, "elsewhere.log")
		}
		if err := os.WriteFile(target, big, 0o644); err != nil {
			t.Fatal(err)
		}
		if link {
			if err := os.Symlink(target, logf); err != nil {
				t.Skipf("no symlinks here: %v", err)
			}
		}
		h := &run{IO: IO{FS: regfs.OS{}, NowMs: func() int64 { return 2_000_000_000_000 }, Pid: 7}, home: home, reg: reg, id: "lane-a-project-a"}
		h.mailHold(attention.Parsed{Event: "Stop"}, attention.Class{}, `{"hook_event_name":"Stop"}`, false)
		_, err := os.Lstat(logf + ".1")
		if rotated := err == nil; rotated == link {
			t.Errorf("link %v: rotated %v", link, rotated)
		}
	}
}
