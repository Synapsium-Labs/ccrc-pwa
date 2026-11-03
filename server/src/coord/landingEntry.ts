// L1: pure. The landing line's entry (landing order wave 5e): what an advance writes to it, decided from values, and
// the reader of its rows. No fs, no node:sqlite, no clock; the one writer, `CoordStore.advanceLanding` (L3), gathers
// the facts, calls `decideLandingWrite`, and acts inside its transaction. Value imports are L0 only.
import type { RunState } from '../../../shared/api.js';
import type { ChecksMode } from '../../../shared/landing.js';
import { isLandingEjectionKind, isLandingEntryState } from '../../../shared/landingLine.js';
import type {
  LandingEjectionKind, LandingEntry, LandingEntryState, LandingHistoricalBinding, LandingIdentity, LandingRecovery,
  LandingRecoverySubject, LandingSubjectRef,
} from '../../../shared/landingLine.js';

/** What the route asks the line to do with one advance, built by `landingAdvanceOf` from the target alone. */
export type LandingAdvance =
  | { kind: 'plain' }
  | { kind: 'pin'; head: string; pr: number | null; mode: ChecksMode; handoffCommit: string }
  | { kind: 'retreat'; ejection: { base: string; kind: LandingEjectionKind } | null };

/** What the line recorded, as the store answers it and the advance's 200 body carries it (D-7627). `no-pr`,
 *  `no-episode` and `no-entry` are in-process words, never wire refusal codes (D-7619). */
export type LandingWrite =
  | { kind: 'none' } | { kind: 'no-pr' } | { kind: 'no-episode' } | { kind: 'no-entry' }
  | { kind: 'kept'; state: LandingEntryState }
  | { kind: 'pinned'; entry: LandingEntry; created: boolean }
  | { kind: 'ejected'; entry: LandingEntry };

/** The composite's decision: a write that touches no row, or the one statement to run. */
export type LandingWriteDecision =
  | { act: 'none'; write: Extract<LandingWrite, { kind: 'none' | 'no-pr' | 'no-episode' | 'no-entry' | 'kept' }> }
  | { act: 'insert' } | { act: 'repin'; id: number }
  | { act: 'eject'; id: number; base: string | null; kind: LandingEjectionKind | null };

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
  current: LandingEntry | null; episode: { pr: number | null } | null }): LandingWriteDecision {
  const { landing, current } = f;
  if (landing.kind === 'plain') return { act: 'none', write: { kind: 'none' } };
  if (landing.kind === 'pin') {
    if (landing.pr === null) return { act: 'none', write: { kind: 'no-pr' } };
    if (current === null) return { act: 'insert' };
    if (current.state === 'pinned' || current.state === 'ejected') return { act: 'repin', id: current.id };
    return { act: 'none', write: { kind: 'kept', state: current.state } };
  }
  if (f.from !== 'merging') return { act: 'none', write: { kind: 'none' } };
  if (f.episode === null) return { act: 'none', write: { kind: 'no-episode' } };
  if (f.episode.pr === null) return { act: 'none', write: { kind: 'no-pr' } };
  if (current === null) return { act: 'none', write: { kind: 'no-entry' } };
  if (current.runId !== f.runId || current.state !== 'pinned') return { act: 'none', write: { kind: 'kept', state: current.state } };
  return { act: 'eject', id: current.id, base: landing.ejection?.base ?? null, kind: landing.ejection?.kind ?? null };
}

const isPositiveSafe = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** A stored `afterIds`: a JSON array of positive safe integers, or null for anything else. */
function afterIdsOf(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) && parsed.every(isPositiveSafe) ? parsed : null;
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
  const baseOk = absent(row.baseSha) || typeof row.baseSha === 'string';
  const consistent = baseOk && absent(row.baseSha) === absent(row.ejectionKind);
  const readable = stateOk && kindOk && consistent && afterIds !== null && fixesOk && pinnedAt !== null
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
