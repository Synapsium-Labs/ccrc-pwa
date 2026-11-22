// The session hook's reports (Overlord W1 door process B1, plan w1-door-process.md Task 7): a session with a door
// (`CCRC_DOOR_NONCE_SHA256` in its environment) sends ONE report per fact it saw, through one sender, `_hook_door_report`,
// to `ccrc-api sessions report <id> --json -`: the witness of a door tool call (keyed by the call digest, plan question 6),
// a subagent's start and stop, a quiet Stop's `readers-clear`, and the id of an operator message whose nudge line the
// prompt carried. Each fails open, is bounded, spools nothing and writes nothing to the hook's state file.
//
// Runs ccd/session-hook.sh for real in a fixture HOME with a RECORDING `ccrc-api` stub (it appends each report body it
// reads on stdin to one file). No live box, no live server, never the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { renderOperatorMessageNudge } from '../src/coord/envelope.js';
import { REPORT_TIMEOUT_S, DOOR_TOOL_PREFIX, AGENT_ID_RE } from '../../shared/continuity-reports.js';
import { witnessKeyOf } from '../../ccd/door-process.mjs';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const HASH = 'ab'.repeat(32);
const AGENT = 'a0000000000000001';
const toolName = (n: string): string => `${DOOR_TOOL_PREFIX}${n}`;

let home: string;
let hookPath = HOOK;
const reg = (...p: string[]): string => path.join(home, '.cc-sessions', ...p);

/** The client: records every `sessions report` body (one line each); with `hang` present it then outlives the bound. */
function client(): void {
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    '[ "$1 $2" = "sessions report" ] || exit 3',
    'printf "%s\\n" "$*" >> "$HOME/report-args"',
    'cat >> "$HOME/reports.log"',
    '[ -f "$HOME/hang" ] && exec sleep 30',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
}
function setup(): void {
  hookPath = HOOK;
  home = mkTmp('ccrc-hook-door-reports-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.writeFileSync(reg(`${ID}.generation`), GENERATION);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'work'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  client();
}
beforeEach(setup);
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

type Report = Record<string, unknown>;
const reports = (): Report[] => {
  const f = path.join(home, 'reports.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Report) : [];
};
const kinds = (): unknown[] => reports().map((r) => r['kind']);
const common = { session_id: UUID, transcript_path: path.join('/rig', `${UUID}.jsonl`), cwd: path.join('/rig', 'work') };

/** The hook's exit asserted; `door` puts a hash in the environment (true: a good one; a string: that text; false: none). */
const run = (payload: object, door: boolean | string = true, extraEnv: Record<string, string> = {}): { out: string; ms: number } => {
  const t0 = Date.now();
  const r = spawnSyncGroup('bash', [hookPath], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
      ...(door === false ? {} : { CCRC_DOOR_NONCE_SHA256: door === true ? HASH : door }), ...extraEnv,
    },
  });
  expect(r.error, 'the spawn itself did not fail').toBeUndefined();
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return { out: String(r.stdout), ms: Date.now() - t0 };
};
const pre = (tool: string, input?: unknown, extra: object = {}): object =>
  ({ ...common, hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: 'toolu_01', ...(input === undefined ? {} : { tool_input: input }), ...extra });
const prompt = (said: string): object => ({ ...common, hook_event_name: 'UserPromptSubmit', prompt: said });
const start = (id = AGENT, type: string | null = 'general-purpose'): object =>
  ({ ...common, hook_event_name: 'SubagentStart', agent_id: id, ...(type === null ? {} : { agent_type: type }) });
const stop = (extra: object = {}): object => ({ ...common, hook_event_name: 'Stop', stop_hook_active: false, ...extra });
const task = (id: string): object => ({ id, type: 'subagent', status: 'running', description: 'fixture agent', agent_type: 'general-purpose' });

// A fixture input with what jq canonicalises: keys out of order, a large integer, a float, an exponent, a unicode escape.
const HARD = { z: 1, a: { y: [1.5, 1e21, Number('9007199254740993'), 12345678901234567890], b: 'café \u0001 😀 "q"' }, m: null };

describe('the witness: one report per door tool call, keyed by the call digest', () => {
  it('sends one witness whose key equals the door process\'s key for the same input (the hard fixture and absent inputs)', async () => {
    for (const [name, input] of [['note_add', HARD], ['timer_list', undefined], ['card', {}], ['note_close', { revises: 5 }]] as const) {
      fs.rmSync(path.join(home, 'reports.log'), { force: true });
      run(pre(toolName(name), input));
      const rs = reports();
      expect(rs, name).toHaveLength(1);
      const key = await witnessKeyOf(name, input);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(rs[0]).toMatchObject({ kind: 'witness', key, tool: toolName(name), agentId: null, fromId: ID, fromUuid: UUID });
      expect(typeof rs[0]!['at']).toBe('number');
    }
  });

  it('the report is the client\'s `sessions report <id> --json -`, and a null tool_input hashes as {}', async () => {
    run(pre(toolName('timer_list'), null));
    expect(fs.readFileSync(path.join(home, 'report-args'), 'utf8').trim()).toBe(`sessions report ${ID} --json -`);
    expect(reports()[0]!['key']).toBe(await witnessKeyOf('timer_list', undefined));
  });

  it('a different input, or a different tool, is a different key', async () => {
    expect(await witnessKeyOf('note_close', { revises: 5 })).not.toBe(await witnessKeyOf('note_close', { revises: 6 }));
    expect(await witnessKeyOf('note_close', { revises: 5 })).not.toBe(await witnessKeyOf('timer_cancel', { revises: 5 }));
  });

  it('a tool that is not a door tool sends nothing, and neither does the bare prefix', () => {
    run(pre('Bash', { command: 'ls' }));
    run(pre('mcp__other__note_add', {}));
    run(pre(DOOR_TOOL_PREFIX, {}));
    expect(reports()).toEqual([]);
  });

  it('a call another arm denies sends none (no real arm names a door tool today, so a copy of the hook gets one after the last deny arm)', () => {
    const text = fs.readFileSync(HOOK, 'utf8');
    const last = 'then _hook_mail_hold || true; fi\n';
    expect(text.split(last), 'the last deny arm is where this copy adds its own').toHaveLength(2);
    const copy = path.join(home, 'hook-denying.sh');
    fs.writeFileSync(copy, text.replace(last, `${last}[[ "\${tool:-}" == mcp__door__denied ]] && pre_json=$(_hook_deny_json "fixture deny")\n`));
    hookPath = copy;
    const { out } = run(pre(toolName('denied'), { text: 'x' }));
    expect(out, 'precondition: the call was denied').toContain('"permissionDecision":"deny"');
    expect(reports()).toEqual([]);
    run(pre(toolName('note_add'), { text: 'a plain note' }));
    expect(kinds(), 'a call that arm lets through is witnessed').toEqual(['witness']);
  });

  it('a reader\'s call carries its agent id: with a recorded join, or with an agent_type; neither is the main thread\'s', () => {
    // A reader's door call is the read tool: B2's scope arm denies a reader any other door tool, which then sends no witness.
    fs.writeFileSync(reg(`${ID}.joined`), `${AGENT}\n`);
    run(pre(toolName('read'), {}, { agent_id: AGENT }));                                            // a join, no type
    run(pre(toolName('read'), {}, { agent_id: 'a0000000000000002', agent_type: 'Explore' }));        // a type, no join
    run(pre(toolName('note_list'), {}, { agent_id: 'a0000000000000003' }));                          // neither: the roster never saw it
    run(pre(toolName('note_list'), {}));                                                            // the main thread
    expect(reports().map((r) => r['agentId'])).toEqual([AGENT, 'a0000000000000002', null, null]);
  });

  it('a session with no hash, or a hash that is not 64 lowercase hex, sends nothing at all', () => {
    for (const door of [false, 'not-a-hash', HASH.toUpperCase(), HASH.slice(1), `${HASH}0`, ''] as const) {
      run(pre(toolName('note_add'), {}), door);
      run(start(), door);
      run(stop({ background_tasks: [] }), door);
      run(prompt(renderOperatorMessageNudge(7)), door);
    }
    expect(reports()).toEqual([]);
  });

  it('a child session sends nothing', () => {
    fs.writeFileSync(reg(`${ID}.child`), '7');
    run(pre(toolName('note_add'), {}));
    run(start());
    run(stop({ background_tasks: [] }));
    run(prompt(renderOperatorMessageNudge(7)));
    expect(reports()).toEqual([]);
  });
});

describe('readers: start, stop, and a quiet turn\'s end', () => {
  it('a SubagentStart and a SubagentStop send one report each, with the agent id and the type on the start', () => {
    run(start(AGENT, 'Explore'));
    run({ ...common, hook_event_name: 'SubagentStop', agent_id: AGENT, agent_type: 'Explore' });
    expect(reports()).toMatchObject([
      { kind: 'reader-start', agentId: AGENT, agentType: 'Explore', fromId: ID, fromUuid: UUID },
      { kind: 'reader-stop', agentId: AGENT, fromId: ID, fromUuid: UUID },
    ]);
    expect(reports()[1]).not.toHaveProperty('agentType');
  });

  it('a start with no agent_type reports a null type, and an id outside the roster\'s shape reports nothing', () => {
    run(start(AGENT, null));
    expect(reports()[0]).toMatchObject({ kind: 'reader-start', agentType: null });
    fs.rmSync(path.join(home, 'reports.log'));
    for (const bad of ['has space', 'a'.repeat(65), 'a/b', '']) {
      expect(AGENT_ID_RE.test(bad)).toBe(false);
      run(start(bad));
      run({ ...common, hook_event_name: 'SubagentStop', agent_id: bad });
    }
    expect(reports()).toEqual([]);
  });

  it('a quiet Stop sends readers-clear; a Stop with background work, or none measured, does not', () => {
    run(stop({ background_tasks: [] }));
    expect(reports()).toMatchObject([{ kind: 'readers-clear', fromId: ID, fromUuid: UUID }]);
    fs.rmSync(path.join(home, 'reports.log'));
    run(stop({ background_tasks: [task(AGENT)] }));
    run(stop());   // no background_tasks field: nothing measured, so nothing cleared
    expect(reports()).toEqual([]);
  });

  it('a quiet Stop clears even when the hook\'s own roster was already empty (a lost stop heals at the next quiet turn)', () => {
    run(prompt('go'));
    run(stop({ background_tasks: [] }));
    run(stop({ background_tasks: [] }));
    expect(kinds()).toEqual(['readers-clear', 'readers-clear']);
  });
});

describe('picked up: each prompt line that is exactly the nudge line', () => {
  it('a prompt holding three nudge lines sends three pick-ups, in order, and other lines send none', () => {
    const text = ['hello', renderOperatorMessageNudge(41), 'between', renderOperatorMessageNudge(7), renderOperatorMessageNudge(9007199254740991), ''].join('\n');
    run(prompt(text));
    expect(reports()).toMatchObject([{ kind: 'picked-up', messageId: 41 }, { kind: 'picked-up', messageId: 7 }, { kind: 'picked-up', messageId: 9007199254740991 }]);
    expect(reports().every((r) => r['fromId'] === ID && r['fromUuid'] === UUID)).toBe(true);
  });

  it('a line that differs by one character sends none', () => {
    const line = renderOperatorMessageNudge(41);
    const variants = [
      `${line} `, ` ${line}`, `${line}\r`, line.replace('41', '041'), line.replace('41', '4l'), line.replace('Operator', 'operator'),
      line.replace('door.', 'door'), line.replace('ccrc-mail:', 'ccrc-mail'), `${line}x`, `x${line}`, line.replace('41', ''),
      `see: ${line}`, `${line} and more`,
    ];
    for (const v of variants) expect(v).not.toBe(line);
    run(prompt(variants.join('\n')));
    expect(reports()).toEqual([]);
  });
});

describe('the nudge pattern is the renderer\'s (one jq definition, held to renderOperatorMessageNudge)', () => {
  const hookText = fs.readFileSync(HOOK, 'utf8');
  const def = /^DOOR_NUDGE_JQ='([^']+)'$/m.exec(hookText)?.[1];
  const nudge = (line: string): string[] => {
    const r = spawnSync('jq', ['-nr', '--arg', 'l', line, `${def} $l | nudge`], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.split('\n').filter((l) => l !== '');
  };

  it('the hook carries it as one definition', () => { expect(def, 'DOOR_NUDGE_JQ is one single-quoted assignment').toBeTypeOf('string'); });

  it('the renderer\'s line, for several ids, matches and yields its id', () => {
    for (const id of [1, 7, 10, 42, 99999, 123456789012345, 1234567890123456, 9007199254740991]) {
      expect(nudge(renderOperatorMessageNudge(id)), String(id)).toEqual([String(id)]);
    }
  });

  it('a line differing by one character, anywhere (changed, dropped or added), matches nothing', () => {
    for (const id of [3, 41, 9007199254740991]) {
      const line = renderOperatorMessageNudge(id);
      for (let i = 0; i < line.length; i += 1) {
        const other = line[i] === 'Q' ? 'Z' : 'Q';
        for (const v of [line.slice(0, i) + other + line.slice(i + 1), line.slice(0, i) + line.slice(i + 1), `${line.slice(0, i)}Q${line.slice(i)}`]) {
          if (v === line) continue;
          // An added or changed DIGIT in the id would still be a well-formed id: those are other ids, not a looser pattern.
          if (/^ccrc-mail: you have new mail\. Operator message [1-9][0-9]*: read it with your messages door\.$/.test(v)) continue;
          expect(nudge(v), JSON.stringify(v)).toEqual([]);
        }
      }
    }
  });

  it('an id that is not a canonical positive safe integer matches nothing', () => {
    for (const id of ['0', '007', '-1', '1.5', '9007199254740992', '12345678901234567', '']) {
      expect(nudge(renderOperatorMessageNudge(1).replace('1:', `${id}:`)), id).toEqual([]);
    }
  });
});

describe('fail open, bounded', () => {
  it('REPORT_TIMEOUT_S is the L0 constant', () => {
    expect(/^REPORT_TIMEOUT_S=(\d+)$/m.exec(fs.readFileSync(HOOK, 'utf8'))?.[1]).toBe(String(REPORT_TIMEOUT_S));
  });

  it('a client that hangs is cut at the bound and the tool call goes on', () => {
    fs.writeFileSync(path.join(home, 'hang'), '');
    const { out, ms } = run(pre(toolName('note_add'), { text: 'a note' }));
    expect(reports(), 'the stub read the body before it hung').toHaveLength(1);
    expect(out, 'no deny: the call goes on').not.toContain('deny');
    expect(ms).toBeGreaterThanOrEqual(REPORT_TIMEOUT_S * 1000 - 200);
    expect(ms).toBeLessThan(REPORT_TIMEOUT_S * 1000 + 5000);
  });

  it('a client that is missing, or fails, is silent and spools nothing', () => {
    fs.rmSync(path.join(home, '.local', 'bin', 'ccrc-api'));
    const { out } = run(pre(toolName('note_add'), {}));
    expect(out).toBe('');
    fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    expect(run(prompt(renderOperatorMessageNudge(5))).out).not.toContain('deny');
    expect(fs.readdirSync(reg()).filter((f) => /pending|spool|report/.test(f))).toEqual([]);
  });
});

describe('hookstate: a report is a pure side send', () => {
  /** The hook's state file after `events`, its clock-valued numbers zeroed, in a fresh home with or without the hash. */
  const stateAfter = (events: object[], door: boolean): unknown => {
    fs.rmSync(home, { recursive: true, force: true });
    setup();
    run(prompt('first'), door);
    for (const e of events) run(e, door);
    const f = reg(`${ID}.hookstate.json`);
    expect(fs.existsSync(f), 'the hook wrote its state').toBe(true);
    const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm)
      : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
        : typeof v === 'number' && v > 1e12 ? 0 : v;
    return norm(JSON.parse(fs.readFileSync(f, 'utf8')));
  };
  const CASES: Array<[string, object[]]> = [
    ['a door tool call', [pre(toolName('note_add'), HARD)]],
    ['a subagent start and stop', [start(), { ...common, hook_event_name: 'SubagentStop', agent_id: AGENT }]],
    ['a quiet Stop', [stop({ background_tasks: [] })]],
    ['a prompt carrying a nudge line', [prompt(renderOperatorMessageNudge(12))]],
  ];
  it.each(CASES)('%s leaves the state file as a session without a door writes it', (_n, events) => {
    const without = stateAfter(events, false);
    const withDoor = stateAfter(events, true);
    expect(reports().length, 'the door run did send').toBeGreaterThan(0);
    expect(withDoor).toEqual(without);
  });
});
