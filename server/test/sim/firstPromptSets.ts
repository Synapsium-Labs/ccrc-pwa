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

export const FIRST_PROMPT_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [FIRST_PROMPT_KEY]: FIRST_PROMPT_SET as MutantSet<never>,
};
