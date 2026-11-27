import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { inheritedEnv } from './gitEnvStrip.js';
import { hookEnv, runHook, type HookFixture } from './hookTwin.js';
import { mkTmp } from './tmpHelpers.js';
import { scaled } from './timeScale.js';

/** A case of the byte describes below runs dozens of hooks in each mode; on Windows a bash hook run takes seconds
 *  (MSYS2's fork), so a case takes one to four minutes there (measured, Task 9b). */
const WIN_CASE_MS = process.platform === 'win32' ? scaled(600_000) : undefined;

// A bare fixture HOME with a registry, nothing planted in it after the snapshot (a CcdHarness re-plants its contained
// tools on every env() call, which would read as a write).
let h: HookFixture;
beforeEach(() => {
  const home = mkTmp('ccrc-hook-spine-');
  fs.mkdirSync(path.join(home, '.cc-sessions', 'delegation', 'spool'), { recursive: true });
  h = { home, env: (extra = {}) => ({ ...inheritedEnv(), HOME: home, ...extra }) };
});

/** Every path under the fixture HOME with its size and mtime: what "the hook wrote nothing" is measured against. */
function tree(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const st = fs.lstatSync(p);
    out.set(p, `${st.size}:${st.mtimeMs}`);
    if (e.isDirectory()) tree(p, out);
  }
  return out;
}

// The hook's first stop (inventory §1, "which session this is"): with no pane and no job directory it finds no
// session, and its header contract says exit 0, no output and no write. Both implementations, on the same fixture.
/** The two hooks' files compared one by one, so a difference names its file and shows both sides (an intermittent one on
 *  Windows, Task 9b gate round, printed neither); then the whole, as before. */
const sameFiles = (go: Record<string, string>, bash: Record<string, string>, name: string): void => {
  for (const k of [...new Set([...Object.keys(bash), ...Object.keys(go)])]) expect(go[k], `${name}: the file ${k}`).toBe(bash[k]);
  expect(go, `${name}: the files`).toEqual(bash);
};

describe('the session hook: no pane and no job directory', () => {
  const PAYLOADS: [string, object | string][] = [
    ['a Stop', { hook_event_name: 'Stop', session_id: 's1', cwd: '/w', transcript_path: '/t.jsonl' }],
    ['a PreToolUse', { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } }],
    ['a payload that is not JSON', 'not json'],
  ];
  it.each(PAYLOADS)('%s: exit 0, empty stdout, nothing written, in bash and in go', (_n, payload) => {
    const before = tree(h.home);
    const b = runHook(h, 'bash', payload);
    expect(tree(h.home), 'bash wrote under HOME').toEqual(before);
    const g = runHook(h, 'go', payload);
    expect(tree(h.home), 'go wrote under HOME').toEqual(before);
    expect(b).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(g).toEqual(b);
  });
  // runHook's own property: a test run from inside a real tmux pane or Claude Code session must not hand the hook that
  // identity. Here the fixture's base env carries a pane whose (stub) tmux names a registry session, as a session's
  // would; runHook clears it, so the hook still finds none.
  it('the caller\'s own pane never reaches the hook: runHook clears the session identity', () => {
    const bin = path.join(h.home, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
    const base = h.env;
    const inPane: HookFixture = { home: h.home, env: (extra = {}) => base({
      TMUX_PANE: '%1', TMUX: '/tmp/tmux-1/default,1,0', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_JOB_DIR: h.home,
      CCRC_DOOR_NONCE_SHA256: 'a'.repeat(64), CCRC_SESSION_GENERATION: '0189abcd-1234-5678-9abc-0123456789ab',
      CCRC_APPROVAL_TICK_S: '1', PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`, ...extra }) };
    const before = tree(h.home);
    const payload = { hook_event_name: 'Stop', session_id: 's1' };
    expect(runHook(inPane, 'bash', payload)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(runHook(inPane, 'go', payload)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(tree(h.home), 'the hook wrote for the caller\'s pane').toEqual(before);
    // What runHook spawns with (hookEnv, its one env path): none of the caller's session names, the fixture's PATH kept,
    // and a test's own env still sets any of them.
    const spawned = hookEnv(inPane);
    for (const k of ['TMUX_PANE', 'TMUX', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_JOB_DIR', 'CCRC_DOOR_NONCE_SHA256',
      'CCRC_SESSION_GENERATION', 'CCRC_APPROVAL_TICK_S']) expect(spawned, k).not.toHaveProperty(k);
    expect(spawned['PATH']).toContain(bin);
    expect(hookEnv(inPane, { CCRC_DOOR_NONCE_SHA256: 'b'.repeat(64) })['CCRC_DOOR_NONCE_SHA256']).toBe('b'.repeat(64));
  });
  it('a pane-less job directory without Claude Code\'s session id is no session either', () => {
    const before = tree(h.home);
    const env = { CLAUDE_JOB_DIR: path.join(h.home, 'job') };
    const payload = { hook_event_name: 'Stop', session_id: 's1' };
    expect(runHook(h, 'bash', payload, env)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(runHook(h, 'go', payload, env)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(tree(h.home)).toEqual(before);
  });
});

// The spine's bytes (wave 2 Task 2): one sequence of events through each implementation, each in a fixture HOME of its
// own, and the files the spine writes compared BYTE FOR BYTE (the moved suites assert shapes; this asserts bytes): the
// hookstate, the turn marker, the join file and the -hookcap capture files, every 13-digit stamp masked. Each event's
// status and output are compared too. Arms later tasks port are kept out of reach: no PermissionRequest (the approval
// gate's route word, Task 7), the role card off (Task 8's subjects), and no other file is read. On Windows too (Task 9b:
// the core starts a `#!` stand-in as MSYS2's bash does); there each case takes minutes, so run it under CCRC_TIME_SCALE.
describe('the session hook: the spine writes the same bytes in bash and in go', { timeout: WIN_CASE_MS }, () => {
  const ID = 'demo-hookcap';
  const GEN = '0189abcd-1234-5678-9abc-0123456789ab';
  const fixture = (caps: boolean): HookFixture => {
    const home = mkTmp('ccrc-hook-bytes-');
    const reg = path.join(home, '.cc-sessions');
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, `${ID}.generation`), GEN);
    fs.mkdirSync(path.join(home, 'bin'));
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    if (caps) fs.writeFileSync(path.join(home, '.ccrc', 'server-caps'),
      `at ${Math.floor(Date.now() / 1000)}\ncaps hook-main-state-v1 dispatch-live-gate-v1\nend\n`);
    return { home, env: (extra = {}) => ({ ...inheritedEnv(), HOME: home,
      PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`, ...extra }) };
  };
  const ENV = { TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GEN };
  const Q = [{ question: 'Which? <&>   é', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }] }];
  const ev = (name: string, rest: object = {}): object => ({ hook_event_name: name, session_id: 'uuid-1', ...rest });
  const SEQ: object[] = [
    ev('SessionStart', { source: 'startup' }),
    ev('UserPromptSubmit', { prompt: 'hi' }),
    ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/x.txt' } }),
    ev('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'peers list' }, tool_response: { stdout: '', interrupted: false } }),
    ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: Q } }),
    ev('SubagentStart', { agent_id: 'a1', agent_type: 'reviewer' }),
    ev('PreToolUse', { agent_id: 'a1', tool_name: 'Grep', tool_input: { pattern: 'x' } }),
    ev('PostToolUse', { agent_id: 'a1', tool_name: 'Grep', tool_input: { pattern: 'x' } }),
    ev('PreToolUse', { agent_id: 'a1', tool_name: 'AskUserQuestion', tool_input: { questions: Q } }),
    ev('PostToolUse', { agent_id: 'a1', tool_name: 'Grep', tool_input: { pattern: 'y' } }),
    ev('SubagentStop', { agent_id: 'a1' }),
    ev('PreToolUse', { agent_id: 'unjoined', tool_name: 'Glob', tool_input: { pattern: '*' } }),
    ev('Stop', { background_tasks: [{ type: 'Local Agent', id: 't1', status: 'running' }, { type: 'shell', id: 't2', status: 'running' }],
      session_crons: [] }),
    ev('SubagentStart', { agent_id: 'a2', agent_name: 'two' }),
    ev('PreCompact', { trigger: 'manual' }),
    ev('PostCompact', { trigger: 'auto' }),
    ev('StopFailure', { error: 'rate_limit' }),
    ev('SessionStart', { source: 'clear' }),
    ev('Stop'),
    ev('SessionEnd', { reason: 'other' }),
  ];
  const mask = (s: string): string => s.replace(/\d{13}/g, 'T');
  const files = (home: string): Record<string, string> => {
    const reg = path.join(home, '.cc-sessions');
    const out: Record<string, string> = {};
    for (const n of [`${ID}.hookstate.json`, `${ID}.turn.json`, `${ID}.joined`]) {
      const p = path.join(reg, n);
      out[n] = fs.existsSync(p) ? mask(fs.readFileSync(p, 'utf8')) : '(absent)';
    }
    const cap = path.join(home, '.ccrc', 'hook-capture', ID);
    out['captures'] = fs.existsSync(cap) ? fs.readdirSync(cap).map((n) => `${n.replace(/-\d{13}-\d+\.cap$/, '')}: `
      + fs.readFileSync(path.join(cap, n), 'utf8')).sort().join('\n') : '(absent)';
    return out;
  };
  it.each([['without the server\'s words', false], ['with hook-main-state-v1 and dispatch-live-gate-v1 advertised', true]])(
    '%s: each event leaves the same bytes', (_n, caps) => {
      const b = fixture(caps as boolean);
      const g = fixture(caps as boolean);
      for (const [i, p] of SEQ.entries()) {
        const name = `event ${i + 1} (${(p as { hook_event_name: string }).hook_event_name})`;
        expect(runHook(g, 'go', p, ENV), `${name}: status and output`).toEqual(runHook(b, 'bash', p, ENV));
        sameFiles(files(g.home), files(b.home), name);
      }
      expect(files(b.home)[`${ID}.hookstate.json`]).not.toBe('(absent)');
    });

  // The quirks the Go hook keeps, MEASURED against the bash rather than written down: a planted hookstate (or env) and
  // one event, each implementation in its own HOME, the same bytes after (an absent file is the "wrote nothing" quirk).
  const BIG = [{ question: 'é'.repeat(40_000), header: 'big', multiSelect: false, options: [] }];
  const QUIRKS: [string, string | null, object, Record<string, string>][] = [
    ['a CLAUDE_PID that is not JSON writes nothing', null, ev('UserPromptSubmit'), { CLAUDE_PID: 'abc' }],
    ['a root that is an array', '[1]\n', ev('UserPromptSubmit'), {}],
    ['a root that is null', 'null\n', ev('PostToolUse', { tool_name: 'Bash' }), {}],
    ['an empty file', '', ev('UserPromptSubmit'), {}],
    ['two values: the first is read', '{"state":"done","graphQueries":2} {"state":"x","graphQueries":9}\n', ev('UserPromptSubmit'), {}],
    ['a state with a newline shifts the later fields', '{"state":"a\\nb","graphQueries":3,"subagents":[{"name":"x"}]}\n', ev('UserPromptSubmit'), {}],
    ['subagents a string "[1]"', '{"state":"done","subagents":"[1]"}\n', ev('UserPromptSubmit'), {}],
    ['subagents a string "[bad" writes nothing', '{"state":"done","subagents":"[bad"}\n', ev('UserPromptSubmit'), {}],
    ['counters 1e16 and 2.7', '{"state":"done","graphQueries":1e16,"graphGateDenials":2.7,"ccrcPeerReads":1.0}\n', ev('UserPromptSubmit'), {}],
    ['a non-ASCII ask of 80000 bytes, 40000 characters', null, ev('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: BIG } }), {}],
    ['a SubagentStop by name removes the first', '{"state":"done","updatedAt":5,"subagents":[{"name":"a"},{"name":"b"},{"name":"a"}]}\n',
      ev('SubagentStop', { agent_name: 'a' }), {}],
    ['a graphify answer counts', '{"state":"working","graphQueries":1}\n', ev('PostToolUse', { tool_name: 'Bash',
      tool_input: { command: 'graphify query x' }, tool_response: { stdout: 'NODE a\n', interrupted: false } }), {}],
  ];
  it.each(QUIRKS)('%s: the same bytes', (_n, planted, payload, env) => {
    const b = fixture(false);
    const g = fixture(false);
    for (const h of [b, g]) if (planted !== null) fs.writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.hookstate.json`), planted);
    // Status and stdout, not stderr: the bash's hookstate `jq -cn` has no 2>/dev/null, so an `--argjson` it cannot parse
    // leaks jq's usage error to stderr (exit 0 either way); the Go hook writes nothing there.
    const out = ({ status, stdout }: { status: number | null; stdout: string }) => ({ status, stdout });
    expect(out(runHook(g, 'go', payload, { ...ENV, ...env }))).toEqual(out(runHook(b, 'bash', payload, { ...ENV, ...env })));
    expect(files(g.home)).toEqual(files(b.home));
  });
});

// The spools and the launch record (wave 2 Task 3): one sequence of events through each implementation, each in a fixture
// HOME of its own, and every file the three writers make compared BYTE FOR BYTE: the delegation spool's buckets (a
// repository with linked worktrees to list, a prunable old bucket planted), the launch record `<id>.deleg` and the history
// spool `<id>.jsonl`, stamps masked. The moved suites assert shapes with loose matchers; this asserts key order, shedding
// and the fence. Run at both caps: the platform's, and the small one a long path has to be shed under. On Windows too.
describe('the session hook: the spools and the launch record write the same bytes in bash and in go', { timeout: WIN_CASE_MS }, () => {
  const ID = 'demo-spools';
  const GEN = '0189abcd-1234-5678-9abc-0123456789ab';
  const SID = '6350faa0-a1be-4e78-939c-57485268f6fc';
  const REG_UUID = '11111111-2222-4333-8444-555555555555';
  const RUN = 'wf_0123abcd-0ab';
  const fixture = (): HookFixture & { repo: string } => {
    const home = mkTmp('ccrc-hook-spools-');
    const reg = path.join(home, '.cc-sessions');
    const repo = path.join(home, 'repo');
    fs.mkdirSync(path.join(reg, 'delegation', 'spool', ID), { recursive: true });
    fs.writeFileSync(path.join(reg, `${ID}.generation`), GEN);
    fs.writeFileSync(path.join(reg, `${ID}.wrapper`), 'lane-a\n');
    fs.writeFileSync(path.join(reg, `${ID}.uuid`), `${REG_UUID}\n`);
    fs.writeFileSync(path.join(reg, 'delegation', 'spool', ID, '2020010100.spool'), '{"old":1}\n');   // pruned by a first write
    fs.mkdirSync(path.join(repo, '.git', 'worktrees', 'agent-a1'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git', 'worktrees', 'raw-wt'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git', 'worktrees', '.dot'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude', 'worktrees', 'agent-a1'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'worktrees', 'agent-a1', '.git'), `gitdir: ${repo}/.git/worktrees/agent-a1\n`);
    fs.mkdirSync(path.join(home, '.ccrc', 'history', 'spool'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    fs.mkdirSync(path.join(home, 'bin'));
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
    return { home, repo, env: (extra = {}) => ({ ...inheritedEnv(), HOME: home,
      PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`, ...extra }) };
  };
  const SESSION = { TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GEN,
    CLAUDE_CODE_EXECPATH: '/h/.local/share/claude/versions/2.1.318' };
  const seq = (repo: string): object[] => {
    const cfg = '/rig/cfg/projects/-rig-repo';
    const ev = (name: string, rest: object = {}): object => ({ hook_event_name: name, session_id: SID, transcript_path: `${cfg}/${SID}.jsonl`, cwd: repo, ...rest });
    const wf = (o: object = {}): object => ({ status: 'async_launched', taskId: 't1', runId: RUN, taskType: 'local_workflow', workflowName: 'demo',
      transcriptDir: `${cfg}/${SID}/workflows/${RUN}`, scriptPath: `${cfg}/${SID}/workflows/scripts/x-${RUN}.js`, ...o });
    const agentResp = { status: 'async_launched', isAsync: true, agentId: 'aef14f3b6908dc0a9' };
    return [
      ev('SessionStart', { source: 'startup' }),
      ev('UserPromptSubmit', { prompt: 'hi' }),
      ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_b1', tool_input: { command: 'git worktree list' } }),
      ev('PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_b1', tool_input: { command: 'git worktree list' }, tool_response: { stdout: '', interrupted: false } }),
      ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_b2', cwd: `${repo}/.claude/worktrees/agent-a1`, tool_input: { command: 'git worktree add x' } }),
      ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 'toolu_a1', tool_input: { isolation: 'worktree', model: 'sonnet' } }),
      ev('PostToolUse', { tool_name: 'Agent', tool_use_id: 'toolu_a1', tool_input: { model: 'sonnet' }, tool_response: agentResp }),
      ev('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'toolu_w1', tool_input: { script: 'x' }, tool_response: wf() }),
      ev('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'toolu_w2', tool_input: { resumeFromRunId: RUN }, tool_response: wf({ taskId: 't2' }) }),
      ev('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'toolu_w3', tool_input: { script: 'x' }, tool_response: wf({ scriptPath: '/elsewhere/x.js' }) }),
      ev('PostToolUse', { tool_name: 'Workflow', tool_use_id: 'toolu_w4', tool_input: { resumeFromRunId: RUN }, tool_response: wf({ status: 'completed' }) }),
      ev('PostToolUse', { tool_name: 'SendMessage', tool_use_id: 'toolu_s1', tool_input: { to: 'aef14f3b6908dc0a9' }, tool_response: { success: true } }),
      ev('PostToolUse', { tool_name: 'SendMessage', tool_use_id: 'toolu_s2', tool_input: { to: 'worker [3fa]' }, tool_response: { success: true } }),
      ev('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>t1</task-id>\n<tool-use-id>toolu_w1</tool-use-id>\n<status>completed</status>\n</task-notification>' }),
      ev('SubagentStart', { agent_id: 'a1', agent_type: 'general-purpose' }),
      ev('PostToolUse', { agent_id: 'a1', tool_name: 'Agent', tool_use_id: 'toolu_a2', tool_input: {}, tool_response: agentResp }),   // a joined subagent's own launch: no row
      ev('SubagentStop', { agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: '/rig/sub/agent-a1.jsonl' }),
      ev('PostToolUse', { agent_id: 'unjoined', tool_name: 'Agent', tool_use_id: 'toolu_a3', tool_input: {}, tool_response: agentResp }),   // nothing joined it: a row
      ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 'toolu_a4', cwd: `/${'\u0001'.repeat(170)}`, transcript_path: `/${'x'.repeat(500)}`, tool_input: { model: 'sonnet' } }),
      ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 'toolu_a5', cwd: '/é€'.repeat(100), tool_input: { model: 'sonnet' } }),
      ev('Stop'),
      ev('PostCompact', { trigger: 'manual' }),
      ev('SessionStart', { source: 'compact' }),
      ev('SessionStart', { source: 'resume' }),
      ev('SessionStart', { source: 'clear' }),
      ev('PostCompact', { trigger: 'weird' }),
      ev('Stop'),
      ev('SessionEnd', { reason: 'other' }),
    ];
  };
  const mask = (s: string): string => s.replace(/\d{13}/g, 'T').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'T');
  const files = (home: string): Record<string, string> => {
    const reg = path.join(home, '.cc-sessions');
    const out: Record<string, string> = {};
    const read = (p: string): string => (fs.existsSync(p) ? mask(fs.readFileSync(p, 'utf8')) : '(absent)');
    out['deleg'] = read(path.join(reg, `${ID}.deleg`));
    out['history'] = read(path.join(home, '.ccrc', 'history', 'spool', `${ID}.jsonl`));
    const dir = path.join(reg, 'delegation', 'spool', ID);
    const names = fs.readdirSync(dir).sort();
    out['buckets'] = names.map((n) => n.replace(/^\d{10}/, 'HOUR')).join(',');
    out['lines'] = names.filter((n) => !n.startsWith('2020')).map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).join('').split('\n').map(mask).join('\n');
    return out;
  };
  /** The files with the HOME's own path taken out (each side names its own repository). */
  const norm = (home: string): Record<string, string> =>
    // also as JSON spells it: a Windows path's backslashes are escaped inside a spool line
    Object.fromEntries(Object.entries(files(home)).map(([k, v]) => [k, v.split(home).join('<home>').split(JSON.stringify(home).slice(1, -1)).join('<home>')]));
  it.each([['the platform\'s cap', {}], ['the small cap (OSTYPE=darwin23)', { OSTYPE: 'darwin23' }]])(
    '%s: every event leaves the same bytes in the spool, the launch record and the history spool', (_n, more) => {
      const b = fixture();
      const g = fixture();
      const sb = seq(b.repo);
      const sg = seq(g.repo);
      const env = { ...SESSION, ...more };
      for (const [i, p] of sb.entries()) {
        const name = `event ${i + 1} (${(p as { hook_event_name: string }).hook_event_name})`;
        const rb = runHook(b, 'bash', p, env);
        const rg = runHook(g, 'go', sg[i]!, env);
        expect(rg, `${name}: status and output`).toEqual(rb);
        sameFiles(norm(g.home), norm(b.home), name);
      }
      const end = files(b.home);
      expect(end['lines']!.split('\n').filter(Boolean).length, 'the spool took lines').toBeGreaterThan(15);
      expect(end['deleg']!.split('\n').filter(Boolean).length, 'the launch record took rows').toBeGreaterThan(5);
      expect(end['history']!.split('\n').filter(Boolean).length, 'the history spool took lines').toBeGreaterThan(4);
      expect(end['buckets'], 'the old bucket was pruned').not.toContain('2020');
      // the worktree listing triggers on a `/`-rooted cwd (the spool's `$trig`): a Windows cwd is not, in either hook
      if (process.platform !== 'win32') expect(end['lines'], 'the listing was written').toContain('"listing":[".dot","agent-a1","raw-wt"]');
    });
});

// The PreToolUse arms (wave 2 Task 4): the same events through each implementation, each in a HOME of its own with the
// same fixture (a repository with a graph in one of its states, a joined subagent, a stub ccrc), and after EVERY event the
// status, the stdout and the hookstate and turn marker compared byte for byte: the graph gate and nudge (a real directory in
// each freshness, a linked tree with its store), the landing advisory, the role-skill deny, Fable, the test route, the
// reader arms and the fan-out pin, with the odd shapes a payload can take. The moved suites assert what each arm says; this
// asserts the two hooks say the same thing, counters included. On Windows too (the stand-ins are run as MSYS2's bash runs them).
describe('the session hook: the PreToolUse arms decide the same in bash and in go', { timeout: WIN_CASE_MS }, () => {
  const ID = 'demo-arms';
  const GEN = '0189abcd-1234-5678-9abc-0123456789ab';
  const PIN = '0.9.9';
  type Graph = 'none' | 'fresh' | 'behind3' | 'behind10' | 'behind11' | 'foreign' | 'unstamped' | 'linked' | 'linked-engine' | 'linked-wide' | 'nonode' | 'badbyte' | 'nul';
  const git = (dir: string, ...a: string[]): string =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=f@example.invalid', '-c', 'user.name=fixture', ...a], { encoding: 'utf8' }).trim();
  const fixture = (graph: Graph, more: { gateOff?: boolean; badState?: boolean; uuid?: boolean } = {}): HookFixture & { tree: string } => {
    const home = fs.realpathSync(mkTmp('ccrc-hook-arms-'));
    const reg = path.join(home, '.cc-sessions');
    const tree = path.join(home, 'tree');
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, `${ID}.generation`), GEN);
    fs.writeFileSync(path.join(reg, `${ID}.joined`), 'j1\n');
    if (more.uuid) fs.writeFileSync(path.join(reg, `${ID}.uuid`), 'uuid-1\n');   // the pane-less fallback matches a registry row by it
    fs.mkdirSync(path.join(home, 'bin'));
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
    // the wrapper's classifier, in one line a case: systemd-run is wrapped, a bare vitest or tsc is heavy, the rest light
    fs.writeFileSync(path.join(home, 'bin', 'ccrc'),
      '#!/bin/sh\n[ "$1 $2" = "test --classify-shell" ] || exit 2\ncase "$4" in *slowcase*) sleep 6; echo wrapped;; *systemd-run*) echo wrapped;; *vitest*|*tsc*|*"npm test"*) echo heavy;; *) echo light;; esac\n', { mode: 0o755 });
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'ccrc-card-off'), '');
    fs.writeFileSync(path.join(home, '.ccrc', 'graphify.pin'), `${PIN}\n`);
    if (more.gateOff) fs.writeFileSync(path.join(home, '.ccrc', 'graph-gate-off'), '');
    if (more.badState) fs.writeFileSync(path.join(reg, `${ID}.hookstate.json`), '{not json');
    if (graph !== 'none') {
      fs.mkdirSync(tree, { recursive: true });
      git(tree, 'init', '-q', '-b', 'main');
      const shas: string[] = [];
      for (let i = 0; i < 12; i++) {
        fs.writeFileSync(path.join(tree, `c${i}.txt`), `${i}\n`);
        git(tree, 'add', '-A'); git(tree, 'commit', '-q', '-m', `c${i}`);
        shas.push(git(tree, 'rev-parse', 'HEAD'));
      }
      const behind = { fresh: 11, behind3: 8, behind10: 1, behind11: 0, foreign: -1, unstamped: -2, nonode: 11, badbyte: 11, nul: 11 } as Record<string, number>;
      const out = path.join(tree, 'graphify-out');
      if (graph.startsWith('linked')) {
        const store = path.join(home, '.ccrc', 'graphs');
        const build = path.join(store, 'k', 'builds', 'b1');
        fs.mkdirSync(build, { recursive: true });
        const built = shas[graph === 'linked-wide' ? 0 : 8]!;
        fs.writeFileSync(path.join(build, 'meta.json'), JSON.stringify({ schema: 1, commit: built, engine: graph === 'linked-engine' ? '0.9.8' : PIN,
          nodes: 4242, files: 100, ref: 'refs/heads/main', store, built_at: '2026-10-29T00:00:00Z' }));
        fs.writeFileSync(path.join(store, 'settings.json'), JSON.stringify({ schema: 1, gate_max_diff_pct: 25, gate_max_denials: 2, card_diff_list_max: 20 }));
        fs.symlinkSync(build, path.join(store, 'k', 'current'));
        fs.symlinkSync(path.join(store, 'k', 'current'), out);
      } else {
        fs.mkdirSync(out);
        const n = behind[graph]!;
        const stamp = n === -1 ? '1'.repeat(40) : n === -2 ? '' : shas[n]!;
        // `badbyte`: a byte that is not UTF-8 on the stamp's own line and on the report's; `nul`: a NUL in each window (grep calls both binary)
        const lead = graph === 'badbyte' ? Buffer.from([0xff, 0x20]) : Buffer.alloc(0);
        const pad = graph === 'nul' ? `x${String.fromCharCode(0)}y` : 'x'.repeat(5000);
        fs.writeFileSync(path.join(out, 'graph.json'), Buffer.concat([Buffer.from(`{\n  "pad": "${pad}",\n  "hyperedges": [],\n`), lead,
          Buffer.from(`${stamp === '' ? '' : `  "built_at_commit": "${stamp}"\n`}}\n`)]));
        if (graph !== 'nonode') fs.writeFileSync(path.join(out, 'GRAPH_REPORT.md'), Buffer.concat([Buffer.from('# Graph Report\n\n'), lead,
          Buffer.from(`- 4242 nodes · 15645 edges\n${graph === 'nul' ? String.fromCharCode(0) : ''}`)]));
        fs.writeFileSync(path.join(out, '.graphify_engine'), `${PIN}\n`);
      }
    }
    return { home, tree, env: (extra = {}) => ({ ...inheritedEnv(), HOME: home,
      PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`, ...extra }) };
  };
  const SESSION = { TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GEN, OSTYPE: 'linux-gnu' };
  const pre = (tree: string, tool: string, input: unknown, rest: object = {}): object =>
    ({ hook_event_name: 'PreToolUse', session_id: 'uuid-1', tool_name: tool, tool_input: input, cwd: tree, ...rest });
  const sh = (tree: string, command: unknown): object => pre(tree, 'Bash', { command });
  const query = (tree: string): object => ({ hook_event_name: 'PostToolUse', session_id: 'uuid-1', tool_name: 'Bash', cwd: tree,
    tool_input: { command: 'graphify query "x"' }, tool_response: { stdout: 'Traversal: BFS | 1 nodes found\n', interrupted: false } });
  const mask = (s: string, home: string): string => s.replace(/\d{13}/g, 'T').split(home).join('<home>').split(JSON.stringify(home).slice(1, -1)).join('<home>');
  const files = (home: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const n of [`${ID}.hookstate.json`, `${ID}.turn.json`]) {
      const p = path.join(home, '.cc-sessions', n);
      out[n] = fs.existsSync(p) ? mask(fs.readFileSync(p, 'utf8'), home) : '(absent)';
    }
    return out;
  };
  const SCRIPTS = [
    "await agent('x', { model: 'opus', effort: 'high' })", "await agent('x')", "await agent({ prompt: 'x', model: 'haiku' })",
    "await agent('p', { model: 'opus' })", 'await agent("x", W)', "const s = 'agent(x)'; return 1", "await agent('p", "/* agent( */ agent('z', { model, effort })",
  ];
  const SEARCHES = ['grep -rn x .', 'cd /x && rg x', 'FOO=1 BAR=2 find . -name x', 'git grep x', 'ls', 'echo grep', 'cat a | grep x', 'egrep x y', 'fd x', 'ag y',
    'ack z', 'ugrep q', 'npm run package', 'x=1; grep y', '  grep lead',
    // a newline: glibc's ^ and $ anchor the whole text and [^;&|]+ runs over it (CompilePOSIX would not)
    'echo hi\ngrep foo', 'ls\nfind . -name x', 'cd /x\nls && grep y', 'ls\n  rg x', 'FOO=1\nfd x'];
  const READS = ['/w/src/a.ts', '/w/src/A.TS', '/w/README.md', '/w/a.json', '/w/a.js.map', 'graphify-out/GRAPH_REPORT.md', '/w/graphify-out/sub/x.md', '/w/dist.ts/README',
    '/w/x.py', '/w/x.PHP', 'rel/x.go',
    'a.ts\nb', '/w/a.ts\n', '/w/a\nb.ts', '/w/a.ts\n/w/b.md'];
  const SYNCS = ['git merge origin/main', 'git pull origin main', 'git rebase origin/main', 'gh pr update-branch 4', 'git -C /w merge main', 'GIT_EDITOR=true git merge origin/main',
    'git merge feature/x', 'echo "git merge origin/main"', 'git commit -m "git merge origin/main"', '(git merge origin/main)', 'git merge-base a b', 'grep -r x .; git merge origin/main',
    'gh api graphql -f query=updatePullRequestBranch', 'git pull'];
  const TESTS = ['systemd-run --user npx vitest run', 'npx vitest run', 'npm test', 'cd s && npx tsc --noEmit', 'ccrc test -- npx vitest run', 'make build', 'S=systemd-run; $S x vitest',
    'echo vitest', 'yarn lint'];
  const events = (tree: string): object[] => [
    ...SEARCHES.map((c) => sh(tree, c)),
    pre(tree, 'Grep', { pattern: 'x' }), pre(tree, 'Glob', { pattern: '*' }), pre(tree, 'Grep', { pattern: 'x' }),
    ...READS.map((f) => pre(tree, 'Read', { file_path: f })),
    pre(tree, 'Read', { file_path: 5 }), pre(tree, 'Read', 'str'), pre(tree, 'Read', {}),
    query(tree),
    pre(tree, 'Grep', { pattern: 'x' }), pre(tree, 'Read', { file_path: '/w/src/a.ts' }),
  ];
  const landing = (tree: string): object[] => [
    ...SYNCS.map((c) => sh(tree, c)),
    sh(tree, 5), sh(tree, null), sh(tree, { a: 1 }), pre(tree, 'Bash', 'git merge origin/main'), pre(tree, 'Bash', null), pre(tree, 'Write', { command: 'git merge origin/main' }),
  ];
  const skills = (tree: string): object[] => [
    ...['ccrc-worker', 'x:ccrc-reviewer', ' /ccrc-coordinator ', ' ccrc-overlord　', 'ccrc-workers', 'a:b:ccrc-worker', 'superpowers:tdd', '//ccrc-worker', 5, null, { s: 1 }, 'ccrc-wo\u0000rker', '﻿ccrc-worker']
      .flatMap((s) => [pre(tree, 'Skill', { skill: s }, { agent_id: 'j1' }), pre(tree, 'Skill', { skill: s })]),
    pre(tree, 'Skill', 'str', { agent_id: 'j1' }), pre(tree, 'Skill', { skill: 'ccrc-worker' }, { agent_id: '' }), pre(tree, 'Skill', { skill: 'ccrc-worker' }, { agent_id: 'new1' }),
  ];
  const fable = (tree: string): object[] => [
    ...['fable', 'Claude-Fable-5', 'opus', 'FABLE', '', 5, null, ['fable']].flatMap((m) => [pre(tree, 'Agent', { prompt: 'p', model: m }), pre(tree, 'Task', { prompt: 'p', model: m })]),
    pre(tree, 'Agent', 'a fable'), pre(tree, 'Agent', null), pre(tree, 'Agent', ['fable']), pre(tree, 'Agent', { prompt: 'a fable', model: 'opus' }),
    ...['model: "fable"', "model:'fable'", 'model = `Fable`', 'model(fable)', 'claude-fable-5', 'xmodel: fable', 'modelx: fable', 'model :  "foo/fable"', 'model: "a-b.c/fable"',
      'model: "fablé"', 'model:"x fable"', 'my model,fable', 'model: opus // fable'].map((s) => pre(tree, 'Workflow', { script: `agent('x', { ${s} })` })),
    pre(tree, 'Workflow', { args: { agents: [{ model: 'FABLE' }] } }), pre(tree, 'Workflow', { name: 'w', input: 'model: fable' }), pre(tree, 'Workflow', 'model: fable'),
    pre(tree, 'Workflow', { a: { model: 'fable' } }), pre(tree, 'Workflow', { a: [{ model: 5 }, { model: 'x' }] }), pre(tree, 'Workflow', null),
  ];
  const tests = (tree: string): object[] => TESTS.map((c) => sh(tree, c));
  const fanout = (tree: string): object[] => [
    ...SCRIPTS.map((s) => pre(tree, 'Workflow', { script: s })),
    pre(tree, 'Workflow', { script: 5 }), pre(tree, 'Workflow', { script: 'return 1', scriptPath: '/nope.js' }), pre(tree, 'Workflow', { scriptPath: '/nope.js' }), pre(tree, 'Workflow', { name: 'x' }),
    pre(tree, 'Workflow', 'str'), pre(tree, 'Agent', { prompt: 'p', model: 'opus' }, { agent_id: 'j1' }),
  ];
  const door = (tree: string): object[] => [
    pre(tree, 'mcp__door__read', {}, { agent_id: 'j1' }), pre(tree, 'mcp__door__note_add', {}, { agent_id: 'j1' }), pre(tree, 'mcp__door__note_add', {}, { agent_id: 'new1', agent_type: 'r' }),
    pre(tree, 'mcp__door__note_add', {}, { agent_id: 'new1', agent_type: '' }), pre(tree, 'mcp__door__note_add', {}), pre(tree, 'mcp__door__', {}, { agent_id: 'j1' }), pre(tree, 'mcp__other__x', {}, { agent_id: 'j1' }),
    pre(tree, 'Agent', { prompt: 'p', model: 'opus' }), pre(tree, 'Task', { prompt: 'p' }),
  ];
  const lite = (tree: string): object[] => [sh(tree, 'grep -rn x .'), sh(tree, 'ls'), pre(tree, 'Grep', { pattern: 'x' }), pre(tree, 'Read', { file_path: '/w/src/a.ts' }),
    pre(tree, 'Read', { file_path: 'graphify-out/GRAPH_REPORT.md' }), pre(tree, 'Glob', { pattern: '*' }), pre(tree, 'Grep', { pattern: 'x' }), pre(tree, 'Grep', { pattern: 'x' }), pre(tree, 'Grep', { pattern: 'x' })];
  const rest = (tree: string): object[] => [...landing(tree), ...skills(tree), ...fable(tree), ...tests(tree), ...fanout(tree), ...door(tree)];
  const run = (graph: Graph, evs: (t: string) => object[], env: Record<string, string> = {}, more = {}): { denies: number; nudges: number } => {
    const b = fixture(graph, more);
    const g = fixture(graph, more);
    const sb = evs(b.tree);
    const sg = evs(g.tree);
    let denies = 0, nudges = 0;
    for (const [i, p] of sb.entries()) {
      const name = `event ${i + 1} (${JSON.stringify(p).slice(0, 110)})`;
      const rb = runHook(b, 'bash', p, { ...SESSION, ...env });
      const rg = runHook(g, 'go', sg[i]!, { ...SESSION, ...env });
      // Status and stdout, not stderr: bash warns on a NUL byte a command substitution drops ('ignored null byte in input'); the Go hook is silent.
      expect({ status: rg.status, stdout: mask(rg.stdout, g.home) }, `${name}: status and output`).toEqual({ status: rb.status, stdout: mask(rb.stdout, b.home) });
      expect(rg.stderr, `${name}: go is silent`).toBe('');
      sameFiles(files(g.home), files(b.home), name);
      if (rb.stdout.includes('"permissionDecision":"deny"')) denies++;
      else if (rb.stdout.includes('additionalContext')) nudges++;
    }
    return { denies, nudges };
  };
  it.each([['fresh', events], ['linked', events], ['behind3', lite], ['behind10', lite], ['behind11', lite], ['none', lite], ['foreign', lite], ['unstamped', lite],
    ['nonode', lite], ['linked-engine', lite], ['linked-wide', lite], ['badbyte', lite], ['nul', lite]] as Array<[Graph, (t: string) => object[]]>)(
    'a %s graph: the gate and the nudge, search by search, with the counter',
    (graph, evs) => {
      const { denies, nudges } = run(graph, evs);
      if (graph === 'fresh' || graph === 'linked') { expect(denies, 'the gate denied').toBeGreaterThanOrEqual(2); expect(nudges, 'the nudge spoke').toBeGreaterThanOrEqual(3); }
      if (graph === 'behind3' || graph === 'behind10' || graph === 'badbyte') expect(denies, 'a stray byte beside the stamp is no binary file').toBeGreaterThanOrEqual(2);
      if (graph === 'linked-wide') expect(denies, '11 files of 100 differ: inside the share').toBeGreaterThanOrEqual(1);
      if (graph === 'behind11' || graph === 'none' || graph === 'linked-engine' || graph === 'nul') expect(denies + nudges, 'a NUL in the window leaves no stamp').toBe(0);
    });
  // The locale decides `${x,,}` (the Read nudge's lowercasing), `${#x}` (the diff list's bound) and what grep calls text: the same
  // events under a UTF-8 locale and under C, with non-ASCII in the paths a Read names.
  it.each([['C.UTF-8'], ['C'], ['en_US.UTF-8']])('under LC_ALL=%s: the gate, the nudge and a non-ASCII Read path agree', (lc) => {
    const wide = (tree: string): object[] => [...lite(tree), pre(tree, 'Read', { file_path: '/w/src/Été.TS' }), pre(tree, 'Read', { file_path: '/w/İ.Ts' }), pre(tree, 'Read', { file_path: '/w/K.md' }),
      pre(tree, 'Read', { file_path: '/w/GRAPHIFY-OUT/x.md' }), sh(tree, 'grep é .'), pre(tree, 'Skill', { skill: ' ccrc-worker' }, { agent_id: 'j1' })];
    for (const g of ['fresh', 'linked', 'badbyte'] as Graph[]) run(g, wide, { LC_ALL: lc });
  });
  // A newline in a command or a path: glibc's ^ and $ anchor the whole text and [^;&|]+ takes the newline; a line-anchored matcher
  // answers the other way. Each search alone, on a fresh graph with the gate armed, so the denial it earns (or not) is the signal.
  it.each([['echo hi\ngrep foo', 0], ['ls\nfind . -name x', 0], ['cd /x\nls && grep y', 1], ['ls\n  rg x', 0], ['grep a\nls', 1], ['FOO=1\nfd x', 1]] as Array<[string, number]>)(
    'a command with a newline, %j: the gate denies it %i times, as bash does', (cmd, denies) => {
      expect(run('fresh', (t) => [sh(t, cmd)]).denies).toBe(denies);
    });
  it('a Read path with a newline, whose extension ends a line but not the path, is not nudged', () => {
    const reads = (t: string): object[] => ['a.ts\nb', 'x.md\nfoo', 'a\nb.ts', 'a.ts\n'].map((p) => pre(t, 'Read', { file_path: p }, { note: 'x.ts', also: 'y.md' }));
    const { nudges } = run('fresh', reads);
    expect(nudges, 'a.ts and a.ts-newline (the substitution cuts it) are nudged; the others end elsewhere').toBe(2);
  });
  it('the gate with the kill switch denies nothing, and with a hookstate that will not parse the first search is let through', () => {
    expect(run('fresh', lite, {}, { gateOff: true })).toEqual({ denies: 0, nudges: 0 });
    run('fresh', lite, {}, { badState: true });   // only the first event meets the unparsable file: the hook writes a parsable one after it
  });
  it('the landing advisory, the role-skill deny, Fable, the test route, the reader arms and the fan-out pin, over every odd shape', () => {
    const { denies, nudges } = run('none', rest);
    expect(denies, 'the arms denied').toBeGreaterThan(40);
    expect(nudges, 'the advisory spoke').toBeGreaterThan(8);
  });
  it('a search that is also a sync meets the graph arm first, and a Read nudge is replaced by a later arm\x27s answer', () => {
    run('fresh', landing);
  });
  // `hooktmo` is assigned in the bash's pane branch alone: a session identified by its pane has the classifier cut at 5 s, and a
  // pane-less one (the job-directory fallback) runs it to its end. A stand-in that answers after 6 s tells them apart.
  it('the classifier is cut at 5 s for a session with a pane and runs on for a pane-less one', () => {
    const slow = (tree: string): object[] => [sh(tree, 'systemd-run slowcase vitest')];
    expect(run('none', slow), 'with a pane: cut at 5 s, so nothing is denied').toEqual({ denies: 0, nudges: 0 });
    expect(run('none', slow, { TMUX_PANE: '', CLAUDE_JOB_DIR: '/job' }, { uuid: true }), 'without one: the verdict arrives and denies').toEqual({ denies: 1, nudges: 0 });
  }, 60_000);
  it('the pin, the door and the three-reader bound', () => {
    const pin = { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1', CCRC_DOOR_NONCE_SHA256: 'ab'.repeat(32) };
    const readers = (tree: string): object[] => [...fanout(tree), ...door(tree), ...['r1', 'r2', 'r3'].map((id) => ({ hook_event_name: 'SubagentStart', session_id: 'uuid-1', agent_id: id, agent_type: 'x' })),
      pre(tree, 'Agent', { prompt: 'p', model: 'opus' }), pre(tree, 'Task', { prompt: 'p', model: 'opus' }), pre(tree, 'Agent', { prompt: 'p', model: 'opus' }, { agent_id: 'r1' }),
      { hook_event_name: 'SubagentStop', session_id: 'uuid-1', agent_id: 'r1' }, pre(tree, 'Agent', { prompt: 'p', model: 'opus' })];
    run('none', readers, pin);
    run('none', readers, { ...pin, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '0' });
    run('none', readers, { CCRC_DOOR_NONCE_SHA256: 'ab'.repeat(32) });
  });
  it('a Workflow scriptPath is read the same: a file with a bare agent(), a routed one, a link, a directory, an oversize file', () => {
    const b = fixture('none');
    const g = fixture('none');
    for (const h of [b, g]) {
      fs.writeFileSync(path.join(h.home, 'bare.js'), "await agent('x')\n");
      fs.writeFileSync(path.join(h.home, 'ok.js'), "await agent('x', { model: 'opus', effort: 'high' })\n");
      fs.symlinkSync(path.join(h.home, 'bare.js'), path.join(h.home, 'link.js'));
      fs.mkdirSync(path.join(h.home, 'dir.js'));
      fs.writeFileSync(path.join(h.home, 'big.js'), `${' '.repeat(262145)}await agent('x')`);
      for (const n of [131070, 131071, 131072]) fs.writeFileSync(path.join(h.home, `arg${n}.js`), `${' '.repeat(n - 16)}await agent('x')`);   // the bash's jq --arg is one argv word: Linux refuses one of 131072 bytes with its NUL
      fs.writeFileSync(path.join(h.home, 'edge.js'), `${' '.repeat(262144 - 16)}await agent('x')`);
      fs.writeFileSync(path.join(h.home, 'nul.js'), "await ag\u0000ent('x')");
    }
    const outs = new Map<string, boolean>();
    for (const f of ['bare.js', 'ok.js', 'link.js', 'dir.js', 'big.js', 'arg131070.js', 'arg131071.js', 'arg131072.js', 'edge.js', 'nul.js', 'nope.js']) {
      const rb = runHook(b, 'bash', pre(b.tree, 'Workflow', { scriptPath: path.join(b.home, f) }), SESSION);
      const rg = runHook(g, 'go', pre(g.tree, 'Workflow', { scriptPath: path.join(g.home, f) }), SESSION);
      expect({ status: rg.status, stdout: rg.stdout }, f).toEqual({ status: rb.status, stdout: rb.stdout });
      outs.set(f, rb.stdout !== '');
    }
    // the set is the Linux and macOS one, which their argv word limit shapes; on Windows both hooks deny two more files of
    // the eleven, agreeing file by file above (measured, Task 9b gate round)
    if (process.platform !== 'win32') expect([...outs].filter(([, d]) => d).map(([n]) => n).sort(), 'which files the bash denies').toEqual(['arg131070.js', 'arg131071.js', 'bare.js', 'nul.js']);
  });
});
