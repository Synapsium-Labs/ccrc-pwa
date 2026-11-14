// `startVerdict` and `waveBoundaryOf`, the generations lane's deciders (Overlord spec §3.3.11; W1a, the generations piece).
// The cases are written once, in `sim/generationStartSets.ts`, so the mutation floor runs the same ones.
import { describe, it } from 'vitest';
import * as decider from '../src/continuity/generationStart.js';
import {
  firstMintCases, judgedForDueCases, startBatchCases, startHoldCases, startVerdictCases, waveBoundaryCases,
} from './sim/generationStartSets.js';

describe('startVerdict: a start mints the next generation of a long-lived identity, and nothing else does', () => {
  for (const [name, fn] of Object.entries(startVerdictCases(decider))) it(name, fn, 60_000);
});

describe('waveBoundaryOf: wave N+1 open and wave N closed', () => {
  for (const [name, fn] of Object.entries(waveBoundaryCases(decider))) it(name, fn, 60_000);
});

describe('startHold: a start waits for a later pass when the listing may predate it, or a failed read skipped it, bounded (review 2003 F2; review 2006 R1, R3)', () => {
  for (const [name, fn] of Object.entries(startHoldCases(decider))) it(name, fn, 60_000);
});

describe('planStartBatch: which starts a pass judges, which wait, and where the cursor moves (review 2006 R6, R8)', () => {
  for (const [name, fn] of Object.entries(startBatchCases(decider))) it(name, fn, 60_000);
});

describe('firstMintOf: a coordinator\'s first generation, from the newest start that mints, stopping at a held one (review 2006 R2)', () => {
  for (const [name, fn] of Object.entries(firstMintCases(decider))) it(name, fn, 60_000);
});

describe('judgedForDue: the due record does not depend on the walk (review 2003 F1)', () => {
  for (const [name, fn] of Object.entries(judgedForDueCases(decider))) it(name, fn, 60_000);
});
