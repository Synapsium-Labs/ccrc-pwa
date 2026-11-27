package attention

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"time"

	"ccrc/core/internal/kernel"
	"ccrc/core/internal/kernel/vocab"
)

// The approval gate (tail stage 16) and the approval wait (tail stage 22) of ccd/session-hook.sh: THE APPROVAL GATE
// above the hookstate write, THE APPROVAL WAIT after it. Every word, line, window and envelope is decided here; app/hook
// reads the files, runs the client and the verifier, sleeps the ticks and writes.

// ParkDenyTail is APPROVAL_PARK_DENY_TAIL, the text after `approval <n> ` in the park deny
// (shared/approval-park.ts#approvalParkDenyText, held equal by session-hook-approval-park's both-mode cases).
const ParkDenyTail = "is parked for a ruling. Do not run this command again now: wait for the mail that says it was ruled, then run the same command again, unchanged."

// aprIntMax is APPROVAL_DIGEST_JQ's integer bound, 2^53 - 1.
const aprIntMax = 9007199254740991

var (
	aprDigestRE  = re(`^[0-9a-f]{64}$`)
	aprHistoryRE = re(`^([0-9a-f]{64}) [0-9]{1,16}$`)
	aprUUIDRE    = re(`^[A-Za-z0-9_-]+$`)
	aprNonceRE   = re(`^[0-9a-f]{32}$`)
	aprTickRE    = re(`^(0\.[0-9]{1,3}|[1-9])$`)
	aprPollRE    = re(`^[1-9]$`)
	aprCeilRE    = re(`^[0-9]{1,3}$`)
	aprCodeRE    = re(`^[0-9]{3}$`)
	aprWordRE    = re(`^[a-z][a-z0-9-]{0,47}$`)
	aprRidRE     = re(`^[0-9]{1,15}$`)
	aprWaitsRE   = re(`^[0-9]{1,6}$`)
	aprPsidRE    = re(`^[A-Za-z0-9-]{1,64}$`)
	aprTieRE     = re(`^[A-Za-z0-9_-]{1,128}$`)
)

// AprReads are the gate's observations, each asked only when the ladder reaches it, as the bash asks it.
type AprReads struct {
	Child, Disabled func() bool           // `-e $REG/<id>.child`, `-e $REG/approvals-disabled`
	Stamp, UUID     func() ([]byte, int)  // `_ct_read` of $REG/<id>.deny-settings and of $REG/<id>.uuid
	Managed         func() ([]byte, bool) // $REG/child-deny.settings.json: `-f && ! -L`, and its bytes (false: not that, or unreadable)
	History         func() ([]byte, bool) // $REG/child-deny.digests: `-f && ! -L && -r`, and its bytes
	Found           func(string) bool     // `command -v`
	Verifier, Key   func() bool           // `-f $REG/approval-verify.mjs`, `-f ~/.ccrc/approval-signing.pub`
	Client          func() bool           // `-x ~/.local/bin/ccrc-api`
	Nonce           func() (string, bool) // 16 random bytes as hex (the bash's `od -An -tx1 -N16 /dev/urandom`)
}

// AprGate is `_hook_approval_gate`'s answer: the route word the write stores, and on `sent` the request.
type AprGate struct {
	Route         string
	Digest, Nonce string
	Dd            string // the history's digest the request carries as denyDigest ("" when the stamp is current)
	Body          []byte // the request (`apr_body`), without the newline `<<<` adds
	TI            any    // `.tool_input // null`, what the watch ties a tool_use by
}

// ApprovalGate is `_hook_approval_gate` over the payload's text (what `payload=$(cat)` holds): the first gate that stops
// the prompt names the route, else `sent` and the request. utf says how `_ct_read` counts; home is jq's `$ENV.HOME` for
// the forbidden match.
func ApprovalGate(payload, id, home string, utf bool, rd AprReads) AprGate {
	stop := func(w string) AprGate { return AprGate{Route: w} }
	if id == "" || !rd.Child() {
		return stop("not-a-child")
	}
	if rd.Disabled() {
		return stop("kill-switch")
	}
	b, rc := rd.Stamp()
	if rc != 0 {
		return stop("deny-unreadable")
	}
	sum, _ := ctRead(b, utf)
	if !aprDigestRE().MatchString(sum) {
		return stop("deny-unreadable")
	}
	managed, ok := rd.Managed()
	// `_apr_sha256` answers rc 1 with neither shasum nor node to run; Go hashes natively, but keeps the word.
	if !ok || !rd.Found("shasum") && !rd.Found("node") {
		return stop("deny-unreadable")
	}
	dd := ""
	if h := sha256.Sum256(managed); hex.EncodeToString(h[:]) != sum {
		if !aprInHistory(rd.History, sum) {
			return stop("deny-unknown")
		}
		dd = sum
	}
	switch {
	case !rd.Found("node"):
		return stop("no-node")
	case !rd.Verifier():
		return stop("no-verifier")
	case !rd.Key():
		return stop("no-key")
	case !rd.Client():
		return stop("no-client")
	}
	b, rc = rd.UUID()
	if rc != 0 {
		return stop("no-uuid")
	}
	uuid, _ := ctRead(b, utf)
	if !aprUUIDRE().MatchString(uuid) {
		return stop("no-uuid")
	}
	// A forbidden match that could not run reads as a match (fail closed): nothing is sent either way. The bash's jq runs
	// over the whole text, so a value followed by anything but blanks (jq reads it, then exits 2 at what follows) is
	// `forbidden` there too. D-TBD-go-hook-apr-one-value: two whole values are `forbidden` here as well, where the bash
	// runs each program per value and sends a two-line canonical form (stricter: such a request is never sent). The
	// shape is the payload parse's word (Task 7b), not a second check.
	ps, _ := ParsePayload(payload)
	if ps.Shape != ShapeOne {
		return stop("forbidden")
	}
	v := ps.Values[0]
	if fb, ok := Forbidden(v, "class", nil, &home); !ok || cmdSubst(fb+"\n") != "" {
		return stop("forbidden")
	}
	canon, ok := AprCanon(v)
	if !ok {
		return stop("canonical-failed")
	}
	d := sha256.Sum256([]byte(canon))
	g := AprGate{Digest: hex.EncodeToString(d[:]), Dd: dd, TI: or(get(v, "tool_input"), nil)}
	if g.Nonce, ok = rd.Nonce(); !ok || !aprNonceRE().MatchString(g.Nonce) {
		return stop("nonce-failed")
	}
	o := kernel.Obj{{K: "v", V: 1}, {K: "sessionId", V: id}, {K: "sessionUuid", V: uuid}}
	if len(canon) > vocab.ApprovalRequestMaxBytes { // `-a` keeps it ASCII, so jq's length is its byte count
		o = append(o, kernel.KV{K: "truncated", V: true})
	} else {
		o = append(o, kernel.KV{K: "canonical", V: canon})
	}
	o = append(o, kernel.KV{K: "digest", V: g.Digest}, kernel.KV{K: "nonce", V: g.Nonce})
	if dd != "" {
		o = append(o, kernel.KV{K: "denyDigest", V: dd})
	}
	g.Body, g.Route = kernel.JQCompact(o), "sent"
	return g
}

// aprInHistory is `_apr_deny_history <sum>`: a line of exactly `<digest> <epoch ms>` names it.
func aprInHistory(read func() ([]byte, bool), sum string) bool {
	b, ok := read()
	if !ok {
		return false
	}
	for _, l := range strings.Split(strings.ReplaceAll(string(b), "\x00", ""), "\n") { // `read` drops NUL bytes
		if m := aprHistoryRE().FindStringSubmatch(l); m != nil && m[1] == sum {
			return true
		}
	}
	return false
}

// AprCanon is `jq -cSa "$APPROVAL_DIGEST_JQ"`: every number an integer of magnitude at most 2^53-1 (-0 as 0, each one
// computed by floor, as jq prints a computed number), else no canonical form; then [session_id, agent_id // "",
// tool_name, cwd, tool_input], keys sorted, ASCII only.
func AprCanon(v any) (string, bool) {
	w, ok := aprWalk(v)
	if !ok {
		return "", false
	}
	row := []any{}
	for _, k := range []string{"session_id", "agent_id", "tool_name", "cwd", "tool_input"} {
		x, err := index(w, k)
		if err != nil {
			return "", false
		}
		if k == "agent_id" {
			x = or(x, "")
		}
		row = append(row, x)
	}
	return string(kernel.JQCompactSortedASCII(row)), true
}

func aprWalk(v any) (any, bool) {
	switch x := v.(type) {
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			var ok bool
			if out[i], ok = aprWalk(e); !ok {
				return nil, false
			}
		}
		return out, true
	case kernel.Obj:
		out := make(kernel.Obj, len(x))
		for i, kv := range x {
			w, ok := aprWalk(kv.V)
			if !ok {
				return nil, false
			}
			out[i] = kernel.KV{K: kv.K, V: w}
		}
		return out, true
	case nil, bool, string:
		return v, true
	}
	f, ok := num(v)
	if !ok || f != math.Floor(f) || math.Abs(f) > aprIntMax {
		return nil, false // error("non-integer")
	}
	return int64(f), true // `if . == 0 then 0 else floor end`: -0 is 0, and floor's double prints as this integer
}

// AprTick is the tick, `CCRC_APPROVAL_TICK_S` when it has the shape (0.5 s, never under 0.05 s by the shape's floor).
func AprTick(v string) time.Duration {
	t := "0.5"
	if aprTickRE().MatchString(v) {
		t = v
	}
	if len(t) > 3 && strings.HasPrefix(t, "0.0") && t[3] <= '4' { // `^0\.0[0-4]`; "0.0" itself sleeps 0
		t = "0.05"
	}
	if len(t) == 1 {
		return time.Duration(t[0]-'0') * time.Second
	}
	ms, _ := strconv.Atoi((t[2:] + "00")[:3])
	return time.Duration(ms) * time.Millisecond
}

// AprPoll is the ticks between two ruling reads, `CCRC_APPROVAL_POLL_TICKS` when it is one digit 1 to 9 (4).
func AprPoll(v string) int {
	if aprPollRE().MatchString(v) {
		return int(v[0] - '0')
	}
	return 4
}

// AprCeil is the wait's ceiling in seconds: APPROVAL_HOOK_WAIT_S, or `CCRC_APPROVAL_CEILING_S` when it is up to three
// digits below it. The knob only shortens. It is read as shell arithmetic reads it: a leading 0 is octal, and an 8 or 9
// there is an arithmetic error, so the comparison fails and the ceiling stands.
func AprCeil(v string) int64 {
	ceil := int64(vocab.ApprovalHookWaitS)
	if aprCeilRE().MatchString(v) {
		base := 10
		if len(v) > 1 && v[0] == '0' {
			base = 8
		}
		if n, err := strconv.ParseInt(v, base, 64); err == nil && n < ceil {
			ceil = n
		}
	}
	return ceil
}

// AprWindowMs is the wait's length: the request's waitS, never past the ceiling.
func AprWindowMs(ceil, waits int64) int64 { return min(ceil, waits) * 1000 }

// AprAnswer is `_apr_call`'s reading of the client's merged output (what `$( )` keeps) when it exited 0: the code after
// the last `http `, the body before it; false where the code is not three digits (no answer).
func AprAnswer(out string) (body, code string, ok bool) {
	body, code = out, out
	if i := strings.LastIndex(out, "http "); i >= 0 {
		body, code = out[:i], out[i+5:]
	}
	if !aprCodeRE().MatchString(code) {
		return "", "", false
	}
	return body, code, true
}

// jqEach is `jq -r <prog> <<<text`: f over each input in turn, each output a line, then what `$( )` keeps; ok false
// where jq exits non-zero (an input that does not parse stops it, an error in f goes on to the next input, as jq does).
func jqEach(text string, f func(any) ([]string, error)) (string, bool) {
	vs, perr := kernel.JQParseAll([]byte(text))
	var b strings.Builder
	ok := perr == nil
	for _, v := range vs {
		outs, err := f(v)
		if err != nil {
			ok = false
			continue
		}
		for _, o := range outs {
			b.WriteString(o)
			b.WriteByte('\n')
		}
	}
	return b.String(), ok
}

// field is `.k // d | tostring` as one output.
func field(k string, d any) func(any) ([]string, error) {
	return func(v any) ([]string, error) {
		x, err := index(v, k)
		if err != nil {
			return nil, err
		}
		return []string{tostring(or(x, d))}, nil
	}
}

// AprRefused is the route a request answered with anything but 201 is patched to: `request-refused:<word>`, the
// refusal's own `error` when it is a kebab word, else `http-<code>`.
func AprRefused(body, code string) string {
	w, ok := jqEach(body, field("error", ""))
	if w = cmdSubst(w); !ok || !aprWordRE().MatchString(w) {
		w = "http-" + code
	}
	return "request-refused:" + w
}

// AprGranted reads a 201: the row id and waitS (positive integers, as jq's tostring spells them, held to the bash's
// shapes) and the first line of a string `park`; ok false where the hook cannot read it (`request-failed`).
func AprGranted(body string) (rid string, waits int64, park string, ok bool) {
	pos := func(x any) string {
		if f, isNum := num(x); isNum && f == math.Floor(f) && f > 0 {
			return tostring(x)
		}
		return ""
	}
	out, _ := jqEach(body, func(v any) ([]string, error) {
		id, err := index(v, "id")
		if err != nil {
			return nil, err
		}
		p, _ := get(v, "park").(string)
		return []string{pos(id), pos(get(v, "waitS")), p}, nil
	})
	// `read -r rid; read -r waits; IFS= read -r pk`: lines, the first two trimmed of the IFS blanks, NUL bytes dropped
	l := strings.Split(strings.ReplaceAll(out, "\x00", ""), "\n")
	line := func(i int) string {
		if i < len(l) {
			return l[i]
		}
		return ""
	}
	rid, w := strings.Trim(line(0), " \t"), strings.Trim(line(1), " \t")
	if !aprRidRE().MatchString(rid) || !aprWaitsRE().MatchString(w) {
		return "", 0, "", false
	}
	waits, _ = strconv.ParseInt(w, 10, 64)
	return rid, waits, line(2), true
}

// AprTranscript is the transcript the request lives in: the payload's absolute, one-line transcript_path, or for a
// subagent `<its directory>/<session_id>/subagents/agent-<agent_id>.jsonl`; "" when there is none to watch.
func AprTranscript(v any, paid bool, aid, psid string) string {
	tp := cmdSubst(tostring(or(get(v, "transcript_path"), "")) + "\n")
	if !strings.HasPrefix(tp, "/") || strings.Contains(tp, "\n") {
		return ""
	}
	if paid {
		if aid == "" || !aprPsidRE().MatchString(psid) {
			return ""
		}
		tp = tp[:strings.LastIndex(tp, "/")] + "/" + psid + "/subagents/agent-" + aid + ".jsonl" // `${apr_tp%/*}`
	}
	return tp
}

// AprRuling is a 200 from the ruling read: Stop for a stop state (APPROVAL_HOOK_STOP_STATES), Parked for `parked`, and
// J, the ruling the verifier reads (`jq -c '.ruling // empty'`), "" for none.
type AprRuling struct {
	Stop, Parked bool
	J            string
}

// AprRuled reads a 200 from `approvals ruling`.
func AprRuled(body string) AprRuling {
	state, ok := jqEach(body, field("state", ""))
	if state = cmdSubst(state); !ok {
		state = ""
	}
	for _, s := range vocab.ApprovalHookStopStates {
		if state == s {
			return AprRuling{Stop: true}
		}
	}
	if state == "parked" {
		return AprRuling{Parked: true}
	}
	j, ok := jqEach(body, func(v any) ([]string, error) {
		r, err := index(v, "ruling")
		if err != nil || !truthy(r) {
			return nil, err
		}
		return []string{string(kernel.JQCompact(r))}, nil
	})
	if !ok {
		return AprRuling{}
	}
	return AprRuling{J: cmdSubst(j)}
}

// AprVerdict reads the verifier's line: the envelope to print and true where the wait ends on it, false to go on (an
// unknown line). An allow prints only for a current deny stamp, or as the operator's (v2) allow; a deny names its ruler.
func AprVerdict(verdict, dd string) ([]byte, bool) {
	who, reason := verdict, verdict // `${verdict%% *}`, `${verdict#* }`
	if i := strings.IndexByte(verdict, ' '); i >= 0 {
		who, reason = verdict[:i], verdict[i+1:]
	}
	switch {
	case strings.HasPrefix(verdict, "allow ") || strings.HasPrefix(verdict, "allow:operator "):
		if dd != "" && who != "allow:operator" {
			return nil, true
		}
		return aprDecision(kernel.Obj{{K: "behavior", V: "allow"}}), true
	case strings.HasPrefix(verdict, "deny ") || strings.HasPrefix(verdict, "deny:operator ") || strings.HasPrefix(verdict, "deny:overlord "):
		switch who {
		case "deny:operator":
			who = "the operator"
		case "deny:overlord":
			who = "the Overlord"
		default:
			who = "your coordinator"
		}
		return aprDeny("denied by " + who + ": " + reason), true
	}
	return nil, false
}

// AprParkDeny is `_apr_park_print <row id>`'s envelope.
func AprParkDeny(rid string) []byte { return aprDeny("approval " + rid + " " + ParkDenyTail) }

func aprDeny(m string) []byte {
	return aprDecision(kernel.Obj{{K: "behavior", V: "deny"}, {K: "message", V: m}})
}

func aprDecision(d kernel.Obj) []byte {
	return kernel.JQCompact(kernel.Obj{{K: "hookSpecificOutput", V: kernel.Obj{{K: "hookEventName", V: "PermissionRequest"}, {K: "decision", V: d}}}})
}

// TranscriptReads are the watch's reads of the transcript, each failing as its shell command fails.
type TranscriptReads struct {
	Size  func() (int64, bool)              // `[[ -f p && ! -L p ]]`, then `wc -c < p`
	Last  func() ([]byte, bool)             // `tail -c 1 p`
	Range func(off, n int64) ([]byte, bool) // at most n bytes from off (`head -c n p`, `tail -c +<off+1> p | head -c n`)
}

// AprWatch is `_apr_scan`'s state: Tie is "" until tied, "-" once given up (ambiguous or unreadable), else the
// tool_use id; Off the bytes already read past the tie; Seen the size last looked at for a tie (-1: none).
type AprWatch struct {
	TP   string // the transcript ("" for none)
	TI   any    // the request's tool_input
	Tie  string
	Off  int64
	Seen int64
}

// Look is one `_apr_scan`: true when the transcript shows this request resolved (its tie's tool_result).
func (w *AprWatch) Look(f TranscriptReads) bool {
	if w.Tie == "-" || w.TP == "" {
		return false
	}
	size, ok := f.Size()
	if !ok {
		return false
	}
	if w.Tie == "" {
		if size <= 0 || size == w.Seen {
			return false
		}
		w.Seen = size
		// Only a file that ends at a line boundary is read for the tie, so the offset the watch starts from is one.
		if last, _ := f.Last(); string(last) != "\n" {
			w.Seen = -1
			return false
		}
		data, ok := f.Range(0, size)
		if !ok {
			return false
		}
		uids, rids := "", " "
		for _, line := range strings.Split(cmdSubst(aprTieLines(data, w.TI)), "\n") {
			switch {
			case strings.HasPrefix(line, "U "):
				uids += line[2:] + " "
			case strings.HasPrefix(line, "R "):
				rids += line[2:] + " "
			}
		}
		n := 0
		// shortcut: `for u in $uids` word-splits on the IFS blanks and also globs an id against the hook's cwd; Go does
		// not glob (D-TBD-go-hook-apr-tie-glob), and the tie's own shape check refuses every glob character after it.
		for _, u := range strings.FieldsFunc(uids, func(r rune) bool { return r == ' ' || r == '\t' || r == '\n' }) {
			if !strings.Contains(rids, " "+u+" ") {
				n++
				w.Tie = u
			}
		}
		switch {
		case n == 0:
			w.Tie = ""
		case n > 1, !aprTieRE().MatchString(w.Tie):
			w.Tie = "-"
		default:
			w.Off = size
		}
		return false
	}
	if size <= w.Off {
		return false
	}
	b, _ := f.Range(w.Off, size-w.Off)
	chunk := strings.ReplaceAll(string(b), "\x00", "") // `$( )` drops NUL bytes before the offset is counted
	rest := chunk[strings.LastIndex(chunk, "\n")+1:]
	n := len(chunk) - len(rest)
	if n <= 0 {
		return false
	}
	w.Off += int64(n)
	if !strings.Contains(chunk, w.Tie) {
		return false
	}
	return strings.Contains(aprResultLines(chunk[:n], w.Tie), "R")
}

// aprRows is `jq -R` over text's lines, each `(fromjson? // empty) | select(type == "object") | (.message.content? //
// empty) | arrays | .[] | select(type == "object")`: the transcript rows' content items, in order.
func aprRows(text []byte, each func(item kernel.Obj)) {
	lines := strings.Split(string(text), "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	for _, l := range lines {
		v, err := kernel.JQParse([]byte(kernel.JQRepair([]byte(l)))) // -R reads each line as a string, made UTF-8
		if err != nil {
			continue
		}
		if _, ok := v.(kernel.Obj); !ok {
			continue
		}
		c, ok := get(v, "message", "content").([]any)
		if !ok {
			continue
		}
		for _, e := range c {
			if o, ok := e.(kernel.Obj); ok {
				each(o)
			}
		}
	}
}

// aprTieLines is the tie's jq: `U <id>` for each tool_use with this request's input (for a Bash call, the same
// command), `R <tool_use_id>` for each tool_result.
func aprTieLines(text []byte, ti any) string {
	var b strings.Builder
	tiObj, isObj := ti.(kernel.Obj)
	byCmd := isObj && has(tiObj, "command")
	aprRows(text, func(o kernel.Obj) {
		switch t := get(o, "type"); {
		case equal(t, "tool_use"):
			in := get(o, "input")
			_, inObj := in.(kernel.Obj)
			if byCmd && inObj && equal(get(in, "command"), get(tiObj, "command")) || !byCmd && equal(in, ti) {
				b.WriteString("U " + tostring(get(o, "id")) + "\n")
			}
		case equal(t, "tool_result"):
			b.WriteString("R " + tostring(get(o, "tool_use_id")) + "\n")
		}
	})
	return b.String()
}

// aprResultLines is the watch's jq over the complete lines read past the tie: `R` for each tool_result naming it.
func aprResultLines(text, tie string) string {
	var b strings.Builder
	aprRows([]byte(text), func(o kernel.Obj) {
		if equal(get(o, "type"), "tool_result") && equal(get(o, "tool_use_id"), tie) {
			b.WriteString("R\n")
		}
	})
	return b.String()
}

// aprEntry is `.agentId == $a and .at == $t` over one approvals entry (an error on an entry jq cannot index).
func aprEntry(e any, aid string, at int64) (bool, error) {
	a, err := index(e, "agentId")
	if err != nil || !equal(a, aid) {
		return false, err
	}
	return equal(get(e, "at"), at), nil
}

// RoutePatch is `_hook_approval_route_patch`'s new hookstate line (without its newline): only when the file still holds
// out, the line this run wrote, and its newline (cur read up to its first NUL, as `read -d ”` reads it); the envelope's
// route and this agent's entry stamped at, set to word. false: leave the file as it stands.
func RoutePatch(cur, out []byte, word, aid string, at int64) ([]byte, bool) {
	if i := bytes.IndexByte(cur, 0); i >= 0 {
		cur = cur[:i]
	}
	if string(cur) != string(out)+"\n" {
		return nil, false
	}
	v, err := kernel.JQParse(out)
	if err != nil {
		return nil, false
	}
	o, ok := v.(kernel.Obj)
	ask, isAsk := get(v, "ask").(kernel.Obj)
	if !ok || !isAsk || !has(ask, "approval") {
		return nil, false // `else empty`
	}
	ap, isObj := get(ask, "approval").(kernel.Obj)
	if !isObj && get(ask, "approval") != nil {
		return nil, false // `.ask.approval.route = $r` cannot index it
	}
	o = set(o, "ask", set(ask, "approval", set(ap, "route", word)))
	if l, ok := get(o, "approvals").([]any); ok {
		nl := make([]any, len(l))
		for i, e := range l {
			hit, err := aprEntry(e, aid, at)
			if err != nil {
				return nil, false
			}
			if nl[i] = e; hit {
				nl[i] = set(e.(kernel.Obj), "route", word)
			}
		}
		o = set(o, "approvals", nl)
	}
	return kernel.JQCompact(o), true
}

// ApprovalsDrop is `_hook_approvals_drop`'s new hookstate text (without its last newline), over the file as it stands:
// this agent's entry stamped at removed, the key with it when the list empties; false where there is none to drop, or
// jq could not run over the file.
func ApprovalsDrop(file []byte, aid string, at int64) ([]byte, bool) {
	vs, err := kernel.JQParseAll(file)
	if err != nil {
		return nil, false
	}
	var out [][]byte
	for _, v := range vs {
		x, err := index(v, "approvals")
		if err != nil {
			return nil, false
		}
		l, ok := x.([]any)
		if !ok {
			continue
		}
		hit := false
		for _, e := range l { // any(…): stops at the first match
			if hit, err = aprEntry(e, aid, at); err != nil {
				return nil, false
			} else if hit {
				break
			}
		}
		if !hit {
			continue
		}
		kept := []any{}
		for _, e := range l {
			m, err := aprEntry(e, aid, at)
			if err != nil {
				return nil, false
			}
			if !m {
				kept = append(kept, e)
			}
		}
		o := v.(kernel.Obj)
		if len(kept) == 0 {
			o = del(o, "approvals")
		} else {
			o = set(o, "approvals", kept)
		}
		out = append(out, kernel.JQCompact(o))
	}
	if len(out) == 0 {
		return nil, false
	}
	return bytes.Join(out, []byte("\n")), true
}

// del is `del(.k)` of one member.
func del(o kernel.Obj, k string) kernel.Obj {
	out := kernel.Obj{}
	for _, kv := range o {
		if kv.K != k {
			out = append(out, kv)
		}
	}
	return out
}
