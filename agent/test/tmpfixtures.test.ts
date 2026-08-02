// The agent suite's fixture cleaner. See tmpHelpers.ts for why the agent
// package needs its own: `whitelist.test.ts` removed its three fixtures with a
// trailing `rmSync` AFTER the assertion, which is skipped on a FAILING run —
// i.e. on exactly the runs a mutation sweep produces, 50-120 per sweep, on the
// box whose OOM/disk history is why this project exists.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('mkTmp (agent suite)', () => {
  it('remembers every directory it made, and removes them with their contents', () => {
    // Two, because a helper that only ever tracked the LAST one would still
    // pass a single-directory test.
    const a = mkTmp('ccrc-agent-tmpfix-');
    const b = mkTmp('ccrc-agent-tmpfix-');
    expect(a).not.toBe(b);
    writeFileSync(path.join(a, 'fixture.txt'), 'not empty\n');
    expect(existsSync(a) && existsSync(b)).toBe(true);

    removeTmpFixtures();
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);

    // ...and it FORGETS them, so the end-of-file sweep cannot delete a path the
    // kernel has since handed to someone else.
    mkdirSync(a);
    removeTmpFixtures();
    expect(existsSync(a), 'the cleaner re-removed a path it had already cleaned').toBe(true);
    rmSync(a, { recursive: true, force: true });
  });

  it('cleans up after a FAILING test, which is the whole reason it is a hook', () => {
    // The defect this replaces, stated as behaviour: a trailing `rmSync` after
    // an assertion is unreachable once the assertion throws. Simulated here
    // rather than described, because "the cleanup line is below the expect" is
    // exactly the shape that reads as fine in review.
    const leaked: string[] = [];
    const badlyWritten = (): void => {
      const dir = mkTmp('ccrc-agent-tmpfix-fail-');
      leaked.push(dir);
      expect(1).toBe(2);                       // the sweep's failing assertion
      rmSync(dir, { recursive: true, force: true });   // never reached
    };
    expect(badlyWritten).toThrow();
    expect(existsSync(leaked[0]!), 'the trailing rmSync did not run').toBe(true);
    // The hook is what actually removes it.
    removeTmpFixtures();
    expect(existsSync(leaked[0]!)).toBe(false);
  });

  it('is registered as an afterAll, which is the half no test in this file can run', () => {
    // An `afterAll` runs after every test in the file that registers it, so
    // nothing inside that file can observe whether it was registered at all —
    // and with the hook dropped the suite is green while every fixture leaks.
    // Comment lines are stripped BEFORE counting: a substring count alone is
    // satisfied by `// afterAll(removeTmpFixtures);`, which is a green suite
    // plus a leak per run.
    const src = readFileSync(path.join(here, 'tmpHelpers.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src.split('afterAll(removeTmpFixtures);').length - 1,
      'exactly one afterAll registration in tmpHelpers.ts').toBe(1);
  });

  it('no agent test file removes a fixture with a trailing rmSync any more', () => {
    // The class, not the instance. `whitelist.test.ts` was the last file in
    // this directory doing it; three new test files were added here in the
    // previous fix round without anyone noticing the pattern next to them.
    // A bare `mkdtempSync` in a test file is the marker: it means the file made
    // a directory the shared registry does not know about, so nothing removes
    // it on a failing run.
    const files = ['whitelist.test.ts', 'helpers.ts'];
    for (const f of files) {
      const src = readFileSync(path.join(here, f), 'utf8');
      expect(src.includes('mkdtempSync('), `${f} makes an unregistered temp dir`).toBe(false);
    }
  });
});
