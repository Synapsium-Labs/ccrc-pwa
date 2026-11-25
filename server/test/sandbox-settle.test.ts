// The settle step's decider and the skew notice's (Overlord W1 sandbox PR B, Task 9; spec §3.2 C2, question 5). The cases live
// in `sim/sandboxSets.ts`, so the mutation floor runs the same ones against each mutant. The door's acts are in
// `continuity-start-loads-route.test.ts`.
import { describe, it } from 'vitest';
import * as sandbox from '../src/continuity/sandboxCheck.js';
import { settleCases, settleEvidenceCases, skewCases } from './sim/sandboxSets.js';

describe('sandboxSettle (Task 9)', () => {
  for (const [name, run] of Object.entries(settleCases(sandbox))) it(name, run);
});

describe('settleEvidenceStands (review 3366 F4)', () => {
  for (const [name, run] of Object.entries(settleEvidenceCases(sandbox))) it(name, run);
});

describe('skewNoticeOf (Task 9, question 5)', () => {
  for (const [name, run] of Object.entries(skewCases(sandbox))) it(name, run);
});
