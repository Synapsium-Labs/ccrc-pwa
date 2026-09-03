// Runs ccd/session-hook.sh for real inside a fixture HOME, the way the ccd
// suites run ccd: a stub tmux on PATH answers the session name, stdin carries
// the hook payload, and the assertion reads the file the script wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

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
      git('commit', '-q', '--allow-empty', '-m', `c${i}`);
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

  const card = (stdout: string): string => {
    expect(stdout.trim(), 'the hook printed nothing').not.toBe('');
    const lines = stdout.trim().split('\n');
    expect(lines, 'the hook printed more than one line on stdout').toHaveLength(1);
    const j = JSON.parse(lines[0]!);
    expect(j.hookSpecificOutput.hookEventName).toBe('SessionStart');
    return String(j.hookSpecificOutput.additionalContext);
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

  it('prints NOTHING on every other event, even with a graph right there', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first });
    for (const payload of [
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: tree },
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

  it('omits the node count rather than inventing one when GRAPH_REPORT.md is absent', () => {
    const tree = path.join(home, 'tree');
    const first = gitTree(tree, 1);
    plantGraph(tree, { built: first, report: false });
    const text = card(run({ hook_event_name: 'SessionStart', cwd: tree }));
    expect(text).toContain('graphify-out/');
    expect(text).not.toContain('nodes');
  });
});
