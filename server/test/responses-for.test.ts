// The response record's figures and retention gate (Overlord W1, the response record, Tasks 5 and 8: plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md, questions 13 and 16). The cases live in
// `sim/responsesSets.ts`, so this suite and the mutation floors run the same ones.
import { describe, it } from 'vitest';
import * as responses from '../src/responses.js';
import { responsesForCases, retentionChangeGateCases } from './sim/responsesSets.js';

describe('responsesFor', () => {
  for (const [title, run] of Object.entries(responsesForCases(responses))) it(title, run);
});
describe('retentionChangeGate', () => {
  for (const [title, run] of Object.entries(retentionChangeGateCases(responses))) it(title, run);
});
