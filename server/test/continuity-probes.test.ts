// The probes, PR A (Overlord W1a, spec §3.3.5 C41 and §3.3.9 C52; the plan is
// `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`, Tasks 1 to 3). The cases live in `./sim/probeSets.ts`, where
// `sim/mutation-floors.test.ts` runs them against every mutant too; here they run against the real module.
import { describe, it } from 'vitest';
import * as probes from '../src/continuity/probes.js';
import { fittedCeilingCases, gradeCases, probeRoundCases } from './sim/probeSets.js';

describe('probeRound: a round drawn from the session\'s own rows (Task 1)', () => {
  for (const [name, run] of Object.entries(probeRoundCases(probes))) it(name, run);
});
describe('gradeProbe and roundVerdict: closed-form, all or nothing (Task 2)', () => {
  for (const [name, run] of Object.entries(gradeCases(probes))) it(name, run);
});
describe('fittedCeiling: derived from closed-book spot probes (Task 3)', () => {
  for (const [name, run] of Object.entries(fittedCeilingCases(probes))) it(name, run);
});
