// Session helpers H1b (D-8862): the helpers on the session socket's `workflows` frame, end to end through a real
// SessionStream over fixture files (spec §3.1, §8). The stream WIRES: the feed's raw hook read and its read time, the
// tailer's helper facts and the session dir go into the reader; what the frame says and whether it is due is the model's
// (`helpersFrame`, `frameDue`), so `checkWorkflows` decides nothing. The two server reset sites keep their behaviour and
// clear the new members: `sendBacklogAndTail` (the gate restates the frame, the facts restart from the backlog's) and the
// reader's rebuild when the session dir changes. Neutral fixture names.
//
// RED FIRST: committed before the code, against origin/main, where the frame carries the workflow rows only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { NO_TICK, SessionStream } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

const ID = 'claude-a-project-a';
const UUID = 'c'.repeat(36);
const WORKDIR = '/work/project-a';
const MUNGED = '-work-project-a';
const PID = 51516;
const line = (o: unknown): string => `${JSON.stringify(o)}\n`;
const now = Date.now();
const iso = (ms: number): string => new Date(ms).toISOString();

let home: string;
let S: string;
let tfile: string;
beforeEach(() => {
  home = mkTmp('ccrc-sws-helpers-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude-a', project: 'project-a', workdir: WORKDIR, uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const sess = path.join(home, '.claude-a', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: WORKDIR, name: 'project-a', status: 'busy', statusUpdatedAt: now, version: '2.1.319', startedAt: now - 600_000,
  }));
  const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
  mkdirSync(tdir, { recursive: true });
  tfile = path.join(tdir, `${UUID}.jsonl`);
  writeFileSync(tfile, line({ type: 'user', uuid: 'u1', timestamp: iso(now - 60_000), message: { role: 'user', content: 'hi' } }));
  S = path.join(tdir, UUID);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const hook = (subagents: Array<{ id?: string; name: string; startedAt: number }>): void =>
  writeFileSync(path.join(home, '.cc-sessions', `${ID}.hookstate.json`), JSON.stringify({
    v: 1, state: 'working', event: 'SubagentStart', sessionId: UUID, pid: PID, updatedAt: now, ask: null, subagents, graphQueries: 0, graphGateDenials: 0,
  }));
const seedHelper = (dir: string, id: string, o: Record<string, unknown> = {}): void => {
  mkdirSync(path.join(dir, 'subagents'), { recursive: true });
  writeFileSync(path.join(dir, 'subagents', `agent-${id}.meta.json`), JSON.stringify({ agentType: 'Explore', description: `look at ${id}`, model: 'model-a', effort: 'high', ...o }));
  writeFileSync(path.join(dir, 'subagents', `agent-${id}.jsonl`), line({ type: 'user', timestamp: iso(now - 20_000), message: { role: 'user', content: 'x' } }));
};
const noticeLine = (id: string, at: number): string => line({
  type: 'user', uuid: `n-${id}`, timestamp: iso(at), origin: { kind: 'task-notification' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>all done</summary>\n<result>the report</result>\n</task-notification>` },
});

const open = (): { stream: SessionStream; frames: SessionStreamMsg[] } => {
  const cfg = loadConfig({ CCRC_HOME: home });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports };
  const frames: SessionStreamMsg[] = [];
  return { stream: new SessionStream(deps, new Bus(), ID, (m) => frames.push(m), undefined, NO_TICK), frames };
};
type WfFrame = SessionStreamMsg & { type: 'workflows' };
const wfFrames = (frames: SessionStreamMsg[]): WfFrame[] => frames.filter((f): f is WfFrame => f.type === 'workflows');
type Priv = {
  resolve(): Promise<{ ok: true; data: unknown } | { ok: false }>;
  sendBacklogAndTail(r: unknown): Promise<void>;
  feed: { poll(): Promise<void> } | null;
  checkWorkflows(f: string, p: unknown, h?: unknown): Promise<void>;
};

describe('the helpers on the session frame (H1b)', () => {
  it('a session with an Agent helper and NO workflow directory: on connect, one frame with its row and no workflow rows', async () => {
    hook([{ id: 'a1', name: 'Explore', startedAt: now - 30_000 }]);
    seedHelper(S, 'a1');
    const { stream, frames } = open();
    try { await stream.start(); } finally { stream.stop(); }
    const sent = wfFrames(frames);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.workflows).toEqual([]);
    expect(sent[0]!.agents).toEqual([expect.objectContaining({ id: 'a1', state: 'running', description: 'look at a1', lastActivityAt: now - 20_000 })]);
  });

  it('a session with no workflow and no helper still sends no frame at all (today\'s gate, now `frameDue`)', async () => {
    hook([]);
    const { stream, frames } = open();
    try { await stream.start(); } finally { stream.stop(); }
    expect(wfFrames(frames)).toEqual([]);
  });

  it('the backlog\'s helper facts reach the frame: a notification in the window ends the row, with its summary', async () => {
    hook([{ id: 'a2', name: 'Explore', startedAt: now - 300_000 }]);
    seedHelper(S, 'a2');
    appendFileSync(tfile, noticeLine('a2', now - 5_000));
    const { stream, frames } = open();
    try { await stream.start(); } finally { stream.stop(); }
    expect(wfFrames(frames).at(-1)!.agents).toEqual([expect.objectContaining({ id: 'a2', state: 'done', endedAt: now - 5_000, summary: 'all done', hasReport: true })]);
  });

  it('the tailer\'s helper facts reach the next reading', async () => {
    hook([{ id: 'a3', name: 'Explore', startedAt: now - 300_000 }]);
    seedHelper(S, 'a3');
    const { stream, frames } = open();
    try {
      await stream.start();
      appendFileSync(tfile, noticeLine('a3', now - 1_000));
      const p = stream as unknown as Priv;
      for (let i = 0; i < 60 && !wfFrames(frames).some((f) => f.agents?.[0]?.state === 'done'); i++) {
        await new Promise((r) => setTimeout(r, 50));
        await p.feed?.poll();
      }
    } finally { stream.stop(); }
    expect(wfFrames(frames).at(-1)!.agents).toEqual([expect.objectContaining({ id: 'a3', state: 'done', summary: 'all done' })]);
  });

  it('a backlog resets the gate: the same frame, helpers included, is stated again after it', async () => {
    hook([{ id: 'a1', name: 'Explore', startedAt: now - 30_000 }]);
    seedHelper(S, 'a1');
    const { stream, frames } = open();
    const p = stream as unknown as Priv;
    try {
      await stream.start();
      const r = await p.resolve();
      if (!r.ok) throw new Error('fixture did not resolve');
      await p.sendBacklogAndTail(r.data);
      await p.feed?.poll();
    } finally { stream.stop(); }
    const sent = wfFrames(frames);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[1]!.agents).toHaveLength(1);
  });

  it('the reader\'s rebuild when the session dir changes clears the helpers: the other dir\'s frame carries none of them', async () => {
    hook([{ id: 'a1', name: 'Explore', startedAt: now - 30_000 }]);
    seedHelper(S, 'a1');
    const other = path.join(path.dirname(S), 'd'.repeat(36));
    mkdirSync(other, { recursive: true });
    const { stream, frames } = open();
    const p = stream as unknown as Priv;
    try {
      await stream.start();
      await p.checkWorkflows(`${other}.jsonl`, { kind: 'live', startedAt: now - 600_000 });
    } finally { stream.stop(); }
    const sent = wfFrames(frames);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.agents).toHaveLength(1);
    expect(sent[1]).toEqual({ type: 'workflows', workflows: [] });
  });

  it('the roster\'s read time decides `launched`: a launch result newer than the roster read is launched, not left out', async () => {
    hook([]);
    seedHelper(S, 'a4');
    appendFileSync(tfile, line({
      type: 'user', uuid: 'l-a4', timestamp: iso(Date.now() + 60_000),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'launched' }] },
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a4', description: 'd', resolvedModel: 'model-b', prompt: 'p' },
    }));
    const { stream, frames } = open();
    try { await stream.start(); } finally { stream.stop(); }
    expect(wfFrames(frames).at(-1)!.agents).toEqual([expect.objectContaining({ id: 'a4', state: 'launched' })]);
  });
});
