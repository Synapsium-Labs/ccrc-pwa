// Session helpers H1b (D-8862): the helpers on the session socket's `workflows` frame, end to end through a real
// SessionStream over fixture files (spec §3.1, §8). The stream WIRES: the feed's raw hook read and its read time, the
// tailer's helper facts and the session dir go into the reader; what the frame says and whether it is due is the model's
// (`helpersFrame`, `frameDue`), so `checkWorkflows` decides nothing. The two server reset sites keep their behaviour and
// clear the new members: `sendBacklogAndTail` (the gate restates the frame, the facts restart from the backlog's) and the
// reader's rebuild when the session dir changes. Neutral fixture names.
//
// RED FIRST: committed before the code, against origin/main, where the frame carries the workflow rows only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { NO_TICK, SessionStream } from '../src/sessionws.js';
import { feedFor } from '../src/sessionFeed.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';
import type { HookReading } from '../src/bus.js';
import type { TranscriptTailer } from '../src/transcript/tail.js';
import type { HelperFact } from '../src/transcript/parse.js';

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

let lastDeps: Deps;
const open = (bus: Bus = new Bus(), io: FleetIO = localIO): { stream: SessionStream; frames: SessionStreamMsg[] } => {
  const cfg = loadConfig({ CCRC_HOME: home });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue(), time: fakeTime().ports };
  lastDeps = deps;
  const frames: SessionStreamMsg[] = [];
  return { stream: new SessionStream(deps, bus, ID, (m) => frames.push(m), undefined, NO_TICK), frames };
};
type WfFrame = SessionStreamMsg & { type: 'workflows' };
const wfFrames = (frames: SessionStreamMsg[]): WfFrame[] => frames.filter((f): f is WfFrame => f.type === 'workflows');
type Priv = {
  helperFacts: HelperFact[];
  tailer: TranscriptTailer | null;
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

describe('the wiring, pinned after the first mutation round', () => {
  it('the roster\'s READ time, not the reading\'s, decides `launched`: a launch between the two is launched', async () => {
    hook([]);
    seedHelper(S, 'a5');
    const launchAt = Date.now() - 2_000;
    appendFileSync(tfile, line({
      type: 'user', uuid: 'l-a5', timestamp: iso(launchAt),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02', content: 'launched' }] },
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a5', description: 'd', resolvedModel: 'model-b', prompt: 'p' },
    }));
    const bus = new Bus();
    const { stream, frames } = open(bus);
    // the watcher's published copy, read 5 s ago: older than the launch, so the roster cannot list it yet
    feedFor(lastDeps, bus, ID);
    bus.emit(`hook:${ID}`, { at: launchAt - 3_000, uuid: UUID, raw: { ok: true, sessionId: UUID, identity: 'current', state: {
      state: 'working', updatedAt: Date.now(), event: null, ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0, interrupted: false,
    } } });
    try { await stream.start(); } finally { stream.stop(); }
    expect(wfFrames(frames).at(-1)!.agents).toEqual([expect.objectContaining({ id: 'a5', state: 'launched' })]);
  });

  it('a backward clock step does not freeze hook ask frames or hand the helper decision an older roster', async () => {
    for (const id of ['a1', 'a2']) seedHelper(S, id);
    const bus = new Bus();
    const { stream, frames } = open(bus);
    const feed = feedFor(lastDeps, bus, ID);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const publication = (at: number, ids: string[], question: string): HookReading => ({
      at, uuid: UUID, raw: { ok: true, sessionId: UUID, identity: 'current', state: {
        state: 'working', updatedAt: at, event: null, ask: { questions: [{ question, options: [{ label: 'Yes' }, { label: 'No' }] }] },
        subagents: ids.map((id, n) => ({ id, name: 'Explore', startedAt: now - 60_000 + n })),
        graphQueries: 0, graphGateDenials: 0, interrupted: false,
      } },
    });
    try {
      bus.emit(`hook:${ID}`, publication(now, ['a1', 'a2'], 'Use the first option?'));
      await stream.start();
      clock.mockReturnValue(now - 5_000);
      bus.emit(`hook:${ID}`, publication(now - 5_000, ['a1'], 'Use the second option?'));
      await feed.poll();
      expect(frames.filter((f) => f.type === 'ask').map((f) => 'questions' in f.ask ? f.ask.questions[0]?.question : null))
        .toEqual(['Use the first option?', 'Use the second option?']);
      expect(wfFrames(frames).flatMap((f) => f.agents ?? []).filter((a) => a.id === 'a2').map((a) => a.state)).toEqual(['running']);
    } finally { stream.stop(); clock.mockRestore(); }
  });

  it('the pending facts retain only the newest 1024 across live chunks while no reading runs', async () => {
    const { stream } = open();
    const p = stream as unknown as Priv;
    try {
      await stream.start();
      const facts: HelperFact[] = Array.from({ length: 1027 }, (_, i) => ({
        source: 'notification', id: `a${i}`, status: 'completed', at: now, model: null, durationMs: null, summary: null, report: null, reportCut: false,
      }));
      p.tailer!.emit('helpers', facts.slice(0, 900));
      p.tailer!.emit('helpers', facts.slice(900));
      expect(p.helperFacts).toHaveLength(1024);
      expect(p.helperFacts[0]?.id).toBe('a3');
      expect(p.helperFacts.at(-1)?.id).toBe('a1026');
    } finally { stream.stop(); }
  });

  it('a reading hands the pending facts to the reader and keeps none: the stream holds nothing between readings', async () => {
    hook([{ id: 'a1', name: 'Explore', startedAt: now - 30_000 }]);
    seedHelper(S, 'a1');
    appendFileSync(tfile, noticeLine('a1', now - 5_000));
    const { stream } = open();
    const p = stream as unknown as Priv;
    try {
      await stream.start();
      expect(p.helperFacts).toEqual([]);
    } finally { stream.stop(); }
  });

  it('characterization (main\'s order): a frame not due still records its JSON, so the same JSON when due later sends nothing', async () => {
    hook([]);
    const { stream, frames } = open();
    const p = stream as unknown as Priv;
    try {
      await stream.start();                                  // absent, never had: no frame, its JSON recorded
      mkdirSync(path.join(S, 'subagents', 'workflows'), { recursive: true });
      await p.feed?.poll();                                  // an empty directory: due, the same JSON
    } finally { stream.stop(); }
    expect(wfFrames(frames)).toEqual([]);
  });
});

// Session helpers H1c (D-8873): the bounded start scan, end to end (spec §3.1 "The start scan", Table 13's scan tests). A
// reload (no `since`: a backlog) and a reconnect (a matching `since`: no backlog, the tail resumes at the client's offset)
// each rebuild the reader, which scans back from its own seam; within the bound they draw the same rows, and a helper beyond
// it draws from the roster and its meta alone. RED FIRST, against origin/main, where neither stream reads past its window.
describe('the start scan: a reload and a reconnect draw the same rows within its bound (H1c)', () => {
  const MIB = 1024 * 1024;
  const launch = (id: string, at: number, pad = 0): string => line({
    type: 'user', uuid: `l-${id}`, timestamp: iso(at),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${id}`, content: `launched${'p'.repeat(pad)}` }] },
    toolUseResult: { isAsync: true, status: 'async_launched', agentId: id, description: 'd', resolvedModel: 'model-b', prompt: 'p' },
  });
  const fill = (at: number, total: number): string => {
    const one = line({ type: 'user', uuid: `f-${at}`, timestamp: iso(at), message: { role: 'user', content: 'x'.repeat(64 * 1024) } });
    return one.repeat(Math.ceil(total / one.length));
  };
  /** One line of exactly `bytes` bytes. */
  const exact = (at: number, bytes: number): string => {
    const base = line({ type: 'user', uuid: `e-${at}`, timestamp: iso(at), message: { role: 'user', content: '' } }).length;
    return line({ type: 'user', uuid: `e-${at}`, timestamp: iso(at), message: { role: 'user', content: 'x'.repeat(bytes - base) } });
  };
  type Scanned = Priv & { workflows: { startScan?: { done: boolean; cost: { bytes: number; reads: number; stop: string | null } } } | null };
  /** Readings until the reader's scan has stopped, then one more, so its last facts are folded; the last frame's rows. */
  const settle = async (stream: SessionStream, frames: SessionStreamMsg[]): Promise<{ rows: unknown[]; scan: Scanned['workflows'] }> => {
    const p = stream as unknown as Scanned;
    for (let k = 0; k < 80 && p.workflows?.startScan?.done !== true; k++) {
      await new Promise((r) => setTimeout(r, 10));
      await p.feed?.poll();
    }
    await p.feed?.poll();
    const rows = (wfFrames(frames).at(-1)?.agents ?? []).map((a) => ({
      id: a.id, state: a.state, startedAt: a.startedAt, endedAt: a.endedAt, summary: a.summary, hasReport: a.hasReport,
    }));
    return { rows, scan: p.workflows };
  };

  it('a launch and a notification behind the backlog\'s window reach both: the same rows, from the scan', async () => {
    // a2's launch line straddles the backlog window's first byte (the reload's seam): the scan joins it to the backlog's cut
    const a2 = launch('a2', now - 240_000, 20_000);
    writeFileSync(tfile, launch('a1', now - 480_000) + fill(now - 420_000, 1.5 * MIB) + noticeLine('a1', now - 360_000)
      + fill(now - 300_000, 1.2 * MIB) + a2 + exact(now - 180_000, MIB - 10_000 - 200 * 1024));
    const resumeAt = statSync(tfile).size;
    appendFileSync(tfile, exact(now - 120_000, 200 * 1024));
    const seam = statSync(tfile).size - MIB;
    expect(seam).toBeGreaterThan(resumeAt - (MIB - 10_000 - 200 * 1024) - a2.length);
    expect(seam).toBeLessThan(resumeAt - (MIB - 10_000 - 200 * 1024));
    hook([{ id: 'a2', name: 'Explore', startedAt: now - 239_000 }]);
    seedHelper(S, 'a1', { finished: true });
    seedHelper(S, 'a2');
    const want = [
      { id: 'a2', state: 'running', startedAt: now - 240_000, endedAt: null, summary: null, hasReport: false },
      { id: 'a1', state: 'done', startedAt: now - 480_000, endedAt: now - 360_000, summary: 'all done', hasReport: true },
    ];

    const reload = open();
    try {
      await reload.stream.start();
      const got = await settle(reload.stream, reload.frames);
      expect(got.rows).toEqual(want);
      expect(got.scan?.startScan?.cost).toMatchObject({ stop: 'start', bytes: seam }); // every byte below the seam, once
    } finally { reload.stream.stop(); }

    const cfg = loadConfig({ CCRC_HOME: home });
    const run: Runner = async (_cmd, args) => ({ ran: true, code: 0, stdout: args[0] === 'list-panes' ? `${PID}\n` : '', stderr: '' });
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports };
    const frames: SessionStreamMsg[] = [];
    const reconnect = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m), { uuid: UUID, offset: resumeAt, file: tfile }, NO_TICK);
    try {
      await reconnect.start();
      expect(frames.some((f) => f.type === 'backlog')).toBe(false); // a resume: no backlog
      const got = await settle(reconnect, frames);
      expect(got.rows).toEqual(want);
      expect(got.scan?.startScan?.cost).toMatchObject({ stop: 'start', bytes: resumeAt });
    } finally { reconnect.stop(); }
  });

  it('(HF1, review 3067 F5) a stream whose backlog window could not be read still scans, from the file\'s size, where its tailer starts', async () => {
    writeFileSync(tfile, launch('a1', now - 300_000) + fill(now - 200_000, 1.5 * MIB));
    const end = statSync(tfile).size;
    hook([{ id: 'a1', name: 'Explore', startedAt: now - 299_000 }]);
    seedHelper(S, 'a1');
    // Only the backlog's window read fails: the transcript's last 1 MiB, read from its size less 1 MiB.
    const io: FleetIO = {
      ...localIO,
      readFileFromMeasured: async (p, from) => (p === tfile && from === end - MIB
        ? { ok: false, reason: 'unreadable' } : localIO.readFileFromMeasured(p, from)),
    };
    const { stream, frames } = open(new Bus(), io);
    try {
      await stream.start();
      expect(frames.find((f) => f.type === 'backlog')).toMatchObject({ events: [], offset: end, missing: false, fileMeasured: false });
      const got = await settle(stream, frames);
      expect(got.scan?.startScan?.cost).toMatchObject({ stop: 'start', bytes: end });
      expect(got.rows).toEqual([{ id: 'a1', state: 'running', startedAt: now - 300_000, endedAt: null, summary: null, hasReport: false }]);
    } finally { stream.stop(); }
  });

  it('a helper whose launch lies beyond HELPER_SCAN_BYTES draws from the roster and its meta alone; one inside it from its launch', async () => {
    writeFileSync(tfile, launch('far', now - 300_000) + launch('done-far', now - 299_000) + noticeLine('done-far', now - 298_000)
      + fill(now - 290_000, 8 * MIB + 512 * 1024) + launch('near', now - 200_000) + fill(now - 100_000, 1.5 * MIB));
    hook([
      { id: 'far', name: 'Explore', startedAt: now - 299_500 },
      { id: 'done-far', name: 'Explore', startedAt: now - 298_500 },
      { id: 'near', name: 'Explore', startedAt: now - 199_500 },
    ]);
    seedHelper(S, 'far');
    seedHelper(S, 'done-far', { finished: true });
    seedHelper(S, 'near');
    const { stream, frames } = open();
    try {
      await stream.start();
      const got = await settle(stream, frames);
      expect(got.scan?.startScan?.cost).toMatchObject({ stop: 'bytes', bytes: 8 * MIB });
      expect(got.rows).toEqual([
        { id: 'far', state: 'running', startedAt: now - 299_500, endedAt: null, summary: null, hasReport: false },
        { id: 'near', state: 'running', startedAt: now - 200_000, endedAt: null, summary: null, hasReport: false },
        { id: 'done-far', state: 'finished', startedAt: now - 298_500, endedAt: now - 20_000, summary: null, hasReport: false },
      ]);
    } finally { stream.stop(); }
  });
});
