// Overlord W2, forecasts B (plan w2-forecasts-health.md, Task 6): the cases of `./sim/programmeHealthSets.ts` against the
// real `programmeHealth`, `healthFactsOf`, `criticalPath` and `healthChangeVerdict`, with the plan's 200 runs per property.
// The same cases are the judges of the mutant sets in that file.
import { describe, it } from 'vitest';
import * as health from '../src/coord/programmeHealth.js';
import { healthCases, pathCases } from './sim/programmeHealthSets.js';

describe('programmeHealth and healthFactsOf', () => {
  for (const c of healthCases(200)) it(c.name, () => c.run(health));
});

describe('criticalPath and healthChangeVerdict', () => {
  for (const c of pathCases()) it(c.name, () => c.run(health));
});
