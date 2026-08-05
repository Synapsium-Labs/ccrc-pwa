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

/** Run the hook with a payload; env overrides let each test break one leg. */
const run = (payload: object, env: Record<string, string> = {}): void => {
  execFileSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env, HOME: home,
      PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
      ...env,
    },
  });
};
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
