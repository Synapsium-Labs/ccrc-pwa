//go:build !windows

package hook

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ccrc/core/internal/adapter/regfs"
)

const (
	spoolID  = "demo-quiet-basin"
	spoolGen = "0189abcd-1234-5678-9abc-0123456789ab"
	otherGen = "7f3c9a10-5555-4aaa-8bbb-0123456789cd"
	spoolSID = "6350faa0-a1be-4e78-939c-57485268f6fc"
)

// swapFS answers the generation file's first read as the file stands and every later one as another incarnation, which
// is a row reused between the gate's read and the append's.
type swapFS struct {
	FS
	gen   string
	reads int
}

func (s *swapFS) ReadFile(p string, max int) ([]byte, error) {
	if p == s.gen {
		s.reads++
		if s.reads > 1 {
			return []byte(otherGen), nil
		}
	}
	return s.FS.ReadFile(p, max)
}

func spoolHome(t *testing.T) (home, bucketDir string) {
	t.Helper()
	home = t.TempDir()
	reg := filepath.Join(home, ".cc-sessions")
	bucketDir = filepath.Join(reg, "delegation", "spool", spoolID)
	if err := os.MkdirAll(bucketDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(reg, spoolID+".generation"), []byte(spoolGen), 0o644); err != nil {
		t.Fatal(err)
	}
	return home, bucketDir
}

func fire(home string, fsys FS, toolUseID string) {
	env := map[string]string{"HOME": home, "TMUX_PANE": "%1", "CCRC_SESSION_GENERATION": spoolGen, "CLAUDE_CODE_SESSION_ID": "uuid-1"}
	payload := `{"hook_event_name":"PreToolUse","session_id":"` + spoolSID + `","tool_name":"Agent","tool_use_id":"` + toolUseID + `","tool_input":{"model":"sonnet"}}`
	Main(strings.NewReader(payload), IO{Stdout: &bytes.Buffer{}, Getenv: func(k string) string { return env[k] }, FS: fsys, Pid: 1,
		NowMs:       func() int64 { return 1700000000500 },
		TmuxSession: func(string, string, string) string { return "cc-" + spoolID }})
}

func spoolLines(t *testing.T, dir string) int {
	t.Helper()
	n := 0
	es, _ := os.ReadDir(dir)
	for _, e := range es {
		b, _ := os.ReadFile(filepath.Join(dir, e.Name()))
		n += strings.Count(string(b), "\n")
	}
	return n
}

// A generation that changes between the line being built and its append records nothing (the second read disagrees);
// with no change the same event is recorded. The Go twin of delegation-spool.test.ts's jq stand-in that swaps the file.
func TestSpoolAppendRereadsTheGeneration(t *testing.T) {
	home, dir := spoolHome(t)
	gen := filepath.Join(home, ".cc-sessions", spoolID+".generation")
	fire(home, regfs.OS{}, "toolu_ctl")
	if got := spoolLines(t, dir); got != 1 {
		t.Fatalf("control: %d lines", got)
	}
	fire(home, &swapFS{FS: regfs.OS{}, gen: gen}, "toolu_swapped")
	if got := spoolLines(t, dir); got != 1 {
		t.Errorf("a generation that changed under the hook still took a line: %d lines", got)
	}
}

// bornFS lets a sibling hook create the bucket the instant after the hook first probes it: the move a current bucket
// makes (absent to regular), landing between any two probes the append makes of its path.
type bornFS struct {
	FS
	path  string
	probe int
}

func (b *bornFS) Lstat(p string) (fs.FileInfo, error) {
	st, err := b.FS.Lstat(p)
	if p == b.path {
		if b.probe++; b.probe == 1 {
			if f, e := os.OpenFile(p, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o666); e == nil {
				f.Close()
			}
		}
	}
	return st, err
}

// A bucket created by a racing hook between the append's probes is a regular file to it, never a refusal (D-7448, the Go
// twin of delegation-spool.test.ts's cut of the node gate): the bucket is born right after the first probe, and the
// line must land. A gate that probes "regular, else absent" in two separate stats refuses it (measured).
func TestSpoolAppendNeverRefusesABucketBeingBorn(t *testing.T) {
	home, dir := spoolHome(t)
	bucket := filepath.Join(dir, "2023111422.spool")
	fire(home, &bornFS{FS: regfs.OS{}, path: bucket}, "toolu_01")
	if b, _ := os.ReadFile(bucket); strings.Count(string(b), "\n") != 1 {
		t.Errorf("the line was refused or doubled: %q", b)
	}
}

// A symlink, a directory or a FIFO at the bucket's name is neither written through nor replaced, and a FIFO is never
// opened (it would block the hook past its bound).
func TestSpoolAppendRefusesANodeAtTheBucket(t *testing.T) {
	home, dir := spoolHome(t)
	bucket := filepath.Join(dir, "2023111422.spool")
	target := filepath.Join(home, "elsewhere")
	if err := os.WriteFile(target, []byte("untouched\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, bucket); err != nil {
		t.Fatal(err)
	}
	fire(home, regfs.OS{}, "toolu_01")
	if b, _ := os.ReadFile(target); string(b) != "untouched\n" {
		t.Errorf("written through a link: %q", b)
	}
	_ = os.Remove(bucket)
	if err := os.Mkdir(bucket, 0o755); err != nil {
		t.Fatal(err)
	}
	fire(home, regfs.OS{}, "toolu_02")
	if st, err := os.Lstat(bucket); err != nil || !st.IsDir() {
		t.Errorf("a directory at the bucket was replaced: %v", err)
	}
}
