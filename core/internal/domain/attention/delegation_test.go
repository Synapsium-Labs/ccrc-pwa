package attention

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ccrc/core/internal/kernel"
)

const (
	goldID  = "demo-quiet-basin"
	goldGen = "0189abcd-1234-5678-9abc-0123456789ab"
	goldNow = 1700000000500 // the golden's clock: `def now: 1700000000.5`
)

type goldCase struct {
	payload  string
	cap      int
	ver, wr  string
	describe string
}

func compact(t *testing.T, v any) string {
	t.Helper()
	return string(kernel.JQCompact(v))
}

// goldenCases enumerates, in gen-delegation-golden.sh's order, every (payload, cap) the golden holds: the hand-made cases
// at five caps, then the capture corpus of three versions at two.
func goldenCases(t *testing.T) []goldCase {
	t.Helper()
	var out []goldCase
	for i, line := range readLinesFile(t, "delegation-synthetic.jsonl") {
		c := parse(t, line)
		ver, wr := "2.1.318", "lane-a"
		if s, ok := get(c, "ver").(string); ok {
			ver = s
		}
		if s, ok := get(c, "wr").(string); ok {
			wr = s
		}
		for _, cap := range []int{4096, 1008, 400, 300, 260} {
			out = append(out, goldCase{compact(t, get(c, "p")), cap, ver, wr, fmt.Sprintf("synthetic #%d cap %d", i+1, cap)})
		}
	}
	corpus := filepath.Join("..", "..", "..", "..", "server", "test", "fixtures", "delegation")
	for _, v := range []string{"2.1.280", "2.1.318", "2.1.319"} {
		files, _ := filepath.Glob(filepath.Join(corpus, v, "*.json"))
		for _, f := range files { // Glob sorts, as the generator's glob does under LC_ALL=C
			b, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			evs, _ := get(parse(t, string(b)), "events").([]any)
			for i, e := range evs {
				for _, cap := range []int{4096, 1008} {
					out = append(out, goldCase{compact(t, get(e, "payload")), cap, "2.1.318", "lane-a", fmt.Sprintf("%s/%s #%d cap %d", v, filepath.Base(f), i, cap)})
				}
			}
		}
	}
	return out
}

// SpoolLine and LaunchRow are `def spool` and `def lrec` byte for byte: every case of the golden, which real jq printed
// for DSP_DEFS cut from ccd/session-hook.sh (testdata/gen-delegation-golden.sh), including every shedding step.
func TestDelegationGolden(t *testing.T) {
	cases, want := goldenCases(t), readLinesFile(t, "delegation.golden")
	if len(cases) != len(want) {
		t.Fatalf("%d cases, %d golden lines: regenerate (gen-delegation-cases.mjs, then gen-delegation-golden.sh)", len(cases), len(want))
	}
	produced := 0
	for i, c := range cases {
		w := parse(t, want[i]).([]any)
		wsp, wrow := w[0].([]any), w[1].(string)
		ps, ok := ParsePayload(Payload([]byte(c.payload)))
		var sp SpoolOut
		var row string
		if ok {
			in := SpoolIn{ID: goldID, Gen: goldGen, Ver: c.ver, Below: c.cap, NowMs: goldNow}
			sp, row = SpoolLine(ps, in), LaunchRow(ps, in, c.wr)
		}
		got := []string{sp.Bucket, sp.Cut, sp.Cwd, sp.Line}
		for j := range got {
			exp := wsp[j].(string)
			if j == 2 {
				exp = strings.Trim(exp, " \t") // the parse's `read -r` trims the cwd line
			}
			if got[j] != exp {
				t.Fatalf("%s: spool line %d\n got %q\nwant %q\npayload %s", c.describe, j+6, got[j], exp, c.payload)
			}
		}
		if row != wrow {
			t.Fatalf("%s: lrec\n got %q\nwant %q\npayload %s", c.describe, row, wrow, c.payload)
		}
		if sp.Line != "" || row != "" {
			produced++
		}
	}
	if produced < len(cases)/4 {
		t.Errorf("only %d of %d cases produced anything: the goldens would prove little", produced, len(cases))
	}
}

// The golden was measured from one program text: red when the bash's DSP_DEFS changes.
func TestDelegationProgramPinned(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "ccd", "session-hook.sh"))
	if err != nil {
		t.Fatal(err)
	}
	s := strings.ReplaceAll(string(src), "\r\n", "\n")
	const head = "\nDSP_DEFS='"
	i := strings.Index(s, head)
	if i < 0 {
		t.Fatal("ccd/session-hook.sh has no DSP_DEFS")
	}
	body := s[i+len(head):]
	end := strings.Index(body, "'; dsp_dir=")
	if end < 0 {
		t.Fatal("DSP_DEFS's closing quote not found")
	}
	got := fmt.Sprintf("%x", sha256.Sum256([]byte(body[:end])))
	if want := strings.TrimSpace(readLinesFile(t, "delegation-program.sha256")[0]); got != want {
		t.Errorf("DSP_DEFS changed (sha256 %s, the goldens were measured from %s): run testdata/gen-delegation-golden.sh "+
			"with real jq and make SpoolLine and LaunchRow match the new goldens", got, want)
	}
}

// The cap is the platform's (D-5436): 4096 where OSTYPE says linux-gnu, 1008 everywhere else; an OSTYPE in the
// environment wins, as it does for bash. This is the Go twin of delegation-spool.test.ts's CAP_STMT cut.
func TestLineBelow(t *testing.T) {
	for _, c := range []struct {
		goos, ostype string
		set, musl    bool
		want         int
	}{
		{"linux", "", false, false, 4096}, {"darwin", "", false, false, 1008}, {"windows", "", false, false, 1008}, {"freebsd", "", false, false, 1008},
		{"linux", "linux-gnu", true, false, 4096}, {"linux", "linux-gnueabihf", true, false, 4096}, {"linux", "darwin23", true, false, 1008},
		{"linux", "linux-musl", true, false, 1008}, {"windows", "msys", true, false, 1008},
		{"darwin", "linux-gnu", true, false, 1008}, {"windows", "linux-gnu", true, false, 1008}, // bash also tests its own build: not glibc Linux
		{"linux", "", false, true, 1008}, {"linux", "linux-gnu", true, true, 1008}, // a musl box
		{"", "", false, false, 1008},
		{"linux", "", true, false, 1008}, // an exported empty OSTYPE is kept by bash, so it is the small cap (delegation-adoption-corpus sets one)
	} {
		if got := LineBelow(c.goos, c.ostype, c.set, c.musl); got != c.want {
			t.Errorf("LineBelow(%q, %q) = %d, want %d", c.goos, c.ostype, got, c.want)
		}
	}
}

func TestStamp(t *testing.T) {
	for ms, want := range map[int64]string{1700000000007: "2023-11-14T22:13:20.007Z", 1700000000500: "2023-11-14T22:13:20.500Z", 1700000000999: "2023-11-14T22:13:20.999Z"} {
		if _, got := stamp(ms); got != want {
			t.Errorf("stamp(%d) = %s, want %s", ms, got, want)
		}
	}
}

func gateIn(over func(*GateIn)) GateIn {
	g := GateIn{ID: goldID, GenRaw: goldGen, SpoolDirOK: true, DelegOK: true, Payload: `{"hook_event_name":"SessionStart"}`,
		ExecPath: "/h/.local/share/claude/versions/2.1.318", Below: 4096, WrapperRaw: func() string { return "lane-a\n" }}
	if over != nil {
		over(&g)
	}
	return g
}

// The spool's gate, statement by statement (the bash's builtins before the parse).
func TestGateDecide(t *testing.T) {
	type tc struct {
		name string
		over func(*GateIn)
		want Gate
	}
	full := Gate{Gen: goldGen, Ver: "2.1.318", Wrapper: "lane-a", Spool: true, Lrec: true, Below: 4096}
	for _, c := range []tc{
		{"a sound incarnation, a spool directory and a delegation event", nil, full},
		{"the generation file is not a lowercase UUID", func(g *GateIn) { g.GenRaw = strings.ToUpper(goldGen) }, Gate{Below: 4096}},
		{"the generation read is 37 bytes (an LF is a 37th)", func(g *GateIn) { g.GenRaw = goldGen + "\n" }, Gate{Below: 4096}},
		{"the generation file is absent", func(g *GateIn) { g.GenRaw = "" }, Gate{Below: 4096}},
		{"the pane's generation is not the file's", func(g *GateIn) { g.EnvGen = "7f3c9a10-5555-4aaa-8bbb-0123456789cd" }, Gate{Below: 4096}},
		{"the pane's generation is the file's", func(g *GateIn) { g.EnvGen = goldGen }, full},
		{"a dot-led id", func(g *GateIn) { g.ID = ".x" }, Gate{Below: 4096}},
		{"an id over CCRC_ID_MAX", func(g *GateIn) { g.ID = strings.Repeat("a", 129) }, Gate{Below: 4096}},
		{"no delegation name in the payload: the incarnation stands, nothing is built", func(g *GateIn) { g.Payload = `{"hook_event_name":"Stop"}` },
			Gate{Below: 4096}},
		{"the version is not a version's shape", func(g *GateIn) { g.ExecPath = "/x/claude" }, Gate{Gen: goldGen, Wrapper: "lane-a", Spool: true, Lrec: true, Below: 4096}},
		{"no spool directory and a SessionStart: no spool line and no launch row", func(g *GateIn) { g.SpoolDirOK = false }, Gate{Gen: goldGen, Ver: "2.1.318", Below: 4096}},
		{"no spool directory, a PostToolUse of a launch tool: a launch row only", func(g *GateIn) {
			g.SpoolDirOK, g.Payload = false, `{"hook_event_name":"PostToolUse","tool_name":"Agent"}`
		}, Gate{Gen: goldGen, Ver: "2.1.318", Wrapper: "lane-a", Lrec: true, Below: 4096}},
		{"no spool directory, a PostToolUse of Bash: nothing", func(g *GateIn) {
			g.SpoolDirOK, g.Payload = false, `{"hook_event_name":"PostToolUse","tool_name":"Bash"}`
		}, Gate{Gen: goldGen, Ver: "2.1.318", Below: 4096}},
		{"the launch record file is a node: the spool only", func(g *GateIn) { g.DelegOK = false }, Gate{Gen: goldGen, Ver: "2.1.318", Spool: true, Below: 4096}},
		{"a task notification tag opens the gate", func(g *GateIn) { g.Payload = `{"prompt":"<task-notification>\n"}`[:0] + "task-notification>" }, full},
	} {
		got := GateDecide(gateIn(c.over))
		if got != c.want {
			t.Errorf("%s:\n got %+v\nwant %+v", c.name, got, c.want)
		}
	}
	// A string that merely mentions a tool carries its quotes escaped, so the quoted name never matches it.
	if g := GateDecide(gateIn(func(g *GateIn) { g.Payload = `{"prompt":"say \"Bash\" or Task"}` })); g.Spool || g.Lrec {
		t.Errorf("an escaped quote opened the gate: %+v", g)
	}
}

func TestSpoolAppendLine(t *testing.T) {
	line := `{"v":1,"a":"b"}`
	none := func(string) Listing { t.Fatal("listing asked"); return Listing{} }
	if got, ok := SpoolAppendLine(line, "", 4096, none); got != line || !ok {
		t.Errorf("no cwd: %q %v", got, ok)
	}
	if got, _ := SpoolAppendLine(`{"v":1,"truncated":true}`, "/x", 4096, none); got != `{"v":1,"truncated":true}` {
		t.Errorf("a truncated line asks for no listing: %q", got)
	}
	list := func(l Listing) func(string) Listing { return func(string) Listing { return l } }
	for _, c := range []struct {
		name  string
		l     Listing
		below int
		want  string
		ok    bool
	}{
		{"the listing is the line's last key", Listing{List: `["a","b"]`}, 4096, `{"v":1,"a":"b","listing":["a","b"]}`, true},
		{"an empty measured listing", Listing{List: "[]"}, 4096, `{"v":1,"a":"b","listing":[]}`, true},
		{"unmeasured leaves the line", Listing{}, 4096, line, true},
		{"a dropped listing marks the line truncated", Listing{Drop: true}, 4096, `{"v":1,"a":"b","truncated":true}`, true},
		{"a listing that would not fit is dropped and the line is marked", Listing{List: `["abcdefghij"]`}, len(line) + 20, `{"v":1,"a":"b","truncated":true}`, true},
		{"the line plus its LF is under the cap, not at it", Listing{}, len(line) + 1, line, false},
		{"one byte under", Listing{}, len(line) + 2, line, true},
	} {
		got, ok := SpoolAppendLine(line, "/x", c.below, list(c.l))
		if got != c.want || ok != c.ok {
			t.Errorf("%s: %q %v, want %q %v", c.name, got, ok, c.want, c.ok)
		}
	}
	// A truncated marker that does not fit: the line is not written.
	if _, ok := SpoolAppendLine(line, "/x", len(line)+5, list(Listing{Drop: true})); ok {
		t.Error("a line over the cap after `truncated` was written")
	}
}

func TestPruneOld(t *testing.T) {
	names := []string{"2023111322.spool", "2023111323.spool", "2023111400.spool", "notes.txt", "2023111322.spool.bak", "202311132.spool", "x2023111322.spool", "2023111301.spool"}
	reg := func(n string) bool { return n != "2023111301.spool" } // that one is a link or a directory
	got := PruneOld(names, "2023111400", reg)
	if strings.Join(got, ",") != "2023111322.spool,2023111323.spool" {
		t.Errorf("got %v", got)
	}
	if PruneOld(names, "20231114", reg) != nil || PruneOld(names, "", reg) != nil {
		t.Error("a cutoff that is not ten digits must select nothing")
	}
}

func TestLaunchAppend(t *testing.T) {
	row, pair := `{"v":1,"k":"agent"}`, "{\"drop\":1}\t{\"row\":1}"
	for _, c := range []struct {
		name  string
		row   string
		size  int64
		known bool
		below int
		want  string
		ok    bool
	}{
		{"one row", row, 0, true, 1008, row + "\n", true},
		{"a drop row then a row, one write", pair, 5, true, 1008, "{\"drop\":1}\n{\"row\":1}\n", true},
		{"the size cannot be read", row, 0, false, 1008, "", false},
		{"a row at the cap's last byte still fits", row, LRCMaxBytes - int64(len(row)+1), true, 1008, row + "\n", true},
		{"a row one byte over the budget becomes a drop row", row, LRCMaxBytes - int64(len(row)), true, 1008,
			`{"v":1,"t":1700000000500,"k":"drop","why":"budget"}` + "\n", true},
		{"a file past the budget and its reserve takes nothing", row, LRCMaxBytes + LRCDropReserve - 10, true, 1008, "", false},
		{"a drop row at the reserve's last byte", row, LRCMaxBytes + LRCDropReserve - 52, true, 1008,
			`{"v":1,"t":1700000000500,"k":"drop","why":"budget"}` + "\n", true},
		{"a row over the line cap is never written", strings.Repeat("x", 1008), 0, true, 1008, "", false},
	} {
		got, ok := LaunchAppend(c.row, c.size, c.known, c.below, goldNow)
		if got != c.want || ok != c.ok {
			t.Errorf("%s: %q %v, want %q %v", c.name, got, ok, c.want, c.ok)
		}
	}
}

type fakeTree struct {
	dirs, files map[string]bool // present and (dirs) a directory without a link / (files) a regular file
	links       map[string]bool
	heads       map[string]string
	names       map[string][]string
	unsearch    map[string]bool
	unreadable  map[string]bool
}

func (f fakeTree) reads() ListingReads {
	return ListingReads{
		DirNoLink:  func(p string) bool { return f.dirs[p] && !f.links[p] },
		FileNoLink: func(p string) bool { return f.files[p] && !f.links[p] },
		Head:       func(p string) string { return f.heads[p] },
		IsDir:      func(p string) bool { return f.dirs[p] },
		Present:    func(p string) bool { return f.dirs[p] || f.files[p] || f.links[p] },
		Searchable: func(p string) bool { return !f.unsearch[p] },
		DirNames:   func(p string) ([]string, bool) { return f.names[p], !f.unreadable[p] },
	}
}

// The listing's four answers stay apart: a measured empty list, a measured list, a dropped list, and unmeasured.
func TestSpoolListing(t *testing.T) {
	tree := func() fakeTree {
		return fakeTree{
			dirs:  map[string]bool{"/r/repo/.git": true, "/r/repo/.git/worktrees": true, "/r/repo/.git/worktrees/a": true, "/r/repo/.git/worktrees/.b": true, "/r/repo/.git/worktrees/z": true},
			files: map[string]bool{"/r/repo/.git/worktrees/f": true}, links: map[string]bool{}, heads: map[string]string{},
			names: map[string][]string{"/r/repo/.git/worktrees": {".b", "a", "f", "z"}}, unsearch: map[string]bool{},
		}
	}
	check := func(name, cwd string, f fakeTree, want Listing) {
		t.Helper()
		if got := SpoolListing(cwd, f.reads()); got != want {
			t.Errorf("%s: %+v, want %+v", name, got, want)
		}
	}
	check("the names under worktrees, dot-led included, files skipped", "/r/repo", tree(), Listing{List: `[".b","a","z"]`})
	check("found walking up from a subdirectory", "/r/repo/sub/dir", tree(), Listing{List: `[".b","a","z"]`})
	check("a relative cwd", "rel", tree(), Listing{})
	f := tree()
	delete(f.dirs, "/r/repo/.git/worktrees")
	check("no worktrees directory: a measured empty list", "/r/repo", f, Listing{List: "[]"})
	f = tree()
	f.unsearch["/r/repo/.git/worktrees"] = true
	check("a directory that cannot be entered: unmeasured, never []", "/r/repo", f, Listing{})
	f = tree()
	f.unreadable = map[string]bool{"/r/repo/.git/worktrees": true}
	check("a directory that cannot be read: no key, never an empty list", "/r/repo", f, Listing{})
	f = tree()
	f.links["/r/repo/.git/worktrees"], f.dirs["/r/repo/.git/worktrees"] = true, false
	check("a dangling link at worktrees: present, not a directory: unmeasured", "/r/repo", f, Listing{})
	f = tree()
	f.dirs["/r/repo/.git/worktrees/bad name"] = true
	f.names["/r/repo/.git/worktrees"] = []string{"a", "bad name"}
	check("a name outside the alphabet drops the whole listing", "/r/repo", f, Listing{Drop: true})
	f = tree()
	f.names["/r/repo/.git/worktrees"] = []string{"a"}
	f.dirs["/r/repo/.git/worktrees/"+strings.Repeat("n", 65)] = true
	f.names["/r/repo/.git/worktrees"] = append(f.names["/r/repo/.git/worktrees"], strings.Repeat("n", 65))
	check("a name over 64 bytes drops it", "/r/repo", f, Listing{Drop: true})
	f = tree()
	var many []string
	for i := 0; i < 257; i++ {
		n := fmt.Sprintf("w%03d", i)
		many = append(many, n)
		f.dirs["/r/repo/.git/worktrees/"+n] = true
	}
	f.names["/r/repo/.git/worktrees"] = many
	check("257 names drop it", "/r/repo", f, Listing{Drop: true})
	f.names["/r/repo/.git/worktrees"] = many[:256]
	if got := SpoolListing("/r/repo", f.reads()); got.Drop || strings.Count(got.List, ",") != 255 {
		t.Errorf("256 names are kept: %+v", got)
	}
	// a linked worktree: `.git` is a file naming <common>/worktrees/<name>
	f = tree()
	delete(f.dirs, "/r/wt/.git")
	f.files["/r/wt/.git"] = true
	f.heads["/r/wt/.git"] = "gitdir: /r/repo/.git/worktrees/wt\nmore"
	check("a linked worktree lists its common directory's", "/r/wt", f, Listing{List: `[".b","a","z"]`})
	f.heads["/r/wt/.git"] = "gitdir: ../repo/.git/worktrees/wt"
	for _, p := range []string{"", "/worktrees", "/worktrees/a", "/worktrees/.b", "/worktrees/z"} {
		f.dirs["/r/wt/../repo/.git"+p] = true
	}
	f.names["/r/wt/../repo/.git/worktrees"] = f.names["/r/repo/.git/worktrees"]
	check("a relative gitdir is taken from the directory", "/r/wt", f, Listing{List: `[".b","a","z"]`})
	f.heads["/r/wt/.git"] = "gitdir: /r/repo/.git"
	check("a gitdir that is not under worktrees/<name>", "/r/wt", f, Listing{})
	f.heads["/r/wt/.git"] = "gitdir: /r/repo/.git/worktrees/a/b"
	check("a name with a slash", "/r/wt", f, Listing{})
	f.heads["/r/wt/.git"] = "not a pointer"
	check("a .git file that is no pointer", "/r/wt", f, Listing{})
	f = tree()
	delete(f.dirs, "/r/repo/.git")
	check("no repository at all", "/r/repo", f, Listing{})
	f = tree()
	f.links["/r/repo/.git"] = true
	check("a .git that is a link is not followed", "/r/repo", f, Listing{})
}

func TestHistoryLine(t *testing.T) {
	psid := "7d0c3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"
	in := func(over func(*HistoryIn)) HistoryIn {
		h := HistoryIn{ID: goldID, Event: "Stop", Psid: psid, SpoolDirOK: true, Gen: goldGen, NowMs: 1700000000123,
			RegUUID: func() string { return "11111111-2222-4333-8444-555555555555" }}
		if over != nil {
			over(&h)
		}
		return h
	}
	for _, c := range []struct {
		name string
		over func(*HistoryIn)
		want string
	}{
		{"Stop", nil, `{"v":1,"ev":"Stop","id":"demo-quiet-basin","sid":"` + psid + `","gen":"` + goldGen + `","ts":1700000000123}`},
		{"Stop with history off", func(h *HistoryIn) { h.Off = true }, ""},
		{"Stop from a subagent", func(h *HistoryIn) { h.Paid = true }, ""},
		{"no spool directory", func(h *HistoryIn) { h.SpoolDirOK = false }, ""},
		{"an id over 224", func(h *HistoryIn) { h.ID = strings.Repeat("a", 225) }, ""},
		{"an id of 224", func(h *HistoryIn) { h.ID = strings.Repeat("a", 224) }, `{"v":1,"ev":"Stop","id":"` + strings.Repeat("a", 224) + `","sid":"` + psid + `","gen":"` + goldGen + `","ts":1700000000123}`},
		{"Stop with a sid that is no UUID: the line stands without it", func(h *HistoryIn) { h.Psid = "bad" },
			`{"v":1,"ev":"Stop","id":"demo-quiet-basin","gen":"` + goldGen + `","ts":1700000000123}`},
		{"no generation", func(h *HistoryIn) { h.Gen = "nope" }, `{"v":1,"ev":"Stop","id":"demo-quiet-basin","sid":"` + psid + `","ts":1700000000123}`},
		{"PostCompact manual", func(h *HistoryIn) { h.Event, h.Trig = "PostCompact", "manual" },
			`{"v":1,"ev":"PostCompact","id":"demo-quiet-basin","sid":"` + psid + `","trig":"manual","gen":"` + goldGen + `","ts":1700000000123}`},
		{"PostCompact with another trigger", func(h *HistoryIn) { h.Event, h.Trig = "PostCompact", "weird" },
			`{"v":1,"ev":"PostCompact","id":"demo-quiet-basin","sid":"` + psid + `","gen":"` + goldGen + `","ts":1700000000123}`},
		{"PostCompact with history off", func(h *HistoryIn) { h.Event, h.Off = "PostCompact", true }, ""},
		{"SessionStart startup carries reg", func(h *HistoryIn) { h.Event, h.Src = "SessionStart", "startup" },
			`{"v":1,"ev":"SessionStart","id":"demo-quiet-basin","sid":"` + psid + `","src":"startup","reg":"11111111-2222-4333-8444-555555555555","gen":"` + goldGen + `","ts":1700000000123}`},
		{"SessionStart clear carries none", func(h *HistoryIn) { h.Event, h.Src = "SessionStart", "clear" },
			`{"v":1,"ev":"SessionStart","id":"demo-quiet-basin","sid":"` + psid + `","src":"clear","gen":"` + goldGen + `","ts":1700000000123}`},
		{"SessionStart with an unreadable uuid", func(h *HistoryIn) {
			h.Event, h.Src, h.RegUUID = "SessionStart", "resume", func() string { return "nope" }
		},
			`{"v":1,"ev":"SessionStart","id":"demo-quiet-basin","sid":"` + psid + `","src":"resume","gen":"` + goldGen + `","ts":1700000000123}`},
		{"SessionStart compact writes none", func(h *HistoryIn) { h.Event, h.Src = "SessionStart", "compact" }, ""},
		{"SessionStart without a UUID sid writes none", func(h *HistoryIn) { h.Event, h.Src, h.Psid = "SessionStart", "startup", "bad" }, ""},
		{"SessionStart ignores history-off", func(h *HistoryIn) { h.Event, h.Src, h.Off = "SessionStart", "fork", true },
			`{"v":1,"ev":"SessionStart","id":"demo-quiet-basin","sid":"` + psid + `","src":"fork","reg":"11111111-2222-4333-8444-555555555555","gen":"` + goldGen + `","ts":1700000000123}`},
		{"UserPromptSubmit writes none", func(h *HistoryIn) { h.Event = "UserPromptSubmit" }, ""},
		{"no clock, no ts", func(h *HistoryIn) { h.NowMs = 0 },
			`{"v":1,"ev":"Stop","id":"demo-quiet-basin","sid":"` + psid + `","gen":"` + goldGen + `"}`},
	} {
		if got := HistoryLine(in(c.over)); got != c.want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, got, c.want)
		}
	}
}

func TestCtRead(t *testing.T) {
	for in, want := range map[string]string{"abc\n": "abc", " \t abc \r\n\n": "abc", "a\nb": "a\nb", "a\x00b": "ab", "": ""} {
		if got := CtRead([]byte(in)); got != want {
			t.Errorf("CtRead(%q) = %q, want %q", in, got, want)
		}
	}
	if got := CtRead([]byte(strings.Repeat("a", 200))); len(got) != 128 {
		t.Errorf("a read is at most 128 characters: %d", len(got))
	}
}
