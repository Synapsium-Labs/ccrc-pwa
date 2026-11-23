/**
 * THE AUTOMATIC ROLL (D-7443, D-7452, D-7454; D-8276): L1, pure.
 *
 * WHO (D-8276, the operator's ruling of 2026-11-10, reversing the 2026-10-29 rule "never auto-roll any
 * non-coordinators"): every idle session rolls onto the newest release, and the newest Claude Code build a restart
 * reaches, as soon as it can, under
 * the setting's default `all`. The setting keeps `coordinators` (the 2026-10-29 rule: an idle coordinator only) and
 * `off` as choices, and a session's own `.no-roll` marker opts it out under every value.
 *
 * BEHIND (D-7454; D-8276): a session is behind when its Claude Code process started before the node's current ccrc
 * install completed (the live file's `startedAt`, `sessions/<pid>.json`, against the modification time of
 * `~/.ccrc/installed`, the completed-install record `ccrc install` writes as its last step), OR when a restart would
 * move it onto a newer Claude Code build: its build is older than the fleet's newest AND older than the newest an awake
 * session on its own lane runs (`claudeBuildOf`'s `reach`, `shared/claudeVersion.ts`). The fleet's newest alone is not
 * enough: the launcher picks the lane's own recorded build before the highest installed one, so a restart keeps a
 * session on its lane's build (binary-lifecycle spec §2.2, "installed is not running"), and a roll of a session whose
 * lane runs nothing newer would spend a restart (and its memory, spec §2.3) to reach nothing. A session already rolled
 * for its lane's reach (`rolledFor`) is not rolled for it again: its restart did not reach it, so another would not.
 *
 * BEHIND ITS CLASS'S MODEL (model-class follow-up typed-repick): a session of an Anthropic lane is behind, too, when it runs
 * a model its class has left (`aliasModelBehind`, `shared/model-aliases.mjs`, the one test doctor's `model-sessions-behind`
 * also asks, here with the seen rule and without doctor's day). Every spawn composes `--model <class>` (and the held id's
 * variable while a hold stands), so a roll's resume lands on the class's current or held id. The lane's models are read
 * only for a session that passes every other gate and is behind on nothing else (`read-models`), at most once per lane per
 * pass, and a successful read stands for an hour (`LANE_MODELS_KEEP_MS`, `server/src/rollLane.ts`). Only a usage reading
 * rendered after the session's current pane started counts (`modelCandidateOf`). An unread, unmeasured or unreadable
 * answer is never behind. A session already rolled for a target
 * (`rolledModelFor`) is not rolled for it again: its relaunch kept the old id (a hand pick, say), so another would too.
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
 * The order is cheapest first: the setting, then the role (so under `coordinators` a child is never measured), then the
 * node's install time, then `measure` (the live reads), then behind, the opt-outs, the idle gate, hibernation and
 * compaction.
 * Every fact that could not be read holds. A MANUAL restart never calls this: the operator chose the session.
 *
 * THE HAND-OFF TO THE RENEWAL LANE (Overlord spec §3.3.8; W1a, plan `w1a-renewal-handoffs.md` Task 5): once the `continuity`
 * row is live, a long-lived session is the renewal lane's (`renewal-owns`): a roll would resume its old conversation, and the
 * renewal lane renews it from canonical state instead (the new install it would have answered is `renewalDue`'s
 * `new-install` soft row). A session whose long-life cannot be read is held (`role-unknown`). While the row is shadow every
 * session is judged as before (slug roll-skips-long-lived-when-live).
 *
 * AN ENTRY IDENTITY THAT STAYS PENDING (D-8955): a spawn writes a `pending` entry line before its pane exists, and the pane
 * replaces it with where it entered. A pane whose writer never ran (a spawn whose command lost its text on the way) leaves
 * the line pending for good, and ccd then holds every child reclaim on the box that could share its tree, because it cannot
 * place that row. ccd's own remedy is to stop and start the session, which is what a roll is. So a session the cleanup
 * lanes have named `entry-pending` for `ENTRY_PENDING_ROLL_MS`, whose current process was already running when they first
 * named it, is behind as well, and every gate below still holds it, but only once a read taken past its spawn's first seconds
 * named it too (`entryPendingStuck`). A process that started after the first naming is not rolled for it: that restart
 * already happened, so one pending episode rolls a session at most once in one server process, and the disk lane's stall
 * alert tells the operator if it stays pending. The episodes are in the server's memory, so a server restart forgets them:
 * a session still pending after its roll can be rolled once more after each server restart (review 8).
 */
import type { SessionRole } from '../../../shared/api.js';
import type { EntryPendingEpisode } from '../cleanupHeldBy.js';
import { FLEET_ROLES } from '../../../shared/fleetRoles.js';
import { ROLE_AMBIGUITIES, type RoleReading } from '../roleOf.js';
import { CLAUDE_ROLL_TARGETS_DEFAULT, isClaudeRollTargets, type ClaudeBuildFact, type ClaudeRollTargets } from '../../../shared/claudeVersion.js';
import { hibernateVerdict, type HibernateHold, type HibernateInput, type IdleGateOptions } from './hibernate.js';
import { aliasModelBehind, type AliasClassView } from '../../../shared/model-aliases.mjs';
import { CLASSES, type LaneClassAdvance, type LaneClassModel, type LaneModelsRead, type ModelClass } from '../../../shared/models.js';
import type { FleetSession } from '../../../shared/api.js';

/** The quiet window (binary-lifecycle spec §7.2 and §12, decision U2): the turn marker's newest stamp older than this. */
export const ROLL_QUIET_MS = 90 * 60_000;
/** Hibernation counts as the roll: a coordinator hibernation will take within this is left to it (ruling 3). */
export const ROLL_HIBERNATION_LEAD_MS = 30 * 60_000;
/** D-8955: a session's entry identity named pending this long, on the process that runs now, is a roll reason. */
export const ENTRY_PENDING_ROLL_MS = 10 * 60_000;
/** D-8955: a pane writes its entry in its first seconds; a read taken this long after the process started is past that. It
 *  covers the coord frame's lag behind an audit (one tick) as well. */
export const ENTRY_PENDING_SPAWN_GRACE_MS = 2 * 60_000;
/** The `compacting` hold's window (spec §7.2): a live status that moved this recently holds. */
export const ROLL_COMPACT_QUIET_MS = 10 * 60_000;
/** The roll's idle gate (D-7562, the operator's ruling of 2026-10-30): an open run the coordinator claims and a live claim
 *  it holds do not hold a roll, which comes straight back as the same session with its runs and claims standing. Every
 *  other hold of hibernation's gate still holds. Used here only: hibernation and every other caller keep the default. */
export const ROLL_IDLE_GATE: IdleGateOptions = { claims: 'pass' };
/** `$REG/<id>.no-roll` (decision U4): that session is never rolled automatically. Written by hand, and by `ccd keep-awake`
 *  on the Overlord's body (spec §3.2, Overlord W1 ccd arms); the server lists it, never reads its bytes. */
export const NO_ROLL_SUFFIX = 'no-roll';
/** The actor the act declares on `ccd hibernate --roll`, as every unattended lane names itself. */
export const ROLL_SWEEP_ACTOR = 'sweep:roll';

/** Why a session was not rolled, in the order the ladder tests them. Each is a word the lane's journal line prints. */
const AUTO_ROLL_SKIP_MAP = {
  'setting-unreadable': 'the Settings row could not be read, so nothing is rolled',
  'setting-off': 'Settings › Automation › Roll idle sessions is off',
  'role-unknown': 'the row does not say whether it is a coordinator (the setting is coordinators only) or whether it is long-lived (continuity is live)',
  'renewal-owns': 'continuity is live and it is long-lived: the renewal lane renews it from its card, so a roll would resume its old conversation',
  'not-coordinator': 'the setting is coordinators only, and it is not one: it picks up the release when it next starts for another reason',
  'designation-unreadable': 'the Overlord designation could not be read, so nothing is rolled',
  overlord: 'it is the Overlord\'s bound or pending body: the renewal lane moves it to a new build, never the roll',
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

/** Typed-repick: the verdict's act that asks the pass to read a lane's models, then ask again. */
const READ_MODELS = 'read-models';

/** Every kebab word this file spells as a literal (its skips, the opt-out suffix, the actor, the read-models act), for
 *  `mail-routes.test.ts`'s census of `server/src/coord`: none is a mail rejection or a route refusal. Derived, never
 *  re-spelled. */
const AUTO_ROLL_KEBABS: ReadonlySet<string> = new Set<string>([...AUTO_ROLL_SKIPS, NO_ROLL_SUFFIX, ROLL_SWEEP_ACTOR, READ_MODELS]);
export function isAutoRollKebab(token: string): boolean { return AUTO_ROLL_KEBABS.has(token); }

/** The setting and the role, the filter every automatic roll applies before it measures anything. */
export type RollTargetVerdict =
  | { readonly take: true }
  | { readonly take: false; readonly skip: Extract<AutoRollSkip, 'setting-off' | 'role-unknown' | 'not-coordinator' | 'renewal-owns'> };

/** May an automatic roll take this session at all? `off` takes nothing. While `continuityLive`, a long-lived session is the
 *  renewal lane's (`renewal-owns`) and one whose long-life is unread (`null`) is held (`role-unknown`); while it is shadow,
 *  `longLived` is not read. Then `all` (D-8276) takes every role, the role unread, and `coordinators` only a coordinator.
 *  Under `coordinators` a row whose role is unknown (an older build's snapshot) is never taken, and an unreadable `.child`
 *  already reads `child` (`server/src/roleOf.ts#sessionRoleOf`). */
export function rollTargetVerdict(targets: ClaudeRollTargets, role: SessionRole | null, longLived: boolean | null,
  continuityLive: boolean): RollTargetVerdict {
  if (targets === 'off') return { take: false, skip: 'setting-off' };
  if (continuityLive && longLived === null) return { take: false, skip: 'role-unknown' };
  if (continuityLive && longLived) return { take: false, skip: 'renewal-owns' };
  if (targets === 'all') return { take: true };
  if (role === null) return { take: false, skip: 'role-unknown' };
  if (role !== 'coordinator') return { take: false, skip: 'not-coordinator' };
  return { take: true };
}

/** Whether a session is long-lived, for the roll's hand-off: its role's `longLived` (Table 3.3.9a) when `roleOf` decided it,
 *  or when every role it cannot tell apart agrees (worker or reviewer: no). A coordinator-or-plain reading (no open run
 *  claimed, intent unread) is long-lived exactly when the renewal lane holds a live generation for it, since it mints for
 *  nothing else (slug roll-long-lived-reads-the-live-generation); null when that could not be read either. */
export function longLivedOf(r: RoleReading, liveGeneration: boolean | 'unmeasured'): boolean | null {
  if (r.kind === 'role') return FLEET_ROLES[r.role].longLived || liveGeneration === true;
  const members = ROLE_AMBIGUITIES[r.between].map((role) => FLEET_ROLES[role].longLived);
  if (members.every((m) => m === members[0])) return members[0]!;
  return liveGeneration === 'unmeasured' ? null : liveGeneration;
}

/** The Settings row as the store read it (`CoordStore.rollSettings`), every value `unknown`. `seeded`: the row is the
 *  migration's seed, never written by an operator (its `updatedAt` is still the seed's 0). */
export type RollSettingsRead =
  | { readonly kind: 'row'; readonly targets: unknown; readonly seeded: boolean }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The setting: a stored choice through the one narrowing; a lost row, and the migration's seed no operator has written
 *  (D-8276: it spells the 2026-10-29 rule, which the operator's ruling of 2026-11-10 reversed), are the default; a value
 *  this build does not know, or a read that failed, is `null`, which rolls nothing. */
export function rollTargetsOf(r: RollSettingsRead): ClaudeRollTargets | null {
  if (r.kind === 'absent' || (r.kind === 'row' && r.seeded)) return CLAUDE_ROLL_TARGETS_DEFAULT;
  if (r.kind === 'unreadable') return null;
  return isClaudeRollTargets(r.targets) ? r.targets : null;
}

/** The model term's fact for one session (typed-repick). `none`: it cannot be behind on its model (not an Anthropic lane, no
 *  routed class, no main-loop model, or a model of another family); `unread`: it could be, and its lane's models have not been
 *  read this pass; `unmeasured`: the read gave no usable answer; `current`: it is on its class's target, or its class has
 *  none; `behind`: the class's target is `to`, and it runs `from`. Five arms, because the pass and the log answer them
 *  differently; only `behind` puts a session behind. */
export type ModelFact =
  | { readonly kind: 'none' }
  | { readonly kind: 'unread' }
  | { readonly kind: 'unmeasured' }
  | { readonly kind: 'current' }
  | { readonly kind: 'behind'; readonly class: ModelClass; readonly from: string; readonly to: string };

/** The session's side of the model term, from the row the pass already holds: its lane is an Anthropic one, its routing
 *  record names a class (readable, and one of the four: `default` and an unknown word are no class), and its usage sidecar
 *  names a main-loop model of that class's family, RENDERED AFTER ITS CURRENT PANE STARTED (`startedAt`, the live start the
 *  roll reads; fix round 1 on #3238). A reading from before the start describes the process a relaunch replaced: a session
 *  relaunched by any other path (a build or release roll, a swap, a wake) comes up on its class's current id and has not
 *  rendered since, so that reading would roll it for nothing. An unknown start is no candidate. No freshness rule beyond
 *  that: a session sits idle 90 minutes before a roll, and Claude Code does not re-render an idle session's status line,
 *  so every reading the roll could act on is past `USAGE_FRESH_S` and marked stale. Null: it cannot be behind on its
 *  model, and its lane is not read for it. */
export function modelCandidateOf(row: Pick<FleetSession, 'route' | 'usage'>, anthropicLane: boolean, startedAt: number | null):
  { readonly cls: ModelClass; readonly model: string } | null {
  if (!anthropicLane || row.route === null || row.route.unreadable.includes('class')) return null;
  if (startedAt === null || row.usage === null || !(row.usage.ts * 1000 > startedAt)) return null;
  const word = row.route.fields.class;
  const cls = (CLASSES as readonly string[]).includes(word ?? '') ? word as ModelClass : null;
  const model = row.usage?.model ?? null;
  if (cls === null || model === null || model === '' || row.usage?.class !== cls) return null;
  return { cls, model };
}

/** One class of a lane-models read as `aliasModelBehind` reads it. While a hold that names an id stands, the row's `model` is
 *  the held id and `aliasId` the alias's own when it differs; otherwise `model` is the alias's id, or null when there is
 *  none or the lane's build cannot launch it. `seenId` absent (an op that predates it) is no launch seen. */
function viewOfLaneClass(r: LaneClassModel, a: LaneClassAdvance): AliasClassView {
  const hold = a.hold === null ? null : { model: typeof a.hold.model === 'string' ? a.hold.model : null };
  const heldId = hold === null ? null : hold.model;
  return {
    id: heldId !== null ? (r.aliasId ?? r.model) : r.model,
    launchable: r.unlaunchable === undefined,
    seenId: r.seenId ?? null,
    hold,
    heldId,
  };
}

/** The model term's fact, from the session's side and its lane's read this pass (undefined: not read yet). Only a read with
 *  its advance file read (`ok`) or known absent (no hold stands) is judged: holds unknown is `unmeasured`, never a guess. */
export function modelFactOf(candidate: { readonly cls: ModelClass; readonly model: string } | null,
  read: LaneModelsRead | undefined): ModelFact {
  if (candidate === null) return { kind: 'none' };
  if (read === undefined) return { kind: 'unread' };
  if (read.kind !== 'read') return { kind: 'unmeasured' };
  const adv = read.advance;
  if (adv === undefined || (adv.state !== 'ok' && adv.state !== 'absent')) return { kind: 'unmeasured' };
  const classes: Partial<Record<ModelClass, AliasClassView>> = {};
  for (const c of CLASSES) {
    const a = adv.state === 'ok' && adv.classes !== null ? adv.classes[c] : null;
    if (adv.state === 'ok' && a === null) return { kind: 'unmeasured' };
    classes[c] = viewOfLaneClass(read.classes[c], a ?? NO_HOLD);
  }
  const b = aliasModelBehind(candidate, classes, { seen: true });
  return b === null ? { kind: 'current' } : { kind: 'behind', class: b.class, from: b.from, to: b.to };
}
const NO_HOLD: LaneClassAdvance = { family: null, hold: null, previous: null, revertable: false, lastMove: null };

export interface AutoRollInput {
  /** The Settings row; null when it could not be read. */
  readonly targets: ClaudeRollTargets | null;
  /** The designation as the lane read it this pass: this row is the Overlord's bound or pending body (`true`), is not
   *  (`false`), or the read failed (`'unmeasured'`): two conditions, two values, never one null. */
  readonly overlord: boolean | 'unmeasured';
  /** `FleetSession.role` (`server/src/roleOf.ts#sessionRoleOf`); null when the row did not say. */
  readonly role: SessionRole | null;
  /** Whether the session is long-lived (`longLivedOf`); null when unread. Read only while `continuityLive`. */
  readonly longLived: boolean | null;
  /** The `continuity` row is live: the renewal lane owns every long-lived session (Task 5). */
  readonly continuityLive: boolean;
  /** When the node's current ccrc install completed (epoch ms); null when it could not be read. */
  readonly release: number | null;
  /** When this session's Claude Code process started (epoch ms); null when it could not be read. Read with the live
   *  state, so it is not looked at while `sleep.live` is unread. */
  readonly startedAt: number | null;
  /** D-8276: this session's Claude Code build against the fleet's newest, with the build a restart on its lane reaches
   *  (`claudeBuildOf`). Only a `reach` puts it behind on the build. */
  readonly build: ClaudeBuildFact;
  /** D-8276: the reach this session was last rolled for, by this server process; null when none. A session already
   *  rolled for the same reach is not behind on the build (the restart did not reach it). */
  readonly rolledFor: string | null;
  /** Typed-repick: whether it runs a model its class has left (`modelFactOf`). */
  readonly model: ModelFact;
  /** Typed-repick: the target this session was last rolled for on its model, by this server process; null when none. A
   *  session already rolled for the same target is not behind on its model (its relaunch kept the old id). */
  readonly rolledModelFor: string | null;
  /** D-8955: this row's `entry-pending` episode as the roll's passes saw it (`entryPendingEpisodesOf`), or null when no
   *  read names it so. */
  readonly entryPending: EntryPendingEpisode | null;
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
  /** `model`: present when the session is behind its class's model, the class and the target it is rolled for.
   *  `entryPending`: present when its entry identity stayed pending (D-8955). */
  | { readonly act: 'roll'; readonly idleMs: number; readonly model?: { readonly class: ModelClass; readonly from: string; readonly to: string };
      readonly entryPending?: true }
  | { readonly act: 'measure' }
  /** Behind on nothing it has read, every other gate passed, and its lane's models not read yet: read them, then ask again. */
  | { readonly act: typeof READ_MODELS }
  | { readonly act: 'current' }
  | { readonly act: 'skip'; readonly reason: Exclude<AutoRollSkip, 'idle-gate'> }
  | { readonly act: 'skip'; readonly reason: 'idle-gate'; readonly hold: HibernateHold };

/** THE ONE "behind the install" test (review 2003 N3): this session's process started before the node's current ccrc install
 *  completed. The roll's `current` is its negation; the generations lane's `installBehind` reads it as it is. */
export function startedBeforeRelease(startedAt: number, release: number): boolean {
  return startedAt < release;
}

/** D-8955: the entry identity has stood pending for the window; the process that runs now was already running when it was
 *  first named pending (so it is that process's spawn whose entry was never recorded); and a read taken past that spawn's
 *  window named it (`freshAfter`), so it is not a naming from the spawn's own first seconds (review 3). */
export function entryPendingStuck(e: EntryPendingEpisode | null, startedAt: number, now: number): boolean {
  return e !== null && startedAt <= e.since && e.freshAfter !== null && e.freshAfter >= startedAt + ENTRY_PENDING_SPAWN_GRACE_MS
    && now - e.since >= ENTRY_PENDING_ROLL_MS;
}

/** Roll this session onto the current release and build now? */
export function autoRollVerdict(i: AutoRollInput): AutoRollVerdict {
  if (i.targets === null) return { act: 'skip', reason: 'setting-unreadable' };
  const t = rollTargetVerdict(i.targets, i.role, i.longLived, i.continuityLive);
  if (!t.take) return { act: 'skip', reason: t.skip };
  if (i.overlord === 'unmeasured') return { act: 'skip', reason: 'designation-unreadable' };
  if (i.overlord) return { act: 'skip', reason: 'overlord' };
  if (i.release === null) return { act: 'skip', reason: 'release-unmeasured' };
  if (i.sleep.live.kind === 'unread') return { act: 'measure' };
  if (i.startedAt === null) return { act: 'skip', reason: 'start-unmeasured' };
  const buildBehind = i.build.kind === 'behind' && i.build.reach !== null && i.rolledFor !== i.build.reach;
  const modelBehind = i.model.kind === 'behind' && i.rolledModelFor !== i.model.to;
  const pending = entryPendingStuck(i.entryPending, i.startedAt, i.now);
  const behind = startedBeforeRelease(i.startedAt, i.release) || buildBehind || modelBehind || pending;
  // Behind on nothing read, but maybe on its model: every gate below holds it as current, never as a skip, since it may
  // not be behind at all; past them all, the lane's models are read.
  const maybe = !behind && i.model.kind === 'unread';
  if (!behind && !maybe) return { act: 'current' };
  const skip = (v: AutoRollVerdict): AutoRollVerdict => (maybe ? { act: 'current' } : v);
  if (i.optedOut.roll) return skip({ act: 'skip', reason: 'no-roll' });
  const sleep = { ...i.sleep, optedOut: false };
  const gate = hibernateVerdict(sleep, i.now, ROLL_QUIET_MS, ROLL_IDLE_GATE);
  if (gate.act === 'measure') return { act: 'measure' };
  if (gate.act === 'hold') return skip({ act: 'skip', reason: 'idle-gate', hold: gate.reason });
  // D-7562: hibernation keeps its claims holds, so it never takes a coordinator that claims a run or holds a claim, and
  // only one its own gate would pass is due.
  const hibernationTakes = hibernateVerdict(sleep, i.now, ROLL_QUIET_MS).act === 'hibernate';
  if (i.hibernation.armed && !i.optedOut.hibernate && hibernationTakes && gate.idleMs + ROLL_HIBERNATION_LEAD_MS >= i.hibernation.afterMs) {
    return skip({ act: 'skip', reason: 'hibernation-due' });
  }
  if (i.statusUpdatedAt === null || i.now - i.statusUpdatedAt < ROLL_COMPACT_QUIET_MS) return skip({ act: 'skip', reason: 'compacting' });
  if (maybe) return { act: READ_MODELS };
  const why = pending ? { entryPending: true as const } : {};
  if (modelBehind && i.model.kind === 'behind') {
    return { act: 'roll', idleMs: gate.idleMs, model: { class: i.model.class, from: i.model.from, to: i.model.to }, ...why };
  }
  return { act: 'roll', idleMs: gate.idleMs, ...why };
}
