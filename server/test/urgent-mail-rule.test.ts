// The urgent-mail sender rule (mid-turn mail PR 2, plan Task 2.3; spec §3.1). The cases live once in
// `sim/urgentMailSets.ts`, so `mutation-floors.test.ts` runs the same cases against each mutant of the decider.
import { describe, expect, it } from 'vitest';
import * as urgentMail from '../src/coord/urgentMail.js';
import { MAILHOLD_ROLES } from '../../shared/mailHold.js';
import { runMutants } from './sim/mutate.js';
import { URGENT_MAIL_MUTANT_SETS, urgentSenderVerdictCases } from './sim/urgentMailSets.js';

describe('urgentSenderVerdict (spec §3.1, plan P2 to P4)', () => {
  for (const [name, fn] of Object.entries(urgentSenderVerdictCases(urgentMail))) it(name, fn);

  it('answers only the hold\'s role words (shared/mailHold.ts#MAILHOLD_ROLES)', () => {
    const base = { senderId: 'sess-a', recipientId: 'sess-b', runId: 1, outstanding: false } as const;
    const asCoord = urgentMail.urgentSenderVerdict({ ...base, recipientWorksOn: [1], senderClaims: [1], recipientClaims: [],
      designation: { kind: 'not-designated' } });
    const asOverlord = urgentMail.urgentSenderVerdict({ ...base, recipientWorksOn: [], senderClaims: [], recipientClaims: [1],
      designation: { kind: 'designated', sessionId: 'sess-a' } });
    const roles = [asCoord, asOverlord].map((v) => (v.kind === 'allowed' ? v.role : v.kind));
    expect(roles).toEqual([...MAILHOLD_ROLES]);
  });

  it('every mutant of the decider is killed by the cases above', async () => {
    const set = URGENT_MAIL_MUTANT_SETS['server/src/coord/urgentMail.ts#urgentSenderVerdict']!;
    const report = await runMutants(set);
    expect(report.results.filter((r) => r.status !== 'killed').map((r) => r.id), 'surviving mutants').toEqual([]);
    expect(report.score).toBe(1);
  }, 60_000);
});
