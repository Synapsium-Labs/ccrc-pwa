// D-8071 (spec §9.3, §11.3, A16, A17): a closed run's word keys on who closed it; the detail adds the reason.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { closeWords, closedLine } from '../src/fleet/closeWords';
import { runStateWord, RUN_WORD } from '../src/fleet/runWords';
import type { RunSummary } from '../../shared/api';

const fmt = (ms: number): string => (ms === 1 ? '4 Nov at 15:05' : '2 Nov at 11:20');
const run = (over: Partial<RunSummary>): RunSummary =>
  ({ id: 1, state: 'failed', closedAt: 1, ...over }) as unknown as RunSummary;

describe('closeWords', () => {
  it('operator with a reason', () => {
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:overtaken' })).toBe('closed by you: overtaken');
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:owner-gone' })).toBe('closed by you: owner gone');
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:never-started' })).toBe('closed by you: never started');
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:review-of-closed' })).toBe('closed by you: review of finished work');
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:start-never-landed' })).toBe('closed by you: start never finished');
  });
  it('operator at its request, with anything else, or with none', () => {
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:requested:item-a' })).toBe('closed by you, at its request');
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:mystery' })).toBe('closed by you');
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: 'free text' })).toBe('closed by you');
    expect(closeWords({ state: 'failed', closedBy: 'operator', closeDetail: null })).toBe('closed by you');
    expect(closeWords({ state: 'failed', closedBy: 'operator' })).toBe('closed by you');
  });
  it('sweep', () => {
    expect(closeWords({ state: 'failed', closedBy: 'sweep', closeDetail: 'expired:owner-gone' })).toBe('closed by ccrc: owner gone');
    expect(closeWords({ state: 'failed', closedBy: 'sweep', closeDetail: 'expired:never-started' })).toBe('closed by ccrc: never started');
    expect(closeWords({ state: 'failed', closedBy: 'sweep', closeDetail: 'expired:unheard-of' })).toBe('closed by ccrc');
    expect(closeWords({ state: 'failed', closedBy: 'sweep', closeDetail: null })).toBe('closed by ccrc');
  });
  it('coordinator and absent give no words of their own', () => {
    expect(closeWords({ state: 'failed', closedBy: 'coordinator' })).toBeNull();
    expect(closeWords({ state: 'done', closedBy: 'coordinator' })).toBeNull();
    expect(closeWords({ state: 'failed', closedBy: null })).toBeNull();
    expect(closeWords({ state: 'failed' })).toBeNull();
  });
  it('an open run has none', () => {
    expect(closeWords({ state: 'working', closedBy: 'operator' })).toBeNull();
  });
});

describe('closedLine carries only what the word lacks (check 5)', () => {
  it('the date alone after a word that names the closer', () => {
    expect(closedLine(run({ closedBy: 'operator', closeDetail: 'abandon:owner-gone' }), fmt)).toBe('4 Nov at 15:05');
    expect(closedLine(run({ closedBy: 'sweep' }), fmt)).toBe('4 Nov at 15:05');
  });
  it('who and when after done or failed', () => {
    expect(closedLine(run({ state: 'done', closedBy: 'coordinator', closedAt: 2 }), fmt)).toBe('Closed by the coordinator, 2 Nov at 11:20');
    expect(closedLine(run({ state: 'failed', closedBy: 'coordinator', closedAt: 2 }), fmt)).toBe('Closed by the coordinator, 2 Nov at 11:20');
  });
  it('the date alone with no closedBy', () => {
    expect(closedLine(run({ closedBy: null }), fmt)).toBe('4 Nov at 15:05');
  });
});

describe('runStateWord', () => {
  it('a closed run never reads failed when someone ended it', () => {
    expect(runStateWord(run({ state: 'failed', closedBy: 'operator' }))).not.toBe('failed');
    expect(runStateWord(run({ state: 'failed', closedBy: 'operator', closeDetail: 'abandon:overtaken' }))).toBe('closed by you: overtaken');
  });
  it('otherwise RUN_WORD, so an older server reads as today', () => {
    expect(runStateWord(run({ state: 'failed', closedBy: 'coordinator' }))).toBe(RUN_WORD.failed);
    expect(runStateWord(run({ state: 'done' }))).toBe(RUN_WORD.done);
    expect(runStateWord(run({ state: 'working' }))).toBe(RUN_WORD.working);
  });
});

describe('one reader of a row\'s word', () => {
  it('the run row draws its word through runStateWord and never indexes RUN_WORD', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'RunRow.tsx'), 'utf8');
    expect(src).not.toMatch(/RUN_WORD\s*\[/);
    expect(src).toMatch(/runStateWord\(run\)/);
  });
});
