// The console's home, decided once (Overlord W1 home, Task 1): `overlordShown`, `designationStateOf` and `homePlace`, each
// over the tables the module reads, so a designation kind or a rung class without a row is red here.
import { describe, expect, it } from 'vitest';
import type { DesignationView } from '../../shared/overlord-designation';
import {
  designationStateOf, HOME_TABLE, homePlace, NOT_ADVERTISED, OVERLORD_CAP, OVERLORD_DOOR, overlordShown, rungClassOf,
  type CapRead, type DesignationState, type RungRead,
} from '../src/overlord/homePlace';
import type { ReadState } from '../src/overlord/readState';

const AT = 1_700_000_000_000;
const row = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 1, designatedTerm: 1, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
  pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [], ...over,
});
const answered = (value: DesignationView | null): ReadState<DesignationView | null> => ({ state: 'answered', value, at: AT });
const BOUND = row({ bound: { sessionId: 'lane-a-overlord', generation: 'g1' } });
const PENDING = row({
  pending: { sessionId: 'lane-a-overlord', kind: 'designate', deadlineAt: AT + 1, since: AT, actor: 'operator', generation: null },
});
const FAILED = row({ lastAttempt: { sessionId: 'lane-a-overlord', outcome: 'create-failed', at: AT } });
const RETIRED = row({ lastAttempt: { sessionId: 'lane-a-overlord', outcome: 'retired', at: AT } });

const WITH_WORD: CapRead = { kind: 'caps', caps: ['continuity-v1', OVERLORD_CAP] };
const WITHOUT_WORD: CapRead = { kind: 'caps', caps: ['continuity-v1'] };
const CAPS_UNMEASURED: CapRead = { kind: 'unmeasured' };

const STATES: Readonly<Record<DesignationState['kind'], DesignationState>> = {
  unmeasured: { kind: 'unmeasured', why: 'loading' },
  none: { kind: 'none' },
  'failed-start': { kind: 'failed-start', outcome: 'create-failed' },
  pending: { kind: 'pending', sessionId: 'lane-a-overlord' },
  bound: { kind: 'bound', sessionId: 'lane-a-overlord' },
};
const RUNGS: readonly RungRead[] = [
  { kind: 'unmeasured' }, { kind: 'rung', rung: 'off' }, { kind: 'rung', rung: 'chat' }, { kind: 'rung', rung: 'advise' },
  { kind: 'rung', rung: 'full' }, { kind: 'rung', rung: 'a-later-word' },
];

describe('overlordShown (plan question 9, ruled F4)', () => {
  it('is true only for an answered read naming the word', () => {
    expect(overlordShown(WITH_WORD)).toBe(true);
    expect(overlordShown(WITHOUT_WORD)).toBe(false);
    expect(overlordShown(CAPS_UNMEASURED)).toBe(false);
    expect(overlordShown({ kind: 'caps', caps: [] })).toBe(false);
    expect(OVERLORD_CAP).toBe('overlord-v1');
  });
});

describe('designationStateOf (plan Task 1, the first table)', () => {
  it('loading, and a read that failed with no answer, are unmeasured with the reason', () => {
    expect(designationStateOf({ state: 'loading' })).toEqual({ kind: 'unmeasured', why: 'loading' });
    expect(designationStateOf({ state: 'unmeasured', error: 'HTTP 503' })).toEqual({ kind: 'unmeasured', why: 'HTTP 503' });
    expect(designationStateOf({ state: 'unmeasured', error: 'timeout' })).toEqual({ kind: 'unmeasured', why: 'timeout' });
  });
  it('an older server (absent) has no Overlord: none, never unmeasured', () => {
    expect(designationStateOf({ state: 'absent' })).toEqual({ kind: 'none' });
  });
  it('no row is none', () => {
    expect(designationStateOf(answered(null))).toEqual({ kind: 'none' });
  });
  it('a bound row is bound, even with a pending rebind beside it', () => {
    expect(designationStateOf(answered(BOUND))).toEqual({ kind: 'bound', sessionId: 'lane-a-overlord' });
    expect(designationStateOf(answered({ ...BOUND, pending: PENDING.pending }))).toEqual({ kind: 'bound', sessionId: 'lane-a-overlord' });
  });
  it('a pending row with no binding is pending', () => {
    expect(designationStateOf(answered(PENDING))).toEqual({ kind: 'pending', sessionId: 'lane-a-overlord' });
  });
  it('no binding, and a failed last attempt that stands, is failed-start', () => {
    expect(designationStateOf(answered(FAILED))).toEqual({ kind: 'failed-start', outcome: 'create-failed' });
  });
  it('a retired last attempt, or none, is none', () => {
    expect(designationStateOf(answered(RETIRED))).toEqual({ kind: 'none' });
    expect(designationStateOf(answered(row()))).toEqual({ kind: 'none' });
  });
  it('F6: a failed start, then a good start, then a retire reads none (goLive cleared the last attempt)', () => {
    expect(designationStateOf(answered(row({ lastAttempt: null })))).toEqual({ kind: 'none' });
  });
  it('a stale read keeps its last answer\'s state', () => {
    expect(designationStateOf({ state: 'stale', value: BOUND, at: AT, error: 'HTTP 503' }))
      .toEqual({ kind: 'bound', sessionId: 'lane-a-overlord' });
    expect(designationStateOf({ state: 'stale', value: null, at: AT, error: 'timeout' })).toEqual({ kind: 'none' });
  });
});

describe('homePlace (plan Task 1, the second table)', () => {
  it('the table has one row per designation kind and one cell per rung class', () => {
    expect(Object.keys(HOME_TABLE).sort()).toEqual(Object.keys(STATES).sort());
    for (const cells of Object.values(HOME_TABLE)) expect(Object.keys(cells).sort()).toEqual(['off', 'other', 'unmeasured']);
  });
  it('without the word, or with the caps unread, the home is the Fleet whatever else reads', () => {
    for (const caps of [WITHOUT_WORD, CAPS_UNMEASURED]) {
      for (const d of Object.values(STATES)) for (const r of RUNGS) expect(homePlace(caps, d, r)).toEqual(NOT_ADVERTISED);
    }
    expect(NOT_ADVERTISED).toEqual({ place: 'fleet', why: 'not-advertised' });
  });
  it('with the word, every cell of the table is what homePlace answers', () => {
    for (const d of Object.values(STATES)) {
      for (const r of RUNGS) expect(homePlace(WITH_WORD, d, r)).toEqual(HOME_TABLE[d.kind][rungClassOf(r)]);
    }
  });
  it('the rows, as the plan writes them', () => {
    for (const k of ['bound', 'pending'] as const) {
      expect(homePlace(WITH_WORD, STATES[k], { kind: 'rung', rung: 'off' })).toEqual({ place: 'fleet', why: 'rung-off' });
      expect(homePlace(WITH_WORD, STATES[k], { kind: 'unmeasured' })).toEqual({ place: 'overlord', why: 'rung-unmeasured' });
      for (const rung of ['chat', 'advise', 'full', 'a-later-word']) {
        expect(homePlace(WITH_WORD, STATES[k], { kind: 'rung', rung })).toEqual({ place: 'overlord', why: 'designated' });
      }
    }
    for (const r of RUNGS) {
      expect(homePlace(WITH_WORD, STATES['failed-start'], r)).toEqual({ place: 'fleet', why: 'failed-start' });
      expect(homePlace(WITH_WORD, STATES.none, r)).toEqual({ place: 'fleet', why: 'none' });
      expect(homePlace(WITH_WORD, STATES.unmeasured, r)).toEqual({ place: 'fleet', why: 'designation-unmeasured' });
    }
  });
  it('monotone: no unmeasured input and no missing word ever answers the Overlord as designated', () => {
    for (const caps of [WITH_WORD, WITHOUT_WORD, CAPS_UNMEASURED]) {
      for (const d of Object.values(STATES)) {
        for (const r of RUNGS) {
          const a = homePlace(caps, d, r);
          const unmeasured = caps.kind === 'unmeasured' || d.kind === 'unmeasured' || r.kind === 'unmeasured';
          if (unmeasured || !overlordShown(caps)) expect(a).not.toEqual({ place: 'overlord', why: 'designated' });
        }
      }
    }
  });
});

describe('the Overlord door table', () => {
  it('draws the door for bound, pending and a failed first start, and never for none or unmeasured', () => {
    expect(OVERLORD_DOOR).toEqual({ bound: true, pending: true, 'failed-start': true, none: false, unmeasured: false });
  });
});
