// The first line's table's mutant set (Overlord W1 door process A2, Task 5, plan `w1-door-process.md` Step 4): the renewal
// act's `FIRST_PROMPT_OF_ROLE` (server/src/continuity/renewalFeed.ts), each row swapped to the other line. Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { FLEET_ROLE_NAMES } from '../../../shared/fleetRoles.js';
import type * as FeedModule from '../../src/continuity/renewalFeed.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Feed = typeof FeedModule;
const FEED_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity/renewalFeed.ts');
export const FIRST_PROMPT_KEY = 'server/src/continuity/renewalFeed.ts#FIRST_PROMPT_OF_ROLE';

/** The rule the table writes down: the Overlord, which has no shell, reads its card through its doors; every other role
 *  through `ccrc-api`. */
const expected = (role: string): string => (role === 'overlord' ? 'overlord-first-prompt' : 'renewal-first-prompt');
const swap = (role: string, from: string, to: string): { id: string; old: string; new: string } =>
  ({ id: `P-${role}`, old: `${role}: '${from}'`, new: `${role}: '${to}'` });

export const FIRST_PROMPT_SET: MutantSet<Feed> = {
  modulePath: FEED_TS,
  mutants: FLEET_ROLE_NAMES.map((r) => (r === 'overlord' ? swap(r, 'overlord-first-prompt', 'renewal-first-prompt')
    : swap(r, 'renewal-first-prompt', 'overlord-first-prompt'))),
  suite(m): Record<string, SuiteCase> {
    return Object.fromEntries(FLEET_ROLE_NAMES.map((r) => [`${r} gets ${expected(r)}`, () => {
      expect(m.FIRST_PROMPT_OF_ROLE[r]).toBe(expected(r));
    }]));
  },
};

/** The two renewal mails' table (door process B1): each row swapped to the other role's bodies, and the Overlord's forms named
 *  back to `ccrc-api`. Its rule: the Overlord's forms name its doors, every other role's keep the `ccrc-api` form. */
export const RENEWAL_MAIL_KEY = 'server/src/continuity/renewalFeed.ts#RENEWAL_MAIL_OF_ROLE';
const OVERLORD_ROW = '{ handover: OVERLORD_HANDOVER_BODY, spotProbe: OVERLORD_SPOT_PROBE_BODY }';
const OTHER_ROW = '{ handover: RENEWAL_HANDOVER_BODY, spotProbe: SPOT_PROBE_BODY }';
export const RENEWAL_MAIL_SET: MutantSet<Feed> = {
  modulePath: FEED_TS,
  mutants: [
    ...FLEET_ROLE_NAMES.map((r) => ({ id: `M-${r}`, old: `${r}: ${r === 'overlord' ? OVERLORD_ROW : OTHER_ROW}`, new: `${r}: ${r === 'overlord' ? OTHER_ROW : OVERLORD_ROW}` })),
    { id: 'M-handover-door', old: 'Write your handover note now with your note handover door.', new: 'Write your handover note now with `ccrc-api note handover`.' },
    { id: 'M-probe-door', old: 'Answer it with your probe door.', new: 'Answer it with `ccrc-api probe`.' },
  ],
  suite(m): Record<string, SuiteCase> {
    return Object.fromEntries(FLEET_ROLE_NAMES.map((r) => [`${r}'s renewal mails`, () => {
      const row = m.RENEWAL_MAIL_OF_ROLE[r];
      if (r === 'overlord') {
        expect(`${row.handover}\n${row.spotProbe}`).not.toContain('ccrc-api');
        expect(row.handover).toContain('note handover door');
        expect(row.spotProbe).toContain('probe door');
      } else {
        expect(row).toEqual({ handover: m.RENEWAL_HANDOVER_BODY, spotProbe: m.SPOT_PROBE_BODY });
      }
    }]));
  },
};

export const FIRST_PROMPT_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [FIRST_PROMPT_KEY]: FIRST_PROMPT_SET as MutantSet<never>,
  [RENEWAL_MAIL_KEY]: RENEWAL_MAIL_SET as MutantSet<never>,
};
