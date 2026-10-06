// `removeTmpFixturesAfterEachTest` (tmpHelpers.ts), the opt-in that keeps a
// fixture-heavy file's one `afterAll` small. This file opts in, so its cases
// observe the removal BETWEEN cases — the half an `afterAll` never shows. The
// cases depend on running in order, which a file's tests do (no `.concurrent`).
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp, pendingTmpFixtures, removeTmpFixtures, removeTmpFixturesAfterEachTest } from './tmpHelpers.js';

removeTmpFixturesAfterEachTest();

describe('removeTmpFixturesAfterEachTest', () => {
  // Made OUTSIDE any test: a later case may still read it, so the per-test
  // removal must leave it to the afterAll.
  let shared = '';
  beforeAll(() => { shared = mkTmp('ccrc-tmpfix-shared-'); });

  let inTest: string[] = [];
  it('a case\'s fixtures are pending while it runs, beside the beforeAll\'s', () => {
    // Two, for the reason tmpfixtures.test.ts makes two: a helper that kept
    // only the last one would pass a single-directory case.
    inTest = [mkTmp('ccrc-tmpfix-case-'), mkTmp('ccrc-tmpfix-case-')];
    writeFileSync(path.join(inTest[0]!, 'fixture.txt'), 'not empty\n');
    mkdirSync(path.join(inTest[1]!, 'nested', 'deeper'), { recursive: true });
    expect(pendingTmpFixtures()).toEqual([shared, ...inTest]);
  });

  it('once that case has ended they are gone and forgotten; the beforeAll\'s fixture is not touched', () => {
    expect(inTest, 'the previous case never ran — this one would be vacuous').toHaveLength(2);
    for (const d of inTest) expect(existsSync(d), `${d} outlived its case`).toBe(false);
    expect(existsSync(shared), 'a fixture made outside a test was removed by a test\'s afterEach').toBe(true);
    expect(pendingTmpFixtures()).toEqual([shared]);
  });

  let reused = '';
  it('a case that runs removeTmpFixtures itself leaves its afterEach nothing to remove twice', () => {
    reused = mkTmp('ccrc-tmpfix-reused-');
    removeTmpFixtures();
    expect(existsSync(reused)).toBe(false);
    // The kernel may hand this name out again; by then it is not ours. Put a
    // directory back at the exact path — the afterEach must leave it alone.
    mkdirSync(reused);
    // `shared` went with removeTmpFixtures too, by its contract (everything,
    // now); nothing later in this file reads it.
    expect(pendingTmpFixtures()).toEqual([]);
  });

  it('… and the re-made path survived that afterEach', () => {
    expect(reused).not.toBe('');
    expect(existsSync(reused), 'the per-test removal re-removed a path removeTmpFixtures had already forgotten').toBe(true);
    // The test's own to remove, precisely because every cleaner forgot it.
    rmSync(reused, { recursive: true, force: true });
  });
});
