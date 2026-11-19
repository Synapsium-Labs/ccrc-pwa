// D-TBD-working-idle-sleeps (waiting workers spec 2026-11-19, Part 2): a dispatched worker whose newest placed run is
// `working` and whose turn marker has been quiet `STOP_DONE_PARKED_IDLE_MS` is put to sleep by the run-done policy.
// This file starts as the CHARACTERIZATION of today's behaviour, green on the code before the change: such a worker
// holds `not-done` (and its own active run would hold `run-worker` behind it), a `dispatched` run holds `not-done`, and
// the pass puts nothing to sleep. The rows marked "today:" are the ones the behaviour commit flips; "kept:" rows must not.
import { describe, expect, it, vi, afterEach } from 'vitest';
import path from 'node:path';
import { STOP_DONE_GRACE_MS, STOP_DONE_PARKED_IDLE_MS, stopDoneVerdict, type StopDoneInput, type StopDoneRow } from '../src/stopDone.js';
import { stopDonePass, type StopDoneMemory, type StopDoneSweepDeps } from '../src/sleepLane.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { VIEWER_OPEN_TTL_MS, type FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import { ACTOR_FLAGS_CAP, HIBERNATE_HOLD_OK_CAP } from '../src/ccdargv.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const WORKER = 'project-a-quiet-basin';
const COORDINATOR = 'lane-a-project-a';

const mark = (quietMs: number) => ({
  ok: true as const, state: 'done', bg: 0, crons: 0, turnAt: NOW - quietMs - MIN, stopAt: NOW - quietMs, restartAt: null,
});

const sdRow = (o: Partial<StopDoneRow> = {}): StopDoneRow => ({
  id: WORKER, child: { kind: 'child', runId: 7 }, archivedAt: null, held: null, stoppedBy: null,
  unmeasured: [], statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null,
  swapBlocked: null, substrate: null, bucket: 'idle', ...o,
});

/** A dispatched child whose newest placed run is `state`, its marker quiet `quietMs`, nothing else standing. */
const input = (state: string, o: { quietMs?: number; store?: Record<string, unknown> } = {}): StopDoneInput => ({
  row: sdRow(), heldKind: 'none', holdOkVerb: true,
  store: {
    ok: true, last: { runId: 7, state, closedAt: null },
    openWorker: state === 'working' || state === 'dispatched', parkedWorker: false, openClaimant: false, claim: false, mail: false,
    ...o.store,
  } as StopDoneInput['store'],
  viewer: false, sinceStartMs: VIEWER_OPEN_TTL_MS + 1, viewerOpenTtlMs: VIEWER_OPEN_TTL_MS, verb: true, overlord: false, optedOut: false,
  live: { kind: 'read', word: { ok: true, word: 'idle' }, turn: 'idle', mark: mark(o.quietMs ?? 7 * HOUR) },
  now: NOW, graceMs: STOP_DONE_GRACE_MS,
});
const word = (i: StopDoneInput): string => { const v = stopDoneVerdict(i); return v.act === 'hold' ? v.reason : v.act; };

describe('the run-done verdict on a worker whose newest placed run is active (characterization)', () => {
  it('today: a `working` run, its marker quiet 7 hours and nothing else standing, holds not-done', () => {
    expect(word(input('working'))).toBe('not-done');
  });

  it('today: a `working` run quiet past STOP_DONE_PARKED_IDLE_MS holds not-done', () => {
    expect(word(input('working', { quietMs: STOP_DONE_PARKED_IDLE_MS }))).toBe('not-done');
  });

  it('kept: a `dispatched` run (its brief unread) holds not-done', () => {
    expect(word(input('dispatched'))).toBe('not-done');
  });

  it('kept: an `unknown` run holds not-done', () => {
    expect(word(input('unknown'))).toBe('not-done');
  });
});

// ── The pass, over a real coordination store ─────────────────────────────────────────────────────────────────────────

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-wis-'), '.ccrc', 'coord.db')));

/** A run of programme `programme-a` claimed by the coordinator, bound to the worker, moved to `state`. */
function runAt(s: CoordStore, state: string, wave = 1, worker = WORKER): number {
  const r = s.openRun({ program: 'programme-a', title: 'programme-a title', programmeTitle: 'programme-a title', project: 'project-a', wave, waveOf: 3, claimedBy: COORDINATOR });
  if (!('id' in r)) throw new Error('openRun refused');
  s.bindSession(r.id, worker);
  s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, r.id);
  return r.id;
}

const fleetRow = (runId: number, o: Partial<FleetSession> = {}): FleetSession => ({
  id: WORKER, child: { kind: 'child', runId }, archivedAt: null, held: null, stoppedBy: null, unmeasured: [],
  statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null,
  substrate: null, bucket: 'idle', ...o,
}) as unknown as FleetSession;
const rec = (id: string): SessionRecord => ({ id, uuid: `uuid-${id}` }) as unknown as SessionRecord;

interface World {
  readonly s: CoordStore;
  readonly deps: StopDoneSweepDeps;
  readonly argv: string[][];
  readonly feed: { sessionId: string; runId: number | null; title: string; body: string }[];
  quietMs: number;
}

function world(s: CoordStore, o: { quietMs?: number } = {}): World {
  const w: World = { s, deps: undefined as unknown as StopDoneSweepDeps, argv: [], feed: [], quietMs: o.quietMs ?? 7 * HOUR };
  let seq = 0;
  (w as { deps: StopDoneSweepDeps }).deps = {
    coord: s,
    runCcd: async (a) => { w.argv.push([...a]); return { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null }; },
    fleetState: { ccdVerbs: ['hibernate', ACTOR_FLAGS_CAP, HIBERNATE_HOLD_OK_CAP] } as unknown as FleetState,
    viewers: { isOpen: () => false },
    notifyLog: {
      epoch: 'e',
      record: (e: { kind: string; sessionId: string; runId: number | null; title: string; body: string }) => {
        if (e.kind === 'run') w.feed.push({ sessionId: e.sessionId, runId: e.runId, title: e.title, body: e.body });
        return { ...e, seq: ++seq, at: NOW };
      },
      flush: async () => undefined,
    } as unknown as StopDoneSweepDeps['notifyLog'],
    liveWord: async () => ({ ok: true, word: 'idle', since: null }),
    turnVerdict: async () => 'idle',
    mark: async () => mark(w.quietMs),
    rowAtAct: async (r) => ({ ok: true, row: fleetRow(0, { id: r.id } as Partial<FleetSession>) as unknown as StopDoneRow }),
    serial: async (fn) => fn(),
    queueRun: async (_id, fn) => fn(),
    listing: async () => [],
    startedAt: NOW - VIEWER_OPEN_TTL_MS - MIN,
    now: () => NOW,
  };
  return w;
}
const mem = (): StopDoneMemory => ({ retryAt: new Map() });

describe('the run-done pass on a worker whose newest placed run is `working` (characterization)', () => {
  it('today: a worker on a `working` run, quiet 7 hours, is not put to sleep and gets no feed row', async () => {
    const s = store();
    const id = runAt(s, 'working');
    const w = world(s);
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([]);
    expect(w.feed).toEqual([]);
  });

  it('kept: a worker on a `done` run, closed past the grace and quiet 7 hours, is put to sleep (the harness control)', async () => {
    const s = store();
    const id = runAt(s, 'done');
    s.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(NOW - STOP_DONE_GRACE_MS - MIN, id);
    const w = world(s);
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([['hibernate', WORKER, '--surface', 'agent', '--actor', 'sweep:stop-done']]);
  });
});

describe('CoordStore.lastRunBySession: active runs naming a worker (characterization)', () => {
  it('kept: one `working` run names the worker in openPlacedWorkers, and it is the newest placed run', () => {
    const s = store();
    const id = runAt(s, 'working');
    const read = s.lastRunBySession([WORKER]);
    if (!read.ok) throw new Error(read.detail);
    expect(read.lastPlaced.map((l) => [l.runId, l.state])).toEqual([[id, 'working']]);
    expect(read.openPlacedWorkers).toEqual([WORKER]);
  });

  it('kept: two active runs name the worker once in openPlacedWorkers', () => {
    const s = store();
    runAt(s, 'working', 1);
    runAt(s, 'working', 2);
    const read = s.lastRunBySession([WORKER]);
    if (!read.ok) throw new Error(read.detail);
    expect(read.openPlacedWorkers).toEqual([WORKER]);
  });
});
