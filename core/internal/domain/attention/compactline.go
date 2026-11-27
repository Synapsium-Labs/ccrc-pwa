package attention

import (
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
)

// The PreCompact events line, the refusal arm, the history scope marker and the steer print (ccd/session-hook.sh:
// `_hook_compact_pre_line`, `_hook_compact_refuse`, `_hook_history_scope`, `_hook_history_pre` and their readers).

// readTwo is `{ read -r a; read -r b; } < <(jq -r …)`: the first two lines of what jq printed, each with its NUL bytes
// dropped and the spaces and tabs a default-IFS `read` trims cut from both ends.
func readTwo(text string) (string, string) {
	l := strings.SplitN(strings.ReplaceAll(text, "\x00", ""), "\n", 3)
	for len(l) < 2 {
		l = append(l, "")
	}
	return strings.Trim(l[0], " \t"), strings.Trim(l[1], " \t")
}

// PayloadTPTrig is the transcript path and trigger as `(.transcript_path // "" | tostring), (.trigger // <dflt> |
// tostring)` prints them, read by two `read -r`s (`_hook_compact_refuse` with dflt "", the scope verdict with "auto").
func PayloadTPTrig(ps Parsed, dflt string) (tp, trig string) {
	text, _ := ps.Lines(func(v any) ([]string, error) {
		a, err := index(v, "transcript_path")
		if err != nil {
			return nil, err
		}
		b, _ := index(v, "trigger")
		return []string{tostring(or(a, "")), tostring(or(b, dflt))}, nil
	})
	return readTwo(text)
}

// PayloadRaw is `x=$(jq -r '.<k> // <dflt>' <<<"$payload")` (dflt nil is `// empty`): the text and the exit status.
func PayloadRaw(ps Parsed, k string, dflt any) (string, bool) {
	return ps.Lines(func(v any) ([]string, error) {
		a, err := index(v, k)
		if err != nil {
			return nil, err
		}
		if a = or(a, dflt); a == nil {
			return nil, nil
		}
		return []string{rawOut(a)}, nil
	})
}

// TriggerAuto is `jq -e '.trigger == "auto"' <<<"$payload"`.
func TriggerAuto(ps Parsed) bool {
	return jqE(ps.Values, ps.Shape == ShapeTrailing, func(v any) (bool, error) {
		t, err := index(v, "trigger")
		return equal(t, "auto"), err
	}) == 0
}

// PreLine is the events line's program over the payload (`jq -c --argjson at … '{at, trigger, scope, transcript,
// phase}'`): one line per value; ok false is jq failing (the line is not written at all).
func PreLine(ps Parsed, at int64, scope, transcript, phase string) (string, bool) {
	opt := func(s string) any {
		if s == "" {
			return nil
		}
		return kernel.JQRepair([]byte(s))
	}
	return ps.Lines(func(v any) ([]string, error) {
		t, err := index(v, "trigger")
		if err != nil {
			return nil, err
		}
		t = or(t, "auto")
		if !equal(t, "auto") && !equal(t, "manual") {
			t = "other"
		}
		return []string{string(kernel.JQCompact(kernel.Obj{{K: "at", V: at}, {K: "trigger", V: t},
			{K: "scope", V: opt(scope)}, {K: "transcript", V: opt(transcript)}, {K: "phase", V: kernel.JQRepair([]byte(phase))}}))}, nil
	})
}

// LineOwesAnchor is the events line's anchor mark: a written `pre` line of an `auto`, main-scope PreCompact whose
// payload reads `auto` too.
func LineOwesAnchor(phase, line string, ps Parsed) bool {
	return phase == "pre" && strings.Contains(line, `"trigger":"auto","scope":"main",`) && TriggerAuto(ps)
}

// FileLines is `mapfile -t lines < f`: how many lines (a last one with no newline counts).
func FileLines(b []byte) int {
	if len(b) == 0 {
		return 0
	}
	n := strings.Count(string(b), "\n")
	if b[len(b)-1] != '\n' {
		n++
	}
	return n
}

// The refusal arm's grammar: the turn marker's `"turnAt":([0-9]{1,15})[,}]` and an events line's `^\{"at":([0-9]{1,15}),`.
var (
	turnAtRE  = re(`"turnAt":([0-9]{1,15})[,}]`)
	lineAtRE  = re(`\A\{"at":([0-9]{1,15}),`)
	refuseVal = "refuse"
)

// bashInt is `$(( s ))` of a digit string: a leading 0 makes it octal, and an octal with an 8 or a 9 is an error
// (measured: `(( 0099 >= x ))` fails, and the loop goes on).
func bashInt(s string) (int64, bool) {
	base := 10
	if len(s) > 1 && s[0] == '0' {
		base = 8
	}
	n, err := strconv.ParseInt(s, base, 64)
	return n, err == nil
}

// RefuseIn is what `_hook_compact_refuse` reads.
type RefuseIn struct {
	Paid       bool
	Precompact []byte // `$REG/<id>.precompact`, nil when it is not a regular file (or is a link)
	TP, Trig   string
	Scope      func(tp, trig string) Scope // the scope rule, asked only past the first two gates
	TurnLine   []byte                      // `IFS= read -r l < turn.json`'s file, nil when not a regular file
	Msid       string
	Events     [][]byte // `.compactevents`, `.compacteventsprev`, each nil when not a regular file
}

// RefuseVerdict is the arm's decision before its line: whether to refuse (record the `refused` line, then print the
// block). asked is whether the scope rule ran (its answer then stands as this run's CS_SCOPE).
func RefuseVerdict(in RefuseIn) (refuse bool, s Scope, asked bool) {
	if in.Paid || in.Precompact == nil {
		return false, s, false
	}
	if readN(in.Precompact, 7) != refuseVal || in.Trig != "auto" {
		return false, s, false
	}
	s, asked = in.Scope(in.TP, in.Trig), true
	if !s.OK || s.Scope != "main" || in.TurnLine == nil {
		return false, s, asked
	}
	l, _, _ := strings.Cut(strings.ReplaceAll(string(in.TurnLine), "\x00", ""), "\n")
	m := turnAtRE().FindStringSubmatch(l)
	if !strings.Contains(l, `"sessionId":"`+in.Msid+`"`) || m == nil {
		return false, s, asked
	}
	ta, taOK := bashInt(m[1])
	for _, f := range in.Events {
		if f == nil {
			continue
		}
		for _, line := range readLoop(f) {
			at := lineAtRE().FindStringSubmatch(line)
			if !strings.Contains(line, `"phase":"refused"`) || at == nil {
				continue
			}
			if n, ok := bashInt(at[1]); ok && taOK && n >= ta {
				return false, s, asked
			}
		}
	}
	return true, s, asked
}

// readLoop is `while IFS= read -r l; do …; done < f`: every newline-ended line (a last line with no newline is never
// read), NUL bytes dropped.
func readLoop(b []byte) []string {
	s := strings.ReplaceAll(string(b), "\x00", "")
	i := strings.LastIndexByte(s, '\n')
	if i < 0 {
		return nil
	}
	return strings.Split(s[:i], "\n")
}

// readN is `read -r -n <n> v < f` with the default IFS: up to n characters of the first line (bytes: the value it
// compares is ASCII), NUL bytes dropped, spaces and tabs trimmed from both ends.
func readN(b []byte, n int) string {
	s, _, _ := strings.Cut(strings.ReplaceAll(string(b), "\x00", ""), "\n")
	if len(s) > n {
		s = s[:n]
	}
	return strings.Trim(s, " \t")
}

// RefuseBlock is the block decision the arm prints.
const RefuseBlock = `{"decision":"block","reason":"ccrc: this automatic compaction is refused once this turn, and a renewal is due (Overlord C39)"}`

// ScopeMarker is the history scope marker's line, `<scope> <psid> <ms>`; ok false writes nothing (an id past 224
// characters, a psid that is no lowercase UUID, no verdict).
func ScopeMarker(id, psid, scope string, ms int64, utf bool) (string, bool) {
	if Chars(id, utf) > 224 || !IsUUID(psid) || scope == "" {
		return "", false
	}
	return scope + " " + psid + " " + strconv.FormatInt(ms, 10) + "\n", true
}
