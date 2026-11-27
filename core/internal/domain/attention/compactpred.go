package attention

import (
	"math"
	"sort"
	"strings"
	"unicode/utf8"

	"ccrc/core/internal/kernel"
)

// The PostCompact gates (ccd/session-hook.sh: JOURNAL_RECORD_PRED_DEFS, JOURNAL_STAGE_PRED, COMPACT_SHAPE_PRED and the
// `#@compact-post-norm` decision), each a jq program the bash runs under `-e`, ported over the kernel's jq values and held
// to real jq by testdata/compact.golden. jq's `and`/`or` short-circuit; every program here guards its paths by type, so
// the only runtime errors are `.x` of a value that is neither an object nor null, which jq reports and `-e` reads as a
// failure.

// jqE is `jq -e <prog>` over every value it read (parseErr: text it could not read followed them), where f answers one
// value with one output: jq 1.7's main keeps the LAST value's answer (0 truthy, 1 false or null, 5 a runtime error, so
// an earlier error is forgotten), 2 for unreadable text, and 4 for no value at all.
func jqE(vs []any, parseErr bool, f func(any) (bool, error)) int {
	rc := 4
	for _, v := range vs {
		switch b, err := f(v); {
		case err != nil:
			rc = 5
		case b:
			rc = 0
		default:
			rc = 1
		}
	}
	if parseErr {
		return 2
	}
	return rc
}

// field is `.k` on an object or null; an error on anything else.
func jqField(v any, k string) (any, error) { return index(v, k) }

func isNum(v any) (float64, bool) {
	if typeName(v) != "number" {
		return 0, false
	}
	return num(v)
}

// nonnegInt is NONNEG_INT: `type == "number" and . >= 0 and floor == .`.
func nonnegInt(v any) bool {
	f, ok := isNum(v)
	return ok && jqCmp(f, 0) >= 0 && numEq(math.Floor(f), f)
}

// nonemptyString is NONEMPTY_STRING (length is code points).
func nonemptyString(v any) bool { s, ok := v.(string); return ok && s != "" }

var (
	safeAgentRE = re(`\A[A-Za-z0-9_-]+\z`)
	builtRE     = re(`\A[0-9a-f]{7,40}\z`)
)

// safeAgent is SAFE_AGENT.
func safeAgent(v any) bool {
	s, ok := v.(string)
	n := utf8.RuneCountInString(s)
	return ok && n >= 1 && n <= 128 && safeAgentRE().MatchString(s)
}

// built is BUILT.
func builtShape(v any) bool { s, ok := v.(string); return ok && builtRE().MatchString(s) }

// isNull, isBool, numIs are the predicates' leaf tests.
func isNull(v any) bool { return v == nil }
func numIs(v any, n float64) bool {
	f, ok := isNum(v)
	return ok && numEq(f, n)
}

// get1 is `$o.k` where the caller knows $o is an object or null.
func get1(o any, k string) any { v, _ := index(o, k); return v }

// nullProvenance is NULL_PROVENANCE (over an object).
func nullProvenance(o any) bool {
	for _, k := range []string{"cwd", "built", "agent", "transcript", "parentLive", "liveAgents"} {
		if get1(o, k) != nil {
			return false
		}
	}
	return true
}

// normalProvenance is NORMAL_PROVENANCE: the per-field shapes, then §3.0's four rows. o is an object or null.
func normalProvenance(o any) bool {
	cwd, b, ag := get1(o, "cwd"), get1(o, "built"), get1(o, "agent")
	tr, pl, ln := get1(o, "transcript"), get1(o, "parentLive"), get1(o, "liveAgents")
	trig, sc := get1(o, "trigger"), get1(o, "scope")
	if !(isNull(cwd) || nonemptyString(cwd)) ||
		!(isNull(b) || builtShape(b) && !isNull(cwd)) ||
		!(isNull(ag) || safeAgent(ag)) ||
		!(isNull(tr) || nonemptyString(tr)) ||
		!(isNull(pl) || typeName(pl) == "boolean") ||
		!(isNull(ln) || nonnegInt(ln)) {
		return false
	}
	is := func(v any, s string) bool { return equal(v, s) }
	switch {
	case is(trig, "manual") && is(sc, "main") && isNull(ag) && nonemptyString(tr) && isNull(pl) && isNull(ln):
		return true
	case is(trig, "auto") && is(sc, "main") && isNull(ag) && nonemptyString(tr) && isNull(pl) && numIs(ln, 0):
		return true
	case is(trig, "auto") && is(sc, "subagent") && safeAgent(ag) && nonemptyString(tr) && equal(pl, false) && numIs(ln, 1):
		return true
	case is(trig, "auto") && is(sc, "ambiguous") && isNull(ag) && isNull(tr):
		if equal(pl, true) && numIs(ln, 1) {
			return true
		}
		if f, ok := isNum(ln); ok && isNull(pl) && nonnegInt(ln) && jqCmp(f, 2) >= 0 {
			return true
		}
	}
	return false
}

// recordKeys is the record's sixteen keys, sorted.
var recordKeys = []string{"agent", "at", "built", "chars", "cited", "cwd", "fences", "filesChars", "liveAgents",
	"parentLive", "scope", "served", "setSize", "steered", "transcript", "trigger"}

// JournalRecord is JOURNAL_RECORD_PRED.
func JournalRecord(v any) bool {
	o, ok := v.(kernel.Obj)
	if !ok {
		return false
	}
	keys := make([]string, 0, len(o))
	for _, kv := range o {
		keys = append(keys, kv.K)
	}
	sort.Strings(keys)
	if strings.Join(keys, "\x00") != strings.Join(recordKeys, "\x00") {
		return false
	}
	g := func(k string) any { return get1(o, k) }
	if !nonnegInt(g("at")) || !nonnegInt(g("chars")) || !nonnegInt(g("fences")) {
		return false
	}
	if fc := g("filesChars"); !isNull(fc) {
		a, _ := isNum(fc)
		c, cok := isNum(g("chars"))
		if !nonnegInt(fc) || !cok || jqCmp(a, c) > 0 {
			return false
		}
	}
	ci, ss := g("cited"), g("setSize")
	if !(isNull(ci) && isNull(ss)) {
		a, _ := isNum(ci)
		b, _ := isNum(ss)
		if !nonnegInt(ci) || !nonnegInt(ss) || jqCmp(a, b) > 0 {
			return false
		}
	}
	tg, sc := g("trigger"), g("scope")
	if !equal(tg, "auto") && !equal(tg, "manual") {
		return false
	}
	if !equal(sc, "main") && !equal(sc, "subagent") && !equal(sc, "ambiguous") && !isNull(sc) {
		return false
	}
	if typeName(g("steered")) != "boolean" || typeName(g("served")) != "boolean" {
		return false
	}
	return normalProvenance(o) ||
		nullProvenance(o) && (isNull(sc) || equal(sc, "ambiguous")) && isNull(ci) && isNull(ss)
}

// CompactShape is COMPACT_SHAPE_PRED.
func CompactShape(v any) bool {
	o, ok := v.(kernel.Obj)
	if !ok {
		return false
	}
	g := func(k string) any { return get1(o, k) }
	numOrNull := func(k string) bool { return typeName(g(k)) == "number" || isNull(g(k)) }
	return typeName(g("chars")) == "number" && typeName(g("fences")) == "number" && typeName(g("at")) == "number" &&
		(equal(g("trigger"), "auto") || equal(g("trigger"), "manual")) &&
		typeName(g("steered")) == "boolean" && typeName(g("served")) == "boolean" &&
		numOrNull("filesChars") && numOrNull("cited") && numOrNull("setSize") &&
		(equal(g("scope"), "main") || equal(g("scope"), "subagent") || equal(g("scope"), "ambiguous") || isNull(g("scope")))
}

// MeasOne is `printf '%s' "$meas" | jq -ce -s "length == 1 and (.[0] | $COMPACT_SHAPE_PRED)"`: exactly one document,
// of the shape.
func MeasOne(meas string) bool {
	vs, err := kernel.JQParseAll([]byte(meas))
	return err == nil && len(vs) == 1 && CompactShape(vs[0])
}

// overlapTrue is `.overlap == true`.
func overlapTrue(v any) (bool, error) {
	o, err := jqField(v, "overlap")
	return equal(o, true), err
}

// PostNorm is the `#@compact-post-norm` decision over a claimed snapshot: "" for an ordinary, provenance-eligible
// claim (measured with `--set`), else the one scope the normalised record commits: "null" (aged, or failing the
// provenance or `files` gates) or "ambiguous" (an overlap-forced set). Age is asked first and wins.
func PostNorm(snap []byte, aged bool, trig string) string {
	if aged {
		return "null"
	}
	if overlapRC(snap) == 0 {
		return "ambiguous"
	}
	if normRC(snap, trig) != 0 {
		return "null"
	}
	return ""
}

// overlapRC is `jq -e '.overlap == true' "$snap"`'s exit status.
func overlapRC(snap []byte) int {
	vs, err := kernel.JQParseAll(snap)
	return jqE(vs, err != nil, overlapTrue)
}

// normRC is the provenance and `files` gate's exit status (`jq -e --arg trig … "$snap"`).
func normRC(snap []byte, trig string) int {
	vs, err := kernel.JQParseAll(snap)
	ok := func(v any) (bool, error) {
		ov, err := jqField(v, "overlap")
		if err != nil {
			return false, err
		}
		if !(isNull(ov) || equal(ov, false)) {
			return false, nil
		}
		var m any
		switch o := v.(type) {
		case nil:
			m = kernel.Obj{{K: "trigger", V: trig}}
		case kernel.Obj:
			m = set(o, "trigger", trig)
		}
		if !normalProvenance(m) {
			return false, nil
		}
		fs, _ := jqField(v, "files")
		if isNull(fs) {
			return true, nil
		}
		arr, isArr := fs.([]any)
		if !isArr {
			return false, nil
		}
		for _, e := range arr {
			eo, isObj := e.(kernel.Obj)
			if !isObj {
				return false, nil
			}
			if p, isStr := get1(eo, "path").(string); !isStr || p == "" {
				return false, nil
			}
		}
		return true, nil
	}
	return jqE(vs, err != nil, ok)
}

// Record is the sixteen-key record: the helper's measurement enriched with the claim's six provenance fields (snap
// given and norm "") or six nulls and the normalised scope, with `served` marker-derived either way. ok false is the
// program failing (`|| rec=""`).
func Record(meas string, snap []byte, useSet bool, served bool, norm string) (string, bool) {
	m, err := kernel.JQParse([]byte(meas))
	mo, isObj := m.(kernel.Obj)
	if err != nil || !isObj && m != nil {
		return "", false
	}
	var add kernel.Obj
	if useSet {
		vs, err := kernel.JQParseAll(snap) // `--slurpfile s`: unreadable text fails the program
		if err != nil {
			return "", false
		}
		var s any // `$s[0]` of an empty file is null
		if len(vs) > 0 {
			s = vs[0]
		}
		if _, ok := s.(kernel.Obj); !ok && s != nil {
			return "", false
		}
		add = kernel.Obj{{K: "served", V: served}}
		for _, k := range []string{"cwd", "built", "agent", "transcript", "parentLive", "liveAgents"} {
			add = append(add, kernel.KV{K: k, V: get1(s, k)})
		}
	} else {
		var sc any
		if norm == "ambiguous" {
			sc = "ambiguous"
		}
		add = kernel.Obj{{K: "served", V: served}, {K: "scope", V: sc}}
		for _, k := range []string{"cwd", "built", "agent", "transcript", "parentLive", "liveAgents"} {
			add = append(add, kernel.KV{K: k, V: nil})
		}
	}
	out := append(kernel.Obj(nil), mo...)
	for _, kv := range add {
		out = set(out, kv.K, kv.V)
	}
	return string(kernel.JQCompact(out)), true
}

// RecordOK is `printf '%s' "$rec" | jq -ce "$JOURNAL_RECORD_PRED_DEFS JOURNAL_RECORD_PRED"`.
func RecordOK(rec string) bool {
	vs, err := kernel.JQParseAll([]byte(rec))
	return jqE(vs, err != nil, func(v any) (bool, error) { return JournalRecord(v), nil }) == 0
}

// StageOK is JOURNAL_STAGE_PRED over the staged file's raw bytes (`jq -R -s`: one string, made UTF-8), with $old (the
// pre-append bytes as the bash's `$( )` kept them) and $rec through --arg: every line a record, one LF at the end, the
// old bytes its exact prefix, and exactly this record plus one LF added.
func StageOK(stage []byte, old, rec string) bool {
	raw := kernel.JQRepair(stage)
	o, r := kernel.JQRepair([]byte(old)), kernel.JQRepair([]byte(rec))
	if !strings.HasSuffix(raw, "\n") || !strings.HasPrefix(raw, o) {
		return false
	}
	if utf8.RuneCountInString(raw) != utf8.RuneCountInString(o)+utf8.RuneCountInString(r)+1 {
		return false
	}
	lines := strings.Split(raw, "\n")
	lines = lines[:len(lines)-1]
	if len(lines) == 0 {
		return false
	}
	for _, l := range lines {
		if l == "" {
			return false
		}
		v, err := kernel.JQParse([]byte(l))
		if err != nil || !JournalRecord(v) {
			return false
		}
	}
	return lines[len(lines)-1] == r
}
