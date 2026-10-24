/**
 * The session hook's fan-out arm (D-6798; operator ruling 2026-10-24): an Agent or Task call names a `model`, and every
 * `agent(...)` call in a Workflow script names a `model` and an `effort`, or the PreToolUse arm denies it and points at
 * the routing matrix. A payload the arm cannot read fails open.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME. Never the live HOME.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const TOP = 'project-a-calm-mesa';
const CWD = '/srv/work/project-a';

let home: string;
beforeAll(() => {
  home = mkTmp('ccrc-fanout-hook-');
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  fs.writeFileSync(path.join(reg, `${TOP}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "cc-%s\\n" "${TMUX_PANE#%}"\n', { mode: 0o755 });
});
afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); });

const env = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: `%${TOP}`, CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
});
const run = (stdin: string): string => {
  const r = spawnSync('bash', [HOOK], { input: stdin, encoding: 'utf8', env: env() });
  expect(r.status, 'exit 0 on every path').toBe(0);
  expect(r.stderr, 'silent on stderr').toBe('');
  return r.stdout.trim();
};
/** The deny reason, or null when the hook printed no deny. */
const fire = (tool: string, input: unknown): string | null => {
  const out = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: CWD }));
  if (out === '') return null;
  const e = JSON.parse(out) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return e.hookSpecificOutput.permissionDecision === 'deny' ? String(e.hookSpecificOutput.permissionDecisionReason) : null;
};

describe('an Agent or Task call must name its model (D-6798)', () => {
  it.each(['Agent', 'Task'])('%s without a model is denied, with a reason that names the routing matrix', (tool) => {
    const why = fire(tool, { description: 'x', prompt: 'do it' });
    expect(why).toMatch(/routing matrix/);
    expect(why).toMatch(/names no model/);
  });
  it('an empty model counts as none', () => {
    expect(fire('Agent', { prompt: 'p', model: '' })).not.toBeNull();
  });
  it.each(['opus', 'sonnet', 'haiku'])('Agent with model %s is allowed', (m) => {
    expect(fire('Agent', { prompt: 'p', model: m })).toBeNull();
  });
  it('a Task with a model is allowed', () => {
    expect(fire('Task', { prompt: 'p', model: 'sonnet' })).toBeNull();
  });
});

describe('a Workflow agent() call must name its model and effort (D-6798)', () => {
  it('an agent() call without effort is denied', () => {
    const why = fire('Workflow', { script: "const r = await agent({ prompt: 'x', model: 'sonnet' })" });
    expect(why).toMatch(/routing matrix/);
    expect(why).toMatch(/model or no effort/);
  });
  it('an agent() call without a model is denied', () => {
    expect(fire('Workflow', { script: "await agent({ prompt: 'x', effort: 'high' })" })).not.toBeNull();
  });
  it('one bare agent() among named ones is denied', () => {
    const script = "await agent({ prompt: 'a', model: 'opus', effort: 'high' });\nawait agent({ prompt: 'b', model: 'haiku' });";
    expect(fire('Workflow', { script })).not.toBeNull();
  });
  it('every agent() call naming a model and an effort is allowed', () => {
    const script = "await agent({ prompt: 'a', model: 'opus', effort: 'high' });\nawait agent({ prompt: 'b', model: 'haiku', effort: 'low' });";
    expect(fire('Workflow', { script })).toBeNull();
  });
  it('a script with no agent() call is allowed', () => {
    expect(fire('Workflow', { script: 'return 1 + 1' })).toBeNull();
  });
  it('a Workflow without a script is not this arm\'s business', () => {
    expect(fire('Workflow', { name: 'saved' })).toBeNull();
  });
});

describe('a Workflow agent() call is read as code, not as text (D-6798)', () => {
  it('options kept in a shared object are not seen, so the call is allowed', () => {
    expect(fire('Workflow', { script: 'const W = { model: "sonnet", effort: "low" }; await agent("x", W)' })).toBeNull();
    expect(fire('Workflow', { script: 'const W = { model: "sonnet", effort: "low" }; await pipeline(items, i => agent(i, W))' })).toBeNull();
    expect(fire('Workflow', { script: 'await agent("x", { ...W, effort: "low" })' })).toBeNull();
  });
  it('the text agent( inside a string is not a call', () => {
    expect(fire('Workflow', { script: "await agent(`call agent( later`, { model: 'opus', effort: 'high' })" })).toBeNull();
    expect(fire('Workflow', { script: "const p = 'then agent(x) the rest'; return p" })).toBeNull();
  });
  it('the word model in the prompt is not a model option', () => {
    expect(fire('Workflow', { script: "await agent('review the data model', { effort: 'low' })" })).not.toBeNull();
    expect(fire('Workflow', { script: "await agent('review the model: effort: x', { model: 'opus' })" })).not.toBeNull();
  });
  it('a two-argument call with inline options needs both keys', () => {
    expect(fire('Workflow', { script: "await agent('x', { model: 'opus', effort: 'high' })" })).toBeNull();
    expect(fire('Workflow', { script: "await agent('x', { model, effort })" })).toBeNull();
    expect(fire('Workflow', { script: "await agent('x', { model: 'opus' })" })).not.toBeNull();
    expect(fire('Workflow', { script: "await agent('x')" })).not.toBeNull();
  });
  it('a quote inside a regex literal does not flip the string state', () => {
    expect(fire('Workflow', { script: "const re = /'/; await agent('p', {model:'opus', effort:'low'}); const s = 'agent(foo)'" })).toBeNull();
    expect(fire('Workflow', { script: "const re = /'/; await agent('p', {model:'opus'})" })).not.toBeNull();
  });
  it('an unterminated string is unknown, so it is allowed', () => {
    expect(fire('Workflow', { script: "await agent('p" })).toBeNull();
  });
  it('a script that starts with agent( and ends on an identifier character is still read', () => {
    expect(fire('Workflow', { script: "agent('x')\nfoo" })).not.toBeNull();
  });
  it('commas inside the prompt or a nested call do not end the first argument', () => {
    expect(fire('Workflow', { script: "await agent(f(a, b) + 'x, y', { model: 'opus', effort: 'high' })" })).toBeNull();
    expect(fire('Workflow', { script: "await agent(f(a, b) + 'x, y', { model: 'opus' })" })).not.toBeNull();
  });
});

describe('a Workflow run by scriptPath is checked as its file (D-6798)', () => {
  let dir: string;
  beforeAll(() => { dir = mkTmp('ccrc-fanout-script-'); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const file = (name: string, body: string): string => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
  it('a file with a bare agent() is denied', () => {
    expect(fire('Workflow', { scriptPath: file('bare.js', "await agent('x')") })).toMatch(/routing matrix/);
  });
  it('a fully routed file is allowed', () => {
    expect(fire('Workflow', { scriptPath: file('ok.js', "await agent('x', { model: 'opus', effort: 'high' })") })).toBeNull();
  });
  it('a missing, unreadable, directory or oversize file fails open', () => {
    expect(fire('Workflow', { scriptPath: path.join(dir, 'nope.js') })).toBeNull();
    expect(fire('Workflow', { scriptPath: dir })).toBeNull();
    expect(fire('Workflow', { scriptPath: file('big.js', `${' '.repeat(262145)}await agent('x')`) })).toBeNull();
  });
  it('an inline script wins over a scriptPath', () => {
    expect(fire('Workflow', { script: 'return 1', scriptPath: file('bare2.js', "await agent('x')") })).toBeNull();
  });
  it('a saved workflow by name is not read (out of scope)', () => {
    expect(fire('Workflow', { name: 'saved' })).toBeNull();
  });
});

describe('the fan-out arm fails open (D-6798)', () => {
  it('a malformed Agent payload prints nothing and exits 0', () => {
    expect(run('{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"prompt":"p"')).toBe('');
  });
  it('a non-object tool_input is allowed', () => {
    expect(fire('Agent', 'just a string')).toBeNull();
  });
  it('a non-string script is allowed', () => {
    expect(fire('Workflow', { script: 42 })).toBeNull();
  });
  it('another tool is not this arm\'s business', () => {
    expect(fire('Bash', { command: 'echo agent( x' })).toBeNull();
  });
});
