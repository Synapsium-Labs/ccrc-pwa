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
import { REPLY_READ_MAX_BYTES, REPLY_REPORT_MAX_BYTES, REPLY_SPOOL_MAX } from '../../shared/operatorMessages.js';
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
    `[ -f "$HOME/purge-on-send" ] && rm -f "$HOME/.cc-sessions/${ID}.generation"`,
    '[ -f "$HOME/hang" ] && exec sleep 30',
    // The real client: the body on stdout, and `http <code>` last on stderr (the code is the stub's `status` file, 200 by default;
    // the body is its `answer` file when one stands, so a case can answer a refusal's word).
    'if [ -f "$HOME/answer" ]; then cat "$HOME/answer"; else printf "{\\"ok\\":true}\\n"; fi',
    'printf "http %s\\n" "$(cat "$HOME/status" 2>/dev/null || echo 200)" >&2',
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
    // The arm includes the transcript library from beside the hook (`ROSTER_CARD_LIB`), as the installed hook finds it.
    fs.symlinkSync(path.resolve(__dirname, '../../ccd/lib'), path.join(home, 'lib'));
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

// CHARACTERIZATION of the picked-up arm's outputs (chat PR B fix round 1, call 1953 condition 3): pinned green on the tree BEFORE the
// nudge grammar moved into the transcript library, and unchanged by that move. Each row is a prompt and the exact reports it sends.
describe('picked up, characterized: the reports each prompt sends', () => {
  const n = renderOperatorMessageNudge;
  const ROWS: Array<[string, unknown, unknown[]]> = [
    ['one nudge line', n(41), [41]],
    ['the line twice', `${n(5)}\n${n(5)}`, [5, 5]],
    ['lines around it, a blank line and a trailing newline', `before\n\n${n(3)}\nafter\n`, [3]],
    ['the largest safe id and the smallest', `${n(9007199254740991)}\n${n(1)}`, [9007199254740991, 1]],
    ['a carriage return ends no line: the line is not exact', `${n(8)}\r\n${n(9)}`, [9]],
    ['the line inside a longer line', `quoted: ${n(4)}`, []],
    ['a prompt that is not a string', ['not', 'a', 'string'], []],
    ['no prompt at all', undefined, []],
    ['an empty prompt', '', []],
  ];
  it.each(ROWS)('%s', (_name, said, ids) => {
    run({ ...common, hook_event_name: 'UserPromptSubmit', ...(said === undefined ? {} : { prompt: said }) });
    expect(reports().map((r) => [r['kind'], r['messageId']])).toEqual(ids.map((id) => ['picked-up', id]));
    expect(reports().every((r) => r['fromId'] === ID && r['fromUuid'] === UUID && Number.isInteger(r['at']))).toBe(true);
  });
});

describe('the nudge pattern is the renderer\'s (one jq definition, held to renderOperatorMessageNudge)', () => {
  // The grammar lives in the transcript library since chat PR B's fix round 1 (call 1953): the hook's picked-up arm includes it, and
  // the reply's answered ids read the same definition. The cases below run the library's own definition, as strongly as before.
  const hookText = fs.readFileSync(HOOK, 'utf8');
  const LIB_DIR = path.resolve(__dirname, '../../ccd/lib');
  const libText = fs.readFileSync(path.join(LIB_DIR, 'transcript.jq'), 'utf8');
  const def = /^def nudge: .+;$/m.exec(libText)?.[0];
  const nudge = (line: string): string[] => {
    const r = spawnSync('jq', ['-nr', '-L', LIB_DIR, '--arg', 'l', line, 'include "transcript"; $l | nudge'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.split('\n').filter((l) => l !== '');
  };

  it('the library carries it as one definition, and the hook includes it and spells no copy', () => {
    expect(def, 'one `def nudge:` line in ccd/lib/transcript.jq').toBeTypeOf('string');
    expect(libText.match(/^def nudge:/gm), 'defined once').toHaveLength(1);
    expect(/^DOOR_NUDGE_JQ='include "transcript"; '$/m.test(hookText), 'the hook\'s arm includes the library').toBe(true);
    expect(hookText, 'no second copy of the line\'s text in the hook').not.toContain('Operator message " as $h');
  });

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

// ── THE REPLY REPORT (Overlord W1 chat, PR B; plan w1-chat.md Task 5, slugs a-reply-is-a-turns-text and reply-report-spools) ──
// At a MAIN-thread Stop of a session with a door the hook reports the turn's reply, read from the transcript's tail. It is the ONE
// report that spools: a send not answered 200 is kept in `$REG/<id>.replyspool` (0600, one body a line, at most REPLY_SPOOL_MAX) and
// resent oldest first at the next Stop, before that Stop's own; 401, 404, 408, 429, a 5xx, no answer and a timeout keep a body, and any
// other 4xx (403 not-the-overlord, 400, 409) drops it. One REPORT_TIMEOUT_S deadline bounds the whole arm.
describe('the reply report: sent at a main Stop, spooled and resent (the one report that is)', () => {
  const TU = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const spoolPath = (): string => reg(`${ID}.replyspool`);
  const spoolLines = (): Array<Record<string, unknown>> =>
    fs.existsSync(spoolPath()) ? fs.readFileSync(spoolPath(), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
  const rawReports = (): string[] => {
    const f = path.join(home, 'reports.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
  };
  /** A transcript whose last turn is a prompt and one assistant row `TU(n)` of `text` (null: a thinking block only); its path. */
  const transcript = (n: number, text: string | null): string => {
    const dir = path.join(home, 'transcripts');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `t${n}.jsonl`);
    const content = text === null ? [{ type: 'thinking', thinking: 'hmm' }] : [{ type: 'text', text }];
    fs.writeFileSync(f, [
      { type: 'user', uuid: TU(1000 + n), message: { role: 'user', content: `go ${n}` } },
      { type: 'assistant', uuid: TU(n), message: { role: 'assistant', stop_reason: 'end_turn', content } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');
    return f;
  };
  const stopFor = (n: number, text: string | null = `reply ${n}`, extra: object = {}): object => stop({ transcript_path: transcript(n, text), ...extra });
  const setStatus = (code: number | null): void => {
    const f = path.join(home, 'status');
    if (code === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, String(code));
  };
  /** A `tail` ahead of the hook's on PATH that records its arguments and runs the real one: it proves whether a transcript was read. */
  const shimTail = (): string => {
    const real = spawnSync('sh', ['-c', 'command -v tail'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(home, 'bin', 'tail'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/tail-calls"\nexec ${real} "$@"\n`, { mode: 0o755 });
    return path.join(home, 'tail-calls');
  };
  const tailReads = (log: string, file: string): string[] =>
    (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n') : []).filter((l) => l.includes(file));

  it('a main Stop of a session with a door sends one reply report with the right body, through the one sender', () => {
    const t0 = Date.now();
    const { out } = run(stopFor(7, 'the answer\n\nwith two paragraphs'));
    const t1 = Date.now();
    expect(out, 'the arm prints nothing').toBe('');
    const rs = reports();
    expect(rs).toHaveLength(1);
    // `fromUuid` last: the hook adds the event's own session id at the send, never in the body it builds or spools (review 4173 F3).
    expect(Object.keys(rs[0]!)).toEqual(['kind', 'entryUuid', 'turnAt', 'text', 'truncated', 'answers', 'fromId', 'at', 'fromUuid']);
    expect(rs[0]!['answers'], 'a prompt that is no nudge names no message').toEqual([]);
    expect(rs[0]).toMatchObject({ kind: 'reply', entryUuid: TU(7), text: 'the answer\n\nwith two paragraphs', truncated: false, fromId: ID, fromUuid: UUID });
    for (const k of ['turnAt', 'at']) {
      expect(Number.isInteger(rs[0]![k]), k).toBe(true);
      expect(rs[0]![k] as number, k).toBeGreaterThanOrEqual(t0 - 1000);
      expect(rs[0]![k] as number, k).toBeLessThanOrEqual(t1 + 1000);
    }
    expect(rs[0]!['turnAt'] as number).toBeLessThanOrEqual(rs[0]!['at'] as number);
    expect(fs.readFileSync(path.join(home, 'report-args'), 'utf8').trim()).toBe(`sessions report ${ID} --json -`);
    expect(fs.existsSync(spoolPath()), 'an answered 200 spools nothing').toBe(false);
    expect(rs[0], 'no droppedBefore unless the spool dropped').not.toHaveProperty('droppedBefore');
  });

  it('a quiet Stop sends its readers-clear and then the reply', () => {
    run(stopFor(8, 'x', { background_tasks: [] }));
    expect(kinds()).toEqual(['readers-clear', 'reply']);
  });

  it('a SubagentStop, and a Stop carrying a reader\'s agent id, send no reply and read no transcript', () => {
    const log = shimTail();
    const file = transcript(9, 'SUBAGENT TEXT');
    run({ ...common, hook_event_name: 'SubagentStop', agent_id: AGENT, agent_type: 'Explore', transcript_path: file });
    run({ ...stop({ transcript_path: file }), agent_id: AGENT, agent_type: 'Explore' });
    expect(kinds().filter((k) => k === 'reply')).toEqual([]);
    expect(tailReads(log, file), 'the transcript was not read').toEqual([]);
  });

  it('only a Stop reports a reply: the other events of a session with a door do not, whatever transcript they name', () => {
    const file = transcript(10, 'not at a Stop');
    run(pre(toolName('read'), {}, { transcript_path: file }));
    run({ ...prompt('go'), transcript_path: file });
    run({ ...common, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {}, tool_response: {}, transcript_path: file });
    expect(kinds().filter((k) => k === 'reply')).toEqual([]);
  });

  it('a session without a door sends no reply AND reads no transcript: the gate comes before the read', () => {
    const log = shimTail();
    const file = transcript(11, 'no door, no read');
    for (const door of [false, 'not-a-hash', HASH.toUpperCase(), HASH.slice(1), '']) run(stop({ transcript_path: file }), door);
    expect(reports()).toEqual([]);
    expect(tailReads(log, file), 'no `tail` ever named the transcript').toEqual([]);
    expect(fs.existsSync(spoolPath())).toBe(false);
    // The shim does see a read when the gate opens, so the empty list above is the gate, not a blind probe.
    run(stop({ transcript_path: file }));
    expect(tailReads(log, file)).toHaveLength(1);
    expect(tailReads(log, file)[0]).toContain(`-c ${REPLY_READ_MAX_BYTES}`);
  });

  it('a child session, and a registry row that is gone, send no reply and read no transcript', () => {
    const log = shimTail();
    const file = transcript(12, 'child');
    fs.writeFileSync(reg(`${ID}.child`), '7');
    run(stop({ transcript_path: file }));
    fs.rmSync(reg(`${ID}.child`));
    fs.rmSync(reg(`${ID}.generation`));
    run(stop({ transcript_path: file }));
    expect(reports()).toEqual([]);
    expect(tailReads(log, file)).toEqual([]);
  });

  it('a Stop whose turn has no text, or whose transcript is missing, relative or empty, sends nothing and spools nothing', () => {
    run(stopFor(13, null));
    run(stop({ transcript_path: path.join(home, 'transcripts', 'absent.jsonl') }));
    run(stop({ transcript_path: 'transcripts/t13.jsonl' }));
    run(stop());   // the shared fixture path, which does not exist
    const empty = path.join(home, 'transcripts', 'empty.jsonl');
    fs.writeFileSync(empty, '');
    run(stop({ transcript_path: empty }));
    run({ ...common, hook_event_name: 'Stop', transcript_path: 7 });
    expect(reports()).toEqual([]);
    expect(fs.existsSync(spoolPath())).toBe(false);
  });

  it('a text past the cap is cut at a code point, never mid-character, with truncated: true; one exactly at the cap is whole', () => {
    expect(REPLY_REPORT_MAX_BYTES).toBeGreaterThan(1000);
    // Each turn its own key: a Stop over a key already reported reports nothing (F1).
    for (const [n, ch, want] of [[23, '€', 3], [24, 'é', 2], [25, '😀', 4]] as const) {
      fs.rmSync(path.join(home, 'reports.log'), { force: true });
      const head = 'a'.repeat(REPLY_REPORT_MAX_BYTES - want + 1);   // the character ends one byte past the cap
      run(stopFor(n, `${head}${ch}tail`));
      const [r] = reports();
      expect(r!['truncated'], ch).toBe(true);
      expect(r!['text'], ch).toBe(head);
      expect(Buffer.byteLength(r!['text'] as string), ch).toBeLessThanOrEqual(REPLY_REPORT_MAX_BYTES);
    }
    fs.rmSync(path.join(home, 'reports.log'), { force: true });
    const exact = `${'b'.repeat(REPLY_REPORT_MAX_BYTES - 3)}€`;
    run(stopFor(21, exact));
    expect(reports()[0]).toMatchObject({ text: exact, truncated: false });
    fs.rmSync(path.join(home, 'reports.log'), { force: true });
    run(stopFor(22, `${exact}x`));
    expect(reports()[0]).toMatchObject({ text: exact, truncated: true });
  });

  describe('the spool', () => {
    it('a stub answering 502 spools the body, in a file only its owner reads; the next Stop resends it before its own, with the same entryUuid', () => {
      setStatus(502);
      expect(run(stopFor(30)).out).toBe('');
      const sent = rawReports();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.endsWith(`,"fromUuid":"${UUID}"}`), 'the send adds the event\'s session id').toBe(true);
      expect(fs.readFileSync(spoolPath(), 'utf8'), 'one body a line: the body that was sent, less the uuid the send added')
        .toBe(`${sent[0]!.slice(0, -`,"fromUuid":"${UUID}"}`.length)}}\n`);
      expect(fs.statSync(spoolPath()).mode & 0o777, 'the spool is 0600').toBe(0o600);
      setStatus(null);
      fs.rmSync(path.join(home, 'reports.log'));
      expect(run(stopFor(31)).out).toBe('');
      const got = reports();
      expect(got.map((r) => r['entryUuid']), 'oldest first, then this Stop\'s own').toEqual([TU(30), TU(31)]);
      expect(rawReports()[0], 'a resend is the same bytes').toBe(sent[0]);
      expect(fs.existsSync(spoolPath()), 'a 200 removes it').toBe(false);
    });

    it('a still-failing stub keeps the body and the Stop\'s own behind it, in order, mode 0600 each time', () => {
      setStatus(503);
      run(stopFor(40));
      run(stopFor(41));
      run(stopFor(42));
      expect(spoolLines().map((r) => r['entryUuid'])).toEqual([TU(40), TU(41), TU(42)]);
      expect(fs.statSync(spoolPath()).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(reg()).filter((f) => f.startsWith(`${ID}.replyspool`) && f !== `${ID}.replyspool`), 'no temp file is left').toEqual([]);
    });

    it('the first failure stops the pass: one resend, and nothing newer is sent before it, this Stop\'s own included (F2)', () => {
      setStatus(502);
      run(stopFor(50));
      expect(reports().map((r) => r['entryUuid']), 'the first Stop sends its own').toEqual([TU(50)]);
      fs.rmSync(path.join(home, 'reports.log'));
      run(stopFor(51));
      expect(reports().map((r) => r['entryUuid']), 'the head is kept, so the Stop\'s own is kept unsent behind it').toEqual([TU(50)]);
      fs.rmSync(path.join(home, 'reports.log'));
      run(stopFor(52));
      // The head is tried (502) and stops the pass; neither 51 nor this Stop's own is sent before it.
      expect(reports().map((r) => r['entryUuid'])).toEqual([TU(50)]);
      expect(spoolLines().map((r) => r['entryUuid'])).toEqual([TU(50), TU(51), TU(52)]);
      // Once the head is answered, the rest go in order, oldest first.
      setStatus(null);
      fs.rmSync(path.join(home, 'reports.log'));
      run(stopFor(53));
      expect(reports().map((r) => r['entryUuid'])).toEqual([TU(50), TU(51), TU(52), TU(53)]);
      expect(fs.existsSync(spoolPath())).toBe(false);
    });

    it('a spooled body refused `stale-uuid` (the registry\'s uuid moved) is kept, ends the pass, and is sent under the current uuid (F3)', () => {
      const NEXT = '00000000-0000-4000-8000-000000000002';
      setStatus(403);
      fs.writeFileSync(path.join(home, 'answer'), '{"ok":false,"error":"stale-uuid","detail":"the registry names another uuid"}\n');
      run(stopFor(57));
      expect(spoolLines().map((r) => r['entryUuid']), 'stale-uuid is not refused for good').toEqual([TU(57)]);
      expect(spoolLines()[0], 'the spool holds no uuid').not.toHaveProperty('fromUuid');
      // The registry follows the new conversation; the next Stop carries its session id, and the kept body goes under it.
      setStatus(null);
      fs.rmSync(path.join(home, 'answer'));
      fs.rmSync(path.join(home, 'reports.log'));
      run(stop({ transcript_path: transcript(58, 'reply 58'), session_id: NEXT }));
      expect(reports().map((r) => [r['entryUuid'], r['fromUuid']])).toEqual([[TU(57), NEXT], [TU(58), NEXT]]);
      expect(fs.existsSync(spoolPath())).toBe(false);
    });

    it('any other 403 word is still refused for good', () => {
      setStatus(403);
      fs.writeFileSync(path.join(home, 'answer'), '{"ok":false,"error":"not-the-overlord"}\n');
      run(stopFor(59));
      expect(fs.existsSync(spoolPath())).toBe(false);
    });

    it('a stub answering 403 (not-the-overlord) does not spool: the refusal is for good, and a resend would only repeat it', () => {
      setStatus(403);
      run(stopFor(55));
      expect(reports().map((r) => r['entryUuid']), 'sent once').toEqual([TU(55)]);
      expect(fs.existsSync(spoolPath())).toBe(false);
      run(stopFor(56));
      expect(reports().map((r) => r['entryUuid']), 'the next Stop resends nothing').toEqual([TU(55), TU(56)]);
      expect(fs.existsSync(spoolPath())).toBe(false);
    });

    it('keeps a body for 401, 404, 408, 429 and a 5xx, and drops it for any other 4xx (403, 400, 409, 413, 422)', () => {
      // Each code its own turn (its own key, F1): the case asks what the answer does to a body, not what a re-fired Stop does.
      for (const code of [401, 404, 408, 429, 500, 502, 503, 504]) {
        fs.rmSync(spoolPath(), { force: true });
        setStatus(code);
        run(stopFor(code));
        expect(spoolLines().map((r) => r['entryUuid']), String(code)).toEqual([TU(code)]);
      }
      for (const code of [400, 403, 409, 413, 422]) {
        fs.rmSync(spoolPath(), { force: true });
        setStatus(code);
        expect(run(stopFor(code + 1000)).out).toBe('');
        expect(fs.existsSync(spoolPath()), `${code} is refused for good: nothing is spooled`).toBe(false);
      }
    });

    it('a spooled body the server now refuses for good is dropped and the pass goes on to the next and to the Stop\'s own', () => {
      setStatus(502);
      run(stopFor(70)); run(stopFor(71));
      setStatus(403);
      fs.rmSync(path.join(home, 'reports.log'));
      run(stopFor(72));
      expect(reports().map((r) => r['entryUuid']), 'each was tried once').toEqual([TU(70), TU(71), TU(72)]);
      expect(fs.existsSync(spoolPath()), 'all refused for good: nothing stays').toBe(false);
    });

    it('a Stop with no reply of its own still resends the spool', () => {
      setStatus(502);
      run(stopFor(80));
      setStatus(null);
      fs.rmSync(path.join(home, 'reports.log'));
      run(stopFor(81, null));
      expect(reports().map((r) => r['entryUuid'])).toEqual([TU(80)]);
      expect(fs.existsSync(spoolPath())).toBe(false);
    });

    it('a ninth spooled body drops the oldest, and the count rides the body that now stands oldest as droppedBefore: 1', () => {
      setStatus(502);
      for (let n = 1; n <= REPLY_SPOOL_MAX; n += 1) run(stopFor(100 + n));
      expect(spoolLines()).toHaveLength(REPLY_SPOOL_MAX);
      expect(spoolLines().some((r) => 'droppedBefore' in r), 'nothing dropped yet').toBe(false);
      run(stopFor(100 + REPLY_SPOOL_MAX + 1));
      const kept = spoolLines();
      expect(kept).toHaveLength(REPLY_SPOOL_MAX);
      expect(kept.map((r) => r['entryUuid']), 'the oldest is gone').toEqual([102, 103, 104, 105, 106, 107, 108, 109].map(TU));
      expect(kept.map((r) => r['droppedBefore'])).toEqual([1, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
      // A tenth drops the one that carried the count: the count moves on, and grows by one.
      run(stopFor(110));
      expect(spoolLines().map((r) => r['droppedBefore'])[0], 'a count is never lost').toBe(2);
      expect(spoolLines().map((r) => r['entryUuid'])[0]).toBe(TU(103));
      // The server answers at last: every body goes, oldest first, the count on the first only.
      setStatus(null);
      fs.rmSync(path.join(home, 'reports.log'));
      run(stopFor(111));
      const got = reports();
      expect(got.map((r) => r['entryUuid'])).toEqual([103, 104, 105, 106, 107, 108, 109, 110, 111].map(TU));
      expect(got.map((r) => r['droppedBefore'])).toEqual([2, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
      expect(fs.existsSync(spoolPath())).toBe(false);
    });

    it('a purge during the arm (the row\'s generation goes) leaves no spool behind', () => {
      setStatus(502);
      fs.writeFileSync(path.join(home, 'purge-on-send'), '');
      run(stopFor(120));
      expect(fs.existsSync(reg(`${ID}.generation`)), 'the stub removed the row, as a purge does').toBe(false);
      expect(fs.readdirSync(reg()).filter((f) => f.includes('replyspool'))).toEqual([]);
    });

    it('a symlink where the spool should be is not followed', () => {
      const target = path.join(home, 'elsewhere');
      fs.writeFileSync(target, '{"kind":"reply","entryUuid":"x"}\n');
      fs.symlinkSync(target, spoolPath());
      setStatus(502);
      run(stopFor(130));
      expect(reports().map((r) => r['entryUuid']), 'the link\'s content was not resent').toEqual([TU(130)]);
      expect(fs.readFileSync(target, 'utf8'), 'and not written through').toBe('{"kind":"reply","entryUuid":"x"}\n');
      expect(fs.lstatSync(spoolPath()).isFile(), 'the spool is a regular file again').toBe(true);
      expect(spoolLines().map((r) => r['entryUuid'])).toEqual([TU(130)]);
    });
  });

  // A REPLY IS ONE TURN'S TEXT (review 4173 F1, call 1952): the hook keeps the key of the reply it built last, in
  // `$REG/<id>.replykey` (owner-only, taken with the registry row), and the next Stop's turn begins after that row.
  describe('the reported key bounds the next turn (F1)', () => {
    const keyPath = (): string => reg(`${ID}.replykey`);
    const rows = (...r: object[]): string => r.map((x) => JSON.stringify(x)).join('\n') + '\n';
    const u = (n: number, content: string): object => ({ type: 'user', uuid: TU(n), message: { role: 'user', content } });
    const a = (n: number, t: string): object => ({ type: 'assistant', uuid: TU(n), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: t }] } });
    const NOTICE = '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>';

    it('a reply built keeps its key, in a file only its owner reads; the next Stop over the same transcript starts after it', () => {
      const f = path.join(home, 'live.jsonl');
      fs.writeFileSync(f, rows(u(1, 'the prompt'), a(2, 'REPLY-A')));
      run(stop({ transcript_path: f }));
      expect(fs.readFileSync(keyPath(), 'utf8').trim()).toBe(TU(2));
      expect(fs.statSync(keyPath()).mode & 0o777, 'the key is 0600').toBe(0o600);
      // A background-task notice opens the next turn: it is no prompt, so only the key keeps the earlier reply out.
      fs.appendFileSync(f, rows(u(3, NOTICE), a(4, 'reply B')));
      fs.rmSync(path.join(home, 'reports.log'));
      run(stop({ transcript_path: f }));
      expect(reports().map((r) => [r['entryUuid'], r['text']])).toEqual([[TU(4), 'reply B']]);
      expect(fs.readFileSync(keyPath(), 'utf8').trim()).toBe(TU(4));
      // The same Stop fired again over the same rows reports nothing.
      fs.rmSync(path.join(home, 'reports.log'));
      run(stop({ transcript_path: f }));
      expect(reports()).toEqual([]);
    });

    it('a turn opened by a nudge prompt names that message in its answers (F2, call 1953)', () => {
      const f = path.join(home, 'live.jsonl');
      fs.writeFileSync(f, rows(u(1, renderOperatorMessageNudge(12)), a(2, 'the answer')));
      run(stop({ transcript_path: f }));
      expect(reports().map((r) => [r['entryUuid'], r['answers']])).toEqual([[TU(2), [12]]]);
    });

    it('a body that is kept (spooled) still moves the key: it was reported, and its text is never taken into the next turn', () => {
      const f = path.join(home, 'live.jsonl');
      fs.writeFileSync(f, rows(u(1, 'the prompt'), a(2, 'REPLY-A')));
      setStatus(502);
      run(stop({ transcript_path: f }));
      expect(fs.readFileSync(keyPath(), 'utf8').trim()).toBe(TU(2));
      setStatus(null);
      fs.appendFileSync(f, rows(u(3, NOTICE), a(4, 'reply B')));
      fs.rmSync(path.join(home, 'reports.log'));
      run(stop({ transcript_path: f }));
      expect(reports().map((r) => [r['entryUuid'], r['text']])).toEqual([[TU(2), 'REPLY-A'], [TU(4), 'reply B']]);
    });

    it('a key file that is a symlink is not followed, and a purge during the arm takes the key too', () => {
      const f = path.join(home, 'live.jsonl');
      fs.writeFileSync(f, rows(u(1, 'the prompt'), a(2, 'REPLY-A')));
      const elsewhere = path.join(home, 'elsewhere');
      fs.writeFileSync(elsewhere, 'untouched\n');
      fs.symlinkSync(elsewhere, keyPath());
      run(stop({ transcript_path: f }));
      expect(reports().map((r) => r['entryUuid']), 'a symlinked key is no key: the prompt rule answers').toEqual([TU(2)]);
      expect(fs.readFileSync(elsewhere, 'utf8'), 'the write never goes through the link').toBe('untouched\n');
      expect(fs.lstatSync(keyPath()).isSymbolicLink(), 'the key is replaced, not followed').toBe(false);
      fs.rmSync(keyPath(), { force: true });
      fs.writeFileSync(path.join(home, 'purge-on-send'), '');
      run(stop({ transcript_path: f }));
      expect(fs.existsSync(keyPath()), 'the generation went during the arm: no key is left behind').toBe(false);
    });
  });

  // NO PROCESS BEFORE THE GATE (review 4173 F9): the arm's function, cut from the hook and run alone with no PATH, a recorder for any
  // command bash cannot find and recorders for the helpers it calls, spawns nothing for a session with no door, a child, a
  // SubagentStop or a row that is gone. Moving any command above the gate makes the record non-empty.
  describe('the gate spawns no process at all (F9)', () => {
    const body = (): string => {
      const text = fs.readFileSync(HOOK, 'utf8');
      const m = /^_hook_reply_report\(\) \{[^]*?\n\}\n/m.exec(text);
      expect(m, 'the function is in the hook').not.toBeNull();
      return m![0];
    };
    const spawned = (env: Record<string, string>, files: Record<string, string> = {}): string[] => {
      const dir = mkTmp('ccrc-reply-gate-');
      const regDir = path.join(dir, 'reg');
      fs.mkdirSync(regDir);
      for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(regDir, n), v);
      const log = path.join(dir, 'spawned');
      const script = [
        `command_not_found_handle() { printf '%s\\n' "$1" >> ${JSON.stringify(log)}; return 127; }`,
        ...['_hook_epoch_ms', '_hook_timeout', '_hook_left', '_hook_net_bound', '_hook_reply_send']
          .map((fn) => `${fn}() { printf '%s\\n' ${fn} >> ${JSON.stringify(log)}; return 1; }`),
        `REG=${JSON.stringify(regDir)}; id=lane-a-project-a; payload='{}'; psid=${UUID}`,
        body(), '_hook_reply_report',
      ].join('\n');
      const r = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', env: { PATH: '', ...env } });
      expect(r.status, r.stderr).toBe(0);
      const got = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : [];
      fs.rmSync(dir, { recursive: true, force: true });
      return got;
    };
    const ROW = { 'lane-a-project-a.generation': GENERATION };

    it('no door, a bad hash, a child, a SubagentStop, a reader\'s Stop and a row that is gone: nothing at all is run', () => {
      expect(spawned({ event: 'Stop', paid: '' }, ROW), 'no door').toEqual([]);
      expect(spawned({ event: 'Stop', paid: '', CCRC_DOOR_NONCE_SHA256: 'nope' }, ROW), 'a bad hash').toEqual([]);
      expect(spawned({ event: 'Stop', paid: '', CCRC_DOOR_NONCE_SHA256: HASH }, { ...ROW, 'lane-a-project-a.child': '7' }), 'a child').toEqual([]);
      expect(spawned({ event: 'SubagentStop', paid: '', CCRC_DOOR_NONCE_SHA256: HASH }, ROW), 'a SubagentStop').toEqual([]);
      expect(spawned({ event: 'Stop', paid: '1', CCRC_DOOR_NONCE_SHA256: HASH }, ROW), 'a reader\'s Stop').toEqual([]);
      expect(spawned({ event: 'Stop', paid: '', CCRC_DOOR_NONCE_SHA256: HASH }), 'a row that is gone').toEqual([]);
    });

    it('CONTROL: the same probe sees the arm\'s first call once the gate opens', () => {
      expect(spawned({ event: 'Stop', paid: '', CCRC_DOOR_NONCE_SHA256: HASH }, ROW).length).toBeGreaterThan(0);
    });
  });

  describe('bounded, silent, fail open', () => {
    it('a client that hangs is cut at the bound; the Stop goes on and exits 0 with nothing printed; the body is spooled', () => {
      fs.writeFileSync(path.join(home, 'hang'), '');
      const { out, ms } = run(stopFor(140));
      expect(out).toBe('');
      expect(reports(), 'the stub read the body before it hung').toHaveLength(1);
      expect(spoolLines().map((r) => r['entryUuid'])).toEqual([TU(140)]);
      expect(ms, 'it waited for the bound').toBeGreaterThanOrEqual(REPORT_TIMEOUT_S * 1000 - 1500);
      expect(ms, 'and no longer').toBeLessThan(REPORT_TIMEOUT_S * 1000 + 5000);
    });

    it('once one send has run out its bound no later send is made in the invocation: the spooled head is tried, the Stop\'s own is kept unsent', () => {
      setStatus(502);
      run(stopFor(150));
      setStatus(null);
      fs.writeFileSync(path.join(home, 'hang'), '');
      fs.rmSync(path.join(home, 'reports.log'));
      const { ms } = run(stopFor(151));
      expect(reports().map((r) => r['entryUuid']), 'the head was tried and hung; the own report was never sent').toEqual([TU(150)]);
      expect(spoolLines().map((r) => r['entryUuid'])).toEqual([TU(150), TU(151)]);
      expect(ms, 'one bound, not two').toBeLessThan(REPORT_TIMEOUT_S * 1000 + 5000);
    });

    it('a client that is missing, or exits without an answer, spools the body and prints nothing', () => {
      fs.rmSync(path.join(home, '.local', 'bin', 'ccrc-api'));
      expect(run(stopFor(160)).out).toBe('');
      expect(spoolLines().map((r) => r['entryUuid'])).toEqual([TU(160)]);
      fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
      expect(run(stopFor(161)).out).toBe('');
      expect(spoolLines().map((r) => r['entryUuid'])).toEqual([TU(160), TU(161)]);
    });

    it('prints nothing on stdout on any path: answered, spooled, refused for good, no reply', () => {
      for (const code of [200, 502, 403]) {
        setStatus(code);
        expect(run(stopFor(170)).out, String(code)).toBe('');
      }
      expect(run(stopFor(171, null)).out).toBe('');
    });
  });

  it('the hook\'s three bounds are the L0 ones', () => {
    const text = fs.readFileSync(HOOK, 'utf8');
    const own = (name: string): string | undefined => new RegExp(`^${name}=(\\d+)$`, 'm').exec(text)?.[1];
    expect(own('REPLY_READ_MAX_BYTES')).toBe(String(REPLY_READ_MAX_BYTES));
    expect(own('REPLY_REPORT_MAX_BYTES')).toBe(String(REPLY_REPORT_MAX_BYTES));
    expect(own('REPLY_SPOOL_MAX')).toBe(String(REPLY_SPOOL_MAX));
  });
});
