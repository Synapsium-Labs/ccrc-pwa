// Graphify revision 2, Task GR4 (D-7350; spec §2, §3, §4, §7): ccd/ccd-graph-sweep builds ONE graph per repository,
// from its main line, in ccrc's graph store, through `ccrc test --local --heavy` and the engine wrapper, and links each
// tree's graphify-out to it. Every row runs the shipped sweep in a fixture HOME laid out as a box is: the sweep copied
// to ~/.local/bin (so it loads the shipped tree, spec §5.2), the shipped tree at ~/ccrc/ccd holding the real ccd/ccrc,
// ccd/graph-build and ccd/graph-resolve beside a fixture `ccrc test` (test/fixtures/graph-sweep/ccrc-test, which
// records its argv and runs the command as given), and the GR3 stub engine (test/fixtures/graph-engine) on PYTHONPATH
// behind a fixture venv python. The real ccd/ccrc-test runs too, in its own describe, on every host.
//
// Rows, by spec §11 number: N1 (sweep half), N2, N4, N5, N9, N10, N11, N12, N16, N21, N22, N23, N25, N27, N28
// (sweep half); every line of the plan's outcome table; the fd-9 row (§Review focus 5); the pause-file row (D-7365);
// the `unknown` rows (D-7366); the stdout row line and settings.json (D-7357, spec §5.3); and the 08-27 §9 rows 1, 4,
// 5a, 6, 7, 8, 10, 12, 13, 15, 16, 17 and 18, retargeted to the store. Fixtures use project-a and lane-a.
//
// Paths and values travel as arguments and files, never spliced into a shell string.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
/** Write (a string) or delete (null) each file, then commit everything. Returns the new commit. */
function commit(repo: string, files: Record<string, string | null>, msg = 'move'): string {
  for (const [f, t] of Object.entries(files)) {
    const p = path.join(repo, f);
    if (t === null) fs.rmSync(p, { force: true });
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); }
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', msg);
  return git(repo, 'rev-parse', 'HEAD');
}
/** A repository under the fixture HOME's projects root, on branch `main`, with one commit. */
function makeRepo(name = 'project-a', files: Record<string, string> = { 'a.py': 'x = 1\n', 'lib/b.py': 'y = 2\n' }): string {
  const d = j('projects', name);
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  commit(d, files, 'init');
  return d;
}
let bumps = 0;
function bump(repo: string, n = 1): string {
  let sha = '';
  for (let i = 0; i < n; i++) { bumps += 1; sha = commit(repo, { [`bump${bumps}.py`]: `z${bumps} = ${bumps}\n` }); }
  return sha;
}

/** The fixture box (see the header). */
beforeEach(() => {
  home = mkTmp('ccrc-graph-repo-sweep-');
  for (const d of ['.ccrc', 'projects', 'ccrc/ccd', '.local/bin', 'bin', '.ccrc/graphify-venv/bin', 'fx']) fs.mkdirSync(j(...d.split('/')), { recursive: true });
  for (const f of ['ccrc', 'graph-build', 'graph-resolve']) fs.symlinkSync(path.join(REPO, 'ccd', f), j('ccrc', 'ccd', f));
  fs.symlinkSync(FIXTURE_TEST, j('ccrc', 'ccd', 'ccrc-test'));
  fs.copyFileSync(SWEEP, j('.local', 'bin', 'ccd-graph-sweep'));
  fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'python'), '#!/bin/sh\nexec python3 "$@"\n', { mode: 0o755 });
  // macOS has no ionice; a pass-through stands in where the host has none, so the build's argv is the box's.
  if (spawnSync('sh', ['-c', 'command -v ionice'], { encoding: 'utf8' }).status !== 0)
    fs.writeFileSync(j('bin', 'ionice'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
  fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.9\n');
});
afterEach(() => {
  // A published build is read-only (0555 directories), so the fixture HOME is made removable first.
  spawnSync('find', [home, '-type', 'd', '-exec', 'chmod', 'u+w', '{}', '+']);
  fs.rmSync(home, { recursive: true, force: true });
});

interface Run { status: number | null; stdout: string; stderr: string }
const sweepEnv = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CCRC_|GIT_|GRAPH_STUB_|GRAPHIFY_|PYTHON)/.test(k)) e[k] = v;
  Object.assign(e, {
    HOME: home, PATH: `${j('bin')}:${process.env['PATH'] ?? ''}`, PYTHONPATH: STUB, PYTHONDONTWRITEBYTECODE: '1',
    GRAPH_STUB_RECORD: j('record.jsonl'), CCRC_GRAPH_FETCH_SECS: '0',
  });
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete e[k]; else e[k] = v; }
  return e;
};
/** One pass of the INSTALLED copy (~/.local/bin/ccd-graph-sweep). */
function sweep(env: NodeJS.ProcessEnv = {}, bin = j('.local', 'bin', 'ccd-graph-sweep')): Run {
  const r = spawnSync('bash', [bin], { encoding: 'utf8', env: sweepEnv(env), timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** The incremental-path rows: spec §5.4's 200, where the box-wide default is the ruled 0 (D-7634). */
const INCR = { CCRC_GRAPH_INCREMENTAL_MAX_FILES: '200' };

interface Row {
  repo_key: string; source: string; ref: string; tip: string; served: string; outcome: string; kind: string;
  changed_files: number; reason: string; fail: string; duration_ms: number; peak_mem_kb: number | null;
  cpu_ms: number | null; full_failures: number; full_failed_at: string; nodes: number; edges: number;
  linked: number; migrate: { done: number; pending: number; refused: unknown[] };
}
interface Pass { started: string; finished: string; pin: string; status: string; reason?: string; repos: Row[] }
const census = (): { passes: Pass[] } => JSON.parse(fs.readFileSync(j('.ccrc', 'graph-sweep.json'), 'utf8'));
const lastPass = (): Pass => census().passes.at(-1)!;
const sourceOf = (repo: string): string => fs.realpathSync(path.join(repo, '.git'));
const rowOf = (repo: string, pass: Pass = lastPass()): Row => {
  const r = pass.repos.find((x) => x.source === sourceOf(repo));
  expect(r, `a repos[] row for ${repo}`).toBeDefined();
  return r!;
};
/** The row's reason without the note a host with no readable cgroup adds to every build (spec §3.4: "peak
 *  unmeasured"); one row below pins the note itself. */
const why = (r: Row): string => r.reason.replace(/(^|; )peak unmeasured$/, '');
const treeCount = (r: Row): unknown => (r as unknown as Record<string, unknown>)['trees'];
const keyDir = (repo: string): string => path.join(STORE(), rowOf(repo).repo_key);
const current = (repo: string): string => fs.realpathSync(path.join(keyDir(repo), 'current'));
interface Meta { schema: number; build_id: string; commit: string; engine: string; kind: string; nodes: number; files: number; store: string; source: string; ref: string; last_full_at: string; noise_digest: string; changed_files: number }
const meta = (repo: string): Meta => JSON.parse(fs.readFileSync(path.join(keyDir(repo), 'current', 'meta.json'), 'utf8'));
type Rec = Record<string, unknown>;
const records = (): Rec[] => fs.existsSync(j('record.jsonl'))
  ? fs.readFileSync(j('record.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Rec) : [];
const calls = (): Rec[] => records().filter((r) => r['event'] === 'call');
const testCalls = (): string[][] => fs.existsSync(j('fx', 'ccrc-test.calls'))
  ? fs.readFileSync(j('fx', 'ccrc-test.calls'), 'utf8').split('\n').filter((l) => l !== '').map((l) => l.split('\t').slice(1)) : [];
const buildCalls = (): string[][] => testCalls().filter((a) => a[0] !== '--status');
const testEnv = (): string[] => fs.existsSync(j('fx', 'ccrc-test.env')) ? fs.readFileSync(j('fx', 'ccrc-test.env'), 'utf8').split('\n') : [];
const fx = (name: string, text: string): void => fs.writeFileSync(j('fx', name), text);
const builds = (repo: string): string[] => fs.readdirSync(path.join(keyDir(repo), 'builds')).sort();
const graphOf = (dir: string): { nodes: { source_file: string; by?: string }[]; built_at_commit?: string } =>
  JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf8'));
const sleep = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** A built, published, linked repository: the base most rows start from. */
function published(name = 'project-a', env: NodeJS.ProcessEnv = {}): string {
  const repo = makeRepo(name);
  const r = sweep(env);
  expect(r.status, r.stderr).toBe(0);
  expect(rowOf(repo).outcome, JSON.stringify(rowOf(repo))).toBe('rebuilt');
  return repo;
}

// ── loading, the pass lock, the pause file, the census ───────────────────
describe('the pass: library, lock, pause file, census (spec §5.2, §7; N25, D-7365, 08-27 rows 6, 8, 12)', () => {
  it('N25 — a GRAPH_LIB missing graph-build is pass status failed naming it, and nothing is built or stored', { timeout: T }, () => {
    makeRepo();
    fs.rmSync(j('ccrc', 'ccd', 'graph-build'));
    const r = sweep();
    expect(r.status).toBe(1);
    expect(lastPass().status).toBe('failed');
    expect(lastPass().reason).toBe('the graph library is incomplete: ~/ccrc/ccd/graph-build is missing (ccrc update --force places the shipped tree)');
    expect(fs.existsSync(STORE())).toBe(false);
    expect(testCalls()).toEqual([]);
  });

  it('N25 — each of the four files is required', { timeout: T }, () => {
    for (const f of ['ccrc', 'ccrc-test', 'graph-resolve']) {
      fs.rmSync(j('ccrc', 'ccd', f));
      sweep();
      expect(lastPass().status, f).toBe('failed');
      expect(lastPass().reason, f).toContain(`~/ccrc/ccd/${f} is missing`);
      fs.symlinkSync(f === 'ccrc-test' ? FIXTURE_TEST : path.join(REPO, 'ccd', f), j('ccrc', 'ccd', f));
    }
  });

  it('N25 — the installed copy never sources or runs the ccrc LAUNCHER beside it; it loads the shipped tree', { timeout: T }, () => {
    const repo = makeRepo();
    // the generated launcher: a marker if anything sources or executes it
    fs.writeFileSync(j('.local', 'bin', 'ccrc'), '#!/usr/bin/env bash\necho touched >> "$HOME/launcher-touched"\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(j('.local', 'bin', 'ccrc-test'), '#!/usr/bin/env bash\necho touched >> "$HOME/launcher-touched"\nexit 0\n', { mode: 0o755 });
    const r = sweep();
    expect(r.status, r.stderr).toBe(0);
    expect(rowOf(repo).outcome).toBe('rebuilt');
    expect(fs.existsSync(j('launcher-touched'))).toBe(false);
  });

  it('a checkout runs from its own directory when the four files sit beside it', { timeout: T }, () => {
    const repo = makeRepo();
    const lib = j('lib-here');
    fs.mkdirSync(lib);
    fs.copyFileSync(SWEEP, path.join(lib, 'ccd-graph-sweep'));
    for (const f of ['ccrc', 'graph-build', 'graph-resolve']) fs.symlinkSync(path.join(REPO, 'ccd', f), path.join(lib, f));
    fs.symlinkSync(FIXTURE_TEST, path.join(lib, 'ccrc-test'));
    fs.rmSync(j('ccrc'), { recursive: true });   // no shipped tree at all
    const r = sweep({}, path.join(lib, 'ccd-graph-sweep'));
    expect(r.status, r.stderr).toBe(0);
    expect(rowOf(repo).outcome).toBe('rebuilt');
  });

  it('D-7365 — the pause file ends the pass `paused` before any fetch, store write or build, and is never removed', { timeout: T }, () => {
    const repo = makeRepo();
    const origin = j('origin.git');
    execFileSync('git', ['clone', '-q', '--bare', repo, origin]);
    git(repo, 'remote', 'add', 'origin', origin);
    fs.writeFileSync(j('.ccrc', 'graph-sweep-paused'), '');
    const r = sweep({ CCRC_GRAPH_FETCH_SECS: '900' });
    expect(r.status).toBe(0);
    expect(lastPass().status).toBe('paused');
    expect(lastPass().repos).toEqual([]);
    expect(fs.existsSync(STORE()), 'no store write').toBe(false);
    expect(fs.existsSync(path.join(repo, '.git', 'FETCH_HEAD')), 'no fetch').toBe(false);
    expect(testCalls(), 'no build, no status call').toEqual([]);
    expect(records(), 'the engine was never imported').toEqual([]);
    expect(fs.existsSync(path.join(repo, 'graphify-out')), 'no link').toBe(false);
    expect(fs.existsSync(j('.ccrc', 'graph-sweep-paused')), 'the hold stays').toBe(true);
  });

  it('D-7365 — the sweep\'s code never names a removal of the pause file', () => {
    const code = fs.readFileSync(SWEEP, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
    expect(code.filter((l) => /\bPAUSE\b/.test(l))).toEqual([
      'PAUSE="$HOME/.ccrc/graph-sweep-paused"',
      '[ -e "$PAUSE" ] && _gs_finish paused 0',
    ]);
    expect(code.filter((l) => /graph-sweep-paused/.test(l) && /\brm\b|\bmv\b|unlink/.test(l))).toEqual([]);
  });

  it('row 6 — a second entrant exits pass-locked at once while a pass holds the flock', { timeout: T }, async () => {
    makeRepo();
    const lock = j('.ccrc', 'graph-sweep.lock');
    fs.writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '5'], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 50 && spawnSync('flock', ['-n', lock, 'true']).status === 0; i++) sleep(50);
      const t0 = Date.now();
      const r = sweep();
      expect(r.status).toBe(0);
      expect(lastPass().status).toBe('pass-locked');
      expect(Date.now() - t0, 'it did not wait for the lock').toBeLessThan(4000);
      expect(fs.existsSync(STORE())).toBe(false);
    } finally { holder.kill('SIGKILL'); }
  });

  it('row 8 — zero trees probed on a box that HAS tree roots is probed-zero, exit 1; no roots at all is no-trees-configured, exit 0', { timeout: T }, () => {
    fs.rmSync(j('projects'), { recursive: true });
    let r = sweep();
    expect([r.status, lastPass().status]).toEqual([0, 'no-trees-configured']);
    fs.mkdirSync(j('projects'));
    r = sweep();
    expect([r.status, lastPass().status]).toEqual([1, 'probed-zero']);
  });

  it('row 12 (retargeted) — the exit code agrees with the pass status: ok 0, failed 1', { timeout: T }, () => {
    makeRepo();
    expect([sweep().status, lastPass().status]).toEqual([0, 'ok']);
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '');
    expect([sweep().status, lastPass().status]).toEqual([1, 'failed']);
    expect(lastPass().reason).toBe('no pin at ~/.ccrc/graphify.pin — run ccrc install first');
  });

  it('the census keeps its last 10 passes, newest last', { timeout: T }, () => {
    makeRepo();
    for (let i = 0; i < 12; i++) sweep();
    expect(census().passes).toHaveLength(10);
    expect(census().passes.every((p) => Array.isArray(p.repos))).toBe(true);
  });

  it('D-7357 — every repos[] row is also one `graph-sweep: row {json}` stdout line, equal to the census row', { timeout: T }, () => {
    makeRepo('project-a'); makeRepo('lane-a');
    const r = sweep();
    const lines = r.stdout.split('\n').filter((l) => l.startsWith('graph-sweep: row '));
    expect(lines.map((l) => JSON.parse(l.slice('graph-sweep: row '.length)))).toEqual(lastPass().repos);
    expect(lines).toHaveLength(2);
  });

  it('spec §7 — a row carries every field of the spec, plus cpu_ms (D-7357)', { timeout: T }, () => {
    const repo = published();
    const row = rowOf(repo);
    expect(Object.keys(row).sort()).toEqual(['changed_files', 'cpu_ms', 'duration_ms', 'edges', 'fail', 'full_failed_at',
      'full_failures', 'kind', 'linked', 'migrate', 'nodes', 'outcome', 'peak_mem_kb', 'reason', 'ref', 'repo_key',
      'served', 'source', 'tip', 'trees'].sort());
    expect(row).toMatchObject({ ref: 'refs/heads/main', tip: git(repo, 'rev-parse', 'HEAD'), served: git(repo, 'rev-parse', 'HEAD'),
      kind: 'full', fail: '', full_failures: 0, full_failed_at: '', nodes: 2, linked: 1 });
    expect(treeCount(row)).toBe(1);
    expect(row.repo_key).toMatch(/^project-a-[0-9a-f]{8}$/);
  });

  it('spec §5.3 — settings.json holds the three read-side settings as resolved this pass', { timeout: T }, () => {
    makeRepo();
    sweep();
    expect(JSON.parse(fs.readFileSync(path.join(STORE(), 'settings.json'), 'utf8')))
      .toEqual({ schema: 1, gate_max_diff_pct: 25, gate_max_denials: 3, card_diff_list_max: 20 });
    fs.writeFileSync(j('.ccrc', 'ccrc.env'), 'CCRC_GRAPH_GATE_MAX_DIFF_PCT=40\nCCRC_GRAPH_CARD_DIFF_LIST_MAX=7\n');
    sweep({ CCRC_GRAPH_GATE_MAX_DENIALS: '5' });
    expect(JSON.parse(fs.readFileSync(path.join(STORE(), 'settings.json'), 'utf8')))
      .toEqual({ schema: 1, gate_max_diff_pct: 40, gate_max_denials: 5, card_diff_list_max: 7 });
  });

  it('N13 (sweep half) — a key in the fixture ccrc.env is what the sweep uses', { timeout: T }, () => {
    const a = makeRepo('project-a'); const b = makeRepo('lane-a');
    fs.writeFileSync(j('.ccrc', 'ccrc.env'), 'CCRC_GRAPH_BUDGET=1\n');
    sweep();
    expect([rowOf(a).outcome, rowOf(b).outcome].sort()).toEqual(['rebuilt', 'skipped-budget']);
  });

  it('a bad value keeps its default and is said on stderr', { timeout: T }, () => {
    const repo = makeRepo();
    const r = sweep({ CCRC_GRAPH_BUDGET: 'many' });
    expect(r.stderr).toMatch(/^graph-sweep: setting: CCRC_GRAPH_BUDGET: 'many' from the environment is not a whole number, 1 or more; using 4$/m);
    expect(rowOf(repo).outcome).toBe('rebuilt');
  });

  it('row 16 (retargeted: scoping) — a store inside a root the sweep enumerates is refused, nothing written', { timeout: T }, () => {
    const repo = makeRepo();
    const r = sweep({ CCRC_GRAPH_STORE: j('projects', 'graphs') });
    expect(r.status).toBe(1);
    expect(lastPass().status).toBe('failed');
    expect(lastPass().reason).toMatch(/is inside ~\/projects, which the sweep and ccd enumerate$/);
    expect(fs.existsSync(j('projects', 'graphs'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'graphify-out'))).toBe(false);
  });
});

// ── the store, the checkout, the build ────────────────────────────────────
describe('the store and its build (spec §2, §3.4, §3.5; 08-27 rows 4, 5a, 10, 18; N12, fd 9)', () => {
  it('cold build: one rebuilt row, the store laid out as §2.1, the link made, a second pass fresh', { timeout: T }, () => {
    const repo = published();
    const kd = keyDir(repo);
    for (const f of ['source', 'memory', 'project-a', 'builds', 'current']) expect(fs.existsSync(path.join(kd, f)), f).toBe(true);
    expect(fs.readFileSync(path.join(kd, 'source'), 'utf8')).toBe(`${sourceOf(repo)}\n`);
    expect(fs.existsSync(path.join(STORE(), '.ccrc-graph-store'))).toBe(true);
    expect(fs.readlinkSync(path.join(kd, 'current'))).toMatch(/^builds\/[0-9a-f]{12}-0\.9\.9-\d{8}T\d{6}Z$/);
    expect(fs.readlinkSync(path.join(repo, 'graphify-out'))).toBe(path.join(kd, 'current'));
    const m = meta(repo);
    expect(m).toMatchObject({ schema: 1, commit: git(repo, 'rev-parse', 'HEAD'), engine: '0.9.9', kind: 'full', nodes: 2, files: 2,
      store: fs.realpathSync(STORE()), source: sourceOf(repo), ref: 'refs/heads/main', changed_files: 0 });
    expect(m.noise_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(path.join(kd, 'current', 'meta.json')).size).toBeLessThan(8192);   // the hook reads 8 KiB
    expect(calls()).toHaveLength(1);
    // D-1512: the log names the repository, the kind and the UTC instant before the engine speaks
    expect(fs.readFileSync(j('.ccrc', 'graph-sweep.log'), 'utf8')).toMatch(new RegExp(`^graph-sweep: build ${rowOf(repo).repo_key} \\(full\\) at \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$`, 'm'));
    // §Review focus 3: no silent queue — the engine was called with acquire_lock=False, and nothing it queues is published
    expect(calls()[0]!['acquire_lock']).toBe(false);
    for (const f of ['.rebuild.lock', '.pending_changes', '.graphify_root', '.started', 'changed.z']) expect(fs.existsSync(path.join(current(repo), f)), f).toBe(false);
    sweep();
    expect(rowOf(repo).outcome).toBe('fresh');
    expect(calls(), 'nothing built').toHaveLength(1);
    expect(fs.existsSync(path.join(kd, 'staging')), 'no staging left').toBe(false);
  });

  it('row 4 (retargeted) — the build runs in the store\'s checkout, at main\'s tip, never in a tree; the checkout is in no worktree list', { timeout: T }, () => {
    const repo = makeRepo();
    const ws = j('worktrees', 'project-a', 'lane-a');
    fs.mkdirSync(path.dirname(ws), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'lane-a', ws);
    commit(ws, { 'branch-only.py': 'b = 1\n' });
    const tip = git(repo, 'rev-parse', 'main');
    sweep();
    const row = rowOf(repo);
    expect(row.outcome).toBe('rebuilt');
    expect(treeCount(row)).toBe(2);
    const call = calls()[0]!;
    expect(call['cwd']).toBe(fs.realpathSync(path.join(keyDir(repo), 'project-a')));
    expect(graphOf(current(repo)).built_at_commit).toBe(tip);
    expect(graphOf(current(repo)).nodes.map((n) => n.source_file).sort(), 'the branch\'s own file is not in main\'s graph').toEqual(['a.py', 'lib/b.py']);
    expect(git(repo, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')))
      .toEqual([`worktree ${repo}`, `worktree ${ws}`]);
    // one shared graph, linked from both trees
    expect(fs.readlinkSync(path.join(ws, 'graphify-out'))).toBe(fs.readlinkSync(path.join(repo, 'graphify-out')));
    expect(row.linked).toBe(2);
  });

  it('N12 — every build runs through `ccrc test --local --heavy --`, after `ccrc test --status`', { timeout: T }, () => {
    makeRepo();
    sweep();
    const all = testCalls();
    expect(all.map((a) => a[0])).toEqual(['--status', '--local']);
    expect(all[1]!.slice(0, 3)).toEqual(['--local', '--heavy', '--']);
  });

  it('rows 5a + 18 — the build\'s environment and argv: NO_BACKUP, the hash seed, the workers, nice, ionice and the inner timeout', { timeout: T }, () => {
    makeRepo();
    sweep({ CCRC_GRAPH_MAX_WORKERS: '3', CCRC_GRAPH_BUILD_NICE: '12', CCRC_GRAPH_BUILD_TIMEOUT: '321' });
    const env = testEnv();
    for (const l of ['GRAPHIFY_NO_BACKUP=1', 'PYTHONHASHSEED=0', 'GRAPHIFY_MAX_WORKERS=3', 'GIT_TERMINAL_PROMPT=0']) expect(env, l).toContain(l);
    const argv = buildCalls()[0]!;
    const cmd = argv.slice(3);
    expect(cmd.slice(0, 8)).toEqual(['nice', '-n', '12', 'ionice', '-c3', 'timeout', '--kill-after=30', '321']);
    expect(cmd[8]).toBe(j('.ccrc', 'graphify-venv', 'bin', 'python'));
    expect(cmd.slice(9, 12)).toEqual(['-s', '-P', j('ccrc', 'ccd', 'graph-build')]);
  });

  it('spec §3.4 — the wrapper\'s arguments: --root and --out as realpaths, --commit the tip, --memory, --launched, --slot-wait', { timeout: T }, () => {
    const repo = makeRepo();
    sweep({ CCRC_GRAPH_SLOT_WAIT_SECS: '77' });
    const argv = buildCalls()[0]!;
    const arg = (k: string): string => argv[argv.indexOf(k) + 1]!;
    const kd = keyDir(repo);
    expect(arg('--root')).toBe(fs.realpathSync(path.join(kd, 'project-a')));
    expect(arg('--out')).toBe(path.join(fs.realpathSync(kd), 'staging', 'graphify-out'));
    expect(arg('--commit')).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(arg('--memory')).toBe(path.join(fs.realpathSync(kd), 'memory'));
    expect(arg('--slot-wait')).toBe('77');
    expect(Number(arg('--launched'))).toBeGreaterThan(Date.now() / 1000 - 120);
    expect(argv, 'a full build passes no --changed').not.toContain('--changed');
    expect(testEnv()).toContain(`GRAPHIFY_OUT=${arg('--out')}`);
  });

  it('§Review focus 5 — the build runs with the pass lock\'s fd 9 closed', { timeout: T }, () => {
    makeRepo();
    sweep();
    expect(testEnv().filter((l) => l.startsWith('fd9='))).toEqual(['fd9=closed']);
  });

  it('§Review focus 5 (calibration) — the fixture\'s probe reports fd 9 open when it is open', { timeout: T }, () => {
    const lockish = fs.openSync(j('fd9-probe'), 'w');
    try {
      const stdio: ('ignore' | number)[] = ['ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', lockish];
      const r = spawnSync(FIXTURE_TEST, ['--local', '--heavy', '--', 'true'], { env: { ...process.env, HOME: home }, stdio });
      expect(r.status).toBe(0);
    } finally { fs.closeSync(lockish); }
    expect(testEnv().filter((l) => l.startsWith('fd9='))).toEqual(['fd9=open']);
  });

  it('row 10 (retargeted) — the build\'s pin is graphify.pin\'s, one definition: the --pin argument and meta.json\'s engine', { timeout: T }, () => {
    const repo = makeRepo();
    sweep();
    const argv = buildCalls()[0]!;
    expect(argv[argv.indexOf('--pin') + 1]).toBe('0.9.9');
    expect(meta(repo).engine).toBe('0.9.9');
    expect(fs.readFileSync(SWEEP, 'utf8'), 'no version literal in the sweep').not.toMatch(/\b0\.9\.\d+\b/);
  });

  it('row 13 — a pin bump alone re-builds at an unchanged main, in full', { timeout: T }, () => {
    const repo = published();
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.10\n');
    sweep();
    // the stub engine is 0.9.9, so the wrapper refuses the pin: what matters here is that the build was DUE and FULL
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'failed', fail: 'setup' });
    expect(why(rowOf(repo))).toMatch(/^setup: pin: the engine is graphifyy 0\.9\.9, not the pinned 0\.9\.10/);
  });

  it('N4 — incremental is incremental: a one-file main commit re-extracts that file alone; a deleted file\'s node goes', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    commit(repo, { 'lib/b.py': 'y = 3\n' });
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ outcome: 'refreshed', kind: 'incremental', changed_files: 1 });
    const call = calls().at(-1)!;
    expect(call['changed_paths']).toEqual([path.join(fs.realpathSync(path.join(keyDir(repo), 'project-a')), 'lib/b.py')]);
    expect(buildCalls().at(-1)).toContain('--changed');
    const g = graphOf(current(repo));
    expect(g.nodes.map((n) => [n.source_file, n.by])).toEqual([['a.py', 'full'], ['lib/b.py', 'incremental']]);
    commit(repo, { 'a.py': null });
    sweep({ ...INCR, CCRC_GRAPH_MAX_SHRINK_PCT: '100' });
    expect(rowOf(repo).outcome).toBe('refreshed');
    expect(graphOf(current(repo)).nodes.map((n) => n.source_file)).toEqual(['lib/b.py']);
    expect(meta(repo).kind).toBe('incremental');
  });

  it('D-7634 — with the box-wide default (INCREMENTAL_MAX_FILES=0) any change on main rebuilds in full', { timeout: T }, () => {
    const repo = published();
    commit(repo, { 'lib/b.py': 'y = 3\n' });
    sweep();
    expect(rowOf(repo)).toMatchObject({ outcome: 'rebuilt', kind: 'full' });
    expect(why(rowOf(repo))).toContain('1 files changed, above CCRC_GRAPH_INCREMENTAL_MAX_FILES=0');
    expect(calls().at(-1)!['changed_paths']).toBeNull();
  });

  it('N2 — a published build is read-only, and a write through a tree\'s link fails', { timeout: T }, () => {
    const repo = published();
    const cur = current(repo);
    for (const e of fs.readdirSync(cur)) {
      const p = path.join(cur, e);
      if (fs.lstatSync(p).isSymbolicLink()) continue;
      expect(fs.statSync(p).mode & 0o222, e).toBe(0);
    }
    expect(fs.statSync(cur).mode & 0o222).toBe(0);
    if (process.getuid?.() === 0) return;                    // root writes through any mode; the modes above are the guard
    expect(() => fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'), '{}')).toThrow();
    expect(() => fs.writeFileSync(path.join(repo, 'graphify-out', 'new.json'), '{}')).toThrow();
  });

  it('N23 — saved results: the build\'s memory link resolves to the repository\'s memory/, a write through a tree works, and the guard does not refuse it', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const kd = keyDir(repo);
    expect(fs.realpathSync(path.join(repo, 'graphify-out', 'memory'))).toBe(fs.realpathSync(path.join(kd, 'memory')));
    expect(fs.readlinkSync(path.join(current(repo), 'memory'))).toBe(path.join(fs.realpathSync(kd), 'memory'));
    fs.writeFileSync(path.join(repo, 'graphify-out', 'memory', 'query-1.md'), '# a saved result\n');
    expect(fs.existsSync(path.join(kd, 'memory', 'query-1.md'))).toBe(true);
    bump(repo);
    sweep(INCR);
    expect(rowOf(repo).outcome, why(rowOf(repo))).toBe('refreshed');
    expect(records().filter((r) => r['event'] === 'detect').length, 'the guard ran').toBeGreaterThan(0);
  });

  it('N21 — a second build at an unchanged commit is published, and the predecessor\'s copies are writable in staging', { timeout: T }, () => {
    const repo = published();
    const first = builds(repo);
    sleep(1100);
    sweep({ CCRC_GRAPH_FULL_REBUILD_SECS: '1' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'rebuilt', kind: 'full' });
    expect(why(rowOf(repo))).toContain('older than CCRC_GRAPH_FULL_REBUILD_SECS=1');
    expect(builds(repo)).toHaveLength(2);
    expect(builds(repo)).toEqual(expect.arrayContaining(first));
    expect(testEnv().filter((l) => l.startsWith('staged='))).toEqual(['staged=absent', 'staged=writable']);
  });

  it('N22 — two builds at one commit get two build ids, and neither is nested in the other', { timeout: T }, () => {
    const repo = published();
    sleep(1100);
    sweep({ CCRC_GRAPH_FULL_REBUILD_SECS: '1' });
    const ids = builds(repo);
    expect(new Set(ids).size).toBe(2);
    expect(ids.map((i) => i.slice(0, 12))).toEqual([meta(repo).commit.slice(0, 12), meta(repo).commit.slice(0, 12)]);
    for (const id of ids) expect(fs.readdirSync(path.join(keyDir(repo), 'builds', id)).filter((e) => ids.includes(e))).toEqual([]);
  });

  it('spec §3.5 step 6 — superseded builds beyond KEEP_BUILDS go once older than BUILD_GRACE_SECS, never sooner', { timeout: T }, () => {
    const repo = published();
    for (let i = 0; i < 2; i++) { sleep(1100); sweep({ CCRC_GRAPH_FULL_REBUILD_SECS: '1', CCRC_GRAPH_BUILD_GRACE_SECS: '3600' }); }
    expect(builds(repo), 'inside the grace every build stays').toHaveLength(3);
    sleep(1100);
    sweep({ CCRC_GRAPH_KEEP_BUILDS: '2', CCRC_GRAPH_BUILD_GRACE_SECS: '1' });
    expect(rowOf(repo).outcome).toBe('fresh');
    const left = builds(repo);
    expect(left).toHaveLength(2);
    expect(left).toContain(path.basename(current(repo)));
    // the memory directory the removed build linked to is untouched
    expect(fs.existsSync(path.join(keyDir(repo), 'memory'))).toBe(true);
  });

  it('N11 — a pass killed mid-build leaves `current` serving the previous build; the next pass collects the staging', { timeout: T }, async () => {
    const repo = published();
    const before = current(repo);
    bump(repo);
    const child = spawn('bash', [j('.local', 'bin', 'ccd-graph-sweep')], { env: sweepEnv({ GRAPH_STUB_SLEEP_S: '30' }), stdio: 'ignore', detached: true });
    const kd = keyDir(repo);
    for (let i = 0; i < 200 && !fs.existsSync(path.join(kd, 'staging', '.started')); i++) await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(path.join(kd, 'staging', '.started')), 'the build started').toBe(true);
    process.kill(-child.pid!, 'SIGKILL');
    await new Promise((r) => child.on('exit', r));
    expect(current(repo)).toBe(before);
    expect(fs.existsSync(path.join(kd, 'staging')), 'a SIGKILL leaves staging behind').toBe(true);
    sweep();
    expect(rowOf(repo).outcome).toBe('rebuilt');
    expect(fs.existsSync(path.join(kd, 'staging'))).toBe(false);
  });

  it('the staging trap — a TERM mid-build removes staging/ and leaves current serving', { timeout: T }, async () => {
    const repo = published();
    const before = current(repo);
    bump(repo);
    const child = spawn('bash', [j('.local', 'bin', 'ccd-graph-sweep')], { env: sweepEnv({ GRAPH_STUB_SLEEP_S: '3' }), stdio: 'ignore' });
    const kd = keyDir(repo);
    for (let i = 0; i < 200 && !fs.existsSync(path.join(kd, 'staging', '.started')); i++) await new Promise((r) => setTimeout(r, 50));
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
    expect(current(repo)).toBe(before);
    expect(fs.existsSync(path.join(kd, 'staging'))).toBe(false);
  });
});

// ── the publish checks (spec §3.5 steps 3-4; N9, N10; 08-27 row 17) ────────
describe('stamp and publish checks (N9, N10, row 17)', () => {
  it('N9 — an untouched-outputs refresh is published stamped with the tip, not the previous commit', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const tip = bump(repo);
    sweep({ ...INCR, GRAPH_STUB_MODE: 'untouched' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'refreshed', served: tip });
    expect(graphOf(current(repo)).built_at_commit).toBe(tip);
    expect(meta(repo).commit).toBe(tip);
  });

  it('N9 — a build whose built_at_commit is another commit is not published (fail: publish), and the next pass is full', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const before = current(repo);
    bump(repo);
    sweep({ ...INCR, GRAPH_STUB_STAMP: 'f'.repeat(40) });
    expect(rowOf(repo)).toMatchObject({ outcome: 'failed', fail: 'publish' });
    expect(why(rowOf(repo))).toBe(`graph.json's built_at_commit is ${'f'.repeat(40)}, not the tip ${git(repo, 'rev-parse', 'HEAD').slice(0, 12)}`);
    expect(current(repo)).toBe(before);
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ outcome: 'rebuilt', kind: 'full' });
  });

  it('cannot stamp — a graph.json with no built_at_commit is refused (fail: publish)', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    bump(repo);
    sweep({ ...INCR, GRAPH_STUB_MODE: 'nostamp' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'failed', fail: 'publish' });
    expect(why(rowOf(repo))).toMatch(/^cannot stamp: no built_at_commit in the last \d+ bytes of graph\.json$/);
  });

  it('a graph.json that does not parse is refused (fail: publish)', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    bump(repo);
    fx('corrupt-after', '');                                 // the wrapper returned 0; the file is broken after it
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ outcome: 'failed', fail: 'publish' });
    expect(why(rowOf(repo))).toBe('graph.json does not parse');
  });

  it('N10 + row 17 — a graph with half the nodes is refused-shrink, never failed, nothing published, and the next pass is full', { timeout: T }, () => {
    const repo = makeRepo('project-a', Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`m${i}.py`, `x${i} = ${i}\n`])));
    sweep(INCR);
    const before = current(repo);
    commit(repo, Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`m${i}.py`, null])));
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ outcome: 'refused-shrink', kind: 'incremental', fail: '' });
    expect(why(rowOf(repo))).toBe('5 nodes against the served build\'s 10, a shrink past CCRC_GRAPH_MAX_SHRINK_PCT=20');
    expect(current(repo)).toBe(before);
    sweep({ ...INCR, CCRC_GRAPH_MAX_SHRINK_PCT: '100' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'rebuilt', kind: 'full' });
    expect(why(rowOf(repo))).toContain('the last attempt was refused-shrink');
  });
});

// ── the decision (spec §3.3, §3.3.1; N5, N27, N28) ────────────────────────
describe('N5 — every row of spec §3.3\'s table leads to a full rebuild', () => {
  it('no published build', { timeout: T }, () => {
    const repo = makeRepo();
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
    expect(why(rowOf(repo))).toBe('no published build');
  });

  it('the engine differs from the pin', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    // a published build of another engine, as a pin bump leaves it: the meta.json the decision reads
    const m = path.join(current(repo), 'meta.json');
    fs.chmodSync(current(repo), 0o755); fs.chmodSync(m, 0o644);
    fs.writeFileSync(m, JSON.stringify({ ...meta(repo), engine: '0.9.8' }));
    bump(repo);
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
    expect(why(rowOf(repo))).toContain('engine 0.9.8 is not the pin 0.9.9');
  });

  it('the noise digest differs (the default noise list changed)', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', '_default.list'), '.remember/\n');
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
    expect(why(rowOf(repo))).toContain('the corpus definition changed (noise digest)');
  });

  it('main was rewritten (the built commit is not an ancestor of the tip)', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const built = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-q', '--orphan', 'rewrite');
    commit(repo, { 'c.py': 'c = 1\n' }, 'rewritten');
    git(repo, 'branch', '-q', '-f', 'main', 'rewrite');
    git(repo, 'checkout', '-q', 'main');
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
    expect(why(rowOf(repo))).toContain(`main was rewritten (${built.slice(0, 12)} is not an ancestor`);
  });

  it('the diff names more than INCREMENTAL_MAX_FILES files', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    commit(repo, { 'a.py': 'x = 2\n', 'lib/b.py': 'y = 3\n' });
    sweep({ CCRC_GRAPH_INCREMENTAL_MAX_FILES: '1' });
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
    expect(why(rowOf(repo))).toContain('2 files changed, above CCRC_GRAPH_INCREMENTAL_MAX_FILES=1');
  });

  it('the diff names .graphifyignore', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    fs.writeFileSync(path.join(repo, '.graphifyignore'), 'docs/\n');
    git(repo, 'add', '-f', '.graphifyignore');               // the sweep's exclude line ignores an untracked one
    git(repo, 'commit', '-q', '-m', 'a committed .graphifyignore');
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
    expect(why(rowOf(repo))).toContain('the commit changes .graphifyignore');
  });

  it('the last full build is older than FULL_REBUILD_SECS (the safety net)', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    bump(repo);
    sleep(1100);
    sweep({ ...INCR, CCRC_GRAPH_FULL_REBUILD_SECS: '1' });
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
    expect(why(rowOf(repo))).toContain('older than CCRC_GRAPH_FULL_REBUILD_SECS=1');
  });

  for (const [what, env, outcome, fail] of [
    ['refused-shrink', { CCRC_GRAPH_MAX_SHRINK_PCT: '0' }, 'refused-shrink', ''],
    ['refused-by-guard', { GRAPH_STUB_DETECT_EXTRA: '["untracked.py"]' }, 'refused-by-guard', ''],
    ['failed with fail: engine', { GRAPH_STUB_MODE: 'false' }, 'failed', 'engine'],
    ['failed with fail: publish', { GRAPH_STUB_MODE: 'nostamp' }, 'failed', 'publish'],
  ] as const) {
    it(`the last attempt was ${what}`, { timeout: T }, () => {
      const repo = published('project-a', INCR);
      commit(repo, { 'a.py': null });                     // one fewer node: MAX_SHRINK_PCT=0 refuses it
      sweep({ ...INCR, ...env });
      expect(rowOf(repo)).toMatchObject({ kind: 'incremental', outcome, fail });
      bump(repo);
      sweep(INCR);
      expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
      expect(why(rowOf(repo))).toContain(`the last attempt was ${outcome}`);
    });
  }
});

describe('N27 — the failure rule: what the next pass builds', () => {
  for (const [what, env, files, outcome, fail] of [
    ['skipped-slots', { CCRC_GRAPH_SLOT_WAIT_SECS: '1' }, { 'sleep-before': '3' }, 'skipped-slots', ''],
    ['timed-out', { CCRC_GRAPH_BUILD_TIMEOUT: '2', GRAPH_STUB_SLEEP_S: '30' }, {}, 'timed-out', ''],
    ['oom-killed', {}, { oom: '', 'exit-after': '137' }, 'oom-killed', ''],
    ['failed with fail: setup', {}, { status: 'ccrctests.slice is not loaded (LoadState=not-found), so ccrc test runs every run uncontained; heavy slots 0 of 2 held, 0 waiting\n2\n' }, 'failed', 'setup'],
    ['failed with fail: unknown (an external SIGKILL)', { GRAPH_STUB_MODE: 'sigkill' }, {}, 'failed', 'unknown'],
  ] as const) {
    it(`a ${what} incremental is retried as an incremental`, { timeout: T }, () => {
      const repo = published('project-a', INCR);
      bump(repo);
      for (const [f, t] of Object.entries(files)) fx(f, t);
      sweep({ ...INCR, ...env });
      expect(rowOf(repo)).toMatchObject({ kind: 'incremental', outcome, fail });
      for (const f of Object.keys(files)) fs.rmSync(j('fx', f));
      sweep(INCR);
      expect(rowOf(repo)).toMatchObject({ kind: 'incremental', outcome: 'refreshed' });
    });
  }

  it('a skipped-budget repository is retried as the same kind, and goes first next pass', { timeout: T }, () => {
    const a = makeRepo('project-a'); const b = makeRepo('lane-a');
    sweep(INCR);
    bump(a, 3); bump(b, 1);
    sweep({ ...INCR, CCRC_GRAPH_BUDGET: '1' });
    expect(rowOf(a)).toMatchObject({ outcome: 'refreshed' });                // the most commits behind went first
    expect(rowOf(b)).toMatchObject({ outcome: 'skipped-budget', kind: 'incremental', reason: 'pass budget CCRC_GRAPH_BUDGET=1 reached' });
    bump(a, 3);
    sweep({ ...INCR, CCRC_GRAPH_BUDGET: '1' });
    expect(rowOf(b)).toMatchObject({ outcome: 'refreshed', kind: 'incremental' });   // skipped last pass: first now
    expect(rowOf(a)).toMatchObject({ outcome: 'skipped-budget' });
  });

  it('repositories with no published build go before ones behind', { timeout: T }, () => {
    const a = published('project-a', INCR);
    bump(a, 5);
    const b = makeRepo('lane-a');
    sweep({ ...INCR, CCRC_GRAPH_BUDGET: '1' });
    expect([rowOf(b).outcome, rowOf(a).outcome]).toEqual(['rebuilt', 'skipped-budget']);
  });

  it('the rule reads the current build\'s meta.json: an old last_full_at there makes the next build full', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const m = path.join(current(repo), 'meta.json');
    fs.chmodSync(current(repo), 0o755); fs.chmodSync(m, 0o644);
    fs.writeFileSync(m, JSON.stringify({ ...meta(repo), last_full_at: '2020-01-01T00:00:00Z' }));
    bump(repo);
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ kind: 'full' });
  });

  it('the rule reads the census\'s last row: a row saying fail: engine makes the next build full', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const c = census();
    c.passes.at(-1)!.repos[0]!.outcome = 'failed';
    c.passes.at(-1)!.repos[0]!.fail = 'engine';
    fs.writeFileSync(j('.ccrc', 'graph-sweep.json'), JSON.stringify(c));
    bump(repo);
    sweep(INCR);
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt' });
  });

  it('…and nothing else: the served graph.json\'s own stamp does not change the decision', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const g = path.join(current(repo), 'graph.json');
    fs.chmodSync(current(repo), 0o755); fs.chmodSync(g, 0o644);
    fs.writeFileSync(g, JSON.stringify({ nodes: [], links: [], built_at_commit: '0'.repeat(40) }));
    sweep(INCR);
    expect(rowOf(repo).outcome).toBe('fresh');
  });
});

describe('N28 — the full-build backoff (spec §3.3.1)', () => {
  it('after FULL_FAIL_MAX failed full attempts no full build starts until the backoff passes; a hard trigger is skipped-backoff', { timeout: T }, () => {
    const repo = makeRepo();
    const env = { ...INCR, CCRC_GRAPH_FULL_FAIL_MAX: '2', CCRC_GRAPH_FAIL_BACKOFF_SECS: '3600' };
    sweep({ ...env, GRAPH_STUB_MODE: 'false' });
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'failed', fail: 'engine', full_failures: 1 });
    sweep({ ...env, GRAPH_STUB_MODE: 'false' });
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'failed', full_failures: 2 });
    expect(rowOf(repo).full_failed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const n = calls().length;
    sweep(env);
    expect(rowOf(repo)).toMatchObject({ outcome: 'skipped-backoff', kind: '', full_failures: 2 });
    expect(why(rowOf(repo))).toMatch(/^2 failed full attempt\(s\); no full build until \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \(CCRC_GRAPH_FAIL_BACKOFF_SECS=3600\); it needs a full build: no published build$/);
    expect(calls(), 'no build started').toHaveLength(n);
    sleep(1100);
    sweep({ ...env, CCRC_GRAPH_FAIL_BACKOFF_SECS: '1' });
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'rebuilt', full_failures: 0, full_failed_at: '' });
  });

  it('a soft-only pass in backoff refreshes incrementally from the published build', { timeout: T }, () => {
    const repo = published('project-a', INCR);
    const env = { ...INCR, CCRC_GRAPH_FULL_FAIL_MAX: '1', CCRC_GRAPH_FAIL_BACKOFF_SECS: '3600', CCRC_GRAPH_FULL_REBUILD_SECS: '1' };
    sleep(1100);
    sweep({ ...env, GRAPH_STUB_MODE: 'false' });                     // the safety net's full build fails
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'failed', full_failures: 1 });
    bump(repo);
    sweep(env);
    expect(rowOf(repo)).toMatchObject({ kind: 'incremental', outcome: 'refreshed', full_failures: 1 });
    expect(why(rowOf(repo))).toMatch(/^in full-build backoff until .*; refreshing incrementally$/);
  });

  it('a timed-out, an oom-killed and a refused full attempt count; a published full build resets the count', { timeout: T }, () => {
    const repo = makeRepo();
    const env = { CCRC_GRAPH_FULL_FAIL_MAX: '9' };
    fx('oom', ''); fx('exit-after', '137');
    sweep(env);
    expect(rowOf(repo)).toMatchObject({ kind: 'full', outcome: 'oom-killed', full_failures: 1 });
    fs.rmSync(j('fx', 'oom')); fs.rmSync(j('fx', 'exit-after'));
    sweep({ ...env, CCRC_GRAPH_BUILD_TIMEOUT: '2', GRAPH_STUB_SLEEP_S: '30' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'timed-out', full_failures: 2 });
    sweep({ ...env, GRAPH_STUB_DETECT_EXTRA: '["x.py"]' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'refused-by-guard', full_failures: 3 });
    sweep({ ...env, GRAPH_STUB_MODE: 'sigkill' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'failed', fail: 'unknown', full_failures: 4 });   // D-7366: counts, never escalates
    sweep(env);
    expect(rowOf(repo)).toMatchObject({ outcome: 'rebuilt', full_failures: 0 });
  });
});

// ── the outcome table, line by line (the plan's §The outcome table; D-7366) ─
describe('the outcome table: every line', () => {
  const after = (env: NodeJS.ProcessEnv, files: Record<string, string> = {}, base: 'cold' | 'published' = 'cold'): Row => {
    const repo = base === 'cold' ? makeRepo() : published('project-a', INCR);
    if (base === 'published') bump(repo);
    for (const [f, t] of Object.entries(files)) fx(f, t);
    sweep({ ...INCR, ...env });
    return rowOf(repo);
  };

  it('0, .started: the publish checks pass: rebuilt (full) / refreshed (incremental)', { timeout: T }, () => {
    expect(after({})).toMatchObject({ outcome: 'rebuilt', fail: '' });
  });
  it('1, .started, `engine: _rebuild_code returned False`: failed, fail: engine', { timeout: T }, () => {
    expect(after({ GRAPH_STUB_MODE: 'false' })).toMatchObject({ outcome: 'failed', fail: 'engine', reason: 'engine: _rebuild_code returned False' });
  });
  it('1, .started, a `publish:` line from the wrapper is not the engine\'s False: failed (exit 1), fail: unknown', { timeout: T }, () => {
    const r = after({ GRAPH_STUB_MODE: 'garbage' });
    expect(r).toMatchObject({ outcome: 'failed', fail: 'unknown' });
    expect(why(r)).toMatch(/^exit 1: publish: saved results: cannot rewrite their source_file in .*graph\.json: /);
  });
  it('1, .started, any other last line (an uncaught exception): failed (exit 1), fail: unknown', { timeout: T }, () => {
    const r = after({ GRAPH_STUB_MODE: 'raise' });
    expect(r).toMatchObject({ outcome: 'failed', fail: 'unknown' });
    expect(why(r)).toBe('exit 1: engine: _rebuild_code raised RuntimeError: stub engine failure');
  });
  it('1, no .started (`ccrc test` could not load ccrc): failed, fail: setup', { timeout: T }, () => {
    const r = after({}, { 'exit-before': '1' });
    expect(r).toMatchObject({ outcome: 'failed', fail: 'setup' });
    expect(why(r)).toMatch(/^exit 1 before the build started/);
  });
  it('2, no .started, `setup: <the check that failed>`: failed, fail: setup, the line as reason', { timeout: T }, () => {
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.8\n');
    const r = after({});
    expect(r).toMatchObject({ outcome: 'failed', fail: 'setup' });
    expect(why(r)).toBe('setup: pin: the engine is graphifyy 0.9.9, not the pinned 0.9.8');
  });
  it('2, no .started, `ccrc test`\'s usage line: failed, fail: setup', { timeout: T }, () => {
    const r = after({}, { 'exit-before': '2' });
    expect(r).toMatchObject({ outcome: 'failed', fail: 'setup' });
  });
  it('3, no .started, `slot-wait: …`: skipped-slots, the line as reason', { timeout: T }, () => {
    const r = after({ CCRC_GRAPH_SLOT_WAIT_SECS: '1' }, { 'sleep-before': '3' });
    expect(r).toMatchObject({ outcome: 'skipped-slots', fail: '' });
    expect(why(r)).toMatch(/^slot-wait: started \d+s after launch, above CCRC_GRAPH_SLOT_WAIT_SECS=1$/);
  });
  it('124, no .started (the outer bound fired in the slot queue): skipped-slots', { timeout: T }, () => {
    const r = after({ CCRC_GRAPH_SLOT_WAIT_SECS: '1', CCRC_GRAPH_BUILD_TIMEOUT: '1' }, { 'sleep-before': '6' });
    expect(r).toMatchObject({ outcome: 'skipped-slots', fail: '' });
    expect(why(r)).toBe('no heavy test slot within CCRC_GRAPH_SLOT_WAIT_SECS=1 (the outer bound fired in the queue)');
  });
  it('124, .started (row 7: a wedged engine): timed-out, not a hung pass', { timeout: T }, () => {
    const t0 = Date.now();
    const r = after({ CCRC_GRAPH_BUILD_TIMEOUT: '2', GRAPH_STUB_SLEEP_S: '60' });
    expect(r).toMatchObject({ outcome: 'timed-out', fail: '', reason: 'the build exceeded CCRC_GRAPH_BUILD_TIMEOUT=2s' });
    expect(Date.now() - t0).toBeLessThan(40_000);
  });
  it('137, .started, `ccrc test`\'s OOM sentence: oom-killed', { timeout: T }, () => {
    const r = after({}, { oom: '', 'exit-after': '137' });
    expect(r).toMatchObject({ outcome: 'oom-killed', fail: '' });
    expect(why(r)).toMatch(/the test slice's memory cap killed a process during this run/);
  });
  it('137, .started, no OOM sentence, elapsed ≥ BUILD_TIMEOUT: timed-out (the --kill-after KILL)', { timeout: T }, () => {
    const r = after({ CCRC_GRAPH_BUILD_TIMEOUT: '1' }, { 'sleep-after': '1.5', 'exit-after': '137' });
    expect(r).toMatchObject({ outcome: 'timed-out', fail: '', reason: 'killed after CCRC_GRAPH_BUILD_TIMEOUT=1s (the --kill-after KILL)' });
  });
  it('137, .started, no OOM sentence, elapsed < BUILD_TIMEOUT (an external SIGKILL): failed (killed by signal 9), fail: unknown', { timeout: T }, () => {
    expect(after({ GRAPH_STUB_MODE: 'sigkill' })).toMatchObject({ outcome: 'failed', fail: 'unknown', reason: 'killed by signal 9' });
  });
  it('137 after a long slot wait: "elapsed" is the build\'s own, from .started, so the wait does not make it a timeout', { timeout: T }, () => {
    const r = after({ CCRC_GRAPH_BUILD_TIMEOUT: '2', GRAPH_STUB_MODE: 'sigkill' }, { 'sleep-before': '3' });
    expect(r).toMatchObject({ outcome: 'failed', fail: 'unknown', reason: 'killed by signal 9' });
  });
  it('any other exit, .started: failed (exit <n>), fail: unknown', { timeout: T }, () => {
    expect(after({}, { 'exit-after': '5' })).toMatchObject({ outcome: 'failed', fail: 'unknown', reason: 'exit 5' });
  });
  it('any other exit, no .started: failed (exit <n> before the build started), fail: setup', { timeout: T }, () => {
    expect(after({}, { 'exit-before': '5' })).toMatchObject({ outcome: 'failed', fail: 'setup', reason: 'exit 5 before the build started' });
  });
  it('the sweep\'s check before the call, `ccrc test --status` rc 2: failed (the status line), fail: setup, and no build runs', { timeout: T }, () => {
    const line = 'ccrctests.slice holds 0B with no memory cap (MemoryMax=infinity); heavy slots 0 of 2 held, 0 waiting';
    const r = after({}, { status: `${line}\n2\n` });
    expect(r).toMatchObject({ outcome: 'failed', fail: 'setup', reason: `ccrc test --status: ${line}` });
    expect(buildCalls()).toEqual([]);
    expect(calls()).toEqual([]);
  });
  // D-7357: the row's peak_mem_kb and cpu_ms are the wrapper's last stdout line, which it reads from its own cgroup
  // (the `0::` line of /proc/self/cgroup, under CCRC_CGROUP_ROOT); a fixture tree stands in for the scope's files.
  const cg = fs.existsSync('/proc/self/cgroup') ? /^0::(.*)$/m.exec(fs.readFileSync('/proc/self/cgroup', 'utf8'))?.[1] : undefined;
  (cg !== undefined ? it : it.skip)('D-7357 — peak_mem_kb and cpu_ms come from the wrapper\'s own cgroup, into the row and meta.json', { timeout: T }, () => {
    const root = j('cgroup');
    const dir = path.join(root, cg!.replace(/^\//, ''));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'memory.peak'), `${2048 * 1024}\n`);
    fs.writeFileSync(path.join(dir, 'cpu.stat'), 'usage_usec 345000\nuser_usec 1\n');
    const r = after({ CCRC_CGROUP_ROOT: root });
    expect(r).toMatchObject({ outcome: 'rebuilt', peak_mem_kb: 2048, cpu_ms: 345 });
    expect(r.reason).not.toContain('peak unmeasured');
    const m = JSON.parse(fs.readFileSync(path.join(STORE(), r.repo_key, 'current', 'meta.json'), 'utf8')) as Record<string, unknown>;
    expect([m['peak_mem_kb'], m['cpu_ms']]).toEqual([2048, 345]);
  });
  it('spec §3.4 — a build whose peak the wrapper could not read says "peak unmeasured", and only then', { timeout: T }, () => {
    const r = after({});
    if (r.peak_mem_kb === null) expect(r.reason).toMatch(/(^|; )peak unmeasured$/);
    else expect(r.reason).not.toContain('peak unmeasured');
  });
  it('an uncontained run (no user manager) builds, and the row says so', { timeout: T }, () => {
    const line = 'no user manager here, so runs are not contained; heavy slots 0 of 2 held, 0 waiting';
    const r = after({}, { status: `${line}\n0\n` });
    expect(r.outcome).toBe('rebuilt');
    expect(why(r)).toContain(`uncontained: ${line}`);
  });

  for (const mode of ['sigkill', 'raise']) {
    it(`D-7366 — an unknown failure (${mode}) after a published build never escalates: the next pass is incremental`, { timeout: T }, () => {
      const r = after({ GRAPH_STUB_MODE: mode }, {}, 'published');
      expect(r).toMatchObject({ kind: 'incremental', outcome: 'failed', fail: 'unknown' });
      const repo = j('projects', 'project-a');
      bump(repo);
      sweep(INCR);
      expect(rowOf(repo)).toMatchObject({ kind: 'incremental', outcome: 'refreshed' });
    });
  }
});

// ── the corpus guard on the checkout (spec §2.2; 08-27 rows 2, 3, 19, D-1160, D-1161) ──
describe('the corpus guard and the generated filter, in the store\'s checkout', () => {
  it('an untracked path in detect()\'s corpus refuses the build: refused-by-guard, nothing published', { timeout: T }, () => {
    const repo = makeRepo();
    sweep({ GRAPH_STUB_DETECT_EXTRA: JSON.stringify(Array.from({ length: 7 }, (_, i) => `u${i}.py`)) });
    expect(rowOf(repo)).toMatchObject({ outcome: 'refused-by-guard', kind: 'full' });
    expect(why(rowOf(repo))).toBe('untracked paths entered the corpus: u0.py u1.py u2.py u3.py u4.py (+2 more)');
    expect(calls()).toEqual([]);
    expect(fs.existsSync(path.join(keyDir(repo), 'current'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'graphify-out')), 'N16: no link without a published build').toBe(false);
  });

  it('D-1454 — a breach inside the five-path cap carries no count clause', { timeout: T }, () => {
    const repo = makeRepo();
    sweep({ GRAPH_STUB_DETECT_EXTRA: '["u0.py","u1.py"]' });
    expect(why(rowOf(repo))).toBe('untracked paths entered the corpus: u0.py u1.py ');
  });

  it('D-1449 — a TRACKED path git C-quotes (non-ASCII, a backslash, a quote, a tab) is not read as untracked', { timeout: T }, () => {
    const repo = makeRepo('project-a', { 'J\u00e0rn.py': 'x\n', 'back\\slash.py': 'b\n', 'quo"te.py': 'q\n', 'tab\tname.py': 't\n' });
    sweep();
    expect(rowOf(repo).outcome, why(rowOf(repo))).toBe('rebuilt');
  });

  it('D-1449 — an UNTRACKED non-ASCII or backslash-named path still refuses, and the reason carries the raw name', { timeout: T }, () => {
    const repo = makeRepo();
    sweep({ GRAPH_STUB_DETECT_EXTRA: JSON.stringify(['J\u00e0rn.bin', 'back\\slash.bin']) });
    expect(rowOf(repo).outcome).toBe('refused-by-guard');
    // the order is `sort`'s in the box's locale, so the names are checked, not their order
    expect(why(rowOf(repo))).toMatch(/^untracked paths entered the corpus: /);
    expect(why(rowOf(repo)).slice('untracked paths entered the corpus: '.length).trim().split(' ').sort()).toEqual(['J\u00e0rn.bin', 'back\\slash.bin'].sort());
  });

  it('F2 — the noise list is found by the main checkout\'s name, a name with a space included', { timeout: T }, () => {
    const repo = makeRepo('project a');
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'project a.list'), '!x\n');
    sweep();
    expect(rowOf(repo)).toMatchObject({ outcome: 'refused-by-guard', repo_key: expect.stringMatching(/^project_a-[0-9a-f]{8}$/) });
    expect(why(rowOf(repo))).toContain("noise list ~/.ccrc/graph-noise/project a.list carries a '!' line");
  });

  it('a venv python that cannot run is a refusal, never a silent success', { timeout: T }, () => {
    const repo = makeRepo();
    fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'python'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    sweep();
    expect(rowOf(repo)).toMatchObject({ outcome: 'refused-by-guard', kind: 'full' });
    expect(why(rowOf(repo))).toBe("detect() failed in the store's checkout");
    expect(fs.existsSync(path.join(keyDir(repo), 'current'))).toBe(false);
  });

  it('a "!" line in either noise list refuses (rule 1), with leading whitespace too', { timeout: T }, () => {
    const repo = makeRepo();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    for (const [f, t] of [['_default.list', '  !keep.md\n'], ['project-a.list', '!x\n']] as const) {
      fs.writeFileSync(j('.ccrc', 'graph-noise', f), t);
      sweep();
      expect(rowOf(repo).outcome, f).toBe('refused-by-guard');
      expect(why(rowOf(repo))).toContain(`noise list ~/.ccrc/graph-noise/${f} carries a '!' line`);
      fs.rmSync(j('.ccrc', 'graph-noise', f));
    }
  });

  it('the generated .graphifyignore lives in the checkout, excluded there, and never in a tree', { timeout: T }, () => {
    const repo = makeRepo();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'ccd', 'graph-noise.default.list'), j('.ccrc', 'graph-noise', '_default.list'));
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'project-a.list'), 'vendor/\n');
    sweep();
    const ck = path.join(keyDir(repo), 'project-a');
    const gen = fs.readFileSync(path.join(ck, '.graphifyignore'), 'utf8').split('\n');
    expect(gen[0]).toBe('# generated by ccd-graph-sweep for the repository\'s graph — never committed, never edited');
    expect(gen).toEqual(expect.arrayContaining(['.remember/', '.claude/', 'vendor/']));
    expect(fs.readFileSync(path.join(ck, '.git', 'info', 'exclude'), 'utf8').split('\n')).toContain('/.graphifyignore');
    expect(git(ck, 'status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(repo, '.graphifyignore'))).toBe(false);
  });

  it('D-1161 (rule 3) — a default pattern the commit tracks files under is withheld and said; an operator pattern is honoured', { timeout: T }, () => {
    const repo = makeRepo('project-a', { 'a.py': 'x\n', '.claude/settings.json': '{}\n', 'vendor/v.py': 'v\n' });
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', '_default.list'), '.claude/\n.remember/\n');
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'project-a.list'), 'vendor/\n');
    const r = sweep();
    expect(r.stderr).toContain('graph-sweep: project-a: default noise withheld, the repository tracks matching files: .claude/ (a project-a.list is honoured as written)');
    const gen = fs.readFileSync(path.join(keyDir(repo), 'project-a', '.graphifyignore'), 'utf8').split('\n');
    expect(gen).toContain('.remember/');
    expect(gen).not.toContain('.claude/');
    expect(gen).toContain('vendor/');
    expect(graphOf(current(repo)).nodes.map((n) => n.source_file).sort()).toEqual(['.claude/settings.json', 'a.py']);
  });

  it('rule 2 — a committed .graphifyignore: the default yields, the operator\'s list is appended, the committed file is kept', { timeout: T }, () => {
    const repo = makeRepo('project-a', { 'a.py': 'x\n', '.graphifyignore': 'docs/\n', 'docs/d.py': 'd\n', 'vendor/v.py': 'v\n' });
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', '_default.list'), '.remember/\n');
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'project-a.list'), 'vendor/\n');
    sweep();
    expect(rowOf(repo).outcome, why(rowOf(repo))).toBe('rebuilt');
    const gen = fs.readFileSync(path.join(keyDir(repo), 'project-a', '.graphifyignore'), 'utf8').split('\n');
    expect(gen.slice(0, 3)).toEqual(['# generated by ccd-graph-sweep for the repository\'s graph — never committed, never edited', 'docs/', 'vendor/']);
    expect(gen).not.toContain('.remember/');
    expect(fs.readFileSync(path.join(repo, '.graphifyignore'), 'utf8'), 'the tree\'s committed file is untouched').toBe('docs/\n');
    expect(graphOf(current(repo)).nodes.map((n) => n.source_file).sort()).toEqual(['.graphifyignore', 'a.py']);
  });

  it('the stray filter an old sweep left in a tree is removed; a foreign one is left byte-identical', { timeout: T }, () => {
    const a = makeRepo('project-a');
    const b = makeRepo('lane-a', { 'a.py': 'x\n', '.graphifyignore': 'docs/\n' });
    fs.writeFileSync(path.join(a, '.graphifyignore'), '# generated by ccd-graph-sweep for one build — never committed, never edited\nx/\n');
    fs.appendFileSync(path.join(a, '.git', 'info', 'exclude'), '.graphifyignore\n');
    sweep();
    expect(fs.existsSync(path.join(a, '.graphifyignore'))).toBe(false);
    expect(fs.readFileSync(path.join(b, '.graphifyignore'), 'utf8')).toBe('docs/\n');
    expect(git(b, 'status', '--porcelain')).toBe('');
  });

  it('row 19 / N23 — files under the repository\'s memory/ are exempt: a graph that answered queries still builds', { timeout: T }, () => {
    const repo = published();
    fs.writeFileSync(path.join(keyDir(repo), 'memory', 'q.md'), 'saved\n');
    sleep(1100);
    sweep({ CCRC_GRAPH_FULL_REBUILD_SECS: '1' });
    expect(rowOf(repo).outcome, why(rowOf(repo))).toBe('rebuilt');
  });
});

// ── links and excludes (spec §6.1; N1, N16; 08-27 rows 1, 15) ──────────────
describe('links and excludes', () => {
  it('N1 — the exclude lines carry the no-slash line; the link is ignored, and `git worktree remove` takes a tree holding it', { timeout: T }, () => {
    const repo = makeRepo();
    const ws = j('worktrees', 'project-a', 'lane-a');
    fs.mkdirSync(path.dirname(ws), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'lane-a', ws);
    sweep();
    const excl = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n');
    expect(excl).toEqual(expect.arrayContaining(['graphify-out/', 'graphify-out', '.graphifyignore']));
    expect(fs.lstatSync(path.join(ws, 'graphify-out')).isSymbolicLink()).toBe(true);
    expect(git(ws, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    const target = current(repo);
    git(repo, 'worktree', 'remove', ws);
    expect(fs.existsSync(ws)).toBe(false);
    expect(fs.existsSync(path.join(target, 'graph.json')), 'the shared graph is untouched').toBe(true);
  });

  it('row 15 — a fresh repository with no exclude lines at all becomes linked: the sweep writes them first', { timeout: T }, () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '');
    sweep();
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toBe('graphify-out/\ngraphify-out\n.graphifyignore\n');
    expect(rowOf(repo).linked).toBe(1);
    sweep();
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'), 'once each').toBe('graphify-out/\ngraphify-out\n.graphifyignore\n');
  });

  it('row 1 — a tree where `git check-ignore -q graphify-out` still fails gets no link, and the row says so', { timeout: T }, () => {
    const repo = makeRepo('project-a', { 'a.py': 'x\n', '.gitignore': '!graphify-out\n' });
    sweep();
    expect(rowOf(repo).outcome).toBe('rebuilt');
    expect(fs.existsSync(path.join(repo, 'graphify-out'))).toBe(false);
    expect(rowOf(repo).linked).toBe(0);
    expect(why(rowOf(repo))).toContain('1 tree(s) not linked: git check-ignore graphify-out fails there');
  });

  it('N16 — no link before the repository\'s current resolves; the link follows the first published build', { timeout: T }, () => {
    const repo = makeRepo();
    sweep({ GRAPH_STUB_MODE: 'false' });
    expect(rowOf(repo).outcome).toBe('failed');
    expect(fs.existsSync(path.join(repo, 'graphify-out'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.git', 'info', 'exclude')) && fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n').includes('graphify-out'),
      'no exclude write before a link is due').toBe(false);
    sweep();
    expect(fs.readlinkSync(path.join(repo, 'graphify-out'))).toBe(path.join(keyDir(repo), 'current'));
  });

  it('a tree whose graphify-out is a real directory is left for migration (GR6), counted as pending', { timeout: T }, () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, 'graphify-out'));
    fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'), '{}');
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), 'graphify-out/\n');
    sweep();
    expect(fs.lstatSync(path.join(repo, 'graphify-out')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'graphify-out', 'graph.json'), 'utf8')).toBe('{}');
    expect(rowOf(repo)).toMatchObject({ linked: 0, migrate: { done: 0, pending: 1, refused: [] } });
  });

  it('§Review focus 1 — nothing in a tree changes but the link: a before-and-after listing of every tree', { timeout: T }, () => {
    const repo = makeRepo();
    const ws = j('worktrees', 'project-a', 'lane-a');
    fs.mkdirSync(path.dirname(ws), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'lane-a', ws);
    const list = (d: string): string[] => execFileSync('find', [d, '-path', '*/.git', '-prune', '-o', '-print'], { encoding: 'utf8' })
      .split('\n').filter((l) => l !== '').sort();
    const before = [...list(repo), ...list(ws)];
    sweep();
    commit(repo, { 'n.py': 'n\n' });
    sweep(INCR);
    const added = [...list(repo), ...list(ws)].filter((p) => !before.includes(p));
    expect(added).toEqual([path.join(repo, 'n.py'), path.join(repo, 'graphify-out'), path.join(ws, 'graphify-out')].sort());
  });
});

// ── tree discovery: `_gs_trees`, kept (D-1367, D-1370, D-1371, D-1510, D-1563) ───
// A tree is still a git TOPLEVEL under the two roots, discovered once by realpath, and a `.claude/worktrees` candidate
// only while a registered session lives in it. What discovery decides now is which trees get a link and how many the
// repository's row counts; the per-tree rows these cases asserted on are gone with the per-tree sweep.
describe('tree discovery (the per-tree rows of D-1367 to D-1563, retargeted to links and the row\'s tree count)', () => {
  function makeWorktreeRoot(name: string): string {
    const d = j('worktrees', name);
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', d]);
    commit(d, { 'a.py': 'x = 1\n', 'src/b.py': 'y = 2\n' }, 'init');
    return d;
  }
  const linked = (t: string): boolean => fs.existsSync(path.join(t, 'graphify-out')) && fs.lstatSync(path.join(t, 'graphify-out')).isSymbolicLink();
  const registerSession = (id: string, tree: string): void => {
    fs.mkdirSync(j('.cc-sessions'), { recursive: true });
    fs.writeFileSync(j('.cc-sessions', `${id}.workdir`), `${tree}\n`);
  };

  it('D-1367 — a depth-1 worktree is a tree ITSELF, and none of its subdirectories is', { timeout: T }, () => {
    const solo = makeWorktreeRoot('solo');
    expect(sweep().status).toBe(0);
    expect(treeCount(rowOf(solo))).toBe(1);
    expect(linked(solo)).toBe(true);
    expect(fs.existsSync(path.join(solo, 'src', 'graphify-out')), 'a plain subdirectory got a link').toBe(false);
    expect(fs.existsSync(path.join(solo, '.git', 'graphify-out')), 'the git dir got a link').toBe(false);
  });

  it('D-1367 — a depth-2 worktree and its main checkout are trees, the directory holding the worktree is not', { timeout: T }, () => {
    const repo = makeRepo();
    const ws = j('worktrees', 'project-a', 'lane-a');
    fs.mkdirSync(path.dirname(ws), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'lane-a', ws);
    sweep();
    expect(treeCount(rowOf(repo))).toBe(2);
    expect([linked(repo), linked(ws)]).toEqual([true, true]);
    expect(fs.existsSync(j('worktrees', 'project-a', 'graphify-out'))).toBe(false);
  });

  it('D-1367 — a candidate whose canonical path is UNMEASURABLE is skipped, never "two empties are equal"', { timeout: T }, () => {
    const solo = makeWorktreeRoot('solo');
    const stub = j('pathstub'); fs.mkdirSync(stub, { recursive: true });
    for (const name of ['realpath', 'readlink']) fs.writeFileSync(path.join(stub, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    sweep({ PATH: `${stub}:${j('bin')}:${process.env['PATH'] ?? ''}` });
    expect(lastPass().status).toBe('probed-zero');
    expect(fs.existsSync(path.join(solo, 'graphify-out'))).toBe(false);
  });

  it('D-1370 — two names of one tree are one tree (dedupe by realpath): counted once, linked once', { timeout: T }, () => {
    const repo = makeRepo('project-a');
    fs.symlinkSync(repo, j('projects', 'project-a-link'));
    sweep();
    expect(lastPass().repos).toHaveLength(1);
    expect(treeCount(rowOf(repo))).toBe(1);
    expect(linked(repo)).toBe(true);
  });

  it('D-1370 — an alias under the other root is the same tree, counted once', { timeout: T }, () => {
    const real = makeWorktreeRoot('project-a');
    fs.symlinkSync(real, j('projects', 'project-a'));
    sweep();
    expect(lastPass().repos).toHaveLength(1);
    expect(treeCount(rowOf(real))).toBe(1);
    expect(linked(real)).toBe(true);
  });

  it('D-1371 — under a symlinked projects root (the live fleet shape) an alias is still the same tree', { timeout: T }, () => {
    fs.rmSync(j('projects'), { recursive: true });
    fs.mkdirSync(j('real-projects'));
    fs.symlinkSync(j('real-projects'), j('projects'));
    const zeta = makeRepo('zeta');
    fs.symlinkSync('zeta', j('projects', 'alpha'));
    sweep();
    expect(lastPass().repos).toHaveLength(1);
    expect(treeCount(rowOf(zeta))).toBe(1);
    expect(linked(zeta)).toBe(true);
  });

  for (const [shape, place] of [
    ['under $PROJECTS_ROOT', (repo: string): string => repo],
    ['under a depth-2 workspace', (repo: string): string => {
      const ws = j('worktrees', 'project-a', 'lane-a');
      fs.mkdirSync(path.dirname(ws), { recursive: true });
      git(repo, 'worktree', 'add', '-q', '-b', 'lane-a', ws);
      return ws;
    }],
  ] as const) {
    it(`D-1510 — a Claude Code worktree ${shape} that a session lives in is a tree of its repository; a plain directory beside it is not`, { timeout: T }, () => {
      const repo = makeRepo();
      const holder = place(repo);
      const wt = path.join(holder, '.claude', 'worktrees', 'x');
      fs.mkdirSync(path.dirname(wt), { recursive: true });
      git(holder, 'worktree', 'add', '-q', '-b', `x-${shape.length}`, wt);
      // D-1562: the registry may spell the tree through a symlinked root; realpaths compare
      fs.symlinkSync(j('projects'), j('data'));
      registerSession('lane-a', wt.replace(j('projects'), j('data')));
      const notatree = path.join(holder, '.claude', 'worktrees', 'notatree');
      fs.mkdirSync(notatree, { recursive: true });
      fs.writeFileSync(path.join(notatree, 'a.py'), 'x = 1\n');
      sweep();
      expect(linked(wt), 'the session\'s own worktree reads its repository\'s graph').toBe(true);
      expect(fs.existsSync(path.join(notatree, 'graphify-out'))).toBe(false);
      expect(treeCount(rowOf(repo))).toBe(holder === repo ? 2 : 3);
    });
  }

  it('D-1510 — a Claude Code worktree under a DEPTH-1 workspace is a tree too', { timeout: T }, () => {
    const solo = makeWorktreeRoot('solo');
    const wt = path.join(solo, '.claude', 'worktrees', 'z');
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    git(solo, 'worktree', 'add', '-q', '-b', 'z', wt);
    registerSession('lane-a', wt);
    sweep();
    expect(linked(wt)).toBe(true);
    expect(treeCount(rowOf(solo))).toBe(2);
  });

  it('D-1563 — a .claude/worktrees tree NO session lives in is not a tree: no link, not counted', { timeout: T }, () => {
    const repo = makeRepo();
    const x = path.join(repo, '.claude', 'worktrees', 'x');
    const y = path.join(repo, '.claude', 'worktrees', 'y');
    fs.mkdirSync(path.dirname(x), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'x', x);
    git(repo, 'worktree', 'add', '-q', '-b', 'y', y);
    registerSession('lane-a', x);
    sweep();
    expect([linked(repo), linked(x), linked(y)]).toEqual([true, true, false]);
    expect(treeCount(rowOf(repo))).toBe(2);
  });
});

// ── the per-repository rows that are not builds ───────────────────────────
describe('excluded, no-source, the fetch', () => {
  it('CCRC_GRAPH_REPOS_EXCLUDE: the repository is `excluded`, gets no store directory and no link; the others build', { timeout: T }, () => {
    const repo = makeRepo();
    const other = makeRepo('lane-a');
    // spec §2.1's key: the main checkout's name, "-", the first 8 hex of sha256(realpath(common dir))
    const key = `lane-a-${createHash('sha256').update(sourceOf(other)).digest('hex').slice(0, 8)}`;
    sweep({ CCRC_GRAPH_REPOS_EXCLUDE: key });
    expect(rowOf(other)).toMatchObject({ repo_key: key, outcome: 'excluded', kind: '', reason: `CCRC_GRAPH_REPOS_EXCLUDE names ${key}` });
    expect(fs.existsSync(path.join(STORE(), key))).toBe(false);
    expect(fs.existsSync(path.join(other, 'graphify-out'))).toBe(false);
    expect(rowOf(repo).outcome).toBe('rebuilt');
  });

  it('no-source: a repository whose source ref names no commit', { timeout: T }, () => {
    const d = j('projects', 'project-a');
    fs.mkdirSync(d, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', d]);
    sweep();
    expect(rowOf(d)).toMatchObject({ outcome: 'no-source', kind: '', tip: '' });
    expect(why(rowOf(d))).toMatch(/^none of .*origin\/master or the local default branch names a commit in '/);
  });

  it('spec §3.1 step 1 — the source ref is origin\'s, fetched at most once per FETCH_SECS; a failed fetch is a reason, not an outcome', { timeout: T }, () => {
    const upstream = j('upstream');
    fs.mkdirSync(upstream);
    execFileSync('git', ['init', '-q', '-b', 'main', upstream]);
    commit(upstream, { 'a.py': 'x\n' });
    const repo = j('projects', 'project-a');
    execFileSync('git', ['clone', '-q', upstream, repo]);
    sweep({ CCRC_GRAPH_FETCH_SECS: '900' });
    expect(rowOf(repo)).toMatchObject({ outcome: 'rebuilt', ref: 'refs/remotes/origin/main', tip: git(upstream, 'rev-parse', 'HEAD') });
    const moved = commit(upstream, { 'b.py': 'y\n' });
    sweep({ CCRC_GRAPH_FETCH_SECS: '900' });
    expect(rowOf(repo).tip, 'inside the throttle nothing is fetched').not.toBe(moved);
    fs.utimesSync(path.join(repo, '.git', 'FETCH_HEAD'), new Date(0), new Date(0));
    sweep({ CCRC_GRAPH_FETCH_SECS: '900' });
    expect(rowOf(repo)).toMatchObject({ tip: moved, outcome: 'rebuilt' });
    expect(git(repo, 'rev-parse', 'refs/remotes/origin/main')).toBe(moved);
    fs.renameSync(upstream, `${upstream}.gone`);
    fs.utimesSync(path.join(repo, '.git', 'FETCH_HEAD'), new Date(0), new Date(0));
    sweep({ CCRC_GRAPH_FETCH_SECS: '900' });
    expect(rowOf(repo).outcome).toBe('fresh');
    expect(why(rowOf(repo))).toBe('fetch of origin main failed; using the refs this box has');
  });
});

// ── the real ccrc test (ccd/ccrc-test), on whatever host this is ──────────
describe('the real ccd/ccrc-test runs the build (D-7356)', () => {
  const realStatus = (): { line: string; rc: number } => {
    const r = spawnSync(path.join(REPO, 'ccd', 'ccrc-test'), ['--status'], { encoding: 'utf8', env: sweepEnv() });
    return { line: (r.stdout ?? '').trim().split('\n').at(-1) ?? '', rc: r.status ?? -1 };
  };
  it('the sweep\'s row follows the real `--status`: a refusal is failed, fail: setup, with its line; otherwise the build runs', { timeout: 120_000 }, () => {
    fs.rmSync(j('ccrc', 'ccd', 'ccrc-test'));
    fs.symlinkSync(path.join(REPO, 'ccd', 'ccrc-test'), j('ccrc', 'ccd', 'ccrc-test'));
    const repo = makeRepo();
    const st = realStatus();
    sweep();
    if (st.rc === 2) {
      expect(rowOf(repo)).toMatchObject({ outcome: 'failed', fail: 'setup', reason: `ccrc test --status: ${st.line}` });
      expect(calls()).toEqual([]);
    } else {
      expect(st.rc).toBe(0);
      expect(rowOf(repo).outcome, why(rowOf(repo))).toBe('rebuilt');
      if (/not contained/.test(st.line)) expect(why(rowOf(repo))).toContain(`uncontained: ${st.line}`);
    }
  });
});

// ── the real engine (venv-gated; quiet-box CI is the arbiter) ─────────────
const realVenv = process.env['CCRC_GRAPHIFY_TEST_VENV'];   // set on the fleet box only
const itVenv = realVenv && fs.existsSync(path.join(realVenv, 'bin', 'graphify')) ? it : it.skip;

describe('graph-sweep: real-engine integration (venv-gated; quiet-box CI is the arbiter)', () => {
  // The fixture's venv python delegates to the real one; the stub leaves PYTHONPATH.
  const useRealEngine = (): NodeJS.ProcessEnv => {
    fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'python'), `#!/bin/sh\nexec "$REAL_VENV/bin/python" "$@"\n`, { mode: 0o755 });
    const v = execFileSync(path.join(realVenv!, 'bin', 'python'), ['-c', 'import importlib.metadata as m; print(m.version("graphifyy"))'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), `${v}\n`);
    return { PYTHONPATH: undefined, REAL_VENV: realVenv, CCRC_GRAPH_BUILD_TIMEOUT: '300' };
  };
  itVenv('row 5b — NO_BACKUP: a published build holds no dated backup directory', { timeout: 600_000 }, () => {
    const repo = makeRepo('semantic');
    const env = useRealEngine();
    sweep(env);
    expect(rowOf(repo).outcome, why(rowOf(repo))).toBe('rebuilt');
    expect(fs.readdirSync(current(repo)).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))).toEqual([]);
  });
  itVenv('row 18 behavioural — GRAPHIFY_MAX_WORKERS bounds the extraction pool', { timeout: 600_000 }, () => {
    const repo = makeRepo('busy50');
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(repo, `m${i}.py`), `x${i} = ${i}\n`);
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'files');
    sweep({ ...useRealEngine(), CCRC_GRAPH_MAX_WORKERS: '1' });
    expect(fs.readFileSync(j('.ccrc', 'graph-sweep.log'), 'utf8')).toMatch(/\[1 workers?\]/);   // graphify logs "[N workers]"
  });
});
