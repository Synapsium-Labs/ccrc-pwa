package attention

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"ccrc/core/internal/kernel"
)

// Mark is what `_hook_turn_mark` hands TURN_MARK_PROGRAM: the previous line (the first line of `$REG/<id>.turn.json`,
// "" when absent), the kind (working, done, failed, restart or clear), the session id (the env's, else the payload's),
// the event, this run's stamp, and Stop's measures and StopFailure's error word.
type Mark struct {
	Prev, Kind, Sid, Event string
	At                     int64
	Bg, Crons              string // decimal text; anything but ^-?[0-9]+$ is -1, as the function's guards make it
	Bgk, Bgi, Err          string
}

var intText = regexp.MustCompile(`^-?[0-9]+$`)

// TurnMark is TURN_MARK_PROGRAM (ccd/session-hook.sh), held to real jq by testdata/turnmark.golden: the marker line,
// or ok false where the program errors or the kind is not one of the five (nothing is written then).
func TurnMark(m Mark) ([]byte, bool) {
	if !intText.MatchString(m.Bg) {
		m.Bg = "-1"
	}
	if !intText.MatchString(m.Crons) {
		m.Crons = "-1"
	}
	bg, crons := jsonNumber(m.Bg), jsonNumber(m.Crons)
	raw, err := kernel.JQParse([]byte(m.Prev)) // `try fromjson catch null`
	if err != nil {
		raw = nil
	}
	var p kernel.Obj
	if o, ok := raw.(kernel.Obj); ok && equal(get(o, "v"), 1) {
		p = o
	}
	same := p != nil && equal(get(p, "sessionId"), m.Sid)
	carry := func(k string, dflt any) any {
		if !same {
			return dflt
		}
		if dflt == nil {
			return get(p, k)
		}
		return or(get(p, k), dflt)
	}
	b := kernel.Obj{{K: "v", V: 1}, {K: "sessionId", V: m.Sid}, {K: "state", V: "done"}, {K: "event", V: m.Event},
		{K: "at", V: m.At}, {K: "turnAt", V: carry("turnAt", nil)}, {K: "stopAt", V: carry("stopAt", nil)},
		{K: "bg", V: carry("bg", -1)}, {K: "bgKinds", V: carry("bgKinds", "")}, {K: "bgIds", V: carry("bgIds", "")},
		{K: "err", V: carry("err", nil)}, {K: "restartAt", V: carry("restartAt", nil)}, {K: "lostBg", V: carry("lostBg", 0)},
		{K: "lostKinds", V: carry("lostKinds", "")}, {K: "lostIds", V: carry("lostIds", "")}, {K: "crons", V: carry("crons", -1)}}
	with := func(kv ...kernel.KV) kernel.Obj {
		for _, x := range kv {
			b = set(b, x.K, x.V)
		}
		return b
	}
	switch m.Kind {
	case "working":
		return kernel.JQCompact(with(kernel.KV{K: "state", V: "working"}, kernel.KV{K: "turnAt", V: m.At},
			kernel.KV{K: "lostBg", V: 0}, kernel.KV{K: "lostKinds", V: ""}, kernel.KV{K: "lostIds", V: ""})), true
	case "done":
		return kernel.JQCompact(with(kernel.KV{K: "stopAt", V: m.At}, kernel.KV{K: "bg", V: bg},
			kernel.KV{K: "bgKinds", V: fitk(uniqueSorted(csv(m.Bgk)))}, kernel.KV{K: "bgIds", V: fiti(csv(m.Bgi))},
			kernel.KV{K: "crons", V: crons})), true
	case "failed":
		return kernel.JQCompact(with(kernel.KV{K: "state", V: "failed"}, kernel.KV{K: "stopAt", V: m.At},
			kernel.KV{K: "err", V: m.Err})), true
	case "restart":
		if same && (equal(get(p, "state"), "done") || equal(get(p, "state"), "failed")) {
			lostBg, err := jqAdd(or(get(p, "lostBg"), 0), jqMax0(or(get(p, "bg"), -1)))
			if err != nil {
				return nil, false
			}
			kinds, err1 := jqAdd(or(get(p, "lostKinds"), ""), ",")
			if err1 == nil {
				kinds, err1 = jqAdd(kinds, or(get(p, "bgKinds"), ""))
			}
			ids, err2 := jqAdd(or(get(p, "lostIds"), ""), ",")
			if err2 == nil {
				ids, err2 = jqAdd(ids, or(get(p, "bgIds"), ""))
			}
			ks, ok1 := kinds.(string)
			is, ok2 := ids.(string)
			if err1 != nil || err2 != nil || !ok1 || !ok2 { // `csv` splits a string only
				return nil, false
			}
			with(kernel.KV{K: "lostBg", V: lostBg}, kernel.KV{K: "lostKinds", V: fitk(uniqueSorted(csv(ks)))},
				kernel.KV{K: "lostIds", V: fiti(csv(is))})
		}
		return kernel.JQCompact(with(kernel.KV{K: "restartAt", V: m.At}, kernel.KV{K: "bg", V: 0},
			kernel.KV{K: "bgKinds", V: ""}, kernel.KV{K: "bgIds", V: ""})), true
	case "clear":
		return kernel.JQCompact(kernel.Obj{{K: "v", V: 1}, {K: "sessionId", V: m.Sid}, {K: "state", V: "done"},
			{K: "event", V: m.Event}, {K: "at", V: m.At}, {K: "turnAt", V: nil}, {K: "stopAt", V: nil}, {K: "bg", V: -1},
			{K: "bgKinds", V: ""}, {K: "bgIds", V: ""}, {K: "err", V: nil}, {K: "restartAt", V: nil}, {K: "lostBg", V: 0},
			{K: "lostKinds", V: ""}, {K: "lostIds", V: ""}, {K: "crons", V: -1}}), true
	}
	return nil, false
}

// csv is the program's `split(",") | map(select(length > 0))`.
func csv(s string) []string {
	out := []string{}
	for _, x := range strings.Split(s, ",") {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}

// fitk keeps whole aliases while the joined list stays within 200 code points.
func fitk(ks []string) string {
	acc := ""
	for _, k := range ks {
		n := utf8.RuneCountInString(acc)
		sep := 0
		if n > 0 {
			sep = 1
		}
		if n+sep+utf8.RuneCountInString(k) <= 200 {
			if n > 0 {
				acc += ","
			}
			acc += k
		}
	}
	return acc
}

// fiti keeps the first eight ids.
func fiti(ids []string) string {
	if len(ids) > 8 {
		ids = ids[:8]
	}
	return strings.Join(ids, ",")
}

// jqAdd is jq's `+`: null is the identity, numbers add as doubles, strings, arrays and objects join; anything else errors.
func jqAdd(a, b any) (any, error) {
	if a == nil {
		return b, nil
	}
	if b == nil {
		return a, nil
	}
	if x, ok := num(a); ok {
		if y, ok := num(b); ok {
			return x + y, nil
		}
		return nil, errJQ
	}
	switch x := a.(type) {
	case string:
		if y, ok := b.(string); ok {
			return x + y, nil
		}
	case []any:
		if y, ok := b.([]any); ok {
			return append(append([]any{}, x...), y...), nil
		}
	case kernel.Obj:
		if y, ok := b.(kernel.Obj); ok {
			for _, kv := range y {
				x = set(x, kv.K, kv.V)
			}
			return x, nil
		}
	}
	return nil, errJQ
}

// jqMax0 is `[x, 0] | max` in jq's order (null < false < true < numbers < strings < arrays < objects).
func jqMax0(x any) any {
	switch x.(type) {
	case nil, bool:
		return 0
	case string, []any, kernel.Obj:
		return x
	}
	if f, _ := num(x); f > 0 {
		return x
	}
	return 0
}
