package attention

import (
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
)

// The SessionStart card's standing subjects (ccd/session-hook.sh): the graphify card (`_hook_graph_card`), the program
// subject (`_hook_hold_card`), the co-tenant subject (`_hook_ccrc_card` over `_ct_probe`) and, beside RoleCard, their
// join. Each decides from what the caller read, as the bash reads it; none reads anything itself.

const (
	ccrcFreshS = 120       // CCRC_FRESH_S: SUPERVISED_FRESH_MS in seconds
	wdMax      = idMax - 1 // CCRC_WD_MAX
	sweepClip  = 400       // `${row:0:400}`
)

// Standing is the arm's join of the four standing subjects: `CARD="$CARD_GRAPH"`, then each non-empty one after a space.
func Standing(graph, hold, role, ccrc string) string {
	card := graph
	for _, s := range []string{hold, role, ccrc} {
		if s != "" {
			card = join(card, " ", s)
		}
	}
	return card
}

// GraphCard is `_hook_graph_card` over the measurement (rc 0 a graph, 1 none, 2 no tree): row is the sweep census's
// word about this tree (SweepRow), gateOff the operator's graph-gate-off file.
func GraphCard(g Graph, rc int, row string, gateOff, utf bool) string {
	switch rc {
	case 2:
		return ""
	case 1:
		if row == "" {
			return ""
		}
		return "graphify: this tree has no knowledge graph — the ccrc sweep's last pass says " + Clip(row, sweepClip, utf) +
			". Do not build one here; the sweep owns the write side."
	}
	line := "graphify: this tree has a knowledge graph — graphify-out/"
	if g.Linked {
		line += " is the graph of this repository's main at " + Clip(g.Built, 8, utf)
	}
	if g.Nodes != "" {
		line += ", " + g.Nodes + " nodes"
	}
	if !g.Linked && g.Built != "" {
		line += ", built at " + Clip(g.Built, 8, utf)
	}
	if !g.Linked && g.Fresh != "" {
		line += " (" + g.Fresh + ")"
	}
	if g.Engine != "" {
		line += ", engine " + g.Engine
	}
	if g.Pin != "" {
		line += " (pin " + g.Pin + ")"
	}
	if g.Linked {
		if age := graphAge(g.Age); age != "" {
			line += ", refreshed " + age + " ago"
		}
		if g.MainMoved != "" {
			line += "; main has moved " + g.MainMoved + " commit" + plural(g.MainMoved) + " since"
		}
		if g.Diff == "0" {
			line += ". Your tree does not differ from it"
		} else if g.Diff != "" {
			line += ". Your tree differs from it in " + g.Diff + " file" + plural(g.Diff) + ", " + g.Branch +
				" of them your branch's own: " + g.DiffList + " — read those directly"
		}
	}
	line += ". Answer codebase questions with `graphify query \"<question>\"` first; `graphify path \"<A>\" \"<B>\"` for relationships and `graphify explain \"<concept>\"` for one concept; read `graphify-out/GRAPH_REPORT.md` only for broad architecture. Do not run `graphify update` or any build here — the ccrc sweep owns the write side."
	if g.GateTree() {
		if gateOff {
			line += " Search tools are not gated here: the search gate is off (operator file)."
		} else {
			line += " Search tools (Grep, Glob, shell grep/rg/find) are gated, and source-file reads are nudged, until this session's first answered graph query."
		}
	}
	return line
}

// plural is `$([ "$n" = 1 ] || echo s)`.
func plural(n string) string {
	if n == "1" {
		return ""
	}
	return "s"
}

// graphAge is the card's age word: seconds under 120, minutes under 7200, hours under 172800, else days (the meta's age
// is a decimal of at most 12 digits, never negative: graphmeasure's metaAge).
func graphAge(age string) string {
	if age == "" {
		return ""
	}
	n, err := strconv.ParseInt(age, 10, 64)
	if err != nil {
		return ""
	}
	switch {
	case n < 120:
		return age + "s"
	case n < 7200:
		return strconv.FormatInt(n/60, 10) + "m"
	case n < 172800:
		return strconv.FormatInt(n/3600, 10) + "h"
	}
	return strconv.FormatInt(n/86400, 10) + "d"
}

// SweepRow is the census read, `jq -r --arg s "$src" '<program>' graph-sweep.json` as `$( ) || row=""` keeps it: the
// last pass's repository row whose source is src and whose reason is said, as `<outcome>: <reason>`. Every value in the
// file runs the program; a file that does not parse whole, or any value the program errors on, is no row at all (jq then
// exits non-zero). ok is whether the file could be opened as a file jq reads.
func SweepRow(data []byte, ok bool, src string) string {
	if !ok {
		return ""
	}
	vs, err := kernel.JQParseAll(data)
	if err != nil {
		return ""
	}
	s := kernel.JQRepair([]byte(src)) // `--arg`: bytes that are not UTF-8 are read as jq reads them
	var outs []string
	for _, v := range vs {
		out, has, ok := sweepOne(v, s)
		if !ok {
			return ""
		}
		if has {
			outs = append(outs, out)
		}
	}
	return cmdSub(strings.Join(outs, "\n"))
}

// sweepOne is the program over one value: its output (has false: none), or ok false where jq errors.
//
//	(.passes // []) | last | (. // {}) | [(.repos // [])[] | select($s != "" and .source == $s)]
//	| map(select((.reason // "") != "")) | if length == 0 then empty else (.[0].outcome + ": " + .[0].reason) end
func sweepOne(v any, s string) (out string, has, ok bool) {
	passes, err := index(v, "passes")
	if err != nil {
		return "", false, false
	}
	var last any
	switch p := or(passes, []any{}).(type) { // `last` is `.[-1]`
	case []any:
		if len(p) > 0 {
			last = p[len(p)-1]
		}
	case nil:
	default:
		return "", false, false
	}
	repos, err := index(or(last, kernel.Obj{}), "repos")
	if err != nil {
		return "", false, false
	}
	var items []any
	switch r := or(repos, []any{}).(type) {
	case []any:
		items = r
	case kernel.Obj:
		for _, kv := range r {
			items = append(items, kv.V)
		}
	default:
		return "", false, false
	}
	var sel []any
	for _, e := range items {
		if s == "" { // `and` stops at a false left side: .source is never asked
			continue
		}
		src, err := index(e, "source")
		if err != nil {
			return "", false, false
		}
		if src2, isStr := src.(string); isStr && src2 == s {
			sel = append(sel, e)
		}
	}
	var said []any
	for _, e := range sel {
		r := or(get(e, "reason"), "")
		if r2, isStr := r.(string); !isStr || r2 != "" {
			said = append(said, e)
		}
	}
	if len(said) == 0 {
		return "", false, true
	}
	// `+`: null + x is x, string + string concatenates, anything else is an error
	head := ""
	switch o := get(said[0], "outcome").(type) {
	case nil:
	case string:
		head = o
	default:
		return "", false, false
	}
	reason, isStr := get(said[0], "reason").(string)
	if !isStr {
		return "", false, false
	}
	return head + ": " + reason, true, true
}

// HoldCard is `_hook_hold_card` (the kill switch is the caller's): the hold read through the registry's `_ct_read`, quoted
// only when it is the wave shape and short enough to have been read whole; an unreadable or empty hold still reads as
// HELD. cwd is the graph measurement's GM_CWD ("" when it found no tree), which the workspace's own workdir must agree
// with for the card to say "this workspace".
func HoldCard(id string, rd RegRead, exists func(name string) bool, cwd string, utf bool) string {
	b, rc := rd(id + ".hold")
	switch rc {
	case 1:
		return ""
	case 2:
		return "ccrc-program: this workspace is held and the hold's reason could not be read — `~/.cc-sessions/" + id + ".hold` exists but is not a readable file. Every other reader on this box treats that as HELD. If a program wave is running here, `~/.local/bin/ccrc-api runs list` is the only thing that can say so."
	}
	h, _ := ctRead(b, utf)
	if h == "" {
		return "ccrc-program: this workspace is held and the hold names no program — `~/.cc-sessions/" + id + ".hold` is present, readable, and carries no reason. `ccd ws-hold` refuses to write one that way, so a `touch` or a hand-edit did. Every other reader on this box treats a present `.hold` as HELD. If a program wave is running here, `~/.local/bin/ccrc-api runs list` is the only thing that can say so."
	}
	if Chars(h, utf) > holdMax || !holdWaveRE().MatchString(h) {
		return ""
	}
	if exists(id + ".archived") {
		return "ccrc-program: this workspace is stamped ARCHIVED and still carries a claim — `~/.cc-sessions/" + id + ".hold` reads `" + h + "`. An archive does not clear a hold, so those bytes are the residue of a claim, not an assignment. Take that to the operator rather than starting a wave on it."
	}
	wd := ""
	if wb, rc := rd(id + ".workdir"); rc == 0 {
		wd, _ = ctRead(wb, utf)
	}
	if Chars(wd, utf) > wdMax || !wdClass(wd) {
		wd = ""
	}
	subj := "this workspace"
	if cwd == "" || wd != "" && cwd != wd {
		subj = "the workspace `" + id + "`"
		if wd != "" {
			subj += " (`" + wd + "`)"
		}
	}
	if !strings.Contains(h, " run:") {
		return "ccrc-program: " + subj + " is claimed — `~/.cc-sessions/" + id + ".hold` reads `" + h + "`, which names a program and a wave — what the `ccrc-worker` skill is for. It names NO run: a close claimed this workspace for a next wave, or a human wrote it by hand — no dispatch placed it. Run `~/.local/bin/ccrc-api runs list` before acting on it; whether any run is open, and whether a brief was sent, are answered there and never by this file."
	}
	return "ccrc-program: " + subj + " is claimed — `~/.cc-sessions/" + id + ".hold` reads `" + h + "`, which names a program and a wave — what the `ccrc-worker` skill is for. Run that skill. Any brief sent to you is listed by `~/.local/bin/ccrc-api mail list --to " + id + "`, and one you already acked is not listed again — the plan it named is the durable record. The hold can outlive the run that wrote it: whether that run is still open, and whether any brief was sent, are answered only by `~/.local/bin/ccrc-api runs list`, never by this file."
}

// wdClass is `case "$wd" in *[!$CCRC_WD_CLASS]*) …`: every character a `/` or in CCRC_PROJ_CLASS.
func wdClass(v string) bool { return projClass(strings.ReplaceAll(v, "/", "")) }

// CcrcCard is `_hook_ccrc_card` over `_ct_probe` (the kill switch is the caller's): how many OTHER rows of the fleet
// (rows is every `$REG/*.uuid` name less its suffix) name this row's project and carry a fresh supervisor heartbeat, and
// whether any row could not be measured ("at least"). No local file says "live"; the card says what the registry proved.
func CcrcCard(id string, rows []string, rd RegRead, nowSec int64, utf bool) string {
	b, rc := rd(id + ".project")
	if rc == 2 {
		return ""
	}
	me, _ := ctRead(b, utf)
	if me == "" {
		me = id
	}
	if !projClass(me) || Chars(me, utf) > projMax {
		return ""
	}
	n, u := 0, 0
	for _, o := range rows {
		if o == id || o == "" || !projClass(o) || Chars(o, utf) > idMax {
			continue
		}
		b, rc := rd(o + ".project")
		if rc == 2 {
			u++
			continue
		}
		p, _ := ctRead(b, utf)
		if p == "" {
			p = o
		}
		if p != me {
			continue
		}
		b, rc = rd(o + ".supervised")
		if rc == 1 {
			continue
		}
		v, _ := ctRead(b, utf)
		if rc == 2 || v == "" || strings.Trim(v, "0123456789") != "" {
			u++
			continue
		}
		if d := nowSec - decimalWrap(v); d >= 0 && d < ccrcFreshS {
			n++
		}
	}
	if n == 0 {
		return ""
	}
	rows2 := "other supervised rows name"
	if n == 1 {
		rows2 = "other supervised row names"
	}
	least := ""
	if u != 0 {
		least = "at least "
	}
	return "ccrc: " + least + strconv.Itoa(n) + " " + rows2 + " project `" + me + "`; `~/.local/bin/ccrc-api peers list --of " + id + "` names them and returns the five peer rules."
}

// decimalWrap is bash's `10#<digits>`: a 64-bit integer, wrapping past its range as bash's arithmetic does.
func decimalWrap(s string) int64 {
	var v int64
	for i := 0; i < len(s); i++ {
		v = v*10 + int64(s[i]-'0')
	}
	return v
}
