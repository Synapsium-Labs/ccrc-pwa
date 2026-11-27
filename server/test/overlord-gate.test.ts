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
  // The W1 inbox piece's three doors are of class `other` too (every step runs), and its two reads are fenced, as the card's
  // recording page is (the inbox plan's question 15).
  // The history door (W1 PR B1) is a fenced read of class `other` too.
  it('every Overlord row but the team link (D-8809), the inbox piece\'s three and the history door is a start door today, and the fenced reads are the card recording page, the inbox\'s two and the history door', () => {
    expect(GATE_DOOR_KEYS.length).toBeGreaterThan(0);
    // The Overlord's timers (W1): the three timer doors are of class `other` too, and name no act kind.
    const notStart = new Set(['link-team', 'inbox', 'messages', 'acknowledge', 'history', 'sequence', 'timer-set', 'timer-list', 'timer-cancel']);
    for (const k of GATE_DOOR_KEYS) expect(isStart(OVERLORD_DOORS[k] as never), k).toBe(!notStart.has(k));
    const reads = GATE_DOOR_KEYS.filter((k) => { const r = doorRow(k) as { write: boolean; act: string }; return r.write && r.act === 'read'; });
    expect(reads).toEqual(['card-record', 'inbox', 'messages', 'history']);
  });
  it('a passing fact set passes at every row', () => {
    for (const k of GATE_DOOR_KEYS) expect(gate.overlordGate(passFacts(doorRow(k) as never)), k).toEqual({ kind: 'pass' });
  });
  it('D-8809: the team link runs every step, and below full it is refused rung-below at step 10', () => {
    const door = doorRow('link-team') as never;
    for (const rung of ['chat', 'advise']) {
      const v = gate.overlordGate(passFacts(door, { ladder: { kind: 'read', rung: { rung, operatorRung: 'full', binding: [], readBy: [] } } }));
      expect([v.kind, (v as { word?: string }).word, (v as { step?: string }).step], rung).toEqual(['refuse', 'rung-below', '10']);
    }
    expect(gate.overlordGate(passFacts(door, { card: 'none' }))).toMatchObject({ kind: 'refuse', word: 'card-unread', step: '8' });
    expect(gate.overlordGate(passFacts(door, { standing: { kind: 'other' } }))).toMatchObject({ kind: 'refuse', word: 'not-the-overlord', step: '1' });
  });
});
