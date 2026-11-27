package attention

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ccrc/core/internal/kernel"
)

func readLinesFile(t *testing.T, name string) []string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSuffix(string(b), "\n"), "\n")
}

// TurnMark is TURN_MARK_PROGRAM byte for byte: every case of turnmark-cases.jsonl against what real jq printed for the
// program cut from ccd/session-hook.sh (testdata/gen-turnmark-golden.sh). Red when the Go program changes shape, as
// ccd-swap-guards.test.ts's cut is red when the bash's does.
func TestTurnMarkGolden(t *testing.T) {
	cases, want := readLinesFile(t, "turnmark-cases.jsonl"), readLinesFile(t, "turnmark.golden")
	if len(cases) != len(want) {
		t.Fatalf("%d cases, %d golden lines: regenerate", len(cases), len(want))
	}
	for i, line := range cases {
		var c struct {
			Prev, Kind, Sid, Ev, Bg, Crons, Bgk, Bgi, Err string
			At                                            int64
		}
		if err := json.Unmarshal([]byte(line), &c); err != nil {
			t.Fatal(err)
		}
		got, ok := TurnMark(Mark{Prev: c.Prev, Kind: c.Kind, Sid: c.Sid, Event: c.Ev, At: c.At, Bg: c.Bg, Crons: c.Crons,
			Bgk: c.Bgk, Bgi: c.Bgi, Err: c.Err})
		g := string(got)
		if !ok {
			g = "-"
		}
		if g != want[i] {
			t.Errorf("case %d (%s):\n got %s\nwant %s", i+1, c.Kind, g, want[i])
		}
	}
}

// The goldens are only as current as the program they were measured from: the sha256 of TURN_MARK_PROGRAM, cut from
// ccd/session-hook.sh as gen-turnmark-golden.sh cuts it, is pinned beside them, so a change to the bash's program is
// red here until the goldens are regenerated (and TurnMark made to match them).
func TestTurnMarkProgramPinned(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "ccd", "session-hook.sh"))
	if err != nil {
		t.Fatal(err)
	}
	s := strings.ReplaceAll(string(src), "\r\n", "\n")
	const head = "\nTURN_MARK_PROGRAM='"
	i := strings.Index(s, head)
	if i < 0 {
		t.Fatal("ccd/session-hook.sh has no TURN_MARK_PROGRAM")
	}
	body := s[i+len(head):]
	end := strings.Index(body, "'\n") // the first line after the head that ends the single-quoted block
	if end < 0 {
		t.Fatal("TURN_MARK_PROGRAM's closing quote not found")
	}
	got := fmt.Sprintf("%x", sha256.Sum256([]byte(body[:end])))
	want := strings.TrimSpace(readLinesFile(t, "turnmark-program.sha256")[0])
	if got != want {
		t.Errorf("TURN_MARK_PROGRAM changed (sha256 %s, the goldens were measured from %s): run testdata/gen-turnmark-golden.sh "+
			"with real jq and make TurnMark match the new goldens", got, want)
	}
}

func parse(t *testing.T, s string) any {
	t.Helper()
	v, err := kernel.JQParse([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestParsePayload(t *testing.T) {
	p, ok := ParsePayload(`{"hook_event_name":"Pre-Tool Use1","session_id":"a b;c","agent_id":"ag-1","tool_name":"Bash","tool_input":{"command":"` + strings.Repeat("x", 300) + `"}}`)
	if !ok || p.Event != "PreToolUse" || p.Psid != "abc" || !p.Paid || p.Aid != "ag-1" {
		t.Fatalf("%+v", p)
	}
	if p.ApCall != `{"t":"Bash","s":"`+strings.Repeat("x", 200)+`"}` {
		t.Errorf("ap_call %s", p.ApCall)
	}
	// a tool_input the summary cannot index: the call key is "" (the parse's try/catch), the rest stands
	if p, ok := ParsePayload(`{"hook_event_name":"Stop","agent_id":"a;1","tool_input":"s"}`); !ok || p.ApCall != "" || p.Aid != "" || !p.Paid {
		t.Errorf("%+v", p)
	}
	for _, bad := range []string{"not json", "[1]", `"Stop"`, "null", `{"hook_event_name":12}`, `{}`} {
		if _, ok := ParsePayload(bad); ok {
			t.Errorf("%s: parsed", bad)
		}
	}
	if p, _ := ParsePayload(`{"hook_event_name":{"Stop":1}}`); p.Event != "Stop" { // tostring of an object, letters kept
		t.Errorf("object event %q", p.Event)
	}
	if Payload([]byte("{}\n\n")) != "{}" || Payload([]byte("a\x00b")) != "ab" {
		t.Error("$(cat) drops NULs and trailing newlines")
	}
}

func TestClassify(t *testing.T) {
	c := Classify("PermissionRequest", "", parse(t, `{"tool_name":"Bash","tool_input":{"command":"ls"}}`))
	if c.State != "waiting" || !c.Apr || string(kernel.JQCompact(c.Ask)) != `{"approval":{"tool":"Bash","summary":"ls"}}` {
		t.Errorf("%+v", c)
	}
	c = Classify("PreToolUse", "", parse(t, `{"tool_name":"AskUserQuestion","tool_input":{}}`))
	if c.State != "waiting" || string(kernel.JQCompact(c.Ask)) != `{"questions":[]}` {
		t.Errorf("%+v", c)
	}
	c = Classify("Stop", "", parse(t, `{"background_tasks":[{"type":"Local Agent","id":"t1","status":"running"},{"type":"shell","id":"bad id"},`+
		`{"type":"subagent","status":"completed"},"x"],"session_crons":[1,2]}`))
	if c.Bg != "4" || c.Bgk != "local-agent,shell,subagent" || c.Bgi != "t1" || c.Bgd != "1" || c.Bgdk != "local-agent" || c.Crons != "2" {
		t.Errorf("%+v", c)
	}
	if c := Classify("Stop", "", parse(t, `{"background_tasks":"x"}`)); c.Bg != "-1" || c.Bgd != "" || c.Crons != "-1" {
		t.Errorf("%+v", c)
	}
	if c := Classify("StopFailure", "", parse(t, `{"error":"Rate Limit_x9"}`)); !c.Stopfail || c.Err != "ateimit_x" {
		t.Errorf("%+v", c)
	}
	for ev, exit := range map[string]bool{"PreModelSwitch": true, "PostModelSwitch": true, "Notification": true, "SubagentStart": false} {
		if Classify(ev, "", parse(t, `{}`)).Exit != exit {
			t.Errorf("%s exit", ev)
		}
	}
	if c := Classify("SessionStart", "", parse(t, `{"source":"compact"}`)); !c.Sessend || c.State != "" {
		t.Errorf("%+v", c)
	}
	if c := Classify("PostToolUse", `graphify`, parse(t, `{"tool_name":"Bash","tool_input":{"command":"graphify query x\n\n"}}`)); c.Gcmd != "graphify query x" {
		t.Errorf("gcmd %q", c.Gcmd)
	}
}

func TestServerCap(t *testing.T) {
	ok := "at 1000\ncaps a hook-main-state-v1\nend\n"
	if !ServerCap([]byte(ok), 1100, "hook-main-state-v1") {
		t.Error("a current listing")
	}
	for name, c := range map[string]struct {
		data string
		now  int64
		word string
	}{"stale": {ok, 1181, "hook-main-state-v1"}, "future": {ok, 999, "hook-main-state-v1"}, "prefix": {ok, 1100, "hook-main"},
		"no end newline": {strings.TrimSuffix(ok, "\n"), 1100, "a"}, "a fourth line": {ok + "\n", 1100, "a"},
		"upper case": {"at 1000\ncaps A\nend\n", 1100, "A"}} {
		if ServerCap([]byte(c.data), c.now, c.word) {
			t.Errorf("%s: advertised", name)
		}
	}
}

func TestReadPrevAndFresh(t *testing.T) {
	p := ReadPrev([]byte(`{"state":"done","graphQueries":2.7,"approvals":[1,{"a":1}],"subagents":[{"name":"x"}]}`), true)
	if p.State != "done" || p.Gq != "2" || p.Gd != "0" || p.Apl != `[{"a":1}]` || p.Subs != `[{"name":"x"}]` || p.Unreadable {
		t.Errorf("%+v", p)
	}
	if p := ReadPrev([]byte(`{nope`), true); !p.Unreadable || p.Subs != "[]" || p.Gq != "0" {
		t.Errorf("%+v", p)
	}
	if p := ReadPrev([]byte(`{"graphQueries":1e16}`), true); p.Gq != "0" { // jq prints 1e+16, which ^[0-9]+$ refuses
		t.Errorf("%+v", p)
	}
	// D-1249: a string state with a newline shifts every later field, and each guard catches its own
	if p := ReadPrev([]byte(`{"state":"a\nb","graphQueries":3}`), true); p.State != "a" || p.Gq != "0" {
		t.Errorf("%+v", p)
	}
	f := ReadFresh([]byte(`{"state":"waiting","waitBy":"subagent","ask":{"q":1},"updatedAt":12.9,"event":"Pre1Tool","bgDelegated":2,"bgDelegatedKinds":"a,b",` +
		`"waitPrev":{"state":"done","event":"Stop","updatedAt":5,"ask":null,"interrupted":true}}`))
	if f.State != "waiting" || f.By != "subagent" || f.Ask != `{"q":1}` || f.Upd != "12" || f.Ev != "PreTool" || f.Bgd != "2" || f.Bgdk != "a,b" {
		t.Errorf("%+v", f)
	}
	if s, ok := f.WaitPrevKept(); !ok || s != `{"state":"done","event":"Stop","updatedAt":5,"ask":null,"interrupted":true}` {
		t.Errorf("%s", s)
	}
	if f := ReadFresh([]byte(`{"state":"waiting","bgDelegated":2,"bgDelegatedKinds":"A"}`)); f.Bgd != "" || f.Bgdk != "" {
		t.Errorf("both or neither: %+v", f)
	}
}

func TestBuildHookstate(t *testing.T) {
	w := Write{State: "working", Event: "PreToolUse", SessionID: "u", PID: "4242", UpdatedAt: 7, Subs: "[]", Apl: `[{"agentId":"a1","tool":"Bash","summary":"ls"},{"agentId":"a2"}]`,
		Gq: "1", Gd: "0", Cp: "0", Cc: "0", ApDrop: "a1", ApCall: `{"t":"Bash","s":"ls"}`}
	got, ok := BuildHookstate(w, true)
	want := `{"v":1,"state":"working","event":"PreToolUse","sessionId":"u","pid":4242,"updatedAt":7,"ask":null,"subagents":[],"graphQueries":1,"graphGateDenials":0,"ccrcPeerReads":0,"ccrcClaims":0,"approvals":[{"agentId":"a2"}]}`
	if !ok || string(got) != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
	for _, bad := range []Write{{PID: "abc", Subs: "[]", Apl: "[]"}, {Subs: "[nope", Apl: "[]"}} {
		bad.Gq, bad.Gd, bad.Cp, bad.Cc = "0", "0", "0", "0"
		if _, ok := BuildHookstate(bad, true); ok {
			t.Errorf("%+v: an --argjson that cannot parse wrote", bad)
		}
	}
	big := Write{State: "waiting", Subs: "[]", Apl: "[]", Gq: "0", Gd: "0", Cp: "0", Cc: "0",
		Ask: kernel.Obj{{K: "questions", V: strings.Repeat("é", 70000)}}}
	if got, ok := BuildHookstate(big, true); !ok || !strings.Contains(string(got), `"ask":null`) {
		t.Errorf("over the cap in code points: the ask is dropped (%v)", ok)
	}
	if got, ok := BuildHookstate(big, false); !ok || !strings.Contains(string(got), `"ask":null`) {
		t.Errorf("over the cap in bytes too (%v %d)", ok, len(got))
	}
	big.Ask = kernel.Obj{{K: "questions", V: strings.Repeat("é", 40000)}} // 40000 code points, 80000 bytes
	if got, _ := BuildHookstate(big, true); strings.Contains(string(got), `"ask":null`) {
		t.Error("under the cap in code points: the ask stays")
	}
	if got, _ := BuildHookstate(big, false); !strings.Contains(string(got), `"ask":null`) {
		t.Error("over it in bytes (a C locale): the ask is dropped")
	}
}

func TestSubagents(t *testing.T) {
	s := Subagents("[]", "SubagentStart", "rev", "a1", 5)
	s = Subagents(s, "SubagentStart", "rev", "a1", 6)
	if s != `[{"name":"rev","startedAt":5,"id":"a1"}]` {
		t.Errorf("%s", s)
	}
	if Subagents(s, "SubagentStop", "x", "a1", 7) != `[]` {
		t.Error("stop by id")
	}
	if Subagents(`[{"name":"a"},{"name":"b"},{"name":"a"}]`, "SubagentStop", "a", "", 0) != `[{"name":"b"},{"name":"a"}]` {
		t.Error("stop by name removes the first")
	}
	if Subagents(`["s"]`, "SubagentStop", "a", "", 0) != `[]` || Subagents(`[nope`, "SubagentStart", "a", "", 0) != `[]` {
		t.Error("a jq failure is []")
	}
	if PruneSubagents(`[{"id":"a"},{"id":"b"},{"name":"c"}]`, "1", "b", "1", "subagent") != `[{"id":"b"}]` {
		t.Error("prune")
	}
	if n, id := SubagentName(parse(t, `{"agent_type":" t\nx ","agent_id":12}`)); n != "t x" || id != "12" {
		t.Errorf("%q %q", n, id)
	}
}

func TestEmitContext(t *testing.T) {
	got := string(EmitContext(Cards{Standing: strings.Repeat("s", 3000), Roster: "r", Anchor: "a"}, true))
	want := `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"a\n` + strings.Repeat("s", 2400) + ` r"}}`
	if got != want {
		t.Errorf("got %s", got)
	}
	if (Cards{}).Any() {
		t.Error("no subject, no print")
	}
}

func TestTurnKindAndJoin(t *testing.T) {
	if TurnKind("PreToolUse", "", `{"v":1,"sessionId":"u","state":"working"}`, "u") != "" || TurnKind("PreToolUse", "", `{"state":"working","sessionId":"v"}`, "u") != "working" {
		t.Error("a tool event under this session's working line writes nothing")
	}
	if TurnKind("SessionStart", "compact", "", "u") != "" || TurnKind("SessionStart", "", "", "u") != "restart" {
		t.Error("session start kinds")
	}
	if !Joined([]byte("a\nb\n"), "b") || Joined([]byte("a\nb"), "b") || Joined([]byte("ab\n"), "b") {
		t.Error("whole lines, the last only with its newline")
	}
	if SessionFromPane("cc-demo\n") != "demo" || SessionFromPane("cc-") != "" || SessionFromPane("main") != "" {
		t.Error("pane names")
	}
}
