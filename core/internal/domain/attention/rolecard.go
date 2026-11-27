package attention

// The role subject of the SessionStart card (ccd/session-hook.sh, `_hook_role_card`): every session that is not a
// dispatched child is its project's coordinator, told so by one of two fixed texts by source. Read in the bash after the
// anchor and only while the anchor's slot is empty; the other subjects (graph, hold, ccrc, compact, history) are Task 8's.
const (
	roleStill = "ccrc-role: You are still this project's coordinator. If the `ccrc-coordinator` skill is not loaded in this context, load it now. Your children's questions and permission prompts come to you first; your own you work out from the programme's goals first; only operator-only decisions go to the operator."
	roleFresh = "ccrc-role: You are this project's coordinator from your first turn. Load the `ccrc-coordinator` skill now, before anything else, and act as it says. When your work belongs to a programme, read its goals and definition of done in its ledger (`docs/superpowers/programs/<slug>.md`) before you plan or ask. Your children's questions and permission prompts come to you first; your own you work out from the programme's goals first; only operator-only decisions go to the operator."
)

// RoleCard is `_hook_role_card`: "" when the card kill switch stands, the row is a child (existence or a link counts) or
// a hold stands; else the short reminder for a resume, fork or compact and the full text for any other source.
func RoleCard(src string, cardOff, child, childLink, hold bool) string {
	if cardOff || child || childLink || hold {
		return ""
	}
	switch src {
	case "resume", "fork", "compact":
		return roleStill
	}
	return roleFresh
}
