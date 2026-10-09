// THE DEAD-COORDINATOR LANE'S DECISIONS (workspace lifecycle spec 2026-09-24 §5.4, wave 4). L1: pure and clock-free
// (the clock is an argument), `fs`-free and fastify-free — `archivedExpiry.ts`'s shape, beside it and sharing nothing
// with it. It imports L0 alone. `watch.ts`'s `sweepDeadCoordinators` (L4) GATHERS the evidence — the claimants of
// non-terminal runs, the reclaim door's own verdict for each (`measureClaimant`, its dead arm now carrying `cause`), the
// lifecycle mirror's rows, the durable first-dead anchors — and APPLIES these verdicts; `coord/endDeadCoordinator.ts`
// (the one executor) ends a programme on the coordination serialiser. Nothing in this file reads a file, a row or a
// clock.
//
// THE RULING (L4): a coordinator that CRASHED and stays dead an hour, with no successor, has its open runs closed
// `failed`, and its workers are then cleaned up. Only a crash counts: one the operator stopped, archived, reaped or
// forgot is never "dead" here. EVERY UNCERTAIN ANSWER IS "NOT THIS PASS": the act ends a programme for good.
import {
  compareGenerations,
  type DeadCoordinatorAttention, type LifecycleAct, type LifecycleDec, type LifecycleMeas, type LifecycleOutcome,
  type SessionLifecycle,
} from '../../shared/api.js';

/** THE LANE'S LIVE SWITCH (the coordinator's safety ruling (B), the expiry lane's and the scope sweep's precedent).
 *  Until `$REG/<this>` exists the lane MEASURES, keeps its durable first-dead anchors, trips its breaker and RECORDS
 *  "would end programme <slug> (<n> runs)" — a feed row and an attention entry — and never reaches `closeRun`'s abandon
 *  arm or the child-reclaim port. It has NO WRITER in the tree: the operator touches it by hand in the registry the
 *  server reads, and `single-definition.test.ts` pins that. Spelled here and nowhere else in `server/src`. */
export const DEAD_COORDINATOR_LANE_LIVE_MARKER = 'dead-coordinator-lane-live';

/** The hour (L4). The anchor's age is compared with it; it is the server's own rule, not a box's. */
export const DEAD_COORDINATOR_AFTER_MS = 60 * 60_000;

/** The circuit breaker's window (spec §5.4): two or more claimants FIRST measured crashed within this of each other
 *  are a box fault until the operator shows otherwise. */
export const DEAD_COORDINATOR_BREAKER_WINDOW_MS = 10 * 60_000;

/** How long the lane may go without measuring a crashed claimant before its durable episode is no longer one: a
 *  server down for longer, or an OLDER build running against this database after a rollback (it never writes the
 *  anchor table), measured nothing meanwhile — the claimant may have come back and crashed again. The episode then
 *  restarts at the pass that measures it again (the departure `dead-anchor-restarts-after-an-unobserved-gap`). Ten
 *  sweep intervals: a restart, a deploy or a slow pass stay inside it. */
export const DEAD_COORDINATOR_GAP_MS = 10 * 60_000;

/** The failure backoff's ceiling for a claimant whose runs the abandon arm could not move: after the k-th consecutive
 *  attempt the lane waits `min(this, passMs × 2^k)` (spec §5.4: "not retried beyond the lane's backoff"). */
export const DEAD_COORDINATOR_BACKOFF_CEILING_MS = 60 * 60_000;

// ── the verdict, widened ─────────────────────────────────────────────────────

/** WHICH death the reclaim door's ladder measured (spec §5.4: "The verdict is widened, not re-derived"). `absent` is
 *  its rung 1, a proven absence; the other three are L0's dead lifecycles. `ClaimantVerdict`'s dead arm
 *  (`coord/reclaim.ts`) carries one, set in that ladder and nowhere else; `coord-reclaim.test.ts` holds this list equal
 *  to `['absent', ...DEAD_LIFECYCLES]`, so a fourth dead word is a red, never a silent cast. */
export type ClaimantDeadCause = 'absent' | Extract<SessionLifecycle, 'stopped' | 'orphan' | 'never-started'>;
export const CLAIMANT_DEAD_CAUSES: readonly ClaimantDeadCause[] = ['absent', 'stopped', 'orphan', 'never-started'];

/** `ClaimantVerdict` as this file reads it — structurally, so L1 imports L0 alone. */
export type ClaimantReading =
  | { readonly state: 'dead'; readonly cause: ClaimantDeadCause }
  | { readonly state: 'alive'; readonly why: string }
  | { readonly state: 'unmeasurable'; readonly why: string };

// ── the journal clause ───────────────────────────────────────────────────────

/** The acts that put a session down ON PURPOSE (spec §5.4): ccd's `stop`, `archive`, `reap`, `destroy`, `purge` and
 *  `forget` (`_LC_ACTS`), CCR-15's `reclaim` and stage 3's `expire`. An `unsupervise` counts when it carries a
 *  DECLARED surface — `_ws_unsupervise`'s `dec.surface`, which reads `none` when ccd acted on its own account. */
export const DEAD_COORDINATOR_DELIBERATE_ACTS: readonly LifecycleAct[] =
  ['stop', 'archive', 'reap', 'destroy', 'purge', 'forget', 'reclaim', 'expire'];

/** Every act the clause reads — the deliberate ones, `unsupervise`, `spawn` (the start) and the we-do-not-know
 *  `unknown` — for the store's ONE read (`CoordStore.deadCoordinatorJournalRows`), so its SQL and this file's reading
 *  can never disagree about which rows matter. */
export const DEAD_COORDINATOR_JOURNAL_ACTS: readonly LifecycleAct[] =
  [...DEAD_COORDINATOR_DELIBERATE_ACTS, 'unsupervise', 'spawn', 'unknown'];

/** One mirrored row as the clause reads it (`MirroredLifecycleEvent`; the clause re-sorts by generation, then the mirror's own id). `raw` is
 *  the line verbatim, the mirror's own column; `gen` is the generation it was read from (19 digits, ccd's clock), which
 *  places a recorded gap before or after it. */
export interface DeadCoordinatorJournalRow {
  readonly act: LifecycleAct;
  readonly outcome: LifecycleOutcome;
  readonly at: number | null;
  readonly gen: string;
  readonly dec: Pick<LifecycleDec, 'surface'> | null;
  readonly meas: Pick<LifecycleMeas, 'rc'> | null;
  readonly raw: string;
}

/** What the mirror says about one claimant since its LAST SUCCESSFUL START. FOUR answers, never folded:
 *  `quiet` (it has history, none of it deliberate since that start — `started` says whether a successful spawn is in
 *  it at all; `failedSpawn` says the horizon held a `spawn` row and none of them succeeded — started, and never ran), `deliberate` (the newest such act), `no-history` (the mirror holds no row for it AT ALL) and `unreadable`
 *  (the read failed, or the journal cannot be trusted to hold every act since that start — never "no history"). */
export type DeadCoordinatorJournal =
  | { readonly kind: 'quiet'; readonly started: boolean; readonly failedSpawn?: true }
  | { readonly kind: 'deliberate'; readonly act: LifecycleAct; readonly at: number | null }
  | { readonly kind: 'no-history' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** HOW FAR THE JOURNAL CAN BE TRUSTED this pass — the facts the clause reads BESIDE the rows (the departure
 *  `journal-loss-reads-as-unmeasured`). The mirror is best-effort and never gates an act by itself (`mirror.ts`), so a
 *  clause that reads "no deliberate act" off it must first ask whether a deliberate act could be missing from it:
 *   - `untrusted`: the mirror's own health is not `ok` — `unavailable` (the fleet's ccd does not journal), `unknown` (not
 *     swept yet) or `stale` (no sweep for three intervals) — or its gaps could not be read;
 *   - `gapGens`: the generations the mirror recorded LOST bytes in (`lifecycle_gaps`). A generation is immutably named
 *     and appended in time order, so a gap in a generation OLDER than the claimant's last start lost only lines from
 *     before that start; any other gap — the same generation, a newer one, or a name that cannot be placed — may have
 *     lost the act;
 *   - `lastWriteErrorAt`: when ccd last counted a journal line it could NOT append (`$REG/.lifecycle/errors`, rewritten
 *     on every count, so its mtime is that instant — the fleet box's clock, as a row's `at` is); `null` when it has
 *     counted none, `'unknown'` when it has and the instant could not be read. */
export interface DeadCoordinatorJournalTrust {
  readonly untrusted: string | null;
  readonly gapGens: readonly string[];
  readonly lastWriteErrorAt: number | null | 'unknown';
}

/** A journal with nothing against it. */
export const DEAD_COORDINATOR_JOURNAL_TRUSTED: DeadCoordinatorJournalTrust = { untrusted: null, gapGens: [], lastWriteErrorAt: null };

/** How close to the last start a counted write failure still counts against it — the two instants are one box's clock,
 *  so this is a margin for the file's mtime granularity, not for skew. */
export const DEAD_COORDINATOR_JOURNAL_MARGIN_MS = 60_000;

const GEN_DIGITS = /^[0-9]{1,25}$/;

/** Could a deliberate act since `start` (the newest successful spawn, or `null`: none in the horizon) be MISSING from
 *  the mirror? `null` when not; otherwise why. */
function journalLossSince(start: DeadCoordinatorJournalRow | null, t: DeadCoordinatorJournalTrust): string | null {
  for (const g of t.gapGens) {
    const before = start !== null && GEN_DIGITS.test(g) && GEN_DIGITS.test(start.gen) && compareGenerations(g, start.gen) < 0;
    if (!before) {
      return `the lifecycle mirror recorded lost journal bytes in generation ${g}`
        + (start === null ? ', and no successful spawn bounds what they held' : ', at or after its last successful spawn');
    }
  }
  const e = t.lastWriteErrorAt;
  if (e === 'unknown') return 'ccd counted journal lines it could not write, and when cannot be read';
  if (e !== null && (start === null || start.at === null || e >= start.at - DEAD_COORDINATOR_JOURNAL_MARGIN_MS)) {
    return `ccd could not write a journal line at ${new Date(e).toISOString()}`
      + (start === null ? ', and no successful spawn bounds it' : ', after its last successful spawn');
  }
  return null;
}

/** A row that puts the session down on purpose. A REFUSED act did nothing. An act this build cannot name (`unknown`,
 *  a newer ccd's) and an `unsupervise` whose surface cannot be read count — doubt never reads as a crash. */
const isDeliberate = (r: DeadCoordinatorJournalRow): boolean => r.outcome !== 'refused'
  && (DEAD_COORDINATOR_DELIBERATE_ACTS.includes(r.act) || r.act === 'unknown'
    || (r.act === 'unsupervise' && (r.dec === null || r.dec.surface !== 'none')));

/** Did this `spawn` line record a SUCCESSFUL spawn — `rc` 0? MEASURED: ccd's encoder (`_lc_json`) writes every meas
 *  value as a STRING, and the mirror's parser keeps `meas.rc` only when it is a JSON number (`journalparse.test.ts`
 *  pins that degrade), so the typed field is null on every line ccd has written. The line's own bytes are read
 *  instead, strictly: exactly `"0"` (or a typed 0) is a success, and anything else — a line that does not parse, a
 *  missing or other value — proves no start (the departure `the-last-start-is-read-off-the-spawn-line`). */
function spawnSucceeded(r: DeadCoordinatorJournalRow): boolean {
  if (r.meas?.rc === 0) return true;
  let v: unknown;
  try { v = JSON.parse(r.raw); } catch { return false; }
  const meas = typeof v === 'object' && v !== null ? (v as { meas?: unknown }).meas : undefined;
  return typeof meas === 'object' && meas !== null && (meas as { rc?: unknown }).rc === '0';
}

/** THE ONE READER of the journal clause. "Since its last successful start" is since the newest `spawn` row that
 *  recorded `rc` 0: `start` and `ensure` are journaled at the TOP of their verbs, before any pane exists, so a revive
 *  that FAILED journals them too — the case the clause exists for (a person stopped it, a later revive failed and
 *  cleared the stop stamp; the row now reads `orphan`). Only `_spawn_settle`'s `spawn` line carries the outcome. With
 *  no such row in the mirror's horizon, every row it holds counts. `rows` is the mirror's answer for the clause's acts, in
 *  the mirror's id order (the clause orders them by generation itself); `hasHistory` is whether it holds ANY row for the id, of any act — the store reads the two together;
 *  `trust` is what the lane measured about the journal itself, and a journal that may be missing an act since that
 *  start is `unreadable`, never quiet. */
export function deadCoordinatorJournal(
  mirrorRows: readonly DeadCoordinatorJournalRow[], hasHistory: boolean, trust: DeadCoordinatorJournalTrust,
): DeadCoordinatorJournal {
  if (trust.untrusted !== null) return { kind: 'unreadable', detail: trust.untrusted };
  // JOURNAL ORDER, not ingest order. The mirror's id is the order rows were COMMITTED, and a pass whose read of an older
  // generation failed commits the newer one first (`mirror.ts` drains each present generation in turn and carries on
  // past a failed read), so by id alone a newer `stop` can precede an older successful spawn and read as a crash. Rows
  // sort by generation (`compareGenerations`, L0's one reader of that order); within one generation the id order IS the
  // line order, and the sort is stable. A generation name this reader cannot place is not guessed at.
  const unplaced = mirrorRows.find((r) => !GEN_DIGITS.test(r.gen));
  if (unplaced !== undefined) {
    return { kind: 'unreadable', detail: `a journal row names a generation that cannot be placed ("${unplaced.gen}")` };
  }
  const rows = [...mirrorRows].sort((a, b) => compareGenerations(a.gen, b.gen));
  let from = 0;
  let start: DeadCoordinatorJournalRow | null = null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i]!;
    if (r.act === 'spawn' && r.outcome === 'done' && spawnSucceeded(r)) { from = i + 1; start = r; break; }
  }
  const lost = journalLossSince(start, trust);
  if (lost !== null) return { kind: 'unreadable', detail: lost };
  if (rows.length === 0) return hasHistory ? { kind: 'quiet', started: false } : { kind: 'no-history' };
  for (let i = rows.length - 1; i >= from; i -= 1) {
    const r = rows[i]!;
    if (isDeliberate(r)) return { kind: 'deliberate', act: r.act, at: r.at };
  }
  // No successful spawn, but a spawn row that did not succeed: ccd marks a session started BEFORE it spawns, so a heir
  // whose first start failed reads `orphan` though it never ran. A horizon with no spawn row at all says nothing.
  if (start === null && rows.some((r) => r.act === 'spawn')) return { kind: 'quiet', started: false, failedSpawn: true };
  return { kind: 'quiet', started: start !== null };
}

// ── a crash, and only a crash ────────────────────────────────────────────────

/** One claimant's reading this pass. `crashed` is the only answer the lane counts toward the hour; every other one
 *  deletes the durable anchor. `unmeasured` is LISTED (an absent row the mirror knows nothing about, or a mirror that
 *  could not be read) and never acted on. */
export type DeadCoordinatorCrash =
  | { readonly kind: 'crashed'; readonly cause: Exclude<ClaimantDeadCause, 'stopped'> }
  | { readonly kind: 'alive'; readonly why: string }
  | { readonly kind: 'unmeasurable'; readonly why: string }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'deliberate'; readonly act: LifecycleAct }
  | { readonly kind: 'unmeasured'; readonly why: string };

/**
 * IS THIS CLAIMANT CRASHED (spec §5.4, "A crash, and only a crash")? Its verdict is `dead` with cause `orphan`,
 * `never-started` or `absent`, AND the journal shows no deliberate act since its last successful start. In order:
 *  - `alive` (a live pane, or a pane gone while the lifecycle reads `restarting` — a supervisor bringing it back) and
 *    `unmeasurable` are never dead;
 *  - `stopped` is never a crash (L4);
 *  - a journal that could not be read, or cannot be trusted to hold every act since the last start, is unmeasured,
 *    never "no history";
 *  - a deliberate act since the last start is never a crash, whatever the row reads now;
 *  - an ABSENT row with no history at all is unmeasured: listed, never acted on;
 *  - a NEVER-STARTED row with no successful spawn in the journal never ran, so it cannot have crashed — an heir the
 *    operator reclaimed a programme onto and has not started yet reads exactly so: unmeasured, listed, never acted on
 *    (the departure `never-started-without-a-spawn-is-unmeasured`); so is ANY dead cause whose journal holds a spawn that
 *    failed and none that succeeded (`failedSpawn`) — started and never ran. No spawn row at all stays a crash.
 */
export function deadCoordinatorCrash(m: ClaimantReading, j: DeadCoordinatorJournal): DeadCoordinatorCrash {
  if (m.state === 'alive') return { kind: 'alive', why: m.why };
  if (m.state === 'unmeasurable') return { kind: 'unmeasurable', why: m.why };
  if (m.cause === 'stopped') return { kind: 'stopped' };
  if (j.kind === 'unreadable') return { kind: 'unmeasured', why: `the lifecycle journal cannot be trusted (${j.detail})` };
  if (j.kind === 'deliberate') return { kind: 'deliberate', act: j.act };
  if (j.kind === 'no-history' && m.cause === 'absent') {
    return { kind: 'unmeasured', why: 'its registry row is gone and the lifecycle mirror holds no history for it' };
  }
  if (m.cause === 'never-started' && !(j.kind === 'quiet' && j.started)) {
    return { kind: 'unmeasured', why: 'it never started — the journal holds no successful spawn for it' };
  }
  if (j.kind === 'quiet' && !j.started && j.failedSpawn === true) {
    return { kind: 'unmeasured', why: 'it was started and never ran — the journal holds only failed spawns' };
  }
  return { kind: 'crashed', cause: m.cause };
}

// ── the hour, made durable ───────────────────────────────────────────────────

/** The `coord.db` row (`dead_claimants`): the first pass of this episode that measured the claimant crashed, and the
 *  latest. Epoch ms, the server's clock. */
export interface DeadAnchor { readonly firstDeadAt: number; readonly lastDeadAt: number }

/** The row after a pass that measured the claimant CRASHED. The first such pass writes `firstDeadAt`; a later one moves
 *  `lastDeadAt` alone — unless the previous crashed pass is older than `DEAD_COORDINATOR_GAP_MS` (nothing measured it
 *  meanwhile) or lies in the future (the clock stepped back), when the episode restarts now. */
export function deadAnchorNext(prev: DeadAnchor | null, nowMs: number): DeadAnchor {
  if (prev === null || nowMs < prev.lastDeadAt || nowMs - prev.lastDeadAt > DEAD_COORDINATOR_GAP_MS) {
    return { firstDeadAt: nowMs, lastDeadAt: nowMs };
  }
  return { firstDeadAt: prev.firstDeadAt, lastDeadAt: nowMs };
}

/** SINCE WHEN the claimant has been dead, for the hour: `max(firstDeadAt, .supervised's stamp)`. The stamp may only
 *  RAISE the anchor, never lower it: it freezes whenever a session runs unsupervised (a unit crash-looped to FAILED, a
 *  darwin bootout), so a pane that died later would read `orphan` with a days-old stamp. An absent, unparseable or
 *  future stamp is ignored. `supervisedAtS` is the registry's epoch SECONDS. */
export function deadCoordinatorSince(anchor: DeadAnchor, supervisedAtS: number | null, nowMs: number): number {
  const stamp = supervisedAtS !== null && Number.isSafeInteger(supervisedAtS) && supervisedAtS > 0
    && supervisedAtS * 1000 <= nowMs ? supervisedAtS * 1000 : null;
  return stamp === null ? anchor.firstDeadAt : Math.max(anchor.firstDeadAt, stamp);
}

/** DUE: dead an hour since the anchor, AND the two latest passes both measured it crashed (`crashedPasses` is the
 *  lane's in-memory run of consecutive crashed passes — a restart can only delay the act, never cause it). */
export const deadCoordinatorDue = (since: number, crashedPasses: number, nowMs: number): boolean =>
  crashedPasses >= 2 && nowMs - since >= DEAD_COORDINATOR_AFTER_MS;

// ── the circuit breaker ──────────────────────────────────────────────────────

/** A box fault (the user manager lost across a reboot, a tmux server death, a bad ccd) makes every coordinator read
 *  dead at once, and that is evidence of a fleet fault, not of N crashes. TRIPPED, the lane acts on NONE — not on the
 *  clustered claimants and not on any other (the departure `breaker-holds-the-whole-lane`) — and raises ONE attention
 *  item naming them. It clears when they fall back under the threshold: revived, their programmes reclaimed or
 *  abandoned by the operator through the doors that already exist (the departure
 *  `breaker-clears-through-the-existing-doors`).
 *
 *  IT REMEMBERS (the departure `breaker-remembers-its-cluster`). A cluster member that reads unmeasurable for one pass
 *  loses its durable anchor (ruling E) and is re-anchored later, so a breaker recomputed from the anchors alone would
 *  let one transient doubt dissolve the cluster for good. `members` carries each held claimant's ORIGINAL first-dead
 *  instant; the lane hands them back on the next pass and releases a member only on an answer that is evidence — alive,
 *  stopped, a deliberate act — or when it leaves the population. */
export type DeadCoordinatorBreaker =
  | { readonly tripped: false }
  | { readonly tripped: true; readonly why: 'clustered' | 'unmeasurable'; readonly claimants: readonly string[];
      /** Since when it stands: the earliest held `firstDeadAt`, or this pass for an unmeasurable one. */
      readonly since: number;
      /** The clustered members and their first-dead instants — the breaker's memory, handed back next pass. */
      readonly members: readonly DeadCoordinatorBreakerMember[];
      /** For `unmeasurable`: what the pass could not measure. */
      readonly detail?: string };

export interface DeadCoordinatorBreakerMember { readonly id: string; readonly firstDeadAt: number }

/** `crashed`: this pass's crashed claimants with their durable `firstDeadAt`. `held`: the members the last trip held
 *  that no answer has released since, with their remembered instants (they win over a re-anchored one). `unmeasurable`:
 *  the ids this pass could not measure, of `measured` asked. `fleetDoubt`: a fleet-wide fact this pass measured — tmux
 *  did not answer — or `null`. A fleet-wide doubt trips it whatever the count: one claimant whose row is gone still
 *  reads crashed while tmux is down for every other, and that pass is exactly the box fault the breaker exists for. So
 *  does a pass that could measure none of two or more claimants. */
export function deadCoordinatorBreaker(
  crashed: readonly DeadCoordinatorBreakerMember[], held: readonly DeadCoordinatorBreakerMember[],
  unmeasurable: readonly string[], measured: number, fleetDoubt: string | null, nowMs: number,
): DeadCoordinatorBreaker {
  const firstDead = new Map(crashed.map((c) => [c.id, c.firstDeadAt]));
  for (const h of held) firstDead.set(h.id, h.firstDeadAt);
  const byTime = [...firstDead].map(([id, at]) => ({ id, firstDeadAt: at }))
    .sort((a, b) => a.firstDeadAt - b.firstDeadAt || (a.id < b.id ? -1 : 1));
  const clustered = new Set<string>();
  for (let i = 1; i < byTime.length; i += 1) {
    if (byTime[i]!.firstDeadAt - byTime[i - 1]!.firstDeadAt <= DEAD_COORDINATOR_BREAKER_WINDOW_MS) {
      clustered.add(byTime[i - 1]!.id); clustered.add(byTime[i]!.id);
    }
  }
  const members = byTime.filter((c) => clustered.has(c.id));
  const allUnmeasurable = measured >= 2 && unmeasurable.length === measured;
  if (fleetDoubt !== null || allUnmeasurable) {
    const named = [...new Set([...unmeasurable, ...crashed.map((c) => c.id), ...members.map((c) => c.id)])].sort();
    if (named.length > 0) {
      return { tripped: true, why: 'unmeasurable', claimants: named, since: nowMs, members,
        detail: fleetDoubt ?? 'not one of them could be measured' };
    }
  }
  if (members.length === 0) return { tripped: false };
  return { tripped: true, why: 'clustered', claimants: members.map((c) => c.id).sort(),
    since: Math.min(...members.map((c) => c.firstDeadAt)), members };
}

/** The breaker's key, for "write its feed row only when it CHANGES". */
export const deadCoordinatorBreakerKey = (b: DeadCoordinatorBreaker): string | null =>
  b.tripped ? `${b.why}:${b.claimants.join(',')}` : null;

// ── the act's answer, and the lane's memory ──────────────────────────────────

/** One programme the act ended, or would end: its slug and the runs it closes. */
export interface DeadCoordinatorProgramme { readonly slug: string; readonly runIds: readonly number[] }

/** Why the act stopped before it ended every run — typed, so the lane never re-splits prose:
 *   - `remeasured`: the claimant was re-measured and the answer was not a crash — alive, stopped, a deliberate act since
 *     its last start, unmeasurable, or a journal it cannot trust. Ruling E's "any other answer deletes the anchor"
 *     applies to this answer as to a pass's: the lane resets its run of crashed passes AND deletes the durable anchor, so
 *     a later crash needs a fresh hour and two fresh passes;
 *   - `switch`: the operator raised `reclaim-paused` or disarmed the lane during the act, or the registry would not list
 *     so neither can be ruled out. Nothing about the claimant was learned: the run of passes resets (a pause forgets a
 *     sighting) and the anchor stands;
 *   - `successor`: a run's claimant is no longer the crashed id (`claimant-changed`). Nothing about the crashed
 *     claimant is learned, so nothing resets. */
export type DeadCoordinatorStop =
  | { readonly kind: 'remeasured'; readonly why: string }
  | { readonly kind: 'switch'; readonly why: string }
  | { readonly kind: 'successor'; readonly why: string };

/** The one executor's answer (`coord/endDeadCoordinator.ts`). `ended` lists what closed (`programmes`), what was left
 *  open (`open`: the runs the abandon arm could not move, the run the act stopped at and those after it), what the arm
 *  could not move (`stuck`), and `stoppedBy` says why the act stopped early: "an alive answer at any point ends the
 *  whole act". */
export type DeadCoordinatorActOutcome =
  | { readonly kind: 'ended'; readonly programmes: readonly DeadCoordinatorProgramme[];
      readonly open: readonly DeadCoordinatorProgramme[];
      readonly stuck: readonly { readonly runId: number; readonly why: string }[];
      readonly stoppedBy: DeadCoordinatorStop | null;
      /** The runs whose WORKER the act released and whose run it then left open — the stop came after the fleet act, so
       *  the worker is unheld until its coordinator re-holds it. Absent when the act released none: a fact the act did,
       *  recorded whether or not it closed anything. */
      readonly released?: readonly DeadCoordinatorProgramme[];
      /** Set only on the outcome a THROWN act hands back (`DeadCoordinatorActThrew`): what it had closed is real, and
       *  this is what failed. */
      readonly failed?: string }
  | { readonly kind: 'would-end'; readonly programmes: readonly DeadCoordinatorProgramme[] }
  | { readonly kind: 'paused-at-server'; readonly detail: string }
  | { readonly kind: 'store-unreadable'; readonly detail: string };

/** What an act DID before it stopped or failed, for the attention list: the runs it closed failed (by programme), the
 *  workers it released (their runs stay open), and why it stopped (`null`: it threw, and which run moved is unknown). */
export interface DeadCoordinatorProgress {
  readonly closed: readonly DeadCoordinatorProgramme[];
  readonly released: readonly DeadCoordinatorProgramme[];
  readonly stop: string | null;
}

/** What the attention list says about one claimant, before it is worded. */
export type DeadCoordinatorReport =
  | { readonly kind: 'would-end'; readonly at: number; readonly cause: Exclude<ClaimantDeadCause, 'stopped'>;
      readonly since: number; readonly programmes: readonly DeadCoordinatorProgramme[] }
  | { readonly kind: 'unmeasured'; readonly at: number; readonly why: string }
  | { readonly kind: 'stuck'; readonly at: number; readonly runs: readonly { readonly runId: number; readonly why: string }[];
      /** The act itself failed (it threw) — nothing is known about which runs moved. */
      readonly error?: string;
      /** What the act had done when it stopped or failed — present only when it did something (closed a run or released
       *  a worker). With no `runs` and no `error` this IS the report: an act a revive cut short. */
      readonly after?: DeadCoordinatorProgress };

/** The lane's memory of one claimant — IN MEMORY ONLY (the anchor is the durable half): a restart can only delay. */
export interface DeadCoordinatorEntry {
  /** Consecutive passes that measured it crashed. */
  readonly crashedPasses: number;
  /** The earliest the act may be asked again (ms), after runs the abandon arm could not move. */
  readonly nextAskAt: number;
  readonly attempts: number;
  /** The last recorded outcome's key, so a feed row is written when it CHANGES. */
  readonly lastOutcome: string | null;
  readonly report: DeadCoordinatorReport | null;
}

export const deadCoordinatorEntry = (): DeadCoordinatorEntry =>
  ({ crashedPasses: 0, nextAskAt: 0, attempts: 0, lastOutcome: null, report: null });

/** One pass's reading, folded into memory: a crashed pass extends the run (and ends an `unmeasured` report — the lane
 *  can tell now); anything else ends it, and the report goes with it — save `unmeasured`, which IS a report, and
 *  `stuck`, which stands until the runs move. */
export function deadCoordinatorSighted(e: DeadCoordinatorEntry, c: DeadCoordinatorCrash, nowMs: number): DeadCoordinatorEntry {
  if (c.kind === 'crashed') {
    return { ...e, crashedPasses: e.crashedPasses + 1, report: e.report?.kind === 'unmeasured' ? null : e.report };
  }
  const report: DeadCoordinatorReport | null = c.kind === 'unmeasured'
    ? { kind: 'unmeasured', at: e.report?.kind === 'unmeasured' ? e.report.at : nowMs, why: c.why }
    : e.report?.kind === 'stuck' ? e.report : null;
  return { ...e, crashedPasses: 0, report };
}

/** The backoff: `min(DEAD_COORDINATOR_BACKOFF_CEILING_MS, passMs × 2^k)`. */
export const deadCoordinatorBackoffMs = (attempts: number, passMs: number): number =>
  Math.min(DEAD_COORDINATOR_BACKOFF_CEILING_MS, passMs * 2 ** Math.min(attempts, 20));

/** The outcome's key, for "write a feed row only when it changes". */
export const deadCoordinatorOutcomeKey = (o: DeadCoordinatorActOutcome): string =>
  o.kind === 'would-end' ? `would-end:${o.programmes.map((p) => `${p.slug}=${p.runIds.join(',')}`).join(';')}` : o.kind;

/** The entry after the act (or its shadow record). A shadow `would-end` stands as the report; an `ended` with nothing
 *  stuck finishes the claimant (its runs are closed, so it leaves the population); runs the abandon arm could not move
 *  are reported and asked again only after the backoff. An act that STOPPED on a re-measure or a switch forgets the run
 *  of crashed passes, so it is never due again on passes counted before it; a switch also waits one pass. */
export function deadCoordinatorNextEntry(
  e: DeadCoordinatorEntry, o: DeadCoordinatorActOutcome, cause: Exclude<ClaimantDeadCause, 'stopped'>, since: number,
  nowMs: number, passMs: number,
): DeadCoordinatorEntry {
  const base = { ...e, lastOutcome: deadCoordinatorOutcomeKey(o) };
  switch (o.kind) {
    case 'would-end':
      return { ...base, report: { kind: 'would-end', at: e.report?.kind === 'would-end' ? e.report.at : nowMs, cause, since,
        programmes: o.programmes } };
    case 'ended': {
      const stop = o.stoppedBy?.kind;
      const crashedPasses = stop === 'remeasured' || stop === 'switch' ? 0 : e.crashedPasses;
      const at = e.report?.kind === 'stuck' ? e.report.at : nowMs;
      // An act that STOPPED having closed a run or released a worker is news the operator reads (the stop's feed row
      // is only for a programme with a closed run): what it did, and that the programme is NOT ended.
      const released = o.released ?? [];
      const after: DeadCoordinatorProgress | undefined = o.stoppedBy !== null && (o.programmes.length > 0 || released.length > 0)
        ? { closed: o.programmes, released, stop: o.stoppedBy.why } : undefined;
      if (o.stuck.length === 0) {
        return { ...base, crashedPasses, attempts: 0, nextAskAt: stop === 'switch' ? nowMs + passMs : 0,
          report: after === undefined ? null : { kind: 'stuck', at, runs: [], after } };
      }
      const attempts = e.attempts + 1;
      return { ...base, crashedPasses, attempts, nextAskAt: nowMs + deadCoordinatorBackoffMs(attempts, passMs),
        report: { kind: 'stuck', at, runs: o.stuck, ...(after === undefined ? {} : { after }) } };
    }
    case 'paused-at-server': case 'store-unreadable':
      // Nothing was measured or moved: the sighting is forgotten, so a lowered switch needs two FRESH passes.
      return { ...base, crashedPasses: 0, nextAskAt: nowMs + passMs };
  }
}

/** The entry after an act that THREW (a store commit that failed after the fleet act, an agent that dropped): what
 *  moved is unknown, so it is reported and asked again only after the backoff — never every pass, re-composing the
 *  fleet act each time (spec §5.4: "not retried beyond the lane's backoff"). */
export function deadCoordinatorThrew(
  e: DeadCoordinatorEntry, error: string, nowMs: number, passMs: number, after?: DeadCoordinatorProgress,
): DeadCoordinatorEntry {
  const attempts = e.attempts + 1;
  return { ...e, attempts, nextAskAt: nowMs + deadCoordinatorBackoffMs(attempts, passMs),
    report: { kind: 'stuck', at: e.report?.kind === 'stuck' ? e.report.at : nowMs, runs: [], error,
      ...(after === undefined ? {} : { after }) } };
}

// ── the words ────────────────────────────────────────────────────────────────

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const runs = (n: number): string => `${n} ${n === 1 ? 'run' : 'runs'}`;
const programmesText = (ps: readonly DeadCoordinatorProgramme[]): string =>
  ps.map((p) => `programme ${p.slug} (${runs(p.runIds.length)})`).join(', ');
const CAUSE_WORD: Readonly<Record<Exclude<ClaimantDeadCause, 'stopped'>, string>> = {
  orphan: 'its pane is gone and nothing is bringing it back',
  'never-started': 'its pane is gone and its registry never recorded the start the journal did',
  absent: 'its registry row is gone',
};

/** The feed row's words for an act (or its shadow), one row per programme (spec §5.4), each with the instant the hour
 *  counted from (`since`) — spec §9's stage-4 row reports every ended programme "with its first-dead time". A programme
 *  the act closed only PART of is never announced as ended: §5.4's row is for an ENDED programme, and one the act closed only part of says it was NOT. */
export function deadCoordinatorFeedRows(
  claimantId: string, o: DeadCoordinatorActOutcome, since: number,
): { readonly title: string; readonly body: string }[] {
  const dead = `coordinator ${claimantId} crashed (dead since ${iso(since)})`;
  switch (o.kind) {
    case 'would-end':
      return o.programmes.map((p) => ({ title: 'dead coordinator: programme would be ended',
        body: `would end programme ${p.slug} (${runs(p.runIds.length)}): ${dead} and stayed dead an hour, and the lane `
          + 'is not armed (shadow), so nothing was ended.' }));
    case 'ended': {
      // A programme with a closed run, then one the act only RELEASED a worker of: its record is the same fact — the
      // programme is NOT ended, and its worker is unheld.
      const released = o.released ?? [];
      const slugs = [...o.programmes, ...released.filter((r) => !o.programmes.some((p) => p.slug === r.slug))];
      return slugs.flatMap((s) => {
        const closed = o.programmes.find((x) => x.slug === s.slug)?.runIds.length ?? 0;
        const left = o.open.find((x) => x.slug === s.slug)?.runIds.length ?? 0;
        if (closed > 0 && left === 0) {
          return [{ title: 'dead coordinator: programme ended',
            body: `${dead} and stayed dead an hour; programme ${s.slug} ended, ${runs(closed)} closed failed.` }];
        }
        const rel = released.find((x) => x.slug === s.slug)?.runIds ?? [];
        const base = o.failed !== undefined ? `the act then failed: ${o.failed}`
          : o.stoppedBy !== null ? `the act stopped: ${o.stoppedBy.why}` : 'the abandon arm could not move the rest';
        const why = rel.length === 0 ? base
          : `${base}; ${rel.map((id) => `run ${id}'s worker`).join(', ')} ${rel.length === 1 ? 'was' : 'were'} released and `
            + `${rel.length === 1 ? 'is' : 'are'} unheld until its coordinator re-holds it`;
        return [{ title: 'dead coordinator: programme partly ended',
          body: `${dead} and stayed dead an hour; programme ${s.slug} was NOT ended: ${closed} of `
            + `${runs(closed + left)} closed failed and ${left} stay open — ${why}.` }];
      });
    }
    case 'paused-at-server': case 'store-unreadable':
      return [];
  }
}

/** One report's sentence. */
export function deadCoordinatorReportSentence(claimantId: string, r: DeadCoordinatorReport): string {
  switch (r.kind) {
    case 'would-end':
      return `coordinator ${claimantId} crashed (${CAUSE_WORD[r.cause]}) and has stayed dead since ${iso(r.since)}. `
        + `The lane is not armed (shadow), so nothing was ended; armed, it would end ${programmesText(r.programmes)}. `
        + 'Revive the coordinator or reclaim its programme to keep it.';
    case 'unmeasured':
      return `coordinator ${claimantId} cannot be told crashed from put down on purpose — ${r.why} — so the lane lists `
        + 'it and never acts on it. Reclaim or abandon its programme by hand.';
    case 'stuck': {
      const done = r.after === undefined ? '' : ` ${progressSentence(r.after)}`;
      if (r.error !== undefined) {
        return `the lane's act on coordinator ${claimantId} failed (${r.error}); it is asked again only after a backoff — `
          + `check its runs on /runs and abandon them by hand if it keeps failing.${done}`;
      }
      if (r.runs.length === 0 && r.after !== undefined) {
        // An act a revive (or a pause) cut short: nothing to move by hand, but the record of what it did.
        return `coordinator ${claimantId} crashed and the lane tried to end its programme, but the act stopped`
          + `${r.after.stop === null ? '' : ` (${r.after.stop})`}, so the programme is NOT ended.${done}`;
      }
      // The report knows only the runs the act could not move — never that every other run closed — so it never says the
      // programme ended: the feed row for the same act says NOT ended, and the operator reads both.
      return `coordinator ${claimantId} crashed and the lane tried to end its programme, but ${r.runs.map((x) => `run ${x.runId} (${x.why})`)
        .join(', ')} could not be moved, so the programme is NOT ended (runs the lane did close stay closed). It is asked again only after a backoff — abandon ${r.runs.length === 1 ? 'it' : 'them'} by hand.${done}`;
    }
  }
}

/** What an act did before it stopped or failed, in words: "Before it stopped it closed failed … and released …". */
function progressSentence(p: DeadCoordinatorProgress): string {
  const parts: string[] = [];
  if (p.closed.length > 0) parts.push(`closed failed ${p.closed.map((x) => `${runs(x.runIds.length)} of programme ${x.slug}`).join(', ')}`);
  for (const x of p.released) {
    parts.push(`released the worker of run ${x.runIds.join(', ')} of programme ${x.slug} (it is unheld until its coordinator re-holds it)`);
  }
  return parts.length === 0 ? '' : `Before it ${p.stop === null ? 'failed' : 'stopped'} the act ${parts.join(' and ')}.`;
}

/** The breaker's ONE item. */
export function deadCoordinatorBreakerSentence(b: Extract<DeadCoordinatorBreaker, { tripped: true }>): string {
  const ids = b.claimants.join(', ');
  return b.why === 'unmeasurable'
    ? `the lane could not measure the fleet this pass (${b.detail ?? 'unknown'}), so it ends nothing and holds `
      + `${b.claimants.length === 1 ? 'coordinator' : 'coordinators'} ${ids} — a tmux that did not answer, or a registry `
      + 'that would not list, is a fleet fault, not a death.'
    : `${b.claimants.length} coordinators read crashed within ${DEAD_COORDINATOR_BREAKER_WINDOW_MS / 60_000} minutes of `
      + `each other (${ids}) — a box fault is likelier than ${b.claimants.length} crashes, so the lane ends nothing. `
      // The other way to trip it, which is no fault of anyone's: a lane that went more than the gap bound without measuring
      // (a restart, a pause, a stale mirror) restarts every crashed episode on one pass.
      + `A lane gap of more than ${DEAD_COORDINATOR_GAP_MS / 60_000} minutes (a restart, a pause, a stale mirror) trips it too: it re-anchors every crashed coordinator together. `
      + 'It clears when the named coordinators are revived, reclaimed or abandoned, all but one of them.';
}

/** The breaker's feed row, written once when it trips (or names a different set) — so a trip, and the coordinators it
 *  held, outlive the in-memory list (spec §9's stage-4 row: "breaker trips … reported"). */
export function deadCoordinatorBreakerFeedRow(b: Extract<DeadCoordinatorBreaker, { tripped: true }>): { readonly title: string; readonly body: string } {
  return { title: 'dead coordinator: breaker tripped', body: `${deadCoordinatorBreakerSentence(b)} (holding since ${iso(b.since)})` };
}

/** THE ATTENTION LIST, from the lane's memory alone, the breaker's item first. */
export function deadCoordinatorAttention(
  entries: ReadonlyMap<string, DeadCoordinatorEntry>, breaker: DeadCoordinatorBreaker,
): DeadCoordinatorAttention[] {
  const out: DeadCoordinatorAttention[] = [];
  for (const [id, e] of entries) {
    if (e.report !== null) {
      out.push({ kind: e.report.kind, claimants: [id], sentence: deadCoordinatorReportSentence(id, e.report), at: e.report.at });
    }
  }
  out.sort((a, b) => b.at - a.at || (a.claimants[0]! < b.claimants[0]! ? -1 : 1));
  return breaker.tripped
    ? [{ kind: 'breaker', claimants: breaker.claimants, sentence: deadCoordinatorBreakerSentence(breaker), at: breaker.since }, ...out]
    : out;
}

// ── the vocabulary, for `mail-routes.test.ts` ────────────────────────────────

const DEAD_COORDINATOR_OUTCOME_KINDS: Readonly<Record<DeadCoordinatorActOutcome['kind'], true>> = {
  ended: true, 'would-end': true, 'paused-at-server': true, 'store-unreadable': true,
};
const DEAD_COORDINATOR_REPORT_KINDS: Readonly<Record<DeadCoordinatorAttention['kind'], true>> = {
  'would-end': true, unmeasured: true, stuck: true, breaker: true,
};
/** `closeRun`'s compare-and-set refusal (`coord/close.ts`, `coord/store.ts`): the run's claimant is no longer the
 *  crashed id — a successor took the programme between the lane's measurement and the commit. */
export const CLAIMANT_CHANGED = 'claimant-changed';
/** `closeRun`'s sweep refusal when its in-arm re-measure (`DeadCoordinatorStop`) says the claimant is no longer crashed,
 *  or cannot say — before the fleet act, or after it and before the commit. */
export const SWEEP_STOPPED = 'sweep-stopped';

/** Every kebab word this lane spells as a literal in `server/src/coord` — its outcome kinds, its report kinds and the
 *  compare-and-set refusal — for `mail-routes.test.ts`'s scan. None is a mail rejection or a run refusal. Derived from
 *  the Records above, never a list. */
export function isDeadCoordinatorKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return v === CLAIMANT_CHANGED || v === SWEEP_STOPPED || own(DEAD_COORDINATOR_OUTCOME_KINDS) || own(DEAD_COORDINATOR_REPORT_KINDS);
}
