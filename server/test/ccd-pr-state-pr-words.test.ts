import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GH_STUB, makePrHarness, trainComment, trainRow, type PrHarness } from './ccdPrHelpers.js';
import { PR_STATE_PR_WORDS, readPrStatePrLine } from '../src/prstate.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prstate-pr-words-'); });
afterEach(() => { h.cleanup(); });

const HEAD = 'a'.repeat(40); const MERGE = 'b'.repeat(40);
const view = (state: string, over: Record<string, unknown> = {}) => ({ number: 41, state, headRefOid: HEAD,
  baseRefName: 'main', isCrossRepository: false, mergedAt: null, mergeCommit: null, labels: [], ...over });
/** One GitHub answer per server word. The train-proved `merged` arm is its own case below. */
const FIXTURES: readonly (readonly [string, (p: PrHarness) => void])[] = [
  ['open', (p) => p.ghView(41, view('OPEN'))],
  ['merged', (p) => p.ghView(41, view('MERGED', { mergedAt: '2026-10-30T12:00:00Z', mergeCommit: { oid: MERGE } }))],
  ['closed', (p) => p.ghView(41, view('CLOSED'))],
  ['unmeasured', (p) => p.ghViewFail(41, 124)],
  ['absent', (p) => p.ghViewFail(41)],
];
const printedLine = (stdout: string): Record<string, unknown> => {
  const lines = stdout.split('\n').filter(Boolean);
  expect(lines, 'exactly one JSON line').toHaveLength(1);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
};

describe('ccd\'s PR-keyed pr-state words are the server\'s (landing order wave 5c)', () => {
  it('the fixtures cover every server word, and no other', () => {
    expect(FIXTURES.map(([w]) => w).sort()).toEqual([...PR_STATE_PR_WORDS].sort());
  });
  it.each(FIXTURES)('the %s fixture prints exactly that word, and the server reads it back unchanged', (word, plant) => {
    h.makeGhRepo('demo');
    plant(h);
    const r = h.run(`${GH_STUB} cmd_pr_state --project demo --pr 41`);
    expect(printedLine(r.stdout).state).toBe(word);
    expect(readPrStatePrLine(r.stdout, 41).state).toBe(word);
  });
  it('the train-proved line is merged, proved, on both sides', () => {
    h.makeGhRepo('demo');
    h.ghView(41, { ...view('CLOSED', { labels: [{ name: 'landed-in-train' }] }), ...trainComment(50) });
    h.ghView(50, trainRow(50, 'e'.repeat(40), [[41, HEAD]]));
    const r = h.run(`${GH_STUB} cmd_pr_state --project demo --pr 41`);
    expect(printedLine(r.stdout).state).toBe('merged');
    expect(readPrStatePrLine(r.stdout, 41)).toMatchObject({ state: 'merged', train: 'proved' });
  });
  it('CONTROL: with no stub the poisoned gh answers, and the line is unmeasured, never absent', () => {
    h.makeGhRepo('demo');
    const r = h.run('cmd_pr_state --project demo --pr 41');
    expect(printedLine(r.stdout).state).toBe('unmeasured');
    expect(h.ghPoison().length).toBeGreaterThan(0);
  });
});
