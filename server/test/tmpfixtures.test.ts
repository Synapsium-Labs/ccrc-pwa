// The fixture cleaner itself. 23 files made `mkdtempSync(tmpdir(), 'ccrc-')`
// fixtures and removed none of them: one full run leaked 140 directories and a
// mutation sweep runs the suite 50-120 times, which is how /tmp reached 47k
// directories and 1.4 GiB once and 7,830 again five weeks later.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

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
  });

  it('is registered as an afterAll, which is the half no test in this file can run', () => {
    // An `afterAll` runs after every test in the file that registers it, so
    // nothing inside that file can observe whether it was registered at all —
    // and with the hook dropped the suite is green while every fixture leaks.
    // The empirical check is the one in the commit message (`/tmp/ccrc-*` = 0
    // before, 0 after two full runs); this is the line that would have to be
    // deleted for that to stop being true, so it is asserted where a deletion
    // is visible: in the source.
    const src = readFileSync(path.join(__dirname, 'tmpHelpers.ts'), 'utf8');
    expect(src.split('afterAll(removeTmpFixtures);').length - 1,
      'exactly one afterAll registration in tmpHelpers.ts').toBe(1);
  });
});
