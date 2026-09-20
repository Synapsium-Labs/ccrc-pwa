// deploy/release-stable.sh — design 2026-09-20 §4, decision 3. On the stable
// branch's HEAD: the vX.Y.Z tag at HEAD names the release to promote (none →
// exit 2: a merge commit has no release, and "promote a tree nobody built"
// is unexpressible); read the release's flags; flip prerelease off; make it
// latest (two calls — drafts and prereleases cannot be set latest in one
// PATCH); read latest back. NEVER builds: a rebuild of the same tree is a
// different build.json, a different digest, bytes nobody ran.
//
// Fixture: a real one-commit repo (the `--points-at HEAD` question is git's;
// the script is COPIED into its deploy/ so `${BASH_SOURCE[0]}` resolves
// there), a stub gh that answers `release view` and `api …/releases/latest`
// from fixture files and RECORDS every argv, npm/curl poisons. Never the
// network.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-stable.sh');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'ccrc fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'ccrc fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', root, ...args], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** `<home>/repo`, one commit, optionally a tag at HEAD. */
function fixture(home: string, opts: { tagHead?: string } = {}): string {
  const root = join(home, 'repo');
  mkdirSync(join(root, 'deploy'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-stable.sh'));
  chmodSync(join(root, 'deploy', 'release-stable.sh'), 0o755);
  git(root, 'init', '-q', '-b', 'stable');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'released from main');
  if (opts.tagHead !== undefined) git(root, 'tag', opts.tagHead);
  return root;
}

/** The gh stub: `release view` prints `$HOME/gh-view` (the --jq output the
 *  script asked for: "<isPrerelease>\t<isDraft>") unless `$HOME/gh-view-exit`
 *  says otherwise; `release edit` exits `$HOME/gh-edit-exit` or 0; the latest
 *  read-back prints `$HOME/gh-latest`. Every argv is recorded. */
function plantBin(home: string, opts: { view?: string; viewExit?: number; editExit?: number; latest?: string }): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(home, 'gh-view'), `${opts.view ?? 'true\tfalse'}\n`);
  if (opts.viewExit !== undefined) writeFileSync(join(home, 'gh-view-exit'), `${opts.viewExit}\n`);
  if (opts.editExit !== undefined) writeFileSync(join(home, 'gh-edit-exit'), `${opts.editExit}\n`);
  writeFileSync(join(home, 'gh-latest'), `${opts.latest ?? 'v1.2.3'}\n`);
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'case "$1 $2" in',
    '  "release view") if [ -f "$HOME/gh-view-exit" ]; then read -r c < "$HOME/gh-view-exit"; exit "$c"; fi; cat "$HOME/gh-view"; exit 0 ;;',
    '  "release edit") if [ -f "$HOME/gh-edit-exit" ]; then read -r c < "$HOME/gh-edit-exit"; exit "$c"; fi; exit 0 ;;',
    '  "api repos/{owner}/{repo}/releases/latest") cat "$HOME/gh-latest"; exit 0 ;;',
    'esac',
    'echo "fixture gh: unexpected argv: $*" >&2; exit 90',
  ].join('\n') + '\n', { mode: 0o755 });
  for (const p of ['npm', 'curl', 'node']) {
    writeFileSync(join(bin, p), `#!/bin/sh\necho "release-stable tests never build or reach the network (${p})" >&2\nexit 97\n`, { mode: 0o755 });
  }
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [],
  opts: { view?: string; viewExit?: number; editExit?: number; latest?: string } = {}): Result {
  const bin = plantBin(home, opts);
  const r = spawnSync('bash', [join(root, 'deploy', 'release-stable.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const ghArgv = (home: string): string[] => (existsSync(join(home, 'gh-argv'))
  ? readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);

describe('release-stable.sh: what it refuses', () => {
  it('an untagged HEAD is exit 2 — a merge commit has no release to promote; gh never runs (§18 row 2)', () => {
    const home = mkTmp('ccrc-relstable-untagged-');
    const root = fixture(home);
    const r = run(root, home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/stable must fast-forward to a commit released from main; a merge commit has no release to promote/);
    expect(ghArgv(home)).toEqual([]);
  });

  it('an unknown argument is exit 2', () => {
    const home = mkTmp('ccrc-relstable-usage-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(ghArgv(home)).toEqual([]);
  });

  it('no release behind the tag: exit 1, says release-main\'s trap should have prevented it, no edit', () => {
    const home = mkTmp('ccrc-relstable-norelease-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { viewExit: 1 });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no GitHub release at v1\.2\.3/);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
  });

  it('a draft release: exit 1, no edit', () => {
    const home = mkTmp('ccrc-relstable-draft-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'true\ttrue' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v1\.2\.3 is a DRAFT release/);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
  });

  it('a failed first edit: exit 1, says the tag is still a prerelease, no --latest call', () => {
    const home = mkTmp('ccrc-relstable-editfail-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { editExit: 1 });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gh release edit v1\.2\.3 --prerelease=false failed — v1\.2\.3 is still a prerelease/);
    expect(ghArgv(home).filter((l) => l.includes('--latest'))).toEqual([]);
  });

  it('a read-back naming another tag: exit 1 naming both (D-3121)', () => {
    const home = mkTmp('ccrc-relstable-readback-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { latest: 'v1.2.4' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/promoted v1\.2\.3 to stable, but GitHub's latest is v1\.2\.4/);
  });
});

describe('release-stable.sh: the promotion', () => {
  it('prerelease → two edits in order (--prerelease=false, then --latest), then the read-back; exit 0 (§18 row 5)', () => {
    const home = mkTmp('ccrc-relstable-promote-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home);
    expect(r.code, r.stderr).toBe(0);
    expect(ghArgv(home)).toEqual([
      'release view v1.2.3 --json isPrerelease,isDraft --jq [.isPrerelease, .isDraft] | @tsv',
      'release edit v1.2.3 --prerelease=false',
      'release edit v1.2.3 --latest',
      'api repos/{owner}/{repo}/releases/latest --jq .tag_name',
    ]);
    expect(r.stdout.trim()).toBe('release-stable.sh: promoted v1.2.3 to stable (latest: v1.2.3)');
  });

  it('already stable → exit 0, no edit (idempotent; §18 row 3)', () => {
    const home = mkTmp('ccrc-relstable-idem-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'false\tfalse' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/already stable v1\.2\.3/);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
  });
});

describe('release-stable.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  it('runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });
  it('never builds and never creates a release (§18 row 4)', () => {
    expect(src()).not.toMatch(/build-release\.sh|npm |gh release create/);
  });
  it('the two edits are two calls, not one PATCH carrying both flags', () => {
    expect(src()).toContain('gh release edit "$TAG" --prerelease=false');
    expect(src()).toContain('gh release edit "$TAG" --latest');
    expect(src()).not.toMatch(/--prerelease=false --latest|--latest --prerelease=false/);
  });
});
