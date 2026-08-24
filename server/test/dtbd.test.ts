// D-TBD placeholders never land (build 9 D13). A session that cannot reach
// the allocator writes `D-TBD-<slug>` and STOPS — this suite is what turns
// the outage into a red diff instead of an invented number, which is the
// root cause (bb47c9e).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

// Built by concatenation so this file's own source never matches its own
// scan. The documented META-form `D-TBD-<slug>` does not match either — '<'
// is outside the class — so specs and skills may TEACH the convention; only a
// CONCRETE placeholder (D-TBD hyphen a real slug) reds the tree. Docs that
// need an example must therefore use the <slug> meta-form, never a literal.
const PATTERN = 'D-TBD' + '-[a-z0-9]';

describe('no D-TBD placeholder lands (D13)', () => {
  it('git grep over every tracked file finds none', () => {
    let out = '';
    try {
      // -I skips binaries; git grep scans TRACKED files in the working tree,
      // which is exactly the set a commit would land.
      out = execFileSync('git', ['grep', '-I', '-n', '-E', PATTERN],
        { cwd: REPO, encoding: 'utf8' });
    } catch (e) {
      const err = e as { status?: number };
      // exit 1 = no match — the green state. Anything else is git itself failing.
      expect(err.status, 'git grep itself failed').toBe(1);
      return;
    }
    expect.fail('a D-TBD placeholder is trying to land — the allocator was unreachable when ' +
      'this was written; allocate the real number (POST /api/ledger/deviations) and replace ' +
      `it before merging:\n${out}`);
  });
});
