// D-8790 (waiting workers spec 2026-11-19, Parts 2 and 4): a dispatched worker whose newest placed run
// is `working` and whose turn marker has been quiet `STOP_DONE_PARKED_IDLE_MS` is put to sleep by the run-done policy,
// behind the Shadow lanes row `working-idle-sleep` (seeded `shadow`), and a live sleep mails the run's coordinator once
// (D-8791). The file began as the characterization of the code before the change; its rows
// marked "now:" are the ones the behaviour commit flipped (each says what it was), and its "kept:" rows did not move.
import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import {
  STOP_DONE_GRACE_MS, STOP_DONE_PARKED_IDLE_MS, STOP_DONE_RETRY_MS, STOP_DONE_WAITING_STATES, WORKER_ASLEEP_DETAIL_PREFIX,
  WORKER_ASLEEP_MAILS_PER_RUN, STOP_DONE_MEASURES_PER_PASS, STOP_DONE_WAITING_HOLD_OFF_MS, STOP_DONE_WAITING_MEASURES_PER_PASS,
  STOP_DONE_PARKED_IDLE_MS as PARKED_MS, mailOnly, stopDoneVerdict, waitingCaseKey, workerAsleepNoticeDue, type StopDoneInput, type StopDoneRow,
} from '../src/stopDone.js';
import { stopDonePass, type StopDoneMemory, type StopDoneSweepDeps } from '../src/sleepLane.js';
import { queueStallNotice, queueSystemMail } from '../src/coord/rundefsTx.js';
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

  // F13 (design review 2848): one case per use hold, so each reds on its own.
  const useBase = input('working');
  const useHolds: [string, string, StopDoneInput][] = [
    ['mail', 'mail', input('working', { store: { mail: true } })],
    ['claim', 'claim', input('working', { store: { claim: true } })],
    ['run-claimant', 'run-claimant', input('working', { store: { openClaimant: true } })],
    ['viewer', 'viewer', { ...useBase, viewer: true }],
    ['menu', 'menu', withRow(useBase, { dialogPending: true })],
    ['bucket', 'bucket', withRow(useBase, { bucket: 'done' })],
    ['background', 'background', withRow(useBase, { background: { count: 1, kinds: ['shell'] } } as Partial<StopDoneRow>)],
    ['roster', 'roster', withRow(useBase, { subagents: [{ name: 'a0000000000000001', startedAt: NOW }] } as Partial<StopDoneRow>)],
    ['turn', 'turn', withLive(useBase, { turn: 'busy' })],
    ['marker', 'marker', withMark(useBase, { state: 'running' })],
    ['marker-background', 'marker-background', withMark(useBase, { bg: 1 })],
    ['marker-background (2)', 'marker-background', withMark(useBase, { bg: -1 })],
    ['scheduled', 'scheduled', withMark(useBase, { crons: 1 })],
    ['scheduled (2)', 'scheduled', withMark(useBase, { crons: null })],
  ];
  it.each(useHolds)('a use hold stands for the waiting case: %s', (_label, w, i) => {
    expect(word(i)).toBe(w);
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

/** One migrated database, copied per store: a fresh open replays every migration, which under a loaded box costs seconds
 *  a store, and a case here opens up to three. The copies are closed after each case. */
let template = '';
const opened: CoordStore[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-wis-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const o of opened.splice(0)) { try { o.db.close(); } catch { /* already closed */ } } });
const store = (): CoordStore => {
  const dir = path.join(mkTmp('ccrc-wis-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const s = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
  opened.push(s);
  return s;
};

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
    // The real notice path over the real store, so the dedupe is the store's own observation row.
    stallNotice: (run, n) => {
      const q = queueStallNotice(s, run, n);
      if (q.queued) w.mails.push({ toId: n.toId, runId: run.id, subject: n.subject, body: n.body });
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
      `ccrc-server: stop-done shadow: would put ${WORKER} to sleep (waiting on a working run, run ${id}, its last turn ended ${new Date(NOW - 7 * HOUR).toISOString()}); the working-idle-sleep row is in shadow — asked again in an hour (D-8790)`,
    ]);
    // A later pass inside the hour asks nothing: no second line, and no measure spent on it.
    const measured = vi.fn(w.deps.liveWord);
    await stopDonePass({ ...w.deps, liveWord: measured }, m, [fleetRow(id)], [rec(WORKER)], []);
    expect(measured).not.toHaveBeenCalled();
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('ccrc-server: stop-done shadow:'))).toHaveLength(1);
    // Review 2887 F3: the hour is keyed by the case (worker, run, state), never by the worker alone.
    expect(m.waitingHeld?.get(waitingCaseKey(WORKER, id, 'working'))).toBe(NOW + STOP_DONE_RETRY_MS);
    expect(m.retryAt.has(WORKER)).toBe(false);
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
      `ccrc-server: stop-done: put ${WORKER} to sleep (waiting on a working run, run ${id}, idle; D-8790)`);
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

  it('live: the sleep is keyed by an observation row on the run, written with its mail, and a restart reads it back (F5)', async () => {
    const s = store();
    const id = runAt(s, 'working');
    live(s);
    const w = world(s);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    const rows = s.runEvents(id).filter((e) => e.detail !== null && e.detail.startsWith(WORKER_ASLEEP_DETAIL_PREFIX));
    expect(rows.map((e) => [e.detail, e.causedBy, e.fromState, e.toState])).toEqual([
      [`${WORKER_ASLEEP_DETAIL_PREFIX}${WORKER}:${NOW - 7 * HOUR}`, 'operator', 'working', 'working'],
    ]);
    // The restart, with the mail row itself deleted: the observation row alone stops a second mail.
    s.db.prepare('DELETE FROM mail_deliveries').run();
    s.db.prepare('DELETE FROM mail').run();
    await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    expect(mailed(s)).toEqual([]);
  });

  it(`live: at most WORKER_ASLEEP_MAILS_PER_RUN (${WORKER_ASLEEP_MAILS_PER_RUN}) sleep notices a run; later sleeps still happen, unmailed (F5)`, async () => {
    const s = store();
    const id = runAt(s, 'working');
    live(s);
    const w = world(s);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sleeps = WORKER_ASLEEP_MAILS_PER_RUN + 2;
    for (let k = 0; k < sleeps; k++) {
      w.quietMs = 7 * HOUR - k * MIN;   // each pass a new sleep: a later last turn
      await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
    }
    expect(w.argv).toHaveLength(sleeps);
    expect(mailed(s)).toHaveLength(WORKER_ASLEEP_MAILS_PER_RUN);
    // CONTROL: another run of the same coordinator has its own bound.
    const other = runAt(s, 'working', 2, 'project-a-other-worker');
    expect(workerAsleepNoticeDue(s.runEvents(other).map((e) => e.detail))).toBe(true);
    expect(workerAsleepNoticeDue(s.runEvents(id).map((e) => e.detail))).toBe(false);
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

// ── Review 2887: the waiting case never costs the rest of the lane (F1), holds without mail (F2), and its hold-off
// covers one case (F3) ─────────────────────────────────────────────────────────────────────────────────────────────

/** N quiet `working` workers that sort before one `done` worker (closed two hours ago), each live read held by a
 *  session cron; the `done` worker's marker is quiet and clear. */
function crowd(s: CoordStore, n: number): { readonly w: World; readonly rows: FleetSession[]; readonly recs: SessionRecord[]; readonly done: string; readonly marks: string[] } {
  const ids: string[] = [];
  const rows: FleetSession[] = [];
  for (let k = 1; k <= n; k++) {
    const id = `project-a-w${String(k).padStart(2, '0')}`;
    const run = runAt(s, 'working', k, id);
    ids.push(id);
    rows.push(fleetRow(run, { id } as Partial<FleetSession>));
  }
  const done = 'project-a-zz-finished';
  const run = runAt(s, 'done', n + 1, done);
  s.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(NOW - 2 * HOUR, run);
  rows.push(fleetRow(run, { id: done } as Partial<FleetSession>));
  const w = world(s);
  const marks: string[] = [];
  w.deps = { ...w.deps, mark: async (r: SessionRecord) => {
    marks.push(r.id);
    return r.id === done ? mark(7 * HOUR) : { ...mark(7 * HOUR), crons: 1 };
  } } as never;
  return { w, rows, recs: [...ids, done].map(rec), done, marks };
}
const HIB_OF = (id: string): string[] => ['hibernate', id, '--surface', 'agent', '--actor', 'sweep:stop-done'];

describe('review 2887: the waiting case and the rest of the run-done lane', () => {
  it('the budgets: the waiting case has its own, and the rest keep the six they had', () => {
    expect(STOP_DONE_MEASURES_PER_PASS).toBe(6);
    expect(STOP_DONE_WAITING_MEASURES_PER_PASS).toBe(3);
    expect(STOP_DONE_WAITING_HOLD_OFF_MS).toBe(PARKED_MS / 3);
  });

  for (const armed of [false, true]) {
    it(`F1: ${STOP_DONE_MEASURES_PER_PASS + 1} quiet working workers held by a session cron never cost a finished worker its sleep (${armed ? 'armed' : 'shadow'})`, async () => {
      const s = store();
      if (armed) live(s);
      const c = crowd(s, STOP_DONE_MEASURES_PER_PASS + 1);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await stopDonePass(c.w.deps, mem(), c.rows, c.recs, []);
      expect(c.w.argv).toEqual([HIB_OF(c.done)]);
      // The waiting workers took their own budget, no more.
      expect(c.marks.filter((id) => id !== c.done)).toHaveLength(STOP_DONE_WAITING_MEASURES_PER_PASS);
      expect(mailed(s)).toEqual([]);
    });
  }

  it('F1 (b): a working worker the live read held is not measured again inside the hold-off, and is once it ends', async () => {
    const s = store();
    const c = crowd(s, 2);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = mem();
    const working = c.rows.filter((r) => r.id !== c.done);
    const recs = c.recs.filter((r) => r.id !== c.done);
    await stopDonePass(c.w.deps, m, working, recs, []);
    expect(c.marks).toEqual(['project-a-w01', 'project-a-w02']);
    await stopDonePass(c.w.deps, m, working, recs, []);
    expect(c.marks).toHaveLength(2);
    const later = { ...c.w.deps, now: () => NOW + STOP_DONE_WAITING_HOLD_OFF_MS } as StopDoneSweepDeps;
    await stopDonePass(later, m, working, recs, []);
    expect(c.marks).toHaveLength(4);
  });

  it('F2: while mail-disabled stands the waiting case holds: no sleep, no observation row, no mail; a finished worker still sleeps', async () => {
    for (const names of [['mail-disabled'], null]) {
      const s = store();
      const id = runAt(s, 'working');
      live(s);
      const w = world(s);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      if (names === null) {
        // An unlistable registry is no clear switch: it holds too, read through the pass's facts.
        expect(stopDoneVerdict({ ...input('working'), mailDisabled: 'unmeasurable' })).toEqual({ act: 'hold', reason: 'mail-disabled' });
        continue;
      }
      await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], names);
      expect(w.argv).toEqual([]);
      expect(mailed(s)).toEqual([]);
      expect(s.runEvents(id).filter((e) => e.detail !== null && e.detail.startsWith(WORKER_ASLEEP_DETAIL_PREFIX))).toEqual([]);
      // CONTROL: the switch lifted, the same worker sleeps and its coordinator is told.
      await stopDonePass(w.deps, mem(), [fleetRow(id)], [rec(WORKER)], []);
      expect(w.argv).toEqual([HIB]);
      expect(mailed(s)).toHaveLength(1);
    }
    // A finished worker's sleep never reads the switch.
    const s = store();
    const c = crowd(s, 0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stopDonePass(c.w.deps, mem(), c.rows, c.recs, ['mail-disabled']);
    expect(c.w.argv).toEqual([HIB_OF(c.done)]);
  });

  it('F3: a shadow-logged worker whose run moves to done sleeps after the grace, not an hour later', async () => {
    const s = store();
    const id = runAt(s, 'working');
    const w = world(s);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = mem();
    await stopDonePass(w.deps, m, [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([]);
    // Inside the hour, the run is done and closed past the grace.
    s.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE id = ?").run(NOW - STOP_DONE_GRACE_MS - MIN, id);
    const later = { ...w.deps, now: () => NOW + 15 * MIN } as StopDoneSweepDeps;
    await stopDonePass(later, m, [fleetRow(id)], [rec(WORKER)], []);
    expect(w.argv).toEqual([HIB]);
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
