package attention

import (
	"strconv"
	"strings"
	"testing"
)

func TestLastStampAndNodes(t *testing.T) {
	sha := strings.Repeat("a", 40)
	for _, c := range []struct{ name, in, want string }{
		{"one stamp", `{"built_at_commit": "` + sha + `"}`, sha},
		{"the last stamp wins", "\"built_at_commit\":\"" + strings.Repeat("b", 40) + "\",\n\"built_at_commit\" : \"" + sha + "\"\n", sha},
		{"abbreviated", `"built_at_commit":"abc1234"`, "abc1234"},
		{"six hex is no stamp", `"built_at_commit":"abc123"`, ""},
		{"a tab beside the sha leaves a word the hex test refuses", "\"built_at_commit\":\t\"" + sha + "\"", ""},
		{"upper case is no hex", `"built_at_commit":"ABCDEF1"`, ""},
		{"a NUL anywhere makes grep call it binary", "x\x00\n\"built_at_commit\":\"" + sha + "\"", ""},
		// measured on GNU grep 3.11 under UTF-8 and C: a byte that is not UTF-8 never makes `grep -o` call its input binary
		{"invalid UTF-8 on the matching line", "\xff \"built_at_commit\":\"" + sha + "\"", sha},
		{"invalid UTF-8 on another line", "\xff\n\"built_at_commit\":\"" + sha + "\"", sha},
		{"invalid UTF-8 after the match", "\"built_at_commit\":\"" + sha + "\" \xff", sha},
		{"no stamp", `{"nodes":[]}`, ""},
	} {
		if got := lastStamp([]byte(c.in)); got != c.want {
			t.Errorf("%s: lastStamp = %q, want %q", c.name, got, c.want)
		}
	}
	for in, want := range map[string]string{"# Graph\n- 4242 nodes · 9 edges\n- 7 nodes": "4242", "12 nodes": "12", "no count": "", "5\x00 nodes": "", "\xff 4242 nodes\n": "4242", "4242 nodes\n\x00\n": ""} {
		if got := firstNodes([]byte(in)); got != want {
			t.Errorf("firstNodes(%q) = %q, want %q", in, got, want)
		}
	}
	if trimSpaces([]byte(" 0.9.9\n\t")) != "0.9.9" || trimSpaces([]byte("a b\x00c\r")) != "abc" {
		t.Error("trimSpaces")
	}
}

func TestReadWords(t *testing.T) {
	for line, want := range map[string]string{"3 5 7": "3|5|7", "  3\t5   7  ": "3|5|7", "3": "3||", "3 5": "3|5|", "3 5 7 9": "3|5|7 9", "": "||", "null 3 4": "null|3|4"} {
		if got := strings.Join(readWords(line, 3), "|"); got != want {
			t.Errorf("readWords(%q) = %q, want %q", line, got, want)
		}
	}
}

// a scripted tree: the reads the measurement asks, and the git answers by their argument words
type graphFake struct {
	files map[string]string
	links map[string]bool
	git   map[string]string // "rev-parse HEAD" -> answer; a missing key is a failure
	asked []string
}

func (f *graphFake) io() GraphIO {
	return GraphIO{Home: "/h", UTF8: true, NowSec: func() int64 { return 1_800_000_000 },
		Workdir: func() string { return "" },
		IsDir:   func(p string) bool { return p == "/t" },
		IsLink:  func(p string) bool { return f.links[p] },
		IsFile:  func(p string) bool { _, ok := f.files[p]; return ok },
		Head: func(p string, n int) []byte {
			s, ok := f.files[p]
			if !ok {
				return nil
			}
			if len(s) > n {
				s = s[:n]
			}
			return []byte(s)
		},
		Tail: func(p string, n int) []byte {
			s := f.files[p]
			if len(s) > n {
				s = s[len(s)-n:]
			}
			return []byte(s)
		},
		Git: func(dir string, args ...string) (string, bool) {
			k := strings.Join(args, " ")
			f.asked = append(f.asked, k)
			s, ok := f.git[k]
			return s, ok
		}}
}

func TestMeasureGraphReal(t *testing.T) {
	built, head := strings.Repeat("1", 40), strings.Repeat("2", 40)
	mk := func(git map[string]string) (Graph, int, *graphFake) {
		f := &graphFake{files: map[string]string{"/t/graphify-out/graph.json": `{"built_at_commit": "` + built + `"}`, "/t/graphify-out/GRAPH_REPORT.md": "- 4242 nodes\n",
			"/t/graphify-out/.graphify_engine": "0.9.9\n", "/h/.ccrc/graphify.pin": "0.9.9\n"}, git: git}
		g, rc := MeasureGraph(parse(t, `{"cwd":"/t"}`), f.io())
		return g, rc, f
	}
	g, rc, _ := mk(map[string]string{"rev-parse HEAD": built})
	if rc != 0 || g.Fresh != "fresh" || g.Behind != "0" || g.Nodes != "4242" || g.Engine != "0.9.9" || g.Pin != "0.9.9" || !g.GateTree() {
		t.Errorf("at HEAD: %+v rc %d", g, rc)
	}
	// same content at another commit: still fresh, with the qualifier, and the commit asked after the trees
	g, _, f := mk(map[string]string{"rev-parse HEAD": head, "rev-parse --verify -q " + built + "^{tree}": "T", "rev-parse --verify -q HEAD^{tree}": "T",
		"rev-parse --verify -q " + built + "^{commit}": built})
	if g.Fresh != "fresh — same content as HEAD" || g.Behind != "0" {
		t.Errorf("same tree: %+v", g)
	}
	if strings.Join(f.asked, ";") != "rev-parse HEAD;rev-parse --verify -q "+built+"^{tree};rev-parse --verify -q HEAD^{tree};rev-parse --verify -q "+built+"^{commit}" {
		t.Errorf("git was asked %v", f.asked)
	}
	for lr, want := range map[string][3]string{"0\t3": {"3 commits behind HEAD", "3", "true"}, "0\t1": {"1 commit behind HEAD", "1", "true"}, "0\t0": {"fresh", "0", "true"},
		"2\t5": {"not an ancestor of HEAD", "", "false"}, "0\t11": {"11 commits behind HEAD", "11", "false"}, "0\t10": {"10 commits behind HEAD", "10", "true"}, "x": {"freshness unmeasured", "", "false"}, "1 2 3": {"freshness unmeasured", "", "false"}} {
		g, _, _ := mk(map[string]string{"rev-parse HEAD": head, "rev-list --left-right --count " + built + "...HEAD": lr})
		if g.Fresh != want[0] || g.Behind != want[1] || strconv.FormatBool(g.GateTree()) != want[2] {
			t.Errorf("rev-list %q: %q %q gate %v", lr, g.Fresh, g.Behind, g.GateTree())
		}
	}
	// a tree with no git says nothing about freshness: nothing to gate on
	g, rc, _ = mk(map[string]string{})
	if rc != 0 || g.Fresh != "" || g.Behind != "" || g.GateTree() {
		t.Errorf("no git: %+v", g)
	}
}

func TestMeasureGraphThreeValuedReturn(t *testing.T) {
	f := &graphFake{files: map[string]string{}, git: map[string]string{}}
	if _, rc := MeasureGraph(parse(t, `{"cwd":"/nowhere"}`), f.io()); rc != 2 {
		t.Errorf("a cwd that is no directory: rc %d", rc)
	}
	if _, rc := MeasureGraph(parse(t, `{}`), f.io()); rc != 2 {
		t.Errorf("no cwd and no workdir: rc %d", rc)
	}
	if g, rc := MeasureGraph(parse(t, `{"cwd":"/t"}`), f.io()); rc != 1 || g.CWD != "/t" {
		t.Errorf("a tree with no graph.json: rc %d %+v", rc, g)
	}
}

func TestMeasureGraphLinked(t *testing.T) {
	built := strings.Repeat("3", 40)
	meta := `{"schema":1,"commit":"` + built + `","engine":"0.9.9","nodes":4242,"files":100,"ref":"refs/heads/main","store":"/s","built_at":"2027-01-15T07:00:00Z"}`
	mk := func(meta, settings string, files []string) (Graph, int) {
		f := &graphFake{files: map[string]string{"/t/graphify-out/meta.json": meta, "/s/settings.json": settings, "/h/.ccrc/graphify.pin": "0.9.9\n"},
			links: map[string]bool{"/t/graphify-out": true}, git: map[string]string{"rev-parse HEAD": strings.Repeat("4", 40),
				"rev-list --left-right --count " + built + "...HEAD": "0\t2", "diff --no-renames --name-only " + built + " HEAD": strings.Join(files, "\n"),
				"merge-base " + built + " HEAD": "MB", "diff --no-renames --name-only MB HEAD": "own1\nown2", "rev-list --count " + built + "..refs/heads/main": "7"}}
		return MeasureGraph(parse(t, `{"cwd":"/t"}`), f.io())
	}
	g, rc := mk(meta, `{"schema":1,"gate_max_diff_pct":3,"gate_max_denials":5,"card_diff_list_max":2}`, []string{"a", "own1", "own2", "b"})
	if rc != 0 || !g.Linked || g.Built != built || g.Nodes != "4242" || g.Files != "100" || g.Ref != "refs/heads/main" || g.Store != "/s" || g.MaxDenials != "5" || g.MaxDiffPct != "3" {
		t.Fatalf("linked: %+v rc %d", g, rc)
	}
	if g.Diff != "4" || g.Branch != "2" || g.DiffList != "own1, own2 and 2 more" || g.MainMoved != "7" || g.Age == "" {
		t.Errorf("diff: %+v", g)
	}
	// 4 files of 100 against a 3% bound: not armed
	if g.GateTree() {
		t.Errorf("4 files of 100 against a 3%% bound armed the gate")
	}
	g, _ = mk(meta, `{"schema":1,"gate_max_diff_pct":4}`, []string{"a", "own1", "own2", "b"})
	if !g.GateTree() || g.MaxDenials != "3" || g.DiffListMax != "20" {
		t.Errorf("4%% arms, defaults for the rest: %+v", g)
	}
	// settings that are not their shape keep the defaults; an engine other than the pin does not arm
	g, _ = mk(meta, `{"schema":2,"gate_max_diff_pct":0}`, []string{"a"})
	if g.MaxDiffPct != "25" || !g.GateTree() {
		t.Errorf("another schema: %+v", g)
	}
	g, _ = mk(strings.Replace(meta, `"0.9.9"`, `"0.9.8"`, 1), `{}`, []string{"a"})
	if g.GateTree() {
		t.Errorf("an engine that is not the pin armed the gate: %+v", g)
	}
	// a meta that is not schema 1, cut short or empty measures the tree the old way: no graph.json beside a link
	for _, bad := range []string{`{"schema":2,"commit":"` + built + `"}`, `{"schema":1`, ``, `[1]`, `{"schema":1,"commit":"abc"}`} {
		if _, rc := mk(bad, "", nil); rc != 1 {
			t.Errorf("meta %q: rc %d, want 1 (the old arm finds no graph.json)", bad, rc)
		}
	}
}

func TestMetaAge(t *testing.T) {
	now := int64(1_800_000_000) // 2027-01-15T08:00:00Z
	for in, want := range map[string]string{"2027-01-15T07:00:00Z": "3600", "2027-01-15T08:00:00Z": "0", "2027-01-15T09:00:00Z": "-3600", "2027-1-15T7:0:0Z": "3600", "x": "", "2027-13-01T00:00:00Z": "", "2027-01-15T07:00:00": ""} {
		if got := metaAge(in, now); got != want {
			t.Errorf("metaAge(%q) = %q, want %q", in, got, want)
		}
	}
	if metaAge(5.0, now) != "" || metaAge(nil, now) != "" {
		t.Error("a stamp that is no string")
	}
}
