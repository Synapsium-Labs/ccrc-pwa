import { TERMINAL_RUN_STATES, type FleetSession } from '../../shared/api.js';
import { turnSays, turnWordOf, type TurnPolicy } from './sessionReading.js';

/**
 * WHEN A SESSION SLEEPS (D-7040; ARCH-43, consolidation spec K1, C4 "Policies, not lanes"): the one decider.
 *
 * Two lanes put a session to sleep with `ccd hibernate`: hibernation (`idle-hours`, D-5242: a long-idle session) and
 * stop-done (`run-done`, D-5370, D-5427, D-6091, D-6092: a finished run's worker). They are two POLICIES of one
 * transition, and they share one ladder here. Every way the two differ that the decision reads is a field of the policy
 * row (`SleepPolicy`): which holds stand before `opted-out`, whether a workspace hold can pass, the run clock, whether
 * `no-verb` holds before `measure`, whether the turn verdict is read, the live-word rule and the quiet rule. The rows
 * live with their lanes (`RUN_DONE_POLICY` in `stopDone.ts`, `IDLE_HOURS_POLICY` in `coord/hibernate.ts`), beside the
 * hold maps that word their answers; this file imports neither (the rows import it).
 *
 * The ladder runs cheapest first; `measure` asks the lane to make the live reads (tmux and file reads) only for a session
 * nothing cheaper holds; every fact the lane did not read HOLDS wherever a row reads it — never an unmeasured sleep.
 * `decideSleep` never asks which policy it runs (`policy.name` is for logs and censuses): only the row's fields steer it
 * (pinned by `single-definition/late-census.test.ts`).
 *
 * What is NOT here, because the lanes keep it apart (spec K1: "merging the rows' code never merges their arming or their
 * herd budget"): arming, kill switches, cadence, per-pass caps, retry memory, the store queries behind each fact and the
 * act. A pane's death reaches this file as the boolean `paneDead`, built by the lane that reads it; nothing here compares
 * a status, bucket or lifecycle with a dead word.
 *
 * L1: decisions only. It imports L0 and `sessionReading.ts` alone.
 */

/** The two policies, by name. A row's `name` is one of these, referenced, never re-spelled. */
export const SLEEP_POLICY_NAMES = ['run-done', 'idle-hours'] as const;
export type SleepPolicyName = (typeof SLEEP_POLICY_NAMES)[number];

/** Whether a stand hold (`.hold`) can pass. `any-holds`: every hold holds. `workspace-passes`: a hold the lane classified
 *  as guarding only the workspace (a programme hold, or one naming a terminal run) passes when the box's ccd can pass it
 *  too (`hibernate-hold-ok`); the input says so in `heldPasses`. */
export const SLEEP_HELD_RULES = { anyHolds: 'any-holds', workspacePasses: 'workspace-passes' } as const;
export type SleepHeldRule = (typeof SLEEP_HELD_RULES)[keyof typeof SLEEP_HELD_RULES];

/** The run clock. `none`: no run is read. `run-close`: the session's newest placed run must be finished — terminal and
 *  closed at least the input's quiet threshold ago, or parked in one of `parkedStates` (whose clock is the marker's quiet
 *  alone). */
export const SLEEP_RUN_CLOCKS = { none: 'none', runClose: 'run-close' } as const;
export type SleepRunClockKind = (typeof SLEEP_RUN_CLOCKS)[keyof typeof SLEEP_RUN_CLOCKS];

/** The quiet rule's boundary: `recent` holds while the marker's quiet is `below` the threshold (`idleMs < t`), or
 *  `at-most` it (`idleMs <= t`). */
export const SLEEP_QUIET_BOUNDARIES = { below: 'below', atMost: 'at-most' } as const;
export type SleepQuietBoundary = (typeof SLEEP_QUIET_BOUNDARIES)[keyof typeof SLEEP_QUIET_BOUNDARIES];

export type SleepRunClock =
  | { readonly kind: typeof SLEEP_RUN_CLOCKS.none }
  | { readonly kind: typeof SLEEP_RUN_CLOCKS.runClose; readonly parkedStates: readonly string[] };

/** One policy row. `W` is the policy's own hold word, typed by its map (`StopDoneHold`, `HibernateHold`). */
export interface SleepPolicy<W extends string> {
  readonly name: SleepPolicyName;
  /** The policy's hold list (its map's keys): every word a `hold` answer under this row carries. */
  readonly holds: readonly W[];
  /** The holds before `opted-out`, beyond `archived` (by `archivedAt`) and `unmeasured`, which every row holds:
   *  `child`: only a dispatched child (`not-a-child`, `child-unreadable`, first); `archivedBucket`: bucket `archived`
   *  holds `archived` too; `paneDead`: a dead pane holds `pane`, after `archived`; `stopped`: a stop stamp holds
   *  `stopped`, after `archived`. */
  readonly entry: { readonly child: boolean; readonly archivedBucket: boolean; readonly paneDead: boolean; readonly stopped: boolean };
  readonly held: SleepHeldRule;
  /** Read after `runs-unreadable`, before `run-worker`. */
  readonly runClock: SleepRunClock;
  /** `no-verb` holds before `measure` (the caps, read once a pass). */
  readonly verbBeforeMeasure: boolean;
  /** The fail-closed turn verdict is read after the live word (`turn`; `unmeasured` holds `unmeasured`). */
  readonly turnVerdict: boolean;
  /** The turn policy the live word is read through (`turnSays`); `rest` passes, anything else holds `live-word`. */
  readonly liveWord: TurnPolicy;
  /** `recent`: the threshold is the input's `quietMs`, or `parkedMs` (when not null) for a run the run clock reads as
   *  parked or a sibling parked run (`parkedWorker`). */
  readonly quiet: { readonly boundary: SleepQuietBoundary; readonly parkedMs: number | null };
}

/** The registry row's facts every row reads — the fleet frame's own row. */
export type SleepRow = Pick<FleetSession,
  'archivedAt' | 'bucket' | 'held' | 'unmeasured' | 'statusUnmeasured' | 'dialogPending' | 'background' | 'subagents'
  | 'stranded' | 'swapBlocked' | 'substrate'>;

/** The coordination store's answers. `last` and `parkedWorker` are the run clock's; a lane without one passes `null`
 *  and `false`. */
export type SleepStoreRead =
  | { readonly ok: false; readonly detail: string }
  | {
    readonly ok: true;
    readonly last: { readonly runId: number; readonly state: string; readonly closedAt: number | null } | null;
    readonly openWorker: boolean;
    readonly parkedWorker: boolean;
    readonly openClaimant: boolean;
    readonly claim: boolean;
    readonly mail: boolean;
  };

/** The turn marker, as `turnMarkFor` reads it judged against the live process. Any `ok: false` holds `marker`. */
export type SleepMark =
  | {
    readonly ok: true; readonly state: string; readonly bg: number; readonly crons: number | null;
    readonly turnAt: number | null; readonly stopAt: number | null; readonly restartAt: number | null;
  }
  | { readonly ok: false; readonly reason: string };

/** The live reads, made only for a session every cheaper hold has passed. `turn` is `null` when the lane reads none. */
export type SleepLive =
  | { readonly kind: 'unread' }
  | {
    readonly kind: 'read';
    readonly word: { readonly ok: true; readonly word: string } | { readonly ok: false; readonly reason: 'no-pane' | 'no-config-dir' | 'unmeasured' };
    readonly turn: 'idle' | 'busy' | 'unmeasured' | null;
    readonly mark: SleepMark;
  };

/** The facts, as each lane's input builder assembles them. A `null` is a fact the lane did not read: it holds wherever a
 *  row reads it. */
export interface SleepInput {
  readonly row: SleepRow;
  /** The child marker; `null`: not read. */
  readonly child: FleetSession['child'] | null;
  /** The pane is dead; `null`: not read. */
  readonly paneDead: boolean | null;
  /** The registry carries a stop stamp; `null`: not read. */
  readonly stopped: boolean | null;
  /** The lane classified the row's hold as one that guards only the workspace, and the box's ccd can pass it. */
  readonly heldPasses: boolean;
  readonly optedOut: boolean;
  readonly store: SleepStoreRead;
  /** `Viewers.isOpen` (D-5242's presence contract): an open screen, visible or hidden. */
  readonly viewer: boolean;
  /** Milliseconds since the server started: no presence is believed for `viewerOpenTtlMs` after a start. */
  readonly sinceStartMs: number;
  readonly viewerOpenTtlMs: number;
  /** The box's ccd lists `hibernate` in its caps; `null`: not asked. */
  readonly verb: boolean | null;
  readonly live: SleepLive;
  readonly now: number;
  /** The quiet threshold (and the run clock's grace): run-done's grace, idle-hours' N. */
  readonly quietMs: number;
}

export type SleepVerdict<W extends string> =
  | {
    readonly act: 'hibernate'; readonly idleMs: number;
    /** The run the run clock read; `null` under `none`. */
    readonly runId: number | null;
    /** The exact `.hold` text a workspace hold passed with. */
    readonly holdOk?: string;
  }
  | { readonly act: 'measure' }
  | { readonly act: 'hold'; readonly reason: W };

/**
 * Put this session to sleep, under this policy row? One ladder, cheapest first, `measure` before any live read, every
 * unread fact holding. The row's fields steer it; its name never does.
 */
export function decideSleep<W extends string>(i: SleepInput, policy: SleepPolicy<W>): SleepVerdict<W> {
  // The words are the policy map's, checked here rather than cast: a word outside the row's own list is a ladder bug and
  // throws, so it never reaches a lane as an answer (the lanes' catch lines then act on nothing). The matrix in
  // `sleep-lanes-pin.test.ts` holds each real row to its own list, so neither throws.
  const hold = (reason: string): SleepVerdict<W> => {
    const word = policy.holds.find((h) => h === reason);
    if (word === undefined) throw new Error(`decideSleep: the hold '${reason}' is not in this policy's hold list`);
    return { act: 'hold', reason: word };
  };
  const r = i.row;
  const e = policy.entry;
  if (e.child && i.child !== null && i.child.kind === 'none') return hold('not-a-child');
  if (e.child && (i.child === null || i.child.kind === 'unreadable')) return hold('child-unreadable');
  if (r.archivedAt !== null || (e.archivedBucket && r.bucket === 'archived')) return hold('archived');
  if (e.paneDead && i.paneDead !== false) return hold('pane');
  if (e.stopped && i.stopped !== false) return hold('stopped');
  if (r.unmeasured.length > 0 || r.statusUnmeasured) return hold('unmeasured');
  if (i.optedOut) return hold('opted-out');
  const holdPasses = policy.held === SLEEP_HELD_RULES.workspacePasses && i.heldPasses;
  if (r.held !== null && !holdPasses) return hold('held');
  if (r.stranded !== null) return hold('stranded');
  if (r.swapBlocked !== null) return hold('swap-blocked');
  if (r.substrate !== null) return hold('substrate');
  const s = i.store;
  if (!s.ok) return hold('runs-unreadable');
  let runId: number | null = null;
  let parked = false;
  if (policy.runClock.kind === SLEEP_RUN_CLOCKS.runClose) {
    if (s.last === null) return hold('no-run');
    runId = s.last.runId;
    // D-6092 (F5 (b)): finished is terminal and closed, or parked — whose clock is the marker's quiet alone (below).
    parked = policy.runClock.parkedStates.includes(s.last.state);
    if (!parked) {
      if (!(TERMINAL_RUN_STATES as readonly string[]).includes(s.last.state)) return hold('not-done');
      if (s.last.closedAt === null) return hold('close-unplaced');
      if (i.now - s.last.closedAt < i.quietMs) return hold('grace');
    }
  }
  if (s.openWorker) return hold('run-worker');
  if (s.openClaimant) return hold('run-claimant');
  if (s.claim) return hold('claim');
  if (s.mail) return hold('mail');
  if (i.viewer || i.sinceStartMs < i.viewerOpenTtlMs) return hold('viewer');
  if (r.dialogPending) return hold('menu');
  if (r.bucket !== 'idle') return hold('bucket');
  if (r.background !== null) return hold('background');
  if (r.subagents !== null && r.subagents.length > 0) return hold('roster');
  if (policy.verbBeforeMeasure && i.verb !== true) return hold('no-verb');
  if (i.live.kind === 'unread') return { act: 'measure' };
  const w = i.live.word;
  if (!w.ok) return hold(w.reason === 'unmeasured' ? 'unmeasured' : 'pane');
  if (turnSays(policy.liveWord, turnWordOf(w.word)) !== 'rest') return hold('live-word');
  if (policy.turnVerdict && i.live.turn !== 'idle') return hold(i.live.turn === 'unmeasured' ? 'unmeasured' : 'turn');
  // Hibernation's two marker holds (§5.11): a row's `background` is null once its hookstate aged out, so a shell or a
  // Monitor left running after the last Stop is visible only here — and it would die with the pane.
  const m = i.live.mark;
  if (!m.ok || m.state !== 'done') return hold('marker');
  if (m.bg !== 0) return hold('marker-background');
  if (m.crons !== 0) return hold('scheduled');
  const stamps = [m.turnAt, m.stopAt, m.restartAt].filter((t): t is number => t !== null);
  if (stamps.length === 0) return hold('recent');
  const idleMs = i.now - Math.max(...stamps);
  // sibling-parked-run-takes-parked-clock: an older parked run beside a newer done one keeps the parked clock.
  const threshold = policy.quiet.parkedMs !== null && (parked || s.parkedWorker) ? policy.quiet.parkedMs : i.quietMs;
  const recent = policy.quiet.boundary === SLEEP_QUIET_BOUNDARIES.atMost ? idleMs <= threshold : idleMs < threshold;
  if (recent) return hold('recent');
  return r.held === null ? { act: 'hibernate', idleMs, runId } : { act: 'hibernate', idleMs, runId, holdOk: r.held };
}
