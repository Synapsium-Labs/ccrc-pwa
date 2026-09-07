// Runs ccd/session-hook.sh for real inside a fixture HOME, the way the ccd
// suites run ccd: a stub tmux on PATH answers the session name, stdin carries
// the hook payload, and the assertion reads the file the script wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { CCD } from './ccdWsHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** Run the hook with a payload; env overrides let each test break one leg.
 *  Returns the hook's STDOUT, which is empty on every event but SessionStart
 *  (R1) — `encoding: 'utf8'` is what makes execFileSync hand it back as a
 *  string rather than a Buffer. */
const run = (payload: object, env: Record<string, string> = {}): string =>
  execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env, HOME: home,
      PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
      ...env,
    },
  });
const stateFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json');
const readState = (): any => JSON.parse(fs.readFileSync(stateFile(), 'utf8'));

// ── The graph fixtures. Module scope, not inside one describe: the R1 card
// and the R5 gate (D-1613) ask the SAME question of the same tree, and a second
// copy of `plantGraph`/`gitTree` for the gate would be exactly the drift this
// repo's single-definition doctrine forbids.
/** A tree with a graph in it. `built` is the sha the graph claims; the DECOY
 *  at the head of graph.json is the mutation this fixture exists to catch —
 *  `built_at_commit` is the file's LAST key on a real 8 MB graph, and a
 *  reader that parses from the head answers the decoy.
 *
 *  `pad` IS THE DISTANCE BETWEEN THE DECOY AND THE END OF THE FILE, and the
 *  hook's `built` read defends that distance with TWO clauses that each cover
 *  the other at 9000 (D-1361): `tail -c 4096` puts the decoy outside the
 *  bytes read at all, and `| tail -n1` takes the last match of however many
 *  were read. Pass `pad: 0` for a graph.json small enough that the whole file
 *  is inside the byte window — the only shape in which the second clause is
 *  the one deciding, and so the only shape that measures it. */
const plantGraph = (dir: string, opts: {
  built?: string; nodes?: number; engine?: string | null; report?: boolean;
  pad?: number;
} = {}): void => {
  const out = path.join(dir, 'graphify-out');
  fs.mkdirSync(out, { recursive: true });
  const built = opts.built ?? 'a'.repeat(40);
  const pad = opts.pad ?? 9000;
  const decoy = `  "built_at_commit": "${'0'.repeat(40)}",\n`;
  const filler = pad > 0 ? `  "pad": "${'x'.repeat(pad)}",\n` : '';
  fs.writeFileSync(path.join(out, 'graph.json'),
    `{\n${decoy}${filler}  "hyperedges": [],\n  "built_at_commit": "${built}"\n}\n`);
  if (opts.report !== false) {
    fs.writeFileSync(path.join(out, 'GRAPH_REPORT.md'),
      `# Graph Report - demo  (2026-09-02)\n\n## Summary\n`
      + `- ${opts.nodes ?? 7662} nodes · 15645 edges · 423 communities\n`);
  }
  // `engine: null` plants an UNSTAMPED graph — the fleet design says outright
  // that one is legal ("`unstamped` is not an outcome"). `??` cannot express
  // it (it would keep ''), so the absence is its own branch (D-1334).
  if (opts.engine !== null) {
    fs.writeFileSync(path.join(out, '.graphify_engine'), `${opts.engine ?? '0.9.9'}\n`);
  }
};

/** A git repo whose HEAD is returned. `-c` on every commit so the box's own
 *  identity is never needed and never used. */
const gitTree = (dir: string, commits = 1): string => {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=f@example.invalid',
      '-c', 'user.name=fixture', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  const shas: string[] = [];
  for (let i = 0; i < commits; i++) {
    // EACH COMMIT CHANGES THE TREE (D-1368). `--allow-empty` moves HEAD and
    // leaves `HEAD^{tree}` byte-identical to every other commit's, which is
    // now the definition of FRESH — so a distance fixture built out of empty
    // commits would be measuring the arm it means to leave alone.
    fs.writeFileSync(path.join(dir, `c${i}.txt`), `${i}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `c${i}`);
    shas.push(git('rev-parse', 'HEAD'));
  }
  return shas[0]!;
};

/** Raw git inside a fixture tree, for the tests that have to MOVE HEAD after
 *  the graph was planted. Identity supplied per call, as `gitTree`'s does, so
 *  the box's own is never needed and never used. */
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=f@example.invalid',
    '-c', 'user.name=fixture', ...args], { encoding: 'utf8' }).trim();

const card = (stdout: string): string => {
  expect(stdout.trim(), 'the hook printed nothing').not.toBe('');
  const lines = stdout.trim().split('\n');
  expect(lines, 'the hook printed more than one line on stdout').toHaveLength(1);
  const j = JSON.parse(lines[0]!);
  expect(j.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return String(j.hookSpecificOutput.additionalContext);
};

// ── The ARMED-TREE fixtures, module scope for the same reason `plantGraph`
// and `gitTree` are: R5's search gate and R6's Read nudge (D-1745) ask ONE
// measurement (`_hook_graph_measure`) of ONE tree under ONE arm predicate, and
// a second copy of the tree builder for the second reader would be exactly the
// drift the comment above forbids — two describes could then disagree about
// what "armed" means while both stayed green.
const NODES = 4242;

/** A tree whose graph is fresh at HEAD — the armed shape, for the tests that
 *  are about something else. `commits` past the graph makes it stale. */
const gatedTree = (commits = 1): string => {
  const tree = path.join(home, 'tree');
  const first = gitTree(tree, commits);
  plantGraph(tree, { built: first, nodes: NODES });
  return tree;
};
const pre = (tool: string, input: object, cwd: string): object =>
  ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd });
const query = (cwd: string): object =>
  ({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'graphify query "who calls assembleFleet"' }, cwd });

/** The one PreToolUse envelope on stdout, asserted to be exactly one line of
 *  JSON — a deny (R5) or a nudge (R6), and the assertion that it is never
 *  BOTH is that this returns a single object. */
const oneLine = (stdout: string): any => {
  const lines = stdout.trim().split('\n').filter((l) => l !== '');
  expect(lines, 'the hook printed nothing, or more than one line').toHaveLength(1);
  return JSON.parse(lines[0]!);
};

describe('event → state mapping', () => {
  it('UserPromptSubmit writes working with identity fields', () => {
    run({ hook_event_name: 'UserPromptSubmit', session_id: 'uuid-1' });
    const s = readState();
    expect(s).toMatchObject({ v: 1, state: 'working', event: 'UserPromptSubmit',
      sessionId: 'uuid-1', pid: 4242, ask: null });
    expect(s.updatedAt).toBeGreaterThan(0);
  });
  it('PreToolUse of an ordinary tool is working; of AskUserQuestion is waiting with the untruncated envelope', () => {
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(readState().state).toBe('working');
    const questions = [{ question: 'Which?', header: 'Pick', multiSelect: false,
      options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }];
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask).toEqual({ questions });
  });
  it('PermissionRequest is waiting with approval tool + clipped summary', () => {
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash',
      tool_input: { command: 'x'.repeat(500) } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask.approval.tool).toBe('Bash');
    expect(s.ask.approval.summary).toHaveLength(200);
  });
  // MEASURED 2026-08-05, live fleet probe against Claude Code 2.1.222:
  // AskUserQuestion arrives as PermissionRequest on THIS harness version, not
  // PreToolUse — superseding the spec's mapping, which came from Orca's
  // normalizer against a different harness version. Before this fix the
  // PermissionRequest arm (above) wrote {approval:{tool:"AskUserQuestion",
  // summary:""}}: state correctly flipped to waiting, but the summary was
  // always empty and the real questions/options were gone — a menu the pane
  // genuinely showed, reported as an envelope with nothing useful in it. Both
  // event names now have to keep producing the exact same {questions:…}
  // shape, since which one actually fires is a harness detail this script
  // does not control and the next upgrade could flip again.
  it('PermissionRequest of AskUserQuestion is waiting with the QUESTIONS envelope, not approval', () => {
    const questions = [{ question: 'Which?', header: 'Pick', multiSelect: false,
      options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }];
    run({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask).toEqual({ questions });
    expect(s.ask.approval).toBeUndefined();
  });
  it('PermissionRequest of an ordinary tool still writes the approval envelope — unaffected by the AskUserQuestion branch above', () => {
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls -la' } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask).toEqual({ approval: { tool: 'Bash', summary: 'ls -la' } });
    expect(s.ask.questions).toBeUndefined();
  });
  // F1 (build4 dogfood, docs/superpowers/programs/build4.md): a virgin
  // session has never taken a turn, so before this fix it had NO hookstate
  // file at all — `sweepMail`'s delivery gate (`hs === null`) correctly
  // fails shut on that, never injecting mid-thought, but nothing then ever
  // wrote this id's FIRST hookstate either — the worker's first coordination
  // brief sat queued forever. A just-started session is definitionally idle:
  // SessionStart must write `state: 'done'`, the exact fact the gate's
  // `hs.state === 'done'` conjunct is waiting to see.
  it('SessionStart writes done — a virgin session is at an idle boundary (F1)', () => {
    run({ hook_event_name: 'SessionStart' });
    const s = readState();
    expect(s).toMatchObject({ v: 1, state: 'done', event: 'SessionStart',
      sessionId: 'uuid-1', pid: 4242, ask: null });
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  // D-306 (was D-B8-10). The F1 arm above was never WIRED (install-session-hooks.sh's event
  // list omitted SessionStart), so it had never run on the fleet. Wiring it
  // exposes the case its unconditional `done` gets wrong: this harness fires
  // SessionStart with `source: 'compact'` in the MIDDLE of a turn — that is how
  // the restore hook re-injects context — so a bare `done` would tell the mail
  // gate that an actively-thinking session is idle, which is precisely the
  // mid-thought injection the gate exists to prevent. PreCompact/PostCompact
  // already own the compaction transition; SessionStart(compact) must be inert.
  it('SessionStart(compact) is inert — it must not stamp done over a working turn (D-306)', () => {
    run({ hook_event_name: 'PreCompact' });
    expect(readState().state).toBe('working');
    run({ hook_event_name: 'SessionStart', source: 'compact' });
    const s = readState();
    expect(s.state).toBe('working');
    expect(s.event).toBe('PreCompact');   // the compact SessionStart wrote nothing at all
  });

  // The reboot case, measured live 2026-08-19: a session killed mid-turn keeps
  // `state: 'working'` forever, because only Stop clears it and no Stop ever
  // fires for a process that was destroyed. Resume is a real idle boundary —
  // the session is sitting at its prompt — so it must re-stamp `done`.
  it('SessionStart(resume) clears a stale working left by a killed turn (D-306)', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().state).toBe('working');
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    expect(readState().state).toBe('done');
  });

  it('SessionStart(startup) is done — and so is a payload with no source at all', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    expect(readState().state).toBe('done');
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'SessionStart' });
    expect(readState().state).toBe('done');
  });
  it('Stop is done and clears ask; interrupted survives when the payload says so', () => {
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
    run({ hook_event_name: 'Stop', is_interrupt: true });
    const s = readState();
    expect(s).toMatchObject({ state: 'done', ask: null, interrupted: true });
  });
  it('PostCompact: auto is working, manual is done', () => {
    run({ hook_event_name: 'PostCompact', trigger: 'auto' });
    expect(readState().state).toBe('working');
    run({ hook_event_name: 'PostCompact', trigger: 'manual' });
    expect(readState().state).toBe('done');
  });
  it('PreCompact is working', () => {
    run({ hook_event_name: 'PreCompact' });
    expect(readState().state).toBe('working');
  });
  it('PostToolUse is working', () => {
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    expect(readState().state).toBe('working');
  });
  it('an unrecognized event writes nothing', () => {
    run({ hook_event_name: 'SessionEnd' });
    expect(fs.existsSync(stateFile())).toBe(false);
  });
});

describe('subagents', () => {
  it('Start adds, Stop removes, the set caps at 32, session state is untouched', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'SubagentStart', agent_name: 'reviewer' });
    let s = readState();
    expect(s.state).toBe('working');
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0].name).toBe('reviewer');
    run({ hook_event_name: 'SubagentStop', agent_name: 'reviewer' });
    expect(readState().subagents).toHaveLength(0);
    for (let i = 0; i < 40; i++) run({ hook_event_name: 'SubagentStart', agent_name: `a${i}` });
    expect(readState().subagents.length).toBeLessThanOrEqual(32);
  });
  it('the cap keeps the newest arrivals, not the oldest', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    for (let i = 0; i < 40; i++) run({ hook_event_name: 'SubagentStart', agent_name: `a${i}` });
    const names = readState().subagents.map((s: any) => s.name);
    expect(names).toContain('a39');
    expect(names).not.toContain('a0');
  });
  it('ask survives subagent events while waiting, and clears once the turn ends', () => {
    const questions = [{ question: 'Which?', header: 'Pick', multiSelect: false, options: [] }];
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
    expect(readState().state).toBe('waiting');
    run({ hook_event_name: 'SubagentStart', agent_name: 'reviewer' });
    let s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask).toEqual({ questions });
    run({ hook_event_name: 'Stop' });
    expect(readState().ask).toBeNull();
  });
});

describe('the fleet gate and failure polarity', () => {
  it('no TMUX_PANE → writes nothing, exits 0', () => {
    run({ hook_event_name: 'Stop' }, { TMUX_PANE: '' });
    expect(fs.readdirSync(path.join(home, '.cc-sessions'))).toEqual([]);
  });
  it('a foreign tmux session name → writes nothing', () => {
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\necho "main"\n', { mode: 0o755 });
    run({ hook_event_name: 'Stop' });
    expect(fs.readdirSync(path.join(home, '.cc-sessions'))).toEqual([]);
  });
  it('a corrupt existing state file is overwritten, not crashed on', () => {
    fs.writeFileSync(stateFile(), '{nope');
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().state).toBe('working');
  });
  it('an oversized questions envelope is dropped whole; the state survives', () => {
    const questions = [{ question: 'q'.repeat(80_000), header: 'big', multiSelect: false, options: [] }];
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
    const s = readState();
    expect(s.state).toBe('waiting');
    expect(s.ask).toBeNull();
    expect(fs.statSync(stateFile()).size).toBeLessThan(65536);
  });
  it('p95 of 20 runs stays under the budget (150ms CI allowance; 50ms target)', () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
      times.push(Date.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(150);
  }, 30000);
  it('p95 of 20 SessionStart runs stays under the budget with a 200-row registry', () => {
    const reg = path.join(home, '.cc-sessions');
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 200; i++) {
      const id = `row-${i}`;
      fs.writeFileSync(path.join(reg, `${id}.uuid`), `uuid-${id}`);
      fs.writeFileSync(path.join(reg, `${id}.project`), i < 40 ? 'alpha' : `proj-${i}`);
      fs.writeFileSync(path.join(reg, `${id}.supervised`), String(now - 5));
    }
    // 120 leaked _reg_set-shaped dotfiles: the glob must not see them.
    for (let i = 0; i < 120; i++) fs.writeFileSync(path.join(reg, `.tmp-${i}`), 'x');
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.uuid'), 'uuid-1');
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.project'), 'alpha');
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.supervised'), String(now - 5));

    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = process.hrtime.bigint();
      run({ hook_event_name: 'SessionStart', cwd: tree, source: 'startup' });
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(150);
  });
});

// ── R4: the read side, MEASURED ───────────────────────────────────────────
// D-1243 shipped an instruction and no number. The whole argument for retiring
// the account-wide block is that its effect measured zero, and the only way
// that sentence stays true (or stops being true) is a counter the console can
// read. `graphify update` and builds deliberately do NOT count: this is
// measuring READS.
describe('graphQueries — the read counter the console can see', () => {
  const bash = (command: string): object =>
    ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } });

  it('counts query, path and explain — each one, once', () => {
    run(bash('graphify query "who calls assembleFleet"'));
    expect(readState().graphQueries).toBe(1);
    run(bash('graphify path "fleet.ts" "watch.ts"'));
    expect(readState().graphQueries).toBe(2);
    run(bash('graphify explain "the mail delivery gate"'));
    expect(readState().graphQueries).toBe(3);
  });

  it('counts a graphify that is not the first word of the line', () => {
    run(bash('cd /tmp && graphify query "x"'));
    expect(readState().graphQueries).toBe(1);
    run(bash('true; graphify explain "y"'));
    expect(readState().graphQueries).toBe(2);
  });

  it('does NOT count graphify update, a build, or a bare graphify', () => {
    run(bash('graphify update .'));
    run(bash('graphify build --all'));
    run(bash('graphify'));
    run(bash('graphify --version'));
    expect(readState().graphQueries).toBe(0);
  });

  it('does NOT count a command that merely contains the word', () => {
    run(bash('mygraphify query "x"'));
    run(bash('echo see-graphify-query-docs'));
    expect(readState().graphQueries).toBe(0);
  });

  // The regex carries TWO boundary classes and the comment gives each its own
  // job; the leading one is bound by the test above, and this binds the
  // trailing one. A verb that is only the PREFIX of a longer word is not that
  // verb: `graphify query-builder` is some other command entirely, and if it
  // counted, the number R4 exists to produce would be inflated — which is the
  // one failure direction that would corrupt the "measured zero" argument the
  // whole R0 removal rests on. Every verb is spelled out: a boundary that
  // holds for `query` and not for `explain` is still a hole.
  // (D-1359)
  it('does NOT count a verb that is merely the prefix of a longer word', () => {
    run(bash('graphify query-builder run'));
    run(bash('graphify pathological-thing'));
    run(bash('graphify explainer --all'));
    run(bash('graphify explain-it'));
    expect(readState().graphQueries).toBe(0);
  });

  it('does NOT count a non-Bash tool whose input happens to say it', () => {
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read',
      tool_input: { command: 'graphify query "x"' } });
    expect(readState().graphQueries).toBe(0);
  });

  it('carries the count across other events, the way subagents is carried', () => {
    run(bash('graphify query "x"'));
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().graphQueries).toBe(1);
    run({ hook_event_name: 'Stop' });
    expect(readState().graphQueries).toBe(1);
    run({ hook_event_name: 'SubagentStart', agent_name: 'reviewer' });
    expect(readState().graphQueries).toBe(1);
  });

  it('resets to 0 on SessionStart(startup) and SessionStart(clear)', () => {
    run(bash('graphify query "x"'));
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    expect(readState().graphQueries).toBe(0);
    run(bash('graphify query "x"'));
    run({ hook_event_name: 'SessionStart', source: 'clear' });
    expect(readState().graphQueries).toBe(0);
  });

  it('resets to 0 on a SessionStart with NO source — the same absence-permits the state arm uses (D-1248)', () => {
    // The polarity this file must not get two different answers to. The
    // SessionStart arm reads an absent `source` as the F1 startup and stamps
    // `done` (pinned by "SessionStart(startup) is done — and so is a payload
    // with no source at all"); if the counter's reset were spelled as an
    // allow-list of `startup|clear`, the SAME payload would be a new session
    // for `state` and a continuing one for `graphQueries`, and on a harness
    // that never sends `source` the count would accumulate across every
    // restart of one tmux session name — reporting previous sessions' reads
    // as this session's.
    run(bash('graphify query "x"'));
    expect(readState().graphQueries).toBe(1);
    run({ hook_event_name: 'SessionStart' });
    expect(readState().graphQueries).toBe(0);
    // …and the state arm's own answer for that payload, re-asserted here so
    // the two readings are pinned side by side, not a file apart.
    expect(readState().state).toBe('done');
  });

  it('resets to 0 on a SessionStart source this build has never heard of', () => {
    // Everything-but-resume, not an allow-list: an unknown boundary resets,
    // which loses a count rather than inventing one.
    run(bash('graphify query "x"'));
    run({ hook_event_name: 'SessionStart', source: 'teleported' });
    expect(readState().graphQueries).toBe(0);
  });

  it('is KEPT across resume and across compact — a compaction is not a new session', () => {
    run(bash('graphify query "x"'));
    run(bash('graphify path "a" "b"'));
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    expect(readState().graphQueries).toBe(2);
    // compact writes nothing at all (D-306), so the count on disk survives it
    run({ hook_event_name: 'SessionStart', source: 'compact' });
    expect(readState().graphQueries).toBe(2);
  });

  it('starts at 0 on a session that has never queried — 0 is a MEASUREMENT', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().graphQueries).toBe(0);
  });

  it('a corrupted multi-line .subagents cannot shift state or the count onto the wrong line (D-1249)', () => {
    // The three fields come back from ONE jq on THREE LINES, so the read is
    // POSITIONAL. `tostring` keeps a newline escaped only for an ARRAY; on a
    // JSON *string* it hands back the text raw, so an externally-corrupted
    // `.subagents` that is a string with a newline in it emits an extra line
    // and everything read after it lands one line late. `subs` self-heals via
    // its `[*` guard and `gq` via `^[0-9]+$`, but `state` has NO guard here —
    // it would be written straight into the file on this path. So the
    // unbounded-text field is read LAST: a shift can only corrupt `subs`,
    // which is already caught.
    fs.writeFileSync(stateFile(), JSON.stringify({
      v: 1, state: 'waiting', event: 'PreToolUse', sessionId: 'uuid-1', pid: 4242,
      updatedAt: 1784600000000, ask: null, subagents: 'evil\nline', graphQueries: 3,
    }));
    run({ hook_event_name: 'SubagentStart', agent_name: 'reviewer' });
    const s = readState();
    // Read in the wrong order these become state:'line' and graphQueries:0 —
    // the state arm's own answer overwritten by another field's overflow.
    expect(s.state).toBe('waiting');
    expect(s.graphQueries).toBe(3);
    // …and the corrupted field itself still degrades to the empty set it
    // always did, the subagent appended onto it.
    expect(s.subagents).toEqual([{ name: 'reviewer', startedAt: expect.any(Number) }]);
  });
});

// ── R1: the graph card ────────────────────────────────────────────────────
// The ONE printf to stdout in this file, and it lives inside the SessionStart
// arm. On PreToolUse a stdout JSON is a PERMISSION DECISION, so a card that
// leaked onto another event would not be noise — it would answer a question
// nobody asked.
describe('the SessionStart graph card', () => {
  /** THE CENSUS FIXTURE IS WRITTEN BY THE SWEEP'S OWN WRITER (D-1337).
   *  `_gs_row` and `_gs_finish` are lifted verbatim out of ccd/ccd-graph-sweep
   *  and run in a bash subshell against this fixture HOME, because the hook is
   *  a SECOND, hand-rolled reader of that schema (`.passes[].trees[]` carrying
   *  `path`/`outcome`/`reason`) with nothing importable to couple it to the
   *  writer — the shape D-306 is the scar from. Hand-written JSON here would
   *  let a `reason` -> `why` rename leave every suite green while the shipped
   *  card went permanently silent on the no-graph path. install-session-hooks
   *  .test.ts derives its event list from the hook's own `case` block for
   *  exactly this reason. */
  const SWEEP = path.resolve(__dirname, '../../ccd/ccd-graph-sweep');
  const liftFn = (name: string): string => {
    const src = fs.readFileSync(SWEEP, 'utf8');
    // `<name>() {` through the next line that is exactly `}` — the file's own
    // layout, and the slice is asserted below rather than assumed.
    const m = new RegExp(`^${name}\\(\\)[^\\n]*\\n[\\s\\S]*?\\n\\}$`, 'm').exec(src);
    expect(m, `ccd-graph-sweep no longer defines ${name}() — the hook's census `
      + 'reader has lost the writer it was coupled to').not.toBeNull();
    return m![0];
  };
  /** One sweep pass, appended to this HOME's census the way the sweep appends
   *  it. Call twice for two passes; the hook reads the LAST. */
  const sweepPass = (rows: { path: string; outcome: string; reason: string }[]): void => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const script = [
      'set -uo pipefail',
      'CENSUS="$HOME/.ccrc/graph-sweep.json"',
      'STARTED="2026-09-02T00:00:00Z"', 'PIN="0.9.9"', 'ROWS=()',
      liftFn('_gs_row'), liftFn('_gs_finish'),
      'while [ "$#" -gt 0 ]; do _gs_row "$1" "$2" "$3" 0; shift 3; done',
      '_gs_finish ok 0',
    ].join('\n');
    execFileSync('bash', ['-c', script, 'sweep',
      ...rows.flatMap((r) => [r.path, r.outcome, r.reason])],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  };

  it('prints a card naming the graph, its node count, its engine and the pin', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, nodes: 4242, engine: '0.9.9' });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graphify.pin'), '0.9.9\n');
    const text = card(run({ hook_event_name: 'SessionStart', source: 'startup', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text).toContain('4242 nodes');
    expect(text).toContain(first.slice(0, 8));
    expect(text).toContain('fresh');
    expect(text).toContain('engine 0.9.9');
    expect(text).toContain('pin 0.9.9');
    expect(text).toContain('graphify query');
    expect(text).toContain('graphify path');
    expect(text).toContain('graphify explain');
    expect(text, 'the card must forbid a session-side build').toContain('graphify update');
  });

  it('reads built_at_commit from the TAIL — a decoy at the head must not win', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'the head decoy was read instead of the real last key')
      .not.toContain('00000000');
    expect(text).toContain(first.slice(0, 8));
  });

  // D-1361: the row above binds `tail -c 4096` — swap it for `head -c 4096`
  // and the decoy is the only match there is. It cannot bind `| tail -n1`: its
  // 9000-byte pad puts the decoy outside the byte window, so deleting that
  // clause leaves grep with a single match and the row green. A graph.json
  // SMALLER than the window is an ordinary graph of an ordinary small tree, and
  // there the byte bound reads the whole file and the pipeline's last-match
  // clause is the only thing between the card and an earlier
  // `"built_at_commit"` in the JSON — so this is the shape that measures it.
  // The measurement only exists because the field split next to it now takes
  // the FIRST colon (`${built#*:}`); while it took the last, it answered the
  // right sha off a two-match read all by itself and `| tail -n1` was
  // undeletable-by-nothing.
  it('takes the LAST built_at_commit when the decoy is INSIDE the byte window', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, pad: 0 });
    // The fixture asserts its own premise: a pad that grew back past the
    // window would silently stop measuring the clause this test exists for.
    const size = fs.statSync(path.join(tree, 'graphify-out', 'graph.json')).size;
    expect(size, 'the fixture no longer fits inside the hook\'s 4096-byte read')
      .toBeLessThan(4096);
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'the head decoy won inside the byte window')
      .not.toContain('00000000');
    expect(text, 'the card named no sha at all — the built read resolved more '
      + 'than one match, so `| tail -n1` is doing nothing')
      .toContain(first.slice(0, 8));
  });

  it('says how far behind HEAD the graph is, in commits', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 3);
    plantGraph(tree, { built: first });
    expect(card(run({ hook_event_name: 'SessionStart', cwd: tree })))
      .toContain('2 commits behind HEAD');
  });

  // ── D-1353: ANCESTRY, not distance ──────────────────────────────────────
  //
  // `rev-list --count "$built..HEAD"` asks ONE side of the question, and
  // answers 0 for two conditions the card must not collapse: the graph was
  // built AT this HEAD, and the graph was built at a commit HEAD cannot reach
  // forward to. Only the first is fresh. `fresh` is the one word clause 12 of
  // the worker skill says licenses taking a query answer as read
  // (`worker-skill.test.ts`, `CONTRACT[11]`), so the false one does not merely
  // mislabel a card — it switches a dispatched worker's verification duty off
  // over a graph of a tree it is not on.

  it('refuses to call a graph built at a DESCENDANT of HEAD fresh', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 3);
    const tip = git(tree, 'rev-parse', 'HEAD');
    plantGraph(tree, { built: tip });
    git(tree, 'checkout', '-q', first);        // the session moves back to c0
    // The pre-fix measurement itself, so this test names the mechanism it
    // guards and not only the symptom: the one-sided count cannot tell this
    // apart from a graph built at HEAD.
    expect(git(tree, 'rev-list', '--count', `${tip}..HEAD`)).toBe('0');
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'a graph two commits of code away from this tree was announced as fresh')
      .not.toMatch(/\(fresh\)/);
    expect(text, 'the card does not say the graph is off this tree\'s history')
      .toContain('not an ancestor of HEAD');
  });

  it('refuses to call a graph built on a DIVERGED branch merely behind HEAD', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 2);
    const mainTip = git(tree, 'rev-parse', 'HEAD');
    git(tree, 'checkout', '-q', '-b', 'side', first);
    git(tree, 'commit', '-q', '--allow-empty', '-m', 'd1');
    plantGraph(tree, { built: mainTip });
    // The one-sided count reports a bare `1`, which the card spent as
    // `1 commit behind HEAD` — true of one side only. The graph also carries a
    // commit this tree has never had.
    expect(git(tree, 'rev-list', '--count', `${mainTip}..HEAD`)).toBe('1');
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'a graph off a diverged branch was reported as merely behind')
      .not.toContain('behind HEAD');
    expect(text).not.toMatch(/\(fresh\)/);
    expect(text).toContain('not an ancestor of HEAD');
  });

  // The arm the fix must NOT break. Reaching the freshness measurement at all
  // requires `tip != built`, and the legitimate way that happens is an
  // ABBREVIATED sha naming this very HEAD — the state the `0` count was right
  // about, and the only one it was right about.
  it('still reads fresh when the graph names HEAD by an ABBREVIATED sha', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 2);
    const tip = git(tree, 'rev-parse', 'HEAD');
    plantGraph(tree, { built: tip.slice(0, 12) });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'an abbreviated sha of HEAD stopped reading as fresh').toContain('(fresh)');
    expect(text).not.toContain('behind HEAD');
    expect(text).not.toContain('not an ancestor');
  });

  // ── D-1368: freshness is CONTENT, not commit identity ───────────────────
  //
  // `built != HEAD` was spent as "the graph is of another commit", which after
  // a squash merge (or any rewrite that keeps the tree) is false: HEAD's tree
  // is byte-identical to the built commit's, so the graph describes THIS tree
  // exactly. The card said `not an ancestor of HEAD` about a graph whose
  // content IS HEAD's, and `fresh` is the one word clause 12 of the worker
  // skill says licenses taking a query answer as read — so the card was
  // switching a worker's verification duty ON over a graph that needed none,
  // which costs the same trust the D-1353 direction costs, spent the other way.
  // The suffix, not a fifth state word: `fresh` stays the word both skill docs
  // harvest (D-1340/D-1342), and `— same content as HEAD` is appended only
  // when the built commit is not HEAD itself, so a reader can still tell the
  // two cases apart.

  it('calls a graph fresh when HEAD carries the built commit\'s tree byte-for-byte', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    git(tree, 'commit', '-q', '--allow-empty', '-m', 'empty');   // same tree, HEAD moved
    // the premise: one commit of distance, zero bytes of difference
    expect(git(tree, 'rev-list', '--count', `${first}..HEAD`)).toBe('1');
    expect(git(tree, 'rev-parse', `${first}^{tree}`))
      .toBe(git(tree, 'rev-parse', 'HEAD^{tree}'));
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'a graph of exactly this tree was reported as behind HEAD')
      .not.toContain('behind HEAD');
    expect(text).toMatch(/\bfresh\b/);
    expect(text, 'the card does not distinguish the same-content case from a graph built AT HEAD')
      .toContain('fresh — same content as HEAD');
  });

  it('calls a SQUASHED history fresh — same tree, and NOT an ancestor of HEAD', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    const main = git(tree, 'rev-parse', '--abbrev-ref', 'HEAD');
    git(tree, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(tree, 'w.txt'), 'w\n');
    git(tree, 'add', '-A'); git(tree, 'commit', '-q', '-m', 'work');
    const sideTip = git(tree, 'rev-parse', 'HEAD');
    git(tree, 'checkout', '-q', main);
    git(tree, 'merge', '--squash', '-q', 'side');
    git(tree, 'commit', '-q', '-m', 'squashed');
    plantGraph(tree, { built: sideTip });
    // the premise, both halves: identical trees, diverged commits. This is the
    // exact shape measured on the live fleet 2026-09-03 — built 0281e084 vs
    // HEAD 6a26a9a3, `rev-parse X^{tree}` identical for both.
    expect(git(tree, 'rev-parse', `${sideTip}^{tree}`))
      .toBe(git(tree, 'rev-parse', 'HEAD^{tree}'));
    expect(git(tree, 'rev-list', '--left-right', '--count', `${sideTip}...HEAD`))
      .toMatch(/^1\s+1$/);
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'a graph whose content IS HEAD\'s was called off this tree\'s history')
      .not.toContain('not an ancestor');
    expect(text).toContain('fresh — same content as HEAD');
  });

  it('BOTH sides unmeasurable is NOT a match — the card still says freshness unmeasured', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    const br = git(tree, 'rev-parse', '--abbrev-ref', 'HEAD');
    // A ref pointing at an object that is not there: `rev-parse HEAD` answers
    // (exit 0, the raw sha) and `HEAD^{tree}` cannot be peeled, so both sides
    // of the content comparison come back empty.
    fs.writeFileSync(path.join(tree, '.git', 'refs', 'heads', br), 'd'.repeat(40) + '\n');
    plantGraph(tree, { built: 'c'.repeat(40) });
    expect(git(tree, 'rev-parse', 'HEAD')).toBe('d'.repeat(40));
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text, 'a graph whose content could not be measured at all was announced as fresh')
      .not.toMatch(/\bfresh\b/);
    expect(text).toContain('freshness unmeasured');
  });

  it('prints NOTHING when the tree has no graph and the sweep never mentioned it', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    expect(run({ hook_event_name: 'SessionStart', cwd: tree })).toBe('');
  });

  it('prints the sweep\'s own reason when the census says why there is no graph', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    sweepPass([]);                       // an older pass that said nothing
    sweepPass([{ path: tree, outcome: 'refused-by-guard',
      reason: 'untracked paths entered the corpus: a.py b.py' }]);
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('refused-by-guard');
    expect(text).toContain('untracked paths entered the corpus');
  });

  // D-1335: the card was the one payload this file emitted with no cap, and
  // `.reason` is repo-controlled — the sweep fills it from one line of an
  // engine's stderr, or from a whole matched refusal line.
  it('clips a pathological census reason instead of injecting it whole', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    sweepPass([{ path: tree, outcome: 'failed', reason: 'x'.repeat(100_000) }]);
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('failed');
    expect(text.length, 'an unbounded repo-controlled string reached the session')
      .toBeLessThan(600);
  });

  it('is printed for compact too — compaction is when a session loses what it knew', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    // the state write stays skipped for compact (D-306); the card does not
    run({ hook_event_name: 'PreCompact' });
    const out = run({ hook_event_name: 'SessionStart', source: 'compact', cwd: tree });
    expect(card(out)).toContain('graphify-out/');
    expect(readState().event, 'the compact SessionStart wrote state after all').toBe('PreCompact');
  });

  // R5 (D-1613) made PreToolUse the ONE other event this file may print on, and
  // only for a gated call in an armed session — so the silence pinned here is
  // now the silence of the calls the gate does not touch: a shell line that is
  // not a search, a named file, an edit. The gated shapes have their own
  // describe below; what this row keeps is that nothing else ever prints.
  //
  // R6 (D-1745) took ONE row off this list: `Read` of `a.ts` in a tree with a
  // fresh graph is the nudged shape now, and it is pinned in R6's own describe.
  // What replaces it is the same call over a path the extension list does NOT
  // carry — a `Read` is still silent unless it is a source read — and `Edit` of
  // a `.ts`, which proves the nudge is scoped to the tool as well as the path.
  it('prints NOTHING on every other event, even with a graph right there', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    for (const payload of [
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: tree },
      { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.json' }, cwd: tree },
      { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.ts' }, cwd: tree },
      { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: tree },
      { hook_event_name: 'Stop', cwd: tree },
      { hook_event_name: 'UserPromptSubmit', cwd: tree },
      { hook_event_name: 'PreCompact', cwd: tree },
      { hook_event_name: 'PostCompact', trigger: 'auto', cwd: tree },
      { hook_event_name: 'SubagentStart', agent_name: 'reviewer', cwd: tree },
    ]) {
      expect(run(payload), `${payload.hook_event_name} printed on stdout`).toBe('');
    }
  });

  it('falls back to $REG/<id>.workdir when the payload carries no cwd', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.workdir'), `${tree}\n`);
    expect(card(run({ hook_event_name: 'SessionStart' }))).toContain('graphify-out/');
  });

  it('exits 0 and prints nothing when cwd does not exist', () => {
    // execFileSync THROWS on a non-zero exit, so a green run is the exit-0
    // assertion — the contract this whole file lives under.
    //
    // The census row is what makes the `[ -d "$cwd" ]` guard MEASURABLE. With
    // nothing seeded, deleting that guard is invisible: the no-graph branch is
    // taken anyway, the census read finds no file, and the card stays silent —
    // the same green. Seeded with a row FOR THIS PATH, a hook that skipped the
    // directory check would print the sweep's line about a directory that is
    // not there, and this assertion goes red.
    const gone = path.join(home, 'gone');
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-sweep.json'), JSON.stringify({
      passes: [{ started: 'x', finished: 'x', pin: '0.9.9', status: 'ok', trees: [
        { path: gone, outcome: 'never-built', reason: 'no exclude entry', duration_ms: 3 },
      ] }],
    }));
    expect(run({ hook_event_name: 'SessionStart', cwd: gone })).toBe('');
    expect(readState().state).toBe('done');
  });

  it('exits 0 and still prints a card when the tree is not a git repo', () => {
    const tree = path.join(home, 'notarepo');
    fs.mkdirSync(tree, { recursive: true });
    plantGraph(tree, { built: 'b'.repeat(40) });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text, 'freshness was claimed with no git to measure it against')
      .not.toContain('behind HEAD');
    expect(text).not.toContain('fresh');
    // …and NOT the undatable card's words either (D-1336): with no git there is
    // nothing to measure against and nothing to say, which is a different
    // silence from "a sha git refused to answer for".
    expect(text, 'the two silences collapsed into one').not.toContain('freshness');
  });

  // D-1252: the not-a-git-repo case above cannot reach the freshness CASE at
  // all — with no `tip`, the whole `[ -n "$built" ] && [ -n "$tip" ]` block is
  // skipped, so mutating `''|*[!0-9]*) fresh=""` to `fresh="fresh"` left the
  // file green. A repo that HAS a HEAD but carries a `built` sha `rev-list`
  // will not answer for is the arm's own condition, and the one that pins it:
  // an unmeasurable comparison is not a measurement, and "fresh" is precisely
  // the wrong thing to say about a graph nobody could date.
  //
  // D-1336 then took the same arm off SILENCE: a card naming a sha and saying
  // nothing about it is byte-identical to the no-git card, and the two are not
  // the same fact. The arm now says which one it is, out loud.
  it('says the graph is undatable when rev-list will not answer for the built sha (D-1252, D-1336)', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'c'.repeat(40) });   // well-formed hex, no such commit here
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('built at cccccccc');
    expect(text, 'the unmeasurable comparison was not named as one')
      .toContain('freshness unmeasured');
    expect(text, 'freshness was claimed against a sha git refused to measure')
      .not.toContain('(fresh)');
    expect(text).not.toContain('behind HEAD');
  });

  // Both tail guards were unmeasurable until this fixture existed: plantGraph
  // stamped `.graphify_engine` unconditionally, and nothing asserted the card
  // is silent about a pin. Both absences are live — an unstamped graph is legal
  // by design, and ~/.ccrc/graphify.pin exists only after `ccrc install` has
  // run on that box — and unguarded the card reads `…, engine  (pin )` (D-1334).
  it('omits engine and pin when the graph is unstamped and the box has no pin', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, engine: null });   // no .graphify_engine, no ~/.ccrc/graphify.pin
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text).toContain(first.slice(0, 8));
    expect(text, 'an empty engine clause was printed anyway').not.toContain('engine');
    expect(text, 'an empty pin clause was printed anyway').not.toContain('pin');
  });

  // ── R5's half of the card (D-1613) ──────────────────────────────────────
  // The card and the gate ask ONE measurement (`_hook_graph_measure`) and one
  // arm predicate (`_hook_gate_tree`), so what the card promises and what the
  // gate does cannot drift. A card that promised a deny that never came would
  // teach the session to stop reading the card.
  it('tells the session the gate is armed, in the trees where it IS armed', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('Search tools (Grep, Glob, shell grep/rg/find) are gated, '
      + "and source-file reads are nudged, until this session's first graph query.");
    // …and the gate itself agrees, in the same tree, on the next call.
    const out = run({ hook_event_name: 'PreToolUse', tool_name: 'Grep',
      tool_input: { pattern: 'x' }, cwd: tree });
    expect(JSON.parse(out.trim()).hookSpecificOutput.permissionDecision,
      'the card promised a gate the hook does not apply').toBe('deny');
  });

  it('says the gate is off while the operator file exists — the arm\'s own silence under it is pinned in the gate describe', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-gate-off'), '');
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('the search gate is off (operator file)');
    expect(text, 'the card announced a gate the kill-switch had already lifted')
      .not.toContain('are gated until');
  });

  it('says nothing about the gate for a tree the gate will not gate', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 12);          // 11 commits past the graph
    plantGraph(tree, { built: first });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('11 commits behind HEAD');
    expect(text, 'a stale tree was told about a gate that will never fire')
      .not.toContain('gate');
    expect(text).not.toContain('are gated until');
  });

  it('omits the node count rather than inventing one when GRAPH_REPORT.md is absent', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, report: false });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text).not.toContain('nodes');
  });
});

// ── R5: the PreToolUse search gate (D-1613) ───────────────────────────────
// The spec's first R5 section DECLINED this gate; the operator's ruling on the
// R4 reading — 4 graph queries fleet-wide in the two days after the read side
// deployed, 10 of 18 live sessions at `graphQueries` 0 — reversed it. What the
// card and clause 12 could not move, a deny does.
//
// On PreToolUse a stdout JSON is a PERMISSION DECISION, so this is the one arm
// in the file allowed to print there, and only for a GATED call in an ARMED
// session. Every other event's silence is pinned in the card describe above,
// and the non-gated PreToolUse calls are pinned here beside it.
describe('the PreToolUse search gate (R5, D-1613)', () => {
  const bashPre = (command: string, cwd: string): object => pre('Bash', { command }, cwd);
  const grepPre = (cwd: string): object => pre('Grep', { pattern: 'assembleFleet' }, cwd);
  /** The deny envelope on stdout: the module's one-line reader, under the name
   *  this describe reads it by. */
  const deny = oneLine;
  /** The spec's reason, spelled here so a drift in either direction is red. */
  const reasonFor = (nodes: number, fresh: string, k: number): string =>
    `graphify gate: this tree has a knowledge graph (${nodes} nodes, ${fresh}) and this session `
    + 'has not queried it yet. Search tools open after one graph query — run: '
    + '`graphify query "<your question in plain words>"` (`graphify path "<A>" "<B>"` for a '
    + 'relationship, `graphify explain "<concept>"` for one concept). '
    + `Denial ${k} of 3; after 3 the gate opens anyway.`;

  it('denies the first Grep in a fresh-graph tree, with the whole envelope byte-exact', () => {
    const tree = gatedTree();
    const j = deny(run(grepPre(tree)));
    expect(j).toEqual({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: reasonFor(NODES, 'fresh', 1) } });
    // …and the three things the reason has to CARRY, named one by one, so a
    // rewording that keeps the shape and loses the content is still red.
    const reason = String(j.hookSpecificOutput.permissionDecisionReason);
    expect(reason, 'the reason does not say how big the graph is').toContain('4242 nodes');
    expect(reason, 'the reason does not say how fresh the graph is').toContain('fresh');
    expect(reason, 'the reason does not say the gate is bounded').toContain('Denial 1 of 3');
    // The denial is COUNTED, in the state file the hook was already writing.
    expect(readState().graphGateDenials).toBe(1);
    expect(readState().state, 'the deny path skipped the state write').toBe('working');
  });

  it('is silent once the session has run one graphify query — the gate opens on the READ', () => {
    const tree = gatedTree();
    run(query(tree));
    expect(readState().graphQueries).toBe(1);
    expect(run(grepPre(tree)), 'a session that queried the graph was gated anyway').toBe('');
    expect(readState().graphGateDenials).toBe(0);
  });

  it('is silent in a tree with no graph at all', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    expect(run(grepPre(tree))).toBe('');
  });

  it('gates at 10 commits behind HEAD and is silent at 11', () => {
    const ten = gatedTree(11);                 // graph built at c0, HEAD at c10
    const j = deny(run(grepPre(ten)));
    expect(String(j.hookSpecificOutput.permissionDecisionReason))
      .toBe(reasonFor(NODES, '10 commits behind HEAD', 1));
    fs.rmSync(ten, { recursive: true, force: true });
    const eleven = gatedTree(12);
    expect(run(grepPre(eleven)), 'a graph 11 commits stale gated a search anyway').toBe('');
  });

  it('is silent while the operator kill-switch file exists', () => {
    const tree = gatedTree();
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-gate-off'), '');
    expect(run(grepPre(tree))).toBe('');
    fs.rmSync(path.join(home, '.ccrc', 'graph-gate-off'));
    expect(deny(run(grepPre(tree))).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  // A search at the HEAD of the line is a codebase question. A search at the
  // tail of a pipeline is filtering something this session already produced,
  // and gating it would be the gate answering a question nobody asked.
  it('denies a Bash line that HEADS with a search, and only that', () => {
    const tree = gatedTree();
    for (const cmd of ['grep -rn x src', 'rg x', 'FOO=1 rg x', 'cd a && find . -name y',
      'cd a; rg x', 'git grep x', 'egrep x f', 'fgrep x f', 'ugrep x f', 'ag x', 'ack x',
      'fd -e ts']) {
      const j = deny(run(bashPre(cmd, tree)));
      expect(j.hookSpecificOutput.permissionDecision, `${cmd} was not gated`).toBe('deny');
      // Undo the denial this probe just counted, so twelve probes do not walk
      // into the bound the next assertions depend on.
      fs.rmSync(stateFile());
    }
    for (const cmd of ['vitest run | grep Tests', 'graphify query "x"', 'ls', 'echo find',
      'git status', 'cat f | ag x', 'grepper x', 'findutils --help', 'echo hi && grep x']) {
      expect(run(bashPre(cmd, tree)), `${cmd} was gated`).toBe('');
    }
  });

  it('gates Glob, and never Read or Edit — a named file is not a question', () => {
    const tree = gatedTree();
    expect(deny(run(pre('Glob', { pattern: '**/*.ts' }, tree)))
      .hookSpecificOutput.permissionDecision).toBe('deny');
    fs.rmSync(stateFile());
    // R6 (D-1745): `.txt` IS on the nudge list, so the file this row used to
    // read is now a nudged read — the silence this row is about is the GATE's,
    // and it is measured over a path neither mechanism speaks about. That a
    // `Read` is never DENIED, in any state including the nudged one, is R6's
    // own row; `Edit` is silent even over a `.ts`, which is this file's only
    // assertion that the nudge is scoped to the tool.
    expect(run(pre('Read', { file_path: `${tree}/c0.bin` }, tree))).toBe('');
    expect(run(pre('Edit', { file_path: `${tree}/c0.ts` }, tree))).toBe('');
  });

  // Ground 2 of the decline, answered by a bound rather than by a promise: a
  // session that cannot run Bash at all gets through on its fourth search.
  it('opens after 3 denials, and the count stops there', () => {
    const tree = gatedTree();
    for (const k of [1, 2, 3]) {
      const j = deny(run(grepPre(tree)));
      expect(String(j.hookSpecificOutput.permissionDecisionReason)).toContain(`Denial ${k} of 3`);
      expect(readState().graphGateDenials).toBe(k);
    }
    expect(run(grepPre(tree)), 'the gate denied a fourth search — the bound is not bounding').toBe('');
    expect(readState().graphGateDenials, 'the bound was passed and the counter kept climbing').toBe(3);
    // AND THE SAME BOUND FOR A SHELL SEARCH (D-1797). The R6 refactor moved the
    // bound out of the arm's outer predicate into a `bounded` flag consulted
    // in more than one place, and the review measured the `Bash` copy pinned
    // by nothing: dropping it left the suite green while a session that
    // searches only through the shell would have read "Denial 4 of 3". The
    // bound is decided at ONE site again, and this row is what keeps it there.
    expect(run(bashPre('rg assembleFleet src', tree)),
      'a shell search past the bound was denied — the Bash arm has its own bound')
      .toBe('');
    expect(readState().graphGateDenials).toBe(3);
  });

  it('carries the denial count across other events, and a non-gated call leaves it alone', () => {
    const tree = gatedTree();
    run(grepPre(tree));
    expect(readState().graphGateDenials).toBe(1);
    run({ hook_event_name: 'UserPromptSubmit', cwd: tree });
    expect(readState().graphGateDenials).toBe(1);
    run(bashPre('ls', tree));
    expect(readState().graphGateDenials).toBe(1);
    run({ hook_event_name: 'Stop', cwd: tree });
    expect(readState().graphGateDenials).toBe(1);
  });

  it('resets both counters on a SessionStart that is not a resume, and keeps them on one', () => {
    const tree = gatedTree();
    run(grepPre(tree)); run(grepPre(tree));
    run(query(tree)); run(query(tree));
    expect(readState()).toMatchObject({ graphQueries: 2, graphGateDenials: 2 });
    run({ hook_event_name: 'SessionStart', source: 'resume', cwd: tree });
    expect(readState(), 'a resume is the SAME session — it re-armed the gate')
      .toMatchObject({ graphQueries: 2, graphGateDenials: 2 });
    run({ hook_event_name: 'SessionStart', source: 'clear', cwd: tree });
    expect(readState(), '/clear did not re-arm the gate')
      .toMatchObject({ graphQueries: 0, graphGateDenials: 0 });
    run(grepPre(tree)); run(grepPre(tree));
    run({ hook_event_name: 'SessionStart', source: 'startup', cwd: tree });
    expect(readState()).toMatchObject({ graphQueries: 0, graphGateDenials: 0 });
  });

  // FAIL-OPEN, ground 2 of the decline. A hook that can wedge a turn is worse
  // than no hook, so every read that will not answer prints NOTHING — and the
  // state write, which is this file's whole job, happens anyway.
  it('is silent when the hookstate exists and will not parse — an UNKNOWN count is not a zero', () => {
    const tree = gatedTree();
    fs.writeFileSync(stateFile(), '{nope');
    expect(run(grepPre(tree)), 'the gate denied on a count it could not read').toBe('');
    expect(readState().state, 'the corrupt file cost the state write too').toBe('working');
  });

  it.skipIf(process.getuid?.() === 0)(
    'says a denial only once it is COUNTED — an unwritable registry means no deny at all (D-1689)', () => {
    // The dual of "counted only if it was said". A deny that goes out before
    // the hookstate lands is a denial the next event cannot see: with the
    // registry unwritable every search reads "Denial 1 of 3" forever, and the
    // documented escape — one graphify query — is lost by the same failed
    // write, so the bound of 3 is a promise the hook cannot keep. Measured on
    // the branch before this test: four searches, four denials, all "1 of 3".
    // The reorder this pins is one line — the envelope is built in the arm
    // and PRINTED only after the rename lands — and the mutation is putting it
    // back where it was. Root writes through 0500, so root skips this.
    const tree = gatedTree();
    const reg = path.join(home, '.cc-sessions');
    fs.chmodSync(reg, 0o500);
    try {
      expect(run(grepPre(tree)), 'the hook denied a search it could not count').toBe('');
      expect(fs.existsSync(stateFile()), 'nothing could be written, so nothing should exist').toBe(false);
    } finally {
      fs.chmodSync(reg, 0o700);
    }
    // And once the registry writes again the first denial IS the first: the
    // one that could not be counted was never said, so it is never charged.
    const j = deny(run(grepPre(tree)));
    expect(j.hookSpecificOutput.permissionDecisionReason).toBe(reasonFor(NODES, 'fresh', 1));
    expect(readState().graphGateDenials).toBe(1);
  });

  it('is silent when cwd is not a directory, and when the graph carries no stamp', () => {
    const notADir = path.join(home, 'afile');
    fs.writeFileSync(notADir, 'x\n');
    expect(run(grepPre(notADir))).toBe('');
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    fs.mkdirSync(path.join(tree, 'graphify-out'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'graphify-out', 'graph.json'), '{"hyperedges": []}\n');
    expect(run(grepPre(tree)), 'a graph nobody could date gated a search').toBe('');
    expect(readState().state).toBe('working');
  });

  it('is silent when the payload names no tree at all', () => {
    gatedTree();
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' } }))
      .toBe('');
  });
});

// ── R6: the PreToolUse Read nudge (D-1745) ────────────────────────────────
// The gate (R5) fires on the question-shaped calls and leaves `Read` alone,
// because a named file is not a question — and a session can therefore
// navigate file by file and never meet the gate at all. Measured against what
// graphify itself ships (D-1746), that hole is the whole of the read side's
// reach: graphify's own project hooks nudge on `Read`, and 330 of the 345
// queries in the week before the read side shipped came from the seven
// projects where someone had run its installer.
//
// The operator's ruling closes it as a NUDGE, not a deny: `Edit` requires a
// prior `Read`, so denying a `Read` would charge every session told to fix a
// named file one denial before its first edit. So this describe's load-bearing
// row is the one that says a `Read` is NEVER denied, in any state.
describe('the PreToolUse Read nudge (R6, D-1745)', () => {
  const readPre = (file: string, cwd: string): object => pre('Read', { file_path: file }, cwd);

  /** The spec's nudge, spelled here so a drift in either direction is red. The
   *  node clause is omitted when the count could not be measured, exactly as
   *  the deny's is. */
  const nudgeFor = (nodes: number | null, fresh: string): string =>
    'graphify: this tree has a knowledge graph ('
    + (nodes === null ? '' : `${nodes} nodes, `)
    + `${fresh}) and this session has not queried it yet. `
    + 'Before reading files to orient, run: `graphify query "<your question in plain words>"` '
    + '(`graphify explain "<concept>"` for one concept). '
    + 'Reading a named file to edit it needs no query.';

  it('nudges the first source Read in a fresh-graph tree, with the whole envelope byte-exact', () => {
    const tree = gatedTree();
    const j = oneLine(run(readPre(`${tree}/src/a.ts`, tree)));
    expect(j).toEqual({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', additionalContext: nudgeFor(NODES, 'fresh') } });
    // THE KEY THAT MUST NOT BE THERE. `toEqual` above already says the object
    // has no other key, but it says it as a shape mismatch; this says WHICH
    // key, because a `Read` denied instead of nudged is the one failure mode
    // the ruling exists to prevent.
    expect('permissionDecision' in j.hookSpecificOutput,
      'the nudge carries a permission decision — a Read was DENIED').toBe(false);
    // …and it spends nothing: the nudge is advice, not a denial.
    expect(readState().graphGateDenials, 'the nudge charged the gate a denial').toBe(0);
    expect(readState().state, 'the nudge path skipped the state write').toBe('working');
  });

  it("nudges an upper-case extension too — graphify's own read hook lowercases before it matches (D-1797)", () => {
    // `hook-guard read` lowercases the path before testing the extension, so
    // `A.TS` is nudged by graphify's project hook. The list here is graphify's
    // own; the match has to be too, or the two halves disagree on one file.
    const tree = gatedTree();
    const j = oneLine(run(readPre(`${tree}/SRC/A.TS`, tree)));
    expect(j.hookSpecificOutput.additionalContext).toBe(nudgeFor(NODES, 'fresh'));
  });

  it('is not bounded and not counted — the fourth source Read is nudged too', () => {
    const tree = gatedTree();
    for (let i = 0; i < 4; i++) {
      expect(oneLine(run(readPre(`${tree}/src/a${i}.ts`, tree))).hookSpecificOutput.additionalContext,
        `read ${i + 1} was not nudged`).toBe(nudgeFor(NODES, 'fresh'));
      expect(readState().graphGateDenials, 'the nudge spent a denial').toBe(0);
    }
  });

  it('is silent once the session has run one graphify query', () => {
    const tree = gatedTree();
    run(query(tree));
    expect(readState().graphQueries).toBe(1);
    expect(run(readPre(`${tree}/src/a.ts`, tree)),
      'a session that queried the graph was nudged anyway').toBe('');
  });

  it('is silent for a read UNDER graphify-out/, at any depth — the card sends the session there', () => {
    const tree = gatedTree();
    for (const f of [`${tree}/graphify-out/GRAPH_REPORT.md`,
      `${tree}/sub/graphify-out/GRAPH_REPORT.md`, 'graphify-out/GRAPH_REPORT.md']) {
      expect(run(readPre(f, tree)), `${f} was nudged`).toBe('');
    }
  });

  it('matches the final segment only, anchored at its end', () => {
    const tree = gatedTree();
    // `.json` must never match `.js`; `a.js.map` ends in `.map`; a directory
    // component that looks like a source file is not what is being read; and a
    // final segment with no dot at all has no extension to match.
    for (const f of [`${tree}/package.json`, `${tree}/a.js.map`, `${tree}/dist.ts/README`,
      `${tree}/Makefile`, `${tree}/notes.txtual`]) {
      expect(run(readPre(f, tree)), `${f} was nudged`).toBe('');
    }
    // …and the silence above is not the silence of a nudge that never fires.
    for (const f of [`${tree}/doc.md`, `${tree}/x.py`, `${tree}/app.tsx`, `${tree}/main.rs`]) {
      expect(oneLine(run(readPre(f, tree))).hookSpecificOutput.additionalContext,
        `${f} was not nudged`).toBe(nudgeFor(NODES, 'fresh'));
    }
  });

  it('is silent while the operator kill-switch file exists', () => {
    const tree = gatedTree();
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-gate-off'), '');
    expect(run(readPre(`${tree}/src/a.ts`, tree))).toBe('');
    fs.rmSync(path.join(home, '.ccrc', 'graph-gate-off'));
    expect(oneLine(run(readPre(`${tree}/src/a.ts`, tree))).hookSpecificOutput.additionalContext)
      .toBe(nudgeFor(NODES, 'fresh'));
  });

  it('nudges at 10 commits behind HEAD and is silent at 11 — the gate\'s own freshness bound', () => {
    const ten = gatedTree(11);                 // graph built at c0, HEAD at c10
    expect(oneLine(run(readPre(`${ten}/src/a.ts`, ten))).hookSpecificOutput.additionalContext)
      .toBe(nudgeFor(NODES, '10 commits behind HEAD'));
    fs.rmSync(ten, { recursive: true, force: true });
    const eleven = gatedTree(12);
    expect(run(readPre(`${eleven}/src/a.ts`, eleven)),
      'a graph 11 commits stale nudged a read anyway').toBe('');
  });

  it('is silent in a tree with no graph at all', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    expect(run(readPre(`${tree}/src/a.ts`, tree))).toBe('');
  });

  // THE RULING ITSELF, as a mechanism. `Edit` requires a prior `Read`, so a
  // denied `Read` would charge every session told to fix a named file one
  // denial before its first edit — this loops every state the gate can be in
  // and asserts no `Read` output ever carries a permission decision.
  it('never DENIES a Read, in any state the gate can be in', () => {
    const states: Array<[string, () => string]> = [
      ['armed', () => gatedTree()],
      ['stale', () => gatedTree(12)],
      ['queried', () => { const t = gatedTree(); run(query(t)); return t; }],
      ['kill-switch', () => {
        const t = gatedTree();
        fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
        fs.writeFileSync(path.join(home, '.ccrc', 'graph-gate-off'), '');
        return t;
      }],
      ['gate bound spent', () => {
        const t = gatedTree();
        run(pre('Grep', { pattern: 'x' }, t)); run(pre('Grep', { pattern: 'x' }, t));
        run(pre('Grep', { pattern: 'x' }, t));
        expect(readState().graphGateDenials).toBe(3);
        return t;
      }],
    ];
    for (const [name, build] of states) {
      const tree = build();
      for (const f of [`${tree}/src/a.ts`, `${tree}/package.json`,
        `${tree}/graphify-out/GRAPH_REPORT.md`]) {
        const out = run(readPre(f, tree));
        expect(out, `${name}: a Read printed more than one line`)
          .not.toMatch(/\n[^\n]*\n/);
        if (out.trim() !== '') {
          expect(JSON.parse(out.trim()).hookSpecificOutput,
            `${name}: a Read of ${f} was denied`).not.toHaveProperty('permissionDecision');
        }
      }
      fs.rmSync(tree, { recursive: true, force: true });
      fs.rmSync(stateFile(), { force: true });
      fs.rmSync(path.join(home, '.ccrc', 'graph-gate-off'), { force: true });
    }
  });

  // AT MOST ONE LINE PER EVENT, and which one is decided by the call: a
  // `Grep` is denied and never nudged, a `Read` is nudged and never denied.
  it('denies a Grep in the same tree and does not nudge it — exactly one line', () => {
    const tree = gatedTree();
    const out = run(pre('Grep', { pattern: 'x' }, tree));
    const j = oneLine(out);
    expect(j.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(j.hookSpecificOutput, 'a gated call carried the nudge as well')
      .not.toHaveProperty('additionalContext');
    expect(out.trim().split('\n'), 'the hook printed a deny AND a nudge').toHaveLength(1);
  });

  // FAIL-OPEN, the same contract the gate lives under: a hook that can wedge a
  // turn is worse than no hook, so every read that will not answer prints
  // nothing — and the state write, which is this file's whole job, happens anyway.
  it('is silent when the hookstate exists and will not parse — an UNKNOWN count is not a zero', () => {
    const tree = gatedTree();
    fs.writeFileSync(stateFile(), '{nope');
    expect(run(readPre(`${tree}/src/a.ts`, tree)),
      'the nudge fired on a count it could not read').toBe('');
    expect(readState().state, 'the corrupt file cost the state write too').toBe('working');
  });

  it('is silent when the payload names no tree at all', () => {
    gatedTree();
    expect(run({ hook_event_name: 'PreToolUse', tool_name: 'Read',
      tool_input: { file_path: 'src/a.ts' } })).toBe('');
  });

  it.skipIf(process.getuid?.() === 0)(
    'says nothing at all when the registry cannot be written (D-1689\'s ordering)', () => {
    // The nudge rides the deny's own print site, which is AFTER the hookstate
    // rename lands. Nothing about a nudge needs counting, but the print site is
    // shared, so a nudge printed from inside the arm would be a nudge printed
    // on a run whose state write failed — and, worse, would put the print back
    // where D-1689 measured the gate's bound breaking. Root writes through
    // 0500, so root skips this.
    const tree = gatedTree();
    const reg = path.join(home, '.cc-sessions');
    fs.chmodSync(reg, 0o500);
    try {
      expect(run(readPre(`${tree}/src/a.ts`, tree)),
        'the hook nudged on a run it could not record').toBe('');
      expect(fs.existsSync(stateFile()), 'nothing could be written, so nothing should exist').toBe(false);
    } finally {
      fs.chmodSync(reg, 0o700);
    }
    expect(oneLine(run(readPre(`${tree}/src/a.ts`, tree))).hookSpecificOutput.additionalContext)
      .toBe(nudgeFor(NODES, 'fresh'));
  });

  it('omits the node clause rather than inventing one when GRAPH_REPORT.md is absent', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, report: false });
    expect(oneLine(run(readPre(`${tree}/src/a.ts`, tree))).hookSpecificOutput.additionalContext)
      .toBe(nudgeFor(null, 'fresh'));
  });

  // ── The extension list, HARVESTED not retyped (the D-1363 idiom) ─────────
  // The hook spells the list ONCE, and this reads it back out of the hook's own
  // assignment: a list retyped in the suite is a list that can agree with itself
  // while disagreeing with graphify, which is the one thing this pin is for.
  it('carries exactly graphify 0.9.9\'s own source and doc extensions', () => {
    const hook = fs.readFileSync(HOOK, 'utf8');
    const m = hook.match(/^GRAPH_NUDGE_READ_RE='\\\.\(([^)]+)\)\$'/m);
    if (!m) throw new Error('ccd/session-hook.sh no longer assigns GRAPH_NUDGE_READ_RE as an '
      + 'end-anchored dotted alternation — the nudge\'s extension list has to be re-derived '
      + 'against the hook\'s new spelling, not pinned against the old one');
    // PROVENANCE: graphify 0.9.9, `graphify/__main__.py`, `_HOOK_SOURCE_EXTS`
    // — the tuple its own `Read|Glob` project hook nudges on, read off the
    // installed 0.9.9 venv on 2026-09-06 and copied here in its own order.
    expect(m[1]!.split('|')).toEqual([
      'py', 'js', 'ts', 'tsx', 'jsx', 'astro', 'vue', 'svelte', 'go',
      'rs', 'java', 'rb', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'kt',
      'swift', 'php', 'scala', 'lua', 'sh', 'md', 'rst', 'txt', 'mdx',
    ]);
  });
});

describe('the emitter: one line, clipped once', () => {
  it('clips the assembled card at the emitter, on every arm', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text.length).toBeLessThanOrEqual(1800);
  });

  it('a pathological hold cannot delete the card', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hold'),
      `program:${'x'.repeat(200_000)} wave:1/2 run:9`);
    const out = run({ hook_event_name: 'SessionStart', cwd: tree });
    const text = card(out);            // card() asserts exactly one line
    expect(text.length).toBeLessThanOrEqual(1800);
    expect(text).toContain('graphify:');
  });

  // THE FIELD THAT ACTUALLY OVERFLOWS. The hold subject cannot: _ct_read caps
  // every registry read at CCRC_ID_MAX (128) before CCRC_HOLD_MAX is even
  // consulted, so a pathological .hold can never grow CARD_HOLD past a few
  // hundred bytes (see 'a pathological hold cannot delete the card' above).
  // GM_NODES carries no such bound — `grep -oE '[0-9]+ nodes' | head -c 4096`
  // is UNBOUNDED repetition inside a 4096-byte window, and the digits are
  // interpolated straight into the graphify sentence. A GRAPH_REPORT.md whose
  // node count is a few thousand digits — still comfortably inside the
  // 4096-byte head, so it is captured WHOLE, not truncated — drives the
  // assembled card well past CARD_MAX_CHARS on its own. This is the fixture
  // that finally discharges Task 3's deferred clip mutation.
  it('a pathological node count cannot delete the card', () => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee', report: false });
    fs.writeFileSync(path.join(tree, 'graphify-out', 'GRAPH_REPORT.md'),
      `# Graph Report - demo  (2026-09-02)\n\n## Summary\n`
      + `- ${'9'.repeat(3000)} nodes · 15645 edges · 423 communities\n`);
    const out = run({ hook_event_name: 'SessionStart', cwd: tree });
    const text = card(out);            // card() asserts exactly one JSON line
    expect(text.length).toBe(1800);    // clipped EXACTLY, not merely bounded
  });
});

// `spawnSync` joins the file's existing `execFileSync` import — the stderr
// assertion below needs a result object on a ZERO exit, which execFileSync
// does not give.
describe('the co-tenant subject', () => {
  const REG = (): string => path.join(home, '.cc-sessions');
  /** Plant a peer row: `.uuid` (the id enumeration), `.project`, `.supervised`. */
  const peer = (id: string, project: string | null, ageS: number | null): void => {
    fs.writeFileSync(path.join(REG(), `${id}.uuid`), `uuid-${id}`);
    if (project !== null) fs.writeFileSync(path.join(REG(), `${id}.project`), project);
    if (ageS !== null) {
      fs.writeFileSync(path.join(REG(), `${id}.supervised`),
        String(Math.floor(Date.now() / 1000) - ageS));
    }
  };
  const plain = (): string => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    return card(run({ hook_event_name: 'SessionStart', cwd: tree }));
  };

  it('counts supervised rows naming the same project, and names the route', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    peer('p2', 'alpha', 5);
    peer('p3', 'beta', 5);
    const text = plain();
    expect(text).toContain('ccrc: 2 other supervised rows name project `alpha`');
    expect(text).toContain('ccrc-api peers list --of demo-quiet-basin');
    expect(text).toContain('the five peer rules');
  });

  it('says nothing at all when this row is alone in its project', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p3', 'beta', 5);
    expect(plain()).not.toContain('ccrc:');
  });

  it('uses the singular at one co-tenant', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    expect(plain()).toContain('ccrc: 1 other supervised row names project `alpha`');
  });

  it('counts an archived row whose supervisor is still beating — the archive stamp decides nothing (D9)', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('ghost', 'alpha', 5);
    fs.writeFileSync(path.join(REG(), 'ghost.archived'), 'archived=1 reason=merged:#160');
    expect(plain()).toContain('ccrc: 1 other supervised row names project `alpha`');
  });

  it('does not count a row whose heartbeat has stopped', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('stale', 'alpha', 5000);
    expect(plain()).not.toContain('ccrc:');
  });

  it('a trailing space in .project groups exactly as the server does', () => {
    peer('demo-quiet-basin', 'alpha ', 5);
    peer('p1', 'alpha', 5);
    expect(plain()).toContain('ccrc: 1 other supervised row names project `alpha`');
  });

  // `spawnSync`, not `run`/`execFileSync`: this test's whole point is the
  // STDERR channel, and only spawnSync hands it back on a zero exit. A bare
  // `$(<f)` on a mode-000 file writes "Permission denied" to the hook's real
  // stderr, which the harness folds into a user-visible warning on EVERY
  // SessionStart of EVERY co-tenant session.
  it('an unreadable peer .project costs no stderr and is reported, never folded into absence', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    peer('p2', 'alpha', 5);
    fs.chmodSync(path.join(REG(), 'p2.project'), 0o000);
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: tree }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home,
        PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242' },
    });
    expect(r.status, 'the hook must exit 0 on every path').toBe(0);
    expect(r.stderr, 'the hook leaked stderr the harness will surface').toBe('');
    expect(card(r.stdout))
      .toContain('ccrc: at least 1 other supervised row names project `alpha`');
  });

  it('a directory at a registry path is not read', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    fs.mkdirSync(path.join(REG(), 'p2.project'), { recursive: true });
    fs.writeFileSync(path.join(REG(), 'p2.uuid'), 'uuid-p2');
    expect(plain()).toContain('at least 1 other supervised row names project `alpha`');
  });

  it('never claims liveness or shared files, and always names the route that can', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    const text = plain();
    expect(text).not.toMatch(/\blive\b|\bsessions? share\b|\bsharing\b/i);
    expect(text).toContain('supervised row names project');
    expect(text).toContain('peers list --of');
  });

  it('survives a tree graphify says nothing about', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    const out = run({ hook_event_name: 'SessionStart', cwd: path.join(home, 'nograph') });
    const text = card(out);
    expect(text).toContain('ccrc:');
    expect(text).not.toContain('graphify:');
  });

  it('the operator file silences the subject and nothing else', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    const text = plain();
    expect(text).not.toContain('ccrc:');
    expect(text).toContain('graphify:');
  });

  it('emits exactly one parseable line when both subjects fire', () => {
    peer('demo-quiet-basin', 'alpha', 5);
    peer('p1', 'alpha', 5);
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.hold'),
      'program:account-pools wave:3/6 run:34');
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    const out = run({ hook_event_name: 'SessionStart', cwd: tree });
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(out.trim())).not.toThrow();
  });

  // CCRC_FRESH_S is a THIRD copy of SUPERVISED_FRESH_MS and
  // single-definition.test.ts's roots are shared, server/src, pwa/src and
  // agent/src — it does not scan ccd/, so nothing else would catch the drift.
  // The local copy follows this file's own precedent (_hook_epoch_ms is a
  // deliberate local copy of ccd's _plat_epoch_ms with a test pinning the two
  // bodies identical), because the hook is installed alone into ~/.cc-sessions
  // and can source nothing.
  it('the hook, ccd and shared agree on the supervised-freshness window', () => {
    const hook = fs.readFileSync(path.resolve(__dirname, '../../ccd/session-hook.sh'), 'utf8');
    const ccd = fs.readFileSync(CCD, 'utf8');
    const api = fs.readFileSync(path.resolve(__dirname, '../../shared/api.ts'), 'utf8');
    const h = /CCRC_FRESH_S=(\d+)/.exec(hook);
    const c = /now - sup >= 0 && now - sup < (\d+)/.exec(ccd);
    const s = /SUPERVISED_FRESH_MS\s*=\s*([\d_]+)/.exec(api);
    expect(h, 'CCRC_FRESH_S not found in the hook').not.toBeNull();
    expect(c, "ccd's supervised-freshness comparison not found").not.toBeNull();
    expect(s, 'SUPERVISED_FRESH_MS not found in shared/api.ts').not.toBeNull();
    expect(Number(h![1]) * 1000, 'the hook and shared disagree on the window')
      .toBe(Number(s![1]!.replace(/_/g, '')));
    expect(Number(c![1]), 'ccd and the hook disagree on the window').toBe(Number(h![1]));
  });

  // ── Fix round 1: the seven review findings against d391f305 ────────────
  // Findings 1 and 2 share one fix (`CT_V=$(<"$1")` → bounded `read -N`);
  // finding 3 is the gap that let five branches ship with no red-on-mutation
  // test at all — this describe closes both, plus finding 5's own leading-
  // zero stderr leak. Findings 4, 6 and 7 were comment-only corrections with
  // no behaviour to pin, so they carry no new test here.
  describe('fix round 1 — reviewed edges', () => {
    /** The stderr-sensitive shape, factored out: two tests below need the
     *  spawnSync result object, not just stdout, the same reason the
     *  existing "unreadable peer .project" test above does. */
    const runRaw = (payload: object) => spawnSync('bash', [HOOK], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, HOME: home,
        PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242' },
    });

    // Finding 1: `CT_V=$(<"$1")` writes bash's "ignored null byte in input"
    // warning to real stderr on a NUL-containing `.project` — reproduced by
    // the reviewer, and exactly the leak the pre-existing "costs no stderr"
    // test exists to prevent for the readability case.
    it('a NUL byte in a peer .project costs no stderr (finding 1)', () => {
      peer('demo-quiet-basin', 'alpha', 5);
      fs.writeFileSync(path.join(REG(), 'p1.uuid'), 'uuid-p1');
      fs.writeFileSync(path.join(REG(), 'p1.project'), Buffer.from('al\0pha'));
      fs.writeFileSync(path.join(REG(), 'p1.supervised'),
        String(Math.floor(Date.now() / 1000) - 5));
      const tree = path.join(home, 'tree');
      gitTree(tree, 1);
      plantGraph(tree, { built: 'deadbee' });
      const r = runRaw({ hook_event_name: 'SessionStart', cwd: tree });
      expect(r.status, 'the hook must exit 0 on every path').toBe(0);
      expect(r.stderr, 'a NUL byte in a peer .project leaked a bash warning').toBe('');
    });

    // Finding 2 (shared fix with 1): the read was unbounded, so one 2 MB
    // `.project` took the probe from 5 ms to 759 ms (reviewer's measurement)
    // and one 8 MB file to 3.3 s. The fix bounds the read to CCRC_ID_MAX
    // (128), not CCRC_PROJ_MAX (64) — reading exactly CCRC_PROJ_MAX would
    // TRUNCATE an over-long value to precisely the bound and let it PASS the
    // length gate as if it had always been that short. This plants a project
    // value past BOTH bounds (150 > 128 > 64) so a value that is genuinely
    // too long is still refused after truncation, not silently accepted.
    it('a project value longer than the read bound is refused, not truncated into a passing one (finding 2)', () => {
      const longProj = 'a'.repeat(150);
      peer('demo-quiet-basin', longProj, 5);
      peer('p1', longProj, 5);
      expect(plain(), 'a 150-char self project slipped past the length gate').not.toContain('ccrc:');
    });

    // Finding 3, branch: the ID_MAX length gate. Nothing in the suite ever
    // planted an over-long peer id before this.
    it('a peer id longer than CCRC_ID_MAX is excluded before its project is even read (finding 3)', () => {
      peer('demo-quiet-basin', 'alpha', 5);
      peer('p1', 'alpha', 5);
      const longId = 'q'.repeat(130);
      peer(longId, 'alpha', 5);
      const text = plain();
      expect(text).toContain('ccrc: 1 other supervised row names project `alpha`');
      expect(text, 'the over-long id was counted anyway').not.toContain('2 other');
    });

    // Finding 3, branch: supervised ABSENT. This is the exact distinction the
    // comment above `_ct_read "$REG/$o.supervised"` argues for — folding
    // absence into doubt would put "at least" on every card forever — and
    // nothing in the suite ever planted a peer with no `.supervised` at all
    // alongside a counted peer to observe the difference.
    it('a peer with no .supervised at all is skipped outright, never folded into "at least" (finding 3)', () => {
      peer('demo-quiet-basin', 'alpha', 5);
      peer('p1', 'alpha', 5);
      peer('p2', 'alpha', null);
      const text = plain();
      expect(text).toContain('ccrc: 1 other supervised row names project `alpha`');
      expect(text, 'an absent heartbeat was folded into uncertainty').not.toContain('at least');
    });

    // Finding 3, branch: supervised UNMEASURABLE (unreadable, distinct from
    // absent). Nothing in the suite ever chmod'd a peer's `.supervised`.
    it('a peer whose .supervised is unreadable counts toward "at least" (finding 3)', () => {
      peer('demo-quiet-basin', 'alpha', 5);
      peer('p1', 'alpha', 5);
      peer('p2', 'alpha', 5);
      fs.chmodSync(path.join(REG(), 'p2.supervised'), 0o000);
      const text = plain();
      expect(text).toContain('ccrc: at least 1 other supervised row names project `alpha`');
    });

    // Finding 3, branch: supervised NON-NUMERIC (distinct from absent and
    // unmeasurable). Nothing in the suite ever planted a non-numeric
    // `.supervised`.
    it('a peer whose .supervised is non-numeric counts toward "at least" (finding 3)', () => {
      peer('demo-quiet-basin', 'alpha', 5);
      peer('p1', 'alpha', 5);
      peer('p2', 'alpha', null);
      fs.writeFileSync(path.join(REG(), 'p2.supervised'), 'not-a-number');
      const text = plain();
      expect(text).toContain('ccrc: at least 1 other supervised row names project `alpha`');
    });

    // Finding 3, branch: the peer `project ?? id` fallback. The only row
    // lacking `.project` in the pre-existing suite exits at rc 2 (unreadable)
    // one line earlier, so `[[ -n $CT_V ]] || CT_V="$o"` never ran. A row
    // with NO `.project` file at all (rc 1, absent) reaches it; its id must
    // equal the self row's project for the fallback to be observable at all.
    it('a peer with no .project falls back to its own id (finding 3)', () => {
      peer('demo-quiet-basin', 'alpha', 5);
      peer('alpha', null, 5);
      expect(plain()).toContain('ccrc: 1 other supervised row names project `alpha`');
    });

    // Finding 5: `case "$CT_V" in ''|*[!0-9]*)` admits a leading-zero string
    // like "0899", which `(( ))` then tries to parse as OCTAL and errors
    // ("value too great for base") to real stderr — the same failure mode as
    // finding 1, on the additionalContext path. `10#$CT_V` fixes it.
    it('a leading-zero .supervised is parsed as decimal, not octal — no stderr leak (finding 5)', () => {
      peer('demo-quiet-basin', 'alpha', 5);
      peer('p1', 'alpha', null);
      fs.writeFileSync(path.join(REG(), 'p1.supervised'), '0899');
      const tree = path.join(home, 'tree');
      gitTree(tree, 1);
      plantGraph(tree, { built: 'deadbee' });
      const r = runRaw({ hook_event_name: 'SessionStart', cwd: tree });
      expect(r.status, 'the hook must exit 0 on every path').toBe(0);
      expect(r.stderr, 'octal parsing of a leading-zero heartbeat leaked stderr').toBe('');
      // "0899" read as decimal is 899 seconds since the epoch — wildly stale
      // — so the lone peer contributes nothing and the card stays silent.
      expect(card(r.stdout)).not.toContain('ccrc:');
    });
  });
});

describe('the program subject', () => {
  const REG = (): string => path.join(home, '.cc-sessions');
  const hold = (bytes: string): void =>
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.hold'), bytes);
  const plain = (): string => {
    const tree = path.join(home, 'tree');
    gitTree(tree, 1);
    plantGraph(tree, { built: 'deadbee' });
    return card(run({ hook_event_name: 'SessionStart', cwd: tree }));
  };

  it('quotes the hold bytes and names the worker skill', () => {
    hold('program:account-pools wave:3/6 run:34');
    const text = plain();
    expect(text).toContain('`program:account-pools wave:3/6 run:34`');
    expect(text).toContain('`ccrc-worker` skill');
    expect(text).toContain('ccrc-api mail list --to demo-quiet-basin');
  });

  it('never narrates the wave or the role', () => {
    hold('program:account-pools wave:3/6 run:34');
    const text = plain();
    expect(text).not.toMatch(/you are on wave|wave 3 of 6|you are the dispatched/i);
  });

  it('says no run placed a suffix-less hold', () => {
    hold('program:account-pools wave:4/6');
    const text = plain();
    expect(text).toContain('names NO run');
    expect(text).not.toContain('mail list --to');
  });

  it('is silent on a free-text operator hold', () => {
    hold('keep — chasing the ccd-session-state flake');
    expect(plain()).not.toContain('ccrc-program:');
  });

  it('is silent on a hold longer than the bound', () => {
    hold(`program:${'x'.repeat(300)} wave:1/2 run:9`);
    expect(plain()).not.toContain('ccrc-program:');
  });

  // The truncation trap: _ct_read caps at CCRC_ID_MAX (128), so a hold longer
  // than that arrives SHORTENED and can lose its ` run:<id>` suffix in the cut.
  // Rendered naively it would read as CASE B — "names NO run" — for a hold that
  // names one. CCRC_HOLD_MAX=127 refuses anything that reached the read's bound,
  // so a value is either quoted whole or not quoted at all.
  it('is silent on a hold whose run suffix the read would have cut off', () => {
    const pad = 'x'.repeat(128 - 'program: wave:1/2'.length);
    hold(`program:${pad} wave:1/2 run:34`);
    const text = plain();
    expect(text).not.toContain('ccrc-program:');
    expect(text).not.toContain('names NO run');
  });

  it('tells unreadable apart from absent', () => {
    hold('program:account-pools wave:3/6 run:34');
    fs.chmodSync(path.join(REG(), 'demo-quiet-basin.hold'), 0o000);
    const text = plain();
    expect(text).toContain('could not be read');
    expect(text).not.toContain('`ccrc-worker` skill');
  });

  it('names an archived row\'s hold as residue, not an assignment', () => {
    hold('program:account-pools wave:3/6 run:34');
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.archived'), 'archived=1 reason=merged:#160');
    const text = plain();
    expect(text).toContain('stamped ARCHIVED');
    expect(text).toContain('residue');
    expect(text).not.toContain('Run that skill');
  });

  it('names the workspace by path when the cwd is somewhere else', () => {
    hold('program:account-pools wave:3/6 run:34');
    fs.writeFileSync(path.join(REG(), 'demo-quiet-basin.workdir'), '/elsewhere/tree');
    const text = plain();
    expect(text).toContain('the workspace `demo-quiet-basin`');
    expect(text).not.toContain('this workspace is claimed');
  });

  it('the operator file silences it', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    hold('program:account-pools wave:3/6 run:34');
    expect(plain()).not.toContain('ccrc-program:');
  });
});

describe('the R7 counters', () => {
  const bash = (command: string): void => {
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } });
  };

  it('counts the spelling the fleet actually uses, not the one it reads', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('API="$HOME/.local/bin/ccrc-api"; "$API" peers list --of demo');
    expect(readState().ccrcPeerReads).toBe(1);
  });

  it('does not count prose or a lookalike', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('ls | grep peers');
    bash('echo speers listing');
    // `speers listing` is blocked by BOTH anchors independently — the leading
    // class fails on the `s` before `peers`, and the trailing class fails on
    // the `ing` after `list` — so neither fixture above decides either anchor
    // on its own (fix round 1, finding 2). These two do: `speers list` ends
    // right at `list`, so the trailing class is satisfied and only the
    // LEADING class stops it; `peers listing` starts at a real boundary, so
    // the leading class is satisfied and only the TRAILING class stops it.
    bash('echo speers list');
    bash('echo peers listing');
    expect(readState().ccrcPeerReads).toBe(0);
  });

  it('counts a programless claim apart from a peer read', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('~/.local/bin/ccrc-api claims take --json -');
    const s = readState();
    expect(s.ccrcClaims).toBe(1);
    expect(s.ccrcPeerReads).toBe(0);
  });

  it('resets on a new context and is kept across resume', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('ccrc-api peers list --of demo');
    expect(readState().ccrcPeerReads).toBe(1);
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    expect(readState().ccrcPeerReads).toBe(1);
    run({ hook_event_name: 'SessionStart', source: 'clear' });
    expect(readState().ccrcPeerReads).toBe(0);
  });

  it('carries both counters across an ordinary event', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    bash('ccrc-api peers list --of demo');
    bash('ccrc-api claims take --json -');
    bash('ls');
    const s = readState();
    expect(s.ccrcPeerReads).toBe(1);
    expect(s.ccrcClaims).toBe(1);
  });

  it('survives a non-numeric carried value', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    const f = stateFile();
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.ccrcPeerReads = 'seven';
    fs.writeFileSync(f, JSON.stringify(j));
    bash('ls');
    expect(readState().ccrcPeerReads).toBe(0);
  });

  // fix round 1, item 3: `jq`'s own `type == "number"` guard already folds a
  // wrong-typed but PARSEABLE value (the test above) before the bash regex
  // guard ever runs — so that fixture cannot tell the bash guard apart from
  // no guard at all. This one can: a state file the jq FORK ITSELF cannot
  // read to completion (unparseable JSON, matching the pre-existing "a corrupt
  // existing state file is overwritten, not crashed on" fixture above) makes
  // EVERY `read` in the carry read-back hit EOF, so `$cp` never sees a jq
  // output line at all — it stays the empty string it was initialised to.
  // `^[0-9]+$` requires at least one digit, so empty fails it exactly the way
  // `"seven"` does not: this is the guard's real job.
  it('survives a state file the jq fork cannot parse at all', () => {
    run({ hook_event_name: 'SessionStart', source: 'startup' });
    fs.writeFileSync(stateFile(), '{nope');
    bash('ls');
    expect(readState().ccrcPeerReads).toBe(0);
  });
});
