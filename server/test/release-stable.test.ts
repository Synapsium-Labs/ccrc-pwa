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

/** `<home>/repo`, one commit, optionally a tag at HEAD. `scope: true` adds what
 *  the refusal's measurement needs, before the first commit so every tag
 *  carries it: release-main.sh and release-scope.mjs in deploy/, and a
 *  server/package.json holding the real file's engines object (D-6403; read
 *  here, never spelled as a version). */
function fixture(home: string, opts: { tagHead?: string; scope?: boolean } = {}): string {
  const root = join(home, 'repo');
  mkdirSync(join(root, 'deploy'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-stable.sh'));
  chmodSync(join(root, 'deploy', 'release-stable.sh'), 0o755);
  if (opts.scope === true) {
    for (const f of ['release-main.sh', 'release-scope.mjs']) copyFileSync(join(REPO, 'deploy', f), join(root, 'deploy', f));
    const real = JSON.parse(readFileSync(join(REPO, 'server', 'package.json'), 'utf8')) as { engines: unknown };
    mkdirSync(join(root, 'server'), { recursive: true });
    writeFileSync(join(root, 'server', 'package.json'), `${JSON.stringify({ engines: real.engines }, null, 2)}\n`);
  }
  // The branch name here is documentary only: the script reads the tag at
  // HEAD, never the branch — the `stable`-must-be-fast-forward constraint
  // is the ruleset's job, not this script's.
  git(root, 'init', '-q', '-b', 'stable');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'released from main');
  if (opts.tagHead !== undefined) git(root, 'tag', opts.tagHead);
  return root;
}

interface GhOpts { view?: string; viewExit?: number; editExit?: number; latest?: string; latestAfterEdit?: string; realNode?: boolean }

/** The gh stub: `release view` prints `$HOME/gh-view` (the --jq output the
 *  script asked for: "<isPrerelease>\t<isDraft>") unless `$HOME/gh-view-exit`
 *  says otherwise; `release edit` exits `$HOME/gh-edit-exit` or 0, touching
 *  `$HOME/gh-edited` on that success path; the latest read-back prints
 *  `$HOME/gh-latest` until an edit has landed, then `$HOME/gh-latest-after-edit`
 *  when one was planted (D-3128: the already-stable path can read latest,
 *  edit, then read again, and the two reads must be allowed to differ).
 *  Every argv is recorded. */
function plantBin(home: string, opts: GhOpts): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(home, 'gh-view'), `${opts.view ?? 'true\tfalse'}\n`);
  if (opts.viewExit !== undefined) writeFileSync(join(home, 'gh-view-exit'), `${opts.viewExit}\n`);
  if (opts.editExit !== undefined) writeFileSync(join(home, 'gh-edit-exit'), `${opts.editExit}\n`);
  writeFileSync(join(home, 'gh-latest'), `${opts.latest ?? 'v1.2.3'}\n`);
  if (opts.latestAfterEdit !== undefined) writeFileSync(join(home, 'gh-latest-after-edit'), `${opts.latestAfterEdit}\n`);
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'case "$1 $2" in',
    '  "release view") if [ -f "$HOME/gh-view-exit" ]; then read -r c < "$HOME/gh-view-exit"; exit "$c"; fi; cat "$HOME/gh-view"; exit 0 ;;',
    '  "release edit") if [ -f "$HOME/gh-edit-exit" ]; then read -r c < "$HOME/gh-edit-exit"; exit "$c"; fi; touch "$HOME/gh-edited"; exit 0 ;;',
    '  "api repos/{owner}/{repo}/releases/latest") if [ -f "$HOME/gh-latest-after-edit" ] && [ -f "$HOME/gh-edited" ]; then cat "$HOME/gh-latest-after-edit"; else cat "$HOME/gh-latest"; fi; exit 0 ;;',
    'esac',
    'echo "fixture gh: unexpected argv: $*" >&2; exit 90',
  ].join('\n') + '\n', { mode: 0o755 });
  for (const p of opts.realNode === true ? ['npm', 'curl'] : ['npm', 'curl', 'node']) {
    writeFileSync(join(bin, p), `#!/bin/sh\necho "release-stable tests never build or reach the network (${p})" >&2\nexit 97\n`, { mode: 0o755 });
  }
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [], opts: GhOpts = {}): Result {
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
    expect(r.stderr).toMatch(/unknown argument: --bogus/);
    expect(ghArgv(home)).toEqual([]);
  });

  it('HEAD carrying two release tags is exit 2 — a promotion names one release, not the lexicographically-first one (D-3129)', () => {
    const home = mkTmp('ccrc-relstable-doubletag-');
    const root = fixture(home, { tagHead: 'v0.0.9' });
    git(root, 'tag', 'v0.1.0');
    const r = run(root, home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/HEAD carries more than one release tag/);
    expect(r.stderr).toMatch(/v0\.0\.9/);
    expect(r.stderr).toMatch(/v0\.1\.0/);
    expect(ghArgv(home)).toEqual([]);
  });

  it('a malformed view answer (DRAFT field missing) never promotes an unmeasured draft: exit 1, no edit', () => {
    const home = mkTmp('ccrc-relstable-malformed-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'true' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unexpected answer from gh release view for v1\.2\.3/);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
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

/** Commit the given files (path -> text) on top of the fixture's HEAD. */
function commitFiles(root: string, files: Record<string, string>, msg = 'a merge'): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', msg);
}

const TAIL_UNRELEASED = 'the next release cut from a descendant of ';
const PUSH_PLACEHOLDER = 'git push origin <tag>^{commit}:refs/heads/stable';

describe('release-stable.sh: the refusal of a HEAD with no release tag says what is true (W25, D-6398)', () => {
  /** The refusal is the whole answer: exit 2, nothing on stdout, no gh call. */
  function refused(home: string, r: Result): string {
    expect(r.code, r.stderr).toBe(2);
    expect(r.stdout).toBe('');
    expect(ghArgv(home)).toEqual([]);
    // Exactly one line on stderr, whatever the measurement printed.
    expect(r.stderr.split('\n').filter((l) => l !== '')).toHaveLength(1);
    return r.stderr;
  }
  const docsOnly = { 'README.md': '# fixture, edited\n', 'docs/a.md': 'a\n' };

  it('W25-T1: an unreleased docs head is refused, and says nothing that ships changed', () => {
    const home = mkTmp('ccrc-relstable-t1-');
    const root = fixture(home, { tagHead: 'v1.2.3', scope: true });
    commitFiles(root, docsOnly);
    const short = git(root, 'rev-parse', '--short', 'HEAD');
    const err = refused(home, run(root, home, [], { realNode: true }));
    expect(err).toBe(
      `release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD ${short} carries no vX.Y.Z tag; it sits past v1.2.3, the newest release it contains, and its merges since changed nothing that ships (paths changed: 2), so no release was cut for them). stable now sits past v1.2.3 and cannot move back (fast-forward only): ${TAIL_UNRELEASED}${short} promotes by a fast-forward push of that release's commit (${PUSH_PLACEHOLDER}). Nothing was changed\n`);
    expect(err).toContain('carries no vX.Y.Z tag; it sits past v1.2.3, the newest release it contains, and its merges since changed nothing that ships (paths changed: 2), so no release was cut for them). stable now sits past v1.2.3 and cannot move back (fast-forward only): the next release cut from a descendant of ');
    expect(err.endsWith('Nothing was changed\n')).toBe(true);
  });

  it('W25-T2: a shipped change is refused, and says to check the release-main run', () => {
    const home = mkTmp('ccrc-relstable-t2-');
    const root = fixture(home, { tagHead: 'v1.2.3', scope: true });
    commitFiles(root, { 'deploy/x.sh': '#!/bin/sh\n' });
    const err = refused(home, run(root, home, [], { realNode: true }));
    expect(err).toMatch(/stable must fast-forward to a commit released from main; a merge commit has no release to promote/);
    expect(err).toMatch(/carries no vX\.Y\.Z tag; it sits past v1\.2\.3, the newest release it contains, and it changed what ships \(shipped paths changed: 1; first: "deploy\/x\.sh"\): check the release-main run for its merge/);
    expect(err).toContain('which should have cut a release). stable now sits past v1.2.3');
  });

  it('W25-T3: only a release HEAD contains is named; a tag on a side branch is not', () => {
    const home = mkTmp('ccrc-relstable-t3-');
    const root = fixture(home, { tagHead: 'v1.2.3', scope: true });
    git(root, 'checkout', '-q', '-b', 'side', 'v1.2.3');
    commitFiles(root, { 'side.txt': 'side\n' }, 'a side commit');
    git(root, 'tag', 'v9.9.9');
    git(root, 'checkout', '-q', 'stable');
    commitFiles(root, docsOnly);
    const err = refused(home, run(root, home, [], { realNode: true }));
    expect(err).toContain('it sits past v1.2.3, the newest release it contains');
    expect(err).not.toContain('v9.9.9');
  });

  it('W25-T4: the newest contained release is the highest version, not the last in lexical order', () => {
    const home = mkTmp('ccrc-relstable-t4-');
    const root = fixture(home, { scope: true });
    git(root, 'commit', '-q', '--allow-empty', '-m', 'one');
    git(root, 'tag', 'v1.9.9');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'two');
    git(root, 'tag', 'v1.9.10');
    commitFiles(root, docsOnly);
    const err = refused(home, run(root, home, [], { realNode: true }));
    expect(err).toContain('it sits past v1.9.10, the newest release it contains');
  });

  it('W25-T5: no release anywhere says HEAD contains none, and runs no node', () => {
    const home = mkTmp('ccrc-relstable-t5-');
    const root = fixture(home);
    const short = git(root, 'rev-parse', '--short', 'HEAD');
    const err = refused(home, run(root, home));
    expect(err).toBe(
      `release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD ${short} carries no vX.Y.Z tag, and it contains no release tag). stable now points at ${short} and cannot move back (fast-forward only): the first release cut from a descendant of ${short} promotes by a fast-forward push of that release's commit (${PUSH_PLACEHOLDER}). Nothing was changed\n`);
    expect(err).toContain('carries no vX.Y.Z tag, and it contains no release tag). stable now points at');
  });

  it('W25-T6: a change that cannot be measured is read as changed, with the reason', () => {
    const home = mkTmp('ccrc-relstable-t6-');
    const root = fixture(home, { tagHead: 'v1.2.3', scope: true });
    git(root, 'rm', '-q', 'deploy/release-scope.mjs');
    commitFiles(root, docsOnly);
    const err = refused(home, run(root, home, [], { realNode: true }));
    expect(err).toContain('whether it changed what ships could not be measured (release-scope.mjs exited 1), so read it as changed: check the release-main run for its merge). stable now sits past v1.2.3');
    expect(err).not.toContain('changed nothing that ships');
  });

  it('W25-T7: no rewind, no force, no push of a contained release; the one command is the placeholder', () => {
    for (const [name, files] of [['t7a', docsOnly], ['t7b', { 'deploy/x.sh': '#!/bin/sh\n' }]] as const) {
      const home = mkTmp(`ccrc-relstable-${name}-`);
      const root = fixture(home, { tagHead: 'v1.2.3', scope: true });
      commitFiles(root, files);
      const err = refused(home, run(root, home, [], { realNode: true }));
      expect(err).not.toMatch(/--force|push -f|\+refs|git reset|git push origin v[0-9]/);
      expect(err.split(PUSH_PLACEHOLDER).length - 1).toBe(1);
    }
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

  it('already stable and latest already matches → exit 0, no edit, but still reads latest back (idempotent means converged, not a bare early return; §18 row 3, D-3128)', () => {
    const home = mkTmp('ccrc-relstable-idem-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'false\tfalse' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('release-stable.sh: already stable v1.2.3 (latest: v1.2.3)');
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual([]);
    expect(ghArgv(home)).toContain('api repos/{owner}/{repo}/releases/latest --jq .tag_name');
  });

  it('already stable but latest names another tag → finishes the promotion: one release edit --latest, then the read-back, exit 0 (D-3128)', () => {
    const home = mkTmp('ccrc-relstable-idem-catchup-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'false\tfalse', latest: 'v1.2.4', latestAfterEdit: 'v1.2.3' });
    expect(r.code, r.stderr).toBe(0);
    expect(ghArgv(home).filter((l) => l.startsWith('release edit'))).toEqual(['release edit v1.2.3 --latest']);
    expect(ghArgv(home).slice(-1)).toEqual(['api repos/{owner}/{repo}/releases/latest --jq .tag_name']);
    expect(r.stdout).toMatch(/promoted v1\.2\.3 to stable \(latest: v1\.2\.3\)/);
  });

  it('already stable, latest names another tag, and the edit fails → exit 1, says stable but latest may still serve another tag (D-3128)', () => {
    const home = mkTmp('ccrc-relstable-idem-editfail-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    const r = run(root, home, [], { view: 'false\tfalse', latest: 'v1.2.4', editExit: 1 });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v1\.2\.3 is stable, but latest\/download may still serve another tag; re-run/);
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
