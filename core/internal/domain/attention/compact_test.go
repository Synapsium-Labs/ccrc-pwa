package attention

import (
	"bufio"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// TestCompactGolden holds the compaction arms' jq programs, ported, to real jq 1.7 over compact-cases.jsonl
// (testdata/gen-compact-golden.sh, run on the Linux bench): the set document, the post-norm overlap and provenance
// gates, the shape gate, both record merges, the record and stage predicates and COMPACT_TEXT_JQ. Each inline program the
// golden ran is the hook's own text (compact-programs.txt, cut from it), so an edit to the hook reds here first.
func TestCompactGolden(t *testing.T) {
	hook, err := os.ReadFile("../../../../ccd/session-hook.sh")
	if err != nil {
		t.Fatal(err)
	}
	progs, err := os.ReadFile("testdata/compact-programs.txt")
	if err != nil {
		t.Fatal(err)
	}
	for _, sec := range strings.Split(string(progs), "## ")[1:] {
		name, body, _ := strings.Cut(sec, "\n")
		if body = strings.TrimSuffix(body, "\n"); !strings.Contains(string(hook), body) {
			t.Fatalf("the hook's %s program is not the one the golden measured: regenerate testdata/compact.golden", name)
		}
	}
	for _, v := range []string{"JOURNAL_RECORD_PRED_DEFS='", "JOURNAL_STAGE_PRED='", "COMPACT_SHAPE_PRED='", "COMPACT_TEXT_JQ='"} {
		if strings.Count(string(hook), "\n"+v) != 1 {
			t.Fatalf("the hook defines %s other than once", v)
		}
	}
	gf, err := os.Open("testdata/compact.golden")
	if err != nil {
		t.Fatal(err)
	}
	defer gf.Close()
	cf, err := os.ReadFile("testdata/compact-cases.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	g := bufio.NewScanner(gf)
	g.Buffer(make([]byte, 1<<20), 1<<20)
	g.Scan() // jq's version
	n := 0
	for _, line := range strings.Split(strings.TrimRight(string(cf), "\n"), "\n") {
		var c map[string]any
		if err := json.Unmarshal([]byte(line), &c); err != nil {
			t.Fatal(err)
		}
		if !g.Scan() {
			t.Fatal("the golden is shorter than the cases")
		}
		rcs, hx, _ := strings.Cut(g.Text(), " ")
		var out []byte
		if hx != "-" {
			out, _ = hex.DecodeString(hx)
		}
		str := func(k string) string { s, _ := c[k].(string); return s }
		b := func(k string) []byte { x, _ := base64.StdEncoding.DecodeString(str(k)); return x }
		ok := rcs == "0"
		n++
		switch str("k") {
		case "overlap":
			if got := overlapRC(b("snap")) == 0; got != ok {
				t.Errorf("case %d overlap %q: Go %v, jq rc %s", n, b("snap"), got, rcs)
			}
		case "norm":
			if got := normRC(b("snap"), str("trig")) == 0; got != ok {
				t.Errorf("case %d norm(%s) %q: Go %v, jq rc %s", n, str("trig"), b("snap"), got, rcs)
			}
		case "shape":
			if got := MeasOne(cmdSubst(string(b("meas")))); got != ok {
				t.Errorf("case %d shape %q: Go %v, jq rc %s", n, b("meas"), got, rcs)
			}
		case "rec1", "rec2":
			served, _ := c["served"].(bool)
			var rec string
			var rok bool
			if str("k") == "rec1" {
				rec, rok = Record(str("meas"), b("snap"), true, served, "")
			} else {
				rec, rok = Record(str("meas"), nil, false, served, str("norm"))
			}
			want := strings.TrimSuffix(string(out), "\n")
			if rok != ok || ok && rec != want {
				t.Errorf("case %d %s %q %q: Go %v %q, jq rc %s %q", n, str("k"), str("meas"), b("snap"), rok, rec, rcs, want)
			}
		case "pred":
			if got := RecordOK(str("rec")); got != ok {
				t.Errorf("case %d pred %q: Go %v, jq rc %s", n, str("rec"), got, rcs)
			}
		case "stage":
			if got := StageOK(b("stage"), str("old"), str("rec")); got != ok {
				t.Errorf("case %d stage %q old %q rec %q: Go %v, jq rc %s", n, b("stage"), str("old"), str("rec"), got, rcs)
			}
		case "text":
			want := ""
			if ok {
				want = cmdSubst(string(out))
			}
			if got := RoleCompactText(b("file"), str("r")); got != want {
				t.Errorf("case %d text %q %s: Go %q, jq %q", n, b("file"), str("r"), got, want)
			}
		case "setdoc":
			var at int64
			_ = json.Unmarshal([]byte(str("at")), &at)
			got := string(SetDoc(SetIn{At: at, Nonce: str("nonce"), S: Scope{Scope: str("scope"), Agent: str("agent"), Transcript: str("t"),
				ParentLive: str("pl"), LiveN: str("ln")}, Overlap: str("ovl") == "true", CWD: str("cwd"), Built: str("built"), Fresh: str("fresh")}))
			if want := strings.TrimSuffix(string(out), "\n"); got != want {
				t.Errorf("case %d setdoc: Go %q, jq %q", n, got, want)
			}
		default:
			t.Fatalf("case %d: unknown kind %q", n, str("k"))
		}
	}
	if g.Scan() {
		t.Fatal("the golden is longer than the cases")
	}
	if n < 1000 {
		t.Fatalf("only %d cases", n)
	}
}

// The arms' constants are the hook's (each a `NAME=value` line in ccd/session-hook.sh).
func TestCompactConstantsPinned(t *testing.T) {
	hook, err := os.ReadFile("../../../../ccd/session-hook.sh")
	if err != nil {
		t.Fatal(err)
	}
	for line, want := range map[string]int{
		"COMPACT_CARD_MAX_AGE": CompactCardMaxAge, "COMPACT_LIVE_S": CompactLiveS,
		"COMPACT_HELPER_TIMEOUT": int(CompactHelperTimeout / time.Second), "COMPACT_WORKSET_MAX": CompactWorksetMax,
		"COMPACT_LOCK_WAIT": int(CompactLockWait / time.Second), "COMPACT_LOCK_WAIT_SERVE": int(CompactLockWaitServe / time.Second),
		"PRECOMPACT_KEEP": PrecompactKeep, "HISTORY_CARD_MAX": HistoryCardMax, "COMPACT_CARD_MAX_CHARS": CompactCardMaxChars,
	} {
		if !strings.Contains(string(hook), "\n"+line+"="+itoa(int64(want))+"\n") {
			t.Errorf("the hook's %s is not %d", line, want)
		}
	}
}

// The exact family grammar: every arm, the permanent lock refused by name, and the two legacy grammars only after a
// decimal head (a nested id's residue is never this row's).
func TestFamilySweepable(t *testing.T) {
	for s, want := range map[string]bool{
		"compactions.lock": false, "compactset.1.n.stage": true, "compactcard.1.n.stage.part": true,
		"compactset.1.n.hook-write.tmp": true, "compactcard.1.n.session-claim.tmp": true, "compactpost.1.2.3.claim": true,
		"compactions.lock-init.AbC123": true, "compactions.lock-open.1.2.3": true, "compactserved-source.n.Xy": true,
		"compactserved.compact-1-2-3-4": true, "generation-read.1.2.3": true, "generation-init.x": true,
		"compactions-stage.1.2.3.tmp": true, "compactions-snapshot.1.2.3.tmp": true,
		"777.demo.compactset.tmp": true, "x-y.777.demo.compactset.tmp": false, "999.compactcard-claim.tmp": true,
		"x-y.999.compactcard-claim.tmp": false, "999.x.compactcard-claim.tmp": false, ".compactset.1.stage": false,
		"compactevents": false, "turn.json": false, "compactset": false, "compactcard.1.stage.x": false,
	} {
		if got := FamilySweepable(s); got != want {
			t.Errorf("FamilySweepable(%q) = %v, want %v", s, got, want)
		}
	}
}

// find -mmin's two bounds, as measured on GNU find 4.9: exact and strict.
func TestYoungerOlder(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	for _, c := range []struct {
		age             time.Duration
		young2, older20 bool
	}{
		{-5 * time.Second, true, false}, {119900 * time.Millisecond, true, false}, {120 * time.Second, false, false},
		{1200 * time.Second, false, false}, {1200*time.Second + time.Millisecond, false, true},
	} {
		if y, o := Younger(now, now.Add(-c.age), 2), Older(now, now.Add(-c.age), 20); y != c.young2 || o != c.older20 {
			t.Errorf("age %v: -mmin -2 %v (want %v), -mmin +20 %v (want %v)", c.age, y, c.young2, o, c.older20)
		}
	}
}

// The scope rule: manual is main; liveness of agent files decides; one live agent beside a quiet parent is that agent,
// its id gated; the parent's own liveness decides only beside exactly one; no find, or no readable transcript, says nothing.
func TestCompactScope(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	live, dead := now.Add(-5*time.Second), now.Add(-10*time.Minute)
	base := func() ScopeIn {
		return ScopeIn{TP: "/p/s.jsonl", Trig: "auto", TPReadable: true, Find: true, Now: now, TPMTime: dead, TPMTimeOK: true,
			LiveReadable: func(string) bool { return true }}
	}
	agent := func(id string, t time.Time) Entry {
		return Entry{Path: "/p/s/subagents/agent-" + id + ".jsonl", MTime: t}
	}
	for name, c := range map[string]struct {
		in   func() ScopeIn
		want Scope
	}{
		"manual": {func() ScopeIn { i := base(); i.Trig = "manual"; i.Agents = []Entry{agent("a", live)}; return i },
			Scope{Scope: "main", Transcript: "/p/s.jsonl", OK: true}},
		"none live": {func() ScopeIn { i := base(); i.Agents = []Entry{agent("a", dead)}; return i },
			Scope{Scope: "main", Transcript: "/p/s.jsonl", LiveN: "0", OK: true}},
		"one live": {func() ScopeIn { i := base(); i.Agents = []Entry{agent("a1", live)}; return i },
			Scope{Scope: "subagent", Transcript: "/p/s/subagents/agent-a1.jsonl", Agent: "a1", LiveN: "1", ParentLive: "false", OK: true}},
		"one live beside a live parent": {func() ScopeIn { i := base(); i.TPMTime = live; i.Agents = []Entry{agent("a1", live)}; return i },
			Scope{Scope: "ambiguous", LiveN: "1", ParentLive: "true", OK: true}},
		"two live": {func() ScopeIn { i := base(); i.Agents = []Entry{agent("a1", live), agent("a2", live)}; return i },
			Scope{Scope: "ambiguous", LiveN: "2", OK: true}},
		"an unspeakable id": {func() ScopeIn { i := base(); i.Agents = []Entry{agent("a.b", live)}; return i },
			Scope{LiveN: "1", ParentLive: "false"}},
		"a name that is no agent file": {func() ScopeIn {
			i := base()
			i.Agents = []Entry{{Path: "/p/s/subagents/notes.jsonl", MTime: live}}
			return i
		}, Scope{Scope: "main", Transcript: "/p/s.jsonl", LiveN: "0", OK: true}},
		"no find":       {func() ScopeIn { i := base(); i.Find = false; return i }, Scope{}},
		"no transcript": {func() ScopeIn { i := base(); i.TPReadable = false; return i }, Scope{}},
	} {
		if got := CompactScope(c.in()); got != c.want {
			t.Errorf("%s: %+v, want %+v", name, got, c.want)
		}
	}
}

// The refusal arm's turn and its octal quirk: bash's (( )) reads a leading 0 as octal and an 8 or 9 after it as an error
// (measured: `(( 0099 >= x ))` fails and the loop goes on).
func TestRefuseVerdict(t *testing.T) {
	main := func(string, string) Scope { return Scope{Scope: "main", OK: true} }
	turn := []byte(`{"v":1,"sessionId":"s1","turnAt":1000,"x":1}` + "\n")
	in := func(events string) RefuseIn {
		return RefuseIn{Precompact: []byte("refuse\n"), Trig: "auto", Scope: main, TurnLine: turn, Msid: "s1", Events: [][]byte{[]byte(events), nil}}
	}
	for events, want := range map[string]bool{
		"": true, `{"at":999,"phase":"refused"}` + "\n": true, `{"at":1000,"phase":"refused"}` + "\n": false,
		`{"at":1000,"phase":"refused"}`:         true, // a last line with no newline is never read
		`{"at":01750,"phase":"refused"}` + "\n": false, `{"at":01749,"phase":"refused"}` + "\n": true,
		`{"at":0999,"phase":"refused"}` + "\n": true, `{"at":2000,"phase":"pre"}` + "\n": true,
	} {
		if got, _, _ := RefuseVerdict(in(events)); got != want {
			t.Errorf("events %q: refuse %v, want %v", events, got, want)
		}
	}
	x := in("")
	x.Precompact = []byte("  refuse\n") // read -n 7 takes "  refus"
	if got, _, _ := RefuseVerdict(x); got {
		t.Error("a field read as `refus` refused")
	}
	x = in("")
	x.Msid = "s2"
	if got, _, _ := RefuseVerdict(x); got {
		t.Error("another session's turn marker refused")
	}
}

// The steer receipt: gen only when it is a UUID, ts only a positive integer of at most 15 digits.
func TestSteerReceipt(t *testing.T) {
	const g = "0189abcd-1234-5678-9abc-0123456789ab"
	if got, want := SteerReceipt("lane-a", "s", "L1", g, 1795600000123), `{"v":1,"ev":"steer","id":"lane-a","sid":"s","leaf":"L1","gen":"`+g+`","ts":1795600000123}`; got != want {
		t.Errorf("%s, want %s", got, want)
	}
	if got := SteerReceipt("lane-a", "s", "", "x", 0); got != `{"v":1,"ev":"steer","id":"lane-a","sid":"s","leaf":""}` {
		t.Errorf("a bad gen and no clock: %s", got)
	}
}
