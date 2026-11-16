// `softRenewalMay` and `earlyWhileAway` (Overlord spec §3.3.11, R19, the preconditions and the soft budget; C50; W1a
// renewal deciders Task 4). The cases are written once, in `sim/renewalDeciderSets.ts`, so the mutation floors run the
// same ones.
import { describe, it } from 'vitest';
import * as soft from '../src/continuity/softRenewal.js';
import { earlyWhileAwayCases, softRenewalCases } from './sim/renewalDeciderSets.js';

describe('softRenewalMay: the waits in order, and an unmeasured reading never starts a renewal', () => {
  for (const [name, fn] of Object.entries(softRenewalCases(soft))) it(name, fn, 60_000);
});

describe('earlyWhileAway: at a break, past half of a soft row\'s threshold (R19)', () => {
  for (const [name, fn] of Object.entries(earlyWhileAwayCases(soft))) it(name, fn);
});
