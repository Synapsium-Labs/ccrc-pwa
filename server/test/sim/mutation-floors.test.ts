// Mutation floors for deciders (Overlord W1a, D-8217): each decider's textual mutants run against its exhaustive test or
// seeded scenario, and its score may only rise. A new L1 decider adds one entry to MUTANT_SETS and one floor.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { mergeBaseText } from '../mergeBase.js';
import { COORD_BLOCKED_INVARIANTS, coordBlockedDay, type CoordBlockedModule } from './coordBlockedDay.js';
import { floorsFallen, rewriteRelativeImports, runMutants, type MutantSet, type SuiteCase } from './mutate.js';
import { MAIL_PACE_MUTANT_SETS } from './mailPaceSets.js';
import { LAUNCH_PROFILE_MUTANT_SETS } from './launchProfileSets.js';
import { RENEWAL_MUTANT_SETS } from './renewalDeciderSets.js';
import { simulate } from './run.js';
import {
  CARD_BLOCK_KEY, CARD_BLOCK_SET, CARD_NEVER_EMPTY_KEY, CARD_NEVER_EMPTY_SET, CARD_ONE_LINE_KEY, CARD_ONE_LINE_SET, CARD_TRIM_KEY,
  CARD_TRIM_SET,
} from './cardMutants.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const FLOORS = JSON.parse(readFileSync(path.join(HERE, 'mutation-floors.json'), 'utf8')) as Record<string, number>;
const KEY = 'server/src/coord/stall.ts#stallCoordBlockedStep';
const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);

const COORD_BLOCKED_SET: MutantSet<CoordBlockedModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/stall.ts'),
  mutants: [
    { id: 'M1', old: 'if (now - oldest.since < COORD_BLOCKED_HELD_MS) return 0;', new: 'if (now - oldest.since < COORD_BLOCKED_OLD_MS) return 0;' },
    { id: 'M2', old: 'Math.max(prev.rung, stallCoordRungNow(si, oldest, now))', new: 'stallCoordRungNow(si, oldest, now)' },
    { id: 'M3', old: 'input.episode ?? { since: oldest.since, rung: 0 }', new: '{ since: oldest.since, rung: 0 }' },
    { id: 'M4', old: 'if (oldest === undefined) return closed;', new: 'if (oldest === undefined) return { verdict: VERDICT_NONE, episode: input.episode };' },
    // M5 and M6 came from review run 1796: the decider hands back no episode, and the push comes one sweep late.
    { id: 'M5', old: "rung: 2, key: prev.since, to: 'operator' },\n    episode,", new: "rung: 2, key: prev.since, to: 'operator' },\n    episode: null," },
    { id: 'M6', old: 'if (now - oldest.since < COORD_BLOCKED_HELD_MS) return 0;', new: 'if (now - oldest.since <= COORD_BLOCKED_HELD_MS) return 0;' },
  ],
  suite(mod) {
    const cases: Record<string, SuiteCase> = {};
    for (const seed of SEEDS) {
      cases[`seed ${seed}`] = async () => {
        const r = await simulate(coordBlockedDay(mod), seed, COORD_BLOCKED_INVARIANTS);
        if (r.violations.length > 0) throw new Error(`${r.violations[0]!.invariant}: ${r.violations[0]!.message}`);
      };
    }
    return cases;
  },
};

const MUTANT_SETS: Record<string, MutantSet<never>> = {
  [KEY]: COORD_BLOCKED_SET as MutantSet<never>,
  [CARD_TRIM_KEY]: CARD_TRIM_SET as MutantSet<never>,
  [CARD_NEVER_EMPTY_KEY]: CARD_NEVER_EMPTY_SET as MutantSet<never>,
  [CARD_ONE_LINE_KEY]: CARD_ONE_LINE_SET as MutantSet<never>,
  [CARD_BLOCK_KEY]: CARD_BLOCK_SET as MutantSet<never>,
  ...RENEWAL_MUTANT_SETS,
  ...MAIL_PACE_MUTANT_SETS,
  ...LAUNCH_PROFILE_MUTANT_SETS,
};

it('rewriteRelativeImports makes ./ and ../ absolute and leaves bare specifiers', () => {
  const out = rewriteRelativeImports(`import { a } from '../x.js';\nimport b from 'node:fs';\n`, '/r/src/coord');
  expect(out).toContain(`from '${path.resolve('/r/src/x.js')}'`);
  expect(out).toContain(`from 'node:fs'`);
});
it('BASELINE: an unmutated copy loaded the same way runs and passes every suite case', async () => {
  const r = await runMutants({ ...MUTANT_SETS[KEY]!, mutants: [] });
  expect([r.results, r.baselineCases]).toEqual([[], 32]);
}, 60_000);
it('a baseline whose case fails unmutated is a failure, never a run of kills', async () => {
  const broken = { ...MUTANT_SETS[KEY]!, suite: () => ({ broken: () => { throw new Error('unmutated'); } }) };
  await expect(runMutants(broken)).rejects.toThrow(/baseline failed: broken: Error: unmutated/);
}, 60_000);
it('a baseline that ran no case is a failure, never a pass', async () => {
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [], suite: () => ({}) })).rejects.toThrow(/baseline/);
}, 60_000);
it('a mutant whose old text is absent is invalid, and the run throws', async () => {
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [{ id: 'x', old: 'no such text', new: '' }] }))
    .rejects.toThrow(/invalid: x/);
}, 60_000);
it('a mutant that does not compile is invalid, never killed', async () => {
  const old = 'if (oldest === undefined) return closed;';
  await expect(runMutants({ ...MUTANT_SETS[KEY]!, mutants: [{ id: 'syntax', old, new: 'if (' }] }))
    .rejects.toThrow(/invalid: syntax/);
}, 60_000);
it.each(Object.keys(MUTANT_SETS))('%s: every mutant is killed, and the score is at least its floor', async (key) => {
  const r = await runMutants(MUTANT_SETS[key]!);
  expect(r.results.filter((x) => x.status !== 'killed')).toEqual([]);
  expect(r.score).toBeGreaterThanOrEqual(FLOORS[key]!);
}, 120_000);
it('the floors and the mutant sets name the same deciders', () => {
  expect(Object.keys(FLOORS).sort()).toEqual(Object.keys(MUTANT_SETS).sort());
});
it('CONTROL: floorsFallen names a lowered floor and a removed one, and nothing else', () => {
  expect(floorsFallen({ a: 1, b: 0.5, c: 0.5 }, { a: 0.75, b: 0.75 })).toEqual(['a', 'c']);
});
it('no floor falls below its value at the merge-base with origin/main', () => {
  const base = mergeBaseText(ROOT, 'server/test/sim/mutation-floors.json');
  if (base === null) { console.warn('mutation-floors: no floors file at the merge-base with origin/main, skipped'); return; }
  expect(floorsFallen(JSON.parse(base) as Record<string, number>, FLOORS)).toEqual([]);
});
