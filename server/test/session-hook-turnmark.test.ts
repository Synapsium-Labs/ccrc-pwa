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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

/** The delegation join record (`<id>.joined`, delegation broker wave 3): one agent id per line, exactly as the payload sent it
 *  (only an id that is already a plain `[A-Za-z0-9_-]{1,64}` is ever recorded), appended by a SubagentStart. `undefined`
 *  when the file is absent, so "nothing was ever joined" reads differently from an empty list. Past 128 lines a Start
 *  renames the whole file to `<id>.joinedprev`, and membership is the union of the two. */
const joinFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.joined');
const prevFile = (): string => path.join(home, '.cc-sessions', 'demo-quiet-basin.joinedprev');
const idsOf = (f: string): string[] | undefined =>
  (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : undefined);
const joined = (): string[] | undefined => idsOf(joinFile());
const joinedPrev = (): string[] | undefined => idsOf(prevFile());
const joinedAll = (): string[] => [...(joinedPrev() ?? []), ...(joined() ?? [])];

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

  // A subagent here is an id with a qualifying join (a SubagentStart for it in this owner's hookstate): a bare
  // agent_id is not one, and the describe at the end of this file pins that.
  it('a subagent PostToolUse after a main Stop leaves the done line byte-identical (the parse row)', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'SubagentStart', agent_id: 'a-1', agent_type: 'general-purpose' });
    run({ hook_event_name: 'Stop' });
    const done = turnRaw();
    expect(JSON.parse(done).state).toBe('done');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', agent_id: 'a-1' });
    expect(turnRaw()).toBe(done);
  });

  it('a joined agent_id never touches the marker; an empty one is the main thread', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'SubagentStart', agent_id: 'a-1', agent_type: 'general-purpose' });
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
    run({ hook_event_name: 'SubagentStart', agent_id: 'a-1', agent_type: 'general-purpose' });
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

  it('with no regex engine, a StopFailure leaves the hookstate alone and the marker reads failed with an empty err', () => {
    noRegexJq();
    run({ hook_event_name: 'UserPromptSubmit' });
    const before = fs.readFileSync(stateFile());
    run({ hook_event_name: 'StopFailure', error: 'server_error' });
    expect(fs.readFileSync(stateFile()), 'a StopFailure never touches the hookstate').toEqual(before);
    const m = turnMark();
    expect(m).toMatchObject({ state: 'failed', event: 'StopFailure', err: '', sessionId: 'uuid-1' });
    expect(m.stopAt).toBe(m.at);
  });

  it('with no regex engine, a SubagentStart still joins and its events still stay off the marker, while a bare id stays the main thread (delegation broker wave 3)', () => {
    noRegexJq();
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'SubagentStart', agent_id: 'a-1', agent_type: 'general-purpose' });
    expect(joined(), 'the join was recorded under a jq that has no regex engine').toEqual(['a-1']);
    run({ hook_event_name: 'Stop' });
    const done = turnRaw();
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, agent_id: 'a-1' });
    expect(turnRaw(), 'the joined id').toBe(done);
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, agent_id: 'a-bare' });
    expect(turnMark().state, 'the bare id').toBe('working');
    expect(joined(), 'and the record is untouched by the main events').toEqual(['a-1']);
  });

  /** The regex builtins a jq built without Oniguruma cannot run; `sub(` covers `gsub(`. */
  const regexCalls = (program: string): string[] => program.match(/(?:test|match|capture|scan|splits|sub)\(/g) ?? [];

  it('STATIC: the payload parse and every branch of the marker program name no regex builtin, run or not', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    /** The text between a unique opener and the first `close` after it. Found by content, never by line number. */
    const between = (open: string, close: string): string => {
      expect(src.split(open).length - 1, `the hook carries exactly one ${JSON.stringify(open)}`).toBe(1);
      const from = src.indexOf(open) + open.length;
      return src.slice(from, src.indexOf(close, from));
    };
    // THREE PIECES, one jq program (delegation broker wave 3, Task 5): the parse proper, which every event compiles and which
    // is spelled on one physical line because nothing may be added above the `_hook_emit_context "$CARD" "$CARD_COMPACT"` line README cites; the delegation spool's definitions (`DSP_DEFS`), spliced in
    // by the shell only for a payload that names a delegation tool or event; and the spool's extra output expression. All
    // three are scanned, because a regex builtin in any of them fails the whole program on a jq without Oniguruma.
    const parse = between('{ read -r event; read -r psid; read -r paid; read -r aid; read -r dsp_bucket; read -r dsp_cut; read -r dsp_cwd; read -r dsp_line; } < <(jq -r --arg sid "$id" --arg gen "$dsp_gen" --arg ver "$dsp_ver" \'', '" <<<"$payload"');
    const spoolDefs = between("DSP_DEFS='", "'; dsp_dir=");
    const spoolOut = between("dsp_out=', ((", ") | .[])'");
    const mark = between('TURN_MARK_PROGRAM=\'\n', '\'\n');
    // Landmarks, so a renamed variable or a moved quote cannot leave this scanning nothing: each extraction must open
    // and close on the program's own text.
    expect(parse.startsWith('def keep(f):'), 'the payload parse program opens on its first definition').toBe(true);
    expect(parse).toContain('.agent_id');
    expect(parse.endsWith('else "" end)\'"$dsp_out'), 'and closes on its last term, the raw id or nothing, then the spool\'s output').toBe(true);
    expect(parse, 'the id alphabet and its length bound are spelled once, by name').toContain('def idch:');
    expect(parse).toContain('def idmax: 64;');
    expect(spoolDefs.startsWith('def maxline:'), 'the spool\'s definitions open on their first').toBe(true);
    expect(spoolDefs.endsWith('else ["", "", "", ""] end;'), 'and close on the end of `spool`').toBe(true);
    expect(spoolOut).toContain('try spool catch');
    expect(mark.startsWith('def csv:'), 'the marker program opens on its first definition').toBe(true);
    for (const kind of ['working', 'done', 'failed', 'restart', 'clear']) expect(mark, kind).toContain(`$kind == "${kind}"`);
    expect(mark.endsWith('else empty end'), 'and closes on its last branch').toBe(true);
    // CONTROL: the scan sees a regex builtin when there is one, `gsub` through its `sub(`.
    expect(regexCalls('. | test("x") | gsub("a"; "b") | capture("c") | scan("d")')).toEqual(['test(', 'sub(', 'capture(', 'scan(']);
    expect(regexCalls(parse), 'the payload parse runs on every event').toEqual([]);
    expect(regexCalls(spoolDefs), 'the spool\'s program runs on every delegation event, and a regex failure there would cost the hookstate too').toEqual([]);
    expect(regexCalls(spoolOut)).toEqual([]);
    expect(regexCalls(mark), 'a marker branch that no row runs is still bound').toEqual([]);
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

// ── SessionEnd (delegation broker wave 1, spec §5.3): registered, captured in a -hookcap
// session, and otherwise inert — no hookstate, no turn marker, nothing printed. A quitting
// session must not look like activity to the stall watch (STALL_PLUMBING_EVENTS). ──
describe('SessionEnd (delegation broker §5.3)', () => {
  const markFile = (id = 'demo-quiet-basin'): string => path.join(reg(), `${id}.turn.json`);

  it('prints nothing on either stream and exits 0', () => {
    expect(runFull({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' })).toEqual({ stdout: '', stderr: '' });
  });

  it('writes no hookstate.json when none existed, and no turn marker', () => {
    run({ hook_event_name: 'SessionEnd', reason: 'clear' });
    expect(fs.existsSync(stateFile())).toBe(false);
    expect(fs.existsSync(markFile())).toBe(false);
  });

  it('control: a Stop in the same fixture writes both', () => {
    run({ hook_event_name: 'Stop' });
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop' });
    expect(fs.existsSync(markFile())).toBe(true);
  });

  it('leaves an existing hookstate.json and turn marker byte-identical', () => {
    run({ hook_event_name: 'UserPromptSubmit' });
    const state = fs.readFileSync(stateFile());
    const mark = fs.readFileSync(markFile());
    run({ hook_event_name: 'SessionEnd', reason: 'logout' });
    expect(fs.readFileSync(stateFile())).toEqual(state);
    expect(fs.readFileSync(markFile())).toEqual(mark);
  });

  it('is captured in a -hookcap session as one .cap file, and still writes no hookstate', () => {
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\necho "cc-demo-hookcap"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(reg(), 'demo-hookcap.generation'), GENERATION);
    run({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    const dir = path.join(home, '.ccrc', 'hook-capture', 'demo-hookcap');
    const caps = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith('SessionEnd-') && n.endsWith('.cap')) : [];
    expect(caps).toHaveLength(1);
    const [meta, body] = fs.readFileSync(path.join(dir, caps[0] as string), 'utf8').split('\n');
    expect(meta).toBe('{"envSid":"uuid-1"}');
    expect(JSON.parse(body as string)).toEqual({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    expect(fs.existsSync(path.join(reg(), 'demo-hookcap.hookstate.json'))).toBe(false);
    expect(fs.existsSync(markFile('demo-hookcap'))).toBe(false);
  });
});


// ── A bare agent_id is not a subagent (delegation broker wave 3, Task 2) ──
// The turn marker used to read ANY non-empty `agent_id` as a subagent's event and write nothing. The real
// lanes show why that is wrong (ledger amendment `tool-agent-id-alone-is-unjoined-evidence`): a main-checkout
// PreToolUse carried an `agent_id` that no launch response, SubagentStart or SubagentStop ever named, so the
// parent's own tool call went unrecorded. Now only an id with a QUALIFYING JOIN — a SubagentStart for that id,
// recorded in this owner's join file `<id>.joined` — is a subagent to the marker. A join is a fact, not liveness:
// the SubagentStop does not take it back, and an unpaired SubagentStop (`post-turn-subagentstop-is-unpaired`, and the
// /compact one) never gives it. `$paid` itself is untouched (the spool gate, the role-skill guard and the wait rules
// still read "any id"). The join lives in a file of its own, appended with one short write, because hookstate.json is
// rewritten whole by every event and a join kept there was lost to a concurrent hook (the concurrency rows below).
describe('only an agent id with a qualifying join is a subagent to the turn marker (delegation broker wave 3)', () => {
  const start = (id: unknown, extra: Record<string, unknown> = {}): void => {
    run({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'general-purpose', ...extra });
  };
  /** The stop of a joined subagent carries its type; the UNPAIRED stops of the real lanes (post-turn, /compact) carry none. */
  const stop = (id: string, agent_type = 'general-purpose'): void => {
    run({ hook_event_name: 'SubagentStop', agent_id: id, agent_type });
  };
  const tool = (id: unknown, event: 'PreToolUse' | 'PostToolUse' = 'PreToolUse', extra: Record<string, unknown> = {}): void => {
    run({ hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'true' }, agent_id: id, ...extra });
  };
  /** A finished main turn with the hookstate in place: the done line. */
  const doneLine = (): string => {
    run({ hook_event_name: 'UserPromptSubmit' });
    run({ hook_event_name: 'Stop' });
    expect(turnMark().state, 'fixture: the main turn is done').toBe('done');
    return turnRaw();
  };
  /** Is `id` a subagent to the marker? Measured by behaviour, the only thing that matters: a tool event under it, over a
   *  done line, leaves the line alone (joined) or re-opens the turn (not). Every call starts from its own Stop. */
  const isJoined = (id: unknown): boolean => {
    run({ hook_event_name: 'Stop' });
    const done = turnRaw();
    tool(id);
    return turnRaw() === done;
  };
  /** One hook process, started now: resolves when it exits 0. */
  const runAsync = (payload: object): Promise<void> => new Promise((resolve, reject) => {
    const child = spawn('bash', [HOOK], { env: hookEnv({}), stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`the hook exited ${code}`))));
    child.stdin.end(JSON.stringify(payload));
  });
  const later = (ms: number, payload: object): Promise<void> =>
    new Promise((resolve, reject) => { setTimeout(() => { runAsync(payload).then(resolve, reject); }, ms); });

  it('a main PreToolUse carrying an agent_id nobody joined is the main thread: it stamps working', () => {
    doneLine();
    const done = turnMark();
    tool('a-unknown');
    const m = turnMark();
    expect(m).toMatchObject({ state: 'working', event: 'PreToolUse', stopAt: done.stopAt });
    expect(m.at).toBeGreaterThan(done.at);
    expect(m.turnAt).toBe(m.at);
    expect(joined(), 'a tool event joins nobody').toBeUndefined();
  });

  it('every event the marker reads is the main thread when its id is unjoined', () => {
    doneLine();
    tool('a-bare', 'PostToolUse');
    expect(turnMark()).toMatchObject({ state: 'working', event: 'PostToolUse' });
    run({ hook_event_name: 'Stop', agent_id: 'a-bare' });
    expect(turnMark()).toMatchObject({ state: 'done', event: 'Stop' });
    run({ hook_event_name: 'StopFailure', error: 'server_error', agent_id: 'a-bare' });
    expect(turnMark()).toMatchObject({ state: 'failed', event: 'StopFailure', err: 'server_error' });
    run({ hook_event_name: 'UserPromptSubmit', agent_id: 'a-bare' });
    const m = turnMark();
    expect(m).toMatchObject({ state: 'working', event: 'UserPromptSubmit' });
    expect(m.turnAt).toBe(m.at);
  });

  it('a qualifying SubagentStart, then its events: the marker is not touched, whatever the event', () => {
    const done = doneLine();
    start('a-1');
    for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const) {
      tool('a-1', 'PreToolUse', { hook_event_name: ev });
      expect(turnRaw(), `${ev} from the joined subagent`).toBe(done);
    }
    run({ hook_event_name: 'StopFailure', error: 'server_error', agent_id: 'a-1' });
    expect(turnRaw(), 'StopFailure from the joined subagent').toBe(done);
    expect(joined()).toEqual(['a-1']);
  });

  it('agent_type is no evidence either way: empty or absent on a join still joins; any type on an unjoined id does not', () => {
    const done = doneLine();
    start('a-empty', { agent_type: '' });
    run({ hook_event_name: 'SubagentStart', agent_id: 'a-notype' });
    expect(joined()).toEqual(['a-empty', 'a-notype']);
    tool('a-empty', 'PreToolUse', { agent_type: '' });
    tool('a-notype', 'PostToolUse');
    tool('a-empty', 'PostToolUse', { agent_type: 'something-else' });
    expect(turnRaw(), 'joined ids stay subagents under every agent_type').toBe(done);
    for (const agent_type of ['', 'general-purpose', 'workflow-subagent']) {
      tool('a-bare', 'PreToolUse', { agent_type });
      expect(turnMark().state, `an unjoined id with agent_type ${JSON.stringify(agent_type)}`).toBe('working');
      run({ hook_event_name: 'Stop' });   // back to done for the next lap
    }
  });

  it('a join is a fact, not liveness: a late event of a STOPPED subagent is still not a main turn', () => {
    const done = doneLine();
    start('a-1');
    expect(readState()['subagents']).toHaveLength(1);
    stop('a-1');
    expect(readState()['subagents'], 'the live list gave it up').toEqual([]);
    expect(joined(), 'the join did not').toEqual(['a-1']);
    tool('a-1', 'PostToolUse');
    expect(turnRaw()).toBe(done);
  });

  it('post-turn-subagentstop-is-unpaired: an unpaired SubagentStop admits nothing, and the id it names stays the main thread', () => {
    const done = doneLine();
    stop('a-9', '');   // the real shape: after the parent's Stop, an id, an EMPTY agent_type, no SubagentStart
    expect(joined(), 'no join recorded').toBeUndefined();
    expect(turnRaw(), 'and the stop itself touched no marker').toBe(done);
    tool('a-9', 'PreToolUse');
    expect(turnMark()).toMatchObject({ state: 'working', event: 'PreToolUse' });
  });

  it('post-turn-subagentstop-is-unpaired: beside a real join it changes neither answer (the joined id stays joined, the unpaired one stays unjoined)', () => {
    const done = doneLine();
    start('a-1');
    stop('a-9', '');
    stop('a-1');
    expect(joined()).toEqual(['a-1']);
    tool('a-1', 'PostToolUse');
    expect(turnRaw(), 'the stopped, joined id').toBe(done);
    tool('a-9', 'PostToolUse');
    expect(turnMark().state, 'the unpaired id').toBe('working');
  });

  it('a SubagentStart before any hookstate still records its join: the record needs only the live row', () => {
    start('a-1');
    expect(fs.existsSync(stateFile()), 'fixture: the Start wrote no hookstate').toBe(false);
    expect(joined()).toEqual(['a-1']);
    const done = doneLine();
    tool('a-1');
    expect(turnRaw(), 'and its events stay off the marker').toBe(done);
  });

  it('a SubagentStart with no usable id (absent, empty, or not a plain id) joins nobody', () => {
    doneLine();
    run({ hook_event_name: 'SubagentStart', agent_type: 'general-purpose' });
    run({ hook_event_name: 'SubagentStart', agent_id: '', agent_type: 'general-purpose' });
    run({ hook_event_name: 'SubagentStart', agent_id: 'é;é', agent_type: 'general-purpose' });
    expect(joined()).toBeUndefined();
    expect(readState()['subagents'], 'the live list still counts them, as before').toHaveLength(3);
    tool('é;é');
    expect(turnMark().state, 'an id that is not a plain id is never joined').toBe('working');
  });

  it('the membership is the RAW id: one that is not already 1-64 of [A-Za-z0-9_-] is never recorded and never suppresses the marker', () => {
    doneLine();
    start('a-1');
    expect(isJoined('a-1'), 'control: a plain id joins').toBe(true);
    const long64 = `L${'x'.repeat(63)}`;
    start(long64);
    expect(isJoined(long64), 'the 64-character edge joins').toBe(true);
    const bad: unknown[] = ['a 1', 'a;1', 'é1', 'a-1\n', ' a-1', 'a-1;', 'A-1x;', `${long64}y`, 7, true, ['a-1'], { id: 'a-1' }];
    for (const raw of bad) {
      const before = joined();
      start(raw);
      expect(joined(), `${JSON.stringify(raw)} was not recorded`).toEqual(before);
      expect(isJoined(raw), `${JSON.stringify(raw)} is the main thread`).toBe(false);
    }
    // THE LOOKALIKE: 'a-1;' cleans to the joined 'a-1', and a cleaned match would let it ride that join.
    expect(isJoined('a-1;'), 'a lookalike of a joined id').toBe(false);
    expect(isJoined('a-1'), 'and the joined id itself is unharmed').toBe(true);
  });

  it('an id is matched whole: a joined id does not make its prefix, its extension or a neighbour a subagent', () => {
    doneLine();
    start('a-12');
    start('b');
    const done = turnRaw();
    tool('a-12');
    tool('b', 'PostToolUse');
    expect(turnRaw(), 'fixture: the joined ids are subagents').toBe(done);
    for (const other of ['a-1', 'a-', 'a', '12', 'a-123', 'a-12b', '-12', 'a12']) {
      tool(other);
      expect(turnMark().state, `${other} is not a joined id`).toBe('working');
      run({ hook_event_name: 'Stop' });
    }
  });

  it('the record is append-only: a repeated start lists the id twice, and no other event rewrites the file', () => {
    doneLine();
    start('a-1');
    start('a-2');
    start('a-1');
    expect(joined()).toEqual(['a-1', 'a-2', 'a-1']);
    const bytes = fs.readFileSync(joinFile());
    const mtime = fs.statSync(joinFile()).mtimeMs;
    run({ hook_event_name: 'UserPromptSubmit' });
    tool('a-1', 'PreToolUse');
    stop('a-1');
    run({ hook_event_name: 'Stop' });
    expect(fs.readFileSync(joinFile()), 'main events, tool events and a stop leave it byte-identical').toEqual(bytes);
    expect(fs.statSync(joinFile()).mtimeMs).toBe(mtime);
  });

  describe('the record rotates by RENAME: no append is lost, and membership is the last 129 to 257 ids', () => {
    // Past 128 lines the Start that notices renames `<id>.joined` to `<id>.joinedprev` whole (`mv -f`, one rename(2)), under a
    // `flock -n` on its own descriptor and after checking that the path still names the inode it locked. An appender whose
    // descriptor opened the old inode writes into what is now joinedprev, so nothing is dropped, and membership is the union
    // of the two files. Nothing is rewritten: the old tail+rewrite lost every append that landed inside its window.
    const hasFlock = spawnSync('sh', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
    const plant = (n: number, file = joinFile(), tag = 'j'): string[] => {
      const ids = Array.from({ length: n }, (_, i) => `${tag}${i}`);
      fs.writeFileSync(file, `${ids.join('\n')}\n`);
      return ids;
    };
    const shadow = (body: string): Record<string, string> => {
      const f = path.join(home, 'shadow.sh');
      fs.writeFileSync(f, `${body}\n`);
      return { BASH_ENV: f };
    };

    it('at 128 lines it only appends; the 129th renames the whole file to joinedprev, and the next Start begins a new one', () => {
      doneLine();
      const ids = plant(127);
      start('j-new');
      expect(joined(), 'the 128th line: appended').toEqual([...ids, 'j-new']);
      expect(fs.existsSync(prevFile()), 'and no rotation').toBe(false);
      start('j-newer');
      expect(joinedPrev(), 'the 129th: the whole file moved, nothing dropped').toEqual([...ids, 'j-new', 'j-newer']);
      expect(joined(), 'and the path is free for the next append').toBeUndefined();
      start('j-after');
      expect(joined()).toEqual(['j-after']);
      expect(joinedPrev()).toHaveLength(129);
      expect(fs.readdirSync(reg()).filter((n) => n.includes('.hook-write.') || n.endsWith('.tmp')), 'no temp').toEqual([]);
    });

    it('membership is the union: an id in joinedprev is a subagent, and the next rotation retires the first file', () => {
      doneLine();
      plant(129, prevFile(), 'old');
      plant(128, joinFile(), 'cur');
      expect(isJoined('old5'), 'found in joinedprev').toBe(true);
      expect(isJoined('cur5'), 'found in joined').toBe(true);
      start('x-new');   // 129 lines: joinedprev becomes the cur* file, the old* file is gone
      expect(isJoined('old5'), 'retired with the first file').toBe(false);
      expect(isJoined('cur5')).toBe(true);
      expect(isJoined('x-new')).toBe(true);
    });

    it('an append whose descriptor opened the old file before the rename lands in joinedprev and stays visible', () => {
      doneLine();
      plant(128);
      const fd = fs.openSync(joinFile(), 'a');   // an appender between its open and its write
      try {
        start('j-new');                           // rotates: the path is renamed under the open descriptor
        fs.writeSync(fd, 'late-1\n');
      } finally { fs.closeSync(fd); }
      expect(joinedPrev(), 'the late write went into the renamed file').toContain('late-1');
      expect(isJoined('late-1')).toBe(true);
    });

    it.skipIf(!hasFlock)('a rotator that cannot take the lock skips: the file stays whole and nothing moves', async () => {
      doneLine();
      plant(130);
      // Another rotator mid-rotation: a process holding the lock on the file's inode.
      const holder = spawn('bash', ['-c', 'exec 9<"$0"; flock -n 9 || exit 3; echo locked; read -r _', joinFile()], { stdio: ['pipe', 'pipe', 'ignore'] });
      await new Promise<void>((resolve, reject) => {
        holder.stdout!.once('data', () => resolve());
        holder.once('exit', (code) => reject(new Error(`the lock holder exited ${code}`)));
      });
      try {
        start('j-new');
        expect(joined(), 'the append landed and the file was not touched').toHaveLength(131);
        expect(fs.existsSync(prevFile()), 'no rotation while another holds the lock').toBe(false);
      } finally {
        holder.stdin!.end();
        await new Promise((resolve) => { holder.once('exit', resolve); });
      }
      start('j-after');   // the lock is gone: the next Start retries and rotates
      expect(joinedPrev(), 'the retry rotated').toHaveLength(132);
    });

    it.skipIf(!hasFlock)('a rotator whose path no longer names its inode skips: the -ef re-check', () => {
      doneLine();
      plant(130);
      // Between this Start's open and its lock, ANOTHER rotator renamed the file and a new one was started.
      const env = shadow(`flock() { command mv -f '${joinFile()}' '${prevFile()}'; command printf 'fresh-1\\nfresh-2\\n' > '${joinFile()}'; command flock "$@"; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'b-1', agent_type: 'general-purpose' }, env);
      expect(joinedPrev(), 'the first rotator\'s file is untouched: this Start did not rename the new file over it').toHaveLength(131);
      expect(joinedPrev()).toContain('b-1');
      expect(joined(), 'and the new file stays').toEqual(['fresh-1', 'fresh-2']);
    });

    it('without flock the file is never rotated; the read bound then drops the newest ids, which fails toward the main turn', () => {
      doneLine();
      const long = (i: number): string => `n${String(i).padStart(63, '0')}`;
      fs.writeFileSync(joinFile(), `${Array.from({ length: 300 }, (_, i) => long(i)).join('\n')}\n`);
      const env = shadow(`command() { if [[ "\${1:-}" == -v && "\${2:-}" == flock ]]; then return 1; fi; builtin command "$@"; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: long(999), agent_type: 'general-purpose' }, env);
      expect(fs.existsSync(prevFile()), 'never rotated').toBe(false);
      expect(joined(), 'the file just grows').toHaveLength(301);
      expect(isJoined(long(5)), 'an id inside the read bound').toBe(true);
      expect(isJoined(long(999)), 'the newest id is past the read bound').toBe(false);
    });
  });

  describe('what the file may hold', () => {
    it('garbage content: a line is a join only if it is, whole and newline-terminated, the id', () => {
      doneLine();
      fs.writeFileSync(joinFile(), ['a-1', '', '   ', 'bad id', 'é', 'b-2 ', 'c-3\r', '-d_4', 'e-5'].join('\n'));   // no final newline
      const outcome = Object.fromEntries(['a-1', 'bad', 'id', 'b-2', 'c-3', '-d_4', 'e-5', 'a'].map((id) => [id, isJoined(id)]));
      expect(outcome).toEqual({ 'a-1': true, bad: false, id: false, 'b-2': false, 'c-3': false, '-d_4': true, 'e-5': false, a: false });
    });

    it('a binary or oversized file never matches an id it does not hold, and never breaks the hook', () => {
      doneLine();
      fs.writeFileSync(joinFile(), Buffer.concat([Buffer.from('a-1\n'), Buffer.alloc(40_000, 0xff), Buffer.from('\nz-9\n')]));
      expect(isJoined('a-1'), 'inside the read window').toBe(true);
      expect(isJoined('z-9'), 'past the read window: fails toward the main turn').toBe(false);
      expect(isJoined('q-1')).toBe(false);
    });

    it('a directory, a symlink or a FIFO at the path joins nobody, is never written through, and never blocks the hook', () => {
      doneLine();
      fs.writeFileSync(path.join(home, 'elsewhere'), 'a-1\n');
      for (const make of [
        () => fs.mkdirSync(joinFile()),
        () => fs.symlinkSync(path.join(home, 'elsewhere'), joinFile()),
        () => { execFileSync('mkfifo', [joinFile()]); },
      ]) {
        fs.rmSync(joinFile(), { recursive: true, force: true });
        make();
        for (const payload of [
          { hook_event_name: 'SubagentStart', agent_id: 'a-2', agent_type: 'general-purpose' },
          { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, agent_id: 'a-1' },
        ]) {
          const t0 = Date.now();
          const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv({}), timeout: 20_000 });
          expect(r.status, `${payload.hook_event_name}: exit 0, never blocked`).toBe(0);
          expect(Date.now() - t0).toBeLessThan(15_000);
        }
        expect(fs.readFileSync(path.join(home, 'elsewhere'), 'utf8'), 'nothing was written through').toBe('a-1\n');
        expect(turnMark().state, 'the event under the id the file seems to hold read as the main thread').toBe('working');
        run({ hook_event_name: 'Stop' });
      }
    });
  });

  describe('junk at joinedprev', () => {
    it('a directory, a symlink or a FIFO there is not read, not written through, never blocks the hook, and stops the rotation', () => {
      doneLine();
      fs.writeFileSync(path.join(home, 'elsewhere'), 'zz-9\n');
      for (const make of [
        () => fs.mkdirSync(prevFile()),
        () => fs.symlinkSync(path.join(home, 'elsewhere'), prevFile()),
        () => { execFileSync('mkfifo', [prevFile()]); },
      ]) {
        fs.rmSync(prevFile(), { recursive: true, force: true });
        fs.writeFileSync(joinFile(), `${Array.from({ length: 130 }, (_, i) => `j${i}`).join('\n')}\n`);
        make();
        for (const payload of [
          { hook_event_name: 'SubagentStart', agent_id: 'a-2', agent_type: 'general-purpose' },
          { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, agent_id: 'zz-9' },
        ]) {
          const t0 = Date.now();
          const r = spawnSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv({}), timeout: 20_000 });
          expect(r.status, `${payload.hook_event_name}: exit 0, never blocked`).toBe(0);
          expect(Date.now() - t0).toBeLessThan(15_000);
        }
        expect(fs.readFileSync(path.join(home, 'elsewhere'), 'utf8'), 'nothing was written through').toBe('zz-9\n');
        expect(joined(), 'the rotation was refused, so the file is whole').toHaveLength(131);
        if (fs.statSync(prevFile()).isDirectory()) expect(fs.readdirSync(prevFile()), 'nothing was moved into the directory').toEqual([]);
        expect(turnMark().state, 'the id the junk seems to hold read as the main thread').toBe('working');
        run({ hook_event_name: 'Stop' });
      }
    });
  });

  describe('rotation cannot be turned against a swapped path, and a failed append leaves no orphan (Task 2 review, carried into Task 5)', () => {
    // The rotation checks `jf` (a regular file or nothing, at the top), then opens it on a descriptor, takes `flock -n`, and only
    // then renames: a path that changes after the check is not what `mv -f` should meet. These rows put the change at exactly that
    // point by shadowing `flock` with a shell function (BASH_ENV), so no sleep is involved. GNU `mv -f joined joinedprev` onto a
    // DIRECTORY moves the file INTO it and answers 0; onto a symlink it replaces the link.
    const shadow = (body: string): Record<string, string> => {
      const f = path.join(home, 'shadow.sh');
      fs.writeFileSync(f, `${body}\n`);
      return { BASH_ENV: f };
    };
    const full = (): void => { fs.writeFileSync(joinFile(), `${Array.from({ length: 128 }, (_, i) => `j${i}`).join('\n')}\n`); };
    const hasFlock = spawnSync('sh', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;

    it.skipIf(!hasFlock)('control: with no swap the 129th line renames the whole file to joinedprev', () => {
      doneLine();
      full();
      run({ hook_event_name: 'SubagentStart', agent_id: 'kept-1', agent_type: 'general-purpose' }, shadow('flock() { return 0; }'));
      expect(fs.existsSync(joinFile())).toBe(false);
      expect(joinedPrev()).toHaveLength(129);
    });

    it.skipIf(!hasFlock)('a symlink swapped in for joined AFTER the open (to the same inode, so -ef still says yes) is not renamed onto joinedprev', () => {
      doneLine();
      full();
      const real = path.join(reg(), 'demo-quiet-basin.joined-target');
      const env = shadow(`flock() { command mv '${joinFile()}' '${real}' && command ln -s '${real}' '${joinFile()}'; return 0; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'swap-1', agent_type: 'general-purpose' }, env);
      expect(fs.lstatSync(joinFile()).isSymbolicLink(), 'fixture: the swap happened').toBe(true);
      expect(fs.lstatSync(prevFile(), { throwIfNoEntry: false }), 'the symlink was not renamed onto joinedprev').toBeUndefined();
    });

    it.skipIf(!hasFlock)('a directory that appears at joinedprev AFTER the check is not moved into: the file stays whole and the directory stays empty', () => {
      doneLine();
      full();
      const env = shadow(`flock() { command mkdir '${prevFile()}'; return 0; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'dir-1', agent_type: 'general-purpose' }, env);
      expect(fs.statSync(prevFile()).isDirectory(), 'fixture: the directory appeared').toBe(true);
      expect(fs.readdirSync(prevFile()), 'nothing was moved into it').toEqual([]);
      expect(joined(), 'and the file was not renamed away').toHaveLength(129);
    });

    it('an append that FAILS after the file was created, with the row purged meanwhile, leaves no empty joined behind (the re-check runs on that path too)', () => {
      doneLine();
      const GEN = path.join(reg(), 'demo-quiet-basin.generation');
      // The redirection has created `joined` by the time the shadowed printf runs; it purges the row and fails the write (ENOSPC's shape).
      const env = shadow(`printf() { if [[ "\${1:-}" == '%s\\n' && "\${2:-}" == "orphan-3" ]]; then rm -f '${GEN}'; return 1; fi; builtin printf "$@"; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'orphan-3', agent_type: 'general-purpose' }, env);
      expect(fs.existsSync(GEN), 'fixture: the shadow ran, the row is gone').toBe(false);
      expect(fs.readdirSync(reg()).filter((n) => n.includes('.joined')), 'no empty join record orphaned beside a purged row').toEqual([]);
    });

    it('control: the same failed append with the row standing leaves nothing to clean and the hook exits 0', () => {
      doneLine();
      const env = shadow(`printf() { if [[ "\${1:-}" == '%s\\n' && "\${2:-}" == "failed-1" ]]; then return 1; fi; builtin printf "$@"; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'failed-1', agent_type: 'general-purpose' }, env);
      expect(joined() ?? [], 'a failed write recorded no id').toEqual([]);
    });
  });

  describe('only a live row, and only the pane that owns it, gets a join file', () => {
    it('control: the fixture row\'s own pane writes it', () => {
      start('a-1');
      expect(joined()).toEqual(['a-1']);
    });

    it('a purged row (no .generation) gets none', () => {
      fs.rmSync(path.join(reg(), 'demo-quiet-basin.generation'));
      start('a-1');
      expect(fs.readdirSync(reg()).filter((n) => n.endsWith('.joined'))).toEqual([]);
    });

    it('a pane that names another row, or none, gets none', () => {
      fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\necho "cc-other-row"\n', { mode: 0o755 });
      start('a-1');
      expect(fs.readdirSync(reg()).filter((n) => n.endsWith('.joined')), 'another row without a generation').toEqual([]);
      fs.writeFileSync(path.join(reg(), 'other-row.generation'), GENERATION);
      start('a-1');
      expect(fs.existsSync(path.join(reg(), 'other-row.joined')), 'the pane\'s own row, live: its file').toBe(true);
      expect(fs.existsSync(joinFile()), 'and never the fixture row\'s').toBe(false);
      fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      fs.rmSync(path.join(reg(), 'other-row.joined'));
      start('a-1');
      expect(fs.readdirSync(reg()).filter((n) => n.endsWith('.joined')), 'a tmux that cannot answer').toEqual([]);
    });
  });

  describe('no window orphans a join record (the row can be purged while a Start is writing)', () => {
    // An orphan is a dot-free field: it holds the slug for ever. The hook takes no lock, so the only thing it can do is look again
    // after it has written: if the row's `generation` is gone it removes what it wrote, BOTH names (`joined` and `joinedprev`).
    // These rows drive the window with a shell function that `BASH_ENV` plants in the hook's own shell and that fires on ONE
    // call, the join's append (or the rotation's `mv`), so the purge lands at exactly that point and no sleep is involved.
    // `_reg_purge`'s half of the pair (an append after the loop, before generation goes) is in `ccd-lifecycle-purge.test.ts`.
    const GEN = (): string => path.join(reg(), 'demo-quiet-basin.generation');
    const shadow = (body: string): Record<string, string> => {
      const f = path.join(home, 'shadow.sh');
      fs.writeFileSync(f, `${body}\n`);
      return { BASH_ENV: f };
    };
    const registry = (): string[] => fs.readdirSync(reg()).sort();

    it('control: the shadow fires on the one call it names and the row stands, so the file is kept', () => {
      const env = shadow(`printf() { if [[ "\${1:-}" == '%s\\n' && "\${2:-}" == "orphan-1" ]]; then rm -f '${GEN()}'; fi; builtin printf "$@"; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'other-1', agent_type: 'general-purpose' }, env);
      expect(joined(), 'a different id does not trip it').toEqual(['other-1']);
      expect(fs.existsSync(GEN())).toBe(true);
    });

    it('the row is purged between the Start\'s check and its append: the files the append made and the rotation left are removed', () => {
      fs.writeFileSync(prevFile(), 'old-1\n');   // a rotation's file from earlier in the row's life
      const env = shadow(`printf() { if [[ "\${1:-}" == '%s\\n' && "\${2:-}" == "orphan-1" ]]; then rm -f '${GEN()}'; fi; builtin printf "$@"; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'orphan-1', agent_type: 'general-purpose' }, env);
      expect(fs.existsSync(GEN()), 'fixture: the shadow ran, the row is gone').toBe(false);
      expect(fs.existsSync(joinFile()), 'no join record orphaned beside a purged row').toBe(false);
      expect(fs.existsSync(prevFile()), 'nor its rotation file').toBe(false);
      expect(registry().filter((n) => n.includes('.joined') || n.endsWith('.tmp')), 'and no temp').toEqual([]);
    });

    it('the row is purged while a ROTATION runs: the rename that makes joinedprev is followed by the same check, which removes both names', () => {
      fs.writeFileSync(joinFile(), `${Array.from({ length: 128 }, (_, i) => `j${i}`).join('\n')}\n`);
      // The purge (its glob already past both names) takes `generation` just after the rotation's rename made `joinedprev`.
      const env = shadow(`mv() { command mv "$@"; rm -f '${GEN()}'; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'orphan-2', agent_type: 'general-purpose' }, env);
      expect(fs.existsSync(GEN()), 'fixture: the shadow ran, the row is gone').toBe(false);
      expect(registry().filter((n) => n.includes('.joined') || n.includes('.hook-write.')), 'no file and no temp left').toEqual([]);
    });

    it('control: the same rotation with the row standing leaves the whole file as joinedprev', () => {
      fs.writeFileSync(joinFile(), `${Array.from({ length: 128 }, (_, i) => `j${i}`).join('\n')}\n`);
      const env = shadow(`mv() { command mv "$@"; }`);
      run({ hook_event_name: 'SubagentStart', agent_id: 'kept-1', agent_type: 'general-purpose' }, env);
      expect(joinedPrev()).toHaveLength(129);
      expect(joinedPrev()!.at(-1)).toBe('kept-1');
    });
  });

  describe('concurrent hooks never lose a join (the record is not read-modified-written)', () => {
    /** The ids whose events the marker does NOT treat as a subagent's. */
    const lost = (ids: string[]): string[] => ids.filter((id) => !isJoined(id));

    it('agent-input-keys-are-the-callers: a SubagentStart beside the parent\'s Agent launch event and a joined sibling\'s event, 24 times, mostly Start-first', async () => {
      doneLine();
      start('sib');
      const ids: string[] = [];
      const DELAYS = [3, 8, 15, 30];
      for (let i = 0; i < 24; i += 1) {
        const id = `c${i}`;
        ids.push(id);
        // The launch event as the real lanes send it: no `subagent_type` in the Agent tool_input.
        const launch = { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { prompt: 'x' } };
        const sibling = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, agent_id: 'sib' };
        const starting = { hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'general-purpose' };
        const d = DELAYS[i % DELAYS.length]!;
        // Two of every three trials are the order the captures show most (the Start first, the launch event landing
        // within a few ms); the third is the launch event first.
        const race = i % 3 !== 2
          ? [runAsync(starting), later(d, launch), later(d + 5, sibling)]
          : [runAsync(launch), later(d, starting)];
        await Promise.all(race);
      }
      expect(lost(['sib', ...ids]), 'every join survived the hooks that ran beside it').toEqual([]);
    }, 120_000);

    it('a workflow fan-out: eight SubagentStarts at once, three rounds, all recorded', async () => {
      doneLine();
      const ids: string[] = [];
      for (let round = 0; round < 3; round += 1) {
        const batch = Array.from({ length: 8 }, (_, k) => `w${round}-${k}`);
        ids.push(...batch);
        await Promise.all(batch.map((id) => runAsync({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'workflow-subagent' })));
      }
      expect(lost(ids), 'every start of the fan-out is a join').toEqual([]);
      expect([...(joined() ?? [])].sort(), 'one line each, none lost').toEqual([...ids].sort());
    }, 120_000);

    it('a fan-out that STRADDLES the cap loses nothing: eight Starts at once onto 126 lines, six times (every id is in joined or joinedprev)', async () => {
      doneLine();
      for (let t = 0; t < 6; t += 1) {
        fs.rmSync(joinFile(), { force: true });
        fs.rmSync(prevFile(), { force: true });
        const planted = Array.from({ length: 126 }, (_, i) => `p${t}-${i}`);
        fs.writeFileSync(joinFile(), `${planted.join('\n')}\n`);
        const batch = Array.from({ length: 8 }, (_, k) => `f${t}-${k}`);
        await Promise.all(batch.map((id) => runAsync({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'workflow-subagent' })));
        const have = new Set(joinedAll());
        expect(batch.filter((id) => !have.has(id)), `trial ${t}: every append is in a file`).toEqual([]);
        expect(planted.filter((id) => !have.has(id)), `trial ${t}: and so is every id that was already there`).toEqual([]);
      }
      expect(lost(joinedAll().slice(-3)), 'and the last trial\'s ids are subagents to the marker').toEqual([]);
    }, 120_000);

    it('concurrent rotators: four Starts at once onto 200 lines; the planted file is never replaced by a newer one', async () => {
      doneLine();
      for (let t = 0; t < 4; t += 1) {
        fs.rmSync(joinFile(), { force: true });
        fs.rmSync(prevFile(), { force: true });
        const planted = Array.from({ length: 200 }, (_, i) => `q${t}-${i}`);
        fs.writeFileSync(joinFile(), `${planted.join('\n')}\n`);
        const batch = Array.from({ length: 4 }, (_, k) => `g${t}-${k}`);
        await Promise.all(batch.map((id) => runAsync({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'workflow-subagent' })));
        const have = new Set(joinedAll());
        expect([...batch, ...planted].filter((id) => !have.has(id)), `trial ${t}: no id vanished`).toEqual([]);
      }
    }, 120_000);
  });

  it('hookstate.json no longer carries the join: after a Start with an id its keys are the base shape', () => {
    doneLine();
    start('a-1');
    expect(Object.keys(readState())).toEqual(['v', 'state', 'event', 'sessionId', 'pid', 'updatedAt', 'ask', 'subagents',
      'graphQueries', 'graphGateDenials', 'ccrcPeerReads', 'ccrcClaims']);
  });

  describe('the membership read costs no fork', () => {
    /** A `jq` on PATH that counts its own invocations and then runs the real one. */
    const countJq = (): (() => number) => {
      const real = execFileSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).trim();
      const log = path.join(home, 'jq-count');
      fs.writeFileSync(path.join(home, 'bin', 'jq'), `#!/bin/sh\necho x >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
      return () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
    };

    it('a tool event carrying an id forks jq exactly as often as a main one that writes no marker: the membership read is a builtin', () => {
      run({ hook_event_name: 'UserPromptSubmit' });   // marker working: a later main tool event is a builtin read too
      start('a-1');
      const count = countJq();
      const forks = (payload: object): number => { const c = count(); run(payload); return count() - c; };
      const toolPayload = (agent: Record<string, unknown>) => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, ...agent });
      const main = forks(toolPayload({}));
      const joinedForks = forks(toolPayload({ agent_id: 'a-1' }));
      const bareForks = forks(toolPayload({ agent_id: 'a-unknown' }));
      expect(main, 'the shim sees the hook\'s jq calls').toBeGreaterThanOrEqual(2);
      expect(joinedForks, 'a joined id: the membership read added no jq').toBe(main);
      expect(bareForks, 'an unjoined id: nor did this').toBe(main);
    });

    it('the delegation spool line adds no jq: the same events fork jq exactly as often with a spool directory as without one (delegation broker wave 3, Task 5)', () => {
      const count = countJq();
      const forks = (payload: object): number => { const c = count(); run(payload); return count() - c; };
      const events: Array<[string, object]> = [
        ['PostToolUse Bash', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, tool_use_id: 'toolu_01', session_id: 'uuid-1', tool_response: { stdout: '' } }],
        ['PreToolUse Bash naming a worktree', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git worktree list' }, tool_use_id: 'toolu_02', session_id: 'uuid-1', cwd: home }],
        ['PreToolUse Agent', { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {}, tool_use_id: 'toolu_03', session_id: 'uuid-1' }],
        ['SubagentStart', { hook_event_name: 'SubagentStart', agent_id: 'a-1', agent_type: 'general-purpose', session_id: 'uuid-1' }],
        ['SessionEnd', { hook_event_name: 'SessionEnd', reason: 'clear', session_id: 'uuid-1' }],
      ];
      for (const [, p] of events) run(p);                                    // warm-up: the marker and the join are in the state both passes share
      const without = events.map(([, p]) => forks(p));
      fs.mkdirSync(path.join(reg(), 'delegation', 'spool', 'demo-quiet-basin'), { recursive: true });
      const withSpool = events.map(([, p]) => forks(p));
      const dir = path.join(reg(), 'delegation', 'spool', 'demo-quiet-basin');
      const written = fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
      expect(written, 'anti-vacuity: every event above wrote its line').toHaveLength(events.length);
      expect(withSpool, 'jq forks per event, spool present vs absent').toEqual(without);
      expect(Math.min(...withSpool), 'and the parse is among them').toBeGreaterThanOrEqual(1);
    });
  });
});
