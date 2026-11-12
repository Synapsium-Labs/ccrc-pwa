import { describe, it, expect } from 'vitest';
import { PR_STATE_PR_REASONS, PR_STATE_PR_WORDS, readPrStatePrLine } from '../src/prstate.js';
const HEAD = 'a'.repeat(40); const MERGE = 'b'.repeat(40); const AT = '2026-10-30T12:00:00Z';
const line = (o: Record<string, unknown>): string => `${JSON.stringify({ number: 41, ...o })}\n`;
const FACTS = { headRefOid: HEAD, baseRefName: 'main', isCrossRepository: false, mergedAt: null, mergeCommit: null };
const reader = (reason: string) => ({ state: 'unmeasured', pr: 41, by: 'reader', reason, train: null });

describe('the PR-keyed pr-state words (landing order wave 5c)', () => {
  it('are five, in the map\'s order', () => {
    expect(PR_STATE_PR_WORDS).toEqual(['open', 'merged', 'closed', 'unmeasured', 'absent']);
  });
});

describe('readPrStatePrLine keeps every distinction (landing order wave 5c)', () => {
  it('open and closed carry their facts and no train', () => {
    expect(readPrStatePrLine(line({ state: 'open', ...FACTS }), 41)).toEqual({ state: 'open', pr: 41, facts: FACTS, train: null });
    expect(readPrStatePrLine(line({ state: 'closed', ...FACTS, isCrossRepository: true }), 41))
      .toEqual({ state: 'closed', pr: 41, facts: { ...FACTS, isCrossRepository: true }, train: null });
  });
  it('merged by GitHub carries mergedAt and mergeCommit; merged by the train carries its train', () => {
    const gh = { ...FACTS, mergedAt: AT, mergeCommit: MERGE };
    expect(readPrStatePrLine(line({ state: 'merged', ...gh }), 41)).toEqual({ state: 'merged', pr: 41, facts: gh, train: null });
    expect(readPrStatePrLine(line({ state: 'merged', ...FACTS, landedInTrain: true, train: 50, trainMergeCommit: 'e'.repeat(40) }), 41))
      .toEqual({ state: 'merged', pr: 41, facts: FACTS, train: { number: 50, mergeCommit: 'e'.repeat(40) } });
  });
  it('a train-landed line with no train number, a train of 0 or a short merge commit is refused fields', () => {
    const E = 'e'.repeat(40);
    for (const o of [{}, { train: 0, trainMergeCommit: E }, { train: 50 }, { train: 50, trainMergeCommit: 'abc' },
      { train: 1.5, trainMergeCommit: E }, { train: '50', trainMergeCommit: E }, { trainMergeCommit: E }]) {
      expect(readPrStatePrLine(line({ state: 'merged', ...FACTS, landedInTrain: true, ...o }), 41)).toEqual(reader('fields'));
    }
  });
  it('a line without the train flag that carries a train is refused train-flags', () => {
    const E = 'e'.repeat(40);
    for (const o of [{ train: 50 }, { trainMergeCommit: E }, { train: 50, trainMergeCommit: E }]) {
      expect(readPrStatePrLine(line({ state: 'open', ...FACTS, ...o }), 41)).toEqual(reader('train-flags'));
      expect(readPrStatePrLine(line({ state: 'merged', ...FACTS, mergedAt: AT, mergeCommit: MERGE, ...o }), 41)).toEqual(reader('train-flags'));
    }
    expect(readPrStatePrLine(line({ state: 'open', ...FACTS, train: null, trainMergeCommit: null }), 41).state).toBe('open');
  });
  it('an open or a closed line carrying mergedAt or mergeCommit is refused merge-facts, never fields', () => {
    for (const [state, o] of [['open', { mergedAt: AT }], ['open', { mergeCommit: MERGE }],
      ['closed', { mergedAt: AT }], ['closed', { mergeCommit: MERGE }]] as const) {
      expect(readPrStatePrLine(line({ state, ...FACTS, ...o }), 41)).toEqual(reader('merge-facts'));
    }
  });
  it('a reason in ccd\'s vocabulary passes through; bogus reads unrecognised; 42 and the empty string read unstated', () => {
    const ccd = (reason: unknown) => readPrStatePrLine(line({ state: 'unmeasured', reason }), 41);
    for (const w of PR_STATE_PR_REASONS) expect(ccd(w)).toMatchObject({ by: 'ccd', reason: w });
    expect(ccd('bogus')).toMatchObject({ by: 'ccd', reason: 'unrecognised' });
    expect(ccd(42)).toMatchObject({ by: 'ccd', reason: 'unstated' });
    expect(ccd('')).toMatchObject({ by: 'ccd', reason: 'unstated' });
  });
  it('absent stays absent beside false train flags and any other field, and is never unmeasured', () => {
    expect(readPrStatePrLine(line({ state: 'absent' }), 41)).toEqual({ state: 'absent', pr: 41 });
    expect(readPrStatePrLine(line({ state: 'absent', landedInTrain: false, trainUnproven: false, trainUnread: false }), 41))
      .toEqual({ state: 'absent', pr: 41 });
    expect(readPrStatePrLine(line({ state: 'absent', headRefOid: 'junk', reason: 'x' }), 41)).toEqual({ state: 'absent', pr: 41 });
  });
  it('ccd\'s own unmeasured keeps its reason and its train word, marked by ccd', () => {
    expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'timeout' }), 41))
      .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'timeout', train: null });
    expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'rate-limit' }), 41))
      .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'rate-limit', train: null });
    expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'train-unread', trainUnread: true }), 41))
      .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'train-unread', train: 'unread' });
    expect(readPrStatePrLine(line({ state: 'unmeasured', reason: 'train-unproven', trainUnproven: true }), 41))
      .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'train-unproven', train: 'unproven' });
    expect(readPrStatePrLine(line({ state: 'unmeasured' }), 41))
      .toEqual({ state: 'unmeasured', pr: 41, by: 'ccd', reason: 'unstated', train: null });
  });
  it.each([
    ['an empty stdout', '', 'line-count'],
    ['two lines', line({ state: 'open', ...FACTS }) + line({ state: 'open', ...FACTS }), 'line-count'],
    ['not JSON', 'not json\n', 'not-json'],
    ['an array', '[]\n', 'not-json'],
    ['another pr', line({ number: 42, state: 'open', ...FACTS }), 'pr-mismatch'],
    ['no number', `${JSON.stringify({ state: 'open', ...FACTS })}\n`, 'pr-mismatch'],
    ['a string number', line({ number: '41', state: 'open', ...FACTS }), 'pr-mismatch'],
    ['an unknown word', line({ state: 'gone', ...FACTS }), 'word'],
    ['GitHub\'s own spelling', line({ state: 'OPEN', ...FACTS }), 'word'],
    ['open with no headRefOid', line({ state: 'open', ...FACTS, headRefOid: undefined }), 'fields'],
    ['open with a short headRefOid', line({ state: 'open', ...FACTS, headRefOid: 'abc1234' }), 'fields'],
    ['a string isCrossRepository', line({ state: 'open', ...FACTS, isCrossRepository: 'false' }), 'fields'],
    ['an empty baseRefName', line({ state: 'closed', ...FACTS, baseRefName: '' }), 'fields'],
    ['open with a mergedAt', line({ state: 'open', ...FACTS, mergedAt: AT }), 'merge-facts'],
    ['GitHub-merged with no mergeCommit', line({ state: 'merged', ...FACTS, mergedAt: AT }), 'fields'],
    ['merged with a malformed mergedAt', line({ state: 'merged', ...FACTS, mergedAt: '30 Oct', mergeCommit: MERGE }), 'fields'],
    ['closed claiming the train', line({ state: 'closed', ...FACTS, landedInTrain: true }), 'train-flags'],
    ['open beside trainUnproven', line({ state: 'open', ...FACTS, trainUnproven: true }), 'train-flags'],
    ['open claiming the train', line({ state: 'open', ...FACTS, landedInTrain: true }), 'train-flags'],
    ['closed beside trainUnread', line({ state: 'closed', ...FACTS, trainUnread: true }), 'train-flags'],
    ['merged beside trainUnproven', line({ state: 'merged', ...FACTS, landedInTrain: true, trainUnproven: true }), 'train-flags'],
    ['closed with a mergeCommit', line({ state: 'closed', ...FACTS, mergeCommit: MERGE }), 'merge-facts'],
    ['GitHub-merged with no mergedAt', line({ state: 'merged', ...FACTS, mergeCommit: MERGE }), 'fields'],
    ['a short mergeCommit', line({ state: 'merged', ...FACTS, mergedAt: AT, mergeCommit: 'abc' }), 'fields'],
    ['a numeric baseRefName', line({ state: 'open', ...FACTS, baseRefName: 7 }), 'fields'],
    ['merged beside trainUnread', line({ state: 'merged', ...FACTS, landedInTrain: true, trainUnread: true }), 'train-flags'],
    ['unmeasured with both train flags', line({ state: 'unmeasured', reason: 'x', trainUnread: true, trainUnproven: true }), 'train-flags'],
    ['absent claiming the train', line({ state: 'absent', landedInTrain: true }), 'train-flags'],
    ['absent beside trainUnread', line({ state: 'absent', trainUnread: true }), 'train-flags'],
  ])('%s is the reader\'s unmeasured: %s', (_what, stdout, reason) => {
    expect(readPrStatePrLine(stdout, 41)).toEqual(reader(reason));
  });
});
