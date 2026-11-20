// The probe door, PR B (Overlord W1a, spec §3.3.5 C41 and §3.3.9 C52; the plan is
// `docs/superpowers/plans/2026-11-10-overlord/w1a-probes.md`, Task 4) and the snapshot reader the probes draw from
// (`snapshotFactsOf`). The cases live in `./sim/probeDoorSets.ts`, where `sim/mutation-floors.test.ts` runs them against
// every mutant too; here they run against the real modules.
import { describe, it } from 'vitest';
import * as card from '../src/continuity/card.js';
import * as door from '../src/continuity/probeDoor.js';
import { bookOfCases, gradeAnswersCases, maskedQuestionCases, probePagesCases, snapshotFactsOfCases } from './sim/probeDoorSets.js';

describe('maskedQuestion: masked once, graded masked', () => {
  for (const [name, run] of Object.entries(maskedQuestionCases(door))) it(name, run);
});
describe('gradeAnswers: closed-form, a missing answer fails', () => {
  for (const [name, run] of Object.entries(gradeAnswersCases(door))) it(name, run);
});
describe('bookOf: open, closed or unmeasured, from the cards and the read ledger', () => {
  for (const [name, run] of Object.entries(bookOfCases(door))) it(name, run);
});
describe('probePages: each question one untrusted block, choices as JSON strings', () => {
  for (const [name, run] of Object.entries(probePagesCases(door))) it(name, run);
});
describe('snapshotFactsOf: a stored snapshot read back, a fact it cannot read unmeasured', () => {
  for (const [name, run] of Object.entries(snapshotFactsOfCases(card))) it(name, run);
});
