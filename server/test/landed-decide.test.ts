// Landing order wave 5h (Task 4): the landed reader's pure decisions (`coord/landed.ts`, L1).
import { describe, it, expect } from 'vitest';
import {
  LANDED_FRESH_MS, LANDED_READS_PER_SWEEP, LANDED_STANDING_BACKOFF_MS, landedAnswerOf, landedCandidatesOf, landedNext,
  isHeldRefusal, closeLandingOf, landedNoticeModeOf, mergedBody, mergedKey, mergedNoticeOf, pickLandedReads, type LandedCandidate, type LandedMemory,
} from '../src/coord/landed.js';
import { PR_BACKOFF_MAX_MS, PR_SWEEP_MS } from '../src/laneSchedule.js';
import type { PrMergedFacts, PrStatePrRead } from '../src/prstate.js';
import type { LandingMutationFacts } from '../src/coord/landingWrites.js';
import type { LandingEntry, LandingEntryState, LandingRecovery, LandingRecoverySubject } from '../../shared/landingLine.js';
import type { LandingProjectionRead } from '../src/coord/landingEntry.js';

const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const cand = (id: number, pinnedAt: number, over: Partial<LandedCandidate> = {}): LandedCandidate =>
  ({ project: 'project-a', id, pr: 100 + id, pinnedAt, pinnedSha: HEAD, runId: id, ...over });
const mem = (pinnedAt: number, over: Partial<LandedMemory> = {}): LandedMemory =>
  ({ pinnedAt, lastReadAt: 0, nextAt: 0, step: PR_SWEEP_MS, missingStreak: 0, ...over });
const NO_HOLD = { hold: null, subjects: [] };
const ids = (cs: LandedCandidate[]): number[] => cs.map((c) => c.id);

describe('pickLandedReads', () => {
  it('twelve never-read candidates pick the ten earliest pinnedAt', () => {
    const cs = Array.from({ length: 12 }, (_, i) => cand(i + 1, 5000 - i * 10)); // id 12 is the earliest pin
    const picked = pickLandedReads(cs, new Map(), 10_000);
    expect(picked).toHaveLength(LANDED_READS_PER_SWEEP);
    expect(ids(picked)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it('every candidate read before: the least recently read comes first, though its pinnedAt is later', () => {
    const early = cand(1, 100);
    const late = cand(2, 900);
    const memory = new Map([[1, mem(100, { lastReadAt: 5000 })], [2, mem(900, { lastReadAt: 1000 })]]);
    expect(ids(pickLandedReads([early, late], memory, 10_000, 1))).toEqual([2]);
  });

  it('a never-read candidate comes before one read before', () => {
    const memory = new Map([[1, mem(100, { lastReadAt: 5000 })]]);
    expect(ids(pickLandedReads([cand(1, 100), cand(2, 900)], memory, 10_000, 1))).toEqual([2]);
  });

  it('ties break on the earlier pinnedAt, then the lower id', () => {
    expect(ids(pickLandedReads([cand(3, 50), cand(2, 50), cand(1, 70)], new Map(), 0))).toEqual([2, 3, 1]);
  });

  it('a candidate whose memory is not yet due is skipped; one due exactly now is picked', () => {
    const memory = new Map([[1, mem(100, { nextAt: 10_001 })], [2, mem(200, { nextAt: 10_000 })]]);
    expect(ids(pickLandedReads([cand(1, 100), cand(2, 200)], memory, 10_000))).toEqual([2]);
  });

  it('a re-pinned entry is due at once, whatever its memory says', () => {
    const memory = new Map([[1, mem(100, { nextAt: 999_999 })]]);
    expect(ids(pickLandedReads([cand(1, 777)], memory, 10_000))).toEqual([1]);
  });
});

describe('landedAnswerOf', () => {
  const facts = { headRefOid: HEAD, baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-11-11T10:00:00Z', mergeCommit: MERGE };
  it('merged lands with its facts, the train included', () => {
    const train = { number: 50, mergeCommit: 'e'.repeat(40) };
    expect(landedAnswerOf({ state: 'merged', pr: 7, facts, train: null })).toEqual({ act: 'land',
      outcome: { word: 'merged', head: HEAD, base: 'main', mergedAt: '2026-11-11T10:00:00Z', mergeCommit: MERGE, train: null } });
    expect(landedAnswerOf({ state: 'merged', pr: 7, facts, train })).toMatchObject({ act: 'land', outcome: { train } });
  });
  it('closed and absent close; open waits', () => {
    expect(landedAnswerOf({ state: 'closed', pr: 7, facts, train: null })).toEqual({ act: 'close', outcome: { word: 'closed' } });
    expect(landedAnswerOf({ state: 'absent', pr: 7 })).toEqual({ act: 'close', outcome: { word: 'absent' } });
    expect(landedAnswerOf({ state: 'open', pr: 7, facts, train: null })).toEqual({ act: 'wait' });
  });
  it('unmeasured and a failed call retry; only ccd\'s missing-field says so', () => {
    const ccd = (reason: Extract<PrStatePrRead, { by: 'ccd' }>['reason']): PrStatePrRead => ({ state: 'unmeasured', pr: 7, by: 'ccd', reason, train: null });
    expect(landedAnswerOf(ccd('timeout'))).toEqual({ act: 'retry', missingField: false });
    expect(landedAnswerOf(ccd('missing-field'))).toEqual({ act: 'retry', missingField: true });
    expect(landedAnswerOf({ state: 'unmeasured', pr: 7, by: 'reader', reason: 'fields', train: null })).toEqual({ act: 'retry', missingField: false });
    expect(landedAnswerOf({ state: 'call-failed' })).toEqual({ act: 'retry', missingField: false });
  });
});

describe('landedNext', () => {
  const c = cand(1, 100);
  it('a mark held at the write is due again at the next pass, with the step reset and the streak cleared', () => {
    const prev = mem(100, { step: 4 * PR_SWEEP_MS, missingStreak: 1 });
    expect(landedNext(prev, c, { act: 'held' }, 1000)).toEqual({ pinnedAt: 100, lastReadAt: 1000, nextAt: 1000, step: PR_SWEEP_MS, missingStreak: 0 });
    expect(pickLandedReads([c], new Map([[1, landedNext(prev, c, { act: 'held' }, 1000)]]), 1001)).toHaveLength(1);
  });
  it('isHeldRefusal names exactly the two recovery words', () => {
    expect(['landing-recovery-unresolved', 'landing-identity-conflict', 'landing-fenced', 'landing-db-apply', 'moved'].filter(isHeldRefusal))
      .toEqual(['landing-recovery-unresolved', 'landing-identity-conflict']);
  });
  it('a wait is due one beat later and resets the step and the streak', () => {
    const prev = mem(100, { step: PR_BACKOFF_MAX_MS, missingStreak: 1 });
    expect(landedNext(prev, c, { act: 'wait' }, 1000)).toEqual({ pinnedAt: 100, lastReadAt: 1000, nextAt: 1000 + PR_SWEEP_MS, step: PR_SWEEP_MS, missingStreak: 0 });
  });
  it('a retry doubles the step from the beat up to the ceiling', () => {
    let m: LandedMemory | undefined;
    const steps: number[] = [];
    for (let i = 0; i < 5; i++) {
      m = landedNext(m, c, { act: 'retry', missingField: false }, 0);
      steps.push(m.step);
    }
    expect(steps).toEqual([2 * PR_SWEEP_MS, 4 * PR_SWEEP_MS, PR_BACKOFF_MAX_MS, PR_BACKOFF_MAX_MS, PR_BACKOFF_MAX_MS]);
    expect(m!.nextAt).toBe(PR_BACKOFF_MAX_MS);
  });
  it('memory of another pin is not carried', () => {
    const stale = mem(1, { step: PR_BACKOFF_MAX_MS, missingStreak: 1 });
    expect(landedNext(stale, c, { act: 'retry', missingField: true }, 0)).toMatchObject({ pinnedAt: 100, step: 2 * PR_SWEEP_MS, missingStreak: 1 });
  });
  it('one missing-field is an ordinary retry, the second is due an hour later, and an open between them resets the streak', () => {
    const miss = { act: 'retry', missingField: true } as const;
    const first = landedNext(undefined, c, miss, 0);
    expect(first).toMatchObject({ missingStreak: 1, nextAt: 2 * PR_SWEEP_MS });
    const second = landedNext(first, c, miss, 10);
    expect(second).toMatchObject({ missingStreak: 2, nextAt: 10 + LANDED_STANDING_BACKOFF_MS });
    const reset = landedNext(first, c, { act: 'wait' }, 10);
    expect(landedNext(reset, c, miss, 20)).toMatchObject({ missingStreak: 1, nextAt: 20 + 2 * PR_SWEEP_MS });
    expect(landedNext(first, c, { act: 'retry', missingField: false }, 10).missingStreak).toBe(0);
  });
});

describe('landedCandidatesOf', () => {
  const entry = (id: number, state: LandingEntryState): LandingEntry => ({ id, project: 'project-a', pr: 100 + id, pinnedSha: HEAD, handoffCommit: HEAD,
    runId: id, state, baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: id * 10 });
  const readable: LandingProjectionRead = { kind: 'readable', quarantine: null };
  it('a pinned and an ejected entry with a readable projection are candidates; the others are not', () => {
    const entries = [entry(1, 'pinned'), entry(2, 'ejected'), entry(3, 'landed'), entry(4, 'unknown'), entry(5, 'pinned'), entry(6, 'pinned'), entry(7, 'closed')];
    const projections: LandingMutationFacts['projections'] = [
      { id: 1, value: readable }, { id: 2, value: readable }, { id: 3, value: readable },
      { id: 4, value: { kind: 'readable', quarantine: 'stale-episode-head' } },
      { id: 5, value: { kind: 'unreadable' } as LandingProjectionRead },
      { id: 6, value: { kind: 'readable', quarantine: 'stale-episode-head' } },
      { id: 7, value: readable },
    ];
    const got = landedCandidatesOf({ entries, projections, recovery: NO_HOLD } as unknown as LandingMutationFacts);
    expect(ids(got)).toEqual([1, 2]);
    expect(got[0]).toEqual({ project: 'project-a', id: 1, pr: 101, pinnedAt: 10, pinnedSha: HEAD, runId: 1 });
  });
  it('an entry with no projection at all is not a candidate', () => {
    expect(landedCandidatesOf({ entries: [entry(1, 'pinned')], projections: [], recovery: NO_HOLD } as unknown as LandingMutationFacts)).toEqual([]);
  });
  // A held subject is skipped here, by the land arm's own rule (`landingHoldGate`), so it costs no `ccd pr-state --pr` call.
  const subject = (project: string, pr: number, projection: LandingRecoverySubject['projection']): LandingRecoverySubject => ({
    id: 1, project, pr, creation: { kind: 'not-recorded' }, historical: { binding: { kind: 'no-run' }, observedSeq: 1 },
    projection, authority: { kind: 'not-set' },
  });
  const held = (...subjects: LandingRecoverySubject[]): LandingRecovery =>
    ({ hold: { reason: 'landing-recovery-unresolved', subjectIds: subjects.map((x) => x.id) }, subjects });
  const MISSING: LandingRecoverySubject['projection'] = { kind: 'missing', association: 'unmeasured' };
  const facts2 = (recovery: LandingRecovery): LandingMutationFacts => ({
    entries: [entry(1, 'pinned'), entry(2, 'pinned')], projections: [{ id: 1, value: readable }, { id: 2, value: readable }], recovery,
  }) as unknown as LandingMutationFacts;
  it('an entry that is its own unresolved recovery subject is skipped; its neighbour is still a candidate', () => {
    const got = landedCandidatesOf(facts2(held(subject('project-a', 101, MISSING))));
    expect(ids(got)).toEqual([2]);
  });
  it('a subject of another project holds nothing here', () => {
    expect(ids(landedCandidatesOf(facts2(held(subject('project-b', 101, MISSING)))))).toEqual([1, 2]);
  });
  it('an identity conflict holds the whole project: no candidate', () => {
    expect(landedCandidatesOf(facts2(held(subject('project-a', 150, { kind: 'identity-conflict', conflicts: [] }))))).toEqual([]);
  });
});

describe('the merged record', () => {
  it('mergedNoticeOf builds the whole record, for the reader\'s inputs and for announceMerged\'s', () => {
    expect(mergedNoticeOf({ pr: 42, reason: null, sessionId: 'lane-a-demo', workspace: 'demo', key: 'lane-a-demo#42' })).toEqual({
      kind: 'merged', sessionId: 'lane-a-demo', title: '✓ merged › demo', body: 'PR #42 merged; nothing archived.', runId: null,
      dedupeKey: 'lane-a-demo#42', tag: 'merged-lane-a-demo#42',
    });
    expect(mergedNoticeOf({ pr: null, reason: 'run 5 is still open', sessionId: 's', workspace: 'w', key: mergedKey('s', null) })).toEqual({
      kind: 'merged', sessionId: 's', title: '✓ merged › w', body: 'PR #? merged — run 5 is still open; nothing archived.', runId: null,
      dedupeKey: 's#?', tag: 'merged-s#?',
    });
  });
  it('mergedBody\'s two sentences, byte for byte', () => {
    expect(mergedBody(9, null)).toBe('PR #9 merged; nothing archived.');
    expect(mergedBody(9, 'held by x')).toBe('PR #9 merged — held by x; nothing archived.');
  });
  it('the mode: record-always inside the fresh window, record-only after it and with no mergedAt', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(landedNoticeModeOf(new Date(now - LANDED_FRESH_MS).toISOString(), now)).toBe('record-always');
    expect(landedNoticeModeOf(new Date(now - LANDED_FRESH_MS - 1).toISOString(), now)).toBe('record-only');
    expect(landedNoticeModeOf(null, now)).toBe('record-only');
    expect(landedNoticeModeOf('not a date', now)).toBe('record-only');
  });
});

describe('closeLandingOf', () => {
  const facts: PrMergedFacts = { pr: 7, head: HEAD, base: 'main', mergedAt: '2026-11-11T10:00:00Z', mergeCommit: MERGE };
  it('a done close with merged facts lands by the close, with no compare-and-set', () => {
    expect(closeLandingOf({ state: 'done', facts, project: 'project-a', at: 5 })).toEqual({
      kind: 'land', project: 'project-a', pr: 7, by: 'close', at: 5, expect: null,
      outcome: { word: 'merged', head: HEAD, base: 'main', mergedAt: '2026-11-11T10:00:00Z', mergeCommit: MERGE, train: null },
    });
  });
  it('a done close with no facts is null', () => {
    expect(closeLandingOf({ state: 'done', facts: null, project: 'project-a', at: 5 })).toBeNull();
  });
  it('a failed close is null, facts or not', () => {
    expect(closeLandingOf({ state: 'failed', facts, project: 'project-a', at: 5 })).toBeNull();
  });
});
