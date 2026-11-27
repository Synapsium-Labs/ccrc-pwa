package attention

import (
	"regexp"
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
)

// The start report (ccd/session-hook.sh, `_hook_start_report`, `_hook_start_keep`): the fresh report, the pending field's
// grammar and the keep, drop and back-off rules. L4 sends; every outcome is decided here.
const (
	StartPendingMax      = 20
	StartResendTries     = 5
	StartResendBackoffMs = 30000
	StartStaleBackoffMs  = 5000
)

var (
	genShape  = regexp.MustCompile(`\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z`)
	allDigits = regexp.MustCompile(`\A[0-9]+\z`)
)

// StartBody is the fresh report: this event's uuid as sender and as the conversation's, a report id, the source and model
// the payload names (cut), the row's incarnation when the environment's is of the shape, and the door's nonce hash when
// it is of its shape.
func StartBody(v any, id, rid, generation, doorNonce string, at int64) []byte {
	u := sessionUUID(v)
	src := tostring(or(get(v, "source"), ""))
	if src == "" {
		src = "other"
	} else {
		src = cut(src, 32)
	}
	var model any
	switch m := get(v, "model").(type) {
	case string:
		model = cut(m, 128)
	case kernel.Obj:
		if s, ok := get(m, "id").(string); ok {
			model = cut(s, 128)
		}
	}
	var inc any
	if genShape.MatchString(generation) {
		inc = generation
	}
	o := kernel.Obj{{K: "fromId", V: id}, {K: "fromUuid", V: u}, {K: "startedUuid", V: u}, {K: "reportId", V: rid},
		{K: "source", V: src}, {K: "model", V: model}, {K: "rowIncarnation", V: inc}, {K: "reportedAt", V: at}}
	if isHex64(doorNonce) {
		o = append(o, kernel.KV{K: "doorNonceSha256", V: doorNonce})
	}
	return kernel.JQCompact(o)
}

// ifsFields is `IFS=tab read -r a b ...` over one line into n variables: tab is an IFS blank, so runs of it are one
// delimiter and none leads a field; the last variable takes the rest, its trailing tabs cut; a missing field is empty.
func ifsFields(line string, n int) []string {
	out := make([]string, n)
	line = strings.TrimLeft(line, "	")
	for i := 0; i < n-1; i++ {
		a, rest, found := strings.Cut(line, "	")
		out[i] = a
		if !found {
			return out
		}
		line = strings.TrimLeft(rest, "	")
	}
	out[n-1] = strings.Trim(line, "	")
	return out
}

func ifsTab(line string) (first, rest string) {
	f := ifsFields(line, 2)
	return f[0], f[1]
}

// (D-TBD-go-hook-spool-arith: the field's numbers are read with strconv; bash's `(( ))` reads a leading zero as octal and
// wraps past int64, and only the hook's own decimal `$(( ))` writes them.)
// StartEligible is the report's gate: a SessionStart or UserPromptSubmit of a main-thread session with a registry row
// (`generation`) that is not a child, an id of the report's grammar and no link at the pending field.
func StartEligible(event string, paid bool, id string, generation, pendingLink, child, childLink bool) bool {
	return (event == "UserPromptSubmit" || event == "SessionStart") && !paid && ReportID(id) && generation && !pendingLink && !child && !childLink
}

// FreshDue says whether this event sends a fresh report: a SessionStart that is not a fork.
func FreshDue(event, src string) bool { return event == "SessionStart" && src != "fork" }

// LoadsPendDue says whether the fresh report also starts a loads window: a launch profile, at a startup or a resume.
func LoadsPendDue(profile, src string) bool {
	return profile != "" && (src == "startup" || src == "resume")
}

// Kept is one report the field holds: its tries and its JSON text.
type Kept struct {
	T int
	J string
}

// ParsePending reads the field as the bash's loop does: the header's two numbers (0 when not allDigits), and the reports
// of every complete line after it (a last line with no newline is no loop pass).
func ParsePending(data []byte) (after, drop int64, kept []Kept) {
	s := NulFree(data)
	lines := strings.Split(s, "\n")
	a, d := ifsTab(lines[0])
	if allDigits.MatchString(a) {
		after, _ = strconv.ParseInt(a, 10, 64)
	}
	if allDigits.MatchString(d) {
		drop, _ = strconv.ParseInt(d, 10, 64)
	}
	if len(lines) > 2 {
		for _, l := range lines[1 : len(lines)-1] {
			t, j := ifsTab(l)
			n := 0
			if allDigits.MatchString(t) {
				n, _ = strconv.Atoi(t)
			}
			kept = append(kept, Kept{T: n, J: j})
		}
	}
	return after, drop, kept
}

// Pass is the report pass's running state: its back-off stamp, the dropped count, whether resends go on, why it ended
// (0 clean, 1 stale or out of time, 2 no answer) and the reports staying.
type Pass struct {
	After, Drop int64
	On          bool
	Why         int
	Stay        []Kept
}

// NewPass starts a pass over the field's header: the back-off stamp held to one long back-off ahead (a clock stepped back
// reads as the long one), resends on only once it has passed and only for an event that has a sender's uuid.
func NewPass(after, drop, now int64, psid string) Pass {
	if after > now+StartResendBackoffMs {
		after = now + StartResendBackoffMs
	}
	return Pass{After: after, Drop: drop, On: now >= after && psid != ""}
}

// Fresh is the fresh report's effect on the pass: a send with no answer, a stale answer, a kept one or none made ends it.
func (p *Pass) Fresh(rc int) {
	if rc == SendStale || rc == SendNoAnswer || rc == SendKept || rc == SendNoTime {
		p.On = false
	}
}

// Resends is the pass over the kept reports: each is rewritten for the current sender and sent through send (which L4
// acts), and the outcome decides its keep. A report jq cannot read is dropped; with the pass off a report is left unsent.
func (p *Pass) Resends(kept []Kept, psid string, send func(j string) int) {
	for _, e := range kept {
		j, r := e.J, SendUnsent
		if p.On {
			if nj, ok := Resend(j, psid); ok {
				j, r = nj, send(nj)
			} else {
				j, r = "", SendRefused
			}
		}
		if r == SendNoTime {
			p.On = false
		}
		p.Keep(e.T, j, StaleElsewhere(r, j, psid))
	}
}

// Keep is `_hook_start_keep`: a send's outcome r for the report (t tries, text j) decides the stay, drop, pass and why.
func (p *Pass) Keep(t int, j string, r int) {
	switch r {
	case SendTaken:
		return
	case SendRefused:
		p.Drop++
		return
	case SendStale:
		p.On = false
		if p.Why < 1 {
			p.Why = 1
		}
	case SendNoTime:
		if p.Why < 1 {
			p.Why = 1
		}
	case SendNoAnswer, SendKept:
		p.On, p.Why = false, 2
	}
	if r == SendStale || r == SendKept || r == SendStaleElse {
		t++
	}
	if t >= StartResendTries {
		p.Drop++
	} else {
		p.Stay = append(p.Stay, Kept{T: t, J: j})
	}
}

// Resend is the rewrite a kept report gets before its resend: `startedUuid` set from `fromUuid` when it has none, and
// `fromUuid` the sender's current uuid for a clear, resume or compact. ok is false where jq fails (the report is dropped).
func Resend(j, psid string) (string, bool) {
	if strings.TrimSpace(j) == "" {
		return "", true
	}
	v, err := kernel.JQParse([]byte(j))
	if err != nil {
		return "", false
	}
	o, isObj := v.(kernel.Obj)
	if !isObj && v != nil {
		return "", false
	}
	if !truthy(get(o, "startedUuid")) {
		o = set(o, "startedUuid", get(o, "fromUuid"))
	}
	switch get(o, "source") {
	case "clear", "resume", "compact":
		o = set(o, "fromUuid", psid)
	}
	return string(kernel.JQCompact(o)), true
}

// StaleElsewhere is the resend's own test: the answer was stale-uuid for a report that does not carry this event's uuid
// (a kept startup's): a try, and the pass goes on.
func StaleElsewhere(r int, j, psid string) int {
	if r == SendStale && !strings.Contains(j, `"fromUuid":"`+psid+`"`) {
		return SendStaleElse
	}
	return r
}

// Finish is the end of a pass: the back-off the way it ended set, the oldest reports over the cap dropped, and the field's
// text ("" when it is to be removed: nothing stays and nothing was dropped).
func (p *Pass) Finish(now int64, taken bool) (text string, remove bool) {
	if taken {
		p.After = 0
	}
	if p.Why == 2 {
		p.After = now + StartResendBackoffMs
	}
	if p.Why == 1 {
		p.After = now + StartStaleBackoffMs
	}
	for len(p.Stay) > StartPendingMax {
		p.Stay = p.Stay[1:]
		p.Drop++
	}
	if len(p.Stay) == 0 && p.Drop == 0 {
		return "", true
	}
	var b strings.Builder
	b.WriteString(itoa(p.After) + "\t" + itoa(p.Drop) + "\n")
	for _, k := range p.Stay {
		b.WriteString(strconv.Itoa(k.T) + "\t" + k.J + "\n")
	}
	return b.String(), false
}

// Rid is the report's id (D-TBD-go-hook-rand: `$RANDOM` is rand.Intn over the same 0..32767): the ms, the process and a random number.
func Rid(now int64, pid, rnd int) string {
	return itoa(now) + "-" + strconv.Itoa(pid) + "-" + strconv.Itoa(rnd)
}
