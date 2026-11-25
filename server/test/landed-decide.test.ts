// Landing order wave 5h (Task 4): the landed reader's pure decisions (`coord/landed.ts`, L1).
import { describe, it, expect } from 'vitest';
import {
  LANDED_FRESH_MS, LANDED_READS_PER_SWEEP, LANDED_STANDING_BACKOFF_MS, landedAnswerOf, landedCallStep, landedCandidatesOf, landedNext,
  isHeldRefusal, closeLandingOf, landedExpectOf, landedNoticeModeOf, mergedBody, mergedKey, mergedNoticeOf, pickLandedReads, type LandedCandidate, type LandedMemory,
} from '../src/coord/landed.js';
import { PR_BACKOFF_MAX_MS, PR_SWEEP_MS } from '../src/laneSchedule.js';
import type { PrMergedFacts, PrStatePrRead } from '../src/prstate.js';
import type { LandingMutationFacts } from '../src/coord/landingWrites.js';
import type { LandingEntry, LandingEntryState, LandingRecovery, LandingRecoverySubject } from '../../shared/landingLine.js';
import type { LandingProjectionRead } from '../src/coord/landingEntry.js';
import type { CcdResult } from '../src/coord/ports.js';
import { parseFile } from './scan/parse.js';
import { REPO_ROOT } from './scan/symbols.js';
import { codeOf } from './consolidationCensus.js';

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
  /** A real `LandingMutationFacts`: the fields the test is about, honest empty values for the rest. */
  const factsOf = (o: { entries: LandingEntry[]; projections: LandingMutationFacts['projections']; recovery: LandingRecovery;
    terminalRepairs?: LandingMutationFacts['terminalRepairs'] }): LandingMutationFacts => ({
    project: 'project-a', flags: { operatorPaused: false, mainRedHold: false }, entries: o.entries, projections: o.projections,
    stateWords: o.entries.map((e) => ({ id: e.id, value: e.state })),
    dependencies: o.entries.map((e) => ({ id: e.id, value: { kind: 'readable' as const, afterIds: [] } })),
    recovery: o.recovery, nextId: Math.max(0, ...o.entries.map((e) => e.id)) + 1, foreignIds: [],
    coordinators: o.entries.map((e) => ({ id: e.id, value: { kind: 'no-run' as const } })),
    terminalRepairs: o.terminalRepairs ?? [], creations: [],
  });
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
    const got = landedCandidatesOf(factsOf({ entries, projections, recovery: NO_HOLD }));
    expect(ids(got)).toEqual([1, 2]);
    expect(got[0]).toEqual({ project: 'project-a', id: 1, pr: 101, pinnedAt: 10, pinnedSha: HEAD, runId: 1 });
  });
  it('an entry with no projection at all is not a candidate', () => {
    expect(landedCandidatesOf(factsOf({ entries: [entry(1, 'pinned')], projections: [], recovery: NO_HOLD }))).toEqual([]);
  });
  // A held subject is skipped here, by the land arm's own rule (`landingHoldGate`), so it costs no `ccd pr-state --pr` call.
  const subject = (project: string, pr: number, projection: LandingRecoverySubject['projection']): LandingRecoverySubject => ({
    id: 1, project, pr, creation: { kind: 'not-recorded' }, historical: { binding: { kind: 'no-run' }, observedSeq: 1 },
    projection, authority: { kind: 'not-set' },
  });
  const held = (...subjects: LandingRecoverySubject[]): LandingRecovery =>
    ({ hold: { reason: 'landing-recovery-unresolved', subjectIds: subjects.map((x) => x.id) }, subjects });
  const MISSING: LandingRecoverySubject['projection'] = { kind: 'missing', association: 'unmeasured' };
  const facts2 = (recovery: LandingRecovery): LandingMutationFacts => factsOf({
    entries: [entry(1, 'pinned'), entry(2, 'pinned')], projections: [{ id: 1, value: readable }, { id: 2, value: readable }], recovery,
  });
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

describe('landedCandidatesOf: the terminal-repair alternative (wave 5i, D-8626)', () => {
  const factsOf = (entries: LandingEntry[], terminalRepairs: LandingMutationFacts['terminalRepairs'], recovery: LandingRecovery = NO_HOLD): LandingMutationFacts => ({
    project: 'project-a', flags: { operatorPaused: false, mainRedHold: false }, entries,
    projections: entries.map((e) => ({ id: e.id, value: { kind: 'unreadable' } as LandingProjectionRead })),
    stateWords: entries.map((e) => ({ id: e.id, value: e.state })),
    dependencies: entries.map((e) => ({ id: e.id, value: { kind: 'readable' as const, afterIds: [] } })), recovery, nextId: 99, foreignIds: [],
    coordinators: entries.map((e) => ({ id: e.id, value: { kind: 'no-run' as const } })), terminalRepairs, creations: [],
  });
  const entry = (id: number, state: LandingEntryState): LandingEntry => ({ id, project: 'project-a', pr: 100 + id, pinnedSha: HEAD, handoffCommit: HEAD,
    runId: id, state, baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: id * 10 });
  const T = 'c'.repeat(64);
  it('an eligible row is a candidate carrying its token; a blocked one, and a row with no verdict, are not', () => {
    const got = landedCandidatesOf(factsOf([entry(1, 'pinned'), entry(2, 'pinned'), entry(3, 'unknown'), entry(4, 'pinned')], [
      { id: 1, value: { kind: 'eligible', token: T } }, { id: 2, value: { kind: 'blocked', reason: 'quarantine' } },
      { id: 3, value: { kind: 'eligible', token: 'd'.repeat(64) } },
    ]));
    expect(got).toEqual([
      { project: 'project-a', id: 1, pr: 101, pinnedAt: 10, pinnedSha: HEAD, runId: 1, repairToken: T },
      { project: 'project-a', id: 3, pr: 103, pinnedAt: 30, pinnedSha: HEAD, runId: 3, repairToken: 'd'.repeat(64) },
    ]);
  });
  it('a normal candidate carries no repairToken key at all', () => {
    const facts = factsOf([entry(1, 'pinned')], []);
    facts.projections = [{ id: 1, value: { kind: 'readable', quarantine: null } }];
    expect(landedCandidatesOf(facts)).toEqual([{ project: 'project-a', id: 1, pr: 101, pinnedAt: 10, pinnedSha: HEAD, runId: 1 }]);
  });
  it('the hold gate still applies: a repair row that is its own unresolved subject, or sits in an identity-conflicted project, is skipped', () => {
    const subject = (pr: number, projection: LandingRecoverySubject['projection']): LandingRecoverySubject => ({
      id: 1, project: 'project-a', pr, creation: { kind: 'not-recorded' }, historical: { binding: { kind: 'no-run' }, observedSeq: 1 }, projection, authority: { kind: 'not-set' } });
    const held = (s: LandingRecoverySubject): LandingRecovery => ({ hold: { reason: 'landing-recovery-unresolved', subjectIds: [s.id] }, subjects: [s] });
    const verdicts: LandingMutationFacts['terminalRepairs'] = [{ id: 1, value: { kind: 'eligible', token: T } }, { id: 2, value: { kind: 'eligible', token: T } }];
    expect(ids(landedCandidatesOf(factsOf([entry(1, 'pinned'), entry(2, 'pinned')], verdicts, held(subject(101, { kind: 'missing', association: 'unmeasured' })))))).toEqual([2]);
    expect(landedCandidatesOf(factsOf([entry(1, 'pinned'), entry(2, 'pinned')], verdicts, held(subject(150, { kind: 'identity-conflict', conflicts: [] }))))).toEqual([]);
  });
  it('landedExpectOf carries the token into the compare-and-set, and only for a repair candidate', () => {
    expect(landedExpectOf({ project: 'project-a', id: 1, pr: 101, pinnedAt: 10, pinnedSha: HEAD, runId: 1 })).toEqual({ id: 1, pinnedAt: 10 });
    expect(landedExpectOf({ project: 'project-a', id: 1, pr: 101, pinnedAt: 10, pinnedSha: HEAD, runId: 1, repairToken: T })).toEqual({ id: 1, pinnedAt: 10, repairToken: T });
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

// Fix round 1, R3: the `pr-state --pr` call's not-ran decision is L1's (`landedCallStep` reads `ran` first), and the lane acts on it.
describe('landedCallStep', () => {
  const Z = { stderr: '', killed: false as const, signal: null };
  it('a call that did not run is not-ran, carrying the retry answer and the link stop, whatever its stdout and ok say', () => {
    const notRan: CcdResult = { ran: false, ok: false, reason: 'transport', detail: 'agent down', stdout: '{"x":1}', ...Z };
    expect(landedCallStep(notRan)).toEqual({ act: 'not-ran', answer: { act: 'retry', missingField: false }, stopped: 'link' });
  });
  it('a call that ran and exited 0 is parsed from its stdout', () => {
    expect(landedCallStep({ ran: true, ok: true, stdout: 'line\n', ...Z })).toEqual({ act: 'parse', stdout: 'line\n' });
  });
  it('a call that ran and failed is failed', () => {
    expect(landedCallStep({ ran: true, ok: false, stdout: 'boom', ...Z })).toEqual({ act: 'failed' });
  });
  it('the lane reads no `.ran` of a runner result: the not-ran policy is landedCallStep\'s alone', () => {
    const lane = parseFile(`${REPO_ROOT}/server/src/coord/landedLane.ts`);
    const src = lane.text.split('\n').map(codeOf).join('\n');
    expect(src).not.toMatch(/\.ran\b/);
    expect(lane.comparisons.filter((c) => c.leftLeaf === 'ran' || c.rightLeaf === 'ran')).toEqual([]);
    expect(src).not.toMatch(/missingField:\s*false/);
  });
});
