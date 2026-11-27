package lock

import (
	"bufio"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func rowAt(t *testing.T) Row {
	t.Helper()
	return Row{Reg: t.TempDir(), ID: "lane-a-project-a", Pid: os.Getpid(), Rand: func() int { return rand.Intn(32768) }}
}

func never() bool { return false }

func residue(t *testing.T, r Row) []string {
	t.Helper()
	es, _ := os.ReadDir(r.Reg)
	var out []string
	for _, e := range es {
		if strings.Contains(e.Name(), "lock-open") || strings.Contains(e.Name(), "lock-init") || strings.Contains(e.Name(), "generation-read") {
			out = append(out, e.Name())
		}
	}
	return out
}

// An uncontended acquisition mints canonical once (a regular file), proves it, and leaves no init source and no alias;
// a second acquisition after the release takes the same inode.
func TestRowAcquireMintsOnceAndLeavesNothing(t *testing.T) {
	r := rowAt(t)
	h, o := r.Acquire(time.Second, never)
	if o != Acquired || !h.Same(r.Canonical()) {
		t.Fatalf("outcome %v", o)
	}
	st1, _ := os.Lstat(r.Canonical())
	h.Close()
	if res := residue(t, r); len(res) != 0 {
		t.Fatalf("residue %v", res)
	}
	h, o = r.Acquire(time.Second, never)
	if o != Acquired {
		t.Fatalf("second outcome %v", o)
	}
	defer h.Close()
	st2, _ := os.Lstat(r.Canonical())
	if !os.SameFile(st1, st2) || !st2.Mode().IsRegular() {
		t.Fatal("canonical was recreated")
	}
}

// A canonical that vanished under a live holder refuses before anything is minted.
func TestRowVanishedRefusesAndMintsNothing(t *testing.T) {
	r := rowAt(t)
	if _, o := r.Acquire(time.Second, func() bool { return true }); o != Vanished {
		t.Fatalf("outcome %v, want Vanished", o)
	}
	if exists(r.Canonical()) || len(residue(t, r)) != 0 {
		t.Fatal("something was minted")
	}
	// an incumbent canonical never asks the vanished probe
	h, o := r.Acquire(time.Second, never)
	if o != Acquired {
		t.Fatal(o)
	}
	h.Close()
	if _, o := r.Acquire(time.Second, func() bool { t.Fatal("asked with canonical present"); return true }); o != Acquired {
		t.Fatal(o)
	}
}

func exists(p string) bool { _, err := os.Lstat(p); return err == nil }

// A non-regular canonical (a directory, a link) is refused, never opened or replaced.
func TestRowRefusesANonRegularCanonical(t *testing.T) {
	for name, plant := range map[string]func(p string){
		"a directory": func(p string) { _ = os.Mkdir(p, 0o755) },
		"a link":      func(p string) { _ = os.WriteFile(p+".t", nil, 0o644); _ = os.Symlink(p+".t", p) },
	} {
		r := rowAt(t)
		plant(r.Canonical())
		if _, o := r.Acquire(time.Second, never); o != Refused {
			t.Errorf("%s: outcome %v", name, o)
		}
	}
}

// The acquisition waits its bound against a holder of the same inode (flock(1) on canonical, as ccd's bash holds it),
// and takes the lock once the holder lets go.
func TestRowWaitsItsBoundAgainstFlock(t *testing.T) {
	if _, err := exec.LookPath("flock"); err != nil {
		t.Skip("no flock(1) on PATH")
	}
	r := rowAt(t)
	h, _ := r.Acquire(time.Second, never)
	h.Close()
	holder := exec.Command("flock", "-x", r.Canonical(), "sh", "-c", "echo held; sleep 1.5")
	out, _ := holder.StdoutPipe()
	if err := holder.Start(); err != nil {
		t.Fatal(err)
	}
	_, _ = bufio.NewReader(out).ReadString('\n')
	t0 := time.Now()
	if _, o := r.Acquire(300*time.Millisecond, never); o != Refused || time.Since(t0) < 250*time.Millisecond {
		t.Fatalf("outcome %v after %v: a contended acquisition refuses at its bound", o, time.Since(t0))
	}
	h, o := r.Acquire(5*time.Second, never)
	if o != Acquired || time.Since(t0) < time.Second {
		t.Fatalf("outcome %v after %v", o, time.Since(t0))
	}
	h.Close()
	_ = holder.Wait()
}

// A canonical replaced under a holder is no longer the holder's: Same answers false (item 3's proof).
func TestRowSameSeesAReplacement(t *testing.T) {
	r := rowAt(t)
	h, _ := r.Acquire(time.Second, never)
	defer h.Close()
	_ = os.Remove(r.Canonical())
	_ = os.WriteFile(r.Canonical(), nil, 0o600)
	if h.Same(r.Canonical()) {
		t.Fatal("a replaced canonical still reads as the holder's")
	}
}

// The generation is read through a private alias that goes at once, NUL bytes dropped, at most 37 others.
func TestRowGeneration(t *testing.T) {
	r := rowAt(t)
	g := filepath.Join(r.Reg, r.ID+".generation")
	for body, want := range map[string]string{
		"0189abcd-1234-5678-9abc-0123456789ab":       "0189abcd-1234-5678-9abc-0123456789ab",
		"0189abcd-1234-5678-9abc-0123456789ab\n":     "0189abcd-1234-5678-9abc-0123456789ab\n",
		"0189abcd-1234-5678-9abc-0123456789ab\x00":   "0189abcd-1234-5678-9abc-0123456789ab",
		"0189abcd-1234-5678-9abc-0123456789abcdefgh": "0189abcd-1234-5678-9abc-0123456789abc",
	} {
		_ = os.WriteFile(g, []byte(body), 0o644)
		if got, ok := r.Generation(); !ok || got != want {
			t.Errorf("%q: %q %v, want %q", body, got, ok, want)
		}
	}
	if len(residue(t, r)) != 0 {
		t.Fatal("an alias was left behind")
	}
	_ = os.Remove(g)
	if _, ok := r.Generation(); ok {
		t.Fatal("an absent generation read")
	}
}

// Go opens every descriptor close-on-exec, so a child the holder starts never inherits the row's lock (the hazard the
// bash's "nothing may be backgrounded" case pins is the bash's own): with a child still running, a stranger takes it.
func TestRowLockNotInherited(t *testing.T) {
	if _, err := exec.LookPath("flock"); err != nil {
		t.Skip("no flock(1) on PATH")
	}
	r := rowAt(t)
	h, _ := r.Acquire(time.Second, never)
	child := exec.Command("sleep", "5")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	h.Close()
	if err := exec.Command("flock", "-n", r.Canonical(), "true").Run(); err != nil {
		t.Fatal("the row's lock outlived its holder in a child")
	}
}

// The /proc scan names a live descriptor on an unlinked alias, and nothing after it is closed.
func TestProcNames(t *testing.T) {
	if _, err := os.Stat("/proc/self/fd"); err != nil || runtime.GOOS == "windows" {
		t.Skip("no /proc (Windows: TestProcNamesWindowsAsBash)")
	}
	r := rowAt(t)
	h, _ := r.Acquire(time.Second, never)
	if !ProcNames(r.OpenPrefix()) {
		t.Fatal("the holder's descriptor on its unlinked alias is not named")
	}
	h.Close()
	if ProcNames(r.OpenPrefix()) {
		t.Fatal("a closed descriptor is still named")
	}
	// D-TBD-go-hook-proc-glob: a prefix find would read as a pattern answers named, whatever is open
	for _, g := range []string{"*", "?", "[", `\`} {
		if !ProcNames(r.Reg + "/h" + g + "/.x.compactions.lock-open.") {
			t.Errorf("a prefix holding %q is not answered named", g)
		}
	}
}

// On Windows the bash hook's own arm (b) is the measure: its exact find, run by MSYS2's bash beside a separate holder
// that keeps the bash hook's descriptor on its unlinked alias, names nothing (MSYS2's /proc shows another process's
// descriptors to no one), and ProcNames answers the same. CONTROL: the holder's own process does see its descriptor.
func TestProcNamesWindowsAsBash(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows only: elsewhere TestProcNames")
	}
	needBashLock(t)
	r := rowAt(t)
	h, _ := r.Acquire(time.Second, never)
	h.Close()
	script := `al="$0/.$1.compactions.lock-open.1.2.3"; link "$0/.$1.compactions.lock" "$al" || exit 9
( exec {fd}<>"$al"; rm -f "$al"; flock -w 1 $fd || exit 8; find /proc/$BASHPID/fd -lname "$al*" -print | grep -q . && echo self-named; echo held; sleep 3 ) &
sleep 1.5
find /proc -mindepth 3 -maxdepth 3 -path '/proc/[0-9]*/fd/*' -lname "$0/.$1.compactions.lock-open.*" -print -quit 2>/dev/null | grep -q . && echo other-named
wait`
	out, err := exec.Command("bash", "-c", script, bashPath(t, r.Reg), r.ID).Output()
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	if got := strings.Join(strings.Fields(string(out)), " "); got != "self-named held" {
		t.Fatalf("the bash hook's arm (b) on MSYS2 answered %q, want the holder named by itself only", got)
	}
	if ProcNames(r.OpenPrefix()) {
		t.Fatal("ProcNames names a holder the bash hook's arm cannot see")
	}
}
