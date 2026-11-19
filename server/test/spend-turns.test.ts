// Overlord W2 forecasts B, fix round 2 (F2-a): the spend arm's turn guard on the adapter side. `readSpendTurns` turns a
// marker that cannot vouch into `unread`, and `spendReadingOf` reads a session the lane has not read yet as `unread`, so
// neither reaches the spend verdict as fresh. The cases live in sim/programmeHealthSets.ts, where the mutant sets run
// them against each mutant; this file runs them against the real modules.
import { describe, it } from 'vitest';
import * as usage from '../src/usage.js';
import * as lane from '../src/coord/forecastLane.js';
import { spendReadingCases, spendTurnsCases } from './sim/programmeHealthSets.js';

describe('the spend arm\'s turn guard (fix round 2, F2-a)', () => {
  for (const c of spendTurnsCases()) it(c.name, () => c.run(usage));
  for (const c of spendReadingCases()) it(c.name, () => c.run(lane));
});
