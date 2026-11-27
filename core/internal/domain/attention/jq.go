// Package attention is ring L1 for the session hook's decisions (Attention & Notification): what an event means for the
// session's state, the hookstate and turn-marker lines, and the reads of the files the hook keeps. It is pure: bytes in,
// bytes or words out. Its values are the kernel's jq values (kernel.JQParse), and each rule below names the jq program
// in ccd/session-hook.sh it stands in for: the bash is the specification, including its quirks (spec 2026-11-24 §6).
package attention

import (
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"ccrc/core/internal/kernel"
)

// errJQ is a jq runtime error: the program stops and prints nothing more, so the bash's reader takes what came before.
var errJQ = errors.New("jq error")

// index is jq's `.k`: null on null, the member (or null) on an object, an error on anything else.
func index(v any, k string) (any, error) {
	switch o := v.(type) {
	case nil:
		return nil, nil
	case kernel.Obj:
		for _, kv := range o {
			if kv.K == k {
				return kv.V, nil
			}
		}
		return nil, nil
	}
	return nil, errJQ
}

// path is `.a.b.c`.
func path(v any, ks ...string) (any, error) {
	for _, k := range ks {
		var err error
		if v, err = index(v, k); err != nil {
			return nil, err
		}
	}
	return v, nil
}

// get is `.a.b.c?`: an error reads as null (where the bash's `try … catch` or a fallback makes it one).
func get(v any, ks ...string) any {
	v, _ = path(v, ks...)
	return v
}

// truthy is what `//` keeps: anything but null and false.
func truthy(v any) bool { return v != nil && v != false }

// or is `a // b` over values already computed (jq's `//` does not catch an error on its left: errors are the caller's).
func or(a, b any) any {
	if truthy(a) {
		return a
	}
	return b
}

func typeName(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case string:
		return "string"
	case json.Number, float64, int, int64:
		return "number"
	case []any, []string:
		return "array"
	case kernel.Obj:
		return "object"
	}
	return ""
}

// tostring is jq's: a string as it is, anything else its compact JSON.
func tostring(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return string(kernel.JQCompact(v))
}

// num is a number's double, as jq computes with it.
func num(v any) (float64, bool) {
	switch n := v.(type) {
	case json.Number:
		f, err := strconv.ParseFloat(string(n), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return 0, false
		}
		return f, true
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// floorText is `floor | tostring` of a number: what jq prints for the double it computes.
func floorText(v any) (string, bool) {
	f, ok := num(v)
	if !ok {
		return "", false
	}
	return kernel.JQDouble(math.Floor(f)), true
}

// equal is jq's `==`: numbers by value, objects by their members whatever their order, the rest by content.
func equal(a, b any) bool {
	if x, ok := num(a); ok {
		y, ok := num(b)
		return ok && x == y
	}
	switch x := a.(type) {
	case nil, bool, string:
		return a == b
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !equal(x[i], y[i]) {
				return false
			}
		}
		return true
	case kernel.Obj:
		y, ok := b.(kernel.Obj)
		if !ok || len(x) != len(y) {
			return false
		}
		for _, kv := range x {
			w, err := index(y, kv.K)
			if err != nil || !has(y, kv.K) || !equal(kv.V, w) {
				return false
			}
		}
		return true
	}
	return false
}

func has(o kernel.Obj, k string) bool {
	for _, kv := range o {
		if kv.K == k {
			return true
		}
	}
	return false
}

// set is `. + {k: v}` for one member: a key already there keeps its place and takes v, as jq's objects do.
func set(o kernel.Obj, k string, v any) kernel.Obj {
	out := append(kernel.Obj(nil), o...)
	for i := range out {
		if out[i].K == k {
			out[i].V = v
			return out
		}
	}
	return append(out, kernel.KV{K: k, V: v})
}

// cut is `.[0:n]` of a string: n code points.
func cut(s string, n int) string {
	i := 0
	for j := range s {
		if i == n {
			return s[:j]
		}
		i++
	}
	return s
}

// keep is the hook's `keep(f)`: the code points of s that f keeps.
func keep(s string, f func(rune) bool) string {
	var b strings.Builder
	for _, r := range s {
		if f(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func alpha(r rune) bool { return r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' }

// idch is the parse's `idch`: [A-Za-z0-9_-].
func idch(r rune) bool { return alpha(r) || r >= '0' && r <= '9' || r == '_' || r == '-' }

// isID is the parse's id rule: a string of 1 to 64 idch code points.
func isID(v any) bool {
	s, ok := v.(string)
	n := utf8.RuneCountInString(s)
	return ok && n >= 1 && n <= 64 && keep(s, idch) == s
}

// uniqueSorted is jq's `unique` over strings: sorted by code point, each once.
func uniqueSorted(xs []string) []string {
	out := append([]string(nil), xs...)
	sort.Strings(out) // UTF-8 byte order is code point order
	n := 0
	for i, x := range out {
		if i == 0 || x != out[n-1] {
			out[n] = x
			n++
		}
	}
	return out[:n]
}

// readLines is what the bash's `{ read -r a; read -r b; … } < <(jq -r …)` sees: the outputs jq printed before any error,
// one per line, split again at every newline a raw string carries (the positional shift D-1249 orders its fields
// against), and each trimmed of the spaces and tabs a `read` with the default IFS trims. Missing lines read as "".
func readLines(outs []string, n int) []string {
	got := []string{}
	if len(outs) > 0 {
		got = strings.Split(strings.Join(outs, "\n"), "\n")
	}
	out := make([]string, n)
	for i := 0; i < n && i < len(got); i++ {
		out[i] = strings.Trim(got[i], " \t")
	}
	return out
}

// rawOut is one `jq -r` output: a string raw, anything else its compact JSON.
func rawOut(v any) string { return tostring(v) }

// subst is what `$( … )` keeps of a program's output: every trailing newline cut.
func subst(s string) string { return strings.TrimRight(s, "\n") }
