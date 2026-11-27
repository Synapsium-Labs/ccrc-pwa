// `_ccrc_lock_file` / `_ccrc_lock_gap` (ccd/ccrc) — the writer and the
// measurement for the two files on this box that carry a secret:
// `exposure.env` (CCRC_DDNS_TOKEN) and `ccrc-agent.env` (CCRC_AGENT_TOKEN).
//
// On a POSIX box the pair is `chmod 600` and `stat -c%a`, and there is nothing
// to test that the platform does not already guarantee. On Windows there are no
// file modes at all, and the failure mode is the dangerous kind: `chmod 600`
// SUCCEEDS, `stat -c%a` then answers 644, and the file's real ACL still reads
//
//     BUILTIN\Users:(I)(RX)      NT AUTHORITY\Authenticated Users:(I)(M)
//
// — every account on the box can read the token, while the number says
// otherwise. So the writer applies an ACL and the check reads one.
//
// THE MEASUREMENT HERE IS INDEPENDENT OF BOTH. Asserting the writer with
// `_ccrc_lock_gap` would only prove the two agree, which they would even if
// both were wrong; this file asks the OS directly — `icacls` on Windows,
// `fs.stat` elsewhere — and then uses a KNOWN-UNLOCKED file as the negative
// control for the check.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { posixPath } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CCRC = posixPath(path.join(root, 'ccd', 'ccrc'));
const WIN = process.platform === 'win32';

/** A snippet with `ccrc` sourced as a library. It guards its own dispatch with
 *  `[[ "${BASH_SOURCE[0]}" == "${0}" ]]`, so sourcing defines and runs nothing. */
function sh(snippet: string, home: string): string {
  return execFileSync('bash', ['-c', `source "${CCRC}"; ${snippet}`], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  }).trim();
}

function fixtureFile(name: string): { home: string; file: string; posix: string } {
  const home = mkTmp('ccrc-lock-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const file = path.join(home, '.ccrc', name);
  writeFileSync(file, 'CCRC_DDNS_TOKEN=fixture-not-a-real-token\n');
  return { home, file, posix: posixPath(file) };
}

/** What the OS says, asked without going through ccrc at all. Returns the list
 *  of principals that hold any grant on the file — one entry, the current user,
 *  is what "owner-only" means on Windows. */
function principals(file: string): string[] {
  const out = execFileSync('icacls', [file], {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  });
  return [...out.matchAll(/([^\s:]+(?:[ \t][^\s:]+)*):\(/g)].map((m) => m[1] ?? '');
}

describe('_ccrc_lock_file makes a secret file owner-only', () => {
  it('leaves nobody but this box\'s user holding a grant on it', () => {
    const { home, file, posix } = fixtureFile('exposure.env');
    expect(sh(`_ccrc_lock_file "${posix}" && echo locked`, home)).toBe('locked');

    if (!WIN) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      return;
    }
    // The independent measurement: ask Windows, not ccrc.
    const holders = principals(file);
    const me = execFileSync('whoami', { encoding: 'utf8' }).trim().toLowerCase();
    expect(holders.length, `grants on the file: ${holders.join(' | ')}`).toBe(1);
    expect((holders[0] ?? '').toLowerCase()).toContain(me.split('\\').pop() ?? me);
  });

  it('does not leave the file unreadable or undeletable to its own owner', () => {
    // `(R,W)` alone passes the assertion above and still breaks every caller:
    // the owner cannot delete its own file. POSIX 0600 does not do that, so
    // neither may this.
    const { home, file, posix } = fixtureFile('exposure.env');
    sh(`_ccrc_lock_file "${posix}"`, home);
    expect(sh(`cat "${posix}"`, home)).toContain('CCRC_DDNS_TOKEN=');
    expect(sh(`printf 'x\\n' >> "${posix}" && rm -f "${posix}" && echo gone`, home)).toBe('gone');
    expect(() => statSync(file)).toThrow();
  });
});

describe('_ccrc_lock_gap measures what the platform enforces', () => {
  it('says nothing about a file the writer just locked', () => {
    const { home, posix } = fixtureFile('exposure.env');
    sh(`_ccrc_lock_file "${posix}"`, home);
    expect(sh(`_ccrc_lock_gap "${posix}"`, home)).toBe('');
  });

  it('NAMES THE GAP on a file nobody locked — the negative control', () => {
    // Without this the suite would pass against a check that answers "fine" to
    // everything, which is precisely the check Windows already had in `stat`.
    const { home, posix } = fixtureFile('open.env');
    const gap = sh(`_ccrc_lock_gap "${posix}"`, home);
    expect(gap).not.toBe('');
    expect(gap).toMatch(WIN ? /ACL grants/ : /not 0600/);
  });
});
