// ccd's roster preamble — the three lines every single ccd invocation on a box
// executes before anything else, and the only ones whose failure the operator
// reads as a sentence rather than as a stack.
//
// MISSING and UNREADABLE are different states with different remedies, and
// conflating them is not cosmetic: a `chmod 000` accounts.sh plainly EXISTS, so
// "no account roster — generate it from ~/.ccrc/accounts.json" sends its
// operator to a generator that will rewrite a file whose BYTES were never the
// problem, on a box where every ccd call is already dying. `loadRoster`
// (server/src/config.ts) draws exactly this distinction for `accounts.json` and
// `config.test.ts` pins it; this is ccd's half of the same rule, and without
// this file nothing pinned it at all — the two messages are prose, and prose
// silently reverts.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

/** Source ccd with nothing after it: the preamble is what runs, and its `die`
 *  is what we read. `spawnSync`, not `execFileSync`, because a nonzero exit IS
 *  the expected result in two of the three cases.
 *
 *  Through `ghContainedEnv` like every other ccd spawn. It was not, and nothing
 *  noticed, because the containment scan in `ccd-workspaces.test.ts` matched
 *  only `execFileSync('bash'` — so this file sourced ccd with the box's REAL
 *  PATH, and the third case below sources it SUCCESSFULLY. Nothing in the
 *  preamble reaches `gh` today; "nothing reaches it today" is the sentence that
 *  argument always ends with, and the scan now covers this idiom too. */
function sourceCcd(home: string): { code: number; stderr: string } {
  const r = spawnSync('bash', ['-c', `source "${CCD}"`], {
    encoding: 'utf8', env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true }),
  });
  return { code: r.status ?? -1, stderr: r.stderr ?? '' };
}

describe("ccd's roster preamble tells a MISSING roster from an UNREADABLE one", () => {
  it('names the file and the generator when the roster is absent', () => {
    const home = mkTmp('ccrc-ccd-preamble-missing-');
    const r = sourceCcd(home);
    expect(r.code, 'ccd must refuse to run without a roster').not.toBe(0);
    expect(r.stderr).toContain('no account roster at');
    expect(r.stderr).toContain('accounts.json');
  });

  it('says EXISTS-BUT-UNREADABLE, and does not send the operator to regenerate it', () => {
    // Root can read a 000 file, which would make this case indistinguishable
    // from the happy path rather than merely fail — say so instead of lying.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect.soft(false, 'skipped: running as root, where chmod 000 is not a permission boundary').toBe(false);
      return;
    }
    const home = mkTmp('ccrc-ccd-preamble-unreadable-');
    seedAccountsSh(home);
    chmodSync(path.join(home, '.ccrc', 'accounts.sh'), 0o000);

    const r = sourceCcd(home);
    expect(r.code, 'an unreadable roster must still be fatal').not.toBe(0);
    expect(r.stderr, 'the unreadable case must not be reported as absent')
      .not.toContain('no account roster at');
    expect(r.stderr).toContain('exists but is not readable');
    // The remedy, which is the whole point: permissions, not regeneration.
    expect(r.stderr).toContain('permissions');
  });

  it('sources cleanly when the roster is present and readable', () => {
    // Without this, both assertions above would pass against a ccd that
    // refuses every roster there is.
    const home = mkTmp('ccrc-ccd-preamble-ok-');
    seedAccountsSh(home);
    const r = sourceCcd(home);
    expect(r.code, `ccd refused a good roster:\n${r.stderr}`).toBe(0);
  });
});
