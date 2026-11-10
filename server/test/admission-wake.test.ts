// D-6095 (fleet-capacity W1-4; spec §3.5 "The server wakes waiting coordinators", §5.1 W1-4; D-8126, amendment A8-3): a
// coordinator whose dispatch (or send-back) the concurrency cap refused is MAILED when the cap has room again, one
// mail per refusal, round-robin by programme, no faster than the wake budget's rate and in a window of the lane's own.
//
// The characterization commit pinned, green on the base, that a refused dispatch wrote nothing and the run stayed
// `planned`; the stamp's block below flips exactly the rows that changed (the stamp and the journal line). A refusal
// still sends no mail: the wake is the lane's, when the cap has room.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchOutcome, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { admissionWakeChoice, type AdmissionWaiter } from '../src/coord/admissionWake.js';
import { WAKE_BURST, WAKE_WINDOW_MS, wakeAdmit, wakeAdmitMany } from '../src/coord/wakeBudget.js';
import { testDeps, withFakeClock } from './helpers.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { laneRow } from '../src/laneSchedule.js';
import { NotifyLog } from '../src/notifylog.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { mkTmp } from './tmpHelpers.js';

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
    paneLive: async () => false,
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
    expect(f.coord.admissionStampOf(id)).toMatchObject({ claimedBy: 'coord-a' });
    expect(f.coord.admissionStampOf(id)!.since).not.toBeNull();
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
    expect(f.coord.admissionStampOf(id)!.since).toBeNull();
  });

  it('a dispatch that proceeds clears the stamp', async () => {
    const f = fixture();
    f.coord.setCaps({ maxConcurrentWorkers: 1 });
    const blocker = f.holder('other');
    const id = f.planned('prog-a', 'coord-a');
    expect(capRefused(await dispatchRun(f.deps, id, 'go', undefined))).toBe(true);
    expect(f.coord.admissionStampOf(id)!.since).not.toBeNull();
    expect(f.coord.advance(blocker, 'working', 'test').ok).toBe(true);
    expect(f.coord.advance(blocker, 'awaiting-review', 'test').ok).toBe(true);   // the slot is free
    expect(await dispatchRun(f.deps, id, 'go', undefined)).toMatchObject({ ok: true });
    expect(f.coord.admissionStampOf(id)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
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
    expect(f.coord.admissionStampOf(id)).toEqual({ since: 1_000, lastRefusedAt: 5_000, wokenAt: null, claimedBy: 'coord-a', program: 'prog-a' });
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
    expect(f.coord.admissionStampOf(a)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
    expect(f.coord.admissionStampOf(b)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
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

  async function lane() {
    const f = fixture();
    const runner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const notifyLog = new NotifyLog(path.join(f.home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const deps = { ...testDeps(f.home, runner), coord: f.coord, notifyLog };
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000, path.join(f.home, 'state-cache.json')));
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
    return { ...f, w, sweep, wakeMail, refused };
  }

  it('a refusal followed by a freed slot sends one mail, to the claimant, from the operator role, and marks the run woken', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 2 });
    const id = l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toMatchObject([{ toId: 'coord-a', fromId: 'operator', subject: `capacity: room for run ${id}` }]);
    expect(l.coord.admissionStampOf(id)!.wokenAt).toBe(T0);
    expect(l.coord.runEvents(id).map((e) => e.detail)).toContainEqual(expect.stringMatching(/^admission-woken:/));
    const stamp = l.coord.admissionStampOf(id)!;
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

  it('no room (the cap is full of busy-or-recent runs) wakes nobody', async () => {
    const l = await lane();
    l.coord.setCaps({ maxConcurrentWorkers: 1 });
    l.holder('other');
    l.refused('prog-a', 'coord-a', T0 - MIN);
    await l.sweep(T0);
    expect(l.wakeMail()).toEqual([]);
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
