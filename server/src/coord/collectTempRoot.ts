import path from 'node:path';
import type { FleetIO, MeasuredDirectoryRead, MeasuredPathKind, MeasuredStat, ReadFailure } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { RunCcd } from './ports.js';
import type { Viewers } from '../viewer.js';
import type { CcdResult } from '../lifecycle.js';
import {
  CCD_ARGV, COLLECT_CAP, COLLECT_LOOSE_CAP, RECLAIM_PAUSE_CAP, capSupported, ccdCan, sweepDec,
} from '../ccdargv.js';
import type { CoordStore } from './store.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { COLLECT_LOOSE_LIVE_MARKER, readSwitches } from '../../../shared/switches.js';
import { CHILD_BIRTH_SKEW_MS } from './childSpent.js';
import {
  COLLECT_LANE_LIVE_MARKER, collectLicence, collectLicenceStands, collectIsLoose, collectLooseHexOf, parseCollectAudit,
  parseCollectCensus, parseCollectLooseAudit, parseCollectLooseResult, parseCollectResult,
  type CollectAudit, type CollectLooseCensus, type CollectCapture, type CollectHoldWhy, type CollectListing, type CollectObservation,
  COLLECT_HOLD_WHYS, type CollectResult,
  collectLaneControl, collectLaneEffective, collectLaneLive, collectLatchDue, collectLatchFeedBody, measureCollectLaneRow,
  type CollectCurrentNode, type CollectEpochPair, type CollectLaneCaps, type CollectLaneControl, type CollectLaneEffective,
  type CollectLaneJournal, type CollectLaneJournalRead, type CollectLaneRowRead, type CollectLaneSettled,
  type CollectLaneSwitches, type CollectLatchOutcome, type CollectLicence,
} from '../collectLane.js';
import { TERMINAL_RUN_STATES, TMPROOT_ID_MAX_CHARS, isTmpRootId, type RunState } from '../../../shared/api.js';
import {
  RETIRE_LISTING_MODES, RETIRE_NOTICE_HOMES, RETIRE_PRESENCE_RULES, RETIRE_REASON_NAMES, RETIRE_STEPS, capabilityJudge,
  presenceJudge, type RetireNoRead, type RetireReason,
} from '../retire.js';

/**
 * THE TEMP-ROOT COLLECTOR'S ONE EXECUTOR, AND ITS READS (child reclamation spec 2026-09-22 §5.10).
 *
 * It runs `ws-audit --collect` as observation 2, then the collector's verb with THAT audit's token. The server composes
 * the verb, and nothing else does. It follows `expireArchived`'s shape, in a file of its own, so it shares no
 * vocabulary, feed row or attention list with the reclaim and expiry lanes. Its callers are `watch.ts`'s collector
 * pass. Every call runs on the id's `KeyedQueue` key, the key the reclaim and expiry executors use, so no two lanes
 * touch one id at once.
 *
 * THE JOB, in order. Every doubt is "not this time". Nothing here paces or frees a slot, and nothing here writes a feed
 * row: the job REPORTS (`CollectJobOutcome`), and the lane folds the report through its L1 rules (`collectLane.ts`). Its
 * one durable write is the marker's latch, through the store's one writer, and the lane writes that latch's row
 * (`collectRetireLatch`, path-identity spec 2026-10-12 §5.4).
 *   1. The box must PROVE both capabilities, `collect-v1` (`ccdCan(state, 'wsCollect')`, D-5866) and the
 *      precondition `reclaim-pause-v1` (`capSupported`); both refuse on no evidence. An automatic destructive lane never runs on a box the phone cannot pause. Then the id predicate
 *      AGAIN, on the job's own id: the population gated it, and this is the second check before any argv.
 *   2. The switch, from ONE registry listing. A raised `reclaim-paused`, or a listing that could not be taken, stops it.
 *   3. A person looking at the session stops it, with no ceiling and no licence past it.
 *   4. The audit is OBSERVATION 2. It is stamped when its answer arrives, and it is an observation only if neither
 *      clear generation moved while it was in flight. It licenses the act only under the lane's one licence rule
 *      (`collectLicence`): observation 1 stands, with the same token, and arrived at least the interval before. Then
 *      the open-run hold is judged on observation 2's document, licensed or not, so a held id never seeds a pair.
 *   5. The switches once more, from one fresh listing: the job's LAST await. The connection epoch is read before it. The
 *      pair the switch is resolved under runs from the epoch the job was QUEUED under to the epoch after it
 *      (path-identity spec 2026-10-12 §5.2, §5.5).
 *   6. SYNCHRONOUSLY, with no await before the argv:
 *      - the marker's latch, through its one helper (`collectRetireLatch`, §5.4);
 *      - both capabilities;
 *      - the Settings row and its generation journal, read again;
 *      - the node measured on the current connection, read again;
 *      - then `collectLaneEffective` (L1) resolves the switch.
 *      A stop (a pause, an unlistable registry, a moved epoch, a stored Live for an unmeasured node) or a missing
 *      capability clears every pair. A flip of the effective boolean clears every pair, writes its one row and composes
 *      nothing. A safety stop composes nothing. Then observation 1 is re-read (`collectLicenceStands`: a pair cleared
 *      since composes nothing), presence is read again, and the hold's store reads are made again (CoordStore is
 *      synchronous). Shadow: "would collect", and stop. Live: the verb, on observation 2's token and the job's id. The
 *      start hold-off is the lane's, asked at its offer.
 * It never kills a holder. It never passes `--defer-expired`: the builder has no such flag, and ccd's arity guard
 * dies on it. It never retries inside itself: ccd recomputes the token inside the reap lock before anything moves.
 */

// ── the ports (L2, declared by this consumer) ────────────────────────────────

/** The two clocks, read together, once, as the first statement after an answer settles (spec §5.7's clock rule).
 *  `mono` decides; `wall` is compared only with a ccd stamp, at arrival. */
export interface CollectClock { readonly mono: number; readonly wall: number }

/** The lane's two clear generations for one id (spec §5.10):
 *  - the lane-wide one moves on a raised pause or an unlistable registry, a missing capability (at a pass, a job or a
 *    learning audit), a flip of the switch's effective boolean, a moved connection epoch, or a stored Live whose node
 *    the current connection has not measured (path-identity spec 2026-10-12 §5.5);
 *  - the id's own moves on any reset of its pair.
 *  Both are captured when a call is composed. Its answer is an observation only if both still stand when it arrives.
 *  It is L1's `CollectCapture`, spelled once there. */
export type CollectGenerations = CollectCapture;

/** An answer, with the generations it was composed under and the instant it arrived. */
export interface CollectAnswer<T> {
  readonly value: T;
  readonly composed: CollectGenerations;
  readonly arrived: CollectClock;
}

/** A collectable audit document: the only one that carries a token. */
export type CollectAuditCollectable = Extract<CollectAudit, { kind: 'collectable' }>;

/**
 * The lane's memory, as the executor reads it and reports to it. `watch.ts` implements it over the lane's L1 state.
 * EVERY MEMBER IS SYNCHRONOUS, so step 6's reads sit between the job's last await and the argv with nothing in
 * between. The executor writes no pacing through it. `cleared` and `flipped` are the two LANE-WIDE events a job can be
 * the first to see. They are applied the instant the job sees them, so an answer composed before one can never seed an
 * observation after it. Everything per-id is reported in the job's outcome, and the lane folds it when the job settles.
 */
export interface CollectLanePort {
  /** The two clocks, read together. */
  clock(): CollectClock;
  /** Both clear generations for `id`, as they stand now. */
  generations(id: string): CollectGenerations;
  /** Observation 1: the standing pair's token and its first answer's arrival, or null when no pair stands. */
  observation(id: string): CollectObservation | null;
  /** A lane-wide clear this job saw (path-identity spec 2026-10-12 §5.5). The whys:
   *  - `paused`: `reclaim-paused` raised, or a registry that did not list;
   *  - `caps`: a missing capability;
   *  - `epoch`: a connection replaced since the job was queued;
   *  - `node`: a stored Live whose fleet node the current connection has not measured.
   *  Every pair clears now, and the per-id pacing stays. */
  cleared(why: 'paused' | 'caps' | 'epoch' | 'node'): void;
  /** The switch as this job resolved it after its last await (`CollectLaneSettled`, path-identity spec 2026-10-12
   *  §5.5). Answers true when its effective boolean (`collectLaneLive`) differs from the lane's last-seen flag, which
   *  starts `shadowed` when the lane is constructed. The lane has then set the flag, cleared every pair and written
   *  the flip's one feed row, and this job composes nothing. Answers false otherwise, and nothing changed. A change of
   *  SOURCE alone, the marker handing over to Settings while both resolve live, is no flip. */
  flipped(r: CollectLaneSettled): boolean;
}

/** The connection-bound fleet identity, as this job reads it (path-identity spec 2026-10-12 §5.2): L2, declared by
 *  this consumer. `FleetIdentityCell` and `NO_FLEET_IDENTITY` (`fleetidentity.ts`) satisfy it. Both members are
 *  synchronous. The epoch is read before the job's last await and again after it, and the node after it, with nothing
 *  awaited between those reads and the argv. */
export interface CollectLinkPort { epochNow(): number; current(): CollectCurrentNode }

/** The switch's control state and the one latch writer's needs (path-identity spec 2026-10-12 §5.2, §5.4): L2,
 *  declared by this consumer, built by `watch.ts` (`collectControlDeps`):
 *  - `coord`: the row's reader and the store's ONE writer, which only the latch calls from here;
 *  - `journal`: the process's one generation journal, or null when the server was built without one. Null reads as
 *    `not-configured`, an unmeasurable control state, never as a missing journal;
 *  - `wallNow`: the wall clock the latch and the row's `updatedAt` are stamped with;
 *  - `latchRetired`: the lane's writer of the latch's one feed row. `watch.ts` writes rows; this file never does. It
 *    must never throw: `collectRetireLatch` calls it after the durable write and outside its catch, so the helper's
 *    never-throws answer holds only while this writer is total. */
export interface CollectControlDeps {
  readonly coord: Pick<CoordStore, 'collectLaneRow' | 'setCollectLane'>;
  readonly journal: CollectLaneJournal | null;
  readonly wallNow: () => number;
  readonly latchRetired: (body: string) => void;
}

/** The executor's ports. Each is narrowed to what is asked of it:
 *  - `coord` to the three destructive-grade reads the hold makes;
 *  - `io` to the one listing the switches read;
 *  - `presence` to its one question;
 *  - `control` to the switch's row, its journal, the latch's clock and the latch's row (path-identity spec 2026-10-12
 *    §5.2, §5.4);
 *  - `link` to the connection epoch and the node measured on it (§5.2).
 *  `observeIntervalMs` is the lane's `COLLECT_OBSERVE_INTERVAL_MS`, passed in, as the L1 licence takes it. `runCcd` is
 *  the lane's stamping wrapper (Task 7), which reads `argv[0]` to tell this job's audit from its act. */
export interface CollectTempRootDeps {
  coord: Pick<CoordStore, 'run' | 'bindingsOf'>;
  io: Pick<FleetIO, 'readdirMeasured'>;
  cfg: Pick<CcrcConfig, 'registryDir'>;
  runCcd: RunCcd;
  fleetState?: FleetState;
  viewers?: Pick<Viewers, 'isVisible'>;
  lane: CollectLanePort;
  observeIntervalMs: number;
  control: CollectControlDeps;
  link: CollectLinkPort;
}

/** One job: the id the lane offered, and the connection epoch the lane's pairs stood under when it was QUEUED
 *  (path-identity spec 2026-10-12 §5.5). The lane reads that epoch outside the queue callback. So after a reconnect
 *  between the pass that queued the job and the job's start, the job's last listing does not stand under it, and the
 *  job composes nothing. Observation 1 is read from the lane's memory and never carried: a token is a comparand, never
 *  a request's payload. */
export interface CollectJob { readonly id: string; readonly epoch: number }

// ── what a job reports ───────────────────────────────────────────────────────

/** A hold that stood (spec §5.10). `why` is the lane's word, and `detail` names the run or the read. */
export interface CollectHeld { readonly kind: 'held'; readonly why: CollectHoldWhy; readonly detail: string }
export type CollectHoldRead = { readonly kind: 'clear' } | CollectHeld;

/** Why a job that asked the box for observation 2 composed nothing. */
export type CollectAnsweredWhy =
  | 'stale' | 'not-collectable' | 'not-licensed' | 'paused' | 'switch-flip' | 'epoch-changed' | 'unknown-fleet'
  | 'safety-stopped' | 'pair-cleared' | 'presence' | 'caps';

/** What one job did (spec §5.10), for the lane to fold. Only `acted` composed the collector's verb. Every other arm
 *  composed none, and the lane frees the slot on it. Each arm says what was measured, never what to do next.
 *  `detail` is DIAGNOSTIC: tests and reports read it, and the lane surfaces no sentence from it. So the distinctions
 *  it alone words (a raised pause from an unlistable registry, a missing capability from a missing verb) are carried
 *  to the lane, not shown to the operator. */
export type CollectJobOutcome =
  /** Nothing was asked of the box: at step 1, 2 or 3, or at step 4 when the audit's own gate refused. */
  | { readonly kind: 'not-asked'; readonly step: 1 | 2 | 3 | 4; readonly why: 'caps' | 'id-refused' | 'paused' | 'presence';
      readonly detail: string }
  /** Observation 2 was asked, and the job stopped at step 4, 5 or 6 without composing. */
  | { readonly kind: 'answered'; readonly step: 4 | 5 | 6; readonly why: CollectAnsweredWhy; readonly detail: string;
      readonly audit: CollectAnswer<CollectAudit> }
  /** The open-run hold stood on observation 2's document, at step 4 or at step 6's re-read. */
  | { readonly kind: 'held'; readonly step: 4 | 6; readonly hold: CollectHeld;
      readonly audit: CollectAnswer<CollectAuditCollectable> }
  /** Shadow: every gate passed, and nothing was composed. */
  | { readonly kind: 'would-collect'; readonly audit: CollectAnswer<CollectAuditCollectable> }
  /** Live: the verb was composed at `composedMono`, and answered `result` at `arrived`. A `no-document` result may
   *  have acted, so the lane keeps the id and the slot until `CHILD_RECLAIM_STALL_MS` after `composedMono`. */
  | { readonly kind: 'acted'; readonly audit: CollectAnswer<CollectAuditCollectable>; readonly composedMono: number;
      readonly result: CollectResult; readonly arrived: CollectClock };

/** The learning audit's answer: not asked, because the box cannot answer it; `id-refused`, because the id is not one
 *  the collector may name (`isTmpRootId`, asked before any argv: the twin of the act's step-1 check), a DISTINCT arm
 *  and never `not-asked`, whose caller clears every pair; or answered, with its generations and its arrival. */
export type CollectLearnAnswer =
  | { readonly kind: 'not-asked'; readonly why: 'caps' }
  | { readonly kind: 'id-refused' }
  | { readonly kind: 'answered'; readonly audit: CollectAnswer<CollectAudit> };

// ── the words this file spells, for the coordination scanner ─────────────────

/** The kebab words this executor spells as quoted literals, as TOTAL tables over their own unions: the outcome kinds,
 *  the not-asked whys, the answered whys and the audit's kinds (its `no-document`). The hold's whys are L1's
 *  `COLLECT_HOLD_WHYS`, read, never re-spelled. None is a mail rejection or a run refusal: no `refused` or
 *  `reject.code` ever carries one; they ride the job's outcome and the lane's memory. */
const COLLECT_OUTCOME_KINDS: Readonly<Record<CollectJobOutcome['kind'], true>> = {
  'not-asked': true, answered: true, held: true, 'would-collect': true, acted: true,
};
const COLLECT_NOT_ASKED_WHYS: Readonly<Record<Extract<CollectJobOutcome, { kind: 'not-asked' }>['why'], true>> = {
  caps: true, 'id-refused': true, paused: true, presence: true,
};
const COLLECT_ANSWERED_WHYS: Readonly<Record<CollectAnsweredWhy, true>> = {
  stale: true, 'not-collectable': true, 'not-licensed': true, paused: true, 'switch-flip': true, 'epoch-changed': true,
  'unknown-fleet': true, 'safety-stopped': true, 'pair-cleared': true, presence: true, caps: true,
};
const COLLECT_AUDIT_KINDS: Readonly<Record<CollectAudit['kind'], true>> = {
  collectable: true, verdict: true, unmeasured: true, unreadable: true, 'no-document': true,
};
/** The resolver's arms step 6 branches on (`CollectLaneEffective`, L1; path-identity spec 2026-10-12 §5.5), as a TOTAL
 *  table: step 6 quotes its kinds. */
const COLLECT_RESOLVED_KINDS: Readonly<Record<CollectLaneEffective['kind'], true>> = {
  stopped: true, 'not-running': true, 'safety-stopped': true, live: true, shadowed: true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`, where this executor
 *  lives: its SIXTEENTH union, admitted as `isArchivedExpiryKebab` admits the expiry lane's. Derived from the tables
 *  above and L1's `COLLECT_HOLD_WHYS`, never a list, so a word added to a union is admitted and a typo is not. */
export function isCollectExecutorKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return own(COLLECT_OUTCOME_KINDS) || own(COLLECT_NOT_ASKED_WHYS) || own(COLLECT_ANSWERED_WHYS)
    || own(COLLECT_AUDIT_KINDS) || own(COLLECT_RESOLVED_KINDS) || (COLLECT_HOLD_WHYS as readonly string[]).includes(v);
}

// ── words ────────────────────────────────────────────────────────────────────

/** The `--actor` this lane declares: its name, as the expiry lane declares `expire sweep`. */
const COLLECT_ACTOR = 'collect sweep';
/** The population's two registry subdirectories (spec §5.10): witnesses, and quarantine records. */
const COLLECT_WITNESS_DIR = 'tmproots';
const COLLECT_RECORD_DIR = 'tmpquarantine';
/** Each cause of a pause in its own sentence (spec §5.10), as `expireArchived`'s switches word theirs: one sentence for
 *  both would say something false of each. Both stop the job alike. */
const COLLECT_PAUSED: Readonly<Record<Extract<CollectSwitches, { paused: true }>['why'], string>> = {
  raised: `${RECLAIM_PAUSE_MARKER} is raised: cleanup is paused fleet-wide`,
  unlistable: `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out`,
};
/** Each gate of the one audit site in its own sentence: `collect-v1` withdrawn since step 1 is not a box that cannot
 *  answer `ws-audit`. */
const COLLECT_AUDIT_REFUSED: Readonly<Record<CollectAuditRefused['notAsked'], string>> = {
  capability: `the fleet host no longer advertises ${COLLECT_CAP}, so the audit was not asked`,
  verb: 'the fleet host cannot answer ws-audit',
};
const COLLECT_SEEN = 'someone is viewing this session';
const COLLECT_ID_REFUSED = 'the id is not one the collector may name: a session id’s shape, with no leading dot or dash, '
  + `of at most ${TMPROOT_ID_MAX_CHARS} characters`;
const COLLECT_STALE = 'a clear landed while the audit was in flight, so its answer is no observation';
const COLLECT_NOT_LICENSED = 'no earlier audit answered collectable with this token at least the interval before this one';
const COLLECT_FLIPPED = 'the collector’s effective switch changed since this lane last read it, so every pair was '
  + 'cleared and this job composes nothing';
/** Each cause of step 6's other stops in its own sentence (path-identity spec 2026-10-12 §5.5). A connection replaced
 *  since the job was queued is worded by WHEN: before the final listing began (`queued`) or while it was out
 *  (`listing`). The epoch read before that listing tells the two apart. Both stop the job alike. */
const COLLECT_EPOCH_MOVED: Readonly<Record<'queued' | 'listing', string>> = {
  queued: 'the connection to the fleet host was replaced after this job was queued, so nothing it measured stands for '
    + 'the box now connected',
  listing: 'the connection to the fleet host was replaced while the last listing was out, so nothing it said stands '
    + 'for the box now connected',
};
const COLLECT_UNKNOWN_FLEET = 'Settings stores live, and the fleet node on the current connection is unmeasured or its '
  + 'id is in collision, so nothing arms the collector for this box';
const COLLECT_SAFETY_STOPPED = 'the collector’s control state could not be proved coherent, so this job composes nothing';
const COLLECT_NOT_RUNNING = `the fleet host no longer advertises both ${COLLECT_CAP} and ${RECLAIM_PAUSE_CAP}`;
const COLLECT_PAIR_CLEARED = 'the observations this act rested on were cleared before it could be composed';

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const sameGenerations = (a: CollectGenerations, b: CollectGenerations): boolean => a.lane === b.lane && a.id === b.id;

// ── the population's two listings ────────────────────────────────────────────

/** THE POPULATION'S TWO LISTINGS (spec §5.10), read exactly, inside the pass's one gather: `<registryDir>/tmproots`
 *  and `<registryDir>/tmpquarantine`. Each answers through `readCollectListing`, and a fault in one never touches the
 *  other. IN THIS ORDER, one after the other, never concurrently: ccd collects by writing the quarantine record, then
 *  dropping the witness, then dropping the record last. A record listing taken before the witness listing can see
 *  neither for an id ccd is collecting between the two, and the population would forget it once. Taken witness first,
 *  an id whose witness is already gone has its record written, so the later listing sees it unless the collection
 *  finished, and then forgetting it is right. */
export async function readCollectPopulation(
  io: Pick<FleetIO, 'lstatMeasured' | 'readdirMeasured' | 'statMeasured'>, registryDir: string,
): Promise<{ tmproots: CollectListing; tmpquarantine: CollectListing }> {
  const tmproots = await readCollectListing(io, registryDir, COLLECT_WITNESS_DIR);
  const tmpquarantine = await readCollectListing(io, registryDir, COLLECT_RECORD_DIR);
  return { tmproots, tmpquarantine };
}

/** ONE listing, in two measured steps (spec §5.10).
 *  1. The path's OWN kind first. `lstatMeasured` has no directory kind, so a directory is `other`. A PROVEN absence is
 *     an empty listing, and nothing is listed. These make THIS listing unmeasured, and are never listed:
 *     - a link (ccd never follows `tmproots/`);
 *     - a plain file;
 *     - every failure, `unreadable` and an agent too old to answer (`unmeasured`) alike;
 *     - a port that rejects.
 *  2. Only `other` is listed. A listing that comes back null, or rejects, is resolved by `statMeasured`. Its proven
 *     ENOENT (the directory went between the two reads) is empty. Every other answer is unmeasured: a FIFO, a socket or
 *     a device is `other` at the first step and lists nothing. The two are never folded.
 *  Names that are not strings are dropped here, because nothing past this adapter can see them. The dot-leading drop
 *  and the size cap belong to the L1 population (`collectPopulation`). STATED RESIDUAL: a directory swapped for a link
 *  between the two reads is listed through the link, and every audit of such a name answers ccd's `witness` probe and
 *  mints no token. */
async function readCollectListing(
  io: Pick<FleetIO, 'lstatMeasured' | 'readdirMeasured' | 'statMeasured'>, registryDir: string, leaf: string,
): Promise<CollectListing> {
  const dir = path.join(registryDir, leaf);
  let kind: MeasuredPathKind;
  try {
    kind = await io.lstatMeasured(dir);
  } catch (err) {
    return { kind: 'unmeasured', why: `what ${leaf}/ is could not be asked (${said(err)})` };
  }
  if (!kind.ok) {
    if (kind.reason === 'absent') return { kind: 'absent' };
    return { kind: 'unmeasured', why: kind.reason === 'unmeasured'
      ? `this fleet host’s agent cannot say what ${leaf}/ is` : `${leaf}/ could not be looked at` };
  }
  if (kind.kind === 'symlink') return { kind: 'unmeasured', why: `${leaf}/ is a symbolic link, which is never followed` };
  if (kind.kind === 'regular') return { kind: 'unmeasured', why: `${leaf}/ is a plain file, not a directory` };
  // D-5969 (ARCH-08b): the MEASURED listing. A proven absence is an empty listing; an unlistable one is reported as
  // such and still asks the stat, because an older agent folds every failure into `unreadable`.
  let listed: MeasuredDirectoryRead;
  try { listed = await io.readdirMeasured(dir); } catch { listed = { ok: false, reason: 'unreadable' }; }
  if (listed.ok) return { kind: 'listed', names: (listed.entries as readonly unknown[]).filter((n): n is string => typeof n === 'string') };
  if (listed.reason === 'absent') return { kind: 'absent' };
  let st: MeasuredStat;
  try {
    st = await io.statMeasured(dir);
  } catch (err) {
    return { kind: 'unmeasured', why: `${leaf}/ did not list, and what stands there could not be asked (${said(err)})` };
  }
  if (!st.ok && st.reason === 'absent') return { kind: 'absent' };
  return { kind: 'unmeasured', why: `${leaf}/ did not list (${listed.reason})` };
}

/** THE LOOSE CENSUS (fleet disk retention spec 2026-10-23 section 2.4, D-6627), asked ONCE per pass inside the gather.
 *  Read-only on the box. A ccd without `collect-loose-v1` is `unavailable` and nothing is asked. A call that never ran, or
 *  rejects, or answers in a shape the reader cannot vouch for, is `unmeasured`, never an empty census. */
export async function readLooseCensus(deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState'>): Promise<CollectLooseCensus> {
  if (!ccdCan(deps.fleetState, 'wsCollectCensus')) return { kind: 'unavailable' };
  let res: CcdResult;
  try {
    res = await deps.runCcd(CCD_ARGV.wsCollectCensus());
  } catch (err) {
    return { kind: 'unmeasured', why: said(err) };
  }
  if (res.ran === false) return { kind: 'unmeasured', why: res.stderr };
  return parseCollectCensus(res.ok, res.stdout, res.stderr);
}

// ── the switches ─────────────────────────────────────────────────────────────

/** The two switches as one listing read them: L1's `CollectLaneSwitches`, aliased, never re-declared (path-identity
 *  spec 2026-10-12 §5.5). A pause says WHY, because its two causes are not one fact. `raised` is `reclaim-paused`
 *  standing in the listing. `unlistable` is a listing that could not be taken, which cannot rule a raised one out. Both
 *  stop a job alike, and neither is ever shadow. `marker` is the legacy marker's MEASURED presence. An unlistable
 *  registry carries none, because a measured absence now retires the marker's latch, and a listing never taken proves
 *  nothing absent. */
export type CollectSwitches = CollectLaneSwitches;
/** L1's listing-failure words are `ReadFailure`'s, EQUAL at compile time (D-5969): a word added to either side is a
 *  type error here until the other names it too. */
type CollectListingFailure = Extract<CollectLaneSwitches, { why: 'unlistable' }>['reason'];
const LISTING_FAILURE_WORDS_ARE_READ_FAILURES: [ReadFailure] extends [CollectListingFailure]
  ? ([CollectListingFailure] extends [ReadFailure] ? true : never) : never = true;
void LISTING_FAILURE_WORDS_ARE_READ_FAILURES;

/** The two switches, from ONE registry listing (spec §5.10). A raised `reclaim-paused` is `paused`, `raised`. A listing
 *  that could not be taken is `paused` too, `unlistable`, with NO `marker` field: it cannot rule a pause out, and it
 *  measured nothing. `marker` is whether `collect-lane-live` stands, which no writer in the tree touches. */
export async function collectSwitches(io: Pick<FleetIO, 'readdirMeasured'>, registryDir: string): Promise<CollectSwitches> {
  // D-5969 (ARCH-08b): the MEASURED listing; a rejecting port is `unreadable`, and the pause says which it was.
  let listed: MeasuredDirectoryRead;
  try { listed = await io.readdirMeasured(registryDir); } catch { listed = { ok: false, reason: 'unreadable' }; }
  if (!listed.ok) return { paused: true, why: 'unlistable', reason: listed.reason };
  const names = listed.entries;
  const marker = names.includes(COLLECT_LANE_LIVE_MARKER);
  // D-6627: the loose arm's own marker rides the SAME listing, and only when it stands: absence reads as shadow.
  const loose = names.includes(COLLECT_LOOSE_LIVE_MARKER) ? { looseMarker: true as const } : {};
  return readSwitches(names)[RECLAIM_PAUSE_MARKER] === 'set'
    ? { paused: true, why: 'raised', marker, ...loose } : { paused: false, marker, ...loose };
}

// ── the switch's control state and the marker's latch (path-identity spec 2026-10-12 §5.2, §5.4) ──────────────

/** The switch's control state, read NOW (path-identity spec 2026-10-12 §5.2): the row and the journal, each exactly as
 *  read, and their coherence decided by L1 (`collectLaneControl`). It is synchronous and never throws: the store's
 *  reader and the journal adapter answer every failure as a read state. A server built with no journal reads
 *  `not-configured`, an unmeasurable state, never `missing`: only a proven ENOENT is the bootstrap's missing journal.
 *  The executor, the latch helper and the route each read through it. */
export function collectControlNow(c: Pick<CollectControlDeps, 'coord' | 'journal'>):
  { readonly row: CollectLaneRowRead; readonly journal: CollectLaneJournalRead; readonly control: CollectLaneControl } {
  const row = c.coord.collectLaneRow();
  const journal: CollectLaneJournalRead = c.journal === null ? { kind: 'not-configured' } : c.journal.read();
  return { row, journal, control: collectLaneControl(measureCollectLaneRow(row), journal) };
}

/** THE ONE LATCH HELPER (path-identity spec 2026-10-12 §5.4). It is synchronous. It reads the control state, and asks
 *  the store's one writer to retire the marker only when L1's `collectLatchDue` says the latch is due. That needs a
 *  listing that is not paused, is listed, is on the same epoch and proves the marker absent, beside a coherent row and
 *  journal whose latch is unset. The request expects exactly the row and the journal it read. The writer appends the
 *  next generation before it updates the row, inside one transaction.
 *
 *  On `retired`, and on nothing else, it hands the lane the latch's row body, once. It never heals a mismatch: an
 *  incoherent state is never due, and the writer refuses one anyway. Its callers are the executor's step 6 and the
 *  lane's pass, each right after a registry listing, never the route. Whatever it answers, the caller reads the control
 *  state again before deciding anything. A throw from the writer, which the store raises only before its append, is
 *  answered `store-threw` (the coordinator's extension of the warn-latch ruling, 2026-10-12): the helper never throws,
 *  so neither the executor's job nor the lane's pass rejects on it. */
export function collectRetireLatch(c: CollectControlDeps, switches: CollectSwitches, epoch: CollectEpochPair): CollectLatchOutcome {
  const seen = collectControlNow(c);
  if (c.journal === null || !collectLatchDue(switches, epoch, seen.control)) return { kind: 'not-due' };
  let w: ReturnType<CollectControlDeps['coord']['setCollectLane']>;
  try {
    w = c.coord.setCollectLane({ kind: 'retire', expected: seen.row, expectedJournal: seen.journal }, c.wallNow(),
      c.journal);
  } catch {
    // A throw BEFORE the store's append (`BEGIN IMMEDIATE` busy past its timeout, an I/O fault at `BEGIN`): nothing was
    // appended or written, and the store propagates it by design. Answered, never rethrown; the caller re-reads.
    return { kind: 'store-threw' };
  }
  switch (w.kind) {
    case 'written':
      c.latchRetired(collectLatchFeedBody(COLLECT_ACTOR));
      return { kind: 'retired' };
    // The store's own read, inside its transaction, found the latch already set: there was nothing to retire.
    case 'unchanged': return { kind: 'not-due' };
    case 'refused': return { kind: 'refused', code: w.code };
    case 'failed': return { kind: 'failed', phase: w.phase };
    default: { const unnamed: never = w; return unnamed; }
  }
}

/** Both capabilities, as the route and the Settings view read them (path-identity spec 2026-10-12 §5.6, §5.7). This is
 *  the ONE helper they call, so neither spells the capability. The executor's own step 6 asks the same pair inline, in
 *  the act's own scope (`collect-lane-scans.test.ts` counts that question). The collector's own row is asked through
 *  `ccdCan` (D-5866) and the pause precondition through `capSupported`; both refuse on no evidence, so a server with no
 *  fleet state reads both absent. */
export function collectLaneCaps(state: FleetState | undefined): CollectLaneCaps {
  return { collect: ccdCan(state, 'wsCollect'), reclaimPause: capSupported(state, RECLAIM_PAUSE_CAP) };
}

// ── the one audit site ───────────────────────────────────────────────────────

/** Which of the one audit site's two gates refused, so nothing was asked of the box (spec §5.10): `capability` is
 *  `collect-v1` not advertised; `verb` is `ws-audit` missing from the box's verb list. */
interface CollectAuditRefused { readonly notAsked: 'capability' | 'verb' }

/** THE ONE AUDIT SITE (spec §5.10). It serves observation 2 for the executor, and the learning audit for the lane. Both
 *  questions are asked in its own scope:
 *  - the capability token, which refuses on no evidence;
 *  - the verb, by which `verb-gate.test.ts` keys this site (`ws-audit`). Where `collect-v1` is advertised the verb is
 *    too, so this check changes no decision.
 *  Either refusal says which gate refused (`CollectAuditRefused`). The generations are captured as the call is composed.
 *  The clocks are read as the first statement after it settles, whether it answered or rejected. A rejection is an
 *  audit with no document, never a probe. */
async function collectAudit(
  deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState' | 'lane'>, id: string,
): Promise<CollectAnswer<CollectAudit> | CollectAuditRefused> {
  if (!ccdCan(deps.fleetState, 'wsCollect')) return { notAsked: 'capability' };
  // D-6627: a loose id is audited by its hex, behind its own capability; everything after the argv is shared.
  const hex = collectLooseHexOf(id);
  if (hex !== null && !ccdCan(deps.fleetState, 'wsCollectLooseAudit')) return { notAsked: 'capability' };
  const argv = hex === null ? CCD_ARGV.wsCollectAudit(id) : CCD_ARGV.wsCollectLooseAudit(hex);
  if (!ccdCan(deps.fleetState, 'wsCollectAudit')) return { notAsked: 'verb' };
  const composed = deps.lane.generations(id);
  let res: CcdResult;
  try {
    res = await deps.runCcd(argv);
  } catch (err) {
    const arrived = deps.lane.clock();
    return { value: { kind: 'no-document', stderr: said(err) }, composed, arrived };
  }
  const arrived = deps.lane.clock();
  // D-6034: a call that never ran is read FIRST, as the rejection above is: an audit with no document, never a probe.
  if (res.ran === false) return { value: { kind: 'no-document', stderr: res.stderr }, composed, arrived };
  return { value: hex === null ? parseCollectAudit(id, res.ok, res.stdout, res.stderr)
    : parseCollectLooseAudit(hex, res.ok, res.stdout, res.stderr), composed, arrived };
}

/** The lane's LEARNING audit (spec §5.10). It is read-only on the box: the audit journals a terminal refusal and
 *  nothing else. It asks the temp-root id predicate FIRST, the twin of the act's step-1 check: the population gated the
 *  id, but path-identity W2 widened that population to an id a compare-and-drop aside is for, so the learning audit no
 *  longer relies on that gate alone. Then it sits behind the capability, as the act does. The caller runs it on the
 *  id's queue key. */
export async function learnCollect(
  deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState' | 'lane'>, id: string,
): Promise<CollectLearnAnswer> {
  if (!isTmpRootId(id) && collectLooseHexOf(id) === null) return { kind: 'id-refused' };
  const audit = await collectAudit(deps, id);
  return 'notAsked' in audit ? { kind: 'not-asked', why: 'caps' } : { kind: 'answered', audit };
}

// ── the job ──────────────────────────────────────────────────────────────────

/** Step 6's stop, as the job and its gate row read it (one spelling of the comparison, D-7166's copy rule). */
const collectLaneStopped = (lane: CollectLaneEffective): lane is Extract<CollectLaneEffective, { kind: 'stopped' }> =>
  lane.kind === 'stopped';

export async function collectTempRoot(deps: CollectTempRootDeps, job: CollectJob): Promise<CollectJobOutcome> {
  // 1 — BOTH capabilities, proven: each refuses on no evidence, where `verbSupported` would permit (D-5866: the
  // collector's own row through `ccdCan`, the pause precondition through `capSupported`). A box the
  // phone cannot pause never runs an automatic destructive lane. Then the id predicate AGAIN, on the job's own id,
  // before any argv. The population gated it; this is the second check, pinned on its own (spec §5.10).
  if (!ccdCan(deps.fleetState, 'wsCollect') || !capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)) {
    deps.lane.cleared('caps');
    return { kind: 'not-asked', step: 1, why: 'caps',
      detail: `the fleet host does not advertise both ${COLLECT_CAP} and ${RECLAIM_PAUSE_CAP}` };
  }
  // D-6627: a loose entry rides its own pair of capabilities and its own id grammar (`loose:<hex>`, a string the temp-root
  // predicate refuses). Both are asked here and again at the audit site; the verb's is asked nearest its argv.
  const looseHex = collectLooseHexOf(job.id);
  if (looseHex !== null && !(ccdCan(deps.fleetState, 'wsCollectLoose') && ccdCan(deps.fleetState, 'wsCollectLooseAudit'))) {
    deps.lane.cleared('caps');
    return { kind: 'not-asked', step: 1, why: 'caps', detail: `the fleet host does not advertise ${COLLECT_LOOSE_CAP}` };
  }
  if (looseHex === null && !isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused', detail: COLLECT_ID_REFUSED };
  // THE EPOCH THIS JOB WAS QUEUED UNDER (path-identity spec 2026-10-12 §5.5). The lane read it outside the queue
  // callback, so the pair the switch is resolved under starts here. A reconnect anywhere between the queueing and the
  // job's last listing, observation 2 included, composes nothing.
  const queuedUnder = job.epoch;
  // 2 — THE SWITCH, from one listing. A registry that did not list cannot rule a raised pause out, so it is a pause.
  const first = await collectSwitches(deps.io, deps.cfg.registryDir);
  if (first.paused) {
    deps.lane.cleared('paused');
    return { kind: 'not-asked', step: 2, why: 'paused', detail: COLLECT_PAUSED[first.why] };
  }
  // 3 — a person at the session. No ceiling, and no licence past it.
  if (deps.viewers?.isVisible(job.id) === true) return { kind: 'not-asked', step: 3, why: 'presence', detail: COLLECT_SEEN };
  // 4 — OBSERVATION 2, through the one audit site. It is stale if a clear landed while it was in flight. Then the
  // licence against observation 1, read from the lane's memory and never carried. Then the open-run hold, judged on
  // THIS document, licensed or not.
  const asked = await collectAudit(deps, job.id);
  if ('notAsked' in asked) {
    deps.lane.cleared('caps');
    return { kind: 'not-asked', step: 4, why: 'caps', detail: COLLECT_AUDIT_REFUSED[asked.notAsked] };
  }
  const audit: CollectAnswer<CollectAudit> = asked;
  const answered = (step: 4 | 5 | 6, why: CollectAnsweredWhy, detail: string): CollectJobOutcome =>
    ({ kind: 'answered', step, why, detail, audit });
  if (!sameGenerations(audit.composed, deps.lane.generations(job.id))) return answered(4, 'stale', COLLECT_STALE);
  const obs2 = audit.value;
  if (obs2.kind !== 'collectable') return answered(4, 'not-collectable', `ws-audit answered ${obs2.kind}`);
  const observed: CollectAnswer<CollectAuditCollectable> = { ...audit, value: obs2 };
  // The licence is the ONE L1 rule, `collectLicence`, against observation 1 read from the lane's memory. `observes`
  // is true: the stale check above has already asked whether this answer is an observation.
  const licence = collectLicence(deps.lane.observation(job.id), obs2, audit.arrived.mono, deps.observeIntervalMs, true);
  const hold = collectOpenRunHold(deps.coord, job.id, obs2);
  if (hold.kind === 'held') return { kind: 'held', step: 4, hold, audit: observed };
  if (licence.kind !== 'licensed') return answered(4, 'not-licensed', `${COLLECT_NOT_LICENSED} (${licence.kind})`);
  const obs1 = licence.first;
  // 5 — THE SWITCHES ONCE MORE: the job's LAST await. The connection epoch is read before it (path-identity spec
  // 2026-10-12 §5.2). Epochs only rise, so the pair below, from the job's epoch to the one after the listing, already
  // covers a move across the listing; this read words WHEN the connection moved.
  const listedUnder = deps.link.epochNow();
  const last = await collectSwitches(deps.io, deps.cfg.registryDir);
  // ── 6 — SYNCHRONOUS from here to the argv: no await may stand between these reads and the act (spec §5.10;
  // path-identity spec 2026-10-12 §5.5). ──
  const epoch: CollectEpochPair = { before: queuedUnder, after: deps.link.epochNow() };
  // The marker's latch, through its ONE helper, decided apart from the arm (§5.4). Whatever it answers, the row and the
  // journal are read again below, so a refused, failed or thrown (`store-threw`) retire is resolved from what now stands.
  collectRetireLatch(deps.control, last, epoch);
  const caps: CollectLaneCaps = {
    collect: ccdCan(deps.fleetState, 'wsCollect'), reclaimPause: capSupported(deps.fleetState, RECLAIM_PAUSE_CAP),
  };
  const lane = collectLaneEffective({
    switches: last, epoch, caps, control: collectControlNow(deps.control).control, node: deps.link.current(),
  });
  // A STOP: no flip, no row, a lane-wide clear (§5.5).
  if (collectLaneStopped(lane)) {
    if (lane.why === 'raised' || lane.why === 'unlistable') {
      deps.lane.cleared('paused');
      return answered(5, 'paused', COLLECT_PAUSED[lane.why]);
    }
    if (lane.why === 'epoch-changed') {
      deps.lane.cleared('epoch');
      return answered(5, 'epoch-changed', COLLECT_EPOCH_MOVED[listedUnder === epoch.after ? 'queued' : 'listing']);
    }
    const unknownFleet: 'unknown-fleet' = lane.why;       // the last stop: a new one is a compile error here
    deps.lane.cleared('node');
    return answered(5, unknownFleet, COLLECT_UNKNOWN_FLEET);
  }
  if (lane.kind === 'not-running') {
    deps.lane.cleared('caps');
    return answered(6, 'caps', COLLECT_NOT_RUNNING);
  }
  // The flip is on the effective BOOLEAN, never on its source (§5.5).
  if (deps.lane.flipped(lane)) return answered(5, 'switch-flip', COLLECT_FLIPPED);
  if (lane.kind === 'safety-stopped') return answered(5, 'safety-stopped', `${COLLECT_SAFETY_STOPPED} (${lane.why})`);
  if (!collectLicenceStands(obs1, audit.composed, deps.lane.generations(job.id), deps.lane.observation(job.id))) {
    return answered(6, 'pair-cleared', COLLECT_PAIR_CLEARED);
  }
  if (deps.viewers?.isVisible(job.id) === true) return answered(6, 'presence', COLLECT_SEEN);
  const holdAtAct = collectOpenRunHold(deps.coord, job.id, obs2);
  if (holdAtAct.kind === 'held') return { kind: 'held', step: 6, hold: holdAtAct, audit: observed };
  if (!collectLaneLive(lane)) return { kind: 'would-collect', audit: observed };
  // D-6627: the loose arm's own marker, from the SAME final listing the lane was resolved under. Absent, or the capability
  // withdrawn since step 1: shadow. Both arms must stand; the lane's switch above is never bypassed.
  if (looseHex !== null && (last.looseMarker !== true || !ccdCan(deps.fleetState, 'wsCollectLoose'))) {
    return { kind: 'would-collect', audit: observed };
  }
  const now = deps.lane.clock();
  let act: CcdResult;
  try {
    act = await deps.runCcd(looseHex === null
      ? CCD_ARGV.wsCollect(obs2.token, job.id, sweepDec(deps.fleetState, COLLECT_ACTOR))
      : CCD_ARGV.wsCollectLoose(obs2.token, looseHex, sweepDec(deps.fleetState, COLLECT_ACTOR)));
  } catch (err) {
    const arrived = deps.lane.clock();
    return { kind: 'acted', audit: observed, composedMono: now.mono, result: { kind: 'no-document', stderr: said(err) }, arrived };
  }
  const arrived = deps.lane.clock();
  // D-6034: read FIRST, before a recognised pre-lock die is read off the runner's stderr. A die "acted nothing"; a call
  // that may not have reached ccd, or reached it and lost the answer, MAY have acted, so it is `no-document` — the lane
  // keeps the id and the slot — exactly as the rejection above is.
  if (act.ran === false) {
    return { kind: 'acted', audit: observed, composedMono: now.mono, result: { kind: 'no-document', stderr: act.stderr }, arrived };
  }
  return { kind: 'acted', audit: observed, composedMono: now.mono,
    result: looseHex === null ? parseCollectResult(job.id, act.ok, act.stdout, act.stderr)
      : parseCollectLooseResult(looseHex, act.ok, act.stdout, act.stderr), arrived };
}

// ── the open-run hold ────────────────────────────────────────────────────────

/** THE OPEN-RUN HOLD (spec §5.10), judged on OBSERVATION 2's document, never observation 1's. It only ever makes the
 *  lane slower. Whatever it answers, ccd decides inside its lock. Every read is a synchronous CoordStore read, and so is
 *  a re-read made at step 6 with no await before the argv. It holds when:
 *  - (a) the witness's run is not terminal; `unknown` and a word from a newer build hold;
 *  - (b) the witness's run is ABSENT from the database. A lost, rebuilt or restored database makes every run absent at
 *    once, the open ones included;
 *  - (c) the witness's run opened after the witness's instant plus `CHILD_BIRTH_SKEW_MS`, so it is not the minting run:
 *    run ids restart after a database loss. A witness with a run and no instant cannot be placed, and holds the same
 *    way;
 *  - (d) any non-terminal run names the id as its session or its coordinator. A later run may bind an unspent child,
 *    and this also holds an id that only a record names;
 *  - (e) a FRESH collectable document (no `resume` key: its token mode is `collect` or `collect-absent`) whose witness
 *    names no run. A wave-7 ccd never prints one, so this is defence in depth. A RESUME with no witness is not held by
 *    (a) to (e): it finishes an act that began under these same gates, and (d) alone holds it. The stated residual is
 *    that a record's own run is not on the wire;
 *  - (f) any of these reads fails.
 *  It counts nothing. The lane clears the pair, and the id's next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS`
 *  flat. */
export function collectOpenRunHold(
  coord: CollectTempRootDeps['coord'], id: string, doc: Pick<CollectAuditCollectable, 'resume' | 'witnessRun' | 'witnessAt'>,
): CollectHoldRead {
  const held = (why: CollectHoldWhy, detail: string): CollectHeld => ({ kind: 'held', why, detail });
  try {
    // (e) is a WITNESSED leaf's rule: a loose entry has no witness and so no run to wait for, and would be held forever.
    if (doc.resume === null && doc.witnessRun === null && !collectIsLoose(id)) {
      return held('no-witness-run', `ws-audit offered a fresh collection of ${id} whose witness names no run, so no run `
        + 'can be asked whether it still needs the temp root');
    }
    if (doc.witnessRun !== null) {
      const n = doc.witnessRun;
      const read = coord.run(n);
      if (!read.ok) return held('store-unreadable', `run ${n}, named by ${id}’s witness, could not be read (${read.detail})`);
      if (read.run === null) {
        return held('run-absent', `run ${n}, named by ${id}’s witness, is not in the coordination database; a lost, rebuilt `
          + 'or restored database makes every run absent at once, the open ones included');
      }
      if (!(TERMINAL_RUN_STATES as readonly RunState[]).includes(read.run.state)) {
        return held('run-open', `run ${n}, named by ${id}’s witness, is ${read.run.state}, not finished`);
      }
      if (doc.witnessAt === null) {
        return held('run-after-witness', `${id}’s witness names run ${n} but carries no instant, so whether that run `
          + 'handed this temp root out cannot be said');
      }
      if (read.run.openedAt > doc.witnessAt + CHILD_BIRTH_SKEW_MS) {
        return held('run-after-witness', `run ${n} opened ${read.run.openedAt - doc.witnessAt} ms after ${id}’s witness `
          + `was written, past the ${CHILD_BIRTH_SKEW_MS} ms skew, so it is not the run that handed this temp root out: `
          + 'run ids restart after a database loss');
      }
    }
    const bound = coord.bindingsOf(id);
    const worker = bound.worker();
    if (!worker.ok) return held('store-unreadable', `which open runs name ${id} as their session could not be read (${worker.detail})`);
    const claims = bound.claimant();
    if (!claims.ok) return held('store-unreadable', `which open runs ${id} coordinates could not be read (${claims.detail})`);
    const naming = [...new Set([...worker.siblings, ...claims.siblings].map((r) => r.id))].sort((a, b) => a - b);
    if (naming.length > 0) {
      return held('id-in-open-run', `open run(s) ${naming.map((r) => `#${r}`).join(', ')} name ${id} as their session or coordinator`);
    }
    return { kind: 'clear' };
  } catch (err) {
    return held('store-unreadable', `the coordination database could not be read (${said(err)})`);
  }
}

// ── the gate's row (D-7166; ARCH-44, consolidation spec K1) ──────────────────

/**
 * TEMP-ORPHAN'S ROW OF THE ONE RETIRE GATE (`retire.ts#decideRetire`): `collectTempRoot`'s steps 1 to 6, one row step per
 * point at which the job answers, in the job's order, each judged by the job's own statements over its readers' facts.
 * The readers are the job's reads, unchanged (`collectSwitches` included, D-7224); the lane clears and every other
 * effect stay with the port (D-7199). It is the job's description, not yet its body: `collectTempRoot` still runs its
 * own ladder until its reason moves (D-7168).
 */
export interface TempOrphanFacts {
  /** Both capabilities, then the loose pair (true when the id is not loose). */
  readonly [RETIRE_STEPS.capability]?: readonly boolean[];
  /** The loose entry's hex, or null: the id predicate's input. */
  readonly [RETIRE_STEPS.id]?: string | null;
  readonly [RETIRE_STEPS.switches]?: CollectSwitches;
  readonly [RETIRE_STEPS.presence]?: boolean;
  readonly [RETIRE_STEPS.audit]?: CollectAnswer<CollectAudit> | CollectAuditRefused;
  /** Both clear generations, read after the audit settled. */
  readonly [RETIRE_STEPS.staleGeneration]?: CollectGenerations;
  readonly [RETIRE_STEPS.auditVerdict]?: RetireNoRead;
  /** `collectLicence` over observation 1, read before the hold and judged with it. */
  readonly [RETIRE_STEPS.licence]?: CollectLicence;
  readonly [RETIRE_STEPS.hold]?: CollectHoldRead;
  /** The epoch read before the last listing, and that listing. */
  readonly [RETIRE_STEPS.switchesLast]?: { readonly listedUnder: number; readonly last: CollectSwitches };
  /** The pair the switch is resolved under; its reader writes the latch. */
  readonly [RETIRE_STEPS.latch]?: CollectEpochPair;
  readonly [RETIRE_STEPS.lane]?: CollectLaneEffective;
  /** `CollectLanePort.flipped`'s answer. */
  readonly [RETIRE_STEPS.flip]?: boolean;
  readonly [RETIRE_STEPS.safety]?: RetireNoRead;
  readonly [RETIRE_STEPS.licenceStands]?: { readonly generations: CollectGenerations; readonly observation: CollectObservation | null };
  readonly [RETIRE_STEPS.presenceLast]?: boolean;
  readonly [RETIRE_STEPS.holdLast]?: CollectHoldRead;
  readonly [RETIRE_STEPS.live]?: RetireNoRead;
  /** `ccdCan(…, 'wsCollectLoose')`, asked again nearest the argv. */
  readonly [RETIRE_STEPS.looseMarker]?: boolean;
}

/** The markers the job's two listings read, each from ONE measured listing. */
const COLLECT_SWITCH_MARKERS: readonly string[] = [RECLAIM_PAUSE_MARKER, COLLECT_LANE_LIVE_MARKER, COLLECT_LOOSE_LIVE_MARKER];

/** The audit's answer, for a step after `audit` (which judged its own refusal). */
const collectAskedOf = (f: TempOrphanFacts): CollectAnswer<CollectAudit> => {
  const asked = f[RETIRE_STEPS.audit];
  if (asked === undefined || 'notAsked' in asked) throw new Error('temp-orphan: a step after the audit was judged without it');
  return asked;
};
/** The collectable audit, for a step after `audit-verdict`. */
const collectObservedOf = (f: TempOrphanFacts): CollectAnswer<CollectAuditCollectable> => {
  const audit = collectAskedOf(f);
  const obs2 = audit.value;
  if (obs2.kind !== 'collectable') throw new Error('temp-orphan: a step after the verdict was judged on an uncollectable audit');
  return { ...audit, value: obs2 };
};
const collectAnsweredOf = (f: TempOrphanFacts, step: 4 | 5 | 6, why: CollectAnsweredWhy, detail: string): CollectJobOutcome =>
  ({ kind: 'answered', step, why, detail, audit: collectAskedOf(f) });

/** Step 1's id predicate, on the job's own id (D-7204: `id-argv-census.test.ts`'s `collector-step-1` gate). */
function collectIdJudge(looseHex: string | null, job: CollectJob): CollectJobOutcome | null {
  if (looseHex === null && !isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused', detail: COLLECT_ID_REFUSED };
  return null;
}

/** Step 2's switch, as `collectSwitches` answers it (D-7224). */
function collectSwitchesJudge(first: CollectSwitches): CollectJobOutcome | null {
  if (first.paused) return { kind: 'not-asked', step: 2, why: 'paused', detail: COLLECT_PAUSED[first.why] };
  return null;
}

/** Step 6's resolved switch: a stop (a pause, an unlistable registry, a moved epoch, an unmeasured node) or a missing
 *  capability. Its epoch words read the epoch taken before the last listing and the pair's `after`. */
function collectLaneJudge(lane: CollectLaneEffective, f: TempOrphanFacts): CollectJobOutcome | null {
  if (collectLaneStopped(lane)) {
    if (lane.why === 'raised' || lane.why === 'unlistable') return collectAnsweredOf(f, 5, 'paused', COLLECT_PAUSED[lane.why]);
    if (lane.why === 'epoch-changed') {
      const listedUnder = f[RETIRE_STEPS.switchesLast]?.listedUnder;
      const epoch = f[RETIRE_STEPS.latch];
      return collectAnsweredOf(f, 5, 'epoch-changed', COLLECT_EPOCH_MOVED[listedUnder === epoch?.after ? 'queued' : 'listing']);
    }
    const unknownFleet: 'unknown-fleet' = lane.why;       // the last stop: a new one is a compile error here
    return collectAnsweredOf(f, 5, unknownFleet, COLLECT_UNKNOWN_FLEET);
  }
  if (lane.kind === 'not-running') return collectAnsweredOf(f, 6, 'caps', COLLECT_NOT_RUNNING);
  return null;
}

export const TEMP_ORPHAN_RETIRE: RetireReason<CollectJob, TempOrphanFacts, CollectJobOutcome> = {
  name: RETIRE_REASON_NAMES.tempOrphan,
  decide: [
    { step: RETIRE_STEPS.capability, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.id, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.switches, sync: false, onReject: 'propagate', markers: COLLECT_SWITCH_MARKERS },
    { step: RETIRE_STEPS.presence, sync: true, onReject: 'propagate' },
  ],
  audit: { step: RETIRE_STEPS.audit, sync: false, onReject: 'propagate' },
  act: [
    { step: RETIRE_STEPS.staleGeneration, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.auditVerdict, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.licence, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.hold, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.switchesLast, sync: false, onReject: 'propagate', markers: COLLECT_SWITCH_MARKERS },
    { step: RETIRE_STEPS.latch, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.lane, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.flip, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.safety, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.licenceStands, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.presenceLast, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.holdLast, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.live, sync: true, onReject: 'propagate' },
    { step: RETIRE_STEPS.looseMarker, sync: true, onReject: 'propagate' },
  ],
  listing: RETIRE_LISTING_MODES.measuredOnce,
  presence: RETIRE_PRESENCE_RULES.noCeiling,
  notice: RETIRE_NOTICE_HOMES.lane,
  judge: {
    [RETIRE_STEPS.capability]: capabilityJudge<CollectJob, TempOrphanFacts, CollectJobOutcome>([
      () => ({ kind: 'not-asked', step: 1, why: 'caps',
        detail: `the fleet host does not advertise both ${COLLECT_CAP} and ${RECLAIM_PAUSE_CAP}` }),
      () => ({ kind: 'not-asked', step: 1, why: 'caps', detail: `the fleet host does not advertise ${COLLECT_LOOSE_CAP}` }),
    ]),
    [RETIRE_STEPS.id]: (looseHex, _f, job) => collectIdJudge(looseHex, job),
    [RETIRE_STEPS.switches]: (first) => collectSwitchesJudge(first),
    [RETIRE_STEPS.presence]: presenceJudge<CollectJob, TempOrphanFacts, CollectJobOutcome>(RETIRE_PRESENCE_RULES.noCeiling,
      () => ({ kind: 'not-asked', step: 3, why: 'presence', detail: COLLECT_SEEN })),
    [RETIRE_STEPS.audit]: (asked) =>
      ('notAsked' in asked ? { kind: 'not-asked', step: 4, why: 'caps', detail: COLLECT_AUDIT_REFUSED[asked.notAsked] } : null),
    [RETIRE_STEPS.staleGeneration]: (now, f) =>
      (!sameGenerations(collectAskedOf(f).composed, now) ? collectAnsweredOf(f, 4, 'stale', COLLECT_STALE) : null),
    [RETIRE_STEPS.auditVerdict]: (_n, f) => {
      const obs2 = collectAskedOf(f).value;
      return obs2.kind !== 'collectable' ? collectAnsweredOf(f, 4, 'not-collectable', `ws-audit answered ${obs2.kind}`) : null;
    },
    [RETIRE_STEPS.hold]: (hold, f) => {
      if (hold.kind === 'held') return { kind: 'held', step: 4, hold, audit: collectObservedOf(f) };
      const licence = f[RETIRE_STEPS.licence];
      if (licence === undefined) throw new Error('temp-orphan: the hold was judged without the licence read before it');
      if (licence.kind !== 'licensed') {
        return collectAnsweredOf(f, 4, 'not-licensed', `${COLLECT_NOT_LICENSED} (${licence.kind})`);
      }
      return null;
    },
    [RETIRE_STEPS.lane]: (lane, f) => collectLaneJudge(lane, f),
    [RETIRE_STEPS.flip]: (flipped, f) => (flipped ? collectAnsweredOf(f, 5, 'switch-flip', COLLECT_FLIPPED) : null),
    [RETIRE_STEPS.safety]: (_n, f) => {
      const lane = f[RETIRE_STEPS.lane];
      return lane?.kind === 'safety-stopped' ? collectAnsweredOf(f, 5, 'safety-stopped', `${COLLECT_SAFETY_STOPPED} (${lane.why})`) : null;
    },
    [RETIRE_STEPS.licenceStands]: (now, f) => {
      const licence = f[RETIRE_STEPS.licence];
      if (licence?.kind !== 'licensed') throw new Error('temp-orphan: the pair was judged without a licensed observation 1');
      return !collectLicenceStands(licence.first, collectAskedOf(f).composed, now.generations, now.observation)
        ? collectAnsweredOf(f, 6, 'pair-cleared', COLLECT_PAIR_CLEARED) : null;
    },
    [RETIRE_STEPS.presenceLast]: presenceJudge<CollectJob, TempOrphanFacts, CollectJobOutcome>(RETIRE_PRESENCE_RULES.noCeiling,
      (_job, f) => collectAnsweredOf(f, 6, 'presence', COLLECT_SEEN)),
    [RETIRE_STEPS.holdLast]: (hold, f) => (hold.kind === 'held' ? { kind: 'held', step: 6, hold, audit: collectObservedOf(f) } : null),
    [RETIRE_STEPS.live]: (_n, f) => {
      const lane = f[RETIRE_STEPS.lane];
      if (lane === undefined || (lane.kind !== 'live' && lane.kind !== 'shadowed')) throw new Error('temp-orphan: the shadow arm was judged on an unresolved switch');
      return !collectLaneLive(lane) ? { kind: 'would-collect', audit: collectObservedOf(f) } : null;
    },
    [RETIRE_STEPS.looseMarker]: (looseCan, f) => {
      const looseHex = f[RETIRE_STEPS.id] ?? null;
      const last = f[RETIRE_STEPS.switchesLast]?.last;
      return looseHex !== null && (last?.looseMarker !== true || !looseCan) ? { kind: 'would-collect', audit: collectObservedOf(f) } : null;
    },
  },
  evidence: [collectLicence],
};
