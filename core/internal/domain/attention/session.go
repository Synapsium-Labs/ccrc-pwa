package attention

import (
	"regexp"
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
	"ccrc/core/internal/kernel/vocab"
)

var plainID = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// SessionFromPane is the pane arm of "which session this is": tmux's `#S` answer (as `$( )` keeps it) names a fleet
// session `cc-<id>`, and the id is what follows; anything else is no session.
func SessionFromPane(tname string) string {
	tname = subst(tname)
	if strings.HasPrefix(tname, "cc-") && len(tname) > 3 {
		return tname[3:]
	}
	return ""
}

// UUIDLine is the job-dir fallback's `read -r -n CCRC_ID_MAX` of a `$REG/<id>.uuid` file: its first line, at most
// CCRC_ID_MAX characters, NUL bytes dropped.
func UUIDLine(data []byte) string {
	s := strings.ReplaceAll(string(data), "\x00", "")
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return cut(s, vocab.HookConstantsCcrcIdMax)
}

// ValidID is the guard after identity: `^[A-Za-z0-9._-]+$`. shortcut (D-TBD-go-hook-ascii-classes): ASCII ranges; bash's under a UTF-8 locale may
// collate other letters into A-Z, which no ccd id holds (ccd mints ids from its own ASCII class).
func ValidID(id string) bool { return plainID.MatchString(id) }

var (
	capsAt   = regexp.MustCompile(`^at ([0-9]{1,11})$`)
	capsList = regexp.MustCompile(`^caps( [a-z0-9-]{1,64})*$`)
)

// ServerCap is `_hook_server_cap`: the file holds exactly three newline-ended lines (`at <secs>`, `caps …`, `end`),
// its stamp is not ahead of now and at most SERVER_CAPS_LEASE_S behind it, and word is listed whole.
func ServerCap(data []byte, nowS int64, word string) bool {
	s := strings.ReplaceAll(string(data), "\x00", "")
	if strings.Count(s, "\n") != 3 || !strings.HasSuffix(s, "\n") {
		return false
	}
	l := strings.Split(s, "\n")
	m := capsAt.FindStringSubmatch(l[0])
	if m == nil || l[2] != "end" || !capsList.MatchString(l[1]) {
		return false
	}
	at, _ := strconv.ParseInt(m[1], 10, 64)
	if at > nowS || nowS-at > vocab.ServerCapsLeaseS {
		return false
	}
	return strings.Contains(" "+strings.TrimPrefix(l[1], "caps")+" ", " "+word+" ")
}

// JoinReadMax and JoinRotateAt are the join record's read bound and its rotation point (`JOIN_READ_MAX`,
// `JOIN_ROTATE_AT`).
const JoinReadMax, JoinRotateAt = 16384, 128

// Joined is the membership test: aid is a whole line of the join file's first JoinReadMax bytes (the last line only
// once its newline arrived).
func Joined(data []byte, aid string) bool {
	if len(data) > JoinReadMax {
		data = data[:JoinReadMax]
	}
	return strings.Contains("\n"+strings.ReplaceAll(string(data), "\x00", ""), "\n"+aid+"\n")
}

// JoinOverCap says a join file read (its first JoinReadMax bytes) holds more than JoinRotateAt lines: the rotation's test.
func JoinOverCap(data []byte) bool {
	if len(data) > JoinReadMax {
		data = data[:JoinReadMax]
	}
	return strings.Count(string(data), "\n") > JoinRotateAt
}

// TurnKind is which marker a main-thread event writes ("" none): a prompt always opens a turn, a tool event only
// when the line on disk is not already this session's `working`, Stop and StopFailure close it, and a SessionStart
// restarts it (clear makes a fresh line; compact is inert, D-306).
func TurnKind(event, src, tmline, msid string) string {
	switch event {
	case "UserPromptSubmit":
		return "working"
	case "PreToolUse", "PostToolUse":
		if strings.Contains(tmline, `"state":"working"`) && strings.Contains(tmline, `"sessionId":"`+msid+`"`) {
			return ""
		}
		return "working"
	case "Stop":
		return "done"
	case "StopFailure":
		return "failed"
	case "SessionStart":
		switch src {
		case "compact":
			return ""
		case "clear":
			return "clear"
		}
		return "restart"
	}
	return ""
}

// CaptureSid is the capture's meta line's session id: CLAUDE_CODE_SESSION_ID cut to [A-Za-z0-9-].
func CaptureSid(s string) string {
	return keep(s, func(r rune) bool { return r < 128 && (alpha(r) || r >= '0' && r <= '9' || r == '-') })
}

// CaptureMax is how many capture files a -hookcap session keeps writing.
const CaptureMax = 200

// Capture is one capture file's text: the meta line, then the payload as the hook read it.
func Capture(sid, payload string) []byte {
	return []byte(`{"envSid":"` + CaptureSid(sid) + "\"}\n" + payload + "\n")
}

// SubagentName is the roster arm's two lines: the name (agent_name, subagent_name, agent_type or "subagent", newlines as
// spaces, trimmed as `read` trims) and the id (agent_id as text, kept only when it is wholly idch, 1 to 64).
func SubagentName(v any) (name, aid string) {
	n := or(or(or(get(v, "agent_name"), get(v, "subagent_name")), get(v, "agent_type")), "subagent")
	name = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' {
			return ' '
		}
		return r
	}, tostring(n))
	raw := tostring(or(get(v, "agent_id"), ""))
	if k := keep(raw, idch); k == raw && isID(k) {
		aid = k
	}
	l := readLines([]string{name, aid}, 2)
	if l[0] == "" {
		l[0] = "subagent"
	}
	return l[0], l[1]
}

// Subagents is the roster update on SubagentStart or SubagentStop (D-5232, D-5375), over the read list's JSON text:
// the new list's text, "[]" where the bash's jq fails.
func Subagents(subs, event, name, aid string, now int64) string {
	v, err := kernel.JQParse([]byte(subs))
	l, ok := v.([]any)
	if err != nil || !ok {
		return "[]"
	}
	idOf := func(e any) any { x, _ := index(e, "id"); return x } // `.id? // null`
	switch {
	case aid != "" && event == "SubagentStart":
		for _, e := range l {
			if equal(idOf(e), aid) {
				return string(kernel.JQCompact(last32(l)))
			}
		}
		l = append(l, kernel.Obj{{K: "name", V: name}, {K: "startedAt", V: now}, {K: "id", V: aid}})
		return string(kernel.JQCompact(last32(l)))
	case aid != "":
		out := []any{}
		for _, e := range l {
			if !equal(idOf(e), aid) {
				out = append(out, e)
			}
		}
		return string(kernel.JQCompact(out))
	case event == "SubagentStart":
		l = append(l, kernel.Obj{{K: "name", V: name}, {K: "startedAt", V: now}})
		return string(kernel.JQCompact(last32(l)))
	}
	for _, e := range l { // `map(.name)` errors on an element that is neither an object nor null
		if _, err := index(e, "name"); err != nil {
			return "[]"
		}
	}
	for i, e := range l {
		if equal(get(e, "name"), name) {
			return string(kernel.JQCompact(append(append([]any{}, l[:i]...), l[i+1:]...)))
		}
	}
	return string(kernel.JQCompact(l))
}

func last32(l []any) []any {
	if len(l) > 32 {
		return l[len(l)-32:]
	}
	return l
}

// PruneSubagents is a main Stop's prune: a measured bg of 0 empties the roster; 1 to 8 listed ids, all kept and all
// subagents' (bgdk empty or `subagent`), cut it to those ids; anything else leaves it.
func PruneSubagents(subs, bg, bgi, bgd, bgdk string) string {
	if subs == "[]" || !digits.MatchString(bg) {
		return subs
	}
	n, _ := strconv.Atoi(bg)
	if n == 0 {
		return "[]"
	}
	if n > 8 || !digits.MatchString(bgd) || (bgdk != "" && bgdk != "subagent") {
		return subs
	}
	ids := strings.Split(bgi, ",")
	if bgi == "" || len(ids) != n {
		return subs
	}
	v, err := kernel.JQParse([]byte(subs))
	l, ok := v.([]any)
	if err != nil || !ok {
		return "[]"
	}
	out := []any{}
	for _, e := range l {
		x, _ := index(e, "id")
		if s, ok := x.(string); ok {
			for _, id := range ids {
				if id == s {
					out = append(out, e)
					break
				}
			}
		}
	}
	return string(kernel.JQCompact(out))
}
