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
  // with `"conclusion": ""`, not null. The empty conclusion must not shadow the
  // run's status: a not-completed run reads running. A COMPLETED run with no
  // conclusion has nothing red to report and keeps reading as settled.
  const emptyConclusion: Case[] = [
    ['CheckRun QUEUED / ""', checkRun('QUEUED', ''), 'pending'],
    ['CheckRun IN_PROGRESS / ""', checkRun('IN_PROGRESS', ''), 'pending'],
    ['CheckRun WAITING / ""', checkRun('WAITING', ''), 'pending'],
    ['CheckRun COMPLETED / ""', checkRun('COMPLETED', ''), 'pass'],
    ['StatusContext PENDING with empty conclusion', { context: 'ci', conclusion: '', state: 'PENDING' }, 'pending'],
    ['CheckRun IN_PROGRESS / undefined', { name: 'build', status: 'IN_PROGRESS' }, 'pending'],
  ];
  it.each(emptyConclusion)('empty conclusion: %s', (_label, entry, word) => {
    expect(wordOf(entry)).toBe(word);
  });

  it('a red entry still outranks a running one with an empty conclusion', () => {
    const c = checksFor({ ...rowOf({}), statusCheckRollup: [
      checkRun('IN_PROGRESS', ''), checkRun('COMPLETED', 'FAILURE'),
    ] } as CcdPrRow);
    expect(c.checks).toBe('fail');
  });

  it('a running entry beside a settled green one, reads pending', () => {
    const c = checksFor({ ...rowOf({}), statusCheckRollup: [
      checkRun('COMPLETED', 'SUCCESS'), checkRun('IN_PROGRESS', null),
    ] } as CcdPrRow);
    expect(c.checks).toBe('pending');
  });
});
