// The probe schedule, PR B (Overlord W1a, spec §3.3.5 C41 and §3.3.9 C52; the plan is
// `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`, Tasks 5 and 6). The cases live in `./sim/probeDoorSets.ts`,
// where `sim/mutation-floors.test.ts` runs them against every mutant too; here they run against the real module.
import { describe, it } from 'vitest';
import * as schedule from '../src/continuity/probeSchedule.js';
import {
  compactionWindowStartCases, ctxSinceCompactionCases, emptyTryKeyCases, probeFailedUnfixedOfCases, probeScheduleCases, roundSnapshotOfCases, roundsOfCases,
  spotFactsOfCases,
} from './sim/probeDoorSets.js';

describe('roundsOf: rows grouped into rounds, a round graded when every row is', () => {
  for (const [name, run] of Object.entries(roundsOfCases(schedule))) it(name, run);
});
describe('compactionWindowStart: the later of the entry and the newest snapshot round', () => {
  for (const [name, run] of Object.entries(compactionWindowStartCases(schedule))) it(name, run);
});
describe('probeFailedUnfixedOf: two failed compaction rounds in a row', () => {
  for (const [name, run] of Object.entries(probeFailedUnfixedOfCases(schedule))) it(name, run);
});
describe('probeSchedule: when a round opens and which one feeds the machine', () => {
  for (const [name, run] of Object.entries(probeScheduleCases(schedule))) it(name, run);
});
describe('spotFactsOf: only this generation\'s rows', () => {
  for (const [name, run] of Object.entries(spotFactsOfCases(schedule))) it(name, run);
});
describe('roundSnapshotOf: the snapshot a round is drawn from (review 2063 F2)', () => {
  for (const [name, run] of Object.entries(roundSnapshotOfCases(schedule))) it(name, run);
});
describe('emptyTryKey: what an empty try is remembered by (review 2063 F4)', () => {
  for (const [name, run] of Object.entries(emptyTryKeyCases(schedule))) it(name, run);
});
describe('ctxSinceCompaction: the context only from a reading newer than the compaction (review 2068 F1)', () => {
  for (const [name, run] of Object.entries(ctxSinceCompactionCases(schedule))) it(name, run);
});
