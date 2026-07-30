// The fixture cleaner itself. 23 files made `mkdtempSync(tmpdir(), 'ccrc-')`
// fixtures and removed none of them: one full run leaked 140 directories and a
// mutation sweep runs the suite 50-120 times, which is how /tmp reached 47k
// directories and 1.4 GiB once and 7,830 again five weeks later.
import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
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

    // ...and it forgets them, so the file-scoped hook cannot re-remove a path
    // that a later mkdtemp could by then have handed to someone else.
    const c = mkTmp('ccrc-tmpfix-');
    removeTmpFixtures();
    expect(existsSync(c)).toBe(false);
  });
});
