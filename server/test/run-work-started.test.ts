// D-8292 (#119): a run moves `dispatched -> working` once its worker takes its wave brief. "Taken" is the brief watch's
// own word (D-5841, `briefwatch.ts`): a delivery of the run's brief to the run's worker reached `ingestedAt` (the
// worker's `UserPromptSubmit` edge after the nudge) or was acked. Before this, only the coordinator's
// `{"to":"working"}` advance moved the run, a call it often does not make, so a live, productive worker's run sat at
// `dispatched` for days. The move is the server's (`causedBy: 'sweep'`, the trail's "ccrc"), its detail says what it
// was derived from, and it never moves a run that is not at `dispatched`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { queueSystemMail } from '../src/coord/rundefsTx.js';
import { BRIEF_TAKEN_START_PREFIX } from '../src/coord/briefwatch.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

const WORKER = 'project-a-quiet-basin';
const OTHER = 'project-a-still-mesa';
const COORD = 'project-a-calm-mesa';
const UUID = 'a'.repeat(36);
const PID = 4242;
const NOW = 1_800_000_000_000; // arbitrary fixed epoch ms, no relation to real time
const MAIL_SWEEP_MS = 10_000;
const MAIL_QUIET_MS = 60_000;

const store = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

const dispatched = (coord: CoordStore, opts: { subject?: string; toId?: string } = {}): { runId: number; deliveryId: number } => {
  const opened = coord.openRun({ program: 'prog-a', title: 'prog-a', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, WORKER, `${WORKER}-ws`, `ws/${WORKER}`, false, Date.now());
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  const q = queueSystemMail(coord, { program: 'prog-a', wave: 1, waveOf: 2 }, { fromId: 'coordinator', toId: opts.toId ?? WORKER,
    runId: opened.id, kind: 'status', subject: opts.subject ?? 'wave-brief', body: 'the wave brief' });
  if (!q.queued) throw new Error('brief not queued');
  return { runId: opened.id, deliveryId: q.deliveryId };
};

const stateOf = (coord: CoordStore, id: number): string =>
  (coord.db.prepare('SELECT state FROM runs WHERE id = ?').get(id) as { state: string }).state;
const startRows = (coord: CoordStore, id: number): { fromState: string; toState: string; causedBy: string; detail: string }[] =>
  coord.db.prepare("SELECT fromState, toState, causedBy, detail FROM run_events WHERE runId = ? AND toState = 'working' ORDER BY id")
    .all(id) as unknown as { fromState: string; toState: string; causedBy: string; detail: string }[];

describe('a run starts working when its worker takes its brief (D-8292)', () => {
  let home: string;
  beforeEach(() => { home = mkTmp('ccrc-work-started-'); });

  it('an untaken brief starts nothing', () => {
    const coord = store(home);
    const { runId, deliveryId } = dispatched(coord);
    coord.markDelivered(deliveryId, Date.now());
    expect(coord.startRunsOnTakenBrief()).toEqual([]);
    expect(stateOf(coord, runId)).toBe('dispatched');
  });

  it('an ingested brief moves the run to working, once, as ccrc, saying what it read', () => {
    const coord = store(home);
    const { runId, deliveryId } = dispatched(coord);
    coord.markDelivered(deliveryId, Date.now());
    coord.markIngested(deliveryId, Date.now() + 1);
    expect(coord.startRunsOnTakenBrief()).toEqual([{ runId, deliveryId, how: 'ingested' }]);
    expect(stateOf(coord, runId)).toBe('working');
    const rows = startRows(coord, runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromState: 'dispatched', toState: 'working', causedBy: 'sweep' });
    expect(rows[0]!.detail.startsWith(BRIEF_TAKEN_START_PREFIX)).toBe(true);
    expect(rows[0]!.detail).toContain(`delivery ${deliveryId}`);
    // A second pass finds nothing: the run is no longer at `dispatched`.
    expect(coord.startRunsOnTakenBrief()).toEqual([]);
    expect(startRows(coord, runId)).toHaveLength(1);
  });

  it('an acked brief moves the run to working', () => {
    const coord = store(home);
    const { runId, deliveryId } = dispatched(coord);
    coord.markDelivered(deliveryId, Date.now());
    expect(coord.markAcked(deliveryId, Date.now() + 1).ok).toBe(true);
    expect(coord.startRunsOnTakenBrief()).toEqual([{ runId, deliveryId, how: 'acked' }]);
    expect(stateOf(coord, runId)).toBe('working');
  });

  it('a taken mail that is not the brief starts nothing', () => {
    const coord = store(home);
    const { runId, deliveryId } = dispatched(coord, { subject: 'fix-round' });
    coord.markDelivered(deliveryId, Date.now());
    coord.markAcked(deliveryId, Date.now() + 1);
    expect(coord.startRunsOnTakenBrief()).toEqual([]);
    expect(stateOf(coord, runId)).toBe('dispatched');
  });

  it('a brief taken by a session that is not the run\'s worker starts nothing', () => {
    const coord = store(home);
    const { runId, deliveryId } = dispatched(coord, { toId: OTHER });
    coord.markDelivered(deliveryId, Date.now());
    coord.markAcked(deliveryId, Date.now() + 1);
    expect(coord.startRunsOnTakenBrief()).toEqual([]);
    expect(stateOf(coord, runId)).toBe('dispatched');
  });

  it('never moves a run that has left dispatched: a run under review is not sent back', () => {
    const coord = store(home);
    const { runId, deliveryId } = dispatched(coord);
    expect(coord.advance(runId, 'working', 'coordinator').ok).toBe(true);
    expect(coord.advance(runId, 'awaiting-review', 'coordinator').ok).toBe(true);
    coord.markDelivered(deliveryId, Date.now());
    coord.markAcked(deliveryId, Date.now() + 1);
    expect(coord.startRunsOnTakenBrief()).toEqual([]);
    expect(stateOf(coord, runId)).toBe('awaiting-review');
  });

  it('a closed run is never moved', () => {
    const coord = store(home);
    const { runId, deliveryId } = dispatched(coord);
    expect(coord.advance(runId, 'failed', 'operator').ok).toBe(true);
    coord.markDelivered(deliveryId, Date.now());
    coord.markIngested(deliveryId, Date.now() + 1);
    expect(coord.startRunsOnTakenBrief()).toEqual([]);
    expect(stateOf(coord, runId)).toBe('failed');
  });
});

// The sweep, end to end: the mail pass that samples the ingest edge is the pass that starts the run.
interface Harness { home: string; run: Runner }
const liveHarness = (): Harness => {
  const home = mkTmp('ccrc-work-started-sweep-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  let box = '';
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: `❯ ${box}\n`, stderr: '' };
    if (args[0] === 'send-keys') {
      if (args[3] === '-l') box += args[5]!;
      else if (args[3] === 'Enter') box = '';
      return { ran: true, code: 0, stdout: '', stderr: '' };
    }
    return { ran: true, code: 1, stdout: '', stderr: '' };
  };
  return { home, run };
};
const seedWorker = (home: string, hook: Record<string, unknown> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${WORKER}.${k}`), v);
  writeFileSync(path.join(reg, `${WORKER}.hookstate.json`), JSON.stringify({
    v: 1, state: 'done', sessionId: UUID, pid: PID, event: null, updatedAt: NOW - 61_000, ask: null, subagents: [], ...hook,
  }));
  const live = path.join(home, '.claude', 'sessions');
  mkdirSync(live, { recursive: true });
  writeFileSync(path.join(live, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: '/w/project-a', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000, version: '2.1.220',
  }));
};

describe('the mail sweep starts the run (D-8292)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('the brief delivered, then the worker\'s turn on it: the run reads working', async () => {
    const h = liveHarness();
    const coord = store(h.home);
    const deps: Deps = { ...testDeps(h.home, h.run), coord };
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000));
    await w.tick();
    seedWorker(h.home);
    const { runId } = dispatched(coord);
    await w.sweepMail();
    expect(stateOf(coord, runId)).toBe('dispatched');
    vi.setSystemTime(Date.now() + MAIL_SWEEP_MS + 1_000);
    seedWorker(h.home, { event: 'UserPromptSubmit', updatedAt: Date.now() });
    // The pass that samples the edge records it; the next pass, one sweep later, starts the run.
    await w.sweepMail();
    expect(stateOf(coord, runId)).toBe('dispatched');
    vi.setSystemTime(Date.now() + MAIL_SWEEP_MS);
    await w.sweepMail();
    expect(stateOf(coord, runId)).toBe('working');
    expect(startRows(coord, runId)).toHaveLength(1);
  });

  it('a brief acked through the route, with nothing else outstanding, starts the run on the next pass', async () => {
    const h = liveHarness();
    const coord = store(h.home);
    const deps: Deps = { ...testDeps(h.home, h.run), coord };
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000));
    await w.tick();
    seedWorker(h.home);
    const { runId, deliveryId } = dispatched(coord);
    await w.sweepMail();
    expect(coord.markAcked(deliveryId, Date.now()).ok).toBe(true);
    vi.setSystemTime(Date.now() + MAIL_SWEEP_MS + 1_000);
    await w.sweepMail();
    expect(stateOf(coord, runId)).toBe('working');
  });
});
