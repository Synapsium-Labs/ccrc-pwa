// `generationStep`, Table 3.3.11a as a pure machine, checked against the model (Overlord spec §3.3.11; W1a renewal
// deciders Task 5). The cases are written once, in `sim/renewalDeciderSets.ts`, so the mutation floor runs the same ones.
import { describe, it } from 'vitest';
import * as machine from '../src/continuity/generationMachine.js';
import { generationStepCases } from './sim/renewalDeciderSets.js';

describe('generationStep: never active without a read card and a passed round; a failure before the first half goes back', () => {
  for (const [name, fn] of Object.entries(generationStepCases(machine))) it(name, fn, 60_000);
});
