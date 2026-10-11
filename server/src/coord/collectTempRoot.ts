import path from 'node:path';
import type { FleetIO, MeasuredPathKind, MeasuredStat } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { Presence } from '../presence.js';
import type { CcdResult } from '../lifecycle.js';
import { CCD_ARGV, COLLECT_CAP, RECLAIM_PAUSE_CAP, capSupported, sweepDec, verbSupported } from '../ccdargv.js';
import type { CoordStore } from './store.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { CHILD_BIRTH_SKEW_MS } from './childSpent.js';
import {
  COLLECT_LANE_LIVE_MARKER, collectLicence, collectLicenceStands, parseCollectAudit, parseCollectResult,
  type CollectAudit, type CollectCapture, type CollectHoldWhy, type CollectListing, type CollectObservation,
  COLLECT_HOLD_WHYS, type CollectResult,
} from '../collectLane.js';
import { TERMINAL_RUN_STATES, TMPROOT_ID_MAX_CHARS, isTmpRootId, type RunState } from '../../../shared/api.js';

/**
 * THE TEMP-ROOT COLLECTOR'S ONE EXECUTOR, AND ITS READS (child reclamation spec 2026-09-22 §5.10).
 *
 * It runs `ws-audit --collect` as observation 2, then the collector's verb with THAT audit's token. The server composes
 * the verb, and nothing else does. It follows `expireArchived`'s shape, in a file of its own, so it shares no
 * vocabulary, feed row or attention list with the reclaim and expiry lanes. Its callers are `watch.ts`'s collector
 * pass. Every call runs on the id's `KeyedQueue` key, the key the reclaim and expiry executors use, so no two lanes
 * touch one id at once.
 *
 * THE JOB, in order. Every doubt is "not this time". Nothing here paces, frees a slot or writes a feed row: the job
 * REPORTS (`CollectJobOutcome`), and the lane folds the report through its L1 rules (`collectLane.ts`).
 *   1. The box must PROVE both capabilities, `collect-v1` and `reclaim-pause-v1` (`capSupported`, which refuses on no
 *      evidence). An automatic destructive lane never runs on a box the phone cannot pause. Then the id predicate
 *      AGAIN, on the job's own id: the population gated it, and this is the second check before any argv.
 *   2. The switch, from ONE registry listing. A raised `reclaim-paused`, or a listing that could not be taken, stops it.
 *   3. A person looking at the session stops it, with no ceiling and no licence past it.
 *   4. The audit is OBSERVATION 2. It is stamped when its answer arrives, and it is an observation only if neither
 *      clear generation moved while it was in flight. It licenses the act only under the lane's one licence rule
 *      (`collectLicence`): observation 1 stands, with the same token, and arrived at least the interval before. Then
 *      the open-run hold is judged on observation 2's document, licensed or not, so a held id never seeds a pair.
 *   5. The switches once more, with the live marker, from one fresh listing. This is the job's LAST await. A marker that
 *      differs from the lane's last-seen flag is a flip: every pair clears, and this job composes nothing.
 *   6. SYNCHRONOUSLY, with no await before the argv: observation 1 is re-read (`collectLicenceStands`: a pair cleared
 *      since composes nothing), presence is read again, the hold's store reads are made again (CoordStore is
 *      synchronous), and the capability is asked again in the act's own scope. Shadow: "would collect", and stop.
 *      Live: the verb, on observation 2's token and the job's id. The start hold-off is the lane's, asked at its offer.
 * It never kills a holder. It never passes `--defer-expired`: the builder has no such flag, and ccd's arity guard
 * dies on it. It never retries inside itself: ccd recomputes the token inside the reap lock before anything moves.
 */

// ── the ports (L2, declared by this consumer) ────────────────────────────────

/** The two clocks, read together, once, as the first statement after an answer settles (spec §5.7's clock rule).
 *  `mono` decides; `wall` is compared only with a ccd stamp, at arrival. */
export interface CollectClock { readonly mono: number; readonly wall: number }

/** The lane's two clear generations for one id (spec §5.10):
 *  - the lane-wide one moves on a raised pause or an unlistable registry, a missing capability, a pass that failed
 *    shut, or a marker flip;
 *  - the id's own moves on any reset of its pair.
 *  Both are captured when a call is composed. Its answer is an observation only if both still stand when it arrives.
 *  It is L1's `CollectCapture`, spelled once there (H3). */
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
  /** A lane-wide clear this job saw. `paused` is `reclaim-paused` raised, or a registry that did not list; `caps` is a
   *  missing capability. Every pair clears now, and the per-id pacing stays. */
  cleared(why: 'paused' | 'caps'): void;
  /** The live marker as this job read it at its last await. Answers true when it differs from the lane's last-seen
   *  flag, which starts `shadowed` when the lane is constructed. The lane has then set the flag, cleared every pair and
   *  written the flip's one feed row, and this job composes nothing. Answers false otherwise, and nothing changed. */
  flipped(live: boolean): boolean;
}

/** The executor's ports. Each is narrowed to what is asked of it:
 *  - `coord` to the three destructive-grade reads the hold makes;
 *  - `io` to the one listing the switches read;
 *  - `presence` to its one question.
 *  `observeIntervalMs` is the lane's `COLLECT_OBSERVE_INTERVAL_MS`, passed in, as the L1 licence takes it. `runCcd` is
 *  the lane's stamping wrapper (Task 7), which reads `argv[0]` to tell this job's audit from its act (H1). */
export interface CollectTempRootDeps {
  coord: Pick<CoordStore, 'run' | 'openRunsForSession' | 'openRunsClaimedBy'>;
  io: Pick<FleetIO, 'readdir'>;
  cfg: Pick<CcrcConfig, 'registryDir'>;
  runCcd: Deps['runCcd'];
  fleetState?: FleetState;
  presence?: Pick<Presence, 'isVisible'>;
  lane: CollectLanePort;
  observeIntervalMs: number;
}

/** One job: the id the lane offered. Observation 1 is read from the lane's memory and never carried: a token is a
 *  comparand, never a request's payload. */
export interface CollectJob { readonly id: string }

// ── what a job reports ───────────────────────────────────────────────────────

/** A hold that stood (spec §5.10). `why` is the lane's word, and `detail` names the run or the read. */
export interface CollectHeld { readonly kind: 'held'; readonly why: CollectHoldWhy; readonly detail: string }
export type CollectHoldRead = { readonly kind: 'clear' } | CollectHeld;

/** Why a job that asked the box for observation 2 composed nothing. */
export type CollectAnsweredWhy =
  | 'stale' | 'not-collectable' | 'not-licensed' | 'paused' | 'marker-flip' | 'pair-cleared' | 'presence' | 'caps';

/** What one job did (spec §5.10), for the lane to fold. Only `acted` composed the collector's verb. Every other arm
 *  composed none, and the lane frees the slot on it. Each arm says what was measured, never what to do next. */
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

/** The learning audit's answer: not asked, because the box cannot answer it, or answered, with its generations and
 *  its arrival. */
export type CollectLearnAnswer =
  | { readonly kind: 'not-asked'; readonly why: 'caps' }
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
  stale: true, 'not-collectable': true, 'not-licensed': true, paused: true, 'marker-flip': true, 'pair-cleared': true,
  presence: true, caps: true,
};
const COLLECT_AUDIT_KINDS: Readonly<Record<CollectAudit['kind'], true>> = {
  collectable: true, verdict: true, unmeasured: true, unreadable: true, 'no-document': true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`, where this executor
 *  lives: its SIXTEENTH union, admitted as `isArchivedExpiryKebab` admits the expiry lane's. Derived from the tables
 *  above and L1's `COLLECT_HOLD_WHYS`, never a list, so a word added to a union is admitted and a typo is not. */
export function isCollectExecutorKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return own(COLLECT_OUTCOME_KINDS) || own(COLLECT_NOT_ASKED_WHYS) || own(COLLECT_ANSWERED_WHYS)
    || own(COLLECT_AUDIT_KINDS) || (COLLECT_HOLD_WHYS as readonly string[]).includes(v);
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
const COLLECT_FLIPPED = 'the live marker changed since this lane last read it, so every pair was cleared and this job '
  + 'composes nothing';
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
  io: Pick<FleetIO, 'lstatMeasured' | 'readdir' | 'statMeasured'>, registryDir: string,
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
  io: Pick<FleetIO, 'lstatMeasured' | 'readdir' | 'statMeasured'>, registryDir: string, leaf: string,
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
  let names: readonly unknown[] | null;
  try { names = await io.readdir(dir); } catch { names = null; }
  if (names !== null) return { kind: 'listed', names: names.filter((n): n is string => typeof n === 'string') };
  let st: MeasuredStat;
  try {
    st = await io.statMeasured(dir);
  } catch (err) {
    return { kind: 'unmeasured', why: `${leaf}/ did not list, and what stands there could not be asked (${said(err)})` };
  }
  if (!st.ok && st.reason === 'absent') return { kind: 'absent' };
  return { kind: 'unmeasured', why: `${leaf}/ did not list` };
}

// ── the switches ─────────────────────────────────────────────────────────────

/** The two switches as one listing read them (spec §5.10). `paused` and `live` mean what they always meant; a pause
 *  also says WHY, because its two causes are not one fact: `raised` is `reclaim-paused` standing in the listing, and
 *  `unlistable` is a listing that could not be taken, which cannot rule a raised one out. Both stop a job alike, and
 *  neither is ever shadow. */
export type CollectSwitches =
  | { readonly paused: false; readonly live: boolean }
  | { readonly paused: true; readonly why: 'raised' | 'unlistable'; readonly live: boolean };

/** The two switches, from ONE registry listing (spec §5.10). A raised `reclaim-paused` is `paused`, `raised`. A listing
 *  that could not be taken is `paused` too, `unlistable`, because it cannot rule a pause out, and that is never shadow.
 *  `live` is whether `collect-lane-live` stands, which no writer in the tree touches. It is meaningful only when `paused`
 *  is false, and the executor asks `paused` first. */
export async function collectSwitches(io: Pick<FleetIO, 'readdir'>, registryDir: string): Promise<CollectSwitches> {
  let names: readonly string[] | null;
  try { names = await io.readdir(registryDir); } catch { names = null; }
  if (names === null) return { paused: true, why: 'unlistable', live: false };
  const live = names.includes(COLLECT_LANE_LIVE_MARKER);
  return names.includes(RECLAIM_PAUSE_MARKER) ? { paused: true, why: 'raised', live } : { paused: false, live };
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
  if (!capSupported(deps.fleetState, COLLECT_CAP)) return { notAsked: 'capability' };
  const argv = CCD_ARGV.wsCollectAudit(id);
  if (!verbSupported(deps.fleetState, argv)) return { notAsked: 'verb' };
  const composed = deps.lane.generations(id);
  let res: CcdResult;
  try {
    res = await deps.runCcd(argv);
  } catch (err) {
    const arrived = deps.lane.clock();
    return { value: { kind: 'no-document', stderr: said(err) }, composed, arrived };
  }
  const arrived = deps.lane.clock();
  return { value: parseCollectAudit(id, res.ok, res.stdout, res.stderr), composed, arrived };
}

/** The lane's LEARNING audit (spec §5.10). It is read-only on the box: the audit journals a terminal refusal and
 *  nothing else. It sits behind the capability, as the act does. The caller runs it on the id's queue key. */
export async function learnCollect(
  deps: Pick<CollectTempRootDeps, 'runCcd' | 'fleetState' | 'lane'>, id: string,
): Promise<CollectLearnAnswer> {
  const audit = await collectAudit(deps, id);
  return 'notAsked' in audit ? { kind: 'not-asked', why: 'caps' } : { kind: 'answered', audit };
}

// ── the job ──────────────────────────────────────────────────────────────────

export async function collectTempRoot(deps: CollectTempRootDeps, job: CollectJob): Promise<CollectJobOutcome> {
  // 1 — BOTH capabilities, proven: `capSupported` refuses on no evidence, where `verbSupported` would permit. A box the
  // phone cannot pause never runs an automatic destructive lane. Then the id predicate AGAIN, on the job's own id,
  // before any argv. The population gated it; this is the second check, pinned on its own (spec §5.10).
  if (!capSupported(deps.fleetState, COLLECT_CAP) || !capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)) {
    deps.lane.cleared('caps');
    return { kind: 'not-asked', step: 1, why: 'caps',
      detail: `the fleet host does not advertise both ${COLLECT_CAP} and ${RECLAIM_PAUSE_CAP}` };
  }
  if (!isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused', detail: COLLECT_ID_REFUSED };
  // 2 — THE SWITCH, from one listing. A registry that did not list cannot rule a raised pause out, so it is a pause.
  const first = await collectSwitches(deps.io, deps.cfg.registryDir);
  if (first.paused) {
    deps.lane.cleared('paused');
    return { kind: 'not-asked', step: 2, why: 'paused', detail: COLLECT_PAUSED[first.why] };
  }
  // 3 — a person at the session. No ceiling, and no licence past it.
  if (deps.presence?.isVisible(job.id) === true) return { kind: 'not-asked', step: 3, why: 'presence', detail: COLLECT_SEEN };
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
  // The licence is R85's ONE L1 rule, `collectLicence`, against observation 1 read from the lane's memory. `observes`
  // is true: the stale check above has already asked whether this answer is an observation.
  const licence = collectLicence(deps.lane.observation(job.id), obs2, audit.arrived.mono, deps.observeIntervalMs, true);
  const hold = collectOpenRunHold(deps.coord, job.id, obs2);
  if (hold.kind === 'held') return { kind: 'held', step: 4, hold, audit: observed };
  if (licence.kind !== 'licensed') return answered(4, 'not-licensed', `${COLLECT_NOT_LICENSED} (${licence.kind})`);
  const obs1 = licence.first;
  // 5 — THE SWITCHES ONCE MORE, with the live marker: the job's LAST await.
  const last = await collectSwitches(deps.io, deps.cfg.registryDir);
  // ── 6 — SYNCHRONOUS from here to the argv: no await may stand between these reads and the act (spec §5.10). ──
  if (last.paused) {
    deps.lane.cleared('paused');
    return answered(5, 'paused', COLLECT_PAUSED[last.why]);
  }
  if (deps.lane.flipped(last.live)) return answered(5, 'marker-flip', COLLECT_FLIPPED);
  if (!collectLicenceStands(obs1, audit.composed, deps.lane.generations(job.id), deps.lane.observation(job.id))) {
    return answered(6, 'pair-cleared', COLLECT_PAIR_CLEARED);
  }
  if (deps.presence?.isVisible(job.id) === true) return answered(6, 'presence', COLLECT_SEEN);
  const holdAtAct = collectOpenRunHold(deps.coord, job.id, obs2);
  if (holdAtAct.kind === 'held') return { kind: 'held', step: 6, hold: holdAtAct, audit: observed };
  if (!capSupported(deps.fleetState, COLLECT_CAP)) {
    deps.lane.cleared('caps');
    return answered(6, 'caps', `the fleet host no longer advertises ${COLLECT_CAP}`);
  }
  if (!last.live) return { kind: 'would-collect', audit: observed };
  const now = deps.lane.clock();
  let act: CcdResult;
  try {
    act = await deps.runCcd(CCD_ARGV.wsCollect(obs2.token, job.id, sweepDec(deps.fleetState, COLLECT_ACTOR)));
  } catch (err) {
    const arrived = deps.lane.clock();
    return { kind: 'acted', audit: observed, composedMono: now.mono, result: { kind: 'no-document', stderr: said(err) }, arrived };
  }
  const arrived = deps.lane.clock();
  return { kind: 'acted', audit: observed, composedMono: now.mono,
    result: parseCollectResult(job.id, act.ok, act.stdout, act.stderr), arrived };
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
 *  It counts nothing. The lane clears the pair, and the id's next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS` flat (R87,
 *  H1). */
export function collectOpenRunHold(
  coord: CollectTempRootDeps['coord'], id: string, doc: Pick<CollectAuditCollectable, 'resume' | 'witnessRun' | 'witnessAt'>,
): CollectHoldRead {
  const held = (why: CollectHoldWhy, detail: string): CollectHeld => ({ kind: 'held', why, detail });
  try {
    if (doc.resume === null && doc.witnessRun === null) {
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
    const worker = coord.openRunsForSession(id);
    if (!worker.ok) return held('store-unreadable', `which open runs name ${id} as their session could not be read (${worker.detail})`);
    const claims = coord.openRunsClaimedBy(id);
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
