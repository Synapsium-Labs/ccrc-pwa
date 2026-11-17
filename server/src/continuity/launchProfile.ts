// L1, context C3 (Session Conversation): `compactThresholdFor`, the auto-compact point of a long-lived role, from its
// launch profile and its measured window (Overlord spec §3.3.4, C39; the plan is
// `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles.md`, Task 4). Pure: the profile and the window arrive
// as arguments. It also holds `launchRowOf` and `launchDigestOf` (Overlord W1 sandbox, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`, Task 2): the row ccd reads and its digest, below.
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
import { createHash } from 'node:crypto';
import { FLEET_ROLES, type FleetRole, type LaunchProfile } from '../../../shared/fleetRoles.js';
import { HOOK_EVENTS } from '../../../shared/hook-events.js';
import { compactInstructionsFor } from './compaction.js';
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

// ── The row ccd reads (Overlord W1 sandbox, Task 2; spec §3.6 H1, index question 12) ──────────────────────────────────
//
// `launchRowOf` is the ONE projection of a role's launch profile into the row ccd reads from `ccd/lib/launch-profiles.json`:
// the JSON file's test, the digest, the route field `profiledigest` and the sandbox check all call it (Review Focus 4). A row
// with no surface keeps W1a's five keys and `longLived`; a surfaced row adds `flags`, `surfaceSettings`, `stagedSkills`,
// `memory` and `remoteControl`, which ccd renders whole or not at all while the route carries `profiledigest`.
// `longLived` is `FLEET_ROLES`'s column of that name, the one definition ccd reads it from (Overlord W1 ccd arms, Task 4,
// slug long-lived-is-projected): `_role_long_lived` asks it for the hold-down and the `/model` skip, and no role-name list
// in ccd restates it. Adding it changed every row's digest, the same on both sides.

/** ccrc's own hook command, as `ccd/install-session-hooks.sh` registers it (`HOOK_CMD`). Pinned setting sources drop the
 *  account's settings, so the surfaced profile registers the hook itself (proposal 4); `launch-surface-installer.test.ts`
 *  holds the two equal by running the installer. */
export const LAUNCH_HOOK_COMMAND = 'bash "$HOME/.cc-sessions/session-hook.sh"';
/** The installer's `HOOK_TIMEOUT_S`, on every event but `SessionEnd`. */
export const LAUNCH_HOOK_TIMEOUT_S = 600;
/** ccrc's status line, as the installer registers it (`STATUSLINE_CMD`), so the context sidecar keeps its writer (slug
 *  `statusline-registered-by-the-profile`). */
export const LAUNCH_STATUSLINE_COMMAND = 'bash "$HOME/.claude/statusline-command.sh"';

/** A JSON value with every object's keys sorted, recursively: `JSON.stringify` of it is `jq -cS`'s spelling of the same
 *  value for the strings and numbers the row holds (printable ASCII, integers; the JSON file's test holds both). */
function sortedJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedJson);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedJson((v as Record<string, unknown>)[k])]));
}

/** ccrc's hook on every event the hook handles, with the installer's timeout and matcher rules, and its status line. */
function surfaceHooks(): Record<string, unknown> {
  return Object.fromEntries(HOOK_EVENTS.map((ev) => {
    const hook = { type: 'command', command: LAUNCH_HOOK_COMMAND, ...(ev === 'SessionEnd' ? {} : { timeout: LAUNCH_HOOK_TIMEOUT_S }) };
    return [ev, [ev === 'PreToolUse' ? { matcher: '*', hooks: [hook] } : { hooks: [hook] }]];
  }));
}

/** The row ccd reads for `role`, keys sorted. */
export function launchRowOf(role: FleetRole): Record<string, unknown> {
  const p = FLEET_ROLES[role].launchProfile;
  const base = { env: p.env, settings: p.settings, autoMemory: p.autoMemory, compactionSettings: p.compaction?.settings ?? {},
    compactText: compactInstructionsFor(role), longLived: FLEET_ROLES[role].longLived };
  const s = p.surface;
  if (s === null) return sortedJson(base) as Record<string, unknown>;
  return sortedJson({
    ...base,
    flags: ['--setting-sources', s.settingSources.join(','), '--tools', s.tools.join(','), '--strict-mcp-config',
      '--agents', JSON.stringify(sortedJson(s.readerTypes))],
    surfaceSettings: { permissions: { deny: s.deny }, hooks: surfaceHooks(),
      statusLine: { type: 'command', command: LAUNCH_STATUSLINE_COMMAND } },
    stagedSkills: s.stagedSkills,
    memory: s.memory,
    remoteControl: 'off',
  }) as Record<string, unknown>;
}

/** The sha256 of the bytes `jq -cS ".[\"$role\"]"` prints for the role's row, its trailing newline included. */
export function launchDigestOf(role: FleetRole): string {
  return createHash('sha256').update(`${JSON.stringify(launchRowOf(role))}\n`, 'utf8').digest('hex');
}
