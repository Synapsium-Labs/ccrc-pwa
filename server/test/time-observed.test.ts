// Observed time, the clock kernel's one accumulator (Overlord spec §11.5; W1a renewal deciders Task 2). The cases are
// written once, in `sim/renewalDeciderSets.ts`, so the mutation floor runs the same ones.
import { describe, it } from 'vitest';
import * as observed from '../src/time/observed.js';
import { observeTimeCases } from './sim/renewalDeciderSets.js';

describe('observeTime: advances by monotonic deltas within one process, never across a gap', () => {
  for (const [name, fn] of Object.entries(observeTimeCases(observed))) it(name, fn);
});
