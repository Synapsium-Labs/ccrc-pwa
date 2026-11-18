// Overlord W2, forecasts B (plan w2-forecasts-health.md, Task 6): `programmeMeasures.ts`, the programme measures the
// portfolio and the health decider share: `waveSpend`, `closedIn` and the wave rule moved out of `portfolio.ts`. The cases
// live in `./sim/programmeHealthSets.ts`, so the mutant sets judge the same ones.
import { describe, it } from 'vitest';
import * as measures from '../src/coord/programmeMeasures.js';
import { measuresCases } from './sim/programmeHealthSets.js';

describe('programmeMeasures', () => {
  for (const c of measuresCases()) it(c.name, () => c.run(measures));
});
