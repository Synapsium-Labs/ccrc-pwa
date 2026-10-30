// Graphify revision 2, Task GR5 (D-7351; spec §6): the read side of a tree whose
// graphify-out is a LINK to its repository's published build in the store
// (spec §2.1, §6.1). The hook reads the build's meta.json through the link
// (spec §2.3) and the store's settings.json (spec §5.3), and finds a tree's
// census row by the repository's `source` (spec §7). A tree whose graphify-out
// is still a real directory is measured the old way until its migration; GR1's
// pins (session-hook-graph-pins.test.ts) hold that arm, and two rows here re-run
// its shape beside a store, so the new arm cannot leak into it.
//
// Rows: N17's card half, N18, N19, the settings.json defaults row (held equal
// to ccd/ccrc's `_graph_knobs`), the dangling-link row, the real-directory rows,
// and the PreCompact argv for a linked tree.
//
// NO SAVED-RESULT ROW (GR3's finding, #1943): with the store's out-of-checkout
// GRAPHIFY_OUT the pinned 0.9.9 engine publishes no node for a saved result
// under memory/, so nothing here assumes one exists. N23 belongs to GR4/GR6.
//
// THE CENSUS ROWS ARE HAND-WRITTEN `repos[]` ROWS, deliberately and for now: no
// writer of `repos[]` exists until GR4 rewrites the sweep, and the hook's old
// per-tree-row reader is pinned against the sweep's OWN writer in GR1's pins and
// session-hook.test.ts (D-1337). GR4 re-points these rows to its writer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { tl } from './compactCardFixtures.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const HOOK = path.join(REPO_ROOT, 'ccd/session-hook.sh');
const CCRC = path.join(REPO_ROOT, 'ccd/ccrc');
const HELPER_SRC = path.join(REPO_ROOT, 'ccd/compact-card.mjs');
const ID = 'lane-a';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const PIN = '0.9.9';
const NODES = 4242;

let home: string;
beforeEach(() => {
  home = fs.realpathSync(mkTmp('ccrc-graph-repo-'));
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'graphify.pin'), `${PIN}\n`);
  // a child row: the role subject is silent, so the card is the graphify subject alone
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

const gitIn = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=f@example.invalid', '-c', 'user.name=fixture', ...args],
    { encoding: 'utf8' }).trim();
const commitFile = (dir: string, file: string, body = `${file}\n`): string => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), body);
  gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', file);
  return gitIn(dir, 'rev-parse', 'HEAD');
};

/** The repository: `project-a` on `main` under the projects root, with c0
 *  (base.txt) and the graph's commit G (a-main.txt), then main moves by
 *  `moved` commits. A worktree on `feat`, cut from c0 (before G), carries the
 *  branch's own files. So, against G: the tree differs in a-main.txt (main-line
 *  drift the tree has not merged) plus every branch file; the branch's own are
 *  the branch files alone (merge-base(G, HEAD) = c0). */
interface Repo { main: string; tree: string; graph: string; common: string }
const makeRepo = (branchFiles: string[], moved = 1): Repo => {
  const main = path.join(home, 'projects', 'project-a');
  fs.mkdirSync(main, { recursive: true });
  gitIn(main, 'init', '-q', '-b', 'main');
  const c0 = commitFile(main, 'base.txt');
  const graph = commitFile(main, 'a-main.txt');
  for (let i = 0; i < moved; i++) commitFile(main, `later-${i}.txt`);
  const tree = path.join(home, 'worktrees', 'project-a', 'feat');
  fs.mkdirSync(path.dirname(tree), { recursive: true });
  gitIn(main, 'worktree', 'add', '-q', '-b', 'feat', tree, c0);
  for (const f of branchFiles) commitFile(tree, f);
  return { main, tree, graph, common: fs.realpathSync(path.join(main, '.git')) };
};

interface Meta {
  schema?: number; commit?: string; engine?: string; nodes?: number; files?: number;
  ref?: string; built_at?: string; store?: string;
}
const STORE = (): string => path.join(home, '.ccrc', 'graphs');
const KEY = 'project-a-0a1b2c3d';
/** A published build in the store, `current` naming it, and the tree's
 *  graphify-out an absolute link to `current` (spec §2.1, §6.1). meta.json
 *  carries the spec §2.3 fields the hook reads; graph.json is a decoy whose
 *  `built_at_commit` is NOT the meta's commit, so a hook still tail-reading it
 *  names the wrong sha. */
const publish = (r: Repo, meta: Meta = {}, link = true): string => {
  const build = path.join(STORE(), KEY, 'builds', 'b1');
  fs.mkdirSync(build, { recursive: true });
  const m = {
    schema: 1, build_id: 'b1', repo_key: KEY, source: r.common, store: STORE(),
    ref: 'refs/heads/main', commit: r.graph, engine: PIN, kind: 'full', changed_files: 0,
    nodes: NODES, edges: 9, files: 100,
    built_at: new Date(Date.now() - 3 * 3600_000 - 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    ...meta,
  };
  fs.writeFileSync(path.join(build, 'meta.json'), JSON.stringify(m));
  fs.writeFileSync(path.join(build, 'graph.json'),
    `{"nodes": [], "links": [], "built_at_commit": "${'d'.repeat(40)}"}\n`);
  fs.writeFileSync(path.join(build, 'GRAPH_REPORT.md'), '- 7 nodes · 9 edges\n');
  fs.writeFileSync(path.join(build, '.graphify_engine'), `${PIN}\n`);
  fs.writeFileSync(path.join(build, '.graphify_labels.json'), '{}');
  fs.symlinkSync(path.join(STORE(), KEY, 'builds', 'b1'), path.join(STORE(), KEY, 'current'));
  if (link) fs.symlinkSync(path.join(STORE(), KEY, 'current'), path.join(r.tree, 'graphify-out'));
  return build;
};
const settings = (body: string | object): void => {
  fs.mkdirSync(STORE(), { recursive: true });
  fs.writeFileSync(path.join(STORE(), 'settings.json'), typeof body === 'string' ? body : JSON.stringify(body));
};

const graphLine = (stdout: string): string => {
  const lines = stdout.trim().split('\n');
  expect(lines, 'the hook printed more than one line on stdout').toHaveLength(1);
  const j = JSON.parse(lines[0]!);
  expect(j.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return String(j.hookSpecificOutput.additionalContext);
};
const start = (tree: string): string => run({ hook_event_name: 'SessionStart', cwd: tree });
const grep = (tree: string): string =>
  run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'assembleFleet' }, cwd: tree });

const ADVICE = '. Answer codebase questions with `graphify query "<question>"` first; '
  + '`graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for one concept; '
  + 'read `graphify-out/GRAPH_REPORT.md` only for broad architecture. '
  + 'Do not run `graphify update` or any build here — the ccrc sweep owns the write side.';
const GATE_ARMED = ' Search tools (Grep, Glob, shell grep/rg/find) are gated, '
  + "and source-file reads are nudged, until this session's first graph query.";
/** Spec §6.3's sentence for a linked tree. */
const linked = (sha: string, rest: string): string =>
  `graphify: this tree has a knowledge graph — graphify-out/ is the graph of this repository's main at ${sha.slice(0, 8)}, `
  + `${NODES} nodes, engine ${PIN} (pin ${PIN}), refreshed 3h ago; ${rest}${ADVICE}`;

describe('N18: the card of a linked tree names the graph of main and the tree\'s own changes (spec §6.3)', () => {
  it('the exact sentence: main moved, the files differing, the branch\'s own FIRST', () => {
    const r = makeRepo(['z-feat-1.txt', 'z-feat-2.txt']);
    publish(r);
    expect(fs.lstatSync(path.join(r.tree, 'graphify-out')).isSymbolicLink()).toBe(true);
    expect(graphLine(start(r.tree))).toBe(linked(r.graph, 'main has moved 1 commit since. '
      + 'Your tree differs from it in 3 files, 2 of them your branch\'s own: '
      + 'z-feat-1.txt, z-feat-2.txt, a-main.txt — read those directly') + GATE_ARMED);
  });

  it('a list longer than card_diff_list_max names the branch\'s files and gives the rest as a count', () => {
    const r = makeRepo(['z-feat-1.txt', 'z-feat-2.txt'], 3);
    publish(r);
    settings({ schema: 1, gate_max_diff_pct: 25, gate_max_denials: 3, card_diff_list_max: 1 });
    expect(graphLine(start(r.tree))).toBe(linked(r.graph, 'main has moved 3 commits since. '
      + 'Your tree differs from it in 3 files, 2 of them your branch\'s own: '
      + 'z-feat-1.txt and 2 more — read those directly') + GATE_ARMED);
  });

  it('the main checkout at the graph\'s commit: no file differs, and the card says so', () => {
    const r = makeRepo([], 0);
    gitIn(r.main, 'worktree', 'remove', '--force', r.tree);
    publish({ ...r, tree: r.main });
    expect(graphLine(start(r.main))).toBe(linked(r.graph, 'main has moved 0 commits since. '
      + 'Your tree does not differ from it') + GATE_ARMED);
  });
});

// THE LIST IS BOUNDED BY CHARACTERS, NOT ONLY BY COUNT. The standing subjects
// (graphify, then hold or role, then co-tenant) share ONE `CARD_MAX_CHARS` clip
// at the emitter, and graphify comes first: a count-bounded list of real
// repository paths grew the graph card to about 2150 characters and the clip
// cut the hold sentence that follows it mid-word. This row plants every other
// subject at its structural worst case (held case A naming a run, a
// 127-character workdir in the subject and a 40-character id; a 64-character
// project at a two-digit co-tenant count) beside 20 long branch paths, and
// asserts that each subject's WHOLE sentence reaches the session.
describe('the diff list leaves room for the subjects after it (CARD_MAX_CHARS)', () => {
  it('20 long branch paths, held case A and a two-digit co-tenant: every sentence whole', () => {
    const LONG_ID = `lane-${'a'.repeat(35)}`;
    expect(LONG_ID).toHaveLength(40);
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${LONG_ID}"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(reg, `${LONG_ID}.generation`), GENERATION);
    fs.writeFileSync(path.join(reg, `${LONG_ID}.child`), '');
    const files = Array.from({ length: 20 }, (_, i) =>
      `server/src/some/deeply/nested/module/path/component-${String(i).padStart(2, '0')}-${'x'.repeat(20)}.ts`);
    expect(files.every((f) => f.length >= 65)).toBe(true);
    const r = makeRepo(files);
    publish(r);
    const holdText = `program:${'p'.repeat(127 - 'program: wave:1/2 run:12'.length)} wave:1/2 run:12`;
    expect(holdText).toHaveLength(127);
    fs.writeFileSync(path.join(reg, `${LONG_ID}.hold`), holdText);
    const wd = `/${'w'.repeat(126)}`;
    fs.writeFileSync(path.join(reg, `${LONG_ID}.workdir`), wd);
    const project = 'q'.repeat(64);
    fs.writeFileSync(path.join(reg, `${LONG_ID}.project`), project);
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(path.join(reg, `peer-${i}.uuid`), `uuid-peer-${i}`);
      fs.writeFileSync(path.join(reg, `peer-${i}.project`), project);
      fs.writeFileSync(path.join(reg, `peer-${i}.supervised`), String(now - 5));
    }
    const text = graphLine(start(r.tree));
    const max = Number(/^CARD_MAX_CHARS=(\d+)$/m.exec(fs.readFileSync(HOOK, 'utf8'))?.[1]);
    expect(max).toBeGreaterThan(0);
    expect(text.length, 'the standing card reached the clip').toBeLessThan(max);
    // graphify: its whole sentence, the branch's own named first and the rest counted
    expect(text).toContain(`main at ${r.graph.slice(0, 8)}`);
    expect(text).toContain(`Your tree differs from it in 21 files, 20 of them your branch's own: ${files[0]}, `);
    expect(text).toMatch(/ and \d+ more — read those directly\. Answer codebase questions/);
    // it STOPS at the first name that does not fit: skipping on to the short main-line name would break the order
    expect(text, 'a main-line name was said before the branch\'s own').not.toContain('a-main.txt');
    expect(text).toContain(ADVICE + GATE_ARMED);
    // the hold, held case A naming a run, whole
    expect(text).toContain(`ccrc-program: the workspace \`${LONG_ID}\` (\`${wd}\`) is claimed — `
      + `\`~/.cc-sessions/${LONG_ID}.hold\` reads \`${holdText}\`, which names a program and a wave — `
      + 'what the `ccrc-worker` skill is for. Run that skill. Any brief sent to you is listed by '
      + `\`~/.local/bin/ccrc-api mail list --to ${LONG_ID}\`, and one you already acked is not listed again — `
      + 'the plan it named is the durable record. The hold can outlive the run that wrote it: whether that run '
      + 'is still open, and whether any brief was sent, are answered only by `~/.local/bin/ccrc-api runs list`, '
      + 'never by this file.');
    // the co-tenant, whole
    expect(text).toContain(`ccrc: 12 other supervised rows name project \`${project}\`; `
      + `\`~/.local/bin/ccrc-api peers list --of ${LONG_ID}\` names them and returns the five peer rules.`);
  });

  it('a list that fits is named whole: the character bound changes nothing for short paths', () => {
    const files = Array.from({ length: 19 }, (_, i) => `f${String(i).padStart(2, '0')}.ts`);
    const r = makeRepo(files);
    publish(r);
    expect(graphLine(start(r.tree))).toContain(`own: ${files.join(', ')}, a-main.txt — read those directly`);
  });
});

describe('N19: the gate of a linked tree arms by share of files, from settings.json (spec §6.3, §5.3)', () => {
  // 3 files differ (N18's fixture); meta.files 100.
  it('gate_max_diff_pct is read: 3% arms, 2% does not', () => {
    const r = makeRepo(['z-feat-1.txt', 'z-feat-2.txt']);
    publish(r);
    settings({ schema: 1, gate_max_diff_pct: 3, gate_max_denials: 3, card_diff_list_max: 20 });
    expect(graphLine(start(r.tree)).endsWith(GATE_ARMED)).toBe(true);
    expect(JSON.parse(grep(r.tree)).hookSpecificOutput.permissionDecision).toBe('deny');
    settings({ schema: 1, gate_max_diff_pct: 2, gate_max_denials: 3, card_diff_list_max: 20 });
    expect(graphLine(start(r.tree)).endsWith(GATE_ARMED), 'armed for a tree past the share').toBe(false);
    expect(grep(r.tree), 'the gate denied in a tree past the share').toBe('');
  });

  it('commits behind do not decide it: 12 commits on the branch, 13 files of 100, still armed', () => {
    // GRAPH_GATE_MAX_BEHIND (10) would have disarmed this tree; the share arms it.
    const files = Array.from({ length: 12 }, (_, i) => `z-feat-${String(i).padStart(2, '0')}.txt`);
    const r = makeRepo(files);
    publish(r);
    expect(graphLine(start(r.tree)).endsWith(GATE_ARMED)).toBe(true);
  });

  it('gate_max_denials is read: one denial, then the gate opens', () => {
    const r = makeRepo(['z-feat-1.txt']);
    publish(r);
    settings({ schema: 1, gate_max_diff_pct: 25, gate_max_denials: 1, card_diff_list_max: 20 });
    const j = JSON.parse(grep(r.tree));
    expect(String(j.hookSpecificOutput.permissionDecisionReason)).toContain('Denial 1 of 1; after 1 the gate opens anyway.');
    expect(grep(r.tree), 'a second search was denied past gate_max_denials').toBe('');
  });

  it('gate_max_denials above the old constant: a fourth denial', () => {
    const r = makeRepo(['z-feat-1.txt']);
    publish(r);
    settings({ schema: 1, gate_max_diff_pct: 25, gate_max_denials: 5, card_diff_list_max: 20 });
    for (const k of [1, 2, 3, 4]) {
      expect(String(JSON.parse(grep(r.tree)).hookSpecificOutput.permissionDecisionReason)).toContain(`Denial ${k} of 5`);
    }
  });

  it('an engine other than the pin does not arm', () => {
    const r = makeRepo(['z-feat-1.txt']);
    publish(r, { engine: '0.9.8' });
    const card = graphLine(start(r.tree));
    expect(card).toContain('engine 0.9.8 (pin 0.9.9)');
    expect(card.endsWith(GATE_ARMED)).toBe(false);
    expect(grep(r.tree)).toBe('');
  });
});

describe('settings.json defaults: the hook\'s equal ccd/ccrc\'s _graph_knobs (spec §5.2, N13)', () => {
  const KEYS = ['CCRC_GRAPH_GATE_MAX_DIFF_PCT', 'CCRC_GRAPH_GATE_MAX_DENIALS', 'CCRC_GRAPH_CARD_DIFF_LIST_MAX'];
  const knobDefaults = (): Record<string, string> => {
    const driver = path.join(home, 'knobs.sh');
    fs.writeFileSync(driver, '. "$1" || exit 90\n_graph_knobs\n');
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_')) env[k] = v;
    const out = execFileSync('bash', [driver, CCRC], { env: { ...env, HOME: home }, encoding: 'utf8', cwd: home });
    const got: Record<string, string> = {};
    for (const l of out.split('\n')) {
      const [k, dflt] = l.split('\x1f');
      if (k && KEYS.includes(k)) got[k] = dflt!;
    }
    return got;
  };
  /** The hook's one defaults line, in `_hook_load_graph_settings`. */
  const hookDefaults = (): Record<string, string> => {
    const m = /^\s*GS_MAX_DIFF_PCT=(\d+); GS_MAX_DENIALS=(\d+); GS_DIFF_LIST_MAX=(\d+)$/m
      .exec(fs.readFileSync(HOOK, 'utf8'));
    expect(m, 'ccd/session-hook.sh carries no settings.json defaults line').not.toBeNull();
    return { [KEYS[0]!]: m![1]!, [KEYS[1]!]: m![2]!, [KEYS[2]!]: m![3]! };
  };

  it('the three defaults are _graph_knobs\' defaults, key by key', () => {
    const k = knobDefaults();
    expect(Object.keys(k).sort()).toEqual([...KEYS].sort());
    expect(hookDefaults()).toEqual(k);
  });

  // The defaults, measured through behaviour: 25% (3 files of 12 arms, of 13
  // does not), 3 denials, 20 names.
  for (const [what, body] of [['absent', null], ['unparsable', '{"schema": 1, '], ['of another schema', { schema: 2, gate_max_diff_pct: 0 }],
    ['holding bad values', { schema: 1, gate_max_diff_pct: '08', gate_max_denials: -1, card_diff_list_max: 'x' }]] as const) {
    it(`settings.json ${what}: every default applies`, () => {
      const files = Array.from({ length: 24 }, (_, i) => `z-feat-${String(i).padStart(2, '0')}.txt`);
      const r = makeRepo(files);
      publish(r, { files: 100 });
      if (body !== null) settings(body);
      const card = graphLine(start(r.tree));
      expect(card).toContain(`Your tree differs from it in 25 files, 24 of them your branch's own: ${files.slice(0, 20).join(', ')} and 5 more — read those directly`);
      expect(card.endsWith(GATE_ARMED), '25 of 100 is inside the default 25%').toBe(true);
      for (const k of [1, 2, 3]) {
        expect(String(JSON.parse(grep(r.tree)).hookSpecificOutput.permissionDecisionReason)).toContain(`Denial ${k} of 3`);
      }
      expect(grep(r.tree)).toBe('');
      fs.rmSync(path.join(STORE(), KEY, 'builds', 'b1', 'meta.json'));
      fs.writeFileSync(path.join(STORE(), KEY, 'builds', 'b1', 'meta.json'), JSON.stringify({
        schema: 1, commit: r.graph, engine: PIN, nodes: NODES, files: 99, ref: 'refs/heads/main', store: STORE(),
        built_at: new Date(Date.now() - 3 * 3600_000 - 60_000).toISOString().replace(/\.\d+Z$/, 'Z') }));
      expect(graphLine(start(r.tree)).endsWith(GATE_ARMED), '25 of 99 is past the default 25%').toBe(false);
    });
  }
});

/** One census pass holding `repos[]` rows of spec §7 (hand-written; see the head of this file). */
const censusPass = (rows: { source: string; outcome: string; reason: string }[]): void => {
  const f = path.join(home, '.ccrc', 'graph-sweep.json');
  let doc: { passes: object[] } = { passes: [] };
  try { doc = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first pass */ }
  doc.passes.push({ started: 'x', finished: 'x', pin: PIN, status: 'ok',
    repos: rows.map((r) => ({ repo_key: KEY, ref: 'refs/heads/main', tip: '', served: '', kind: '', fail: '', ...r })) });
  fs.writeFileSync(f, JSON.stringify(doc));
};
const NO_GRAPH = (row: string): string => 'graphify: this tree has no knowledge graph — the ccrc sweep\'s last pass says '
  + `${row}. Do not build one here; the sweep owns the write side.`;

describe('N17 (card half): a tree with no graph prints its repository\'s census row (spec §6.3, §7)', () => {
  it('the row whose source is the realpath of the common dir, from the LAST pass, in a worktree', () => {
    const r = makeRepo(['z-feat-1.txt']);
    censusPass([{ source: r.common, outcome: 'failed', reason: 'an older pass' }]);
    censusPass([
      { source: path.join(home, 'projects', 'project-b', '.git'), outcome: 'failed', reason: 'not this repository' },
      { source: r.common, outcome: 'refused-by-guard', reason: 'the corpus holds 1 file outside the commit: x.bin' },
    ]);
    expect(graphLine(start(r.tree))).toBe(NO_GRAPH('refused-by-guard: the corpus holds 1 file outside the commit: x.bin'));
    expect(graphLine(start(r.main)), 'the main checkout shares the row').toBe(NO_GRAPH('refused-by-guard: the corpus holds 1 file outside the commit: x.bin'));
  });

  it('no row for this repository: no card', () => {
    const r = makeRepo(['z-feat-1.txt']);
    censusPass([{ source: path.join(home, 'projects', 'project-b', '.git'), outcome: 'failed', reason: 'not this repository' }]);
    expect(start(r.tree)).toBe('');
  });

  it('a pathological reason is clipped (D-1335)', () => {
    const r = makeRepo(['z-feat-1.txt']);
    censusPass([{ source: r.common, outcome: 'failed', reason: 'x'.repeat(100_000) }]);
    const card = graphLine(start(r.tree));
    expect(card.startsWith(NO_GRAPH('failed: xxx').slice(0, 80))).toBe(true);
    expect(card.length).toBeLessThan(600);
  });
});

describe('a dangling link prints the repository\'s census row (spec §6.3, §11)', () => {
  it('graphify-out links to a current that is gone: the same row, no graph claimed', () => {
    const r = makeRepo(['z-feat-1.txt']);
    publish(r);
    fs.rmSync(path.join(STORE(), KEY), { recursive: true, force: true });
    expect(fs.lstatSync(path.join(r.tree, 'graphify-out')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(r.tree, 'graphify-out'))).toBe(false);
    censusPass([{ source: r.common, outcome: 'timed-out', reason: 'the build passed 600s' }]);
    expect(graphLine(start(r.tree))).toBe(NO_GRAPH('timed-out: the build passed 600s'));
    expect(grep(r.tree), 'a dangling link armed the gate').toBe('');
  });
});

describe('a real-directory graphify-out keeps the old arm (GR1\'s pins, spec §6.3)', () => {
  /** graphify-out as today's sweep leaves it, with a meta.json planted inside
   *  that names ANOTHER commit and a store whose settings would disarm. */
  const realDir = (r: Repo, built: string): void => {
    const out = path.join(r.tree, 'graphify-out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'graph.json'), `{"nodes": [], "links": [], "built_at_commit": "${built}"}\n`);
    fs.writeFileSync(path.join(out, 'GRAPH_REPORT.md'), `- ${NODES} nodes · 9 edges\n`);
    fs.writeFileSync(path.join(out, '.graphify_engine'), `${PIN}\n`);
    fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ schema: 1, commit: r.graph, engine: PIN, nodes: 1,
      files: 1, ref: 'refs/heads/main', store: STORE(), built_at: '2026-10-29T00:00:00Z' }));
    settings({ schema: 1, gate_max_diff_pct: 0, gate_max_denials: 0, card_diff_list_max: 0 });
  };
  const has = (sha: string, fresh: string): string =>
    `graphify: this tree has a knowledge graph — graphify-out/, ${NODES} nodes, built at ${sha.slice(0, 8)} `
    + `(${fresh}), engine ${PIN} (pin ${PIN})${ADVICE}`;

  it('measured from graph.json and the report, gated by commits behind, denials by the constant', () => {
    const r = makeRepo(['z-feat-1.txt', 'z-feat-2.txt', 'z-feat-3.txt']);
    const head = gitIn(r.tree, 'rev-parse', 'HEAD~3');
    realDir(r, head);
    expect(graphLine(start(r.tree))).toBe(`${has(head, '3 commits behind HEAD')}${GATE_ARMED}`);
    for (const k of [1, 2, 3]) {
      expect(String(JSON.parse(grep(r.tree)).hookSpecificOutput.permissionDecisionReason)).toContain(`Denial ${k} of 3`);
    }
    expect(grep(r.tree)).toBe('');
  });

  it('eleven commits behind: not armed, whatever the store says', () => {
    const files = Array.from({ length: 11 }, (_, i) => `z-feat-${String(i).padStart(2, '0')}.txt`);
    const r = makeRepo(files);
    const base = gitIn(r.tree, 'rev-parse', 'HEAD~11');
    realDir(r, base);
    expect(graphLine(start(r.tree))).toBe(has(base, '11 commits behind HEAD'));
  });
});

// ── PreCompact: the helper's argv is unchanged; the link carries the path ────
const TIMEOUT_STUB = [
  '#!/bin/sh',
  'case "$*" in *compact-card.mjs*) ;; *) shift; exec "$@" ;; esac',
  'printf \'%s\\n\' "$*" > "$HOME/timeout-argv"; shift; exec "$@"',
].join('\n');

describe('the PreCompact helper argv for a linked tree (spec §6.1)', () => {
  it('names graph.json and .graphify_labels.json under "$GM_CWD/graphify-out/", through the link', () => {
    const r = makeRepo(['z-feat-1.txt']);
    publish(r);
    fs.copyFileSync(HELPER_SRC, path.join(home, '.cc-sessions', 'compact-card.mjs'));
    fs.writeFileSync(path.join(home, 'bin', 'timeout'), `${TIMEOUT_STUB}\n`, { mode: 0o755 });
    const proj = path.join(home, '.claude', 'projects', '-home-u-project-a');
    fs.mkdirSync(proj, { recursive: true });
    const transcript = path.join(proj, 'sess-1.jsonl');
    fs.writeFileSync(transcript, [
      tl.toolUse('Read', { file_path: path.join(r.tree, 'z-feat-1.txt') }),
      tl.toolUse('Bash', { command: 'sed -n 1,40p base.txt' }),
    ].join('\n') + '\n');
    const dead = Math.floor(Date.now() / 1000) - 600;
    fs.utimesSync(transcript, dead, dead);
    expect(run({ hook_event_name: 'PreCompact', trigger: 'manual', cwd: r.tree, transcript_path: transcript,
      session_id: 'sess-1', prompt_id: 'p1', custom_instructions: null })).toBe('');
    const argv = fs.readFileSync(path.join(home, 'timeout-argv'), 'utf8');
    expect(argv).toContain(` --cwd ${r.tree} --graph ${r.tree}/graphify-out/graph.json `
      + `--labels ${r.tree}/graphify-out/.graphify_labels.json --set-stage `);
    expect(argv, 'the helper was handed the graph.json decoy\'s sha, not meta.json\'s commit').toContain(` --built ${r.graph} `);
  });
});
