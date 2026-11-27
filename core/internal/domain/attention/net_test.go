package attention

import (
	"strings"
	"testing"
	"time"

	"ccrc/core/internal/kernel"
)

func TestNetBound(t *testing.T) {
	var n Net
	if left, ok := n.Bound(1000, 4000); left != 4000 || !ok || n.DL != 9000 {
		t.Fatalf("first ask: %d %v dl %d", left, ok, n.DL)
	}
	// one deadline for the invocation: the second ask is bound by what is left, not by its own max
	if left, ok := n.Bound(6000, 4000); left != 3000 || !ok {
		t.Errorf("second ask: %d %v", left, ok)
	}
	if left, ok := n.Bound(8100, 4000); left != 900 || ok {
		t.Errorf("under a second left starts nothing: %d %v", left, ok)
	}
	if left, ok := n.Bound(9500, 4000); left >= 0 || ok {
		t.Errorf("past the deadline: %d %v", left, ok)
	}
	n = Net{DL: 9000, Hung: true}
	if _, ok := n.Bound(1000, 4000); ok {
		t.Error("a read that ran out its bound is not followed by another")
	}
	if got := Seconds(3999); got != 3900*time.Millisecond {
		t.Errorf("NET_B steps in tenths of a second: %v", got)
	}
	if got := Left(10000, 9990); got != 100*time.Millisecond {
		t.Errorf("_hook_left is at least 0.1: %v", got)
	}
}

func TestSendOutcome(t *testing.T) {
	for _, c := range []struct {
		rc   int
		out  string
		want int
	}{
		{0, "{}\nhttp 202", SendTaken}, {0, `{"error":"stale-uuid"}` + "\nhttp 403", SendStale}, {0, "http 401", SendKept}, {0, "http 404", SendKept},
		{0, "http 503", SendKept}, {0, "http 400", SendRefused}, {0, "http 403 nope", SendRefused}, {0, "http 4", SendNoAnswer},
		{0, "", SendNoAnswer}, {2, "http 202", SendKept}, {124, "http 202", SendNoAnswer}, {127, "", SendNoAnswer}, {1, "http 202", SendNoAnswer},
		{0, "x http 5", SendNoAnswer}, {0, "http 40", SendNoAnswer},
	} {
		if got := SendOutcome(c.rc, c.out); got != c.want {
			t.Errorf("SendOutcome(%d, %q) = %d, want %d", c.rc, c.out, got, c.want)
		}
	}
}

func TestNudge(t *testing.T) {
	line := func(id string) string { return nudgeHead + id + nudgeTail }
	for id, want := range map[string]int64{"1": 1, "42": 42, "123456789012345": 123456789012345, "9007199254740991": 9007199254740991} {
		if n, ok := nudge(line(id)); !ok || n != want {
			t.Errorf("nudge(%s) = %d %v", id, n, ok)
		}
	}
	for _, id := range []string{"", "0", "007", "-1", "1.5", "9007199254740992", "9999999999999999", "12345678901234567", " 1", "1 ", "٣", "1e3"} {
		if n, ok := nudge(line(id)); ok {
			t.Errorf("nudge(%q) = %d: not an id", id, n)
		}
	}
	for _, l := range []string{line("5") + " ", " " + line("5"), strings.Replace(line("5"), "Operator", "operator", 1), nudgeHead + nudgeTail, "x"} {
		if _, ok := nudge(l); ok {
			t.Errorf("nudge(%q) matched", l)
		}
	}
}

func obj(kv ...any) kernel.Obj {
	var o kernel.Obj
	for i := 0; i < len(kv); i += 2 {
		o = append(o, kernel.KV{K: kv[i].(string), V: kv[i+1]})
	}
	return o
}

func TestDoorReports(t *testing.T) {
	ev := func(e string, more ...any) any {
		return obj(append([]any{"hook_event_name", e, "session_id", "u-1"}, more...)...)
	}
	one := func(in DoorIn) []string {
		var s []string
		for _, b := range DoorReports(in) {
			s = append(s, string(b))
		}
		return s
	}
	got := one(DoorIn{V: ev("PreToolUse", "tool_name", "mcp__door__x"), ID: "id", Key: "k", Aid: "a1", Joined: true, Now: 5})
	if len(got) != 1 || got[0] != `{"kind":"witness","key":"k","tool":"mcp__door__x","agentId":"a1","fromId":"id","fromUuid":"u-1","at":5}` {
		t.Errorf("witness: %v", got)
	}
	// no join and no agent_type: the main thread's call, whatever aid is
	got = one(DoorIn{V: ev("PreToolUse", "tool_name", "mcp__door__x"), ID: "id", Key: "k", Aid: "a1"})
	if len(got) != 1 || !strings.Contains(got[0], `"agentId":null`) {
		t.Errorf("an unjoined, untyped agent id is not carried: %v", got)
	}
	if got = one(DoorIn{V: ev("PreToolUse"), ID: "id"}); len(got) != 0 {
		t.Errorf("no key, no witness: %v", got)
	}
	if got = one(DoorIn{V: ev("Stop"), ID: "id", Quiet: true, Now: 1}); len(got) != 1 || !strings.HasPrefix(got[0], `{"kind":"readers-clear","fromId"`) {
		t.Errorf("readers-clear: %v", got)
	}
	if got = one(DoorIn{V: ev("Stop"), ID: "id"}); len(got) != 0 {
		t.Errorf("a Stop with background work clears nothing: %v", got)
	}
	got = one(DoorIn{V: ev("SubagentStart", "agent_type", strings.Repeat("é", 200)), ID: "id", Aid: "a1"})
	if len(got) != 1 || !strings.Contains(got[0], `"agentType":"`+strings.Repeat("é", 128)+`","fromId"`) {
		t.Errorf("reader-start cuts the type to 128 characters: %v", got)
	}
	got = one(DoorIn{V: ev("UserPromptSubmit", "prompt", "hi\n"+nudgeHead+"7"+nudgeTail+"\n"+nudgeHead+"x"+nudgeTail+"\n"+nudgeHead+"9"+nudgeTail), ID: "id", Now: 2})
	if len(got) != 2 || !strings.Contains(got[0], `"messageId":7,`) || !strings.Contains(got[1], `"messageId":9,`) {
		t.Errorf("picked-up, line by line, in order: %v", got)
	}
}

func TestDoorKey(t *testing.T) {
	v := obj("tool_input", obj("b", 1, "a", obj("z", nil)))
	// the sha256 of "mcp__door__x\n" + `{"a":{"z":null},"b":1}`
	k := DoorKey("mcp__door__x", v, false)
	if len(k) != 64 || k != Sha256Hex([]byte("mcp__door__x\n"+`{"a":{"z":null},"b":1}`)) {
		t.Errorf("key %s", k)
	}
	if DoorKey("mcp__door__x", obj(), false) != Sha256Hex([]byte("mcp__door__x\n{}")) {
		t.Error("an absent input hashes as {}")
	}
	for _, c := range []struct {
		tool   string
		denied bool
	}{{"mcp__door__", false}, {"mcp__other__x", false}, {"Bash", false}, {"mcp__door__x", true}} {
		if DoorKey(c.tool, v, c.denied) != "" {
			t.Errorf("%v has no witness", c)
		}
	}
}

func TestModelReport(t *testing.T) {
	v := obj("session_id", "u", "from_model", obj("id", "claude-a\x01é"), "to_model", strings.Repeat("m", 200))
	if got := string(ModelReport("switched", "id", 9, v)); got != `{"kind":"model-switch","how":"switched","from":"claude-a","to":"`+strings.Repeat("m", 128)+`","fromId":"id","fromUuid":"u","at":9}` {
		t.Errorf("switched: %s", got)
	}
	typed := func(p string) string { return string(ModelReport("typed-refused", "id", 1, obj("prompt", p))) }
	for p, want := range map[string]string{"/model opus": "opus", "  \n/model\topus  x": "opus", "/model": "", "/model \tfast\nslow": "fast", "/model\n opus": ""} {
		to := "null"
		if want != "" {
			to = `"` + want + `"`
		}
		if got := typed(p); !strings.Contains(got, `"from":null,"to":`+to+`,`) {
			t.Errorf("typed %q: %s", p, got)
		}
	}
	if !ModelReportOK(false, "a-b_1", true, false, false) || ModelReportOK(true, "a", true, false, false) || ModelReportOK(false, "a.b", true, false, false) ||
		ModelReportOK(false, "a", false, false, false) || ModelReportOK(false, "a", true, true, false) || ModelReportOK(false, "a", true, false, true) {
		t.Error("ModelReportOK")
	}
}

func TestDoorDelta(t *testing.T) {
	const now = 1_700_000_000_000
	head := "v=1 at=1 until=1700000100000\n"
	for _, c := range []struct{ in, want string }{
		{head + "ccrc-delta: hi\n", "ccrc-delta: hi"},
		{head, ""},
		{head + "\nsecond", ""},
		{head + "ccrc-delta: a\u0007\x1bb\u0085c d‮e⁦f⁩g\nsecond", "ccrc-delta: abcdefg"},
		{head + "ccrc-delta: a‧ ⁥⁪ ·", "ccrc-delta: a‧ ⁥⁪ ·"},
		{head + "other", DoorDeltaUnknown},
		{head + "\u0007‮", DoorDeltaUnknown},
		{"v=1 at=1 until=1699999999999\nccrc-delta: hi", DoorDeltaUnknown},
		{"v=2 at=1 until=1700000100000\nccrc-delta: hi", DoorDeltaUnknown},
		{"v=1 at=x until=1700000100000\nccrc-delta: hi", DoorDeltaUnknown},
		{"", DoorDeltaUnknown},
		{head + "ccrc-delta: " + strings.Repeat("x", 400), ("ccrc-delta: " + strings.Repeat("x", 400))[:300]},
	} {
		if got := DoorDelta([]byte(c.in), now); got != c.want {
			t.Errorf("DoorDelta(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
