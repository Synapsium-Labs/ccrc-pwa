// deploy/release-main.sh — spec §3. On a clean, untagged HEAD: derive the next
// patch tag from the highest existing vX.Y.Z, push it to origin, build with
// build-release.sh, publish with gh — and delete the pushed tag if the publish
// never completes. Fixture: a repo with a BARE origin (so `git push` is real
// and its effect is measurable), the real build-release.sh copied in (its own
// suite proves it), a recording npm that fabricates dists, a recording gh
// whose exit code the test chooses. Never touches the network: curl is
// poisoned, gh is the stub.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-main.sh');
const BUILDER = join(REPO, 'deploy', 'build-release.sh');

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
  'install.sh': '#!/usr/bin/env bash\necho fixture\n',
  'ccd/ccrc': '#!/usr/bin/env bash\necho fixture\n',
  'shared/package.json': '{ "type": "module" }\n',
  'deploy/ccrc.service': '[Unit]\nDescription=fixture\n',
  'server/package.json': '{ "name": "s" }\n', 'server/package-lock.json': '{}\n',
  'agent/package.json': '{ "name": "a" }\n', 'agent/package-lock.json': '{}\n',
  'pwa/package.json': '{ "name": "p" }\n', 'pwa/package-lock.json': '{}\n',
};

/** `<home>/repo` with one commit, `<home>/origin.git` bare and added as
 *  `origin`, optional existing tags (pushed to origin too, as real ones are). */
function fixture(home: string, opts: { tags?: string[]; tagHead?: string } = {}): string {
  const root = join(home, 'repo');
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(path.dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, { mode: rel.endsWith('.sh') || rel === 'ccd/ccrc' ? 0o755 : 0o644 });
  }
  copyFileSync(BUILDER, join(root, 'deploy', 'build-release.sh'));
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-main.sh'));
  chmodSync(join(root, 'deploy', 'build-release.sh'), 0o755);
  chmodSync(join(root, 'deploy', 'release-main.sh'), 0o755);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  for (const t of opts.tags ?? []) {
    // Each older tag sits on its own earlier commit, so HEAD stays untagged.
    git(root, 'commit', '-q', '--allow-empty', '-m', `release ${t}`);
    git(root, 'tag', t);
  }
  git(root, 'commit', '-q', '--allow-empty', '-m', 'the merge under release');
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
  return root;
}

function plantBin(home: string, ghExit = 0): string {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'npm'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$PWD $*" >> "$HOME/npm-argv"',
    'if [ "$1" = "run" ] && [ "$2" = "build" ]; then case "$PWD" in',
    '  */server) mkdir -p dist/server/src; echo "// s" > dist/server/src/index.js ;;',
    '  */pwa) mkdir -p ../server/dist-pwa; echo "<title>p</title>" > ../server/dist-pwa/index.html ;;',
    '  */agent) mkdir -p dist/agent/src; echo "// a" > dist/agent/src/index.js ;;',
    'esac; fi; exit 0',
  ].join('\n'), { mode: 0o755 });
  // gh RECORDS its argv and, at call time, records which tags origin holds —
  // the ordering pin (tag pushed BEFORE publish) reads that record.
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/gh-argv"',
    'git -C "$HOME/origin.git" tag > "$HOME/origin-tags-at-gh"',
    `exit ${ghExit}`,
  ].join('\n'), { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "release-main tests never reach the network" >&2\nexit 97\n', { mode: 0o755 });
  return bin;
}

interface Result { code: number; stdout: string; stderr: string }
function run(root: string, home: string, args: string[] = [], ghExit = 0,
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  const bin = plantBin(home, ghExit);
  const r = spawnSync('bash', [join(root, 'deploy', 'release-main.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, ...extraEnv }, cwd: root, encoding: 'utf8' });
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

describe('release-main.sh: prepare (tag locally, build) then publish (push, three artifacts, --prerelease)', () => {
  it.each([
    [['v0.0.1'], 'v0.0.2'],
    [['v1.9.9', 'v1.9.10'], 'v1.9.11'],
    [['v0.0.1', 'vnext', 'v1.2', 'v1.2.3-rc1'], 'v0.0.2'],
    [[], 'v0.0.1'],
  ])('highest %j → next %s: prepare tags locally, publish pushes and publishes', (tags, next) => {
    const home = mkTmp('ccrc-relmain-derive-');
    const root = fixture(home, { tags });
    const out = join(home, 'out');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code, `stderr: ${p.stderr}\nstdout: ${p.stdout}`).toBe(0);
    // Prepared: the tag is local, origin has NOT seen it, nothing was published.
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe(next);
    expect(originTags(home)).not.toContain(next);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe(`built true\ntag ${next}\n`);
    expect(existsSync(join(out, `ccrc-${next}.tar.gz`))).toBe(true);
    const bundle = plantBundle(home);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: bundle });
    expect(q.code, `stderr: ${q.stderr}\nstdout: ${q.stdout}`).toBe(0);
    expect(originTags(home)).toContain(next);
    expect(readFileSync(join(home, 'origin-pushes'), 'utf8')).toBe(`refs/tags/${next}\n`);
    // All three artifacts NAMED, the flag trailing (the stub records `$*` as one line).
    expect(readFileSync(join(home, 'gh-argv'), 'utf8').trim())
      .toBe(`release create ${next} ${out}/ccrc-${next}.tar.gz ${out}/SHA256SUMS ${out}/ccrc-${next}.tar.gz.sigstore.json --verify-tag --prerelease`);
    expect(existsSync(join(out, `ccrc-${next}.tar.gz.sigstore.json`))).toBe(true);
    expect(q.stdout).toMatch(/published v[0-9.]+ as a prerelease/);
  });

  it('publish pushes the tag BEFORE gh runs — --verify-tag needs it on origin', () => {
    const home = mkTmp('ccrc-relmain-order-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out], 0, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code, q.stderr).toBe(0);
    expect(readFileSync(join(home, 'origin-tags-at-gh'), 'utf8').split('\n')).toContain('v0.0.2');
  });

  it('publish without a bundle refuses, pushes nothing, keeps the local tag for a retry', () => {
    const home = mkTmp('ccrc-relmain-nobundle-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const out = join(home, 'out');
    expect(run(root, home, ['prepare', '--out', out]).code).toBe(0);
    const q = run(root, home, ['publish', '--out', out]);
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/no provenance bundle .* refusing to publish an unattested release; nothing was pushed/);
    expect(existsSync(join(home, 'origin-pushes'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
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
    const q = run(root, home, ['publish', '--out', out], 1, { CCRC_BUNDLE_PATH: plantBundle(home) });
    expect(q.code).toBe(1);
    expect(q.stderr).toMatch(/deleting tag v0\.0\.2 from origin/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
  });

  it('an already-tagged HEAD: prepare records built false and publish does nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const out = join(home, 'out');
    const p = run(root, home, ['prepare', '--out', out]);
    expect(p.code).toBe(0);
    expect(p.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(readFileSync(join(out, 'release-main.state'), 'utf8')).toBe('built false\ntag v1.0.0\n');
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
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
  });
});

describe('release-main.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  it('runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });
  it('derives with sort -V — plain sort would rank v1.9.10 below v1.9.9', () => { expect(src()).toMatch(/sort -V/); });
  it('builds through build-release.sh and owns no second build path', () => {
    expect(src()).toContain('deploy/build-release.sh" --out "$OUT_DIR"');
    expect(src()).not.toMatch(/npm ci|npm run/);
  });
  it('names all three artifacts to gh rather than globbing, and publishes a PRERELEASE (design §4, §18 rows 1 and 7)', () => {
    expect(src()).toContain('"$tarball" "$sums" "$bundle" --verify-tag --prerelease');
  });
});
