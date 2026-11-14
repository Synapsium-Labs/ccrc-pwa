// L1, context C3 (Session Conversation): `precompactDecision`, the PreCompact refusal arm's verdict (Overlord spec §3.3.4,
// C39; W0-13; rulings R7a, R7b, R11; the plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-compaction.md`, Task 4).
// Pure. The arm itself is bash, `ccd/session-hook.sh#_hook_compact_refuse`, because it must answer inside the hook's
// PreCompact run; this is its twin, held equal to it by a parity table run through both
// (`server/test/session-hook-precompact-refuse.test.ts`), and the form the simulator and the mutation floors read.
//
// It refuses only when every condition holds: the route field `precompact` reads `refuse` (absent is dark: its one
// writer is the generations lane, through the renewal hand-offs piece), the trigger is `auto` (a manual `/compact` is
// the operator's or ccd's own and always passes), the hook's scope verdict is `main` (`subagent`, `ambiguous` and no
// verdict never refuse, R7a), and no refusal was recorded for this turn (R11: once a turn, so the turn after a refusal
// may compact; the hook reads an unreadable turn marker as "refused already").

/** What the arm decides: block the compaction (and record a `refused` line), or let it through. */
export type PrecompactVerdict = 'refuse' | 'pass';

/** Each input is the raw word the hook holds, or null when it holds none, so nothing here narrows what it was given. */
export function precompactDecision(trigger: string | null, scope: string | null, field: string | null, refusedThisTurn: boolean): PrecompactVerdict {
  return field === 'refuse' && trigger === 'auto' && scope === 'main' && !refusedThisTurn ? 'refuse' : 'pass';
}
