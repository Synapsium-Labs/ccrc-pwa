// D-6095 (fleet-capacity W1-4; spec §3.5 "The server wakes waiting coordinators", §5.1 W1-4; D-8126, amendment A8-3): a
// coordinator whose dispatch (or send-back) the concurrency cap refused is MAILED when the cap has room again, one
// mail per refusal, round-robin by programme, no faster than the wake budget's rate and in a window of the lane's own.
//
// The characterization commit pinned, green on the base, that a refused dispatch wrote nothing and the run stayed
// `planned`; the stamp's block below flips exactly the rows that changed (the stamp and the journal line). A refusal
// still sends no mail: the wake is the lane's, when the cap has room.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CAP_COUNTS_WORKING_LANE } from '../../shared/lane-arm.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, waitOnSendBackRefusal, type DispatchOutcome, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { admissionWakeChoice, admissionWakeDetail, blockWokenWith, capWaitOf, type AdmissionWaiter } from '../src/coord/admissionWake.js';
import { queueAdmissionWake } from '../src/coord/admissionWakeTx.js';
import { capsReadingOf, capsRoomOf } from '../src/coord/dispatchDecide.js';
import { WAKE_BURST, WAKE_WINDOW_MS, wakeAdmit, wakeAdmitMany, wakeRoom } from '../src/coord/wakeBudget.js';
import { testDeps, withFakeClock } from './helpers.js';
import { FleetWatcher } from '../src/watch.js';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { laneRow } from '../src/laneSchedule.js';
import { NotifyLog } from '../src/notifylog.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { mkTmp } from './tmpHelpers.js';

/** One run's admission stamp and claimant, read from its three columns (the test's own read; the store has no reader of
 *  them besides the waiter list). Null for an unknown run. */
type Stamp = { since: number | null; lastRefusedAt: number | null; wokenAt: number | null; claimedBy: string | null; program: string };
function stampOf(coord: CoordStore, runId: number): Stamp | null {
  const r = coord.db.prepare(
    'SELECT admissionWaitSince AS since, lastRefusedAt, admissionWokenAt AS wokenAt, claimedBy, program FROM runs WHERE id = ?',
  ).get(runId) as Stamp | undefined;
  return r === undefined ? null : { since: r.since, lastRefusedAt: r.lastRefusedAt, wokenAt: r.wokenAt, claimedBy: r.claimedBy, program: r.program };
}

const PROJECT = 'demo';
const WORKER = 'demo-quiet-basin';

function fixture() {
  const home = mkTmp('ccrc-admission-wake-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const run: Runner = async (_cmd, args) => ({ ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' });
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: DispatchRunDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => 'idle' as const,
  };
  const seed = (id: string): void => {
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
      workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };
  /** A dispatched run holding a slot for programme `program`. */
  const holder = (program: string): number => {
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy: `c-${program}` }) as { id: number };
    coord.markDispatched(o.id, `${program}-worker`, `${program}-ws`, `ws/${program}`, false, Date.now());
    if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: holder did not dispatch');
    return o.id;
  };
  /** A planned run of `program` bound to WORKER (the resume arm), claimed by `claimedBy`. */
  const planned = (program: string, claimedBy: string): number => {
    seed(WORKER);
    const o = coord.openRun({ program, title: program, project: PROJECT, wave: 2, waveOf: 2, claimedBy });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(WORKER, o.id);
    return o.id;
  };
  return { coord, deps, holder, planned, home };
}

const capRefused = (out: DispatchOutcome): boolean => !out.ok && out.kind === 'refused' && out.code === 'cap-concurrency';
const mailCount = (coord: CoordStore): number => (coord.db.prepare('SELECT count(*) AS c FROM mail').get() as { c: number }).c;

describe('a cap-refused dispatch is stamped and journalled (D-6095)', () => {
  it('the run stays planned and carries the stamp, its journal names the refusal, and no mail is sent', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
    const run = f.coord.run(id);
    expect(run.ok && run.run !== null && run.run.state).toBe('planned');
    expect(f.coord.runEvents(id).map((e) => e.detail)).toEqual(['admission-refused:cap-concurrency limit=1 running=1']);
    expect(stampOf(f.coord, id)).toMatchObject({ claimedBy: 'coord-a' });
    expect(stampOf(f.coord, id)!.since).not.toBeNull();
    expect(mailCount(f.coord)).toBe(0);
  });

  it('a refusal by the pause or the mail-disabled marker is not a cap refusal and stamps nothing', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    writeFileSync(path.join(f.home, '.cc-sessions', 'coordinator-paused'), '');
    const out = await dispatchRun(f.deps, id, 'go', undefined);
    expect(!out.ok && out.kind === 'refused' && out.code === 'paused').toBe(true);
    expect(stampOf(f.coord, id)!.since).toBeNull();
  });

  it('a dispatch that proceeds clears the stamp', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    const blocker = f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
    expect(stampOf(f.coord, id)!.since).not.toBeNull();
    expect(f.coord.advance(blocker, 'working', 'test').ok).toBe(true);
    expect(f.coord.advance(blocker, 'awaiting-review', 'test').ok).toBe(true);   // the slot is free
    expect(await dispatchRun(f.deps, id, 'go', undefined)).toMatchObject({ ok: true });
    expect(stampOf(f.coord, id)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
  });
});

describe('the stamp (store)', () => {
  const open = (f: ReturnType<typeof fixture>, program: string, claimedBy: string): number => {
    const o = f.coord.openRun({ program, title: program, project: PROJECT, wave: 1, waveOf: 1, claimedBy });
    if (!('id' in o)) throw new Error('fixture openRun refused');
    return o.id;
  };

  it('the migration is nullable: three columns, no NOT NULL and no CHECK, so a rollback stays bootable', () => {
    const f = fixture();
    const cols = f.coord.db.prepare('PRAGMA table_info(runs)').all() as { name: string; notnull: number; dflt_value: unknown }[];
    for (const name of ['admissionWaitSince', 'lastRefusedAt', 'admissionWokenAt']) {
      const c = cols.find((x) => x.name === name);
      expect(c, name).toBeDefined();
      expect(c!.notnull).toBe(0);
    }
    const ddl = (f.coord.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'runs'").get() as { sql: string }).sql;
    expect(ddl).not.toMatch(/admissionWaitSince[^,]*(NOT NULL|CHECK)/);
  });

  it('the stamp keeps the oldest refusal and moves the newest', () => {
    const f = fixture();
    const id = open(f, 'prog-a', 'coord-a');
    f.coord.stampAdmissionWait(id, 1_000);
    f.coord.stampAdmissionWait(id, 5_000);
    expect(stampOf(f.coord, id)).toEqual({ since: 1_000, lastRefusedAt: 5_000, wokenAt: null, claimedBy: 'coord-a', program: 'prog-a' });
  });

  it('a woken waiter is skipped until it is refused again', () => {
    const f = fixture();
    const id = open(f, 'prog-a', 'coord-a');
    f.coord.stampAdmissionWait(id, 1_000);
    expect(f.coord.admissionWaiters().map((w) => w.runId)).toEqual([id]);
    f.coord.markAdmissionWoken(id, 2_000);
    expect(f.coord.admissionWaiters()).toEqual([]);
    f.coord.stampAdmissionWait(id, 3_000);
    expect(f.coord.admissionWaiters()).toEqual([{ runId: id, program: 'prog-a', claimedBy: 'coord-a', since: 1_000, lastRefusedAt: 3_000, sendBack: false }]);
  });

  it('a run that left planned (dispatched, abandoned) is not a waiter and its stamp is cleared', () => {
    const f = fixture();
    const a = open(f, 'prog-a', 'coord-a');
    const b = open(f, 'prog-b', 'coord-b');
    f.coord.stampAdmissionWait(a, 1_000);
    f.coord.stampAdmissionWait(b, 1_000);
    f.coord.markDispatched(a, 'a-worker', 'a-ws', 'ws/a', false);
    expect(f.coord.advance(a, 'dispatched', 'test').ok).toBe(true);
    expect(f.coord.advance(b, 'failed', 'operator', 'abandon:x').ok).toBe(true);
    expect(f.coord.admissionWaiters()).toEqual([]);
    expect(stampOf(f.coord, a)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
    expect(stampOf(f.coord, b)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
  });

  it('a send-back waiter is a run parked in an idle state; the cleared stamp of a send-back that proceeds is gone', () => {
    const f = fixture();
    const id = f.holder('prog-a');
    expect(f.coord.advance(id, 'working', 'test').ok).toBe(true);
    expect(f.coord.advance(id, 'awaiting-review', 'test').ok).toBe(true);
    f.coord.stampAdmissionWait(id, 1_000);
    expect(f.coord.admissionWaiters()).toMatchObject([{ runId: id, sendBack: true }]);
    expect(f.coord.advance(id, 'working', 'test').ok).toBe(true);
    expect(f.coord.admissionWaiters()).toEqual([]);
  });
});

describe('the wake\'s one write: queueAdmissionWake (the stall-notice pattern)', () => {
  const waiter = (f: ReturnType<typeof fixture>, at: number): AdmissionWaiter => {
    const o = f.coord.openRun({ program: 'prog-a', title: 'prog-a', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'coord-a' });
    if (!('id' in o)) throw new Error('fixture openRun refused');
    f.coord.stampAdmissionWait(o.id, at);
    const w = f.coord.admissionWaiters().find((x) => x.runId === o.id);
    if (w === undefined) throw new Error('fixture: no waiter');
    return w;
  };
  const mails = (f: ReturnType<typeof fixture>): number => mailCount(f.coord);

  it('records the observation row, sends one mail naming the run and marks the run woken, in one transaction', () => {
    const f = fixture();
    const w = waiter(f, 1_000);
    const q = queueAdmissionWake(f.coord, w, 2_000);
    expect(q.queued).toBe(true);
    expect(mails(f)).toBe(1);
    expect(stampOf(f.coord, w.runId)!.wokenAt).toBe(2_000);
    expect(f.coord.runEvents(w.runId).map((e) => e.detail)).toContain(admissionWakeDetail(w));
    const m = f.coord.db.prepare("SELECT runId, toId, fromId FROM mail WHERE subject LIKE 'capacity:%'").get() as { runId: number; toId: string; fromId: string };
    expect(m).toEqual({ runId: w.runId, toId: 'coord-a', fromId: 'operator' });
  });

  it('the same refusal twice: the second write is a duplicate, sends nothing, re-marks the stamp and wakes no block', () => {
    const f = fixture();
    const w = waiter(f, 1_000);
    queueAdmissionWake(f.coord, w, 2_000);
    f.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();   // read: an outstanding-only check would send again
    f.coord.db.prepare('UPDATE runs SET admissionWokenAt = NULL WHERE id = ?').run(w.runId);
    // A capacity block recorded after the first wake: the duplicate sends no mail, so it must not wake the block (review
    // 2907 F7; D-8126 A6: a block is never woken without its own mail).
    const late = f.coord.insertCall('prog-a', 'coord-a', {
      class: 'block', runId: null, question: null, options: null, chosen: 'waiting for a slot', why: 'w', reversible: true,
      wakeOn: 'capacity' as never,
    }, 'b-late', 2_500);
    expect(queueAdmissionWake(f.coord, w, 3_000)).toEqual({ queued: false, why: 'duplicate' });
    expect(mails(f)).toBe(1);
    expect(stampOf(f.coord, w.runId)!.wokenAt).toBe(3_000);
    expect(f.coord.callById(late)!.wokenAt).toBeNull();
  });

  it('a run refused again since the read is run-gone: nothing is written, the newer refusal is woken on its own', () => {
    const f = fixture();
    const w = waiter(f, 1_000);
    f.coord.stampAdmissionWait(w.runId, 1_500);
    expect(queueAdmissionWake(f.coord, w, 2_000)).toEqual({ queued: false, why: 'run-gone' });
    expect(mails(f)).toBe(0);
    expect(stampOf(f.coord, w.runId)!.wokenAt).toBeNull();
    expect(f.coord.runEvents(w.runId).map((e) => e.detail)).not.toContain(admissionWakeDetail(w));
  });

  it('a run that left its idle state since the read is run-gone: no mail, no row', () => {
    const f = fixture();
    const w = waiter(f, 1_000);
    f.coord.markDispatched(w.runId, 'w-1', 'ws-1', 'ws/ws-1', false, 1_200);
    expect(f.coord.advance(w.runId, 'dispatched', 'test').ok).toBe(true);
    expect(queueAdmissionWake(f.coord, w, 2_000)).toEqual({ queued: false, why: 'run-gone' });
    expect(mails(f)).toBe(0);
  });
});

describe('capWaitOf: a refusal by the concurrency cap is a wait (D-6095)', () => {
  it('answers the cap refusal\'s numbers, and null for every other refusal', () => {
    expect(capWaitOf({ reject: { code: 'cap-concurrency', limit: 2, running: 3 } })).toEqual({ limit: 2, running: 3 });
    expect(capWaitOf({ reject: { code: 'review-in-flight', reviewRunId: 4 } })).toBeNull();
    expect(capWaitOf({ reject: { code: 'unknown-run' } })).toBeNull();
    expect(capWaitOf({ error: 'bad-request' })).toBeNull();
  });
});

describe('waitOnSendBackRefusal: the send-back door\'s half (held routes hunk\'s one call)', () => {
  it('a send-back the cap refused is stamped and journalled; a pass or any other refusal writes nothing', () => {
    const f = fixture();
    const o = f.coord.openRun({ program: 'prog-a', title: 'prog-a', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'coord-a' });
    if (!('id' in o)) throw new Error('fixture openRun refused');
    waitOnSendBackRefusal(f.coord, o.id, { ok: true });
    waitOnSendBackRefusal(f.coord, o.id, { ok: false, refusal: { reject: { code: 'unknown-run' } } });
    expect(stampOf(f.coord, o.id)!.since).toBeNull();
    expect(f.coord.runEvents(o.id)).toEqual([]);
    waitOnSendBackRefusal(f.coord, o.id, { ok: false, refusal: { reject: { code: 'cap-concurrency', limit: 2, running: 2 } } });
    expect(stampOf(f.coord, o.id)!.since).not.toBeNull();
    expect(f.coord.runEvents(o.id).map((e) => e.detail)).toEqual(['admission-refused:cap-concurrency limit=2 running=2']);
  });
});

describe('the advance route: a send-back the cap refused waits (the consented routes.ts packet)', () => {
  it('a send-back on a full fleet is refused as before, and the run is stamped and journalled; it keeps its state', async () => {
    const f = fixture();
    const TOKEN = 'f'.repeat(64);
    const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
    const app = await buildServer({ ...testDeps(f.home, run), mailToken: TOKEN, coord: f.coord });
    try {
      f.coord.setCaps({ maxConcurrentWorkers: 1 });
      const o = f.coord.openRun({ program: 'prog-a', title: 'prog-a', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'coord-a' });
      if (!('id' in o)) throw new Error('fixture openRun refused');
      f.coord.markDispatched(o.id, 'demo-a', 'ws-a', 'ws/ws-a', false, 1_000);
      for (const to of ['dispatched', 'working', 'awaiting-review'] as const) expect(f.coord.advance(o.id, to, 'test').ok).toBe(true);
      f.holder('other');   // takes the one slot
      const res = await app.inject({ method: 'POST', url: `/api/runs/${o.id}/advance`, headers: { 'x-ccrc-mail-token': TOKEN },
        payload: { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, reject: { code: 'cap-concurrency', limit: 1, running: 1 } });
      const run2 = f.coord.run(o.id);
      expect(run2.ok && run2.run !== null && run2.run.state).toBe('awaiting-review');
      expect(stampOf(f.coord, o.id)!.since).not.toBeNull();
      expect(f.coord.runEvents(o.id).map((e) => e.detail)).toContain('admission-refused:cap-concurrency limit=1 running=1');
      expect(f.coord.admissionWaiters().map((w) => ({ runId: w.runId, sendBack: w.sendBack }))).toEqual([{ runId: o.id, sendBack: true }]);
    } finally {
      await app.close();
    }
  });
});

describe('the decider: admissionWakeChoice', () => {
  const w = (runId: number, program: string, since: number, over: Partial<AdmissionWaiter> = {}): AdmissionWaiter =>
    ({ runId, program, claimedBy: `coord-${program}`, since, lastRefusedAt: since, sendBack: false, ...over });
  const ids = (c: { chosen: readonly AdmissionWaiter[] }): number[] => c.chosen.map((x) => x.runId);
  const NOW = 10 * WAKE_WINDOW_MS;

  it('no room wakes nobody, and the list it hands back is the window pruned', () => {
    const c = admissionWakeChoice([w(1, 'a', 1)], 0, [NOW - 1, NOW - WAKE_WINDOW_MS - 1], NOW);
    expect(c.chosen).toEqual([]);
    expect(c.recent).toEqual([NOW - 1]);
  });

  it('the oldest refusal in a programme goes first', () => {
    const c = admissionWakeChoice([w(2, 'a', 20), w(1, 'a', 10), w(3, 'a', 30)], 1, [], NOW);
    expect(ids(c)).toEqual([1]);
  });

  it('two programmes waiting are served alternately, not one programme twice', () => {
    const c = admissionWakeChoice([w(1, 'a', 10), w(2, 'a', 11), w(3, 'b', 12)], 2, [], NOW);
    expect(ids(c).sort()).toEqual([1, 3]);
  });

  it('the programme served longest ago goes first', () => {
    const served = new Map([['a', NOW - 5], ['b', NOW - 50]]);
    const c = admissionWakeChoice([w(1, 'a', 10), w(2, 'b', 99)], 1, [], NOW, served);
    expect(ids(c)).toEqual([2]);
    expect(c.served.get('b')).toBe(NOW);
    expect(c.served.get('a')).toBe(NOW - 5);
  });

  it('a third wake inside one window waits for the next', () => {
    const c = admissionWakeChoice([w(1, 'a', 1), w(2, 'b', 2), w(3, 'c', 3)], 3, [], NOW);
    expect(ids(c)).toHaveLength(WAKE_BURST);
    expect(c.recent).toHaveLength(WAKE_BURST);
    const later = admissionWakeChoice([w(3, 'c', 3)], 3, c.recent, NOW + 1);
    expect(later.chosen).toEqual([]);
    expect(admissionWakeChoice([w(3, 'c', 3)], 3, c.recent, NOW + WAKE_WINDOW_MS).chosen).toHaveLength(1);
  });

  it('a programme with several waiters is served one a pass', () => {
    const c = admissionWakeChoice([w(1, 'a', 10), w(2, 'a', 11), w(3, 'a', 12)], 5, [], NOW);
    expect(ids(c)).toEqual([1]);
  });

  it('it never wakes more than the room', () => {
    expect(ids(admissionWakeChoice([w(1, 'a', 1), w(2, 'b', 2)], 1, [], NOW))).toHaveLength(1);
  });

  it('a woken waiter does not block the next in its programme (the store lists eligible waiters only)', () => {
    const c = admissionWakeChoice([w(2, 'a', 20)], 1, [], NOW);
    expect(ids(c)).toEqual([2]);
  });
});

describe('blockWokenWith: which blocks a wake wakes (capacity follow-ups, T4 F3)', () => {
  const w = { runId: 7, program: 'prog-a' };
  it('a capacity block naming the woken run, yes; another run of the same coordinator, no; another wake word, no', () => {
    expect(blockWokenWith({ wakeOn: 'capacity', runId: 7, program: 'prog-a' }, w)).toBe(true);
    expect(blockWokenWith({ wakeOn: 'capacity', runId: 8, program: 'prog-a' }, w)).toBe(false);
    expect(blockWokenWith({ wakeOn: 'disk', runId: 7, program: 'prog-a' }, w)).toBe(false);
  });
  it('a capacity block naming no run is woken by a wake in its programme, and by no other', () => {
    expect(blockWokenWith({ wakeOn: 'capacity', runId: null, program: 'prog-a' }, w)).toBe(true);
    expect(blockWokenWith({ wakeOn: 'capacity', runId: null, program: 'prog-b' }, w)).toBe(false);
  });
});

describe('the room: capsRoomOf reads the cap reading\'s own count (Part 3 ships in shadow)', () => {
  // Three counted runs under a limit of three; two of their workers read waiting or gone.
  const rows = [{ runId: 1, sessionId: 'w-1' }, { runId: 2, sessionId: 'w-2' }, { runId: 3, sessionId: 'w-3' }];
  const readings = new Map([[1, 'waiting'], [2, 'gone'], [3, 'busy']] as const);
  it('in shadow a waiting worker still holds its slot, even when the reading measured it: no room', () => {
    const shadow = capsReadingOf({ maxConcurrentWorkers: 3 }, rows, readings, false);
    expect(shadow.usage.waiting).toBe(2);
    expect(capsRoomOf(shadow, WAKE_BURST)).toBe(0);
  });
  it('armed, the waiting and gone workers free their slots: room for two, while the freed-slot window admits two', () => {
    expect(capsRoomOf(capsReadingOf({ maxConcurrentWorkers: 3 }, rows, readings, true), 2)).toBe(2);
  });
  it('capacity follow-ups (T4 F5): armed, a freed slot is room only up to what the freed-slot window admits now', () => {
    const armed = capsReadingOf({ maxConcurrentWorkers: 3 }, rows, readings, true);
    expect(capsRoomOf(armed, 1)).toBe(1);
    expect(capsRoomOf(armed, 0)).toBe(0);
    // An ordinary free slot never waits on the window: limit 5 over three counted runs, two of them waiting.
    const roomy = capsReadingOf({ maxConcurrentWorkers: 5 }, rows, readings, true);
    expect(capsRoomOf(roomy, 0)).toBe(2);
    expect(capsRoomOf(roomy, 1)).toBe(3);
  });
  it('capacity follow-ups (T4 F5): wakeRoom reads the window without recording into it', () => {
    const NOW = 10 * WAKE_WINDOW_MS;
    const list = [NOW - 1];
    expect(wakeRoom([], NOW)).toBe(WAKE_BURST);
    expect(wakeRoom(list, NOW)).toBe(WAKE_BURST - 1);
    expect(wakeRoom([NOW - 1, NOW - 2], NOW)).toBe(0);
    expect(wakeRoom([NOW - WAKE_WINDOW_MS], NOW)).toBe(WAKE_BURST);
    expect(list).toEqual([NOW - 1]);
  });
  it('with no readings it is today\'s count, and never below zero', () => {
    expect(capsRoomOf(capsReadingOf({ maxConcurrentWorkers: 5 }, rows, null, false), 0)).toBe(2);
    expect(capsRoomOf(capsReadingOf({ maxConcurrentWorkers: 2 }, rows, null, true), WAKE_BURST)).toBe(0);
  });
});

describe('the lane row', () => {
  it('admissionWake is one row: the wake budget\'s window, one pass at a time, the monotonic clock', () => {
    const row = laneRow('admissionWake');
    expect(row.cadenceMs).toBe(WAKE_WINDOW_MS);   // the L0 table declares its own figure; this holds the two equal
    expect(row.flight).toBe('skip');
    expect(row.clock).toBe('mono');
  });
});

describe('the lane: refused coordinators are woken when the cap has room (D-6095)', () => {
  const T0 = Date.parse('2026-11-10T10:00:00Z');
  const MIN = 60_000;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  /** `from`: a restart, a new watcher (an empty in-memory window) over the same store and home. */
  async function lane(opts: { serial?: boolean; from?: ReturnType<typeof fixture> } = {}) {
    const f = opts.from ?? fixture();
    const runner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const notifyLog = new NotifyLog(path.join(f.home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const deps = { ...testDeps(f.home, runner), coord: f.coord, notifyLog };
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000, path.join(f.home, 'state-cache.json')));
    // The coordination serialiser `buildServer` hands over (`useStopDoneSerialiser`), a pass-through here that counts.
    let serialRuns = 0;
    if (opts.serial !== false) w.useStopDoneSerialiser({ serial: async (fn) => { serialRuns++; return fn(); } });
    await w.tick();   // primes; the registry directory exists and lists
    const sweep = async (at: number, names: readonly string[] | null = []): Promise<void> => {
      vi.setSystemTime(at);
      await w.sweepAdmissionWake(names);
    };
    f.coord.setCaps({ maxConcurrentWorkers: 5 });
    const wakeMail = () => f.coord.db.prepare(
      "SELECT m.id, m.toId, m.subject, m.fromId, d.state FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE m.subject LIKE 'capacity:%' ORDER BY m.id",
    ).all() as unknown as { id: number; toId: string; subject: string; fromId: string; state: string }[];
    /** A refused planned run: stamped at `at`. */
    let wave = 0;
    const refused = (program: string, claimedBy: string, at: number): number => {
      const o = f.coord.openRun({ program, title: program, project: PROJECT, wave: ++wave, waveOf: 9, claimedBy });
      if (!('id' in o)) throw new Error('fixture openRun refused');
      f.coord.stampAdmissionWait(o.id, at);
      return o.id;
    };
    /** A dispatched run whose worker cannot be read (no session on the row), so it holds its slot whatever the readings. */
    const busyHolder = (program: string): number => {
      const id = f.holder(program);
      f.coord.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(id);
      return id;
    };
    return { ...f, w, sweep, wakeMail, refused, busyHolder, serialRuns: () => serialRuns };
  }

  it('a refusal followed by a freed slot sends one mail, to the claimant, from the operator role, and marks the run woken', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 2 });
    const id = l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toMatchObject([{ toId: 'coord-a', fromId: 'operator', subject: `capacity: room for run ${id}` }]);
    expect(stampOf(l.coord, id)!.wokenAt).toBe(T0);
    expect(l.coord.runEvents(id).map((e) => e.detail)).toContainEqual(expect.stringMatching(/^admission-woken:/));
    const stamp = stampOf(l.coord, id)!;
    expect(l.coord.hasNotice('coord', 'coord-a', `admission-wake:${id}:${stamp.lastRefusedAt}`)).toBe(true);
  });

  it('a send-back waiter is mailed with its own subject', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 2 });
    const id = l.holder('prog-a');
    expect(l.coord.advance(id, 'working', 'test').ok).toBe(true);
    expect(l.coord.advance(id, 'awaiting-review', 'test').ok).toBe(true);
    l.coord.stampAdmissionWait(id, T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail().map((m) => m.subject)).toEqual([`capacity: room to send back run ${id}`]);
  });

  it('the same refusal is mailed once, however many passes run', async () => {
    const l = await lane();
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    await l.sweep(T0 + MIN);
    await l.sweep(T0 + 2 * MIN);
    expect(l.wakeMail()).toHaveLength(1);
  });

  it('a woken coordinator refused again is woken again at the next free slot', async () => {
    const l = await lane();
    const id = l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    l.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();   // the first mail was read
    l.coord.stampAdmissionWait(id, T0 + 10);
    await l.sweep(T0 + MIN);
    expect(l.wakeMail()).toHaveLength(2);
  });

  it('no room (the cap is full of runs whose worker holds its slot) wakes nobody', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    l.busyHolder('other');
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toEqual([]);
  });

  it('armed (cap-counts-working live): a slot a gone worker frees (the worker readings, not the raw count) wakes the refused coordinator', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    l.coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'live', 1);
    l.holder('other');   // dispatched, its worker has no registry row: gone, so it holds no slot
    expect(l.coord.capsUsage().running).toBe(1);   // the raw count alone says the cap is full
    const id = l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail().map((m) => m.subject)).toEqual([`capacity: room for run ${id}`]);
  });

  it('capacity follow-ups (T4 F5), armed: a freed slot the freed-slot window would refuse is no room, so a waiter refused there is woken once, not every pass', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    l.coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'live', 1);
    l.holder('other');   // gone: armed, its slot is a freed slot, which only the freed-slot window hands out
    const id = l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toHaveLength(1);
    // Two other starts take the window's two admits; the coordinator's dispatch then meets the window and is refused again.
    vi.setSystemTime(T0 + 1_000);
    expect(l.w.admitFreedSlot()).toBe(true);
    expect(l.w.admitFreedSlot()).toBe(true);
    expect(l.w.admitFreedSlot()).toBe(false);
    l.coord.stampAdmissionWait(id, T0 + 2_000);
    // The lane's next pass (its cadence is the window), with both admits still inside the window: the readings still free
    // the slot, but the window would refuse it, so nobody is woken.
    await l.sweep(T0 + MIN);
    expect(l.wakeMail()).toHaveLength(1);
    // CONTROL: the pass after, the window admits again, and the refused coordinator is woken for its new refusal.
    await l.sweep(T0 + 2 * MIN);
    expect(l.wakeMail()).toHaveLength(2);
  });

  it('shadow (cap-counts-working not armed): a gone worker still holds its slot, so nobody is woken', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    l.holder('other');   // gone, but the shadow count keeps it
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toEqual([]);
    l.coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'shadow', 2);   // an explicit shadow choice reads the same
    await l.sweep(T0 + MIN);
    expect(l.wakeMail()).toEqual([]);
  });

  it('a wake survives a restart without re-sending: the observation row is the once-only key, not the stamp or the delivery', async () => {
    const l = await lane();
    const id = l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toHaveLength(1);
    // The mail was read, and the woken stamp is lost (as if the pass died between its rows): the row still holds.
    l.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked'").run();
    l.coord.db.prepare('UPDATE runs SET admissionWokenAt = NULL WHERE id = ?').run(id);
    const again = await lane({ from: l });
    await again.sweep(T0 + MIN);
    expect(again.wakeMail()).toHaveLength(1);
    expect(stampOf(again.coord, id)!.wokenAt).toBe(T0 + MIN);   // the duplicate re-marks the stamp
  });

  it('two programmes waiting are served alternately, and a third wake inside one window waits for the next', async () => {
    const l = await lane();
    l.refused('prog-a', 'coord-a', T0 - 5 * MIN);
    l.refused('prog-a', 'coord-a', T0 - 4 * MIN);
    l.refused('prog-b', 'coord-b', T0 - 3 * MIN);
    await l.sweep(T0);
    expect(l.wakeMail().map((m) => m.toId).sort()).toEqual(['coord-a', 'coord-b']);   // one per programme, not a twice
    await l.sweep(T0 + 1000);
    expect(l.wakeMail()).toHaveLength(WAKE_BURST);   // the third waits: the window is full
    await l.sweep(T0 + WAKE_WINDOW_MS);
    expect(l.wakeMail()).toHaveLength(3);
  });

  it('the oldest refusal in a programme goes first, and a woken waiter does not block the next', async () => {
    const l = await lane();
    const old = l.refused('prog-a', 'coord-a', T0 - 5 * MIN);
    const newer = l.refused('prog-a', 'coord-a', T0 - 2 * MIN);
    await l.sweep(T0);
    expect(l.wakeMail().map((m) => m.subject)).toEqual([`capacity: room for run ${old}`]);
    await l.sweep(T0 + WAKE_WINDOW_MS);
    expect(l.wakeMail().map((m) => m.subject)).toEqual([`capacity: room for run ${old}`, `capacity: room for run ${newer}`]);
  });

  it('a run dispatched or abandoned since its refusal is not mailed', async () => {
    const l = await lane();
    const a = l.refused('prog-a', 'coord-a', T0 - MIN);
    const b = l.refused('prog-b', 'coord-b', T0 - MIN);
    expect(l.coord.advance(a, 'failed', 'operator', 'abandon:x').ok).toBe(true);
    l.coord.markDispatched(b, 'b-worker', 'b-ws', 'ws/b', false);
    expect(l.coord.advance(b, 'dispatched', 'test').ok).toBe(true);
    await l.sweep(T0);
    expect(l.wakeMail()).toEqual([]);
  });

  it('the pause, mail-disabled or an unlistable registry sends nothing', async () => {
    const l = await lane();
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0, ['coordinator-paused']);
    await l.sweep(T0 + MIN, ['mail-disabled']);
    await l.sweep(T0 + 2 * MIN, null);
    expect(l.wakeMail()).toEqual([]);
    await l.sweep(T0 + 3 * MIN, []);
    expect(l.wakeMail()).toHaveLength(1);
  });

  it('the lane acts inside the coordination serialiser, once a pass, and wakes nobody until it is handed one', async () => {
    const none = await lane({ serial: false });
    none.refused('prog-a', 'coord-a', T0 - MIN);
    await none.sweep(T0);
    expect(none.wakeMail()).toEqual([]);
    const l = await lane();
    l.refused('prog-a', 'coord-a', T0 - MIN);
    l.refused('prog-b', 'coord-b', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toHaveLength(2);
    expect(l.serialRuns()).toBe(1);
  });

  it('the lane never records into the shared wake list or asks the watcher for a wake', async () => {
    const l = await lane();
    const admit = vi.spyOn(l.w, 'admitWake');
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toHaveLength(1);
    expect(admit).not.toHaveBeenCalled();
    expect((l.w as unknown as { wakeRecent: number[] }).wakeRecent).toEqual([]);
  });

  it('an admission wake mail is an ordinary queued delivery, which the mail lane (and its wake budget) delivers to a hibernated coordinator', async () => {
    const l = await lane();
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toMatchObject([{ toId: 'coord-a', state: 'queued' }]);
  });

  it('A8-3: the wake also marks the coordinator\'s live capacity block woken, once, and only a capacity block', async () => {
    const l = await lane();
    const park = (wakeOn: string): number => l.coord.insertCall('prog-a', 'coord-a', {
      class: 'block', runId: null, question: null, options: null, chosen: 'waiting for a slot', why: 'w', reversible: true,
      wakeOn: wakeOn as never,
    }, 'b1', T0 - MIN);
    const cap = park('capacity');
    const disk = park('disk');
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toHaveLength(1);
    expect(l.coord.callById(cap)!.wokenAt).toBe(T0);
    expect(l.coord.callById(disk)!.wokenAt).toBeNull();
    expect(l.coord.liveBlocksOf('coord-a', T0 + 1).map((r) => r.id)).toEqual([disk]);
    await l.sweep(T0 + MIN);
    expect(l.wakeMail()).toHaveLength(1);
    expect(l.coord.callById(cap)!.wokenAt).toBe(T0);
  });

  it('capacity follow-ups (T4 F3): a coordinator refused in two runs has only the woken run\'s capacity block woken', async () => {
    const l = await lane();
    // One slot free: two holders under a cap of three.
    l.coord.setCaps({ maxConcurrentWorkers: 3 });
    l.busyHolder('prog-h1');
    l.busyHolder('prog-h2');
    const first = l.refused('prog-a', 'coord-a', T0 - 2 * MIN);
    const second = l.refused('prog-a', 'coord-a', T0 - MIN);
    const park = (runId: number | null): number => l.coord.insertCall('prog-a', 'coord-a', {
      class: 'block', runId, question: null, options: null, chosen: `waiting for a slot for ${runId}`, why: 'w', reversible: true,
      wakeOn: 'capacity' as never,
    }, 'b1', T0 - MIN);
    const forFirst = park(first);
    const forSecond = park(second);
    await l.sweep(T0);
    expect(l.wakeMail().map((m) => m.subject)).toEqual([`capacity: room for run ${first}`]);
    expect(l.coord.callById(forFirst)!.wokenAt).toBe(T0);
    expect(l.coord.callById(forSecond)!.wokenAt).toBeNull();
  });

  /** The block lane's own wake mail to `coord-a` (`blockWakeMail`), every delivery state. */
  const blockMail = (l: { coord: CoordStore }): { subject: string; toId: string; fromId: string }[] => l.coord.db.prepare(
    "SELECT subject, toId, fromId FROM mail WHERE subject LIKE 'wake: call %' ORDER BY id",
  ).all() as never;
  const parkCapacity = (l: { coord: CoordStore }, runId: number | null, at: number, program = 'prog-a'): number => l.coord.insertCall(program, 'coord-a', {
    class: 'block', runId, question: null, options: null, chosen: 'waiting for a slot', why: 'w', reversible: true, wakeOn: 'capacity' as never,
  }, 'b1', at);

  it('capacity follow-ups (T4 F3): a capacity block recorded after its run\'s wake is woken, with its mail, at the next pass with room — not left live for 24 hours', async () => {
    const l = await lane();
    const id = l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toHaveLength(1);
    // After the wake, the coordinator parks a thread on capacity for that run: no eligible waiter will ever wake it.
    const late = parkCapacity(l, id, T0 + 10);
    await l.sweep(T0 + MIN);
    expect(l.coord.callById(late)!.wokenAt).toBe(T0 + MIN);
    expect(blockMail(l)).toEqual([{ subject: `wake: call ${late} (capacity)`, toId: 'coord-a', fromId: 'operator' }]);
    // Once: the next pass sends nothing more.
    await l.sweep(T0 + 2 * MIN);
    expect(blockMail(l)).toHaveLength(1);
    expect(l.wakeMail()).toHaveLength(1);
  });

  it('capacity follow-ups (T4 F3): a run-less capacity block of a coordinator with no waiter is woken when the cap has room', async () => {
    const l = await lane();
    const parked = parkCapacity(l, null, T0 - MIN);
    await l.sweep(T0);
    expect(l.coord.callById(parked)!.wokenAt).toBe(T0);
    expect(blockMail(l).map((m) => m.subject)).toEqual([`wake: call ${parked} (capacity)`]);
  });

  it('capacity follow-ups (T4 F3): block wakes spend the lane\'s own wake budget, oldest first', async () => {
    const l = await lane();
    const ids = ['prog-a', 'prog-b', 'prog-c'].map((p, k) => parkCapacity(l, null, T0 - (3 - k) * MIN, p));
    await l.sweep(T0);
    expect(ids.map((id) => l.coord.callById(id)!.wokenAt !== null)).toEqual([true, true, false]);
    expect(blockMail(l)).toHaveLength(WAKE_BURST);
    // One slot left under the cap: the third block is woken on the next pass, inside the room.
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    await l.sweep(T0 + MIN);
    expect(l.coord.callById(ids[2]!)!.wokenAt).toBe(T0 + MIN);
  });

  it('capacity follow-ups (T4 F3): block wakes never pass the room, oldest first', async () => {
    const room = await lane();
    room.coord.setCaps({ maxConcurrentWorkers: 1 });
    const two = ['prog-a', 'prog-b'].map((p, k) => parkCapacity(room, null, T0 - (2 - k) * MIN, p));
    await room.sweep(T0);
    expect(two.map((id) => room.coord.callById(id)!.wokenAt !== null)).toEqual([true, false]);
  });

  it('capacity follow-ups (T4 F3): no room, or a pause or mail-disabled, wakes no block; room later wakes it', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    const holder = l.busyHolder('prog-h1');
    const parked = parkCapacity(l, null, T0 - MIN);
    await l.sweep(T0);
    expect(l.coord.callById(parked)!.wokenAt).toBeNull();
    l.coord.setCaps({ maxConcurrentWorkers: 2 });
    await l.sweep(T0 + MIN, ['mail-disabled']);
    await l.sweep(T0 + 2 * MIN, ['coordinator-paused']);
    expect(l.coord.callById(parked)!.wokenAt).toBeNull();
    expect(blockMail(l)).toEqual([]);
    await l.sweep(T0 + 3 * MIN);
    expect(l.coord.callById(parked)!.wokenAt).toBe(T0 + 3 * MIN);
    expect(holder).toBeGreaterThan(0);
  });

  it('capacity follow-ups (T4 F3): a block whose run still has an eligible waiter is left to that waiter\'s wake', async () => {
    const l = await lane();
    // One slot: the older refusal of prog-b is served first, and prog-a's waiter waits; its block waits with it.
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    l.refused('prog-b', 'coord-b', T0 - 3 * MIN);
    const a = l.refused('prog-a', 'coord-a', T0 - MIN);
    const parked = parkCapacity(l, a, T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toHaveLength(1);
    expect(l.coord.callById(parked)!.wokenAt).toBeNull();
    expect(blockMail(l)).toEqual([]);
  });
});

describe('wakeAdmitMany: the lane\'s own window, one wakeAdmit at a time', () => {
  it('takes what wakeAdmit would take, and hands back the pruned list', () => {
    const NOW = 10 * WAKE_WINDOW_MS;
    const one = wakeAdmit([], NOW, 'auto');
    expect(wakeAdmitMany([], NOW, 1)).toEqual({ admitted: 1, recent: one.recent });
    expect(wakeAdmitMany([], NOW, 5).admitted).toBe(WAKE_BURST);
    expect(wakeAdmitMany([NOW - WAKE_WINDOW_MS - 1, NOW - 1], NOW, 0)).toEqual({ admitted: 0, recent: [NOW - 1] });
    const input = [NOW - 1];
    wakeAdmitMany(input, NOW, 2);
    expect(input).toEqual([NOW - 1]);
  });
});
