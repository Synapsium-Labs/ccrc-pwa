package attention

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"ccrc/core/internal/kernel"
	"ccrc/core/internal/kernel/vocab"
)

// Every case of testdata/approval-cases.jsonl against what the bash's own approval code answered for it, cut from
// ccd/session-hook.sh and run with real jq (testdata/gen-approval-golden.sh): the canonical form, the wait's reads of a
// client answer, the transcript watch step by step, the route patch and the drop.
func TestApprovalGolden(t *testing.T) {
	cases, want := readLinesFile(t, "approval-cases.jsonl"), readLinesFile(t, "approval.golden")
	if len(cases) != len(want) {
		t.Fatalf("%d cases, %d golden lines: regenerate", len(cases), len(want))
	}
	for i, line := range cases {
		var c struct {
			Fn, Text, Body, Code, TI, Out, Cur, Word, Aid, At, File string
			Steps                                                   []*string
		}
		if err := json.Unmarshal([]byte(line), &c); err != nil {
			t.Fatal(err)
		}
		var w map[string]any
		if err := json.Unmarshal([]byte(want[i]), &w); err != nil {
			t.Fatal(err)
		}
		got := map[string]any{}
		at, _ := strconv.ParseInt(c.At, 10, 64)
		switch c.Fn {
		case "canon":
			v, err := kernel.JQParseFirst([]byte(strings.TrimRight(c.Text, "\n")))
			s, ok := AprCanon(v)
			if err != nil || !ok {
				s = "none"
			}
			got["canon"] = s
		case "granted":
			rid, waits, pk, ok := AprGranted(c.Body)
			got["ok"] = ok
			if ok {
				got["rid"], got["waits"], got["pk"] = rid, strconv.FormatInt(waits, 10), pk
			}
		case "refused":
			got["route"] = AprRefused(c.Body, c.Code)
		case "ruled":
			r := AprRuled(c.Body)
			got["verdict"], got["j"] = "more", r.J
			if r.Stop {
				got["verdict"] = "stop"
			} else if r.Parked {
				got["verdict"] = "parked"
			}
		case "scan":
			ti, err := kernel.JQParse([]byte(c.TI))
			if err != nil {
				t.Fatal(err)
			}
			wt := AprWatch{TP: "t", TI: ti, Seen: -1}
			steps := []any{}
			for _, s := range c.Steps {
				rc := "1"
				if wt.Look(memFile(s)) {
					rc = "0"
				}
				steps = append(steps, fmt.Sprintf("%s|%s|%d|%d", rc, wt.Tie, wt.Off, wt.Seen))
			}
			got["steps"] = steps
		case "patch":
			cur := unb64(t, c.Cur)
			if nl, ok := RoutePatch(cur, []byte(c.Out), c.Word, c.Aid, at); ok {
				cur = append(nl, '\n')
			}
			got["file"] = base64.StdEncoding.EncodeToString(cur)
		case "drop":
			f := unb64(t, c.File)
			if nl, ok := ApprovalsDrop(f, c.Aid, at); ok {
				f = append(nl, '\n')
			}
			got["file"] = base64.StdEncoding.EncodeToString(f)
		default:
			t.Fatalf("case %d: no fn %q", i+1, c.Fn)
		}
		if !reflect.DeepEqual(got, w) {
			t.Errorf("case %d (%s): got %v\nwant %v", i+1, c.Fn, got, w)
		}
	}
}

func unb64(t *testing.T, s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// memFile is a transcript step: its bytes, or (nil) no file.
func memFile(s *string) TranscriptReads {
	var b []byte
	if s != nil {
		b, _ = base64.StdEncoding.DecodeString(*s)
	}
	return TranscriptReads{
		Size: func() (int64, bool) { return int64(len(b)), s != nil },
		Last: func() ([]byte, bool) {
			if s == nil {
				return nil, false
			}
			return b[max(0, len(b)-1):], true
		},
		Range: func(off, n int64) ([]byte, bool) {
			if s == nil {
				return nil, false
			}
			return b[min(off, int64(len(b))):min(off+n, int64(len(b)))], true
		},
	}
}

// The goldens are as current as the text they were measured from: the approval functions and constants, cut from
// ccd/session-hook.sh as gen-approval-golden.sh cuts them, are pinned beside them.
func TestApprovalProgramPinned(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "ccd", "session-hook.sh"))
	if err != nil {
		t.Fatal(err)
	}
	s := "\n" + strings.ReplaceAll(string(src), "\r\n", "\n")
	var b strings.Builder
	for _, n := range []string{"_apr_deny_history", "_hook_approval_gate", "_apr_park_print", "_apr_call", "_apr_scan",
		"_hook_approval_route_patch", "_hook_approvals_drop", "_hook_approval_wait"} {
		i := strings.Index(s, "\n"+n+"() {")
		if i < 0 {
			t.Fatalf("ccd/session-hook.sh defines no %s", n)
		}
		body := s[i+1:]
		b.WriteString(body[:strings.Index(body, "\n}\n")+3])
	}
	for _, n := range []string{"APPROVAL_REQUEST_MAX_BYTES", "APPROVAL_DIGEST_JQ", "APPROVAL_HOOK_WAIT_S", "APPROVAL_HOOK_STOP_STATES", "APPROVAL_PARK_DENY_TAIL"} {
		i := strings.Index(s, "\n"+n+"=")
		if i < 0 {
			t.Fatalf("ccd/session-hook.sh assigns no %s", n)
		}
		line, _, _ := strings.Cut(s[i+1:], "\n")
		b.WriteString(line + "\n")
	}
	got := fmt.Sprintf("%x", sha256.Sum256([]byte(b.String())))
	if want := strings.TrimSpace(readLinesFile(t, "approval-program.sha256")[0]); got != want {
		t.Errorf("the bash's approval code changed (sha256 %s, the goldens were measured from %s): run testdata/gen-approval-golden.sh with real jq and make attention's approval deciders match", got, want)
	}
	// the park deny's tail is the bash's own text (shared/approval-park.ts holds the bash's copy)
	if i := strings.Index(s, "\nAPPROVAL_PARK_DENY_TAIL=\""); i < 0 || !strings.HasPrefix(s[i+len("\nAPPROVAL_PARK_DENY_TAIL=\""):], ParkDenyTail+"\"\n") {
		t.Error("ParkDenyTail is not the bash's APPROVAL_PARK_DENY_TAIL")
	}
}

// gateReads is a ladder whose every gate opens: a child, no kill switch, a current stamp, the tools, files and a nonce.
func gateReads(deny []byte) *AprReads {
	sum := sha256.Sum256(deny)
	return &AprReads{
		Child: func() bool { return true }, Disabled: func() bool { return false },
		Stamp:    func() ([]byte, int) { return []byte(hex.EncodeToString(sum[:]) + "\n"), 0 },
		UUID:     func() ([]byte, int) { return []byte("00000000-0000-4000-8000-0000000000aa\n"), 0 },
		Managed:  func() ([]byte, bool) { return deny, true },
		History:  func() ([]byte, bool) { return nil, false },
		Found:    func(string) bool { return true },
		Verifier: func() bool { return true }, Key: func() bool { return true }, Client: func() bool { return true },
		Nonce: func() (string, bool) { return strings.Repeat("ab", 16), true },
	}
}

// Each gate of the ladder, in its order: the first that stops the prompt names the route, and nothing is built to send.
func TestApprovalGateLadder(t *testing.T) {
	deny := []byte(`{"permissions":{"deny":["Bash(ccd ws-rm:*)"]}}` + "\n")
	old := strings.Repeat("c", 64)
	payload := func(cmd string) string {
		return `{"session_id":"s","tool_name":"Bash","cwd":"/w","tool_input":{"command":` + strconv.Quote(cmd) + `}}`
	}
	cases := []struct {
		route string
		edit  func(r *AprReads)
		cmd   string
	}{
		{"not-a-child", func(r *AprReads) { r.Child = func() bool { return false } }, "ls"},
		{"kill-switch", func(r *AprReads) { r.Disabled = func() bool { return true } }, "ls"},
		{"deny-unreadable", func(r *AprReads) { r.Stamp = func() ([]byte, int) { return nil, 1 } }, "ls"},
		{"deny-unreadable", func(r *AprReads) { r.Stamp = func() ([]byte, int) { return []byte("not-a-digest"), 0 } }, "ls"},
		{"deny-unreadable", func(r *AprReads) { r.Managed = func() ([]byte, bool) { return nil, false } }, "ls"},
		// `_apr_sha256` has neither shasum nor node to run: the stamp cannot be compared
		{"deny-unreadable", func(r *AprReads) { r.Found = func(string) bool { return false } }, "ls"},
		{"deny-unknown", func(r *AprReads) { r.Stamp = func() ([]byte, int) { return []byte(old), 0 } }, "ls"},
		{"deny-unknown", func(r *AprReads) {
			r.Stamp = func() ([]byte, int) { return []byte(old), 0 }
			r.History = func() ([]byte, bool) { return []byte(old + "  1700000000000\n" + strings.ToUpper(old) + " 1\n"), true }
		}, "ls"},
		{"no-node", func(r *AprReads) { r.Found = func(n string) bool { return n == "shasum" } }, "ls"},
		{"no-verifier", func(r *AprReads) { r.Verifier = func() bool { return false } }, "ls"},
		{"no-key", func(r *AprReads) { r.Key = func() bool { return false } }, "ls"},
		{"no-client", func(r *AprReads) { r.Client = func() bool { return false } }, "ls"},
		{"no-uuid", func(r *AprReads) { r.UUID = func() ([]byte, int) { return nil, 2 } }, "ls"},
		{"no-uuid", func(r *AprReads) { r.UUID = func() ([]byte, int) { return []byte("a b"), 0 } }, "ls"},
		{"forbidden", func(r *AprReads) {}, "ccd ws-rm project-a-old"},
		{"nonce-failed", func(r *AprReads) { r.Nonce = func() (string, bool) { return "", false } }, "ls"},
		{"nonce-failed", func(r *AprReads) { r.Nonce = func() (string, bool) { return strings.Repeat("AB", 16), true } }, "ls"},
		{"sent", func(r *AprReads) {}, "ls"},
		{"sent", func(r *AprReads) {
			r.Stamp = func() ([]byte, int) { return []byte(" " + old + "\n"), 0 }
			r.History = func() ([]byte, bool) { return []byte("x\n" + old + " 1700000000000"), true }
		}, "ls"},
	}
	for _, c := range cases {
		r := gateReads(deny)
		c.edit(r)
		g := ApprovalGate(payload(c.cmd), "lane-a-project-a", "/home/x", true, *r)
		if g.Route != c.route {
			t.Errorf("%s case: got %q", c.route, g.Route)
			continue
		}
		if (c.route == "sent") != (g.Body != nil) {
			t.Errorf("%s case: a request built is %v", c.route, g.Body != nil)
		}
	}
	// What follows the payload's one value: blanks are nothing to jq; anything else makes jq exit 2 after reading the value,
	// so the forbidden match could not run (fail closed). D-TBD-go-hook-apr-one-value: a second whole value is refused here
	// too, where the bash runs each program per value and sends a two-line canonical form.
	for tail, want := range map[string]string{" garbage": "forbidden", "}": "forbidden", `{"tool_name":"Bash"}`: "forbidden",
		" \n\t\r ": "sent"} {
		if g := ApprovalGate(payload("ls")+tail, "lane-a-project-a", "/home/x", true, *gateReads(deny)); g.Route != want {
			t.Errorf("a payload then %q: %q, want %q", tail, g.Route, want)
		}
	}
	// a non-integer anywhere in the input has no canonical form
	if g := ApprovalGate(`{"tool_name":"Bash","tool_input":{"timeout":1.5}}`, "lane-a-project-a", "/h", true, *gateReads(deny)); g.Route != "canonical-failed" {
		t.Errorf("a non-integer: %q", g.Route)
	}
}

// The request: v1, the session, its uuid, the canonical string (or `truncated` past APPROVAL_REQUEST_MAX_BYTES), its
// sha256, the nonce, and denyDigest only for a stamp the history names.
func TestApprovalGateRequest(t *testing.T) {
	deny := []byte("{}\n")
	text := `{"session_id":"s","tool_name":"Bash","cwd":"/w","tool_input":{"command":"ls"}}`
	v, _ := kernel.JQParse([]byte(text))
	g := ApprovalGate(text, "lane-a-project-a", "/h", true, *gateReads(deny))
	canon, _ := AprCanon(v)
	d := sha256.Sum256([]byte(canon))
	want := `{"v":1,"sessionId":"lane-a-project-a","sessionUuid":"00000000-0000-4000-8000-0000000000aa","canonical":` +
		string(kernel.JQCompact(canon)) + `,"digest":"` + hex.EncodeToString(d[:]) + `","nonce":"` + strings.Repeat("ab", 16) + `"}`
	if string(g.Body) != want {
		t.Errorf("body\n got %s\nwant %s", g.Body, want)
	}
	old := strings.Repeat("c", 64)
	r := gateReads(deny)
	r.Stamp = func() ([]byte, int) { return []byte(old), 0 }
	r.History = func() ([]byte, bool) { return []byte(old + " 1700000000000\n"), true }
	big := `{"session_id":"s","tool_name":"Bash","cwd":"/w","tool_input":{"command":"` + strings.Repeat("a", vocab.ApprovalRequestMaxBytes) + `"}}`
	g = ApprovalGate(big, "lane-a-project-a", "/h", true, *r)
	if !strings.Contains(string(g.Body), `"truncated":true,"digest":`) || !strings.HasSuffix(string(g.Body), `,"denyDigest":"`+old+`"}`) || g.Dd != old {
		t.Errorf("truncated history request: %s", g.Body)
	}
}

// The knobs only shorten or speed up the wait: a value not of the shape is the default, and the ceiling is read as shell
// arithmetic reads it.
func TestApprovalKnobs(t *testing.T) {
	for v, want := range map[string]time.Duration{"": 500 * time.Millisecond, "0.05": 50 * time.Millisecond, "0.04": 50 * time.Millisecond,
		"0.001": 50 * time.Millisecond, "0.049": 50 * time.Millisecond, "0.0": 0, "0.123": 123 * time.Millisecond, "0.1": 100 * time.Millisecond,
		"9": 9 * time.Second, "10": 500 * time.Millisecond, "1.5": 500 * time.Millisecond, "0.1234": 500 * time.Millisecond, " 1": 500 * time.Millisecond} {
		if got := AprTick(v); got != want {
			t.Errorf("tick %q: %v, want %v", v, got, want)
		}
	}
	for v, want := range map[string]int{"": 4, "1": 1, "9": 9, "0": 4, "10": 4, "x": 4} {
		if got := AprPoll(v); got != want {
			t.Errorf("poll %q: %d, want %d", v, got, want)
		}
	}
	for v, want := range map[string]int64{"": 540, "4": 4, "539": 539, "540": 540, "999": 540, "1000": 540, "010": 8, "08": 540, "0": 0, "00": 0, "-1": 540} {
		if got := AprCeil(v); got != want {
			t.Errorf("ceiling %q: %d, want %d", v, got, want)
		}
	}
	if AprWindowMs(4, 1) != 1000 || AprWindowMs(1, 100) != 1000 {
		t.Error("the window is the request's waitS, never past the ceiling")
	}
}

// The verifier's line: an allow prints only for a current stamp or as the operator's; a deny names its ruler; any other
// line goes on waiting.
func TestApprovalVerdict(t *testing.T) {
	allow := `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
	deny := func(m string) string {
		return `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"` + m + `"}}}`
	}
	for _, c := range []struct {
		verdict, dd, out string
		end              bool
	}{
		{"allow ok", "", allow, true},
		{"allow ok", "c", "", true},
		{"allow:operator ok", "c", allow, true},
		{"deny not here", "", deny("denied by your coordinator: not here"), true},
		{"deny not here", "c", deny("denied by your coordinator: not here"), true},
		{"deny:operator r", "", deny("denied by the operator: r"), true},
		{"deny:overlord r s", "", deny("denied by the Overlord: r s"), true},
		{"allow:overlord x", "", "", false},
		{"deny:foo x", "", "", false},
		{"allow:operatorx y", "", "", false},
		{"allow", "", "", false},
		{"", "", "", false},
	} {
		out, end := AprVerdict(c.verdict, c.dd)
		if string(out) != c.out || end != c.end {
			t.Errorf("%q (dd %q): %s %v", c.verdict, c.dd, out, end)
		}
	}
	if got := string(AprParkDeny("41")); got != deny("approval 41 "+ParkDenyTail) {
		t.Errorf("park deny: %s", got)
	}
}

// The client's merged output: the code after the last `http `, the body before it.
func TestApprovalAnswer(t *testing.T) {
	for out, want := range map[string][3]string{
		`{"id":41}http 201`:        {`{"id":41}`, "201", "ok"},
		"body http 2 http 409":     {"body http 2 ", "409", "ok"},
		"201":                      {"201", "201", "ok"},
		`{"id":41}http 20`:         {"", "", ""},
		"http 201\nx":              {"", "", ""},
		`{"id":41}` + "\nhttp 404": {"{\"id\":41}\n", "404", "ok"},
	} {
		b, c, ok := AprAnswer(out)
		if got := [3]string{b, c, map[bool]string{true: "ok"}[ok]}; got != want {
			t.Errorf("%q: %q", out, got)
		}
	}
}

// The transcript the request lives in.
func TestApprovalTranscript(t *testing.T) {
	v, _ := kernel.JQParse([]byte(`{"transcript_path":"/c/p/main.jsonl"}`))
	for _, c := range []struct {
		paid      bool
		aid, psid string
		want      string
	}{
		{false, "", "", "/c/p/main.jsonl"},
		{true, "a1", "sid-1", "/c/p/sid-1/subagents/agent-a1.jsonl"},
		{true, "", "sid-1", ""},
		{true, "a1", "sid_1", ""},
	} {
		if got := AprTranscript(v, c.paid, c.aid, c.psid); got != c.want {
			t.Errorf("%+v: %q", c, got)
		}
	}
	for _, tp := range []string{`"rel/x.jsonl"`, `5`, `"/a\nb"`, `null`} {
		v, _ := kernel.JQParse([]byte(`{"transcript_path":` + tp + `}`))
		if got := AprTranscript(v, false, "", ""); got != "" {
			t.Errorf("%s: %q", tp, got)
		}
	}
	v, _ = kernel.JQParse([]byte(`{"transcript_path":"/x\n\n"}`))
	if got := AprTranscript(v, false, "", ""); got != "/x" {
		t.Errorf("trailing newlines: %q", got)
	}
}
