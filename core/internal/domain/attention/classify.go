package attention

import (
	"regexp"
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
	"ccrc/core/internal/kernel/vocab"
)

// Class is what the classification `case "$event"` sets (ccd/session-hook.sh), and how it leaves.
type Class struct {
	Exit        bool   // the arm exits 0 here (PreModelSwitch, PostModelSwitch, an unknown event, a failed read)
	State       string // working, waiting, done or "" (a subagent event)
	Ask         any    // the ask envelope: nil, {questions}, {approval:{tool,summary}}
	AskBad      bool   // the ask envelope is two lines (several values): the hookstate write's `--argjson` refuses it
	Interrupted bool
	Trig        string // PostCompact: `.trigger // "auto"`; the history spool writes only manual and auto
	Tool        string // PreToolUse and PermissionRequest: `.tool_name // empty`
	Src         string // SessionStart: `.source // empty`
	Gcmd        string // PostToolUse: a Bash command line naming graphify, `peers list` or `claims take`
	Apr         bool   // a PermissionRequest for any tool but AskUserQuestion: the approval wait's flag
	Stopfail    bool
	Sessend     bool // SessionEnd, or a compact SessionStart: inert past the start report
	Err         string
	// Stop's background measure (bg -1 unless background_tasks is an array) and session crons; Bgd/Bgdk are the
	// delegated count and kinds, "" unless both counts are measured.
	Bg, Bgk, Bgi, Bgd, Bgdk, Crons string
}

// Classify is the classification case for every event but the typed /model (TypedModel, which the caller tests first
// on UserPromptSubmit). payload is the text the parse read, v its value. The network sends inside the arms (the model
// report, the SessionStart cards) are not here: a SessionStart's cards are the caller's.
func Classify(event, payload string, v any) Class {
	c := Class{Bg: "-1", Crons: "-1"}
	switch event {
	case "UserPromptSubmit", "PreCompact":
		c.State = "working"
	case "PostToolUse":
		c.State = "working"
		if strings.Contains(payload, "graphify") || strings.Contains(payload, "peers list") || strings.Contains(payload, "claims take") {
			if equal(get(v, "tool_name"), "Bash") {
				if cmd, err := path(v, "tool_input", "command"); err == nil {
					c.Gcmd = subst(rawOut(or(cmd, "")))
				}
			}
		}
	case "PostCompact":
		c.Trig = subst(rawOut(or(get(v, "trigger"), "auto")))
		if c.Trig == "manual" {
			c.State = "done"
		} else {
			c.State = "working"
		}
	case "PreToolUse", "PermissionRequest":
		c.State = "working"
		if event == "PermissionRequest" {
			c.State = "waiting"
		}
		if t := get(v, "tool_name"); truthy(t) {
			c.Tool = subst(rawOut(t))
		}
		if c.Tool == "AskUserQuestion" {
			c.State = "waiting"
			if q, err := path(v, "tool_input", "questions"); err == nil {
				c.Ask = kernel.Obj{{K: "questions", V: or(q, []any{})}}
			}
		} else if event == "PermissionRequest" {
			c.Apr = true
			if s, err := AprSummary(v); err == nil {
				c.Ask = kernel.Obj{{K: "approval", V: kernel.Obj{{K: "tool", V: or(get(v, "tool_name"), "unknown")}, {K: "summary", V: s}}}}
			}
		}
	case "SessionStart":
		if s := get(v, "source"); truthy(s) {
			c.Src = subst(rawOut(s))
		}
		if c.Src == "compact" {
			c.Sessend = true
		} else {
			c.State = "done"
		}
	case "Stop":
		c.State = "done"
		stopBackground(v, &c)
	case "StopFailure":
		c.Stopfail = true
		c.Err = cut(keep(tostring(or(get(v, "error"), "")), func(r rune) bool { return r >= 'a' && r <= 'z' || r == '_' }), 64)
	case "SessionEnd":
		c.Sessend = true
	case "SubagentStart", "SubagentStop":
	default: // PreModelSwitch, PostModelSwitch (its report is the network's) and anything unknown
		c.Exit = true
	}
	return c
}

var taskID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// stopBackground is Stop's one jq over background_tasks and session_crons, then its two guards.
func stopBackground(v any, c *Class) {
	a, isArr := get(v, "background_tasks").([]any)
	kind := func(t kernel.Obj) string {
		s, ok := get(t, "type").(string)
		if !ok {
			return ""
		}
		return keep(strings.ReplaceAll(strings.Map(asciiLower, s), " ", "-"), func(r rune) bool {
			return r >= 'a' && r <= 'z' || r == '_' || r == '-'
		})
	}
	in := func(v any, set []string) bool {
		for _, s := range set {
			if equal(v, s) {
				return true
			}
		}
		return false
	}
	var kinds, ids, del []string
	nd := 0
	for _, x := range a {
		t, ok := x.(kernel.Obj)
		if !ok {
			continue
		}
		k := kind(t)
		if k != "" {
			kinds = append(kinds, k)
		}
		if id, ok := get(t, "id").(string); ok && taskID.MatchString(id) {
			ids = append(ids, id)
		}
		// The delegated-task rule reads its owner (shared/api.ts, generated into vocab); the bash spells the lists in its jq.
		if !in(k, vocab.NonDelegatingTaskKinds) && !in(get(t, "status"), vocab.TerminalTaskStatuses) {
			nd++
			if k != "" {
				del = append(del, k)
			}
		}
	}
	if len(ids) > 8 {
		ids = ids[:8]
	}
	if isArr {
		c.Bg, c.Bgd = strconv.Itoa(len(a)), strconv.Itoa(nd)
	} else {
		c.Bg, c.Bgd = "-1", "-1"
	}
	c.Bgk, c.Bgi, c.Bgdk = strings.Join(kinds, ","), strings.Join(ids, ","), strings.Join(uniqueSorted(del), ",")
	c.Crons = "-1"
	if cr, ok := get(v, "session_crons").([]any); ok {
		c.Crons = strconv.Itoa(len(cr))
	}
	if !isArr { // `[[ "$bg" =~ ^[0-9]+$ && "$bgd" =~ ^[0-9]+$ ]] || { bgd="" bgdk=""; }`
		c.Bgd, c.Bgdk = "", ""
	}
}

// asciiLower is jq's ascii_downcase: A-Z only.
func asciiLower(r rune) rune {
	if r >= 'A' && r <= 'Z' {
		return r + 32
	}
	return r
}
