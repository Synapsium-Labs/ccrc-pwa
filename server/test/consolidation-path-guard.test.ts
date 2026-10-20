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
// The base: `$CCRC_HISTORY_BASE`, else `origin/main` (`topology-clean.test.ts`'s `resolveBase`, which CI's
// `fetch-depth: 0` keeps resolvable). With no base it skips with a printed notice; in CI (`CI` set) a missing base is
// red, never a silent skip.
import { execFileSync } from 'node:child_process';
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

function resolveBase(cwd: string): string | null {
  const candidates = [process.env.CCRC_HISTORY_BASE, 'origin/main'].filter((r): r is string => Boolean(r));
  for (const ref of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, stdio: 'pipe' });
      return ref;
    } catch { /* try the next candidate */ }
  }
  return null;
}

const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });

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

  it('this diff does not touch a W1a-owned file and a pwa/ path together', () => {
    const base = resolveBase(REPO);
    if (base === null) {
      expect(process.env.CI, 'no $CCRC_HISTORY_BASE or origin/main resolved in CI: the guard would measure nothing')
        .toBeFalsy();
      console.log('consolidation-path-guard: no origin/main here, so the diff guard is skipped (it is red in CI)');
      return;
    }
    const mergeBase = git(['merge-base', base, 'HEAD']).trim();
    const files = git(['diff', '--name-only', mergeBase, 'HEAD']).split('\n').filter(Boolean);
    const v = pathGuard(files);
    expect(v.red ? v.pwa : [], `this diff touches W1a-owned ${v.owned.join(', ')} and pwa/ paths`).toEqual([]);
  });
});
