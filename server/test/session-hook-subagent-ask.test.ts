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

  // a-carried-wait-keeps-its-stamp (D-4041): the aged door (hookstate.ts) is the reader that needs liveness, and it
  // reads `aliveAt`. The attention bucket, the ask row's `askAt` and the verdict's hold 2a read the wait's START.
  it('a carried write keeps updatedAt and event and writes aliveAt', () => {
    askViaPermission();
    // Rewrite the stored stamp so "kept" is a strict, observable fact, not a same-millisecond tie.
    const seeded = { ...readState(), updatedAt: 1 };
    fs.writeFileSync(stateFile(), JSON.stringify(seeded) + '\n');
    const before = Date.now();
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    const after = readState();
    expect(after['state']).toBe('waiting');
    expect(after['event']).toBe('PermissionRequest');
    expect(after['updatedAt']).toBe(1);
    expect(after['aliveAt'] as number).toBeGreaterThanOrEqual(before);
  });

  it('a subagent PreToolUse keeps the stamp and writes aliveAt too, and a second carry keeps the FIRST stamp', () => {
    askViaPermission();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), updatedAt: 1 }) + '\n');
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, ...SUB });
    const first = readState();
    expect(first).toMatchObject({ state: 'waiting', event: 'PermissionRequest', updatedAt: 1 });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, ...SUB });
    const second = readState();
    expect(second).toMatchObject({ state: 'waiting', event: 'PermissionRequest', updatedAt: 1 });
    expect(second['aliveAt'] as number).toBeGreaterThanOrEqual(first['aliveAt'] as number);
  });

  it('a main-thread write after a carried one carries no aliveAt', () => {
    askViaPermission();
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toHaveProperty('aliveAt');
    // a new main-thread question: waiting again, rewritten whole, with a fresh stamp and no aliveAt
    askViaPermission();
    const renewed = readState();
    expect(renewed).toMatchObject({ state: 'waiting', event: 'PermissionRequest' });
    expect(renewed).not.toHaveProperty('aliveAt');
    // and the answer: working
    run({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: Q });
    expect(readState()).toMatchObject({ state: 'working' });
    expect(readState()).not.toHaveProperty('aliveAt');
  });

  it('SubagentStart and SubagentStop over a main-thread wait keep the stamp and write aliveAt', () => {
    askViaPermission();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), updatedAt: 1 }) + '\n');
    for (const ev of ['SubagentStart', 'SubagentStop']) {
      run({ hook_event_name: ev, ...SUB });
      const s = readState();
      expect(s, ev).toMatchObject({ state: 'waiting', event: 'PermissionRequest', updatedAt: 1, ask: { questions: Q.questions } });
      expect(s['aliveAt'] as number, ev).toBeGreaterThan(1);
    }
  });

  it('control: SubagentStart over working and over a subagent-raised wait write no aliveAt', () => {
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' } });
    run({ hook_event_name: 'SubagentStart', ...SUB });
    expect(readState()).toMatchObject({ state: 'working' });
    expect(readState()).not.toHaveProperty('aliveAt');
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...SUB });
    run({ hook_event_name: 'SubagentStop', ...SUB });
    const s = readState();
    expect(s).toMatchObject({ state: 'waiting', waitBy: 'subagent' });
    expect(s).not.toHaveProperty('aliveAt');
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

  // carry-only-a-main-thread-wait (task review, Important 1): a wait the subagent raised itself ends as it always did.
  it('a subagent\'s own approved dialog ends at its next tool event (working, no ask)', () => {
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', waitBy: 'subagent' });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...SUB });
    const s = readState();
    expect(s).toMatchObject({ state: 'working', ask: null });
    expect(s).not.toHaveProperty('waitBy');
  });

  it('the same holds after a Stop, and across a SubagentStop that carries the provenance', () => {
    run({ hook_event_name: 'Stop' });
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...SUB });
    run({ hook_event_name: 'SubagentStop', ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', waitBy: 'subagent' });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'working', ask: null });
  });

  it('a main-thread wait survives a SubagentStop and a SubagentStart, and is not flipped to subagent-raised', () => {
    askViaPermission();
    run({ hook_event_name: 'SubagentStart', ...SUB });
    run({ hook_event_name: 'SubagentStop', ...SUB });
    const mid = readState();
    expect(mid).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
    expect(mid).not.toHaveProperty('waitBy');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    const after = readState();
    expect(after).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
    expect(after).not.toHaveProperty('waitBy');
  });

  it('a subagent AskUserQuestion over a main-thread question leaves the main wait, still main-owned', () => {
    // The subagent asks a DIFFERENT question, so "the main thread's ask survived" is observable, not assumed.
    const Q2 = { questions: [{ question: 'Subagent asks?', header: 'Sub', multiSelect: false,
      options: [{ label: 'yes', description: 'go on' }, { label: 'no', description: 'stop' }] }] };
    askViaPermission();
    run({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: Q2, ...SUB });
    const first = readState();
    expect(first).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
    expect(JSON.stringify(first['ask'])).not.toContain('Subagent asks?');
    expect(first).not.toHaveProperty('waitBy');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    const s = readState();
    expect(s).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
    expect(JSON.stringify(s['ask'])).not.toContain('Subagent asks?');
    expect(s).not.toHaveProperty('waitBy');
  });

  it('Review Focus 1 scope pin: a subagent PermissionRequest over a main-thread question writes its own approval', () => {
    askViaPermission();
    run({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { approval: { tool: 'Bash', summary: 'ls' } }, waitBy: 'subagent' });
  });

  it('the interrupted flag is carried with the wait', () => {
    askViaPermission();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), interrupted: true }) + '\n');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB });
    expect(readState()).toMatchObject({ state: 'waiting', interrupted: true, ask: { questions: Q.questions } });
  });

  it('a main-thread write carries no waitBy key (the default shape is unchanged)', () => {
    askViaPermission();
    expect(readState()).not.toHaveProperty('waitBy');
    run({ hook_event_name: 'Stop' });
    expect(readState()).not.toHaveProperty('waitBy');
  });
});

// ── The race (review 397, "P1 exception 1"; D-4041) ─────────────────────────────────────────────────────────────────
// A forced interleaving: a `jq` shim in the fixture's `bin/` passes through to the real jq, and, on ONE chosen read of the
// hookstate file, prints the real result first and then rewrites the file the way the main thread's ANSWER would. The
// prefilter read is the one whose program names `graphQueries`; the carry's fresh read is the one that names `waitBy`.
describe('the carry is decided from one fresh read (D-4041)', () => {
  const SHIM = `#!/bin/bash
args=("$@"); last="${'$'}{args[$((${'$'}{#args[@]}-1))]}"
if [[ "$last" == *.hookstate.json ]]; then
  [[ -n "${'$'}{SHIM_LOG:-}" ]] && echo "$last" >> "$SHIM_LOG"
  hit=""
  case "${'$'}{SHIM_RACE:-}" in
    prefilter) [[ "$*" == *graphQueries* ]] && hit=1 ;;
    carry) [[ "$*" == *waitBy* ]] && hit=1 ;;
  esac
  if [[ -n "$hit" && ! -e "$last.fired" ]]; then
    : > "$last.fired"
    "$REAL_JQ" "$@" > "$last.shimout"; rc=$?
    printf '%s\n' "$SHIM_REWRITE" > "$last.rw" && mv "$last.rw" "$last"
    cat "$last.shimout"; rm -f "$last.shimout"; exit $rc
  fi
fi
exec "$REAL_JQ" "$@"
`;
  const realJq = (): string => execFileSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).trim();
  const installShim = (): void => { fs.writeFileSync(path.join(home, 'bin', 'jq'), SHIM, { mode: 0o755 }); };
  const mainAnswer = (): string => JSON.stringify({ v: 1, state: 'working', event: 'PostToolUse', sessionId: 'uuid-1', pid: 4242,
    updatedAt: Date.now(), ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0 });
  const raceEnv = (race: string): Record<string, string> => ({ REAL_JQ: realJq(), SHIM_RACE: race, SHIM_REWRITE: mainAnswer() });

  it('a main answer landing after the prefilter read is not overwritten by a carried waiting', () => {
    askViaPermission();
    installShim();
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB }, raceEnv('prefilter'));
    expect(fs.existsSync(`${stateFile()}.fired`), 'the shim fired').toBe(true);
    expect(readState()).toMatchObject({ state: 'working', ask: null });
    expect(readState()).not.toHaveProperty('aliveAt');
  });

  it('the same holds for a SubagentStop: its state comes from the fresh read, not from the prefilter', () => {
    askViaPermission();
    installShim();
    run({ hook_event_name: 'SubagentStop', ...SUB }, raceEnv('prefilter'));
    expect(fs.existsSync(`${stateFile()}.fired`), 'the shim fired').toBe(true);
    expect(readState()).toMatchObject({ state: 'working', ask: null });
  });

  it('a file that is gone or unreadable at the fresh read leaves SubagentStop inert', () => {
    askViaPermission();
    installShim();
    run({ hook_event_name: 'SubagentStop', ...SUB }, { ...raceEnv('prefilter'), SHIM_REWRITE: 'not json' });
    expect(fs.existsSync(`${stateFile()}.fired`), 'the shim fired').toBe(true);
    expect(fs.readFileSync(stateFile(), 'utf8').trim()).toBe('not json');
  });

  it('control: with no interleaving the shim is a pass-through and the wait is carried', () => {
    askViaPermission();
    installShim();
    run({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB }, { REAL_JQ: realJq() });
    expect(readState()).toMatchObject({ state: 'waiting', ask: { questions: Q.questions } });
  });

  it('the prefilter keeps the fresh read off every other event: one read over working or done, and for a main-thread event over a wait', () => {
    installShim();
    const log = path.join(home, 'jq.log');
    const env = { REAL_JQ: realJq(), SHIM_LOG: log };
    const reads = (payload: object): number => {
      fs.rmSync(log, { force: true });
      run(payload, env);
      return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
    };
    const subPost = { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' }, ...SUB };
    const mainPost = { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' } };
    const ask = { hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: Q };
    run(mainPost, env);
    expect(reads(subPost), 'subagent over working').toBe(1);
    run({ hook_event_name: 'Stop' }, env);
    expect(reads(subPost), 'subagent over done').toBe(1);
    run(ask, env);
    expect(reads(mainPost), 'main thread over a wait').toBe(1);
    run(ask, env);
    expect(reads(subPost), 'subagent over a main-thread wait: the prefilter and the fresh read').toBe(2);
  });

  it('SubagentStart and SubagentStop read the hookstate file with two jq forks: the prefilter and the shared fresh read', () => {
    askViaPermission();
    installShim();
    const log = path.join(home, 'jq.log');
    for (const ev of ['SubagentStart', 'SubagentStop']) {
      fs.rmSync(log, { force: true });
      run({ hook_event_name: ev, ...SUB }, { REAL_JQ: realJq(), SHIM_LOG: log });
      const forks = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
      expect(forks, ev).toHaveLength(2);
    }
  });
});
