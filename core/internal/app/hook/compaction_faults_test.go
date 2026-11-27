package hook

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"ccrc/core/internal/adapter/regfs"
)

// The Go twins of session-hook.test.ts's bash-only fault cases (Task 8b fix round 1, F2): each fault the bash suite lands
// through a stand-in for a tool the Go hook never forks is landed here through the hook's ports (the helper's run, the
// registry's FS, the row lock's generation read), and each test names the guard it holds.

// withHelper sets the `node` helper's stand-in for one test.
func withHelper(t *testing.T, f func(name string, args []string) (RunResult, bool)) {
	testHelper = f
	t.Cleanup(func() { testHelper = nil })
}

// argOf is the value after flag k in a helper's argv.
func argOf(args []string, k string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == k {
			return args[i+1]
		}
	}
	return ""
}

// stage writes the helper's two stages as a finished helper leaves them.
func stage(args []string) {
	n := argOf(args, "--nonce")
	_ = os.WriteFile(argOf(args, "--card-stage"), []byte(n+"\ngraphify card — staged\n"), 0o644)
	_ = os.WriteFile(argOf(args, "--set-stage"), []byte(`{"v":1,"at":1,"nonce":"`+n+`","scope":"main","files":[]}`+"\n"), 0o644)
}

// preTree is a PreCompact over a fresh graphed tree, the helper's arm reached.
func preTree(t *testing.T) (home, reg string, payload string) {
	needTools(t, "flock", "mktemp", "link", "find", "git", "timeout")
	home, reg, tp := cHome(t)
	tree := gitTree(t, home)
	write(t, filepath.Join(reg, "compact-card.mjs"), "")
	return home, reg, `{"hook_event_name":"PreCompact","session_id":"` + cSID + `","transcript_path":"` + tp + `","trigger":"manual","cwd":"` + tree + `"}`
}

// THE CAS (the bash's "THE CAS: a sibling that publishes its own verdict while the helper runs keeps it"): a sibling
// that publishes its set while the helper runs owns the slot, and the second section renames nothing over it. Guards
// compactPre's `n == nonce` compare.
func TestPreCASKeepsASiblingsSet(t *testing.T) {
	home, reg, payload := preTree(t)
	sibling := `{"v":1,"at":2,"nonce":"compact-9-9-9-9","scope":"main"}` + "\n"
	withHelper(t, func(name string, args []string) (RunResult, bool) {
		if name != "node" || len(args) < 2 || args[1] != "card" {
			return RunResult{}, false
		}
		stage(args)
		_ = os.WriteFile(filepath.Join(reg, cID+".compactset"), []byte(sibling), 0o644)
		return RunResult{}, true
	})
	fireC(home, payload, newSeam(0))
	if b, _ := os.ReadFile(filepath.Join(reg, cID+".compactset")); string(b) != sibling {
		t.Errorf("the sibling's set was replaced: %q", b)
	}
	if exists(filepath.Join(reg, cID+".compactcard")) || len(names(t, reg, ".stage")) != 0 {
		t.Errorf("a card was published over a slot that is not ours, or stages were left: %v", names(t, reg, ".stage"))
	}
}

// A nonzero helper (the bash's "records working hookstate before the bounded helper starts and rolls back … after a
// nonzero helper"): the hookstate's working stamp is on disk before the helper runs, and a helper that exits nonzero
// publishes nothing and leaves no stage. Guards the helper rc switch (0 renames both, 3 the set alone).
func TestPreNonzeroHelperPublishesNothing(t *testing.T) {
	home, reg, payload := preTree(t)
	state := ""
	withHelper(t, func(name string, args []string) (RunResult, bool) {
		if name != "node" || len(args) < 2 || args[1] != "card" {
			return RunResult{}, false
		}
		b, _ := os.ReadFile(filepath.Join(reg, cID+".hookstate.json"))
		state = string(b)
		stage(args)
		return RunResult{Rc: 1}, true
	})
	fireC(home, payload, newSeam(0))
	if !strings.Contains(state, `"state":"working"`) {
		t.Errorf("the working stamp was not on disk when the helper ran: %q", state)
	}
	b, _ := os.ReadFile(filepath.Join(reg, cID+".compactset"))
	if exists(filepath.Join(reg, cID+".compactcard")) || strings.Contains(string(b), `"files":[]`) || len(names(t, reg, ".stage")) != 0 {
		t.Errorf("a nonzero helper's stages were published (card %v, set %q) or left %v", exists(filepath.Join(reg, cID+".compactcard")), b, names(t, reg, ".stage"))
	}
}

// CLOSE-BEFORE-FORK, by effect (the bash's case of that name): the row's lock is free while the helper runs, so a
// stranger's `flock -n` on canonical succeeds from inside the helper. Guards the release before the helper.
func TestPreReleasesTheLockBeforeTheHelper(t *testing.T) {
	home, reg, payload := preTree(t)
	free := -1
	withHelper(t, func(name string, args []string) (RunResult, bool) {
		if name != "node" || len(args) < 2 || args[1] != "card" {
			return RunResult{}, false
		}
		err := exec.Command("flock", "-n", filepath.Join(reg, "."+cID+".compactions.lock"), "true").Run()
		free = 0
		if err != nil {
			free = 1
		}
		stage(args)
		return RunResult{}, true
	})
	fireC(home, payload, newSeam(0))
	if free != 0 {
		t.Fatalf("flock -n from inside the helper answered %d: the hook held the row across the helper", free)
	}
}

// failFS fails one act on one name, as the bash suite's stand-ins fail cat, rm and touch.
type failFS struct {
	regfs.OS
	writeTo, removeOf string // WriteFile to / Remove of a name holding this
	touch             func(p string) error
}

func (f failFS) WriteFile(p string, b []byte, m os.FileMode) error {
	if f.writeTo != "" && strings.Contains(filepath.Base(p), f.writeTo) {
		return os.ErrPermission
	}
	return f.OS.WriteFile(p, b, m)
}

func (f failFS) Remove(p string) error {
	if f.removeOf != "" && filepath.Base(p) == f.removeOf {
		return os.ErrPermission
	}
	return f.OS.Remove(p)
}

func (f failFS) Touch(p string) error {
	if f.touch != nil {
		return f.touch(p)
	}
	return f.OS.Touch(p)
}

// postFixture is a set PreCompact left and the helper's file, ready for a PostCompact.
func postFixture(t *testing.T) (home, reg, tp, set string) {
	needTools(t, "flock", "mktemp", "link", "find", "touch")
	home, reg, tp = cHome(t)
	plantPair(t, reg)
	write(t, filepath.Join(reg, "compact-card.mjs"), "")
	return home, reg, tp, filepath.Join(reg, cID+".compactset")
}

// A FAILED SNAPSHOT COPY (the bash's case of that name): nothing commits, the verified claim is retained, and this
// process's snapshot goes. Guards settle's return on a failed copy.
func TestPostFailedSnapshotCopyCommitsNothing(t *testing.T) {
	home, reg, tp, _ := postFixture(t)
	fireCWith(home, postC(tp), newSeam(0), failFS{writeTo: "compactions-snapshot"})
	if exists(filepath.Join(reg, cID+".compactions")) || len(names(t, reg, "compactpost")) != 1 || len(names(t, reg, "compactions-snapshot")) != 0 {
		t.Errorf("journal %v, claims %v, snapshots %v", exists(filepath.Join(reg, cID+".compactions")), names(t, reg, "compactpost"), names(t, reg, "compactions-snapshot"))
	}
}

// A FAILED canonical unlink (the bash's case of that name): canonical's bytes and mtime stand, only the claim goes,
// nothing commits. Guards settle's return on the failed unlink, before the touch that would stamp the shared inode.
func TestPostFailedUnlinkKeepsTheSet(t *testing.T) {
	home, reg, tp, set := postFixture(t)
	old := time.Now().Add(-3 * time.Minute)
	_ = os.Chtimes(set, old, old)
	before, _ := os.ReadFile(set)
	fireCWith(home, postC(tp), newSeam(0), failFS{removeOf: cID + ".compactset"})
	after, _ := os.ReadFile(set)
	st, err := os.Lstat(set)
	if err != nil || string(after) != string(before) || !st.ModTime().Equal(old) {
		t.Errorf("the set changed: %v %q mtime %v", err, after, st.ModTime())
	}
	if len(names(t, reg, "compactpost")) != 0 || exists(filepath.Join(reg, cID+".compactions")) {
		t.Errorf("claims %v, journal %v", names(t, reg, "compactpost"), exists(filepath.Join(reg, cID+".compactions")))
	}
}

// A COLLIDING restore (the bash's "…but a COLLIDING restore never overwrites the occupant, and RETAINS the claim"): the
// claim's stamp fails while a stranger takes canonical's free name; the no-clobber restore leaves the stranger standing
// and keeps the claim, the only copy of the set's bytes. Guards the restore's link-then-prove before the claim goes.
func TestPostCollidingRestoreKeepsTheOccupantAndTheClaim(t *testing.T) {
	home, reg, tp, set := postFixture(t)
	stranger := "a stranger's set\n"
	fireCWith(home, postC(tp), newSeam(0), failFS{touch: func(string) error {
		_ = os.WriteFile(set, []byte(stranger), 0o644)
		return os.ErrPermission
	}})
	if b, _ := os.ReadFile(set); string(b) != stranger {
		t.Errorf("the occupant was overwritten: %q", b)
	}
	if len(names(t, reg, "compactpost")) != 1 || exists(filepath.Join(reg, cID+".compactions")) {
		t.Errorf("claims %v, journal %v", names(t, reg, "compactpost"), exists(filepath.Join(reg, cID+".compactions")))
	}
}

// The served marker revalidates the generation (the bash's "the MARKER publication revalidates the generation — a row
// re-authorized between the print and the mark mints nothing"): the card is served, but a row whose generation answers
// another's by the mark publishes no marker. Guards markServed's generationOK.
func TestMarkServedRevalidatesTheGeneration(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find")
	for _, bad := range []int{0, 2} { // read 1 is the serve's, read 2 the mark's
		home, reg, _ := cHome(t)
		n := plantPair(t, reg)
		l := newSeam(0)
		k := 0
		l.genCalls, l.badGenAt = &k, bad
		out := fireC(home, startC(), l)
		marked := exists(filepath.Join(reg, "."+cID+".compactserved."+n))
		if !strings.Contains(out, "graphify card — planted") || marked != (bad == 0) {
			t.Errorf("bad read %d: served %v, marker %v", bad, strings.Contains(out, "graphify card — planted"), marked)
		}
	}
}

// epipe is a stdout whose reader has gone.
type epipe struct{}

func (epipe) Write([]byte) (int, error) { return 0, syscall.EPIPE }

// The SessionStart card's print is untrapped in the bash, so a reader gone kills it there: no served marker and no
// tail stage (here, the clear's turn marker). The Go hook stops at the same print (F3).
func TestSessionStartStopsAtABrokenPipe(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find")
	for _, broken := range []bool{false, true} {
		home, reg, _ := cHome(t)
		if broken {
			testStdout = epipe{}
		}
		fireC(home, `{"hook_event_name":"SessionStart","source":"clear","session_id":"`+cSID+`","transcript_path":"/t.jsonl"}`, newSeam(0))
		testStdout = nil
		if marked := exists(filepath.Join(reg, cID+".turn.json")); marked == broken {
			t.Errorf("broken pipe %v: the tail's turn marker written %v", broken, marked)
		}
	}
}
