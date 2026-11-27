package attention

import "ccrc/core/internal/kernel"

// The SessionStart card's ceilings, in the bash's unit (`${x:0:n}`: locale characters).
const (
	CardMaxChars        = 2400 // CARD_MAX_CHARS: the standing subjects
	CompactCardMaxChars = 4000 // COMPACT_CARD_MAX_CHARS: the compact card, after the standing clip
	CardTotalMaxChars   = CardMaxChars + 1 + CompactCardMaxChars
	RosterCardMaxChars  = 2048 // ROSTER_CARD_MAX_CHARS
	AnchorCardMaxChars  = 1500 // ANCHOR_CARD_MAX_CHARS: the anchor, first
)

// Cards are the SessionStart subjects the arm assembles (wave 2 Task 8a fills them; until then every one is empty).
type Cards struct {
	Standing, Compact, Roster, Anchor string
}

// Any says whether the arm prints at all (`[ -n "$CARD$CARD_COMPACT$CARD_ROSTER$CARD_ANCHOR" ]`).
func (c Cards) Any() bool { return c.Standing+c.Compact+c.Roster+c.Anchor != "" }

// EmitContext is `_hook_emit_context`: each subject under its own clip, the standing and compact pair under the total,
// the roster after them, the anchor first on a line of its own; then the SessionStart envelope, one line.
func EmitContext(c Cards, utf8Locale bool) []byte {
	clip := func(s string, n int) string { return Clip(s, n, utf8Locale) }
	text := clip(c.Standing, CardMaxChars)
	if c.Compact != "" {
		text = join(text, " ", clip(c.Compact, CompactCardMaxChars))
		text = clip(text, CardTotalMaxChars)
	}
	if c.Roster != "" {
		text = join(text, " ", clip(c.Roster, RosterCardMaxChars))
	}
	if c.Anchor != "" {
		if text != "" {
			text = "\n" + text
		}
		text = clip(c.Anchor, AnchorCardMaxChars) + text
	}
	return kernel.JQCompact(kernel.Obj{{K: "hookSpecificOutput", V: kernel.Obj{{K: "hookEventName", V: "SessionStart"},
		{K: "additionalContext", V: text}}}})
}

// join is `${a:+$a<sep>}$b`.
func join(a, sep, b string) string {
	if a == "" {
		return b
	}
	return a + sep + b
}
