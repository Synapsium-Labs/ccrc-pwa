// L1, context C3 (Session Conversation): `compactThresholdFor`, the auto-compact point of a long-lived role, from its
// launch profile and its measured window (Overlord spec §3.3.4, C39; the plan is
// `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles.md`, Task 4). Pure: the profile and the window arrive
// as arguments.
//
// C39: compaction is lowered so that renewal fires first. The hard cap is `hardCapTokens(windowTokens)` (Table 3.3.11b,
// the renewal deciders' one definition); the compact point sits `aboveHardCapPts` points of the window above it,
// in percent `ceil(100 * hardCap / windowTokens) + aboveHardCapPts`, never above `COMPACT_PCT_MAX`. Claude Code's own
// window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, measured in W0-14) is that point in tokens PLUS the buffer Claude Code keeps
// below the variable (`AUTO_COMPACT_BUFFER_TOKENS`, review 1945 F2), clamped to the range the variable takes: Claude Code
// fires about 33,000 tokens below the variable, whatever it is set to, so the variable set to the compact point itself
// would fire under the hard cap on a 200k window (120,000 fires near 87,000) and invert C39. On a 1M window that is
// 25 + 10 = 35%, 350,000 + 34,000 = 384,000 tokens; on 200k, 50 + 10 = 60%, 120,000 + 34,000 = 154,000 tokens.
// A role with no compaction column, an unmeasured window, or a window where the clamp to the variable's range would fire
// Claude Code before the compact point (for the shipped 10-point profile, `LONG_LIVED_COMPACTION`, outside 85,000 to
// 6,900,000 tokens; a profile with another step has its own band) answers `null`. For a role that has a compaction column,
// the lane then writes no compaction field and leaves the route's earlier ones (review 2031 F4).
import type { LaunchProfile } from '../../../shared/fleetRoles.js';
import { hardCapTokens } from './renewalDue.js';

/** The compact point is never later than this percent of the window. */
export const COMPACT_PCT_MAX = 95;
/** The range `CLAUDE_CODE_AUTO_COMPACT_WINDOW` takes, in tokens (W0-14); ccd's `_route_valid` checks the same bounds. */
export const COMPACT_WINDOW_MIN_TOKENS = 100_000;
export const COMPACT_WINDOW_MAX_TOKENS = 1_000_000;
/** How far below `CLAUDE_CODE_AUTO_COMPACT_WINDOW` Claude Code fires its auto-compaction: measured between 33,000 and
 *  33,500 tokens on Claude Code 2.1.325, in the W0 rig against the mock API, with the variable at 120,000 (fired after a
 *  turn at 87,000, not at 86,000) and at 200,000 (fired at 167,000, not at 166,500): absolute, not a share of the window.
 *  Rounded up, so Claude Code fires at or just after the compact point, never before it (review 1945 F2). */
export const AUTO_COMPACT_BUFFER_TOKENS = 34_000;

export interface CompactThreshold {
  /** ccd's own threshold (the route's `compact`), in percent of the window. */
  readonly pct: number;
  /** Claude Code's auto-compact window (the route's `compactwindow`), in tokens: the compact point plus Claude Code's buffer. */
  readonly windowTokens: number;
}

export function compactThresholdFor(profile: LaunchProfile, windowTokens: number | null): CompactThreshold | null {
  if (profile.compaction === null || windowTokens === null || !Number.isFinite(windowTokens) || windowTokens <= 0) return null;
  const pct = Math.min(COMPACT_PCT_MAX,
    Math.ceil((100 * hardCapTokens(windowTokens)) / windowTokens) + profile.compaction.aboveHardCapPts);
  const point = Math.ceil((pct * windowTokens) / 100);
  const tokens = Math.min(COMPACT_WINDOW_MAX_TOKENS, Math.max(COMPACT_WINDOW_MIN_TOKENS, point + AUTO_COMPACT_BUFFER_TOKENS));
  // Claude Code fires the buffer below the variable, or below the window when the variable passes it. Where the clamp makes
  // that earlier than the compact point (for the 10-point profile, windows under 85,000 or over 6,900,000 tokens), no point
  // is written (review 2024 F4).
  if (Math.min(tokens, windowTokens) - AUTO_COMPACT_BUFFER_TOKENS < point) return null;
  return { pct, windowTokens: tokens };
}
