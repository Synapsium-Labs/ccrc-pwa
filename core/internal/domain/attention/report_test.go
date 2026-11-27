package attention

import (
	"reflect"
	"strings"
	"testing"

	"ccrc/core/internal/kernel"
)

func TestStartBody(t *testing.T) {
	const gen = "0189abcd-1234-5678-9abc-0123456789ab"
	nonce := strings.Repeat("a", 64)
	v := obj("session_id", "u-1", "source", strings.Repeat("s", 40), "model", obj("id", strings.Repeat("m", 200)))
	want := `{"fromId":"id","fromUuid":"u-1","startedUuid":"u-1","reportId":"r","source":"` + strings.Repeat("s", 32) + `","model":"` + strings.Repeat("m", 128) +
		`","rowIncarnation":"` + gen + `","reportedAt":7,"doorNonceSha256":"` + nonce + `"}`
	if got := string(StartBody(v, "id", "r", gen, nonce, 7)); got != want {
		t.Errorf("%s", got)
	}
	// no source reads `other`, a malformed incarnation or nonce is left out, a model that is neither text nor an id is null
	got := string(StartBody(obj("session_id", 5, "model", 3), "id", "r", strings.ToUpper(gen), nonce+"0", 7))
	if got != `{"fromId":"id","fromUuid":"5","startedUuid":"5","reportId":"r","source":"other","model":null,"rowIncarnation":null,"reportedAt":7}` {
		t.Errorf("%s", got)
	}
}

func TestParsePending(t *testing.T) {
	after, drop, kept := ParsePending([]byte("123\t4\n0\t{\"a\":1}\n2\t\t{\"b\":2}\t\nunterminated"))
	if after != 123 || drop != 4 || !reflect.DeepEqual(kept, []Kept{{0, `{"a":1}`}, {2, `{"b":2}`}}) {
		t.Errorf("%d %d %v: a last line with no newline is no loop pass, runs of tabs are one delimiter", after, drop, kept)
	}
	if a, d, k := ParsePending([]byte("x\ty\n")); a != 0 || d != 0 || k != nil {
		t.Errorf("a header that is not numbers reads 0: %d %d %v", a, d, k)
	}
	if a, _, _ := ParsePending([]byte("77")); a != 77 {
		t.Errorf("a header with no newline still reads: %d", a)
	}
}

func TestPassKeep(t *testing.T) {
	// outcome -> (on, why, stays, drops, tries kept)
	for _, c := range []struct {
		r        int
		on       bool
		why      int
		stay     int
		drop     int64
		wantTrie int
	}{
		{SendTaken, true, 0, 0, 0, 0}, {SendRefused, true, 0, 0, 1, 0}, {SendStale, false, 1, 1, 0, 3}, {SendNoTime, true, 1, 1, 0, 2},
		{SendNoAnswer, false, 2, 1, 0, 2}, {SendKept, false, 2, 1, 0, 3}, {SendUnsent, true, 0, 1, 0, 2}, {SendStaleElse, true, 0, 1, 0, 3},
	} {
		p := Pass{On: true}
		p.Keep(2, "j", c.r)
		if p.On != c.on || p.Why != c.why || len(p.Stay) != c.stay || p.Drop != c.drop || (c.stay == 1 && p.Stay[0].T != c.wantTrie) {
			t.Errorf("outcome %d: %+v", c.r, p)
		}
	}
	p := Pass{On: true, Why: 2}
	p.Keep(0, "j", SendStale)
	if p.Why != 2 {
		t.Error("a stale answer never lowers a no-answer's back-off")
	}
	p = Pass{}
	p.Keep(StartResendTries-1, "j", SendKept)
	if p.Drop != 1 || len(p.Stay) != 0 {
		t.Errorf("a report tried %d times is dropped: %+v", StartResendTries, p)
	}
}

func TestPassFinish(t *testing.T) {
	p := Pass{After: 5, Drop: 2, Why: 2, Stay: []Kept{{1, "a"}}}
	if text, rm := p.Finish(1000, false); rm || text != "31000\t2\n1\ta\n" {
		t.Errorf("%q %v", text, rm)
	}
	p = Pass{After: 5, Why: 1}
	if _, rm := p.Finish(1000, true); !rm || p.After != 6000 {
		t.Errorf("a stale pass stamps the short back-off, and an empty field is removed: %+v", p)
	}
	p = Pass{After: 9, Drop: 1}
	if text, rm := p.Finish(1000, true); rm || text != "0\t1\n" {
		t.Errorf("a taken fresh report clears the stamp; a drop count keeps the field: %q %v", text, rm)
	}
	for i := 0; i < StartPendingMax+3; i++ {
		p.Stay = append(p.Stay, Kept{T: i, J: "j"})
	}
	text, _ := p.Finish(1000, false)
	if n := strings.Count(text, "\n"); n != StartPendingMax+1 || !strings.HasPrefix(text, "0\t4\n3\tj\n") {
		t.Errorf("at most %d kept, the oldest dropped and counted: %q", StartPendingMax, text)
	}
}

func TestResend(t *testing.T) {
	for _, c := range []struct {
		in, want string
		ok       bool
	}{
		{`{"fromUuid":"x","source":"clear"}`, `{"fromUuid":"U","source":"clear","startedUuid":"x"}`, true},
		{`{"fromUuid":"x","startedUuid":"y","source":"startup"}`, `{"fromUuid":"x","startedUuid":"y","source":"startup"}`, true},
		{`{"fromUuid":"x","startedUuid":false,"source":"resume"}`, `{"fromUuid":"U","startedUuid":"x","source":"resume"}`, true},
		{`{"a":1}`, `{"a":1,"startedUuid":null}`, true},
		{`{"source":"compact","fromUuid":1.0}`, `{"source":"compact","fromUuid":"U","startedUuid":1.0}`, true},
		{`null`, `{"startedUuid":null}`, true},
		{``, ``, true}, {"  ", ``, true},
		{`[1]`, ``, false}, {`"s"`, ``, false}, {`5`, ``, false}, {`{`, ``, false},
	} {
		got, ok := Resend(c.in, "U")
		if got != c.want || ok != c.ok {
			t.Errorf("Resend(%q) = %q %v, want %q %v", c.in, got, ok, c.want, c.ok)
		}
	}
	if StaleElsewhere(SendStale, `{"fromUuid":"a"}`, "b") != SendStaleElse || StaleElsewhere(SendStale, `{"fromUuid":"b"}`, "b") != SendStale ||
		StaleElsewhere(SendKept, `{"fromUuid":"a"}`, "b") != SendKept {
		t.Error("StaleElsewhere")
	}
}

func TestLoads(t *testing.T) {
	f := ParseLoads([]byte("2\trid\t100\tresume\t/a b/c\n150\t{\"x\":1}\n"))
	if f.T != "2" || f.Rid != "rid" || f.Off != "100" || f.Sc != "resume" || f.Tp != "/a b/c" || f.We != "150" || f.Body != `{"x":1}` || !f.Valid() {
		t.Errorf("%+v", f)
	}
	if f = ParseLoads([]byte("x\trid\t1\tstartup\t/p\n\n")); f.Valid() || f.We != "" {
		t.Errorf("tries that are not a number: %+v", f)
	}
	if f = ParseLoads([]byte("0\trid\t1\tstartup\trel/path\n")); f.Valid() {
		t.Error("a relative path is no transcript")
	}
	if LoadsVer("/x/versions/1.2.3") != "1.2.3" || LoadsVer("/x/-bad") != "" || LoadsVer("") != "" || LoadsVer("/x/"+strings.Repeat("1", 33)) != "" {
		t.Error("LoadsVer")
	}
	if Digest("overlord:abc:def") != "abc:def" || Digest("plain") != "plain" {
		t.Error("Digest")
	}
	l := ParseLoadLast([]byte("r1\tabc\t1.2.3\t10\t90\t/t\t\nsecond"))
	if l != (LoadLast{"r1", "abc", "1.2.3", "10", "90", "/t"}) {
		t.Errorf("%+v", l)
	}
	if !l.Carried("resume", "/t", "p:abc", "1.2.3", 90) || l.Carried("startup", "/t", "p:abc", "1.2.3", 90) || l.Carried("resume", "/u", "p:abc", "1.2.3", 90) ||
		l.Carried("resume", "/t", "p:abd", "1.2.3", 90) || l.Carried("resume", "/t", "p:abc", "1.2.4", 90) || l.Carried("resume", "/t", "p:abc", "", 90) ||
		l.Carried("resume", "/t", "p:abc", "1.2.3", 89) {
		t.Error("Carried: same transcript, digest and build, and a window ending inside the one read")
	}
	if n, ok := ReadyEnd(`{"state":"ready","end":42,"x":1}`); !ok || n != 42 {
		t.Error("ReadyEnd")
	}
	if _, ok := ReadyEnd(`{"state":"wait","end":42,`); ok {
		t.Error("only a ready window ends the read")
	}
	taken := LoadsEnd(LoadsFile{T: "1", Rid: "r", Off: "5", Sc: "startup", Tp: "/t"}, SendTaken, "b", "9", "p:d", "1.0")
	if !taken.Remove || taken.LastLine != "r\td\t1.0\t5\t9\t/t\n" {
		t.Errorf("%+v", taken)
	}
	if a := LoadsEnd(LoadsFile{T: "1", Sc: "resume"}, SendTaken, "b", "9", "p:d", "1.0"); !a.Remove || a.LastLine != "" {
		t.Errorf("only a startup records its window: %+v", a)
	}
	if !LoadsEnd(LoadsFile{T: "0"}, SendRefused, "", "", "", "").Remove || !LoadsEnd(LoadsFile{T: "4"}, SendKept, "", "", "", "").Remove {
		t.Error("a refusal for good and the last try remove the file")
	}
	keep := LoadsEnd(LoadsFile{T: "1", Rid: "r", Off: "5", Sc: "resume", Tp: "/t"}, SendKept, "body", "9", "", "")
	if keep.Remove || keep.Keep != "2\tr\t5\tresume\t/t\n9\tbody\n" {
		t.Errorf("%+v", keep)
	}
	if k := LoadsEnd(LoadsFile{T: "1", Rid: "r", Off: "5", Sc: "resume", Tp: "/t"}, SendUnsent, "", "", "", ""); k.Keep != "2\tr\t5\tresume\t/t\n\n" {
		t.Errorf("a try with no body spools an empty line: %q", k.Keep)
	}
}

func TestAnchorAnswer(t *testing.T) {
	const text = "ccrc-anchor: hello\nline 2"
	for _, c := range []struct {
		out, form, word, text string
	}{
		{`{"ok":true,"part":"anchor","form":"start","text":"` + `ccrc-anchor: hello\nline 2` + `"}`, "start", "text", text},
		{`{"ok":true,"part":"anchor","form":"start","dark":true,"text":"ccrc-anchor: x"}`, "start", "dark", ""},
		{`{"ok":true,"part":"anchor","form":"fork","live":true}`, "fork", "live", ""},
		{`{"ok":true,"part":"anchor","form":"start","live":true,"text":"ccrc-anchor: x"}`, "start", "text", "ccrc-anchor: x"},
		{`{"ok":true,"part":"anchor","form":"start","text":"no prefix"}`, "start", "", ""},
		{`{"ok":true,"part":"anchor","form":"prompt","text":"ccrc-anchor: x"}`, "start", "", ""},
		{`{"ok":true,"part":"card","form":"start","text":"ccrc-anchor: x"}`, "start", "", ""},
		{`{"ok":false,"part":"anchor","form":"start","dark":true}`, "start", "", ""},
		{`{"ok":true,"part":"anchor","form":"start","text":"ccrc-anchor: a\u0000b"}`, "start", "text", "ccrc-anchor: a"},
		{`[1]`, "start", "", ""}, {``, "start", "", ""}, {`not json`, "start", "", ""},
	} {
		if w, x := AnchorAnswer(c.out, c.form); w != c.word || x != c.text {
			t.Errorf("AnchorAnswer(%s, %s) = %q %q, want %q %q", c.out, c.form, w, x, c.word, c.text)
		}
	}
}

func TestOwedAndWake(t *testing.T) {
	if OwedTries("2") != 2 || OwedTries("") != 0 || OwedTries("12") != 0 || OwedTries("x") != 0 {
		t.Error("OwedTries: one digit, else 0")
	}
	if p := Owed("text", 1); !p.Print || !p.Remove {
		t.Errorf("%+v", p)
	}
	if p := Owed("dark", 1); p.Print || !p.Remove {
		t.Errorf("%+v", p)
	}
	if p := Owed("", 0); p.Remove || p.Print || p.Count != "1\n" {
		t.Errorf("no answer counts a try: %+v", p)
	}
	if p := Owed("", AnchorOwedTries-1); !p.Remove || p.Count != "" {
		t.Errorf("the last try removes the mark: %+v", p)
	}
	if WakePrompt(obj("prompt", RosterWakeMail+" x", "transcript_path", "/t")) != "/t" || WakePrompt(obj("prompt", "x "+RosterWakeMail, "transcript_path", "/t")) != "" ||
		WakePrompt(obj("prompt", RosterWakeIdle, "transcript_path", 5)) != "" || WakePrompt(obj("prompt", 5)) != "" {
		t.Error("WakePrompt: a prompt that BEGINS with a wake text, and a transcript that is text")
	}
	if !WakeFiltered("a "+RosterWakeIdle[:30]+" b") || WakeFiltered("nothing") {
		t.Error("WakeFiltered")
	}
	if !WakeReady("/t", true) || WakeReady("/t", false) || WakeReady("t", true) || !IdleOpen("true") || IdleOpen("false") || IdleOpen("") ||
		!RosterShadowDue(false, 0) || !RosterShadowDue(true, RosterShadowMax) || RosterShadowDue(true, RosterShadowMax+1) ||
		!DeltaAlone("d", false, false) || DeltaAlone("", false, false) || DeltaAlone("d", true, false) || DeltaAlone("d", false, true) {
		t.Error("the wake, shadow and delta decisions")
	}
	if !RosterLive(`{"rosterCard":"live"}`) || RosterLive(`{"rosterCard":"shadow"}`) || RosterLive(`{}`) || RosterLive(`x`) || RosterLive(`[1]`) {
		t.Error("RosterLive")
	}
	if !RosterEligible(false, false, false, false) || RosterEligible(true, false, false, false) || RosterEligible(false, true, false, false) ||
		RosterEligible(false, false, true, false) || RosterEligible(false, false, false, true) {
		t.Error("RosterEligible")
	}
	if got := string(PromptEnvelope("a\xffb")); got != `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"a`+"�"+`b"}}` {
		t.Errorf("invalid UTF-8 is repaired as jq --arg repairs it: %s", got)
	}
	if WithDelta("héllo", 2, "D", true) != "hé\nD" || WithDelta("héllo", 2, "", false) != "h\xc3" || WithDelta("ab", 5, "", true) != "ab" {
		t.Error("WithDelta")
	}
	if RoleCard("startup", false, false, false, false) != roleFresh || RoleCard("fork", false, false, false, false) != roleStill ||
		RoleCard("clear", true, false, false, false) != "" || RoleCard("clear", false, true, false, false) != "" || RoleCard("clear", false, false, true, false) != "" ||
		RoleCard("clear", false, false, false, true) != "" {
		t.Error("RoleCard")
	}
	_ = kernel.Obj{}
}

func TestStartDecisions(t *testing.T) {
	ok := func(ev string, paid bool, id string, gen, plink, child, clink bool) bool {
		return StartEligible(ev, paid, id, gen, plink, child, clink)
	}
	if !ok("SessionStart", false, "a-b_1", true, false, false, false) || !ok("UserPromptSubmit", false, "a", true, false, false, false) {
		t.Error("a main-thread session with a row")
	}
	for _, c := range []bool{ok("Stop", false, "a", true, false, false, false), ok("SessionStart", true, "a", true, false, false, false),
		ok("SessionStart", false, "a.b", true, false, false, false), ok("SessionStart", false, "a", false, false, false, false),
		ok("SessionStart", false, "a", true, true, false, false), ok("SessionStart", false, "a", true, false, true, false),
		ok("SessionStart", false, "a", true, false, false, true)} {
		if c {
			t.Error("a gate that should refuse let a report through")
		}
	}
	if !FreshDue("SessionStart", "clear") || FreshDue("SessionStart", "fork") || FreshDue("UserPromptSubmit", "") {
		t.Error("FreshDue")
	}
	if !LoadsPendDue("p:d", "startup") || !LoadsPendDue("p:d", "resume") || LoadsPendDue("p:d", "clear") || LoadsPendDue("", "startup") {
		t.Error("LoadsPendDue")
	}
	// the stamp is held one long back-off ahead; a pass that has not come, or has no sender's uuid, resends nothing
	if p := NewPass(1_000_000, 3, 1000, "u"); p.After != 31000 || p.On || p.Drop != 3 {
		t.Errorf("%+v", p)
	}
	if p := NewPass(500, 0, 1000, "u"); !p.On || p.After != 500 {
		t.Errorf("%+v", p)
	}
	if p := NewPass(0, 0, 1000, ""); p.On {
		t.Error("no sender's uuid, no resend")
	}
	for rc, on := range map[int]bool{SendTaken: true, SendStale: false, SendNoAnswer: false, SendKept: false, SendNoTime: false, SendRefused: true, SendUnsent: true} {
		p := Pass{On: true}
		p.Fresh(rc)
		if p.On != on {
			t.Errorf("Fresh(%d): on %v", rc, p.On)
		}
	}
	// Resends: each kept report is rewritten, sent and kept by its outcome; a report jq cannot read is dropped; a send
	// that had no time ends the pass for the reports behind it
	var sent []string
	answers := []int{SendStale, SendNoTime}
	p := Pass{On: true}
	p.Resends([]Kept{{0, `{"fromUuid":"a","source":"startup"}`}, {1, `{"fromUuid":"b"}`}, {2, `{"fromUuid":"c"}`}, {3, `[1]`}}, "u", func(j string) int {
		sent = append(sent, j)
		r := answers[0]
		answers = answers[1:]
		return r
	})
	if len(sent) != 2 || p.On || p.Why != 1 || p.Drop != 0 || len(p.Stay) != 4 || p.Stay[3].J != `[1]` {
		t.Errorf("%v %+v", sent, p)
	}
	p = Pass{On: true}
	p.Resends([]Kept{{0, `[1]`}}, "u", func(string) int { t.Error("an unreadable report is not sent"); return SendTaken })
	if p.Drop != 1 || len(p.Stay) != 0 {
		t.Errorf("a report jq cannot read is dropped: %+v", p)
	}
	// a stale answer to a kept startup (another sender's) is a try and the pass goes on
	p = Pass{On: true}
	p.Resends([]Kept{{0, `{"fromUuid":"a","source":"startup"}`}}, "u", func(string) int { return SendStale })
	if !p.On || len(p.Stay) != 1 || p.Stay[0].T != 1 {
		t.Errorf("%+v", p)
	}
	if !HasTimeout(func(n string) bool { return n == "gtimeout" }) || HasTimeout(func(string) bool { return false }) {
		t.Error("HasTimeout")
	}
	if !LoadsDue("Stop", false, true) || LoadsDue("Stop", true, true) || LoadsDue("Stop", false, false) || LoadsDue("PreToolUse", false, true) {
		t.Error("LoadsDue")
	}
	if !LoadsWindowReadable(true, LoadsMaxBytes) || LoadsWindowReadable(true, LoadsMaxBytes+1) || LoadsWindowReadable(false, 1) {
		t.Error("LoadsWindowReadable")
	}
	if LoadsLast("3") != "0" || LoadsLast("4") != "1" || LoadsLast("9") != "1" {
		t.Error("LoadsLast")
	}
	if !SendReady("b", "12") || SendReady("", "12") || SendReady("b", "") || SendReady("b", "1x") {
		t.Error("SendReady")
	}
}
