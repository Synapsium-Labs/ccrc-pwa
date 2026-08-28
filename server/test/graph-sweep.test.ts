import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const SWEEP = path.resolve(__dirname, '../../ccd/ccd-graph-sweep');
let home: string;
const j = (...p: string[]) => path.join(home, ...p);

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
           GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
}
function makeRepo(name: string): string {
  const d = j('projects', name);
  fs.mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', d]);
  fs.writeFileSync(path.join(d, 'a.py'), 'x = 1\n');
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'init');
  // the exclude precondition, as D' leaves it:
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), 'graphify-out/\n.graphifyignore\n');
  return d;
}
function plantEngine(behavior = ''): void {
  const bin = j('.ccrc', 'graphify-venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'graphify'), `#!/bin/bash
echo "cwd=$PWD argv=$* NO_BACKUP=\${GRAPHIFY_NO_BACKUP:-} SEED=\${PYTHONHASHSEED:-} WORKERS=\${GRAPHIFY_MAX_WORKERS:-}" >> "$HOME/engine-calls"
${behavior}
mkdir -p graphify-out
printf '{"nodes":[],"links":[],"built_at_commit":"%s"}' "$(git rev-parse HEAD)" > graphify-out/graph.json
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.9\n');
  // Task 8: a real venv always ships bin/python beside bin/graphify, and the
  // pre-build corpus guard now requires it on every tree. Task 6/7 tests plant
  // only the engine and don't care about the guard, so give them a vacuously-
  // passing default (empty corpus never breaches) — but only if a test hasn't
  // already planted its own via plantGuardPython(), in EITHER call order (the
  // 11a+11b test calls plantGuardPython() first, plantEngine() second).
  const py = path.join(bin, 'python');
  if (!fs.existsSync(py)) fs.writeFileSync(py, '#!/bin/bash\ntrue\n', { mode: 0o755 });
}
function plantGuardPython(): void {
  // the fake venv python implements the guard protocol: it prints the corpus,
  // one path per line, reading fixture file corpus-paths if present.
  const bin = j('.ccrc', 'graphify-venv', 'bin');
  // NB (gap in the brief's snippet, mirrors Task 7's plantEngine finding): the
  // 11a+11b test calls this BEFORE plantEngine(), so `bin` does not exist yet
  // — mkdirSync it here rather than relying on call order.
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'python'), `#!/bin/bash
# fake detect(): echo the fixture corpus (paths relative to cwd)
cat "$HOME/fixture-corpus" 2>/dev/null || true
`, { mode: 0o755 });
}
function runSweep(env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [SWEEP], { encoding: 'utf8',
    env: { ...process.env, HOME: home, CCRC_GRAPH_BUILD_TIMEOUT: '5', ...env } });
}
const census = () => JSON.parse(fs.readFileSync(j('.ccrc', 'graph-sweep.json'), 'utf8'));
const lastPass = () => census().passes.at(-1);
const outcomeOf = (tree: string) =>
  lastPass().trees.find((t: { path: string }) => t.path === tree)?.outcome;

beforeEach(() => { home = mkTmp('ccrc-gfxsweep-'); fs.mkdirSync(j('.ccrc'), { recursive: true }); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('graph-sweep: probe + census (Task 6)', () => {
  it('cold-builds a never-built tree, stamps the engine, and a second pass is fresh', () => {
    const repo = makeRepo('alpha'); plantEngine();
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('never-built');
    expect(fs.readFileSync(path.join(repo, 'graphify-out', '.graphify_engine'), 'utf8')).toBe('0.9.9\n');
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('fresh');
  });
  it('row 13 — a pin bump alone re-marks a fresh tree stale (engine dimension)', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep(); runSweep();
    expect(outcomeOf(repo)).toBe('fresh');
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.50\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('stale-rebuilt');
  });
  it('row 1 — a tree without the exclude line is refused, not built', () => {
    const repo = makeRepo('alpha');
    fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '');   // strip D'
    plantEngine();
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-no-exclude');
    expect(fs.existsSync(path.join(repo, 'graphify-out'))).toBe(false);
  });
  it('row 8 — zero trees probed on a box that HAS tree roots is an error', () => {
    fs.mkdirSync(j('projects'), { recursive: true });   // root exists, no git tree in it
    plantEngine();
    const r = runSweep();
    expect(r.status).not.toBe(0);
    expect(lastPass().status).toBe('probed-zero');
  });
  it('no tree roots at all is a distinct, non-error status', () => {
    plantEngine();
    const r = runSweep();
    expect(r.status).toBe(0);
    expect(lastPass().status).toBe('no-trees-configured');
  });
  it('row 6 — a second entrant exits pass-locked while a pass holds the flock', async () => {
    makeRepo('alpha'); plantEngine();
    const lock = j('.ccrc', 'graph-sweep.lock');
    fs.writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '30']);
    await new Promise((r) => setTimeout(r, 300));          // let flock take it
    try {
      expect(runSweep().status).toBe(0);
      expect(lastPass().status).toBe('pass-locked');
      expect(fs.existsSync(j('engine-calls'))).toBe(false);
    } finally { holder.kill(); }
  });
  it('O4 — the pause file short-circuits the pass', () => {
    makeRepo('alpha'); plantEngine();
    fs.writeFileSync(j('.ccrc', 'graph-sweep-paused'), '');
    expect(runSweep().status).toBe(0);
    expect(lastPass().status).toBe('paused');
    expect(fs.existsSync(j('engine-calls'))).toBe(false);
  });
});

describe('graph-sweep: build discriminators (Task 7)', () => {
  it('row 7 — a wedged engine is timed-out by the knob, not a hung pass', () => {
    const repo = makeRepo('alpha');
    plantEngine('sleep 60');                                   // wedges past the 5s test knob
    const t0 = Date.now();
    runSweep({ CCRC_GRAPH_BUILD_TIMEOUT: '2' });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(outcomeOf(repo)).toBe('timed-out');
  });
  it('row 17 — a shrink refusal is refused-shrink, never failed', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                // seed a graph + stamp
    git(repo, 'commit', '-qm', 'move', '--allow-empty');       // make it stale again
    plantEngine('echo "refusing to write: node count shrank" >&2; exit 1\n# no graph write:');
    // the fake above must NOT rewrite graph.json — remove the trailing writer lines for this plant:
    const enginePath = j('.ccrc', 'graphify-venv', 'bin', 'graphify');
    // Leading warning line before the refusal — a real `graphify update` can
    // print a conditional warning (build.py:384, watch.py:510) ahead of the
    // shrink refusal on the same invocation; the discriminator must grep the
    // FULL stderr, not just its first line, or this collapses to `failed`.
    fs.writeFileSync(enginePath, `#!/bin/bash
echo "[graphify] Extraction warning (2 issues): demo" >&2
echo "[graphify] WARNING: new graph has 1 nodes but existing graph.json has 4. Refusing to overwrite — you may be missing chunk files from a previous session. Pass --force to override." >&2
exit 1
`, { mode: 0o755 });
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-shrink');
  });
  it('other exit-1 conditions collapse to failed, carrying the first stderr line', () => {
    const repo = makeRepo('alpha');
    fs.mkdirSync(j('.ccrc', 'graphify-venv', 'bin'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'graphify'), `#!/bin/bash
echo "extractor exploded: boom" >&2
exit 1
`, { mode: 0o755 });
    // this test doesn't call plantEngine(), so plant the guard's vacuously-
    // passing default python by hand (Task 8: the guard now runs on every tree).
    fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'python'), '#!/bin/bash\ntrue\n', { mode: 0o755 });
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.9\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('failed');
    expect(lastPass().trees.find((t: {path:string}) => t.path === repo).reason)
      .toContain('extractor exploded');
  });
  it('rows 4+18+5a — the build runs IN the tree with the pinned env (argv pin)', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();
    const call = fs.readFileSync(j('engine-calls'), 'utf8');
    expect(call).toContain(`cwd=${fs.realpathSync(repo)}`);    // row 4: chdir (export.py:475 has no cwd=)
    expect(call).toContain('NO_BACKUP=1');                     // row 5a
    expect(call).toContain('SEED=0');                          // PYTHONHASHSEED
    expect(call).toContain('WORKERS=');                        // row 18: cap present
  });
  it('skipped-locked — a held .rebuild.lock defers the tree without waiting', async () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                            // seed + stamp
    git(repo, 'commit', '-qm', 'move', '--allow-empty');   // stale again
    const lock = path.join(repo, 'graphify-out', '.rebuild.lock');
    fs.writeFileSync(lock, '');
    const holder = spawn('flock', [lock, 'sleep', '30']);
    await new Promise((r) => setTimeout(r, 300));
    try {
      const t0 = Date.now();
      runSweep();
      expect(Date.now() - t0).toBeLessThan(10_000);        // deferred, never waited
      expect(outcomeOf(repo)).toBe('skipped-locked');
    } finally { holder.kill(); }
  });
});

describe('graph-sweep: corpus guard (Task 8)', () => {
  it('row 2 — an untracked corpus path refuses the BUILD (previous graph untouched)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    runSweep();                                                     // seed a good graph
    const seeded = fs.statSync(path.join(repo, 'graphify-out', 'graph.json')).mtimeMs;
    git(repo, 'commit', '-qm', 'move', '--allow-empty');
    fs.writeFileSync(path.join(repo, 'poison.py'), 'x');            // untracked, would enter corpus
    fs.writeFileSync(j('fixture-corpus'), 'a.py\npoison.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    expect(fs.statSync(path.join(repo, 'graphify-out', 'graph.json')).mtimeMs).toBe(seeded);
  });
  it('row 19 — graphify-out/memory/ is exempt (a tree that answered queries still builds)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.mkdirSync(path.join(repo, 'graphify-out', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'graphify-out', 'memory', 'q1.md'), 'q');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\ngraphify-out/memory/q1.md\n');
    runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
  });
  it('row 3 — a "!" line in the noise list refuses the build', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n!secrets.md\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    expect(lastPass().trees.find((t: {path:string}) => t.path === repo).reason).toContain('!');
  });
  it('rows 11a+11b — .graphifyignore is written for the build, removed after, and harmless if orphaned', () => {
    const repo = makeRepo('alpha'); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    // the engine snapshots the file's presence mid-build:
    plantEngine('cp .graphifyignore "$HOME/gfxignore-during" 2>/dev/null || true');
    runSweep();
    expect(fs.readFileSync(j('gfxignore-during'), 'utf8')).toContain('fixtures/');
    expect(fs.existsSync(path.join(repo, '.graphifyignore'))).toBe(false);   // removed after
    // 11b: an orphan does not dirty the tree (excluded by D')
    fs.writeFileSync(path.join(repo, '.graphifyignore'), 'stray');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // and the next pass sweeps the stray even when the tree is fresh:
    runSweep();
    expect(fs.existsSync(path.join(repo, '.graphifyignore'))).toBe(false);
  });
  it('a worktree of alpha also resolves graph-noise/alpha.list (repo-basename shared across worktrees)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    const wtDir = j('worktrees', 'alpha', 'wt1');
    fs.mkdirSync(path.dirname(wtDir), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'wt1-branch', wtDir);
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    // same repo-basename ('alpha') noise list, written once, must gate BOTH
    // the main checkout and its worktree — the whole point of keying the
    // noise list off the common-dir basename rather than the tree path.
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n!secrets.md\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(wtDir)).toBe('refused-by-guard');
    expect(lastPass().trees.find((t: {path:string}) => t.path === wtDir).reason).toContain('!');
  });
});
