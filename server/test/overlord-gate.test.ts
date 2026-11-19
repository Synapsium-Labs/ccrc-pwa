// The Overlord gate order's deciders (Overlord W1, gates B, plan w1-gates.md Task 4): `callerStandingOf`, `fenceVerdict`,
// `counterVerdict` and `overlordGate`. The cases live once in `sim/gateSets.ts`, as the identity vocabulary's do, so the
// every-run mutation floor (`sim/mutation-floors.test.ts`) runs the same cases against each mutant of the module.
import { describe, it, expect } from 'vitest';
import * as gate from '../src/coord/overlordGate.js';
import { OVERLORD_DOORS, doorRow } from '../src/coord/overlordDoors.js';
import {
  callerStandingCases, fenceVerdictCases, counterVerdictCases, overlordGateCases, GATE_DOOR_KEYS, passFacts, isStart,
} from './sim/gateSets.js';

describe('callerStandingOf and incarnationNeeded (step 1)', () => {
  for (const [name, fn] of Object.entries(callerStandingCases(gate))) it(name, fn);
});
describe('fenceVerdict (steps 5 and 7)', () => {
  for (const [name, fn] of Object.entries(fenceVerdictCases(gate))) it(name, fn);
});
describe('counterVerdict', () => {
  for (const [name, fn] of Object.entries(counterVerdictCases(gate))) it(name, fn);
});
describe('overlordGate (the order)', () => {
  for (const [name, fn] of Object.entries(overlordGateCases(gate))) it(name, fn);
});
describe('the door table the gate reads', () => {
  it('every Overlord row is a start door today, and the card recording page is the one write whose act is read', () => {
    expect(GATE_DOOR_KEYS.length).toBeGreaterThan(0);
    for (const k of GATE_DOOR_KEYS) expect(isStart(OVERLORD_DOORS[k] as never), k).toBe(true);
    const reads = GATE_DOOR_KEYS.filter((k) => { const r = doorRow(k) as { write: boolean; act: string }; return r.write && r.act === 'read'; });
    expect(reads).toEqual(['card-record']);
  });
  it('a passing fact set passes at every row', () => {
    for (const k of GATE_DOOR_KEYS) expect(gate.overlordGate(passFacts(doorRow(k) as never)), k).toEqual({ kind: 'pass' });
  });
});
