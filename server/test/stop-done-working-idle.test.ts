// D-TBD-working-idle-sleeps (waiting workers spec 2026-11-19, Parts 2 and 4): a dispatched worker whose newest placed run
// is `working` and whose turn marker has been quiet `STOP_DONE_PARKED_IDLE_MS` is put to sleep by the run-done policy,
// behind the Shadow lanes row `working-idle-sleep` (seeded `shadow`), and a live sleep mails the run's coordinator once
// (D-TBD-coordinator-told-of-sleep). The file began as the characterization of the code before the change; its rows
// marked "now:" are the ones the behaviour commit flipped (each says what it was), and its "kept:" rows did not move.
import { describe, expect, it, vi, afterEach } from 'vitest';
import path from 'node:path';
import {
  STOP_DONE_GRACE_MS, STOP_DONE_PARKED_IDLE_MS, STOP_DONE_RETRY_MS, STOP_DONE_WAITING_STATES, mailOnly, stopDoneVerdict,
  type StopDoneInput, type StopDoneRow,
} from '../src/stopDone.js';
import { stopDonePass, type StopDoneMemory, type StopDoneSweepDeps } from '../src/sleepLane.js';
import { queueSystemMail } from '../src/coord/rundefsTx.js';
import { WORKING_IDLE_SLEEP_LANE } from '../../shared/lane-arm.js';
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
    openWorker: state === 'working' || state === 'dispatched', parkedWorker: false, otherOpenWorker: false, openClaimant: false,
    claim: false, mail: false,
    ...o.store,
  } as StopDoneInput['store'],
  viewer: false, sinceStartMs: VIEWER_OPEN_TTL_MS + 1, viewerOpenTtlMs: VIEWER_OPEN_TTL_MS, verb: true, overlord: false, optedOut: false,
  live: { kind: 'read', word: { ok: true, word: 'idle' }, turn: 'idle', mark: mark(o.quietMs ?? 7 * HOUR) },
  now: NOW, graceMs: STOP_DONE_GRACE_MS,
});
const word = (i: StopDoneInput): string => { const v = stopDoneVerdict(i); return v.act === 'hold' ? v.reason : v.act; };
const withRow = (i: StopDoneInput, o: Partial<StopDoneRow>): StopDoneInput => ({ ...i, row: { ...i.row, ...o } });
const withLive = (i: StopDoneInput, o: Record<string, unknown>): StopDoneInput =>
  (i.live.kind === 'read' ? { ...i, live: { ...i.live, ...o } as StopDoneInput['live'] } : i);
const withMark = (i: StopDoneInput, o: Record<string, unknown>): StopDoneInput =>
  (i.live.kind === 'read' && i.live.mark.ok ? { ...i, live: { ...i.live, mark: { ...i.live.mark, ...o } } as StopDoneInput['live'] } : i);

describe('the run-done verdict on a worker whose newest placed run is active', () => {
  it('the waiting states are `working` alone', () => {
    expect([...STOP_DONE_WAITING_STATES]).toEqual(['working']);
  });

  it('now: a `working` run, its marker quiet 7 hours and nothing else standing, sleeps as the waiting case (was: not-done)', () => {
    expect(stopDoneVerdict(input('working'))).toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR, waiting: { since: NOW - 7 * HOUR } });
  });

  it('now: quiet exactly STOP_DONE_PARKED_IDLE_MS sleeps; one ms less holds recent (was: not-done for both)', () => {
    expect(word(input('working', { quietMs: STOP_DONE_PARKED_IDLE_MS }))).toBe('hibernate');
    expect(word(input('working', { quietMs: STOP_DONE_PARKED_IDLE_MS - 1 }))).toBe('recent');
    // CONTROL: the 30 minutes are the waiting clock, not the done run's 10-minute grace.
    expect(word(input('working', { quietMs: STOP_DONE_GRACE_MS + MIN }))).toBe('recent');
  });

  it('its own active run does not hold it; a SECOND active run naming it holds run-worker', () => {
    expect(word(input('working', { store: { openWorker: true, otherOpenWorker: false } }))).toBe('hibernate');
    expect(word(input('working', { store: { openWorker: true, otherOpenWorker: true } }))).toBe('run-worker');
  });

  it('every use hold stands: mail, claim, viewer, menu, bucket, roster, turn, marker-background, scheduled', () => {
    const base = input('working');
    const held: [string, StopDoneInput][] = [
      ['mail', input('working', { store: { mail: true } })],
      ['claim', input('working', { store: { claim: true } })],
      ['run-claimant', input('working', { store: { openClaimant: true } })],
      ['viewer', { ...base, viewer: true }],
      ['menu', withRow(base, { dialogPending: true })],
      ['bucket', withRow(base, { bucket: 'done' })],
      ['background', withRow(base, { background: { count: 1, kinds: ['shell'] } } as Partial<StopDoneRow>)],
      ['roster', withRow(base, { subagents: [{ name: 'a0000000000000001', startedAt: NOW }] } as Partial<StopDoneRow>)],
      ['turn', withLive(base, { turn: 'busy' })],
      ['marker', withMark(base, { state: 'running' })],
      ['marker-background', withMark(base, { bg: 1 })],
      ['marker-background', withMark(base, { bg: -1 })],
      ['scheduled', withMark(base, { crons: 1 })],
      ['scheduled', withMark(base, { crons: null })],
    ];
    for (const [w, i] of held) expect(word(i), w).toBe(w);
  });

  it('a hold naming its own run passes with hibernate-hold-ok, and the answer carries its exact text and the waiting case', () => {
    const held = 'program:programme-a wave:1 run:7';
    const i = withRow({ ...input('working'), heldKind: 'run-own' }, { held });
    expect(stopDoneVerdict(i)).toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR, holdOk: held, waiting: { since: NOW - 7 * HOUR } });
    expect(word({ ...i, holdOkVerb: false })).toBe('held');
    expect(word({ ...i, heldKind: 'run-live' })).toBe('held');
  });

  it('a done or parked run\'s answer carries no waiting case', () => {
    const done = input('done', { store: { openWorker: false, last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1 } } });
    expect(stopDoneVerdict(done)).toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
    expect(stopDoneVerdict(input('awaiting-review', { store: { openWorker: false } }))).toEqual({ act: 'hibernate', runId: 7, idleMs: 7 * HOUR });
  });

  it('the mail-only count is of finished workers: a waiting worker held by mail alone is not counted', () => {
    expect(mailOnly(input('working', { store: { mail: true } }))).toBe(false);
    // CONTROL: a done worker held by mail alone is.
    expect(mailOnly(input('done', { store: { openWorker: false, mail: true, last: { runId: 7, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1 } } }))).toBe(true);
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
  deps: StopDoneSweepDeps;
  readonly argv: string[][];
  readonly feed: { sessionId: string; runId: number | null; title: string; body: string }[];
  readonly mails: { toId: string; runId: number | null; subject: string; body: string }[];
  quietMs: number;
  /** Runs once, inside the act, before its re-reads (`rowAtAct`): the window between the pass and the argv. */
  beforeAct: (() => void) | null;
}

function world(s: CoordStore, o: { quietMs?: number } = {}): World {
  const w: World = {
    s, deps: undefined as unknown as StopDoneSweepDeps, argv: [], feed: [], mails: [], quietMs: o.quietMs ?? 7 * HOUR, beforeAct: null,
  };
  let seq = 0;
  w.deps = {
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
    rowAtAct: async (r) => {
      const b = w.beforeAct;
      w.beforeAct = null;
      b?.();
      return { ok: true, row: fleetRow(0, { id: r.id, held: heldOf.get(r.id) ?? null } as Partial<FleetSession>) as unknown as StopDoneRow };
    },
    serial: async (fn) => fn(),
    queueRun: async (_id, fn) => fn(),
    listing: async () => [],
    // The real mail path over the real store, so the dedupe is the store's own.
    systemMail: (run, m) => {
      const q = queueSystemMail(s, run, m);
      if (q.queued) w.mails.push({ toId: m.toId, runId: m.runId, subject: m.subject, body: m.body });
      return q;
    },
    startedAt: NOW - VIEWER_OPEN_TTL_MS - MIN,
    now: () => NOW,
  };
  return w;
}
/** The row's `.hold` at the act, per id (the tick's row carries its own). */
const heldOf = new Map<string, string>();
afterEach(() => { heldOf.clear(); });
const mem = (): StopDoneMemory => ({ retryAt: new Map() });
const live = (s: CoordStore): void => { s.setLaneArm(WORKING_IDLE_SLEEP_LANE, 'live', NOW - HOUR); };
const HIB = ['hibernate', WORKER, '--surface', 'agent', '--actor', 'sweep:stop-done'];
/** Mail the store holds to the coordinator from the server, every delivery state. */
const mailed = (s: CoordStore): { subject: string; runId: number | null }[] =>
  s.db.prepare("SELECT subject, runId FROM mail WHERE fromId = 'operator' AND toId = ? ORDER BY id").all(COORDINATOR) as never;

describe('the run-done pass on a worker whose newest placed run is `working`', () => {
  it('the row is seeded shadow: a worker on a `working` run, quiet 7 hours, is left awake, with one shadow line, no feed row and no mail', async () => {
    const s = store();
    const id = runAt(s, 'working');
    const w = world(s);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = mem();
    expect(await stopDonePass(w.deps, m, [fleetRow(id)], [rec(WORKER)], [])).toEqual([]);
    expect(w.argv).toEqual([]);
    expect(w.feed).toEqual([]);
    expect(mailed(s)).toEqual([]);
    const shadow = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: stop-done shadow:'));
    expect(shadow).toEqual([
      `ccrc-server: stop-done shadow: would put ${WORKER} to sleep (waiting on a working run, run ${id}, its last turn ended ${new Date(NOW - 7 * HOUR).toISOString()}); the working-idle-sleep row is in shadow — asked again in an hour (D-TBD-working-idle-sleeps)`,
    ]);
    // A later pass inside the hour asks nothing: no second line, and no measure spent on it.
    const measured = vi.fn(w.deps.liveWord);
    await stopDonePass({ ...w.deps, liveWord: measured }, m, [fleetRow(id)], [rec(WORKER)], []);
    expect(measured).not.toHaveBeenCalled();
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('ccrc-server: stop-done shadow:'))).toHaveLength(1);
    expect(m.retryAt.get(WORKER)).toBe(NOW + STOP_DONE_RETRY_MS);
    expect(w.argv).toEqual([]);
  });

  it('live: the worker is put to sleep, its asleep row says it waited on a working run, and its coordinator is mailed once', async () => {
    const s = store();
    const id = runAt(s, 'working');
    live(s);
    const w = world(s);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], [])).toEqual([{ id: WORKER, kind: 'hibernated', runId: id }]);
    expect(w.argv).toEqual([HIB]);
    expect(w.feed).toEqual([{
      sessionId: WORKER, runId: id, title: 'Worker asleep',
      body: `${WORKER} was put to sleep waiting on a working run (run ${id}): it sat idle. Mail, a re-dispatch or a restart wakes it.`,
    }]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(
      `ccrc-server: stop-done: put ${WORKER} to sleep (waiting on a working run, run ${id}, idle; D-TBD-working-idle-sleeps)`);
    const at = `${new Date(NOW - 7 * HOUR).toISOString().slice(0, 16)}Z`;
    expect(w.mails).toEqual([{
      toId: COORDINATOR, runId: id, subject: `worker-asleep: run ${id}, last turn ended ${at}`,
      body: `Your worker ${WORKER} on run ${id} was put to sleep: the run is working, and the worker's last turn ended at ${at} `
        + 'with nothing running or scheduled since. Its workspace, branch and transcript are kept. Mail to it, or a send-back, wakes it.',
    }]);
  });

  it('live: across a restart (fresh memory) and with the first mail already acked, the same sleep is never mailed twice', async () => {
    const s = store();
    const id = runAt(s, 'working');
    live(s);
    const w = world(s);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(mailed(s)).toHaveLength(1);
    s.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    // The restart: a new process's memory, the same sleep (the same last turn) asked again.
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([HIB, HIB]);
    expect(mailed(s)).toHaveLength(1);
    // CONTROL: a later sleep, after a later turn, is a new sleep and is told.
    w.quietMs = 2 * HOUR;
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(mailed(s).map((r) => r.subject)).toEqual([
      `worker-asleep: run ${id}, last turn ended ${new Date(NOW - 7 * HOUR).toISOString().slice(0, 16)}Z`,
      `worker-asleep: run ${id}, last turn ended ${new Date(NOW - 2 * HOUR).toISOString().slice(0, 16)}Z`,
    ]);
  });

  it('live: a worker parked at review is put to sleep with no mail (the wait there is the coordinator\'s own)', async () => {
    const s = store();
    const id = runAt(s, 'awaiting-review');
    live(s);
    const w = world(s);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([HIB]);
    expect(mailed(s)).toEqual([]);
  });

  it('live: the dispatch\'s own-run hold passes with --hold-ok and its exact text', async () => {
    const s = store();
    const id = runAt(s, 'working');
    live(s);
    const held = `program:programme-a wave:1 run:${id}`;
    heldOf.set(WORKER, held);
    const w = world(s);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stopDonePass(w.deps, mem(), [fleetRow(id, { held } as Partial<FleetSession>)], [rec(WORKER)], []);
    expect(w.argv).toEqual([['hibernate', '--hold-ok', held, WORKER, '--surface', 'agent', '--actor', 'sweep:stop-done']]);
  });

  it('live: a second active run naming the worker holds it, and a `dispatched` run holds it', async () => {
    const s = store();
    runAt(s, 'working', 1);
    const id = runAt(s, 'working', 2);
    live(s);
    const w = world(s);
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([]);
    const s2 = store();
    const d = runAt(s2, 'dispatched');
    live(s2);
    const w2 = world(s2);
    await stopDonePass(w2.deps, mem(), [fleetRow(d)], [rec(WORKER)], []);
    expect(w2.argv).toEqual([]);
  });

  it('live: unread mail to the worker, background work or a session cron holds it', async () => {
    for (const hold of ['mail', 'bg', 'crons'] as const) {
      const s = store();
      const id = runAt(s, 'working');
      live(s);
      const w = world(s);
      if (hold === 'mail') queueSystemMail(s, null, { fromId: 'operator', toId: WORKER, runId: null, kind: 'status', subject: 'unread', body: 'b' });
      if (hold !== 'mail') w.deps = { ...w.deps, mark: async () => ({ ...mark(7 * HOUR), [hold]: 1 }) } as never;
      await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
      expect(w.argv, hold).toEqual([]);
    }
  });

  it('live: the row set back to shadow between the pass and the act holds the act (switched-off), with no mail', async () => {
    const s = store();
    const id = runAt(s, 'working');
    live(s);
    const w = world(s);
    w.beforeAct = () => { s.setLaneArm(WORKING_IDLE_SLEEP_LANE, 'shadow', NOW); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []))
      .toEqual([{ id: WORKER, kind: 'switched-off', detail: 'answer-in-shadow' }]);
    expect(w.argv).toEqual([]);
    expect(mailed(s)).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(
      `ccrc-server: stop-done: ${WORKER} was not put to sleep: its case was in shadow during the pass`);
  });

  it('kept: a worker on a `done` run, closed past the grace and quiet 7 hours, is put to sleep with the row in shadow (the harness control)', async () => {
    const s = store();
    const id = runAt(s, 'done');
    s.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(NOW - STOP_DONE_GRACE_MS - MIN, id);
    const w = world(s);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([HIB]);
    expect(mailed(s)).toEqual([]);
  });
});

describe('CoordStore.lastRunBySession: active runs naming a worker', () => {
  const read = (s: CoordStore) => { const r = s.lastRunBySession([WORKER]); if (!r.ok) throw new Error(r.detail); return r; };

  it('kept: one `working` run names the worker in openPlacedWorkers, and it is the newest placed run; no OTHER active run names it', () => {
    const s = store();
    const id = runAt(s, 'working');
    const r = read(s);
    expect(r.lastPlaced.map((l) => [l.runId, l.state])).toEqual([[id, 'working']]);
    expect(r.openPlacedWorkers).toEqual([WORKER]);
    expect(r.otherOpenPlacedWorkers).toEqual([]);
  });

  it('kept: two active runs name the worker once in openPlacedWorkers; the older is an OTHER active run', () => {
    const s = store();
    runAt(s, 'working', 1);
    runAt(s, 'working', 2);
    const r = read(s);
    expect(r.openPlacedWorkers).toEqual([WORKER]);
    expect(r.otherOpenPlacedWorkers).toEqual([WORKER]);
  });

  it('an older done run beside a newer working one is no other active run; an older working run beside a newer done one is', () => {
    const s = store();
    runAt(s, 'done', 1);
    runAt(s, 'working', 2);
    expect(read(s).otherOpenPlacedWorkers).toEqual([]);
    const s2 = store();
    runAt(s2, 'working', 1);
    runAt(s2, 'done', 2);
    expect(read(s2).otherOpenPlacedWorkers).toEqual([WORKER]);
    expect(read(s2).openPlacedWorkers).toEqual([WORKER]);
  });

  it('a newer planned run is not placed: the working run is still the newest placed one, and no other active run names it', () => {
    const s = store();
    runAt(s, 'working', 1);
    runAt(s, 'planned', 2);
    expect(read(s).otherOpenPlacedWorkers).toEqual([]);
  });
});
