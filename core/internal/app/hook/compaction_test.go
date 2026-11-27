package hook

import (
	"bytes"
	"io"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"ccrc/core/internal/adapter/lock"
	"ccrc/core/internal/adapter/regfs"
)

// The compaction arms through the hook's ports (Go core wave 2, Task 8b): the real registry and the real row lock, with a
// fault seam on the lock's identity proof. session-hook.test.ts's ITEM 3 cases land a canonical replacement inside a
// tool the bash forks (find, mv, rm, touch); the Go hook forks none of them, so the same fault is a Same() that answers
// "no longer canonical" at its Nth call, site by site.

const (
	cID  = "lane-a-project-a"
	cGen = "0189abcd-1234-5678-9abc-0123456789ab"
	cSID = "00000000-0000-4000-8000-000000000001"
)

// seamLock is the row lock with its canonical proof failing from call `failAt` on (0: never).
type seamLock struct {
	failAt   int
	calls    *int
	badGenAt int  // the generation read that answers another row's (0: never)
	genCalls *int // generation reads so far
}

type seamHeld struct {
	*lock.Held
	l seamLock
}

func (h seamHeld) Same(p string) bool {
	if strings.HasSuffix(p, ".compactions.lock") {
		*h.l.calls++
		if h.l.failAt > 0 && *h.l.calls >= h.l.failAt {
			return false
		}
	}
	return h.Held.Same(p)
}

func (l seamLock) row(reg, id string) lock.Row {
	return lock.Row{Reg: reg, ID: id, Pid: os.Getpid(), Rand: func() int { return rand.Intn(32768) }}
}

func (l seamLock) Acquire(reg, id string, wait time.Duration, vanished func() bool) (Held, bool, bool) {
	h, o := l.row(reg, id).Acquire(wait, vanished)
	if o != lock.Acquired {
		return nil, false, o == lock.Vanished
	}
	return seamHeld{h, l}, true, false
}

func (l seamLock) Generation(reg, id string) (string, bool) {
	if l.genCalls != nil {
		if *l.genCalls++; *l.genCalls == l.badGenAt {
			return "0189abcd-0000-0000-0000-000000000000", true
		}
	}
	return l.row(reg, id).Generation()
}
func (seamLock) Open(p string) (Held, error) {
	h, err := lock.OpenRead(p)
	if err != nil {
		return nil, err
	}
	return h, nil
}
func (seamLock) ProcNames(prefix string) bool        { return lock.ProcNames(prefix) }
func (seamLock) Mktemp(prefix string) (string, bool) { return lock.Mktemp(prefix) }

func needTools(t *testing.T, names ...string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the row lock is Parked for Task 9 on Windows")
	}
	for _, n := range names {
		if _, err := exec.LookPath(n); err != nil {
			t.Skipf("no %s on PATH", n)
		}
	}
}

// cHome is a fixture HOME: the row's generation, a main transcript and the hook's helper absent.
func cHome(t *testing.T) (home, reg, transcript string) {
	t.Helper()
	home = t.TempDir()
	reg = filepath.Join(home, ".cc-sessions")
	if err := os.MkdirAll(reg, 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(reg, cID+".generation"), cGen)
	transcript = filepath.Join(home, "t", cSID+".jsonl")
	write(t, transcript, "{\"type\":\"user\"}\n")
	old := time.Now().Add(-10 * time.Minute)
	_ = os.Chtimes(transcript, old, old)
	return home, reg, transcript
}

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

// testHelper, when set, answers a process run first (ok false falls through to the defaults below); testStdout, when
// set, is the hook's stdout. Each test that sets one clears it.
var (
	testHelper func(name string, args []string) (RunResult, bool)
	testStdout io.Writer
)

// fireC runs the hook once over payload with the seam lock; it answers stdout.
func fireC(home, payload string, l seamLock) string { return fireCWith(home, payload, l, regfs.OS{}) }

// measureJSON is the helper's `measure` answer the node stand-in gives: a shape the record predicate accepts.
const measureJSON = `{"chars":12,"fences":0,"at":1795600000500,"trigger":"manual","steered":false,"served":false,"filesChars":null,"cited":null,"setSize":null,"scope":"main"}`

// fireCWith is fireC over fsys; `node … measure` answers measureJSON, every other process cannot start.
func fireCWith(home, payload string, l seamLock, fsys FS) string {
	env := map[string]string{"HOME": home, "TMUX_PANE": "%1", "CCRC_SESSION_GENERATION": cGen, "CLAUDE_CODE_SESSION_ID": cSID,
		"PATH": os.Getenv("PATH")}
	var out bytes.Buffer
	var stdout io.Writer = &out
	if testStdout != nil {
		stdout = testStdout
	}
	Main(strings.NewReader(payload), IO{Stdout: stdout, Getenv: func(k string) string { return env[k] }, FS: fsys, Pid: os.Getpid(),
		GOOS: runtime.GOOS, NowMs: func() int64 { return time.Now().UnixMilli() },
		Found: func(n string) bool { _, err := exec.LookPath(n); return err == nil },
		Rand:  func() int { return rand.Intn(32768) },
		Git: func(dir string, args ...string) (string, bool) {
			out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
			return strings.TrimRight(string(out), "\n"), err == nil
		},
		TmuxSession: func(string, string, string) string { return "cc-" + cID },
		Run: func(b time.Duration, in []byte, extra []string, merge bool, name string, args ...string) RunResult {
			if testHelper != nil {
				if r, ok := testHelper(name, args); ok {
					return r
				}
			}
			if name == "node" && len(args) > 1 && args[1] == "measure" {
				return RunResult{Out: []byte(measureJSON + "\n")}
			}
			if name == "node" && len(args) > 1 && args[1] == "card" { // the helper's stages, written whole, exit 0
				arg := func(k string) string {
					for i := range args[:len(args)-1] {
						if args[i] == k {
							return args[i+1]
						}
					}
					return ""
				}
				n := arg("--nonce")
				_ = os.WriteFile(arg("--card-stage"), []byte(n+"\ngraphify card — staged\n"), 0o644)
				_ = os.WriteFile(arg("--set-stage"), []byte(`{"v":1,"at":1,"nonce":"`+n+`","scope":"main","files":[]}`+"\n"), 0o644)
				return RunResult{}
			}
			return RunResult{Rc: 127}
		},
		Lock: l})
	return out.String()
}

func newSeam(failAt int) seamLock { n := 0; return seamLock{failAt: failAt, calls: &n} }

func preC(tp, trig string) string {
	return `{"hook_event_name":"PreCompact","session_id":"` + cSID + `","transcript_path":"` + tp + `","trigger":"` + trig + `"}`
}

func startC() string {
	return `{"hook_event_name":"SessionStart","source":"compact","session_id":"` + cSID + `","transcript_path":"/t.jsonl"}`
}

// plantPair is a young set and its card, as PreCompact leaves them.
func plantPair(t *testing.T, reg string) string {
	n := "compact-" + strconv.FormatInt(time.Now().UnixMilli(), 10) + "-4242-31-7"
	write(t, filepath.Join(reg, cID+".compactset"), `{"v":1,"at":1,"nonce":"`+n+`","scope":"main"}`+"\n")
	write(t, filepath.Join(reg, cID+".compactcard"), n+"\ngraphify card — planted\n")
	return n
}

func TestServeMarksServed(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find")
	home, reg, _ := cHome(t)
	n := plantPair(t, reg)
	out := fireC(home, startC(), newSeam(0))
	if !strings.Contains(out, "graphify card — planted") {
		t.Fatalf("the card was not served: %q", out)
	}
	if _, err := os.Lstat(filepath.Join(reg, "."+cID+".compactserved."+n)); err != nil {
		t.Fatalf("no served marker after the print: %v", err)
	}
}

func exists(p string) bool { _, err := os.Lstat(p); return err == nil }

func names(t *testing.T, reg, sub string) []string {
	t.Helper()
	es, _ := os.ReadDir(reg)
	var out []string
	for _, e := range es {
		if strings.Contains(e.Name(), sub) {
			out = append(out, e.Name())
		}
	}
	return out
}

func postC(tp string) string {
	return `{"hook_event_name":"PostCompact","session_id":"` + cSID + `","transcript_path":"` + tp + `","trigger":"manual","compact_summary":"1. Task\ndid a thing\n"}`
}

// ITEM 3, every site (spec §3.4, stable lock item 3): the holder proves its descriptor still names canonical before
// each mutation, and a failed proof mutates nothing canonical from there on. session-hook.test.ts's ITEM 3 cases land a
// canonical replacement inside a tool only the bash forks; here the proof itself answers "replaced" from its Nth call.
// Each row is one site, with the fixture that reaches it and what must (not) have happened; failAt 0 is its control.
func TestItem3EverySite(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find", "touch")
	type fx struct{ home, reg, tp, nonce string }
	set := func(f fx) string { return filepath.Join(f.reg, cID+".compactset") }
	card := func(f fx) string { return filepath.Join(f.reg, cID+".compactcard") }
	journal := func(f fx) string { return filepath.Join(f.reg, cID+".compactions") }
	for _, row := range []struct {
		name   string
		prep   func(t *testing.T, f *fx)
		fire   func(f fx, l seamLock)
		failAt int
		check  func(t *testing.T, f fx)
	}{
		// Each site's own effect, so a row reds when ITS proof goes (the seam fails from call N on, and a later proof would
		// otherwise stop the arm too): the overlap's card removal, then the sweep.
		{"PreCompact: after the overlap find, the overlapped card is not removed",
			func(t *testing.T, f *fx) { plantPair(t, f.reg) },
			func(f fx, l seamLock) { fireC(f.home, preC(f.tp, "manual"), l) }, 1,
			func(t *testing.T, f fx) {
				if !exists(card(f)) {
					t.Error("the card was removed on a lock that stopped naming canonical")
				}
			}},
		{"PreCompact control: an overlapped card is removed",
			func(t *testing.T, f *fx) { plantPair(t, f.reg) },
			func(f fx, l seamLock) { fireC(f.home, preC(f.tp, "manual"), l) }, 0,
			func(t *testing.T, f fx) {
				if exists(card(f)) {
					t.Error("the overlapped card stayed")
				}
			}},
		{"PreCompact: after the sweep's find, aged residue is not swept",
			func(t *testing.T, f *fx) { agedStage(t, f.reg) },
			func(f fx, l seamLock) { fireC(f.home, preC(f.tp, "manual"), l) }, 2,
			func(t *testing.T, f fx) {
				if len(names(t, f.reg, ".stage")) != 1 {
					t.Error("aged residue was swept on a lock that stopped naming canonical")
				}
			}},
		{"PreCompact control: aged residue is swept",
			func(t *testing.T, f *fx) { agedStage(t, f.reg) },
			func(f fx, l seamLock) { fireC(f.home, preC(f.tp, "manual"), l) }, 0,
			func(t *testing.T, f fx) {
				if len(names(t, f.reg, ".stage")) != 0 {
					t.Error("aged residue stayed")
				}
			}},
		{"PreCompact: before the publication, no set is published", nil,
			func(f fx, l seamLock) { fireC(f.home, preC(f.tp, "manual"), l) }, 3,
			func(t *testing.T, f fx) {
				if exists(set(f)) {
					t.Error("a set was published")
				}
			}},
		{"PreCompact control: the set is published", nil,
			func(f fx, l seamLock) { fireC(f.home, preC(f.tp, "manual"), l) }, 0,
			func(t *testing.T, f fx) {
				if !exists(set(f)) {
					t.Error("no set")
				}
			}},
		{"serve: at the card claim, the placeholder goes and the card stays",
			func(t *testing.T, f *fx) { f.nonce = plantPair(t, f.reg) },
			func(f fx, l seamLock) { fireC(f.home, startC(), l) }, 1,
			func(t *testing.T, f fx) {
				if !exists(card(f)) || len(names(t, f.reg, "session-claim")) != 0 || exists(filepath.Join(f.reg, "."+cID+".compactserved."+f.nonce)) {
					t.Errorf("card %v, claims %v", exists(card(f)), names(t, f.reg, "session-claim"))
				}
			}},
		{"serve: at the aged card's removal, the aged card survives",
			func(t *testing.T, f *fx) {
				plantPair(t, f.reg)
				old := time.Now().Add(-21 * time.Minute)
				_ = os.Chtimes(card(*f), old, old)
			},
			func(f fx, l seamLock) { fireC(f.home, startC(), l) }, 1,
			func(t *testing.T, f fx) {
				if !exists(card(f)) {
					t.Error("the aged card was removed under a lock that stopped naming canonical")
				}
			}},
		{"serve control: the aged card is removed",
			func(t *testing.T, f *fx) {
				plantPair(t, f.reg)
				old := time.Now().Add(-21 * time.Minute)
				_ = os.Chtimes(card(*f), old, old)
			},
			func(f fx, l seamLock) { fireC(f.home, startC(), l) }, 0,
			func(t *testing.T, f fx) {
				if exists(card(f)) {
					t.Error("the aged card stayed")
				}
			}},
		{"serve: at a crossed card's restore, the claim is retained and nothing is restored",
			func(t *testing.T, f *fx) {
				plantPair(t, f.reg)
				write(t, card(*f), "compact-1-2-3-4\nanother compaction's card\n")
			},
			func(f fx, l seamLock) { fireC(f.home, startC(), l) }, 2,
			func(t *testing.T, f fx) {
				if exists(card(f)) || len(names(t, f.reg, "session-claim")) != 1 {
					t.Errorf("card %v, claims %v", exists(card(f)), names(t, f.reg, "session-claim"))
				}
			}},
		{"serve control: a crossed card is restored",
			func(t *testing.T, f *fx) {
				plantPair(t, f.reg)
				write(t, card(*f), "compact-1-2-3-4\nanother compaction's card\n")
			},
			func(f fx, l seamLock) { fireC(f.home, startC(), l) }, 0,
			func(t *testing.T, f fx) {
				if !exists(card(f)) || len(names(t, f.reg, "session-claim")) != 0 {
					t.Errorf("card %v, claims %v", exists(card(f)), names(t, f.reg, "session-claim"))
				}
			}},
		{"PostCompact: before canonical's unlink, the set stays and only the claim goes",
			func(t *testing.T, f *fx) {
				f.nonce = plantPair(t, f.reg)
				write(t, filepath.Join(f.reg, "compact-card.mjs"), "")
			},
			func(f fx, l seamLock) { fireC(f.home, postC(f.tp), l) }, 1,
			func(t *testing.T, f fx) {
				if !exists(set(f)) || len(names(t, f.reg, "compactpost")) != 0 || exists(journal(f)) {
					t.Errorf("set %v, claims %v, journal %v", exists(set(f)), names(t, f.reg, "compactpost"), exists(journal(f)))
				}
			}},
		{"PostCompact: between the unlink and the touch, the claim is retained and nothing commits",
			func(t *testing.T, f *fx) {
				f.nonce = plantPair(t, f.reg)
				write(t, filepath.Join(f.reg, "compact-card.mjs"), "")
			},
			func(f fx, l seamLock) { fireC(f.home, postC(f.tp), l) }, 2,
			func(t *testing.T, f fx) {
				if exists(set(f)) || len(names(t, f.reg, "compactpost")) != 1 || exists(journal(f)) {
					t.Errorf("set %v, claims %v, journal %v", exists(set(f)), names(t, f.reg, "compactpost"), exists(journal(f)))
				}
			}},
		{"PostCompact: before the journal commit, nothing commits and the claim is residue",
			func(t *testing.T, f *fx) {
				f.nonce = plantPair(t, f.reg)
				write(t, filepath.Join(f.reg, "compact-card.mjs"), "")
			},
			func(f fx, l seamLock) { fireC(f.home, postC(f.tp), l) }, 3,
			func(t *testing.T, f fx) {
				if exists(journal(f)) || len(names(t, f.reg, "compactpost")) != 1 || len(names(t, f.reg, "compactions-")) != 0 {
					t.Errorf("journal %v, claims %v, stages %v", exists(journal(f)), names(t, f.reg, "compactpost"), names(t, f.reg, "compactions-"))
				}
			}},
		{"PostCompact control: one record commits and the claim is consumed",
			func(t *testing.T, f *fx) {
				f.nonce = plantPair(t, f.reg)
				write(t, filepath.Join(f.reg, "compact-card.mjs"), "")
			},
			func(f fx, l seamLock) { fireC(f.home, postC(f.tp), l) }, 0,
			func(t *testing.T, f fx) {
				b, _ := os.ReadFile(journal(f))
				if strings.Count(string(b), "\n") != 1 || len(names(t, f.reg, "compactpost")) != 0 {
					t.Errorf("journal %q, claims %v", b, names(t, f.reg, "compactpost"))
				}
			}},
	} {
		t.Run(row.name, func(t *testing.T) {
			home, reg, tp := cHome(t)
			f := fx{home: home, reg: reg, tp: tp}
			if row.prep != nil {
				row.prep(t, &f)
			}
			row.fire(f, newSeam(row.failAt))
			row.check(t, f)
		})
	}
}

// renameFailFS fails the events line's rotation (a rename onto `.compacteventsprev`), as session-hook-precompact's stub
// `mv` fails it for the bash.
type renameFailFS struct{ regfs.OS }

func (renameFailFS) Rename(a, b string) error {
	if strings.HasSuffix(b, ".compacteventsprev") {
		return os.ErrPermission
	}
	return os.Rename(a, b)
}

// A rotation that is due and fails appends nothing, so the events file never grows past PRECOMPACT_KEEP.
func TestPreLineFailedRotationAppendsNothing(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find")
	home, reg, tp := cHome(t)
	write(t, filepath.Join(home, ".ccrc", "compact-card-off"), "")
	f := filepath.Join(reg, cID+".compactevents")
	seed := strings.Repeat(`{"at":1,"trigger":"auto","scope":"main","transcript":null,"phase":"pre"}`+"\n", 32)
	write(t, f, seed)
	fireCWith(home, preC(tp, "manual"), newSeam(0), renameFailFS{})
	if b, _ := os.ReadFile(f); string(b) != seed || exists(filepath.Join(reg, cID+".compacteventsprev")) {
		t.Fatalf("a failed rotation appended or moved: %d bytes", len(b))
	}
	fireC(home, preC(tp, "manual"), newSeam(0))
	if b, _ := os.ReadFile(filepath.Join(reg, cID+".compacteventsprev")); string(b) != seed {
		t.Fatal("CONTROL: with the rename working the same run rotates")
	}
}

// raceFS creates the scope marker right after the guard's lstat reads it absent, as a sibling would.
type raceFS struct {
	regfs.OS
	at   string
	n    int // lstats of the marker so far: the first is tail stage 1's, the second the guard's
	done bool
}

func (r *raceFS) Lstat(p string) (os.FileInfo, error) {
	st, err := r.OS.Lstat(p)
	if p == r.at {
		r.n++
	}
	if p == r.at && r.n == 2 {
		r.done = true
		_ = os.WriteFile(p, []byte("stale\n"), 0o644)
	}
	return st, err
}

// The scope marker's guard is one lstat (a positive non-regular type refuses), so a marker a sibling creates after that
// read is still written over: the Go twin of W4-H6, whose bash seam rewrites a copy of the bash.
func TestHistoryScopeGuardOneRead(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find")
	home, _, tp := cHome(t)
	marker := filepath.Join(home, ".ccrc", "history", "scope", cID)
	write(t, filepath.Join(home, ".ccrc", "compact-card-off"), "")
	if err := os.MkdirAll(filepath.Dir(marker), 0o700); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{"HOME": home, "TMUX_PANE": "%1", "CCRC_SESSION_GENERATION": cGen, "CLAUDE_CODE_SESSION_ID": cSID}
	fsys := &raceFS{at: marker}
	Main(strings.NewReader(preC(tp, "manual")), IO{Stdout: &bytes.Buffer{}, Getenv: func(k string) string { return env[k] }, FS: fsys,
		Pid: os.Getpid(), GOOS: runtime.GOOS, NowMs: func() int64 { return time.Now().UnixMilli() },
		Found: func(n string) bool { _, err := exec.LookPath(n); return err == nil }, Rand: func() int { return rand.Intn(32768) },
		Git: func(string, ...string) (string, bool) { return "", false }, TmuxSession: func(string, string, string) string { return "cc-" + cID },
		Lock: newSeam(0)})
	b, err := os.ReadFile(marker)
	if !fsys.done || err != nil || !strings.HasPrefix(string(b), "main "+cSID+" ") {
		t.Fatalf("the marker created between the guard and the write was not written over: raced=%v %q %v", fsys.done, b, err)
	}
}

// touchFailFS fails the settlement's stamp of its claim (`touch "$claim"`), as session-hook.test.ts's stub `touch` does.
type touchFailFS struct{ regfs.OS }

func (touchFailFS) Touch(string) error { return os.ErrPermission }

// ITEM 3 at the failed-touch restore: canonical is put back by no-clobber link only while the lock still names it; a
// replacement there leaves the claim as the only copy and restores nothing. CONTROL: with the proof holding, the set is
// restored, same inode, and the claim goes.
func TestItem3FailedTouchRestore(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find", "touch")
	for _, failAt := range []int{0, 3} {
		home, reg, tp := cHome(t)
		plantPair(t, reg)
		write(t, filepath.Join(reg, "compact-card.mjs"), "")
		set := filepath.Join(reg, cID+".compactset")
		before, _ := os.Lstat(set)
		fireCWith(home, postC(tp), newSeam(failAt), touchFailFS{})
		after, err := os.Lstat(set)
		claims := names(t, reg, "compactpost")
		switch failAt {
		case 0:
			if err != nil || !os.SameFile(before, after) || len(claims) != 0 {
				t.Errorf("CONTROL: set restored %v (same inode %v), claims %v", err == nil, err == nil && os.SameFile(before, after), claims)
			}
		default:
			if err == nil || len(claims) != 1 {
				t.Errorf("a refused proof restored canonical (%v) or lost the claim %v", err == nil, claims)
			}
		}
		if exists(filepath.Join(reg, cID+".compactions")) {
			t.Error("a journal line committed after a failed touch")
		}
	}
}

// agedStage is a stage a killed hook left 21 minutes ago: exact-family residue the locked sweep removes.
func agedStage(t *testing.T, reg string) {
	p := filepath.Join(reg, "."+cID+".compactset.1.compact-1-2-3-4.stage")
	write(t, p, "x")
	old := time.Now().Add(-21 * time.Minute)
	_ = os.Chtimes(p, old, old)
}

// gitTree is a tree of one commit whose graph was built at it (fresh, nothing behind), so PreCompact runs the helper.
func gitTree(t *testing.T, home string) string {
	t.Helper()
	tree := filepath.Join(home, "tree")
	git := func(args ...string) string {
		pre := []string{"-C", tree, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"}
		out, err := exec.Command("git", append(pre, args...)...).Output()
		if err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
		return strings.TrimSpace(string(out))
	}
	write(t, filepath.Join(tree, "c0.txt"), "0\n")
	git("init", "-q")
	git("add", "-A")
	git("commit", "-q", "-m", "c0")
	sha := git("rev-parse", "HEAD")
	write(t, filepath.Join(tree, "graphify-out", "graph.json"), "{\n  \"hyperedges\": [],\n  \"built_at_commit\": \""+sha+"\"\n}\n")
	write(t, filepath.Join(tree, "graphify-out", "GRAPH_REPORT.md"), "# Graph Report\n\n## Summary\n- 42 nodes · 1 edges · 1 communities\n")
	write(t, filepath.Join(tree, "graphify-out", ".graphify_engine"), "0.9.9\n")
	return tree
}

// ITEM 3 in PreCompact's second section (the reacquire after the helper): the proof before the card's rename and the
// one between the card's and the set's. A stand-in helper writes both stages and exits 0.
func TestItem3SecondSection(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find", "git", "timeout")
	for _, c := range []struct {
		failAt            int
		card, setReplaced bool
	}{{0, true, true}, {4, false, false}, {5, true, false}} {
		home, reg, tp := cHome(t)
		tree := gitTree(t, home)
		write(t, filepath.Join(reg, "compact-card.mjs"), "")
		payload := `{"hook_event_name":"PreCompact","session_id":"` + cSID + `","transcript_path":"` + tp + `","trigger":"manual","cwd":"` + tree + `"}`
		fireC(home, payload, newSeam(c.failAt))
		b, _ := os.ReadFile(filepath.Join(reg, cID+".compactset"))
		gotCard, gotSet := exists(filepath.Join(reg, cID+".compactcard")), strings.Contains(string(b), `"files":[]`)
		if gotCard != c.card || gotSet != c.setReplaced || len(names(t, reg, ".stage")) != 0 {
			t.Errorf("failAt %d: card %v (want %v), set renamed %v (want %v), stages %v", c.failAt, gotCard, c.card, gotSet, c.setReplaced, names(t, reg, ".stage"))
		}
	}
}

// ITEM 3 in the events line: the dangling prev link's removal, the rotation and the append each mutate only under a
// proof (with the card off, these are the run's only proofs).
func TestItem3EventsLine(t *testing.T) {
	needTools(t, "flock", "mktemp", "link", "find")
	full := strings.Repeat(`{"at":1,"trigger":"auto","scope":"main","transcript":null,"phase":"pre"}`+"\n", 32)
	for _, c := range []struct {
		name   string
		seed   string
		link   bool
		failAt int
		check  func(cur, prev string, prevLink bool) bool
	}{
		{"the prev link's removal", "", true, 1, func(cur, prev string, l bool) bool { return l && cur == "" }},
		{"the prev link's removal, control", "", true, 0, func(cur, prev string, l bool) bool { return !l && strings.Count(cur, "\n") == 1 }},
		{"the rotation", full, false, 1, func(cur, prev string, l bool) bool { return cur == full && prev == "" }},
		{"the rotation, control", full, false, 0, func(cur, prev string, l bool) bool { return prev == full && strings.Count(cur, "\n") == 1 }},
		{"the append", "", false, 1, func(cur, prev string, l bool) bool { return cur == "" }},
	} {
		home, reg, tp := cHome(t)
		write(t, filepath.Join(home, ".ccrc", "compact-card-off"), "")
		f, p := filepath.Join(reg, cID+".compactevents"), filepath.Join(reg, cID+".compacteventsprev")
		if c.seed != "" {
			write(t, f, c.seed)
		}
		if c.link {
			_ = os.Symlink(filepath.Join(home, "nowhere"), p)
		}
		fireC(home, preC(tp, "manual"), newSeam(c.failAt))
		cur, _ := os.ReadFile(f)
		prev, _ := os.ReadFile(p)
		st, err := os.Lstat(p)
		if !c.check(string(cur), string(prev), err == nil && st.Mode()&os.ModeSymlink != 0) {
			t.Errorf("%s (failAt %d): current %d bytes, prev %d bytes", c.name, c.failAt, len(cur), len(prev))
		}
	}
}
