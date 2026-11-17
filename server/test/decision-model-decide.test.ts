// Overlord W2, the decision-model port (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 2):
// planning, encoding and reading a call, against the real module. The cases live in `decisionModelCases.ts`, which the
// mutation sets (`sim/decisionModelSets.ts`) run against each mutant too.
import { describe, expect, it } from 'vitest';
import * as decisionModel from '../src/coord/decisionModel.js';
import { decisionCallMiss, decisionDayOf, decisionLineGen, egressWordOf } from '../src/coord/decisionModel.js';
import { ALL_DECISION_MODEL_CASES, ARMED_HELD, SHADOW } from './decisionModelCases.js';

describe('decisionModel.ts: plan, encode and read (Task 2)', () => {
  it.each(ALL_DECISION_MODEL_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(decisionModel));
});

describe('decisionModel.ts: the small helpers the one caller reads', () => {
  it('decisionDayOf is the UTC day', () => {
    expect(decisionDayOf(Date.UTC(2026, 10, 16, 23, 59, 59))).toBe('2026-11-16');
    expect(decisionDayOf(Date.UTC(2026, 10, 17, 0, 0, 0))).toBe('2026-11-17');
  });

  it('decisionLineGen: an armed gate is gathered under its own line, never a newer one; else the current line, 0 before any', () => {
    const armed = { ...ARMED_HELD, held: false };
    expect(decisionLineGen('scope.widens', armed, { id: 7 })).toBe(3);
    expect(decisionLineGen('scope.widens', SHADOW, { id: 7 })).toBe(7);
    expect(decisionLineGen('relay.method', armed, { id: 7 })).toBe(7);
    expect(decisionLineGen('relay.method', SHADOW, null)).toBe(0);
  });

  it('egressWordOf names what the check records', () => {
    expect(egressWordOf('clear')).toBe('clear');
    expect(egressWordOf('no-list')).toBe('skipped-no-list');
    expect(egressWordOf('not-hosted')).toBe('not-hosted');
  });

  it('decisionCallMiss keeps the port word, its why, attempts and time', () => {
    expect(decisionCallMiss('relay.method', { outcome: 'unavailable', why: 'timeout', ms: 2000, attempts: 1 }))
      .toEqual({ row: 'relay.method', outcome: 'unavailable', why: 'timeout', ms: 2000, attempts: 1 });
    expect(decisionCallMiss('relay.method', { outcome: 'auth-failed', ms: 10, attempts: 1 }))
      .toEqual({ row: 'relay.method', outcome: 'auth-failed', why: null, ms: 10, attempts: 1 });
  });
});
