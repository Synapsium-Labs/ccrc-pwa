// L1, context C3 (Session Conversation): `compactThresholdFor`, the auto-compact point of a long-lived role, from its
// launch profile and its measured window (Overlord spec §3.3.4, C39; the plan is
// `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles.md`, Task 4). Pure: the profile and the window arrive
// as arguments.
//
// C39: compaction is lowered so that renewal fires first. The hard cap is `hardCapTokens(windowTokens)` (Table 3.3.11b,
// the renewal deciders' one definition); the compact point sits `aboveHardCapPts` points of the window above it,
// in percent `ceil(100 * hardCap / windowTokens) + aboveHardCapPts`, never above `COMPACT_PCT_MAX`. Claude Code's own
// window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, measured in W0-14) is the same point in tokens, clamped to the range that
// variable takes. On a 1M window that is 25 + 10 = 35%, 350,000 tokens; on 200k, 50 + 10 = 60%, 120,000 tokens.
// A role with no compaction column, or an unmeasured window, answers `null`: leave the route as it is.
import type { LaunchProfile } from '../../../shared/fleetRoles.js';
import { hardCapTokens } from './renewalDue.js';

/** The compact point is never later than this percent of the window. */
export const COMPACT_PCT_MAX = 95;
/** The range `CLAUDE_CODE_AUTO_COMPACT_WINDOW` takes, in tokens (W0-14); ccd's `_route_valid` checks the same bounds. */
export const COMPACT_WINDOW_MIN_TOKENS = 100_000;
export const COMPACT_WINDOW_MAX_TOKENS = 1_000_000;

export interface CompactThreshold {
  /** ccd's own threshold (the route's `compact`), in percent of the window. */
  readonly pct: number;
  /** Claude Code's auto-compact window (the route's `compactwindow`), in tokens. */
  readonly windowTokens: number;
}

export function compactThresholdFor(profile: LaunchProfile, windowTokens: number | null): CompactThreshold | null {
  if (profile.compaction === null || windowTokens === null || !Number.isFinite(windowTokens) || windowTokens <= 0) return null;
  const pct = Math.min(COMPACT_PCT_MAX,
    Math.ceil((100 * hardCapTokens(windowTokens)) / windowTokens) + profile.compaction.aboveHardCapPts);
  const tokens = Math.ceil((pct * windowTokens) / 100);
  return { pct, windowTokens: Math.min(COMPACT_WINDOW_MAX_TOKENS, Math.max(COMPACT_WINDOW_MIN_TOKENS, tokens)) };
}
