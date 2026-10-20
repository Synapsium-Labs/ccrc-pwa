// D-5855 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1a and §Global
// constraints; spec 2026-10-19 §5.1 rule 8): no `pwa/` file before W7. A W1a series PR never edits the PWA, so the
// skins chain, Settings and Accounts PWA work never rebase on this wave.
//
// KEYED ON THE DIFF, never on a branch name: CI runs `pull_request` on a detached merge commit and `merge_group` on a
// `gh-readonly-queue/*` ref, and nothing reads `GITHUB_HEAD_REF`. Over `git diff --name-only $(git merge-base
// origin/main HEAD) HEAD`, a diff that touches any `pwa/` path is red when it also touches a file W1a alone owns
// (`shared/switches.ts`, `server/src/notice.ts`) or when a commit in the same range cites one of the W1a plan's own
// numbers (D-5855 to D-5860). A diff that touches only one side passes.
//
// The owned list is deliberately NOT the shared hot files W1a's tasks also edit (`server.ts`, `watch.ts`,
// `coord/routes.ts`, `coord/db.ts`, `coord/schema.ts`, `coord/store.ts` and the lane definers): the skins, Settings
// and Accounts PRs edit those beside `pwa/` (an Accounts roster PR touches `server.ts`, `coord/routes.ts` and a PWA
// store), and the plan says the guard never stops them (path-guard-owned-narrowed). A W1a PR is still caught there
// by its own commits, which cite its D-number.
//
// The base: in a `merge_group` run, the group's `base_sha` from `$GITHUB_EVENT_PATH` (path-guard-merge-group-base);
// otherwise `$CCRC_HISTORY_BASE`, else `origin/main` (`topology-clean.test.ts`'s `resolveBase`, which CI's
// `fetch-depth: 0` keeps resolvable). With no base it skips with a printed notice; in CI (`CI` set) a missing base is
// red, never a silent skip.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The files W1a creates and no other stream edits (path-guard-owned-narrowed). */
const W1A_OWNED: readonly string[] = ['shared/switches.ts', 'server/src/notice.ts'];

/** A W1a commit cites one of the W1a plan's numbers, D-5855 to D-5860, and not a longer number that starts with one. */
const W1A_NUMBER = /\bD-(?:585[5-9]|5860)(?!\d)/;

/** The guard's verdict over one diff's file names and its commits' messages: red when the diff touches a `pwa/` path
 *  and either a W1a-owned file or a commit cites a W1a number. */
function pathGuard(
  files: readonly string[],
  messages: readonly string[] = [],
): { owned: string[]; w1aCommits: number; pwa: string[]; red: boolean } {
  const owned = files.filter((f) => W1A_OWNED.includes(f));
  const w1aCommits = messages.filter((m) => W1A_NUMBER.test(m)).length;
  const pwa = files.filter((f) => f.startsWith('pwa/'));
  return { owned, w1aCommits, pwa, red: (owned.length > 0 || w1aCommits > 0) && pwa.length > 0 };
}

/** Where this diff starts. A `merge_group` run's HEAD is the queue commit, stacked on every entry queued ahead of it,
 *  so its own diff starts at the group's `base_sha` (the base CI's select step already uses), never at `origin/main`:
 *  from there a pwa-only PR queued behind a W1a PR would measure both (path-guard-merge-group-base). Otherwise
 *  `$CCRC_HISTORY_BASE`, else `origin/main`, through their merge base with HEAD. Null when nothing resolves. */
function guardBase(
  cwd: string,
  env: NodeJS.ProcessEnv,
  readEvent: (file: string) => string = (f) => readFileSync(f, 'utf8'),
): string | null {
  const verify = (ref: string): boolean => {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, stdio: 'pipe' });
      return true;
    } catch { return false; }
  };
  if (env.GITHUB_EVENT_NAME === 'merge_group') {
    // A merge_group run with no readable base_sha is red, never a fall-back to origin/main's wider diff.
    const sha = (JSON.parse(readEvent(env.GITHUB_EVENT_PATH ?? '')) as { merge_group?: { base_sha?: string } })
      .merge_group?.base_sha;
    if (!sha || !verify(sha)) throw new Error(`merge_group base_sha ${String(sha)} does not resolve`);
    return sha;
  }
  for (const ref of [env.CCRC_HISTORY_BASE, 'origin/main'].filter((r): r is string => Boolean(r))) {
    if (verify(ref)) return execFileSync('git', ['merge-base', ref, 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  }
  return null;
}

const diffFiles = (cwd: string, from: string): string[] =>
  execFileSync('git', ['diff', '--name-only', from, 'HEAD'], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);

/** Each commit message in from..HEAD, NUL-separated so a multi-line body stays one entry. */
const rangeMessages = (cwd: string, from: string): string[] =>
  execFileSync('git', ['log', '--format=%B%x00', `${from}..HEAD`], { cwd, encoding: 'utf8' })
    .split('\0').map((m) => m.trim()).filter(Boolean);

describe('no pwa/ file before W7 (D-5855; spec §5.1 rule 8)', () => {
  it('CONTROL (fixture): an owned file and a pwa/ path together are red; either side alone, or neither, passes', () => {
    expect(pathGuard(['shared/switches.ts', 'pwa/src/app.tsx'])).toEqual(
      { owned: ['shared/switches.ts'], w1aCommits: 0, pwa: ['pwa/src/app.tsx'], red: true });
    expect(pathGuard(['server/src/notice.ts', 'pwa/src/app.tsx']).red).toBe(true);
    expect(pathGuard(['server/src/coord/rundefs.ts', 'server/test/switches.test.ts']).red).toBe(false);
    expect(pathGuard(['pwa/src/app.tsx', 'pwa/src/shell.css', 'server/test/single-definition.test.ts']).red).toBe(false);
    expect(pathGuard(['docs/x.md']).red).toBe(false);
    // A path that merely starts like an owned one is not it, and `pwa` must be the top directory.
    expect(pathGuard(['shared/switches.ts.orig', 'shared/pwa/x.ts']).red).toBe(false);
  });

  it('CONTROL (fixture): an Accounts-shaped diff (server.ts, coord/routes.ts and a PWA store) with no W1a commit is green', () => {
    const accounts = ['server/src/server.ts', 'server/src/coord/routes.ts', 'pwa/src/stores/fleet.ts'];
    expect(pathGuard(accounts, ['feat(accounts): roster reload on GET /api/accounts'])).toEqual(
      { owned: [], w1aCommits: 0, pwa: ['pwa/src/stores/fleet.ts'], red: false });
    // The same files under a commit that cites a W1a number are a W1a PR touching pwa/: red.
    expect(pathGuard(accounts, ['refactor(server): re-point a reader (D-5856)']).red).toBe(true);
    expect(pathGuard(['server/src/watch.ts', 'pwa/src/app.tsx'], ['x\n\nbody cites D-5860 here']).red).toBe(true);
    // A W1a commit with no pwa/ path is green, and a longer number that starts with a W1a one is not it.
    expect(pathGuard(['server/src/watch.ts'], ['(D-5855)']).red).toBe(false);
    expect(pathGuard(['pwa/src/app.tsx'], ['(D-58551)', '(D-5854)', '(D-5861)']).red).toBe(false);
  });

  it('CONTROL (fixture): a pwa-only queue entry stacked on a W1a entry is green against the group base_sha', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'path-guard-'));
    try {
      const g = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
      const put = (f: string, msg = f): void => {
        mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        writeFileSync(path.join(dir, f), `${f}\n`);
        g('add', f);
        g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg);
      };
      g('init', '-q', '-b', 'main');
      put('README.md');
      g('update-ref', 'refs/remotes/origin/main', 'HEAD');
      put('shared/switches.ts', 'refactor: the switchboard\n\nbody (D-5855)'); // the entry queued ahead
      const groupBase = g('rev-parse', 'HEAD');
      put('pwa/src/main.tsx'); // this entry: pwa-only
      const event = JSON.stringify({ merge_group: { base_sha: groupBase } });
      const queued = guardBase(dir, { GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: 'e.json' }, () => event);
      expect(queued).toBe(groupBase);
      expect(pathGuard(diffFiles(dir, queued!), rangeMessages(dir, queued!))).toEqual(
        { owned: [], w1aCommits: 0, pwa: ['pwa/src/main.tsx'], red: false });
      // Measured from origin/main instead, the same queue commit carries the entry ahead and is red.
      const fromMain = guardBase(dir, {});
      expect(pathGuard(diffFiles(dir, fromMain!), rangeMessages(dir, fromMain!))).toEqual(
        { owned: ['shared/switches.ts'], w1aCommits: 1, pwa: ['pwa/src/main.tsx'], red: true });
      // A merge_group run whose base_sha does not resolve is red, not a silent fall-back.
      expect(() => guardBase(dir, { GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: 'e.json' },
        () => JSON.stringify({ merge_group: { base_sha: '0'.repeat(40) } }))).toThrow(/does not resolve/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('this diff does not touch pwa/ beside a W1a-owned file or a W1a commit', () => {
    const base = guardBase(REPO, process.env);
    if (base === null) {
      expect(process.env.CI, 'no $CCRC_HISTORY_BASE or origin/main resolved in CI: the guard would measure nothing')
        .toBeFalsy();
      console.log('consolidation-path-guard: no origin/main here, so the diff guard is skipped (it is red in CI)');
      return;
    }
    const v = pathGuard(diffFiles(REPO, base), rangeMessages(REPO, base));
    expect(v.red ? v.pwa : [],
      `this diff touches pwa/ paths with W1a-owned [${v.owned.join(', ')}] or ${v.w1aCommits} W1a commit(s)`).toEqual([]);
  });
});
