// Graphify revision 2, Task GR3 (D-7349; spec §3.4, the plan's outcome table): ccd/graph-build, the engine wrapper,
// driven against the stub engine in test/fixtures/graph-engine (on PYTHONPATH, which `-s -P` keep). Spec §11 rows:
//
//   N3   the engine contract: a _rebuild_code lacking changed_paths, force or acquire_lock makes --probe exit 2;
//        the real pinned package passes --probe (only where its venv exists);
//   N6   the root convention: a cwd other than --root exits 2; every published source_file is repository-relative,
//        except the saved-result spelling graphify-out/memory/<path> (finding 4);
//   N7   GRAPHIFY_OUT is honoured only when the engine read it at import;
//   N8   no silent queue: the engine is called with acquire_lock=False; no .pending_changes or .rebuild.lock;
//   N24  the output's basename is graphify-out; a repository tracking staging/ keeps those files;
//   N26  the OOM victim: the wrapper and its forked worker run with oom_score_adj 1000 (Linux);
//   N29  peak memory and CPU come from the wrapper's own cgroup (a fixture tree under CCRC_CGROUP_ROOT);
// plus the slot-wait refusal (finding 2) and the exit-code rows of the outcome table's first five lines.
//
// The interpreter is `python3 -s -P`, as the sweep runs the venv's: Python 3.11 or later.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD = path.join(REPO, 'ccd', 'graph-build');
const STUB = path.join(REPO, 'server', 'test', 'fixtures', 'graph-engine');
const LINUX = process.platform === 'linux';
const LAST_STDOUT = /^graph-build: peak_kb=(\d+|null) cpu_ms=(\d+|null)$/;
const CLASS_LINE = /^graph-build: (setup|slot-wait|engine|publish): .+$/;

const git = (cwd: string, ...args: string[]): string => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  Object.assign(env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
};

interface Fx { store: string; root: string; staging: string; out: string; memory: string; record: string; commit: string }
/** A store laid out as spec §2.1: <store>/project-a-0123abcd/{project-a (the checkout), staging/graphify-out, memory},
 *  with the absolute memory link inside the staged output, as the sweep places it (§3.5). */
function fixture(files: Record<string, string> = { 'a.py': 'def a():\n    return 1\n', 'lib/b.py': 'x = 1\n' }): Fx {
  const store = mkTmp('graph-build-');
  const key = path.join(store, 'project-a-0123abcd');
  const root = path.join(key, 'project-a');
  const staging = path.join(key, 'staging');
  const out = path.join(staging, 'graphify-out');
  const memory = path.join(key, 'memory');
  for (const d of [root, out, memory]) mkdirSync(d, { recursive: true });
  symlinkSync(memory, path.join(out, 'memory'));
  git(root, 'init', '-q');
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), t);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'one');
  return { store, root, staging, out, memory, record: path.join(store, 'record.jsonl'), commit: git(root, 'rev-parse', 'HEAD') };
}

interface Run { status: number | null; stdout: string; stderr: string; out: string[]; err: string[] }
interface Opts { args?: Record<string, string | null>; extra?: string[]; env?: NodeJS.ProcessEnv; cwd?: string; python?: string; pythonpath?: string | null }
/** One wrapper run. `args` overrides (null drops) the sweep's arguments; `env` adds to (undefined removes from) the
 *  wrapper's environment, which starts as the sweep's: GRAPHIFY_OUT=--out, the stub on PYTHONPATH. */
function run(fx: Fx, o: Opts = {}): Run {
  const base: Record<string, string | null> = {
    '--root': fx.root, '--out': fx.out, '--commit': fx.commit, '--pin': '0.9.9', '--memory': fx.memory,
    '--launched': String(Math.floor(Date.now() / 1000)), '--slot-wait': '600',
  };
  const argv: string[] = [];
  for (const [k, v] of Object.entries({ ...base, ...(o.args ?? {}) })) if (v !== null) argv.push(k, v);
  argv.push(...(o.extra ?? []));
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!/^(GRAPHIFY_|GRAPH_STUB_|CCRC_|PYTHON|GIT_)/.test(k)) env[k] = v;
  Object.assign(env, { GRAPHIFY_OUT: fx.out, PYTHONDONTWRITEBYTECODE: '1', GRAPH_STUB_RECORD: fx.record });
  if (o.pythonpath !== null) env.PYTHONPATH = o.pythonpath ?? STUB;
  for (const [k, v] of Object.entries(o.env ?? {})) { if (v === undefined) delete env[k]; else env[k] = v; }
  const r = spawnSync(o.python ?? 'python3', ['-s', '-P', BUILD, ...argv], { cwd: o.cwd ?? fx.root, env, encoding: 'utf8', timeout: 120000 });
  const lines = (s: string | null): string[] => (s ?? '').split('\n').filter((l) => l !== '');
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: lines(r.stdout), err: lines(r.stderr) };
}
type Rec = Record<string, unknown>;
const records = (fx: Fx): Rec[] =>
  existsSync(fx.record) ? readFileSync(fx.record, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Rec) : [];
const calls = (fx: Fx): Rec[] => records(fx).filter((r) => r.event === 'call');
const imported = (fx: Fx): boolean => records(fx).some((r) => r.event === 'import');
const started = (fx: Fx): boolean => existsSync(path.join(fx.staging, '.started'));
interface Graph { nodes: { source_file: string; by?: string }[]; links: { source_file: string }[]; built_at_commit: string }
const graph = (fx: Fx): Graph => JSON.parse(readFileSync(path.join(fx.out, 'graph.json'), 'utf8')) as Graph;
const sources = (fx: Fx): string[] => graph(fx).nodes.map((n) => n.source_file).sort();

/** The contract of every non-zero exit: exactly one `graph-build: <class>: …` stderr line, and it is the last. */
function refusedWith(r: Run, status: number, cls: string, detail: RegExp): void {
  expect(r.status, r.stderr).toBe(status);
  const named = r.err.filter((l) => l.startsWith('graph-build: '));
  expect(named, 'exactly one graph-build line on stderr').toHaveLength(1);
  expect(r.err[r.err.length - 1]).toBe(named[0]);
  expect(named[0]).toMatch(CLASS_LINE);
  expect(named[0].startsWith(`graph-build: ${cls}: `), named[0]).toBe(true);
  expect(named[0].slice(`graph-build: ${cls}: `.length)).toMatch(detail);
}

describe('python3 is new enough for `-s -P`', () => {
  it('3.11 or later', () => {
    const v = execFileSync('python3', ['-c', 'import sys; print(sys.version_info >= (3, 11))'], { encoding: 'utf8' }).trim();
    expect(v).toBe('True');
  });
});

describe('the slot wait (finding 2): a build never starts late', () => {
  it('launched longer ago than --slot-wait: exit 3, the slot-wait line, no .started, the engine not imported', () => {
    const fx = fixture();
    const r = run(fx, { args: { '--launched': String(Math.floor(Date.now() / 1000) - 100), '--slot-wait': '10' } });
    refusedWith(r, 3, 'slot-wait', /^started \d+s after launch, above CCRC_GRAPH_SLOT_WAIT_SECS=10$/);
    const n = Number(/started (\d+)s/.exec(r.err[r.err.length - 1])?.[1]);
    expect(n).toBeGreaterThanOrEqual(100);
    expect(started(fx)).toBe(false);
    expect(imported(fx), 'the engine was not imported').toBe(false);
    expect(existsSync(path.join(fx.out, 'graph.json'))).toBe(false);
  });

  it('it is the FIRST check: a late start with every other argument wrong still says slot-wait', () => {
    const fx = fixture();
    const r = run(fx, {
      args: { '--launched': String(Math.floor(Date.now() / 1000) - 100), '--slot-wait': '10', '--out': '/nowhere/staging', '--pin': '0.0.0' },
      cwd: fx.store, env: { GRAPHIFY_OUT: undefined },
    });
    refusedWith(r, 3, 'slot-wait', /above CCRC_GRAPH_SLOT_WAIT_SECS=10$/);
    expect(imported(fx)).toBe(false);
  });

  it('within the wait the build runs', () => {
    const fx = fixture();
    const r = run(fx, { args: { '--launched': String(Math.floor(Date.now() / 1000) - 5), '--slot-wait': '60' } });
    expect(r.status, r.stderr).toBe(0);
    expect(calls(fx)).toHaveLength(1);
  });
});

describe('the outcome table\'s first five lines, as the wrapper writes them', () => {
  it('exit 0 with .started: the engine returned True; the last stdout line is the measured figures', () => {
    const fx = fixture();
    const r = run(fx);
    expect(r.status, r.stderr).toBe(0);
    expect(started(fx)).toBe(true);
    expect(r.out[r.out.length - 1]).toMatch(LAST_STDOUT);
    expect(r.err.filter((l) => l.startsWith('graph-build: '))).toEqual([]);
    expect(graph(fx).built_at_commit).toBe(fx.commit);
  });

  it('exit 1 with .started and `engine: _rebuild_code returned False` (the one line that forces a full build)', () => {
    const fx = fixture();
    const r = run(fx, { env: { GRAPH_STUB_MODE: 'false' } });
    refusedWith(r, 1, 'engine', /^_rebuild_code returned False$/);
    expect(started(fx)).toBe(true);
    expect(r.out[r.out.length - 1]).toMatch(LAST_STDOUT);
  });

  it('exit 1 with .started and any other engine line: an exception is printed, then named, and is NOT the False line', () => {
    const fx = fixture();
    const r = run(fx, { env: { GRAPH_STUB_MODE: 'raise' } });
    refusedWith(r, 1, 'engine', /^_rebuild_code raised RuntimeError: stub engine failure$/);
    expect(r.err[r.err.length - 1]).not.toBe('graph-build: engine: _rebuild_code returned False');
    expect(r.stderr).toMatch(/Traceback/);
    expect(started(fx)).toBe(true);
  });

  it('exit 1 never happens before .started (that row is ccrc test\'s): an engine that cannot be imported is setup, exit 2', () => {
    const fx = fixture();
    const empty = mkTmp('graph-build-nopkg-');
    const r = run(fx, { pythonpath: empty });
    refusedWith(r, 2, 'setup', /^pin: the engine is graphifyy \(not installed\), not the pinned 0\.9\.9$/);
    expect(started(fx)).toBe(false);
  });

  it('exit 2 without .started: each setup refusal names its check', () => {
    const fx = fixture();
    const cases: [Opts, RegExp][] = [
      [{ args: { '--memory': null } }, /^arguments: missing --memory$/],
      [{ args: { '--slot-wait': 'soon' } }, /^arguments: /],
      [{ args: { '--pin': '0.9.8' } }, /^pin: the engine is graphifyy 0\.9\.9, not the pinned 0\.9\.8$/],
      [{ args: { '--commit': '0'.repeat(40) } }, /^commit: HEAD in the working directory is [0-9a-f]{40}, not --commit 0{40}$/],
      [{ args: { '--changed': path.join(fx.staging, 'missing.z') } }, /^changed: cannot read --changed /],
      [{ args: { '--out': 'graphify-out' } }, /^out: --out graphify-out is not an absolute path$/],
    ];
    for (const [o, detail] of cases) {
      refusedWith(run(fx, o), 2, 'setup', detail);
      expect(started(fx), JSON.stringify(o)).toBe(false);
      expect(calls(fx), JSON.stringify(o)).toEqual([]);
    }
  });

  it('a read-only file in --out is refused before the call (the engine would return False with no reason)', () => {
    if (process.getuid?.() === 0) return;   // root writes anything; the check is for the sweep's user
    const fx = fixture();
    writeFileSync(path.join(fx.out, 'GRAPH_REPORT.md'), 'x\n');
    chmodSync(path.join(fx.out, 'GRAPH_REPORT.md'), 0o444);
    refusedWith(run(fx), 2, 'setup', /^writable: .*GRAPH_REPORT\.md is not writable$/);
    expect(started(fx)).toBe(false);
  });

  it('"outputs left untouched": exit 0, graph.json as it was (the sweep\'s stamper owns the commit)', () => {
    const fx = fixture();
    const before = '{"nodes": [], "links": [], "built_at_commit": "previous"}\n';
    writeFileSync(path.join(fx.out, 'graph.json'), before);
    const r = run(fx, { env: { GRAPH_STUB_MODE: 'untouched' } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/outputs left untouched/);
    expect(r.out[r.out.length - 1]).toMatch(LAST_STDOUT);
    expect(readFileSync(path.join(fx.out, 'graph.json'), 'utf8')).toBe(before);
  });
});

describe('N3: the engine contract', () => {
  it('--probe passes against an engine with the pinned signature, imports it, calls nothing', () => {
    const fx = fixture();
    const r = run(fx, { extra: ['--probe'] });
    expect(r.status, r.stderr).toBe(0);
    expect(imported(fx)).toBe(true);
    expect(calls(fx)).toEqual([]);
    expect(started(fx)).toBe(false);
  });

  it('--probe needs only --pin', () => {
    const fx = fixture();
    const r = run(fx, { args: { '--root': null, '--out': null, '--commit': null, '--memory': null, '--launched': null, '--slot-wait': null }, extra: ['--probe'], env: { GRAPHIFY_OUT: undefined } });
    expect(r.status, r.stderr).toBe(0);
  });

  it.each(['changed_paths', 'force', 'acquire_lock'])('a _rebuild_code without %s: --probe exits 2, and a build is refused before .started', (p) => {
    const fx = fixture();
    refusedWith(run(fx, { extra: ['--probe'], env: { GRAPH_STUB_DROP: p } }), 2, 'setup', new RegExp(`^signature: _rebuild_code has no ${p}$`));
    refusedWith(run(fx, { env: { GRAPH_STUB_DROP: p } }), 2, 'setup', new RegExp(`^signature: _rebuild_code has no ${p}$`));
    expect(started(fx)).toBe(false);
    expect(calls(fx)).toEqual([]);
  });

  it('--probe against another version exits 2', () => {
    const fx = fixture();
    refusedWith(run(fx, { args: { '--pin': '0.9.10' }, extra: ['--probe'] }), 2, 'setup', /^pin: /);
  });

  // The pinned 0.9.9 itself, where its venv exists (the fleet box, a development machine that ran
  // `ccrc install`): --probe passes, and a build of the fixture repository through it is repository-relative.
  const venvPython = path.join(process.env.GRAPH_BUILD_TEST_VENV ?? path.join(homedir(), '.ccrc', 'graphify-venv'), 'bin', 'python');
  const haveVenv = existsSync(venvPython);
  if (!haveVenv) console.log(`graph-build.test: the real-engine rows are skipped: no pinned venv (${path.basename(path.dirname(path.dirname(venvPython)))}) on this machine`);
  it.skipIf(!haveVenv)('the real pinned engine: --probe exits 0, and a build is repository-relative and stamped at --commit', () => {
    const fx = fixture();
    writeFileSync(path.join(fx.memory, 'query_one.md'), '# Query: who calls a\n\nNobody.\n');
    const probe = run(fx, { python: venvPython, pythonpath: null, extra: ['--probe'] });
    expect(probe.status, probe.stderr).toBe(0);
    const r = run(fx, { python: venvPython, pythonpath: null });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out[r.out.length - 1]).toMatch(LAST_STDOUT);
    // Repository-relative, or the saved-result spelling (0.9.9 measured to drop a saved result outside the
    // checkout from detect(); either way no absolute or store path is published).
    expect([...new Set(sources(fx))].filter((s) => s !== 'graphify-out/memory/query_one.md')).toEqual(['a.py', 'lib/b.py']);
    expect(graph(fx).built_at_commit).toBe(fx.commit);
    expect(existsSync(path.join(fx.out, '.pending_changes'))).toBe(false);
    expect(existsSync(path.join(fx.out, '.rebuild.lock'))).toBe(false);
  });
});

describe('N6: the root convention', () => {
  it('a cwd other than --root exits 2 before the engine is imported', () => {
    const fx = fixture();
    refusedWith(run(fx, { cwd: fx.store }), 2, 'setup', /^cwd: the working directory .* is not --root /);
    expect(imported(fx)).toBe(false);
    expect(started(fx)).toBe(false);
  });

  it('a --root that is not the realpath of the cwd (a link to it) exits 2', () => {
    const fx = fixture();
    const alias = path.join(fx.store, 'alias');
    symlinkSync(fx.root, alias);
    refusedWith(run(fx, { args: { '--root': alias }, cwd: alias }), 2, 'setup', /^cwd: /);
  });

  it('the engine is called on Path("."), from --root, and every published source_file is repository-relative, except the saved-result spelling', () => {
    const fx = fixture();
    writeFileSync(path.join(fx.memory, 'query_one.md'), '# q\n');
    // The saved result as an engine could spell it: absolute through the memory link, and relative to the root.
    const extra = [path.join(fx.out, 'memory', 'query_one.md'), '../staging/graphify-out/memory/query_one.md'];
    const r = run(fx, { env: { GRAPH_STUB_EXTRA_SOURCES: JSON.stringify(extra) } });
    expect(r.status, r.stderr).toBe(0);
    const c = calls(fx)[0];
    expect(c.watch_path).toBe('.');
    expect(c.cwd).toBe(fx.root);
    const tracked = git(fx.root, 'ls-files').split('\n').sort();
    for (const s of sources(fx)) {
      if (s.startsWith('graphify-out/memory/')) { expect(s).toBe('graphify-out/memory/query_one.md'); continue; }
      expect(tracked, s).toContain(s);
    }
    for (const l of graph(fx).links) expect(l.source_file.startsWith('/') || l.source_file.includes(fx.store), l.source_file).toBe(false);
    expect(sources(fx)).toEqual(['a.py', 'graphify-out/memory/query_one.md', 'graphify-out/memory/query_one.md', 'lib/b.py']);
  });

  it('the rewrite touches EXACTLY the values under realpath(--memory): another absolute path is left as it is', () => {
    const fx = fixture();
    const other = mkTmp('graph-build-other-');
    mkdirSync(path.join(other, 'memory'));
    writeFileSync(path.join(other, 'memory', 'q.md'), '# q\n');
    const decoys = [path.join(other, 'memory', 'q.md'), 'graphify-out/memory/q.md', fx.memory];
    const r = run(fx, { env: { GRAPH_STUB_EXTRA_SOURCES: JSON.stringify(decoys) } });
    expect(r.status, r.stderr).toBe(0);
    expect(sources(fx)).toEqual([...decoys, 'a.py', 'lib/b.py'].sort());
  });

  it('a graph.json the rewrite cannot parse is a publish refusal, after the figures line', () => {
    const fx = fixture();
    // The stub writes nothing in this mode, so the planted text is what the rewrite reads.
    writeFileSync(path.join(fx.out, 'graph.json'), '{not json');
    const r = run(fx, { env: { GRAPH_STUB_MODE: 'untouched' } });
    refusedWith(r, 1, 'publish', /^saved results: cannot rewrite their source_file in .*graph\.json: /);
    expect(r.out[r.out.length - 1]).toMatch(LAST_STDOUT);
  });
});

describe('N7: GRAPHIFY_OUT is honoured only as the engine read it at import', () => {
  it('unset in the environment: exit 2, the engine not imported', () => {
    const fx = fixture();
    refusedWith(run(fx, { env: { GRAPHIFY_OUT: undefined } }), 2, 'setup', /^GRAPHIFY_OUT: unset in the environment before the engine is imported, not --out /);
    expect(imported(fx)).toBe(false);
  });

  it('another value: exit 2', () => {
    const fx = fixture();
    refusedWith(run(fx, { env: { GRAPHIFY_OUT: path.join(fx.store, 'graphify-out') } }), 2, 'setup', /^GRAPHIFY_OUT: '.*' in the environment/);
  });

  it('the engine read another value at import (as when it is set after import): exit 2, the engine not called', () => {
    const fx = fixture();
    refusedWith(run(fx, { env: { GRAPH_STUB_OUT_READ_EARLY: '1' } }), 2, 'setup', /^GRAPHIFY_OUT: the engine read 'graphify-out' at import, not --out /);
    expect(imported(fx)).toBe(true);
    expect(calls(fx)).toEqual([]);
    expect(started(fx)).toBe(false);
  });

  it('the engine wrote where --out says', () => {
    const fx = fixture();
    expect(run(fx).status).toBe(0);
    expect(calls(fx)[0].graphify_out).toBe(fx.out);
    expect(existsSync(path.join(fx.out, 'graph.json'))).toBe(true);
    expect(existsSync(path.join(fx.root, 'graphify-out'))).toBe(false);
  });
});

describe('N8: no silent queue', () => {
  it('a full build: acquire_lock=False, force=True, changed_paths None; no lock or queue file anywhere', () => {
    const fx = fixture();
    expect(run(fx).status).toBe(0);
    const c = calls(fx)[0];
    expect([c.acquire_lock, c.force, c.changed_paths, c.no_cluster, c.block_on_lock]).toEqual([false, true, null, false, false]);
    for (const d of [fx.out, fx.staging, fx.root])
      expect(readdirSync(d).filter((f) => f === '.pending_changes' || f === '.rebuild.lock'), d).toEqual([]);
  });

  it('an incremental build: the NUL-separated --changed list as absolute paths under --root; a deleted file is evicted, the rest kept', () => {
    const fx = fixture({ 'a.py': 'a = 1\n', 'lib/b.py': 'b = 1\n', 'c.py': 'c = 1\n' });
    expect(run(fx).status).toBe(0);
    writeFileSync(path.join(fx.root, 'a.py'), 'a = 2\n');
    git(fx.root, 'rm', '-q', 'c.py');
    git(fx.root, 'commit', '-qam', 'two');
    const changed = path.join(fx.staging, 'changed.z');
    writeFileSync(changed, 'a.py\0c.py\0');
    const r = run(fx, { args: { '--commit': git(fx.root, 'rev-parse', 'HEAD'), '--changed': changed } });
    expect(r.status, r.stderr).toBe(0);
    const c = calls(fx)[1];
    expect(c.changed_paths).toEqual([path.join(fx.root, 'a.py'), path.join(fx.root, 'c.py')]);
    expect(c.acquire_lock).toBe(false);
    expect(graph(fx).nodes.map((n) => [n.source_file, n.by])).toEqual([['a.py', 'incremental'], ['lib/b.py', 'full']]);
    for (const d of [fx.out, fx.staging])
      expect(readdirSync(d).filter((f) => f === '.pending_changes' || f === '.rebuild.lock'), d).toEqual([]);
  });

  it('calibration: the stub does queue and lock when asked to (so the rows above can see a wrapper that asks)', () => {
    const fx = fixture();
    const env: NodeJS.ProcessEnv = { ...process.env, GRAPHIFY_OUT: fx.out, PYTHONPATH: STUB, PYTHONDONTWRITEBYTECODE: '1' };
    execFileSync('python3', ['-s', '-P', '-c', 'from pathlib import Path; from graphify.watch import _rebuild_code; _rebuild_code(Path("."), changed_paths=[Path("a.py")])'],
      { cwd: fx.root, env });
    expect(existsSync(path.join(fx.out, '.pending_changes'))).toBe(true);
    expect(existsSync(path.join(fx.out, '.rebuild.lock'))).toBe(true);
  });
});

describe('N24: the output directory is named graphify-out', () => {
  it('an --out with another basename exits 2', () => {
    const fx = fixture();
    const other = path.join(fx.staging, 'staging');
    mkdirSync(other);
    refusedWith(run(fx, { args: { '--out': other }, env: { GRAPHIFY_OUT: other } }), 2, 'setup', /^out-name: --out is named staging, not graphify-out/);
    expect(calls(fx)).toEqual([]);
  });

  it('a repository tracking staging/ keeps those files in the graph', () => {
    const fx = fixture({ 'a.py': 'a = 1\n', 'staging/keep.py': 'k = 1\n', 'staging/deep/more.py': 'm = 1\n' });
    expect(run(fx).status).toBe(0);
    expect(sources(fx)).toEqual(['a.py', 'staging/deep/more.py', 'staging/keep.py']);
  });

  it('calibration: the stub drops a directory named like the output, as the pinned engine does', () => {
    const fx = fixture({ 'a.py': 'a = 1\n', 'staging/keep.py': 'k = 1\n' });
    const other = path.join(fx.store, 'staging');
    const env: NodeJS.ProcessEnv = { ...process.env, GRAPHIFY_OUT: other, PYTHONPATH: STUB, PYTHONDONTWRITEBYTECODE: '1' };
    execFileSync('python3', ['-s', '-P', '-c', 'from pathlib import Path; from graphify.watch import _rebuild_code; _rebuild_code(Path("."), acquire_lock=False)'],
      { cwd: fx.root, env });
    const g = JSON.parse(readFileSync(path.join(other, 'graph.json'), 'utf8')) as Graph;
    expect(g.nodes.map((n) => n.source_file)).toEqual(['a.py']);
  });
});

describe('N26: the build is the OOM victim', () => {
  it.runIf(LINUX)('Linux: the wrapper (already at the engine\'s import) and the engine\'s forked worker run with oom_score_adj 1000', () => {
    const fx = fixture();
    expect(run(fx).status).toBe(0);
    expect(records(fx).find((r) => r.event === 'import')?.oom_score_adj, 'raised before the engine was imported').toBe(1000);
    const c = calls(fx)[0];
    const w = records(fx).find((r) => r.event === 'worker');
    expect(c.oom_score_adj).toBe(1000);
    expect(w?.oom_score_adj).toBe(1000);
    expect(w?.pid).toBe(c.worker_pid);
  });

  it.runIf(!LINUX)('no /proc (macOS): oom_score_adj is skipped, the build runs, both processes read none', () => {
    const fx = fixture();
    expect(existsSync('/proc/self/oom_score_adj')).toBe(false);
    expect(run(fx).status).toBe(0);
    expect(calls(fx)[0].oom_score_adj).toBe(null);
    expect(records(fx).find((r) => r.event === 'worker')?.oom_score_adj).toBe(null);
  });

  // A memcg at its cap holding a build and a test process: the kernel kills the build's worker. Needs a delegated
  // cgroup v2 subtree this user can create a child with the memory controller in and move processes into.
  const delegated = ((): string | null => {
    if (!LINUX) return null;
    try {
      const rel = /^0::(.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))?.[1];
      if (!rel) return null;
      // A sibling of this process's cgroup (a cgroup holding processes cannot also hold controller-enabled
      // children), or a child of the root, which is exempt from that rule.
      const parent = rel === '/' ? '/sys/fs/cgroup' : path.join('/sys/fs/cgroup', rel, '..');
      const probe = path.join(parent, `graph-build-probe-${process.pid}`);
      mkdirSync(probe);
      const ok = existsSync(path.join(probe, 'memory.max'));
      execFileSync('rmdir', [probe]);
      return ok ? parent : null;
    } catch { return null; }
  })();
  if (!delegated) console.log('graph-build.test: the memcg-at-cap row is skipped: no writable delegated cgroup v2 subtree with the memory controller');
  it.skipIf(!delegated)('in a memcg at its cap holding the build and a test process, the build is the one killed', () => {
    const fx = fixture();
    const cg = path.join(delegated!, `graph-build-cap-${process.pid}`);
    mkdirSync(cg);
    try {
      writeFileSync(path.join(cg, 'memory.max'), String(256 * 1024 * 1024));
      writeFileSync(path.join(cg, 'memory.swap.max'), '0');
      // The test process: holds 64 MiB, at the default oom_score_adj, then waits.
      const holder = path.join(fx.store, 'holder.py');
      writeFileSync(holder, 'import sys, time\nb = bytearray(64 * 1024 * 1024)\nfor i in range(0, len(b), 4096):\n    b[i] = 1\nopen(sys.argv[1], "w").write("ready")\ntime.sleep(60)\n');
      const driver = path.join(fx.store, 'in-cgroup.sh');
      writeFileSync(driver, '#!/bin/sh\necho $$ > "$1/cgroup.procs"\nshift\nexec "$@"\n', { mode: 0o755 });
      const ready = path.join(fx.store, 'ready');
      const test = spawnSync('sh', ['-c', '"$0" "$1" python3 "$2" "$3" </dev/null >/dev/null 2>&1 & echo $!', driver, cg, holder, ready], { encoding: 'utf8' });
      const testPid = Number(test.stdout.trim());
      for (let i = 0; i < 100 && !existsSync(ready); i++) execFileSync('sleep', ['0.1']);
      const env: NodeJS.ProcessEnv = { ...process.env, GRAPHIFY_OUT: fx.out, PYTHONPATH: STUB, PYTHONDONTWRITEBYTECODE: '1', GRAPH_STUB_RECORD: fx.record, GRAPH_STUB_ALLOC_MB: '512' };
      const build = spawnSync(driver, [cg, 'python3', '-s', '-P', BUILD, '--root', fx.root, '--out', fx.out, '--commit', fx.commit, '--pin', '0.9.9',
        '--memory', fx.memory, '--launched', String(Math.floor(Date.now() / 1000)), '--slot-wait', '600'], { cwd: fx.root, env, encoding: 'utf8', timeout: 60000 });
      expect(existsSync(`/proc/${testPid}`), 'the test process survived').toBe(true);
      expect(records(fx).find((r) => r.event === 'worker')?.oom_score_adj, 'the killed worker ran as the victim').toBe(1000);
      expect(build.status, build.stderr).not.toBe(0);
      expect(readFileSync(path.join(cg, 'memory.events'), 'utf8')).toMatch(/^oom_kill [1-9]/m);
      process.kill(testPid, 'SIGKILL');
    } finally {
      for (let i = 0; i < 50; i++) { try { execFileSync('rmdir', [cg]); break; } catch { execFileSync('sleep', ['0.1']); } }
    }
  });
});

describe('N29: peak memory and CPU from the wrapper\'s own cgroup (D-7357)', () => {
  /** A fixture cgroup tree under CCRC_CGROUP_ROOT at the path /proc/self/cgroup names for this process (and so for
   *  the wrapper it spawns, which stays in it). */
  function cgroupRoot(peakBytes: string | null, cpuStat: string | null): string {
    const root = mkTmp('graph-build-cgroup-');
    const rel = LINUX ? (/^0::(.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))?.[1] ?? '/') : '/fixture.scope';
    const dir = path.join(root, rel);
    mkdirSync(dir, { recursive: true });
    if (peakBytes !== null) writeFileSync(path.join(dir, 'memory.peak'), peakBytes);
    if (cpuStat !== null) writeFileSync(path.join(dir, 'cpu.stat'), cpuStat);
    return root;
  }
  // 64 GiB: far above the wrapper's own ru_maxrss, so a figure from anything but the file would differ.
  const PEAK = String(64 * 1024 * 1024 * 1024);
  const CPU = 'usage_usec 123456789\nuser_usec 100000000\nsystem_usec 23456789\n';

  it.runIf(LINUX)('Linux: the fixture\'s memory.peak (KiB) and cpu.stat usage_usec (ms) are the last stdout line', () => {
    const fx = fixture();
    const r = run(fx, { env: { CCRC_CGROUP_ROOT: cgroupRoot(PEAK + '\n', CPU) } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out[r.out.length - 1]).toBe(`graph-build: peak_kb=${64 * 1024 * 1024} cpu_ms=123456`);
  });

  it.runIf(LINUX)('Linux: unreadable files print null, each on its own', () => {
    const fx = fixture();
    expect(run(fx, { env: { CCRC_CGROUP_ROOT: cgroupRoot(null, null) } }).out.at(-1)).toBe('graph-build: peak_kb=null cpu_ms=null');
    expect(run(fx, { env: { CCRC_CGROUP_ROOT: cgroupRoot(PEAK, null) } }).out.at(-1)).toBe(`graph-build: peak_kb=${64 * 1024 * 1024} cpu_ms=null`);
    expect(run(fx, { env: { CCRC_CGROUP_ROOT: cgroupRoot('max\n', CPU) } }).out.at(-1)).toBe('graph-build: peak_kb=null cpu_ms=123456');
  });

  it.runIf(!LINUX)('no /proc (macOS): the peak and the CPU are null even with a fixture tree', () => {
    const fx = fixture();
    const r = run(fx, { env: { CCRC_CGROUP_ROOT: cgroupRoot(PEAK, CPU) } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out[r.out.length - 1]).toBe('graph-build: peak_kb=null cpu_ms=null');
  });
});

describe('counted exit: who imports the engine under ccd/', () => {
  // Measured on the base: one file imported graphify, the sweep's corpus guard (its python heredoc imports
  // graphify.detect to list the corpus; it never builds). This task adds the wrapper, the only importer of the
  // engine's build module: graphify importers 1 -> 2, graphify.watch importers 0 -> 1.
  const importers = (re: RegExp): string[] =>
    execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'ccd'], { cwd: REPO, encoding: 'utf8' })
      .split('\0').filter((f) => f !== '' && existsSync(path.join(REPO, f)))
      .filter((f) => re.test(readFileSync(path.join(REPO, f), 'utf8'))).sort();
  it('ccd/graph-build is the only file importing graphify.watch (the build API); the sweep\'s guard imports detect only', () => {
    expect(importers(/^\s*(import graphify\b|from graphify\b)/m)).toEqual(['ccd/ccd-graph-sweep', 'ccd/graph-build']);
    expect(importers(/^\s*(import graphify\.watch\b|from graphify\.watch\b|from graphify import watch\b)/m)).toEqual(['ccd/graph-build']);
  });
});
