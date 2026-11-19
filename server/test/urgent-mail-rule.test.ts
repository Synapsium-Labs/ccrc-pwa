// The urgent-mail sender rule (mid-turn mail PR 2, plan Task 2.3; spec §3.1). The cases live once in
// `sim/urgentMailSets.ts`, so `mutation-floors.test.ts` runs the same cases against each mutant of the decider.
import { describe, expect, it } from 'vitest';
import * as urgentMail from '../src/coord/urgentMail.js';
import { runMutants } from './sim/mutate.js';
import { URGENT_MAIL_MUTANT_SETS, urgentSenderVerdictCases } from './sim/urgentMailSets.js';

describe('urgentSenderVerdict (spec §3.1, plan P2 and P3)', () => {
  for (const [name, fn] of Object.entries(urgentSenderVerdictCases(urgentMail))) it(name, fn);

  it('stores one of two role words, and nothing else', () => {
    expect([...urgentMail.URGENT_ROLES]).toEqual(['coordinator', 'overlord']);
  });

  it('every mutant of the decider is killed by the cases above', async () => {
    const set = URGENT_MAIL_MUTANT_SETS['server/src/coord/urgentMail.ts#urgentSenderVerdict']!;
    const report = await runMutants(set);
    expect(report.results.filter((r) => r.status !== 'killed').map((r) => r.id), 'surviving mutants').toEqual([]);
    expect(report.score).toBe(1);
  }, 60_000);
});
