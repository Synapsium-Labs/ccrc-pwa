// The launch record (session-continuity wave 6b, Task 1; D-8363..D-8367).
//
// `ccd/session-hook.sh` appends ONE JSON row per background launch (a Workflow, a resume, an Agent or Task, a SendMessage to an
// agent id) to `$REG/<id>.deleg`. The row is a second output of the hook's one payload parse (`lrec`, inside `DSP_DEFS`), so the
// hook forks nothing it did not fork before except one `wc -c` for each row it writes into an existing file. The file has a byte
// budget and a drop row says why a row was lost. Nothing in the tree reads it yet (6b-2's manifest does). These rows run the
// hook for real in a fixture HOME with a stub tmux, the row's generation and the pane's CCRC_SESSION_GENERATION, the way
// `delegation-spool.test.ts` does. Every name here is neutral: lane-a, project-a, run ids of the measured shape.
//
// Mutation rows (the brief's LR-* table) each go red on a named case below; the case titles carry the words the table cites.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const OWNER = 'demo-quiet-basin';
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const OTHER_GENERATION = '7f3c9a10-5555-4aaa-8bbb-0123456789cd';
const SID = '6350faa0-a1be-4e78-939c-57485268f6fc';
const OTHER_SID = '11111111-2222-4333-8444-555555555555';
const CONFIG = '/rig/cfg/projects/-rig-repo';
const TRANSCRIPT = `${CONFIG}/${SID}.jsonl`;
const SIDECAR = `${CONFIG}/${SID}`;
const RUN = 'wf_0123abcd-0ab';
const AGENT = 'aef14f3b6908dc0a9';
const SCRIPT = `${SIDECAR}/workflows/scripts/x-${RUN}.js`;
const REAL_JQ = execFileSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).trim();
const REAL_WC = execFileSync('sh', ['-c', 'command -v wc'], { encoding: 'utf8' }).trim();
const src = fs.readFileSync(HOOK, 'utf8');
/** The hook's spelling, or the plan's provisional value when the hook has none (the pin row below then reds on its own). */
const constant = (name: string, plan: number): number => Number(src.match(new RegExp(`${name}=(\\d+)`))?.[1] ?? plan);
const LRC_MAX_BYTES = constant('LRC_MAX_BYTES', 1048576);
const LRC_DROP_RESERVE = constant('LRC_DROP_RESERVE', 4096);

let home: string;
const reg = (): string => path.join(home, '.cc-sessions');
const genFile = (): string => path.join(reg(), `${OWNER}.generation`);
const delegFile = (): string => path.join(reg(), `${OWNER}.deleg`);
const wrapperFile = (): string => path.join(reg(), `${OWNER}.wrapper`);
const joinFile = (): string => path.join(reg(), `${OWNER}.joined`);
const stateFile = (): string => path.join(reg(), `${OWNER}.hookstate.json`);
const turnFile = (): string => path.join(reg(), `${OWNER}.turn.json`);
const tmuxAnswered = (): string => path.join(home, 'tmux-answered');
const records = (f: string): string[] => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').slice(0, -1) : []);

const setup = (): void => {
  home = mkTmp('ccrc-lrec-');
  fs.mkdirSync(reg(), { recursive: true });
  fs.writeFileSync(genFile(), GENERATION);   // exactly 36 bytes, no terminal LF: ccd's writer contract
  fs.writeFileSync(wrapperFile(), 'lane-a');
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  // The stub answers `cc-<name>` and records that it did, so a run whose pane lookup outlasted its 2 s bound under load (an honest
  // identity skip that exits 0 and writes nothing) is replayed and never read as a lost row.
  fs.writeFileSync(path.join(home, 'bin', 'tmux'),
    `#!/bin/sh\ntrap '' TERM\necho "cc-${OWNER}"\nprintf '%s\\n' answered >> '${tmuxAnswered()}'\n`, { mode: 0o755 });
};
beforeEach(setup);
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hookEnv = (env: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env };
  delete e['OSTYPE'];
  return {
    ...e, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
    TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
    CLAUDE_CODE_EXECPATH: '', ...env,
  };
};
type Ran = { status: number | null; timedOut: boolean; ms: number; stderr: string };
/** One hook run, in a process group of its own and under a timeout. Exit 0 is asserted by the caller through `status`. A run whose pane
 *  lookup went unanswered is replayed (at most four times). */
const run = (payload: object | string, env: Record<string, string> = {}, timeout = 120_000): Ran => {
  for (let attempt = 0; ; attempt += 1) {
    const answered = records(tmuxAnswered()).length;
    const t0 = Date.now();
    const r = spawnSyncGroup('bash', [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: hookEnv(env), timeout });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    const skipped = hookEnv(env)['TMUX_PANE'] !== '' && records(tmuxAnswered()).length === answered;
    if (!skipped || timedOut || attempt === 4) return { status: r.status, timedOut, ms: Date.now() - t0, stderr: String(r.stderr ?? '') };
  }
};
const ok = (payload: object | string, env: Record<string, string> = {}): void => {
  const r = run(payload, env);
  expect(r.timedOut, 'the hook did not block').toBe(false);
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
};

// ── the record ──
const text = (): string => (fs.existsSync(delegFile()) && fs.statSync(delegFile()).isFile() ? fs.readFileSync(delegFile(), 'utf8') : '');
/** Every line of the record parsed; a record must end in LF and hold no empty line. */
const rows = (): any[] => {
  const t = text();
  expect(t === '' || t.endsWith('\n'), 'the record ends in LF').toBe(true);
  return t.split('\n').slice(0, -1).map((l) => { expect(l, 'no empty line').not.toBe(''); return JSON.parse(l); });
};
/** Run one payload and return the rows it added. */
const added = (payload: object | string, env: Record<string, string> = {}): any[] => {
  const before = rows().length;
  ok(payload, env);
  return rows().slice(before);
};

// ── payload builders ──
const ev = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ session_id: SID, transcript_path: TRANSCRIPT, cwd: '/rig/repo', hook_event_name: name, ...extra });
const post = (tool: string, input: Record<string, unknown>, resp: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ev('PostToolUse', { tool_name: tool, tool_input: input, tool_response: resp, tool_use_id: 'toolu_01AAAA', ...extra });
const wfResp = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  status: 'async_launched', taskId: 't1', runId: RUN, taskType: 'local_workflow', workflowName: 'demo', transcriptDir: `${SIDECAR}/workflows/${RUN}`,
  scriptPath: SCRIPT, ...over,
});
const workflow = (over: Record<string, unknown> = {}, input: Record<string, unknown> = { script: 'return 1' }, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  post('Workflow', input, wfResp(over), extra);
const agentResp = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ status: 'async_launched', isAsync: true, agentId: AGENT, ...over });
const agent = (over: Record<string, unknown> = {}, tool = 'Agent', extra: Record<string, unknown> = {}): Record<string, unknown> =>
  post(tool, { prompt: 'p', model: 'sonnet' }, agentResp(over), extra);
const send = (to: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  post('SendMessage', { to, message: 'm', summary: 's' }, { success: true }, extra);
const WORKFLOW_ROW = { v: 1, t: expect.any(Number), k: 'workflow', w: 'lane-a', uuid: SID, run: RUN, task: 't1', script: SCRIPT };

/** A record of exactly `bytes` bytes, every line valid JSON (a `drop` row padded with a `pad` key). */
const plant = (bytes: number): void => {
  const head = '{"v":1,"t":1,"k":"drop","why":"id","pad":"';
  const mk = (n: number): string => `${head}${'x'.repeat(n - head.length - 3)}"}\n`;
  const parts: string[] = [];
  let left = bytes;
  while (left > 0) {
    let n = Math.min(left, 1000);
    if (left - n > 0 && left - n < 60) n = left - 60;   // the last line must be long enough to be a line
    parts.push(mk(n));
    left -= n;
  }
  fs.writeFileSync(delegFile(), parts.join(''));
  if (fs.statSync(delegFile()).size !== bytes) throw new Error(`planted ${fs.statSync(delegFile()).size}, wanted ${bytes}`);
};
const size = (): number => fs.statSync(delegFile()).size;

describe('the launch record: what a launch appends (session-continuity 6b)', () => {
  it('a background Workflow launch appends one workflow row: time, wrapper, uuid, run, task and script, and nothing else of the payload', () => {
    const before = Date.now();
    expect(added(workflow())).toEqual([WORKFLOW_ROW]);
    expect(rows()[0].t).toBeGreaterThanOrEqual(before - 2000);
    expect(Object.keys(rows()[0])).toEqual(['v', 't', 'k', 'w', 'uuid', 'run', 'task', 'script']);
  });

  it('a launch whose workflowName or taskType is 129 bytes, or whose transcriptDir is absent, still appends its row', () => {
    expect(added(workflow({ workflowName: 'w'.repeat(129) }))).toEqual([WORKFLOW_ROW]);
    expect(added(workflow({ taskType: 't'.repeat(129) }))).toEqual([WORKFLOW_ROW]);
    expect(added(workflow({ transcriptDir: undefined }))).toEqual([WORKFLOW_ROW]);
    expect(added(workflow({ workflowName: undefined, taskType: undefined }))).toEqual([WORKFLOW_ROW]);
  });

  it('a resumeFromRunId call appends a resume row naming the resumed run', () => {
    const resumed = 'wf_9999abcd-0ab';
    expect(added(workflow({}, { resumeFromRunId: resumed, script: 'return 1' }))).toEqual([{ ...WORKFLOW_ROW, k: 'resume', run: resumed }]);
  });

  it('a resumeFromRunId call whose response is not async-launched appends one drop row, why shape', () => {
    for (const status of ['completed', 'failed', 'something_new']) {
      const got = added(workflow({ status }, { resumeFromRunId: RUN }));
      expect(got, status).toEqual([{ v: 1, t: expect.any(Number), k: 'drop', why: 'shape' }]);
    }
    // CONTROL: a plain (non-resume) Workflow that completed is not a launch and appends nothing.
    expect(added(workflow({ status: 'completed' }))).toEqual([]);
  });

  it('a background Agent appends an agent row; a completed one, or one whose isAsync is false, appends none', () => {
    const want = { v: 1, t: expect.any(Number), k: 'agent', w: 'lane-a', uuid: SID, agent: AGENT };
    expect(added(agent())).toEqual([want]);
    expect(added(agent({}, 'Task'))).toEqual([want]);
    expect(added(agent({ isAsync: undefined })), 'an absent isAsync reads as async').toEqual([want]);
    expect(added(agent({ status: 'completed', isAsync: false })), 'a completed one').toEqual([]);
    expect(added(agent({ status: 'completed' })), 'a completed one that says isAsync').toEqual([]);
    expect(added(agent({ isAsync: false })), 'async-launched but isAsync false').toEqual([]);
  });

  it('a SendMessage to an id-shaped target appends a send row; a target such as "worker [3fa9c1]" appends nothing', () => {
    expect(added(send(AGENT))).toEqual([{ v: 1, t: expect.any(Number), k: 'send', w: 'lane-a', uuid: SID, agent: AGENT }]);
    for (const to of ['worker [3fa9c1]', 'team-lead name', '', 7, null, undefined, 'a'.repeat(65)]) {
      expect(added(send(to)), JSON.stringify(to)).toEqual([]);
    }
  });

  it('a joined subagent\'s own PostToolUse appends nothing, for every kind', () => {
    fs.writeFileSync(joinFile(), 'a-other\na-sub-1\n');
    const as = { agent_id: 'a-sub-1' };
    for (const p of [workflow({}, { script: 'x' }, as), workflow({}, { resumeFromRunId: RUN }, as), agent({}, 'Agent', as), agent({}, 'Task', as), send(AGENT, as)]) {
      expect(added(p)).toEqual([]);
    }
    expect(added(workflow()), 'CONTROL: the main thread records').toHaveLength(1);
  });

  it('a main-thread launch carrying an agent_id nothing joined appends its row', () => {
    fs.writeFileSync(joinFile(), 'a-other\n');
    expect(added(workflow({}, { script: 'x' }, { agent_id: 'a-bare-9' }))).toEqual([WORKFLOW_ROW]);
    expect(added(agent({}, 'Agent', { agent_id: 'a-bare-9' }))).toHaveLength(1);
    expect(added(send(AGENT, { agent_id: 'a-bare-9' }))).toHaveLength(1);
  });

  it('a launch whose run, task or agent id is outside the grammar, or absent, appends one drop row, why id, and no launch row', () => {
    const DROP = [{ v: 1, t: expect.any(Number), k: 'drop', why: 'id' }];
    for (const over of [{ runId: 'wf bad id' }, { runId: 'wf/../x' }, { runId: undefined }, { runId: 'r'.repeat(65) }, { runId: 'wf_é' },
      { taskId: 'bad id' }, { taskId: undefined }, { taskId: 5 }]) {
      expect(added(workflow(over)), JSON.stringify(over)).toEqual(DROP);
    }
    expect(added(workflow({}, { resumeFromRunId: 'not a run' })), 'a resume naming a bad run').toEqual(DROP);
    for (const over of [{ agentId: 'bad agent' }, { agentId: undefined }, { agentId: 'a'.repeat(65) }]) {
      expect(added(agent(over)), JSON.stringify(over)).toEqual(DROP);
    }
    // A bad id wins over a bad path: one drop row, and no path drop.
    expect(added(workflow({ runId: 'bad id', scriptPath: '/elsewhere/x.js' }))).toEqual(DROP);
  });

  it('a launch whose session_id fails isid (a non-ASCII byte, 65 bytes, absent) appends one drop row, why id, and no launch row', () => {
    const DROP = [{ v: 1, t: expect.any(Number), k: 'drop', why: 'id' }];
    for (const sid of ['6350faa0-é-4e78-939c-57485268f6fc', 'a'.repeat(65), '', 'has space']) {
      expect(added({ ...workflow(), session_id: sid }), JSON.stringify(sid)).toEqual(DROP);
      expect(added({ ...agent(), session_id: sid }), `agent ${JSON.stringify(sid)}`).toEqual(DROP);
    }
    const absent = workflow() as Record<string, unknown>;
    delete absent['session_id'];
    expect(added(absent)).toEqual(DROP);
    expect(text().includes('é'), 'no non-ASCII byte reached the file').toBe(false);
    for (const l of text().split('\n').filter(Boolean)) expect(Buffer.byteLength(l, 'utf8')).toBe(l.length);
  });
});

describe('the launch record: the wrapper', () => {
  it('a FIFO, a link, a directory, an over-long or an out-of-class value at $REG/<id>.wrapper writes w null and never blocks', () => {
    const elsewhere = path.join(home, 'elsewhere');
    fs.writeFileSync(elsewhere, 'lane-b');
    const cases: Array<[string, () => void]> = [
      ['a FIFO', () => { execFileSync('mkfifo', [wrapperFile()]); }],
      ['a link', () => { fs.symlinkSync(elsewhere, wrapperFile()); }],
      ['a directory', () => { fs.mkdirSync(wrapperFile()); }],
      ['a 65-byte value', () => { fs.writeFileSync(wrapperFile(), 'a'.repeat(65)); }],
      ['a 4000-byte value', () => { fs.writeFileSync(wrapperFile(), 'a'.repeat(4000)); }],
      ['a value with a space', () => { fs.writeFileSync(wrapperFile(), 'lane a'); }],
      ['a value with a slash', () => { fs.writeFileSync(wrapperFile(), 'lane/a'); }],
      ['a non-ASCII value', () => { fs.writeFileSync(wrapperFile(), 'lané'); }],
      ['an empty file', () => { fs.writeFileSync(wrapperFile(), ''); }],
      ['no file', () => { /* removed above */ }],
    ];
    for (const [label, make] of cases) {
      fs.rmSync(wrapperFile(), { recursive: true, force: true });
      make();
      const before = rows().length;
      const r = run(workflow(), {}, 30_000);
      expect(r.timedOut, `${label}: never blocked`).toBe(false);
      expect(r.status, label).toBe(0);
      const got = rows().slice(before);
      expect(got, label).toEqual([{ ...WORKFLOW_ROW, w: null }]);
      expect(fs.readFileSync(elsewhere, 'utf8'), 'nothing written through').toBe('lane-b');
    }
    // CONTROLS: a well-formed value is kept, with or without a trailing LF.
    for (const content of ['lane-a', 'lane-a\n', 'a'.repeat(64)]) {
      fs.rmSync(wrapperFile(), { recursive: true, force: true });
      fs.writeFileSync(wrapperFile(), content);
      expect(added(workflow()).map((r) => r.w), JSON.stringify(content)).toEqual([content.trim()]);
    }
  });
});

describe('the launch record: the script path', () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['a working-directory copy', { scriptPath: `/rig/repo/x-${RUN}.js` }],
    ['a .. segment', { scriptPath: `${SIDECAR}/workflows/scripts/../x.js` }],
    ['another uuid\'s sidecar', { scriptPath: `${CONFIG}/${OTHER_SID}/workflows/scripts/x-${RUN}.js` }],
    ['a sidecar path outside workflows/scripts', { scriptPath: `${SIDECAR}/workflows/x-${RUN}.js` }],
    ['a name ending .sh', { scriptPath: `${SIDECAR}/workflows/scripts/x-${RUN}.sh` }],
    ['a space in the path', { scriptPath: `${SIDECAR}/workflows/scripts/x y-${RUN}.js` }],
    ['a 513-byte path', { scriptPath: `${SIDECAR}/workflows/scripts/${'a'.repeat(513 - `${SIDECAR}/workflows/scripts/.js`.length)}.js` }],
    ['no scriptPath at all', { scriptPath: undefined }],
  ];
  it.each(bad)('a script path outside this session\'s sidecar keeps the row with script null, after one drop row with why path, both lines in the file and both parsing: %s', (_label, over) => {
    if (_label === 'a 513-byte path') expect((over['scriptPath'] as string).length).toBe(513);
    const got = added(workflow(over));
    expect(got).toEqual([{ v: 1, t: expect.any(Number), k: 'drop', why: 'path' }, { ...WORKFLOW_ROW, script: null }]);
    expect(text().split('\n').filter(Boolean), 'both lines are in the file').toHaveLength(2);
  });

  it('the 512-byte bound itself: a 513-byte path with a valid short name is refused, a 512-byte one is kept', () => {
    // A long transcript directory (the check is lexical) and the short name x.js, so the bound is the ONLY check the 513-byte path fails.
    const tail = `/${SID}/workflows/scripts/x.js`;
    const withLen = (n: number): { transcript_path: string; script: string } => {
      const dir = `${CONFIG}-${'d'.repeat(n - CONFIG.length - 1 - tail.length)}`;
      return { transcript_path: `${dir}/${SID}.jsonl`, script: `${dir}${tail}` };
    };
    const at512 = withLen(512);
    const at513 = withLen(513);
    expect([at512.script.length, at513.script.length]).toEqual([512, 513]);
    expect(added(workflow({ scriptPath: at512.script }, { script: 'x' }, { transcript_path: at512.transcript_path })).map((r) => r.script), '512 bytes keeps its path').toEqual([at512.script]);
    const got = added(workflow({ scriptPath: at513.script }, { script: 'x' }, { transcript_path: at513.transcript_path }));
    expect(got.map((r) => [r.k, r.why ?? r.script])).toEqual([['drop', 'path'], ['workflow', null]]);
  });

  // Rows that vary the TRANSCRIPT path or the script name, with a script path consistent with the transcript. Which conjunct of `lrpath` refuses which row:
  // a relative transcript -> `startswith("/")` on the transcript; another session's id -> `endswith("/" + $cs + ".jsonl")`; `//`, `/./` and `/../` ->
  // the segment test on the script path (`all(. != "" and . != "." and . != "..")`); a space -> `all(lrbyte)` on the script path; `xxjs` -> `endswith(".js")`
  // (its name slice `x` passes the name class, so nothing else refuses it). The absent, null and number rows below are refused by `($tp | type) == "string"`.
  const withTranscript = (dir: string, name = 'x.js', sid = SID): { extra: Record<string, unknown>; over: Record<string, unknown> } =>
    ({ extra: { transcript_path: `${dir}/${sid}.jsonl` }, over: { scriptPath: `${dir}/${sid}/workflows/scripts/${name}` } });
  const badTranscript: Array<[string, { extra: Record<string, unknown>; over: Record<string, unknown> }]> = [
    ['a relative transcript path', withTranscript('rig/cfg/projects/-rig-repo')],
    ['another session\'s id in the transcript path, with its own sidecar script', withTranscript(CONFIG, 'x.js', OTHER_SID)],
    ['a // in the directory part', withTranscript('/rig//cfg/projects/-rig-repo')],
    ['a /./ in the directory part', withTranscript('/rig/./cfg/projects/-rig-repo')],
    ['a /../ in the directory part', withTranscript('/rig/../rig/cfg/projects/-rig-repo')],
    ['a space in the directory part', withTranscript('/rig/cfg x/projects/-rig-repo')],
    ['a script name ending js with no dot', withTranscript(CONFIG, 'xxjs')],
    ['a transcript_path that is absent', { extra: { transcript_path: undefined }, over: { scriptPath: SCRIPT } }],
    ['a transcript_path that is null', { extra: { transcript_path: null }, over: { scriptPath: SCRIPT } }],
    ['a transcript_path that is a number', { extra: { transcript_path: 42 }, over: { scriptPath: SCRIPT } }],
  ];
  it.each(badTranscript)('a transcript path or script name the check refuses keeps the row with script null, after one drop row with why path: %s', (_label, c) => {
    const got = added(workflow(c.over, { script: 'return 1' }, c.extra));
    expect(got).toEqual([{ v: 1, t: expect.any(Number), k: 'drop', why: 'path' }, { ...WORKFLOW_ROW, script: null }]);
  });
  it('CONTROL: the same shapes with a clean directory write the script path', () => {
    for (const [label, dir, name] of [['an absolute directory', '/rig/cfg2/projects/-rig-repo', 'x.js'], ['a dotted directory name', '/rig/cfg.d/projects/-rig-repo', 'xx.js'], ['a leading-dot directory (the shape of a real config directory)', '/rig/.cfg/projects/-rig-repo', 'x.js']] as const) {
      const c = withTranscript(dir, name);
      expect(added(workflow(c.over, { script: 'return 1' }, c.extra)).map((r) => [r.k, r.script]), label).toEqual([['workflow', c.over['scriptPath']]]);
    }
  });

  it('a resume that names a working-directory copy is counted the same way', () => {
    const got = added(workflow({ scriptPath: `/rig/repo/x.js` }, { resumeFromRunId: RUN }));
    expect(got.map((r) => r.k)).toEqual(['drop', 'resume']);
    expect(got[1].script).toBeNull();
  });

  it('CONTROL: the byte class, the name class and the 512-byte bound keep what they should', () => {
    for (const name of ['a.js', 'A_b-c.d.js', '_x.js', '-x.js', `b${'a'.repeat(127)}.js`]) {
      const p = `${SIDECAR}/workflows/scripts/${name}`;
      expect(added(workflow({ scriptPath: p })).map((r) => r.script), name).toEqual([p]);
    }
    for (const name of ['x+1.js', '@x.js']) {
      expect(added(workflow({ scriptPath: `${SIDECAR}/workflows/scripts/${name}` })).map((r) => r.k), `${name}: + and @ are path bytes but not name bytes`).toEqual(['drop', 'workflow']);
    }
    expect(added(workflow({ scriptPath: `${SIDECAR}/workflows/scripts/.hidden.js` })).map((r) => r.k), 'a name may not start with a dot').toEqual(['drop', 'workflow']);
    expect(added(workflow({ scriptPath: `${SIDECAR}/workflows/scripts//x.js` })).map((r) => r.k), 'a // is refused').toEqual(['drop', 'workflow']);
    expect(added(workflow({ scriptPath: `${SIDECAR}/workflows/scripts/${'a'.repeat(129)}.js` })).map((r) => r.k), 'a 129-character base name is refused').toEqual(['drop', 'workflow']);
  });
});

describe('the launch record: no event loses its hookstate or its turn marker', () => {
  const states = (): { state: boolean; turn: boolean } => ({ state: fs.existsSync(stateFile()), turn: fs.existsSync(turnFile()) });
  const clear = (): void => { fs.rmSync(stateFile(), { force: true }); fs.rmSync(turnFile(), { force: true }); };

  it('every event still writes its turn marker and hookstate with the record on: a PostToolUse Bash, a PreToolUse Agent, a non-launch PostToolUse Workflow, a SessionStart and a Read', () => {
    const events: Array<[string, Record<string, unknown>, { state: boolean; turn: boolean }]> = [
      ['PostToolUse Bash', post('Bash', { command: 'true' }, { stdout: '', interrupted: false }), { state: true, turn: true }],
      ['PreToolUse Agent', ev('PreToolUse', { tool_name: 'Agent', tool_input: { prompt: 'p', model: 'sonnet' }, tool_use_id: 'toolu_02' }), { state: true, turn: true }],
      ['non-launch PostToolUse Workflow', workflow({ status: 'completed' }), { state: true, turn: true }],
      ['SessionStart', ev('SessionStart', { source: 'startup' }), { state: true, turn: true }],
      ['PostToolUse SendMessage to a peer name', send('worker [3fa9c1]'), { state: true, turn: true }],
      ['PostToolUse Read', post('Read', { file_path: '/rig/repo/a' }, { content: 'x' }), { state: true, turn: true }],
    ];
    for (const [label, payload, want] of events) {
      clear();
      expect(fs.existsSync(path.join(reg(), 'delegation')), 'no spool directory: the record is on alone').toBe(false);
      ok(payload);
      expect(states(), label).toEqual(want);
      expect(rows(), `${label}: the record is unchanged`).toEqual([]);
      expect(fs.existsSync(delegFile()), `${label}: and not even created`).toBe(false);
    }
  });

  it('every launch event still writes its hookstate with the record on: a background Workflow, a background Agent, a path failure, a launch against a full record, a launch against a spent reserve, and an orphan removal', () => {
    const cases: Array<[string, () => void, Record<string, unknown>, (() => void) | undefined]> = [
      ['a background Workflow', () => {}, workflow(), undefined],
      ['a background Agent', () => {}, agent(), undefined],
      ['a path failure', () => {}, workflow({ scriptPath: '/rig/repo/x.js' }), undefined],
      ['a launch against a full record', () => plant(LRC_MAX_BYTES - 10), workflow(), undefined],
      ['a launch against a spent reserve', () => plant(LRC_MAX_BYTES + LRC_DROP_RESERVE), workflow(), undefined],
      ['an orphan removal', () => plant(1000), workflow(), () => {
        fs.writeFileSync(path.join(home, 'bin', 'wc'), `#!/bin/sh\nrm -f '${genFile()}'\nexec '${REAL_WC}' "$@"\n`, { mode: 0o755 });
      }],
    ];
    for (const [label, prep, payload, stub] of cases) {
      fs.rmSync(delegFile(), { force: true });
      fs.rmSync(path.join(home, 'bin', 'wc'), { force: true });
      fs.writeFileSync(genFile(), GENERATION);
      prep();
      stub?.();
      fs.rmSync(stateFile(), { force: true });
      ok(payload);
      expect(fs.existsSync(stateFile()), `${label}: the hookstate was written`).toBe(true);
    }
  });
});

describe('the launch record: its budget', () => {
  const dropRows = (): any[] => rows().filter((r) => r.k === 'drop');
  it('the budget: past LRC_MAX_BYTES no row is written and one budget drop row is, until LRC_DROP_RESERVE is spent; every line in the file parses', () => {
    expect([LRC_MAX_BYTES, LRC_DROP_RESERVE], 'the provisional values (D-8366)').toEqual([1048576, 4096]);
    // 10 bytes under the cap: the row does not fit, so one budget drop row is written instead, and no launch row.
    plant(LRC_MAX_BYTES - 10);
    const before = size();
    const got = added(workflow());
    expect(got).toEqual([{ v: 1, t: expect.any(Number), k: 'drop', why: 'budget' }]);
    expect(size() - before, 'exactly one drop row and its LF').toBe(JSON.stringify(got[0]).length + 1);
    expect(rows().some((r) => r.k === 'workflow'), 'no launch row').toBe(false);
    // The reserve is usable by drop rows while one fits under MAX + RESERVE.
    plant(LRC_MAX_BYTES + LRC_DROP_RESERVE - 200);
    expect(added(workflow())).toHaveLength(1);
    expect(size()).toBeLessThanOrEqual(LRC_MAX_BYTES + LRC_DROP_RESERVE);
    // The edges, exactly. Lengths come from the fixture: a row's bytes from one launch into an empty record, a budget drop row's from its grammar.
    fs.rmSync(delegFile(), { force: true });
    ok(workflow());
    const ROWB = size();   // the workflow row and its LF
    const DROPB = JSON.stringify({ v: 1, t: 1700000000000, k: 'drop', why: 'budget' }).length + 1;
    expect([ROWB > 100, DROPB > 40 && DROPB < 80], 'the derived lengths are sane').toEqual([true, true]);
    plant(LRC_MAX_BYTES - ROWB);   // the row and its LF fit to the byte
    expect(added(workflow()).map((r) => r.k), 'a row that exactly fits is written').toEqual(['workflow']);
    expect(size()).toBe(LRC_MAX_BYTES);
    plant(LRC_MAX_BYTES - ROWB + 1);   // one byte short
    expect(added(workflow()).map((r) => r.k), 'one byte more and it is a budget drop').toEqual(['drop']);
    plant(LRC_MAX_BYTES + LRC_DROP_RESERVE - DROPB);   // the drop row and its LF fit to the byte
    expect(added(workflow()).map((r) => r.why), 'a drop row that exactly fits the reserve is written').toEqual(['budget']);
    expect(size()).toBe(LRC_MAX_BYTES + LRC_DROP_RESERVE);
    plant(LRC_MAX_BYTES + LRC_DROP_RESERVE - DROPB + 1);
    expect(added(workflow()), 'one byte more and nothing is').toEqual([]);
    // Spent: at the sum, and one byte short of room for the drop row, nothing is written.
    for (const planted of [LRC_MAX_BYTES + LRC_DROP_RESERVE, LRC_MAX_BYTES + LRC_DROP_RESERVE - 1]) {
      plant(planted);
      expect(added(workflow()), `planted ${planted}`).toEqual([]);
      expect(size(), `planted ${planted}: the file never passes the sum`).toBe(planted);
    }
    // A record under the cap takes its row and is not a drop.
    plant(LRC_MAX_BYTES / 2);
    expect(added(workflow()).map((r) => r.k)).toEqual(['workflow']);
    expect(dropRows().every((r) => r.why === 'id'), 'the planted filler is the only drop').toBe(true);
    // A path failure whose two lines do not both fit adds one budget drop row and neither line.
    plant(LRC_MAX_BYTES - 100);
    const two = added(workflow({ scriptPath: '/rig/repo/x.js' }));
    expect(two).toEqual([{ v: 1, t: expect.any(Number), k: 'drop', why: 'budget' }]);
  });

  it('a symlink, a directory or a FIFO at $REG/<id>.deleg is never written through', () => {
    const elsewhere = path.join(home, 'elsewhere');
    const cases: Array<[string, () => void]> = [
      ['a link', () => { fs.writeFileSync(elsewhere, 'kept\n'); fs.symlinkSync(elsewhere, delegFile()); }],
      ['a dangling link', () => { fs.symlinkSync(path.join(home, 'nowhere'), delegFile()); }],
      ['a directory', () => { fs.mkdirSync(delegFile()); }],
      ['a FIFO', () => { execFileSync('mkfifo', [delegFile()]); }],
    ];
    for (const [label, make] of cases) {
      fs.rmSync(delegFile(), { recursive: true, force: true });
      fs.rmSync(elsewhere, { force: true });
      make();
      const r = run(workflow(), {}, 30_000);
      expect(r.timedOut, `${label}: nothing blocks`).toBe(false);
      expect(r.status, label).toBe(0);
      const st = fs.lstatSync(delegFile());
      expect(st.isFile(), `${label}: nothing replaced it`).toBe(false);
      if (label === 'a link') expect(fs.readFileSync(elsewhere, 'utf8'), 'and nothing went through').toBe('kept\n');
      if (label === 'a dangling link') expect(fs.existsSync(path.join(home, 'nowhere')), 'nothing was made at the target').toBe(false);
      if (label === 'a directory') expect(fs.readdirSync(delegFile())).toEqual([]);
    }
  });

  it('a symlink, a directory or a FIFO that appears at $REG/<id>.deleg AFTER the gate is never written through either', () => {
    // The gate (before the parse) saw no file; a jq stand-in runs the real jq and then makes the object, so only the append's own type test stands between it and the write.
    const elsewhere = path.join(home, 'elsewhere');
    const cases: Array<[string, string]> = [
      ['a link', `ln -s '${elsewhere}' '${delegFile()}'`],
      ['a dangling link', `ln -s '${path.join(home, 'nowhere')}' '${delegFile()}'`],
      ['a directory', `mkdir '${delegFile()}'`],
      ['a FIFO', `mkfifo '${delegFile()}'`],
    ];
    for (const [label, make] of cases) {
      fs.rmSync(delegFile(), { recursive: true, force: true });
      fs.writeFileSync(elsewhere, 'kept\n');
      // The stand-in holds the real jq's output until the object exists: the hook reads the parse from a process
      // substitution, so a stand-in that printed first could lose the race to the append it is meant to precede.
      fs.writeFileSync(path.join(home, 'bin', 'jq'),
        `#!/bin/sh\n'${REAL_JQ}' "$@" > '${home}/jq.out'\nrc=$?\nif [ ! -e '${delegFile()}' ] && [ ! -L '${delegFile()}' ]; then ${make}; fi\ncat '${home}/jq.out'\nexit $rc\n`, { mode: 0o755 });
      const r = run(workflow(), {}, 30_000);
      expect(r.timedOut, `${label}: nothing blocks`).toBe(false);
      expect(r.status, label).toBe(0);
      expect(fs.lstatSync(delegFile()).isFile(), `${label}: the object stands (the stand-in made it)`).toBe(false);
      expect(fs.readFileSync(elsewhere, 'utf8'), `${label}: nothing went through`).toBe('kept\n');
      if (label === 'a dangling link') expect(fs.existsSync(path.join(home, 'nowhere')), 'nothing made at the target').toBe(false);
      if (label === 'a directory') expect(fs.readdirSync(delegFile())).toEqual([]);
    }
    fs.rmSync(path.join(home, 'bin', 'jq'));
  });

  it('a generation that changed between the parse and the append, or a pane generation that is not the row\'s, writes nothing', () => {
    expect(added(workflow()), 'control: with the real jq the event is recorded').toHaveLength(1);
    const flag = path.join(home, 'swapped');
    fs.writeFileSync(path.join(home, 'bin', 'jq'),
      `#!/bin/sh\n'${REAL_JQ}' "$@" > '${home}/jq.out'\nrc=$?\nif [ ! -e '${flag}' ]; then : > '${flag}'; printf '%s' '${OTHER_GENERATION}' > '${genFile()}'; fi\ncat '${home}/jq.out'\nexit $rc\n`, { mode: 0o755 });   // the swap happens before the parse's output is released (see the stand-in above)
    const before = text();
    ok(workflow());
    expect(fs.existsSync(flag), 'the swap happened').toBe(true);
    expect(text(), 'the row of the old incarnation was not written').toBe(before);
    fs.rmSync(path.join(home, 'bin', 'jq'));
    fs.writeFileSync(genFile(), GENERATION);
    // The pane's generation is not the row's: nothing, whichever side is newer.
    expect(added(workflow(), { CCRC_SESSION_GENERATION: GENERATION }), 'control: a pane that carries the row\'s generation').toHaveLength(1);
    expect(added(workflow(), { CCRC_SESSION_GENERATION: '0189abcd-9999-5678-9abc-0123456789ab' })).toEqual([]);
    // CONTROL: a pane with no generation in its environment is bound to the file's.
    expect(added(workflow(), { CCRC_SESSION_GENERATION: '' })).toHaveLength(1);
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable or unwritable .deleg keeps the hook\'s own stderr empty: a failed open of the size read or of the append prints nothing', () => {
    for (const [label, mode] of [['mode 000 (the size read cannot open it)', 0o000], ['mode 444 (the append cannot open it)', 0o444]] as const) {
      fs.rmSync(delegFile(), { force: true });
      fs.writeFileSync(delegFile(), '{"v":1,"t":1,"k":"drop","why":"id"}\n');
      fs.chmodSync(delegFile(), mode);
      const r = run(workflow(), {}, 30_000);
      expect(r.timedOut, label).toBe(false);
      expect(r.status, label).toBe(0);
      expect(r.stderr, `${label}: nothing on the hook's stderr`).toBe('');
      fs.chmodSync(delegFile(), 0o644);
      expect(fs.readFileSync(delegFile(), 'utf8'), `${label}: nothing was written`).toBe('{"v":1,"t":1,"k":"drop","why":"id"}\n');
    }
  });

  // The pair arm (a script-path failure: a drop row and the row) and the budget-drop arm, each with a mode-644 twin that writes, so the 444 case cannot pass
  // because the append was never reached.
  const SEED = '{"v":1,"t":1,"k":"drop","why":"id"}\n';
  const pairPayload = (): Record<string, unknown> => workflow({ scriptPath: '/rig/repo/x.js' });
  it('the pair arm writes both lines into a writable .deleg (the twin of the mode-444 case)', () => {
    fs.writeFileSync(delegFile(), SEED);
    const r = run(pairPayload(), {}, 30_000);
    expect([r.timedOut, r.status, r.stderr]).toEqual([false, 0, '']);
    expect(rows().slice(1).map((x) => [x.k, x.why ?? x.script])).toEqual([['drop', 'path'], ['workflow', null]]);
  });
  it.skipIf(process.getuid?.() === 0)('the pair arm keeps the hook\'s stderr empty when the append cannot open a mode-444 .deleg', () => {
    fs.writeFileSync(delegFile(), SEED);
    fs.chmodSync(delegFile(), 0o444);
    const r = run(pairPayload(), {}, 30_000);
    expect([r.timedOut, r.status], 'exit 0').toEqual([false, 0]);
    expect(r.stderr, 'nothing on the hook\'s stderr').toBe('');
    fs.chmodSync(delegFile(), 0o644);
    expect(fs.readFileSync(delegFile(), 'utf8'), 'nothing was written').toBe(SEED);
  });
  it('the budget-drop arm writes one drop row into a writable .deleg at the cap (the twin of the mode-444 case)', () => {
    plant(LRC_MAX_BYTES - 10);
    const before = size();
    const r = run(workflow(), {}, 30_000);
    expect([r.timedOut, r.status, r.stderr]).toEqual([false, 0, '']);
    expect(size() - before, 'one budget drop row and its LF').toBeGreaterThan(40);
    expect(rows().slice(-1).map((x) => [x.k, x.why])).toEqual([['drop', 'budget']]);
  });
  it.skipIf(process.getuid?.() === 0)('the budget-drop arm keeps the hook\'s stderr empty when the append cannot open a mode-444 .deleg at the cap', () => {
    plant(LRC_MAX_BYTES - 10);
    const want = fs.readFileSync(delegFile());
    fs.chmodSync(delegFile(), 0o444);
    const r = run(workflow(), {}, 30_000);
    expect([r.timedOut, r.status], 'exit 0').toEqual([false, 0]);
    expect(r.stderr, 'nothing on the hook\'s stderr').toBe('');
    fs.chmodSync(delegFile(), 0o644);
    expect(fs.readFileSync(delegFile()).equals(want), 'nothing was written').toBe(true);
  });

  it('an append that lands after the row was purged leaves no .deleg behind', () => {
    plant(120);   // one row, so the append forks its `wc -c`: it forks one only when the file exists
    fs.writeFileSync(path.join(home, 'bin', 'wc'), `#!/bin/sh\n'${REAL_WC}' "$@"\n`, { mode: 0o755 });
    expect(added(workflow()), 'control: a plain wc, the row lands').toHaveLength(1);
    fs.writeFileSync(path.join(home, 'bin', 'wc'), `#!/bin/sh\nrm -f '${genFile()}'\nexec '${REAL_WC}' "$@"\n`, { mode: 0o755 });
    ok(workflow());
    expect(fs.existsSync(genFile()), 'the stub removed the generation (the purge\'s window)').toBe(false);
    expect(fs.existsSync(delegFile()), 'and the append removed what it wrote').toBe(false);
  });
});

describe('the launch record: its place in the hook', () => {
  it('the launch record needs no spool directory, and the spool still needs its own', () => {
    expect(added(workflow())).toHaveLength(1);
    expect(fs.existsSync(path.join(reg(), 'delegation')), 'the hook never makes the spool directory').toBe(false);
    const spoolDir = path.join(reg(), 'delegation', 'spool', OWNER);
    fs.mkdirSync(spoolDir, { recursive: true, mode: 0o700 });
    expect(added(workflow())).toHaveLength(1);
    const buckets = fs.readdirSync(spoolDir).filter((f) => f.endsWith('.spool'));
    expect(buckets, 'with the directory present the spool writes its bucket too').toHaveLength(1);
    const line = JSON.parse(fs.readFileSync(path.join(spoolDir, buckets[0]!), 'utf8').trim().split('\n').at(-1)!);
    expect(line).toMatchObject({ eventKind: 'PostToolUse', toolName: 'Workflow', outcome: 'async-launched' });
    expect(rows().filter((r) => r.k === 'workflow')).toHaveLength(2);
    // A SendMessage compiles the spool's text and records only in the launch record.
    expect(added(send(AGENT))).toHaveLength(1);
  });

  /** A PATH stub that logs each call of `name` and then runs the real tool. */
  const logging = (name: string, real: string, logFile: string, line = '"$#"'): void =>
    fs.writeFileSync(path.join(home, 'bin', name), `#!/bin/sh\nprintf '%s\\n' ${line} >> '${logFile}'\nexec '${real}' "$@"\n`, { mode: 0o755 });

  it('one parse: the same events fork jq exactly as often with the launch record as without it, and only an event that writes a row forks wc', () => {
    const jqLog = path.join(home, 'jq-calls');
    const wcLog = path.join(home, 'wc-calls');
    logging('jq', REAL_JQ, jqLog);
    logging('wc', REAL_WC, wcLog);
    const events: Array<[string, Record<string, unknown>]> = [
      ['Workflow launch', workflow()], ['Agent launch', agent()], ['SendMessage', send(AGENT)], ['Bash', post('Bash', { command: 'true' }, { stdout: '', interrupted: false })],
      ['Read', post('Read', { file_path: '/rig/repo/a' }, { content: 'x' })], ['SessionStart', ev('SessionStart', { source: 'startup' })],
    ];
    const count = (f: string): number => records(f).length;
    for (const [label, payload] of events) {
      // OFF: a directory at .deleg turns the record off (no `lrc_ok`); ON: no file.
      fs.rmSync(delegFile(), { recursive: true, force: true });
      fs.mkdirSync(delegFile());
      ok(payload);   // warm-up: the first run of an event may write a hookstate the later ones only read
      const j0 = count(jqLog);
      ok(payload);
      const off = count(jqLog) - j0;
      fs.rmSync(delegFile(), { recursive: true, force: true });
      const j1 = count(jqLog);
      ok(payload);
      expect(count(jqLog) - j1, `${label}: jq forks`).toBe(off);
    }
    // wc: none for an event that writes nothing, with the record absent OR present; none for a first row; one for a row into an existing record.
    fs.rmSync(wcLog, { force: true });
    fs.rmSync(delegFile(), { recursive: true, force: true });
    for (const [, payload] of events.slice(3)) ok(payload);
    ok(workflow());   // the record is absent: no wc
    expect(count(wcLog), 'no wc for a Read, a Bash, a SessionStart, or a first row').toBe(0);
    plant(120);   // the record exists now: an event that writes no row must still not fork wc
    for (const [label, payload] of events.slice(3)) {
      ok(payload);
      expect(count(wcLog), `${label} with the record present forks no wc`).toBe(0);
    }
    ok(workflow());   // a row into an existing record
    expect(count(wcLog), 'one wc for a row into an existing record').toBe(1);
    ok(agent());
    expect(count(wcLog)).toBe(2);
  });

  it('with no spool directory, only a PostToolUse quoting Agent, Task, Workflow or SendMessage compiles DSP_DEFS', () => {
    const lenLog = path.join(home, 'jq-lengths');
    // Logs the length of the parse program (the one that defines `keep`), found among the arguments after the `--arg` pairs.
    fs.writeFileSync(path.join(home, 'bin', 'jq'), `#!/bin/sh
prog=""; skip=0
for a in "$@"; do
  if [ "$skip" -gt 0 ]; then skip=$((skip - 1)); continue; fi
  case "$a" in --arg) skip=2 ;; -*) ;; *) prog="$a"; break ;; esac
done
case "$prog" in *'def keep(f)'*) printf '%s\\n' "\${#prog}" >> '${lenLog}' ;; esac
exec '${REAL_JQ}' "$@"
`, { mode: 0o755 });
    const lengthOf = (payload: Record<string, unknown>): number => {
      fs.rmSync(lenLog, { force: true });
      ok(payload);
      const l = records(lenLog);
      expect(l, 'the parse ran once').toHaveLength(1);
      return Number(l[0]);
    };
    const alone = lengthOf(post('Bash', { command: 'true' }, { stdout: '', interrupted: false }));
    expect(alone).toBeGreaterThan(100);
    expect(lengthOf(ev('PreToolUse', { tool_name: 'Agent', tool_input: { prompt: 'p', model: 'sonnet' }, tool_use_id: 'toolu_02' })), 'a PreToolUse Agent').toBe(alone);
    expect(lengthOf(ev('SessionStart', { source: 'startup' })), 'a SessionStart').toBe(alone);
    expect(lengthOf(post('Read', { file_path: '/rig/repo/a' }, { content: 'x' })), 'a Read').toBe(alone);
    for (const [label, p] of [['Workflow', workflow()], ['Agent', agent()], ['Task', agent({}, 'Task')], ['SendMessage', send(AGENT)]] as Array<[string, Record<string, unknown>]>) {
      expect(lengthOf(p), `a PostToolUse ${label}`).toBeGreaterThan(alone + 1000);
    }
    // With the spool directory present, the spool's own prefilter decides: a Bash event compiles it again, as on main.
    fs.mkdirSync(path.join(reg(), 'delegation', 'spool', OWNER), { recursive: true, mode: 0o700 });
    expect(lengthOf(post('Bash', { command: 'true' }, { stdout: '', interrupted: false })), 'the spool directory compiles for Bash').toBeGreaterThan(alone + 1000);
    expect(lengthOf(post('Read', { file_path: '/rig/repo/a' }, { content: 'x' })), 'but not for a Read').toBe(alone);
  });

  it('sentinels in the prompt, the message, the script text and the response never reach the record', () => {
    const S = 'SENTINEL_9f2c71d4';
    ok(post('Workflow', { script: `return '${S}-script'`, prompt: `${S}-prompt`, args: { note: `${S}-args` } }, wfResp({ output: `${S}-response`, message: `${S}-msg` })));
    ok(post('Agent', { prompt: `${S}-agent-prompt`, model: 'sonnet', description: `${S}-desc` }, agentResp({ output: `${S}-agent-out`, prompt: `${S}-echo` })));
    ok(post('SendMessage', { to: AGENT, message: `${S}-message`, summary: `${S}-summary` }, { success: true, message: `${S}-reply` }));
    ok(post('Workflow', { resumeFromRunId: RUN, script: `${S}-resume` }, wfResp({ output: `${S}-r` })));
    expect(rows().map((r) => r.k)).toEqual(['workflow', 'agent', 'send', 'resume']);
    expect(text()).not.toContain(S);
    expect(text()).not.toContain('SENTINEL');
  });

  it('the constants are spelled once in the hook, beside the appender', () => {
    expect(src.match(/LRC_MAX_BYTES=\d+ LRC_DROP_RESERVE=\d+/g)).toHaveLength(1);
    expect(src.match(/^_hook_launch_record_append\(\)/gm)).toHaveLength(1);
    expect(src.indexOf('# <<< delegation-spool')).toBeLessThan(src.indexOf('# >>> launch-record'));
    expect(src.indexOf('# >>> launch-record') - src.indexOf('# <<< delegation-spool'), 'directly after the spool block').toBeLessThan(40);
    expect(src, 'no bare EPOCHREALTIME in the block').not.toMatch(/# >>> launch-record[\s\S]*?\$EPOCHREALTIME[\s\S]*?# <<< launch-record/);
    // The one jq program the record adds names no regex builtin (a jq built without Oniguruma must still run it).
    const defs = src.slice(src.indexOf("DSP_DEFS='"), src.indexOf("'; dsp_dir="));
    const lrec = defs.slice(defs.indexOf('def lrwc:'), defs.indexOf('def spool:'));
    expect(lrec.length).toBeGreaterThan(500);
    expect(lrec.match(/(?:test|match|capture|scan|splits|sub)\(/g) ?? []).toEqual([]);
  });
});
