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

/** The newest `spawn` row that recorded `rc` 0, in journal order (`rows` already sorted by generation), with its index. */
function newestSuccessfulSpawn(rows: readonly DeadCoordinatorJournalRow[]): { index: number; row: DeadCoordinatorJournalRow } | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i]!;
    if (r.act === 'spawn' && r.outcome === 'done' && spawnSucceeded(r)) return { index: i, row: r };
  }
  return null;
}

/** The instant (ms) of the claimant's newest SUCCESSFUL spawn, by the same selector `deadCoordinatorJournal` reads its
 *  "last start" with, or `null` (no such row, a row with no instant, or a generation this reader cannot place). It is the
 *  second kind of evidence of a later life (`deadCoordinatorNewEpisode`, D-4827); the caller reads it only for a claimant
 *  the journal clause called crashed, so the journal was trusted. */
export function deadCoordinatorJournalSpawnedAt(mirrorRows: readonly DeadCoordinatorJournalRow[]): number | null {
  if (mirrorRows.some((r) => !GEN_DIGITS.test(r.gen))) return null;
  const found = newestSuccessfulSpawn([...mirrorRows].sort((a, b) => compareGenerations(a.gen, b.gen)));
  return found === null ? null : found.row.at;
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
  const found = newestSuccessfulSpawn(rows);
  const from = found === null ? 0 : found.index + 1;
  const start: DeadCoordinatorJournalRow | null = found === null ? null : found.row;
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

/** A NEW EPISODE (D-4825, D-4827; the returning-id seam): the claimant is crashed this pass, and EVIDENCE of a later life
 *  is later than its durable anchor's `firstDeadAt` and not after now — so what is crashed now is a later death, not the
 *  one the anchor counts. Two kinds of evidence, either enough: (1) its supervisor's heartbeat (`supervisedAt`, epoch
 *  SECONDS), which is SUPERVISION evidence — `cmd_supervise` re-stamps it every 30 s and at every supervisor start,
 *  `cmd_swap` while a carry runs — so a restart of a supervisor also shows; (2) the trusted journal's newest SUCCESSFUL
 *  `spawn` (rc 0, already selected by `deadCoordinatorJournal`, `spawnedAtMs`), which covers the unsupervised fallbacks of
 *  a successful spawn that stamp no heartbeat. The lane then starts a FRESH anchor at this crash, as for a first crash
 *  (`deadAnchorNext(null, now)`), and the breaker adds that instant to every instant it remembers. A lane that saw the
 *  claimant alive in between would have deleted the anchor and anchored afresh; one that skipped that pass, or was
 *  restarting, did not, and keeps the old episode's instant — which this makes the same. Stateless: the evidence and the
 *  anchor are both durable or read, so it survives a restart, and once the fresh anchor is written neither piece of
 *  evidence is later than it, so it fires once per later life. The hour then counts from the fresh anchor, exactly as for
 *  a first crash. A heartbeat that classifies the claimant crashed is already outside the 120-second fresh window, so the
 *  new anchor is that delay, plus up to a cadence or the skipped passes, later than the stamp: it never shortens the old
 *  hour. Not covered, and not claimed: a later life that left neither a heartbeat nor a journaled successful spawn, and, in
 *  remote mode, evidence stamped by a fleet clock running behind the server's (it can only hide a return, never invent
 *  one). Both values are read as the existing timestamp handling reads them: a future, non-positive or unsafe one is no
 *  evidence. */
export function deadCoordinatorNewEpisode(
  prev: DeadAnchor | null, supervisedAtS: number | null, nowMs: number, spawnedAtMs: number | null = null,
): boolean {
  if (prev === null) return false;
  const later = (ms: number | null): boolean => ms !== null && Number.isSafeInteger(ms) && ms > 0 && ms <= nowMs && ms > prev.firstDeadAt;
  return later(supervisedAtS !== null && Number.isSafeInteger(supervisedAtS) ? supervisedAtS * 1000 : null) || later(spawnedAtMs);
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
 *  let one transient doubt dissolve the cluster for good. `members` carries each held claimant's accumulated first-dead
 *  instants (every one it has held or been anchored at); the lane hands them back on the next pass and releases a member only on an answer that is evidence — alive,
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

export interface DeadCoordinatorBreakerMember {
  readonly id: string;
  readonly firstDeadAt: number;
  /** Every anchor instant a HELD member has carried while held (review 384, F1-N1), ascending and without repeats, the
   *  first of them `firstDeadAt`. Absent when it carries one. `crashed` entries never have it. */
  readonly instants?: readonly number[];
  /** A member the FALLBACK seed holds (review 382, R2) — the lane could not read its record of the hold, so it holds every
   *  claimant the pass does not release. Absent on every ordinary member, never `false`. See `deadCoordinatorBreaker`. */
  readonly fallback?: true;
}

/** `crashed`: this pass's crashed claimants with their durable `firstDeadAt` (the CURRENT anchor). `held`: the members the
 *  last trip held that no answer has released since, with every instant they carry. `unmeasurable`: the ids this pass
 *  could not measure, of `measured` asked. `fleetDoubt`: a fleet-wide fact this pass measured — tmux did not answer — or
 *  `null`. A fleet-wide doubt trips it whatever the count: one claimant whose row is gone still reads crashed while tmux
 *  is down for every other, and that pass is exactly the box fault the breaker exists for. So does a pass that could
 *  measure none of two or more claimants.
 *
 *  THE CLUSTERING IS MONOTONE (review 384, F1). Each entry is an id, and it carries a SET of instants — every instant it
 *  carried while held, plus its current anchor when it is crashed and anchored this pass — and a flag. No instant
 *  replaces another and none is dropped while the member stays held. Two DISTINCT entries cluster when ANY instant of one
 *  is within the window of ANY instant of the other; an id's own instants never cluster it with itself. A sorted sweep
 *  over the (id, instant) points, comparing consecutive points of different ids, finds exactly the clustered ids: on a
 *  within-window run from a point of A to a point of B, the first change of id leaves A beside a consecutive different-id
 *  point and the last change lands on B beside one. Members are the clustered ids, and a member's instants for the next
 *  pass are those it carried plus this pass's anchor (so they grow by one per re-anchor while it is held — an
 *  unmeasurable episode, a gap, a backward clock step, a later life (D-4825, D-4827) — with no bound of their own, and
 *  the record grows with them); its `firstDeadAt` is the earliest. The anchor itself stays
 *  durable in `dead_claimants`.
 *
 *  A held member FLAGGED `fallback` (review 382, R2) is a WILDCARD: it clusters with every other entry, whatever the
 *  instants. When at least two entries stand and one is flagged, the breaker trips with EVERY entry as a member, and
 *  EVERY member of that trip carries the flag (review 382, N1) — a claimant that crashed while the hold stood included,
 *  on the clustered and the unmeasurable arm alike, since both build `members` the same way.
 *
 *  THE PROPERTY (about this function). Let L and L' be two inputs of one pass such that every (id, instant) pair of L, and
 *  every flag, is also in L'. Then every id L clusters, L' clusters: a wildcard in L' clusters every id of L', and
 *  without one, adding a point P between two consecutive points a and b of different ids within the window leaves a
 *  consecutive different-id pair within the window beside P (P's id is a's, b's, or another's, and each case keeps both
 *  ids paired), so no id unclusters; adding an id, an instant or a flag therefore never untrips the clustered arm and
 *  never drops a member. The unmeasurable arm names `unmeasurable ∪ crashed ∪ members`, and its trigger (`fleetDoubt`,
 *  `allUnmeasurable`) reads only the pass's own measurements, so the superset stays a superset there too.
 *  ANCHORS AND RELEASES ARE PASS-SAMPLED: an anchor is the instant of its lane's own pass (`deadAnchorNext(…, at)`), up to
 *  one cadence after the crash, and evidence that releases a hold (alive, stopped, deliberate) is seen only at a pass; a
 *  restarted process passes on its own grid, as does any lane started at another moment. Two lanes therefore anchor one
 *  crash up to a cadence apart, can release a member at different passes, and a pair near the window's edge can cluster in
 *  one and not in the other; the lane with more passes may act sooner. That is inherent to pass sampling, was true before
 *  this, and is not argued away: what follows is claimed ONLY FOR THE PASSES AND EVIDENCE BOTH LANES SHARE. The pure
 *  property above, a statement about this function's inputs, does not depend on it.
 *  WHAT IT GIVES A RESTARTED LANE R against an unrestarted one U, UNDER TWO ASSUMPTIONS. (A1) Both lanes' passes fall at
 *  the same moments, so they hold the same anchor instants for a claimant's current episode and see, and release on, the
 *  same evidence (not true across a restart that moves the pass grid, nor across a gap longer than the episode gap, which
 *  re-anchors every crashed coordinator: the spec's residuals name both, and this does not argue about either). (A2) R's
 *  population differs from U's only by claimants U has ended and R has not yet: R's reset run of crashed passes delays its
 *  act, whereas its lost backoff makes it act SOONER, and that is a path of its own: if U backs off a stuck claimant P
 *  while R, its backoff lost, ends P, U keeps P as an extra entry that can cluster with a new crash, so R can end a third
 *  claimant Q that U holds. THE HYPOTHESIS: every id U holds, R holds with at least U's instants, or flagged. At the seed
 *  it holds: a plain restart reads U's own record (and flags every claimant whose anchor began after it, D-4826), and the
 *  fallback holds every claimant the pass does not release, flagged, a superset of anything U holds (a held member is
 *  always unreleased and in the population). Each step: both see the same anchors and release the same members on the
 *  same evidence (alive, stopped, deliberate, left the population), so R's entries are a superset of U's as (id, instant)
 *  pairs and flags; by the property R trips whenever U does, with members ⊇ U's; and each member's next instants are its
 *  held instants plus this pass's anchor on both sides, so R's remain ⊇ U's (or R's is flagged, and every member of a
 *  flagged trip is). So, for the passes and evidence both lanes share, and outside the paths named here, U's breaker
 *  standing implies R's stands. A claimant that U ended and that RETURNS (a new spawn, a new run) while R still holds its
 *  old episode is covered by `deadCoordinatorNewEpisode` (D-4825, D-4827): a supervisor heartbeat (supervision evidence)
 *  or a journaled successful spawn is later than R's durable anchor, so R anchors it afresh at its next crash, as U, which
 *  deleted the anchor, does — R then carries U's new instant beside every one it remembers. That rests on one of the two:
 *  a return that leaves neither is not seen, in remote mode a fleet clock behind the server's can hide one, and this does
 *  not claim to cover them, nor claim that no other corner exists. A process that dies between step five (a fresh anchor
 *  written) and step six (the record written), or whose write kept failing, seeds the older record; the lane's first pass
 *  therefore flags every claimant whose durable anchor began after that record row was written (D-4826), so the holds it
 *  formed and lost are held again, flagged. A pass that starts an anchor also writes the record when the set is unchanged
 *  (a checkpoint, so the write time moves past that pass's anchors), which leaves only the anchors of a pass that died before
 *  its write, or whose write failed, newer than the record: the cost is holding two such crashed claimants, though they never
 *  clustered, until evidence releases one. A server clock that steps backwards across a restart can make a later anchor read
 *  earlier than the record. One class is an unresolved ARMING BLOCKER, not an accepted residual (the lane must not be armed until it is closed): a held
 *  instant that lived in memory alone because held-set writes failed while anchor writes landed, its anchor then deleted by a
 *  doubt before the restart, is invisible to that recovery. The all-unmeasurable arm diverges as measured: R's extra claimant can be measured while all of
 *  U's are not, so R does not trip there, but every other claimant is as unmeasured in R as in U, so R can act there only
 *  on the claimant U already ended. The cost of the accumulation is more holding: a member held at an old instant that
 *  crashes anew also clusters near its new instant, a held member's instants and its record grow by one per re-anchor
 *  while it is held, and while a flagged member stands a coordinator that crashes is swept into the hold and flagged
 *  itself, until evidence releases it or fewer than two entries stand. */
export function deadCoordinatorBreaker(
  crashed: readonly DeadCoordinatorBreakerMember[], held: readonly DeadCoordinatorBreakerMember[],
  unmeasurable: readonly string[], measured: number, fleetDoubt: string | null, nowMs: number,
): DeadCoordinatorBreaker {
  const anchor = new Map(crashed.map((c) => [c.id, c.firstDeadAt]));
  const carried = new Map(held.map((h) => [h.id, [h.firstDeadAt, ...(h.instants ?? [])]]));
  const flagged = new Set(held.filter((h) => h.fallback === true).map((h) => h.id));
  const ids = [...new Set([...anchor.keys(), ...carried.keys()])];
  // Every instant of an id, ascending, no repeats: what it carried while held, then this pass's anchor.
  const instantsOf = (id: string): number[] => {
    const all = [...(carried.get(id) ?? [])];
    const a = anchor.get(id);
    if (a !== undefined) all.push(a);
    return [...new Set(all)].sort((x, y) => x - y);
  };
  const points: { id: string; at: number }[] = [];
  for (const id of ids) for (const at of instantsOf(id)) points.push({ id, at });
  points.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // A trip a flagged entry took part in flags EVERY member (review 382, N1).
  const wild = ids.length >= 2 && flagged.size > 0;
  const clustered = new Set<string>();
  if (wild) {
    for (const id of ids) clustered.add(id);
  } else {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!; const b = points[i]!;
      if (a.id !== b.id && b.at - a.at <= DEAD_COORDINATOR_BREAKER_WINDOW_MS) { clustered.add(a.id); clustered.add(b.id); }
    }
  }
  const members: DeadCoordinatorBreakerMember[] = ids.filter((id) => clustered.has(id))
    .map((id) => {
      const all = instantsOf(id);
      return { id, firstDeadAt: all[0]!, ...(all.length > 1 ? { instants: all } : {}) };
    })
    .sort((a, b) => a.firstDeadAt - b.firstDeadAt || (a.id < b.id ? -1 : 1))
    .map((m) => (wild ? { ...m, fallback: true as const } : m));
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

// ── the breaker's hold, made durable (review 381, F1) ─────────────────────────

/** The head of the `run_events` observation row that carries the breaker's held set across a restart (the stall watch's
 *  "Durable dedupe, no migration" shape: `fromState = toState`, so nothing pushes it). After the head: the members as
 *  `id@firstDeadAt` (several instants `+`-joined, review 384, F1-N1; a fallback member, review 382, R2, with a `*` after the list), comma-joined, ids ascending; an EMPTY list is the hold cleared. `parseStallDetail` reads any detail
 *  with other than four colon-separated parts as null, and this one has two, so the stall count never sees it. */
export const DEAD_COORDINATOR_BREAKER_HELD_HEAD = 'dead-coordinator-breaker-held:';

/** THE ID IS PERCENT-ESCAPED, AND THE ENCODING IS TOTAL (review 381, part A review item 2; operator ruling 4286, item 6):
 *  every string has exactly one spelling, and every spelling reads back as the string it was written from. Per UTF-16
 *  code unit, left to right: one of `[A-Za-z0-9._-]` stays as it is; a LONE surrogate (one with no partner beside it) is
 *  `%u` and four UPPERCASE hex digits; anything else — a whole character, a surrogate pair taken together — is its
 *  UTF-8 bytes, each `%` and two UPPERCASE hex digits, `%` itself included. So no claimant id can break the separators
 *  (`@`, `,`, the head's `:`), a leading U+FEFF reads back (review 382, R1), and a lone surrogate, which UTF-8 cannot
 *  carry, has a spelling of its own: a valid held set always has a record (`claimedBy` is not shape-checked at
 *  `POST /api/runs`). `%u` cannot be read as a byte escape: `u` is not a hex digit. The empty id is the empty string.
 *  Ids ascend by the DECODED string's code units, on write and on read alike. */
const BREAKER_HELD_SAFE = /^[A-Za-z0-9._-]*$/;
/** A fallback member's mark, after the complete `+` list of its instants (review 382, R2): `id@<t1+t2…>*`. `*` is outside the escaped-id alphabet
 *  and is not a digit, so it can never be part of an id or an instant. No released build reads this record at all (the
 *  build that first had a reader, before the mark, never shipped), so a rollback to a released build starts with no hold,
 *  failing open: the spec's §12 says to disarm the lane before rolling back. */
const BREAKER_HELD_FALLBACK_MARK = '*';
/** Several instants of one member (review 384, F1-N1): `id@t1+t2+t3`, ascending, no repeats; the mark, if any, after the
 *  whole list. `+` is outside the escaped-id alphabet and is not a digit. A row with one instant is the old spelling. */
const BREAKER_HELD_INSTANT_JOIN = '+';
const BREAKER_HELD_ESCAPED = /^(?:[A-Za-z0-9._-]|%[0-9A-F]{2}|%u[0-9A-F]{4})*$/;

const isHighSurrogate = (c: number): boolean => c >= 0xD800 && c <= 0xDBFF;
const isLowSurrogate = (c: number): boolean => c >= 0xDC00 && c <= 0xDFFF;
const utf8Escaped = (text: string): string =>
  [...new TextEncoder().encode(text)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('');

const escapeBreakerHeldId = (id: string): string => {
  if (BREAKER_HELD_SAFE.test(id)) return id;
  let out = '';
  for (let i = 0; i < id.length; i += 1) {
    const c = id.charCodeAt(i);
    if (isHighSurrogate(c) && i + 1 < id.length && isLowSurrogate(id.charCodeAt(i + 1))) {
      out += utf8Escaped(id.slice(i, i + 2));
      i += 1;
    } else if (isHighSurrogate(c) || isLowSurrogate(c)) {
      out += `%u${c.toString(16).toUpperCase().padStart(4, '0')}`;
    } else {
      const ch = id[i]!;
      out += /^[A-Za-z0-9._-]$/.test(ch) ? ch : utf8Escaped(ch);
    }
  }
  return out;
};

/** The id an escaped text spells, or `null` for anything that is not exactly what `escapeBreakerHeldId` writes: a
 *  character outside the alphabet, a lowercase or short escape, bytes that are not UTF-8, a `%u` escape of a code unit
 *  that is not a surrogate, or any other spelling of a string that has one (the decode must re-encode to the same text:
 *  two `%u` halves of a valid pair, an escape of a character that is written plain). */
const unescapeBreakerHeldId = (text: string): string | null => {
  if (!BREAKER_HELD_ESCAPED.test(text)) return null;
  // `ignoreBOM: true` keeps a LEADING U+FEFF as part of the id — the default strips it, and an id that begins with one
  // would be written and then read as unreadable (review 382, R1).
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let id = '';
  let bytes: number[] = [];
  const flush = (): boolean => {
    if (bytes.length === 0) return true;
    try { id += decoder.decode(Uint8Array.from(bytes)); } catch { return false; }
    bytes = [];
    return true;
  };
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '%' && text[i + 1] === 'u') {
      const unit = parseInt(text.slice(i + 2, i + 6), 16);
      if (!(isHighSurrogate(unit) || isLowSurrogate(unit)) || !flush()) return null;
      id += String.fromCharCode(unit);
      i += 5;
    } else if (text[i] === '%') {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      if (!flush()) return null;
      id += text[i];
    }
  }
  if (!flush()) return null;
  return escapeBreakerHeldId(id) === text ? id : null;
};

/** The held set's detail, or `null` when the set is not one a pass builds: an instant that is not a positive safe
 *  integer, or two members with one id. Every id has a spelling (the encoding is total), so a valid set always has
 *  one. */
export function deadCoordinatorBreakerHeldDetail(members: readonly DeadCoordinatorBreakerMember[]): string | null {
  const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const m = sorted[i]!;
    const id = escapeBreakerHeldId(m.id);
    const ats = [...new Set([m.firstDeadAt, ...(m.instants ?? [])])].sort((x, y) => x - y);
    if (ats.some((at) => !Number.isSafeInteger(at) || at < 1)) return null;
    if (i > 0 && sorted[i - 1]!.id === m.id) return null;
    parts.push(`${id}@${ats.join(BREAKER_HELD_INSTANT_JOIN)}${m.fallback === true ? BREAKER_HELD_FALLBACK_MARK : ''}`);
  }
  return `${DEAD_COORDINATOR_BREAKER_HELD_HEAD}${parts.join(',')}`;
}

/** A held-set detail split into its members' DECODED ids and UNPROVEN instant texts, strictly: the head, then nothing or
 *  `escapedId@digits` — several instants `+`-joined, strictly ascending, and a `*` after the list marking a fallback member — joined by commas with decoded ids strictly ascending. Anything else — a malformed escape included —
 *  is `null`: a malformed row, which the store reads as a failed read, never as a smaller set. The store proves each
 *  instant (`persistedInt`). */
export function splitDeadCoordinatorBreakerHeld(detail: string): { id: string; texts: string[]; fallback: boolean }[] | null {
  if (!detail.startsWith(DEAD_COORDINATOR_BREAKER_HELD_HEAD)) return null;
  const body = detail.slice(DEAD_COORDINATOR_BREAKER_HELD_HEAD.length);
  if (body === '') return [];
  const out: { id: string; texts: string[]; fallback: boolean }[] = [];
  for (const part of body.split(',')) {
    const at = part.split('@');
    if (at.length !== 2) return null;
    const [escaped, marked] = at as [string, string];
    const fallback = marked.endsWith(BREAKER_HELD_FALLBACK_MARK);
    const list = fallback ? marked.slice(0, -BREAKER_HELD_FALLBACK_MARK.length) : marked;
    const texts = list.split(BREAKER_HELD_INSTANT_JOIN);
    const id = unescapeBreakerHeldId(escaped);
    if (id === null || !texts.every((t) => /^[1-9][0-9]*$/.test(t))) return null;
    // Strictly ascending: canonical positive decimals compare by length, then by text.
    for (let k = 1; k < texts.length; k += 1) {
      const p = texts[k - 1]!; const q = texts[k]!;
      if (!(p.length < q.length || (p.length === q.length && p < q))) return null;
    }
    if (out.length > 0 && !(out[out.length - 1]!.id < id)) return null;
    out.push({ id, texts, fallback });
  }
  return out;
}

/** The held set's key, for "write its record only when it CHANGES": the encoded detail itself (its sorted, escaped,
 *  unambiguous spelling), or — for a set with no spelling — the JSON of the sorted members. */
export const deadCoordinatorBreakerHeldKey = (members: readonly DeadCoordinatorBreakerMember[]): string =>
  deadCoordinatorBreakerHeldDetail(members)
  ?? JSON.stringify([...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

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
 *     claimant is learned, so nothing resets;
 *   - `hold`: the lifecycle mirror turned `unknown` or `stale` between the pass and the act (review 339, F4, ruled). The
 *     journal could not be read, so nothing about the claimant was learned — the adapter's own contract, "a slow mirror
 *     never deletes an anchor": the anchor AND the run of passes stand, and the act waits one pass, as the switch's
 *     does. Never `remeasured`, which would delete the anchor on a mirror's lateness. */
export type DeadCoordinatorStop =
  | { readonly kind: 'remeasured'; readonly why: string }
  | { readonly kind: 'switch'; readonly why: string }
  | { readonly kind: 'successor'; readonly why: string }
  | { readonly kind: 'hold'; readonly why: string };

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
      /** The runs whose worker the act RE-HELD under a surviving run's reason (another open run claims the workspace)
       *  and whose run it then left open — the worker stays claimed. Absent when the act re-held none. */
      readonly reheld?: readonly DeadCoordinatorProgramme[];
      /** Set only on the outcome a THROWN act hands back (`DeadCoordinatorActThrew`): what it had closed is real, and
       *  this is what failed. */
      readonly failed?: string;
      /** Set only with `failed`, when the throw came from one run's abandon: that run. Whether ITS fleet act ran before
       *  the throw is not known — the abandon arm answered nothing (review 339, F13). */
      readonly failedRun?: number }
  | { readonly kind: 'would-end'; readonly programmes: readonly DeadCoordinatorProgramme[] }
  | { readonly kind: 'paused-at-server'; readonly detail: string }
  | { readonly kind: 'store-unreadable'; readonly detail: string };

/** What an act DID before it stopped or failed, for the attention list: the runs it closed failed (by programme), the
 *  workers it released and those it re-held under a surviving run (their runs stay open), and why it stopped (`null`:
 *  it threw, and which run moved is unknown). */
export interface DeadCoordinatorProgress {
  readonly closed: readonly DeadCoordinatorProgramme[];
  readonly released: readonly DeadCoordinatorProgramme[];
  readonly reheld: readonly DeadCoordinatorProgramme[];
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

/** The lane's memory of one claimant — IN MEMORY ONLY (the anchor is the durable half). A restart drops the run of
 *  crashed passes, which DELAYS an act, and the backoff (`nextAskAt`, `attempts`), which can bring an abandon back
 *  SOONER after a stuck or thrown act (review 381, F10). A restart while a held-set write is failing, or a death between a
 *  pass's anchors and its record, seeds the older record, which can hold less than the process did: the first pass flags
 *  every claimant whose durable anchor began after it (D-4826), though not a held instant that lived in memory alone
 *  with its anchor deleted by a doubt (an unresolved ARMING BLOCKER: the lane must not be armed until it is closed). The lane composes no act on a pass whose held-set record
 *  did not land, so the record never lags an act; the
 *  act is still behind the claimant's re-measure before and after the fleet act. The breaker's hold is not in this entry: it survives a restart (review
 *  381, F1), and an unreadable record of it seeds a conservative fallback (review 382, R2). */
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
 *  `stuck`, which stands until the runs move. Anything else also ENDS THE EPISODE (its anchor is deleted, ruling E), so
 *  the last recorded outcome goes too: a coordinator that crashes, is revived and crashes again is a second episode,
 *  and its shadow record is written again (review 339, F2). */
export function deadCoordinatorSighted(e: DeadCoordinatorEntry, c: DeadCoordinatorCrash, nowMs: number): DeadCoordinatorEntry {
  if (c.kind === 'crashed') {
    return { ...e, crashedPasses: e.crashedPasses + 1, report: e.report?.kind === 'unmeasured' ? null : e.report };
  }
  const report: DeadCoordinatorReport | null = c.kind === 'unmeasured'
    ? { kind: 'unmeasured', at: e.report?.kind === 'unmeasured' ? e.report.at : nowMs, why: c.why }
    : e.report?.kind === 'stuck' ? e.report : null;
  return { ...e, crashedPasses: 0, report, lastOutcome: null };
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
      const crashedPasses = stop === 'remeasured' || stop === 'switch' ? 0 : e.crashedPasses;   // `hold` keeps them
      const at = e.report?.kind === 'stuck' ? e.report.at : nowMs;
      // An act that STOPPED having closed a run or released a worker is news the operator reads (the stop's feed row
      // is only for a programme with a closed run): what it did, and that the programme is NOT ended.
      const released = o.released ?? [];
      const reheld = o.reheld ?? [];
      const after: DeadCoordinatorProgress | undefined = o.stoppedBy !== null
        && (o.programmes.length > 0 || released.length > 0 || reheld.length > 0)
        ? { closed: o.programmes, released, reheld, stop: o.stoppedBy.why } : undefined;
      if (o.stuck.length === 0) {
        return { ...base, crashedPasses, attempts: 0, nextAskAt: stop === 'switch' || stop === 'hold' ? nowMs + passMs : 0,
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
      // A programme with a closed run, then one the act only RELEASED or RE-HELD a worker of: its record is the same
      // fact — the programme is NOT ended — and says which act ran on that worker.
      const released = o.released ?? [];
      const reheld = o.reheld ?? [];
      const slugs = [...o.programmes];
      for (const r of [...released, ...reheld]) if (!slugs.some((p) => p.slug === r.slug)) slugs.push(r);
      return slugs.flatMap((s) => {
        const closed = o.programmes.find((x) => x.slug === s.slug)?.runIds.length ?? 0;
        const left = o.open.find((x) => x.slug === s.slug)?.runIds.length ?? 0;
        if (closed > 0 && left === 0) {
          return [{ title: 'dead coordinator: programme ended',
            body: `${dead} and stayed dead an hour; programme ${s.slug} ended, ${runs(closed)} closed failed.` }];
        }
        const rel = released.find((x) => x.slug === s.slug)?.runIds ?? [];
        const reh = reheld.find((x) => x.slug === s.slug)?.runIds ?? [];
        const base = o.failed !== undefined ? `the act then failed: ${o.failed}`
          : o.stoppedBy !== null ? `the act stopped: ${o.stoppedBy.why}` : 'the abandon arm could not move the rest';
        const workers = (ids: readonly number[]): string => `${ids.map((id) => `run ${id}'s worker`).join(', ')} ${ids.length === 1 ? 'was' : 'were'}`;
        const parts = [base];
        if (rel.length > 0) parts.push(`${workers(rel)} released and ${rel.length === 1 ? 'is' : 'are'} unheld until its coordinator re-holds it`);
        if (reh.length > 0) parts.push(`${workers(reh)} re-held under a surviving run and ${reh.length === 1 ? 'stays' : 'stay'} claimed`);
        const why = parts.join('; ');
        return [{ title: 'dead coordinator: programme partly ended',
          body: `${dead} and stayed dead an hour; programme ${s.slug} was NOT ended: ${closed} of `
            + `${runs(closed + left)} closed failed and ${left} stay open — ${why}.` }];
      });
    }
    case 'paused-at-server': case 'store-unreadable':
      return [];
  }
}

/** The feed row for an act that THREW (review 339, F13), written for EVERY thrown act — beside the rows of any
 *  programme it had closed — so a throw that closed nothing is still a durable record, not only an in-memory entry a
 *  restart loses. It names what is known — the runs the act closed, the run whose abandon failed — and says nothing
 *  more is. `done` is the executor's own outcome up to the throw, or `null` when the act failed before the executor
 *  could say anything (the serialiser itself threw). */
export function deadCoordinatorThrewFeedRow(
  claimantId: string, done: Extract<DeadCoordinatorActOutcome, { kind: 'ended' }> | null, error: string, since: number,
): { readonly title: string; readonly body: string } {
  const closed = done === null || done.programmes.length === 0 ? 'before it closed any run'
    : `after it closed failed ${done.programmes.map((x) => `${runs(x.runIds.length)} of programme ${x.slug}`).join(', ')}`;
  const at = done?.failedRun === undefined ? ''
    : `; run ${done.failedRun}'s abandon is the one that failed, and whether its worker was released or re-held before the failure is not known`;
  return { title: 'dead coordinator: act failed',
    body: `coordinator ${claimantId} crashed (dead since ${iso(since)}) and stayed dead an hour; the lane's act failed (${error}) `
      + `${closed}${at}. Nothing more is known about which runs or workspaces moved — check its runs on /runs. It is asked `
      + 'again only after a backoff.' };
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
  for (const x of p.reheld) {
    parts.push(`re-held the worker of run ${x.runIds.join(', ')} of programme ${x.slug} under a surviving run (it stays claimed)`);
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

/** The feed row for a pass that could not read its record of the breaker's hold (review 382, R2): written once per bad row,
 *  through `recordRows` — a record, never a push, and no new attention kind. `held` is who the breaker held that pass as
 *  members; `tripped` is whether it tripped at all (review 382, N3: the words key on the breaker, not on `held` — a trip
 *  on a fleet-wide doubt has no members). `reason` is already a bounded string, never the row's content. */
export function deadCoordinatorBreakerUnreadableFeedRow(
  held: readonly string[], tripped: boolean, eventId: number | null, reason: string,
): { readonly title: string; readonly body: string } {
  const lead = `The lane could not read its record of the breaker's hold (${eventId === null ? 'no row' : `event ${eventId}`}: ${reason}), `;
  const tail = 'It writes a fresh record, and ends nothing until that record is written.';
  const none = 'so it held every coordinator this pass did not see alive, stopped or put down on purpose, but fewer than two stood, so no cluster formed';
  return { title: 'dead coordinator: breaker record unreadable',
    body: held.length > 0
      ? `${lead}so it held every coordinator this pass did not see alive, stopped or put down on purpose (${held.join(', ')}), `
        + 'each flagged: a flagged coordinator clusters with any other crashed or held coordinator until evidence releases it, '
        + `so while one stands a coordinator that crashes is swept into the hold and flagged itself. ${tail}`
      : tripped
        ? `${lead}${none}, but the breaker tripped on a fleet-wide doubt, which holds the lane this pass. ${tail}`
        : `${lead}${none} and nothing was held. ${tail}` };
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

/** WHICH fleet act the sweep's abandon ran before an in-arm stop (`sweep-stopped.fleetAct`, `coord/close.ts`): the
 *  worker RELEASED (nothing else claimed the workspace — unheld until its coordinator re-holds it) or RE-HELD under a
 *  surviving run's reason (still claimed). Two acts, two words (review 339, F3). Spelled here, once. */
export const SWEEP_FLEET_ACTS = ['released', 're-held'] as const;
export type SweepFleetAct = typeof SWEEP_FLEET_ACTS[number];

/** Every kebab word this lane spells as a literal in `server/src/coord` — its outcome kinds, its report kinds and the
 *  compare-and-set refusal — for `mail-routes.test.ts`'s scan. None is a mail rejection or a run refusal. Derived from
 *  the Records above, never a list. */
export function isDeadCoordinatorKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return v === CLAIMANT_CHANGED || v === SWEEP_STOPPED || (SWEEP_FLEET_ACTS as readonly string[]).includes(v)
    || own(DEAD_COORDINATOR_OUTCOME_KINDS) || own(DEAD_COORDINATOR_REPORT_KINDS);
}
