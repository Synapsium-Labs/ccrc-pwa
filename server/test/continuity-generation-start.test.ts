// `startVerdict` and `waveBoundaryOf`, the generations lane's deciders (Overlord spec §3.3.11; W1a, the generations piece).
// The cases are written once, in `sim/generationStartSets.ts`, so the mutation floor runs the same ones.
import { describe, it } from 'vitest';
import * as decider from '../src/continuity/generationStart.js';
import { judgedForDueCases, startHeldCases, startVerdictCases, waveBoundaryCases } from './sim/generationStartSets.js';

describe('startVerdict: a start mints the next generation of a long-lived identity, and nothing else does', () => {
  for (const [name, fn] of Object.entries(startVerdictCases(decider))) it(name, fn, 60_000);
});

describe('waveBoundaryOf: wave N+1 open and wave N closed', () => {
  for (const [name, fn] of Object.entries(waveBoundaryCases(decider))) it(name, fn, 60_000);
});

describe('startHeld: a start a failed registry read skipped waits for a later pass, bounded (review 2003 F2)', () => {
  for (const [name, fn] of Object.entries(startHeldCases(decider))) it(name, fn, 60_000);
});

describe('judgedForDue: the due record does not depend on the walk (review 2003 F1)', () => {
  for (const [name, fn] of Object.entries(judgedForDueCases(decider))) it(name, fn, 60_000);
});
