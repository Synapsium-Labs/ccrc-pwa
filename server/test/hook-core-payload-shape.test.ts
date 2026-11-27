/**
 * The payload that is not exactly one JSON value (Go core wave 2, Task 7b). The bash pipes the payload into jq at about
 * fifty sites; on trailing garbage jq prints the first value's result and fails, on two whole values it prints a result
 * for each. Claude Code writes one value, so none of this is reachable in production, but the hook's parity contract and
 * the safety rule (the Go hook never allows what the bash refuses) cover every input. Every event the classification
 * knows, each shape of input (and the deny-worthy variants), through hookBoth: status, stdout and the files must match.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { hookBoth, runHook } from './hookTwin.js';

const ID = 'demo-quiet-basin';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
/** A measuring mode: with this file named, each case records the bash's answer instead of comparing. */
const DUMP = process.env['PAYLOAD_SHAPE_DUMP'];

let home: string;
const fixture = (h: string): void => {
  const reg = path.join(h, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  fs.writeFileSync(path.join(reg, `${ID}.generation`), GENERATION);
  fs.writeFileSync(path.join(reg, `${ID}.child`), '17'); // a child: the merge deny is live
  const bin = path.join(h, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
};
beforeEach(() => { home = mkTmp('ccrc-payshape-'); fixture(home); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const env = (h: string = home): NodeJS.ProcessEnv => ({ ...process.env, HOME: h, PATH: `${path.join(h, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION });

const bashTool = (hook_event_name: string, command: string): object => ({ hook_event_name, session_id: 's1', tool_name: 'Bash', tool_input: { command } });
/** The deny-worthy value: a merge in a child session. */
const DENY = bashTool('PreToolUse', 'gh pr merge 42 --squash');

const EVENTS: Record<string, object> = {
  SessionStart: { hook_event_name: 'SessionStart', session_id: 's1', source: 'startup' },
  UserPromptSubmit: { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'hello' },
  'PreToolUse Bash': bashTool('PreToolUse', 'ls'),
  'PreToolUse Edit': { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: '/tmp/a' } },
  'PreToolUse merge': DENY,
  PostToolUse: bashTool('PostToolUse', 'ls'),
  PermissionRequest: bashTool('PermissionRequest', 'ls'),
  AskUserQuestion: { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'AskUserQuestion', tool_input: { questions: [] } },
  Stop: { hook_event_name: 'Stop', session_id: 's1', background_tasks: [] },
  StopFailure: { hook_event_name: 'StopFailure', session_id: 's1', error: 'rate_limit' },
  SubagentStart: { hook_event_name: 'SubagentStart', session_id: 's1', agent_id: 'ag1' },
  SubagentStop: { hook_event_name: 'SubagentStop', session_id: 's1', agent_id: 'ag1' },
  PreCompact: { hook_event_name: 'PreCompact', session_id: 's1' },
  PostCompact: { hook_event_name: 'PostCompact', session_id: 's1', trigger: 'manual' },
  SessionEnd: { hook_event_name: 'SessionEnd', session_id: 's1' },
  Notification: { hook_event_name: 'Notification', session_id: 's1' },
  PreModelSwitch: { hook_event_name: 'PreModelSwitch', session_id: 's1' },
  PostModelSwitch: { hook_event_name: 'PostModelSwitch', session_id: 's1' },
};
const j = JSON.stringify;
const SHAPES: Record<string, (v: object) => string> = {
  trail: (v) => `${j(v)} garbage`,
  trailNL: (v) => `${j(v)}\n}`,
  'trail deny': () => `${j(DENY)} garbage`,
  two: (v) => `${j(v)}\n${j(v)}`,
  'two, deny second': (v) => `${j(v)}\n${j(DENY)}`,
  'two, deny first': (v) => `${j(DENY)}\n${j(v)}`,
  'two, one line': (v) => `${j(v)}${j(v)}`,
  'scalar number': () => '42',
  'scalar string': () => '"x"',
  'scalar null': () => 'null',
  array: (v) => `[${j(v)}]`,
  empty: () => '',
  blank: () => '  \n',
};

/** One case: the payload through both hooks, compared (or, measuring, the two answers recorded). */
function check(ev: string, shape: string, payload: string): void {
  if (DUMP) {
    const r = runHook({ home, env: (e = {}) => e }, 'bash', payload, env());
    const g2 = mkTmp('ccrc-payshape-g-');
    fixture(g2);
    const g = runHook({ home: g2, env: (e = {}) => e }, 'go', payload, env(g2));
    fs.rmSync(g2, { recursive: true, force: true });
    fs.appendFileSync(DUMP, `${j({ ev, shape, status: r.status, stdout: r.stdout, stderr: r.stderr, gstatus: g.status, gout: g.stdout })}\n`);
    return;
  }
  const r = hookBoth(home, payload, env(), { tree: true, watch: [`.cc-sessions/${ID}.hookstate.json`, `.cc-sessions/${ID}.turn.json`, `.cc-sessions/${ID}.compactevents`] });
  expect(r.status).toBe(0);
}

describe('a payload that is not exactly one JSON value', () => {
  for (const [ev, v] of Object.entries(EVENTS)) {
    for (const [shape, mk] of Object.entries(SHAPES)) it(`${ev}: ${shape}`, () => check(ev, shape, mk(v)));
  }
});

/** A deny-worthy call in a LATER value, behind a first value that says less (or nothing): the bash reads each site's jq
 *  over every value, so a tool name or a command can come from either. */
describe('a deny-worthy call in a later value', () => {
  const firsts: Record<string, object> = {
    'bare PreToolUse': { hook_event_name: 'PreToolUse', session_id: 's1' },
    'Bash ls': bashTool('PreToolUse', 'ls'),
    Edit: EVENTS['PreToolUse Edit']!,
    'Bash, no input': { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash' },
    'Bash, empty input': { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: {} },
    'bare PermissionRequest': { hook_event_name: 'PermissionRequest', session_id: 's1' },
    'Bash ls, PermissionRequest': bashTool('PermissionRequest', 'ls'),
  };
  const seconds: Record<string, object> = {
    'merge, whole': DENY,
    'merge, command only': { tool_input: { command: 'gh pr merge 42 --squash' } },
    'account, whole': bashTool('PreToolUse', 'ccrc account add x'),
    'account, command only': { tool_input: { command: 'ccrc account add x' } },
    'account, tool and command': { tool_name: 'Bash', tool_input: { command: 'ccrc account add x' } },
    'roll, tool and command': { tool_name: 'Bash', tool_input: { command: 'ccd roll' } },
    'account, PermissionRequest': bashTool('PermissionRequest', 'ccrc account add x'),
    'prune, whole': bashTool('PreToolUse', 'git worktree prune'),
    'prune, command only': { tool_input: { command: 'git worktree prune' } },
    'quiz, whole': bashTool('PreToolUse', 'ccrc quiz-record x'),
    'build, whole': bashTool('PreToolUse', 'claude update'),
    'build, command only': { tool_input: { command: 'claude update' } },
    'fable, whole': { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Agent', tool_input: { model: 'fable', prompt: 'x' } },
    'fable, input only': { tool_input: { model: 'fable', prompt: 'x' } },
  };
  // how two values are joined: a newline, nothing, or a newline and then junk after the second
  const join = (a: object, b: object, how: string): string => (how === 'newline' ? `${j(a)}\n${j(b)}` : how === 'adjacent' ? `${j(a)}${j(b)}` : `${j(a)}\n${j(b)} junk`);
  for (const [fn, f] of Object.entries(firsts)) {
    for (const [sn, sv] of Object.entries(seconds)) {
      for (const how of ['newline', 'adjacent', 'junk after']) {
        it(`${fn} then ${sn} (${how})`, () => check(`later: ${fn}`, `${sn} (${how})`, join(f, sv, how)));
        it(`${sn} then ${fn} (${how})`, () => check(`earlier: ${fn}`, `${sn} (${how})`, join(sv, f, how)));
      }
    }
  }
});

/** A typed /model in a session with a door: `_hook_typed_model`'s `jq -e` takes the last value's status, and text jq
 *  cannot read fails it, so the prompt is refused only when the last of several whole values is the typed one. */
describe('a typed /model among several values', () => {
  const typed = { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: '/model opus' };
  const plain = { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'hello' };
  // [payload, whether the bash refuses it]: measured, then held in both hooks
  const cases: Record<string, [string, boolean]> = {
    one: [j(typed), true], 'trailing text': [`${j(typed)} junk`, false], 'typed twice': [`${j(typed)}\n${j(typed)}`, true],
    'plain then typed': [`${j(plain)}\n${j(typed)}`, true], 'typed then plain': [`${j(typed)}\n${j(plain)}`, false],
    'array then typed': [`[1]\n${j(typed)}`, true], 'typed then array': [`${j(typed)}\n[1]`, false],
  };
  for (const [name, [payload, refused]] of Object.entries(cases)) {
    it(name, () => {
      const r = hookBoth(home, payload, { ...env(), CCRC_DOOR_NONCE_SHA256: 'ab'.repeat(32) }, { tree: true, watch: [`.cc-sessions/${ID}.hookstate.json`] });
      expect(r.status).toBe(0);
      expect(r.stdout.includes('"decision":"block"'), 'the bash refuses the typed /model').toBe(refused);
    });
  }
});

/** The number spellings jq reads and JSON does not (jq's lexer takes a run of characters up to a blank or one of
 *  `[]{},:"` as a literal and judges it whole): a payload holding one is still a payload to the bash, which denies the
 *  merge in it, so a Go hook that took it for "no payload" would allow what the bash refuses. The kernel's reader owns
 *  the lexicon (core/internal/kernel/testdata/jq-numbers.golden, measured on jq 1.7 and 1.8.1). */
describe('a number spelling only jq reads', () => {
  const read = ['nan', 'NaN', '-nan', 'sNaN', 'Infinity', '-Infinity', 'inf', '-Inf', '01', '00', '-01', '+1', '.5', '-.5', '1.', '1.e5', '1e999'];
  const refused = ['infinite', '0x1', '1e', 'truex', 'nul', '1-1', '++1', 'nan1'];
  const withX = (x: string, v: object = DENY): string => j({ ...v, x: '@@' }).replace('"@@"', x);
  for (const x of [...read, ...refused]) {
    const isRead = read.includes(x);
    it(`"x":${x} on the merge deny: ${isRead ? 'read, denied' : 'refused, nothing'}`, () => {
      const r = hookBoth(home, withX(x), env(), { tree: true, watch: [`.cc-sessions/${ID}.hookstate.json`] });
      expect(r.status).toBe(0);
      expect(r.stdout.includes('"permissionDecision":"deny"'), 'the bash denies a payload jq reads whole').toBe(isRead);
    });
  }
  // trailing and second values with the spelling (jq: the deny value, then text it cannot read, prints nothing)
  for (const x of ['nan', 'Infinity', '01', '.5', '1.', '+1']) {
    it(`the deny value, then ${x} as text`, () => { hookBoth(home, `${j(DENY)} ${x}`, env(), { tree: true, watch: [`.cc-sessions/${ID}.hookstate.json`] }); });
    it(`the deny value twice, the second holding ${x}`, () => { hookBoth(home, `${j(DENY)}\n${withX(x)}`, env(), { tree: true, watch: [`.cc-sessions/${ID}.hookstate.json`] }); });
    it(`${x} first, then the deny value`, () => { hookBoth(home, `{"x":${x}}\n${j(DENY)}`, env(), { tree: true, watch: [`.cc-sessions/${ID}.hookstate.json`] }); });
  }
});

/** The later per-value sites with their state planted (review F3): the mail hold armed live under a marker, the delegation
 *  spool and the history spool with their directories. The bash runs each site's jq over every value; the Go hook reads
 *  the first, so each row says whether that can change what is printed or kept. The door's reports (a door nonce and a
 *  server to send to) and the roster card (a roster, accounts and a registry) are not planted here: their sends need
 *  the network stubs of hook-core-net.test.ts and the roster fixtures of session-hook-roster-card.test.ts, and neither
 *  site prints a refusal (a report is a send, a card is an `additionalContext`), so they are named in the report. */
describe('the later per-value sites, state planted', () => {
  const plant = (held: boolean): void => {
    const reg = path.join(home, '.cc-sessions');
    if (held) fs.rmSync(path.join(reg, `${ID}.child`)); // the hold is a top-level session's; a start's cards for one are Task 8's
    fs.writeFileSync(path.join(reg, `${ID}.mailhold`), `${Math.floor(Date.now() / 1000) + 300}:coordinator.42`);
    fs.writeFileSync(path.join(reg, 'mailhold-refuse-live'), '');
    fs.mkdirSync(path.join(reg, 'delegation', 'spool', ID), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(home, '.ccrc', 'history', 'spool'), { recursive: true, mode: 0o700 });
  };
  const GATED = ['git', 'pu' + 'sh'].join(' '); // the mail hold's gated act
  const gated = { ...bashTool('PreToolUse', GATED), session_id: 'uuid-1', cwd: home };
  const bare = { hook_event_name: 'PreToolUse', session_id: 's1' };
  const agent = { hook_event_name: 'PostToolUse', session_id: 's1', tool_use_id: 'tu1', tool_name: 'Agent', tool_input: {}, tool_response: { status: 'async_launched', agentId: 'ag1', isAsync: true } };
  const two = (v: object): string => `${j(v)}\n${j(v)}`;
  const rows: Record<string, string> = {
    'gated, one value': j(gated), 'gated, trailing text': `${j(gated)} junk`, 'gated twice': two(gated),
    'bare PreToolUse then gated': `${j(bare)}\n${j(gated)}`, 'gated then a bare PreToolUse': `${j(gated)}\n${j(bare)}`,
    'ls, then gated without a tool': `${j(bashTool('PreToolUse', 'ls'))}\n${j({ tool_input: { command: GATED } })}`,
    'SessionStart twice': two(EVENTS['SessionStart']!), 'SessionStart, trailing text': `${j(EVENTS['SessionStart']!)} junk`,
    'SessionEnd twice': two(EVENTS['SessionEnd']!),
    'agent launch, one value': j(agent), 'agent launch twice': two(agent), 'agent launch, trailing text': `${j(agent)} junk`,
    'SubagentStart twice': two(EVENTS['SubagentStart']!), 'prompt twice': two(EVENTS['UserPromptSubmit']!),
    'Stop, trailing text': `${j(EVENTS['Stop']!)} junk`,
  };
  for (const [name, payload] of Object.entries(rows)) {
    it(name, () => {
      plant(name.includes('gated'));
      const r = hookBoth(home, payload, { ...env(), CLAUDE_CODE_EXECPATH: '/x/2.1.311' }, { tree: true, watch: [`.cc-sessions/${ID}.hookstate.json`, `.cc-sessions/${ID}.deleg`] });
      expect(r.status).toBe(0);
      // the controls: the state is live (the hold refuses the one-value act; a launch leaves a spool file)
      if (name === 'agent launch, one value') expect(fs.readdirSync(path.join(home, '.cc-sessions', 'delegation', 'spool', ID)).length, 'the launch is spooled').toBeGreaterThan(0);
      if (name === 'gated, one value') expect(r.stdout, 'the armed mail hold refuses the gated act').toContain('"permissionDecision":"deny"');
    });
  }
});
