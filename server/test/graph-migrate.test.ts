// Graphify revision 2, Task GR6 (D-7352, D-7666; spec §9): the sweep migrates each tree's old per-tree graphify-out
// directory onto the repository's shared link, at most CCRC_GRAPH_MIGRATE_BUDGET trees a pass and only in a repository
// whose `current` is published, and collects the store at every pass's end. Every row runs the INSTALLED sweep in a
// fixture HOME laid out as graph-repo-sweep.test.ts lays one out (the shipped tree at ~/ccrc/ccd, the fixture `ccrc
// test`, the GR3 stub engine behind a fixture venv python).
//
// Rows: N15 (a busy tree is not cleaned; an unexpected top-level entry refuses and touches nothing; a mount point
// refuses; a directory on another filesystem than its tree refuses; an un-ignored directory refuses `not ignored`;
// nothing outside <tree>/graphify-out is removed, by a before-and-after listing of the whole fixture HOME), N23's
// migration half (saved results moved and readable through the new link), the budget and the step order, the
// cross-filesystem `rm` arm, the excluded arm (no link; a later-excluded link unlinked), and §9.2's collection of
// `.trash` and of a gone or excluded repository's directory after CCRC_GRAPH_BUILD_GRACE_SECS.
//
// Another filesystem and a mount point are simulated by fixture `stat` and `mountpoint` commands first on PATH: they
// answer for the paths a row lists in ~/fx and hand every other call to the real command. Paths travel as arguments
// and files, never spliced into a shell string. Fixtures use project-a and lane-a.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(__dirname, '../..');
const SWEEP = path.join(REPO, 'ccd', 'ccd-graph-sweep');
const STUB = path.join(REPO, 'server', 'test', 'fixtures', 'graph-engine');
const FIXTURE_TEST = path.join(REPO, 'server', 'test', 'fixtures', 'graph-sweep', 'ccrc-test');
const T = 60_000;

let home: string;
const j = (...p: string[]): string => path.join(home, ...p);
const STORE = (): string => j('.ccrc', 'graphs');

function git(cwd: string, ...args: string[]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  Object.assign(env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env }).trim();
}
function commit(repo: string, files: Record<string, string>, msg = 'move'): string {
  for (const [f, t] of Object.entries(files)) {
    const p = path.join(repo, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, t);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', msg);
  return git(repo, 'rev-parse', 'HEAD');
}
function makeRepo(name = 'project-a', files: Record<string, string> = { 'a.py': 'x = 1\n', 'lib/b.py': 'y = 2\n' }): string {
  const d = j('projects', name);
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  commit(d, files, 'init');
  return d;
}
function addWorktree(repo: string, lane: string): string {
  const ws = j('worktrees', path.basename(repo), lane);
  fs.mkdirSync(path.dirname(ws), { recursive: true });
  git(repo, 'worktree', 'add', '-q', '-b', lane, ws);
  return ws;
}

beforeEach(() => {
  home = mkTmp('ccrc-graph-migrate-');
  for (const d of ['.ccrc', 'projects', 'ccrc/ccd', '.local/bin', 'bin', '.ccrc/graphify-venv/bin', 'fx']) fs.mkdirSync(j(...d.split('/')), { recursive: true });
  for (const f of ['ccrc', 'graph-build', 'graph-resolve']) fs.symlinkSync(path.join(REPO, 'ccd', f), j('ccrc', 'ccd', f));
  fs.symlinkSync(FIXTURE_TEST, j('ccrc', 'ccd', 'ccrc-test'));
  fs.copyFileSync(SWEEP, j('.local', 'bin', 'ccd-graph-sweep'));
  fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'python'), '#!/bin/sh\nexec python3 "$@"\n', { mode: 0o755 });
  if (spawnSync('sh', ['-c', 'command -v ionice'], { encoding: 'utf8' }).status !== 0)
    fs.writeFileSync(j('bin', 'ionice'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.9\n');
});
afterEach(() => {
  spawnSync('find', [home, '-type', 'd', '-exec', 'chmod', 'u+w', '{}', '+']);
  fs.rmSync(home, { recursive: true, force: true });
});

interface Run { status: number | null; stdout: string; stderr: string }
function sweep(env: NodeJS.ProcessEnv = {}): Run {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CCRC_|GIT_|GRAPH_STUB_|GRAPHIFY_|PYTHON)/.test(k)) e[k] = v;
  Object.assign(e, {
    HOME: home, PATH: `${j('bin')}:${process.env['PATH'] ?? ''}`, PYTHONPATH: STUB, PYTHONDONTWRITEBYTECODE: '1',
    GRAPH_STUB_RECORD: j('record.jsonl'), CCRC_GRAPH_FETCH_SECS: '0',
  });
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete e[k]; else e[k] = v; }
  const r = spawnSync('bash', [j('.local', 'bin', 'ccd-graph-sweep')], { encoding: 'utf8', env: e, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface Refusal { path: string; reason: string }
interface Row { repo_key: string; source: string; outcome: string; linked: number; migrate: { done: number; pending: number; refused: Refusal[] } }
const lastPass = (): { status: string; repos: Row[] } =>
  (JSON.parse(fs.readFileSync(j('.ccrc', 'graph-sweep.json'), 'utf8')) as { passes: { status: string; repos: Row[] }[] }).passes.at(-1)!;
const rowOf = (repo: string): Row => {
  const src = fs.realpathSync(path.join(repo, '.git'));
  const r = lastPass().repos.find((x) => x.source === src);
  expect(r, `a repos[] row for ${repo}`).toBeDefined();
  return r!;
};
const keyDir = (repo: string): string => path.join(STORE(), rowOf(repo).repo_key);
const go = (t: string): string => path.join(t, 'graphify-out');
const isLink = (p: string): boolean => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
/** The tree key (D-7666): the tree's realpath basename, then the first 8 hex of the sha256 of the realpath, the shape
 *  of graph-resolve's repository key. */
const treeKey = (t: string): string => {
  const r = fs.realpathSync(t);
  return `${path.basename(r).replace(/[^A-Za-z0-9._-]/g, '_')}-${createHash('sha256').update(r).digest('hex').slice(0, 8)}`;
};
/** An old per-tree graphify-out: graphify's own entries, plus whatever a row adds. */
function oldGraph(tree: string, extra: Record<string, string> = {}): void {
  const files: Record<string, string> = {
    'graph.json': '{"nodes":[]}', 'GRAPH_REPORT.md': '# report\n', 'manifest.json': '{}', '.graphify_engine': '0.9.0\n',
    'cache/x.json': '{}', ...extra,
  };
  for (const [f, t] of Object.entries(files)) {
    const p = path.join(go(tree), f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, t);
  }
}
/** A registered session on the tree, `working` (busy) or `idle`, as `_gs_busy` reads one. */
function session(tree: string, state: 'working' | 'idle', id = 's1'): void {
  fs.mkdirSync(j('.cc-sessions'), { recursive: true });
  fs.writeFileSync(j('.cc-sessions', `${id}.workdir`), `${tree}\n`);
  fs.writeFileSync(j('.cc-sessions', `${id}.hookstate.json`), JSON.stringify({ pid: 4242 }));
  fs.writeFileSync(j('.cc-sessions', `${id}.wrapper`), 'lane-a\n');
  fs.writeFileSync(j('.ccrc', 'accounts.sh'), '_ccrc_cfg_dir() { printf \'%s\\n\' "$HOME/cfg-$1"; }\n');
  fs.mkdirSync(j('cfg-lane-a', 'sessions'), { recursive: true });
  fs.writeFileSync(j('cfg-lane-a', 'sessions', '4242.json'), JSON.stringify({ state }));
}
/** Every path under the fixture HOME (no `.git` internals), sorted. */
const listing = (): string[] => execFileSync('find', [home, '-path', '*/.git', '-prune', '-o', '-print'], { encoding: 'utf8' })
  .split('\n').filter((l) => l !== '').sort();
const under = (dir: string): string[] => execFileSync('find', [dir, '-mindepth', '1'], { encoding: 'utf8' })
  .split('\n').filter((l) => l !== '').sort();
const contents = (dir: string): Record<string, string> => Object.fromEntries(under(dir)
  .filter((p) => fs.lstatSync(p).isFile()).map((p) => [path.relative(dir, p), fs.readFileSync(p, 'utf8')]));
/** The fixture `stat`: a path listed in ~/fx/otherfs answers device 4242 for `%d:%i`; every other call is the real one. */
function otherFs(...dirs: string[]): void {
  fs.writeFileSync(j('fx', 'otherfs'), dirs.map((d) => `${fs.realpathSync(d)}\n`).join(''));
  fs.writeFileSync(j('bin', 'stat'), [
    '#!/bin/sh',
    'for a; do last="$a"; done',
    'case "$*" in',
    '  *%d:%i*)',
    '    r="$(cd -P -- "$last" 2>/dev/null && pwd -P)" || r="$last"',
    '    if grep -qxF -- "$r" "$HOME/fx/otherfs" 2>/dev/null; then echo 4242:1; exit 0; fi ;;',
    'esac',
    'exec /usr/bin/stat "$@"',
    '',
  ].join('\n'), { mode: 0o755 });
}
/** The fixture `mountpoint`: true exactly for a directory listed in ~/fx/mounts. */
function mountPoint(dir: string): void {
  fs.writeFileSync(j('fx', 'mounts'), `${fs.realpathSync(dir)}\n`);
  fs.writeFileSync(j('bin', 'mountpoint'), [
    '#!/bin/sh',
    'for a; do last="$a"; done',
    'r="$(cd -P -- "$last" 2>/dev/null && pwd -P)" || exit 1',
    'grep -qxF -- "$r" "$HOME/fx/mounts"',
    '',
  ].join('\n'), { mode: 0o755 });
}
const trash = (): string[] => fs.existsSync(path.join(STORE(), '.trash')) ? fs.readdirSync(path.join(STORE(), '.trash')).sort() : [];

// ── N15: what refuses, what waits, what is touched ────────────────────────
describe('N15 — the migration touches only <tree>/graphify-out, and only a graphify-shaped one under an idle tree (spec §9.1)', () => {
  it('a busy tree is not cleaned: it waits, counted in pending; once idle it is migrated and linked', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    session(repo, 'working');
    const before = contents(go(repo));
    expect(sweep().status).toBe(0);
    expect(rowOf(repo).outcome).toBe('rebuilt');
    expect(isLink(go(repo))).toBe(false);
    expect(contents(go(repo))).toEqual(before);
    expect(rowOf(repo)).toMatchObject({ linked: 0, migrate: { done: 0, pending: 1, refused: [] } });
    session(repo, 'idle');
    expect(sweep().status).toBe(0);
    expect(fs.readlinkSync(go(repo))).toBe(path.join(keyDir(repo), 'current'));
    expect(rowOf(repo)).toMatchObject({ linked: 1, migrate: { done: 1, pending: 0, refused: [] } });
  });

  it('an unexpected top-level entry refuses, naming the first one, and touches nothing', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo, { 'notes.txt': 'mine\n', 'zz-later.txt': 'also mine\n' });
    const before = contents(go(repo));
    const names = under(go(repo));
    expect(sweep().status).toBe(0);
    expect(isLink(go(repo))).toBe(false);
    expect(under(go(repo))).toEqual(names);
    expect(contents(go(repo))).toEqual(before);
    expect(rowOf(repo).migrate).toEqual({ done: 0, pending: 0, refused: [{ path: repo, reason: 'unexpected entry notes.txt' }] });
    expect(trash()).toEqual([]);
  });

  it('a symlink at the top level is unexpected too, even under an allowed name', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    fs.mkdirSync(j('elsewhere'));
    fs.symlinkSync(j('elsewhere'), path.join(go(repo), 'memory'));
    sweep();
    expect(rowOf(repo).migrate.refused).toEqual([{ path: repo, reason: 'unexpected entry memory' }]);
    expect(isLink(path.join(go(repo), 'memory'))).toBe(true);
  });

  it('a mount point refuses and touches nothing', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    mountPoint(go(repo));
    const before = contents(go(repo));
    sweep();
    expect(contents(go(repo))).toEqual(before);
    expect(rowOf(repo).migrate.refused).toEqual([{ path: repo, reason: 'a mount point' }]);
  });

  it('a directory on another filesystem than its tree refuses and touches nothing', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    otherFs(go(repo));
    const before = contents(go(repo));
    sweep();
    expect(contents(go(repo))).toEqual(before);
    expect(rowOf(repo).migrate.refused).toEqual([{ path: repo, reason: 'on another filesystem than its tree' }]);
  });

  it('an un-ignored directory refuses `not ignored` and touches nothing', { timeout: T }, () => {
    const repo = makeRepo();
    commit(repo, { '.gitignore': '!graphify-out\n!graphify-out/\n' });
    oldGraph(repo);
    const before = contents(go(repo));
    sweep();
    expect(contents(go(repo))).toEqual(before);
    expect(rowOf(repo).migrate.refused).toEqual([{ path: repo, reason: 'not ignored' }]);
  });

  it('nothing outside <tree>/graphify-out is removed: a before-and-after listing of the whole fixture HOME', { timeout: T }, () => {
    const repo = makeRepo();
    const ws = addWorktree(repo, 'lane-a');
    oldGraph(repo, { 'memory/q1.md': 'saved\n' });
    oldGraph(ws);
    session(repo, 'working', 's1');
    session(ws, 'working', 's2');
    sweep();   // everything a pass creates exists now; both trees wait
    const old = [...under(go(repo)), ...under(go(ws))];
    const before = listing();
    session(repo, 'idle', 's1');
    fs.writeFileSync(j('cfg-lane-a', 'sessions', '4242.json'), JSON.stringify({ state: 'idle' }));
    expect(sweep().status).toBe(0);
    const after = listing();
    const removed = before.filter((p) => !after.includes(p));
    expect(removed).toEqual(old.sort());
    expect(isLink(go(repo)) && isLink(go(ws))).toBe(true);
  });
});

// ── N23's migration half: saved results ───────────────────────────────────
describe('N23 (migration half) — saved results move to the repository\'s memory and read through the new link', () => {
  it('memory/ moves to <store>/<repo-key>/memory/migrated-<tree-key>/ and the old directory goes to .trash', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo, { 'memory/q1.md': 'saved one\n', 'memory/sub/q2.md': 'saved two\n' });
    expect(sweep().status).toBe(0);
    const tk = treeKey(repo);
    expect(fs.readFileSync(path.join(keyDir(repo), 'memory', `migrated-${tk}`, 'q1.md'), 'utf8')).toBe('saved one\n');
    expect(fs.readFileSync(path.join(go(repo), 'memory', `migrated-${tk}`, 'sub', 'q2.md'), 'utf8')).toBe('saved two\n');
    const t = trash();
    expect(t).toHaveLength(1);
    // `<tree-key>.<digits>`, checked without building a pattern from the key
    expect(t[0]!.startsWith(`${tk}.`), `${t[0]} is not ${tk}.<n>`).toBe(true);
    expect(t[0]!.slice(tk.length + 1)).toMatch(/^[0-9]+$/);
    expect(fs.readFileSync(path.join(STORE(), '.trash', t[0]!, 'graph.json'), 'utf8')).toBe('{"nodes":[]}');
    expect(fs.existsSync(path.join(STORE(), '.trash', t[0]!, 'memory'))).toBe(false);
    expect(rowOf(repo).migrate).toEqual({ done: 1, pending: 0, refused: [] });
  });

  it('nothing migrates before the repository\'s current is published: the directory waits, counted in pending', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    sweep({ GRAPH_STUB_MODE: 'false' });
    expect(rowOf(repo).outcome).toBe('failed');
    expect(isLink(go(repo))).toBe(false);
    expect(fs.existsSync(path.join(go(repo), 'graph.json'))).toBe(true);
    expect(rowOf(repo).migrate).toEqual({ done: 0, pending: 1, refused: [] });
  });
});

// ── the budget and the order ──────────────────────────────────────────────
describe('CCRC_GRAPH_MIGRATE_BUDGET trees a pass, and the steps in spec §9.1\'s order', () => {
  it('at most the budget a pass, across the pass; the rest wait in pending and go next pass', { timeout: T }, () => {
    const repo = makeRepo();
    const a = addWorktree(repo, 'lane-a');
    const b = addWorktree(repo, 'lane-b');
    for (const t of [repo, a, b]) oldGraph(t);
    sweep({ CCRC_GRAPH_MIGRATE_BUDGET: '2' });
    expect(rowOf(repo).migrate).toEqual({ done: 2, pending: 1, refused: [] });
    expect([repo, a, b].filter((t) => isLink(go(t)))).toHaveLength(2);
    sweep({ CCRC_GRAPH_MIGRATE_BUDGET: '2' });
    expect(rowOf(repo).migrate).toEqual({ done: 1, pending: 0, refused: [] });
    expect([repo, a, b].every((t) => isLink(go(t)))).toBe(true);
  });

  it('the budget spans repositories, and a budget of 0 migrates nothing', { timeout: T }, () => {
    const p = makeRepo('project-a');
    const q = makeRepo('project-b');
    oldGraph(p); oldGraph(q);
    sweep({ CCRC_GRAPH_MIGRATE_BUDGET: '0' });
    expect([rowOf(p).migrate.pending, rowOf(q).migrate.pending]).toEqual([1, 1]);
    expect(isLink(go(p)) || isLink(go(q))).toBe(false);
    sweep({ CCRC_GRAPH_MIGRATE_BUDGET: '1' });
    expect(rowOf(p).migrate.done + rowOf(q).migrate.done).toBe(1);
  });

  it('a refusal spends no budget', { timeout: T }, () => {
    const repo = makeRepo();
    const a = addWorktree(repo, 'lane-a');
    oldGraph(repo, { 'notes.txt': 'x' });
    oldGraph(a);
    sweep({ CCRC_GRAPH_MIGRATE_BUDGET: '1' });
    expect(rowOf(repo).migrate).toEqual({ done: 1, pending: 0, refused: [{ path: repo, reason: 'unexpected entry notes.txt' }] });
    expect(isLink(go(a))).toBe(true);
  });

  it('step 1 before step 2: a busy tree that is not ignored is refused `not ignored`', { timeout: T }, () => {
    const repo = makeRepo();
    commit(repo, { '.gitignore': '!graphify-out\n!graphify-out/\n' });
    oldGraph(repo);
    session(repo, 'working');
    sweep();
    expect(rowOf(repo).migrate).toEqual({ done: 0, pending: 0, refused: [{ path: repo, reason: 'not ignored' }] });
  });

  it('step 2 before step 3: a busy tree with an unexpected entry waits, it is not refused yet', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo, { 'notes.txt': 'x' });
    session(repo, 'working');
    sweep();
    expect(rowOf(repo).migrate).toEqual({ done: 0, pending: 1, refused: [] });
  });
});

// ── step 5's two arms ─────────────────────────────────────────────────────
describe('step 5 — .trash on the store\'s filesystem, else `rm -rf --one-file-system` under ionice', () => {
  it('a store on another filesystem than the tree: the directory is removed in place, nothing goes to .trash', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo, { 'memory/q1.md': 'saved\n' });
    fs.mkdirSync(STORE(), { recursive: true });
    otherFs(STORE());
    expect(sweep().status).toBe(0);
    expect(fs.readlinkSync(go(repo))).toBe(path.join(keyDir(repo), 'current'));
    expect(trash()).toEqual([]);
    expect(fs.readFileSync(path.join(go(repo), 'memory', `migrated-${treeKey(repo)}`, 'q1.md'), 'utf8')).toBe('saved\n');
    expect(rowOf(repo).migrate).toEqual({ done: 1, pending: 0, refused: [] });
  });
});

describe('step 5 in the source: the in-place removal never crosses a mount, on either userland', () => {
  const src = fs.readFileSync(SWEEP, 'utf8');
  const body = (fn: string): string => { const m = new RegExp(`^${fn}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?\\n\\}\\n`, 'm').exec(src); expect(m, fn).not.toBeNull(); return m![0]; };
  const rms = (fn: string): string[] => body(fn).split('\n').filter((l) => /(^|\s)rm\s/.test(l) && !/^\s*#/.test(l)).map((l) => l.trim());
  it('`_gs_migrate_one` removes in place only as `rm -rf --one-file-system` (GNU) or `rm -rfx` (BSD), under ionice when present', () => {
    expect(rms('_gs_migrate_one')).toEqual([
      '${io[@]+"${io[@]}"} rm -rfx -- "$tree/graphify-out"',
      '${io[@]+"${io[@]}"} rm -rf --one-file-system -- "$tree/graphify-out"',
    ]);
    expect(body('_gs_migrate_one')).toContain('command -v ionice >/dev/null 2>&1 && io=(ionice -c3)');
  });
  it('a .trash entry is removed the same way', () => {
    expect(rms('_gs_rm_onefs')).toEqual([
      'if [ "$CCD_OS" = darwin ]; then ${io[@]+"${io[@]}"} rm -rfx -- "$doomed"',
      'else ${io[@]+"${io[@]}"} rm -rf --one-file-system -- "$doomed"; fi',
    ]);
    expect(body('_gs_rm_onefs')).toContain('command -v ionice >/dev/null 2>&1 && io=(ionice -c3)');
  });
});

// ── the excluded arm ──────────────────────────────────────────────────────
describe('excluded repositories — steps 1 to 5, no link; a link made before the exclusion is removed (spec §9.1)', () => {
  it('an excluded repository\'s old directory is migrated with no link, its saved results kept in the store', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo, { 'memory/q1.md': 'saved\n' });
    const key = (() => { sweep({ CCRC_GRAPH_MIGRATE_BUDGET: '0' }); return rowOf(repo).repo_key; })();
    expect(sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key }).status).toBe(0);
    expect(rowOf(repo).outcome).toBe('excluded');
    expect(fs.existsSync(go(repo)) || isLink(go(repo))).toBe(false);
    expect(fs.readFileSync(path.join(STORE(), key, 'memory', `migrated-${treeKey(repo)}`, 'q1.md'), 'utf8')).toBe('saved\n');
    expect(trash()).toHaveLength(1);
    expect(rowOf(repo)).toMatchObject({ linked: 0, migrate: { done: 1, pending: 0, refused: [] } });
  });

  it('an excluded repository that never published still migrates (the published gate is the link\'s, D-7666)', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    const key = (() => { sweep({ GRAPH_STUB_MODE: 'false', CCRC_GRAPH_MIGRATE_BUDGET: '0' }); return rowOf(repo).repo_key; })();
    sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key });
    expect(fs.existsSync(go(repo)) || isLink(go(repo))).toBe(false);
    expect(rowOf(repo).migrate.done).toBe(1);
  });

  it('a link made before the repository was excluded is unlinked; the store it pointed into is untouched', { timeout: T }, () => {
    const repo = makeRepo();
    const ws = addWorktree(repo, 'lane-a');
    sweep();
    expect(isLink(go(repo)) && isLink(go(ws))).toBe(true);
    const key = rowOf(repo).repo_key;
    const cur = fs.realpathSync(path.join(STORE(), key, 'current'));
    sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key });
    expect(isLink(go(repo)) || isLink(go(ws))).toBe(false);
    expect(fs.existsSync(path.join(cur, 'graph.json'))).toBe(true);
    expect(rowOf(repo).linked).toBe(0);
  });

  it('a link that points outside the store is not ours to remove, excluded or not', { timeout: T }, () => {
    const repo = makeRepo();
    sweep({ GRAPH_STUB_MODE: 'false' });
    const key = rowOf(repo).repo_key;
    fs.mkdirSync(j('mine'));
    fs.symlinkSync(j('mine'), go(repo));
    sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key });
    expect(fs.readlinkSync(go(repo))).toBe(j('mine'));
  });
});

// ── spec §9.2: steady-state collection ────────────────────────────────────
describe('collection at every pass\'s end (spec §9.2)', () => {
  const ageTrash = (secs: number): void => {
    for (const t of trash()) {
      const old = Math.floor(Date.now() / 1000) - secs;
      fs.renameSync(path.join(STORE(), '.trash', t), path.join(STORE(), '.trash', t.replace(/\.[0-9]+$/, `.${old}`)));
    }
  };

  it('.trash/* is collected once older than CCRC_GRAPH_BUILD_GRACE_SECS, and not before', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    sweep();
    expect(trash()).toHaveLength(1);
    sweep();
    expect(trash(), 'inside the grace').toHaveLength(1);
    ageTrash(3600 + 60);
    sweep();
    expect(trash()).toEqual([]);
  });

  it('the grace is the setting', { timeout: T }, () => {
    const repo = makeRepo();
    oldGraph(repo);
    sweep();
    ageTrash(120);
    sweep({ CCRC_GRAPH_BUILD_GRACE_SECS: '600' });
    expect(trash()).toHaveLength(1);
    sweep({ CCRC_GRAPH_BUILD_GRACE_SECS: '60' });
    expect(trash()).toEqual([]);
  });

  const since = (kd: string): string => path.join(kd, 'collect-since');
  const backdate = (kd: string, secs: number): void => {
    fs.writeFileSync(since(kd), `${Math.floor(Date.now() / 1000) - secs}\n`);
  };

  it('a gone repository\'s whole directory (checkout, builds, memory) goes after the grace; a live one stays', { timeout: T }, () => {
    const p = makeRepo('project-a');
    const q = makeRepo('project-b');
    sweep();
    const pd = keyDir(p); const qd = keyDir(q);
    fs.rmSync(q, { recursive: true, force: true });
    sweep();
    expect(fs.existsSync(qd), 'inside the grace').toBe(true);
    expect(fs.existsSync(since(qd))).toBe(true);
    expect(fs.existsSync(since(pd))).toBe(false);
    backdate(qd, 3600 + 60);
    sweep();
    expect(fs.existsSync(qd)).toBe(false);
    expect(fs.existsSync(path.join(pd, 'current', 'graph.json'))).toBe(true);
  });

  it('an excluded repository\'s directory goes after the grace; lifting the exclusion first clears the clock', { timeout: T }, () => {
    const repo = makeRepo();
    sweep();
    const kd = keyDir(repo); const key = rowOf(repo).repo_key;
    sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key });
    expect(fs.existsSync(since(kd))).toBe(true);
    sweep();
    expect(fs.existsSync(since(kd)), 'not excluded any more').toBe(false);
    sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key });
    backdate(kd, 3600 + 60);
    sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key });
    expect(fs.existsSync(kd)).toBe(false);
  });

  it('a directory of the store with no source file is not the sweep\'s to collect', { timeout: T }, () => {
    makeRepo();
    sweep();
    fs.mkdirSync(path.join(STORE(), 'stranger-0000abcd'));
    fs.writeFileSync(path.join(STORE(), 'stranger-0000abcd', 'keep'), 'x');
    backdate(path.join(STORE(), 'stranger-0000abcd'), 3600 + 60);   // even with an old clock in it
    sweep();
    expect(fs.existsSync(path.join(STORE(), 'stranger-0000abcd', 'keep'))).toBe(true);
  });
});
