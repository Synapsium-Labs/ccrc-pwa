// `agent-events-keep-the-main-state` (D-5232; plan 2026-10-16-working-state-and-interruptions Task 2, spec §5.2 and
// §6.1): the HOOK side. An agent event (a payload carrying `agent_id`: PreToolUse other than AskUserQuestion,
// PostToolUse, SubagentStart, SubagentStop) never rewrites the main thread's state: it keeps `state`, `event`,
// `updatedAt`, `ask`, `interrupted`, `waitBy`, `waitPrev` and D-5231's pair, and writes `aliveAt` = now. That carry is
// SELF-GATED: it engages only while `~/.ccrc/server-caps` (Task 9b's file) is whole, current within the lease by the
// hook's own clock, and lists `hook-main-state-v1`; otherwise the event writes exactly what it writes today. The roster
// (`subagents`) is keyed by `agent_id`, and that half is not gated.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME. The harness is COPIED from
// session-hook-turnmark.test.ts (a test file cannot import another). Every payload copies the key set of the matching
// event in the committed capture `fixtures/delegation/2.1.292/agent-iso-bg.json`, with neutral ids and text. No
// capture holds a PermissionRequest: its payload here is the capture's agent PreToolUse key set with that event name
// and no `tool_use_id`, DERIVED [B].
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { SERVER_CAPS, SERVER_CAPS_FILE, SERVER_CAPS_LEASE_S, renderServerCaps } from '../../shared/api.js';
import { readHookStateMeasured } from '../src/hookstate.js';
import { localIO } from '../src/io.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const WORD = 'hook-main-state-v1';

/** The row's generation, exactly 36 bytes and no LF, as ccd writes it. */
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';
const SID = '00000000-0000-4000-8000-000000000001';
let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-agent-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hookEnv = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home,
  PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242',
  CCRC_SESSION_GENERATION: GENERATION,
});
const run = (payload: object, env: NodeJS.ProcessEnv = {}): string =>
  execFileSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...hookEnv(), ...env } });
const reg = (): string => path.join(home, '.cc-sessions');
const stateFile = (): string => path.join(reg(), `${ID}.hookstate.json`);
const readState = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;
const seed = (over: Record<string, unknown>): void => {
  fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...over }) + '\n');
};

// ── the server's words, written the way Task 9b's writers write them (`renderServerCaps`) ─────────────────────────
const capsPath = (): string => path.join(home, '.ccrc', SERVER_CAPS_FILE);
const nowS = (): number => Math.floor(Date.now() / 1000);
const writeCapsText = (text: string): void => {
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(capsPath(), text, { mode: 0o600 });
};
const writeCaps = (words: readonly string[], ageS = 0): void => { writeCapsText(renderServerCaps(words, nowS() - ageS)); };
const advertise = (): void => { writeCaps(['dispatch-live-gate-v1', WORD]); };

// ── payloads: the capture's key sets, neutral ids ──────────────────────────────────────────────────────────────────
const A = 'a0000000000000001';
const B = 'a0000000000000002';
const common = { session_id: SID, transcript_path: `/rig/fixhome/cfg/projects/-rig-repo/${SID}.jsonl` };
const prompt = '00000000-0000-4000-8000-0000000000a1';
const subTask = (id: string): Record<string, unknown> =>
  ({ id, type: 'subagent', status: 'running', description: 'fixture agent', agent_type: 'general-purpose' });
const stop = (tasks: unknown = [subTask(A), subTask(B)]): Record<string, unknown> => ({
  ...common, cwd: '/rig/repo', prompt_id: prompt, permission_mode: 'default', effort: { level: 'medium' },
  hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'fixture',
  ...(tasks === undefined ? {} : { background_tasks: tasks }), session_crons: [],
});
const stopNoTasks = (): Record<string, unknown> => {
  const p = stop();
  delete p['background_tasks'];
  return p;
};
const userPrompt = (): Record<string, unknown> => ({
  ...common, cwd: '/rig/repo', prompt_id: prompt, permission_mode: 'default',
  hook_event_name: 'UserPromptSubmit', prompt: 'fixture prompt',
});
const agentTool = (ev: 'PreToolUse' | 'PostToolUse', id = A, tool = 'Bash'): Record<string, unknown> => ({
  ...common, cwd: `/rig/repo/.claude/worktrees/agent-${id}`, prompt_id: prompt, permission_mode: 'default',
  agent_id: id, agent_type: 'general-purpose', effort: { level: 'medium' }, hook_event_name: ev,
  tool_name: tool, tool_input: { command: 'true', description: 'fixture' },
  ...(ev === 'PreToolUse' ? { tool_use_id: 'toolu_rig000002' }
    : { tool_response: { stdout: '', stderr: '', interrupted: false, isImage: false }, tool_use_id: 'toolu_rig000002' }),
});
const subStart = (id = A, type = 'general-purpose'): Record<string, unknown> => ({
  ...common, cwd: `/rig/repo/.claude/worktrees/agent-${id}`, prompt_id: prompt,
  agent_id: id, agent_type: type, hook_event_name: 'SubagentStart',
});
const subStop = (id = A, type = 'general-purpose'): Record<string, unknown> => ({
  ...common, cwd: `/rig/repo/.claude/worktrees/agent-${id}`, prompt_id: prompt, permission_mode: 'default',
  agent_id: id, agent_type: type, effort: { level: 'medium' }, hook_event_name: 'SubagentStop', stop_hook_active: false,
  agent_transcript_path: `/rig/fixhome/cfg/projects/-rig-repo/${SID}/subagents/agent-${id}.jsonl`,
  last_assistant_message: 'fixture', background_tasks: [subTask(id)], session_crons: [],
});
/** DERIVED [B]: no capture holds a PermissionRequest; the agent PreToolUse key set with this event name. */
const agentPermission = (id = A): Record<string, unknown> => ({
  ...common, cwd: `/rig/repo/.claude/worktrees/agent-${id}`, prompt_id: prompt, permission_mode: 'default',
  agent_id: id, agent_type: 'general-purpose', effort: { level: 'medium' }, hook_event_name: 'PermissionRequest',
  tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'fixture' },
});
const sessionStart = (source: string): Record<string, unknown> => ({
  ...common, cwd: '/rig/repo', hook_event_name: 'SessionStart', source, model: 'fixture-model',
});

/** T0: a main Stop listing two subagents, its stamp moved 40 minutes back so "kept" is a strict, observable fact. */
const T0 = (): number => Date.now() - 40 * 60_000;
const stopAtT0 = (): number => {
  run(stop());
  const t0 = T0();
  seed({ updatedAt: t0 });
  return t0;
};
const PAIR = { bgDelegated: 2, bgDelegatedKinds: 'subagent' };

describe('the carry engages only behind the server\'s word (D-5232, spec §6.1)', () => {
  const todays = (t0: number, env: NodeJS.ProcessEnv = {}): void => {
    const before = Date.now();
    run(agentTool('PostToolUse'), env);
    const s = readState();
    expect(s).toMatchObject({ state: 'working', event: 'PostToolUse', ask: null });
    expect(s['updatedAt'] as number).toBeGreaterThanOrEqual(before);
    expect(s['updatedAt']).not.toBe(t0);
    expect(s).not.toHaveProperty('aliveAt');
    expect(s).not.toHaveProperty('bgDelegated');
  };
  it('(a) no server-caps file: today\'s write', () => { todays(stopAtT0()); });
  it('(b) a current file listing only dispatch-live-gate-v1: today\'s write', () => {
    writeCaps(['dispatch-live-gate-v1']);
    todays(stopAtT0());
  });
  it('(c) a file 181 s old: today\'s write', () => {
    writeCaps(['dispatch-live-gate-v1', WORD], SERVER_CAPS_LEASE_S + 1);
    todays(stopAtT0());
  });
  it('(d) a file whose `at` is in the future: today\'s write', () => {
    writeCaps(['dispatch-live-gate-v1', WORD], -120);
    todays(stopAtT0());
  });
  it('(e) a torn file (no `end` line): today\'s write', () => {
    writeCapsText(renderServerCaps(['dispatch-live-gate-v1', WORD], nowS()).replace(/end\n$/, ''));
    todays(stopAtT0());
  });
  it('(f) a file with a word that fails the grammar: today\'s write', () => {
    writeCapsText(`at ${nowS()}\ncaps ${WORD} Not_A_Word\nend\n`);
    todays(stopAtT0());
  });
  // The gate is Task 10's `_hook_server_cap` (D-5239), its word class spelled letter by letter: under a UTF-8 locale a
  // bash range may collate a non-ASCII lowercase letter into `a-z`, and the TypeScript grammar refuses such a word.
  it('(f2) a non-ASCII lowercase word beside it, under LC_ALL=en_US.UTF-8: today\'s write', () => {
    writeCapsText(`at ${nowS()}\ncaps ${WORD} caf\u00e9\nend\n`);
    todays(stopAtT0(), { LC_ALL: 'en_US.UTF-8' });
  });
  it('(g2) a file listing only a prefix of the arm\'s word: today\'s write', () => {
    writeCaps(['dispatch-live-gate-v1', 'hook-main-state']);
    todays(stopAtT0());
  });
  it('(g) a file listing only a word that merely starts with the arm\'s word: today\'s write (exact match, never a prefix)', () => {
    writeCaps(['dispatch-live-gate-v1', `${WORD}x`]);
    todays(stopAtT0());
  });
  it('(h) a file listing the word but carrying a fourth line: today\'s write', () => {
    writeCapsText(`${renderServerCaps([WORD], nowS())}extra\n`);
    todays(stopAtT0());
  });
  it('with the word listed and the file 179 s old: the carry', () => {
    writeCaps(['dispatch-live-gate-v1', WORD], SERVER_CAPS_LEASE_S - 1);
    const t0 = stopAtT0();
    run(agentTool('PostToolUse'));
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0, ...PAIR });
  });
  it('the hook\'s word is one SERVER_CAPS lists, and its file name and lease are the TypeScript ones', () => {
    const src = fs.readFileSync(HOOK, 'utf8');
    const words = [...src.matchAll(/^[^#\n]*_hook_server_cap ([a-z0-9-]+)/gm)].map((m) => m[1]!);
    expect(words).toContain(WORD);
    for (const w of words) expect(SERVER_CAPS as readonly string[], w).toContain(w);
    expect(SERVER_CAPS).toContain(WORD);
    // One gate, Task 10's (D-5239), with the file name and the lease as its literals.
    expect([...src.matchAll(/^_hook_server_cap\(\)/gm)]).toHaveLength(1);
    expect(src).toContain(`"$HOME/.ccrc/${SERVER_CAPS_FILE}"`);
    expect(src).toContain(`now - at <= ${SERVER_CAPS_LEASE_S} ))`);
  });
});

describe('an agent event never rewrites the main state (D-5232)', () => {
  beforeEach(advertise);
  it('an agent PostToolUse after a main Stop keeps done/Stop/T0 and the pair, and writes aliveAt', () => {
    const t0 = stopAtT0();
    const before = Date.now();
    run(agentTool('PostToolUse'));
    const s = readState();
    expect(s).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0, ask: null, ...PAIR });
    expect(s['aliveAt'] as number).toBeGreaterThanOrEqual(before);
    expect(s).not.toHaveProperty('waitBy');
  });
  it('the same for an agent PreToolUse with no SubagentStart before it (a side agent)', () => {
    const t0 = stopAtT0();
    run(agentTool('PreToolUse', 'a00000000000000ff', 'Read'));
    const s = readState();
    expect(s).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0, ...PAIR });
    expect(typeof s['aliveAt']).toBe('number');
  });
  it('the same for a SubagentStart and a SubagentStop', () => {
    const t0 = stopAtT0();
    run(subStart(A));
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0, ...PAIR });
    expect(typeof readState()['aliveAt']).toBe('number');
    run(subStop(A));
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0, ...PAIR });
    expect(typeof readState()['aliveAt']).toBe('number');
  });
  it('a working main state is kept the same way (a foreground Agent call)', () => {
    run(userPrompt());
    const t = Date.now() - 70 * 60_000;
    seed({ updatedAt: t, event: 'PreToolUse' });
    run(agentTool('PostToolUse'));
    expect(readState()).toMatchObject({ state: 'working', event: 'PreToolUse', updatedAt: t });
    expect(typeof readState()['aliveAt']).toBe('number');
  });
  it('the interrupted flag is kept', () => {
    stopAtT0();
    seed({ interrupted: true });
    run(agentTool('PostToolUse'));
    expect(readState()).toMatchObject({ state: 'done', interrupted: true });
  });
  it('a main event still opens the turn: a main UserPromptSubmit writes working with a fresh stamp', () => {
    const t0 = stopAtT0();
    run(agentTool('PostToolUse'));
    const before = Date.now();
    run(userPrompt());
    const s = readState();
    expect(s).toMatchObject({ state: 'working', event: 'UserPromptSubmit' });
    expect(s['updatedAt'] as number).toBeGreaterThanOrEqual(before);
    expect(s['updatedAt']).not.toBe(t0);
    expect(s).not.toHaveProperty('aliveAt');
  });
});

describe('a subagent\'s own wait is attention, and its end restores the main state (D-5232)', () => {
  beforeEach(advertise);
  it('a subagent PermissionRequest over done stores waitPrev; the next agent tool event restores it with aliveAt', () => {
    const t0 = stopAtT0();
    seed({ interrupted: true });
    const before = Date.now();
    run(agentPermission());
    const w = readState();
    expect(w).toMatchObject({ state: 'waiting', waitBy: 'subagent', event: 'PermissionRequest',
      ask: { approval: { tool: 'Bash', summary: 'rm -rf build' } } });
    expect(w['updatedAt'] as number).toBeGreaterThanOrEqual(before);
    expect(w['waitPrev']).toEqual({ state: 'done', event: 'Stop', updatedAt: t0, ask: null, interrupted: true });
    run(agentTool('PostToolUse'));
    const s = readState();
    expect(s).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0, ask: null, interrupted: true, ...PAIR });
    expect(typeof s['aliveAt']).toBe('number');
    expect(s).not.toHaveProperty('waitBy');
    expect(s).not.toHaveProperty('waitPrev');
  });
  it('the restore brings back the ask the subagent\'s wait replaced (a main question under it)', () => {
    const Q = { questions: [{ question: 'Which base?', header: 'Base', multiSelect: false,
      options: [{ label: 'main', description: 'current main' }, { label: 'stable', description: 'the branch' }] }] };
    run({ ...common, cwd: '/rig/repo', permission_mode: 'default', hook_event_name: 'PermissionRequest',
      tool_name: 'AskUserQuestion', tool_input: Q });
    const ta = Date.now() - 5 * 60_000;
    seed({ updatedAt: ta });
    run(agentPermission());
    expect(readState()).toMatchObject({ state: 'waiting', waitBy: 'subagent', ask: { approval: { tool: 'Bash' } } });
    run(agentTool('PreToolUse'));
    const s = readState();
    expect(s).toMatchObject({ state: 'waiting', event: 'PermissionRequest', updatedAt: ta, ask: { questions: Q.questions } });
    expect(s).not.toHaveProperty('waitBy');
  });
  it('a SubagentStart or SubagentStop over the subagent\'s wait keeps the wait, its waitPrev and its stamp', () => {
    const t0 = stopAtT0();
    run(agentPermission());
    const tw = readState()['updatedAt'];
    run(subStart(B));
    expect(readState()).toMatchObject({ state: 'waiting', waitBy: 'subagent', updatedAt: tw,
      waitPrev: { state: 'done', event: 'Stop', updatedAt: t0 } });
    run(agentTool('PostToolUse'));
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0 });
  });
  it('a file with no waitPrev (an older hook\'s subagent wait) falls back to today\'s working', () => {
    stopAtT0();
    run(agentPermission());
    const s = readState();
    delete s['waitPrev'];
    fs.writeFileSync(stateFile(), JSON.stringify(s) + '\n');
    const before = Date.now();
    run(agentTool('PostToolUse'));
    const after = readState();
    expect(after).toMatchObject({ state: 'working', ask: null });
    expect(after['updatedAt'] as number).toBeGreaterThanOrEqual(before);
    expect(after).not.toHaveProperty('waitBy');
  });
  it('without the word, a subagent wait stores no waitPrev and its end writes today\'s working', () => {
    fs.rmSync(capsPath());
    stopAtT0();
    run(agentPermission());
    expect(readState()).not.toHaveProperty('waitPrev');
    run(agentTool('PostToolUse'));
    expect(readState()).toMatchObject({ state: 'working', ask: null });
  });
});

describe('freshness moves to aliveAt (D-5232)', () => {
  beforeEach(advertise);
  const read = () => readHookStateMeasured(localIO, reg(), ID, SID, Date.now());
  it('a main Stop 40 minutes ago, then an agent PostToolUse, reads fresh through the aged door', async () => {
    const t0 = stopAtT0();
    run(agentTool('PostToolUse'));
    expect(readState()['updatedAt']).toBe(t0);
    const r = await read();
    expect(r.ok && r.state).toMatchObject({ state: 'done', event: 'Stop', updatedAt: t0 });
  });
  it('with no agent event since, the same file reads NO_STATE', async () => {
    stopAtT0();
    const r = await read();
    expect(r).toMatchObject({ ok: false, reason: 'no-state' });
  });
});

describe('with no file to carry, an agent event writes no hookstate (D-5232)', () => {
  it('behind the word: an agent PostToolUse, SubagentStart and SubagentStop on a session with no file write none', () => {
    advertise();
    for (const p of [agentTool('PostToolUse'), agentTool('PreToolUse'), subStart(A), subStop(A)]) {
      expect(run(p)).toBe('');
      expect(fs.existsSync(stateFile()), String(p['hook_event_name'])).toBe(false);
    }
  });
  it('without the word, an agent tool event writes today\'s working file', () => {
    run(agentTool('PostToolUse'));
    expect(readState()).toMatchObject({ state: 'working' });
  });
});

describe('the roster is keyed by agent_id (D-5232)', () => {
  const roster = (): Array<Record<string, unknown>> => readState()['subagents'] as Array<Record<string, unknown>>;
  const ids = (): unknown[] => roster().map((e) => e['id']);
  beforeEach(() => { run(userPrompt()); });

  it('Start(A) then Stop(A) leaves it empty, and an entry is {name, startedAt, id}', () => {
    run(subStart(A));
    expect(roster()).toHaveLength(1);
    expect(Object.keys(roster()[0]!).sort()).toEqual(['id', 'name', 'startedAt']);
    expect(roster()[0]).toMatchObject({ name: 'general-purpose', id: A });
    run(subStop(A));
    expect(roster()).toEqual([]);
  });
  it('Start(A) twice is one entry', () => {
    run(subStart(A));
    run(subStart(A));
    expect(ids()).toEqual([A]);
  });
  it('Stop(B) with no Start changes nothing', () => {
    run(subStart(A));
    run(subStop(B));
    expect(ids()).toEqual([A]);
  });
  it('Start(A, general-purpose) then Stop(A, agent_type "") removes it: by id, not by name', () => {
    run(subStart(A));
    run(subStop(A, ''));
    expect(roster()).toEqual([]);
  });
  it('Stop by id removes that one entry when two share a name', () => {
    run(subStart(A));
    run(subStart(B));
    run(subStop(B));
    expect(ids()).toEqual([A]);
  });
  it.each(['startup', 'clear', 'resume'])('SessionStart %s empties it', (source) => {
    run(subStart(A));
    run(sessionStart(source));
    expect(roster()).toEqual([]);
  });
  it('SessionStart compact keeps it', () => {
    run(subStart(A));
    run(sessionStart('compact'));
    expect(ids()).toEqual([A]);
  });
  it('a main Stop with background_tasks [] empties it', () => {
    run(subStart(A));
    run(subStart(B));
    run(stop([]));
    expect(roster()).toEqual([]);
  });
  it('a main Stop listing only A (a subagent) and a shell cuts [A, B] to [A]', () => {
    run(subStart(A));
    run(subStart(B));
    run(stop([subTask(A), { id: 'b0000001', type: 'shell', status: 'running', description: 'fixture shell', command: 'sleep 600' }]));
    expect(ids()).toEqual([A]);
  });
  it('a main Stop listing a workflow leaves it unchanged', () => {
    run(subStart(A));
    run(subStart(B));
    run(stop([subTask(A), { id: 'w00000001', type: 'workflow', status: 'running', description: 'fixture workflow', name: 'fixwf' }]));
    expect(ids()).toEqual([A, B]);
  });
  describe('only measured kinds prune', () => {
    const T = 'a0000000000000003';
    beforeEach(() => { run(subStart(A)); run(subStart(B)); run(subStart(T, 'teammate')); });
    it('a Stop listing subagent A and a teammate leaves [A, B, T\'] unchanged', () => {
      run(stop([subTask(A), { id: 't0000001', type: 'teammate', status: 'running', description: 'fixture teammate' }]));
      expect(ids()).toEqual([A, B, T]);
    });
    it('the same with a cloud session (DERIVED [B])', () => {
      run(stop([subTask(A), { id: 'r0000001', type: 'cloud session', status: 'running', description: 'fixture cloud' }]));
      expect(ids()).toEqual([A, B, T]);
    });
    it('the same with an unseen kind (`local_newkind`, DERIVED [B])', () => {
      run(stop([subTask(A), { id: 'n0000001', type: 'local_newkind', status: 'running', description: 'fixture' }]));
      expect(ids()).toEqual([A, B, T]);
    });
    it('background_tasks absent (bg -1) leaves it unchanged', () => {
      run(stopNoTasks());
      expect(ids()).toEqual([A, B, T]);
    });
  });
  it('an id-less legacy entry is dropped at the first main Stop that prunes', () => {
    run(subStart(A));
    seed({ subagents: [{ name: 'general-purpose', startedAt: 1 }, ...roster()] });
    run(stop([subTask(A)]));
    expect(roster()).toEqual([expect.objectContaining({ id: A })]);
  });
  it('the roster rules hold without the server\'s word (not gated)', () => {
    expect(fs.existsSync(capsPath())).toBe(false);
    run(subStart(A));
    run(subStart(A));
    expect(ids()).toEqual([A]);
  });
});
