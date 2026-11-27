//go:build !windows

package regfs

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
)

// The Go twin of session-hook-append-race.test.ts's history-spool cut (D-7503): the append refuses only a POSITIVE
// non-regular type, opens the file once and writes only through that descriptor. The bash test cuts the guard out of
// `_hook_history_spool_append` and races it; here the guard is AppendRegular itself, raced the same way.

func lines(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return string(b)
}

// A positive non-regular type at the path writes nothing and creates nothing; absent and regular take the line.
func TestAppendRegularTypes(t *testing.T) {
	d := t.TempDir()
	target := filepath.Join(d, "target")
	if err := os.WriteFile(target, []byte("outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mk := map[string]func(p string){
		"a live link":     func(p string) { _ = os.Symlink(target, p) },
		"a dangling link": func(p string) { _ = os.Symlink(filepath.Join(d, "nowhere"), p) },
		"a directory":     func(p string) { _ = os.Mkdir(p, 0o755) },
		"a FIFO":          func(p string) { _ = syscall.Mkfifo(p, 0o644) },
	}
	for name, f := range mk {
		p := filepath.Join(d, strings.ReplaceAll(name, " ", "-"))
		f(p)
		if err := (OS{}).AppendRegular(p, []byte("\nline\n")); err != nil {
			t.Errorf("%s: %v", name, err)
		}
		if lines(t, target) != "outside\n" {
			t.Errorf("%s: the link's target was written", name)
		}
	}
	if _, err := os.Lstat(filepath.Join(d, "a-dangling-link")); err != nil {
		t.Error("a dangling link was replaced")
	}
	if _, err := os.Stat(filepath.Join(d, "nowhere")); err == nil {
		t.Error("a dangling link's target was created")
	}
	p := filepath.Join(d, "spool.jsonl")
	for i := 0; i < 2; i++ { // absent, then regular
		if err := (OS{}).AppendRegular(p, []byte("\nx\n")); err != nil {
			t.Fatal(err)
		}
	}
	if got := lines(t, p); got != "\nx\n\nx\n" {
		t.Errorf("absent then regular: %q", got)
	}
}

// A symlink swapped in after the guard never receives the line (its target stays byte-identical), though the open
// follows it; a drain that renames the file after the open gets the line in the renamed file, and no new file is made.
func TestAppendRegularSwapAfterGuardAndOpen(t *testing.T) {
	d := t.TempDir()
	p, outside := filepath.Join(d, "s.jsonl"), filepath.Join(d, "outside.txt")
	if err := os.WriteFile(outside, []byte("outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	afterGuard = func() { _ = os.Remove(p); _ = os.Symlink(outside, p) }
	_ = (OS{}).AppendRegular(p, []byte("\nline\n"))
	afterGuard = func() {}
	if st, _ := os.Lstat(p); st == nil || st.Mode()&os.ModeSymlink == 0 {
		t.Fatal("the swap did not happen")
	}
	if got := lines(t, outside); got != "outside\n" {
		t.Errorf("the link's target received the line: %q", got)
	}

	q, drained := filepath.Join(d, "q.jsonl"), filepath.Join(d, "q.draining")
	if err := os.WriteFile(q, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	afterOpen = func() { _ = os.Rename(q, drained) }
	_ = (OS{}).AppendRegular(q, []byte("\nline\n"))
	afterOpen = func() {}
	if got := lines(t, drained); got != "\nline\n" {
		t.Errorf("the renamed file: %q", got)
	}
	if _, err := os.Lstat(q); err == nil {
		t.Error("a new spool file was made after the drain")
	}
}

// The path moves both ways under the appender: a drain renames the file away and a sibling creates it again whenever it
// is absent. Every append lands in the spool file or a drained one, so a guard that refuses a file that is only moving
// between absent and regular loses lines here. Four races at once.
func TestAppendRegularLosesNoLineUnderADrain(t *testing.T) {
	const lanes, drains = 4, 400
	root := t.TempDir()
	var wg sync.WaitGroup
	ran := make([]int, lanes)
	for l := 0; l < lanes; l++ {
		dir := filepath.Join(root, fmt.Sprint("lane", l))
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		wg.Add(1)
		go func(l int, dir string) {
			defer wg.Done()
			p, stop := filepath.Join(dir, "s.jsonl"), make(chan struct{})
			var side sync.WaitGroup
			side.Add(2)
			go func() { // the drain
				defer side.Done()
				for k := 0; k < drains; k++ {
					_ = os.Rename(p, filepath.Join(dir, fmt.Sprint("drained.", k)))
				}
				close(stop)
			}()
			go func() { // the sibling hook that creates it again
				defer side.Done()
				for {
					select {
					case <-stop:
						return
					default:
						if _, err := os.Lstat(p); err != nil {
							if f, err := os.OpenFile(p, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o666); err == nil {
								f.Close()
							}
						}
					}
				}
			}()
			for i := 1; ; i++ {
				select {
				case <-stop:
					side.Wait()
					return
				default:
				}
				if err := (OS{}).AppendRegular(p, []byte(fmt.Sprintf("\nL%d\n", i))); err != nil {
					t.Errorf("append: %v", err)
					return
				}
				ran[l] = i
			}
		}(l, dir)
	}
	wg.Wait()
	for l := 0; l < lanes; l++ {
		dir := filepath.Join(root, fmt.Sprint("lane", l))
		es, _ := os.ReadDir(dir)
		found := 0
		for _, e := range es {
			for _, x := range strings.Split(lines(t, filepath.Join(dir, e.Name())), "\n") {
				if strings.HasPrefix(x, "L") {
					found++
				}
			}
		}
		if ran[l] == 0 || found != ran[l] {
			t.Errorf("lane %d: %d appends ran, %d lines landed", l, ran[l], found)
		}
	}
}
