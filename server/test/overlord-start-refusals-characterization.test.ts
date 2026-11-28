// CHARACTERIZATION (Overlord W1, overlord-v1's lane guard, calls 1887 and 1941): the deciders' verdicts for Start the Overlord,
// Rebind and Restart as they stand BEFORE the guard joins them, each pinned whole (its word, its detail, its needs or count), one
// fact wrong at a time and then several at once, so the order is shown too. The deciders only: the doors' HTTP answers are the
// route suites'. Written green on main's deciders; the guard's commits add a step to each, after every refusal pinned here, and
// must leave every row exactly as it is.
import { describe, expect, it } from 'vitest';
import { DESIGNATE_CCD_WORDS } from '../../shared/overlord-designation.js';
import { designateVerdict, rebindVerdict, restartVerdict } from '../src/coord/overlordDesignation.js';
import { boundRead, dfacts, rfacts } from './sim/designationSets.js';

const ALL_CCD = [...DESIGNATE_CCD_WORDS];
const NONE = { kind: 'not-designated', row: null } as const;
const UNMEASURED = { kind: 'unmeasured', why: 'the row could not be narrowed' } as const;
const PENDING = boundRead({ pending: { sessionId: 'overlord-y', kind: 'rebind', deadlineAt: 9, since: 1, actor: 'op', generation: null } });
const EMPTY_SET = { pools: [], untagged: false };
const BAD_SET = { pools: ['bad name'], untagged: false };

describe('Start the Overlord: every refusal before the lane guard, pinned whole', () => {
  it('each step alone', () => {
    expect(designateVerdict(dfacts())).toEqual({ act: 'create', wrapper: 'lane-a', acctorder: 'lane-b,lane-a,lane-c', poolset: 'pool-a,pool-b' });
    expect(designateVerdict(dfacts({ read: UNMEASURED }))).toEqual({ act: 'unmeasured', why: 'the designation could not be read: the row could not be narrowed' });
    expect(designateVerdict(dfacts({ read: boundRead() }))).toEqual({ act: 'refuse', word: 'overlord-exists', detail: 'an Overlord is already designated or being started' });
    expect(designateVerdict(dfacts({ ccdWords: null }))).toEqual({ act: 'refuse', word: 'capability-missing', detail: `missing: ${ALL_CCD.join(', ')}`, needs: ALL_CCD });
    expect(designateVerdict(dfacts({ serverWords: [] }))).toEqual({ act: 'refuse', word: 'capability-missing', detail: 'missing: continuity-v1', needs: ['continuity-v1'] });
    expect(designateVerdict(dfacts({ probe: { kind: 'not-run' } }))).toEqual({ act: 'refuse', word: 'capability-missing', detail: 'missing: pool-set', needs: ['pool-set'] });
    expect(designateVerdict(dfacts({ probe: { kind: 'unparsed', why: 'verdict' } })))
      .toEqual({ act: 'refuse', word: 'capability-missing', detail: "the agent's pool answer could not be read", needs: ['pool-set'] });
    expect(designateVerdict(dfacts({ builds: 'skewed' }))).toEqual({ act: 'refuse', word: 'launch-profile-unmet', detail: 'skewed' });
    expect(designateVerdict(dfacts({ builds: 'unknown' }))).toEqual({ act: 'refuse', word: 'launch-profile-unmet', detail: 'unmeasured' });
    expect(designateVerdict(dfacts({ accountPools: BAD_SET }))).toEqual({ act: 'refuse-input', why: 'unspellable' });
    expect(designateVerdict(dfacts({ accountPools: EMPTY_SET })))
      .toEqual({ act: 'refuse', word: 'overlord-single-account', count: 0, detail: '0 counted account(s); the Overlord needs at least two' });
  });

  it('several wrong at once answer the first, in the order: exists, words, builds, spelling, count', () => {
    const all = { read: boundRead(), ccdWords: null, serverWords: [], builds: 'skewed', accountPools: BAD_SET } as const;
    expect(designateVerdict(dfacts(all))).toMatchObject({ word: 'overlord-exists' });
    expect(designateVerdict(dfacts({ ...all, read: NONE }))).toMatchObject({ word: 'capability-missing' });
    expect(designateVerdict(dfacts({ ...all, read: NONE, ccdWords: ALL_CCD, serverWords: ['continuity-v1'] }))).toMatchObject({ word: 'launch-profile-unmet' });
    expect(designateVerdict(dfacts({ ...all, read: NONE, ccdWords: ALL_CCD, serverWords: ['continuity-v1'], builds: 'agreed' }))).toEqual({ act: 'refuse-input', why: 'unspellable' });
    expect(designateVerdict(dfacts({ accountPools: EMPTY_SET, builds: 'agreed' }))).toMatchObject({ word: 'overlord-single-account' });
  });
});

describe('Rebind: every refusal before the lane guard, pinned whole', () => {
  it('each step alone', () => {
    expect(rebindVerdict(rfacts())).toEqual({ act: 'create', wrapper: 'lane-a', acctorder: 'lane-b,lane-a,lane-c', poolset: 'pool-a,pool-b' });
    expect(rebindVerdict(rfacts({ read: UNMEASURED }))).toEqual({ act: 'unmeasured', why: 'the designation could not be read: the row could not be narrowed' });
    expect(rebindVerdict(rfacts({ read: NONE }))).toEqual({ act: 'refuse', word: 'not-found', detail: 'no Overlord is bound, so there is nothing to rebind' });
    expect(rebindVerdict(rfacts({ read: PENDING })))
      .toEqual({ act: 'refuse', word: 'overlord-attempt-pending', detail: 'an attempt is already pending on the designation' });
    expect(rebindVerdict(rfacts({ old: 'alive' }))).toEqual({ act: 'refuse', word: 'overlord-body-alive', detail: 'the bound body is alive' });
    expect(rebindVerdict(rfacts({ old: 'unmeasurable' })))
      .toEqual({ act: 'refuse', word: 'overlord-body-alive', detail: 'the bound body could not be measured dead or absent' });
    expect(rebindVerdict(rfacts({ old: 'alive', force: true }))).toEqual({ act: 'create', wrapper: 'lane-a', acctorder: 'lane-b,lane-a,lane-c', poolset: 'pool-a,pool-b' });
    expect(rebindVerdict(rfacts({ ccdWords: null }))).toEqual({ act: 'refuse', word: 'capability-missing', detail: `missing: ${ALL_CCD.join(', ')}`, needs: ALL_CCD });
    expect(rebindVerdict(rfacts({ serverWords: [] }))).toEqual({ act: 'refuse', word: 'capability-missing', detail: 'missing: continuity-v1', needs: ['continuity-v1'] });
    expect(rebindVerdict(rfacts({ probe: { kind: 'not-run' } }))).toEqual({ act: 'refuse', word: 'capability-missing', detail: 'missing: pool-set', needs: ['pool-set'] });
    expect(rebindVerdict(rfacts({ probe: { kind: 'unparsed', why: 'verdict' } })))
      .toEqual({ act: 'refuse', word: 'capability-missing', detail: "the agent's pool answer could not be read", needs: ['pool-set'] });
    expect(rebindVerdict(rfacts({ builds: 'skewed' }))).toEqual({ act: 'refuse', word: 'launch-profile-unmet', detail: 'skewed' });
    expect(rebindVerdict(rfacts({ builds: 'unknown' }))).toEqual({ act: 'refuse', word: 'launch-profile-unmet', detail: 'unmeasured' });
    // The class and the set are the row's (`rebind-keeps-the-class-and-set`), so the spelling and the count read the row's set.
    expect(rebindVerdict(rfacts({ read: boundRead({ accountPools: BAD_SET }) }))).toEqual({ act: 'refuse-input', why: 'unspellable' });
    expect(rebindVerdict(rfacts({ read: boundRead({ accountPools: EMPTY_SET }) })))
      .toEqual({ act: 'refuse', word: 'overlord-single-account', count: 0, detail: '0 counted account(s); the Overlord needs at least two' });
  });

  it('several wrong at once answer the first: no binding, attempt pending, body alive, then designate\'s order', () => {
    expect(rebindVerdict(rfacts({ read: NONE, old: 'alive', ccdWords: null }))).toMatchObject({ word: 'not-found' });
    expect(rebindVerdict(rfacts({ read: PENDING, old: 'alive', ccdWords: null, builds: 'skewed' }))).toMatchObject({ word: 'overlord-attempt-pending' });
    expect(rebindVerdict(rfacts({ old: 'alive', ccdWords: null, builds: 'skewed' }))).toMatchObject({ word: 'overlord-body-alive' });
    expect(rebindVerdict(rfacts({ ccdWords: null, builds: 'skewed' }))).toMatchObject({ word: 'capability-missing' });
    expect(rebindVerdict(rfacts({ builds: 'skewed', old: 'dead', read: boundRead({ accountPools: BAD_SET }) }))).toMatchObject({ word: 'launch-profile-unmet' });
    expect(rebindVerdict(rfacts({ read: boundRead({ accountPools: BAD_SET }) }))).toEqual({ act: 'refuse-input', why: 'unspellable' });
  });
});

describe('Restart: every answer before the lane guard, pinned whole', () => {
  const NOW = 1_000;
  const bound = { sessionId: 'overlord-x', pending: null };
  const pendingAt = (deadlineAt: number) => ({ sessionId: 'overlord-x', pending: { sessionId: 'overlord-new-owl', deadlineAt } });
  const asleep = { kind: 'asleep' } as const;
  it('each state alone', () => {
    expect(restartVerdict(null, asleep, NOW)).toEqual({ ok: false, error: 'not-found' });
    expect(restartVerdict(pendingAt(NOW + 1), asleep, NOW)).toEqual({ ok: false, error: 'overlord-attempt-pending' });
    expect(restartVerdict(bound, { kind: 'up' }, NOW)).toEqual({ ok: false, error: 'overlord-body-alive', detail: 'alive' });
    expect(restartVerdict(bound, { kind: 'down', since: 5 }, NOW)).toEqual({ ok: false, error: 'overlord-body-alive', detail: 'restarting' });
    expect(restartVerdict(bound, { kind: 'unmeasured', why: 'x' }, NOW)).toEqual({ ok: false, error: 'overlord-body-alive', detail: 'unmeasured' });
    expect(restartVerdict(bound, asleep, NOW)).toEqual({ ok: true, endAttempt: null });
    expect(restartVerdict(bound, { kind: 'gone', cause: 'absent' }, NOW)).toEqual({ ok: true, endAttempt: null });
    expect(restartVerdict(pendingAt(NOW), asleep, NOW)).toEqual({ ok: true, endAttempt: 'overlord-new-owl' });
  });

  it('several at once answer the first, in the order: no binding, attempt pending inside its deadline, the body', () => {
    expect(restartVerdict(null, { kind: 'up' }, NOW)).toEqual({ ok: false, error: 'not-found' });
    expect(restartVerdict(pendingAt(NOW + 1), { kind: 'up' }, NOW)).toEqual({ ok: false, error: 'overlord-attempt-pending' });
    expect(restartVerdict(pendingAt(NOW - 1), { kind: 'up' }, NOW)).toEqual({ ok: false, error: 'overlord-body-alive', detail: 'alive' });
  });
});
