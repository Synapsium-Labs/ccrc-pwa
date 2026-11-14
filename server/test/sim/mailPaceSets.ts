// `mailPaceOf`'s oracle and mutant set (Overlord W1a, the MAIL_PACE row: w1a-mail-pace-roles.md). Its cases are written
// ONCE here, as suite cases over a module: `mail-pace.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { FLEET_ROLE_NAMES } from '../../../shared/fleetRoles.js';
import type { RoleAmbiguity } from '../../src/roleOf.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type MailPaceModule = typeof import('../../src/coord/mailPace.js');

/** The ambiguities `roleOf` can answer, written out rather than read from `ROLE_AMBIGUITIES`, so a new one is a choice. */
const AMBIGUITIES: Readonly<Record<RoleAmbiguity, readonly string[]>> = {
  'worker-or-reviewer': ['worker', 'reviewer'],
  'coordinator-or-plain': ['coordinator', 'plain'],
};
// Literal on purpose: the slower member's values, from spec §3.3.9 ("it takes the slower mail pace") and today's rows.
const WORKER_PAIR = { quietMs: 60_000, cooldownMs: 120_000 };

export function mailPaceOfCases(m: MailPaceModule): Record<string, SuiteCase> {
  return {
    'a decided role reads its own row': () => {
      for (const role of FLEET_ROLE_NAMES) expect(m.mailPaceOf({ kind: 'role', role }), role).toBe(m.MAIL_PACE[role]);
    },
    'an undecided reading takes the slower row (spec §3.3.9)': () => {
      expect(m.mailPaceOf({ kind: 'undecided', between: 'coordinator-or-plain' })).toEqual(WORKER_PAIR);
      expect(m.mailPaceOf({ kind: 'undecided', between: 'worker-or-reviewer' })).toEqual(WORKER_PAIR);
    },
    'an undecided reading is never faster than any of its members, on either field': () => {
      for (const [between, members] of Object.entries(AMBIGUITIES) as [RoleAmbiguity, readonly string[]][]) {
        const got = m.mailPaceOf({ kind: 'undecided', between });
        for (const r of members) {
          const row = m.MAIL_PACE[r as keyof MailPaceModule['MAIL_PACE']];
          expect(got.quietMs, `${between} vs ${r}`).toBeGreaterThanOrEqual(row.quietMs);
          expect(got.cooldownMs, `${between} vs ${r}`).toBeGreaterThanOrEqual(row.cooldownMs);
        }
      }
    },
  };
}

/** `mailPaceOf`'s mutants. One textual mutant is left out as equivalent today: dropping the `cooldownMs` tiebreak of
 *  `slower` changes nothing while no ambiguity has two members with equal quiet times and different cooldowns
 *  (worker and reviewer share a row; plain's quiet is longer than coordinator's). */
const MAIL_PACE_OF_SET: MutantSet<MailPaceModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/mailPace.ts'),
  mutants: [
    { id: 'P1', old: 'b.quietMs > a.quietMs ||', new: 'b.quietMs < a.quietMs ||' },
    { id: 'P2', old: 'b.cooldownMs > a.cooldownMs) ? b : a;', new: 'b.cooldownMs > a.cooldownMs) ? a : b;' },
    { id: 'P3', old: "if (reading.kind === 'role') return MAIL_PACE[reading.role];", new: "if (reading.kind === 'role') return MAIL_PACE.worker;" },
    { id: 'P4', old: '.reduce(slower)', new: '.reduce((a) => a)' },
  ],
  suite: mailPaceOfCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const MAIL_PACE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/mailPace.ts#mailPaceOf': MAIL_PACE_OF_SET as MutantSet<never>,
};
