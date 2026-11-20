// server/test/mail-hold-policy.test.ts
//
// The mailhold projection's decider (mid-turn mail plan `docs/superpowers/plans/2026-11-19-mid-turn-mail.md` Task 4.2):
// its oracle lives in `sim/mailHoldPolicySets.ts`, so `mutation-floors.test.ts` runs the same cases against each mutant.
import { describe, expect, it } from 'vitest';
import * as mailHoldPolicy from '../src/coord/mailHoldPolicy.js';
import { runMutants } from './sim/mutate.js';
import { MAIL_HOLD_POLICY_MUTANT_SETS, decideMailHoldCases } from './sim/mailHoldPolicySets.js';

describe('decideMailHold (Task 4.2)', () => {
  for (const [name, fn] of Object.entries(decideMailHoldCases(mailHoldPolicy))) it(name, fn);

  it('every mutant of the decider is killed by the cases above', async () => {
    const set = MAIL_HOLD_POLICY_MUTANT_SETS['server/src/coord/mailHoldPolicy.ts#decideMailHold']!;
    const report = await runMutants(set);
    expect(report.results.filter((r) => r.status !== 'killed').map((r) => `${r.id} ${r.status}: ${r.detail}`), 'surviving mutants').toEqual([]);
    expect(report.score).toBe(1);
  }, 60_000);
});
