package lock

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// The bash hook's lock family and this adapter on ONE row (Task 8b fix round 1, F1 and F6). The bash side is the hook's
// own functions, cut from ccd/session-hook.sh by name (`_hook_lock_same`, `_vanished`, `_init`, `_acquire`, `_release`)
// and run in a plain bash over the same $REG and id, so a lock the two spell differently, or take on different inodes,
// shows here as two holders at once.

const hookPath = "../../../../ccd/session-hook.sh"

// bashLock writes a bash script that defines the hook's lock functions and then runs body with REG and id set.
func bashLock(t *testing.T, r Row, body string) string {
	t.Helper()
	src, err := os.ReadFile(hookPath)
	if err != nil {
		t.Fatal(err)
	}
	var cut []string
	for _, fn := range []string{"_hook_lock_same", "_hook_lock_vanished", "_hook_lock_init", "_hook_lock_acquire", "_hook_lock_release"} {
		at := strings.Index(string(src), "\n"+fn+"() {")
		if at < 0 {
			t.Fatalf("the hook defines no %s", fn)
		}
		end := strings.Index(string(src)[at+1:], "\n}\n")
		cut = append(cut, string(src)[at+1:at+1+end+2])
	}
	p := filepath.Join(t.TempDir(), "lock.bash")
	script := "set -u\nREG=" + strconv.Quote(bashPath(t, r.Reg)) + "\nid=" + strconv.Quote(r.ID) + "\n" + strings.Join(cut, "\n") + "\n" + body + "\n"
	if err := os.WriteFile(p, []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func needBashLock(t *testing.T) {
	t.Helper()
	for _, n := range []string{"bash", "flock", "mktemp", "link", "find"} {
		if _, err := exec.LookPath(n); err != nil {
			t.Skipf("no %s on PATH", n)
		}
	}
	if exec.Command("bash", "-c", "[ -e /proc/self/fd ]").Run() != nil {
		t.Skip("the hook's inode proof reads /proc/self/fd")
	}
}

// bashPath is p as the bash hook holds it: on Windows MSYS2's spelling (`cygpath -u`, as $HOME reaches bash there), so
// its /proc scan reads names the way the hook's does.
func bashPath(t *testing.T, p string) string {
	t.Helper()
	if runtime.GOOS != "windows" {
		return p
	}
	out, err := exec.Command("cygpath", "-u", "--", p).Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimRight(string(out), "\n")
}

// minted is a row whose canonical exists (minted by this adapter, as any first acquisition does).
func minted(t *testing.T) Row {
	r := rowAt(t)
	h, o := r.Acquire(time.Second, never)
	if o != Acquired {
		t.Fatal(o)
	}
	h.Close()
	return r
}

// MUTUAL EXCLUSION, measured inside the critical section: four bash and four Go workers each take the row's lock
// `rounds` times, and inside the section append `enter <who>`, wait a few milliseconds, then append `exit <who>` to one
// log (O_APPEND: the log's order is the order the writes happened in). Any `enter` while another holds is an overlap.
func TestBashAndGoExcludeOnTheRow(t *testing.T) {
	needBashLock(t)
	r := minted(t)
	log := filepath.Join(t.TempDir(), "cs.log")
	const rounds = 25
	script := bashLock(t, r, `for i in $(seq `+strconv.Itoa(rounds)+`); do
  _hook_lock_acquire 30 || { echo "refused bash-$$" >> "$1"; continue; }
  echo "enter bash-$$" >> "$1"; sleep 0.003; echo "exit bash-$$" >> "$1"
  _hook_lock_release "$HOOK_LOCK_FD"
done`)
	appendLine := func(s string) {
		f, err := os.OpenFile(log, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o644)
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = f.WriteString(s + "\n")
		_ = f.Close()
	}
	var wg sync.WaitGroup
	for w := 0; w < 4; w++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			if out, err := exec.Command("bash", script, log).CombinedOutput(); err != nil {
				t.Errorf("bash worker: %v %s", err, out)
			}
		}()
		go func(w int) {
			defer wg.Done()
			who := fmt.Sprintf("go-%d", w)
			for i := 0; i < rounds; i++ {
				h, o := r.Acquire(30*time.Second, never)
				if o != Acquired {
					appendLine("refused " + who)
					continue
				}
				appendLine("enter " + who)
				time.Sleep(3 * time.Millisecond)
				appendLine("exit " + who)
				h.Close()
			}
		}(w)
	}
	wg.Wait()
	f, err := os.Open(log)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	holder, enters, bashIn, goIn := "", 0, 0, 0
	sc := bufio.NewScanner(f)
	for n := 1; sc.Scan(); n++ {
		verb, who, _ := strings.Cut(sc.Text(), " ")
		switch verb {
		case "enter":
			if holder != "" {
				t.Fatalf("line %d: %s entered while %s held the row's lock", n, who, holder)
			}
			holder = who
			enters++
			if strings.HasPrefix(who, "bash-") {
				bashIn++
			} else {
				goIn++
			}
		case "exit":
			if holder != who {
				t.Fatalf("line %d: %s exited while %q held", n, who, holder)
			}
			holder = ""
		default:
			t.Fatalf("line %d: %s", n, sc.Text())
		}
	}
	if bashIn != 4*rounds || goIn != 4*rounds {
		t.Fatalf("bash entered %d times, Go %d (want %d each)", bashIn, goIn, 4*rounds)
	}
}

// Deterministic, both directions: a Go holder keeps flock(1) and the bash hook's acquire out until it lets go; a bash
// holder (the hook's own acquire) keeps the Go acquire out until it lets go.
func TestBashAndGoBlockEachOther(t *testing.T) {
	needBashLock(t)
	r := minted(t)
	try := bashLock(t, r, `_hook_lock_acquire 0.3 && { echo got; _hook_lock_release "$HOOK_LOCK_FD"; } || echo refused`)
	bashTry := func() string {
		out, _ := exec.Command("bash", try).Output()
		return strings.TrimSpace(string(out))
	}
	h, _ := r.Acquire(time.Second, never)
	if exec.Command("flock", "-n", r.Canonical(), "true").Run() == nil {
		t.Error("flock(1) took the row while the Go hook held it")
	}
	if got := bashTry(); got != "refused" {
		t.Errorf("the bash hook's acquire answered %q while the Go hook held the row", got)
	}
	h.Close()
	if got := bashTry(); got != "got" {
		t.Errorf("CONTROL: after the release the bash acquire answered %q", got)
	}
	hold := bashLock(t, r, `_hook_lock_acquire 1 || exit 1; echo held; read -r _`)
	cmd := exec.Command("bash", hold)
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if line, _ := bufio.NewReader(stdout).ReadString('\n'); strings.TrimSpace(line) != "held" {
		t.Fatalf("the bash holder answered %q", line)
	}
	if _, o := r.Acquire(300*time.Millisecond, never); o != Refused {
		t.Errorf("the Go acquire answered %v while the bash hook held the row", o)
	}
	_ = stdin.Close()
	_ = cmd.Wait()
	g, o := r.Acquire(time.Second, never)
	if o != Acquired {
		t.Fatalf("CONTROL: after the bash release the Go acquire answered %v", o)
	}
	g.Close()
}

// LIVENESS (F6): six bash and six Go waiters queue on one row held by flock(1) for a second; each holds 50 ms once in.
// The bash waits in the kernel (`flock -w`) and the Go acquire polls, so a polling waiter could lose every release to a
// kernel-queued one: measured, every waiter gets in within the bash's own 5 s bound.
func TestBashAndGoWaitersAllGetIn(t *testing.T) {
	needBashLock(t)
	r := minted(t)
	holder := exec.Command("flock", "-x", r.Canonical(), "sh", "-c", "echo held; sleep 1")
	out, _ := holder.StdoutPipe()
	if err := holder.Start(); err != nil {
		t.Fatal(err)
	}
	_, _ = bufio.NewReader(out).ReadString('\n')
	script := bashLock(t, r, `_hook_lock_acquire 5 && { sleep 0.05; _hook_lock_release "$HOOK_LOCK_FD"; echo got; } || echo refused`)
	var mu sync.Mutex
	got := map[string]int{}
	var wg sync.WaitGroup
	for w := 0; w < 6; w++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			o, _ := exec.Command("bash", script).Output()
			mu.Lock()
			got["bash "+strings.TrimSpace(string(o))]++
			mu.Unlock()
		}()
		go func() {
			defer wg.Done()
			h, o := r.Acquire(5*time.Second, never)
			word := "go refused"
			if o == Acquired {
				time.Sleep(50 * time.Millisecond)
				h.Close()
				word = "go got"
			}
			mu.Lock()
			got[word]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	_ = holder.Wait()
	if got["bash got"] != 6 || got["go got"] != 6 {
		t.Fatalf("waiters: %v (want six of each in)", got)
	}
}
