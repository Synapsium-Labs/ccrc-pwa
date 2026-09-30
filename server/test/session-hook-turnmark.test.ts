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

describe('the capture arm (§5.1 first task; capture-arm-keyed-on-hookcap)', () => {
  const REDUCER = path.resolve(__dirname, '../../deploy/hook-capture-reduce.mjs');
  const capRoot = (): string => path.join(home, '.ccrc', 'hook-capture');

  it('a session whose id does not end -hookcap writes nothing under .ccrc/hook-capture', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'Stop' });
    run({ hook_event_name: 'StopFailure', error: 'server_error' });
    expect(fs.existsSync(capRoot())).toBe(false);
    expect(readState()).toMatchObject({ state: 'done' });   // control: the hook ran
  });

  describe('in a -hookcap session', () => {
    const capDir = (): string => path.join(capRoot(), 'demo-hookcap');
    const caps = (): string[] => fs.readdirSync(capDir()).filter((n) => n.endsWith('.cap')).sort();
    beforeEach(() => {
      fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\necho "cc-demo-hookcap"\n', { mode: 0o755 });
      fs.writeFileSync(path.join(reg(), 'demo-hookcap.generation'), GENERATION);
    });
    /** The hook under an explicit `umask 022`, so a capture file's 0600 comes
     *  from the arm's own `umask 077` and never from the test process's umask. */
    const runCap = (payload: object, env: Record<string, string> = {}): { stdout: string; stderr: string } => {
      const r = spawnSync('sh', ['-c', 'umask 022 && exec bash "$0"', HOOK],
        { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env) });
      expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
      return { stdout: r.stdout, stderr: r.stderr };
    };

    it('writes one 0600 .cap per event in a 0700 per-id dir: line 1 the meta line, the rest the payload', () => {
      const payloads: Array<{ hook_event_name: string } & Record<string, unknown>> = [
        { hook_event_name: 'UserPromptSubmit', prompt: 'p' },
        { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' } },
        { hook_event_name: 'SubagentStart', agent_id: 'a-1', agent_type: 'general' },
        { hook_event_name: 'Stop', background_tasks: [] },
        { hook_event_name: 'StopFailure', error: 'server_error' },
      ];
      for (const p of payloads) runCap(p);
      const names = caps();
      expect(names).toHaveLength(payloads.length);
      expect(fs.statSync(capDir()).mode & 0o777).toBe(0o700);
      for (const p of payloads) {
        const n = names.find((x) => x.startsWith(`${p.hook_event_name}-`));
        expect(n, p.hook_event_name).toMatch(/^[A-Za-z]+-[0-9]+-[0-9]+\.cap$/);
        const file = path.join(capDir(), n as string);
        expect(fs.statSync(file).mode & 0o777, n).toBe(0o600);
        const [meta, body, tail, ...more] = fs.readFileSync(file, 'utf8').split('\n');
        expect(meta).toBe('{"envSid":"uuid-1"}');
        expect(JSON.parse(body as string)).toEqual(p);
        expect([tail, ...more]).toEqual(['']);
      }
      expect(fs.readdirSync(capDir()).filter((n) => !n.endsWith('.cap'))).toEqual([]);   // no tmp left behind
    });

    it('prints nothing on either stream for any captured event', () => {
      const payloads = [
        { hook_event_name: 'UserPromptSubmit' },
        { hook_event_name: 'PostToolUse', tool_name: 'Bash' },
        { hook_event_name: 'Stop' },
        { hook_event_name: 'StopFailure', error: 'server_error' },
      ];
      for (const p of payloads) expect(runCap(p), p.hook_event_name).toEqual({ stdout: '', stderr: '' });
      expect(caps()).toHaveLength(payloads.length);
    });

    it('stops at 200 files: with 199 it writes the 200th, with 200 it writes nothing', () => {
      fs.mkdirSync(capDir(), { recursive: true, mode: 0o700 });
      for (let i = 0; i < 199; i += 1) fs.writeFileSync(path.join(capDir(), `Stop-${i}-1.cap`), '{}\n{}\n');
      runCap({ hook_event_name: 'UserPromptSubmit' });
      expect(caps()).toHaveLength(200);
      runCap({ hook_event_name: 'UserPromptSubmit' });
      expect(caps()).toHaveLength(200);
      expect(fs.readdirSync(capDir()).filter((n) => !n.endsWith('.cap'))).toEqual([]);
    });

    it.skipIf(process.getuid?.() === 0)('an unwritable capture dir costs nothing: silent, exit 0, no file, hookstate still written', () => {
      fs.mkdirSync(capDir(), { recursive: true, mode: 0o700 });
      fs.chmodSync(capDir(), 0o500);
      try {
        expect(runCap({ hook_event_name: 'Stop' })).toEqual({ stdout: '', stderr: '' });
        expect(fs.readdirSync(capDir())).toEqual([]);
      } finally {
        fs.chmodSync(capDir(), 0o700);
      }
      expect(fs.existsSync(path.join(reg(), 'demo-hookcap.hookstate.json'))).toBe(true);
    });

    it('SessionStart compact writes nothing (it exits in its own arm); SessionStart startup is captured', () => {
      runCap({ hook_event_name: 'SessionStart', source: 'compact' });
      expect(fs.existsSync(capDir())).toBe(false);
      runCap({ hook_event_name: 'SessionStart', source: 'startup' });
      expect(caps().filter((n) => n.startsWith('SessionStart-'))).toHaveLength(1);
    });

    it('the meta line carries the env session id stripped to [A-Za-z0-9-]', () => {
      runCap({ hook_event_name: 'Stop' }, { CLAUDE_CODE_SESSION_ID: 'uuid-1;rm -rf "x"' });
      const [meta] = fs.readFileSync(path.join(capDir(), caps()[0] as string), 'utf8').split('\n');
      expect(meta).toBe('{"envSid":"uuid-1rm-rfx"}');
    });

    it('round trip: deploy/hook-capture-reduce.mjs reads what the arm writes', () => {
      runCap({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'uuid-1' });
      runCap({ hook_event_name: 'UserPromptSubmit', session_id: 'uuid-1' });
      runCap({ hook_event_name: 'Stop', session_id: 'uuid-1', background_tasks: [{ id: 't1', type: 'shell' }] });
      const r = spawnSync(process.execPath, [REDUCER, capDir()], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout) as {
        files: number; unparsed: number;
        events: Record<string, { envSid: Record<string, number>; backgroundTasks: { array: number; types: string[] } }>;
        sessionStarts: Array<{ source: string; envSidVsPrevious: string }>;
      };
      expect(out).toMatchObject({ files: 3, unparsed: 0 });
      expect(out.sessionStarts).toEqual([{ source: 'startup', envSidVsPrevious: 'first' }]);
      expect(out.events['Stop']?.backgroundTasks).toMatchObject({ array: 1, types: ['shell'] });
      expect(out.events['UserPromptSubmit']?.envSid).toEqual({ absent: 0, equalsPayload: 1, differsFromPayload: 0, payloadAbsent: 0 });
    });
  });
});
