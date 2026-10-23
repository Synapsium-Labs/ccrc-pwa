// deploy/release-artifact.sh — the hand-over between the release workflow's
// two jobs (D-6649, D-6650, D-6657). `record` runs in the build job, which
// holds no write credential: it checks the built tarball against its
// SHA256SUMS and against the build.json inside it, and hands the digest on as
// a step output. `verify` runs in the publish job, which holds the write
// token: it checks the downloaded artifact against that digest and against
// its own SHA256SUMS without opening the tarball, and only then copies it
// where the attest step and the publish read it. Fixture: a two-commit repo
// with the script copied in, and tarballs made with the system tar from a
// directory holding a build.json in the builder's shape and a MANIFEST.
// Never touches the network.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SCRIPT = join(REPO, 'deploy', 'release-artifact.sh');
const RELEASE_MAIN = join(REPO, 'deploy', 'release-main.sh');
const TAG = 'v0.0.9';
const NAME = `ccrc-${TAG}.tar.gz`;

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

/** `<home>/repo` with the script copied in and two commits; `parent` is the
 *  first, `head` the second. */
function repo(home: string): { root: string; head: string; parent: string } {
  const root = join(home, 'repo');
  mkdirSync(join(root, 'deploy'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'deploy', 'release-artifact.sh'));
  chmodSync(join(root, 'deploy', 'release-artifact.sh'), 0o755);
  writeFileSync(join(root, 'README'), 'fixture\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  const parent = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'README'), 'fixture, second\n');
  git(root, 'commit', '-q', '-am', 'second');
  return { root, head: git(root, 'rev-parse', 'HEAD'), parent };
}

/** build.json in build-release.sh's one-line shape. */
function buildJson(sha: string, version: string): string {
  return `{"sha":"${sha}","ref":"main","builtAt":"2026-10-23T00:00:00Z","dirty":false,"version":"${version}"}\n`;
}

let made = 0;
/** A gzip tarball at `file` of a directory holding `build.json` (when given)
 *  and a MANIFEST, so its members are `./build.json` and `./MANIFEST`. */
function tarball(home: string, file: string, json: string | null): void {
  const src = join(home, `tree-${made++}`);
  mkdirSync(src, { recursive: true });
  if (json !== null) writeFileSync(join(src, 'build.json'), json);
  writeFileSync(join(src, 'MANIFEST'), 'fixture manifest\n');
  mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync('tar', ['-czf', file, '-C', src, '.'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fixture tar failed: ${r.stderr}`);
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const sumsLine = (digest: string, name: string): string => `${digest}  ${name}\n`;

/** `<home>/<sub>` holding `ccrc-<tag>.tar.gz` (built with `json`) and a
 *  SHA256SUMS written by `sums` (default: the one exact line). */
function artifact(home: string, sub: string, opts: {
  tag?: string; json: string | null; sums?: (digest: string, name: string) => string;
}): { dir: string; digest: string } {
  const tag = opts.tag ?? TAG;
  const name = `ccrc-${tag}.tar.gz`;
  const dir = join(home, sub);
  tarball(home, join(dir, name), opts.json);
  const digest = sha256(join(dir, name));
  writeFileSync(join(dir, 'SHA256SUMS'), (opts.sums ?? sumsLine)(digest, name));
  return { dir, digest };
}

function run(root: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [join(root, 'deploy', 'release-artifact.sh'), ...args],
    { env: { ...process.env, ...GIT_ENV, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', ...env }, cwd: root, encoding: 'utf8' });
}

function record(root: string, dir: string, out: string, tag = TAG) {
  return run(root, ['record', '--tag', tag, '--dir', dir], { GITHUB_OUTPUT: out });
}

function verify(root: string, inDir: string, out: string, digest: string, tag = TAG) {
  return run(root, ['verify', '--tag', tag, '--digest', digest, '--in', inDir, '--out', out]);
}

/** An empty file for `GITHUB_OUTPUT`. */
function outputFile(home: string): string {
  const f = join(home, 'github-output');
  writeFileSync(f, '');
  return f;
}

/** W26-V11: a refused `verify` wrote nothing — `<out>` does not exist, or is
 *  empty, or (when the row planted something there first) holds exactly what
 *  the row planted. */
function expectNothingWritten(out: string, planted: string[] = []): void {
  if (planted.length === 0) {
    expect(!existsSync(out) || readdirSync(out).length === 0, `${out} must not exist or be empty`).toBe(true);
  } else {
    expect(readdirSync(out).sort()).toEqual([...planted].sort());
  }
}

function expectRefused(r: ReturnType<typeof run>, reason: string): void {
  expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
  expect(r.stderr).toContain(`release-artifact.sh: ${reason}`);
}

const SUMS_CASES: [string, (digest: string, name: string) => string][] = [
  ['a line for another digest', (_d, n) => sumsLine('0'.repeat(64), n)],
  ['two lines', (d, n) => sumsLine(d, n) + sumsLine(d, n)],
  ['no trailing newline', (d, n) => `${d}  ${n}`],
];

const sumsReason = (digest: string): string => `SHA256SUMS is not exactly one line for ${NAME} at ${digest}`;
const holdsReason = (names: string[]): string =>
  `the build's artifact holds ${[...names].sort().join(' ')} — expected exactly ${NAME} and SHA256SUMS`;

describe('release-artifact.sh: record, in the build job', () => {
  it('W26-A1: a good pair is recorded — one line printed, and the digest handed on as a step output', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'release-out', { json: buildJson(head, TAG) });
    const out = outputFile(home);
    const r = record(root, dir, out);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`release-artifact.sh: recorded ${NAME}, sha256 ${digest} (build.json: version ${TAG}, sha ${head})\n`);
    expect(readFileSync(out, 'utf8')).toBe(`digest=${digest}\n`);
  });

  it('W26-A2: a tarball named after another release tag is refused, and no digest is handed on', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir } = artifact(home, 'release-out', { tag: 'v0.1.0', json: buildJson(head, 'v0.1.0') });
    const out = outputFile(home);
    const r = record(root, dir, out);
    expectRefused(r, `no ${NAME} in ${dir} (it holds ccrc-v0.1.0.tar.gz) — the builder named the tarball after another release tag at HEAD`);
    expect(readFileSync(out, 'utf8')).toBe('');
  });

  it.each(SUMS_CASES)('W26-A3: a SHA256SUMS with %s is refused', (_label, sums) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'release-out', { json: buildJson(head, TAG), sums });
    const out = outputFile(home);
    expectRefused(record(root, dir, out), sumsReason(digest));
    expect(readFileSync(out, 'utf8')).toBe('');
  });

  it('W26-A5: a GITHUB_OUTPUT that cannot be written never fails the run', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir } = artifact(home, 'release-out', { json: buildJson(head, TAG) });
    const ro = join(home, 'read-only');
    mkdirSync(ro);
    chmodSync(ro, 0o555);
    try {
      const r = record(root, dir, join(ro, 'github-output'));
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toBe('');
      expect(existsSync(join(ro, 'github-output'))).toBe(false);
    } finally {
      chmodSync(ro, 0o755);
    }
  });

  it('W26-A7: a build.json naming another version is refused, and no digest is handed on', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir } = artifact(home, 'release-out', { json: buildJson(head, 'v0.0.8') });
    const out = outputFile(home);
    expectRefused(record(root, dir, out), `build.json says version v0.0.8, not ${TAG}`);
    expect(readFileSync(out, 'utf8')).toBe('');
  });

  it('W26-A8: a build.json built from another commit is refused', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head, parent } = repo(home);
    const { dir } = artifact(home, 'release-out', { json: buildJson(parent, TAG) });
    const out = outputFile(home);
    expectRefused(record(root, dir, out), `build.json was built from ${parent}, not HEAD ${head}`);
    expect(readFileSync(out, 'utf8')).toBe('');
  });

  it.each([
    ['a tarball with no ./build.json', (_head: string): string | null => null],
    ['a build.json with its keys reordered', (head: string): string | null =>
      `{"version":"${TAG}","sha":"${head}","ref":"main","builtAt":"2026-10-23T00:00:00Z","dirty":false}\n`],
  ])('W26-A9: %s is refused', (_label, json) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir } = artifact(home, 'release-out', { json: json(head) });
    const out = outputFile(home);
    expectRefused(record(root, dir, out), `could not read build.json from ${NAME}, or it is not the builder's one-line shape`);
    expect(readFileSync(out, 'utf8')).toBe('');
  });
});

describe('release-artifact.sh: verify, in the publish job', () => {
  it('W26-V1: a good artifact is copied out, byte-identical, with a SHA256SUMS written from the recorded digest', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const out = join(home, 'release-out');
    const r = verify(root, dir, out, digest);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`release-artifact.sh: verified ${NAME} (sha256 ${digest}): the build's record and its SHA256SUMS agree; the tarball was not opened\n`);
    expect(readdirSync(out).sort()).toEqual(['SHA256SUMS', NAME]);
    expect(readFileSync(join(out, NAME)).equals(readFileSync(join(dir, NAME)))).toBe(true);
    expect(readFileSync(join(out, 'SHA256SUMS'), 'utf8')).toBe(`${digest}  ${NAME}\n`);
  });

  it('W26-V2: a tarball that does not hash to the recorded digest is refused, naming both digests', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const other = createHash('sha256').update('another file\n').digest('hex');
    const out = join(home, 'release-out');
    expectRefused(verify(root, dir, out, other), `${NAME} hashes to ${digest}, not the ${other} the build job recorded`);
    expectNothingWritten(out);
  });

  it.each(SUMS_CASES)('W26-V3: a SHA256SUMS with %s is refused', (_label, sums) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG), sums });
    const out = join(home, 'release-out');
    expectRefused(verify(root, dir, out, digest), sumsReason(digest));
    expectNothingWritten(out);
  });

  it.each([
    ['a third file x', 'x', (p: string) => writeFileSync(p, 'x\n')],
    ['a dot file .x', '.x', (p: string) => writeFileSync(p, 'x\n')],
    ['a directory d', 'd', (p: string) => mkdirSync(p)],
  ])('W26-V4: an artifact holding %s is refused, listing every name', (_label, extra, plant) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    plant(join(dir, extra));
    const out = join(home, 'release-out');
    expectRefused(verify(root, dir, out, digest), holdsReason(['SHA256SUMS', NAME, extra]));
    expectNothingWritten(out);
  });

  it.each([NAME, 'SHA256SUMS'])('W26-V5: %s as a symlink to a good copy elsewhere is refused', (name) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const elsewhere = join(home, 'elsewhere');
    mkdirSync(elsewhere);
    copyFileSync(join(dir, name), join(elsewhere, name));
    unlinkSync(join(dir, name));
    symlinkSync(join(elsewhere, name), join(dir, name));
    const out = join(home, 'release-out');
    expectRefused(verify(root, dir, out, digest), `${name} in the build's artifact is not a regular file`);
    expectNothingWritten(out);
  });

  it.each([
    [NAME, ['SHA256SUMS']],
    ['SHA256SUMS', [NAME]],
  ])('W26-V6: an artifact missing %s is refused', (missing, left) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    unlinkSync(join(dir, missing));
    const out = join(home, 'release-out');
    expectRefused(verify(root, dir, out, digest), holdsReason(left));
    expectNothingWritten(out);
  });

  it('W26-V12: the write side never opens the tarball — 64 KiB of bytes that are not gzip at all verify and are copied byte-identical', () => {
    const home = mkTmp('ccrc-relart-');
    const { root } = repo(home);
    const dir = join(home, 'downloaded');
    mkdirSync(dir);
    writeFileSync(join(dir, NAME), randomBytes(64 * 1024));
    const digest = sha256(join(dir, NAME));
    writeFileSync(join(dir, 'SHA256SUMS'), sumsLine(digest, NAME));
    const out = join(home, 'release-out');
    const r = verify(root, dir, out, digest);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(out, NAME)).equals(readFileSync(join(dir, NAME)))).toBe(true);
    expect(readFileSync(join(out, 'SHA256SUMS'), 'utf8')).toBe(sumsLine(digest, NAME));
  });

  it('W26-V10: an out directory that already holds a tarball is refused, and is left as it was', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const out = join(home, 'release-out');
    mkdirSync(out);
    writeFileSync(join(out, 'ccrc-v0.0.1.tar.gz'), 'stale\n');
    expectRefused(verify(root, dir, out, digest), `${out} already holds a tarball — the attest step would sign an artifact no release publishes`);
    expectNothingWritten(out, ['ccrc-v0.0.1.tar.gz']);
    expect(readFileSync(join(out, 'ccrc-v0.0.1.tar.gz'), 'utf8')).toBe('stale\n');
  });

  it('W26-V10: --out equal to --in is refused, and the artifact is left as it was', () => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const before = readFileSync(join(dir, 'SHA256SUMS'));
    const r = verify(root, dir, dir, digest);
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/^release-artifact\.sh: /m);
    expectNothingWritten(dir, ['SHA256SUMS', NAME]);
    expect(readFileSync(join(dir, 'SHA256SUMS')).equals(before)).toBe(true);
    expect(sha256(join(dir, NAME))).toBe(digest);
  });
});

describe('release-artifact.sh: refusals of the arguments', () => {
  const recordArgs = (dir: string): string[] => ['record', '--tag', TAG, '--dir', dir];
  const verifyArgs = (dir: string, out: string, digest: string): string[] =>
    ['verify', '--tag', TAG, '--digest', digest, '--in', dir, '--out', out];

  /** Replaces the value after `flag` in `args`. */
  const withValue = (args: string[], flag: string, value: string): string[] => {
    const i = args.indexOf(flag);
    return [...args.slice(0, i + 1), value, ...args.slice(i + 2)];
  };
  /** Drops `flag` and its value from `args`. */
  const without = (args: string[], flag: string): string[] => {
    const i = args.indexOf(flag);
    return [...args.slice(0, i), ...args.slice(i + 2)];
  };

  it.each([
    ['record', 'vnext'], ['record', 'v1.2'], ['verify', 'vnext'], ['verify', 'v1.2'],
  ])('W26-A4: %s --tag %s is refused as not a release tag', (verb, tag) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const out = join(home, 'release-out');
    const args = verb === 'record' ? recordArgs(dir) : verifyArgs(dir, out, digest);
    const r = run(root, withValue(args, '--tag', tag), verb === 'record' ? { GITHUB_OUTPUT: outputFile(home) } : {});
    expectRefused(r, `${tag} is not a release tag`);
    if (verb === 'record') expect(readFileSync(join(home, 'github-output'), 'utf8')).toBe('');
    else expectNothingWritten(out);
  });

  it.each([
    ['63 hex', (d: string) => d.slice(0, 63)],
    ['uppercase hex', (d: string) => d.toUpperCase()],
    ['empty', (_d: string) => ''],
  ])('W26-A4: verify --digest of %s is refused as not a sha256 digest', (_label, mangle) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const out = join(home, 'release-out');
    const bad = mangle(digest);
    expectRefused(run(root, withValue(verifyArgs(dir, out, digest), '--digest', bad)), `${bad} is not a sha256 digest`);
    expectNothingWritten(out);
  });

  it.each([
    ['record', '--tag'], ['record', '--dir'],
    ['verify', '--tag'], ['verify', '--digest'], ['verify', '--in'], ['verify', '--out'],
  ])('W26-A4: %s without %s exits 2', (verb, flag) => {
    const home = mkTmp('ccrc-relart-');
    const { root, head } = repo(home);
    const { dir, digest } = artifact(home, 'downloaded', { json: buildJson(head, TAG) });
    const out = join(home, 'release-out');
    const args = verb === 'record' ? recordArgs(dir) : verifyArgs(dir, out, digest);
    const r = run(root, without(args, flag), { GITHUB_OUTPUT: outputFile(home) });
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(2);
    expect(readFileSync(join(home, 'github-output'), 'utf8')).toBe('');
    expectNothingWritten(out);
  });

  it.each([
    ['an unknown flag', ['record', '--tag', TAG, '--dir', 'x', '--bogus', 'y']],
    ['a flag of the other verb', ['record', '--tag', TAG, '--dir', 'x', '--digest', 'y']],
    ['a flag with no value', ['record', '--dir', 'x', '--tag']],
    ['no verb', ['--tag', TAG, '--dir', 'x']],
    ['an unknown verb', ['publish', '--tag', TAG]],
  ])('W26-A4: %s exits 2', (_label, args) => {
    const home = mkTmp('ccrc-relart-');
    const { root } = repo(home);
    const r = run(root, args);
    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(2);
  });
});

describe('release-artifact.sh: source pins', () => {
  const src = (): string => readFileSync(SCRIPT, 'utf8');
  const fn = (name: string): string => new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(src())?.[0] ?? '';
  /** A command word: not part of a longer word, a path or a file name, so
   *  `ccrc-*.tar.gz` and `tarball` are not a `tar`. */
  const word = (w: string, flags = ''): RegExp => new RegExp(`(?<![\\w./-])${w}(?![\\w.-])`, flags);
  const code = (s: string): string => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('W26-A6: runs under set -euo pipefail', () => { expect(src()).toMatch(/^set -euo pipefail$/m); });

  it('W26-A6: the SHAPE= line is release-main.sh\'s, byte for byte', () => {
    const shape = (s: string): string[] => s.split('\n').filter((l) => l.startsWith('SHAPE='));
    const mine = shape(src());
    expect(mine).toHaveLength(1);
    expect(mine).toEqual(shape(readFileSync(RELEASE_MAIN, 'utf8')));
  });

  it('W26-A6: no node, npm, gh, push, curl or token', () => {
    const s = src();
    expect(s).not.toMatch(/\bnode\b/);
    expect(s).not.toMatch(/\bnpm\b/);
    expect(s).not.toMatch(/\bgh\s/);
    expect(s).not.toContain('git push');
    expect(s).not.toMatch(/\bcurl\b/);
    expect(s).not.toContain('GH_TOKEN');
  });

  it('W26-A6: exactly one tar call, inside record\'s body, and it carries -xzOf', () => {
    const calls = code(src()).split('\n').filter((l) => word('tar').test(l));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('-xzOf');
    const body = fn('record');
    expect(body.length, 'record\'s body was not found').toBeGreaterThan(200);
    expect(code(body)).toContain(calls[0]);
  });

  it('W26-A6: verify\'s body runs no decoder — the write side opens nothing it received', () => {
    const body = fn('verify');
    expect(body.length, 'verify\'s body was not found').toBeGreaterThan(200);
    for (const w of ['tar', 'gzip', 'gunzip', 'zcat', 'unzip', 'bsdtar', 'node']) {
      expect(body, w).not.toMatch(word(w));
    }
  });
});
