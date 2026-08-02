// The agent suite's fixture cleaner. See tmpHelpers.ts for why the agent
// package needs its own: `whitelist.test.ts` removed its three fixtures with a
// trailing `rmSync` AFTER the assertion, which is skipped on a FAILING run —
// i.e. on exactly the runs a mutation sweep produces, 50-120 per sweep, on the
// box whose OOM/disk history is why this project exists.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('no file in this directory makes a temp dir outside the one registry', () => {
    // THE CLASS, and this time by SCAN. The round-2 version of this test named
    // two files — `['whitelist.test.ts', 'helpers.ts']` — and the round-2
    // report claimed on the strength of it that the pin "fails if any agent
    // test file goes back to a bare `mkdtempSync`" and that "the registry is
    // now one per package". Both claims were false when they were written:
    // `exec.test.ts` was sitting in this same directory with its own
    // `stubDirs` array, its own `afterAll`, and a bare `mkdtempSync` — a second
    // local registry, i.e. the very pattern the class_check said had been
    // resisted. It was invisible to a guard that names its files, which is the
    // whole point: the finding that produced this guard was "three new test
    // files were added here without anyone noticing the pattern next to them",
    // and a two-name list cannot notice the fourth. So the file list is read
    // from the directory and the only thing hardcoded is the exemption, which
    // is short, justified per entry, and asserted to be non-empty of purpose
    // by the two tests below.
    //
    // What the marker means, stated accurately (the round-2 comment overstated
    // it): a bare `mkdtempSync` does not prove a leak — `exec.test.ts` cleaned
    // up in an `afterAll` and leaked nothing. It proves the file DERIVED the
    // discipline instead of importing it, so whether it leaks depends on that
    // file's author getting the hook right, every time, forever. One registry
    // means one place to get it right.
    const exempt = new Map<string, string>([
      // The registry itself: this is the one legitimate `mkdtempSync` call in
      // the package, and mkTmp is what every other file must route through.
      ['tmpHelpers.ts', 'IS the registry'],
      // The PATH-containment setup file. It runs as a `setupFiles` entry, not
      // as a test module, so it makes its one directory before any test file's
      // registry exists and must own it outright. It cannot route through
      // `mkTmp` either: `mkTmp`'s `afterAll` belongs to whichever suite is
      // being built when the module is imported, and a setup file is imported
      // before there is one. Rewiring it is forbidden by the standing
      // constraint that has cost the live fleet four outages.
      //
      // Its exemption is CONDITIONAL and the condition is checked below: the
      // `afterAll` must still be there AND the run-scoped root must still be
      // wired, because the hook alone was measurably not enough.
      ['contain-path.setup.ts', 'setupFiles, not a test module; hook-cleaned inside a run-scoped root; must not be rewired'],
      // The run-scoped root itself. It runs as a `globalSetup` entry in
      // vitest's MAIN process — the only place in this package whose cleanup a
      // destroyed worker cannot skip — and it removes what it made in the
      // teardown it returns. It cannot route through `mkTmp` either: `mkTmp`'s
      // `afterAll` needs a suite, and the main process has none.
      ['contain-path.globalsetup.ts', 'globalSetup in the main process; removes its own root in its teardown'],
    ]);

    const files = readdirSync(here).filter((f) => f.endsWith('.ts')).sort();
    // Guard the guard: a scan that reads an empty directory passes every
    // assertion below without checking anything. Both directions again — an
    // exemption naming a file that no longer exists is folklore.
    expect(files.length, 'the directory scan found no .ts files').toBeGreaterThan(5);
    for (const name of exempt.keys()) {
      expect(files, `${name} is exempted but no longer exists — stale exemption`).toContain(name);
    }

    // The marker is assembled rather than written, because otherwise THIS file
    // is its own first offender: the literal below would match itself, and the
    // only way out would be to exempt the guard from the guard.
    const MARKER = `mkdtemp${'Sync'}(`;
    // Comments stripped first: prose about the pattern (this file is full of
    // it) is not the pattern. Line comments and block comments only — enough
    // for a directory of test files, and a false positive here is a loud,
    // one-line-to-fix failure rather than a silent pass.
    const code = (src: string): string => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    const offenders = files.filter((f) => !exempt.has(f)
      && code(readFileSync(path.join(here, f), 'utf8')).includes(MARKER));
    expect(offenders, 'these files make temp dirs the shared registry does not know about').toEqual([]);

    // ...and the scan is shown to be capable of finding one, so "no offenders"
    // cannot mean "the matcher is broken". The registry is exempt from the
    // verdict, not from the matcher.
    expect(code(readFileSync(path.join(here, 'tmpHelpers.ts'), 'utf8')).includes(MARKER),
      'the matcher no longer recognises the registry\'s own mkdtempSync call').toBe(true);
  });

  it('the exempted files are exempted for the reason given, not by habit', () => {
    // `contain-path.setup.ts` is excused because its cleanup is a HOOK. If that
    // ever becomes a trailing statement the exemption stops being true, and the
    // file would leak once per run of every agent test file.
    //
    // The hook alone WAS the exemption, and the exemption was wrong. A vitest
    // `afterAll` only runs if vitest built a suite for the test file, and a
    // `setupFiles` body runs BEFORE the test module is imported — so a test
    // module that THROWS AT IMPORT leaves the directory behind with no hook to
    // remove it. This project's own `whitelist.ts` throws at module load by
    // design, so every over-permission mutant produces exactly that shape;
    // the final review measured ten leaked directories from one mutant run.
    //
    // The exemption now requires the hook AND the run-scoped root, and both
    // are asserted here. Note what these assertions are and are not: they are
    // TEXT checks, so they can only prove the mechanism is present. Whether it
    // FIRES is pinned behaviourally by `contain-path.test.ts`, which spawns a
    // real vitest whose test module throws at import and counts what is left.
    // Both are needed — the first fix for this finding used
    // `process.on('exit')`, which is present, readable, and skipped outright
    // when the `forks` pool destroys a worker: 2 leaks in 12 runs.
    const src = readFileSync(path.join(here, 'contain-path.setup.ts'), 'utf8');
    const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // Comments stripped first, so a commented-out registration cannot satisfy
    // any of these — the same trap the `afterAll(removeTmpFixtures);` count
    // above is written to avoid.
    expect(code(src), 'contain-path.setup.ts no longer cleans up in a vitest hook')
      .toContain('afterAll(removeContainedDir)');
    expect(code(src).includes('rmSync(dir'), 'the cleanup no longer removes the contained dir').toBe(true);
    expect(code(src), 'contain-path.setup.ts no longer puts its dir inside the run-scoped root')
      .toContain('CONTAIN_PATH_ROOT_ENV');

    // The root's own janitor: a `globalSetup` that made a directory and never
    // removed it would be a leak of one per run instead of one per file.
    const gsrc = code(readFileSync(path.join(here, 'contain-path.globalsetup.ts'), 'utf8'));
    expect(gsrc, 'the global setup no longer returns a teardown that removes its root')
      .toMatch(/return \(\) => \{[\s\S]*rmSync\(root/);

    // And both are still wired, which is the constraint the standing rules put
    // above everything else in this package.
    const cfg = readFileSync(path.resolve(here, '..', 'vitest.config.ts'), 'utf8');
    expect(cfg).toContain("setupFiles: ['test/contain-path.setup.ts']");
    expect(cfg, 'globalSetup is unwired — a module-load throw leaks again')
      .toContain("globalSetup: ['test/contain-path.globalsetup.ts']");
  });
});
