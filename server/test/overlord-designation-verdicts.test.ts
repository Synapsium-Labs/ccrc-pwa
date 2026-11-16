// The Overlord designation's three deciders (Overlord W1 designation A, plan Task 2). The cases live in
// `sim/designationSets.ts`, written once for this file and for the every-run mutation floors; this file runs them
// against the real module, and reads the placement widening (the index's Q5).
import { describe, it, expect } from 'vitest';
import * as m from '../src/coord/overlordDesignation.js';
import { projectHome, projectPlacement } from '../src/limits.js';
import {
  ROSTER, SET_A, SET_AB, designateVerdictCases, limit, overlordAccountsCases, retireVerdictCases,
} from './sim/designationSets.js';

const NO_EDGES = new Map<string, readonly string[]>();
const HEALTHY = { 'lane-a': limit(), 'lane-b': limit(), 'lane-c': limit(), 'lane-d': limit(), 'lane-pay': limit(), 'lane-off': limit({ disabled: true }) };

describe('overlordAccounts', () => {
  for (const [name, fn] of Object.entries(overlordAccountsCases(m))) it(name, fn);
});
describe('designateVerdict', () => {
  for (const [name, fn] of Object.entries(designateVerdictCases(m))) it(name, fn);
});
describe('retireVerdict', () => {
  for (const [name, fn] of Object.entries(retireVerdictCases(m))) it(name, fn);
});

describe('placement in the set (review F8)', () => {
  it('a set without +untagged, with a home, answers projected', () => {
    expect(projectPlacement(ROSTER, HEALTHY, { state: 'set', set: SET_A }, NO_EDGES, 'opus', { kind: 'absent' }, 2_000_000))
      .toEqual({ kind: 'projected', wrapper: 'lane-a', score: 10 });
  });
  it('with no lane, answers none carrying the set', () => {
    expect(projectPlacement(ROSTER, HEALTHY, { state: 'set', set: { pools: ['pool-z'], untagged: false } }, NO_EDGES))
      .toEqual({ kind: 'none', set: { pools: ['pool-z'], untagged: false } });
  });
  it('a set whose carrier cannot be read answers unmeasurable, never none', () => {
    expect(projectPlacement(ROSTER, HEALTHY, { state: 'set-unreadable' }, NO_EDGES)).toEqual({ kind: 'unmeasurable' });
    expect(projectPlacement(ROSTER, HEALTHY, { state: 'set-malformed' }, NO_EDGES)).toEqual({ kind: 'unmeasurable' });
  });
  it('a set without +untagged does not place on an untagged account, and +untagged does', () => {
    expect(projectHome(ROSTER, HEALTHY, { state: 'set', set: { pools: ['pool-z'], untagged: false } }, NO_EDGES)).toBeNull();
    expect(projectHome(ROSTER, { 'lane-d': limit({ five: 1, seven: 1 }) }, { state: 'set', set: { pools: ['pool-z'], untagged: true } }, NO_EDGES))
      .toEqual({ wrapper: 'lane-d', score: 1 });
  });
  it('a project side answers as before', () => {
    expect(projectPlacement(ROSTER, HEALTHY, { state: 'tagged', name: 'pool-b' }, NO_EDGES))
      .toEqual({ kind: 'projected', wrapper: 'lane-b', score: 10 });
    const allOff = Object.fromEntries(Object.keys(HEALTHY).map((id) => [id, limit({ disabled: true })]));
    expect(projectPlacement(ROSTER, allOff, { state: 'tagged', name: 'pool-z' }, NO_EDGES)).toEqual({ kind: 'none', pool: 'pool-z' });
    expect(projectPlacement(ROSTER, HEALTHY, { state: 'unreadable' }, NO_EDGES)).toEqual({ kind: 'unmeasurable' });
  });
  it('the set\'s own order is never the placement\'s: the pick is the least loaded in the set', () => {
    const lim = { ...HEALTHY, 'lane-a': limit({ five: 50, seven: 50 }), 'lane-b': limit({ five: 20, seven: 20 }) };
    expect(projectHome(ROSTER, lim, { state: 'set', set: SET_AB }, NO_EDGES)).toEqual({ wrapper: 'lane-c', score: 10 });
  });
});
