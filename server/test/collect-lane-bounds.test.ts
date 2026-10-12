// Child reclamation wave 9 (spec §5.10): the collector lane's OWN decisions, which the L4 pass applies and never makes —
// who one pass asks (`collectOffers`, over `collectCandidateOf`'s plain facts) and what a settled act job does to the
// lane (`collectJobEffects`: the slot and the flock latch). Pure: no clock, no fleet, no watcher. The lane suites
// (`collect-lane-pass`, `collect-lane-slot`) pin what reaches ccd.
import { describe, it, expect } from 'vitest';
import {
  collectCandidateOf, collectFirstSighting, collectJobEffects, collectOffers,
  type CollectCandidate, type CollectJobEffects, type CollectJobSettled, type CollectOfferInput,
} from '../src/collectLane.js';
import type { CollectJobOutcome } from '../src/coord/collectTempRoot.js';
import type { CollectToken } from '../../shared/api.js';

const T = 'a'.repeat(64) as CollectToken;
const STALL = 480_000;
const NOW = 1_000_000;
/** An unpaired id: no observation, so no ripening instant. */
const c = (id: string, nextAskMono: number, over: Partial<CollectCandidate> = {}): CollectCandidate =>
  ({ id, nextAskMono, ripeningMono: null, ripe: false, ...over });
/** A ripe id: observation 1 stands, it ripened at `at`, and nothing else moves its next ask past that. */
const ripe = (id: string, at: number): CollectCandidate => c(id, at, { ripeningMono: at, ripe: true });
const input = (over: Partial<CollectOfferInput> = {}): CollectOfferInput => ({
  candidates: [], busy: new Set(), nowMono: NOW, auditsMax: 2,
  act: { slotFree: true, flockLatched: false, startMono: 0, holdOffMs: STALL }, ...over });

describe('collectOffers: who one pass asks (spec §5.10)', () => {
  it('a never-asked id is due at once; learning is capped, by next-ask instant and then id', () => {
    expect(collectOffers(input({ candidates: [c('demo-c', -Infinity), c('demo-a', -Infinity), c('demo-b', -Infinity)] })))
      .toEqual({ learn: ['demo-a', 'demo-b'], act: null });
  });

  it('the next-ask instant orders before the id, and an id not yet due is offered nothing', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', NOW - 10), c('demo-z', NOW - 20), c('demo-b', NOW + 1)] })))
      .toEqual({ learn: ['demo-z', 'demo-a'], act: null });
  });

  it('an id is due at exactly its instant', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', NOW)] })).learn).toEqual(['demo-a']);
  });

  it('a busy id — a call not settled, or the slot kept for it — is offered nothing, to learn or to act', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', -Infinity), ripe('demo-b', NOW - 1)],
      busy: new Set(['demo-a', 'demo-b']) }))).toEqual({ learn: [], act: null });
  });

  it('a ripe X with a never-settling call does not stop Y’s act', () => {
    expect(collectOffers(input({ candidates: [ripe('demo-x', NOW - 9), ripe('demo-y', NOW - 5)],
      busy: new Set(['demo-x']) })).act).toBe('demo-y');
  });

  it('an id holding an observation is never offered a learning audit, even while the act is closed to it', () => {
    expect(collectOffers(input({ candidates: [ripe('demo-a', NOW - 1)] }))).toEqual({ learn: [], act: 'demo-a' });
    expect(collectOffers(input({ candidates: [ripe('demo-a', NOW - 1)],
      act: { slotFree: false, flockLatched: false, startMono: 0, holdOffMs: STALL } }))).toEqual({ learn: [], act: null });
  });

  it('the act is offered FIRST and counts against no learning audit', () => {
    expect(collectOffers(input({ candidates: [c('demo-b', -Infinity), ripe('demo-a', NOW - 1), c('demo-c', -Infinity)] })))
      .toEqual({ learn: ['demo-b', 'demo-c'], act: 'demo-a' });
  });

  it('ONE act, to the earliest RIPENING instant and then id — never by next-ask instant or listing order', () => {
    expect(collectOffers(input({ candidates: [ripe('demo-b', NOW - 5), ripe('demo-a', NOW - 5), ripe('demo-c', NOW - 9)] })).act)
      .toBe('demo-c');
    expect(collectOffers(input({ candidates: [ripe('demo-b', NOW - 5), ripe('demo-a', NOW - 5)] })).act).toBe('demo-a');
    // demo-a ripened first, though a floor moved its next ask after demo-b's: the ripening instant decides.
    expect(collectOffers(input({ candidates: [c('demo-a', NOW - 1, { ripeningMono: NOW - 9, ripe: true }),
      ripe('demo-b', NOW - 5)] })).act).toBe('demo-a');
  });

  it('an id that holds an observation but is not ripe is not offered the act', () => {
    expect(collectOffers(input({ candidates: [c('demo-a', NOW + 1, { ripeningMono: NOW + 1 })] })).act).toBeNull();
  });

  it('the act is closed while the slot is taken, while flock-unavailable is latched, and inside the start hold-off', () => {
    const act = (a: Partial<CollectOfferInput['act']>): string | null => collectOffers(input({
      candidates: [ripe('demo-a', NOW - 1)],
      act: { slotFree: true, flockLatched: false, startMono: 0, holdOffMs: STALL, ...a } })).act;
    expect(act({}), 'CONTROL').toBe('demo-a');
    expect(act({ slotFree: false })).toBeNull();
    expect(act({ flockLatched: true })).toBeNull();
    expect(act({ startMono: NOW - STALL + 1 }), 'one millisecond inside the hold-off').toBeNull();
    expect(act({ startMono: NOW - STALL }), 'exactly at its end').toBe('demo-a');
  });

  it('the learning cap is its argument', () => {
    const four = ['demo-a', 'demo-b', 'demo-c', 'demo-d'].map((id) => c(id, -Infinity));
    expect(collectOffers(input({ candidates: four, auditsMax: 0 })).learn).toEqual([]);
    expect(collectOffers(input({ candidates: four, auditsMax: 3 })).learn).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });
});

describe('collectCandidateOf: an id’s facts through Task 4’s rules', () => {
  const PASS = 60_000;
  const OBSERVE = 60_000;
  it('no entry: never asked, so due at once, with no observation and not ripe', () => {
    expect(collectCandidateOf('demo-a', undefined, NOW, PASS, OBSERVE))
      .toEqual({ id: 'demo-a', nextAskMono: Number.NEGATIVE_INFINITY, ripeningMono: null, ripe: false });
  });

  it('a first sighting reads through L1: no wait, so due at once, and no observation', () => {
    expect(collectCandidateOf('demo-a', collectFirstSighting(1), NOW, PASS, OBSERVE))
      .toEqual({ id: 'demo-a', nextAskMono: Number.NEGATIVE_INFINITY, ripeningMono: null, ripe: false });
  });

  it('observation 1 ripens one interval after it ARRIVED: not before, and exactly then', () => {
    const at = (arrivedMono: number) =>
      collectCandidateOf('demo-a', { ...collectFirstSighting(1), obs: { token: T, arrivedMono } }, NOW, PASS, OBSERVE);
    expect(at(NOW - OBSERVE + 1)).toEqual({ id: 'demo-a', nextAskMono: NOW + 1, ripeningMono: NOW + 1, ripe: false });
    expect(at(NOW - OBSERVE)).toEqual({ id: 'demo-a', nextAskMono: NOW, ripeningMono: NOW, ripe: true });
  });
});

describe('collectJobEffects: the slot’s life, and the latch (spec §5.10)', () => {
  // Task 6's outcome is a CollectJobSettled: L1 declares the shape structurally, because it may not import L3.
  const settles = (o: CollectJobOutcome): CollectJobSettled => o;
  void settles;
  const FREE: CollectJobEffects = { keptUntilMono: null, latchFlock: false };
  const acted = (result: Extract<CollectJobSettled, { kind: 'acted' }>['result']): CollectJobSettled =>
    ({ kind: 'acted', composedMono: 7_000, result });
  it.each<readonly [string, CollectJobSettled, CollectJobEffects]>([
    ['shadow’s would-collect frees it', { kind: 'would-collect' }, FREE],
    ['a job that asked nothing frees it (caps, a refused id, a pause, presence at step 3)', { kind: 'not-asked' }, FREE],
    ['a job stopped after its audit frees it (stale, not licensed, a flip, a cleared pair, presence at step 6)',
      { kind: 'answered' }, FREE],
    ['the open-run hold frees it', { kind: 'held' }, FREE],
    ['a document frees it: collected', acted({ kind: 'collected', record: null, resumed: false, witness: 'dropped' }), FREE],
    ['a document frees it: refused', acted({ kind: 'refused', word: 'in-use', detail: 'x', paths: [] }), FREE],
    ['a document frees it: failed', acted({ kind: 'failed', token: 'probe-unmeasured', detail: 'x' }), FREE],
    ['a recognised die acted nothing: lock-unopenable frees it', acted({ kind: 'die', word: 'lock-unopenable' }), FREE],
    ['flock-unavailable frees it, and latches', acted({ kind: 'die', word: 'flock-unavailable' }), { ...FREE, latchFlock: true }],
    ['NO DOCUMENT may have acted: kept until STALL after the act was COMPOSED', acted({ kind: 'no-document', stderr: '' }),
      { ...FREE, keptUntilMono: 7_000 + STALL }],
    ['a job that threw may have acted: kept until STALL after it SETTLED', { kind: 'threw', detail: 'x' },
      { ...FREE, keptUntilMono: 9_000 + STALL }],
  ])('%s', (_label, settled, effects) => {
    expect(collectJobEffects(settled, 9_000, STALL)).toEqual(effects);
  });
});
