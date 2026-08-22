// ── the ignore rules that stand between a token file and a PUBLIC repo ─────
//
// `deploy/ccrc.env`, `deploy/ccrc-agent.env` and `deploy/ccrc-mail.token` are
// real credentials on every workstation that deploys. They were ignored by
// EXACT NAME, which covers the file an operator edits and none of the files
// editing it produces. Measured 2026-08-22: a `cp deploy/ccrc.env
// deploy/ccrc.env.bak-<ts>` before an edit left an untracked-but-visible file
// holding every token in the original — one `git add -A` from being published
// — and it was caught only because something unrelated prompted a
// `git check-ignore`. Nothing in the repo would have objected.
//
// These assertions ask GIT, not the .gitignore text: what matters is the
// answer `git add` would give, and a rule can be undone from another file
// (.git/info/exclude, a nested .gitignore, a negation added later) without
// the line here changing at all.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What `git add` would do with this path — asked of git itself. `-C REPO` so
 *  the answer is about the repo, never about the suite's cwd. */
const ignored = (rel: string): boolean =>
  spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '--no-index', rel],
    { encoding: 'utf8' }).status === 0;

/** The real secret-bearing names, and `exposure.env` — which is written on the
 *  BOX rather than here, but carries the DuckDNS token and is the obvious
 *  thing to copy down while debugging an exposed box. */
const SECRET_FILES = [
  'deploy/ccrc.env',
  'deploy/ccrc-agent.env',
  'deploy/ccrc-mail.token',
  'deploy/exposure.env',
];

/** What an operator's hands actually produce next to a file they are editing. */
const VARIANTS = ['.bak', '.bak-1787398337', '.save', '.orig', '.tmp', '.2', '~'];

// D-170.
describe('.gitignore: a token file and every copy of it', () => {
  it.each(SECRET_FILES)('%s is ignored', (f) => {
    expect(ignored(f)).toBe(true);
  });

  it.each(SECRET_FILES.flatMap((f) => VARIANTS.map((v) => [`${f}${v}`] as const)))(
    '%s is ignored — the backup is as dangerous as the original', (f) => {
      expect(ignored(f), `${f} would be publishable`).toBe(true);
    });

  // The negations are load-bearing in the other direction: the .example files
  // carry placeholders, no secrets, and MUST stay tracked. Boot refuses the
  // unedited mail-token placeholder BY NAME, so losing it from the repo is a
  // different failure, not a safer one.
  it.each([
    'deploy/ccrc.env.example',
    'deploy/ccrc-agent.env.example',
    'deploy/ccrc-mail.token.example',
  ])('%s is NOT ignored — the glob must not swallow the placeholders', (f) => {
    expect(ignored(f), `${f} would stop being shipped`).toBe(false);
  });

  it('the placeholders are actually tracked right now, not merely ignorable', () => {
    // `check-ignore` answers a hypothetical; this answers the fact. A rule
    // that let them be committed is worth nothing if they already are not.
    const tracked = spawnSync('git', ['-C', REPO, 'ls-files', 'deploy/'],
      { encoding: 'utf8' }).stdout.split('\n');
    for (const f of ['deploy/ccrc.env.example', 'deploy/ccrc-agent.env.example',
                     'deploy/ccrc-mail.token.example']) {
      expect(tracked, `${f} is not in the index`).toContain(f);
    }
  });

  it('no real env or token file is tracked — the assertion the others imply', () => {
    const tracked = spawnSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' })
      .stdout.split('\n').filter(Boolean);
    const leaked = tracked.filter((f) =>
      /(^|\/)(ccrc\.env|ccrc-agent\.env|ccrc-mail\.token|exposure\.env)(\..*)?$/.test(f)
      && !f.endsWith('.example'));
    expect(leaked, 'a real credential file is committed').toEqual([]);
  });
});
