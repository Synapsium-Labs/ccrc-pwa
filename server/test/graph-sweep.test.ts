import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';

// The sweep is linux-only by product shape (its systemd timer never installs
// on the Darwin arm) and by userland (GNU stat/date, flock(1)) — the same
// carve-out `ccd-cap-scopes` has. On macOS this whole file skips; measured on
// the macos CI leg: BSD userland aborts every pass and all outcomes read
// undefined.
beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

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
// D-1368 — A FIXTURE THAT WANTS A TREE TO READ STALE HAS TO CHANGE THE TREE.
// `--allow-empty` moves HEAD and leaves `HEAD^{tree}` byte-identical to the
// built commit's, which is now the definition of FRESH — so every "make it
// stale again" step below commits real content. The counter keeps the names
// unique across a file that reuses one repo name in most of its cases.
let bumps = 0;
function bump(repo: string, msg = 'move'): void {
  bumps += 1;
  fs.writeFileSync(path.join(repo, `bump${bumps}.py`), `z${bumps} = ${bumps}\n`);
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg);
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
// D-1161: plants the ACTUAL shipped list, not a hand-written copy of it —
// `_inst_graph_noise` converges this exact file, so a fixture that paraphrased
// it could go green against contents no box has.
function plantDefaultNoise(): void {
  fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '../../ccd/graph-noise.default.list'),
                  j('.ccrc', 'graph-noise', '_default.list'));
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
# fake detect(): the fixture corpus (paths relative to cwd) — filtered through
# the generated .graphifyignore the way the real detect() applies THESE entries
# (D-1451). A leading '/' anchors at the directory holding the file, which is
# the tree root (detect.py:883-895, \`anchored = raw.startswith("/")\`); a
# trailing '/' is a directory, excluded with everything under it by the
# ancestor walk (detect.py:924-931), i.e. by prefix; anything else names one
# file. graphify-out/memory/ bypasses the filter entirely, exactly as
# detect.py:1160-1166 does — query results are re-added whatever the ignore
# rules say, which is why the guard exempts them from the breach test.
# A stub that ignored .graphifyignore could not tell a filter that works from
# one that does nothing.
#
# D-1453: a file entry is matched by an UNQUOTED \`case\` pattern, not by
# equality. Equality was the one place this stub could not mirror the engine —
# and it is exactly the place where the mirror is load-bearing, because bash's
# \`case\` lets \`*\` cross a \`/\` just as \`fnmatch.fnmatch\` does (and just as
# \`git ls-files -X\`'s wildmatch does NOT). With equality, an entry that eats a
# TRACKED file out of the corpus is invisible to the suite. The corpus is also
# teed to \$HOME/seen-corpus so a row can assert what SURVIVED, not only what
# the filter carries — a shrunk corpus is otherwise silent (no withheld line,
# no breach, exit 0).
#
# D-1458: every invocation appends one line to $HOME/detect-calls, so a row can
# assert HOW MANY TIMES detect() ran. The guard now runs it twice — but only on
# a tree where the first run caught a breach git ignores; the whole point of the
# narrowing is that a tree with nothing to derive pays for exactly one run.
echo call >> "$HOME/detect-calls"
# and the filter as detect saw it on THIS call — the engine's own capture is
# unreachable on a tree the guard refuses, and a withheld entry now always
# refuses (it is in the corpus; that is why it was derived).
rm -f "$HOME/detect-ignore"; cp .graphifyignore "$HOME/detect-ignore" 2>/dev/null || true
[ -f "$HOME/fixture-corpus" ] || exit 0
pats=()
if [ -f .graphifyignore ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    pats+=("\${line#/}")
  done < .graphifyignore
fi
{ while IFS= read -r p || [ -n "$p" ]; do
  [ -n "$p" ] || continue
  case "$p" in graphify-out/memory/*) printf '%s\\n' "$p"; continue ;; esac
  keep=1
  for pat in \${pats[@]+"\${pats[@]}"}; do
    case "$pat" in
      */) case "$p" in \${pat%/}/*) keep=0 ;; esac ;;
      *)  case "$p" in $pat) keep=0 ;; esac ;;
    esac
  done
  [ "$keep" = 1 ] && printf '%s\\n' "$p"
done < "$HOME/fixture-corpus"; } | tee "$HOME/seen-corpus"
exit 0
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
  it('finding 3a — CCRC_GRAPH_BUDGET caps rebuilds per pass; the rest are skipped-budget', () => {
    const repoA = makeRepo('alpha'); const repoB = makeRepo('beta'); plantEngine();
    runSweep({ CCRC_GRAPH_BUDGET: '1' });
    const outcomes = [outcomeOf(repoA), outcomeOf(repoB)];
    // both trees are stale (never-built) going in; with a budget of 1 exactly
    // one of the two is actually built this pass and the other is deferred —
    // deleting the "$BUILT" -ge "$CCRC_GRAPH_BUDGET" guard stays green on
    // every OTHER test in this file (nothing else pins it), but goes red
    // here: both would come back 'never-built' instead.
    expect(outcomes.filter((o) => o === 'never-built' || o === 'stale-rebuilt')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'skipped-budget')).toHaveLength(1);
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

describe('graph-sweep: a tree is a TOPLEVEL, never a subdirectory of one (D-1367)', () => {
  /** A git tree at `~/worktrees/<name>` — the DEPTH-1 shape, where the
   *  workspace directly under the worktrees root is itself the toplevel. The
   *  old glob pair (one level under `projects`, two under `worktrees`) never
   *  named it, while `--is-inside-work-tree` said yes to every one of its
   *  subdirectories, so the
   *  sweep built a graph into each of them instead. Measured on the live fleet
   *  2026-09-03 — 8 stray `graphify-out/` directories under one worktree,
   *  including `node_modules/graphify-out` and `graphify-out/graphify-out`. */
  function makeWorktreeRoot(name: string): string {
    const d = j('worktrees', name);
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q', d]);
    fs.writeFileSync(path.join(d, 'a.py'), 'x = 1\n');
    fs.writeFileSync(path.join(d, 'src', 'b.py'), 'y = 2\n');
    git(d, 'add', '.'); git(d, 'commit', '-qm', 'init');
    fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), 'graphify-out/\n.graphifyignore\n');
    return d;
  }
  const paths = (): string[] => lastPass().trees.map((t: { path: string }) => t.path);

  it('discovers a depth-1 worktree ITSELF, and none of its subdirectories', () => {
    const solo = makeWorktreeRoot('solo'); plantEngine();
    expect(runSweep().status).toBe(0);
    expect(paths(), 'a depth-1 worktree is never discovered at all').toContain(solo);
    expect(paths().filter((p) => p.startsWith(solo + '/')),
      'a subdirectory of a work tree was censused as a tree of its own').toEqual([]);
    // The effect, not merely the census row: the stray graphs the live fleet
    // grew are graphs the sweep BUILT into those subdirectories.
    expect(fs.existsSync(path.join(solo, 'src', 'graphify-out')),
      'the sweep built a graph into a plain subdirectory').toBe(false);
    expect(fs.existsSync(path.join(solo, '.git', 'graphify-out')),
      'the sweep built a graph inside .git').toBe(false);
    expect(outcomeOf(solo)).toBe('never-built');
  });

  it('still discovers a depth-2 worktree, and never its container directory', () => {
    const repo = makeRepo('alpha'); plantEngine();
    const wtDir = j('worktrees', 'alpha', 'wt1');
    fs.mkdirSync(path.dirname(wtDir), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'wt1-branch', wtDir);
    expect(runSweep().status).toBe(0);
    expect(paths()).toContain(wtDir);
    expect(paths()).toContain(repo);
    expect(paths(), 'the plain directory that merely HOLDS worktrees was censused as a tree')
      .not.toContain(j('worktrees', 'alpha'));
  });

  it('skips a candidate whose canonical path is UNMEASURABLE — never "two empties are equal"', () => {
    // Both spellings of the shim answer nothing. The predicate is an EQUALITY,
    // so an unmeasurable answer that is spent rather than skipped makes every
    // candidate compare equal to every other and the whole
    // subdirectory-of-a-worktree class walks straight back in.
    const solo = makeWorktreeRoot('solo'); plantEngine();
    const stub = j('pathstub'); fs.mkdirSync(stub, { recursive: true });
    for (const name of ['realpath', 'readlink']) {
      fs.writeFileSync(path.join(stub, name), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    }
    runSweep({ PATH: `${stub}:${process.env.PATH}` });
    expect(paths().filter((p) => p === solo || p.startsWith(solo + '/')),
      'an unmeasurable canonical path was spent as if it were a measurement').toEqual([]);
    expect(lastPass().status).toBe('probed-zero');
  });

  it('censuses one row per tree when two names reach the same one (dedupe by realpath)', () => {
    const repo = makeRepo('beta'); plantEngine();
    fs.symlinkSync(repo, j('projects', 'beta-link'));
    expect(runSweep().status).toBe(0);
    const real = fs.realpathSync(repo);
    const hits = paths().filter((p) => fs.realpathSync(p) === real);
    expect(hits, `one tree, censused ${hits.length} times: ${hits.join(', ')}`).toHaveLength(1);
  });

  // D-1370 — WHICH of the two names survives the dedupe, not merely how many.
  // The case above symlinks WITHIN `projects/`, where both names are equally
  // arbitrary and only the count is a claim. Across the two roots the names
  // are NOT equal: one is the tree's real path, the one a session's
  // `$REG/<id>.workdir` and the card's `cwd` actually carry, and the census
  // row is compared against those VERBATIM by both readers. Glob order alone
  // handed the row to `$PROJECTS_ROOT` — the alias — measured: the pass
  // carried one row and it was `…/projects/foo`, with the real workspace path
  // absent from the pass entirely.
  it('keeps the REAL path, not the alias, when the two names live under different roots', () => {
    const realTree = makeWorktreeRoot('foo'); plantEngine();
    fs.mkdirSync(j('projects'), { recursive: true });         // no makeRepo() here to make it
    fs.symlinkSync(realTree, j('projects', 'foo'));          // an alias, globbed FIRST
    expect(runSweep().status).toBe(0);
    const canonical = fs.realpathSync(realTree);
    const hits = paths().filter((p) => fs.realpathSync(p) === canonical);
    expect(hits, `one tree, censused ${hits.length} times: ${hits.join(', ')}`).toHaveLength(1);
    expect(hits[0], 'the census carries the ALIAS — every reader that matches the row by string ' +
      '(the idle gate, the card) is unmatched for a session recorded under the real path')
      .toBe(realTree);
  });

  // The EFFECT the row's spelling decides, not just the spelling. `_gs_busy`
  // matches a session by raw string compare of `$REG/<id>.workdir` against the
  // as-globbed path, so an alias row means the idle gate never fires and the
  // sweep builds under a working session — the one thing that gate exists to
  // prevent.
  it('an alias row would unmatch the idle gate — a session on the real path still defers it', () => {
    seedAccountsSh(home);
    const realTree = makeWorktreeRoot('foo'); plantEngine();
    fs.mkdirSync(j('projects'), { recursive: true });
    fs.symlinkSync(realTree, j('projects', 'foo'));
    const reg = j('.cc-sessions'); fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, 'foo-ws1.workdir'), realTree + '\n');   // the REAL name
    fs.writeFileSync(path.join(reg, 'foo-ws1.wrapper'), 'claude\n');
    fs.writeFileSync(path.join(reg, 'foo-ws1.hookstate.json'),
      JSON.stringify({ pid: 4242, state: { state: 'working' } }));
    const cfg = j('.claude'); fs.mkdirSync(path.join(cfg, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'sessions', '4242.json'), JSON.stringify({ state: 'working' }));
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(realTree), 'the sweep built a graph under a WORKING session because its ' +
      'census row named the alias and the idle gate matches by string').toBe('skipped-busy');
    expect(fs.existsSync(j('engine-calls')),
      'the engine ran on a tree the idle gate should have deferred').toBe(false);
  });

  // D-1371 — THE SHAPE THE FLEET ACTUALLY HAS, not the one /tmp has. Both
  // cases above build their roots as REAL directories, which is the only shape
  // where "is this candidate spelled as its own realpath" is ever true — so
  // D-1370's guard measured green there while being INERT on the live box,
  // where `$HOME/projects` is ITSELF a symlink (`~/projects -> /data/projects`,
  // `/data -> /mnt/…`). Under a symlinked root no candidate can equal its own
  // realpath, nothing is preferred, the survivor falls back to glob order and
  // the ALIAS wins: exactly the failure D-1370 was written to stop. MEASURED
  // on this fixture against the D-1370 spelling — the pass carried one row and
  // it was `…/projects/alpha`, the real name absent from the pass entirely.
  it('prefers the real name when the ROOT ITSELF is a symlink (the live fleet shape)', () => {
    const realRoot = j('real-projects');
    fs.mkdirSync(realRoot, { recursive: true });
    fs.symlinkSync(realRoot, j('projects'));            // the root, reached through a link
    const zeta = makeRepo('zeta');                      // the real tree, under that root
    fs.symlinkSync('zeta', j('projects', 'alpha'));     // the alias, globbed FIRST
    plantEngine();
    expect(runSweep().status).toBe(0);
    const canonical = fs.realpathSync(zeta);
    const hits = paths().filter((p) => fs.realpathSync(p) === canonical);
    expect(hits, `one tree, censused ${hits.length} times: ${hits.join(', ')}`).toHaveLength(1);
    expect(hits[0], 'the census carries the ALIAS under a symlinked root — the survivor rule asks ' +
      'about ANCESTRY when the only thing that distinguishes the two names is the last component')
      .toBe(j('projects', 'zeta'));
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
    bump(repo);                                                // make it stale again
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
    bump(repo);                                            // stale again
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
    bump(repo);
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
  it('F1 (review fix) — a "!" line with LEADING WHITESPACE also refuses (grep was column-0-anchored; graphify lstrips before checking startswith("!"))', () => {
    const repoSpace = makeRepo('ws-space');
    const repoTab = makeRepo('ws-tab');
    plantEngine(); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'ws-space.list'), 'fixtures/\n !secrets.md\n');   // leading space
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'ws-tab.list'), 'fixtures/\n\t!secrets.md\n');    // leading tab
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(repoSpace)).toBe('refused-by-guard');
    expect(lastPass().trees.find((t: {path:string}) => t.path === repoSpace).reason).toContain('!');
    expect(outcomeOf(repoTab)).toBe('refused-by-guard');
    expect(lastPass().trees.find((t: {path:string}) => t.path === repoTab).reason).toContain('!');
  });
  it('F2 (review fix) — repo-basename derivation is space-safe (a project dir whose name contains a space)', () => {
    const repo = makeRepo('al pha'); plantEngine(); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'al pha.list'), 'fixtures/\n!secrets.md\n');
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
    // 11b: an orphan does not dirty the tree (excluded by D'). A real orphan
    // from a crashed pass always carries the marker line _gs_guard itself
    // writes (finding 1: ownership is marker-detected, not "any stray file"
    // — see the describe block below for the foreign-file counterpart).
    fs.writeFileSync(path.join(repo, '.graphifyignore'),
      '# generated by ccd-graph-sweep for one build — never committed, never edited\nstray\n');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // and the next pass sweeps the stray even when the tree is fresh:
    runSweep();
    expect(fs.existsSync(path.join(repo, '.graphifyignore'))).toBe(false);
  });
  it('D-1160 — the DEFAULT noise list applies with no per-repo list at all', () => {
    // The whole point: ccrc's own footprint (`.remember/`, `.superpowers/`,
    // `.claude/`, `CLAUDE.local.md`) leaves every repo, without an operator
    // writing a file per repo. Before this, those four names were held against
    // a repo by the corpus guard and refused its build for ever — 5 of the
    // reference fleet's 14 refused trees were blocked by nothing else.
    const repo = makeRepo('alpha'); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', '_default.list'), '.remember/\n.superpowers/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    plantEngine('cp .graphifyignore "$HOME/gfxignore-during" 2>/dev/null || true');
    runSweep();
    const written = fs.readFileSync(j('gfxignore-during'), 'utf8');
    expect(written).toContain('.remember/');
    expect(written).toContain('.superpowers/');
  });

  it('D-1160 — default and per-repo lists are UNIONED, not one-or-the-other', () => {
    // `<repo>.list` is the operator's and must not be silenced by ccrc shipping
    // a default, nor the other way round.
    const repo = makeRepo('alpha'); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', '_default.list'), '.remember/\n');
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    plantEngine('cp .graphifyignore "$HOME/gfxignore-during" 2>/dev/null || true');
    runSweep();
    const written = fs.readFileSync(j('gfxignore-during'), 'utf8');
    expect(written, "ccrc's own default").toContain('.remember/');
    expect(written, "the operator's per-repo list").toContain('fixtures/');
    // …and no filename prefix leaked in from grepping two files at once, which
    // would be a pattern matching nothing.
    expect(written).not.toMatch(/_default\.list:|alpha\.list:/);
  });

  it('D-1160 — a "!" line in the DEFAULT refuses too, not just in the per-repo list', () => {
    // The negation check runs over EVERY source. A default that could smuggle a
    // re-include past a per-repo check would be worse than shipping no default.
    // BOTH lists are present, and the '!' is in the DEFAULT — the one that is
    // NOT last in the union order. With only the default planted this test
    // would be vacuous: "check the last source" and "check every source" agree
    // when there is one source, and a mutation to last-only stayed green until
    // this fixture grew its second list.
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', '_default.list'), '.remember/\n!secrets.md\n');
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    expect(lastPass().trees.find((t: {path:string}) => t.path === repo).reason).toContain('!');
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
  it('F3 (review fix) — SIGTERM mid-build fires the .graphifyignore trap (row 11a: the crash window)', async () => {
    const repo = makeRepo('alpha'); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    // Wedge the build so we can catch it mid-flight. The engine backgrounds
    // its own sleep and records its EXACT pid to a file before waiting on it,
    // so cleanup below can reap it precisely by that captured PID afterward
    // (never by a `pkill -f` pattern match -- one already caught an UNRELATED
    // process on this box during development of this test). `timeout`'s
    // SIGTERM to the untrapped fake-engine script kills the script but does
    // not reliably reach this grandchild under load (measured: reliable in
    // isolation, occasionally orphaned under the full suite's concurrency),
    // which is exactly the gap this pid file closes.
    const pidFile = j('wedged-sleep-pid');
    plantEngine(`sleep 30 & echo $! > "${pidFile}"; wait $!`);
    const ignorePath = path.join(repo, '.graphifyignore');
    const child = spawn('bash', [SWEEP], {
      env: { ...process.env, HOME: home, CCRC_GRAPH_BUILD_TIMEOUT: '2' },
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(ignorePath)) {
        if (Date.now() > deadline) {
          throw new Error('.graphifyignore never appeared -- guard/build never reached');
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      // the guard wrote it and armed the trap; the wedged engine is mid-flight
      // (or about to be).
      child.kill('SIGTERM');
      // bash defers a TRAPPED TERM until its current foreground wait() returns
      // -- that happens when the build's OWN CCRC_GRAPH_BUILD_TIMEOUT backstop
      // (2s here) kills the wedged engine, so just wait for the sweep to exit
      // on its own once the backstop fires and the deferred trap runs.
      await exited;
      expect(fs.existsSync(ignorePath)).toBe(false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (fs.existsSync(pidFile)) {
        const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
        }
      }
    }
  });
});

describe('graph-sweep: the guard compares git TRUTH, not git QUOTING (D-1449)', () => {
  // `git ls-files` C-quotes any path carrying a non-ASCII byte
  // (`"J\303\240rn.py"`) unless core.quotepath is off, while detect() prints
  // raw UTF-8 relative paths. `comm -23` then reads a TRACKED file as
  // untracked and refuses the tree for ever, with no remedy on the box.
  // MEASURED on the live fleet: mm-data was refused over two tracked files —
  // a JSON named with a/o diacritics and a PNG named with an umlaut.
  const NON_ASCII = 'Jàrnbìtar.py';        // raw UTF-8; git would print "J\303\240rnb\303\254tar.py"

  it('a TRACKED non-ASCII path is not read as untracked (the tree still builds)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.writeFileSync(path.join(repo, NON_ASCII), 'x = 1\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'a tracked non-ASCII name');
    fs.writeFileSync(j('fixture-corpus'), `a.py\n${NON_ASCII}\n`);
    runSweep();
    expect(outcomeOf(repo)).not.toBe('refused-by-guard');
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
  });

  it('an UNTRACKED non-ASCII path still refuses, and the reason carries the raw name', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.writeFileSync(path.join(repo, NON_ASCII), 'x = 1\n');   // written, never committed
    fs.writeFileSync(j('fixture-corpus'), `a.py\n${NON_ASCII}\n`);
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    const reason = lastPass().trees.find((t: { path: string }) => t.path === repo).reason;
    expect(reason).toContain(NON_ASCII);
    expect(reason).not.toContain('\\303');   // never the C-quoted spelling
  });

  // D-1450: `-c core.quotepath=false` silences ONLY the non-ASCII class.
  // `ls-files` still C-quotes a backslash, a double quote and any control
  // byte, so a tracked file in any of those three classes was refused by the
  // identical defect, with the identical no-remedy-on-the-box property. `-z`
  // is raw for all four in one call; this row is what the narrower spelling
  // cannot pass.
  const QUOTED_TOO = ['back\\slash.py', 'quo"te.py', 'tab\tname.py'];

  it('a TRACKED path git C-quotes for a backslash, a quote or a tab is not read as untracked', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    for (const n of QUOTED_TOO) fs.writeFileSync(path.join(repo, n), 'x = 1\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'tracked names git C-quotes');
    fs.writeFileSync(j('fixture-corpus'), `a.py\n${QUOTED_TOO.join('\n')}\n`);
    runSweep();
    expect(outcomeOf(repo)).not.toBe('refused-by-guard');
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
  });

  it('an UNTRACKED backslash-named path still refuses, and the reason carries the raw name', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.writeFileSync(path.join(repo, 'back\\slash.py'), 'x = 1\n');   // never committed
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nback\\slash.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    const reason = lastPass().trees.find((t: { path: string }) => t.path === repo).reason;
    expect(reason).toContain('back\\slash.py');
    expect(reason).not.toContain('back\\\\slash.py');   // never the C-quoted spelling
  });
});

describe('graph-sweep: what git IGNORES never enters the corpus (D-1451)', () => {
  // detect() reads `.gitignore` only along the ancestor chain from the VCS root
  // down to the SCAN root (`_load_graphifyignore`, detect.py:793-836) — a
  // NESTED `.gitignore` below the scan root is never read at all. So gitignored
  // build artifacts entered the corpus, were untracked, and the guard refused
  // the tree for ever, with no remedy on the box. MEASURED on the live fleet:
  // synapsium-platform over `frontend/exposynapse-site/.astro/settings.json`
  // (ignored by `frontend/exposynapse-site/.gitignore`) and
  // MekWarLive/swift-harbor over `.husky/_/*` (ignored by `.husky/_/.gitignore`).
  // The fix derives GIT'S OWN verdicts into the generated filter, so the two
  // sides answer with one authority instead of two.
  const captureFilter = 'cp .graphifyignore "$HOME/seen-ignore" 2>/dev/null || true';
  const seen = () => fs.readFileSync(j('seen-ignore'), 'utf8');
  // the same file as detect() saw it — readable even when the tree is refused
  // and the engine never runs.
  const seenAtDetect = () => fs.readFileSync(j('detect-ignore'), 'utf8');
  // D-1453 — what the FILTER carries and what the CORPUS keeps are two
  // different questions, and only the second can see an entry that eats a
  // TRACKED file. plantGuardPython() tees the filtered corpus here.
  const corpusSeen = () => fs.readFileSync(j('seen-corpus'), 'utf8');
  // D-1458 — the stub appends one line per invocation. The derivation now costs
  // a SECOND detect() run, and the row that matters is the one where it costs
  // none at all.
  const detectCalls = () => (fs.existsSync(j('detect-calls'))
    ? fs.readFileSync(j('detect-calls'), 'utf8').split('\n').filter(Boolean).length : 0);

  it('a NESTED .gitignore below the tree root is honoured — the tree BUILDS, and the entry is anchored', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    fs.mkdirSync(path.join(repo, 'frontend', '.astro'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'frontend', 'index.ts'), 'export const i = 1;\n');
    fs.writeFileSync(path.join(repo, 'frontend', '.gitignore'), '.astro/\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'a nested .gitignore, below the scan root');
    fs.writeFileSync(path.join(repo, 'frontend', '.astro', 'settings.json'), '{}\n');   // ignored, untracked
    fs.writeFileSync(j('fixture-corpus'),
      'a.py\nfrontend/index.ts\nfrontend/.astro/settings.json\n');
    const r = runSweep();
    expect(outcomeOf(repo), 'git ignores it, so it is not a breach — it is not corpus at all')
      .not.toBe('refused-by-guard');
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), 'one ENTRY per line, anchored at the tree root, directory entries keeping their slash')
      .toMatch(/^\/frontend\/\.astro\/$/m);
    expect(r.stderr, 'the count is logged in the pass output, uncapped')
      .toMatch(/git-ignored entries derived into the corpus filter: 1$/m);
    expect(detectCalls(), 'measure, derive, measure again — the second run is what makes the derivation do anything')
      .toBe(2);
  });

  it('a directory holding BOTH a tracked and an ignored file is NOT collapsed — only the ignored file is named', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    fs.mkdirSync(path.join(repo, 'mixed'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    fs.writeFileSync(path.join(repo, 'mixed', 'keep.py'), 'k = 1\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'a directory with tracked content beside ignored');
    fs.writeFileSync(path.join(repo, 'mixed', 'skip.log'), 'noise\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nmixed/keep.py\nmixed/skip.log\n');
    runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), '--directory collapses a directory only when it holds no tracked file')
      .toMatch(/^\/mixed\/skip\.log$/m);
    expect(seen(), 'collapsing it would take the TRACKED mixed/keep.py out of the corpus with it')
      .not.toMatch(/^\/mixed\/$/m);
  });

  it('a repo with nothing ignored gets no derived entries at all', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    // an operator list, so a filter is written at all and its contents are visible
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    const r = runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), "the operator's pattern is still written").toMatch(/^fixtures\/$/m);
    expect(seen(), 'nothing is ignored, so nothing is derived').not.toMatch(/^\//m);
    expect(r.stderr).not.toContain('git-ignored entries derived');
    expect(detectCalls(), 'nothing derived, so no second run').toBe(1);
  });

  // D-1458 — A MEASURED COST WAS ACCEPTED INSTEAD OF REMOVED. D-1451..D-1453
  // derived EVERY path git ignores. MEASURED on the live fleet (2026-09-04,
  // custom-tools): 308 entries — 211 files under `.superpowers/`, 59 under
  // `tools/`, 24 under `.remember/` — against a 1938-file corpus, at ~50 us per
  // (pattern, path) with the path re-resolved inside the per-pattern loop
  // (detect.py:891-895): ~600k matches, ~30 s added to EVERY pass over that
  // tree, twice over. And only 22 of the 308 covered a file detect would ingest
  // at all, every one under `.remember/` — which the DEFAULT noise list already
  // excludes. The ledger measured that 30 s and signed it off as "inside the
  // timeout". This row is the shape of that tree: a great many ignored paths,
  // none of them anywhere near the corpus. It must cost NOTHING — no entries,
  // and no second detect() run either.
  it('a tree with hundreds of ignored files NONE of which reach the corpus derives nothing, and detect() runs once', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    // an operator list, so a filter is written at all and its contents are visible
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.tmp\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'ignore *.tmp');
    // 300 ignored files at the ROOT, which holds tracked content — so
    // `--directory` cannot collapse them and the old derivation would spell
    // all 300 into the filter, one line each.
    for (let i = 0; i < 300; i += 1) {
      fs.writeFileSync(path.join(repo, `n${String(i).padStart(3, '0')}.tmp`), 'junk\n');
    }
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');   // detect ingests none of them
    const r = runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), "the operator's pattern is still written").toMatch(/^fixtures\/$/m);
    const derivedLines = seen().split('\n').filter((l) => l.startsWith('/'));
    expect(derivedLines, 'not one of the 300 covers a file detect would ingest, so not one is derived')
      .toEqual([]);
    expect(r.stderr, 'and nothing is counted, because nothing was carried')
      .not.toContain('git-ignored entries derived');
    expect(detectCalls(), 'the second run is reached only when something was derived').toBe(1);
  });

  // D-1458 — the derivation asks GIT, not the breach's shape. Without the
  // check-ignore step every untracked corpus path would be derived into the
  // filter, which is not a narrowing but a blanket amnesty: the guard would
  // hide from itself the very paths it exists to refuse.
  it('a breach path git does NOT ignore is never derived — the tree is still refused over it', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'ignore *.log');
    fs.writeFileSync(path.join(repo, 'skip.log'), 'noise\n');    // ignored, untracked
    fs.writeFileSync(path.join(repo, 'poison.py'), 'x\n');       // untracked and NOT ignored
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nskip.log\npoison.py\n');
    runSweep();
    expect(outcomeOf(repo), 'the ignored path is derived away; the other one is a real breach')
      .toBe('refused-by-guard');
    const reason = lastPass().trees.find((t: { path: string }) => t.path === repo).reason;
    expect(reason).toContain('poison.py');
    expect(reason, 'and the ignored one is gone from the corpus, so it is not in the reason')
      .not.toContain('skip.log');
  });

  // D-1450's four quoting classes reach the derivation too, now that it round-
  // trips every breach path through `git check-ignore --stdin`. `-z` frames
  // both sides in NUL, so a non-ASCII name comes back raw; the line-framed
  // spelling comes back C-quoted (`"J\303\240..."`), which would derive an
  // entry naming a file that does not exist and leave the real one breaching.
  it('a NON-ASCII ignored corpus path survives the check-ignore round trip and is derived raw', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    const NAME = 'Jàrnbìtar.log';
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'ignore *.log');
    fs.writeFileSync(path.join(repo, NAME), 'noise\n');   // ignored, untracked
    fs.writeFileSync(j('fixture-corpus'), `a.py\n${NAME}\n`);
    const r = runSweep();
    expect(outcomeOf(repo), 'git ignores it, so it is not a breach at all')
      .not.toBe('refused-by-guard');
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), 'the raw UTF-8 name, never the C-quoted spelling').toContain(`/${NAME}`);
    expect(seen()).not.toContain('303');
    expect(r.stderr).toMatch(/git-ignored entries derived into the corpus filter: 1$/m);
  });

  it('a derived entry is ANCHORED — an ignored `build/` may not hide a TRACKED src/build/', () => {
    // Unanchored, this entry is a `build/` that matches at every depth: the
    // RULE-3 probe sees it hide the tracked src/build/x.ts and withholds it,
    // and build/junk.js then breaches the corpus. Anchored, it names the root
    // directory git actually ignores and nothing else.
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    fs.mkdirSync(path.join(repo, 'src', 'build'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'build'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.gitignore'), 'build/\n');
    fs.writeFileSync(path.join(repo, 'src', 'build', 'x.ts'), 'export const x = 1;\n');
    git(repo, 'add', '.gitignore'); git(repo, 'add', '-f', 'src/build/x.ts');
    git(repo, 'commit', '-qm', 'tracks src/build despite an unanchored build/ rule');
    fs.writeFileSync(path.join(repo, 'build', 'junk.js'), 'junk\n');   // ignored, untracked
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nsrc/build/x.ts\nbuild/junk.js\n');
    runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), 'the entry names the ignored ROOT directory, not the name at every depth')
      .toMatch(/^\/build\/$/m);
  });

  // D-1453 — THE SILENT CLASS THE PROBE CANNOT SEE, which D-1452 mistook for
  // the probe's own case. The seam is THREE-way: git spells an entry as a
  // PATH, `git ls-files -X` spends it as WILDMATCH (`*` does not cross `/`),
  // detect spends it as `fnmatch.fnmatch` (detect.py:866, anchored arm, where
  // `*` DOES cross `/`). Put the tracked file one directory DEEPER than the
  // derived entry and the two glob dialects disagree: the probe answers empty
  // and KEEPS the entry, and detect then eats the tracked file — no withheld
  // line, no breach, exit 0. MEASURED against the installed 0.9.9 on this
  // exact fixture: corpus with no filter ['a*.py', 'ax/b.py', 'keep.py']; with
  // the raw entry `/a*.py` ['keep.py'] — the TRACKED ax/b.py gone; with the
  // neutralized `/a[*].py` ['ax/b.py', 'keep.py']. Neutralization is the guard
  // this row pins, and only the CORPUS assertion can see it.
  it('a derived entry whose FILENAME carries a glob metacharacter is made LITERAL — a tracked file one directory deeper survives', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    // `\*` in .gitignore is a LITERAL star: only the file named `a*.py` is ignored.
    fs.writeFileSync(path.join(repo, '.gitignore'), '/a\\*.py\n');
    fs.mkdirSync(path.join(repo, 'ax'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'ax', 'b.py'), 'b = 1\n');
    fs.writeFileSync(path.join(repo, 'keep.py'), 'k = 1\n');
    // makeRepo's own `a.py` has to GO: `a*.py` matches it in wildmatch too, so
    // leaving it would fire the probe and make this row red for the loud
    // reason instead of the silent one it exists to measure.
    git(repo, 'rm', '-q', 'a.py');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'tracks ax/b.py and keep.py; ignores the literal a*.py');
    fs.writeFileSync(path.join(repo, 'a*.py'), 'untracked\n');   // ignored, untracked
    fs.writeFileSync(j('fixture-corpus'), 'ax/b.py\nkeep.py\na*.py\n');
    const r = runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    // the CORPUS first — it is the assertion that names the harm. The filter
    // shape below only says HOW the corpus was kept whole.
    expect(corpusSeen().split('\n'), 'the TRACKED file one directory deeper is still in the corpus')
      .toContain('ax/b.py');
    expect(corpusSeen().split('\n'), 'and the ignored untracked file the entry names is still excluded')
      .not.toContain('a*.py');
    expect(seen(), 'the metacharacter is neutralized into a one-character class — literal in BOTH dialects')
      .toMatch(/^\/a\[\*\]\.py$/m);
    expect(seen(), 'the raw spelling — the one whose `*` crosses a `/` under fnmatch — never reaches the filter')
      .not.toMatch(/^\/a\*\.py$/m);
    expect(r.stderr, 'nothing is hidden, so nothing is withheld')
      .not.toContain('derived ignore entries withheld');
  });

  // D-1453 — the RULE-3 probe over derived entries keeps its own red row, and
  // after neutralization it is the OTHER half of the same three-way seam: a
  // backslash is LITERAL to `fnmatch` but an ESCAPE to wildmatch. The entry
  // `a\b.log` — one untracked file to git, one literal name to detect — reads
  // as `ab.log` to `git ls-files -X`, which is TRACKED. So the probe fires on
  // a file detect would never have hidden: a VISIBLE false positive, which is
  // the direction a belt is allowed to fail in. MEASURED both ways on the
  // installed 0.9.9: `_is_ignored(ab.log, root, [(root, '/a\b.log')])` is
  // False, while `git ls-files -c -i -X` over that same entry prints `ab.log`.
  it('the RULE-3 probe still withholds — a backslash is an escape to wildmatch and a literal to fnmatch', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');  // so a filter is written at all
    // `\\` in .gitignore is ONE literal backslash: the ignored file is `a\b.log`.
    fs.writeFileSync(path.join(repo, '.gitignore'), 'a\\\\b.log\n');
    fs.writeFileSync(path.join(repo, 'ab.log'), 'tracked\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'tracks ab.log; ignores the literal a-backslash-b.log');
    fs.writeFileSync(path.join(repo, 'a\\b.log'), 'untracked\n');   // ignored, untracked
    // D-1458: the path has to be IN THE CORPUS for the derivation to look at it
    // at all — which also makes the cost of a withheld entry plain. Under the
    // census-wide derivation the entry was withheld and nothing else happened;
    // now a withheld entry means the tree is refused over that path, in the
    // open, which is the direction a belt is allowed to fail in.
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nab.log\na\\b.log\n');
    const r = runSweep();
    expect(r.stderr, 'the probe fires, and says which entry it withheld and why')
      .toMatch(/derived ignore entries withheld, repo tracks matching files: \/a\\b\.log/);
    expect(seenAtDetect(), "the operator's pattern is still written").toMatch(/^fixtures\/$/m);
    expect(seenAtDetect(), 'the withheld entry never reaches the generated filter')
      .not.toMatch(/a\\b\.log/);
    expect(r.stderr, 'nothing survived the probe, so no count is logged')
      .not.toContain('git-ignored entries derived');
    expect(detectCalls(), 'and nothing survived, so there is nothing to measure a second time').toBe(1);
    expect(outcomeOf(repo), 'the path is still in the corpus and still untracked — a VISIBLE refusal')
      .toBe('refused-by-guard');
    expect(lastPass().trees.find((t: { path: string }) => t.path === repo).reason)
      .toContain('a\\b.log');
    expect(corpusSeen(), 'and the TRACKED ab.log the probe protected is still in the corpus')
      .toContain('ab.log');
  });

  // D-1452 — git emits REDUNDANT entries whenever a directory is not itself
  // named by an ignore rule but all of its content is ignored: the collapsed
  // directory AND every ignored file under it. Measured (git 2.43.0): with
  // `*.log` and a directory holding only `a.log`/`b.log`, `ls-files -o -i
  // --exclude-standard --directory` prints `f/`, `f/a.log`, `f/b.log` — three
  // entries for one collapsed directory. Every extra entry is dead weight the
  // corpus side pays for per scanned path (D-1452's cost note), and it inflates
  // the number the pass logs, so the count would over-report what the filter
  // carries.
  it('redundant entries under a COLLAPSED directory are pruned, and the logged count states what the filter carries', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'ignore *.log');
    fs.mkdirSync(path.join(repo, 'f'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'f', 'a.log'), 'noise\n');
    fs.writeFileSync(path.join(repo, 'f', 'b.log'), 'noise\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nf/a.log\nf/b.log\n');
    const r = runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), 'the collapsed directory is the entry that carries the subtree')
      .toMatch(/^\/f\/$/m);
    expect(seen(), 'and the files under it are redundant with it — dead weight in every detect() call')
      .not.toMatch(/^\/f\/a\.log$/m);
    expect(r.stderr, 'the count states the entries the filter carries, not the entries git printed')
      .toMatch(/git-ignored entries derived into the corpus filter: 1$/m);
  });
});

describe('graph-sweep: foreign .graphifyignore ownership (finding 1, whole-branch review)', () => {
  // A repo that adopts graphify upstream may COMMIT its own .graphifyignore
  // — tracked, so ignore rules don't protect it from deletion the way they
  // protect an untracked file. Ownership is marker-detected (first line
  // starts with "# generated by ccd-graph-sweep"), not "any file the sweep
  // happens to find" — a foreign file must survive every pass, forever,
  // whether or not a noise list applies.
  function trackForeignIgnore(repo: string): string {
    const p = path.join(repo, '.graphifyignore');
    fs.writeFileSync(p, 'upstream-owned-rule/\n');
    // -f: makeRepo's local exclude (the D' precondition, added for the
    // SWEEP's own ephemeral file) would otherwise refuse the add — this
    // repo tracked its own .graphifyignore before ccrc ever touched it.
    git(repo, 'add', '-f', '.graphifyignore');
    git(repo, 'commit', '-qm', 'track a graphify-adopted .graphifyignore');
    return p;
  }

  it('(a) no noise list: a tracked, committed .graphifyignore is left byte-identical and the tree still builds', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    const ignorePath = trackForeignIgnore(repo);
    const before = fs.readFileSync(ignorePath, 'utf8');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');   // vacuous corpus: no breach
    runSweep();
    expect(fs.readFileSync(ignorePath, 'utf8')).toBe(before);
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
  });

  // D-1161. Case (a) above pinned a world that stopped existing the moment
  // D-1160 shipped `_default.list` to every non-server box: with a list always
  // present, the foreign-file refusal became UNIVERSAL and this describe's own
  // stated guarantee — "a foreign file must survive every pass, forever,
  // WHETHER OR NOT a noise list applies" — was false on every installed box.
  // (a) stayed green only because no fixture here installs the shipped default.
  // This is that same case in the world the box is really in, and it is the
  // test that goes RED on the first draft of D-1160.
  it('(a2) D-1161 — with the SHIPPED default installed and no per-repo list, the foreign file still survives and the tree still builds', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    const ignorePath = trackForeignIgnore(repo);
    const before = fs.readFileSync(ignorePath, 'utf8');
    plantDefaultNoise();                                // exactly what _inst_graph_noise does
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(repo), 'the shipped default must not turn a repo that owns its own .graphifyignore into a permanent refusal')
      .not.toBe('refused-by-guard');
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(fs.readFileSync(ignorePath, 'utf8')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');   // and nothing was dirtied
  });

  it('(b) a noise list present: the foreign file blocks the write — refused-by-guard, naming the file', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    const ignorePath = trackForeignIgnore(repo);
    const before = fs.readFileSync(ignorePath, 'utf8');
    fs.mkdirSync(j('.ccrc', 'graph-noise'), { recursive: true });
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), 'fixtures/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    expect(lastPass().trees.find((t: { path: string }) => t.path === repo).reason)
      .toContain('.graphifyignore');
    expect(fs.readFileSync(ignorePath, 'utf8')).toBe(before);   // untouched, not overwritten
    expect(fs.existsSync(path.join(repo, 'graphify-out', 'graph.json'))).toBe(false);
  });

  // (d) D-1452, narrowed by D-1458 — the case the other three cannot reach.
  // (a)/(a2)/(b) each carry a foreign `.graphifyignore` but nothing GITIGNORED,
  // untracked AND IN THE CORPUS, so the derivation produces an empty set and
  // the write block never runs: all three stay green with the `foreign` skip
  // deleted. Measured. This row supplies the missing precondition — one ignored
  // untracked path that detect actually ingests, which since D-1458 is what it
  // takes for the derivation to have anything to write — and the skip is the
  // only thing standing between it and the repo's own committed file. Without
  // the skip the generated filter OVERWRITES that tracked file, and
  // `_gs_rm_generated`, reading its own marker on what is now a marker-bearing
  // file, then DELETES it at exit: D-1161's failure one step worse, the repo
  // left with a deleted tracked file. So the tree is refused here — the honest
  // outcome for a repo whose own filter this sweep may not touch — and what
  // this row pins is that the refusal costs the committed file nothing.
  it('(d) a foreign file plus a GITIGNORED untracked path IN THE CORPUS: the derivation is skipped, and the committed file survives byte-identical', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    const ignorePath = trackForeignIgnore(repo);
    const before = fs.readFileSync(ignorePath, 'utf8');
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    git(repo, 'add', '.gitignore'); git(repo, 'commit', '-qm', 'ignore *.log');
    fs.writeFileSync(path.join(repo, 'noise.log'), 'noise\n');   // ignored, untracked: derivable
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nnoise.log\n');
    const r = runSweep();
    // D-1459: what pins the outer `foreign` skip ITSELF, now that
    // `_gs_open_filter` also refuses a foreign tree. With the skip deleted the
    // derivation runs (and then writes nowhere, which is the point), so the
    // file survives either way and every assertion below stays green — this
    // line is the one that does not. The count log is printed for any non-empty
    // `derived`, outside the write block.
    expect(r.stderr, 'a tree the sweep may not filter must not pay for a derivation either')
      .not.toContain('derived into the corpus filter');
    expect(fs.existsSync(ignorePath), "the repo's own committed file must still exist").toBe(true);
    expect(fs.readFileSync(ignorePath, 'utf8'), 'and be byte-identical — never overwritten by the derived filter').toBe(before);
    expect(git(repo, 'status', '--porcelain'), 'and never dirtied, still less deleted').toBe('');
    expect(outcomeOf(repo), 'RULE 2 yields, but this repo owns its filter — the breach is stated instead of filtered away')
      .toBe('refused-by-guard');
    expect(lastPass().trees.find((t: { path: string }) => t.path === repo).reason)
      .toContain('noise.log');
  });

  // (e)/(f) D-1459 — the helper's OWN contract, exercised DIRECTLY, because no
  // caller can reach `_gs_open_filter` on a foreign tree today: RULE 2 empties
  // `patterns` before call site 1, and the derivation skips on `foreign` before
  // call site 2. Rows (a)-(d) therefore all stay green with the helper's
  // ownership line deleted — measured — so without these two rows the only
  // thing holding the shared write site shut on a foreign tree is a comment
  // enumerating its callers, which goes stale the moment a third appears.
  //
  // The definitions are LIFTED FROM THE SHIPPED FILE (function name through the
  // closing brace at column 0), never retyped: a fixture carrying its own copy
  // of the helper could go green against a helper no box has. `trap -p EXIT` is
  // run at top level, NOT in a command substitution — bash resets non-ignored
  // traps in a subshell, so `$(trap -p EXIT)` prints nothing either way and
  // could not tell an armed trap from a disarmed one.
  function callOpenFilter(tree: string) {
    return spawnSync('bash', ['-c', `
      eval "$(sed -n '/^_gs_owns_ignore() {/,/^}/p; /^_gs_open_filter() {/,/^}/p' "$1")"
      GS_FILTER_TREE=sentinel
      _gs_open_filter "$2"; echo "rc=$?"
      echo "tree=$GS_FILTER_TREE"
      trap -p EXIT
      trap - EXIT
    `, 'bash', SWEEP, tree], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  }

  it('(e) _gs_open_filter REFUSES a foreign tree itself: nothing written, no trap armed, non-zero return', () => {
    const repo = makeRepo('alpha');
    const ignorePath = trackForeignIgnore(repo);
    const before = fs.readFileSync(ignorePath, 'utf8');
    const r = callOpenFilter(repo);
    expect(r.stdout, 'a foreign tree is a refusal, and callers key "append nothing" off it').toContain('rc=1');
    expect(fs.readFileSync(ignorePath, 'utf8'), 'the marker header must never go over a tracked file').toBe(before);
    expect(git(repo, 'status', '--porcelain'), 'and the tree is not dirtied').toBe('');
    // and the trap is NOT armed on a file the sweep does not own — GS_FILTER_TREE
    // still carries the sentinel, and no EXIT trap was installed.
    expect(r.stdout).toContain('tree=sentinel');
    expect(r.stdout).not.toContain('_gs_rm_generated');
  });

  it('(f) and the happy paths are unchanged: absent gets the header, ours is appended to, both arm the trap', () => {
    const repo = makeRepo('alpha');
    const p = path.join(repo, '.graphifyignore');
    const first = callOpenFilter(repo);                       // absent
    expect(first.stdout).toContain('rc=0');
    expect(first.stdout).toContain(`tree=${repo}`);
    expect(first.stdout).toContain('_gs_rm_generated');        // trap armed
    expect(fs.readFileSync(p, 'utf8')).toBe(
      '# generated by ccd-graph-sweep for one build — never committed, never edited\n');
    fs.appendFileSync(p, 'fixtures/\n');
    const second = callOpenFilter(repo);                      // ours, already open
    expect(second.stdout).toContain('rc=0');
    expect(second.stdout).toContain('_gs_rm_generated');
    expect(fs.readFileSync(p, 'utf8'), 'idempotent: the header is not written twice').toBe(
      '# generated by ccd-graph-sweep for one build — never committed, never edited\nfixtures/\n');
  });

  it('(c) the sweep\'s OWN marker-bearing leftover is still swept, even with a foreign file elsewhere', () => {
    const repo = makeRepo('alpha'); plantEngine();
    fs.writeFileSync(path.join(repo, '.graphifyignore'),
      '# generated by ccd-graph-sweep for one build — never committed, never edited\nfixtures/\n');
    runSweep();
    expect(fs.existsSync(path.join(repo, '.graphifyignore'))).toBe(false);
  });
});

describe('graph-sweep: D-1161 — the default yields, the operator instructs', () => {
  // `.graphifyignore` is a pure path filter: it knows nothing about git. So the
  // default list's stated contract — "only what ccrc and its skills create" —
  // could not be enforced by shipping patterns, and in a repo that COMMITS
  // `.claude/settings.json` the default removed TRACKED nodes from the corpus.
  // The corpus guard cannot see that (it measures corpus MINUS tracked, so a
  // SHRINKING corpus never breaches); graphify's shrink guard then saw an
  // unaccounted net loss with `had_explicit_deletions=False` and refused the
  // write, wedging the tree at `refused-shrink` on every pass thereafter.
  // Seven repos on the reference fleet track such content — three of them among
  // the five D-1160 was written to unblock.
  function trackClaudeDir(repo: string): void {
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{}\n');
    git(repo, 'add', '-f', '.claude/settings.json');
    git(repo, 'commit', '-qm', 'this repo tracks its own .claude/');
  }
  // the engine records the filter it was actually handed — the only way to see
  // a file the sweep deletes before it returns.
  const captureFilter = 'cp .graphifyignore "$HOME/seen-ignore" 2>/dev/null || true';
  const seen = () => fs.readFileSync(j('seen-ignore'), 'utf8');

  it('withholds a DEFAULT pattern that would hide tracked content, and still applies the rest', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    trackClaudeDir(repo);
    plantDefaultNoise();
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(['never-built', 'stale-rebuilt']).toContain(outcomeOf(repo));
    expect(seen(), 'a pattern that hides TRACKED content must be withheld — it is what wedges the tree at refused-shrink')
      .not.toMatch(/^\.claude\/$/m);
    expect(seen(), 'and withholding one pattern must not disable the others')
      .toMatch(/^\.remember\/$/m);
  });

  it('honours an OPERATOR pattern that hides tracked content — that is the escape hatch', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    trackClaudeDir(repo);
    plantDefaultNoise();
    fs.writeFileSync(j('.ccrc', 'graph-noise', 'alpha.list'), '.claude/\n');
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(seen(), "the operator's list is an instruction about THIS repo, honoured as written")
      .toMatch(/^\.claude\/$/m);
  });

  it('announces what it withheld, naming the pattern and the remedy — never silently', () => {
    const repo = makeRepo('alpha'); plantEngine(captureFilter); plantGuardPython();
    trackClaudeDir(repo);
    plantDefaultNoise();
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    const r = runSweep();
    expect(r.stderr).toContain('default noise withheld');
    expect(r.stderr).toContain('.claude/');
    expect(r.stderr).toContain('alpha.list');       // the remedy, named
  });

  it('a guard refusal after the filter was written leaves no armed trap — nothing is rm-ed at the filesystem root', () => {
    // The trap `_gs_guard` arms interpolated `$tree` at FIRE time. A corpus
    // breach returns 1 with the trap still armed and the loop `continue`s past
    // the only disarm, so the leaked EXIT trap fired at pass end — by which
    // point the loop variable is EMPTY and the command is `rm -f
    // /.graphifyignore`. Unreachable before D-1160, because the block that arms
    // the trap only ran for a repo an operator had configured; universal after
    // it, because the default ships to every box.
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    plantDefaultNoise();
    const shim = j('shim');
    fs.mkdirSync(shim, { recursive: true });
    fs.writeFileSync(path.join(shim, 'rm'),
      '#!/bin/bash\nprintf \'%s\\n\' "$*" >> "$HOME/rm-calls"\nexec /bin/rm "$@"\n', { mode: 0o755 });
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nnot-tracked.py\n');   // breach => refusal
    runSweep({ PATH: `${shim}:${process.env.PATH}` });
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    const calls = fs.existsSync(j('rm-calls')) ? fs.readFileSync(j('rm-calls'), 'utf8') : '';
    expect(calls, 'a leaked trap firing with an empty tree deletes at the filesystem root')
      .not.toMatch(/(^|\s)-f \/\.graphifyignore\s*$/m);
  });

  // D-1454 — THE 5-PATH CAP HID THE SIZE OF THE BREACH. The reason keeps its
  // cap (a census row is read on a phone, and 60 paths on one line is not a
  // finding, it is a wall), but a reader has no way to tell a tree with six
  // untracked paths — one commit away from building again — from one with
  // sixty, which is a corpus problem. The count is the difference between
  // "fix it" and "triage it", and it costs one clause.
  const reasonOf = (tree: string) =>
    lastPass().trees.find((t: { path: string }) => t.path === tree)?.reason as string;

  it('the refusal reason says how many breach paths the 5-path cap cut (D-1454)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    const untracked = ['b1.py', 'b2.py', 'b3.py', 'b4.py', 'b5.py', 'b6.py', 'b7.py', 'b8.py'];
    fs.writeFileSync(j('fixture-corpus'), ['a.py', ...untracked].join('\n') + '\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    const reason = reasonOf(repo);
    // five named, and the three the cap cut are COUNTED, not silently dropped.
    expect(reason, 'the cap still names at most five paths').toContain('b5.py');
    expect(reason, 'a sixth path is named — the cap is gone, not counted').not.toContain('b6.py');
    expect(reason, 'the breach beyond the cap is invisible').toMatch(/\(\+3 more\)$/);
  });

  it('a breach that fits inside the cap carries no count clause (D-1454)', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantGuardPython();
    fs.writeFileSync(j('fixture-corpus'), 'a.py\nb1.py\nb2.py\nb3.py\nb4.py\nb5.py\n');
    runSweep();
    expect(outcomeOf(repo)).toBe('refused-by-guard');
    expect(reasonOf(repo), 'five paths named and five shown — nothing was cut')
      .not.toMatch(/\(\+\d+ more\)/);
  });

  // The trap-body fix and the caller-side cleanup are DEFENSE IN DEPTH for the
  // root-level rm above: each alone closes it, so neither reddens that test on
  // its own (measured — both single mutations stayed green; the pair reddens).
  // The cleanup does have an effect of its own, and this is it. A tree refused
  // on the detect()-failure path removes nothing inside the guard, so without
  // the caller's cleanup its filter waits for a trap that a LATER tree's arm
  // renames — and is then never removed at all. A stray .graphifyignore in a
  // repo is a file a session can commit.
  it('a filter written for a tree that is then refused is removed at once, not left for a trap that may never name it again', () => {
    const alpha = makeRepo('alpha'); makeRepo('beta');
    plantEngine();
    // detect() FAILS in alpha only — the one refusal path that removes nothing
    // inside the guard; beta then builds and re-arms the trap onto itself.
    fs.writeFileSync(j('.ccrc', 'graphify-venv', 'bin', 'python'),
      '#!/bin/bash\ncase "$PWD" in */alpha) exit 1 ;; esac\ncat "$HOME/fixture-corpus" 2>/dev/null || true\n',
      { mode: 0o755 });
    plantDefaultNoise();
    fs.writeFileSync(j('fixture-corpus'), 'a.py\n');
    runSweep();
    expect(outcomeOf(alpha)).toBe('refused-by-guard');
    expect(fs.existsSync(path.join(alpha, '.graphifyignore')),
      'the refused tree kept a generated filter no later trap will ever name')
      .toBe(false);
  });
});

describe('graph-sweep: freshness is CONTENT, not commit identity (D-1368)', () => {
  /** How many times the fake engine ran across every pass so far — the effect,
   *  not merely the census word. A tree the sweep calls fresh is a tree it did
   *  not build. */
  const engineCalls = (): number =>
    (fs.readFileSync(j('engine-calls'), 'utf8').match(/^cwd=/gm) ?? []).length;

  it('an empty commit moves HEAD and the graph stays fresh — no rebuild, no reason', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();
    expect(outcomeOf(repo)).toBe('never-built');
    expect(engineCalls()).toBe(1);
    const seeded = fs.statSync(path.join(repo, 'graphify-out', 'graph.json')).mtimeMs;
    git(repo, 'commit', '-qm', 'empty', '--allow-empty');       // HEAD moves, tree does not
    runSweep();
    expect(outcomeOf(repo)).toBe('fresh');
    expect(lastPass().trees.find((t: { path: string }) => t.path === repo).reason).toBe('');
    expect(engineCalls(), 'the sweep rebuilt a graph whose content is already HEAD\'s').toBe(1);
    expect(fs.statSync(path.join(repo, 'graphify-out', 'graph.json')).mtimeMs).toBe(seeded);
  });

  it('the SQUASH shape — HEAD is a commit carrying the built tree that does not descend from it', () => {
    const repo = makeRepo('alpha'); plantEngine();
    const main = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
    git(repo, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(repo, 'w.py'), 'k = 9\n');
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'work');
    runSweep();                                                 // the graph is built HERE
    expect(outcomeOf(repo)).toBe('never-built');
    const sideTip = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-q', main);
    git(repo, 'merge', '--squash', '-q', 'side');
    git(repo, 'commit', '-qm', 'squashed');
    // the premise, both halves — this is the live-fleet shape of 2026-09-03:
    // built 0281e084 vs HEAD 6a26a9a3, `rev-parse X^{tree}` identical.
    expect(git(repo, 'rev-parse', `${sideTip}^{tree}`))
      .toBe(git(repo, 'rev-parse', 'HEAD^{tree}'));
    expect(git(repo, 'rev-list', '--left-right', '--count', `${sideTip}...HEAD`))
      .toMatch(/^1\s+1$/);
    runSweep();
    expect(outcomeOf(repo), 'every pass rebuilds a graph that is already of HEAD\'s content')
      .toBe('fresh');
    expect(engineCalls()).toBe(1);
  });

  it('BOTH sides unmeasurable is NOT a match — two empties never compare fresh', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                   // seed a graph + stamp
    fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [], links: [], built_at_commit: 'c'.repeat(40) }));
    // A ref pointing at an object that is not there: `rev-parse HEAD` still
    // answers (exit 0, the raw sha), while `HEAD^{tree}` cannot be peeled — so
    // BOTH sides of the content comparison come back empty, and an equality
    // that spends them is an equality that calls an unmeasurable tree fresh.
    const br = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
    fs.writeFileSync(path.join(repo, '.git', 'refs', 'heads', br), 'd'.repeat(40) + '\n');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe('d'.repeat(40));
    runSweep();
    expect(outcomeOf(repo), 'a tree whose content could not be measured at all was called fresh')
      .toBe('stale-rebuilt');
    expect(lastPass().trees.find((t: { path: string }) => t.path === repo).reason).toBe('head');
  });

  // D-1369 — the mirror image. `built_at_commit` is repo-controlled text, and
  // D-1368 made the sweep spend it as a git REVISION for the first time. A rev
  // NAME peels on both sides of the equality and compares trivially equal, so
  // the tree reads `fresh` for ever and is never rebuilt again — where the old
  // string compare simply failed for a rev name and the tree rebuilt every
  // pass. `fresh` is what the census reports, so nothing surfaces it.
  it('a built_at_commit that is a rev NAME is not a sha, and never resolves to "fresh"', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                   // seed a graph + stamp
    expect(engineCalls()).toBe(1);
    fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [], links: [], built_at_commit: 'HEAD' }));
    bump(repo);                                                   // real content, genuinely stale
    runSweep();
    expect(outcomeOf(repo), 'a self-referential revision compared equal to itself and a genuinely '
      + 'stale graph was declared fresh').toBe('stale-rebuilt');
    expect(lastPass().trees.find((t: { path: string }) => t.path === repo).reason).toBe('head');
    expect(engineCalls(), 'the sweep never rebuilt the stale tree at all').toBe(2);
  });

  it('a GARBAGE-COLLECTED built commit is unmeasurable, and falls through to stale/head', () => {
    // Either `rev-parse` answering empty is the one case that keeps today's
    // behaviour: the sweep cannot prove the content matches, so it rebuilds.
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();
    const graph = path.join(repo, 'graphify-out', 'graph.json');
    fs.writeFileSync(graph, JSON.stringify({ nodes: [], links: [],
      built_at_commit: 'c'.repeat(40) }));                       // no such commit here
    runSweep();
    expect(outcomeOf(repo)).toBe('stale-rebuilt');
    expect(lastPass().trees.find((t: { path: string }) => t.path === repo).reason).toBe('head');
  });
});

describe('graph-sweep: a rebuild is a CLAIM until the stamp advances (D-1509, D-1512)', () => {
  /** Engine invocations across every pass so far — the effect, not the word. */
  const engineCalls = (): number =>
    (fs.readFileSync(j('engine-calls'), 'utf8').match(/^cwd=/gm) ?? []).length;
  const reasonOf = (tree: string) =>
    lastPass().trees.find((t: { path: string }) => t.path === tree)?.reason;
  const stampOf = (repo: string): string =>
    JSON.parse(fs.readFileSync(path.join(repo, 'graphify-out', 'graph.json'), 'utf8')).built_at_commit;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // graphify 0.9.9's `_rebuild_code` short-circuit in the shape the live fleet
  // measured (D-1509): the engine re-extracts the whole corpus, finds the
  // topology unchanged, SAYS SO ON STDOUT and exits 0 WITHOUT rewriting
  // graph.json — so `built_at_commit` keeps the sha of the last write while
  // `graphify update` still prints "Code graph updated." and exits 0. The cold
  // call still writes, exactly as the real engine does with no graph on disk.
  const SHORTCIRCUIT = `if [ -f graphify-out/graph.json ]; then
  echo "[graphify watch] No code-graph topology changes detected; outputs left untouched."
  exit 0
fi`;
  // Same exit code, no verdict: an engine that returns 0 having written and
  // said nothing at all. Nobody vouched for the stamp on disk.
  const SILENT = `if [ -f graphify-out/graph.json ]; then exit 0; fi`;

  // The restamp spends `$VENV/bin/python` WITH ARGUMENTS; `_gs_detect` spends
  // the same interpreter with none (its script arrives on stdin). One stub
  // serves both roles: vacuous for detect (an empty corpus never breaches the
  // corpus guard, which is what every other Task 6/7 fixture relies on), and
  // the real interpreter for the restamp — whose whole job is rewriting bytes
  // on disk, so a stub that faked it would pin nothing.
  function plantRestampPython(): void {
    const bin = j('.ccrc', 'graphify-venv', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'python'), `#!/bin/bash
[ "$#" -gt 1 ] || exit 0
exec python3 "$@"
`, { mode: 0o755 });
  }

  it('graphify says "left untouched", so the sweep RESTAMPS rather than claiming a rebuild', () => {
    const repo = makeRepo('alpha'); plantEngine(SHORTCIRCUIT); plantRestampPython();
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('never-built');
    const old = git(repo, 'rev-parse', 'HEAD');
    expect(stampOf(repo)).toBe(old);
    // the report graphify writes beside the graph, carrying the same commit
    const report = path.join(repo, 'graphify-out', 'GRAPH_REPORT.md');
    fs.writeFileSync(report, `# Code graph\n\n- Built from commit: \`${old.slice(0, 8)}\`\n- Nodes: 0\n`);
    const before = fs.readFileSync(path.join(repo, 'graphify-out', 'graph.json'), 'utf8');
    bump(repo);
    const head = git(repo, 'rev-parse', 'HEAD');

    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo), 'an exit 0 that wrote nothing was recorded as a rebuild').toBe('restamped');
    expect(reasonOf(repo)).toBe(`unchanged topology; ${old.slice(0, 8)} -> ${head.slice(0, 8)}`);
    expect(stampOf(repo)).toBe(head);
    expect(fs.readFileSync(report, 'utf8'))
      .toContain(`- Built from commit: \`${head.slice(0, 8)}\``);
    expect(engineCalls()).toBe(2);
    // the stamp is ALL that moved: the graph the engine wrote is byte-identical
    // everywhere else (the restamp splices a value, it does not re-serialize).
    expect(fs.readFileSync(path.join(repo, 'graphify-out', 'graph.json'), 'utf8'))
      .toBe(before.replace(old, head));

    // and the restamp is read by the freshness predicate that already exists —
    // no marker, no second spelling. The wedge is that this pass rebuilds.
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('fresh');
    expect(engineCalls(), 'the restamped tree was rebuilt again — the every-15-minutes wedge').toBe(2);
  });

  it('the restamp reason names the tracked files commit-keyed freshness cannot see (D-1511)', () => {
    const repo = makeRepo('alpha'); plantEngine(SHORTCIRCUIT); plantRestampPython();
    runSweep();
    expect(outcomeOf(repo)).toBe('never-built');
    bump(repo);
    fs.writeFileSync(path.join(repo, 'a.py'), 'x = 2  # uncommitted\n');   // tracked, dirty
    runSweep();
    expect(outcomeOf(repo)).toBe('restamped');
    expect(reasonOf(repo))
      .toMatch(/^unchanged topology; [0-9a-f]{8} -> [0-9a-f]{8}; 1 tracked file\(s\) modified$/);
  });

  it('exit 0, no advance and NO verdict is a failed build — and nothing is written', () => {
    const repo = makeRepo('alpha'); plantEngine(SILENT); plantRestampPython();
    runSweep();
    expect(outcomeOf(repo)).toBe('never-built');
    const old = git(repo, 'rev-parse', 'HEAD');
    bump(repo);
    runSweep();
    expect(outcomeOf(repo), 'a stamp nobody verified was recorded as a build').toBe('failed');
    expect(reasonOf(repo)).toContain('did not advance');
    expect(stampOf(repo), 'the sweep restamped a graph graphify never vouched for').toBe(old);
  });

  it('the log names the tree and the UTC instant BEFORE the engine speaks (D-1512)', () => {
    const repo = makeRepo('alpha'); plantEngine('echo "ENGINE-SPEAKS-HERE"'); plantRestampPython();
    expect(runSweep().status).toBe(0);
    expect(outcomeOf(repo)).toBe('never-built');
    const log = fs.readFileSync(j('.ccrc', 'graph-sweep.log'), 'utf8');
    const header = log.search(
      new RegExp(`^graph-sweep: build ${esc(repo)} at 20\\d\\d-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ$`, 'm'));
    expect(header, 'the log attributes its build to no tree and no time').toBeGreaterThanOrEqual(0);
    expect(log.indexOf('ENGINE-SPEAKS-HERE'),
      'the header did not precede the output it attributes').toBeGreaterThan(header);
  });
});

describe('graph-sweep: idle gate (Task 9)', () => {
  // seedAccountsSh gives the fixture HOME a real ~/.ccrc/accounts.sh so the
  // sweep's `source "$HOME/.ccrc/accounts.sh"` + `_ccrc_cfg_dir` resolve.
  beforeEach(() => { seedAccountsSh(home); });

  // DEFAULT_TEST_ROSTER's first account (server/test/helpers.ts) is
  // id: 'claude', configDirSuffix: '.claude' — the brief's 'claude'/'.claude'
  // pair already matches, no substitution needed.
  function plantSession(tree: string, state: string, opts: { fresh?: boolean } = {}): void {
    const reg = j('.cc-sessions'); fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, 'alpha-ws1.workdir'), tree + '\n');
    fs.writeFileSync(path.join(reg, 'alpha-ws1.wrapper'), 'claude\n');
    fs.writeFileSync(path.join(reg, 'alpha-ws1.hookstate.json'),
      JSON.stringify({ pid: 4242, state: { state } }));
    // live status file at the resolver's destination (Task 0-confirmed shape):
    const cfg = j('.claude'); fs.mkdirSync(path.join(cfg, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'sessions', '4242.json'),
      JSON.stringify({ state: state === 'working' ? 'working' : 'idle' }));
    if (opts.fresh === false) {
      const old = Date.now() / 1000 - 3600;
      fs.utimesSync(path.join(reg, 'alpha-ws1.hookstate.json'), old, old);
    }
  }
  it('a working session defers its tree as skipped-busy', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantSession(repo, 'working');
    runSweep();
    expect(outcomeOf(repo)).toBe('skipped-busy');
  });
  it('an idle session builds; a STALE hookstate (>30 min) is treated as idle', () => {
    const repo = makeRepo('alpha'); plantEngine(); plantSession(repo, 'working', { fresh: false });
    runSweep();
    expect(outcomeOf(repo)).toBe('never-built');
  });
  it('O3 — the escape hatch overrides busy at >=20 commits behind', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                    // seed
    for (let i = 0; i < 20; i++) bump(repo, `c${i}`);
    plantSession(repo, 'working');
    runSweep();
    expect(outcomeOf(repo)).toBe('stale-rebuilt');
  });
  it('O3 (D-1368) — a same-content HEAD counts as ZERO commits, so the escape never fires', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                    // seed
    for (let i = 0; i < 20; i++) git(repo, 'commit', '-qm', `e${i}`, '--allow-empty');
    // The hatch is only ASKED on a tree that is stale AND busy, and D-1368
    // makes the head dimension fresh here — so the tree is kept stale by the
    // OTHER dimension, a pin bump (row 13's mechanism). Without that this case
    // would never reach `_gs_busy` at all and would measure nothing.
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), '0.9.50\n');
    plantSession(repo, 'working');
    runSweep();
    expect(outcomeOf(repo), 'the one-sided distance count fired the build-anyway escape over '
      + '20 commits that changed nothing at all').toBe('skipped-busy');
  });

  // finding 3b — only the COMMITS arm above was ever tested; the SECONDS arm
  // (CCRC_GRAPH_STALE_ESCAPE_SECS, checked against the engine stamp's own
  // mtime) had no coverage at all. One commit keeps the commits-arm well
  // under its default (20) threshold in both tests below, so only the
  // secs arm can be what flips the outcome.
  it('O3 — the escape hatch overrides busy once the engine stamp itself is old enough (SECONDS arm)', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();                                                    // seed a fresh build + stamp
    bump(repo);                                                     // stale again; 1 commit behind
    const stampPath = path.join(repo, 'graphify-out', '.graphify_engine');
    const old = Date.now() / 1000 - 10;                             // age the stamp 10s
    fs.utimesSync(stampPath, old, old);
    plantSession(repo, 'working');
    runSweep({ CCRC_GRAPH_STALE_ESCAPE_SECS: '1' });                // threshold well under the 10s age
    expect(outcomeOf(repo)).toBe('stale-rebuilt');
  });
  it('O3 — a LARGE escape-secs threshold still defers a busy stale tree (SECONDS arm, negative case)', () => {
    const repo = makeRepo('alpha'); plantEngine();
    runSweep();
    bump(repo);
    const stampPath = path.join(repo, 'graphify-out', '.graphify_engine');
    const old = Date.now() / 1000 - 10;
    fs.utimesSync(stampPath, old, old);
    plantSession(repo, 'working');
    runSweep({ CCRC_GRAPH_STALE_ESCAPE_SECS: '3600' });             // threshold far above the 10s age
    expect(outcomeOf(repo)).toBe('skipped-busy');
  });
});

const realVenv = process.env.CCRC_GRAPHIFY_TEST_VENV;   // set on the fleet box only
const itVenv = realVenv && fs.existsSync(path.join(realVenv, 'bin', 'graphify')) ? it : it.skip;

describe('graph-sweep: real-engine integration (venv-gated; quiet-box CI is the arbiter)', () => {
  // A copied venv still runs: bin/graphify's shebang names the SOURCE venv's
  // python by absolute path, so the copy delegates to the real interpreter and
  // site-packages. The fixture only needs the entrypoint at its own $HOME path.
  const useRealEngine = () => {
    fs.cpSync(realVenv!, j('.ccrc', 'graphify-venv'), { recursive: true });
    const v = execFileSync(path.join(realVenv!, 'bin', 'graphify'), ['--version'],
      { encoding: 'utf8' }).trim().split(' ')[1];
    fs.writeFileSync(j('.ccrc', 'graphify.pin'), v + '\n');
  };
  itVenv('row 5b — NO_BACKUP suppresses the dated dir on an armed (semantic-marked) store', () => {
    const repo = makeRepo('semantic');
    fs.mkdirSync(path.join(repo, 'graphify-out'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'graphify-out', '.graphify_semantic_marker'), '');
    useRealEngine();
    runSweep({ CCRC_GRAPH_BUILD_TIMEOUT: '300' });
    const dated = fs.readdirSync(path.join(repo, 'graphify-out'))
      .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));
    expect(dated).toEqual([]);                    // export.py:45 honoured end-to-end
  });
  itVenv('row 18 behavioural — GRAPHIFY_MAX_WORKERS bounds the extraction pool', () => {
    const repo = makeRepo('busy50');
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(repo, `m${i}.py`), `x${i} = ${i}\n`);
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'files');
    useRealEngine();
    runSweep({ CCRC_GRAPH_BUILD_TIMEOUT: '300', CCRC_GRAPH_MAX_WORKERS: '1' });
    const log = fs.readFileSync(j('.ccrc', 'graph-sweep.log'), 'utf8');
    expect(log).toMatch(/\[1 workers?\]/);       // graphify logs "[N workers]"
  });
});
