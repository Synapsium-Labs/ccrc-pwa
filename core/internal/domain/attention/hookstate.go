package attention

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"ccrc/core/internal/kernel"
)

// Prev is the tail's one read of `$REG/<id>.hookstate.json` (its seven lines), after the bash's guards: the counters as
// decimal text, the two lists as JSON text that starts with `[` (an `--argjson` that cannot parse it is the write's
// failure, kept), and Unreadable when a file exists but no count came out (D-1613's probe, which the graph gate reads).
type Prev struct {
	State          string
	Gq, Gd, Cp, Cc string
	Apl, Subs      string
	Unreadable     bool
}

var digits = regexp.MustCompile(`^[0-9]+$`)

// ReadPrev reads the file's bytes (exists says whether `-f` held; data is nil when it could not be read).
func ReadPrev(data []byte, exists bool) Prev {
	var outs []string
	if v, err := kernel.JQParseFirst(data); err == nil {
		outs = prevOutputs(v)
	}
	l := readLines(outs, 7)
	p := Prev{State: l[0], Gq: l[1], Gd: l[2], Cp: l[3], Cc: l[4], Apl: l[5], Subs: l[6]}
	p.Unreadable = exists && p.Gq == ""
	if !strings.HasPrefix(p.Subs, "[") {
		p.Subs = "[]"
	}
	if !strings.HasPrefix(p.Apl, "[") {
		p.Apl = "[]"
	}
	for _, n := range []*string{&p.Gq, &p.Gd, &p.Cp, &p.Cc} {
		if !digits.MatchString(*n) {
			*n = "0"
		}
	}
	return p
}

// prevOutputs is the read's jq program, output by output, stopping at the first error as jq does.
func prevOutputs(v any) []string {
	st, err := index(v, "state")
	if err != nil {
		return nil
	}
	outs := []string{rawOut(or(st, ""))}
	for _, k := range []string{"graphQueries", "graphGateDenials", "ccrcPeerReads", "ccrcClaims"} {
		x := get(v, k)
		if f, ok := floorText(x); ok {
			outs = append(outs, f)
		} else {
			outs = append(outs, "0")
		}
	}
	if a, ok := get(v, "approvals").([]any); ok {
		objs := []any{}
		for _, e := range a {
			if _, ok := e.(kernel.Obj); ok {
				objs = append(objs, e)
			}
		}
		outs = append(outs, tostring(objs))
	} else {
		outs = append(outs, "[]")
	}
	return append(outs, tostring(or(get(v, "subagents"), []any{})))
}

// Fresh is `_hook_fresh_read`: the file as it stands now, each field validated as the bash's jq validates it.
type Fresh struct {
	State, By, Ask, Upd, Ev, Bgd, Bgdk string
	Int                                bool
	WpState, WpEv, WpUpd, WpAsk        string
	WpInt                              bool
}

// ReadFresh reads the file's bytes as `_hook_fresh_read` does (an absent or unreadable file is nil data).
func ReadFresh(data []byte) Fresh {
	var outs []string
	if v, err := kernel.JQParseFirst(data); err == nil {
		outs = freshOutputs(v)
	}
	l := readLines(outs, 13)
	f := Fresh{State: l[0], By: l[1], Ask: l[2], Int: l[3] == "true", Upd: l[4], Ev: l[5], Bgd: l[6], Bgdk: l[7],
		WpState: l[8], WpEv: l[9], WpUpd: l[10], WpAsk: l[11], WpInt: l[12] == "true"}
	if digits.MatchString(f.Bgd) && strings.HasPrefix(f.Bgdk, "k") {
		f.Bgdk = f.Bgdk[1:]
	} else {
		f.Bgd, f.Bgdk = "", ""
	}
	return f
}

func word3(v any) string {
	if s, ok := v.(string); ok && (s == "working" || s == "waiting" || s == "done") {
		return s
	}
	return ""
}

func letters(v any) string {
	if s, ok := v.(string); ok {
		return keep(s, alpha)
	}
	return ""
}

func floorOrEmpty(v any) string {
	if f, ok := floorText(v); ok {
		return f
	}
	return ""
}

func freshOutputs(v any) []string {
	st, err := index(v, "state")
	if err != nil {
		return nil
	}
	b := func(x bool) string {
		if x {
			return "true"
		}
		return "false"
	}
	outs := []string{word3(st), "", string(kernel.JQCompact(or(get(v, "ask"), nil))), b(get(v, "interrupted") == true),
		floorOrEmpty(get(v, "updatedAt")), letters(get(v, "event")), "", ""}
	if equal(get(v, "waitBy"), "subagent") {
		outs[1] = "subagent"
	}
	if f, ok := num(get(v, "bgDelegated")); ok && f >= 0 && f == math.Floor(f) {
		outs[6] = floorOrEmpty(get(v, "bgDelegated"))
	}
	if s, ok := get(v, "bgDelegatedKinds").(string); ok && utf8.RuneCountInString(s) <= 200 &&
		keep(s, func(r rune) bool { return r == ',' || r == '-' || r == '_' || r >= 'a' && r <= 'z' }) == s {
		outs[7] = "k" + s
	}
	wp, isObj := get(v, "waitPrev").(kernel.Obj)
	if !isObj {
		return append(outs, "", "", "", "null", "false")
	}
	return append(outs, word3(get(wp, "state")), letters(get(wp, "event")), floorOrEmpty(get(wp, "updatedAt")),
		string(kernel.JQCompact(or(get(wp, "ask"), nil))), b(get(wp, "interrupted") == true))
}

// WaitPrevKept is `_hook_wait_prev_kept`: the stored waitPrev rebuilt from the fresh read's validated lines.
func (f Fresh) WaitPrevKept() (string, bool) {
	if f.WpState == "" || !digits.MatchString(f.WpUpd) {
		return "", false
	}
	return waitPrevText(f.WpState, f.WpEv, f.WpUpd, f.WpAsk, f.WpInt), true
}

// WaitPrevOf is the waitPrev a subagent's own wait stores over the main state f read (D-5232), or "".
func (f Fresh) WaitPrevOf() string {
	if f.State == "" || !digits.MatchString(f.Upd) {
		return ""
	}
	return waitPrevText(f.State, f.Ev, f.Upd, f.Ask, f.Int)
}

func waitPrevText(state, ev, upd, ask string, interrupted bool) string {
	if ask == "" {
		ask = "null"
	}
	return `{"state":"` + state + `","event":"` + ev + `","updatedAt":` + upd + `,"ask":` + ask + `,"interrupted":` +
		strconv.FormatBool(interrupted) + `}`
}

// Write is everything the hookstate write's `jq -cn` takes.
type Write struct {
	State, Event, SessionID, PID string // PID: CLAUDE_PID as given ("" is 0), read as JSON
	UpdatedAt                    int64
	LateStamp                    bool // the stamp is the write's own clock: the caller sets UpdatedAt where it writes
	Interrupted                  bool
	Ask                          any
	AskBad                       bool   // the ask is two lines (several values in the payload): `--argjson` refuses it
	Subs, Apl                    string // JSON text
	Gq, Gd, Cp, Cc               string // decimal text
	WaitBy, AliveAt              string
	Bgd, Bgdk, WaitPrev, Route   string
	ApDrop, ApCall               string
	ApAdd                        bool
}

// HookstateCap is the 64 KiB cap in the bash's unit (`${#out}`: locale characters, code points under UTF-8).
const HookstateCap = 65536

// BuildHookstate is the write's `jq -cn` and its 64 KiB rule: the line to write (without its newline), or ok false
// where the bash exits 0 before the write (an `--argjson` that cannot parse, or a line still over the cap with the ask
// dropped). utf8Locale says whether the cap counts code points or bytes.
func BuildHookstate(w Write, utf8Locale bool) ([]byte, bool) {
	pidText := w.PID
	if pidText == "" {
		pidText = "0"
	}
	pid, err := kernel.JQParse([]byte(pidText))
	if err != nil || w.AskBad {
		return nil, false
	}
	subs, err1 := kernel.JQParse([]byte(w.Subs))
	apl, err2 := kernel.JQParse([]byte(w.Apl))
	if err1 != nil || err2 != nil {
		return nil, false
	}
	n := func(s string) any { return jsonNumber(s) }
	ask := w.Ask
	if a, ok := ask.(kernel.Obj); ok && w.Route != "" && has(a, "approval") {
		if ap, ok := get(a, "approval").(kernel.Obj); ok {
			ask = set(a, "approval", set(ap, "route", w.Route))
		}
	}
	o := kernel.Obj{{K: "v", V: 1}, {K: "state", V: w.State}, {K: "event", V: w.Event}, {K: "sessionId", V: w.SessionID},
		{K: "pid", V: pid}, {K: "updatedAt", V: w.UpdatedAt}, {K: "ask", V: ask}, {K: "subagents", V: subs},
		{K: "graphQueries", V: n(w.Gq)}, {K: "graphGateDenials", V: n(w.Gd)}, {K: "ccrcPeerReads", V: n(w.Cp)},
		{K: "ccrcClaims", V: n(w.Cc)}}
	if w.Interrupted {
		o = append(o, kernel.KV{K: "interrupted", V: true})
	}
	if w.WaitBy == "subagent" {
		o = append(o, kernel.KV{K: "waitBy", V: "subagent"})
	}
	if w.AliveAt != "" {
		o = append(o, kernel.KV{K: "aliveAt", V: tonumber(w.AliveAt)})
	}
	if w.Bgd != "" {
		o = append(o, kernel.KV{K: "bgDelegated", V: tonumber(w.Bgd)}, kernel.KV{K: "bgDelegatedKinds", V: w.Bgdk})
	}
	if w.WaitPrev != "" && w.WaitBy == "subagent" {
		if wp, err := kernel.JQParse([]byte(w.WaitPrev)); err == nil {
			if _, ok := wp.(kernel.Obj); ok {
				o = append(o, kernel.KV{K: "waitPrev", V: wp})
			}
		}
	}
	if ap := approvals(apl, w, ask); len(ap) > 0 {
		o = append(o, kernel.KV{K: "approvals", V: ap})
	}
	out := kernel.JQCompact(o)
	if Chars(string(out), utf8Locale) > HookstateCap {
		o = set(o, "ask", nil)
		if wp, ok := get(o, "waitPrev").(kernel.Obj); ok {
			o = set(o, "waitPrev", set(wp, "ask", nil))
		}
		if out = kernel.JQCompact(o); Chars(string(out), utf8Locale) > HookstateCap {
			return nil, false
		}
	}
	return out, true
}

// approvals is the write's per-agent envelope list: the read list less this agent's entry for this call (or every
// entry of an agent that stopped), plus a subagent PermissionRequest's own, newest 16.
func approvals(apl any, w Write, ask any) []any {
	var c any
	if w.ApCall != "" {
		c, _ = kernel.JQParse([]byte(w.ApCall))
	}
	l, _ := apl.([]any)
	out := []any{}
	for _, e := range l {
		cObj, isObj := c.(kernel.Obj)
		if !equal(get(e, "agentId"), w.ApDrop) || isObj && (!equal(get(e, "tool"), get(cObj, "t")) || !equal(get(e, "summary"), get(cObj, "s"))) {
			out = append(out, e)
		}
	}
	if a, ok := ask.(kernel.Obj); ok && w.ApAdd && has(a, "approval") {
		e := kernel.Obj{{K: "agentId", V: w.ApDrop}, {K: "tool", V: get(a, "approval", "tool")}, {K: "summary", V: get(a, "approval", "summary")},
			{K: "at", V: w.UpdatedAt}}
		if w.Route != "" {
			e = append(e, kernel.KV{K: "route", V: w.Route})
		}
		out = append(out, e)
	}
	if len(out) > 16 {
		out = out[len(out)-16:]
	}
	return out
}

// jsonNumber is `--argjson` of decimal text the bash already checked against ^[0-9]+$ or built by arithmetic.
func jsonNumber(s string) any {
	if v, err := kernel.JQParse([]byte(s)); err == nil {
		return v
	}
	return s
}

// tonumber is jq's `tonumber` of decimal text: a computed double.
func tonumber(s string) any {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return s
	}
	return f
}
