/**
 * The session hook's Fable arm (D-6792; operator ruling 2026-10-24): Fable runs only when the operator selects it. On a
 * PreToolUse an Agent or Task call whose `model` names Fable, and a Workflow call whose script or input names a Fable
 * model for an agent, is denied; opus, sonnet and haiku pass untouched, and a payload the arm cannot read fails open.
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
  home = mkTmp('ccrc-fable-hook-');
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

describe('the Fable arm denies an agent that names Fable (D-6792)', () => {
  it.each(['Agent', 'Task'])('%s with model fable is denied, with a reason that names the alternatives', (tool) => {
    const why = fire(tool, { description: 'x', prompt: 'do it', model: 'fable' });
    expect(why).toMatch(/opus, sonnet or haiku/);
    expect(why).toMatch(/operator/);
  });
  it('matches the model case-insensitively and as a full id', () => {
    expect(fire('Agent', { prompt: 'p', model: 'Claude-Fable-5' })).not.toBeNull();
  });
  it.each(['opus', 'sonnet', 'haiku'])('Agent with model %s is allowed', (m) => {
    expect(fire('Agent', { prompt: 'p', model: m })).toBeNull();
  });
  it('an Agent that only mentions fable in its prompt is allowed', () => {
    expect(fire('Agent', { prompt: 'write a fable about a fox', model: 'opus' })).toBeNull();
  });
});

describe('the Fable arm denies a Workflow that names Fable (D-6792)', () => {
  it.each([
    ["model: 'fable'", "const r = await agent({ prompt: 'x', model: 'fable' })"],
    ['model: "fable"', 'await agent({ prompt: "x", model: "fable" })'],
    ['a claude-fable id', "agent({ prompt: 'x', model: 'claude-fable-5' })"],
  ])('a script with %s is denied', (_n, script) => {
    expect(fire('Workflow', { script })).toMatch(/opus, sonnet or haiku/);
  });
  it('args naming a Fable model are denied', () => {
    expect(fire('Workflow', { name: 'w', args: { agents: [{ model: 'fable' }] } })).not.toBeNull();
  });
  it('a script that names opus and only says "fable" in prose is allowed', () => {
    expect(fire('Workflow', { script: "agent({ prompt: 'a fable about a fox', model: 'opus', effort: 'high' })" })).toBeNull();
  });
  it('a Workflow without fable is allowed', () => {
    expect(fire('Workflow', { script: "agent({ prompt: 'x', model: 'sonnet', effort: 'low' })" })).toBeNull();
  });
});

describe('the Fable arm fails open (D-6792)', () => {
  it('a malformed payload that names fable prints nothing and exits 0', () => {
    expect(run('{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"model":"fable"')).toBe('');
  });
  it('a non-string model is allowed', () => {
    expect(fire('Agent', { prompt: 'p', model: { fable: 1 } })).not.toMatch(/Fable runs only/);
  });
  it('another tool naming fable is not this arm\'s business', () => {
    expect(fire('Bash', { command: 'echo model: fable' })).toBeNull();
  });
});
