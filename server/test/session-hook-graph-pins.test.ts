// Graphify revision 2, Task GR1 (D-7347): the read side's pins for a tree whose
// graphify-out is a REAL DIRECTORY, laid out the way today's sweep writes it.
// GR5 adds the shared-graph arm (graphify-out as a link to the store) and must
// leave every row here green unchanged: a real directory is measured the old
// way until its migration (spec §6.3). These are characterization pins, green
// on the base, and they pin EXACT text where session-hook.test.ts pins
// fragments.
//
// The fixture is this file's own, in the shape of session-hook.test.ts's
// module-level harness (that file is not edited and exports nothing): a
// fixture HOME with a stub tmux, the row generation, and `ccd/session-hook.sh`
// run for real with the payload on stdin.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { tl, GRAPH, type GraphContent } from './compactCardFixtures.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const SWEEP = path.resolve(__dirname, '../../ccd/ccd-graph-sweep');
const HELPER_SRC = path.resolve(__dirname, '../../ccd/compact-card.mjs');
const ID = 'lane-a';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const PIN = '0.9.9';
const NODES = 4242;

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-graph-pins-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);   // 36 bytes, no LF
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  // the box's pin, as `ccrc install` writes it
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'graphify.pin'), `${PIN}\n`);
  // a child row: the role subject is silent for a child, so the card's whole
  // context is the graphify subject and is pinned whole
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (payload: object): string =>
  execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
      CCRC_SESSION_GENERATION: GENERATION, CLAUDE_JOB_DIR: '',
      TMUX: '', CLAUDE_CONFIG_DIR: '', CLAUDECODE: '',
    },
  });

/** A repository under the fixture HOME's projects root, `commits` commits
 *  deep, each changing the tree. Returns every sha, oldest first. */
const repo = (commits: number): { tree: string; shas: string[] } => {
  const tree = path.join(home, 'projects', 'project-a');
  fs.mkdirSync(tree, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', tree, '-c', 'user.email=f@example.invalid', '-c', 'user.name=fixture', ...args],
      { encoding: 'utf8' }).trim();
  git('init', '-q');
  const shas: string[] = [];
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(tree, `c${i}.txt`), `${i}\n`);
    git('add', '-A'); git('commit', '-q', '-m', `c${i}`);
    shas.push(git('rev-parse', 'HEAD'));
  }
  return { tree, shas };
};

/** graphify-out as today's sweep leaves it after a build: a real directory
 *  holding graph.json (node-link JSON, `built_at_commit` its LAST key, with a
 *  decoy stamp at the head beyond the 4 KB tail the hook reads), the report,
 *  the labels, and the sweep's `.graphify_engine` receipt. */
const plantGraph = (tree: string, built: string, content: GraphContent = GRAPH): void => {
  const out = path.join(tree, 'graphify-out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'graph.json'),
    `{\n  "built_at_commit": "${'0'.repeat(40)}",\n  "pad": "${'x'.repeat(9000)}",\n`
    + `  "directed": false,\n  "multigraph": false,\n  "graph": {},\n`
    + `  "nodes": ${JSON.stringify(content.nodes)},\n  "links": ${JSON.stringify(content.links)},\n`
    + `  "hyperedges": [],\n  "built_at_commit": "${built}"\n}\n`);
  fs.writeFileSync(path.join(out, '.graphify_labels.json'), JSON.stringify(content.labels));
  fs.writeFileSync(path.join(out, 'GRAPH_REPORT.md'),
    `# Graph Report - project-a  (2026-10-29)\n\n## Summary\n- ${NODES} nodes · 15645 edges · 423 communities\n`);
  fs.writeFileSync(path.join(out, '.graphify_engine'), `${PIN}\n`);
};

/** One census pass, written by the sweep's OWN writer (`_gs_emit`, `_gs_row`,
 *  `_gs_finish` and the sweep's `declare -A K_…` lines, lifted out of
 *  ccd/ccd-graph-sweep), so the hook's reader is pinned against the row object
 *  the sweep really builds: a rename of one of `_gs_emit`'s field names reds
 *  these rows. The lifted text goes into a driver file; the rows travel as
 *  arguments. Since the repository sweep (GR4, D-7350) a row is one
 *  repository's: each row below is given by the tree it is about, and its
 *  `source` is the realpath of that tree's common dir. */
const sweepPass = (rows: { path: string; outcome: string; reason: string }[]): void => {
  const src = fs.readFileSync(SWEEP, 'utf8');
  const lift = (name: string): string => {
    const m = new RegExp(`^${name}\\(\\)[^\\n]*\\n[\\s\\S]*?\\n\\}$`, 'm').exec(src);
    expect(m, `ccd-graph-sweep no longer defines ${name}()`).not.toBeNull();
    return m![0];
  };
  // The sweep's own per-repository state declarations, verbatim (`_gs_emit` reads them as associative arrays).
  const declares = (): string[] => {
    const d = src.split('\n').filter((l) => /^declare -A K_/.test(l));
    expect(d.length, 'ccd-graph-sweep no longer declares its K_* state').toBeGreaterThan(0);
    return d;
  };
  // The sweep's own top-level counter initialisers, verbatim (`GS_LINKED=0 …`, `GS_MDONE=0 …`), so a counter
  // `_gs_emit` reads cannot be renamed or added without this driver following; each one it reads must be among them.
  const counters = (): string[] => {
    const c = src.split('\n').filter((l) => /^GS_[A-Z]+=0 /.test(l));
    const set = new Set(c.flatMap((l) => [...l.matchAll(/(GS_[A-Z]+)=/g)].map((m) => m[1])));
    for (const v of new Set([...lift('_gs_emit').matchAll(/\$\{?(GS_[A-Z_]+)/g)].map((m) => m[1]))) {
      expect(set.has(v!), `ccd-graph-sweep no longer initialises ${v} at the top level`).toBe(true);
    }
    return c;
  };
  const driver = path.join(home, 'sweep-pass.sh');
  fs.writeFileSync(driver, [
    'set -uo pipefail',
    'CENSUS="$HOME/.ccrc/graph-sweep.json"',
    'STARTED="2026-10-29T00:00:00Z"', `PIN="${PIN}"`, 'ROWS=()',
    ...declares(), ...counters(),
    lift('_gs_row'), lift('_gs_finish'), lift('_gs_emit'),
    'n=0',
    'while [ "$#" -gt 0 ]; do n=$((n+1)); K_RK["k$n"]=project-a-0123abcd; K_COMMON["k$n"]="$1"; K_OUTCOME["k$n"]="$2"; K_REASON["k$n"]="$3"; _gs_emit "k$n" >/dev/null; shift 3; done',
    '_gs_finish ok 0',
  ].join('\n'));
  const source = (tree: string): string => {
    const gitDir = path.join(tree, '.git');
    return fs.existsSync(gitDir) ? fs.realpathSync(gitDir) : gitDir;
  };
  execFileSync('bash', [driver, ...rows.flatMap((r) => [source(r.path), r.outcome, r.reason])],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
};

/** The SessionStart card's whole context: one JSON line on stdout. */
const graphLine = (stdout: string): string => {
  const lines = stdout.trim().split('\n');
  expect(lines, 'the hook printed more than one line on stdout').toHaveLength(1);
  const j = JSON.parse(lines[0]!);
  expect(j.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return String(j.hookSpecificOutput.additionalContext);
};
const start = (tree: string): string => run({ hook_event_name: 'SessionStart', cwd: tree });

const ADVICE = '. Answer codebase questions with `graphify query "<question>"` first; '
  + '`graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for one concept; '
  + 'read `graphify-out/GRAPH_REPORT.md` only for broad architecture. '
  + 'Do not run `graphify update` or any build here — the ccrc sweep owns the write side.';
const GATE_ARMED = ' Search tools (Grep, Glob, shell grep/rg/find) are gated, '
  + "and source-file reads are nudged, until this session's first graph query.";
const has = (sha: string, fresh: string): string =>
  `graphify: this tree has a knowledge graph — graphify-out/, ${NODES} nodes, built at ${sha.slice(0, 8)} `
  + `(${fresh}), engine ${PIN} (pin ${PIN})${ADVICE}`;

describe('the SessionStart card for a real-directory graphify-out (GR1 pins, D-7347)', () => {
  it('(a) a graph built at HEAD: the exact line, gate armed', () => {
    const { tree, shas } = repo(1);
    plantGraph(tree, shas[0]!);
    expect(fs.lstatSync(path.join(tree, 'graphify-out')).isDirectory()).toBe(true);
    expect(graphLine(start(tree))).toBe(`${has(shas[0]!, 'fresh')}${GATE_ARMED}`);
  });

  it('(b) a graph 3 commits behind: the exact line, still armed (inside the gate\'s distance)', () => {
    const { tree, shas } = repo(4);
    plantGraph(tree, shas[0]!);
    expect(graphLine(start(tree))).toBe(`${has(shas[0]!, '3 commits behind HEAD')}${GATE_ARMED}`);
  });

  it('(c) no graph: the census row for this path, from the LAST pass, is the line', () => {
    const { tree } = repo(1);
    const other = path.join(home, 'projects', 'project-b');
    sweepPass([{ path: tree, outcome: 'failed', reason: 'an older pass' }]);
    sweepPass([
      { path: other, outcome: 'refused-by-guard', reason: 'not this tree' },
      { path: tree, outcome: 'refused-by-guard', reason: 'corpus holds 3 untracked file(s): a.bin, b.bin, c.bin' },
    ]);
    expect(graphLine(start(tree))).toBe('graphify: this tree has no knowledge graph — the ccrc sweep\'s last pass says '
      + 'refused-by-guard: corpus holds 3 untracked file(s): a.bin, b.bin, c.bin. '
      + 'Do not build one here; the sweep owns the write side.');
  });

  it('(c) no graph and no census row for this path: no card at all', () => {
    const { tree } = repo(1);
    sweepPass([{ path: path.join(home, 'projects', 'project-b'), outcome: 'failed', reason: 'not this tree' }]);
    expect(start(tree), 'a child with no graph and no row for its tree gets no card').toBe('');
  });

  it('(d) the gate-armed sentence: exact, and absent past the gate\'s distance', () => {
    const near = repo(11);
    plantGraph(near.tree, near.shas[0]!);                                      // 10 behind: the edge, armed
    expect(graphLine(start(near.tree))).toBe(`${has(near.shas[0]!, '10 commits behind HEAD')}${GATE_ARMED}`);
    fs.rmSync(near.tree, { recursive: true, force: true });
    const far = repo(12);
    plantGraph(far.tree, far.shas[0]!);                                        // 11 behind: not armed
    expect(graphLine(start(far.tree))).toBe(has(far.shas[0]!, '11 commits behind HEAD'));
  });
});

// ── PreCompact: the helper's --graph and --labels argv ──────────────────────
/** A stub `timeout` that records the helper's argv and runs it; any other
 *  bounded command (the tmux question) runs unobserved. */
const TIMEOUT_STUB = [
  '#!/bin/sh',
  'case "$*" in *compact-card.mjs*) ;; *) shift; exec "$@" ;; esac',
  'printf \'%s\\n\' "$*" > "$HOME/timeout-argv"; shift; exec "$@"',
].join('\n');

describe('the PreCompact helper argv for a real-directory graphify-out (GR1 pins, D-7347)', () => {
  it('names graph.json and .graphify_labels.json under "$GM_CWD/graphify-out/"', () => {
    const { tree, shas } = repo(1);
    plantGraph(tree, shas[0]!);
    fs.copyFileSync(HELPER_SRC, path.join(home, '.cc-sessions', 'compact-card.mjs'));
    fs.writeFileSync(path.join(home, 'bin', 'timeout'), `${TIMEOUT_STUB}\n`, { mode: 0o755 });
    const proj = path.join(home, '.claude', 'projects', '-home-u-project-a');
    fs.mkdirSync(proj, { recursive: true });
    const transcript = path.join(proj, 'sess-1.jsonl');
    fs.writeFileSync(transcript, [
      tl.toolUse('Read', { file_path: path.join(tree, 'server/src/pane/statusline.ts') }),
      tl.toolUse('Bash', { command: 'sed -n 1,40p server/src/watch.ts' }),
    ].join('\n') + '\n');
    const dead = Math.floor(Date.now() / 1000) - 600;
    fs.utimesSync(transcript, dead, dead);
    expect(run({ hook_event_name: 'PreCompact', trigger: 'manual', cwd: tree, transcript_path: transcript,
      session_id: 'sess-1', prompt_id: 'p1', custom_instructions: null })).toBe('');
    const argv = fs.readFileSync(path.join(home, 'timeout-argv'), 'utf8');
    expect(argv).toContain(` --cwd ${tree} --graph ${tree}/graphify-out/graph.json `
      + `--labels ${tree}/graphify-out/.graphify_labels.json --set-stage `);
  });
});
