package attention

import (
	"math"
	pathpkg "path"
	"strconv"
	"strings"
	"time"

	"ccrc/core/internal/kernel"
)

// The compaction arms' decisions (ccd/session-hook.sh, spec 2026-09-09-graphify-compaction-card-design.md §3, D-2605):
// the scope rule, the private family grammar, the stable lock's caller policy, the set document and its nonce, the
// card's read, and the shapes PostCompact gates on. Pure: the caller (app/hook) measures and acts.

// The arms' bounds, in the bash's units.
const (
	CompactCardMaxAge    = 1200 // COMPACT_CARD_MAX_AGE, seconds (find -mmin over its minutes)
	CompactLiveS         = 120  // COMPACT_LIVE_S
	CompactHelperTimeout = 8 * time.Second
	CompactWorksetMax    = 12
	// The two stable-lock waits, COMPACT_LOCK_WAIT (every acquisition but one) and COMPACT_LOCK_WAIT_SERVE (compact
	// SessionStart's: a human waits on it).
	CompactLockWait      = 5 * time.Second
	CompactLockWaitServe = 2 * time.Second
	PrecompactKeep       = 32  // PRECOMPACT_KEEP
	HistoryCardMax       = 512 // HISTORY_CARD_MAX
	cardReadMax          = CompactCardMaxChars + 64
	headReadMax          = 4096
)

// THE HOOK'S LOCK POLICY, legitimately different from ccd's (spec 2026-11-24 §3, "Consolidate, don't duplicate"): the
// mechanism is adapter/lock's one owner, which ccd blocks on and reports; the hook's contract is exit 0 on every path
// (its header), so every outcome but an acquisition (app/hook#acquire answers nil) is a silent return that publishes
// nothing, a missing mechanism (this probe) included (spec §3.4 "Platform outcome": fail closed); the adapter keeps
// Refused and Vanished apart where they are measured.
//
// LockMechanism is the acquire's probe: whether the bash's three tools are on PATH (the Go hook needs none of them, but
// a box the bash would refuse the Go hook refuses too).
func LockMechanism(found func(string) bool) bool {
	return found("flock") && found("mktemp") && found("link")
}

// LockVanished is `_hook_lock_vanished`'s verdict for an absent canonical: a LATER disappearance (refuse) when an
// acquisition's alias stands in $REG, or, on a row with a generation, a box with /proc and find on PATH, when a live
// descriptor names an alias (procNames, the one expensive read, asked last). Anything else is a first-ever mint. Where
// /proc is absent (Darwin) the rule is not enforced, as the bash records.
func LockVanished(aliasPresent, genPresent, procDir, find bool, procNames func() bool) bool {
	if aliasPresent {
		return true
	}
	return genPresent && procDir && find && procNames()
}

// FamilySweepable is `_hook_family_sweepable`: whether a basename, its literal `.<id>.` prefix stripped, is this row's
// private compaction residue that an aged, locked sweep may remove. The permanent lock never is.
func FamilySweepable(s string) bool {
	glob := func(pat string) bool { return pathGlob(pat, s) }
	switch {
	case s == "compactions.lock":
		return false
	case glob("compactset.*.stage"), glob("compactcard.*.stage"),
		glob("compactset.*.stage.part"), glob("compactcard.*.stage.part"),
		glob("compactset.*.hook-write.tmp"), glob("compactcard.*.hook-write.tmp"),
		glob("compactcard.*.session-claim.tmp"), glob("compactpost.*.claim"),
		glob("compactions.lock-init.*"), glob("compactions.lock-open.*"),
		glob("compactserved-source.*"), glob("compactserved.*"),
		glob("generation-init.*"), glob("generation-read.*"),
		glob("compactions-stage.*.tmp"), glob("compactions-snapshot.*.tmp"):
		return true
	case glob("*.compactset.tmp"):
		return decimalHead(s)
	case glob("*.compactcard-claim.tmp"):
		_, rest, _ := strings.Cut(s, ".")
		return rest == "compactcard-claim.tmp" && decimalHead(s)
	}
	return false
}

// decimalHead is `[[ "${s%%.*}" =~ ^[0-9]+$ ]]`.
func decimalHead(s string) bool {
	h, _, _ := strings.Cut(s, ".")
	return h != "" && strings.Trim(h, "0123456789") == ""
}

// pathGlob is a shell `*`/`?`/`[…]` pattern as `case` and find's `-name` read it (path.Match: `*` never crosses a `/`,
// which a basename holds none of).
func pathGlob(pat, s string) bool { ok, _ := pathpkg.Match(pat, s); return ok }

// Younger is `find p -mmin -<mins>`: modified less than mins minutes before now (an mtime in the future too); Older is
// `-mmin +<mins>`: more than mins minutes. Measured on GNU find 4.9: exact, to the nanosecond, both bounds strict.
func Younger(now, mtime time.Time, mins int) bool {
	return now.Sub(mtime) < time.Duration(mins)*time.Minute
}
func Older(now, mtime time.Time, mins int) bool {
	return now.Sub(mtime) > time.Duration(mins)*time.Minute
}

// Entry is one name a `find` walk met: its path, base name and lstat mtime.
type Entry struct {
	Path  string
	MTime time.Time
}

// ScopeIn is what `_hook_compact_scope` measures.
type ScopeIn struct {
	TP, Trig     string
	TPReadable   bool              // `-n tp && -f tp && -r tp`
	Find         bool              // `command -v find`
	Agents       []Entry           // `find <tp less .jsonl>/subagents -name …` met these (every name; the filter is here)
	TPMTime      time.Time         // tp's own lstat mtime
	TPMTimeOK    bool              // tp could be lstat'ed (`find "$tp"` names it)
	LiveReadable func(string) bool // `-f p && -r p`
	Now          time.Time
	UTF8         bool
}

// Scope is the rule's answer: CS_SCOPE, CS_TRANSCRIPT, CS_AGENT, CS_LIVE_N, CS_PARENT_LIVE as the bash spells them
// (an empty word is unset or no verdict); OK false is the rule's rc 1, "nothing may be said".
type Scope struct {
	Scope, Transcript, Agent, LiveN, ParentLive string
	OK                                          bool
}

// CompactScope is `_hook_compact_scope`: main, subagent or ambiguous, from the transcripts' liveness (spec §3.0).
func CompactScope(in ScopeIn) Scope {
	mins := CompactLiveS / 60
	if !in.TPReadable || !in.Find {
		return Scope{}
	}
	if in.Trig == "manual" {
		return Scope{Scope: "main", Transcript: in.TP, OK: true}
	}
	n, live := 0, ""
	for _, e := range in.Agents {
		if pathGlob("agent-*.jsonl", pathpkg.Base(e.Path)) && Younger(in.Now, e.MTime, mins) {
			n++
			live = e.Path
		}
	}
	s := Scope{LiveN: strconv.Itoa(n)}
	switch {
	case n == 0:
		s.Scope, s.Transcript, s.OK = "main", in.TP, true
		return s
	case n > 1:
		s.Scope, s.OK = "ambiguous", true
		return s
	}
	if in.TPMTimeOK && Younger(in.Now, in.TPMTime, mins) {
		s.ParentLive, s.Scope, s.OK = "true", "ambiguous", true
		return s
	}
	s.ParentLive = "false"
	if !in.LiveReadable(live) {
		return s
	}
	f := strings.TrimSuffix(strings.TrimPrefix(pathpkg.Base(live), "agent-"), ".jsonl")
	if f == "" || keep(f, idch) != f || Chars(f, in.UTF8) > idMax {
		return s
	}
	s.Scope, s.Transcript, s.Agent, s.OK = "subagent", live, f, true
	return s
}

// SubagentsDir is `${tp%.jsonl}/subagents`.
func SubagentsDir(tp string) string { return strings.TrimSuffix(tp, ".jsonl") + "/subagents" }

// CompactNonce is the set's slot identity, `compact-<at>-<pid>-<r>-<r>`.
func CompactNonce(at int64, pid, r1, r2 int) string {
	return "compact-" + strconv.FormatInt(at, 10) + "-" + strconv.Itoa(pid) + "-" + strconv.Itoa(r1) + "-" + strconv.Itoa(r2)
}

// SetIn is what PreCompact publishes in the canonical set.
type SetIn struct {
	At                int64
	Nonce             string
	S                 Scope
	Overlap           bool
	CWD, Built, Fresh string
}

// SetDoc is the set document, the `jq -cn` program of `_hook_compact_pre` (every text through --arg, so made UTF-8).
func SetDoc(in SetIn) []byte {
	opt := func(s string) any {
		if s == "" {
			return nil
		}
		return kernel.JQRepair([]byte(s))
	}
	var pl, ln any
	switch in.S.ParentLive {
	case "true":
		pl = true
	case "false":
		pl = false
	}
	if in.S.LiveN != "" {
		n, _ := strconv.Atoi(in.S.LiveN)
		ln = n
	}
	return kernel.JQCompact(kernel.Obj{{K: "v", V: 1}, {K: "at", V: in.At}, {K: "nonce", V: kernel.JQRepair([]byte(in.Nonce))},
		{K: "scope", V: kernel.JQRepair([]byte(in.S.Scope))}, {K: "overlap", V: in.Overlap},
		{K: "agent", V: opt(in.S.Agent)}, {K: "transcript", V: opt(in.S.Transcript)},
		{K: "parentLive", V: pl}, {K: "liveAgents", V: ln},
		{K: "cwd", V: opt(in.CWD)}, {K: "built", V: opt(in.Built)}, {K: "fresh", V: opt(in.Fresh)},
		{K: "steered", V: false}, {K: "files", V: nil}, {K: "stats", V: nil}})
}

// The set's head grammar: `[[ "$head" =~ \"nonce\":\"([^\"]+)\" ]]` (measured: the class refuses only the quote) and
// the safe-nonce gate `^compact-[0-9]+-[0-9]+-[0-9]+-[0-9]+$` that makes it a path component.
var (
	headNonceRE = re(`"nonce":"([^"]+)"`)
	safeNonceRE = re(`\Acompact-[0-9]+-[0-9]+-[0-9]+-[0-9]+\z`)
)

// HeadNonce is the first nonce a set's head (`read -r -N 4096`, in the locale's unit) names.
func HeadNonce(set []byte, utf bool) (string, bool) {
	m := headNonceRE().FindStringSubmatch(readChars(set, headReadMax, utf))
	if m == nil {
		return "", false
	}
	return m[1], true
}

// SafeNonce is the gate a nonce passes before it names a marker.
func SafeNonce(n string) bool { return safeNonceRE().MatchString(n) }

// ServeCard is `_hook_compact_card_locked`'s read of a claimed card (`read -r -N COMPACT_CARD_MAX_CHARS+64`): serve says
// line 1 is the set's nonce and text follows it; the body is what follows line 1, trailing [:space:] cut.
func ServeCard(card []byte, nonce string, utf bool) (body string, serve, crossed bool) {
	raw := readChars(card, cardReadMax, utf)
	line1, rest, nl := strings.Cut(raw, "\n")
	if line1 != nonce {
		return "", false, true
	}
	if !nl {
		return "", false, false // a nonce with no text after it: restored, like a crossed card
	}
	return trimSpaceRight(rest, utf), true, false
}

// trimSpaceRight is `${s%"${s##*[![:space:]]}"}` in the locale.
func trimSpaceRight(s string, utf bool) string {
	end := 0
	for i := 0; i < len(s); {
		w := 1
		r := rune(s[i])
		if utf {
			w = charLen(s[i:])
			if w > 1 {
				r = []rune(s[i : i+w])[0]
			} else if s[i] >= 0x80 {
				r = -1
			}
		}
		if !glibcSpace(r, utf) {
			end = i + w
		}
		i += w
	}
	return s[:end]
}

// HistoryCardReserve is HISTORY_CARD_RESERVE: room for the history line above the compact card on a PreCompact of a box
// the sweep has made card/ on, history-off absent.
func HistoryCardReserve(precompact, cardDir, off bool) int {
	if precompact && cardDir && !off {
		return HistoryCardMax + 1
	}
	return 0
}

// HelperCardArgs is the helper's `card` argv after `node <helper>` (no canonical pathname in it, round 7's option A).
func HelperCardArgs(s Scope, cwd, built, fresh, setStage, cardStage, nonce string, at int64, reserve int) []string {
	a := []string{"card", "--transcript", s.Transcript, "--cwd", cwd,
		"--graph", cwd + "/graphify-out/graph.json", "--labels", cwd + "/graphify-out/.graphify_labels.json",
		"--set-stage", setStage, "--card-stage", cardStage,
		"--parent-live", s.ParentLive, "--live-agents", s.LiveN,
		"--max-chars", strconv.Itoa(CompactCardMaxChars - reserve), "--max-files", strconv.Itoa(CompactWorksetMax),
		"--built", built, "--fresh", fresh, "--scope", s.Scope, "--at", strconv.FormatInt(at, 10), "--nonce", nonce}
	if s.Agent != "" {
		a = append(a, "--agent", s.Agent)
	}
	return a
}

// ---------------------------------------------------------------------------------------------------- jq's order

// jqCmp is jq 1.7's jv_cmp over two numbers: a NaN compares as null does, below every number (so NaN < NaN).
func jqCmp(a, b float64) int {
	switch {
	case math.IsNaN(a):
		return -1
	case math.IsNaN(b):
		return 1
	case a < b:
		return -1
	case a == b:
		return 0
	}
	return 1
}

// numEq is `==` between two numbers (jq's: cmp == 0, so a NaN equals nothing).
func numEq(a, b float64) bool { return jqCmp(a, b) == 0 }
