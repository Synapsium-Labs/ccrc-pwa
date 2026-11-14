// L1, context C3 (Session Conversation): what a reported start does to a long-lived identity's generations (Overlord spec
// §3.3.11, H12, "every start mints"; §3.3.9's keys), and the wave-boundary fact a coordinator's renewal row reads. Pure: the
// generations lane (`generationsLane.ts`, L4) gathers the facts, asks here, and writes through the store.
//
// A start mints the identity's next generation unless it is not a new life of that identity: a compaction (the same
// conversation, summarised), a fork (another conversation in the same pane, never this identity's next life), a start of a
// row the registry no longer lists, a start whose conversation is not the row's own (a nested process in the pane can land a
// `clear`, `resume` or `compact` as the row's: reviews 1949 G2, 1975 H2), a start older than the live generation's (id order
// is receipt order: review 1949 G3), or a start of a role that is not long-lived or that cannot be told. A start a failed
// registry read skipped is held for a later pass, bounded (`startHold`, review 2003 F2), and so is one the server received
// after the pass's registry was listed (review 2006 R1). Which starts a pass judges, which wait and where the cursor moves
// are decided here too (`planStartBatch`, `firstMintOf`; review 2006 R6), so the lane only acts.
import { TERMINAL_RUN_STATES } from '../../../shared/api.js';
import { RENEWAL_LANE_PERIOD_MS, type GenerationOutcome, type GenerationState, type StartSource } from '../../../shared/continuity.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { RoleReading } from '../roleOf.js';
import { RENEWAL_ROWS } from './renewalDue.js';

const START_SKIP_MAP = {
  compact: 'a compaction: the same conversation, summarised',
  fork: 'a fork: another conversation in the same pane',
  unregistered: 'the registry does not list the row',
  'uuid-unmeasured': "the registry's uuid for the row could not be read",
  'foreign-uuid': "the started conversation is not the one the registry names for the row",
  late: "older than the live generation's start",
  undecided: 'the role could not be told',
  'not-long-lived': 'the role is not long-lived: its wave is its renewal',
} as const;
export type StartSkip = keyof typeof START_SKIP_MAP;
export const START_SKIPS = Object.keys(START_SKIP_MAP) as StartSkip[];

/** The skips a read that failed this pass gives (review 2003 F2): the start is held, the cursor stays at it and later
 *  passes judge it again, for at most `START_RETRY_MS` after the server received it; past that it is skipped for good. */
const RETRIED_SKIPS: ReadonlySet<StartSkip> = new Set<StartSkip>(['unregistered', 'uuid-unmeasured']);
/** About five passes of the lane: how long a start whose registry read failed is held before it is skipped, and how long
 *  another start's hold may keep a start waiting (review 2006 R8). Wall time (spec §11.5 allows it for a timer whose expiry
 *  permits nothing, and giving up on a start permits nothing: review 2006 R3). */
export const START_RETRY_MS = 5 * RENEWAL_LANE_PERIOD_MS;

/** What a hold reads of one start. */
export interface HoldStart { readonly id: number; readonly receivedAt: number }

/** The pass's side of the hold: its wall clock, when the registry it judges against was listed, and the starts this server
 *  process held for a failed read on an earlier pass (a process-local memo: a restart forgets it, which only adds a retry). */
export interface HoldClock { readonly now: number; readonly listedAt: number; readonly retried: ReadonlySet<number> }

/** Why a start waits for a later pass, or null: `listing` when the server received it at or after the registry was listed,
 *  so the registry may not know of it yet, whatever its skip (review 2006 R1: a `/clear` accepted mid-tick carries a uuid
 *  the listing has not seen); `read` for a skip a failed registry read gave, while the start is younger than
 *  `START_RETRY_MS`, and past that until this process has held it once (review 2006 R3: a restart or a slow tick never skips
 *  a start with no retry). */
export type StartHoldWhy = 'listing' | 'read';

export function startHold(skip: StartSkip | null, s: HoldStart, at: HoldClock): StartHoldWhy | null {
  if (s.receivedAt >= at.listedAt) return 'listing';
  if (skip === null || !RETRIED_SKIPS.has(skip)) return null;
  return !startAged(s.receivedAt, at.now) || !at.retried.has(s.id) ? 'read' : null;
}

/** Has a start waited out `START_RETRY_MS`? A clock that reads earlier than the start's receipt reads as the receipt (spec
 *  §11.5; review 2006 R3), so a backward step keeps it young. */
export function startAged(receivedAt: number, now: number): boolean {
  return Math.max(now, receivedAt) - receivedAt >= START_RETRY_MS;
}

/** What the batch and the first mint read of a start. */
export interface PlanStart extends HoldStart {
  readonly sessionId: string; readonly source: StartSource; readonly uuid: string; readonly reportedAt: number;
}

/** A session's start order: `reportedAt`, then id (review 1949 G3). */
const startBefore = (a: PlanStart, b: PlanStart): number => a.reportedAt - b.reportedAt || a.id - b.id;

/** The sources that cannot change the account: a compaction keeps the conversation, a fork is another conversation in the
 *  same pane. */
const ACCOUNT_KEEPING: ReadonlySet<StartSource> = new Set<StartSource>(['compact', 'fork']);

/** Is `s` its identity's newest start among `all`, as the registry's account goes (review 2003 F4)? Only a later start of
 *  the same identity that could have moved the account makes it older: a `compact` or a `fork` cannot (review 2006 R6). The
 *  batch and the first mint both ask this. */
export function newestStart(s: PlanStart, all: readonly PlanStart[]): boolean {
  return all.every((n) => n.sessionId !== s.sessionId || startBefore(n, s) <= 0 || ACCOUNT_KEEPING.has(n.source));
}

/** One pass's split of the starts after the cursor. */
export interface StartBatchPlan<S extends PlanStart> {
  /** The starts the pass judges, in their sessions' own order, each with whether it is its identity's newest. */
  readonly judged: readonly { readonly start: S; readonly newest: boolean }[];
  /** The starts that wait for a later pass. */
  readonly waiting: readonly S[];
  /** Of `waiting`, the ids held for a failed read: this process has now held them once. */
  readonly heldForRead: readonly number[];
  /** The cursor's next position, or null when it stays. */
  readonly advanceTo: number | null;
}

/** Which starts after the cursor (`from`) a pass judges. In their sessions' own order: a held start waits (`startHold`),
 *  and so does every start after it, unless that start has itself waited out `START_RETRY_MS` (review 2006 R8: no start
 *  waits longer than the bound for another's hold). The cursor moves past every start when none waits, else to just below
 *  the lowest waiting id, so a waiting start is read again. A start the pass judged above that point is judged again next
 *  pass, and its answer may differ (review 2014 F4): it never mints twice (a mint already written answers `superseded`),
 *  but a start skipped `undecided` can mint once its role reads, and a minted one can answer `late`; the pass's counts
 *  count it again each time, for as long as the hold stands. */
export function planStartBatch<S extends PlanStart>(starts: readonly S[], from: number,
  registryOf: (sessionId: string) => StartFacts['registry'], at: HoldClock): StartBatchPlan<S> {
  const ordered = [...starts].sort(startBefore);
  const judged: S[] = []; const waiting: S[] = []; const heldForRead: number[] = [];
  let holding = false;
  for (const s of ordered) {
    const why = startHold(startReadSkip({ source: s.source, uuid: s.uuid, registry: registryOf(s.sessionId) }), s, at);
    if (why !== null) {
      holding = true; waiting.push(s);
      if (why === 'read') heldForRead.push(s.id);
    } else if (holding && !startAged(s.receivedAt, at.now)) waiting.push(s);
    else judged.push(s);
  }
  const to = ordered.length === 0 ? from
    : waiting.length === 0 ? Math.max(...ordered.map((s) => s.id)) : Math.min(...waiting.map((s) => s.id)) - 1;
  return {
    judged: judged.map((start) => ({ start, newest: newestStart(start, ordered) })),
    waiting, heldForRead, advanceTo: to > from ? to : null,
  };
}

/** A coordinator's first generation (review 2003 F2, slug coordinator-first-mint): the start it mints from, a start that
 *  stops the walk because it is held, or none. `readHolds` names every start the walk reached whose skip a failed read
 *  gave, whether it held it now or passed it because this process had held it before (review 2014 F2): the lane keeps
 *  them all in its memo, so two such starts cannot take turns being held for ever. */
export type FirstMint<S extends PlanStart> = { readonly readHolds: readonly number[] } & (
  | { readonly kind: 'mint'; readonly start: S; readonly verdict: Extract<StartVerdict, { mint: true }> }
  | { readonly kind: 'held'; readonly start: S; readonly why: StartHoldWhy }
  | { readonly kind: 'none' });

/** An identity with no generation mints n=1 from its newest start that mints, among the starts the cursor has passed
 *  (`passed`). The walk runs newest first and STOPS at a start that is held (review 2006 R2): it may read on a later pass,
 *  so falling through to an older conversation now could mint from the wrong one. A start above the cursor that waits in
 *  the batch does not stop the walk (review 2014 F3): an older start may mint n=1 with no account, and the waiting start,
 *  once judged, mints n=2 and ends n=1 `unmeasured`, so nothing is lost for good. */
export function firstMintOf<S extends PlanStart & { readonly rowIncarnation: string | null }>(starts: readonly S[], passed: number,
  registry: StartFacts['registry'], role: RoleReading, at: HoldClock): FirstMint<S> {
  const mine = starts.filter((s) => s.id <= passed).sort((a, b) => startBefore(b, a));
  const readHolds: number[] = [];
  for (const s of mine) {
    const skip = startReadSkip({ source: s.source, uuid: s.uuid, registry });
    if (skip !== null && RETRIED_SKIPS.has(skip)) readHolds.push(s.id);
    const why = startHold(skip, s, at);
    if (why !== null) return { kind: 'held', start: s, why, readHolds };
    const verdict = startVerdict({
      source: s.source, uuid: s.uuid, reportedAt: s.reportedAt, rowIncarnation: s.rowIncarnation, registry, role,
      live: null, newest: newestStart(s, starts),
    });
    if (verdict.mint) return { kind: 'mint', start: s, verdict, readHolds };
  }
  return { kind: 'none', readHolds };
}

/** A long-lived role is one `renewalDue` has rows for (Table 3.3.11b): every other role's wave is its renewal. */
export function longLived(role: FleetRole): boolean {
  return RENEWAL_ROWS[role].length > 0;
}

/** What the lane read about one start. */
export interface StartFacts {
  readonly source: StartSource;
  /** The started conversation's uuid (`continuity_starts.uuid`). */
  readonly uuid: string;
  /** The hook's clock: a session's start order. */
  readonly reportedAt: number;
  /** The registry row's incarnation the start carried, or null. */
  readonly rowIncarnation: string | null;
  /** The registry, at the pass: the row's current conversation (null: unreadable) and its account, or absent. */
  readonly registry: { readonly kind: 'row'; readonly uuid: string | null; readonly lane: string | null } | { readonly kind: 'absent' };
  readonly role: RoleReading;
  /** Whether this is the identity's newest start the pass judges (review 2003 F4): the registry is read at the pass, not
   *  at the start, so its account describes only the newest start. An older one's outcome is `unmeasured` and it records
   *  no account. */
  readonly newest: boolean;
  /** The identity's live generation: its `state` column (what the session lived; a shadow walk's would-be state is not
   *  what happened to it, review 2003 F1), its start's `reportedAt`, its incarnation and its account. */
  readonly live: {
    readonly state: GenerationState; readonly reportedAt: number;
    readonly rowIncarnation: string | null; readonly lane: string | null;
  } | null;
}

export type StartVerdict =
  | { readonly mint: false; readonly skip: StartSkip }
  | {
    readonly mint: true; readonly role: FleetRole; readonly outcome: GenerationOutcome; readonly resumed: boolean;
    /** The account the new generation records: the registry's, for the newest start only. */
    readonly lane: string | null;
  };

const skip = (s: StartSkip): StartVerdict => ({ mint: false, skip: s });

/** The skips decided by the start and the registry alone, before the live generation or the role is asked: by source,
 *  then the row, then (for every source but `startup`) its conversation. The lane asks this first to find a start a
 *  failed read holds (`startHeld`); `startVerdict` asks it first too, so the two never disagree. */
export function startReadSkip(f: Pick<StartFacts, 'source' | 'uuid' | 'registry'>): StartSkip | null {
  if (f.source === 'compact') return 'compact';
  if (f.source === 'fork') return 'fork';
  if (f.registry.kind === 'absent') return 'unregistered';
  if (f.source !== 'startup') {
    if (f.registry.uuid === null) return 'uuid-unmeasured';
    if (f.registry.uuid !== f.uuid) return 'foreign-uuid';
  }
  return null;
}

/** Does this start mint the identity's next generation, and with what outcome for the one it ends? A `startup` is
 *  attributed by the door against the registry at its send and keeps its own sender (review 1949 G2), so it is not
 *  checked against the registry's current conversation, which a later `/clear` may have moved on; every other source is
 *  the row's own only when the registry names its conversation now (slug uuid-checked-against-the-current-row). */
export function startVerdict(f: StartFacts): StartVerdict {
  const read = startReadSkip(f);
  if (read !== null) return skip(read);
  if (f.live !== null && f.reportedAt < f.live.reportedAt) return skip('late');
  if (f.role.kind === 'undecided') return skip('undecided');
  if (!longLived(f.role.role)) return skip('not-long-lived');
  const lane = f.newest && f.registry.kind === 'row' ? f.registry.lane : null;
  return { mint: true, role: f.role.role, outcome: f.newest ? startOutcome(f) : 'unmeasured', resumed: f.source === 'resume', lane };
}

/** The outcome written on the generation a start ends (slug outcome-from-the-start): `renewed` for the start a renewal
 *  asked for (the generation was `clearing`); otherwise `unmeasured` when either account is not known (a swap cannot be
 *  ruled out, review 2003 F4), `swapped` when the account changed; on the same row incarnation, `cleared` for a `clear` (a
 *  `/clear` is not a crash: review 2006, slug clear-is-not-a-crash) and `crashed` for any other start while the generation
 *  was `active`; and `woken` for the rest. With no live generation nothing is ended, and the answer is not written. */
export function startOutcome(f: Pick<StartFacts, 'source' | 'registry' | 'live' | 'rowIncarnation'>): GenerationOutcome {
  const old = f.live;
  if (old === null) return 'woken';
  if (old.state === 'clearing') return 'renewed';
  const lane = f.registry.kind === 'row' ? f.registry.lane : null;
  if (lane === null || old.lane === null) return 'unmeasured';
  if (lane !== old.lane) return 'swapped';
  const sameRow = f.rowIncarnation !== null && f.rowIncarnation === old.rowIncarnation;
  if (sameRow && f.source === 'clear') return 'cleared';
  if (sameRow && old.state === 'active') return 'crashed';
  return 'woken';
}

/** Is a generation judged for due, and gathered for? When its `state` column is `active` or `degraded`, whatever a shadow
 *  walk holds in `shadowState` (review 2003 F1): the due record does not depend on the walk. A generation on a live walk
 *  (`state` past `active`) is not judged. */
export function judgedForDue(g: { readonly state: GenerationState }): boolean {
  return g.state === 'active' || g.state === 'degraded';
}

/** Table 3.3.11b's wave boundary: the coordinator's newest work run is open and the one before it, of the same programme,
 *  is closed. `runs` is newest first, as `newestClaimedWorkRuns` reads them. */
export function waveBoundaryOf(runs: readonly { readonly state: string; readonly program: string }[]): boolean {
  const closed = (s: string): boolean => (TERMINAL_RUN_STATES as readonly string[]).includes(s);
  const [newest, before] = runs;
  return newest !== undefined && before !== undefined && newest.program === before.program
    && !closed(newest.state) && closed(before.state);
}
