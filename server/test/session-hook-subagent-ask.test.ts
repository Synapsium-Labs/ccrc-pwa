// Stall watch settings wave 3, Task 1: `subagent-tool-event-keeps-the-waiting-ask` (D-4039).
// Finding 4063: a background subagent's tool events wrote `working` and a null ask over the main thread's question.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME. The harness is COPIED from
// session-hook-turnmark.test.ts (a test file cannot import another).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');

/** The row's generation, exactly 36 bytes and no LF, as ccd writes it
 *  (session-hook.test.ts's own fixture constant). */
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.generation'), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hookEnv = (env: Record<string, string>): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home,
  PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
  CCRC_SESSION_GENERATION: GENERATION,
  ...env,
});
/** The hook's STDOUT; `execFileSync` throws on a non-zero exit. */
const run = (payload: object, env: Record<string, string> = {}): string =>
  execFileSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env) });
const reg = (): string => path.join(home, '.cc-sessions');
const stateFile = (): string => path.join(reg(), 'demo-quiet-basin.hookstate.json');
const readState = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;

const Q = { questions: [{ question: 'Which base?', header: 'Base', multiSelect: false,
  options: [{ label: 'main', description: 'current main' }, { label: 'stable', description: 'the stable branch' }] }] };
const SUB = { agent_id: 'a882033f84d7f43d3', agent_type: 'general-purpose' };
const askViaPermission = (): void => { run({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: Q }); };

describe('a subagent tool event keeps the main thread waiting (D-4039)', () => {
  it('a subagent PreToolUse after a PermissionRequest question leaves waiting and the questions', () => {
    askViaPermission();
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
  });

  it('a subagent PostToolUse does too, and so do many in a row', () => {
    askViaPermission();
    for (let i = 0; i < 3; i++) run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
  });

  it('the PreToolUse question arm is kept the same way', () => {
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: Q });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: { pattern: 'x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
  });

  it('an approval dialog is kept the same way', () => {
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
    run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { approval: { tool: 'Bash', summary: 'rm -rf build' } } });
  });

  it('the stamp and the event still move, for the delegates hold and the frozen arm', () => {
    askViaPermission();
    const before = readState()['updatedAt'] as number;
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    const after = readState();
    expect(after['event']).toBe('PostToolUse');
    expect(after['updatedAt'] as number).toBeGreaterThanOrEqual(before);
  });

  it('control: the main thread answering (its own PostToolUse) ends the wait and clears the ask', () => {
    askViaPermission();
    run({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: Q });
    expect(readState()).toMatchObject({ state: 'working', ask: null });
  });

  it('scope: a subagent tool event over done still writes working, as before', () => {
    run({ hook_event_name: 'Stop' });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'working', ask: null });
  });
});
