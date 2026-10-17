// `background-aware-working` (D-5231; plan 2026-10-16-working-state-and-interruptions Task 1, spec §5.1): the HOOK
// side. A main Stop records, beside the turn marker's `bg`, the DELEGATED background work it left running —
// `bgDelegated` (a count) and `bgDelegatedKinds` (unique kinds, comma-joined) — over the tasks that pass the
// delegated-task rule, whose one home is `shared/api.ts` (`NON_DELEGATING_TASK_KINDS`, `TERMINAL_TASK_STATUSES`).
// The hook's `jq` is the documented second spelling; the iterating cases below hold the two equal.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME. The harness is COPIED from
// session-hook-turnmark.test.ts (a test file cannot import another). Every payload copies the key set of the matching
// event in the committed capture `fixtures/delegation/2.1.280/agent-iso-bg.json`, with neutral ids and text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { NON_DELEGATING_TASK_KINDS, TERMINAL_TASK_STATUSES } from '../../shared/api.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const FIVE_KINDS = path.resolve(__dirname, 'fixtures/hook/stop-bg-five-kinds.json');

/** The row's generation, exactly 36 bytes and no LF, as ccd writes it. */
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'project-a-quiet-basin';
let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-bg-');
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
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: '00000000-0000-4000-8000-000000000001', CLAUDE_PID: '4242',
  CCRC_SESSION_GENERATION: GENERATION,
});
const run = (payload: object): string =>
  execFileSync('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: hookEnv() });
const stateFile = (): string => path.join(home, '.cc-sessions', `${ID}.hookstate.json`);
const readState = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Record<string, unknown>;

type Task = Record<string, unknown>;
/** The five-kinds Stop (the fixture file, every key kept). */
const fiveKinds = (): Record<string, unknown> => JSON.parse(fs.readFileSync(FIVE_KINDS, 'utf8')) as Record<string, unknown>;
const fixtureTasks = (): Task[] => fiveKinds()['background_tasks'] as Task[];
/** A variant: the fixture with `background_tasks` edited, nothing else. */
const stopWith = (tasks: unknown): Record<string, unknown> => ({ ...fiveKinds(), background_tasks: tasks });
/** The fixture's own subagent task, with one field changed. */
const subagentTask = (over: Task = {}): Task => ({ ...fixtureTasks().find((t) => t['type'] === 'subagent')!, ...over });
const stopWithout = (): Record<string, unknown> => {
  const p = fiveKinds();
  delete p['background_tasks'];
  return p;
};

const sid = '00000000-0000-4000-8000-000000000001';
const common = {
  session_id: sid,
  transcript_path: `/rig/fixhome/cfg/projects/-rig-repo/${sid}.jsonl`,
};
/** The capture's UserPromptSubmit shape. */
const userPrompt = {
  ...common, cwd: '/rig/repo', prompt_id: '00000000-0000-4000-8000-0000000000a2', permission_mode: 'default',
  hook_event_name: 'UserPromptSubmit', prompt: 'fixture prompt',
};
/** The capture's SubagentStop shape. */
const subagentStop = {
  ...common, cwd: '/rig/repo/.claude/worktrees/agent-a0000000000000001',
  prompt_id: '00000000-0000-4000-8000-0000000000a1', permission_mode: 'default',
  agent_id: 'a0000000000000001', agent_type: 'general-purpose', effort: { level: 'medium' },
  hook_event_name: 'SubagentStop', stop_hook_active: false,
  agent_transcript_path: `/rig/fixhome/cfg/projects/-rig-repo/${sid}/subagents/agent-a0000000000000001.jsonl`,
  last_assistant_message: 'fixture', background_tasks: [subagentTask()], session_crons: [],
};

const pair = (): { bgDelegated: unknown; bgDelegatedKinds: unknown } => {
  const s = readState();
  return { bgDelegated: s['bgDelegated'], bgDelegatedKinds: s['bgDelegatedKinds'] };
};
const NEITHER = { bgDelegated: undefined, bgDelegatedKinds: undefined };

describe('the Stop records delegated background work (D-5231)', () => {
  it('the five-kinds fixture counts the subagent, the teammate and the workflow, never the shell or the monitor', () => {
    run(fiveKinds());
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop' });
    expect(pair()).toEqual({ bgDelegated: 3, bgDelegatedKinds: 'subagent,teammate,workflow' });
  });

  it('a Stop listing only a shell and a monitor writes a measured zero', () => {
    run(stopWith(fixtureTasks().filter((t) => t['type'] === 'shell' || t['type'] === 'monitor')));
    expect(pair()).toEqual({ bgDelegated: 0, bgDelegatedKinds: '' });
  });

  it('an empty array writes a measured zero', () => {
    run(stopWith([]));
    expect(pair()).toEqual({ bgDelegated: 0, bgDelegatedKinds: '' });
  });

  it('no background_tasks key, and a value that is not an array, write neither field (bg -1)', () => {
    run(stopWithout());
    expect(readState()).toMatchObject({ state: 'done', event: 'Stop' });
    expect(pair()).toEqual(NEITHER);
    for (const v of ['running', { id: 'a0000000000000001' }, 3, null]) {
      run(stopWith(v));
      expect(pair(), JSON.stringify(v)).toEqual(NEITHER);
    }
  });

  describe('the status rule', () => {
    it.each(['completed', 'failed', 'killed'])('a subagent with status %s is finished: zero', (status) => {
      run(stopWith([subagentTask({ status })]));
      expect(pair()).toEqual({ bgDelegated: 0, bgDelegatedKinds: '' });
    });
    it('a pending subagent counts', () => {
      run(stopWith([subagentTask({ status: 'pending' })]));
      expect(pair()).toEqual({ bgDelegated: 1, bgDelegatedKinds: 'subagent' });
    });
    it('a status no build has shown counts as running (`parked`, DERIVED)', () => {
      run(stopWith([subagentTask({ status: 'parked' })]));
      expect(pair()).toEqual({ bgDelegated: 1, bgDelegatedKinds: 'subagent' });
    });
    it('iterates TERMINAL_TASK_STATUSES from shared/api.ts: each one alone writes zero, and `running` does not', () => {
      for (const status of TERMINAL_TASK_STATUSES) {
        run(stopWith([subagentTask({ status })]));
        expect(pair(), status).toEqual({ bgDelegated: 0, bgDelegatedKinds: '' });
      }
      run(stopWith([subagentTask({ status: 'running' })]));
      expect(pair()).toEqual({ bgDelegated: 1, bgDelegatedKinds: 'subagent' });
    });
  });

  describe('the kind rule', () => {
    // `MCP task`, `cloud session` and `local_newkind` are DERIVED from the builder's label map and its raw-name
    // fallback [B]; no fleet capture shows them.
    it('`MCP task` cleans to mcp-task and does not count', () => {
      run(stopWith([subagentTask({ id: 'm0000002', type: 'MCP task' })]));
      expect(pair()).toEqual({ bgDelegated: 0, bgDelegatedKinds: '' });
    });
    it('`cloud session` cleans to cloud-session and counts', () => {
      run(stopWith([subagentTask({ id: 'c0000001', type: 'cloud session' })]));
      expect(pair()).toEqual({ bgDelegated: 1, bgDelegatedKinds: 'cloud-session' });
    });
    it('a kind no build has shown counts (`local_newkind`)', () => {
      run(stopWith([subagentTask({ id: 'n0000001', type: 'local_newkind' })]));
      expect(pair()).toEqual({ bgDelegated: 1, bgDelegatedKinds: 'local_newkind' });
    });
    it('iterates NON_DELEGATING_TASK_KINDS from shared/api.ts: each one alone writes zero', () => {
      for (const kind of NON_DELEGATING_TASK_KINDS) {
        run(stopWith([subagentTask({ type: kind })]));
        expect(pair(), kind).toEqual({ bgDelegated: 0, bgDelegatedKinds: '' });
      }
    });
  });

  it('a main UserPromptSubmit after that Stop writes neither field', () => {
    run(fiveKinds());
    expect(pair().bgDelegated).toBe(3);
    run(userPrompt);
    expect(readState()).toMatchObject({ state: 'working', event: 'UserPromptSubmit' });
    expect(pair()).toEqual(NEITHER);
  });

  it('a SubagentStop after that Stop keeps both (the carry)', () => {
    run(fiveKinds());
    run(subagentStop);
    expect(readState()).toMatchObject({ state: 'done' });
    expect(pair()).toEqual({ bgDelegated: 3, bgDelegatedKinds: 'subagent,teammate,workflow' });
  });
});
