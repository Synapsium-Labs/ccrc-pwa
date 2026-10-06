// The fixture cleaner itself. 17 of the 23 files that make
// `mkdtempSync(tmpdir(), 'ccrc-')` fixtures removed none of them: one full run
// leaked 140 directories and a mutation sweep runs the suite 50-120 times,
// which is how /tmp reached 47k directories and 1.4 GiB once, and 7,830 again
// five weeks later.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  mkTmp, removeTmpFixtures, removeTmpFixturesSince, removeTmpFixturesEachTest, tmpMark,
} from './tmpHelpers.js';

describe('mkTmp', () => {
  it('remembers every directory it made, and removes them with their contents', () => {
    // Two, because a helper that only ever tracked the LAST one would still
    // pass a single-directory test — and the files this replaces make five and
    // ten of them per run.
    const a = mkTmp('ccrc-tmpfix-');
    const b = mkTmp('ccrc-tmpfix-');
    expect(a).not.toBe(b);
    writeFileSync(path.join(a, 'fixture.txt'), 'not empty\n');
    expect(existsSync(a) && existsSync(b)).toBe(true);

    removeTmpFixtures();
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);

    // ...and it FORGETS them. `mkdtemp` hands out a name the kernel is free to
    // hand out again once it is gone, so a cleaner that kept its list would
    // delete, at the end of the file, a directory that by then belongs to
    // someone else. Said as behaviour: put a directory back at that exact path
    // and it must survive the next sweep.
    mkdirSync(a);
    removeTmpFixtures();
    expect(existsSync(a), 'the cleaner re-removed a path it had already cleaned').toBe(true);
    // ...and this one is the test's own to remove, precisely because the
    // cleaner has (correctly) forgotten it. Measured: without this line the
    // suite leaked exactly one directory per run — the file that exists to stop
    // the leak, leaking.
    rmSync(a, { recursive: true, force: true });
  });

  it('is registered as an afterAll, which is the half no test in this file can run', () => {
    // An `afterAll` runs after every test in the file that registers it, so
    // nothing inside that file can observe whether it was registered at all —
    // and with the hook dropped the suite is green while every fixture leaks.
    // The empirical check is the one in the commit message (`/tmp/ccrc-*` = 0
    // before, 0 after two full runs); this is the line that would have to be
    // deleted for that to stop being true, so it is asserted where a deletion
    // is visible: in the source.
    // Comment lines are stripped BEFORE counting: a substring count alone is
    // satisfied by `// afterAll(removeTmpFixtures);`, which is a green suite
    // plus 140 leaked dirs per run — measured, on a disk at 92% (re-review N1).
    const src = readFileSync(path.join(__dirname, 'tmpHelpers.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src.split('afterAll(removeTmpFixtures);').length - 1,
      'exactly one afterAll registration in tmpHelpers.ts').toBe(1);
  });
});

// R20a (centralised-update wave 13): a file whose one end-of-file sweep is too big for one hook removes each
// test's homes after that test instead. `ccrc-update.test.ts` is that file: its `afterAll` overran vitest's 20 s
// hook timeout on CI shards at 670d25fd and 7b0a5454 while every test passed.
describe('removeTmpFixturesSince (R20a)', () => {
  it('removes what was made from the mark on, forgets it, and leaves what came before for the afterAll', () => {
    const before = mkTmp('ccrc-tmpfix-since-');
    const mark = tmpMark();
    const b = mkTmp('ccrc-tmpfix-since-');
    const c = mkTmp('ccrc-tmpfix-since-');
    writeFileSync(path.join(b, 'fixture.txt'), 'not empty\n');
    removeTmpFixturesSince(mark);
    expect(existsSync(b) || existsSync(c), 'a directory made after the mark survived').toBe(false);
    expect(existsSync(before), 'a directory made BEFORE the mark was removed').toBe(true);
    expect(tmpMark()).toBe(mark);
    // Forgotten, as `removeTmpFixtures` forgets: a directory put back at that path survives both sweeps.
    mkdirSync(b);
    removeTmpFixturesSince(mark);
    removeTmpFixtures();
    expect(existsSync(b), 'the cleaner re-removed a path it had already cleaned').toBe(true);
    expect(existsSync(before)).toBe(false);
    rmSync(b, { recursive: true, force: true });
  });

  // Root removes what it likes, so a refusal cannot be planted; CI and the dev box run unprivileged.
  it.skipIf(process.getuid?.() === 0)('keeps a directory whose removal fails, for the afterAll to remove or fail on loudly', () => {
    const mark = tmpMark();
    const d = mkTmp('ccrc-tmpfix-since-keep-');
    const locked = path.join(d, 'locked');
    mkdirSync(path.join(locked, 'inner'), { recursive: true });
    chmodSync(locked, 0o500);   // `inner` cannot be unlinked: rmSync throws EACCES
    try {
      expect(() => removeTmpFixturesSince(mark)).not.toThrow();
      expect(existsSync(d)).toBe(true);
      expect(tmpMark(), 'the failed directory was forgotten unremoved').toBe(mark + 1);
    } finally {
      chmodSync(locked, 0o700);
    }
    removeTmpFixtures();
    expect(existsSync(d), 'the kept directory was not removed by the end-of-file sweep').toBe(false);
  });
});

describe('removeTmpFixturesEachTest (R20a)', () => {
  let fromBeforeAll = '';
  let fromFirst = '';
  beforeAll(() => { fromBeforeAll = mkTmp('ccrc-tmpfix-each-all-'); });
  // Registered on THIS describe here; `ccrc-update.test.ts` calls it at its top level, on the root suite.
  removeTmpFixturesEachTest();

  describe('an inner describe with its own teardown', () => {
    afterEach(() => {
      // The holder/lingerer kills in ccrc-update.test.ts are describe-level afterEach hooks that still need the
      // home: an outer afterEach must run after them.
      expect(existsSync(fromFirst), 'the test\'s home was removed before an inner afterEach ran').toBe(true);
    });
    it('makes a home inside the test', () => {
      fromFirst = mkTmp('ccrc-tmpfix-each-');
      writeFileSync(path.join(fromFirst, 'fixture.txt'), 'not empty\n');
      expect(existsSync(fromBeforeAll)).toBe(true);
    });
  });

  it('the previous test\'s home is gone, and the beforeAll\'s is not', () => {
    expect(fromFirst).not.toBe('');
    expect(existsSync(fromFirst), 'a home made inside a test outlived it').toBe(false);
    expect(existsSync(fromBeforeAll), 'a home made in a beforeAll was removed after one test').toBe(true);
  });

  it('ccrc-update.test.ts opts in, at its top level, outside any comment', () => {
    const src = readFileSync(path.join(__dirname, 'ccrc-update.test.ts'), 'utf8').split('\n');
    expect(src.filter((l) => l === 'removeTmpFixturesEachTest();'),
      'ccrc-update.test.ts must call removeTmpFixturesEachTest() once, unindented').toHaveLength(1);
  });
});
