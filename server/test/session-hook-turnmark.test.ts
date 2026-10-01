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
import { readTurnMarkMeasured } from '../src/turnmark.js';
import { localIO } from '../src/io.js';

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

describe('the capture arm (§5.1 first task; capture-arm-keyed-on-hookcap (D-3612))', () => {
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

// ── The turn marker's writer core (worker stall watch §5.1, wave 2 Task 3) ──
// `$REG/<id>.turn.json`: one JSON line, main-thread events only, written in the
// hook's TAIL (README anchors the hook at :2900, so nothing new lands above it).
// Module scope, so the restart rows (Task 4) and the reader's round-trip row
// (Task 6) read the same file through the same helpers.
const turnFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.turn.json');
const turnRaw = (): string => fs.readFileSync(turnFile(), 'utf8');
const turnMark = (): any => JSON.parse(turnRaw());
const plantTurn = (line: string): void => { fs.writeFileSync(turnFile(), line); };
/** The writer's key order: the base object in TURN_MARK_PROGRAM fixes it. */
const TURN_KEYS: readonly string[] = ['v', 'sessionId', 'state', 'event', 'at', 'turnAt', 'stopAt', 'bg', 'bgKinds',
  'bgIds', 'err', 'restartAt', 'lostBg', 'lostKinds', 'lostIds'];

describe('the turn marker (§5.1)', () => {
  /** A Stop's line with nothing carried: what the writer emits over a foreign or unreadable previous line. */
  const freshStop = (at: number): Record<string, unknown> => ({ v: 1, sessionId: 'uuid-1', state: 'done',
    event: 'Stop', at, turnAt: null, stopAt: at, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null,
    lostBg: 0, lostKinds: '', lostIds: '' });

  it("UserPromptSubmit on no marker writes ONE line, exactly, keys in the writer's order", () => {
    const t0 = Date.now();
    run({ hook_event_name: 'UserPromptSubmit' });
    const t1 = Date.now();
    const raw = turnRaw();
    const at = JSON.parse(raw).at as number;
    expect(at).toBeGreaterThanOrEqual(t0);
    expect(at).toBeLessThanOrEqual(t1);
    expect(raw).toBe(JSON.stringify({ v: 1, sessionId: 'uuid-1', state: 'working', event: 'UserPromptSubmit', at,
      turnAt: at, stopAt: null, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0,
      lostKinds: '', lostIds: '' }) + '\n');
    expect(Object.keys(JSON.parse(raw))).toEqual(TURN_KEYS);
  });

  it('the marker and the hookstate share ONE stamp per hook run (one-stamp-per-hook-run (D-3616))', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState().updatedAt).toBe(turnMark().at);
  });

  it('a main TOOL event while already working is a builtin read: same bytes, same mtime', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    const past = new Date(Date.now() - 3_600_000);
    fs.utimesSync(turnFile(), past, past);
    const bytes = turnRaw();
    const mtime = fs.statSync(turnFile()).mtimeMs;
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
    expect(turnRaw()).toBe(bytes);
    expect(fs.statSync(turnFile()).mtimeMs).toBe(mtime);
  });

  it('a prompt after an interrupted turn (marker still working) opens a new turn: turnAt moves (a-prompt-always-opens-a-turn (D-3675))', () => {
    // An Esc interrupt ends a turn with no Stop, so the line still reads working under THIS session id.
    plantTurn(JSON.stringify({ v: 1, sessionId: 'uuid-1', state: 'working', event: 'PostToolUse', at: 5, turnAt: 5,
      stopAt: null, bg: 2, bgKinds: 'shell', bgIds: 'b1', err: null, restartAt: null, lostBg: 0, lostKinds: '',
      lostIds: '' }) + '\n');
    run({ hook_event_name: 'UserPromptSubmit' });
    const m = turnMark();
    expect(m).toMatchObject({ sessionId: 'uuid-1', state: 'working', event: 'UserPromptSubmit', stopAt: null, bg: 2,
      bgKinds: 'shell', bgIds: 'b1' });
    expect(m.at).toBeGreaterThan(5);
    expect(m.turnAt).toBe(m.at);
  });

  it('a working line under ANOTHER session id is rewritten, not skipped', () => {
    plantTurn(JSON.stringify({ v: 1, sessionId: 'uuid-OLD', state: 'working', event: 'PostToolUse', at: 5, turnAt: 5,
      stopAt: null, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '',
      lostIds: '' }) + '\n');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const m = turnMark();
    expect(m).toMatchObject({ sessionId: 'uuid-1', state: 'working', event: 'PostToolUse' });
    expect(m.at).toBeGreaterThan(5);
    expect(m.turnAt).toBe(m.at);
  });

  it('Stop measures background_tasks: count, cleaned de-duplicated kinds, shaped ids', () => {
    const out = run({ hook_event_name: 'Stop', background_tasks: [
      { id: 'b989ocn62', type: 'Monitor' }, { id: 'x y', type: 'MCP task' }, { type: 'subagent' }] });
    expect(out).toBe('');
    const m = turnMark();
    expect(m).toMatchObject({ state: 'done', event: 'Stop', bg: 3, bgKinds: 'mcp-task,monitor,subagent',
      bgIds: 'b989ocn62' });
    expect(m.stopAt).toBe(m.at);
  });

  it('bg is -1, never 0, unless background_tasks is an ARRAY (absent, a string, an object)', () => {
    const cases = [
      ['absent', {}],
      ['a string', { background_tasks: 'x' }],
      ['an object', { background_tasks: { a: { type: 'subagent', id: 'z' } } }],
    ] as const;
    for (const [name, extra] of cases) {
      run({ hook_event_name: 'Stop', ...extra });
      const m = turnMark();
      expect([m.bg, m.bgKinds, m.bgIds], name).toEqual([-1, '', '']);
    }
  });

  it('ids keep at most eight; each alias is cleaned per element and de-duplicated', () => {
    run({ hook_event_name: 'Stop',
      background_tasks: Array.from({ length: 9 }, (_, i) => ({ id: `id${i + 1}`, type: 'shell' })) });
    expect(turnMark()).toMatchObject({ bg: 9, bgKinds: 'shell', bgIds: 'id1,id2,id3,id4,id5,id6,id7,id8' });
    run({ hook_event_name: 'Stop', background_tasks: [{ type: 'a,b' }, { type: 'Shell' }, { type: 'shell' }] });
    expect(turnMark()).toMatchObject({ bg: 3, bgKinds: 'ab,shell', bgIds: '' });
  });

  it('an id or type ending in a newline cannot end the field early: the newline id is refused, the later id survives', () => {
    // Oniguruma's `$` matches before a final newline, which would pass `b1\n` and let `read -r` cut bgIds at `b1`.
    run({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1\n', type: 'shell\n' }, { id: 'b2', type: 'monitor' }] });
    expect(turnMark()).toMatchObject({ bg: 2, bgKinds: 'monitor,shell', bgIds: 'b2' });
  });

  it('40 aliases fit WHOLE under 200 bytes: no half alias, no trailing comma (alias-list-fits-whole-aliases (D-3658))', () => {
    const L = 'abcdefghijklmnopqrstuvwxyz';
    // Letters only: the writer deletes every character outside [a-z_-], so digits would collide.
    const aliases = Array.from({ length: 40 }, (_, i) => `kind${L.charAt(Math.floor(i / 26))}${L.charAt(i % 26)}zz`);
    run({ hook_event_name: 'Stop', background_tasks: aliases.map((type) => ({ type })) });
    const want = [...aliases].sort().slice(0, 22).join(',');   // 22 × 8 bytes + 21 commas = 197
    expect(want.length).toBe(197);
    expect(turnMark().bgKinds).toBe(want);
    expect(turnMark().bg).toBe(40);
  });

  it('StopFailure writes failed with a cleaned err and a stopAt, and still no hookstate', () => {
    run({ hook_event_name: 'StopFailure', error: 'server_error' });
    const m = turnMark();
    expect(m).toMatchObject({ state: 'failed', event: 'StopFailure', err: 'server_error' });
    expect(m.stopAt).toBe(m.at);
    expect(fs.existsSync(stateFile()), 'StopFailure leaves hookstate alone').toBe(false);
    run({ hook_event_name: 'StopFailure', error: 'Rate-Limit!' });
    expect(turnMark().err).toBe('ateimit');
  });

  it('a subagent PostToolUse after a main Stop leaves the done line byte-identical (the parse row)', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'Stop' });
    const done = turnRaw();
    expect(JSON.parse(done).state).toBe('done');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', agent_id: 'a-1' });
    expect(turnRaw()).toBe(done);
  });

  it('a non-empty agent_id never touches the marker; an empty one is the main thread', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'Stop' });
    const done = turnRaw();
    for (const ev of ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure'] as const) {
      run({ hook_event_name: ev, agent_id: 'a-1', tool_name: 'Bash', tool_input: { command: 'true' } });
      expect(turnRaw(), `${ev} from a subagent`).toBe(done);
    }
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', agent_id: '' });
    expect(turnMark().state, 'agent_id "" is the main thread').toBe('working');
  });

  it('the first main PreToolUse after a Stop writes working: fresh at and turnAt, stopAt kept (first-tool-event-after-done)', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'Stop' });
    const done = turnMark();
    expect(done.state).toBe('done');
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
    const m = turnMark();
    expect(m).toMatchObject({ sessionId: 'uuid-1', state: 'working', event: 'PreToolUse', stopAt: done.stopAt });
    expect(m.at).toBeGreaterThan(done.at);
    expect(m.turnAt).toBe(m.at);
  });

  it('the first main PostToolUse after a StopFailure writes working (first-tool-event-after-failed)', () => {
    run({ hook_event_name: 'StopFailure', error: 'server_error' });
    const failed = turnMark();
    expect(failed.state).toBe('failed');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const m = turnMark();
    expect(m).toMatchObject({ sessionId: 'uuid-1', state: 'working', event: 'PostToolUse', stopAt: failed.stopAt });
    expect(m.at).toBeGreaterThan(failed.at);
    expect(m.turnAt).toBe(m.at);
  });

  it('a SUBAGENT PreToolUse after a Stop leaves the done line byte-identical', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'Stop' });
    const done = turnRaw();
    run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, agent_id: 'a-1' });
    expect(turnRaw()).toBe(done);
    expect(JSON.parse(done).state).toBe('done');
  });

  it('the env session id wins; an empty env falls back to the payload id, cleaned (marker-identity-from-env (D-3614))', () => {
    run({ hook_event_name: 'UserPromptSubmit', session_id: 'sess-9' });
    expect(turnMark().sessionId, 'the env id wins').toBe('uuid-1');
    fs.rmSync(turnFile());
    run({ hook_event_name: 'UserPromptSubmit', session_id: 'sess-9' }, { CLAUDE_CODE_SESSION_ID: '' });
    expect(turnMark().sessionId, 'an empty env falls back to the payload').toBe('sess-9');
    fs.rmSync(turnFile());
    run({ hook_event_name: 'UserPromptSubmit', session_id: 'sess;9 x' }, { CLAUDE_CODE_SESSION_ID: '' });
    expect(turnMark().sessionId, 'the payload id is cleaned to [A-Za-z0-9_-]').toBe('sess9x');
  });

  it('a hook_event_name carrying a newline is cleaned to letters and falls to the default arm (event-name-sanitised-in-parse (D-3661))', () => {
    const r = runFull({ hook_event_name: 'Stop\nX' });
    expect(r.stdout).toBe('');
    expect(fs.existsSync(turnFile()), 'no marker').toBe(false);
    expect(fs.existsSync(stateFile()), 'no hookstate').toBe(false);
  });

  it('no .generation on the row: no marker, and the hookstate is still written', () => {
    fs.rmSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.generation'));
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(fs.existsSync(turnFile())).toBe(false);
    expect(readState().state, 'the hookstate does not depend on the generation').toBe('working');
  });

  it('Stop and StopFailure print nothing, on either stream, and leave no marker temp behind', () => {
    expect(run({ hook_event_name: 'UserPromptSubmit' })).toBe('');
    const stop = runFull({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell' }] });
    expect([stop.stdout, stop.stderr]).toEqual(['', '']);
    const fail = runFull({ hook_event_name: 'StopFailure', error: 'server_error' });
    expect([fail.stdout, fail.stderr]).toEqual(['', '']);
    expect(turnMark().state).toBe('failed');
    expect(fs.readdirSync(path.join(home, '.cc-sessions')).filter((n) => n.endsWith('.hook-write.tmp'))).toEqual([]);
  });

  it('carries: turnAt survives Stop; bg and kinds survive working; working clears lost*', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    const turnAt = turnMark().turnAt as number;
    run({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell' }, { id: 'b2', type: 'subagent' }] });
    expect(turnMark()).toMatchObject({ state: 'done', turnAt, bg: 2, bgKinds: 'shell,subagent', bgIds: 'b1,b2' });
    expect(turnMark().stopAt).toBeGreaterThanOrEqual(turnAt);
    plantTurn(JSON.stringify({ ...turnMark(), lostBg: 2, lostKinds: 'shell', lostIds: 'b9' }) + '\n');
    run({ hook_event_name: 'UserPromptSubmit' });
    const m = turnMark();
    expect(m).toMatchObject({ state: 'working', bg: 2, bgKinds: 'shell,subagent', bgIds: 'b1,b2', lostBg: 0,
      lostKinds: '', lostIds: '' });
    expect(m.turnAt).toBe(m.at);
  });

  it('a foreign previous line is not carried', () => {
    plantTurn(JSON.stringify({ v: 1, sessionId: 'uuid-OLD', state: 'done', event: 'Stop', at: 7, turnAt: 5, stopAt: 6,
      bg: 4, bgKinds: 'shell', bgIds: 'b1', err: 'x', restartAt: 7, lostBg: 2, lostKinds: 'shell',
      lostIds: 'b1' }) + '\n');
    run({ hook_event_name: 'Stop' });
    const m = turnMark();
    expect(m).toEqual(freshStop(m.at));
  });

  it('an unreadable previous line (not JSON, or v other than 1) reads as absent', () => {
    const v2 = JSON.stringify({ v: 2, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: 7, turnAt: 5, stopAt: 6,
      bg: 4, bgKinds: 'shell', bgIds: 'b1', err: null, restartAt: 7, lostBg: 2, lostKinds: 'shell', lostIds: 'b1' });
    for (const [name, line] of [['not JSON', 'not json\n'], ['v 2', `${v2}\n`]] as const) {
      plantTurn(line);
      run({ hook_event_name: 'Stop' });
      const m = turnMark();
      expect(m, name).toEqual(freshStop(m.at));
    }
  });

  it('TURN_MARK_PROGRAM is one single-quoted constant naming only its own jq variables', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    expect(src.split('\n').filter((l) => l.startsWith('TURN_MARK_PROGRAM='))).toEqual(["TURN_MARK_PROGRAM='"]);
    const open = src.indexOf("TURN_MARK_PROGRAM='") + "TURN_MARK_PROGRAM='".length;
    const body = src.slice(open, src.indexOf("'", open));
    // The first quote after the opening one must close the PROGRAM. A shell splice (`'"$x"'`) inside it
    // would end the constant early, and this is where that shows.
    expect(body.trimEnd().endsWith('else empty end'), 'the constant ends where the program does').toBe(true);
    const names = [...new Set([...body.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!))].sort();
    expect(names).toEqual(['at', 'b', 'bg', 'bgi', 'bgk', 'err', 'ev', 'k', 'kind', 'p', 'prev', 'raw', 'same', 'sid']);
    expect(src.split('"$TURN_MARK_PROGRAM"').length - 1, 'one use, one jq').toBe(1);
  });
});

// ── The turn marker across a restart (worker stall watch §5.1, wave 2 Task 4) ──
// A SessionStart other than compact is a new process: the old one's background
// tasks died with it, so a same-session `done` moves bg/bgKinds/bgIds into lost*.
// compact fires mid-turn and is inert (D-306); clear starts a fresh line.
describe('the turn marker across a restart (§5.1, SessionStart)', () => {
  const stopWith = (tasks: Array<{ id?: string; type?: string }>): void => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'Stop', background_tasks: tasks });
  };
  const THREE = [{ id: 'b1', type: 'shell' }, { id: 'b2', type: 'subagent' }, { id: 'b3', type: 'shell' }];

  it('a resume after a done moves the dead tasks into lost*, keeping stopAt and turnAt', () => {
    stopWith(THREE);
    const done = turnMark();
    expect(done).toMatchObject({ state: 'done', bg: 3, bgKinds: 'shell,subagent', bgIds: 'b1,b2,b3', lostBg: 0 });
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    const m = turnMark();
    expect(Object.keys(m)).toEqual(TURN_KEYS);
    expect(m).toEqual({ ...done, event: 'SessionStart', at: m.at, restartAt: m.at, bg: 0, bgKinds: '', bgIds: '',
      lostBg: 3, lostKinds: 'shell,subagent', lostIds: 'b1,b2,b3' });
    expect(m.at).toBeGreaterThanOrEqual(done.at);
  });

  it('a SECOND resume keeps lostBg AND lostKinds/lostIds (lost-kinds-accumulate (D-3660))', () => {
    stopWith(THREE);
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    const m = turnMark();
    expect(m).toMatchObject({ state: 'done', bg: 0, lostBg: 3, lostKinds: 'shell,subagent', lostIds: 'b1,b2,b3' });
    expect(m.restartAt).toBe(m.at);
  });

  it("startup, an absent source and an unknown source all behave as resume (D-1248's rule)", () => {
    for (const source of ['startup', undefined, 'weird'] as const) {
      fs.rmSync(turnFile(), { force: true });
      stopWith([{ id: 'b1', type: 'shell' }]);
      run(source === undefined ? { hook_event_name: 'SessionStart' } : { hook_event_name: 'SessionStart', source });
      const m = turnMark();
      expect(m, String(source)).toMatchObject({ state: 'done', bg: 0, lostBg: 1, lostKinds: 'shell', lostIds: 'b1' });
      expect(m.restartAt, String(source)).toBe(m.at);
    }
  });

  it('a resume after a working line keeps turnAt > stopAt and adds no lost', () => {
    stopWith([{ id: 'b1', type: 'shell' }, { id: 'b2', type: 'shell' }]);
    run({ hook_event_name: 'UserPromptSubmit' });   // the next turn: working, lost* cleared, bg 2 carried
    const working = turnMark();
    expect(working.state).toBe('working');
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    const m = turnMark();
    expect(m).toMatchObject({ state: 'done', turnAt: working.turnAt, stopAt: working.stopAt, bg: 0, lostBg: 0,
      lostKinds: '', lostIds: '' });
    expect(m.turnAt).toBeGreaterThan(m.stopAt);
    expect(m.restartAt).toBe(m.at);
  });

  it('a resume under a different session id writes a fresh line with restartAt', () => {
    stopWith(THREE);
    run({ hook_event_name: 'SessionStart', source: 'resume' }, { CLAUDE_CODE_SESSION_ID: 'uuid-2' });
    const m = turnMark();
    expect(m).toEqual({ v: 1, sessionId: 'uuid-2', state: 'done', event: 'SessionStart', at: m.at, turnAt: null,
      stopAt: null, bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: m.at, lostBg: 0, lostKinds: '',
      lostIds: '' });
  });

  it('clear writes the fresh line', () => {
    stopWith(THREE);
    run({ hook_event_name: 'SessionStart', source: 'clear' });
    const m = turnMark();
    expect(m).toEqual({ v: 1, sessionId: 'uuid-1', state: 'done', event: 'SessionStart', at: m.at, turnAt: null,
      stopAt: null, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '',
      lostIds: '' });
  });

  it('compact leaves the marker byte-identical (D-306: it fires mid-turn)', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    const past = new Date(Date.now() - 3_600_000);
    fs.utimesSync(turnFile(), past, past);
    const bytes = turnRaw();
    const mtime = fs.statSync(turnFile()).mtimeMs;
    run({ hook_event_name: 'SessionStart', source: 'compact' });
    expect(turnRaw()).toBe(bytes);
    expect(fs.statSync(turnFile()).mtimeMs).toBe(mtime);
  });

  it('a previous bg of -1 (unmeasured) adds 0 to lostBg, never subtracts', () => {
    plantTurn(JSON.stringify({ v: 1, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: 2000, turnAt: 1000,
      stopAt: 2000, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 2, lostKinds: 'shell',
      lostIds: 'b1' }) + '\n');
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    expect(turnMark()).toMatchObject({ state: 'done', turnAt: 1000, stopAt: 2000, bg: 0, lostBg: 2,
      lostKinds: 'shell', lostIds: 'b1' });
  });

  it('the lost ids are the previous lost ids then the dead bg ids, cut to the FIRST 8 (fiti)', () => {
    plantTurn(JSON.stringify({ v: 1, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: 2000, turnAt: 1000,
      stopAt: 2000, bg: 6, bgKinds: 'shell', bgIds: 'b1,b2,b3,b4,b5,b6', err: null, restartAt: null, lostBg: 6,
      lostKinds: 'shell', lostIds: 'l1,l2,l3,l4,l5,l6' }) + '\n');
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    // The program joins the previous lost ids FIRST and the dead bg ids after, with no sort and no dedupe, and
    // keeps 8 of the 12: the six lost ids, then b1 and b2.
    expect(turnMark()).toMatchObject({ state: 'done', bg: 0, bgIds: '', lostBg: 12, lostIds: 'l1,l2,l3,l4,l5,l6,b1,b2' });
  });

  it('the lost kinds are the sorted union cut to WHOLE aliases inside 200 bytes: no half alias, no trailing comma (fitk)', () => {
    const k = (c: string): string => c.repeat(60);   // letters only: the alias charset is [a-z_-]
    const lost = [k('a'), k('c'), k('e')].join(',');   // 182 bytes, fits on its own
    const dead = [k('b'), k('d')].join(',');   // 121 bytes, fits on its own
    expect(lost.length).toBeLessThanOrEqual(200);
    expect(dead.length).toBeLessThanOrEqual(200);
    plantTurn(JSON.stringify({ v: 1, sessionId: 'uuid-1', state: 'done', event: 'Stop', at: 2000, turnAt: 1000,
      stopAt: 2000, bg: 2, bgKinds: dead, bgIds: '', err: null, restartAt: null, lostBg: 3, lostKinds: lost,
      lostIds: '' }) + '\n');
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    const kinds = turnMark().lostKinds as string;
    // The union sorts to a..e (304 bytes); a, b and c fill 182, and d or e would make 243.
    expect(kinds).toBe([k('a'), k('b'), k('c')].join(','));
    expect(kinds.length).toBeLessThanOrEqual(200);
    expect(kinds.endsWith(',')).toBe(false);
    expect(kinds.split(',').every((a) => [k('a'), k('b'), k('c'), k('d'), k('e')].includes(a))).toBe(true);
    expect(turnMark().lostBg).toBe(5);
  });

  it('a resume after a failed line flips it to done, keeps err, turnAt and stopAt, and moves no tasks into lost*', () => {
    stopWith(THREE);
    run({ hook_event_name: 'UserPromptSubmit' });   // working: bg 3 and its kinds and ids carried, lost* cleared
    run({ hook_event_name: 'StopFailure', error: 'server_error' });
    const failed = turnMark();
    expect(failed).toMatchObject({ state: 'failed', err: 'server_error', bg: 3, bgKinds: 'shell,subagent', bgIds: 'b1,b2,b3' });
    run({ hook_event_name: 'SessionStart', source: 'resume' });
    const m = turnMark();
    // Only a same-session DONE line's tasks are moved. A failed line's are dropped: bg, bgKinds and bgIds reset,
    // lostBg stays 0 and the lost lists stay empty.
    expect(m).toEqual({ ...failed, state: 'done', event: 'SessionStart', at: m.at, restartAt: m.at, bg: 0, bgKinds: '',
      bgIds: '', lostBg: 0, lostKinds: '', lostIds: '' });
    expect(m.err).toBe('server_error');
  });
});

// The payload parse runs on EVERY event, so it calls no regex builtin. jq's regex engine
// (Oniguruma) is an optional build dependency: a jq built without it fails every `test`/`gsub`, and the parse used to
// gsub, so such a box wrote no hookstate and no marker for any event. The Stop and StopFailure arms keep their regexes:
// they feed the marker's bg/kinds/ids and err alone, so on such a box a Stop writes bg -1 (unmeasured) and a
// StopFailure an empty err (failed-unknown), and the hookstate write is untouched. That holds for the Stop arm because
// its program is all-or-nothing: a jq without Oniguruma does not refuse a program up front, it fails at the first
// regex call at RUNTIME, so a program that printed the count first would leave bg N beside empty kinds and ids. The
// arm emits its three lines only together, and the stand-in below fails the way the real jq does, at runtime.
describe('the payload parse needs no regex engine', () => {
  /** A jq stand-in for one built without Oniguruma. It RUNS the real jq, with the program prefixed by definitions
   *  that shadow every regex builtin with one that raises, so the program executes up to its first regex call and
   *  then fails with status 5, exactly as the real failure looks (an up-front refusal would hide a program that
   *  prints before it fails). The program is the first non-option argument; `--arg`, `--argjson` and the other
   *  two-value options carry a name and a value that are not it. */
  const noRegexJq = (): void => {
    const real = execFileSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).trim();
    const raise = 'error("jq was compiled without ONIGURUMA regex library")';
    const defs = [
      'test(a)', 'test(a; b)', 'match(a)', 'match(a; b)', 'capture(a)', 'capture(a; b)', 'scan(a)', 'scan(a; b)',
      'splits(a)', 'splits(a; b)', 'split(a; b)', 'sub(a; b)', 'sub(a; b; c)', 'gsub(a; b)', 'gsub(a; b; c)',
    ].map((d) => `def ${d}: ${raise}; `).join('');
    fs.writeFileSync(path.join(home, 'bin', 'jq'), [
      '#!/bin/bash',
      `defs='${defs}'`,
      'args=(); seen=0',
      'while (($#)); do',
      '  a="$1"; shift',
      '  if ((seen == 0)); then',
      '    case "$a" in',
      '      --arg|--argjson|--slurpfile|--rawfile) args+=("$a" "$1" "$2"); shift 2; continue ;;',
      '      -*) args+=("$a"); continue ;;',
      '      *) args+=("$defs$a"); seen=1; continue ;;',
      '    esac',
      '  fi',
      '  args+=("$a")',
      'done',
      `exec '${real}' "\${args[@]}"`,
      '',
    ].join('\n'), { mode: 0o755 });
  };

  it('CONTROL: the stand-in fails a regex program at runtime, runs a plain one, and prints what a program emitted before its regex call', () => {
    noRegexJq();
    const jq = (prog: string) => spawnSync('jq', ['-n', prog], { encoding: 'utf8', env: hookEnv({}) });
    expect(jq('"a" | test("a")').status).toBe(5);
    expect(jq('"a" | gsub("a"; "b")').status).toBe(5);
    expect(jq('"a" | explode | implode').stdout.trim()).toBe('"a"');
    // Runtime fidelity: the first value is printed, THEN the regex call fails. An up-front refusal prints nothing.
    const partial = jq('1, ("a" | test("a"))');
    expect(partial.stdout.trim()).toBe('1');
    expect(partial.status).not.toBe(0);
    // The program is found after an option and the two-value options: the hook's marker writer passes `--arg`s.
    const withArgs = spawnSync('jq', ['-cn', '--arg', 'x', 'a', '--argjson', 'n', '1', '$x | test("a")'],
      { encoding: 'utf8', env: hookEnv({}) });
    expect(withArgs.status).toBe(5);
  });

  it('with no regex engine, every main event still writes the hookstate and the marker; a Stop degrades to bg -1', () => {
    noRegexJq();
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(readState()).toMatchObject({ state: 'working', event: 'UserPromptSubmit' });
    expect(turnMark()).toMatchObject({ state: 'working', event: 'UserPromptSubmit', sessionId: 'uuid-1' });
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' } });
    expect(readState()).toMatchObject({ state: 'working', event: 'PostToolUse' });
    run({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell' }] });
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop' });
    expect(turnMark()).toMatchObject({ state: 'done', event: 'Stop', bg: -1, bgKinds: '', bgIds: '' });
  });

  it('the cleaning is unchanged: a stripped event name still reaches its arm, and a stripped session id is the marker id', () => {
    run({ hook_event_name: 'Sto-pé ' });
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop' });
    expect(turnMark()).toMatchObject({ state: 'done', event: 'Stop' });
    fs.rmSync(turnFile());
    run({ hook_event_name: 'UserPromptSubmit', session_id: 'sess_9-é;x 7' }, { CLAUDE_CODE_SESSION_ID: '' });
    expect(turnMark().sessionId).toBe('sess_9-x7');
  });
});

// The writer and the reader agree (F2). The hook fits the kinds list whole-alias-first under 200 bytes, and
// `readTurnMarkMeasured` refuses anything else as malformed. So a line this hook wrote must read back `ok`, with
// every kind a whole alias it was sent.
describe('the turn marker round trip: a hook-written line reads back ok (§5.1)', () => {
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
  /** Forty distinct aliases `aa<tail>`…`bn<tail>`, already in the hook's cleaned alphabet and in sorted order. */
  const aliases = (tail: string): string[] =>
    Array.from({ length: 40 }, (_, i) => `${LETTERS[Math.floor(i / 26)]}${LETTERS[i % 26]}${tail}`);
  const stopWith = (types: readonly string[]): void => {
    run({ hook_event_name: 'Stop', background_tasks: types.map((type, i) => ({ id: `t${i}`, type })) });
  };
  const readBack = () =>
    readTurnMarkMeasured(localIO, path.join(home, '.cc-sessions'), 'demo-quiet-basin', 'uuid-1', { startedAt: 0 });

  it('forty 8-byte aliases: the fit keeps the first 22 whole (197 bytes), and the reader takes the line', async () => {
    const sent = aliases('-alias');
    stopWith(sent);
    const r = await readBack();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.state).toBe('done');
    expect(r.bg).toBe(40);
    expect(r.bgKinds).toEqual([...sent].sort().slice(0, 22));
    expect(r.bgKinds.join(',')).toHaveLength(197);
    expect(r.bgIds).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']);
  });

  it('forty 7-byte aliases: a byte cut at 200 would end on a comma; the fit keeps 25 whole (199 bytes), read ok', async () => {
    const sent = aliases('-kind');
    stopWith(sent);
    const r = await readBack();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.bgKinds).toEqual([...sent].sort().slice(0, 25));
    expect(r.bgKinds.join(',')).toHaveLength(199);
  });
});
