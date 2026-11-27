package attention

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"

	"ccrc/core/internal/kernel"
)

// The door's reports and delta (ccd/session-hook.sh: `_hook_door_arms`, `_hook_model_report`, `_hook_door_delta`).
// Each builds the bytes jq built, with the kernel's encoder.

// DoorSession says whether the spawn put the launch nonce's sha256 in the environment: a session with a door.
func DoorSession(nonce string) bool { return isHex64(nonce) }

// DoorKey is the witness's key: the sha256 of the tool's full name, one newline and `jq -cS` of its input (`{}` when
// absent or false), and only for a door tool whose call no deny stopped. "" is no witness.
func DoorKey(tool string, v any, denied bool) string {
	if !strings.HasPrefix(tool, "mcp__door__") || len(tool) == len("mcp__door__") || denied {
		return ""
	}
	sum := sha256.Sum256(append([]byte(tool+"\n"), kernel.JQCompactSorted(or(get(v, "tool_input"), kernel.Obj{}))...))
	return hex.EncodeToString(sum[:])
}

// DoorIn is what the event's reports ask of it.
type DoorIn struct {
	V      any    // the payload as jq read it
	ID     string // the session
	Key    string // DoorKey
	Aid    string // the agent id, when a plain one
	Joined bool   // the agent is a joined subagent (tmsub)
	Quiet  bool   // a main-thread Stop with no background work
	Now    int64
}

const (
	nudgeHead = "ccrc-mail: you have new mail. Operator message "
	nudgeTail = ": read it with your messages door."
)

// nudge is DOOR_NUDGE_JQ's `nudge`: the message id of a line that is EXACTLY the private store's nudge line, else none.
func nudge(line string) (int64, bool) {
	if !strings.HasPrefix(line, nudgeHead) || !strings.HasSuffix(line, nudgeTail) || len(line) <= len(nudgeHead)+len(nudgeTail) {
		return 0, false
	}
	d := line[len(nudgeHead) : len(line)-len(nudgeTail)]
	if !(len(d) <= 15 || len(d) == 16 && d <= "9007199254740991") || d[0] == '0' {
		return 0, false
	}
	var n int64
	for i := 0; i < len(d); i++ {
		if d[i] < '0' || d[i] > '9' {
			return 0, false
		}
		n = n*10 + int64(d[i]-'0')
	}
	return n, true
}

// DoorReports is DOOR_NUDGE_JQ's program: the report bodies the event owes, in order, each `jq -c` of its object.
func DoorReports(in DoorIn) [][]byte {
	var kinds []kernel.Obj
	switch ev, _ := get(in.V, "hook_event_name").(string); {
	case ev == "PreToolUse" && in.Key != "":
		var agent any
		if at, _ := get(in.V, "agent_type").(string); in.Aid != "" && (in.Joined || at != "") {
			agent = in.Aid
		}
		kinds = append(kinds, kernel.Obj{{K: "kind", V: "witness"}, {K: "key", V: in.Key}, {K: "tool", V: get(in.V, "tool_name")}, {K: "agentId", V: agent}})
	case ev == "SubagentStart" && in.Aid != "":
		var at any
		if s, ok := get(in.V, "agent_type").(string); ok {
			at = cut(s, 128)
		}
		kinds = append(kinds, kernel.Obj{{K: "kind", V: "reader-start"}, {K: "agentId", V: in.Aid}, {K: "agentType", V: at}})
	case ev == "SubagentStop" && in.Aid != "":
		kinds = append(kinds, kernel.Obj{{K: "kind", V: "reader-stop"}, {K: "agentId", V: in.Aid}})
	case ev == "Stop" && in.Quiet:
		kinds = append(kinds, kernel.Obj{{K: "kind", V: "readers-clear"}})
	case ev == "UserPromptSubmit":
		if p, ok := get(in.V, "prompt").(string); ok {
			for _, l := range strings.Split(p, "\n") {
				if n, ok := nudge(l); ok {
					kinds = append(kinds, kernel.Obj{{K: "kind", V: "picked-up"}, {K: "messageId", V: n}})
				}
			}
		}
	}
	var out [][]byte
	for _, o := range kinds {
		out = append(out, kernel.JQCompact(append(o, kernel.KV{K: "fromId", V: in.ID}, kernel.KV{K: "fromUuid", V: sessionUUID(in.V)}, kernel.KV{K: "at", V: in.Now})))
	}
	return out
}

// sessionUUID is `(.session_id // "" | tostring)`.
func sessionUUID(v any) string { return tostring(or(get(v, "session_id"), "")) }

// mdl is MODEL_REPORT_JQ's `mdl`: a model's id as text, printable ASCII only, at most 128 characters, null when empty.
func mdl(v any) any {
	s := ""
	switch x := v.(type) {
	case string:
		s = x
	case kernel.Obj:
		if id, ok := get(x, "id").(string); ok {
			s = id
		}
	}
	s = cut(keep(s, func(r rune) bool { return r >= 32 && r <= 126 }), 128)
	if s == "" {
		return nil
	}
	return s
}

// typedModelWord is MODEL_REPORT_JQ's `typed` read to the model word: the prompt's first word after `/model`, blanks cut.
func typedModelWord(v any) any {
	p, _ := get(v, "prompt").(string)
	p = strings.TrimLeft(p, " \t\n\r")
	r := []rune(p)
	if len(r) > 6 {
		r = r[6:]
	} else {
		r = nil
	}
	line, _, _ := strings.Cut(string(r), "\n")
	for _, w := range strings.Split(strings.ReplaceAll(line, "\t", " "), " ") {
		if w != "" {
			return w
		}
	}
	return nil
}

var reportID = regexp.MustCompile(`\A[A-Za-z0-9_-]+\z`)

// ReportID is the start report's and the model report's id grammar.
func ReportID(id string) bool { return reportID.MatchString(id) }

// (D-TBD-go-hook-sha256-native: `_apr_sha256` needs shasum or node; DoorKey hashes natively.)
// HasTimeout is `_hook_timeout`'s own test: with neither `timeout` nor `gtimeout` on PATH it answers 127 and starts nothing.
// D-TBD-go-hook-timeout-windows: on Windows `found` is MSYS2's lookup (proc.Found), so it finds the file the bash
// finds; where that is System32's timeout.exe (a sleep, first on a PATH without MSYS2's /usr/bin ahead of it) the bash's
// `timeout N cmd` fails and the Go hook's in-process bound runs the call. A hook's PATH has /usr/bin first (ccd's spawn).
func HasTimeout(found func(string) bool) bool { return found("timeout") || found("gtimeout") }

// ModelReportOK is the arm's gate: a main-thread session with a registry row that is not a child, and an id the start
// report's own grammar holds.
func ModelReportOK(paid bool, id string, generation, child, childLink bool) bool {
	return !paid && ReportID(id) && generation && !child && !childLink
}

// ModelReport is the `model-switch` body: how is `switched` (from and to read from the payload's model fields) or
// `typed-refused` (to read from the typed prompt).
func ModelReport(how, id string, now int64, v any) []byte {
	var from, to any
	if how == "switched" {
		from, to = mdl(get(v, "from_model")), mdl(get(v, "to_model"))
	} else {
		to = mdl(typedModelWord(v))
	}
	return kernel.JQCompact(kernel.Obj{{K: "kind", V: "model-switch"}, {K: "how", V: how}, {K: "from", V: from}, {K: "to", V: to},
		{K: "fromId", V: id}, {K: "fromUuid", V: sessionUUID(v)}, {K: "at", V: now}})
}

// DoorDeltaUnknown is the line a stale or unreadable cache yields; DoorDeltaMax the text's bytes.
const (
	DoorDeltaUnknown = "ccrc-delta: unknown (the door process's cache is stale)"
	DoorDeltaMax     = 300
)

var deltaHead = regexp.MustCompile(`\Av=1 at=[0-9]{1,16} until=([0-9]{1,16})\z`)

// DoorDelta is `_hook_door_delta` over the first 1024 bytes of the cache (head -c 1024, as `$( )` keeps them) and the
// clock: the cache's line while its lease holds, "" for an empty one, else the unknown line.
func DoorDelta(head []byte, now int64) string {
	raw := strings.TrimRight(strings.ReplaceAll(string(head), "\x00", ""), "\n")
	h1, rest, _ := strings.Cut(raw, "\n")
	m := deltaHead.FindStringSubmatch(h1)
	if m == nil || now < 0 || now > 9999999999999999 {
		return DoorDeltaUnknown
	}
	until, _ := parseU(m[1])
	if until <= now {
		return DoorDeltaUnknown
	}
	body, _, _ := strings.Cut(rest, "\n")
	if strings.Contains(raw, "\n") == false {
		body = ""
	}
	cl := keepBytes(body, func(b byte) bool { return b >= 32 && b != 127 })
	for _, s := range []string{"\xc2\x85"} {
		cl = strings.ReplaceAll(cl, s, "")
	}
	cl = stripRange(cl, "\xe2\x80", 0xa8, 0xae)
	cl = stripRange(cl, "\xe2\x81", 0xa6, 0xa9)
	if body != "" && !strings.HasPrefix(cl, "ccrc-delta: ") {
		return DoorDeltaUnknown
	}
	if len(cl) > DoorDeltaMax {
		cl = cl[:DoorDeltaMax]
	}
	return cl
}

func parseU(s string) (int64, bool) {
	var n int64
	for i := 0; i < len(s); i++ {
		n = n*10 + int64(s[i]-'0')
	}
	return n, true
}

func keepBytes(s string, f func(byte) bool) string {
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if f(s[i]) {
			b = append(b, s[i])
		}
	}
	return string(b)
}

// stripRange is `${s//$'<lead>'[$'\x<lo>'-$'\x<hi>']/}` in the C locale: the three-byte sequence lead + one byte in [lo,hi].
func stripRange(s, lead string, lo, hi byte) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if strings.HasPrefix(s[i:], lead) && i+2 < len(s) && s[i+2] >= lo && s[i+2] <= hi {
			i += 3
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}
