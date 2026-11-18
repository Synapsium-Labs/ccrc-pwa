// Overlord W2, forecasts A (plan w2-forecasts-health.md, Tasks 1 and 2): the cases of `./forecastCases.ts` against the real
// `seededDraws` and forecast deciders, with the plan's 200 runs per property. `sim/forecastSets.ts` runs the same cases
// against each mutant.
import { describe, it } from 'vitest';
import * as forecasts from '../src/coord/forecast.js';
import * as seeded from '../src/time/seeded.js';
import { SEEDED_CASES, forecastCases } from './forecastCases.js';

describe('seededDraws', () => {
  for (const c of SEEDED_CASES) it(c.name, () => c.run(seeded));
});

describe('forecastProgramme, forecastOutcome and forecastCalibration', () => {
  for (const c of forecastCases(200)) it(c.name, () => c.run(forecasts));
});
