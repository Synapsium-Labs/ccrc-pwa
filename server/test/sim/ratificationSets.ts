// The goals ratification's mutant sets (Overlord W1, portfolio B, plan w1-portfolio.md Task 4 Step 5; the floors rule is
// D-8217's): `goalRatification` and `itemAnswered`, each run against every case of `../ratificationCases.ts` loaded over the
// mutated copy of shared/ledgers.ts. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in
// mutation-floors.json. The plan's red checks are R-1, R-2, R-3 (question 1) and A-1. A re-pin that keeps the old source is
// not a decider's mutant: `goals-ratification.test.ts`' re-pin case catches it in the full suite.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_RATIFICATION_CASES, type RatificationModule } from '../ratificationCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const LEDGERS_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/ledgers.ts');
export const GOAL_RATIFICATION_KEY = 'shared/ledgers.ts#goalRatification';
export const ITEM_ANSWERED_KEY = 'shared/ledgers.ts#itemAnswered';

const suite = (m: RatificationModule): Record<string, SuiteCase> =>
  Object.fromEntries(ALL_RATIFICATION_CASES.map((c) => [c.name, () => c.run(m)]));
const set = (mutants: MutantSet<RatificationModule>['mutants']): MutantSet<RatificationModule> => ({ modulePath: LEDGERS_TS, mutants, suite });

export const GOAL_RATIFICATION_SET = set([
  // The plan's red checks: the item arm answers ratified on a ticked item; `unreadable` reads as `operator`; (question 1) the
  // `coordinator` case ignores the constant.
  { id: 'R-1', old: "return { ratified: false, why: itemAnswered(item) ? 'effect-unmeasured' : 'item-not-answered', source };",
    new: "return itemAnswered(item) ? { ratified: true, source } : { ratified: false, why: 'item-not-answered', source };" },
  { id: 'R-2', old: "if (source === 'unrecorded' || source === 'unreadable') return { ratified: false, why: source, source: null };",
    new: "if (source === 'unrecorded') return { ratified: false, why: source, source: null };\n  if (source === 'unreadable') return { ratified: true, source: { kind: 'operator' } };" },
  { id: 'R-3', old: "return COORDINATOR_SOURCE_RATIFIES ? { ratified: true, source } : { ratified: false, why: 'source-does-not-ratify', source };",
    new: "return { ratified: false, why: 'source-does-not-ratify', source };" },
  { id: 'R-4', old: 'if (item === null || item.program !== program)', new: 'if (item === null)' },
  { id: 'R-5', old: "    case 'operator':\n      return { ratified: true, source };", new: "    case 'operator':\n      return { ratified: false, why: 'unrecorded', source };" },
  { id: 'R-6', old: 'return { ratified: false, why: source, source: null };', new: "return { ratified: false, why: 'unrecorded', source: null };" },
  { id: 'R-7', old: "item.program !== program) return { ratified: false, why: 'unreadable', source };", new: "item.program !== program) return { ratified: false, why: 'item-not-answered', source };" },
  { id: 'R-8', old: 'export const COORDINATOR_SOURCE_RATIFIES: boolean = true;', new: 'export const COORDINATOR_SOURCE_RATIFIES: boolean = false;' },
  { id: 'R-9', old: "=> r ?? { ratified: false, why: 'absent', source: null };", new: "=> r ?? { ratified: false, why: 'unrecorded', source: null };" },
]);

export const ITEM_ANSWERED_SET = set([
  // The plan's red check: accept an `open` item with a `tickedAt` (a returned one).
  { id: 'A-1', old: "(item.state === 'checking' || item.state === 'done') && item.tickedAt !== null", new: 'item.tickedAt !== null' },
  { id: 'A-2', old: "(item.state === 'checking' || item.state === 'done') && item.tickedAt !== null", new: "(item.state === 'checking' || item.state === 'done')" },
  { id: 'A-3', old: "(item.state === 'checking' || item.state === 'done') && item.tickedAt !== null", new: "item.state === 'checking' && item.tickedAt !== null" },
  { id: 'A-4', old: "(item.state === 'checking' || item.state === 'done') && item.tickedAt !== null", new: "item.state === 'done' && item.tickedAt !== null" },
]);

export const RATIFICATION_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [GOAL_RATIFICATION_KEY]: GOAL_RATIFICATION_SET as MutantSet<never>,
  [ITEM_ANSWERED_KEY]: ITEM_ANSWERED_SET as MutantSet<never>,
};
