// `removeTmpFixturesAfterEachTest` (tmpHelpers.ts), the opt-in that keeps a
// fixture-heavy file's one `afterAll` small. This file opts in, so its cases
// observe the removal BETWEEN cases — the half an `afterAll` never shows. The
// cases depend on running in order, which a file's tests do; the one
// `.concurrent` describe is LAST and exists to prove overlap is refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  mkTmp, pendingTmpFixtures, removeTmpFixtures, removeTmpFixturesAfterEachTest, skipIfPreviousCaseFilteredOut,
} from './tmpHelpers.js';

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

  it('once that case has ended they are gone and forgotten; the beforeAll\'s fixture is not touched', (ctx) => {
    if (inTest.length === 0) skipIfPreviousCaseFilteredOut(ctx);
    expect(inTest, 'the previous case never ran — this one would be vacuous').toHaveLength(2);
    for (const d of inTest) expect(existsSync(d), `${d} outlived its case`).toBe(false);
    expect(existsSync(shared), 'a fixture made outside a test was removed by a test\'s afterEach').toBe(true);
    expect(pendingTmpFixtures()).toEqual([shared]);
  });

  let reused = '';
  // Case 3 re-makes `reused` after every cleaner has forgotten it, and case 4
  // removes it — but under a `-t` that runs case 3 alone, or when case 3
  // fails after the re-make, case 4 never does. So the describe removes it.
  afterAll(() => { if (reused !== '') rmSync(reused, { recursive: true, force: true }); });
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

  it('… and the re-made path survived that afterEach', (ctx) => {
    if (reused === '') skipIfPreviousCaseFilteredOut(ctx);
    expect(reused, 'the previous case never ran — this one would be vacuous').not.toBe('');
    expect(existsSync(reused), 'the per-test removal re-removed a path removeTmpFixtures had already forgotten').toBe(true);
    // The test's own to remove, precisely because every cleaner forgot it.
    rmSync(reused, { recursive: true, force: true });
  });
});

describe('removeTmpFixturesAfterEachTest — the cleanups vitest runs AFTER it', () => {
  // Pins the order its docstring states: an `onTestFinished` callback runs
  // after the file-level `afterEach`, so it finds the case's HOME gone.
  let seen: boolean | null = null;
  it('a case registers an onTestFinished that looks for its HOME', (ctx) => {
    const home = mkTmp('ccrc-tmpfix-finished-');
    ctx.onTestFinished(() => { seen = existsSync(home); });
  });

  it('… which found it already removed', (ctx) => {
    if (seen === null) skipIfPreviousCaseFilteredOut(ctx);
    expect(seen, 'the previous case never ran — this one would be vacuous').not.toBeNull();
    expect(seen, 'onTestFinished ran before the per-test removal — the docstring\'s order is stale').toBe(false);
  });
});

// A removal that fails must not strand the case's other directories, nor
// forget the one it could not remove. Root ignores the mode bits, so there
// is nothing to provoke there.
describe.skipIf(process.getuid?.() === 0)('removeTmpFixturesAfterEachTest — one removal fails', () => {
  let locked = '';
  let first = '';
  let second = '';
  afterAll(() => { if (locked !== '' && existsSync(locked)) chmodSync(locked, 0o700); });

  // `.fails`: the case's own body passes; its afterEach is what must fail.
  it.fails('a case leaves an unremovable directory first and a plain one after it — its afterEach fails', () => {
    first = mkTmp('ccrc-tmpfix-locked-');
    locked = path.join(first, 'locked');
    mkdirSync(locked);
    writeFileSync(path.join(locked, 'f'), 'x\n');
    chmodSync(locked, 0o500);
    second = mkTmp('ccrc-tmpfix-after-locked-');
    writeFileSync(path.join(second, 'f'), 'x\n');
  });

  it('… having still removed the later directory, and kept the failed one for the afterAll', (ctx) => {
    if (first === '') skipIfPreviousCaseFilteredOut(ctx);
    expect(first, 'the previous case never ran — this one would be vacuous').not.toBe('');
    expect(existsSync(second), 'one failed removal stopped the rest').toBe(false);
    expect(existsSync(first)).toBe(true);
    expect(pendingTmpFixtures(), 'the failed directory was forgotten — no hook will retry it').toContain(first);
    expect(pendingTmpFixtures()).not.toContain(second);
    chmodSync(locked, 0o700);   // the afterAll can now remove it
  });
});

// LAST: overlapping tests are refused. There is one per-test list per file, so
// letting B start while A is open would have one of them remove the other's
// HOME mid-run. B's beforeEach must throw (hence `.fails`), and A — which owns
// the list — must keep its HOME for its whole run.
describe.concurrent('removeTmpFixturesAfterEachTest — overlapping tests', () => {
  it('A: its HOME survives B starting, and B ending, while A runs', async () => {
    const home = mkTmp('ccrc-tmpfix-overlap-a-');
    await sleep(300);
    expect(existsSync(home), 'A\'s HOME was removed while A was running').toBe(true);
  });

  it.fails('B: starts while A is still open — its beforeEach refuses', async () => {
    mkTmp('ccrc-tmpfix-overlap-b-');
    await sleep(50);
  });
});
