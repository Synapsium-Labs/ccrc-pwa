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
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The smallest tree build-release.sh's `git archive` pathspec accepts. */
const FILES: Record<string, string> = {
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
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main', '--tags');
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
function run(root: string, home: string, args: string[] = [], ghExit = 0): Result {
  const bin = plantBin(home, ghExit);
  const r = spawnSync('bash', [join(root, 'deploy', 'release-main.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }, cwd: root, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const originTags = (home: string): string[] =>
  spawnSync('git', ['-C', join(home, 'origin.git'), 'tag'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l !== '');

describe('release-main.sh: refusals before anything is written', () => {
  it('refuses a dirty tree — no tag, no npm, no gh', () => {
    const home = mkTmp('ccrc-relmain-dirty-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    writeFileSync(join(root, 'straggler.txt'), 'untracked\n');
    const r = run(root, home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing a dirty tree/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('an unknown argument is a usage error, exit 2', () => {
    const home = mkTmp('ccrc-relmain-usage-');
    const root = fixture(home);
    const r = run(root, home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown argument: --bogus/);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
  });

  it('a HEAD that already carries a vX.Y.Z tag exits 0 and does nothing — release.yml owns it', () => {
    const home = mkTmp('ccrc-relmain-tagged-');
    const root = fixture(home, { tags: ['v0.0.1'], tagHead: 'v1.0.0' });
    const r = run(root, home);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/already tagged v1\.0\.0; release\.yml owns it/);
    expect(originTags(home).sort()).toEqual(['v0.0.1', 'v1.0.0']);
    expect(existsSync(join(home, 'gh-argv'))).toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
  });
});

describe('release-main.sh: derive, push, build, publish', () => {
  it.each([
    [['v0.0.1'], 'v0.0.2'],
    [['v1.9.9', 'v1.9.10'], 'v1.9.11'],   // sort -V, not lexical: v1.9.10 > v1.9.9
    [['v0.0.1', 'wip', 'backup/x'], 'v0.0.2'],   // non-release tags are ignored
    [[], 'v0.0.1'],
  ])('highest %j → next %s', (tags, next) => {
    const home = mkTmp('ccrc-relmain-derive-');
    const root = fixture(home, { tags });
    const r = run(root, home, ['--out', join(home, 'out')]);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(originTags(home)).toContain(next);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe(next);
    const gh = readFileSync(join(home, 'gh-argv'), 'utf8').trim();
    expect(gh).toBe(`release create ${next} ${join(home, 'out')}/ccrc-${next}.tar.gz ${join(home, 'out')}/SHA256SUMS --verify-tag`);
    // The artifact really is build-release.sh's: the stamp names the tag.
    expect(existsSync(join(home, 'out', `ccrc-${next}.tar.gz`))).toBe(true);
  });

  it('pushes the tag to origin BEFORE publishing — gh --verify-tag needs it there', () => {
    const home = mkTmp('ccrc-relmain-order-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const r = run(root, home, ['--out', join(home, 'out')]);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'origin-tags-at-gh'), 'utf8').split('\n')).toContain('v0.0.2');
  });

  it('a failed publish deletes the pushed tag from origin, so no release-less tag remains', () => {
    const home = mkTmp('ccrc-relmain-cleanup-');
    const root = fixture(home, { tags: ['v0.0.1'] });
    const r = run(root, home, ['--out', join(home, 'out')], 1);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/deleting tag v0\.0\.2 from origin/);
    expect(originTags(home)).toEqual(['v0.0.1']);
    expect(git(root, 'tag', '--points-at', 'HEAD')).toBe('');
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
  it('names both artifacts to gh rather than globbing — a glob\'s order follows the locale', () => {
    expect(src()).toContain('"$OUT_DIR/ccrc-$NEXT.tar.gz" "$OUT_DIR/SHA256SUMS" --verify-tag');
  });
});
