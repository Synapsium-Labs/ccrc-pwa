import { describe, it, expect } from 'vitest';
import { checksFor, type CcdPrRow } from '../src/prstate.js';

// Characterization of the checks word (`checksFor`) for every input shape `gh`
// returns in a PR's rollup. A CheckRun carries `status` and `conclusion`; a
// StatusContext carries `state`. Each case is ONE entry in the rollup.
const rowOf = (entry: Record<string, unknown>): CcdPrRow => ({
  number: 42, state: 'OPEN', headRefName: 'ws/quiet-basin', headRefOid: 'deadbee',
  baseRefName: 'main', isCrossRepository: false, mergedAt: null, mergeCommit: null,
  url: 'https://github.com/o/r/pull/42', title: 'the work', isDraft: false,
  statusCheckRollup: [entry], ours: true,
} as unknown as CcdPrRow);
const wordOf = (entry: Record<string, unknown>) => checksFor(rowOf(entry)).checks;

type Case = [label: string, entry: Record<string, unknown>, word: 'pass' | 'pending' | 'fail'];

const checkRun = (status: string, conclusion: unknown): Record<string, unknown> =>
  ({ __typename: 'CheckRun', name: 'build', status, conclusion });

describe('checksFor — the checks word, per rollup entry shape', () => {
  const settled: Case[] = [
    ['CheckRun COMPLETED / SUCCESS', checkRun('COMPLETED', 'SUCCESS'), 'pass'],
    ['CheckRun COMPLETED / NEUTRAL', checkRun('COMPLETED', 'NEUTRAL'), 'pass'],
    ['CheckRun COMPLETED / SKIPPED', checkRun('COMPLETED', 'SKIPPED'), 'pass'],
    ['CheckRun COMPLETED / FAILURE', checkRun('COMPLETED', 'FAILURE'), 'fail'],
    ['CheckRun COMPLETED / CANCELLED', checkRun('COMPLETED', 'CANCELLED'), 'fail'],
    ['CheckRun COMPLETED / TIMED_OUT', checkRun('COMPLETED', 'TIMED_OUT'), 'fail'],
    ['CheckRun COMPLETED / ACTION_REQUIRED', checkRun('COMPLETED', 'ACTION_REQUIRED'), 'fail'],
    ['CheckRun QUEUED / null', checkRun('QUEUED', null), 'pending'],
    ['CheckRun IN_PROGRESS / null', checkRun('IN_PROGRESS', null), 'pending'],
    ['StatusContext SUCCESS', { __typename: 'StatusContext', context: 'ci', state: 'SUCCESS' }, 'pass'],
    ['StatusContext FAILURE', { __typename: 'StatusContext', context: 'ci', state: 'FAILURE' }, 'fail'],
    ['StatusContext ERROR', { __typename: 'StatusContext', context: 'ci', state: 'ERROR' }, 'fail'],
    ['StatusContext PENDING', { __typename: 'StatusContext', context: 'ci', state: 'PENDING' }, 'pending'],
    ['StatusContext EXPECTED', { __typename: 'StatusContext', context: 'ci', state: 'EXPECTED' }, 'pending'],
  ];
  it.each(settled)('%s', (_label, entry, word) => {
    expect(wordOf(entry)).toBe(word);
  });

  // `gh pr view --json statusCheckRollup` renders a run that has not finished
  // with `"conclusion": ""`, not null. `??` keeps an empty string, so today the
  // empty conclusion shadows the status and the entry reads as passing.
  // These rows pin TODAY's word; the fix is a commit of its own and flips them.
  const emptyConclusion: Case[] = [
    ['CheckRun QUEUED / ""', checkRun('QUEUED', ''), 'pass'],
    ['CheckRun IN_PROGRESS / ""', checkRun('IN_PROGRESS', ''), 'pass'],
    ['CheckRun COMPLETED / "" (unusual)', checkRun('COMPLETED', ''), 'pass'],
  ];
  it.each(emptyConclusion)('empty conclusion today: %s', (_label, entry, word) => {
    expect(wordOf(entry)).toBe(word);
  });

  it('a running entry beside a settled green one, as null today reads pending', () => {
    const c = checksFor({ ...rowOf({}), statusCheckRollup: [
      checkRun('COMPLETED', 'SUCCESS'), checkRun('IN_PROGRESS', null),
    ] } as CcdPrRow);
    expect(c.checks).toBe('pending');
  });
});
