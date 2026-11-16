// The pool-set plan's Task 10 (`docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`): `poolSetLoss`, the
// decider behind the server's push when a placing box loses a capability word while a fact that needs it stands. Its cases
// live in `sim/poolSetSets.ts`, where the mutation floor runs them against each mutant too.
import { describe, it } from 'vitest';
import { poolSetLoss } from '../src/poolrule.js';
import { poolSetLossCases } from './sim/poolSetSets.js';

describe('poolSetLoss: every floor row, an unreadable set counted, once per build and set', () => {
  for (const [name, c] of Object.entries(poolSetLossCases({ poolSetLoss }))) it(name, c);
});
