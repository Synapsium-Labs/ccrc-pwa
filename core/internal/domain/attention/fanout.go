package attention

import (
	"regexp"
	"strings"
	"unicode"
)

// The fan-out pin's scanner (ccd/session-hook.sh, the jq program run as `fo=$(jq -r --arg file …)` beside "A FAN-OUT NAMES
// ITS MODEL", D-6798): a Workflow script is read as code, and an `agent(…)` call whose visible options name no model or no
// effort is "bad". The bash writes the walk in jq over an array of code points; this is the same walk over []rune, helper
// for helper (skipc, scan, calls, ws, judge), so a change to the jq is a change to be made here. The goldens in
// testdata/fanout.golden were measured from real jq running the program cut from the hook (gen-fanout-golden.sh) and
// fanout.program.sha256 pins that program's text.

// onigSpace is Oniguruma's `[[:space:]]` on a code point (UTF-8): White_Space, which is Go's unicode.IsSpace (measured
// equal over every code point against jq 1.8: 9-13, 32, 133, 160, 5760, 8192-8202, 8232, 8233, 8239, 8287, 12288).
func onigSpace(r rune) bool { return unicode.IsSpace(r) }

// FanOutVerdict is the program: "agent" (an Agent or Task call naming no model), "workflow" (a Workflow script with an
// agent() call missing a model or an effort), or "" (allowed, and every case that cannot be seen). file is the text of
// the script the call's scriptPath names (the caller's read, `$fosrc`), "" when there is none. A tool_input of the wrong
// type, a script that is not a string and an unbalanced quote all allow, as the program does.
func FanOutVerdict(v any, file string) string {
	tool := get(v, "tool_name")
	in := get(v, "tool_input") // `.tool_input as $i`; the payload is an object here, so this never errors
	switch {
	case equal(tool, "Agent") || equal(tool, "Task"):
		if typeName(in) != "object" {
			return ""
		}
		m := get(in, "model")
		if s, ok := m.(string); !ok || s == "" {
			return "agent"
		}
	case equal(tool, "Workflow") && typeName(in) == "object":
		var src string
		if s, ok := get(in, "script").(string); ok {
			src = s
		} else if file != "" {
			src = file
		} else {
			return ""
		}
		c := []rune(src)
		for _, h := range fanCalls(c) {
			if fanJudge(c, h) == "bad" {
				return "workflow"
			}
		}
	}
	return ""
}

func fanAt(c []rune, i int) rune { // `$c[$i]`: null (here -1) past either end
	if i >= 0 && i < len(c) {
		return c[i]
	}
	return -1
}

func fanQuote(r rune) bool { return r == '"' || r == '\'' || r == '`' }

// fanSkipc is `skipc($c; $i)`: where a comment or a regex literal at i ends, or false when i starts neither. The
// positions it answers can lie past the end of c (a comment that never closes answers len+2), which every caller reads
// as "the text ended".
func fanSkipc(c []rune, i int) (int, bool) {
	n := len(c)
	switch {
	case c[i] == '/' && fanAt(c, i+1) == '/':
		j := i
		for j < n && c[j] != '\n' {
			j++
		}
		return j, true
	case c[i] == '/' && fanAt(c, i+1) == '*':
		for j := i + 2; j < n-1; j++ {
			if c[j] == '*' && c[j+1] == '/' {
				return j + 2, true
			}
		}
		return n + 2, true
	case c[i] == '/' && fanRegexStart(c, i):
		j, k := i+1, false
		for !(j >= n || !k && c[j] == '/') {
			switch {
			case c[j] == '\\':
				j += 2
			case c[j] == '[':
				k, j = true, j+1
			case c[j] == ']':
				k, j = false, j+1
			default:
				j++
			}
		}
		return j + 1, true
	}
	return 0, false
}

// fanRegexStart: a `/` begins a regex literal when the last non-blank character before it is none or one of `(,=:!&|?{;[`.
func fanRegexStart(c []rune, i int) bool {
	for p := i - 1; p >= 0; p-- {
		if !onigSpace(c[p]) {
			return strings.ContainsRune("(,=:!&|?{;[", c[p])
		}
	}
	return true
}

// fanScan is `scan($c; $from; $mode)`: "comma" stops at the first top-level comma, "bal" at the close of the bracket
// opened at from. The answer is that index, -1 when the enclosing bracket closes first, and -9 when the text ends.
func fanScan(c []rune, from int, mode string) int {
	i, d := from, 0
	var q rune = -1
	r, haveR := 0, false
	for !haveR && i < len(c) {
		ch := c[i]
		switch {
		case q != -1:
			switch {
			case ch == '\\':
				i += 2
			case ch == q:
				q, i = -1, i+1
			default:
				i++
			}
		default:
			if j, ok := fanSkipc(c, i); ok {
				i = j
				continue
			}
			switch {
			case fanQuote(ch):
				q, i = ch, i+1
			case ch == '(' || ch == '[' || ch == '{':
				d, i = d+1, i+1
			case ch == ')' || ch == ']' || ch == '}':
				if d == 0 {
					r, haveR = -1, true
				} else {
					d--
					if mode == "bal" && d == 0 {
						r, haveR = i, true
					}
					i++
				}
			case ch == ',' && d == 0 && mode == "comma":
				r, haveR = i, true
			default:
				i++
			}
		}
	}
	if !haveR {
		return -9
	}
	return r
}

func fanIsID(r rune) bool { // `isid`: the previous character is an identifier character (ASCII)
	return r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '.' || r == '$'
}

// fanCalls is `calls($c)`: the index just after the `(` of every agent( call outside a string or a comment; none when a
// string is left open.
func fanCalls(c []rune) []int {
	var h []int
	i := 0
	var q rune = -1
	for i < len(c) {
		ch := c[i]
		switch {
		case q != -1:
			switch {
			case ch == '\\':
				i += 2
			case ch == q:
				q, i = -1, i+1
			default:
				i++
			}
		default:
			if j, ok := fanSkipc(c, i); ok {
				i = j
				continue
			}
			switch {
			case fanQuote(ch):
				q, i = ch, i+1
			case ch == 'a' && fanIsAgent(c, i) && !(i > 0 && fanIsID(c[i-1])):
				if j := fanWS(c, i+5); fanAt(c, j) == '(' {
					h = append(h, j+1)
					i = j + 1
				} else {
					i += 5
				}
			default:
				i++
			}
		}
	}
	if q != -1 {
		return nil
	}
	return h
}

func fanIsAgent(c []rune, i int) bool { // `($c[.i:.i + 5] | join("")) == "agent"`
	return i+5 <= len(c) && string(c[i:i+5]) == "agent"
}

// fanWS is `ws($c; $i)`: the index of the first non-blank at or after i, else the length.
func fanWS(c []rune, i int) int {
	for ; i < len(c); i++ {
		if !onigSpace(c[i]) {
			return i
		}
	}
	return len(c)
}

// The option tests of judge: a key is a name not glued to an identifier, optionally quoted, then `:`, `,` or `}`
// (shorthand counts). Oniguruma's [[:space:]] is spelled out as the code points it holds.
var (
	fanBlank   = `[\t-\r \x{85}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}]`
	fanQ       = "[\"'`]"
	fanModelRE = regexp.MustCompile("(^|[^A-Za-z0-9_$])" + fanQ + "?model" + fanQ + "?" + fanBlank + "*[:,}]")
	fanEffort  = regexp.MustCompile("(^|[^A-Za-z0-9_$])" + fanQ + "?effort" + fanQ + "?" + fanBlank + "*[:,}]")
	fanHaiku   = regexp.MustCompile("(^|[^A-Za-z0-9_$])" + fanQ + "?model" + fanQ + "?" + fanBlank + "*:" + fanBlank + "*" + fanQ + "(claude-)?haiku")
)

// fanJudge is `judge($c; $h)`: "bad" when this call surely names no model or no effort, else "ok".
func fanJudge(c []rune, h int) string {
	a := fanWS(c, h)
	var o int
	if fanAt(c, a) == '{' {
		o = a
	} else {
		k := fanScan(c, h, "comma")
		switch {
		case k == -9:
			o = -3
		case k < 0:
			if fanAt(c, a) == '.' && fanAt(c, a+1) == '.' {
				o = -3
			} else {
				o = -2
			}
		default:
			b := fanWS(c, k+1)
			switch fanAt(c, b) {
			case '{':
				o = b
			case ')':
				o = -2
			default:
				o = -3
			}
		}
	}
	switch o {
	case -2:
		return "bad"
	case -3:
		return "ok"
	}
	e := fanScan(c, o, "bal")
	if e < 0 {
		return "ok"
	}
	t := string(c[o : e+1])
	if strings.Contains(t, "...") || fanModelRE.MatchString(t) && (fanEffort.MatchString(t) || fanHaiku.MatchString(t)) {
		return "ok"
	}
	return "bad"
}

// onigAlnum is Oniguruma's `[[:alnum:]]` on a code point: Alphabetic (letters, letter numbers, Other_Alphabetic) or a
// decimal digit. Go's tables are Unicode 17, so code points assigned since the jq's Oniguruma are alnum here and not there
// (D-TBD-go-hook-unicode-tables: measured against jq 1.8 over every code point, no code point jq counts is missed).
func onigAlnum(r rune) bool {
	return unicode.IsLetter(r) || unicode.Is(unicode.Nl, r) || unicode.Is(unicode.Other_Alphabetic, r) || unicode.Is(unicode.Nd, r)
}
