// ARCH-52 (#787; consolidation spec K13): what a SessionStream's four per-session readings (the pane menu, the task
// plan, the hook ask, the outstanding mail) put on the wire, and what they cost. Characterization first: the frame
// rows are green on the code before the readings left the stream and stay green after; the cost rows are the
// counted exit (polls 4 -> 0 per socket, dialog frames per change per socket 1).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Deps } from '../src/server.js';
import { SessionStream } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const ID = 'claude-a-project-f';
const UUID_A = 'a'.repeat(36);
const WORKDIR = '/data/projects/project-f';
const MUNGED = '-data-projects-project-f';
const PID = 40613;

const here = path.dirname(fileURLToPath(import.meta.url));
const pane = (name: string): string => readFileSync(path.join(here, 'fixtures', 'panes', name), 'utf8');
const MENU = pane('ask-2col-chat-about.txt');
const BUSY = pane('busy.txt');

/** One poll of a live stream: what the 2 s interval does, awaited, so these tests never sleep. After ARCH-52 the
 *  stream's timer drives only its own reading; the shared per-session feed has one of its own, polled here too. */
const pollOnce = async (...streams: SessionStream[]): Promise<void> => {
  for (const s of streams) await (s as unknown as { tick: () => Promise<void> }).tick();
  await (streams[0] as unknown as { feed?: { poll(): Promise<void> } }).feed?.poll();
};

describe('a session stream\'s four readings (ARCH-52)', () => {
  let home: string;
  let coord: CoordStore;
  let current: string;           // the pane the next capture returns
  let captures: number;
  let hookReads: number;
  let taskReads: number;
  let deps: Deps;
  const hookFile = (): string => path.join(home, '.cc-sessions', `${ID}.hookstate.json`);

  beforeEach(() => {
    home = mkTmp('ccrc-sws-readings-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = { wrapper: 'claude-a', project: 'project-f', workdir: WORKDIR, uuid: UUID_A, started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const sess = path.join(home, '.claude-a', 'sessions');
    mkdirSync(sess, { recursive: true });
    writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'project-f-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const tdir = path.join(home, '.claude-a', 'projects', MUNGED);
    mkdirSync(tdir, { recursive: true });
    writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), '');
    current = BUSY; captures = 0; hookReads = 0; taskReads = 0;
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
      if (args[0] === 'capture-pane') { captures += 1; return { ran: true, code: 0, stdout: current, stderr: '' }; }
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: (p) => { if (p === hookFile()) hookReads += 1; return localIO.readFileMeasured(p); },
      readdir: (p) => { if (p.includes(`${path.sep}tasks${path.sep}`)) taskReads += 1; return localIO.readdir(p); },
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue(), coord };
  });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); });

  const open = async (bus: Bus, frames: SessionStreamMsg[]): Promise<SessionStream> => {
    const s = new SessionStream(deps, bus, ID, (m) => frames.push(m));
    await s.start();
    return s;
  };

  it('states each reading on connect, in one order: dialog, tasks, ask, mail', async () => {
    current = MENU;
    const tasks = path.join(home, '.claude-a', 'tasks', UUID_A);
    mkdirSync(tasks, { recursive: true });
    writeFileSync(path.join(tasks, '1.json'), JSON.stringify({ id: '1', subject: 'one', description: '', activeForm: 'Doing one', status: 'pending' }));
    writeFileSync(hookFile(), JSON.stringify({
      v: 1, state: 'waiting', event: 'Notification', sessionId: UUID_A, pid: PID, updatedAt: Date.now(), subagents: [],
      ask: { questions: [{ question: 'Deploy now?', options: [{ label: 'Yes' }, { label: 'No' }] }] },
    }));
    const inserted = coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: ID, runId: null,
      kind: 'question', subject: 'rebase?', body: 'b', artifacts: [] });
    coord.queueDelivery(inserted.id, ID, 'envelope');
    const frames: SessionStreamMsg[] = [];
    const s = await open(new Bus(), frames);
    s.stop();
    const readings = frames.map((f) => f.type).filter((t) => ['dialog', 'tasks', 'ask', 'mail'].includes(t));
    expect(readings).toEqual(['dialog', 'tasks', 'ask', 'mail']);
  });

  it('a connect with nothing pending still states ask_cleared and an empty mail list, and no dialog or tasks', async () => {
    const frames: SessionStreamMsg[] = [];
    const s = await open(new Bus(), frames);
    s.stop();
    const readings = frames.map((f) => f.type).filter((t) => ['dialog', 'dialog_cleared', 'tasks', 'ask', 'ask_cleared', 'mail'].includes(t));
    expect(readings).toEqual(['ask_cleared', 'mail']);
  });

  it('a menu that appears and goes sends each socket one dialog frame and one dialog_cleared, whatever the socket count', async () => {
    const bus = new Bus();
    const a: SessionStreamMsg[] = [];
    const b: SessionStreamMsg[] = [];
    const sa = await open(bus, a);
    const sb = await open(bus, b);
    try {
      current = MENU;
      await pollOnce(sa, sb);
      await pollOnce(sa, sb);   // the same menu again: nothing more
      current = BUSY;
      await pollOnce(sa, sb);
      for (const frames of [a, b]) {
        expect(frames.filter((f) => f.type === 'dialog')).toHaveLength(1);
        expect(frames.filter((f) => f.type === 'dialog_cleared')).toHaveLength(1);
      }
    } finally { sa.stop(); sb.stop(); }
  });

  it('a task plan, a hook ask and a mail item that change between polls each reach the socket once', async () => {
    const frames: SessionStreamMsg[] = [];
    const s = await open(new Bus(), frames);
    try {
      frames.length = 0;
      const tasks = path.join(home, '.claude-a', 'tasks', UUID_A);
      mkdirSync(tasks, { recursive: true });
      writeFileSync(path.join(tasks, '1.json'), JSON.stringify({ id: '1', subject: 'one', description: '', activeForm: 'Doing one', status: 'pending' }));
      writeFileSync(hookFile(), JSON.stringify({
        v: 1, state: 'waiting', event: 'Notification', sessionId: UUID_A, pid: PID, updatedAt: Date.now(), subagents: [],
        ask: { questions: [{ question: 'Deploy now?', options: [{ label: 'Yes' }, { label: 'No' }] }] },
      }));
      const inserted = coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: ID, runId: null,
        kind: 'question', subject: 'rebase?', body: 'b', artifacts: [] });
      coord.queueDelivery(inserted.id, ID, 'envelope');
      await pollOnce(s);
      await pollOnce(s);
      const kinds = frames.map((f) => f.type);
      expect(kinds.filter((t) => t === 'tasks')).toHaveLength(1);
      expect(kinds.filter((t) => t === 'ask')).toHaveLength(1);
      expect(kinds.filter((t) => t === 'mail')).toHaveLength(1);
    } finally { s.stop(); }
  });

  // The counted exit's cost row. Before ARCH-52 every open socket read the pane, the plan, the hookstate and the mail
  // itself, every tick: two sockets on one session, two of each. The session's feed reads once for all of them.
  it('one tick costs one capture, one hookstate read and one plan read for the session, however many sockets watch it', async () => {
    const bus = new Bus();
    const sa = await open(bus, []);
    const sb = await open(bus, []);
    try {
      captures = 0; hookReads = 0; taskReads = 0;
      await pollOnce(sa, sb);
      expect({ captures, hookReads, taskReads }).toEqual({ captures: 1, hookReads: 1, taskReads: 1 });
    } finally { sa.stop(); sb.stop(); }
  });

  it('a stream\'s own tick reads none of the four: polls 4 -> 0', async () => {
    const s = await open(new Bus(), []);
    try {
      captures = 0; hookReads = 0; taskReads = 0;
      await (s as unknown as { tick: () => Promise<void> }).tick();
      expect({ captures, hookReads, taskReads }).toEqual({ captures: 0, hookReads: 0, taskReads: 0 });
    } finally { s.stop(); }
  });

  // The subscription (K13): the watcher already captures the pane and reads the hookstate for every session on its tick
  // and publishes both; an open session's feed takes them, and a published pane IS the tick (the feed has no clock).
  it('a pane and a hookstate the watcher published are the reading: no capture, no hookstate read, and every socket is told', async () => {
    const bus = new Bus();
    const fa: SessionStreamMsg[] = []; const fb: SessionStreamMsg[] = [];
    const sa = await open(bus, fa);
    const sb = await open(bus, fb);
    try {
      captures = 0; hookReads = 0; taskReads = 0;
      const at = Date.now();
      bus.emit(`hook:${ID}`, { at, uuid: UUID_A, raw: { ok: false, reason: 'absent' } });
      bus.emit(`pane:${ID}`, { at, pane: MENU });
      await new Promise((r) => setTimeout(r, 50));
      expect({ captures, hookReads }).toEqual({ captures: 0, hookReads: 0 });
      expect(taskReads).toBe(1);   // the plan is the feed's own read: the watcher holds its counts on a slower clock
      for (const f of [fa, fb]) expect(f.filter((m) => m.type === 'dialog')).toHaveLength(1);
      bus.emit(`pane:${ID}`, { at: Date.now(), pane: BUSY });
      await new Promise((r) => setTimeout(r, 50));
      for (const f of [fa, fb]) expect(f.filter((m) => m.type === 'dialog_cleared')).toHaveLength(1);
      expect(captures).toBe(0);
    } finally { sa.stop(); sb.stop(); }
  });

  it('a pane captured before the last answer is not the reading: the feed looks again', async () => {
    const bus = new Bus();
    const sa = await open(bus, []);
    try {
      const old = Date.now();
      await new Promise((r) => setTimeout(r, 5));
      bus.emit(`answered:${ID}`, null);
      captures = 0;
      bus.emit(`pane:${ID}`, { at: old, pane: MENU });
      await new Promise((r) => setTimeout(r, 50));
      expect(captures).toBe(1);
    } finally { sa.stop(); }
  });

  it('a socket that joins a menu already explained is handed the explained menu, and costs the session no new read of the transcript', async () => {
    current = MENU;
    writeFileSync(path.join(home, '.claude-a', 'projects', MUNGED, `${UUID_A}.jsonl`),
      readFileSync(path.join(here, 'fixtures', 'transcript-ask-2col.jsonl'), 'utf8'));
    const bus = new Bus();
    const a: SessionStreamMsg[] = [];
    const sa = await open(bus, a);
    const b: SessionStreamMsg[] = [];
    try {
      const first = a.find((f) => f.type === 'dialog') as { dialog: { ask?: unknown } } | undefined;
      expect(first?.dialog.ask).toBeDefined();
      const sb = await open(bus, b);
      try {
        const joined = b.find((f) => f.type === 'dialog') as { dialog: { ask?: unknown } } | undefined;
        expect(joined?.dialog.ask).toEqual(first?.dialog.ask);
        expect(b.filter((f) => f.type === 'dialog')).toHaveLength(1);
        expect(a.filter((f) => f.type === 'dialog')).toHaveLength(1);
      } finally { sb.stop(); }
    } finally { sa.stop(); }
  });

  it('the last socket to leave takes the feed with it: no listener, and a new socket starts a new feed', async () => {
    const bus = new Bus();
    const sa = await open(bus, []);
    const sb = await open(bus, []);
    sa.stop();
    expect(bus.listenerCount(`answered:${ID}`)).toBeGreaterThan(0);
    sb.stop();
    expect(bus.listenerCount(`answered:${ID}`)).toBe(0);
    expect(bus.listenerCount(`pane:${ID}`)).toBe(0);
    expect(bus.listenerCount(`hook:${ID}`)).toBe(0);
    const frames: SessionStreamMsg[] = [];
    const sc = await open(bus, frames);
    try {
      expect(frames.map((f) => f.type)).toContain('ask_cleared');
    } finally { sc.stop(); }
  });
});
