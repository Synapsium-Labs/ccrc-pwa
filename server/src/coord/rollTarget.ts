/**
 * THE AUTOMATIC COORDINATOR ROLL, RELEASE HALF (D-7443, D-7452, D-7454; the operator's rulings of 2026-10-29): L1, pure.
 *
 * "Always auto-roll all coordinators when they go idle, but never auto-roll any non-coordinators." A coordinator should
 * follow the new rules (a new ccrc release, new skill text) as soon as it is idle; a non-coordinator picks them up the
 * next time it starts for another reason (a wake, an ensure, a swap), so this verdict never takes one.
 *
 * BEHIND (D-7454): a coordinator is behind when its Claude Code process started before the node's current ccrc install
 * completed: the live file's `startedAt` (`sessions/<pid>.json`, the process's own stamp) against the modification time
 * of `~/.ccrc/installed`, the completed-install record `ccrc install` writes as its last step. The Claude Code binary
 * trigger is not here: it comes with the binary-lifecycle programme's `ccd roll` (its wave 2) and its canary.
 *
 * IDLE is hibernation's gate (`hibernateVerdict`, the one ladder `decideSleep` runs), with its quiet window set to the
 * roll's 90 minutes (binary-lifecycle spec §7.2, its U2) and its claims holds passed (`ROLL_IDLE_GATE`, D-7562: an
 * open run the coordinator claims, planned or dispatched, and a live claim do not hold a roll), plus this verdict's own
 * holds: `.no-roll`, hibernation due soon, and a live status that moved in the last 10 minutes (`compacting`: Claude
 * Code's idle compaction runs on a turn that already ended, so the turn marker does not see it, but the live status
 * does). ccd re-measures the box-local half
 * at the act (`ccd hibernate --roll`, D-7458: a draft in the input box, `esc to interrupt`, an attached terminal,
 * `.no-roll`), and its refusal is the lane's skip.
 *
 * HIBERNATION COUNTS AS THE ROLL: a wake starts the session on the current release, so a coordinator hibernation will
 * take within `ROLL_HIBERNATION_LEAD_MS` is left to it (`hibernation-due`). Only an ARMED hibernation is due, and never
 * for a session carrying `.no-hibernate`, which hibernation does not take (D-7458).
 *
 * The order is cheapest first: the setting, then the role (so a child is never measured), then the node's install
 * time, then `measure` (the live reads), then behind, the opt-outs, the idle gate, hibernation and compaction.
 * Every fact that could not be read holds. A MANUAL restart never calls this: the operator chose the session.
 */
import type { SessionRole } from '../../../shared/api.js';
import { CLAUDE_ROLL_TARGETS_DEFAULT, isClaudeRollTargets, type ClaudeRollTargets } from '../../../shared/claudeVersion.js';
import { hibernateVerdict, type HibernateHold, type HibernateInput, type IdleGateOptions } from './hibernate.js';

/** The quiet window (binary-lifecycle spec §7.2 and §12, decision U2): the turn marker's newest stamp older than this. */
export const ROLL_QUIET_MS = 90 * 60_000;
/** Hibernation counts as the roll: a coordinator hibernation will take within this is left to it (ruling 3). */
export const ROLL_HIBERNATION_LEAD_MS = 30 * 60_000;
/** The `compacting` hold's window (spec §7.2): a live status that moved this recently holds. */
export const ROLL_COMPACT_QUIET_MS = 10 * 60_000;
/** The roll's idle gate (D-7562, the operator's ruling of 2026-10-30): an open run the coordinator claims and a live claim
 *  it holds do not hold a roll, which comes straight back as the same session with its runs and claims standing. Every
 *  other hold of hibernation's gate still holds. Used here only: hibernation and every other caller keep the default. */
export const ROLL_IDLE_GATE: IdleGateOptions = { claims: 'pass' };
/** `$REG/<id>.no-roll` (decision U4): that session is never rolled automatically. Written by hand, never by the tree. */
export const NO_ROLL_SUFFIX = 'no-roll';
/** The actor the act declares on `ccd hibernate --roll`, as every unattended lane names itself. */
export const ROLL_SWEEP_ACTOR = 'sweep:roll';

/** Why a session was not rolled, in the order the ladder tests them. Each is a word the lane's journal line prints. */
const AUTO_ROLL_SKIP_MAP = {
  'setting-unreadable': 'the Settings row could not be read, so nothing is rolled',
  'setting-off': 'Settings › Automation › Roll idle sessions is off',
  'role-unknown': 'the row does not say whether it is a coordinator',
  'not-coordinator': 'it is not a coordinator: it picks up the release when it next starts for another reason',
  'release-unmeasured': 'when the node\'s current ccrc install completed could not be read',
  'start-unmeasured': 'when its Claude Code process started could not be read',
  'no-roll': 'the operator opted it out ($REG/<id>.no-roll)',
  'idle-gate': 'the idle gate holds it (the hold is named beside)',
  'hibernation-due': 'hibernation will take it within 30 minutes, and the wake brings the release',
  'compacting': 'its live status moved within 10 minutes (a compaction may be running), or could not be read',
} as const satisfies Record<string, string>;
export type AutoRollSkip = keyof typeof AUTO_ROLL_SKIP_MAP;
export const AUTO_ROLL_SKIPS: readonly AutoRollSkip[] = Object.keys(AUTO_ROLL_SKIP_MAP) as AutoRollSkip[];
export function autoRollSkipText(s: AutoRollSkip): string { return AUTO_ROLL_SKIP_MAP[s]; }

/** Every kebab word this file spells as a literal (its skips, the opt-out suffix, the actor), for `mail-routes.test.ts`'s
 *  census of `server/src/coord`: none is a mail rejection or a route refusal. Derived, never re-spelled. */
const AUTO_ROLL_KEBABS: ReadonlySet<string> = new Set<string>([...AUTO_ROLL_SKIPS, NO_ROLL_SUFFIX, ROLL_SWEEP_ACTOR]);
export function isAutoRollKebab(token: string): boolean { return AUTO_ROLL_KEBABS.has(token); }

/** The setting and the role, the filter every automatic roll applies before it measures anything. */
export type RollTargetVerdict =
  | { readonly take: true }
  | { readonly take: false; readonly skip: Extract<AutoRollSkip, 'setting-off' | 'role-unknown' | 'not-coordinator'> };

/** May an automatic roll take this session at all? `off` takes nothing; then only a coordinator. A row whose role is
 *  unknown (an older build's snapshot) is never taken, and an unreadable `.child` already reads `child`
 *  (`sessionRoleOf`). */
export function rollTargetVerdict(targets: ClaudeRollTargets, role: SessionRole | null): RollTargetVerdict {
  if (targets === 'off') return { take: false, skip: 'setting-off' };
  if (role === null) return { take: false, skip: 'role-unknown' };
  if (role !== 'coordinator') return { take: false, skip: 'not-coordinator' };
  return { take: true };
}

/** The Settings row as the store read it (`CoordStore.rollSettings`), every value `unknown`. */
export type RollSettingsRead =
  | { readonly kind: 'row'; readonly targets: unknown }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The setting: a stored choice through the one narrowing; a lost row is the default (the seed); a value this build
 *  does not know, or a read that failed, is `null`, which rolls nothing. */
export function rollTargetsOf(r: RollSettingsRead): ClaudeRollTargets | null {
  if (r.kind === 'absent') return CLAUDE_ROLL_TARGETS_DEFAULT;
  if (r.kind === 'unreadable') return null;
  return isClaudeRollTargets(r.targets) ? r.targets : null;
}

export interface AutoRollInput {
  /** The Settings row; null when it could not be read. */
  readonly targets: ClaudeRollTargets | null;
  /** `FleetSession.role` (`sessionRoleOf`); null when the row did not say. */
  readonly role: SessionRole | null;
  /** When the node's current ccrc install completed (epoch ms); null when it could not be read. */
  readonly release: number | null;
  /** When this session's Claude Code process started (epoch ms); null when it could not be read. Read with the live
   *  state, so it is not looked at while `sleep.live` is unread. */
  readonly startedAt: number | null;
  /** `$REG/<id>.no-roll` and `$REG/<id>.no-hibernate`. Only `.no-roll` opts out of the roll (D-7458): the act,
   *  `ccd hibernate --roll`, refuses `.no-roll` and not `.no-hibernate`. `.no-hibernate` says only that hibernation
   *  will never take the session, so `hibernation-due` never holds it. */
  readonly optedOut: { readonly roll: boolean; readonly hibernate: boolean };
  /** Hibernation as it stands: armed (its live switch, no kill switch, the verb on the box) and its N. */
  readonly hibernation: { readonly armed: boolean; readonly afterMs: number };
  /** The live file's `statusUpdatedAt` (the row's own); null when it carried none. */
  readonly statusUpdatedAt: number | null;
  /** Hibernation's input for this row. Its own `optedOut` is not read: the roll's opt-out is above. */
  readonly sleep: HibernateInput;
  readonly now: number;
}

export type AutoRollVerdict =
  | { readonly act: 'roll'; readonly idleMs: number }
  | { readonly act: 'measure' }
  | { readonly act: 'current' }
  | { readonly act: 'skip'; readonly reason: Exclude<AutoRollSkip, 'idle-gate'> }
  | { readonly act: 'skip'; readonly reason: 'idle-gate'; readonly hold: HibernateHold };

/** Roll this session onto the current release now? */
export function autoRollVerdict(i: AutoRollInput): AutoRollVerdict {
  if (i.targets === null) return { act: 'skip', reason: 'setting-unreadable' };
  const t = rollTargetVerdict(i.targets, i.role);
  if (!t.take) return { act: 'skip', reason: t.skip };
  if (i.release === null) return { act: 'skip', reason: 'release-unmeasured' };
  if (i.sleep.live.kind === 'unread') return { act: 'measure' };
  if (i.startedAt === null) return { act: 'skip', reason: 'start-unmeasured' };
  if (i.startedAt >= i.release) return { act: 'current' };
  if (i.optedOut.roll) return { act: 'skip', reason: 'no-roll' };
  const sleep = { ...i.sleep, optedOut: false };
  const gate = hibernateVerdict(sleep, i.now, ROLL_QUIET_MS, ROLL_IDLE_GATE);
  if (gate.act === 'measure') return { act: 'measure' };
  if (gate.act === 'hold') return { act: 'skip', reason: 'idle-gate', hold: gate.reason };
  // D-7562: hibernation keeps its claims holds, so it never takes a coordinator that claims a run or holds a claim, and
  // only one its own gate would pass is due.
  const hibernationTakes = hibernateVerdict(sleep, i.now, ROLL_QUIET_MS).act === 'hibernate';
  if (i.hibernation.armed && !i.optedOut.hibernate && hibernationTakes && gate.idleMs + ROLL_HIBERNATION_LEAD_MS >= i.hibernation.afterMs) {
    return { act: 'skip', reason: 'hibernation-due' };
  }
  if (i.statusUpdatedAt === null || i.now - i.statusUpdatedAt < ROLL_COMPACT_QUIET_MS) return { act: 'skip', reason: 'compacting' };
  return { act: 'roll', idleMs: gate.idleMs };
}
