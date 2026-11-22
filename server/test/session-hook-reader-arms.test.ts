// The hook's reader arms (Overlord W1 door process B2, plan w1-door-process.md Task 8; spec §3.3.10 C55: "a reader never
// acts", "a second line" and "Bounds"). Three PreToolUse deny arms, each keyed on a fact, never on a role's name:
//   - READER SCOPE (ruled, F24): a door tool other than `mcp__door__read`, called by a reader, is denied. A reader is a call
//     whose agent id has a recorded join (`$REG/<id>.joined`) or whose payload carries an `agent_type`.
//   - THREE READERS (plan question 10, slug `reader-bound-in-the-scope-arm`): a main-thread `Agent` (or `Task`) call in a
//     session with a door (`CCRC_DOOR_NONCE_SHA256`), while the hook's subagent roster holds three entries, is denied.
//   - READER MODEL (slug `reader-model-arm-kept-as-a-belt`): under the pin (`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`), an
//     `Agent` call naming a model other than `$CLAUDE_CODE_SUBAGENT_MODEL` is denied.
// A denied door call sends no witness (B1's witness runs after every deny arm).
//
// Runs ccd/session-hook.sh for real in a fixture HOME with a RECORDING `ccrc-api` stub. No live box, no live server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { mkTmp } from './tmpHelpers.js';
import { DOOR_TOOL_PREFIX } from '../../shared/continuity-reports.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const ID = 'lane-a-project-a';
const UUID = '00000000-0000-4000-8000-000000000001';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const HASH = 'ab'.repeat(32);
const AGENT = 'a0000000000000001';
const door = (n: string): string => `${DOOR_TOOL_PREFIX}${n}`;

let home: string;
const reg = (...p: string[]): string => path.join(home, '.cc-sessions', ...p);

beforeEach(() => {
  home = mkTmp('ccrc-hook-reader-arms-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.writeFileSync(reg(`${ID}.generation`), GENERATION);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    '[ "$1 $2" = "sessions report" ] || exit 0',
    'cat >> "$HOME/reports.log"',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reports = (): Array<Record<string, unknown>> => {
  const f = path.join(home, 'reports.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};
const common = { session_id: UUID, transcript_path: path.join('/rig', `${UUID}.jsonl`), cwd: path.join('/rig', 'work') };

/** The hook's stdout, its exit asserted. `env` adds to the fixture environment; `hasDoor` puts the launch nonce's hash in it. */
const run = (payload: object, hasDoor = true, env: Record<string, string> = {}): string => {
  const r = spawnSyncGroup('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
      CLAUDE_CODE_SUBAGENT_MODEL: '', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '',
      ...(hasDoor ? { CCRC_DOOR_NONCE_SHA256: HASH } : {}), ...env,
    },
  });
  expect(r.error, 'the spawn itself did not fail').toBeUndefined();
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return String(r.stdout);
};
const denied = (out: string): string | null => {
  if (!out.includes('"permissionDecision":"deny"')) return null;
  return String((JSON.parse(out.trim()) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason);
};
const pre = (tool: string, input: object = {}, extra: object = {}): object =>
  ({ ...common, hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: 'toolu_01', tool_input: input, ...extra });
const agentCall = (input: object = { description: 'read', prompt: 'read the board', subagent_type: 'overlord-reader', model: 'sonnet' }): object =>
  pre('Agent', input);
const rosterId = (i: number): string => `a00000000000000${i}`;
/** A hook state file whose subagent roster holds `n` entries, as SubagentStart writes them. */
const roster = (n: number): void => {
  const subs = Array.from({ length: n }, (_, i) => ({ name: 'overlord-reader', startedAt: 1_700_000_000_000 + i, id: rosterId(i) }));
  fs.writeFileSync(reg(`${ID}.hookstate.json`), `${JSON.stringify({ v: 1, state: 'working', event: 'PreToolUse', sessionId: UUID, pid: 4242,
    updatedAt: 1_700_000_000_000, ask: null, subagents: subs, graphQueries: 0, graphGateDenials: 0, ccrcPeerReads: 0, ccrcClaims: 0 })}\n`);
};

describe('reader scope: a reader holds no write door (C55)', () => {
  it('a joined reader\'s note_add is denied and sends no witness; its read is allowed and witnessed', () => {
    fs.writeFileSync(reg(`${ID}.joined`), `${AGENT}\n`);
    const why = denied(run(pre(door('note_add'), { text: 'x' }, { agent_id: AGENT })));
    expect(why).toMatch(/^ccrc: /);
    expect(why).toContain(door('read'));
    expect(reports()).toEqual([]);
    expect(denied(run(pre(door('read'), { door: 'board' }, { agent_id: AGENT })))).toBeNull();
    expect(reports().map((r) => r['kind'])).toEqual(['witness']);
  });

  it('an unjoined call carrying agent_type is denied; a call with neither join nor type is allowed', () => {
    expect(denied(run(pre(door('card'), {}, { agent_id: 'a0000000000000002', agent_type: 'overlord-reader' })))).not.toBeNull();
    expect(denied(run(pre(door('card'), {}, { agent_id: 'a0000000000000003' })))).toBeNull();
    expect(denied(run(pre(door('card'), {})))).toBeNull();
  });

  it('keys on the tool and the reader facts, not on the door hash: it holds in a session without one', () => {
    fs.writeFileSync(reg(`${ID}.joined`), `${AGENT}\n`);
    expect(denied(run(pre(door('note_add'), {}, { agent_id: AGENT }), false))).not.toBeNull();
  });

  it('a reader\'s tool that is not a door tool is left to the other arms', () => {
    fs.writeFileSync(reg(`${ID}.joined`), `${AGENT}\n`);
    expect(denied(run(pre('Read', { file_path: '/rig/work/x' }, { agent_id: AGENT })))).toBeNull();
    expect(denied(run(pre('mcp__other__note_add', {}, { agent_id: AGENT })))).toBeNull();
  });
});

describe('three readers at most', () => {
  it('a fourth is denied, a third allowed, and a stop frees a place', () => {
    roster(2);
    expect(denied(run(agentCall()))).toBeNull();
    roster(3);
    const why = denied(run(agentCall()));
    expect(why).toMatch(/^ccrc: /);
    expect(why).toContain('three readers');
    roster(4);
    expect(denied(run(agentCall()))).not.toBeNull();
    roster(3);
    run({ ...common, hook_event_name: 'SubagentStop', agent_id: rosterId(0) });
    expect(denied(run(agentCall())), 'the stop removed one roster entry').toBeNull();
  });

  it('a Task call counts as an Agent call', () => {
    roster(3);
    expect(denied(run(pre('Task', { description: 'x', prompt: 'y', model: 'sonnet' })))).not.toBeNull();
  });

  it('only in a session with a door, and only on the main thread', () => {
    roster(3);
    expect(denied(run(agentCall(), false))).toBeNull();
    expect(denied(run(pre('Agent', { description: 'x', prompt: 'y', model: 'sonnet' }, { agent_id: AGENT })))).toBeNull();
  });
});

describe('reader model: under the pin, only the pinned model', () => {
  const PIN = { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' };
  it('opus is denied; sonnet, or no model named, is allowed', () => {
    const why = denied(run(agentCall({ description: 'x', prompt: 'y', model: 'opus' }), true, PIN));
    expect(why).toMatch(/^ccrc: /);
    expect(why).toContain('sonnet');
    expect(denied(run(agentCall({ description: 'x', prompt: 'y', model: 'sonnet' }), true, PIN))).toBeNull();
    expect(denied(run(agentCall({ description: 'x', prompt: 'y' }), true, PIN))).toBeNull();
  });

  it('a Task call naming another model is denied too', () => {
    expect(denied(run(pre('Task', { description: 'x', prompt: 'y', model: 'haiku' }), true, PIN))).not.toBeNull();
  });

  it('without the pin the arm does nothing', () => {
    expect(denied(run(agentCall({ description: 'x', prompt: 'y', model: 'opus' }), true, { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' }))).toBeNull();
    expect(denied(run(agentCall({ description: 'x', prompt: 'y', model: 'opus' }), true, { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }))).toBeNull();
  });
});
