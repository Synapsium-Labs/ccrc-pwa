/**
 * A PreToolUse whose session lookup misses fails closed (Go core wave 2, Task 9c; the controller's ruling "the spine's
 * misses"). The miss is no session matched: a pane whose tmux session is not `cc-<id>`, a job directory whose session
 * id no registry row's `.uuid` holds, or neither. Until this task both hooks ended there and skipped every deny arm. Now
 * the arms run with every session fact read as absent, so each arm that needs no session fact refuses as it does in
 * every session (the account, quiz and prune rows, the `--admin` and `gh api` bypass, the role skill, Fable, the
 * fan-out pin, the `wrapped` test route, a reader's write door), and the rows that need one are left as an unknown
 * session has them (the wave's merge, the child's rows, the `heavy` test route, a joined reader, the readers' bound).
 * The graph gate and the landing advisory do not run, and nothing reads or writes a row: the fixture plants decoys at
 * the names an empty id would reach (`$REG/.child`, `.hold`, `.project`, `.generation`, `.joined`), so a stage or an arm
 * that ran with the empty id would deny what is left, allow what is refused, or leave a file, and every case asserts
 * the HOME's files unchanged. Every case runs the bash hook and the Go hook (hookBoth), which must answer the same.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { hookBoth } from './hookTwin.js';

const WAVE_HOLD = 'program:project-a wave:2/5 run:17';

let home: string;
let reg: string;
beforeEach(() => {
  home = mkTmp('ccrc-lookupmiss-');
  reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(path.join(reg, 'admin-merge-allowed'), { recursive: true });
  // The decoys: what a session row would say, at the names an empty id reaches.
  fs.writeFileSync(path.join(reg, '.child'), '17');
  fs.writeFileSync(path.join(reg, '.hold'), WAVE_HOLD);
  fs.writeFileSync(path.join(reg, '.project'), 'project-a');
  fs.writeFileSync(path.join(reg, 'admin-merge-allowed', 'project-a'), '');
  fs.writeFileSync(path.join(reg, '.generation'), '0189abcd-1234-5678-9abc-0123456789ab');
  fs.writeFileSync(path.join(reg, '.joined'), 'agent-1\n');
  // another session's row, whose uuid is not this event's
  fs.writeFileSync(path.join(reg, 'lane-a.uuid'), 'uuid-other\n');
  fs.mkdirSync(path.join(home, '.ccrc', 'history', 'spool'), { recursive: true });
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  // a tmux whose pane is in a session ccd did not name; a classifier that reads a systemd-run as wrapped, else heavy
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho main\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ccrc'),
    '#!/bin/sh\ncase "$*" in *systemd-run*) echo wrapped ;; *) echo heavy ;; esac\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** Every file under the HOME, by relative path. */
const files = (): string[] => {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(home, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r); else out.push(r);
    }
  };
  walk('');
  return out.sort();
};

type Shape = 'pane' | 'job' | 'neither';
const SHAPE: Record<Shape, NodeJS.ProcessEnv> = {
  pane: { TMUX_PANE: '%1', TMUX: '/tmp/tmux-1/default,1,0' },
  job: { CLAUDE_JOB_DIR: '/job', CLAUDE_CODE_SESSION_ID: 'uuid-this' },
  neither: {},
};
/** The runner's env less every name of the session it runs in (tests run inside Claude Code sessions and tmux panes). */
const BASE: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|CCRC_|TMUX)/i.test(k)));

/** One hook event in both hooks, on a miss of `shape`: the envelope it printed ('' for none). Exit 0, a silent stderr
 *  and an unchanged HOME are asserted on every call. */
const run = (shape: Shape, payload: object, env: NodeJS.ProcessEnv = {}): string => {
  const before = files();
  const r = hookBoth(home, JSON.stringify(payload), {
    ...BASE, HOME: home, PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`, ...SHAPE[shape], ...env,
  }, { tree: true });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  expect(files(), 'a miss writes nothing').toEqual(before);
  return r.stdout.trim();
};
const pre = (tool: string, input: object, extra: object = {}): object =>
  ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: '/tmp', ...extra });
const denial = (out: string): string => {
  const j = JSON.parse(out) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  expect(j.hookSpecificOutput.permissionDecision).toBe('deny');
  return String(j.hookSpecificOutput.permissionDecisionReason);
};

// The arms that need no session fact: each refuses on a miss, in every shape of miss.
const REFUSED: [string, object, RegExp][] = [
  ['the --admin bypass, its allowance unprovable', pre('Bash', { command: 'gh pr merge 5 --admin' }), /merges are refused in every session/],
  ['the account row', pre('Bash', { command: 'ccrc account remove --id lane-x' }), /an account-management act no fleet session runs/],
  ['the prune row', pre('Bash', { command: 'git worktree prune' }), /runs `git worktree prune`/],
  ['the role skill from a subagent', pre('Skill', { skill: 'ccrc-worker' }, { agent_id: 'agent-1' }), /loads the `ccrc-worker` skill from a subagent/],
  ['a Fable model', pre('Agent', { model: 'fable', prompt: 'x' }), /names a Fable model/],
  ['a fan-out that names no model', pre('Agent', { prompt: 'x' }), /names no model/],
  ['a wrapped test run', pre('Bash', { command: 'systemd-run --user --scope npx vitest run' }), /never under a systemd-run of your own/],
  ['a reader\'s write door', pre('mcp__door__write', { x: 1 }, { agent_id: 'agent-2', agent_type: 'Explore' }), /a reader holds no write door/],
];

// The rows that need a session fact: left on a miss, as an unknown session has them.
const LEFT: [string, object][] = [
  ['a plain merge: a coordinator lands PRs, and the wave\'s hold is unread', pre('Bash', { command: 'gh pr merge 5' })],
  ['a child\'s verb row: a top-level session runs it after asking', pre('Bash', { command: 'ccd ws-rm lane-a' })],
  ['a heavy test: not a fleet session\'s', pre('Bash', { command: 'npx vitest run' })],
  ['a joined reader\'s door: the join record is the session\'s', pre('mcp__door__write', { x: 1 }, { agent_id: 'agent-1' })],
  ['a search: the graph gate\'s bound is the session\'s counter', pre('Grep', { pattern: 'x' })],
  ['a sync: the landing advisory is a nudge, never a deny', pre('Bash', { command: 'git merge origin/main' })],
];

describe('a PreToolUse whose session lookup misses runs the deny arms that need no session fact', () => {
  for (const shape of ['neither', 'pane', 'job'] as const) {
    describe(`a miss: ${shape}`, () => {
      // every case on the first shape; the other two take one refusal and one left row each
      const refused = shape === 'neither' ? REFUSED : REFUSED.slice(0, 1);
      const left = shape === 'neither' ? LEFT : LEFT.slice(0, 1);
      it.each(refused)('refuses %s', (_n, payload, why) => {
        expect(denial(run(shape, payload))).toMatch(why);
      });
      it.each(left)('leaves %s', (_n, payload) => {
        expect(run(shape, payload)).toBe('');
      });
    });
  }

  // A payload that only names PreToolUse passes the builtin prefilter and ends at the parsed event: a typed /model in a
  // session with a door would otherwise be refused and reported under no session.
  it('every other event on a miss still ends silently, a payload that only names PreToolUse included', () => {
    expect(run('neither', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr merge 5 --admin # PreToolUse' } })).toBe('');
    expect(run('neither', { hook_event_name: 'UserPromptSubmit', prompt: '/model opus', note: 'PreToolUse' },
      { CCRC_DOOR_NONCE_SHA256: 'a'.repeat(64) })).toBe('');
    expect(run('neither', { hook_event_name: 'SessionStart', source: 'startup' })).toBe('');
  });
});
