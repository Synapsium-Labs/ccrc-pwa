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
});
