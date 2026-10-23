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
// from fixture files and RECORDS every argv, npm/curl/node poisons. Never the
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
  // The branch name here is documentary only: the script reads the tag at
  // HEAD, never the branch — the `stable`-must-be-fast-forward constraint
  // is the ruleset's job, not this script's.
  git(root, 'init', '-q', '-b', 'stable');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'released from main');
  if (opts.tagHead !== undefined) git(root, 'tag', opts.tagHead);
  return root;
}

interface GhOpts { view?: string; viewExit?: number; editExit?: number; latest?: string; latestAfterEdit?: string }

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
  for (const p of ['npm', 'curl', 'node']) {
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

const REFUSAL_HEAD = 'release-stable.sh: stable must fast-forward to a commit released from main; a merge commit has no release to promote (HEAD ';

describe('release-stable.sh: the refusal of a HEAD with no release tag says what is true (W25, D-6398)', () => {
  /** The refusal is the whole answer: exit 2, nothing on stdout, no gh call,
   *  and ONE line on stderr. The fixture's PATH poisons node, npm and curl. */
  function refused(home: string, r: Result): string {
    expect(r.code, r.stderr).toBe(2);
    expect(r.stdout).toBe('');
    expect(ghArgv(home)).toEqual([]);
    expect(r.stderr.split('\n').filter((l) => l !== '')).toHaveLength(1);
    expect(r.stderr.endsWith('\n')).toBe(true);
    return r.stderr;
  }
  const docsOnly = { 'README.md': '# fixture, edited\n', 'docs/a.md': 'a\n' };
  const shipped = { 'server/src/x.ts': 'export const x = 1;\n' };
  const pointerTail = (full: string): string =>
    `A main merge whose build came out unchanged cuts no release either: the release-main run for ${full} printed "built unchanged" or what differed`;
  const DOCS_WHY = "HEAD's merge changed only docs/ or the root's Markdown, so no release-main run started for it.";

  it('W25-T1: a HEAD whose merge changed a shipped path is refused in one line naming the release, the full sha and "built unchanged"', () => {
    const home = mkTmp('ccrc-relstable-t1-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    commitFiles(root, shipped);
    const short = git(root, 'rev-parse', '--short', 'HEAD');
    const full = git(root, 'rev-parse', 'HEAD');
    const err = refused(home, run(root, home));
    expect(err).toBe(
      `${REFUSAL_HEAD}${short} carries no vX.Y.Z tag; the newest release it contains is v1.2.3). ${pointerTail(full)}. stable now sits past v1.2.3 and cannot move back (fast-forward only); the next release cut from a descendant of ${short} is the next commit it can promote. Nothing was changed\n`);
    expect(err).toContain('v1.2.3');
    expect(err).toContain(full);
    expect(err).toContain('built unchanged');
  });

  it('W25-T1b: a HEAD whose merge changed only docs/ and the root Markdown says no release-main run started, and names the release', () => {
    const home = mkTmp('ccrc-relstable-t1b-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    commitFiles(root, { 'docs/x.md': 'x\n', 'README.md': '# fixture, edited\n' });
    const short = git(root, 'rev-parse', '--short', 'HEAD');
    const full = git(root, 'rev-parse', 'HEAD');
    const err = refused(home, run(root, home));
    expect(err).toBe(
      `${REFUSAL_HEAD}${short} carries no vX.Y.Z tag; the newest release it contains is v1.2.3). ${DOCS_WHY} stable now sits past v1.2.3 and cannot move back (fast-forward only); the next release cut from a descendant of ${short} is the next commit it can promote. Nothing was changed\n`);
    expect(err).not.toContain(full);
    expect(err).not.toContain('built unchanged');
  });

  it('W25-T1c: the docs rule is root-anchored; a Markdown file below the root, a docs directory below the root, or one non-docs path among docs paths all point at the run', () => {
    const cases: Array<[string, Record<string, string>]> = [
      ['skill', { 'ccd/x/SKILL.md': 'x\n' }],
      ['nested', { 'pwa/src/docs/a.ts': 'x\n' }],
      ['mixed', { 'docs/a.md': 'a\n', 'server/src/x.ts': 'x\n' }],
      ['root-non-md', { 'LICENSE': 'x\n' }],
    ];
    for (const [name, files] of cases) {
      const home = mkTmp(`ccrc-relstable-t1c-${name}-`);
      const root = fixture(home, { tagHead: 'v1.2.3' });
      commitFiles(root, files);
      const full = git(root, 'rev-parse', 'HEAD');
      const err = refused(home, run(root, home));
      expect(err, name).toContain(`${pointerTail(full)}. stable now sits past`);
      expect(err, name).not.toContain('no release-main run started');
    }
  });

  it('W25-T1d: an empty HEAD commit (no changed path) points at the run; "only docs" needs at least one path', () => {
    const home = mkTmp('ccrc-relstable-t1d-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    git(root, 'commit', '-q', '--allow-empty', '-m', 'an empty merge');
    const full = git(root, 'rev-parse', 'HEAD');
    const err = refused(home, run(root, home));
    expect(err).toContain(`${pointerTail(full)}. stable now sits past`);
    expect(err).not.toContain('no release-main run started');
  });

  it('W25-T3: only a release HEAD contains is named; a tag on a side branch is not', () => {
    const home = mkTmp('ccrc-relstable-t3-');
    const root = fixture(home, { tagHead: 'v1.2.3' });
    git(root, 'checkout', '-q', '-b', 'side', 'v1.2.3');
    commitFiles(root, { 'side.txt': 'side\n' }, 'a side commit');
    git(root, 'tag', 'v9.9.9');
    git(root, 'checkout', '-q', 'stable');
    commitFiles(root, docsOnly);
    const err = refused(home, run(root, home));
    expect(err).toContain('the newest release it contains is v1.2.3)');
    expect(err).not.toContain('v9.9.9');
  });

  it('W25-T4: the newest contained release is the highest version, not the last in lexical order', () => {
    const home = mkTmp('ccrc-relstable-t4-');
    const root = fixture(home);
    git(root, 'commit', '-q', '--allow-empty', '-m', 'one');
    git(root, 'tag', 'v1.9.9');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'two');
    git(root, 'tag', 'v1.9.10');
    commitFiles(root, docsOnly);
    const err = refused(home, run(root, home));
    expect(err).toContain('the newest release it contains is v1.9.10)');
    expect(err).toContain('stable now sits past v1.9.10 and');
  });

  it('W25-T5: a one-commit HEAD with no release anywhere says HEAD contains none, points at the run, and says its changed paths could not be read', () => {
    const home = mkTmp('ccrc-relstable-t5-');
    const root = fixture(home);
    const short = git(root, 'rev-parse', '--short', 'HEAD');
    const full = git(root, 'rev-parse', 'HEAD');
    const err = refused(home, run(root, home));
    expect(err).toBe(
      `${REFUSAL_HEAD}${short} carries no vX.Y.Z tag, and it contains no release tag). ${pointerTail(full)} (HEAD's changed paths could not be read). stable now points at ${short} and cannot move back (fast-forward only); the first release cut from a descendant of ${short} is the next commit it can promote. Nothing was changed\n`);
  });

  it('W25-T7: no push, force, reset or tag^{commit} command in the refusal, with or without a contained release', () => {
    for (const [name, tagHead, files] of [['t7a', 'v1.2.3', docsOnly], ['t7b', undefined, docsOnly], ['t7c', 'v1.2.3', shipped]] as const) {
      const home = mkTmp(`ccrc-relstable-${name}-`);
      const root = fixture(home, tagHead === undefined ? {} : { tagHead });
      commitFiles(root, files);
      const err = refused(home, run(root, home));
      expect(err).not.toMatch(/git push|--force|push -f|\+refs|git reset|\^\{commit\}|<tag>/);
    }
  });

  it('pin: the code (comments aside) calls neither release-main.sh nor node, and measures nothing', () => {
    const code = readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/deploy\/release-main\.sh|\bnode\b|\bmeasure\b/);
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
