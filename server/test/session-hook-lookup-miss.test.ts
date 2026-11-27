/**
 * A PreToolUse whose session lookup misses fails closed (Go core wave 2, Task 9c; the controller's ruling "the spine's
 * misses"). The miss is no session matched: a pane whose tmux session is not `cc-<id>`, a job directory whose session
 * id no registry row's `.uuid` holds, a name off the id class, or neither. Until this task both hooks ended there and
 * skipped every deny arm. Now only the SAFETY arms run, without reading a row (the controller's ruling "scope of
 * fail-closed"): account management and secrets, the forbidden verbs, build and install, the protected paths (the
 * approval surface's signing key and verifier among them), the quiz record, the prune, and the `--admin` and `gh api`
 * merge bypass, the account arm asked as a child is. The fleet POLICY arms answer a miss as before 9c, with no deny (the
 * role skill, Fable, the fan-out pin, the test route, the reader arms, the graph gate, the landing advisory), and so do
 * a coordinator's own acts (the wave's plain merge, the approval surface's API half). The fixture plants decoys at the
 * names an empty id would reach (`$REG/.child`, `.hold`, `.project`, `.generation`, `.joined`), so a stage or an arm that
 * ran with the empty id would deny what is left, allow what is refused, or leave a file, and every case asserts the
 * HOME's files unchanged and both hooks' stderr empty. Every case runs the bash hook and the Go hook (hookBoth), which
 * must answer the same.
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
  expect(r.goStderr, 'the Go hook, silent on stderr too').toBe('');
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

// The SAFETY arms: each refuses on a miss (the controller's ruling "scope of fail-closed", Task 9c fix round 1).
const ACCT = /an account-management act no fleet session runs/;
const SURFACE = /reaches the approval surface/;
const REFUSED: [string, object, RegExp][] = [
  ['the account row', pre('Bash', { command: 'ccrc account remove --id lane-x' }), ACCT],
  ['the --admin bypass, its allowance unprovable', pre('Bash', { command: 'gh pr merge 5 --admin' }), /merges are refused in every session/],
  ['the gh api merge', pre('Bash', { command: 'gh api -X PUT repos/o/r/pulls/5/merge' }), /merges are refused in every session/],
  ['the prune row', pre('Bash', { command: 'git worktree prune' }), /runs `git worktree prune`/],
  ['the quiz record', pre('Bash', { command: 'ccrc quiz-record --week 1' }), /the replay quiz's record/],
  ['a secret read', pre('Read', { file_path: '~/.cc-secrets/ccrc-mail.token' }), ACCT],
  ['an Edit of the roster', pre('Edit', { file_path: '~/.ccrc/accounts.json', old_string: 'a', new_string: 'b' }), ACCT],
  ['a Write into the build directory', pre('Write', { file_path: '~/.local/share/claude/versions/9.9.9', content: 'x' }), /a write to a Claude Code build/],
  ['a child\'s verb row', pre('Bash', { command: 'ccd ws-rm lane-a' }), /ws-rm.*which a dispatched child never runs.*could not match this call to a session's registry row/],
  ['a child\'s build row', pre('Bash', { command: 'claude update' }), /installing or updating a Claude Code build.*could not match this call/],
  ['a Read of the signing key', pre('Read', { file_path: '~/.ccrc/approval-signing.key' }), SURFACE],
  ['a cat of the signing key', pre('Bash', { command: 'cat ~/.ccrc/approval-signing.key' }), SURFACE],
  ['a Write of the verifier', pre('Write', { file_path: '~/.cc-sessions/approval-verify.mjs', content: 'x' }), SURFACE],
  ['an Edit of the verifier', pre('Edit', { file_path: '~/.cc-sessions/approval-verify.mjs', old_string: 'a', new_string: 'b' }), SURFACE],
];

// Answered as before 9c, with no deny: the fleet POLICY arms, and a coordinator's own acts.
const LEFT: [string, object, NodeJS.ProcessEnv?][] = [
  ['a plain merge: a coordinator lands PRs, and the wave\'s hold is unread', pre('Bash', { command: 'gh pr merge 5' })],
  ['the approval surface\'s API half: a coordinator rules approvals', pre('Bash', { command: 'ccrc-api approvals list' })],
  ['the role skill from a subagent', pre('Skill', { skill: 'ccrc-worker' }, { agent_id: 'agent-1' })],
  ['a Fable model', pre('Agent', { model: 'fable', prompt: 'x' })],
  ['a fan-out that names no model', pre('Agent', { prompt: 'x' })],
  ['a wrapped test run', pre('Bash', { command: 'systemd-run --user --scope npx vitest run' })],
  ['a heavy test run', pre('Bash', { command: 'npx vitest run' })],
  ['a reader\'s write door', pre('mcp__door__write', { x: 1 }, { agent_id: 'agent-2', agent_type: 'Explore' })],
  ['a subagent\'s door write', pre('mcp__door__write', { x: 1 }, { agent_id: 'agent-1' })],
  ['a model other than the pinned one', pre('Agent', { model: 'opus', prompt: 'x' }),
    { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }],
  ['a search: the graph gate', pre('Grep', { pattern: 'x' })],
  ['a sync: the landing advisory', pre('Bash', { command: 'git merge origin/main' })],
];

describe('a PreToolUse whose session lookup misses runs the SAFETY arms, and the POLICY arms answer as before', () => {
  for (const shape of ['neither', 'pane', 'job'] as const) {
    describe(`a miss: ${shape}`, () => {
      // every case on the first shape; the other two take two refusals and one left row
      const refused = shape === 'neither' ? REFUSED : REFUSED.slice(0, 2);
      const left = shape === 'neither' ? LEFT : LEFT.slice(0, 1);
      it.each(refused)('refuses %s', (_n, payload, why) => {
        expect(denial(run(shape, payload))).toMatch(why);
      });
      it.each(left)('leaves %s', (_n, payload, env) => {
        expect(run(shape, payload, env)).toBe('');
      });
    });
  }

  // An off-class name (`cc-a b`): a miss whose id is reset to empty, so the row it names is never read (F5).
  it('a pane named off the id class is a miss, and the row its name spells is never read', () => {
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), '#!/bin/sh\necho "cc-a b"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(reg, 'a b.hold'), WAVE_HOLD);
    fs.writeFileSync(path.join(reg, 'a b.project'), 'project-a');
    expect(run('pane', pre('Bash', { command: 'gh pr merge 5' })), 'its wave hold is unread').toBe('');
    expect(denial(run('pane', pre('Bash', { command: 'gh pr merge 5 --admin' }))), 'its allowance is unread').toMatch(/merges are refused in every session/);
    expect(denial(run('pane', pre('Bash', { command: 'claude update' }))), 'asked as a child').toMatch(/could not match this call/);
  });

  // A payload that only names PreToolUse passes the builtin prefilter and ends at the parsed event: a typed /model in a
  // session with a door would otherwise be refused and reported under no session.
  it('every other event on a miss still ends silently, a payload that only names PreToolUse included', () => {
    expect(run('neither', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr merge 5 --admin # PreToolUse' } })).toBe('');
    expect(run('neither', { hook_event_name: 'UserPromptSubmit', prompt: '/model opus', note: 'PreToolUse' },
      { CCRC_DOOR_NONCE_SHA256: 'a'.repeat(64) })).toBe('');
    expect(run('neither', { hook_event_name: 'SessionStart', source: 'startup' })).toBe('');
  });
});
