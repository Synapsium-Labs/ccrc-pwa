// The test box, Part A, TB3 (D-7405; spec §2.1; plan #1874): the transport.
//
// ccd/testbox-snap sends a session's git state to the box's mirror as scratch refs under one fresh
// refs/ccrc-test/<run-id>/; deploy/testbox/git/pre-receive accepts only creations under one fresh run id;
// deploy/testbox/git/push-command is the push user's forced command; deploy/testbox/bin/checkout reproduces the state
// in a run's checkout as uncommitted changes.
//
// Fixtures only: every repository is a local fixture under a fixture HOME (`project-a`), the mirror is a local bare
// clone set up as spec §2.1 says, pushes go to its path (or, for the forced command, through a fixed GIT_SSH driver
// that runs the forced command in place of sshd, host `testbox.invalid`). Nothing here contacts a box or a remote.
//
// The snapshot rows run on Linux and macOS (the snapshot runs on the fleet host); the hook, forced command and
// checkout rows run on Linux only (they run on the box).
//
// The two review foci (plan §Review focus 1 and 2) are the `never origin` and `untouched` blocks.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { TESTBOX_FALLBACK, TESTBOX_REF_MAP, parseRepoRow } from '../../shared/testbox.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNAP = path.join(REPO, 'ccd', 'testbox-snap');
const HOOK = path.join(REPO, 'deploy', 'testbox', 'git', 'pre-receive');
const PUSH_COMMAND = path.join(REPO, 'deploy', 'testbox', 'git', 'push-command');
const CHECKOUT = path.join(REPO, 'deploy', 'testbox', 'bin', 'checkout');
const LINUX = process.platform === 'linux';
const T = 60_000;

// Fixture sizes, in bytes, passed to the snapshot as its caller would (TB8 reads them through ccrc's one reader).
const FILE_MAX = 4096;
const SNAP_MAX = 65536;
const DENY = '*.pem *.key .env .env.* id_* *.p12';

// ---------------------------------------------------------------------------------------------------------------
// Fixture plumbing
// ---------------------------------------------------------------------------------------------------------------

interface Ran { status: number | null; stdout: string; stderr: string }

/** The fixture environment: nothing inherited but PATH, so no session git variable reaches a fixture git. */
function baseEnv(home: string, tmp: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, TMPDIR: tmp, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1' };
}

function sh(cmd: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, input?: string): Ran {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface World {
  root: string;
  home: string;
  tmp: string;
  env: NodeJS.ProcessEnv;
  upstream: string;
  mirror: string;
  clone: string;
  sess: string;
  hooks: string;
  table: string;
  git: (cwd: string, ...args: string[]) => string;
  gitRan: (cwd: string, ...args: string[]) => Ran;
}

function world(): World {
  const root = mkTmp('tb3-');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(home, '.gitconfig'),
    '[user]\n\tname = fixture\n\temail = fixture@testbox.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgSign = false\n[protocol "file"]\n\tallow = always\n');
  const env = baseEnv(home, tmp);
  const gitRan = (cwd: string, ...args: string[]): Ran => sh('git', args, cwd, env);
  const git = (cwd: string, ...args: string[]): string => {
    const r = gitRan(cwd, ...args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd}: ${r.stderr}`);
    return r.stdout;
  };
  const upstream = path.join(root, 'project-a.git');
  git(root, 'init', '-q', '--bare', upstream);
  const seed = path.join(root, 'seed');
  git(root, 'clone', '-q', upstream, seed);
  mkdirSync(path.join(seed, 'server'), { recursive: true });
  mkdirSync(path.join(seed, 'pwa'), { recursive: true });
  writeFileSync(path.join(seed, 'README.md'), 'project-a\n');
  writeFileSync(path.join(seed, 'server', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(seed, 'pwa', 'b.ts'), 'export const b = 1;\n');
  writeFileSync(path.join(seed, '.gitignore'), 'dist/\n*.log\nserver/dist/\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'c1: the seed');
  git(seed, 'push', '-q', 'origin', 'main');

  // The mirror (spec §2.1 "The mirror"): a plain bare clone with the heads fetched to origin's tracking refs.
  const mirror = path.join(root, 'mirrors', 'project-a.git');
  mkdirSync(path.dirname(mirror), { recursive: true });
  git(root, 'clone', '-q', '--bare', upstream, mirror);
  git(mirror, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  git(mirror, 'fetch', '-q', '--prune', 'origin');
  const hooks = path.join(root, 'mirror-hooks');
  mkdirSync(hooks, { recursive: true });
  if (LINUX) {
    writeFileSync(path.join(hooks, 'pre-receive'), readFileSync(HOOK));
    chmodSync(path.join(hooks, 'pre-receive'), 0o755);
    git(mirror, 'config', 'core.hooksPath', hooks);
  }
  // The repository table: one parseRepoRow-shaped row.
  const table = path.join(root, 'testbox-repos.d');
  mkdirSync(table, { recursive: true });
  writeFileSync(path.join(table, 'project-a.json'), repoRow(mirror));

  // The session: a clone, and a linked worktree on a branch (a session's own index is a linked worktree's).
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', upstream, clone);
  const sess = path.join(root, 'sess');
  return { root, home, tmp, env, upstream, mirror, clone, sess, hooks, table, git, gitRan };
}

function repoRow(mirror: string): string {
  return JSON.stringify({
    name: 'project-a',
    fetchUrl: 'https://testbox.invalid/project-a.git',
    mirrorPath: mirror,
    packages: [{ name: 'server', installInputs: ['server/package.json', 'server/package-lock.json'], commands: ['./node_modules/.bin/vitest run'] }],
    buildOutputs: [{ path: 'server/dist', package: 'server', build: ['npm', 'run', 'build'] }],
    systemTools: ['git'],
  }, null, 2);
}

/** A commit on the upstream's main, through a scratch clone. */
function upstreamCommit(w: World, file: string, text: string, msg: string): void {
  const dir = mkTmp('tb3-up-');
  w.git(dir, 'clone', '-q', w.upstream, 'c');
  const c = path.join(dir, 'c');
  mkdirSync(path.dirname(path.join(c, file)), { recursive: true });
  writeFileSync(path.join(c, file), text);
  w.git(c, 'add', '-A');
  w.git(c, 'commit', '-qm', msg);
  w.git(c, 'push', '-q', 'origin', 'main');
}

/** spec §5 row 1's session: a branch two commits ahead of origin/main, one staged, one unstaged and one untracked
 *  change, ignored files beside them, and a stash entry (which must stay where it is). */
function dirtySession(w: World): void {
  w.git(w.clone, 'worktree', 'add', '-q', '--no-track', '-b', 'feat', w.sess, 'origin/main');
  writeFileSync(path.join(w.sess, 'pwa', 'b.ts'), 'export const b = 2;\n');
  w.git(w.sess, 'commit', '-qam', 'feat 1: pwa');
  writeFileSync(path.join(w.sess, 'README.md'), 'project-a, stashed\n');
  w.git(w.sess, 'stash', '-q');
  writeFileSync(path.join(w.sess, 'server', 'c.ts'), 'export const c = 1;\n');
  w.git(w.sess, 'add', 'server/c.ts');
  w.git(w.sess, 'commit', '-qm', 'feat 2: server');
  writeFileSync(path.join(w.sess, 'server', 'a.ts'), 'export const a = 2; // staged\n');
  w.git(w.sess, 'add', 'server/a.ts');
  writeFileSync(path.join(w.sess, 'README.md'), 'project-a, unstaged\n');
  writeFileSync(path.join(w.sess, 'notes.txt'), 'untracked\n');
  mkdirSync(path.join(w.sess, 'server', 'dist'), { recursive: true });
  writeFileSync(path.join(w.sess, 'server', 'dist', 'index.js'), 'ignored build output\n');
  writeFileSync(path.join(w.sess, 'run.log'), 'ignored\n');
}

interface SnapOpts { base?: string; mirror?: string; fileMax?: number; snapMax?: number; deny?: string; outputs?: string[]; env?: NodeJS.ProcessEnv; cwd?: string }

function snap(w: World, o: SnapOpts = {}): Ran {
  const args = [SNAP, '--git-url-base', o.base ?? '', '--mirror-path', o.mirror ?? w.mirror,
    '--untracked-file-max', String(o.fileMax ?? FILE_MAX), '--snapshot-max', String(o.snapMax ?? SNAP_MAX),
    '--deny-globs', o.deny ?? DENY];
  for (const out of o.outputs ?? ['server/dist', 'agent/dist']) args.push('--output', out);
  return sh('bash', args, o.cwd ?? w.sess, { ...w.env, ...(o.env ?? {}) });
}

interface Frame { runId: string; branch: string | null; refs: string[]; outputs: string[]; forward: Record<string, string> }

function frameOf(r: Ran): Frame {
  expect(r.status, `snapshot exit (${r.stdout}${r.stderr})`).toBe(0);
  const lines = r.stdout.split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as Frame;
}

function checkout(w: World, f: Frame, dest: string, env: NodeJS.ProcessEnv = {}): Ran {
  const args = [CHECKOUT, '--mirror', w.mirror, '--run-id', f.runId, '--fetch-url', w.upstream, '--dest', dest];
  if (f.branch !== null) args.push('--branch', f.branch);
  return sh('bash', args, w.root, { ...w.env, ...env });
}

/** spec §2.1's owner layout: the mirror is the service's, the push user and the run user are other users. git's own
 *  switch GIT_TEST_ASSUME_DIFFERENT_OWNER makes every repository look foreign to the process that has it, so a row
 *  allows the directories its user owns and leaves the mirror foreign. The fixture is checked to bite on this git. */
const FOREIGN: NodeJS.ProcessEnv = { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' };
function expectForeign(w: World, repo: string): void {
  const r = sh('git', ['rev-parse', '--git-dir'], repo, { ...w.env, ...FOREIGN });
  expect({ status: r.status, dubious: /dubious ownership/.test(r.stderr) }, 'the foreign-owner fixture bites').toEqual({ status: 128, dubious: true });
}

const scratchRefs = (w: World, repo: string): string => w.git(repo, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/ccrc-test');

// ---------------------------------------------------------------------------------------------------------------
// The probe: spec §5 row 1's seven reads, the reads of spec §2.1's "What a test sees" table, and a copy of
// consolidation-path-guard's diff check (its guardBase outside a merge_group, diffFiles, rangeMessages, pathGuard).
// ---------------------------------------------------------------------------------------------------------------

const W1A_OWNED: readonly string[] = ['shared/switches.ts', 'server/src/notice.ts'];
const W1A_NUMBER = /\bD-(?:585[5-9]|5860)(?!\d)/;
function pathGuard(files: readonly string[], messages: readonly string[] = []): { owned: string[]; w1aCommits: number; pwa: string[]; red: boolean } {
  const owned = files.filter((f) => W1A_OWNED.includes(f));
  const w1aCommits = messages.filter((m) => W1A_NUMBER.test(m)).length;
  const pwa = files.filter((f) => f.startsWith('pwa/'));
  return { owned, w1aCommits, pwa, red: (owned.length > 0 || w1aCommits > 0) && pwa.length > 0 };
}

function probe(w: World, cwd: string, forward: Record<string, string> = {}): string {
  const env = { ...w.env, ...forward };
  const read = (...a: string[]): string => {
    const r = sh('git', a, cwd, env);
    return r.status === 0 ? r.stdout : `<exit ${r.status}>`;
  };
  const verify = (ref: string): boolean => sh('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd, env).status === 0;
  let base: string | null = null;
  for (const ref of [env.CCRC_HISTORY_BASE, 'origin/main'].filter((x): x is string => Boolean(x))) {
    if (verify(ref)) { base = read('merge-base', ref, 'HEAD').trim(); break; }
  }
  const files = base === null ? [] : read('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  const messages = base === null ? [] : read('log', '--format=%B%x00', `${base}..HEAD`).split('\0').map((m) => m.trim()).filter(Boolean);
  const mb = read('merge-base', 'origin/main', 'HEAD').trim();
  return JSON.stringify({
    head: read('rev-parse', 'HEAD'),
    abbrev: read('rev-parse', '--abbrev-ref', 'HEAD'),
    originMain: read('rev-parse', 'origin/main'),
    mergeBase: mb,
    diffNames: read('diff', '--name-only', mb, 'HEAD'),
    revCount: read('rev-list', '--count', `${mb}..HEAD`),
    status: read('status', '--porcelain'),
    diff: read('diff'),
    diffCached: read('diff', '--cached'),
    originUrl: read('remote', 'get-url', 'origin'),
    guard: { base, files, messages, verdict: pathGuard(files, messages) },
  }, null, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// The untouched census (§Review focus 2): every file of the session's worktree and of its repository's git
// directory outside objects/, by size, mtime and content, plus the index bytes, the stash, the reflogs, the refs and
// the worktree listing.
// ---------------------------------------------------------------------------------------------------------------

function walk(dir: string, skip: (rel: string) => boolean, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(base, p);
    if (skip(rel)) continue;
    const st = lstatSync(p);
    if (st.isDirectory()) { walk(p, skip, base, out); continue; }
    const hash = st.isFile() ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'link';
    out[rel] = `${st.size} ${st.mtimeMs} ${hash}`;
  }
  return out;
}

interface Census { files: Record<string, string>; gitdir: Record<string, string>; index: string; stash: string; reflog: string; refs: string; worktrees: string }

function census(w: World, sess: string): Census {
  const indexPath = path.resolve(sess, w.git(sess, 'rev-parse', '--git-path', 'index').trim());
  const common = path.resolve(sess, w.git(sess, 'rev-parse', '--git-common-dir').trim());
  return {
    files: walk(sess, (rel) => rel === '.git' && !lstatSync(path.join(sess, rel)).isFile()),
    gitdir: walk(common, (rel) => rel === 'objects'),
    index: createHash('sha256').update(readFileSync(indexPath)).digest('hex'),
    stash: w.git(sess, 'stash', 'list'),
    reflog: w.git(sess, 'log', '-g', '--all', '--format=%H %gd %gs'),
    refs: w.git(sess, 'for-each-ref'),
    worktrees: w.git(sess, 'worktree', 'list', '--porcelain'),
  };
}

/** The writes the snapshot made to the session's index, stash and refs (the counted exit), and every other change. */
function changed(a: Census, b: Census): string[] {
  const out: string[] = [];
  for (const k of ['index', 'stash', 'reflog', 'refs', 'worktrees'] as const) if (a[k] !== b[k]) out.push(k);
  for (const side of ['files', 'gitdir'] as const) {
    for (const k of new Set([...Object.keys(a[side]), ...Object.keys(b[side])])) if (a[side][k] !== b[side][k]) out.push(`${side}:${k}`);
  }
  return out;
}

const objectCount = (w: World, repo: string): string => w.git(repo, 'count-objects', '-v');

/** TESTBOX_FALLBACK's printed texts, each as a pattern with its `<…>` holes open. */
const FALLBACK_PATTERNS = TESTBOX_FALLBACK.map((r) => new RegExp(`^${r.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>/g, '.+')}$`));
const inFallbackWords = (line: string): boolean => FALLBACK_PATTERNS.some((p) => p.test(line));

/** A refused snapshot: exit 3, one `test box:` line on stdout in TESTBOX_FALLBACK's words, nothing on the mirror. */
function expectFallback(w: World, r: Ran, line: string): void {
  expect({ status: r.status, stdout: r.stdout }).toEqual({ status: 3, stdout: `${line}\n` });
  expect(inFallbackWords(line), `${line} is in TESTBOX_FALLBACK's words`).toBe(true);
  expect(scratchRefs(w, w.mirror)).toBe('');
}

// ---------------------------------------------------------------------------------------------------------------
// The snapshot (Linux and macOS)
// ---------------------------------------------------------------------------------------------------------------

describe('the snapshot: the frame and the pushed refs (spec §2.1 "What a submission carries")', () => {
  it('git --version (recorded: the CI image is the base this runs on)', () => {
    const v = spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.trim();
    console.log(`testbox-transport: ${v} on ${process.platform}`);
    expect(v).toMatch(/^git version \d+\.\d+/);
  });

  it('a dirty session: one JSON line of the frame\'s git fields; head, base and snap pushed; S_W over S_I over HEAD', () => {
    const w = world();
    dirtySession(w);
    const f = frameOf(snap(w, { cwd: path.join(w.sess, 'server') }));
    expect(Object.keys(f)).toEqual(['runId', 'branch', 'refs', 'outputs', 'forward']);
    expect(f.runId).toMatch(/^[0-9a-f]{32}$/);
    expect(f).toMatchObject({ branch: 'feat', refs: ['head', 'base', 'snap'], outputs: ['server/dist'], forward: {} });
    for (const ref of f.refs) expect(Object.prototype.hasOwnProperty.call(TESTBOX_REF_MAP, ref)).toBe(true);
    const at = (ref: string): string => w.git(w.mirror, 'rev-parse', `refs/ccrc-test/${f.runId}/${ref}`).trim();
    expect(at('head')).toBe(w.git(w.sess, 'rev-parse', 'HEAD').trim());
    expect(at('base')).toBe(w.git(w.sess, 'rev-parse', 'origin/main').trim());
    // S_I's tree is the staged tree, S_W's the worktree's (untracked included, ignored excluded).
    expect(w.git(w.mirror, 'rev-parse', `${at('snap')}^1^1`).trim()).toBe(at('head'));
    expect(w.git(w.mirror, 'show', `${at('snap')}^1:server/a.ts`)).toBe('export const a = 2; // staged\n');
    expect(w.git(w.mirror, 'show', `${at('snap')}^1:README.md`)).toBe('project-a\n');
    expect(w.git(w.mirror, 'show', `${at('snap')}:README.md`)).toBe('project-a, unstaged\n');
    expect(w.git(w.mirror, 'show', `${at('snap')}:notes.txt`)).toBe('untracked\n');
    expect(w.git(w.mirror, 'ls-tree', '-r', '--name-only', at('snap'))).not.toMatch(/dist|run\.log/);
    // The carriers have a fixed identity: no prompt, no signature.
    expect(w.git(w.mirror, 'log', '-1', '--format=%an <%ae> %cn <%ce> %G?', at('snap')).trim())
      .toBe('ccrc test box <snapshot@testbox.invalid> ccrc test box <snapshot@testbox.invalid> N');
    // Nothing else reached the mirror: no branch, no tag, no other prefix.
    expect(w.git(w.mirror, 'for-each-ref', '--format=%(refname)').split('\n').filter((l) => l.startsWith('refs/ccrc-test/')))
      .toEqual(['base', 'head', 'snap'].map((r) => `refs/ccrc-test/${f.runId}/${r}`));
  }, T);

  it('a clean session sends HEAD, the branch and the base only: no trees are built, no snap ref', () => {
    const w = world();
    w.git(w.clone, 'worktree', 'add', '-q', '--no-track', '-b', 'feat', w.sess, 'origin/main');
    const before = objectCount(w, w.clone);
    const f = frameOf(snap(w));
    expect(f).toMatchObject({ branch: 'feat', refs: ['head', 'base'], outputs: [] });
    expect(objectCount(w, w.clone)).toBe(before);
  }, T);

  it('two runs draw two run ids', () => {
    const w = world();
    dirtySession(w);
    const a = frameOf(snap(w));
    const b = frameOf(snap(w));
    expect(a.runId).not.toBe(b.runId);
  }, T);

  it('a detached session: branch null', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'checkout', '-q', '--detach');
    expect(frameOf(snap(w))).toMatchObject({ branch: null, refs: ['head', 'base', 'snap'] });
  }, T);

  it('a session with no base: no base ref', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(frameOf(snap(w))).toMatchObject({ branch: 'feat', refs: ['head', 'snap'] });
  }, T);

  it('the override refs: a resolvable CCRC_HISTORY_BASE is pushed and forwarded as its sha; an unresolvable CCRC_LEDGER_BASE is forwarded unchanged', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'branch', 'stack-base', 'HEAD~1');
    const sha = w.git(w.sess, 'rev-parse', 'stack-base').trim();
    const f = frameOf(snap(w, { env: { CCRC_HISTORY_BASE: 'stack-base', CCRC_LEDGER_BASE: 'no-such-ref' } }));
    expect(f.refs).toEqual(['head', 'base', 'snap', 'history-base']);
    expect(f.forward).toEqual({ CCRC_HISTORY_BASE: sha, CCRC_LEDGER_BASE: 'no-such-ref' });
    expect(w.git(w.mirror, 'rev-parse', `refs/ccrc-test/${f.runId}/history-base`).trim()).toBe(sha);
    const g = frameOf(snap(w, { env: { CCRC_LEDGER_BASE: 'origin/main' } }));
    expect(g.refs).toEqual(['head', 'base', 'snap', 'ledger-base']);
    expect(g.forward).toEqual({ CCRC_LEDGER_BASE: w.git(w.sess, 'rev-parse', 'origin/main').trim() });
  }, T);

  it('the session\'s pre-push hook, signing config and followTags do not reach the push', () => {
    const w = world();
    dirtySession(w);
    const hooks = path.join(w.root, 'session-hooks');
    mkdirSync(hooks);
    writeFileSync(path.join(hooks, 'pre-push'), '#!/bin/sh\necho pre-push ran >&2\nexit 1\n');
    chmodSync(path.join(hooks, 'pre-push'), 0o755);
    w.git(w.sess, 'config', 'core.hooksPath', hooks);
    w.git(w.sess, 'config', 'commit.gpgSign', 'true');
    w.git(w.sess, 'config', 'gpg.program', 'false');
    w.git(w.sess, 'config', 'push.followTags', 'true');
    w.git(w.sess, 'tag', '-a', '-m', 'a tag', 'v1');
    const r = snap(w);
    expect(r.stderr).not.toMatch(/pre-push ran/);
    frameOf(r);
    expect(w.git(w.mirror, 'tag', '--list')).toBe('');
  }, T);

  it('a polluted GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE are scrubbed: the session is read, the decoy is untouched', () => {
    const w = world();
    dirtySession(w);
    const decoy = path.join(w.root, 'decoy');
    w.git(w.root, 'init', '-q', decoy);
    writeFileSync(path.join(decoy, 'decoy.txt'), 'decoy\n');
    w.git(decoy, 'add', '-A');
    w.git(decoy, 'commit', '-qm', 'decoy');
    const decoyBefore = census(w, decoy);
    const f = frameOf(snap(w, { env: {
      GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, '.git', 'index'),
      GIT_COMMON_DIR: path.join(decoy, '.git'), GIT_OBJECT_DIRECTORY: path.join(decoy, '.git', 'objects'),
    } }));
    expect(w.git(w.mirror, 'rev-parse', `refs/ccrc-test/${f.runId}/head`).trim()).toBe(w.git(w.sess, 'rev-parse', 'HEAD').trim());
    expect(changed(decoyBefore, census(w, decoy))).toEqual([]);
  }, T);
});

describe('the untouched rows (§Review focus 2): the snapshot never writes the session', () => {
  it('index bytes, git stash list, the reflogs, the refs, the worktree listing and every file\'s mtime and bytes are equal before and after', () => {
    const w = world();
    dirtySession(w);
    // A stat-dirty file the session's index has not refreshed: a clean check that refreshed the index would write it.
    const touched = path.join(w.sess, 'server', 'c.ts');
    writeFileSync(touched, readFileSync(touched));
    const before = census(w, w.sess);
    expect(before.stash).not.toBe('');
    frameOf(snap(w, { cwd: path.join(w.sess, 'server') }));
    const writes = changed(before, census(w, w.sess));
    console.log(`testbox-transport: counted exit, writes to the session's index, stash or refs by the snapshot: ${writes.filter((k) => ['index', 'stash', 'refs', 'reflog'].includes(k)).length}`);
    expect(writes).toEqual([]);
  }, T);

  it('the same for each refusal: refused, too large, origin', () => {
    const w = world();
    dirtySession(w);
    writeFileSync(path.join(w.sess, 'big.bin'), Buffer.alloc(FILE_MAX + 1, 7));
    writeFileSync(path.join(w.sess, 'id_fixture'), 'not a key\n');
    const before = census(w, w.sess);
    expect(snap(w).stdout).toBe('test box: snapshot refused (id_fixture)\n');
    expect(snap(w, { deny: '' }).stdout).toBe(`test box: snapshot too large (big.bin ${FILE_MAX + 1})\n`);
    expect(changed(before, census(w, w.sess))).toEqual([]);
    rmSync(path.join(w.sess, 'big.bin'));
    rmSync(path.join(w.sess, 'id_fixture'));
    const clean = census(w, w.sess);
    expect(snap(w, { mirror: w.upstream }).stdout).toMatch(/^test box: unreachable \(push: /);
    expect(changed(clean, census(w, w.sess))).toEqual([]);
  }, T);
});

describe('the caps (spec §2.1 "Size caps"): over a cap, nothing is hashed and nothing is sent', () => {
  it('an untracked file over the file cap is named with its size and never hashed (git count-objects before and after)', () => {
    const w = world();
    dirtySession(w);
    const big = path.join(w.sess, 'scratch', 'dump.bin');
    mkdirSync(path.dirname(big));
    writeFileSync(big, Buffer.alloc(FILE_MAX + 1, 1));
    writeFileSync(path.join(w.sess, 'small.bin'), Buffer.alloc(FILE_MAX - 1, 2));
    const before = objectCount(w, w.clone);
    expectFallback(w, snap(w), `test box: snapshot too large (scratch/dump.bin ${FILE_MAX + 1})`);
    expect(objectCount(w, w.clone)).toBe(before);
    const id = w.git(w.sess, 'hash-object', 'scratch/dump.bin').trim();
    expect(w.gitRan(w.sess, 'cat-file', '-e', id).status).not.toBe(0);
  }, T);

  it('a file at the cap passes; untracked and modified sizes over the snapshot cap name the largest', () => {
    const w = world();
    dirtySession(w);
    writeFileSync(path.join(w.sess, 'at-cap.bin'), Buffer.alloc(FILE_MAX, 3));
    frameOf(snap(w));
    writeFileSync(path.join(w.sess, 'server', 'a.ts'), Buffer.alloc(FILE_MAX * 3, 4));
    const before = objectCount(w, w.clone);
    const r = snap(w, { snapMax: FILE_MAX * 2 });
    expect(r.stdout).toBe(`test box: snapshot too large (server/a.ts ${FILE_MAX * 3})\n`);
    expect(r.status).toBe(3);
    expect(objectCount(w, w.clone)).toBe(before);
  }, T);

  it('an ignored file over the cap is not counted', () => {
    const w = world();
    dirtySession(w);
    writeFileSync(path.join(w.sess, 'server', 'dist', 'huge.js'), Buffer.alloc(FILE_MAX * 4, 5));
    frameOf(snap(w));
  }, T);
});

describe('the deny list (spec §2.3): untracked, unignored paths matching a glob are refused by name', () => {
  it('names every matching path, by basename or full path; an ignored match is not named', () => {
    const w = world();
    dirtySession(w);
    mkdirSync(path.join(w.sess, 'certs'));
    writeFileSync(path.join(w.sess, 'certs', 'server.pem'), 'x\n');
    writeFileSync(path.join(w.sess, '.env.local'), 'x\n');
    writeFileSync(path.join(w.sess, 'server', 'dist', 'leak.key'), 'x\n');
    const before = objectCount(w, w.clone);
    expectFallback(w, snap(w), 'test box: snapshot refused (.env.local certs/server.pem)');
    expect(objectCount(w, w.clone)).toBe(before);
  }, T);

  it('an empty deny list refuses nothing', () => {
    const w = world();
    dirtySession(w);
    writeFileSync(path.join(w.sess, '.env'), 'x\n');
    frameOf(snap(w, { deny: '' }));
  }, T);
});

describe('unmerged paths (spec §2.1 step 2)', () => {
  it('an index with unmerged entries falls back with `test box: unmerged paths`', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'reset', '-q', '--hard');
    w.git(w.sess, 'checkout', '-q', '-b', 'other', 'HEAD~1');
    writeFileSync(path.join(w.sess, 'server', 'c.ts'), 'export const c = 3;\n');
    w.git(w.sess, 'add', '-A');
    w.git(w.sess, 'commit', '-qm', 'other');
    expect(w.gitRan(w.sess, 'merge', 'feat').status).not.toBe(0);
    const before = census(w, w.sess);
    expectFallback(w, snap(w), 'test box: unmerged paths');
    expect(changed(before, census(w, w.sess))).toEqual([]);
  }, T);
});

describe('never origin (§Review focus 1): a mirror URL equal to a remote of the clone sends nothing', () => {
  const nothingSent = (w: World, before: string): void => {
    expect(scratchRefs(w, w.upstream)).toBe('');
    expect(objectCount(w, w.upstream)).toBe(before);
  };

  it('CCRC_TESTBOX_GIT_URL_BASE equal to origin\'s URL', () => {
    const w = world();
    dirtySession(w);
    const before = objectCount(w, w.upstream);
    expectFallback(w, snap(w, { base: w.upstream }), 'test box: unreachable (push: the mirror URL is this clone\'s remote origin)');
    nothingSent(w, before);
  }, T);

  it('a mirror URL that is origin\'s, spelled as a path, as file:// or with a trailing slash', () => {
    const w = world();
    dirtySession(w);
    const before = objectCount(w, w.upstream);
    for (const o of [{ mirror: w.upstream }, { base: 'file://', mirror: w.upstream }, { mirror: `${w.upstream}/` }]) {
      expectFallback(w, snap(w, o), 'test box: unreachable (push: the mirror URL is this clone\'s remote origin)');
    }
    nothingSent(w, before);
  }, T);

  it('any remote, not only origin, and its push URL too', () => {
    const w = world();
    dirtySession(w);
    const elsewhere = path.join(w.root, 'elsewhere.git');
    w.git(w.root, 'init', '-q', '--bare', elsewhere);
    w.git(w.sess, 'remote', 'add', 'fork', 'https://testbox.invalid/fork.git');
    w.git(w.sess, 'remote', 'set-url', '--push', 'fork', elsewhere);
    expectFallback(w, snap(w, { mirror: elsewhere }), 'test box: unreachable (push: the mirror URL is this clone\'s remote fork)');
    expect(scratchRefs(w, elsewhere)).toBe('');
  }, T);

  // A network remote spelled two ways: ssh:// against the scp form, the host in another case, another user, the default
  // port. GIT_SSH=false: nothing connects, so a push that is not refused fails `unreachable (git push: ...)`.
  const NO_SSH: NodeJS.ProcessEnv = { GIT_SSH: 'false', GIT_SSH_VARIANT: 'simple' };
  const ORIGIN_REFUSED = 'test box: unreachable (push: the mirror URL is this clone\'s remote origin)';

  it('origin scp-like, the mirror URL ssh:// (host case, user, port, trailing slash)', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'remote', 'set-url', 'origin', 'git@testbox.invalid:org/r.git');
    for (const base of ['ssh://git@testbox.invalid', 'ssh://git@TESTBOX.invalid', 'ssh://other@testbox.invalid:22/', 'ssh://testbox.invalid']) {
      expectFallback(w, snap(w, { base, mirror: '/org/r.git', env: NO_SSH }), ORIGIN_REFUSED);
    }
    expectFallback(w, snap(w, { base: 'ssh://git@testbox.invalid', mirror: '/org/r', env: NO_SSH }), ORIGIN_REFUSED);
  }, T);

  it('origin ssh://, the mirror URL scp-like; a path in another case on the same host', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'remote', 'set-url', 'origin', 'ssh://git@Testbox.Invalid:22/Org/R.git');
    for (const base of ['git@testbox.invalid:', 'testbox.invalid:']) {
      expectFallback(w, snap(w, { base, mirror: '/org/r.git', env: NO_SSH }), ORIGIN_REFUSED);
    }
  }, T);

  it('another path on the same host is not origin: the push is tried (and, with no ssh, fails unreachable)', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'remote', 'set-url', 'origin', 'git@testbox.invalid:org/r.git');
    const r = snap(w, { base: 'ssh://git@testbox.invalid', mirror: '/srv/mirrors/r.git', env: NO_SSH });
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/^test box: unreachable \(git push: .+\)\n$/);
  }, T);
});

describe('the fallback lines are TESTBOX_FALLBACK\'s words', () => {
  it('every `test box:` reason the snapshot and the checkout can print fits one of TESTBOX_FALLBACK\'s rows', () => {
    const literals: string[] = [];
    for (const m of readFileSync(SNAP, 'utf8').matchAll(/_tbs_fall (['"])(.*)\1(?=;|\s|$)/gm)) literals.push(`test box: ${m[2]}`);
    for (const m of readFileSync(CHECKOUT, 'utf8').matchAll(/'(test box: [^']+)'/g)) literals.push(m[1]);
    expect(literals.length).toBeGreaterThan(10);
    const filled = literals.map((l) => l.replace(/\$\([^)]*\)|\$\{[^}]+\}|\$[A-Za-z_]+|%s/g, 'x').replace(/\\n$/, ''));
    expect(filled.filter((l) => !inFallbackWords(l))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The box side: the hook, the forced command and the checkout (Linux only)
// ---------------------------------------------------------------------------------------------------------------

const ZERO = '0'.repeat(40);
const RUN_A = 'a'.repeat(32);
const RUN_B = 'b'.repeat(32);

describe.skipIf(!LINUX)('the pre-receive hook (spec §2.1 "the create-only rule"), run directly', () => {
  const hook = (w: World, lines: string[]): Ran => sh('bash', [HOOK], w.mirror, { ...w.env, GIT_DIR: w.mirror }, `${lines.join('\n')}\n`);
  const sha = (w: World): string => w.git(w.mirror, 'rev-parse', 'main').trim();

  it('accepts creations of a run\'s scratch refs under one fresh run id', () => {
    const w = world();
    const s = sha(w);
    expect(hook(w, [`${ZERO} ${s} refs/ccrc-test/${RUN_A}/head`, `${ZERO} ${s} refs/ccrc-test/${RUN_A}/base`, `${ZERO} ${s} refs/ccrc-test/${RUN_A}/snap`]).status).toBe(0);
  }, T);

  it.each([
    ['a branch ref', (s: string) => [`${ZERO} ${s} refs/ccrc-test/${RUN_A}/head`, `${ZERO} ${s} refs/heads/main2`]],
    ['a tag', (s: string) => [`${ZERO} ${s} refs/tags/v1`]],
    ['an update of an existing ref', (s: string) => [`${s} ${s} refs/ccrc-test/${RUN_A}/head`]],
    ['a deletion', (s: string) => [`${s} ${ZERO} refs/ccrc-test/${RUN_A}/head`]],
    ['two prefixes in one push', (s: string) => [`${ZERO} ${s} refs/ccrc-test/${RUN_A}/head`, `${ZERO} ${s} refs/ccrc-test/${RUN_B}/head`]],
    ['a run id that is not 32 hex', (s: string) => [`${ZERO} ${s} refs/ccrc-test/${'A'.repeat(32)}/head`]],
    ['a name outside the five', (s: string) => [`${ZERO} ${s} refs/ccrc-test/${RUN_A}/other`]],
    ['a nested name', (s: string) => [`${ZERO} ${s} refs/ccrc-test/${RUN_A}/head/x`]],
  ])('refuses the whole push: %s', (_n, lines) => {
    const w = world();
    const r = hook(w, lines(sha(w)));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^test box mirror: push refused whole: /);
  }, T);

  it('refuses a reused run id: the prefix already holds a ref', () => {
    const w = world();
    const s = sha(w);
    w.git(w.mirror, 'update-ref', `refs/ccrc-test/${RUN_A}/head`, s);
    const r = hook(w, [`${ZERO} ${s} refs/ccrc-test/${RUN_A}/snap`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`the run id already holds a ref (refs/ccrc-test/${RUN_A}/head)`);
  }, T);

  it('through a real push: a push with one bad ref lands none of its refs; a reused run id pushed again lands nothing', () => {
    const w = world();
    dirtySession(w);
    const head = w.git(w.sess, 'rev-parse', 'HEAD').trim();
    const bad = w.gitRan(w.sess, 'push', '-q', '--no-verify', w.mirror, `${head}:refs/ccrc-test/${RUN_A}/head`, `${head}:refs/heads/leak`);
    expect(bad.status).not.toBe(0);
    expect(w.git(w.mirror, 'for-each-ref', '--format=%(refname)', 'refs/ccrc-test', 'refs/heads/leak')).toBe('');
    expect(w.gitRan(w.sess, 'push', '-q', '--no-verify', w.mirror, `${head}:refs/ccrc-test/${RUN_A}/head`).status).toBe(0);
    expect(w.gitRan(w.sess, 'push', '-q', '--no-verify', w.mirror, `${head}:refs/ccrc-test/${RUN_A}/snap`).status).not.toBe(0);
    expect(scratchRefs(w, w.mirror)).toBe(`refs/ccrc-test/${RUN_A}/head ${head}\n`);
  }, T);
});

/** A fixed GIT_SSH driver standing in for sshd and authorized_keys' forced command: git calls it as
 *  `<driver> <host> <command>` (GIT_SSH_VARIANT=simple); it runs the forced command with SSH_ORIGINAL_COMMAND set to
 *  the command git asked for. Paths reach it through the environment, never through a built command line. */
// TB3_FOREIGN=1: the forced command runs as a user who does not own the mirror (spec §2.1's push user).
const SSH_DRIVER = '#!/bin/sh\n[ "$1" = testbox.invalid ] || exit 255\nSSH_ORIGINAL_COMMAND=$2\nexport SSH_ORIGINAL_COMMAND\n'
  + 'if [ -n "$TB3_FOREIGN" ]; then GIT_TEST_ASSUME_DIFFERENT_OWNER=1; export GIT_TEST_ASSUME_DIFFERENT_OWNER; fi\n'
  + 'exec bash "$TB3_PUSH_COMMAND" "$TB3_REPOS"\n';

describe.skipIf(!LINUX)('the forced command (spec §2.1 "The push user")', () => {
  const forced = (w: World, cmd: string | undefined, marker: string): Ran => {
    const env: NodeJS.ProcessEnv = { ...w.env, TB3_MARKER: marker };
    if (cmd !== undefined) env.SSH_ORIGINAL_COMMAND = cmd;
    return sh('bash', [PUSH_COMMAND, w.table], w.root, env, '');
  };

  it('the repository table row is parseRepoRow\'s shape', () => {
    const w = world();
    const r = parseRepoRow(readFileSync(path.join(w.table, 'project-a.json'), 'utf8'));
    expect(r.ok && r.value.mirrorPath).toBe(w.mirror);
  }, T);

  it('a snapshot pushed over the forced command lands its refs (git-receive-pack \'<listed mirror>\')', () => {
    const w = world();
    dirtySession(w);
    const driver = path.join(w.root, 'ssh-driver');
    writeFileSync(driver, SSH_DRIVER);
    chmodSync(driver, 0o755);
    const f = frameOf(snap(w, { base: 'ssh://testbox.invalid', env: { GIT_SSH: driver, GIT_SSH_VARIANT: 'simple', TB3_PUSH_COMMAND: PUSH_COMMAND, TB3_REPOS: w.table } }));
    expect(scratchRefs(w, w.mirror).split('\n').filter(Boolean)).toHaveLength(3);
    expect(f.refs).toEqual(['head', 'base', 'snap']);
  }, T);

  it('a mirror the push user does not own (the service owns it): the push still lands', () => {
    const w = world();
    dirtySession(w);
    expectForeign(w, w.mirror);
    const driver = path.join(w.root, 'ssh-driver');
    writeFileSync(driver, SSH_DRIVER);
    chmodSync(driver, 0o755);
    const f = frameOf(snap(w, { base: 'ssh://testbox.invalid', env: { GIT_SSH: driver, GIT_SSH_VARIANT: 'simple', TB3_PUSH_COMMAND: PUSH_COMMAND, TB3_REPOS: w.table, TB3_FOREIGN: '1' } }));
    expect(scratchRefs(w, w.mirror).split('\n').filter(Boolean)).toHaveLength(3);
    expect(f.refs).toEqual(['head', 'base', 'snap']);
  }, T);

  it.each([
    ['no command', undefined],
    ['a fetch', (m: string) => `git-upload-pack '${m}'`],
    ['an archive', (m: string) => `git-upload-archive '${m}'`],
    ['a mirror the table does not list', (m: string) => `git-receive-pack '${m}.other'`],
    ['a relative path', () => "git-receive-pack 'mirrors/project-a.git'"],
    ['an unquoted path', (m: string) => `git-receive-pack ${m}`],
    ['a trailing command', (m: string) => `git-receive-pack '${m}'; touch "$TB3_MARKER"`],
    ['a shell', () => 'sh -c \'touch "$TB3_MARKER"\''],
    ['the space form', (m: string) => `git receive-pack '${m}'`],
  ])('refuses any other command: %s', (_n, cmd) => {
    const w = world();
    const marker = path.join(w.root, 'ran');
    const r = forced(w, typeof cmd === 'function' ? cmd(w.mirror) : cmd, marker);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^test box push: refused: /);
    expect(r.stdout).toBe('');
    expect(existsSync(marker)).toBe(false);
  }, T);

  it('a table row with two mirrorPath members, or a symlinked row, lists nothing', () => {
    const w = world();
    writeFileSync(path.join(w.table, 'project-a.json'), `{"mirrorPath": "${w.mirror}", "mirrorPath": "/elsewhere"}`);
    expect(forced(w, `git-receive-pack '${w.mirror}'`, path.join(w.root, 'm')).status).toBe(1);
  }, T);
});

describe.skipIf(!LINUX)('the run\'s checkout (spec §2.1 "The run\'s checkout"; spec §5 row 1\'s git-state fixture)', () => {
  /** The session newer than the mirror (the mirror has not fetched the session's origin/main), or older (the mirror
   *  fetched a main the session never saw). */
  function skewed(order: 'session-newer' | 'session-older'): World {
    const w = world();
    upstreamCommit(w, 'server/later.ts', 'export const later = 1;\n', 'c2: later on main');
    if (order === 'session-newer') w.git(w.clone, 'fetch', '-q', 'origin');
    else w.git(w.mirror, 'fetch', '-q', '--prune', 'origin');
    dirtySession(w);
    return w;
  }

  it.each(['session-newer', 'session-older'] as const)('the probe\'s reads and the diff guard are byte-identical, local versus checkout (%s)', (order) => {
    const w = skewed(order);
    const local = w.git(w.sess, 'rev-parse', 'origin/main').trim();
    const mirrorMain = w.git(w.mirror, 'rev-parse', 'refs/remotes/origin/main').trim();
    expect(local === mirrorMain, 'the fixture skews the two').toBe(false);
    const f = frameOf(snap(w));
    const co = path.join(w.root, 'run', 'checkout');
    mkdirSync(path.dirname(co));
    expect(checkout(w, f, co)).toEqual({ status: 0, stdout: '', stderr: '' });
    const a = probe(w, w.sess);
    expect(JSON.parse(a).status).toBe(' M README.md\nM  server/a.ts\n?? notes.txt\n');
    expect(JSON.parse(a).guard.verdict.pwa).toEqual(['pwa/b.ts']);
    expect(probe(w, co)).toBe(a);
    // The checkout holds the run's refs and origin/main only: no mirror ref was copied.
    expect(w.git(co, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean).sort())
      .toEqual(['refs/ccrc-test/run/base', 'refs/ccrc-test/run/head', 'refs/ccrc-test/run/snap', 'refs/heads/feat', 'refs/remotes/origin/main']);
  }, T);

  it('the override: CCRC_HISTORY_BASE as a local-only branch reaches the guard as its sha, the same base on both sides', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'branch', 'stack-base', 'HEAD~1');
    const f = frameOf(snap(w, { env: { CCRC_HISTORY_BASE: 'stack-base' } }));
    const co = path.join(w.root, 'co');
    expect(checkout(w, f, co).status).toBe(0);
    const local = JSON.parse(probe(w, w.sess, { CCRC_HISTORY_BASE: 'stack-base' })).guard;
    expect(local.files).toEqual(['server/c.ts']);
    expect(JSON.parse(probe(w, co, f.forward)).guard).toEqual(local);
  }, T);

  it('a detached session checks out detached; the reads are identical', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'checkout', '-q', '--detach');
    const f = frameOf(snap(w));
    const co = path.join(w.root, 'co');
    expect(checkout(w, f, co).status).toBe(0);
    const a = probe(w, w.sess);
    expect(JSON.parse(a).abbrev).toBe('HEAD\n');
    expect(probe(w, co)).toBe(a);
  }, T);

  it('a session with no base: no origin/main on either side; the reads are identical', () => {
    const w = world();
    dirtySession(w);
    w.git(w.sess, 'update-ref', '-d', 'refs/remotes/origin/main');
    const f = frameOf(snap(w));
    const co = path.join(w.root, 'co');
    expect(checkout(w, f, co).status).toBe(0);
    const a = probe(w, w.sess);
    expect(JSON.parse(a).originMain).toMatch(/^<exit /);
    expect(probe(w, co)).toBe(a);
  }, T);

  it('a clean session: the checkout is clean on the branch', () => {
    const w = world();
    w.git(w.clone, 'worktree', 'add', '-q', '--no-track', '-b', 'feat', w.sess, 'origin/main');
    const f = frameOf(snap(w));
    const co = path.join(w.root, 'co');
    expect(checkout(w, f, co).status).toBe(0);
    expect(probe(w, co)).toBe(probe(w, w.sess));
  }, T);

  it('spec §5 row 2: a dirty submission prepared, git gc --prune=now in the mirror, git fsck in the checkout reports no missing object', () => {
    const w = world();
    dirtySession(w);
    const f = frameOf(snap(w));
    const co = path.join(w.root, 'co');
    expect(checkout(w, f, co).status).toBe(0);
    w.git(w.mirror, 'gc', '-q', '--prune=now');
    const fsck = w.gitRan(co, 'fsck', '--full', '--no-dangling');
    expect(fsck.status, fsck.stderr).toBe(0);
    expect(`${fsck.stdout}${fsck.stderr}`).not.toMatch(/missing/);
    expect(probe(w, co)).toBe(probe(w, w.sess));
  }, T);

  it('a mirror the run user does not own (the service owns it, the run user only reads it): the checkout is the same', () => {
    const w = world();
    dirtySession(w);
    expectForeign(w, w.mirror);
    const f = frameOf(snap(w));
    const co = path.join(w.root, 'co');
    // The run user owns its own checkout; the mirror stays foreign.
    appendFileSync(path.join(w.home, '.gitconfig'), `[safe]\n\tdirectory = ${co}\n`);
    expect(checkout(w, f, co, FOREIGN)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(w.git(co, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean).sort())
      .toEqual(['refs/ccrc-test/run/base', 'refs/ccrc-test/run/head', 'refs/ccrc-test/run/snap', 'refs/heads/feat', 'refs/remotes/origin/main']);
    expect(probe(w, co)).toBe(probe(w, w.sess));
  }, T);

  it('a failed step prints one `test box: prepare failed (git <step>: <detail>)` line and exits 3', () => {
    const w = world();
    const r = checkout(w, { runId: RUN_A, branch: 'feat', refs: [], outputs: [], forward: {} }, path.join(w.root, 'co'));
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/^test box: prepare failed \(git fetch: .+\)\n$/);
    expect(inFallbackWords(r.stdout.trim())).toBe(true);
  }, T);

  it('every git call runs hooks-off: a mirror-side post-checkout hook in the run\'s template never runs', () => {
    const w = world();
    dirtySession(w);
    const f = frameOf(snap(w));
    const tpl = path.join(w.root, 'tpl', 'hooks');
    mkdirSync(tpl, { recursive: true });
    const marker = path.join(w.root, 'hook-ran');
    writeFileSync(path.join(tpl, 'post-checkout'), '#!/bin/sh\ntouch "$TB3_MARKER"\n');
    chmodSync(path.join(tpl, 'post-checkout'), 0o755);
    const args = [CHECKOUT, '--mirror', w.mirror, '--run-id', f.runId, '--fetch-url', w.upstream, '--dest', path.join(w.root, 'co'), '--branch', 'feat'];
    const r = sh('bash', args, w.root, { ...w.env, GIT_TEMPLATE_DIR: path.dirname(tpl), TB3_MARKER: marker });
    expect(r.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
  }, T);
});
