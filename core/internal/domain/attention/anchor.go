package attention

import (
	"strconv"
	"strings"

	"ccrc/core/internal/kernel"
)

// The anchor and the roster card (ccd/session-hook.sh: `_hook_anchor_fetch`, `_hook_anchor_owed`, `_hook_roster_card`,
// `_hook_roster_wake`, `_hook_roster_eligible`). The door's text is rendered by the server; this decides only what to
// keep of an answer and what the hook prints and removes.
const (
	AnchorPromptMaxChars = 600 // ANCHOR_PROMPT_MAX_CHARS
	AnchorOwedTries      = 3   // ANCHOR_OWED_TRIES
	anchorPrefix         = "ccrc-anchor: "
	RosterWakeMail       = "ccrc-mail: you have new mail."
	RosterWakeIdle       = "Continue with your open tasks. If you were waiting for the operator's answer, say so in one line and stop."
	RosterWakeTailBytes  = 262144
	RosterShadowMax      = 256 * 1024 // `find -size +256k`: over this many bytes
)

// RosterEligible is `_hook_roster_eligible`: a main-thread session, not a child, with the card kill switch absent.
func RosterEligible(paid, cardOff, child, childLink bool) bool {
	return !paid && !cardOff && !child && !childLink
}

// D-TBD-go-hook-json-single-value: jq reads every value of the door's answer, this reads the first.
// AnchorAnswer reads the door's answer to `card --anchor --form <form>`: its word (`text`, `dark`, `live` or "" for no
// answer) and the text it carries. Only an answer naming `part: "anchor"` and the form asked is read, and its text only
// when it begins with the anchor's prefix; anything else is no answer.
func AnchorAnswer(out, form string) (word, text string) {
	v, err := kernel.JQParseFirst([]byte(out))
	if err != nil {
		return "", ""
	}
	o, ok := v.(kernel.Obj)
	if !ok || get(o, "ok") != true || get(o, "part") != "anchor" || get(o, "form") != form {
		return "", ""
	}
	if get(o, "dark") == true {
		return "dark", ""
	}
	if get(o, "live") == true && form == "fork" {
		return "live", ""
	}
	if t, ok := get(o, "text").(string); ok && strings.HasPrefix(t, anchorPrefix) {
		// `read -r -d ''` takes the text to its first NUL
		t, _, _ = strings.Cut(t, "\x00")
		return "text", t
	}
	return "", ""
}

// CardsRoster is the SessionStart arm's roster read: which sources carry one.
func CardsRoster(src string) bool { return src == "compact" || src == "resume" || src == "clear" }

// AnchorSource is the form the SessionStart arm asks for by source ("" for none).
func AnchorSource(src string) string {
	switch src {
	case "startup", "resume", "clear", "compact":
		return "start"
	case "fork":
		return "fork"
	}
	return ""
}

// ForkAnchorLine is the one line a fork's slot carries when the door says `live`.
const ForkAnchorLine = "ccrc-anchor: a forked copy is not this session; it has no card."

// PromptEnvelope is the UserPromptSubmit envelope carrying text c (`jq -cn --arg c`: invalid UTF-8 made U+FFFD).
func PromptEnvelope(c string) []byte {
	return kernel.JQCompact(kernel.Obj{{K: "hookSpecificOutput", V: kernel.Obj{{K: "hookEventName", V: "UserPromptSubmit"},
		{K: "additionalContext", V: kernel.JQRepair([]byte(c))}}}})
}

// WithDelta is `${text:0:max}${DOOR_DELTA:+$'\n'$DOOR_DELTA}`.
func WithDelta(text string, max int, delta string, utf8Locale bool) string {
	text = Clip(text, max, utf8Locale)
	if delta != "" {
		text += "\n" + delta
	}
	return text
}

// OwedPlan is what the owed anchor's answer does: print an envelope with the text clipped, remove the mark, or write the
// next count.
type OwedPlan struct {
	Print  bool   // print the envelope with the door's text
	Remove bool   // rm the mark
	Count  string // the mark's next content ("" when none)
}

// OwedTries is the mark's count: its first line when one digit, else 0.
func OwedTries(first string) int {
	if len(first) == 1 && first[0] >= '0' && first[0] <= '9' {
		return int(first[0] - '0')
	}
	return 0
}

// Owed decides `_hook_anchor_owed`'s case over the door's word and the mark's tries.
func Owed(word string, tries int) OwedPlan {
	switch word {
	case "text":
		return OwedPlan{Print: true, Remove: true}
	case "dark":
		return OwedPlan{Remove: true}
	}
	if tries+1 >= AnchorOwedTries {
		return OwedPlan{Remove: true}
	}
	return OwedPlan{Count: strconv.Itoa(tries+1) + "\n"}
}

// WakePrompt is the wake arm's gate on the prompt: it begins with one of the server's two wake texts, and answers the
// transcript's path ("" when none).
func WakePrompt(v any) string {
	p, ok := get(v, "prompt").(string)
	if !ok || !strings.HasPrefix(p, RosterWakeMail) && !strings.HasPrefix(p, RosterWakeIdle) {
		return ""
	}
	return TranscriptPath(v)
}

// WakeFiltered is the arm's builtin prefilter over the payload text.
func WakeFiltered(payload string) bool {
	return strings.Contains(payload, RosterWakeMail) || strings.Contains(payload, RosterWakeIdle[:30])
}

// RosterShadowLine is one shadow-log entry: the ms, the id and the event word, then the card.
func RosterShadowLine(now int64, id, event, card string) string {
	return itoa(now) + " " + id + " " + event + "\n" + card + "\n"
}

// RosterLive is `jq -e '.rosterCard == "live"'` over the runs list.
func RosterLive(body string) bool {
	v, err := kernel.JQParse([]byte(body))
	return err == nil && get(v, "rosterCard") == "live"
}

// WakeReady is the wake arm's gate on the transcript: an absolute path to a regular file.
func WakeReady(path string, regular bool) bool { return strings.HasPrefix(path, "/") && regular }

// IdleOpen is the wake arm's read of `idle_compaction_open`: the one word `true`.
func IdleOpen(out string) bool { return out == "true" }

// RosterShadowDue says whether the unarmed card is logged: not while the log is over its ceiling.
func RosterShadowDue(exists bool, size int64) bool { return !exists || size <= RosterShadowMax }

// DeltaAlone says whether the delta prints an envelope of its own: it is not empty and neither the wake nor the owed
// anchor printed this event's one envelope.
func DeltaAlone(delta string, woke, printed bool) bool { return delta != "" && !woke && !printed }

// AnchorSlot is what the SessionStart arm puts in the anchor's slot: a start's text, or a fork's one line only on the door's
// `live`; a `dark` answer or none leaves it empty.
func AnchorSlot(form, word, text string) string {
	switch {
	case form == "start" && word == "text":
		return text
	case form == "fork" && word == "live":
		return ForkAnchorLine
	}
	return ""
}
