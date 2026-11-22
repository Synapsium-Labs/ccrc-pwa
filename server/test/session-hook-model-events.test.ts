// The model events and the typed /model (Overlord W1 door process B2, plan w1-door-process.md Task 8; spec §3.6 H1, §3.4
// Table 3.4b "The model changes inside a generation", W0-12). Both events are REPORT-ONLY (ruled, F11): `PostModelSwitch`
// sends one `model-switch` report, `how: 'switched'`, for every session the start report covers (a main-thread session
// with a registry row that is not a child: plan question 11, so a coordinator's switch is measured too), and
// `PreModelSwitch` refuses nothing and sends nothing. Each arm exits before the hook's state write (ruled, F14), so the
// state file stays byte for byte as it was. The one refusal is on the prompt path: a `UserPromptSubmit` whose prompt begins
// `/model`, in a session with a door (`CCRC_DOOR_NONCE_SHA256`: a fact, never a role's name), is blocked with the event's
// own block answer and reported `how: 'typed-refused'` (slug `typed-model-refused-on-the-prompt-path`).
//
// Runs ccd/session-hook.sh for real in a fixture HOME with a RECORDING `ccrc-api` stub. No live box, no live server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { MODEL_SWITCH_HOWS, REPORT_MODEL_MAX } from '../../shared/continuity-reports.js';
import { hookReportOf } from '../src/continuity/hookReports.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const HASH = 'ab'.repeat(32);

let home: string;
const reg = (...p: string[]): string => path.join(home, '.cc-sessions', ...p);
const stateFile = (): string => reg(`${ID}.hookstate.json`);

beforeEach(() => {
  home = mkTmp('ccrc-hook-model-events-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.writeFileSync(reg(`${ID}.generation`), GENERATION);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'tmux-name'), `cc-${ID}\n`);
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\ncat "$HOME/tmux-name"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    'printf "%s %s\\n" "$1" "$2" >> "$HOME/verbs.log"',
    '[ "$1 $2" = "sessions report" ] || exit 0',
    'cat >> "$HOME/reports.log"',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

type Report = Record<string, unknown>;
const reports = (): Report[] => {
  const f = path.join(home, 'reports.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Report) : [];
};
const common = { session_id: UUID, transcript_path: path.join('/rig', `${UUID}.jsonl`), cwd: path.join('/rig', 'work') };

/** The hook's exit asserted; `door` puts the launch nonce's hash in the environment. */
const run = (payload: object, door = false): string => {
  const r = spawnSyncGroup('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
      ...(door ? { CCRC_DOOR_NONCE_SHA256: HASH } : {}),
    },
  });
  expect(r.error, 'the spawn itself did not fail').toBeUndefined();
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return String(r.stdout);
};
const switchEvent = (name: 'PreModelSwitch' | 'PostModelSwitch', from: unknown = 'claude-opus-5-5', to: unknown = 'claude-sonnet-5-5', extra: object = {}): object =>
  ({ ...common, hook_event_name: name, from_model: from, to_model: to, ...extra });
const prompt = (said: string): object => ({ ...common, hook_event_name: 'UserPromptSubmit', prompt: said });

describe('PostModelSwitch: one report, for every session the start report covers', () => {
  it.each([[true], [false]])('door %s: one model-switch report, how switched, from and to as the payload names them', (door) => {
    const out = run(switchEvent('PostModelSwitch'), door);
    expect(out, 'report-only: nothing printed').toBe('');
    const rs = reports();
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: 'model-switch', how: 'switched', from: 'claude-opus-5-5', to: 'claude-sonnet-5-5', fromId: ID, fromUuid: UUID });
    expect(typeof rs[0]!['at']).toBe('number');
  });

  it('the body narrows at the report door (hookReportOf), for strings, objects with an id, and anything else', () => {
    const cases: Array<[unknown, unknown, unknown, unknown]> = [
      ['opus', 'sonnet', 'opus', 'sonnet'],
      [{ id: 'claude-opus-5-5', display_name: 'Opus' }, { id: 'claude-haiku-5-5' }, 'claude-opus-5-5', 'claude-haiku-5-5'],
      [null, 7, null, null],
      ['', 'a\u0001b\u007fc', null, 'abc'],
      ['x'.repeat(REPORT_MODEL_MAX + 50), 'café', 'x'.repeat(REPORT_MODEL_MAX), 'caf'],
    ];
    for (const [from, to, wantFrom, wantTo] of cases) {
      fs.rmSync(path.join(home, 'reports.log'), { force: true });
      run(switchEvent('PostModelSwitch', from, to));
      const rs = reports();
      expect(rs, JSON.stringify([from, to])).toHaveLength(1);
      expect(rs[0]!['from']).toBe(wantFrom);
      expect(rs[0]!['to']).toBe(wantTo);
      expect(hookReportOf(rs[0]!).ok, JSON.stringify(rs[0])).toBe(true);
    }
  });

  it('a payload with neither field still reports, both null', () => {
    run({ ...common, hook_event_name: 'PostModelSwitch' });
    expect(reports()).toEqual([expect.objectContaining({ kind: 'model-switch', how: 'switched', from: null, to: null })]);
  });

  it('a child, a subagent and a session with no registry row send nothing', () => {
    run(switchEvent('PostModelSwitch', 'a', 'b', { agent_id: 'a0000000000000001' }));
    fs.writeFileSync(reg(`${ID}.child`), '7');
    run(switchEvent('PostModelSwitch'));
    fs.rmSync(reg(`${ID}.child`));
    fs.rmSync(reg(`${ID}.generation`));
    run(switchEvent('PostModelSwitch'));
    expect(reports()).toEqual([]);
  });
});

describe('the model report covers exactly the ids the start report covers (review 3317 F3)', () => {
  const verbs = (): string[] => {
    const f = path.join(home, 'verbs.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
  };
  it.each([['lane-a.project-a', false], ['lane_a-project-a', true]] as const)('id %s: start report %s, and the model report the same', (sid, sent) => {
    // The hook itself admits a dot in an id; the start report does not (`_hook_start_report`'s id test).
    fs.writeFileSync(path.join(home, 'tmux-name'), `cc-${sid}\n`);
    fs.writeFileSync(reg(`${sid}.generation`), GENERATION);
    run({ ...common, hook_event_name: 'SessionStart', source: 'startup' });
    expect(verbs().includes('sessions start'), 'the start report').toBe(sent);
    run(switchEvent('PostModelSwitch'));
    expect(reports().length, 'the model report').toBe(sent ? 1 : 0);
  });
});

describe('PreModelSwitch: refuses nothing and sends nothing', () => {
  it.each([[true], [false]])('door %s: no output, no report', (door) => {
    expect(run(switchEvent('PreModelSwitch'), door)).toBe('');
    expect(reports()).toEqual([]);
  });
});

describe('the model events never touch the hook state (ruled, F14)', () => {
  it.each([['PreModelSwitch'], ['PostModelSwitch']] as const)('%s leaves the state file byte for byte', (name) => {
    run(prompt('first'));
    const before = fs.readFileSync(stateFile());
    run(switchEvent(name), true);
    run(switchEvent(name), false);
    expect(fs.readFileSync(stateFile()).equals(before)).toBe(true);
  });
  it.each([['PreModelSwitch'], ['PostModelSwitch']] as const)('%s writes no state file where none stood', (name) => {
    run(switchEvent(name), true);
    expect(fs.existsSync(stateFile())).toBe(false);
  });
});

describe('a typed /model: refused in a session with a door, passed elsewhere', () => {
  const blocked = (out: string): Record<string, unknown> => JSON.parse(out.trim()) as Record<string, unknown>;

  it.each([['/model opus', 'opus'], ['/model', null], ['  /model sonnet\nmore', 'sonnet'], ['/model\topus', 'opus']])(
    '%j is blocked with the prompt event\'s block answer and reported typed-refused', (said, to) => {
      const out = run(prompt(said), true);
      const b = blocked(out);
      expect(b['decision']).toBe('block');
      expect(String(b['reason'])).toMatch(/^ccrc: /);
      const rs = reports();
      expect(rs).toEqual([expect.objectContaining({ kind: 'model-switch', how: 'typed-refused', from: null, to, fromId: ID, fromUuid: UUID })]);
      expect(hookReportOf(rs[0]!).ok).toBe(true);
    });

  it('a blocked prompt writes no state: no turn opened', () => {
    run(prompt('/model opus'), true);
    expect(fs.existsSync(stateFile())).toBe(false);
    expect(fs.existsSync(reg(`${ID}.turn.json`))).toBe(false);
  });

  it('a prompt that only mentions /model, or a longer command, passes', () => {
    for (const said of ['please run /model opus', '/models', '/modelx', 'x /model', '/effort high']) {
      const out = run(prompt(said), true);
      expect(out, said).not.toContain('"block"');
    }
    expect(reports().filter((r) => r['kind'] === 'model-switch')).toEqual([]);
  });

  it('in a session without a door, a typed /model passes and nothing is reported', () => {
    expect(run(prompt('/model opus'), false)).not.toContain('"block"');
    expect(reports()).toEqual([]);
    expect(fs.existsSync(stateFile()), 'the ordinary prompt write ran').toBe(true);
  });
});

describe('the wire', () => {
  it('the hook sends only the hows the L0 vocabulary holds', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    for (const how of src.match(/_hook_model_report ([a-z-]+)/g) ?? []) {
      expect(MODEL_SWITCH_HOWS as readonly string[]).toContain(how.split(' ')[1]);
    }
    expect((src.match(/_hook_model_report ([a-z-]+)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
