// Overlord lane C (the act journal plan's question 10, slug `act-journal-ships-the-head-cache`, ruling F16 of review 2275):
// the chained-journal file adapter's verified-head cache (`server/src/chainedJournalFile.ts#chainedJournalFileAt`). A hit
// skips re-verifying the bytes before the cached head only when the adapter can show they are unchanged since it verified
// them; any doubt is a full verify. The cases live in `sim/chainedJournalFileSets.ts`, run here against the real adapter;
// the decision's mutant set runs in mutation-floors.test.ts, and the adapter's own here, every mutant killed.
import { afterEach, describe, expect, it } from 'vitest';
import * as Adapter from '../src/chainedJournalFile.js';
import { HEAD_CACHE_SET, headCacheSuite, headHoldsSuite } from './sim/chainedJournalFileSets.js';
import { runMutants } from './sim/mutate.js';
import { removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

describe('verifiedHeadHolds: the cache\'s one decision', () => {
  for (const [name, fn] of Object.entries(headHoldsSuite(Adapter))) it(name, fn);
});

describe('the verified-head cache: a hit only on bytes shown unchanged', () => {
  for (const [name, fn] of Object.entries(headCacheSuite(Adapter))) it(name, fn);
});

describe('the adapter\'s use of the decision, by mutation', () => {
  it('every mutant of the hit, the bytes after the head and the key it keeps is killed by the cases above', async () => {
    const r = await runMutants(HEAD_CACHE_SET);
    expect(r.results.filter((x) => x.status !== 'killed')).toEqual([]);
    expect(r.results.length).toBe(HEAD_CACHE_SET.mutants.length);
  }, 120_000);
});
