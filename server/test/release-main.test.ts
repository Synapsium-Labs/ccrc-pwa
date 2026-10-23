// deploy/release-main.sh — spec §3. On a clean, untagged HEAD: derive the next
// patch tag from the highest existing vX.Y.Z, tag it locally and build the
// candidate (prepare), decide on the built artifact whether the merge releases
// (compare), then push the tag, publish with gh and delete the pushed tag if
// the publish never completes (publish). Fixture: a repo with a BARE origin
// (so `git push` is real and its effect is measurable), the real
// build-release.sh copied in (its own suite proves it), a recording npm that
// fabricates dists, a recording gh whose exit code the test chooses and which
// serves release assets the test built with that same builder. Never touches
// the network: curl is poisoned, gh is the stub.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

// Every test builds several tarballs and clones; one end-of-file sweep of all of
// them can overrun vitest's 20 s hook timeout under load, so each test removes
// its own directories.
removeTmpFixturesEachTest();

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-main.sh');
const BUILDER = join(REPO, 'deploy', 'build-release.sh');
const NOTES = join(REPO, 'deploy', 'release-notes.mjs');
const ARTIFACT = join(REPO, 'deploy', 'release-artifact.sh');

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

/** The smallest tree build-release.sh's `git archive` pathspec accepts.
 *  `.gitignore` mirrors the real repo's (node_modules, the three dist dirs) —
 *  without it, a build's untracked output would read as a dirty tree on a
 *  second `prepare` against the same checkout, exactly as it would NOT in
 *  the real, gitignored repo. */
const FILES: Record<string, string> = {
  '.gitignore': 'node_modules\nserver/dist/\nserver/dist-pwa/\nagent/dist/\n',
  '.github/workflows/release-main.yml': '# the fixture workflow\n',
  'install.sh': '#!/usr/bin/env bash\necho fixture\n',
  'ccd/ccrc': '#!/usr/bin/env bash\necho fixture\n',
  'shared/package.json': '{ "type": "module" }\n',
  'deploy/ccrc.service': '[Unit]\nDescription=fixture\n',
  'server/package.json': '{ "name": "s" }\n',
  'server/package-lock.json': '{}\n',
  'agent/package.json': '{ "name": "a" }\n', 'agent/package-lock.json': '{}\n',
  'pwa/package.json': '{ "name": "p" }\n', 'pwa/package-lock.json': '{}\n',
  // build-release.sh installs ui before pwa (pwa builds @ccrc/ui from source).
  'ui/package.json': '{ "name": "u" }\n', 'ui/package-lock.json': '{}\n',
};

/** Builds `<home>/assets/<tag>/` the way a release is built: the real
 *  build-release.sh, the stub npm, on a clone of the fixture checked out at
 *  `<tag>` (as branch `main`, or `branch`). It runs under its own HOME, so the
 *  main home's npm record stays what the rows under test measure. */
function buildAsset(home: string, root: string, tag: string, branch = 'main'): void {
  const work = join(home, 'asset-build', tag);
  mkdirSync(path.dirname(work), { recursive: true });
  const env = { ...process.env, ...GIT_ENV };
  const clone = spawnSync('git', ['clone', '-q', root, work], { env, encoding: 'utf8' });
  if (clone.status !== 0) throw new Error(`fixture clone failed: ${clone.stderr}`);
  git(work, 'checkout', '-q', '-B', branch, tag);
  const assetHome = join(home, 'asset-home');
  mkdirSync(assetHome, { recursive: true });
  const bin = plantBin(assetHome);
  const out = join(home, 'assets', tag);
  const r = spawnSync('bash', [join(work, 'deploy', 'build-release.sh'), '--out', out],
    { env: { ...env, HOME: assetHome, PATH: `${bin}:${process.env.PATH ?? ''}` }, cwd: work, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture asset build for ${tag} failed: ${r.stderr}`);
}

/** `<home>/repo` with one commit, `<home>/origin.git` bare and added as
 *  `origin`, optional existing tags (pushed to origin too, as real ones are).
 *  `seed` adds files to the first commit, so every tag carries them; `merge`
 *  writes the change 'the merge under release' carries (default: a shipped
 *  change to ccd/ccrc); `after` adds a later commit; `assets` builds each
 *  named tag's release asset (tarball + SHA256SUMS) with the real builder, on
 *  branch `assetBranch` when given. */
function fixture(home: string, opts: {
  tags?: string[]; tagHead?: string; notes?: boolean;
  seed?: (root: string) => void; merge?: (root: string) => void; after?: (root: string) => void;
  assets?: string[]; assetBranch?: string;
} = {}): string {
  const root = join(home, 'repo');
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(path.dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, { mode: rel.endsWith('.sh') || rel === 'ccd/ccrc' ? 0o755 : 0o644 });
  }
  copyFileSync(BUILDER, join(root, 'deploy', 'build-release.sh'));
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-main.sh'));
  // receive verifies the hand-over with it, as the publish job does (D-6656).
  copyFileSync(ARTIFACT, join(root, 'deploy', 'release-artifact.sh'));
  // D-5548: the notes writer rides beside the script, as in the real tree;
  // `notes: false` leaves it out, the shape of a writer that fails.
  if (opts.notes !== false) copyFileSync(NOTES, join(root, 'deploy', 'release-notes.mjs'));
  chmodSync(join(root, 'deploy', 'build-release.sh'), 0o755);
  chmodSync(join(root, 'deploy', 'release-main.sh'), 0o755);
  chmodSync(join(root, 'deploy', 'release-artifact.sh'), 0o755);
  if (opts.seed !== undefined) opts.seed(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  for (const t of opts.tags ?? []) {
    // Each older tag sits on its own earlier commit, so HEAD stays untagged.
    git(root, 'commit', '-q', '--allow-empty', '-m', `release ${t}`);
    git(root, 'tag', t);
  }
  (opts.merge ?? ((r: string) => {
    writeFileSync(join(r, 'ccd', 'ccrc'), '#!/usr/bin/env bash\necho the merge\n', { mode: 0o755 });
  }))(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'the merge under release');
  if (opts.after !== undefined) {
    opts.after(root);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'a docs merge after it');
  }
  if (opts.tagHead !== undefined) git(root, 'tag', opts.tagHead);
  const origin = join(home, 'origin.git');
  spawnSync('git', ['init', '-q', '--bare', origin], { env: { ...process.env, ...GIT_ENV } });
  // An `update` hook records every ref pushed to origin — including a
  // transient push that a later refusal unwinds — so "no push happened at
  // all" is OBSERVABLE from outside the process (R4: `git tag`/`push`
  // succeeding and then being cleaned up is not the same as never running).
  // Hooks run with the pusher's environment, so HOME is the fixture home.
  mkdirSync(join(origin, 'hooks'), { recursive: true });
  writeFileSync(join(origin, 'hooks', 'update'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$1" >> "$HOME/origin-pushes"',
    'exit 0',
  ].join('\n'), { mode: 0o755 });
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main', '--tags');
  // fixture()'s own setup push fires the hook too (main, and any pre-existing
  // tags); clear that so `origin-pushes` reflects only what `run()` does.
  rmSync(join(home, 'origin-pushes'), { force: true });
  for (const t of opts.assets ?? []) buildAsset(home, root, t, opts.assetBranch);
  return root;
}

interface GhView { view?: string; viewExit?: number }
function plantBin(home: string, ghExit = 0, ghView: GhView = {}): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$PWD $*" >> "$HOME/npm-argv"',
    'if [ "$1" = "run" ] && [ "$2" = "build" ]; then case "$PWD" in',
    '  */server) mkdir -p dist/server/src; echo "// s" > dist/server/src/index.js; if [ -f "$HOME/dist-mode" ]; then chmod "$(cat "$HOME/dist-mode")" dist/server; fi; if [ -f "$HOME/dist-file-mode" ]; then chmod "$(cat "$HOME/dist-file-mode")" dist/server/src/index.js; fi ;;',
    '  */pwa) mkdir -p ../server/dist-pwa; echo "<title>p</title>" > ../server/dist-pwa/index.html; if [ -f "$HOME/dot-mode" ]; then mkdir -p ../server/dist-pwa/.vite; chmod "$(cat "$HOME/dot-mode")" ../server/dist-pwa/.vite; fi ;;',
    '  */agent) mkdir -p dist/agent/src; echo "// a" > dist/agent/src/index.js ;;',
    'esac; fi; exit 0',
  ].join('\n'), { mode: 0o755 });
  // gh RECORDS its argv and the token it was given, and, at call time, which
  // tags origin holds — the ordering pin (tag pushed BEFORE publish) reads
  // that record. `release view` is compare's published-base check and answers
  // from files the test plants (default: false, rc 0). `release download`
  // copies what the test built into $HOME/assets/<tag>/ into --dir, and fails
  // with the code in $HOME/gh-download-exit when that file holds a non-zero one.
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'printf \'GH_TOKEN=%s\\n\' "${GH_TOKEN:-unset}" >> "$HOME/gh-env"',
    'git -C "$HOME/origin.git" tag > "$HOME/origin-tags-at-gh"',
    'if [ "$1 $2" = "release view" ]; then',
    '  if [ -f "$HOME/gh-view-exit" ]; then exit "$(cat "$HOME/gh-view-exit")"; fi',
    '  if [ -f "$HOME/gh-view" ]; then cat "$HOME/gh-view"; else echo false; fi',
    '  exit 0',
    'fi',
    'if [ "$1 $2" = "release download" ]; then',
    '  tag="$3"; dir=""',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--dir" ]; then dir="$2"; fi; shift; done',
    '  if [ -f "$HOME/gh-download-exit" ] && [ "$(cat "$HOME/gh-download-exit")" != 0 ]; then exit "$(cat "$HOME/gh-download-exit")"; fi',
    '  mkdir -p "$dir"',
    '  for f in "$HOME/assets/$tag"/*; do if [ -e "$f" ]; then cp "$f" "$dir"/; fi; done',
    '  exit 0',
    'fi',
    `exit ${ghExit}`,
  ].join('\n'), { mode: 0o755 });
  rmSync(join(home, 'gh-view'), { force: true });
  rmSync(join(home, 'gh-view-exit'), { force: true });
  if (ghView.view !== undefined) writeFileSync(join(home, 'gh-view'), `${ghView.view}\n`);
  if (ghView.viewExit !== undefined) writeFileSync(join(home, 'gh-view-exit'), `${ghView.viewExit}\n`);
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "release-main tests never reach the network" >&2\nexit 97\n', { mode: 0o755 });
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [], ghExit = 0,
  extraEnv: NodeJS.ProcessEnv = {}, ghView: GhView = {}): Result {
  const bin = plantBin(home, ghExit, ghView);
  // The summary and output files are the job's, not the fixture's: a CI test
  // job would otherwise append fixture lines to its own (D-6395).
  const r = spawnSync('bash', [join(root, 'deploy', 'release-main.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '', ...extraEnv }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** prepare, then compare, then publish into one out directory — the workflow's
 *  order. publish gets a planted bundle, as the attest step would leave one. */
function pipeline(root: string, home: string, out: string, gh: GhView = {}, env: NodeJS.ProcessEnv = {}): { p: Result; c: Result; q: Result } {
  const p = run(root, home, ['prepare', '--out', out], 0, env, gh);
  const c = run(root, home, ['compare', '--out', out], 0, env, gh);
  const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home), ...env }, gh);
  return { p, c, q };
}
/** The publish job's checkout: a fresh clone of origin, so it holds origin's
 *  tags, has `main` checked out at origin's tip and carries no local candidate
 *  tag. `name` tells a second publish job's clone apart from the first. */
function publishClone(home: string, name = 'publish'): string {
  const clone = join(home, name);
  const r = spawnSync('git', ['clone', '-q', '-b', 'main', join(home, 'origin.git'), clone], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture publish clone failed: ${r.stderr}`);
  return clone;
}
/** The upload and the download: the tarball and SHA256SUMS from `out`, copied
 *  into a fresh `dir`; returns the tarball's sha256. */
function handOver(out: string, dir: string, tag: string): string {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(out, `ccrc-${tag}.tar.gz`), join(dir, `ccrc-${tag}.tar.gz`));
  copyFileSync(join(out, 'SHA256SUMS'), join(dir, 'SHA256SUMS'));
  return sha256(join(dir, `ccrc-${tag}.tar.gz`));
}
/** release-artifact.sh, run as `run()` runs release-main.sh. */
function artifact(root: string, home: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync('bash', [join(root, 'deploy', 'release-artifact.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, GITHUB_STEP_SUMMARY: '', GITHUB_OUTPUT: '', ...extraEnv }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** What the attest step leaves behind: any file — the script copies it, never reads it. */
function plantBundle(home: string): string {
  const p = join(home, 'attest-bundle.json');
  writeFileSync(p, '{"fixture":"sigstore bundle"}\n');
  return p;
}
const originTags = (home: string): string[] =>
  spawnSync('git', ['-C', join(home, 'origin.git'), 'tag'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l !== '');
const ghCalls = (home: string): string[] =>
  existsSync(join(home, 'gh-argv')) ? readFileSync(join(home, 'gh-argv'), 'utf8').split('\n').filter((l) => l !== '') : [];
const releaseCreates = (home: string): string[] => ghCalls(home).filter((l) => l.startsWith('release create '));
/** What compare asks gh: every call but the publish's. */
const ghReads = (home: string): string[] => ghCalls(home).filter((l) => !l.startsWith('release create '));
const stateOf = (out: string): string => readFileSync(join(out, 'release-main.state'), 'utf8');
const tarballsIn = (dir: string): string[] => readdirSync(dir).filter((f) => /^ccrc-.*\.tar\.gz$/.test(f));
/** The entries a fingerprint of this tarball has: everything below the root. */
const entriesIn = (tarball: string): number =>
  spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l !== '' && l !== './').length;
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** A tarball whose root holds nothing: it extracts to an empty tree. */
function emptyTarball(dest: string): void {
  const dir = mkTmp('ccrc-relmain-emptytree-');
  const r = spawnSync('tar', ['-czf', dest, '-C', dir, '.'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture tar failed: ${r.stderr}`);
}
/** Serves `tarball` as tag's release asset, with a SHA256SUMS that matches it. */
function plantAsset(home: string, tag: string, tarball: string): void {
  const dir = join(home, 'assets', tag);
  mkdirSync(dir, { recursive: true });
  copyFileSync(tarball, join(dir, `ccrc-${tag}.tar.gz`));
  writeFileSync(join(dir, 'SHA256SUMS'), `${sha256(tarball)}  ccrc-${tag}.tar.gz\n`);
}

describe('release-main.sh: refusals before anything is written', () => {
  it('refuses a dirty tree — no tag, no npm, no gh', () => {
    const home = mkTmp('ccrc-relmain-dirty-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    writeFileSync(join(root, 'straggler.txt'), 'untracked\n');
    const r = run(root, home, ['prepare']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing a dirty tree/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    // No transient tag/push either — the refusal must fire before any push
    // reaches origin at all, not merely before one that sticks (R4).
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('an unknown argument is a usage error, exit 2', () => {
    const home = mkTmp('ccrc-relmain-usage-');
    const root = fixture(home);
    const r = run(root, home, ['prepare', '--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown argument: --bogus/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('a HEAD that already carries a vX.Y.Z tag exits 0 and does nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const r = run(root, home, ['prepare']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(originTags(home).sort()).toEqual(['v0.0.1', 'v1.0.0']);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
  });

  it('refuses when origin already holds the derived tag — a tag-stale checkout (R5)', () => {
    const home = mkTmp('ccrc-relmain-stale-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    // Origin already has v0.0.2 — created directly in the bare repo, NOT in
    // the working tree, so the local checkout's tags stay behind origin's,
    // exactly the "tag-stale checkout" this guard exists for.
    const originSha = git(root, 'rev-parse', 'HEAD');
    spawnSync('git', ['-C', join(home, 'origin.git'), 'tag', 'v0.0.2', originSha], { env: { ...process.env, ...GIT_ENV } });
    const r = run(root, home, ['prepare', '--out', join(home, 'out')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/origin already holds v0\.0\.2/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });
});

describe('release-main.sh: prepare (tag locally, build), compare, then publish (push, three artifacts, --prerelease)', () => {
  it.each([
    [['v0.0.1'], 'v0.0.2'],
    [['v1.9.9', 'v1.9.10'], 'v1.9.11'],
    [['v0.0.1', 'vnext', 'v1.2', 'v1.2.3-rc1'], 'v0.0.2'],
    [[], 'v0.0.1'],
  ])('highest %j → next %s: prepare tags locally, compare decides, publish pushes and publishes', (tags, next) => {
    const home = mkTmp('ccrc-relmain-derive-');
    const root = fixture(home, { tags });
    const out = join(home, 'out');
    const prev = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop();
    const sha = git(root, 'rev-parse', 'HEAD');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code, `stderr: ${p.stderr}\nstdout: ${p.stdout}`).toBe(0);
    // Prepared: the tag is local, origin has NOT seen it, nothing was published.
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe(next);
    expect(originTags(home)).not.toContain(next);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(stateOf(out)).toBe(`built candidate\ntag ${next}\nhead ${sha}\n`);
    expect(existsSync(join(out, 'candidate', `ccrc-${next}.tar.gz`))).toBe(true);
    expect(tarballsIn(out)).toEqual([]);
    // Compared: this fixture serves no asset, so the merge cannot be compared and releases.
    const c = run(root, home, ['compare', '--out', out]);
    expect(c.code, `stderr: ${c.stderr}\nstdout: ${c.stdout}`).toBe(0);
    expect(c.stdout).toMatch(new RegExp(`^could not compare \\(.+\\); releasing ${next}\\n$`));
    expect(stateOf(out)).toBe(`built true\ntag ${next}\nhead ${sha}\n`);
    expect(existsSync(join(out, `ccrc-${next}.tar.gz`))).toBe(true);
    expect(existsSync(join(out, 'SHA256SUMS'))).toBe(true);
    const bundle = plantBundle(home);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: bundle });
    expect(q.code, `stderr: ${q.stderr}\nstdout: ${q.stdout}`).toBe(0);
    expect(originTags(home)).toContain(next);
    expect(readFileSync(join(home, 'origin-pushes'), 'utf8')).toBe(`refs/tags/${next}\n`);
    // All three artifacts NAMED, the flag trailing (the stub records `$*` as one line).
    expect(releaseCreates(home)).toEqual([
      `release create ${next} ${out}/ccrc-${next}.tar.gz ${out}/SHA256SUMS ${out}/ccrc-${next}.tar.gz.sigstore.json --verify-tag --prerelease --notes-file ${out}/release-notes.txt`,
    ]);
    // D-5548: the body says what changed since the previous release tag.
    // The fixture's commits after `prev`, newest first: the merge, then each
    // later tag's own `release <t>` commit (a tag that is not release-shaped
    // sits inside the range), then `first` when there is no previous tag.
    const later = tags.slice(prev === undefined ? 0 : tags.indexOf(prev) + 1).reverse().map((t) => `- Release ${t}`);
    expect(readFileSync(join(out, 'release-notes.txt'), 'utf8')).toBe([
      prev === undefined ? 'First release' : `Changes since ${prev}`, '',
      'Behind the scenes', '- The merge under release', ...later, ...(prev === undefined ? ['- First'] : []), '',
    ].join('\n'));
    expect(existsSync(join(out, `ccrc-${next}.tar.gz.sigstore.json`))).toBe(true);
    expect(q.stdout).toMatch(/published v[0-9.]+ as a prerelease/);
  });

  it('a notes writer that fails never stops the release: publish says so and ships an empty body (D-5548)', () => {
    const home = mkTmp('ccrc-relmain-nonotes-');
    const root = fixture(home, { tags: ['v0.0.1'], notes: false });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    expect(run(root, home, ['compare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, q.stderr).toBe(0);
    expect(q.stderr).toMatch(/could not write the release notes for v0\.0\.2 — publishing with an empty body/);
    expect(readFileSync(join(out, 'release-notes.txt'), 'utf8')).toBe('');
    expect(releaseCreates(home)[0]).toMatch(/--prerelease --notes-file \S+\/release-notes\.txt$/);
    expect(originTags(home)).toContain('v0.0.2');
  });

  it('publish pushes the tag BEFORE gh creates the release — --verify-tag needs it on origin', () => {
    const home = mkTmp('ccrc-relmain-order-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    expect(run(root, home, ['compare', '--out', out]).code).toBe(0);
    // compare's own gh calls ran before any push; the record is rewritten by each call.
    expect(originTags(home)).toEqual(['v0.0.1']);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, q.stderr).toBe(0);
    expect(readFileSync(join(home, 'origin-tags-at-gh'), 'utf8').split('\n')).toContain('v0.0.2');
  });

  it('publish without a bundle refuses, pushes nothing, keeps the local tag for a retry', () => {
    const home = mkTmp('ccrc-relmain-nobundle-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    expect(run(root, home, ['compare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/no provenance bundle .* refusing to publish an unattested release; nothing was pushed/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(releaseCreates(home)).toEqual([]);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('v0.0.2');
    // CCRC_BUNDLE_PATH naming a file that does not exist is the same refusal.
    const q2 = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: join(home, 'missing.json') });
    expect(q2.code).toBe(1);
    expect(q2.stderr).toMatch(/CCRC_BUNDLE_PATH names no file/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('publish without a prepared state is a usage error, exit 2, nothing touched', () => {
    const home = mkTmp('ccrc-relmain-nostate-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const q = run(root, home, ['publish', '--out', join(home, 'out')]);
    expect(q.code).toBe(2);
    expect(q.stderr).toMatch(/run 'release-main.sh prepare' first/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('a failed publish deletes the pushed tag from origin, so no release-less tag remains', () => {
    const home = mkTmp('ccrc-relmain-cleanup-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    expect(run(root, home, ['compare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 1, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/deleting tag v0\.0\.2 from origin/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
  });

  it('an already-tagged HEAD: prepare records built false, compare and publish do nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const out = join(home, 'out');
    const output = join(home, 'output');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(0);
    expect(p.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(stateOf(out)).toBe('built false\ntag v1.0.0\n');
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    const c = run(root, home, ['compare', '--out', out], 0, { GITHUB_OUTPUT: output });
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toMatch(/nothing to compare — HEAD was already tagged; release\.yml owns it/);
    expect(readFileSync(output, 'utf8')).toBe('release=false\n');
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(0);
    expect(q.stdout).toMatch(/nothing to publish — v1\.0\.0 was already tagged at checkout; release\.yml owns it/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('a leftover LOCAL tag from an earlier prepare is named, not mistaken for release.yml\'s', () => {
    const home = mkTmp('ccrc-relmain-leftover-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(1);
    expect(p.stderr).toMatch(/HEAD carries v0\.0\.2 which origin does not hold — a previous prepare's local tag/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('an arm is required, and only one', () => {
    const home = mkTmp('ccrc-relmain-arm-');
    const root = fixture(home);
    expect(run(root, home, []).code).toBe(2);
    expect(run(root, home, ['prepare', 'publish']).code).toBe(2);
    expect(run(root, home, ['compare', 'publish']).code).toBe(2);
  });
});

// ── W25 fix round 2: the decision is made on the built artifact ───────────────
// (D-6390, D-6392 to D-6395, D-6401, D-6408, D-6409, D-6499 to D-6501.) Every
// row runs the arms in the workflow's order into one out directory, against a
// release asset the real builder made at the base tag.
const docsOnly = (r: string): void => {
  mkdirSync(join(r, 'docs'), { recursive: true });
  writeFileSync(join(r, 'docs', 'a.md'), 'a doc\n');
  writeFileSync(join(r, 'README.md'), 'a readme\n');
};
const put = (rel: string, body = 'x\n') => (r: string): void => {
  mkdirSync(path.dirname(join(r, rel)), { recursive: true });
  writeFileSync(join(r, rel), body);
};
/** compare's one line (D-6501): no `release-main.sh:` prefix. */
const L = {
  skip: (n: number, base: string): string => `built unchanged: ${n} entries identical to ${base}`,
  differs: (base: string, k: number, first: string, next: string): string => `differs from ${base}: ${k} entries, first ${JSON.stringify(first)}; releasing ${next}`,
  cant: (why: string, next: string): string => `could not compare (${why}); releasing ${next}`,
};

describe('release-main.sh: compare — a build identical to the newest release HEAD contains cuts no release (W25 fix round 2)', () => {
  it('W25-C1: a docs-only merge skips — no tag push, no attestation input, no publish', () => {
    const home = mkTmp('ccrc-relmain-w25c1-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    const sha = git(root, 'rev-parse', 'HEAD');
    const n = entriesIn(join(home, 'assets', 'v0.0.1', 'ccrc-v0.0.1.tar.gz'));
    expect(n).toBeGreaterThan(10);
    const { p, c, q } = pipeline(root, home, out, {}, { GITHUB_STEP_SUMMARY: join(home, 'summary.md'), GITHUB_OUTPUT: join(home, 'output') });
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.skip(n, 'v0.0.1')}\n`);
    expect(readFileSync(join(home, 'summary.md'), 'utf8')).toBe(`${L.skip(n, 'v0.0.1')}\n`);
    expect(readFileSync(join(home, 'output'), 'utf8')).toBe('release=false\n');
    expect(stateOf(out)).toBe(`built unchanged\nsame-as v0.0.1\nhead ${sha}\n`);
    expect(git(root, 'tag', '--list', 'v0.0.2')).toBe('');
    expect(tarballsIn(out)).toEqual([]);
    expect(q.code, q.stderr).toBe(0);
    expect(q.stdout).toContain('release-main.sh: no release for this merge — built unchanged, the same as v0.0.1; nothing to push, attest or publish');
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(releaseCreates(home)).toEqual([]);
    // publish, as the workflow runs it after a skipped attest: CCRC_BUNDLE_PATH empty
    const q2 = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: '' });
    expect(q2.code, q2.stderr).toBe(0);
    expect(ghCalls(home).map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['release view', 'release download']);
  });

  // Each of these changes the shipped tree in one way the fingerprint must see.
  // A content change moves MANIFEST's digest line too, so K counts it, but the
  // line names the changed file, never MANIFEST while anything else differs
  // (D-6501); a mode, a link target and a build.json key leave MANIFEST alone.
  const releases: Array<[string, string, (r: string) => void, ((r: string) => void) | undefined, number, string]> = [
    ['W25-C2: a content change to a shipped file', 'c2', (r) => writeFileSync(join(r, 'ccd', 'ccrc'), '#!/usr/bin/env bash\necho changed\n', { mode: 0o755 }), undefined, 2, 'ccd/ccrc'],
    ['W25-C3: a mode-only change', 'c3', (r) => chmodSync(join(r, 'ccd', 'ccrc'), 0o644), undefined, 1, 'ccd/ccrc'],
    // The two targets are the same length, so a link whose target is dropped
    // from the fingerprint shows through the target and not through the size.
    ['W25-C4: a symlink\'s target change (targets of equal length)', 'c4', (r) => { unlinkSync(join(r, 'ccd', 'link')); symlinkSync('ccrd', join(r, 'ccd', 'link')); }, (r) => { writeFileSync(join(r, 'ccd', 'ccrd'), 'x\n'); symlinkSync('ccrc', join(r, 'ccd', 'link')); }, 1, 'ccd/link'],
    ['W25-C5: an added entry', 'c5', put('ccd/added'), undefined, 2, 'ccd/added'],
    ['W25-C6: a removed entry', 'c6', (r) => rmSync(join(r, 'ccd', 'extra')), put('ccd/extra'), 2, 'ccd/extra'],
  ];
  it.each(releases)('%s releases, and the line names what differs', (_name, id, merge, seed, k, first) => {
    const home = mkTmp(`ccrc-relmain-w25${id}-`);
    const root = fixture(home, { tags: ['v0.0.1'], merge, assets: ['v0.0.1'], ...(seed === undefined ? {} : { seed }) });
    const out = join(home, 'out');
    const sha = git(root, 'rev-parse', 'HEAD');
    const { p, c, q } = pipeline(root, home, out, {}, { GITHUB_OUTPUT: join(home, 'output') });
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.differs('v0.0.1', k, first, 'v0.0.2')}\n`);
    expect(readFileSync(join(home, 'output'), 'utf8')).toBe('release=true\ntag=v0.0.2\n');
    expect(stateOf(out)).toBe(`built true\ntag v0.0.2\nhead ${sha}\n`);
    expect(tarballsIn(out)).toEqual(['ccrc-v0.0.2.tar.gz']);
    expect(q.code, q.stderr).toBe(0);
    expect(releaseCreates(home)).toHaveLength(1);
    expect(originTags(home)).toContain('v0.0.2');
  });

  it('W25-C7: a build.json key other than the three removed ones differs — the line names "build.json"', () => {
    const home = mkTmp('ccrc-relmain-w25c7-');
    // Same content, but the base was built on another branch, so its `ref` differs.
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'], assetBranch: 'other' });
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.differs('v0.0.1', 1, 'build.json', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  it.each([
    ['both sides', true, 'the fingerprint of v0.0.1 is empty'],
    ['the candidate only', false, 'the fingerprint of the candidate is empty'],
  ])('W25-C8: an empty fingerprint is no match — %s', (_name, emptyBase, why) => {
    const home = mkTmp('ccrc-relmain-w25c8-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, ...(emptyBase ? {} : { assets: ['v0.0.1'] }) });
    const out = join(home, 'out');
    if (emptyBase) {
      const empty = join(home, 'empty.tar.gz');
      emptyTarball(empty);
      plantAsset(home, 'v0.0.1', empty);
    }
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    emptyTarball(join(out, 'candidate', 'ccrc-v0.0.2.tar.gz'));
    const c = run(root, home, ['compare', '--out', out], 0, { GITHUB_OUTPUT: join(home, 'output') });
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant(why, 'v0.0.2')}\n`);
    expect(readFileSync(join(home, 'output'), 'utf8')).toBe('release=true\ntag=v0.0.2\n');
    expect(tarballsIn(out)).toEqual(['ccrc-v0.0.2.tar.gz']);
  });

  it('W25-C9: no earlier release tag — nothing to compare against, so it releases, and gh is never asked', () => {
    const home = mkTmp('ccrc-relmain-w25c9-');
    const root = fixture(home, { tags: [], merge: docsOnly });
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('HEAD contains no earlier release tag', 'v0.0.1')}\n`);
    expect(stateOf(out)).toMatch(/^built true\ntag v0.0.1\n/);
    expect(ghReads(home)).toEqual([]);
  });

  it.each([
    [{ view: 'true' }, "v0.0.1 is not a published release (gh answered 'true')"],
    [{ viewExit: 1 }, 'gh release view v0.0.1 exited 1'],
  ])('W25-C10: a base that is a draft, or whose release cannot be viewed, releases — %j', (gh, why) => {
    const home = mkTmp('ccrc-relmain-w25c10-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out, gh);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant(why, 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
    // The view is where it stopped: the asset was never downloaded.
    expect(ghCalls(home).filter((l) => l.startsWith('release download'))).toEqual([]);
  });

  it('W25-C11: a base that HEAD does not contain is no base — an equal-content tag on a side branch releases', () => {
    const home = mkTmp('ccrc-relmain-w25c11-');
    const root = fixture(home, { tags: [], merge: docsOnly });
    // A release commit off main, which HEAD does not contain, built from the
    // same tree HEAD would build.
    git(root, 'checkout', '-q', '--detach', 'HEAD~1');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'a release cut off main');
    git(root, 'tag', 'v0.0.1');
    git(root, 'checkout', '-q', 'main');
    buildAsset(home, root, 'v0.0.1');
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('HEAD contains no earlier release tag', 'v0.0.2')}\n`);
    expect(ghReads(home)).toEqual([]);
  });

  it.each([
    ['a failed download', (home: string) => writeFileSync(join(home, 'gh-download-exit'), '1\n'), 'gh release download v0.0.1 exited 1'],
    ['a missing SHA256SUMS', (home: string) => rmSync(join(home, 'assets', 'v0.0.1', 'SHA256SUMS')), 'v0.0.1 carries no ccrc-v0.0.1.tar.gz and SHA256SUMS'],
    ['a missing tarball', (home: string) => rmSync(join(home, 'assets', 'v0.0.1', 'ccrc-v0.0.1.tar.gz')), 'v0.0.1 carries no ccrc-v0.0.1.tar.gz and SHA256SUMS'],
    ['a malformed SHA256SUMS', (home: string) => writeFileSync(join(home, 'assets', 'v0.0.1', 'SHA256SUMS'), 'junk\n'), "v0.0.1's SHA256SUMS is malformed"],
    ['a SHA256SUMS for another file name', (home: string) => writeFileSync(join(home, 'assets', 'v0.0.1', 'SHA256SUMS'), `${'a'.repeat(64)}  other.tar.gz\n`), "v0.0.1's SHA256SUMS is malformed"],
    ['two lines in SHA256SUMS', (home: string) => {
      const f = join(home, 'assets', 'v0.0.1', 'SHA256SUMS');
      writeFileSync(f, `${readFileSync(f, 'utf8')}${readFileSync(f, 'utf8')}`);
    }, "v0.0.1's SHA256SUMS is malformed"],
    ['a checksum mismatch', (home: string) => writeFileSync(join(home, 'assets', 'v0.0.1', 'SHA256SUMS'), `${'0'.repeat(64)}  ccrc-v0.0.1.tar.gz\n`), "v0.0.1's tarball does not match its SHA256SUMS"],
  ])('W25-C12: %s releases', (_name, spoil, why) => {
    const home = mkTmp('ccrc-relmain-w25c12-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    spoil(home);
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant(why, 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  it('W25-C13: a revert merge releases — its content equals an older release, not the newest one HEAD contains', () => {
    const home = mkTmp('ccrc-relmain-w25c13-');
    // v0.0.1 carries the original ccd/ccrc, v0.0.2 the merge's, and HEAD reverts to the original.
    const root = fixture(home, { tags: ['v0.0.1'] });
    git(root, 'tag', 'v0.0.2');
    writeFileSync(join(root, 'ccd', 'ccrc'), FILES['ccd/ccrc']!, { mode: 0o755 });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'revert the merge');
    buildAsset(home, root, 'v0.0.1');
    buildAsset(home, root, 'v0.0.2');
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.differs('v0.0.2', 2, 'ccd/ccrc', 'v0.0.3')}\n`);
    expect(stateOf(out)).toMatch(/^built true\ntag v0.0.3\n/);
  });

  it('W25-C14: a changed release-main.yml releases whatever the build says, and gh is never asked', () => {
    const home = mkTmp('ccrc-relmain-w25c14-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: put('.github/workflows/release-main.yml', '# a changed workflow\n'), assets: ['v0.0.1'] });
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('v0.0.1..HEAD changes ".github/workflows/release-main.yml", which judges this comparison', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
    expect(ghReads(home)).toEqual([]);
  });

  it('W25-C14b: a changed release-main.sh releases too', () => {
    const home = mkTmp('ccrc-relmain-w25c14b-');
    const merge = (r: string): void => {
      writeFileSync(join(r, 'deploy', 'release-main.sh'), `${readFileSync(join(r, 'deploy', 'release-main.sh'), 'utf8')}# a later edit\n`, { mode: 0o755 });
    };
    const root = fixture(home, { tags: ['v0.0.1'], assets: ['v0.0.1'] });
    merge(root);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'edit the compare script');
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('v0.0.1..HEAD changes "deploy/release-main.sh", which judges this comparison', 'v0.0.2')}\n`);
    expect(ghReads(home)).toEqual([]);
  });

  it('W25-C15: compare\'s gh calls carry GH_TOKEN, and prepare runs no gh', () => {
    const home = mkTmp('ccrc-relmain-w25c15-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    const env = { GH_TOKEN: 'fixture-token' };
    expect(run(root, home, ['prepare', '--out', out], 0, env).code).toBe(0);
    expect(existsSync(join(home, 'gh-env'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    const c = run(root, home, ['compare', '--out', out], 0, env);
    expect(c.code, c.stderr).toBe(0);
    expect(readFileSync(join(home, 'gh-env'), 'utf8')).toBe('GH_TOKEN=fixture-token\nGH_TOKEN=fixture-token\n');
    expect(ghCalls(home)).toHaveLength(2);
  });

  it('W25-C16: each state is bound to the HEAD it was measured for', () => {
    const home = mkTmp('ccrc-relmain-w25c16-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    // a commit after prepare: compare dies, and asks gh nothing
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    writeFileSync(join(root, 'docs', 'b.md'), 'later\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'a later commit');
    const c = run(root, home, ['compare', '--out', out]);
    expect(c.code).toBe(1);
    expect(c.stderr).toMatch(/release-main\.state was measured for [0-9a-f]{40}, not HEAD [0-9a-f]{40} — re-run prepare/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    // a commit after a skipping compare: publish dies, and pushes nothing
    const home2 = mkTmp('ccrc-relmain-w25c16b-');
    const root2 = fixture(home2, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out2 = join(home2, 'out');
    expect(run(root2, home2, ['prepare', '--out', out2]).code).toBe(0);
    expect(run(root2, home2, ['compare', '--out', out2]).code).toBe(0);
    expect(stateOf(out2)).toMatch(/^built unchanged\n/);
    writeFileSync(join(root2, 'docs', 'b.md'), 'later\n');
    git(root2, 'add', '-A');
    git(root2, 'commit', '-q', '-m', 'a later commit');
    const q = run(root2, home2, ['publish', '--out', out2]);
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/was measured for [0-9a-f]{40}, not HEAD [0-9a-f]{40}/);
    expect(existsSync(join(home2, 'origin-pushes'))).toBe(false);
    expect(releaseCreates(home2)).toEqual([]);
  });

  it('W25-C16b: a skip whose same-as tag HEAD does not contain, or whose shape is wrong, is refused by publish', () => {
    const home = mkTmp('ccrc-relmain-w25c16c-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    mkdirSync(out, { recursive: true });
    const sha = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(out, 'release-main.state'), `built unchanged\nsame-as junk\nhead ${sha}\n`);
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/malformed .*release-main\.state/);
    git(root, 'checkout', '-q', '--detach', 'HEAD~1');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'off main');
    git(root, 'tag', 'v0.0.9');
    git(root, 'checkout', '-q', 'main');
    writeFileSync(join(out, 'release-main.state'), `built unchanged\nsame-as v0.0.9\nhead ${sha}\n`);
    const q2 = run(root, home, ['publish', '--out', out]);
    expect(q2.code).toBe(1);
    expect(q2.stderr).toMatch(/names v0\.0\.9 as the unchanged base, and HEAD does not contain it/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it('W25-C17: publish refuses a build compare never decided on — no push, no gh', () => {
    const home = mkTmp('ccrc-relmain-w25c17-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code).toBe(1);
    expect(q.stderr).toContain('release-main.sh: compare never decided on v0.0.2 — refusing to publish an undecided build; nothing was pushed');
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('W25-C18: the attest tripwire — a tarball already in the out directory refuses prepare before a tag or a build', () => {
    const home = mkTmp('ccrc-relmain-w25c18-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'ccrc-v0.0.1.tar.gz'), 'planted\n');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(1);
    expect(p.stderr).toMatch(/a tarball is already in .* — the attest step would sign an artifact no release publishes/);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(existsSync(join(out, 'release-main.state'))).toBe(false);
  });

  it('W25-C19: an unwritable summary or output file never fails compare and prints no shell error', () => {
    const home = mkTmp('ccrc-relmain-w25c19-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    // A directory cannot be appended to: the summary and the step's output file are both unwritable.
    const c = run(root, home, ['compare', '--out', out], 0, { GITHUB_STEP_SUMMARY: home, GITHUB_OUTPUT: home });
    expect(c.code).toBe(0);
    expect(c.stdout).toMatch(/^built unchanged: \d+ entries identical to v0\.0\.1\n$/);
    expect(c.stderr).toBe('');
    expect(stateOf(out)).toMatch(/^built unchanged\nsame-as v0\.0\.1\n/);
  });

  it.each([
    ['an array', '[]'],
    ['a string', '"x"'],
    ['null', 'null'],
    ['an object without version', '{"sha":"x","builtAt":"y"}'],
    ['not JSON', 'not json'],
  ])('W25-C20: a build.json that is %s releases — the candidate\'s fingerprint failed', (_name, body) => {
    const home = mkTmp('ccrc-relmain-w25c20-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    // Re-pack the candidate with the damaged build.json.
    const cand = join(out, 'candidate', 'ccrc-v0.0.2.tar.gz');
    const tree = join(home, 'candidate-tree');
    mkdirSync(tree, { recursive: true });
    expect(spawnSync('tar', ['-xzf', cand, '-C', tree]).status).toBe(0);
    writeFileSync(join(tree, 'build.json'), `${body}\n`);
    expect(spawnSync('tar', ['-czf', cand, '-C', tree, '.']).status).toBe(0);
    const c = run(root, home, ['compare', '--out', out]);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('the fingerprint of the candidate failed', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  it.each([['decide', ['decide']], ['measure', ['measure', '--base', 'v0.0.1']], ['--base', ['prepare', '--base', 'v0.0.1']]] as const)(
    'W25-C21: the retired %s is a usage error, exit 2', (_name, args) => {
      const home = mkTmp('ccrc-relmain-w25c21-');
      const root = fixture(home, { tags: ['v0.0.1'] });
      const r = run(root, home, [...args]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/unknown argument/);
      expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    });

  it.each([
    ['a docs-only merge, which skips', docsOnly, 'built unchanged'],
    ['a shipped merge, which releases', undefined, 'built true'],
  ] as const)('W25-C22: --out inside the checkout (the workflow\'s release-out) builds, compares and publishes; %s', (_name, merge, state) => {
    const home = mkTmp('ccrc-relmain-w25c22-');
    const root = fixture(home, { tags: ['v0.0.1'], assets: ['v0.0.1'], ...(merge === undefined ? {} : { merge }) });
    const { p, c, q } = pipeline(root, home, 'release-out');
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(q.code, q.stderr).toBe(0);
    expect(readFileSync(join(root, 'release-out', 'release-main.state'), 'utf8')).toMatch(new RegExp(`^${state}\\n`));
  });

  it('W25-C23: monotonic — a skipped docs merge, then a code merge, releases both in one release', () => {
    const home = mkTmp('ccrc-relmain-w25c23-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const first = pipeline(root, home, join(home, 'out1'));
    expect(stateOf(join(home, 'out1'))).toMatch(/^built unchanged\n/);
    expect(first.q.code, first.q.stderr).toBe(0);
    writeFileSync(join(root, 'ccd', 'ccrc'), '#!/usr/bin/env bash\necho the code\n', { mode: 0o755 });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'the code merge after');
    const out2 = join(home, 'out2');
    const second = pipeline(root, home, out2);
    expect(second.c.code, second.c.stderr).toBe(0);
    expect(second.c.stdout).toBe(`${L.differs('v0.0.1', 2, 'ccd/ccrc', 'v0.0.2')}\n`);
    expect(second.q.code, second.q.stderr).toBe(0);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('v0.0.2');
    const notes = readFileSync(join(out2, 'release-notes.txt'), 'utf8');
    expect(notes).toContain('- The code merge after');
    expect(notes).toContain('- The merge under release');
  });

  it('W25-C24: a directory whose mode alone differs releases, and the line names that directory', () => {
    const home = mkTmp('ccrc-relmain-w25c24-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    // The stub npm re-modes one built directory when this file exists. It is
    // written after the base asset was built, so only HEAD's candidate has it.
    writeFileSync(join(home, 'dist-mode'), '750\n');
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.differs('v0.0.1', 1, 'server/dist/server', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  it('W25-C25: a nested build.json whose sha differs releases — only the top-level one is normalised', () => {
    const home = mkTmp('ccrc-relmain-w25c25-');
    const nested = (sha: string) => put('ccd/sub/build.json', `{"sha":"${sha}","builtAt":"t","version":"v"}\n`);
    const root = fixture(home, { tags: ['v0.0.1'], seed: nested('a'), merge: nested('b'), assets: ['v0.0.1'] });
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    // MANIFEST's digest line for the nested file moves too: two entries, and the line names the file.
    expect(c.stdout).toBe(`${L.differs('v0.0.1', 2, 'ccd/sub/build.json', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  /** Both sides carry a tree of one file and no build.json or MANIFEST, byte for byte equal. */
  function plantBareTrees(home: string, out: string): void {
    const tree = mkTmp('ccrc-relmain-bare-');
    mkdirSync(join(tree, 'ccd'), { recursive: true });
    writeFileSync(join(tree, 'ccd', 'x'), 'x\n');
    const bare = join(home, 'bare.tar.gz');
    expect(spawnSync('tar', ['-czf', bare, '-C', tree, '.']).status).toBe(0);
    plantAsset(home, 'v0.0.1', bare);
    copyFileSync(bare, join(out, 'candidate', 'ccrc-v0.0.2.tar.gz'));
  }
  it('W25-C26: trees with entries but no top-level build.json and MANIFEST have no fingerprint — they release, and never match', () => {
    const home = mkTmp('ccrc-relmain-w25c26-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    plantBareTrees(home, out);
    const c = run(root, home, ['compare', '--out', out], 0, { GITHUB_OUTPUT: join(home, 'output') });
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('the fingerprint of v0.0.1 failed', 'v0.0.2')}\n`);
    expect(readFileSync(join(home, 'output'), 'utf8')).toBe('release=true\ntag=v0.0.2\n');
  });

  it.each([
    ['no build.json line', (lines: string[]) => lines.filter((l) => !l.endsWith('  build.json'))],
    ['two build.json lines', (lines: string[]) => [...lines, ...lines.filter((l) => l.endsWith('  build.json'))]],
  ])('W25-C27: a base MANIFEST with %s releases — the base has no fingerprint', (_name, edit) => {
    const home = mkTmp('ccrc-relmain-w25c27-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    // Re-pack the base asset with the damaged MANIFEST, under a matching SHA256SUMS.
    const tree = join(home, 'base-tree');
    mkdirSync(tree, { recursive: true });
    const asset = join(home, 'assets', 'v0.0.1', 'ccrc-v0.0.1.tar.gz');
    expect(spawnSync('tar', ['-xpzf', asset, '-C', tree]).status).toBe(0);
    const lines = readFileSync(join(tree, 'MANIFEST'), 'utf8').split('\n');
    expect(lines.filter((l) => l.endsWith('  build.json'))).toHaveLength(1);
    writeFileSync(join(tree, 'MANIFEST'), edit(lines).join('\n'));
    const repacked = join(home, 'repacked.tar.gz');
    expect(spawnSync('tar', ['-czf', repacked, '-C', tree, '.']).status).toBe(0);
    plantAsset(home, 'v0.0.1', repacked);
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('the fingerprint of v0.0.1 failed', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  it('W25-C28: a HEAD a later release already contains is a re-run of an older merge — nothing is built, tagged, pushed or asked of gh (D-6502)', () => {
    const home = mkTmp('ccrc-relmain-w25c28-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const sha = git(root, 'rev-parse', 'HEAD');
    // A later merge was released first (v0.0.5 sits on its descendant); the
    // older merge's run starts now, on a detached checkout of its commit.
    git(root, 'commit', '-q', '--allow-empty', '-m', 'a later merge');
    git(root, 'tag', 'v0.0.5');
    git(root, 'checkout', '-q', '--detach', sha);
    const out = join(home, 'out');
    const outFile = join(home, 'output');
    const { p, c, q } = pipeline(root, home, out, {}, { GITHUB_OUTPUT: outFile });
    expect(p.code, p.stderr).toBe(0);
    expect(p.stdout).toContain('release-main.sh: HEAD is already contained in v0.0.5 — a re-run of an older merge; nothing to build');
    expect(stateOf(out)).toBe(`built contained\ncontained-by v0.0.5\nhead ${sha}\n`);
    expect(git(root, 'tag', '--list').split('\n')).toEqual(['v0.0.1', 'v0.0.5']);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(existsSync(join(out, 'candidate'))).toBe(false);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe('release-main.sh: nothing to compare — HEAD is already contained in v0.0.5\n');
    expect(readFileSync(outFile, 'utf8')).toBe('release=false\n');
    expect(q.code, q.stderr).toBe(0);
    expect(q.stdout).toBe('release-main.sh: nothing to publish — HEAD is already contained in v0.0.5\n');
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(tarballsIn(out)).toEqual([]);
    // the state is bound to its HEAD: a later commit makes publish die
    git(root, 'checkout', '-q', '-B', 'rerun');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'after the state');
    const late = run(root, home, ['publish', '--out', out]);
    expect(late.code).toBe(1);
    expect(late.stderr).toMatch(/was measured for [0-9a-f]{40}, not HEAD [0-9a-f]{40}/);
  });

  /** PATH for a run with stub commands first, then the fixture's bin (the run re-plants it). */
  function stubbed(home: string, stubs: Record<string, string>): NodeJS.ProcessEnv {
    const dir = join(home, 'stubs');
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(stubs)) writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return { PATH: `${dir}:${join(home, 'bin')}:${process.env.PATH ?? ''}` };
  }
  /** What the stub npm reads for the asset builds, which run under their own HOME. */
  function baseNpm(home: string, file: string, body: string): void {
    mkdirSync(join(home, 'asset-home'), { recursive: true });
    writeFileSync(join(home, 'asset-home', file), `${body}\n`);
  }

  it('W25-C29: a link retargeted between two byte-identical shipped files releases, and the line names the link (the walk never follows a link)', () => {
    const home = mkTmp('ccrc-relmain-w25c29-');
    const twins = (r: string): void => {
      writeFileSync(join(r, 'ccd', 'twin-a'), 'same bytes\n');
      writeFileSync(join(r, 'ccd', 'twin-b'), 'same bytes\n');
      symlinkSync('twin-a', join(r, 'ccd', 'twin-link'));
    };
    const retarget = (r: string): void => { unlinkSync(join(r, 'ccd', 'twin-link')); symlinkSync('twin-b', join(r, 'ccd', 'twin-link')); };
    const root = fixture(home, { tags: ['v0.0.1'], seed: twins, merge: retarget, assets: ['v0.0.1'] });
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.differs('v0.0.1', 1, 'ccd/twin-link', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  // Git does not track these bits, so the stub npm makes them: the base asset
  // is built at 755 (its own HOME), the candidate at the special mode.
  const specialMode = (_name: string, file: string, mode: string, first: string): void => {
    const home = mkTmp('ccrc-relmain-w25c30-');
    baseNpm(home, file, '755');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    writeFileSync(join(home, file), `${mode}\n`);
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.differs('v0.0.1', 1, first, 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  };
  // Not on macOS (D-6583): compare's plain `tar` there is BSD tar (libarchive),
  // whose -p restores a setuid bit only when the new file's owner matches the
  // archive's (uid 0, from --owner=0), so as a non-root runner both trees
  // extract at 755 and the case cannot tell them apart. The release lane runs
  // on ubuntu-latest, with GNU tar, which keeps the bit.
  it.skipIf(process.platform === 'darwin').each([
    ['a setuid file (755 to 4755)', 'dist-file-mode', '4755', 'server/dist/server/src/index.js'],
  ])('W25-C30: %s releases, and the line names it', specialMode);
  it.each([
    ['a sticky directory (755 to 1755)', 'dist-mode', '1755', 'server/dist/server'],
  ])('W25-C30: %s releases, and the line names it', specialMode);

  it('W25-C31: a mode change on a dot-named entry alone releases, and the line names it', () => {
    const home = mkTmp('ccrc-relmain-w25c31-');
    baseNpm(home, 'dot-mode', '755');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    writeFileSync(join(home, 'dot-mode'), '700\n');
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.differs('v0.0.1', 1, 'server/dist-pwa/.vite', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  it('W25-C32: a git diff against the base that fails releases — a failed guard is not an empty one', () => {
    const home = mkTmp('ccrc-relmain-w25c32-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    expect(realGit).toMatch(/^\//);
    // Fails only the guard's `diff --name-only`; every other git call runs for real.
    const env = stubbed(home, { git: `case " $* " in *" diff "*) case " $* " in *" --name-only "*) exit 128 ;; esac ;; esac\nexec "${realGit}" "$@"` });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const c = run(root, home, ['compare', '--out', out], 0, env);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('git diff against v0.0.1 failed', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
    expect(ghReads(home)).toEqual([]);
  });

  it('W25-C33: a judge change older than HEAD~1 still releases — the guard reads the whole range from the base', () => {
    const home = mkTmp('ccrc-relmain-w25c33-');
    const root = fixture(home, {
      tags: ['v0.0.1'], assets: ['v0.0.1'],
      merge: put('.github/workflows/release-main.yml', '# a changed workflow\n'), after: docsOnly,
    });
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out);
    expect(p.code, p.stderr).toBe(0);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('v0.0.1..HEAD changes ".github/workflows/release-main.yml", which judges this comparison', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
    expect(ghReads(home)).toEqual([]);
  });

  // A tag that is not release-shaped is no release: it never makes HEAD "contained".
  it.each([
    ['vnext', 'on HEAD'], ['v1.2.3-rc1', 'on HEAD'], ['vnext', 'on a descendant'], ['v1.2.3-rc1', 'on a descendant'],
  ])('W25-C34: %s %s is not a release, so prepare builds a candidate and compare decides', (name, where) => {
    const home = mkTmp('ccrc-relmain-w25c34-');
    const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'], ...(where === 'on HEAD' ? { tagHead: name } : {}) });
    const sha = git(root, 'rev-parse', 'HEAD');
    if (where !== 'on HEAD') {
      git(root, 'commit', '-q', '--allow-empty', '-m', 'a later merge');
      git(root, 'tag', name);
      // Back on branch main (the base asset's ref), so build.json agrees.
      git(root, 'checkout', '-q', '-B', 'main', sha);
    }
    const n = entriesIn(join(home, 'assets', 'v0.0.1', 'ccrc-v0.0.1.tar.gz'));
    const out = join(home, 'out');
    const { p, c } = pipeline(root, home, out, {}, { GITHUB_OUTPUT: join(home, 'output') });
    expect(p.code, p.stderr).toBe(0);
    expect(p.stdout).not.toContain('already contained');
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.skip(n, 'v0.0.1')}\n`);
    expect(stateOf(out)).toBe(`built unchanged\nsame-as v0.0.1\nhead ${sha}\n`);
    expect(readFileSync(join(home, 'output'), 'utf8')).toBe('release=false\n');
    expect(ghReads(home)).toHaveLength(2);
  });

  // Three shapes of a listing that cannot be trusted all release: one that
  // fails (rc), one that exits 0 with nothing to show (awk then prints a bare
  // TAB, which the shape check refuses), and one that prints a well-formed
  // line yet exits 1 (the shape check accepts it, so only the rc half refuses).
  it.each([
    ['comm exits 1', 'exit 1'], ['comm exits 0 and prints nothing', 'exit 0'],
    ['comm prints one well-formed line and exits 1', "printf '\"ccd/ccrc\"\\tx\\n'; exit 1"],
  ])('W25-C35: a difference that cannot be listed releases with that reason — the line is never empty (%s)', (_name, body) => {
    const home = mkTmp('ccrc-relmain-w25c35-');
    const root = fixture(home, { tags: ['v0.0.1'], assets: ['v0.0.1'] });
    const env = stubbed(home, { comm: body });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const c = run(root, home, ['compare', '--out', out], 0, env);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant('the fingerprints differ, and listing how failed', 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  // A tar that extracts every entry but the one the merge changed, then exits
  // 2. Planted on one side's extraction only (told apart by the archive's
  // path); every other tar call, the build's included, runs for real.
  it.each([
    ['the base', '/asset/', "could not extract v0.0.1's tarball"],
    ['the candidate', '/candidate/', 'could not extract the candidate'],
  ])('W25-C37: a partial extraction of %s that exits non-zero releases with that reason — a short tree is never compared', (_name, side, reason) => {
    const home = mkTmp('ccrc-relmain-w25c37-');
    const root = fixture(home, { tags: ['v0.0.1'], assets: ['v0.0.1'], merge: (r) => chmodSync(join(r, 'ccd', 'ccrc'), 0o644) });
    const realTar = spawnSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
    expect(realTar).toMatch(/^\//);
    const env = stubbed(home, {
      tar: `case " $* " in *" -xpzf "*"${side}"*) "${realTar}" "$@" --exclude=./ccd/ccrc --exclude=ccd/ccrc; exit 2 ;; esac\nexec "${realTar}" "$@"`,
    });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const c = run(root, home, ['compare', '--out', out], 0, env);
    expect(c.code, c.stderr).toBe(0);
    expect(c.stdout).toBe(`${L.cant(reason, 'v0.0.2')}\n`);
    expect(stateOf(out)).toMatch(/^built true\n/);
  });

  it.each([[''], ['null'], ['garbage']])(
    'W25-C36: a gh view that answers exit 0 with %j is no proof of a published release — it releases',
    (answer) => {
      const home = mkTmp('ccrc-relmain-w25c36-');
      const root = fixture(home, { tags: ['v0.0.1'], merge: docsOnly, assets: ['v0.0.1'] });
      const out = join(home, 'out');
      const { p, c } = pipeline(root, home, out, { view: answer });
      expect(p.code, p.stderr).toBe(0);
      expect(c.code, c.stderr).toBe(0);
      expect(c.stdout).toBe(`${L.cant(`v0.0.1 is not a published release (gh answered '${answer}')`, 'v0.0.2')}\n`);
      expect(stateOf(out)).toMatch(/^built true\n/);
      expect(ghCalls(home).filter((l) => l.startsWith('release download'))).toEqual([]);
    });

  // The build job's outputs (D-6658): a release hands the publish job its tag in
  // the same append as the decision; every other outcome writes the one word.
  const outcomes: Array<[string, { merge?: (r: string) => void; assets?: string[]; tagHead?: string }, boolean, string]> = [
    ['a release', {}, false, 'release=true\ntag=v0.0.2\n'],
    ['a skip', { merge: docsOnly, assets: ['v0.0.1'] }, false, 'release=false\n'],
    ['an already-tagged HEAD', { tagHead: 'v1.0.0' }, false, 'release=false\n'],
    ['a HEAD a later release contains', {}, true, 'release=false\n'],
  ];
  it.each(outcomes)('W26-C1: compare\'s output for %s', (_name, opts, contained, want) => {
    const home = mkTmp('ccrc-relmain-w26c1-');
    const root = fixture(home, { tags: ['v0.0.1'], ...opts });
    if (contained) {
      // W25-C28's shape: a later merge was released first.
      const sha = git(root, 'rev-parse', 'HEAD');
      git(root, 'commit', '-q', '--allow-empty', '-m', 'a later merge');
      git(root, 'tag', 'v0.0.5');
      git(root, 'checkout', '-q', '--detach', sha);
    }
    const out = join(home, 'out');
    const output = join(home, 'output');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const c = run(root, home, ['compare', '--out', out], 0, { GITHUB_OUTPUT: output });
    expect(c.code, c.stderr).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(want);
  });
});

// ── W26: the publish job re-proves the build's artifact (D-6649, D-6656 to D-6658, D-6662)
// The build job (prepare, compare, record) runs in the fixture repo; the
// publish job (receive, then publish) runs in a fresh clone of origin, with only
// the hand-over directory and the tag and digest between them.
const RECEIVED = (tag: string, digest: string): string =>
  `release-main.sh: received ${tag} from the build job (sha256 ${digest}) — tagged locally (NOT pushed); next: attest, then publish\n`;
const tarballsUnder = (dir: string): string[] => existsSync(dir) ? tarballsIn(dir) : [];

describe('release-main.sh: receive — the publish job re-derives the tag and verifies the build\'s artifact before any write (W26)', () => {
  interface Built { root: string; out: string; handed: string; digest: string; sha: string }
  /** The build job: prepare, compare (a release: the fixture serves no base
   *  asset), record; then the hand-over into `<home>/handed`. The publish job
   *  runs on another machine, so the build job's gh record is cleared. */
  function buildHalf(home: string): Built {
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const c = run(root, home, ['compare', '--out', out]);
    expect(c.code, c.stderr).toBe(0);
    expect(stateOf(out)).toMatch(/^built true\ntag v0\.0\.2\n/);
    const output = join(home, 'record-output');
    const rec = artifact(root, home, ['record', '--tag', 'v0.0.2', '--dir', out], { GITHUB_OUTPUT: output });
    expect(rec.code, rec.stderr).toBe(0);
    const handed = join(home, 'handed');
    const digest = handOver(out, handed, 'v0.0.2');
    expect(readFileSync(output, 'utf8')).toBe(`digest=${digest}\n`);
    rmSync(join(home, 'gh-argv'), { force: true });
    rmSync(join(home, 'gh-env'), { force: true });
    return { root, out, handed, digest, sha: git(root, 'rev-parse', 'HEAD') };
  }
  const receive = (clone: string, home: string, handed: string, tag: string, digest: string, out = 'release-out'): Result =>
    run(clone, home, ['receive', '--in', handed, '--tag', tag, '--digest', digest, '--out', out]);

  it('W26-R1: the two-job pipeline — receive tags locally and leaves compare\'s state; publish pushes and publishes the received files', () => {
    const home = mkTmp('ccrc-relmain-w26r1-');
    const { handed, digest, sha } = buildHalf(home);
    expect(originTags(home)).not.toContain('v0.0.2');
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    const clone = publishClone(home);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(sha);
    expect(git(clone, 'tag', '--points-at', 'HEAD')).toBe('');
    const r = receive(clone, home, handed, 'v0.0.2', digest);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(RECEIVED('v0.0.2', digest));
    expect(git(clone, 'tag', '--points-at', 'HEAD')).toBe('v0.0.2');
    expect(stateOf(join(clone, 'release-out'))).toBe(`built true\ntag v0.0.2\nhead ${sha}\n`);
    expect(sha256(join(clone, 'release-out', 'ccrc-v0.0.2.tar.gz'))).toBe(digest);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    const q = run(clone, home, ['publish', '--out', 'release-out'], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, `stderr: ${q.stderr}\nstdout: ${q.stdout}`).toBe(0);
    expect(originTags(home)).toContain('v0.0.2');
    expect(readFileSync(join(home, 'origin-pushes'), 'utf8')).toBe('refs/tags/v0.0.2\n');
    expect(releaseCreates(home)).toEqual([
      'release create v0.0.2 release-out/ccrc-v0.0.2.tar.gz release-out/SHA256SUMS release-out/ccrc-v0.0.2.tar.gz.sigstore.json --verify-tag --prerelease --notes-file release-out/release-notes.txt',
    ]);
    expect(readFileSync(join(clone, 'release-out', 'release-notes.txt'), 'utf8')).toBe([
      'Changes since v0.0.1', '', 'Behind the scenes', '- The merge under release', '',
    ].join('\n'));
  });

  it('W26-R2: a release tag that reaches origin between the two jobs — receive refuses, tags nothing, pushes nothing (D-6662)', () => {
    const home = mkTmp('ccrc-relmain-w26r2-');
    const { root, handed, digest } = buildHalf(home);
    // Another run's v0.0.2 lands on origin, on an earlier commit, after the build job derived its own.
    spawnSync('git', ['-C', join(home, 'origin.git'), 'tag', 'v0.0.2', git(root, 'rev-parse', 'HEAD~1')], { env: { ...process.env, ...GIT_ENV } });
    rmSync(join(home, 'origin-pushes'), { force: true });
    const clone = publishClone(home);
    const r = receive(clone, home, handed, 'v0.0.2', digest);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('release-main.sh: the build job derived v0.0.2; this checkout derives v0.0.3 — a release tag reached origin between the two jobs; re-run all jobs; nothing was tagged or pushed');
    expect(git(clone, 'tag', '--points-at', 'HEAD')).toBe('');
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(tarballsUnder(join(clone, 'release-out'))).toEqual([]);
  });

  it('W26-R3: a digest of another file — verify\'s hash reason, then "did not verify"; nothing tagged', () => {
    const home = mkTmp('ccrc-relmain-w26r3-');
    const { handed, digest } = buildHalf(home);
    const other = sha256(join(handed, 'SHA256SUMS'));
    expect(other).not.toBe(digest);
    const clone = publishClone(home);
    const r = receive(clone, home, handed, 'v0.0.2', other);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`release-artifact.sh: ccrc-v0.0.2.tar.gz hashes to ${digest}, not the ${other} the build job recorded`);
    expect(r.stderr).toContain('release-main.sh: the build\'s artifact did not verify; nothing was tagged or pushed');
    expect(git(clone, 'tag', '--points-at', 'HEAD')).toBe('');
    expect(tarballsUnder(join(clone, 'release-out'))).toEqual([]);
    expect(existsSync(join(clone, 'release-out', 'release-main.state'))).toBe(false);
  });

  it('W26-R4: a HEAD that already carries a release tag on origin — receive refuses', () => {
    const home = mkTmp('ccrc-relmain-w26r4-');
    fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const clone = publishClone(home);
    const r = receive(clone, home, join(home, 'handed'), 'v1.0.1', 'a'.repeat(64));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('release-main.sh: HEAD already carries v1.0.0 — it was published already, or release.yml owns it; nothing was tagged or pushed');
    expect(git(clone, 'tag', '--points-at', 'HEAD')).toBe('v1.0.0');
    expect(existsSync(join(clone, 'release-out'))).toBe(false);
  });

  it('W26-R5: a HEAD a later release tag contains — a re-run of an older merge; receive refuses', () => {
    const home = mkTmp('ccrc-relmain-w26r5-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    // A later merge was released first: v0.0.5 reaches origin on a descendant
    // of origin's main, which stays at the older merge.
    git(root, 'commit', '-q', '--allow-empty', '-m', 'a later merge');
    git(root, 'tag', 'v0.0.5');
    git(root, 'push', '-q', 'origin', 'refs/tags/v0.0.5');
    rmSync(join(home, 'origin-pushes'), { force: true });
    const clone = publishClone(home);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(git(root, 'rev-parse', 'HEAD~1'));
    const r = receive(clone, home, join(home, 'handed'), 'v0.0.6', 'a'.repeat(64));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('release-main.sh: HEAD is already contained in v0.0.5 — a re-run of an older merge; nothing was tagged or pushed');
    expect(git(clone, 'tag', '--points-at', 'HEAD')).toBe('');
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  const DIRTY = 'release-main.sh: refusing a dirty tree — a release is built from a commit; commit or stash, then re-run (git status --porcelain is non-empty); nothing was tagged or pushed';
  const FILLED = (out: string): string => `release-main.sh: ${out} already holds a state or a tarball — receive runs once, into an empty out directory; nothing was tagged or pushed`;
  // D-6656: in the workflow, release-out lies inside the checkout and is not
  // gitignored, so the dirty check is what catches a pre-filled one; the
  // out-directory check catches one outside the tree.
  it.each([
    ['a dirty publish clone', 'outside', null, true, 'dirty'],
    ['an out directory outside the clone holding a state', 'outside', 'release-main.state', false, 'filled'],
    ['an out directory outside the clone holding a tarball', 'outside', 'ccrc-v0.0.1.tar.gz', false, 'filled'],
    ['the in-clone release-out holding a state', 'inside', 'release-main.state', false, 'dirty'],
  ] as const)('W26-R6: %s — receive refuses before any write', (_name, where, plant, dirty, why) => {
    const home = mkTmp('ccrc-relmain-w26r6-');
    fixture(home, { tags: ['v0.0.1'] });
    const clone = publishClone(home);
    const out = where === 'outside' ? join(home, 'out') : join(clone, 'release-out');
    if (plant !== null) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, plant), 'planted\n');
    }
    if (dirty) writeFileSync(join(clone, 'straggler.txt'), 'untracked\n');
    const r = receive(clone, home, join(home, 'handed'), 'v0.0.2', 'a'.repeat(64), out);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(why === 'dirty' ? DIRTY : FILLED(out));
    expect(git(clone, 'tag', '--points-at', 'HEAD')).toBe('');
    if (plant !== null) expect(readFileSync(join(out, plant), 'utf8')).toBe('planted\n');
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
  });

  it.each([
    ['prepare --tag', ['prepare', '--tag', 'v0.0.2']],
    ['publish --in', ['publish', '--in', 'x']],
    ['compare --digest', ['compare', '--digest', 'a'.repeat(64)]],
    ['receive without --in', ['receive', '--tag', 'v0.0.2', '--digest', 'a'.repeat(64)]],
    ['receive without --tag', ['receive', '--in', 'x', '--digest', 'a'.repeat(64)]],
    ['receive without --digest', ['receive', '--in', 'x', '--tag', 'v0.0.2']],
  ] as const)('W26-R7: %s is a usage error, exit 2', (_name, args) => {
    const home = mkTmp('ccrc-relmain-w26r7-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const r = run(root, home, [...args]);
    expect(r.code, r.stderr).toBe(2);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('W26-R9: re-running only the failed publish job — a fresh clone receives the same hand-over and publishes the same tag', () => {
    const home = mkTmp('ccrc-relmain-w26r9-');
    const { handed, digest } = buildHalf(home);
    const first = publishClone(home);
    expect(receive(first, home, handed, 'v0.0.2', digest).code).toBe(0);
    const q1 = run(first, home, ['publish', '--out', 'release-out'], 1, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q1.code).toBe(1);
    expect(q1.stderr).toMatch(/deleting tag v0\.0\.2 from origin/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    const second = publishClone(home, 'publish-rerun');
    const r = receive(second, home, handed, 'v0.0.2', digest);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(RECEIVED('v0.0.2', digest));
    const q2 = run(second, home, ['publish', '--out', 'release-out'], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q2.code, q2.stderr).toBe(0);
    expect(originTags(home).filter((t) => t === 'v0.0.2')).toEqual(['v0.0.2']);
    expect(releaseCreates(home)).toHaveLength(2);
    expect(git(second, 'tag', '--points-at', 'HEAD')).toBe('v0.0.2');
  });
});

describe('release-main.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  const fn = (name: string): string => new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(src())?.[0] ?? '';
  it('runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });
  it('builds through build-release.sh and owns no second build path', () => {
    expect(src()).not.toMatch(/npm ci|npm run/);
  });
  it('names all three artifacts to gh rather than globbing, and publishes a PRERELEASE (design §4, §18 rows 1 and 7)', () => {
    expect(src()).toContain('"$tarball" "$sums" "$bundle" --verify-tag --prerelease');
  });
  it('hands gh the notes as a FILE, written by release-notes.mjs — commit text never reaches a command line (D-5548)', () => {
    expect(src()).toContain('--verify-tag --prerelease --notes-file "$notes"');
    expect(src()).toContain('node "$ROOT/deploy/release-notes.mjs" --repo "$ROOT" --tag "$tag" --out "$notes"');
    expect(src(), 'the script must not read commit text itself').not.toMatch(/git[^\n]* log\b/);
    expect(src(), 'no --notes argument: the body goes through a file').not.toMatch(/--notes /);
  });

  it('W25-P1: the base, the guard, the published-base check, the download and the extraction are asked in exactly these spellings', () => {
    const s = src();
    expect(s).toContain('git -C "$ROOT" tag --merged HEAD | grep -vxF -- "$tag" | newest');
    expect(s).toContain('git -C "$ROOT" diff --name-only "$base" HEAD -- "${JUDGES[@]}"');
    expect(s).toContain('gh release view "$base" --json isDraft --jq .isDraft');
    expect(s).toContain('gh release download "$base" --pattern "ccrc-$base.tar.gz" --pattern SHA256SUMS --dir "$d/asset"');
    expect(s).toContain('tar -xpzf "$d/asset/ccrc-$base.tar.gz" -C "$d/base"');
    expect(s).toContain('tar -xpzf "$OUT_DIR/candidate/ccrc-$tag.tar.gz" -C "$d/head"');
    expect(s).toContain('cmp -s "$d/fp-base" "$d/fp-head"');
    expect(s).toContain('LC_ALL=C comm -3 "$d/fp-base" "$d/fp-head"');
  });
  it('W25-P2: the five state words, each spelled once', () => {
    const s = src();
    expect(s).toContain("printf 'built contained\\ncontained-by %s\\nhead %s\\n'");
    expect(s).toContain("printf 'built candidate\\ntag %s\\nhead %s\\n'");
    expect(s).toContain("printf 'built unchanged\\nsame-as %s\\nhead %s\\n'");
    expect(s).toContain("printf 'built true\\ntag %s\\nhead %s\\n'");
    expect(s).toContain("printf 'built false\\ntag %s\\n'");
    for (const w of ['candidate', 'unchanged', 'contained', 'true', 'false']) {
      expect(s.match(new RegExp(`printf 'built ${w}\\\\n`, 'g')) ?? [], `printf 'built ${w}'`).toHaveLength(1);
    }
  });
  it('W25-P3: prepare builds into the candidate directory, with no gh call and no token', () => {
    const body = fn('prepare');
    expect(body.length, 'prepare\'s body was not found').toBeGreaterThan(200);
    expect(body).toContain('deploy/build-release.sh" --out "$OUT_DIR/candidate"');
    expect(body).not.toMatch(/\bgh /);
    expect(body).not.toContain('GH_TOKEN');
    expect(body).not.toContain('judge');
  });
  it('W25-P4: the two files that judge a comparison are spelled once, in JUDGES, and the diff reads that array', () => {
    const s = src();
    expect(s.match(/\.github\/workflows\/release-main\.yml/g) ?? []).toHaveLength(1);
    expect(s).toContain('JUDGES=(.github/workflows/release-main.yml deploy/release-main.sh)');
    expect(s.match(/\bJUDGES=/g) ?? []).toHaveLength(1);
  });
  it('W25-P5: the version sort is spelled once, in newest, which derive_tags and the base both use', () => {
    expect(src().match(/sort -V/g) ?? []).toHaveLength(1);
    expect(/^newest\(\) \{[^\n]*sort -V[^\n]*\}$/m.test(src())).toBe(true);
    expect(fn('derive_tags')).toContain("tag --list 'v*' | newest");
  });
  it('W25-P6: the retired helpers and arms are gone', () => {
    const s = src();
    for (const gone of ['scope_ask', 'node_floor_ok', 'measure_change', 'base_published', 'decision_in_tree', 'release-scope', 'release-main.decision']) {
      expect(s, gone).not.toContain(gone);
    }
    expect(s).not.toMatch(/^(decide|measure)\(\) \{/m);
  });
  it('W25-P7: the fingerprint is one inline node program over node:fs, node:path and node:crypto', () => {
    const s = src();
    expect(s.match(/node -e /g) ?? []).toHaveLength(1);
    const req = [...s.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]).sort();
    expect(req).toEqual(['node:crypto', 'node:fs', 'node:path']);
    expect(s).toContain('fingerprint() { node -e "$FP_JS" "$1" | LC_ALL=C sort; }');
  });
  it('W26-P1: receive runs no gh, no token, no builder, no install and no tar, verifies once, and shares compare\'s state writer (D-6656)', () => {
    const body = fn('receive');
    expect(body.length, 'receive\'s body was not found').toBeGreaterThan(200);
    expect(body).not.toContain('gh ');
    expect(body).not.toContain('GH_TOKEN');
    expect(body).not.toContain('build-release');
    expect(body).not.toContain('npm');
    expect(body).not.toContain('tar ');
    expect(body.match(/release-artifact\.sh" verify/g) ?? []).toHaveLength(1);
    expect(fn('record_release')).toContain("printf 'built true\\ntag %s\\nhead %s\\n'");
    expect(fn('compare')).toContain('record_release "$tag" "$head"');
    expect(body).toContain('record_release "$tag" "$head"');
  });
});
