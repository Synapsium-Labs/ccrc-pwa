// D-5855 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1a and §Global
// constraints; spec 2026-10-19 §5.1 rule 8): no `pwa/` file before W7. A W1a series PR never edits the PWA, so the
// skins chain, Settings and Accounts PWA work never rebase on this wave.
//
// KEYED ON THE DIFF, never on a branch name: CI runs `pull_request` on a detached merge commit and `merge_group` on a
// `gh-readonly-queue/*` ref, and nothing reads `GITHUB_HEAD_REF`. Over `git diff --name-only $(git merge-base
// origin/main HEAD) HEAD`, a diff that touches a W1a-owned file AND any `pwa/` path is red. A diff that touches only
// one side passes. The owned list is the production files the W1a plan's tasks create or edit; its tests are not in
// it, because a PWA change that adds a server pin beside it is not W1a's.
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

/** The production files W1a's tasks (C1a to C1f) create or edit. */
const W1A_OWNED: readonly string[] = [
  'shared/switches.ts',
  'server/src/notice.ts',
  'server/src/archivedExpiry.ts',
  'server/src/collectLane.ts',
  'server/src/deadCoordinator.ts',
  'server/src/idlenudge.ts',
  'server/src/interruptlog.ts',
  'server/src/server.ts',
  'server/src/stopDone.ts',
  'server/src/turnidle.ts',
  'server/src/watch.ts',
  'server/src/coord/childReclaim.ts',
  'server/src/coord/collectTempRoot.ts',
  'server/src/coord/endDeadCoordinator.ts',
  'server/src/coord/expireArchived.ts',
  'server/src/coord/hibernate.ts',
  'server/src/coord/routes.ts',
  'server/src/coord/rundefs.ts',
  'server/src/coord/db.ts',
  'server/src/coord/schema.ts',
  'server/src/coord/store.ts',
];

/** The guard's verdict over one diff's file names: the W1a-owned files and the `pwa/` paths it touches. Red when
 *  both lists are non-empty. */
function pathGuard(files: readonly string[]): { owned: string[]; pwa: string[]; red: boolean } {
  const owned = files.filter((f) => W1A_OWNED.includes(f));
  const pwa = files.filter((f) => f.startsWith('pwa/'));
  return { owned, pwa, red: owned.length > 0 && pwa.length > 0 };
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

describe('no pwa/ file before W7 (D-5855; spec §5.1 rule 8)', () => {
  it('CONTROL (fixture): an owned file and a pwa/ path together are red; either side alone, or neither, passes', () => {
    expect(pathGuard(['shared/switches.ts', 'pwa/src/app.tsx'])).toEqual(
      { owned: ['shared/switches.ts'], pwa: ['pwa/src/app.tsx'], red: true });
    expect(pathGuard(['server/src/coord/rundefs.ts', 'server/test/switches.test.ts']).red).toBe(false);
    expect(pathGuard(['pwa/src/app.tsx', 'pwa/src/shell.css', 'server/test/single-definition.test.ts']).red).toBe(false);
    expect(pathGuard(['docs/x.md']).red).toBe(false);
    // A path that merely starts like an owned one is not it, and `pwa` must be the top directory.
    expect(pathGuard(['server/src/watch.ts.orig', 'shared/pwa/x.ts']).red).toBe(false);
  });

  it('CONTROL (fixture): a pwa-only queue entry stacked on a W1a entry is green against the group base_sha', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'path-guard-'));
    try {
      const g = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
      const put = (f: string): void => {
        mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        writeFileSync(path.join(dir, f), `${f}\n`);
        g('add', f);
        g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', f);
      };
      g('init', '-q', '-b', 'main');
      put('README.md');
      g('update-ref', 'refs/remotes/origin/main', 'HEAD');
      put('server/src/watch.ts'); // the entry queued ahead
      const groupBase = g('rev-parse', 'HEAD');
      put('pwa/src/main.tsx'); // this entry: pwa-only
      const event = JSON.stringify({ merge_group: { base_sha: groupBase } });
      const queued = guardBase(dir, { GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: 'e.json' }, () => event);
      expect(queued).toBe(groupBase);
      expect(pathGuard(diffFiles(dir, queued!)).red).toBe(false);
      // Measured from origin/main instead, the same queue commit carries the entry ahead and is red.
      const fromMain = guardBase(dir, {});
      expect(pathGuard(diffFiles(dir, fromMain!)).red).toBe(true);
      // A merge_group run whose base_sha does not resolve is red, not a silent fall-back.
      expect(() => guardBase(dir, { GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: 'e.json' },
        () => JSON.stringify({ merge_group: { base_sha: '0'.repeat(40) } }))).toThrow(/does not resolve/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('this diff does not touch a W1a-owned file and a pwa/ path together', () => {
    const base = guardBase(REPO, process.env);
    if (base === null) {
      expect(process.env.CI, 'no $CCRC_HISTORY_BASE or origin/main resolved in CI: the guard would measure nothing')
        .toBeFalsy();
      console.log('consolidation-path-guard: no origin/main here, so the diff guard is skipped (it is red in CI)');
      return;
    }
    const v = pathGuard(diffFiles(REPO, base));
    expect(v.red ? v.pwa : [], `this diff touches W1a-owned ${v.owned.join(', ')} and pwa/ paths`).toEqual([]);
  });
});
