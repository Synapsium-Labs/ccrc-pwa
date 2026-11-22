/**
 * The surface arm (Overlord W1 sandbox PR B, Task 8; slug `surface-arm-refuses-what-the-profile-lacks`): with
 * `CCRC_LAUNCH_PROFILE` set, the session hook reads that role's row from the installed `launch-profiles.json` and denies a
 * `PreToolUse` whose tool the row does not list (its `--tools`, or a tool of the server its reader types name), an `Agent`
 * or `Task` call whose `subagent_type` is not a declared reader type, and a `Skill` call naming a skill the row does not
 * stage, compared whole after the role-skill arm's reader. An unreadable row denies. It enforces the INSTALLED row and judges
 * no digest; without the variable it does nothing.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, the way `session-hook-role-skill-deny.test.ts` does. Never the live
 * HOME. The "installed row" cases run a copy of the hook beside a copy of `lib/` whose row differs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { launchDigestOf } from '../src/continuity/launchProfile.js';

const CCD = path.resolve(__dirname, '../../ccd');
const HOOK = path.join(CCD, 'session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'lane-a-overlord';
const PROFILE = `overlord:${launchDigestOf('overlord')}`;
/** The pin the overlord row's environment carries, so the D-6798 arm passes an Agent call that names no model. */
const PIN = { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' };

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-surface-arm-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** One PreToolUse event through the hook; the deny reason, or null. Exit 0 and a silent stderr on every call. */
function fire(tool: string, input: Record<string, unknown>, env: Record<string, string> = { CCRC_LAUNCH_PROFILE: PROFILE, ...PIN },
  opts: { hook?: string; extra?: Record<string, unknown> } = {}): string | null {
  const r = spawnSync('bash', [opts.hook ?? HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: home, ...opts.extra }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`, TMUX_PANE: '%1',
      CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, ...env },
  });
  expect(r.status, 'the hook contract: exit 0').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return null;
  const o = JSON.parse(line) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return o.hookSpecificOutput.permissionDecision === 'deny' ? String(o.hookSpecificOutput.permissionDecisionReason) : null;
}

/** A copy of the hook beside a copy of `lib/` whose `launch-profiles.json` is `edit(rows)`; the hook path. */
function installed(edit: (rows: Record<string, Record<string, unknown>>) => unknown): string {
  const dir = path.join(home, 'installed');
  fs.cpSync(path.join(CCD, 'lib'), path.join(dir, 'lib'), { recursive: true });
  fs.copyFileSync(HOOK, path.join(dir, 'session-hook.sh'));
  const f = path.join(dir, 'lib', 'launch-profiles.json');
  const rows = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, Record<string, unknown>>;
  const out = edit(rows);
  fs.writeFileSync(f, typeof out === 'string' ? out : JSON.stringify(rows));
  return path.join(dir, 'session-hook.sh');
}

describe('the surface arm (W1 sandbox B, Task 8)', () => {
  it('allows the row\'s tools: a door tool, a declared reader, the staged skill', () => {
    expect(fire('mcp__door__read', { id: 'x' })).toBeNull();
    expect(fire('mcp__door__act', { act: 'note' })).toBeNull();
    expect(fire('Agent', { subagent_type: 'overlord-reader', prompt: 'read' })).toBeNull();
    expect(fire('Skill', { skill: 'ccrc-overlord' })).toBeNull();
  });

  it('denies a tool the row does not list, a built-in or another server\'s', () => {
    for (const t of ['Bash', 'Read', 'AskUserQuestion', 'mcp__plug__x', 'mcp__doorx__read']) {
      const r = fire(t, {});
      expect(r, t).toContain('launch profile');
      expect(r, t).toContain(t);
    }
  });

  it('denies an Agent or Task call whose subagent_type is not a declared reader type, or names none', () => {
    for (const tool of ['Agent', 'Task']) {
      expect(fire(tool, { subagent_type: 'general-purpose', prompt: 'p' }), tool).toContain('general-purpose');
      expect(fire(tool, { prompt: 'p' }), tool).not.toBeNull();
    }
    expect(fire('Task', { subagent_type: 'overlord-reader', prompt: 'p' })).toBeNull();
  });

  it('denies a Skill not in the row, a prefixed name included, read the role-skill arm\'s way', () => {
    expect(fire('Skill', { skill: 'dataviz' })).toContain('dataviz');
    expect(fire('Skill', { skill: 'x:ccrc-overlord' })).toContain('x:ccrc-overlord');
    expect(fire('Skill', { skill: 'ccrc-overlord-x' })).not.toBeNull();
    expect(fire('Skill', { skill: ' /ccrc-overlord\t' })).toBeNull();
  });

  it('does nothing without CCRC_LAUNCH_PROFILE', () => {
    expect(fire('Read', { file_path: '/x' }, {})).toBeNull();
    expect(fire('Skill', { skill: 'dataviz' }, {})).toBeNull();
    expect(fire('mcp__plug__x', {}, {})).toBeNull();
  });

  it('denies every call when the row cannot be read: an absent role, a malformed variable, a file that is not JSON', () => {
    expect(fire('Skill', { skill: 'ccrc-overlord' }, { CCRC_LAUNCH_PROFILE: 'ghost:abc', ...PIN })).toContain('could not be read');
    expect(fire('mcp__door__read', {}, { CCRC_LAUNCH_PROFILE: 'Over Lord', ...PIN })).toContain('could not be read');
    // The variable's grammar, not the row's absence: an installed row under the malformed name is still never read.
    const oddKey = installed((rows) => { rows['Over Lord'] = rows['overlord']!; });
    expect(fire('mcp__door__read', {}, { CCRC_LAUNCH_PROFILE: 'Over Lord', ...PIN }, { hook: oddKey })).toContain('could not be read');
    const hook = installed(() => '{not json');
    expect(fire('mcp__door__read', {}, undefined, { hook })).toContain('could not be read');
    const noFlags = installed((rows) => { delete rows['overlord']!['flags']; });
    expect(fire('mcp__door__read', {}, undefined, { hook: noFlags })).toContain('could not be read');
  });

  /** The row's flags less one flag and its value. */
  const without = (flag: string) => installed((rows) => {
    const flags = rows['overlord']!['flags'] as string[];
    const i = flags.indexOf(flag);
    expect(i, `the fixture row carries ${flag}`).toBeGreaterThanOrEqual(0);
    flags.splice(i, 2);
  });

  it('denies every call when the row\'s flags lack --tools: malformed, never a usable surface (review 3325 F5)', () => {
    const hook = without('--tools');
    for (const [t, input] of [['mcp__door__read', {}], ['Agent', { subagent_type: 'overlord-reader', prompt: 'p' }],
      ['Skill', { skill: 'ccrc-overlord' }]] as const) {
      expect(fire(t, input, undefined, { hook }), t).toContain('could not be read');
    }
  });

  it('denies every call when the row\'s flags lack --agents (review 3325 F5)', () => {
    const hook = without('--agents');
    for (const [t, input] of [['mcp__door__read', {}], ['Skill', { skill: 'ccrc-overlord' }]] as const) {
      expect(fire(t, input, undefined, { hook }), t).toContain('could not be read');
    }
    // The flag's own test, not a parse failure by accident: the agents' JSON moved to the slot after the first flag.
    const moved = installed((rows) => {
      const flags = rows['overlord']!['flags'] as string[];
      const i = flags.indexOf('--agents');
      const [, json] = flags.splice(i, 2);
      flags[1] = json!;
    });
    expect(fire('mcp__door__read', {}, undefined, { hook: moved })).toContain('could not be read');
  });

  it('denies every call when the row\'s staged skills or its --agents value is not an object', () => {
    const noSkills = installed((rows) => { rows['overlord']!['stagedSkills'] = ['ccrc-overlord']; });
    expect(fire('mcp__door__read', {}, undefined, { hook: noSkills })).toContain('could not be read');
    const listAgents = installed((rows) => {
      const flags = rows['overlord']!['flags'] as string[];
      flags[flags.indexOf('--agents') + 1] = '[]';
    });
    expect(fire('mcp__door__read', {}, undefined, { hook: listAgents })).toContain('could not be read');
  });

  it('enforces the installed row, whatever digest the session carries', () => {
    const hook = installed((rows) => {
      const flags = rows['overlord']!['flags'] as string[];
      flags[flags.indexOf('--tools') + 1] = 'Agent,Skill,Read';
    });
    expect(fire('Read', { file_path: '/x' }, undefined, { hook })).toBeNull();
    expect(fire('Read', { file_path: '/x' })).not.toBeNull();
  });

  it('leaves an earlier arm\'s deny in place: a subagent loading a role skill reads the role-skill arm\'s reason', () => {
    const r = fire('Skill', { skill: 'ccrc-worker' }, undefined, { extra: { agent_id: 'a1b2c3', agent_type: 'overlord-reader' } });
    expect(r).toContain('from a subagent');
    expect(r).not.toContain('launch profile');
  });

  it('applies to a subagent\'s call too', () => {
    expect(fire('Bash', { command: 'true' }, undefined, { extra: { agent_id: 'a1b2c3', agent_type: 'overlord-reader' } })).toContain('Bash');
    expect(fire('mcp__door__read', {}, undefined, { extra: { agent_id: 'a1b2c3', agent_type: 'overlord-reader' } })).toBeNull();
  });
});
