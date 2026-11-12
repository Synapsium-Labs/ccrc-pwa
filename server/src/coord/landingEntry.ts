// L1: pure. The landing line's entry (landing order wave 5e): what an advance writes to it, decided from values, and
// the reader of its rows. No fs, no node:sqlite, no clock; the one writer, `CoordStore.advanceLanding` (L3), gathers
// the facts, calls `decideLandingWrite`, and acts inside its transaction. Value imports are L0 only.
import type { RunState } from '../../../shared/api.js';
import type { ChecksMode } from '../../../shared/landing.js';
import { isLandingEjectionKind, isLandingEntryState } from '../../../shared/landingLine.js';
import type {
  LandingAuthority, LandingEjectionKind, LandingEntry, LandingEntryState, LandingHistoricalBinding, LandingIdentity,
  LandingJournalRecord, LandingMutationCode, LandingRecovery, LandingRecoverySubject, LandingSubjectRef, LandingWrite,
} from '../../../shared/landingLine.js';
import type { LandingAuthorityCommand, LandingMutationDecision, LandingMutationFacts, LandingReadResult } from './landingWrites.js';

/** What the route asks the line to do with one advance, built by `landingAdvanceOf` from the target alone. */
export type LandingAdvance =
  | { kind: 'plain' }
  | { kind: 'pin'; head: string; pr: number | null; mode: ChecksMode; handoffCommit: string }
  | { kind: 'retreat'; ejection: { base: string; kind: LandingEjectionKind } | null };

/** What the line recorded, as the store answers it and the advance's 200 body carries it (D-7627). `no-pr`,
 *  `no-episode` and `no-entry` are in-process words, never wire refusal codes (D-7619). */
// The union is defined ONCE, in the import-free L0 vocabulary `shared/landingLine.ts` (`AdvanceOk.landing` is the same
// type); this is its type-only re-export for the store.
export type { LandingWrite };

/** The composite's decision: a write that touches no row, or the one statement to run. */
export type LandingWriteDecision =
  | { act: 'none'; write: Extract<LandingWrite, { kind: 'none' | 'no-pr' | 'no-episode' | 'no-entry' | 'kept' }> }
  | { act: 'insert' } | { act: 'repin'; id: number }
  /** `ejections` is the count the row takes: one more than it had, but never past the safe-integer ceiling the strict
   *  reader can still read (a row at the ceiling keeps its count; the retreat is still an ejection). */
  | { act: 'eject'; id: number; base: string | null; kind: LandingEjectionKind | null; ejections: number }
  /** A retreat whose entry names a head other than the episode's: the row is marked `unknown` with its one marker, and
   *  nothing else about it moves (no base, no count, no notice). */
  | { act: 'quarantine'; id: number }
  /** A retreat whose owned, pinned entry names another head and cannot be read as a whole: the advance is refused before
   *  the run moves, with the line's own typed infrastructure answer (nothing is rewritten, the run stays at `merging`). */
  | { act: 'refuse'; failure: { ok: false; error: 'landing-projection-unreadable'; recovery: 'restart' } };

/** advanceAct's choice: to 'merging' with a verdict → pin (head = measured.branchTip, pr = measured.prNumber ?? null);
 *  to 'working' → retreat (the parsed ejection or null); anything else → plain. */
export function landingAdvanceOf(f: { to: RunState; measured: { branchTip: string; prNumber: number | null } | null;
  mode: ChecksMode | null; handoffCommit: string; ejection: { base: string; kind: LandingEjectionKind } | null }): LandingAdvance {
  if (f.to === 'merging' && f.measured !== null && f.mode !== null) {
    return { kind: 'pin', head: f.measured.branchTip, pr: f.measured.prNumber ?? null, mode: f.mode, handoffCommit: f.handoffCommit };
  }
  if (f.to === 'working') return { kind: 'retreat', ejection: f.ejection };
  return { kind: 'plain' };
}

/** `episode` is `CoordStore.currentEpisode`'s answer, passed whole (typed structurally, so L1 imports no store):
 *  null means the run has no episode row, which is not an episode whose verdict measured no PR (`pr: null`).
 *  `current` is the row for (project, `pin.pr`) on a pin, or for (project, `episode.pr`) on a retreat; null means no
 *  such row. D-7618 (advances the line does not place) and D-7617 (a re-pin moves to the back). */
export function decideLandingWrite(f: { landing: LandingAdvance; from: RunState; runId: number;
  current: LandingEntry | null; projection: LandingProjectionRead | null; episode: { pr: number | null; head: string } | null }): LandingWriteDecision {
  const { landing, current } = f;
  if (landing.kind === 'plain') return { act: 'none', write: { kind: 'none' } };
  if (landing.kind === 'pin') {
    if (landing.pr === null) return { act: 'none', write: { kind: 'no-pr' } };
    if (current === null) return { act: 'insert' };
    // A `closed` row re-pins as an ejected one does: GitHub lets a closed PR reopen, and only a verified pin brings it back.
    if (current.state === 'pinned' || current.state === 'ejected' || current.state === 'closed') return { act: 'repin', id: current.id };
    // Wave 5f: `projection` is the single row reader's verdict on `current`. A quarantined row (literal unknown with exactly
    // the stale-head marker and every retained field readable) re-pins; every other unknown row stays kept.
    if (current.state === 'unknown' && f.projection?.kind === 'readable' && f.projection.quarantine === 'stale-episode-head') {
      return { act: 'repin', id: current.id };
    }
    return { act: 'none', write: { kind: 'kept', state: current.state } };
  }
  if (f.from !== 'merging') return { act: 'none', write: { kind: 'none' } };
  if (f.episode === null) return { act: 'none', write: { kind: 'no-episode' } };
  if (f.episode.pr === null) return { act: 'none', write: { kind: 'no-pr' } };
  if (current === null) return { act: 'none', write: { kind: 'no-entry' } };
  if (current.runId !== f.runId || current.state !== 'pinned') return { act: 'none', write: { kind: 'kept', state: current.state } };
  // Wave 5f: an owned, pinned entry whose head is not the episode's head is stale, so nothing about its ejection is known:
  // it is quarantined (no ejection, base, count or notice). An unreadable projection is neither ejected nor rewritten to
  // mint the marker, and the retreat is refused, so the run is not moved past an entry nobody can read.
  if (current.pinnedSha !== f.episode.head) {
    if (f.projection?.kind !== 'readable') {
      return { act: 'refuse', failure: { ok: false, error: 'landing-projection-unreadable', recovery: 'restart' } };
    }
    return { act: 'quarantine', id: current.id };
  }
  return { act: 'eject', id: current.id, base: landing.ejection?.base ?? null, kind: landing.ejection?.kind ?? null,
    ejections: current.ejections >= Number.MAX_SAFE_INTEGER ? current.ejections : current.ejections + 1 };
}

// ── Landing order wave 5h: the landed reader's mark (the land arm of the one writer) ──

/** The states a mark may take out of the line. */
export const LANDING_LANDABLE_STATES = ['pinned', 'ejected'] as const;

/** Whether the land arm may mark a row: its state is landable and its projection is readable with no quarantine marker.
 *  The ONE copy of the rule: `decideLandingLand` and the landed reader's candidate walk both call it. */
export function isLandable(state: LandingEntryState, projection: LandingProjectionRead | null): boolean {
  return (LANDING_LANDABLE_STATES as readonly string[]).includes(state)
    && projection?.kind === 'readable' && projection.quarantine === null;
}

/** What GitHub said of one PR: merged (with the facts the mark records), closed without merging, or no such PR. */
export type LandingOutcome =
  | { word: 'merged'; head: string; base: string; mergedAt: string | null; mergeCommit: string | null;
    train: { number: number; mergeCommit: string } | null }
  | { word: 'closed' | 'absent' };

/** The land arm's input. `expect` is the reader's compare-and-set: the entry it read before the GitHub call. `null` is
 *  the close's: a merge is final, so no later pin can make it untrue. */
export interface LandingLand {
  kind: 'land'; project: string; pr: number; by: 'close' | 'reader'; at: number; outcome: LandingOutcome;
  expect: { id: number; pinnedAt: number } | null;
}

/** What the land arm recorded, as the store answers it. */
export type LandingLandWrite =
  | { kind: 'landed' | 'closed'; entry: LandingEntry }
  | { kind: 'kept'; state: LandingEntryState }
  | { kind: 'no-entry' }
  | { kind: 'moved' };

/** The mark's decision, from values: which row takes which word and `detail`, or why nothing is written. */
export function decideLandingLand(f: { land: LandingLand; current: LandingEntry | null; projection: LandingProjectionRead | null }):
  { act: 'land'; id: number; state: 'landed' | 'closed'; detail: string } | { act: 'none'; write: LandingLandWrite } {
  const { land, current } = f;
  if (current === null) return { act: 'none', write: { kind: 'no-entry' } };
  if (land.expect !== null && (land.expect.id !== current.id || land.expect.pinnedAt !== current.pinnedAt)) {
    return { act: 'none', write: { kind: 'moved' } };
  }
  if (!isLandable(current.state, f.projection)) return { act: 'none', write: { kind: 'kept', state: current.state } };
  const o = land.outcome;
  const base = { v: 1, by: land.by, at: land.at, word: o.word };
  const detail = o.word === 'merged'
    ? { ...base, ...(o.head !== current.pinnedSha ? { head: o.head } : {}), base: o.base, mergedAt: o.mergedAt,
      mergeCommit: o.mergeCommit, train: o.train?.number ?? null, trainMergeCommit: o.train?.mergeCommit ?? null }
    : base;
  return { act: 'land', id: current.id, state: o.word === 'merged' ? 'landed' : 'closed', detail: JSON.stringify(detail) };
}

const isPositiveSafe = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** A stored `afterIds`: a JSON array of distinct positive safe integers, or null for anything else. Distinct, because a
 *  journal record's `after` is duplicate-free (`landingJournalPolicy.ts`): a copied duplicate would append a line the
 *  next read of the history refuses. */
function afterIdsOf(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) && parsed.every(isPositiveSafe) && new Set(parsed).size === parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

/** A stored integer as a safe JS number: a `number` or a `bigint` (a SELECT with `setReadBigInts(true)` hands back
 *  bigints, so an oversized INTEGER is never silently rounded), at least `min`, within the safe range. Else null. */
function safeIntOf(v: unknown, min: 0 | 1): number | null {
  if (typeof v === 'bigint') {
    if (v < BigInt(min) || v > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(v);
  }
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : null;
}
const hash40 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const nonblank = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v === v.trim();
const absent = (v: unknown): v is null | undefined => v === null || v === undefined;

/** Whether a row's retained fields can be trusted as a whole. `readable.quarantine` is the one named marker
 *  (`stale-episode-head`, state literally `unknown`) that licenses a later verified re-pin; anything else that is
 *  `unknown` is `unreadable`. */
export type LandingProjectionRead =
  | { kind: 'readable'; quarantine: 'stale-episode-head' | null }
  | { kind: 'unreadable' };

/** What one row says. `dependencies` is readable independently of the state and of every numeric field, so a graph walk
 *  never has to trust the display `afterIds: []` of an unreadable row. */
export interface LandingEntryFacts {
  entry: LandingEntry;
  dependencies: { kind: 'readable'; afterIds: number[] } | { kind: 'unreadable' };
  projection: LandingProjectionRead;
}

/** THE strict reader of one `landing_entries` row (the row is never mutated). The display `entry` keeps its 5e contract:
 *  a `state` that is not a word, an `ejectionKind` that is neither null nor a kind, an unreadable `afterIds`, a
 *  `fixesMain` that is not exactly 0 or 1, or a `pinnedAt`/`ejections` that is not a nonnegative safe integer
 *  (number or bigint) reads `state: 'unknown'` (never in the line), with a finite placeholder (false, 0, [], null) for
 *  the unreadable field. `projection` is stricter: it is `readable` only when every retained field is readable (an
 *  invalid id, pr or run id makes it unreadable, and the store refuses the whole snapshot), and the state is either an
 *  ordinary word with no quarantine marker or the literal `unknown` with exactly the `stale-episode-head` marker. */
export function landingEntryFactsOfRow(row: Record<string, unknown>): LandingEntryFacts {
  const kindOk = absent(row.ejectionKind) || isLandingEjectionKind(row.ejectionKind);
  const afterIds = afterIdsOf(row.afterIds);
  const id = safeIntOf(row.id, 1);
  const pr = safeIntOf(row.pr, 1);
  const runId = absent(row.runId) ? null : safeIntOf(row.runId, 1);
  const runIdOk = absent(row.runId) || runId !== null;
  const fixesRaw = typeof row.fixesMain === 'bigint' ? Number(row.fixesMain) : row.fixesMain;
  const fixesOk = typeof fixesRaw === 'number' && (fixesRaw === 0 || fixesRaw === 1);
  const pinnedAt = safeIntOf(row.pinnedAt, 0);
  const ejections = safeIntOf(row.ejections, 0);
  const wordOk = isLandingEntryState(row.state) && row.state !== 'unknown';
  const displayOk = isLandingEntryState(row.state) && kindOk && afterIds !== null && fixesOk && pinnedAt !== null
    && ejections !== null && id !== null && pr !== null && runIdOk;
  const entry: LandingEntry = {
    id: id ?? Number(row.id), project: String(row.project), pr: pr ?? Number(row.pr), pinnedSha: String(row.pinnedSha),
    handoffCommit: String(row.handoffCommit), runId: absent(row.runId) ? null : (runId ?? Number(row.runId)),
    state: displayOk && isLandingEntryState(row.state) ? row.state : 'unknown',
    baseSha: absent(row.baseSha) ? null : String(row.baseSha),
    ejectionKind: kindOk && isLandingEjectionKind(row.ejectionKind) ? row.ejectionKind : null,
    ejections: ejections ?? 0, afterIds: afterIds ?? [], fixesMain: fixesOk && fixesRaw === 1,
    setBy: String(row.setBy), pinnedAt: pinnedAt ?? 0,
  };
  const marker = row.quarantineKind;
  const stateOk = wordOk ? absent(marker) : row.state === 'unknown' && marker === 'stale-episode-head';
  const baseOk = absent(row.baseSha) || hash40(row.baseSha);
  const readable = stateOk && kindOk && baseOk && afterIds !== null && fixesOk && pinnedAt !== null
    && ejections !== null && id !== null && pr !== null && runIdOk && nonblank(row.project) && hash40(row.pinnedSha)
    && hash40(row.handoffCommit) && nonblank(row.setBy);
  return {
    entry,
    dependencies: afterIds === null ? { kind: 'unreadable' } : { kind: 'readable', afterIds },
    projection: readable ? { kind: 'readable', quarantine: marker === 'stale-episode-head' ? 'stale-episode-head' : null }
      : { kind: 'unreadable' },
  };
}

/** One `landing_entries` row as a display entry: `landingEntryFactsOfRow(row).entry`. */
export function landingEntryOfRow(row: Record<string, unknown>): LandingEntry {
  return landingEntryFactsOfRow(row).entry;
}

/** DB-only evidence of the last verified pin of a projection (`landing_projection_witness`). */
export interface LandingProjectionWitness extends LandingIdentity {
  observedSeq: number; runId: number; pinnedSha: string; handoffCommit: string;
}

/** Whether a projection's association is consistent with the subject's latest surviving historical observation. Needs
 *  exact subject/entry identity. Agreement of the historical binding with the projection (no-run with a null run, run X
 *  with run X) means no known contradiction; no run is ever looked up by a historical id. A disagreement is readable
 *  only through a valid witness of the same identity, the subject's latest `observedSeq`, the projection's exact
 *  `runId`, `pinnedSha` and `handoffCommit`. */
export function landingAssociationReadable(f: {
  subject: LandingSubjectRef & { observedSeq: number };
  entry: LandingEntry;
  witness: LandingProjectionWitness | null;
}): boolean {
  const { subject: s, entry: e, witness: w } = f;
  if (s.id !== e.id || s.project !== e.project || s.pr !== e.pr) return false;
  const b = s.binding;
  if (b.kind === 'no-run' ? e.runId === null : e.runId === b.observedRunId) return true;
  if (w === null || e.runId === null) return false;
  return w.id === e.id && w.project === e.project && w.pr === e.pr && w.observedSeq === s.observedSeq
    && Number.isSafeInteger(w.observedSeq) && w.observedSeq >= 0 && w.runId === e.runId && w.runId > 0
    && hash40(w.pinnedSha) && w.pinnedSha === e.pinnedSha && hash40(w.handoffCommit) && w.handoffCommit === e.handoffCommit;
}

/** A recovered journal subject as the fold sees it: identity, latest historical observation, original creation and the
 *  authority (all from the overlay tables). */
export type LandingRecoverySubjectFact = LandingIdentity & {
  binding: LandingHistoricalBinding; observedSeq: number;
  creation: LandingRecoverySubject['creation']; authority: LandingRecoverySubject['authority'];
};

const sameIdentity = (a: LandingIdentity, b: LandingIdentity): boolean => a.id === b.id && a.project === b.project && a.pr === b.pr;
const identityOf = (x: LandingIdentity): LandingIdentity => ({ id: x.id, project: x.project, pr: x.pr });

/** The recovery of ONE project, a fold over values (shared contract §4): `subjects` are every recovered subject,
 *  `projections` the facts of every row of every project that can matter (all projects named by a subject or a
 *  colliding row), `witnesses` the witness rows. A subject is listed in this project's recovery when it lives in it or
 *  when a colliding projection does; it is listed only while unresolved, and the fold invents no hash, current run,
 *  counter or eligibility:
 *  - no projection of its exact identity is `missing` (association `unmeasured`);
 *  - the same id under another project/pr, or the same project/pr under another id, is an `identity-conflict` that lists
 *    every conflicting identity, and so appears in every involved project's recovery; nothing else resolves it;
 *  - an exact-identity projection whose run association contradicts the latest historical binding is
 *    `association-unmeasured` unless `landingAssociationReadable` accepts a matching witness.
 *  `hold` carries the sorted, deduplicated listed ids, or is null when nothing is listed. */
export function landingRecoveryOf(project: string, input: {
  subjects: readonly LandingRecoverySubjectFact[];
  projections: readonly LandingEntryFacts[];
  witnesses: readonly LandingProjectionWitness[];
}): LandingRecovery {
  const listed: LandingRecoverySubject[] = [];
  for (const s of input.subjects) {
    const conflicts: LandingIdentity[] = [];
    let exact: LandingEntry | null = null;
    for (const { entry: e } of input.projections) {
      if (sameIdentity(s, e)) exact = e;
      else if (e.id === s.id || (e.project === s.project && e.pr === s.pr)) conflicts.push(identityOf(e));
    }
    conflicts.sort((a, b) => a.id - b.id || (a.project < b.project ? -1 : a.project > b.project ? 1 : 0) || a.pr - b.pr);
    let projection: LandingRecoverySubject['projection'] | null;
    if (conflicts.length > 0) projection = { kind: 'identity-conflict', conflicts };
    else if (exact === null) projection = { kind: 'missing', association: 'unmeasured' };
    else {
      const witness = input.witnesses.find((w) => w.id === exact!.id) ?? null;
      projection = landingAssociationReadable({ subject: { id: s.id, project: s.project, pr: s.pr, binding: s.binding, observedSeq: s.observedSeq }, entry: exact, witness })
        ? null : { kind: 'association-unmeasured', reason: 'historical-binding-mismatch' };
    }
    if (projection === null) continue;
    const involved = s.project === project || conflicts.some((c) => c.project === project);
    if (!involved) continue;
    listed.push({ id: s.id, project: s.project, pr: s.pr, creation: s.creation,
      historical: { binding: s.binding, observedSeq: s.observedSeq }, projection, authority: s.authority });
  }
  listed.sort((a, b) => a.id - b.id);
  const ids = [...new Set(listed.map((x) => x.id))];
  return { subjects: listed, hold: ids.length > 0 ? { reason: 'landing-recovery-unresolved', subjectIds: ids } : null };
}

/** A project's two flags. An absent row reads both clear. A flag is false only when its value is `0` or `0n`; any other
 *  value reads as set (fail closed). */
export function landingFlagsOfRow(row: Record<string, unknown> | undefined): { operatorPaused: boolean; mainRedHold: boolean } {
  const set = (v: unknown): boolean => v !== 0 && v !== 0n;
  return row === undefined ? { operatorPaused: false, mainRedHold: false }
    : { operatorPaused: set(row.operatorPaused), mainRedHold: set(row.mainRedHold) };
}

// ── Landing order wave 5f: the guarded read's fold, the hold gate and the journal record (shared contract §4, §6) ──

/** Every landing row the store read, as values (a SELECT with `setReadBigInts(true)`, so no INTEGER is rounded). */
export interface LandingStoreRows {
  entries: Record<string, unknown>[];
  subjects: Record<string, unknown>[];
  authorities: Record<string, unknown>[];
  witnesses: Record<string, unknown>[];
  flags: Record<string, unknown> | undefined;
  /** `{id, claimedBy}` of the runs this project's entries name. */
  runs: Record<string, unknown>[];
}

const json = (v: unknown): unknown => { try { return typeof v === 'string' ? JSON.parse(v) : undefined; } catch { return undefined; } };
const UNREADABLE: LandingReadResult = { ok: false, error: 'landing-projection-unreadable', recovery: 'restart' };

/** The recovered subjects, from the overlay tables; null when a row is not what the SQL constraints promise. */
function subjectsOf(rows: LandingStoreRows): LandingRecoverySubjectFact[] | null {
  const out: LandingRecoverySubjectFact[] = [];
  for (const s of rows.subjects) {
    const id = safeIntOf(s.id, 1); const pr = safeIntOf(s.pr, 1); const observedSeq = safeIntOf(s.observedSeq, 1);
    if (id === null || pr === null || observedSeq === null || !nonblank(s.project)) return null;
    const run = absent(s.observedRunId) ? null : safeIntOf(s.observedRunId, 1);
    let binding: LandingHistoricalBinding;
    if (s.bindingKind === 'no-run' && absent(s.observedRunId)) binding = { kind: 'no-run' };
    else if (s.bindingKind === 'run' && run !== null) binding = { kind: 'run', observedRunId: run };
    else return null;
    let creation: LandingRecoverySubject['creation'] = { kind: 'not-recorded' };
    if (!absent(s.creationSeq)) {
      const seq = safeIntOf(s.creationSeq, 1); const c = json(s.creationClaim) as Record<string, unknown> | undefined;
      if (seq === null || typeof c !== 'object' || c === null || safeIntOf(c.at, 0) === null || !nonblank(c.setBy) || !hash40(c.pinnedSha) || !hash40(c.handoffCommit)) return null;
      creation = { kind: 'recorded', seq, claim: { at: c.at as number, setBy: c.setBy, pinnedSha: c.pinnedSha, handoffCommit: c.handoffCommit } };
    }
    let authority: LandingRecoverySubject['authority'] = { kind: 'not-set' };
    const a = rows.authorities.find((x) => safeIntOf(x.subjectId, 1) === id);
    if (a !== undefined) {
      const afterIds = afterIdsOf(a.afterIds); const seq = safeIntOf(a.seq, 1); const fixes = safeIntOf(a.fixesMain, 0);
      if (afterIds === null || seq === null || fixes === null || fixes > 1 || !nonblank(a.setBy)) return null;
      const value: LandingAuthority = { afterIds, fixesMain: fixes === 1, setBy: a.setBy, seq };
      authority = { kind: 'set', value };
    }
    out.push({ id, project: s.project, pr, binding, observedSeq, creation, authority });
  }
  return out;
}

/**
 * One project's coherent facts (shared contract §4). The authority overlay of a subject whose identity matches a
 * projection EXACTLY replaces that row's `afterIds`, `fixesMain` and `setBy` before the single row reader sees it. An
 * invalid id or pr in ANY row, or an overlay row that is not what its constraints promise, refuses the whole snapshot.
 * `nextId` is the one allocator's answer: MAX(projection ids, subject ids) + 1, null when that would overflow.
 */
export function landingFactsOf(project: string, rows: LandingStoreRows): LandingReadResult {
  const subjects = subjectsOf(rows);
  if (subjects === null) return UNREADABLE;
  const all: LandingEntryFacts[] = [];
  const mine: { facts: LandingEntryFacts; row: Record<string, unknown> }[] = [];
  const ids: number[] = subjects.map((s) => s.id);
  const foreign = new Set<number>(subjects.filter((s) => s.project !== project).map((s) => s.id));
  for (const row of rows.entries) {
    const id = safeIntOf(row.id, 1); const pr = safeIntOf(row.pr, 1);
    if (id === null || pr === null || typeof row.project !== 'string') return UNREADABLE;
    ids.push(id);
    const subject = subjects.find((s) => s.id === id && s.project === row.project && s.pr === pr);
    const set = subject?.authority.kind === 'set' ? subject.authority.value : null;
    const facts = landingEntryFactsOfRow(set === null ? row
      : { ...row, afterIds: JSON.stringify(set.afterIds), fixesMain: set.fixesMain ? 1 : 0, setBy: set.setBy });
    all.push(facts);
    if (row.project === project) mine.push({ facts, row }); else foreign.add(id);
  }
  const witnesses: LandingProjectionWitness[] = [];
  for (const w of rows.witnesses) {
    const id = safeIntOf(w.entryId, 1); const pr = safeIntOf(w.pr, 1); const observedSeq = safeIntOf(w.observedSeq, 0); const runId = safeIntOf(w.runId, 1);
    if (id !== null && pr !== null && observedSeq !== null && runId !== null && nonblank(w.project) && hash40(w.pinnedSha) && hash40(w.handoffCommit)) {
      witnesses.push({ id, project: w.project, pr, observedSeq, runId, pinnedSha: w.pinnedSha, handoffCommit: w.handoffCommit });
    }
  }
  const max = ids.reduce((m, n) => Math.max(m, n), 0);
  const coordinators: LandingMutationFacts['coordinators'] = mine.map(({ facts, row }) => {
    const id = facts.entry.id;
    if (absent(row.runId)) return { id, value: { kind: 'no-run' as const } };
    const runId = safeIntOf(row.runId, 1);
    const run = runId === null ? undefined : rows.runs.find((r) => safeIntOf(r.id, 1) === runId);
    const claimedBy = run?.claimedBy;
    const ok = runId !== null && run !== undefined && (claimedBy === null || typeof claimedBy === 'string');
    return { id, value: ok ? { kind: 'run' as const, runId, claimedBy: claimedBy as string | null } : { kind: 'unreadable' as const } };
  });
  return { ok: true, facts: {
    project, flags: landingFlagsOfRow(rows.flags), entries: mine.map((m) => m.facts.entry),
    recovery: landingRecoveryOf(project, { subjects, projections: all, witnesses }),
    projections: mine.map((m) => ({ id: m.facts.entry.id, value: m.facts.projection })),
    dependencies: mine.map((m) => ({ id: m.facts.entry.id, value: m.facts.dependencies })),
    nextId: max + 1 > Number.MAX_SAFE_INTEGER ? null : max + 1, foreignIds: [...foreign], coordinators,
  } };
}

export type LandingHoldGate =
  | { ok: true; own: LandingRecoverySubject | null }
  | { ok: false; error: Extract<LandingMutationCode, 'landing-recovery-unresolved' | 'landing-identity-conflict'> };

/**
 * Whether a pin, retreat or mark may go ahead while recovery holds the project (shared contract §6). A hold is refused to every
 * retreat and every pin, with two bounded exceptions: a pin may resolve its OWN subject's missing projection, or its
 * exact-identity association mismatch while that projection is readable; and a pin to a brand-new PR (no projection and
 * no recovered subject in the project) is allocated the next id and materialized normally. An identity collision anywhere in the project
 * has no exception and answers its own word.
 */
export function landingHoldGate(recovery: LandingRecovery, kind: 'pin' | 'retreat' | 'land', key: { project: string; pr: number },
  projection: LandingProjectionRead | null): LandingHoldGate {
  if (recovery.hold === null) return { ok: true, own: null };
  if (recovery.subjects.some((s) => s.projection.kind === 'identity-conflict')) return { ok: false, error: 'landing-identity-conflict' };
  // A mark only takes an entry out of the line and never chooses a head, so only the entry's own unresolved subject holds it.
  if (kind === 'land') {
    return recovery.subjects.some((s) => s.project === key.project && s.pr === key.pr)
      ? { ok: false, error: 'landing-recovery-unresolved' } : { ok: true, own: null };
  }
  const own = kind === 'pin' ? recovery.subjects.find((s) => s.project === key.project && s.pr === key.pr) : undefined;
  if (own !== undefined && (own.projection.kind === 'missing' || (own.projection.kind === 'association-unmeasured' && projection?.kind === 'readable'))) {
    return { ok: true, own };
  }
  // A brand-new PR (no projection, no recovered subject in this project) is no unrelated materialized subject: it takes
  // the allocator's next id and materializes normally, which cannot disturb any held subject.
  if (kind === 'pin' && own === undefined && projection === null) return { ok: true, own: null };
  return { ok: false, error: 'landing-recovery-unresolved' };
}

/** The journal record one decided (non-noop) mutation becomes. An order's source binding is the CURRENT association the
 *  decision read and carried (review 1413 A2): never re-read from the facts, so an unreadable one cannot become no-run. */
export function landingRecordOf(command: LandingAuthorityCommand,
  mutation: Extract<Extract<LandingMutationDecision, { ok: true }>['mutation'], { kind: 'entry' | 'order' }>,
  seq: number, at: number): LandingJournalRecord {
  if (mutation.kind === 'entry') {
    return { v: 1, seq, at, setBy: mutation.setBy, subject: { id: mutation.id, project: mutation.project, pr: mutation.pr, binding: { kind: 'no-run' } },
      kind: 'entry', claim: { pinnedSha: mutation.pinnedSha, handoffCommit: mutation.handoffCommit } };
  }
  return { v: 1, seq, at, setBy: command.setBy, subject: { id: mutation.entry.id, project: mutation.entry.project, pr: mutation.entry.pr, binding: mutation.binding },
    kind: 'order', after: mutation.after, fixesMain: mutation.fixesMain };
}
