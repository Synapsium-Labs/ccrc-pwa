// `deploy/deploy.sh` used to carry the reference fleet's coordinates as
// DEFAULTS: `CCRC_BOX` fell back to one operator's `user@100.x.x.x` and
// `CCRC_SSH_KEY` to a key named after that operator's laptop. On a public
// tree that is not an untidy literal, it is a live hazard — a contributor who
// runs the documented command with nothing set does not get an error, they get
// a deploy aimed at someone else's machine. The same shape sat on the roster
// seed: `CCRC_ACCOUNTS_JSON` defaulted to `accounts.migration.json`, the
// reference fleet's five real accounts, and seeding is PERMANENT (`_inst_roster`
// never overwrites an existing `~/.ccrc/accounts.json`), so a stranger's very
// first deploy would have installed that account list irreversibly.
//
// This pins the refusal, the per-workstation config file that replaces the
// defaults, and the seed. It is a TEXT+BEHAVIOUR scan rather than a fixed
// sentence: the literals are matched by shape (a user@IP, a named key, the
// migration roster), so re-introducing them under a different spelling still
// fails here.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEPLOY = path.join(root, 'deploy', 'deploy.sh');
const script = readFileSync(DEPLOY, 'utf8');

/** Run deploy.sh with NO inherited coordinates.
 *
 *  `CCRC_DEPLOY_ENV` is always pointed at a path inside a fresh tmpdir — never
 *  left to its default — so this test can never read the developer's real
 *  `~/.ccrc/deploy.env` and can never, on any machine, get far enough to open
 *  an ssh connection. */
function run(env: Record<string, string> = {}, argv: string[] = []): { code: number; stderr: string } {
  try {
    execFileSync('bash', [DEPLOY, ...argv], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    });
    return { code: 0, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? -1, stderr: err.stderr ?? '' };
  }
}

describe('deploy.sh: the target is never guessed', () => {
  let tmp: string;
  const mk = (): string => (tmp = mkdtempSync(path.join(tmpdir(), 'ccrc-deploy-')));
  const cleanup = (): void => { if (tmp) rmSync(tmp, { recursive: true, force: true }); };

  it('refuses with exit 2 when CCRC_BOX is unset, naming the fix', () => {
    mk();
    try {
      const r = run({ CCRC_DEPLOY_ENV: path.join(tmp, 'absent.env') });
      // Exit 2 is the usage-error contract `ccrc` states for its own verbs.
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/CCRC_BOX is not set/);
      // The message has to carry the remedy, not just the complaint.
      expect(r.stderr).toContain('absent.env');
      expect(r.stderr).toMatch(/no default/i);
    } finally { cleanup(); }
  });

  it('refuses when the key is unset even though the box is set', () => {
    mk();
    try {
      const envFile = path.join(tmp, 'partial.env');
      writeFileSync(envFile, 'CCRC_BOX=user@example-box\n');
      const r = run({ CCRC_DEPLOY_ENV: envFile });
      expect(r.code).toBe(2);
      // Reaching the SECOND guard proves the first was satisfied FROM THE FILE
      // — i.e. that deploy.sh actually sourced it. A test that only checked the
      // CCRC_BOX refusal would pass against a script that never read the file.
      expect(r.stderr).toMatch(/CCRC_SSH_KEY is not set/);
    } finally { cleanup(); }
  });

  it('accepts an agent target named on the command line, with no CCRC_BOX', () => {
    // The guard has to run AFTER the target is resolved. A first cut required
    // `$CCRC_BOX` before reading `deploy.sh agent <host>`, so naming the box on
    // the command line still refused — a refusal with nothing for the caller to
    // fix, since they had just supplied the very thing it asked for.
    mk();
    try {
      const envFile = path.join(tmp, 'key-only.env');
      writeFileSync(envFile, 'CCRC_SSH_KEY=/dev/null\n');
      const r = run({ CCRC_DEPLOY_ENV: envFile }, ['agent', 'user@given-host']);
      expect(r.stderr, 'the explicit agent host must satisfy the target guard')
        .not.toMatch(/CCRC_BOX is not set/);
    } finally { cleanup(); }
  });

  it('still refuses `agent` with no host and no CCRC_BOX', () => {
    mk();
    try {
      const envFile = path.join(tmp, 'key-only2.env');
      writeFileSync(envFile, 'CCRC_SSH_KEY=/dev/null\n');
      const r = run({ CCRC_DEPLOY_ENV: envFile }, ['agent']);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/CCRC_BOX is not set/);
    } finally { cleanup(); }
  });

  it('carries no operator-specific coordinates as defaults', () => {
    // By SHAPE, not by the specific strings that were there — a different
    // operator's address re-introduced tomorrow fails this too.
    expect(script, 'a user@host literal as a default').not.toMatch(/CCRC_BOX:-\S+@\S+/);
    // `${CCRC_SSH_KEY:-}` — an EMPTY default — is how the script reads the var
    // without tripping `set -u`. What must never come back is a non-empty one.
    expect(script, 'an ssh key path as a default').not.toMatch(/CCRC_SSH_KEY:-[^}\s]/);
    expect(script, 'a target as a default').not.toMatch(/CCRC_BOX:-[^}\s]/);
    // Loopback and the any-address are legitimate here — the script reasons
    // about bind addresses. A ROUTABLE literal is what must never appear.
    const routable = (script.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])
      .filter((ip) => ip !== '127.0.0.1' && ip !== '0.0.0.0');
    expect(routable, 'a routable IP address literal').toEqual([]);
    expect(script, 'a tailnet magic-DNS name').not.toMatch(/\.ts\.net\b/);
  });

  it('reads per-workstation coordinates from a file outside every checkout', () => {
    // Outside the repo on purpose: this box carries many worktrees of the same
    // repo, and a per-checkout file would be both duplicated and one careless
    // `git add -A` from being committed.
    expect(script).toMatch(/CCRC_DEPLOY_ENV:-\$HOME\/\.ccrc\/deploy\.env/);
  });
});

describe('deploy.sh: the roster seed', () => {
  it('defaults to the neutral seed, not to any real fleet roster', () => {
    expect(script).toMatch(/CCRC_ACCOUNTS_JSON:-deploy\/accounts\.default\.json/);
    // Seeding is irreversible on the target, so the default must never be a
    // roster describing accounts that exist somewhere else.
    expect(script, 'the migration roster must not be the default')
      .not.toMatch(/CCRC_ACCOUNTS_JSON:-deploy\/accounts\.migration\.json/);
  });
});
