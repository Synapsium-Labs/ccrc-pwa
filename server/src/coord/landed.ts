// L1: pure (context C4, landing order wave 5h). The landed reader's decisions, from values: which entries of the line it
// may read, which ten it reads this sweep, what one PR-keyed answer means for the entry, when the entry is read again,
// and the `merged` feed record the mark raises. No fs, no node:sqlite, no clock, no ccd: `landedLane.ts` (L4) gathers
// the facts, makes the call and acts on these answers. Value imports are the lane table (`laneSchedule.js`) and two L1
// rules from `landingEntry.ts`: `isLandable` (the landable rule) and `landingHoldGate` (the hold rule), the same functions
// the land arm calls, so the lane re-states neither. Every other import is type-only.
import { PR_BACKOFF_MAX_MS, PR_SWEEP_MS } from '../laneSchedule.js';
import { isLandable, landingHoldGate } from './landingEntry.js';
import type { LandingHoldGate, LandingLand, LandingLandWrite, LandingOutcome } from './landingEntry.js';
import type { LandingMutationFacts, LandingReadResult } from './landingWrites.js';
import type { CcdResult, WatcherCoordPort } from './ports.js';
import type { LandingLandResult } from './store.js';
import type { NoticeMode, NoticeRecord } from '../notice.js';
import type { PrMergedFacts, PrStatePrRead } from '../prstate.js';

/** How many entries one sweep reads: the PR lane reads one project a call, this reads one PR a call. */
export const LANDED_READS_PER_SWEEP = 10;
/** The wait after a second `missing-field` in a row (decision 6): the box's ccd cannot print the field, so asking at
 *  the ordinary beat only repeats the question. */
export const LANDED_STANDING_BACKOFF_MS = 60 * 60_000;
/** A merge younger than this is news (decision 9): it is archived even while the operator watches the session. */
export const LANDED_FRESH_MS = 60 * 60_000;

/** The identity of one merged announcement: the workspace AND the PR that merged. Defined once because two things key
 *  on it and they must not drift: `mergedNotified` (say it once) and the push's collapse tag (replace only what is
 *  genuinely the same statement). A workspace outlives its own merge now, so `id` alone is not an identity. Moved here
 *  from `watch.ts` unchanged (wave 5h), because the landed reader raises the same record. */
export const mergedKey = (id: string, number: number | null): string => `${id}#${number ?? '?'}`;
/** The merged announcement's body, built in ONE place (landing-order wave 3d): `announceMerged` writes it, and
 *  `sweepMerged`'s durable read matches a row archived before the once-only key existed by exactly this text. */
export const mergedBody = (number: number | null, reason: string | null): string => reason === null
  ? `PR #${number ?? '?'} merged; nothing archived.`
  : `PR #${number ?? '?'} merged — ${reason}; nothing archived.`;

/** One entry the reader may read: a row the land arm could mark. `repairToken` (wave 5i, D-8626) is present only on a
 *  terminal-repair candidate: a row that does not read, whose `terminalRepairs` verdict is eligible. */
export interface LandedCandidate {
  project: string; id: number; pr: number; pinnedAt: number; pinnedSha: string; runId: number | null; repairToken?: string;
}

/** The land arm's compare-and-set for a candidate: the entry the reader read, and a repair candidate's token beside it. */
export function landedExpectOf(c: LandedCandidate): NonNullable<LandingLand['expect']> {
  return { id: c.id, pinnedAt: c.pinnedAt, ...(c.repairToken === undefined ? {} : { repairToken: c.repairToken }) };
}

/** The entries of one project's facts that are landable and not held, in the facts' order. A held subject is the line's
 *  to repair, not the PR's to answer: the store would refuse its mark, so it is skipped HERE (the one hold rule, the
 *  land arm's own `landingHoldGate`) and costs no `ccd pr-state --pr` call. On a complete pass its memory is pruned, so
 *  it is due at once when the hold clears, still competing for the ten reads; on an incomplete pass the memory is kept, so it is read when its `nextAt` comes. */
export function landedCandidatesOf(facts: LandingMutationFacts): LandedCandidate[] {
  const out: LandedCandidate[] = [];
  for (const e of facts.entries) {
    const projection = facts.projections.find((p) => p.id === e.id)?.value ?? null;
    // Normal first: `isLandable` is the strict gate and stays. A row that does not read is a candidate only through its
    // separate terminal verdict (Amendment B), which carries its token and never makes the projection look readable.
    const repair = facts.terminalRepairs.find((r) => r.id === e.id)?.value;
    const token = isLandable(e.state, projection) ? undefined : repair?.kind === 'eligible' ? repair.token : null;
    if (token === null) continue;
    if (!landingHoldGate(facts.recovery, 'land', { project: e.project, pr: e.pr }, projection).ok) continue;
    out.push({ project: e.project, id: e.id, pr: e.pr, pinnedAt: e.pinnedAt, pinnedSha: e.pinnedSha, runId: e.runId,
      ...(token === undefined ? {} : { repairToken: token }) });
  }
  return out;
}

/** What the lane remembers of one entry between sweeps, keyed by the entry's id. */
export interface LandedMemory { pinnedAt: number; lastReadAt: number; nextAt: number; step: number; missingStreak: number }

/** The memory that still speaks for this candidate: none for a re-pinned entry (a re-pin is a new fact). */
const memoryOf = (memory: ReadonlyMap<number, LandedMemory>, c: LandedCandidate): LandedMemory | undefined => {
  const m = memory.get(c.id);
  return m !== undefined && m.pinnedAt === c.pinnedAt ? m : undefined;
};

/** The due candidates, never-read first, then the least recently read, then the earlier pin, then the lower id; at most
 *  `cap`. */
export function pickLandedReads(
  cands: readonly LandedCandidate[], memory: ReadonlyMap<number, LandedMemory>, now: number, cap = LANDED_READS_PER_SWEEP,
): LandedCandidate[] {
  const due = cands.filter((c) => {
    const m = memoryOf(memory, c);
    return m === undefined || m.nextAt <= now;
  });
  const lastRead = (c: LandedCandidate): number => memoryOf(memory, c)?.lastReadAt ?? -Infinity;
  due.sort((a, b) => {
    const ra = lastRead(a);
    const rb = lastRead(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.pinnedAt - b.pinnedAt || a.id - b.id;
  });
  return due.slice(0, Math.max(0, cap));
}

/** What one read means for the entry. `retry` is an unmeasured answer or a failed call; `missingField` is true only
 *  for ccd's own `missing-field`. */
export type LandedReadAnswer =
  | { act: 'land'; outcome: LandingOutcome }
  | { act: 'close'; outcome: LandingOutcome }
  | { act: 'wait' }
  | { act: 'retry'; missingField: boolean };
/** What `landedNext` remembers: a read's answer, or a mark held at the write. */
export type LandedAnswer = LandedReadAnswer | { act: 'held' };

/** The two refusals of a mark that the line's recovery hold causes (the hold appeared between the read and the write):
 *  they say nothing about the PR, so the entry is remembered as `held` and read again at the next pass. */
type HeldWord = Extract<LandingHoldGate, { ok: false }>['error'];
/** Exhaustive over the hold gate's refusal words, which the gate spells out literally (not through an `Extract` of the
 *  mutation codes, which would drop a word that is not one of them): a third word is a compile error here until it is placed. */
const HELD_WORDS: Record<HeldWord, true> = { 'landing-recovery-unresolved': true, 'landing-identity-conflict': true };
export const isHeldRefusal = (error: string): error is HeldWord => Object.hasOwn(HELD_WORDS, error);

export function landedAnswerOf(read: PrStatePrRead | { state: 'call-failed' }): LandedReadAnswer {
  switch (read.state) {
    case 'merged':
      return { act: 'land', outcome: { word: 'merged', head: read.facts.headRefOid, base: read.facts.baseRefName,
        mergedAt: read.facts.mergedAt, mergeCommit: read.facts.mergeCommit, train: read.train } };
    case 'closed': return { act: 'close', outcome: { word: 'closed' } };
    case 'absent': return { act: 'close', outcome: { word: 'absent' } };
    case 'open': return { act: 'wait' };
    case 'unmeasured': return { act: 'retry', missingField: read.by === 'ccd' && read.reason === 'missing-field' };
    case 'call-failed': return { act: 'retry', missingField: false };
  }
}

/** The entry's memory after a read at `now` (the pass's start: the lane takes it once per pass). A `held` mark is due at
 *  the next pass, with the step and the streak reset. A wait is due one PR beat later and resets the step; a retry doubles the
 *  step from the beat to the PR backoff's ceiling; the second `missing-field` in a row is due an hour later, and any
 *  other answer resets the streak. */
export function landedNext(prev: LandedMemory | undefined, cand: LandedCandidate, answer: LandedAnswer, now: number): LandedMemory {
  const kept = prev !== undefined && prev.pinnedAt === cand.pinnedAt ? prev : undefined;
  if (answer.act === 'held') return { pinnedAt: cand.pinnedAt, lastReadAt: now, nextAt: now, step: PR_SWEEP_MS, missingStreak: 0 };
  if (answer.act !== 'retry') {
    return { pinnedAt: cand.pinnedAt, lastReadAt: now, nextAt: now + PR_SWEEP_MS, step: PR_SWEEP_MS, missingStreak: 0 };
  }
  const step = Math.min((kept?.step ?? PR_SWEEP_MS) * 2, PR_BACKOFF_MAX_MS);
  const streak = answer.missingField ? (kept?.missingStreak ?? 0) + 1 : 0;
  const wait = streak >= 2 ? LANDED_STANDING_BACKOFF_MS : step;
  return { pinnedAt: cand.pinnedAt, lastReadAt: now, nextAt: now + wait, step, missingStreak: streak };
}

/** A `merged` feed record with the once-only key and the push's collapse tag beside it. */
export type MergedNotice = NoticeRecord & { dedupeKey: string; tag: string };

/** The ONE builder of a `merged` feed record. `runId` is `null`: a `merged` event belongs to no programme, so it stays
 *  out of `CoordStore.feedEventsForProgram`. */
export function mergedNoticeOf(f: { pr: number | null; reason: string | null; sessionId: string; workspace: string; key: string }): MergedNotice {
  return {
    kind: 'merged', sessionId: f.sessionId,
    title: `✓ merged › ${f.workspace}`,
    body: mergedBody(f.pr, f.reason),
    runId: null,
    dedupeKey: f.key,
    tag: `merged-${f.key}`,
  };
}

/** `record-always` for a merge within `LANDED_FRESH_MS` of `now` (archived even while the operator views the session;
 *  still pushed when nobody does), `record-only` for an older merge or one with no `mergedAt` (decision 9). */
export function landedNoticeModeOf(mergedAt: string | null, now: number): NoticeMode {
  if (mergedAt === null) return 'record-only';
  const at = Date.parse(mergedAt);
  return Number.isFinite(at) && now - at <= LANDED_FRESH_MS ? 'record-always' : 'record-only';
}

/** The close's mark (landing order wave 5h): a `done` work close whose own re-measure read the bound PR MERGED lands the
 *  entry by the close, with no compare-and-set (`expect: null`: the close read no entry). Anything else, an abandon
 *  included, is null. */
export function closeLandingOf(f: { state: 'done' | 'failed'; facts: PrMergedFacts | null; project: string; at: number }): LandingLand | null {
  if (f.state !== 'done' || f.facts === null) return null;
  const { pr, head, base, mergedAt, mergeCommit } = f.facts;
  return { kind: 'land', project: f.project, pr, by: 'close', at: f.at, expect: null,
    outcome: { word: 'merged', head, base, mergedAt, mergeCommit, train: null } };
}

/** What `landingReadProjects` answers, named from the port so the lane's call and this decision cannot drift. */
export type LandingProjectsRead = ReturnType<WatcherCoordPort['landingReadProjects']>;

/** The stopped warning, said once per process by the lane: the key is the latch, the line is the text. */
export function landedStopped(error: string): { key: string; line: string } {
  return { key: `stopped:${error}`, line: `ccrc-server: landed reader: stopped (${error}); no entry is read until it clears` };
}

/** The pass's first read: the projects to walk, or the store's refusal, which ends the pass. */
export function landedProjectsStep(read: LandingProjectsRead): { act: 'projects'; projects: string[] } | { act: 'stop'; error: string } {
  return read.ok ? { act: 'projects', projects: read.projects } : { act: 'stop', error: read.error };
}

/** One project's read: its candidates; an unreadable projection skips the project (the inventory is then incomplete);
 *  any other refusal stops the pass. */
export function landedProjectStep(read: LandingReadResult):
  { act: 'candidates'; candidates: LandedCandidate[] } | { act: 'skip' } | { act: 'stop'; error: string } {
  if (read.ok) return { act: 'candidates', candidates: landedCandidatesOf(read.facts) };
  if (read.error === 'landing-projection-unreadable') return { act: 'skip' };
  return { act: 'stop', error: read.error };
}

/** The memory ids to drop: on a COMPLETE inventory, those no candidate holds; on an incomplete one, none (an unvisited
 *  project's entries keep their `nextAt`). */
export function landedPruneIds(complete: boolean, candidates: readonly LandedCandidate[], memory: ReadonlyMap<number, LandedMemory>): number[] {
  if (!complete) return [];
  const live = new Set(candidates.map((c) => c.id));
  return [...memory.keys()].filter((id) => !live.has(id));
}

/** What a mark's answer means: recorded; held (the hold appeared between the read and the write, so it is read again
 *  next pass); or a stop with the warning to say once (the two fence words say the line is fenced until restart). */
export function landedMarkStep(mark: LandingLandResult, candidate: LandedCandidate):
  { act: 'marked'; write: LandingLandWrite } | { act: 'held' } | { act: 'stop'; key: string; line: string } {
  if (mark.ok) return { act: 'marked', write: mark.landing };
  if (isHeldRefusal(mark.error)) return { act: 'held' };
  if (mark.error === 'landing-db-apply' || mark.error === 'landing-db-commit') {
    return { act: 'stop', key: `fence:${mark.error}`,
      line: `ccrc-server: landed reader: the mark of ${candidate.project} #${candidate.pr} answered ${mark.error}; the landing line is fenced until the server restarts` };
  }
  return { act: 'stop', ...landedStopped(mark.error) };
}

/** What a `ccd pr-state --pr` call means, `ran` read FIRST (the not-ran arm is this decider's, never the lane's): a call
 *  that did not run is no answer about the PR, so the entry is remembered with the retry answer, no read is counted and the
 *  pass stops on the link (`answer` and `stopped` are what the lane applies); one that ran and failed backs the entry off
 *  and the pass goes on; an exit 0 is parsed by the lane with the PR parser. */
export function landedCallStep(call: CcdResult):
  { act: 'parse'; stdout: string } | { act: 'failed' } | { act: 'not-ran'; answer: LandedReadAnswer; stopped: 'link' } {
  if (call.ran === false) return { act: 'not-ran', answer: { act: 'retry', missingField: false }, stopped: 'link' };
  return call.ok ? { act: 'parse', stdout: call.stdout } : { act: 'failed' };
}

/** The second `missing-field` in a row says so once (hourly reading follows); any other streak says nothing. */
export function landedMissingWarning(candidate: LandedCandidate, next: LandedMemory): { key: string; line: string } | null {
  if (next.missingStreak !== 2) return null;
  return { key: `missing-field:${candidate.id}`,
    line: `ccrc-server: landed reader: ${candidate.project} #${candidate.pr} reads missing-field twice; reading it hourly` };
}

/** A failed `merged` feed record after a committed mark warns and the pass goes on: the mark is the fact, the record is news. */
export function landedNoticeFailure(candidate: LandedCandidate, error: string): { line: string; continue: true } {
  return { line: `ccrc-server: landed reader: the merged record of ${candidate.project} #${candidate.pr} failed (${error})`, continue: true };
}
