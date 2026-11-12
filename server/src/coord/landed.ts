// L1: pure (context C4, landing order wave 5h). The landed reader's decisions, from values: which entries of the line it
// may read, which ten it reads this sweep, what one PR-keyed answer means for the entry, when the entry is read again,
// and the `merged` feed record the mark raises. No fs, no node:sqlite, no clock, no ccd: `landedLane.ts` (L4) gathers
// the facts, makes the call and acts on these answers. Value imports are L0 and the lane table only; the landable rule
// is `landingEntry.ts#isLandable`, the same predicate the land arm calls, so the lane re-states none of it.
import { PR_BACKOFF_MAX_MS, PR_SWEEP_MS } from '../laneSchedule.js';
import { isLandable, landingHoldGate } from './landingEntry.js';
import type { LandingLand, LandingOutcome } from './landingEntry.js';
import type { LandingMutationFacts } from './landingWrites.js';
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

/** One entry the reader may read: a row the land arm could mark. */
export interface LandedCandidate {
  project: string; id: number; pr: number; pinnedAt: number; pinnedSha: string; runId: number | null;
}

/** The entries of one project's facts that are landable and not held, in the facts' order. A held subject is the line's
 *  to repair, not the PR's to answer: the store would refuse its mark, so it is skipped HERE (the one hold rule, the
 *  land arm's own `landingHoldGate`) and costs no `ccd pr-state --pr` call. It stays due, so it is read the sweep after
 *  the hold clears. */
export function landedCandidatesOf(facts: LandingMutationFacts): LandedCandidate[] {
  const out: LandedCandidate[] = [];
  for (const e of facts.entries) {
    const projection = facts.projections.find((p) => p.id === e.id)?.value ?? null;
    if (!isLandable(e.state, projection)) continue;
    if (!landingHoldGate(facts.recovery, 'land', { project: e.project, pr: e.pr }, projection).ok) continue;
    out.push({ project: e.project, id: e.id, pr: e.pr, pinnedAt: e.pinnedAt, pinnedSha: e.pinnedSha, runId: e.runId });
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
export const isHeldRefusal = (error: string): boolean => error === 'landing-recovery-unresolved' || error === 'landing-identity-conflict';

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
