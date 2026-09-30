// Worker stall watch wave 2 (design 2026-09-29 §5.1): the HOOK side. Part A is
// StopFailure (registered, handled, writes nothing) and the `-hookcap` capture
// arm; Part B appends the main-thread turn marker below.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME, the way
// session-hook.test.ts does. The harness is COPIED from that file's fixture and
// runners, not imported: a test file cannot import another, and
// session-hook.test.ts's own lines are cited by the compaction-card audit, so
// no row of this wave is inserted there.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
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
/** `run` plus stderr, with the header contract's exit 0 asserted once, here. */
const runFull = (payload: object, env: Record<string, string> = {}): { stdout: string; stderr: string } => {
  const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env) });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return { stdout: r.stdout, stderr: r.stderr };
};
const reg = (): string => path.join(home, '.cc-sessions');
const stateFile = (): string => path.join(reg(), 'demo-quiet-basin.hookstate.json');
const readState = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;

describe('StopFailure (worker stall watch §5.1)', () => {
  it('prints nothing on either stream and exits 0', () => {
    expect(runFull({ hook_event_name: 'StopFailure', error: 'server_error' })).toEqual({ stdout: '', stderr: '' });
    expect(run({ hook_event_name: 'StopFailure', error: 'rate_limit' })).toBe('');
  });

  it('writes no hookstate.json when none existed', () => {
    run({ hook_event_name: 'StopFailure', error: 'server_error' });
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  it('control: a Stop in the same fixture does write hookstate.json', () => {
    run({ hook_event_name: 'Stop' });
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop' });
  });

  it('leaves an existing hookstate.json byte-identical', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    const before = fs.readFileSync(stateFile());
    const mtime = fs.statSync(stateFile()).mtimeMs;
    run({ hook_event_name: 'StopFailure', error: 'server_error' });
    expect(fs.readFileSync(stateFile())).toEqual(before);
    expect(fs.statSync(stateFile()).mtimeMs).toBe(mtime);
    expect(readState()).toMatchObject({ state: 'working', event: 'UserPromptSubmit' });
  });
});
