// `startVerdict` and `waveBoundaryOf`, the generations lane's deciders (Overlord spec §3.3.11; W1a, the generations piece).
// The cases are written once, in `sim/generationStartSets.ts`, so the mutation floor runs the same ones.
import { describe, it } from 'vitest';
import * as decider from '../src/continuity/generationStart.js';
import { startVerdictCases, waveBoundaryCases } from './sim/generationStartSets.js';

describe('startVerdict: a start mints the next generation of a long-lived identity, and nothing else does', () => {
  for (const [name, fn] of Object.entries(startVerdictCases(decider))) it(name, fn, 60_000);
});

describe('waveBoundaryOf: wave N+1 open and wave N closed', () => {
  for (const [name, fn] of Object.entries(waveBoundaryCases(decider))) it(name, fn, 60_000);
});
