/**
 * The role-skill deny (D-4934): the session hook's PreToolUse arm DENIES a
 * `Skill` call that names `ccrc-worker`, `ccrc-reviewer` or `ccrc-coordinator`
 * when it comes from a SUBAGENT (a payload with a non-empty `agent_id`: a
 * session started by another session's Agent tool or a workflow `agent()` call).
 *
 * Those three skills make whoever loads them act AS the session: ack mail, take
 * claims, send wave-done or review-done, open or dispatch runs, all under the
 * session's identity. A subagent cannot be the session, and one that loaded the
 * worker skill once sent a false wave-done as its worker. The skills' own
 * descriptions say "Never use it inside a subagent", and a subagent on a Codex
 * lane loaded the reviewer skill as its first action anyway, after that wording
 * shipped. So the hook says no, on every lane. Any other skill, and the main
 * thread, are untouched: subagents may use skills by design.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, the way
 * `session-hook-merge-deny.test.ts` does: a stub `tmux` answers the session
 * name, stdin carries the payload, stdout is the one PreToolUse envelope (or
 * nothing). Never the live HOME.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { renderServerCaps, SERVER_CAPS_FILE } from '../../shared/api.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const SKILL_FILES = {
  'ccrc-worker': path.resolve(__dirname, '../../ccd/worker-skill/SKILL.md'),
  'ccrc-reviewer': path.resolve(__dirname, '../../ccd/reviewer-skill/SKILL.md'),
  'ccrc-coordinator': path.resolve(__dirname, '../../ccd/coordinator-skill/SKILL.md'),
} as const;
const ROLE_SKILLS = Object.keys(SKILL_FILES) as Array<keyof typeof SKILL_FILES>;
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'demo-quiet-basin';

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-roleskill-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

type Envelope = { hookSpecificOutput: { hookEventName?: string; permissionDecision?: string; permissionDecisionReason?: string } };
type Result = { deny: string | null; stdout: string; envelope: Envelope | null };

/** One PreToolUse event through the real hook. Exit 0 and a silent stderr are
 *  the hook's standing contract, asserted on every call. `extra` is spread into
 *  the payload (the `agent_id` of a subagent's event, say). */
const fire = (tool: string, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}): Result => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd: home, ...extra }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return { deny: null, stdout: '', envelope: null };
  const envelope = JSON.parse(line) as Envelope;
  return {
    deny: envelope.hookSpecificOutput.permissionDecision === 'deny'
      ? String(envelope.hookSpecificOutput.permissionDecisionReason) : null,
    stdout: line,
    envelope,
  };
};
/** A subagent's Skill call: Claude Code stamps `agent_id` (and `agent_type`) on every event a subagent fires. */
const subagentSkill = (skill: unknown, id: unknown = 'a1b2c3d4e5f6'): Result =>
  fire('Skill', { skill }, { agent_id: id, agent_type: 'general-purpose' });
/** The same call on the main thread: no `agent_id` at all. */
const mainSkill = (skill: unknown): Result => fire('Skill', { skill });

describe('the role-skill deny (D-4934)', () => {
  it('refuses a subagent\'s load of each of the three role skills, in the PreToolUse deny envelope, naming the skill', () => {
    for (const name of ROLE_SKILLS) {
      const r = subagentSkill(name);
      expect(r.deny, `a subagent loaded ${name}`).not.toBeNull();
      expect(r.stdout.split('\n'), 'one line, one envelope').toHaveLength(1);
      expect(Object.keys(r.envelope!), 'the envelope is the contract\'s one key').toEqual(['hookSpecificOutput']);
      expect(Object.keys(r.envelope!.hookSpecificOutput).sort(),
        'the deny envelope\'s three fields, no more').toEqual(['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
      expect(r.envelope!.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(r.envelope!.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(r.deny, 'the reason opens with the ccrc prefix every deny here carries').toMatch(/^ccrc: /);
      expect(r.deny, 'the reason names the skill').toContain(name);
      expect(r.deny, 'the reason says who the caller is').toContain('subagent');
      expect(r.deny, 'the reason says what to do instead').toContain('return your report to your parent');
    }
  });

  it('names the skill the call named, not another of the three', () => {
    // A reason that always said "ccrc-worker" would pass the loop above for the
    // worker alone; each reason must carry its own skill and not the others'.
    for (const name of ROLE_SKILLS) {
      const reason = subagentSkill(name).deny;
      expect(reason, `a subagent loaded ${name}`).not.toBeNull();
      for (const other of ROLE_SKILLS.filter((n) => n !== name)) {
        expect(reason, `the ${name} reason names ${other}`).not.toContain(other);
      }
    }
  });

  it('refuses the same three behind one `<namespace>:` prefix — `x:ccrc-worker` is the worker skill', () => {
    for (const name of ROLE_SKILLS) {
      const r = subagentSkill(`x:${name}`);
      expect(r.deny, `a subagent loaded x:${name}`).not.toBeNull();
      expect(r.deny).toContain(name);
    }
  });

  it('never touches the main thread — no `agent_id` is the session itself, whose skills these are', () => {
    for (const name of ROLE_SKILLS) {
      expect(mainSkill(name).stdout, `the main thread's ${name} was answered`).toBe('');
      expect(mainSkill(`x:${name}`).stdout, `the main thread's x:${name} was answered`).toBe('');
    }
  });

  it('reads an empty-string `agent_id` as the main thread — only a non-empty one marks a subagent', () => {
    for (const name of ROLE_SKILLS) {
      expect(subagentSkill(name, '').stdout, `an empty agent_id denied ${name}`).toBe('');
    }
    // A null one is no id either, and a numeric one is (the parse's own `tostring`).
    expect(subagentSkill('ccrc-worker', null).stdout).toBe('');
    expect(subagentSkill('ccrc-worker', 7).deny).not.toBeNull();
  });

  it('leaves every other skill alone — subagents may use skills by design', () => {
    for (const name of ['superpowers:test-driven-development', 'graphify', 'ccrc-doctor', 'simplify', 'x:y']) {
      expect(subagentSkill(name).stdout, `a subagent's ${name} was answered`).toBe('');
    }
  });

  it('the near misses pass — a name matches exactly, or after ONE namespace prefix and ONE leading slash, never as a substring', () => {
    for (const name of ['ccrc-workers', 'my-ccrc-worker', 'ccrc-worker:x', 'ccrc-reviewers', 'ccrc-coordinator2',
      'ccrc-work', 'CCRC-WORKER', 'ccrc worker',
      // One prefix: `a:b:ccrc-worker` is the skill `b:ccrc-worker` of the plugin `a`, not the worker skill.
      'a:b:ccrc-worker', 'x:y:ccrc-reviewer', 'x:y:ccrc-coordinator',
      // One slash: `//ccrc-worker` is `/ccrc-worker` after Claude Code's strip, a name no skill has.
      '//ccrc-worker', '//ccrc-reviewer', '//ccrc-coordinator']) {
      expect(subagentSkill(name).stdout, `a near miss was denied: ${JSON.stringify(name)}`).toBe('');
    }
  });

  it('reads the name the way Claude Code reads it — trimmed, and ONE leading `/` stripped, before the match', () => {
    // Claude Code's Skill tool does `skill.trim()` and then drops one leading
    // `/` before it resolves the skill (the 2.1.296 tool's input validation), so
    // each of these spellings LOADS the role skill and each must be refused.
    for (const name of ROLE_SKILLS) {
      for (const spelled of [`/${name}`, ` ${name}`, `${name} `, `\t${name}`, `\u00a0${name}`, `${name}\ufeff`,
        `/x:${name}`, `  /${name}\n`, ` /x:${name} `, `\n\r${name}\t`]) {
        const r = subagentSkill(spelled);
        expect(r.deny, `a subagent loaded ${JSON.stringify(spelled)}`).not.toBeNull();
        expect(r.deny, `the reason for ${JSON.stringify(spelled)} names the skill`).toContain(name);
      }
    }
  }, 60_000);  // thirty real hook runs: more than the 20 s default can promise on a loaded box

  it('trims exactly the characters JavaScript\'s String.prototype.trim does, at both ends', () => {
    // U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F,
    // U+205F, U+3000 and U+FEFF: every one of them, leading and trailing, so a
    // character dropped from the hook's set is red here and not a silent hole.
    const set: number[] = [];
    for (let c = 0x09; c <= 0x0d; c++) set.push(c);
    set.push(0x20, 0xa0, 0x1680);
    for (let c = 0x2000; c <= 0x200a; c++) set.push(c);
    set.push(0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff);
    for (const c of set) {
      const ch = String.fromCodePoint(c);
      const hex = `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
      expect(ch.trim(), `${hex} is not in JavaScript's trim set`).toBe('');
      expect(subagentSkill(`${ch}ccrc-worker`).deny, `a leading ${hex} was not trimmed`).not.toBeNull();
      expect(subagentSkill(`ccrc-worker${ch}`).deny, `a trailing ${hex} was not trimmed`).not.toBeNull();
    }
  }, 60_000);  // fifty real hook runs

  it('trims once, before the slash — a space after the slash is no longer an edge, and a slash after a prefix is no leading slash', () => {
    // Claude Code trims, THEN strips one `/`: it does not trim again, so
    // `/ ccrc-worker` is the name ` ccrc-worker` (no skill) and not the worker.
    for (const name of ['/ ccrc-worker', '/\tccrc-worker', 'x:/ccrc-worker', 'x: ccrc-worker', ' / ccrc-worker']) {
      expect(subagentSkill(name).stdout, `a near miss was denied: ${JSON.stringify(name)}`).toBe('');
    }
  });

  it('a payload with no readable skill name denies nothing — a missing, null, numeric or object skill, or no tool_input at all', () => {
    for (const skill of [undefined, null, 7, {}, [], '']) {
      expect(subagentSkill(skill).stdout, `denied on skill=${JSON.stringify(skill)}`).toBe('');
    }
    const bare = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Skill', agent_id: 'a1', cwd: home }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
    });
    expect(bare.status).toBe(0);
    expect(bare.stdout.trim()).toBe('');
    // A tool_input that is a bare string would make `.tool_input.skill` an error in jq: fail open.
    const str = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: 'ccrc-worker', agent_id: 'a1', cwd: home }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
    });
    expect(str.status).toBe(0);
    expect(str.stdout.trim()).toBe('');
  });

  it('only a `Skill` call is asked — a subagent\'s Bash call, or any other tool carrying a `skill` field, is unaffected', () => {
    const sub = { agent_id: 'a1b2c3d4e5f6', agent_type: 'general-purpose' };
    expect(fire('Bash', { command: 'echo ccrc-worker' }, sub).stdout,
      'a subagent\'s Bash call that only names the skill was answered').toBe('');
    expect(fire('Bash', { command: 'ls' }, sub).stdout, 'a subagent\'s plain Bash call was answered').toBe('');
    expect(fire('Task', { skill: 'ccrc-worker', prompt: 'ccrc-worker' }, sub).stdout,
      'a subagent\'s Task call carrying skill: \'ccrc-worker\' was answered — the gate does not require tool_name Skill').toBe('');
    expect(fire('Agent', { skill: 'ccrc-reviewer' }, sub).stdout,
      'a subagent\'s Agent call carrying skill: \'ccrc-reviewer\' was answered').toBe('');
  });

  it('costs one jq, for the skill\'s name, and only on a subagent\'s Skill call — no event of any other kind, and not the main thread, pays a fork for it', () => {
    // A `jq` shim in front of the real one logs every call whose program reads
    // the skill field and then runs the real jq: the hot-path budget (README:
    // the hook runs on every tool call of every fleet session) measured, not
    // read off the structure.
    const real = (process.env['PATH'] ?? '').split(path.delimiter).map((d) => path.join(d, 'jq')).find((p) => fs.existsSync(p));
    expect(real, 'no jq on PATH').toBeDefined();
    const log = path.join(home, 'jq-skill-reads.log');
    fs.writeFileSync(path.join(home, 'bin', 'jq'),
      `#!/bin/sh\nfor a in "$@"; do case "$a" in *tool_input.skill*) echo read >> '${log}' ;; esac; done\nexec '${real}' "$@"\n`,
      { mode: 0o755 });
    const reads = (run: () => Result): number => {
      fs.rmSync(log, { force: true });
      run();
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').length : 0;
    };
    const sub = { agent_id: 'a1b2c3d4e5f6', agent_type: 'general-purpose' };
    expect(reads(() => subagentSkill('superpowers:test-driven-development')), 'a subagent\'s Skill call').toBe(1);
    expect(reads(() => subagentSkill('ccrc-worker')), 'a subagent\'s role skill').toBe(1);
    expect(reads(() => mainSkill('ccrc-worker')), 'the main thread\'s Skill call').toBe(0);
    expect(reads(() => fire('Bash', { command: 'ls' }, sub)), 'a subagent\'s Bash call').toBe(0);
    expect(reads(() => fire('Bash', { command: 'ls' })), 'the main thread\'s Bash call').toBe(0);
    expect(reads(() => fire('Task', { skill: 'ccrc-worker' }, sub)), 'a subagent\'s call to another tool').toBe(0);
    expect(reads(() => fire('AskUserQuestion', { questions: [] }, sub)), 'a subagent\'s question').toBe(0);
  });

  it('a subagent\'s denied load leaves the hookstate write alone — the deny prints, the state still lands', () => {
    const r = subagentSkill('ccrc-worker');
    expect(r.deny).not.toBeNull();
    const state = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', `${ID}.hookstate.json`), 'utf8')) as { event: string };
    expect(state.event).toBe('PreToolUse');
  });
});

describe('the deny never replaces a deny already set (D-4934)', () => {
  // Unreachable in ONE payload, and that is a fact about the payload rather
  // than about this gate: `tool_name` is a single value, and every other deny
  // in the hook (the graph search gate: Grep, Glob, Read, Bash; the worker
  // merge deny: Bash) fires on a tool this gate does not, so a `Skill` event
  // reaches this gate with `pre_json` empty today. The guard is still written,
  // so the day another arm denies a Skill call it keeps its own reason, and the
  // cheapest pin is the one the merge-deny suite uses for its structure: read
  // the gate's own condition from the hook and require the guard in it.
  const hook = fs.readFileSync(HOOK, 'utf8');
  const code = hook.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('the gate\'s condition carries the merge deny\'s own `!= *\'"permissionDecision":"deny"\'*` guard', () => {
    const gate = /if \[\[ "\$event" == PreToolUse && "\$\{tool:-\}" == Skill[\s\S]*?\]\]; then/.exec(code);
    expect(gate, 'the role-skill gate is gone from the hook\'s tail').not.toBeNull();
    expect(gate![0]).toContain('-n "$paid"');
    expect(gate![0], 'the gate would replace a deny already set')
      .toContain(`"$pre_json" != *'"permissionDecision":"deny"'*`);
  });

  it('the gate sits after the merge deny and before the `SubagentStart` arm — in the tail, below README\'s :2900 anchor', () => {
    const at = (needle: string): number => {
      const i = hook.indexOf(needle);
      expect(i, `${needle} is gone`).toBeGreaterThan(-1);
      return hook.slice(0, i).split('\n').length;
    };
    const merge = at('mreason="ccrc: $mwhy, and a wave');
    const gate = at('== Skill');
    const sub = at('if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then');
    expect(gate, 'after the merge deny').toBeGreaterThan(merge);
    expect(gate, 'before the SubagentStart arm').toBeLessThan(sub);
    expect(gate, 'README anchors the hook at :2900: nothing new lands above it').toBeGreaterThan(2900);
  });

  it('the Skill event pays no fork before the gate\'s own jq — the condition is bash builtins and the one read is inside `then`', () => {
    const gate = /if \[\[ "\$event" == PreToolUse && "\$\{tool:-\}" == Skill[\s\S]*?\]\]; then([\s\S]*?)\nfi\n/.exec(code);
    expect(gate, 'the role-skill gate is gone from the hook\'s tail').not.toBeNull();
    expect(gate![0].split('then')[0], 'a command substitution in the gate\'s condition forks on every Skill event').not.toContain('$(');
    expect(gate![0].match(/\bjq\b/g) ?? [], 'exactly one jq read in the gate').toHaveLength(1);
  });
});

describe('the three names, written once (D-4934)', () => {
  const hook = fs.readFileSync(HOOK, 'utf8');
  const defs = hook.split('\n').filter((l) => /^ROLE_SKILLS=/.test(l));

  it('the hook defines ROLE_SKILLS once, as a quoted space-separated list', () => {
    expect(defs, 'one definition').toHaveLength(1);
    expect(defs[0]).toMatch(/^ROLE_SKILLS="[a-z-]+( [a-z-]+)*"$/);
  });

  it('the list is exactly the `name:` frontmatter of the worker, reviewer and coordinator skills — a rename turns this red', () => {
    const named = (file: string): string => {
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'));
      expect(fm, `${file} has no frontmatter`).not.toBeNull();
      const m = /^name:[ \t]*(\S+)[ \t]*$/m.exec(fm![1]!);
      expect(m, `${file} has no name:`).not.toBeNull();
      return m![1]!;
    };
    const frontmatter = Object.values(SKILL_FILES).map(named).sort();
    const inHook = /^ROLE_SKILLS="([^"]*)"$/m.exec(hook)![1]!.split(' ').sort();
    expect(inHook).toEqual(frontmatter);
    // And the test's own table agrees, so a fourth skill added to one side only is red on both.
    expect(ROLE_SKILLS.slice().sort()).toEqual(frontmatter);
  });
});

// D-5232 (plan 2026-10-16 Task 2): behind the server's word `hook-main-state-v1`, an agent event with no hookstate file
// to carry writes none, and is NOT a silent exit: the tail's one print is still reached, so a subagent's role-skill deny
// is printed on a session that has no file yet. The server's words are written the way Task 9b's writers write them.
describe('the deny prints on a session with no hookstate file (D-5232)', () => {
  it('a subagent\'s role-skill load with no hookstate file prints its deny and writes no file', () => {
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', SERVER_CAPS_FILE),
      renderServerCaps(['dispatch-live-gate-v1', 'hook-main-state-v1'], Math.floor(Date.now() / 1000)));
    const state = path.join(home, '.cc-sessions', `${ID}.hookstate.json`);
    expect(fs.existsSync(state)).toBe(false);
    const r = subagentSkill('ccrc-worker');
    expect(r.deny).not.toBeNull();
    expect(r.envelope!.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(fs.existsSync(state), 'no file to carry: no hookstate is written').toBe(false);
  });
});
