// The park's L1 deciders (approvals plan 2026-11-18, §3.3; approvals PR 3), every case of `approvalParkCases.ts` run against
// the real modules. The same cases kill the mutants of `sim/approvalParkSets.ts`.
import { describe, it } from 'vitest';
import * as park from '../src/coord/approvalPark.js';
import * as policy from '../src/coord/questionPolicy.js';
import { APPROVAL_LAPSE_PARK_CASES, APPROVAL_PARK_CASES } from './approvalParkCases.js';

describe('the park\'s deciders (approvalPark.ts)', () => {
  it.each(APPROVAL_PARK_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(park));
});

describe('the lapse decider\'s park arms and the deferred push (questionPolicy.ts)', () => {
  it.each(APPROVAL_LAPSE_PARK_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(policy));
});
