package attention

import (
	"strings"

	"ccrc/core/internal/kernel"
)

// Parsed is the ONE parse's first five lines (ccd/session-hook.sh, the jq after the delegation spool's gate): the
// event cut to letters, the session id cut to idch, the any-agent flag, the agent id when it is already a plain id,
// and a subagent call's approvals key. The spool's lines 6 to 10 are wave 2 Task 3's.
type Parsed struct {
	Shape   Shape  // how many values the payload holds: the one decision every arm reads (never re-derived)
	Values  []any  // every value jq read, in order (Payload is the first that the parse's program accepts)
	Payload any    // the payload as jq read it
	Event   string // letters only
	Psid    string // idch only
	Paid    bool   // any non-empty agent_id
	Aid     string // agent_id, when a string of 1 to 64 idch
	ApCall  string // {t,s} as one JSON line, or ""
}

// Payload is `payload=$(cat)`: a command substitution drops every NUL byte and cuts every trailing newline.
func Payload(stdin []byte) string {
	return strings.TrimRight(strings.ReplaceAll(string(stdin), "\x00", ""), "\n")
}

// Shape is how many JSON values a payload holds, as jq counts them when the bash pipes the payload into it (about fifty
// sites, each `jq … <<<"$payload"`): jq runs its program over each value in turn and stops at text it cannot read.
// Claude Code writes exactly one value, so ShapeOne is every real payload; the others are the hook's parity contract
// for any input (Go core wave 2, Task 7b). Decided here once; an arm that must tell them apart reads Parsed.Shape.
type Shape int

const (
	ShapeUnreadable Shape = iota // jq reads no value: empty or blank input, or text that opens with none
	ShapeOne                     // exactly one value
	ShapeMany                    // two or more whole values (jq prints a result for each, and exits 0)
	ShapeTrailing                // one or more whole values, then text jq cannot read (results for the whole values, exit 2)
)

// shapeOf is the shape of what JQParseAll read: the values and the error that ended it.
func shapeOf(vs []any, err error) Shape {
	switch {
	case len(vs) == 0:
		return ShapeUnreadable
	case err != nil:
		return ShapeTrailing
	case len(vs) == 1:
		return ShapeOne
	}
	return ShapeMany
}

// accepted is a value the parse's program runs over without error: `.hook_event_name` errors on anything but an object
// or null, and jq goes on to the next value after an error.
func accepted(v any) bool {
	_, isObj := v.(kernel.Obj)
	return isObj || v == nil
}

// Lines is a `jq -r <prog>` over every value of the payload, as `$( … )` reads it: f's outputs for each value in
// order, one a line, trailing newlines cut. ok is the program's exit status being 0: false for text jq could not read
// after the values (exit 2) and for a value f fails on (jq prints its error and goes on to the next value, exit 5); the
// text is still what jq printed, which a site with no `||` keeps.
func (p Parsed) Lines(f func(v any) ([]string, error)) (text string, ok bool) {
	ok = p.Shape == ShapeOne || p.Shape == ShapeMany
	var out []string
	for _, v := range p.Values {
		o, err := f(v)
		if err != nil {
			ok = false
			continue
		}
		out = append(out, o...)
	}
	return subst(strings.Join(out, "\n")), ok
}

// ParsePayload is the one parse. ok is false where the bash exits 0: a payload jq cannot read or in which no value's
// root is an object (every line is then missing), or an empty event. Shape is set whether or not ok is.
func ParsePayload(payload string) (Parsed, bool) {
	vs, err := kernel.JQParseAll([]byte(payload))
	shape := shapeOf(vs, err)
	// The parse's `{ read -r event; … } < <(jq …)` keeps the first ten lines: the first value its program runs over.
	var v any
	found := false
	for _, x := range vs {
		if accepted(x) {
			v, found = x, true
			break
		}
	}
	if !found {
		return Parsed{Shape: shape, Values: vs}, false
	}
	o, _ := v.(kernel.Obj)
	p := Parsed{Shape: shape, Values: vs, Payload: o}
	if v == nil {
		p.Payload = nil
	}
	p.Event = keep(tostring(or(get(v, "hook_event_name"), "")), alpha)
	p.Psid = keep(tostring(or(get(v, "session_id"), "")), idch)
	p.Paid = tostring(or(get(v, "agent_id"), "")) != ""
	if a := get(v, "agent_id"); isID(a) {
		p.Aid = a.(string)
	}
	if a, ok := get(v, "agent_id").(string); ok && a != "" {
		if s, err := AprSummary(v); err == nil { // `try … catch ""`
			p.ApCall = string(kernel.JQCompact(kernel.Obj{{K: "t", V: or(get(v, "tool_name"), "unknown")}, {K: "s", V: s}}))
		}
	}
	return p, p.Event != ""
}

// AprSummary is APR_SUMMARY_JQ: the first of command, file_path, path, url and pattern that is neither null nor
// false, as a string, cut to 200 code points. An error (a tool_input that is not an object) is the caller's.
func AprSummary(v any) (string, error) {
	ti, err := index(v, "tool_input")
	if err != nil {
		return "", err
	}
	var x any = ""
	for _, k := range []string{"command", "file_path", "path", "url", "pattern"} {
		y, err := index(ti, k)
		if err != nil {
			return "", err
		}
		if truthy(y) {
			x = y
			break
		}
	}
	return cut(tostring(x), 200), nil
}

// TypedModel is `_hook_typed_model`'s test: in a session with a door, a prompt whose first non-blank characters are
// `/model` followed by nothing or a blank. The report it sends is the network's (wave 2 Task 6).
func TypedModel(doorNonce, payload string, v any) bool {
	if !isHex64(doorNonce) || !strings.Contains(payload, "/model") {
		return false
	}
	s, ok := get(v, "prompt").(string)
	if !ok {
		return false
	}
	s = strings.TrimLeft(s, " \t\n\r")
	return strings.HasPrefix(s, "/model") && (len(s) == 6 || strings.ContainsRune(" \t\n\r", rune(s[6])))
}

// TypedModelBlock is the block answer a typed /model gets (`_hook_prompt_block_json`'s envelope).
func TypedModelBlock() []byte {
	return kernel.JQCompact(kernel.Obj{{K: "decision", V: "block"}, {K: "reason", V: "ccrc: a typed /model is refused in this session. Its model is the designation's, set at each start; a change inside a generation reads as model drift. Change the designated model in the Overlord's Settings: it takes effect at the next generation."}})
}

func isHex64(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
