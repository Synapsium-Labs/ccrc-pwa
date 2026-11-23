// D-8920 (the operator's ruling of 2026-11-22): the run cap is derived from the machine the fleet runs
// on. This file pins THE CAP NOW where it is enforced and shown: `dispatch.ts#capNow` is the one reader, the dispatch
// door, the send-back door and the admission wake refuse and make room at that cap, and the stored number is the cap only
// as the operator's override or while the host is unmeasured. The pure decisions (`deriveCap`, `capNowOf`, `decideCaps`)
// are in `coord-caps-policy.test.ts`; the route and the view are in `coord-caps-route.test.ts`.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import {
  capNow, capsMeasured, dispatchRun, sendBackCapCheck, type DispatchRunDeps, type HostMachinePort,
} from '../src/coord/dispatch.js';
import { capsRoomOf, type WorkerFacts } from '../src/coord/dispatchDecide.js';
import { CAP_COUNTS_WORKING_LANE } from '../../shared/lane-arm.js';
import { admissionWakePass } from '../src/coord/admissionWakeLane.js';
import type { HostMachineReading } from '../../shared/pressure.js';
import { PressureLane } from '../src/pressureLane.js';
import { PRESSURE_SWEEP_MS } from '../src/pressure.js';
import { localIO, type MeasuredPressure } from '../src/io.js';
import { NotifyLog } from '../src/notifylog.js';
import { notify } from '../src/notice.js';
import { capAutomaticNotice } from '../src/coord/caps.js';
import type { Runner } from '../src/exec.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { callsIn, parsedFile, sourceOfSymbol, symbolOf } from './scan/symbols.js';

const PROJECT = 'demo';
const HOUR = 60 * 60 * 1000;
const GiB = 2 ** 30;
/** A host of 17 GiB and 16 cores derives floor((17 - 8) / 3) = 3 by memory; with 2 cores it derives 2 by the cores. */
const host = (memGiB: number, cores: number): HostMachineReading =>
  ({ kind: 'measured', machine: { memTotalBytes: memGiB * GiB, cores, sessionMemLimit: 'none' } });
const UNMEASURED: HostMachineReading = { kind: 'unmeasured', why: 'no-reading' };

let template = '';
const opened: CoordStore[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-cap-derived-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const o of opened.splice(0)) { try { o.db.close(); } catch { /* already closed */ } } });

interface Over {
  workerFacts?: DispatchRunDeps['workerFacts'];
  /** Arm the `cap-counts-working` row (D-8792). Default: shadow. */
  armed?: boolean;
}

function fixture(hostMachine?: HostMachinePort, over: Over = {}) {
  const home = mkTmp('ccrc-cap-derived-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async (_cmd, args) =>
    ({ ran: true, code: 0, stdout: args[0] === 'ensure' ? `alive: ${args[1] ?? ''}\n` : '', stderr: '' });
  const base = testDeps(home, run);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  opened.push(coord);
  /** The shadow records the doors deferred, run by `settle()` after the refusal came back. */
  const deferred: (() => Promise<void>)[] = [];
  const settle = async (): Promise<void> => { for (const work of deferred.splice(0)) await work(); };
  if (over.armed === true) coord.setLaneArm(CAP_COUNTS_WORKING_LANE, 'live', 1);
  const deps: DispatchRunDeps = {
    deferShadowRecord: (work) => { deferred.push(work); },
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    sendClear: async () => ({ ok: true }),
    ...(hostMachine === undefined ? {} : { hostMachine }),
    ...(over.workerFacts === undefined ? {} : { workerFacts: over.workerFacts, admitFreedSlot: () => true }),
    configDir: (w: string) => configDirFor(base.cfg, w),
    turnVerdict: async () => 'idle' as const,
  };
  /** `n` dispatched runs, each holding a slot. Answers their run ids. */
  const holders = (n: number): number[] => {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = coord.openRun({ program: `h${i}`, title: 'h', project: PROJECT, wave: 1, waveOf: 1, claimedBy: `c-h${i}` }) as { id: number };
      coord.markDispatched(o.id, `demo-h${i}`, `h${i}-ws`, `ws/h${i}`, false, Date.now() - HOUR);
      if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: holder did not dispatch');
      ids.push(o.id);
    }
    return ids;
  };
  const fresh = (): number =>
    (coord.openRun({ program: 'fresh', title: 'f', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c-fresh' }) as { id: number }).id;
  /** A run of `demo-parked` parked at `state` (an idle state), for the send-back door. */
  const parked = (state: 'awaiting-review' | 'merging' = 'awaiting-review'): number => {
    const reg = path.join(home, '.cc-sessions');
    const id = 'demo-parked';
    const fields: Record<string, string> = {
      wrapper: 'claude-a', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
    const o = coord.openRun({ program: 'sb', title: 't', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c-sb' }) as { id: number };
    coord.markDispatched(o.id, id, `${id}-ws`, `ws/${id}`, false, Date.now() - HOUR);
    coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, o.id);
    return o.id;
  };
  return { coord, deps, holders, fresh, parked, settle };
}

describe('characterization: with no host reading the cap is the stored number, as before the cap was derived', () => {
  it('a fresh box: the seeded 3, automatic, and the answer says the host is unmeasured', () => {
    const f = fixture();
    expect(f.coord.caps()).toEqual({ maxConcurrentWorkers: 3 });
    expect(f.coord.capMode()).toBe('automatic');
    expect(capNow(f.coord, undefined)).toEqual({ mode: 'automatic', cap: 3, derived: { kind: 'unmeasured', why: 'no-reading' } });
    expect(capNow(f.coord, () => UNMEASURED)).toEqual({ mode: 'automatic', cap: 3, derived: { kind: 'unmeasured', why: 'no-reading' } });
  });

  it('dispatch refuses at the stored number when nothing measured the host', async () => {
    const f = fixture();
    f.holders(3);
    expect(capsMeasured(f.coord, f.deps.hostMachine).overConcurrency).toEqual({ limit: 3, running: 3 });
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 3, running: 3 });
  });

  it('a port that throws is unmeasured, never a refusal of everything and never a throw', () => {
    const f = fixture();
    expect(capNow(f.coord, () => { throw new Error('lane gone'); })).toEqual({ mode: 'automatic', cap: 3, derived: { kind: 'unmeasured', why: 'no-reading' } });
  });
});

describe('automatic: the cap is derived from the measured host, whatever number is stored', () => {
  it('the derived cap is the limit a dispatch refuses at, and says so in the refusal', async () => {
    // Stored 3 (the seed), host derives 2 by its cores: the third run is refused at 2.
    const f = fixture(() => host(64, 2));
    f.holders(2);
    expect(capNow(f.coord, f.deps.hostMachine)).toMatchObject({ mode: 'automatic', cap: 2, derived: { kind: 'measured', bound: 'cores' } });
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 2, running: 2 });
  });

  it('a derived cap ABOVE the stored number admits what the stored number would refuse', async () => {
    // Stored 3, host derives 16: three runs hold slots and there is room.
    const f = fixture(() => host(64, 16));
    f.holders(3);
    expect(capsMeasured(f.coord, f.deps.hostMachine)).toMatchObject({ limit: 16, overConcurrency: null });
    expect(capsRoomOf(capsMeasured(f.coord, f.deps.hostMachine), 0)).toBe(13);
  });

  it('the send-back door refuses at the same derived cap', async () => {
    const f = fixture(() => host(64, 2));
    f.holders(2);
    expect((await sendBackCapCheck(f.coord, f.deps, f.parked(), 'working'))()).toEqual({ limit: 2, running: 2 });
    const roomy = fixture(() => host(64, 16));
    roomy.holders(2);
    expect((await sendBackCapCheck(roomy.coord, roomy.deps, roomy.parked(), 'working'))()).toBeNull();
  });

  it('the host is read at each ask: a reading that lands later moves the cap, and one that is lost falls back', () => {
    let reading: HostMachineReading = UNMEASURED;
    const f = fixture(() => reading);
    expect(capNow(f.coord, f.deps.hostMachine).cap).toBe(3);
    reading = host(17, 16);
    expect(capNow(f.coord, f.deps.hostMachine)).toMatchObject({ cap: 3, derived: { kind: 'measured', cap: 3, bound: 'memory' } });
    reading = host(64, 16);
    expect(capNow(f.coord, f.deps.hostMachine).cap).toBe(16);
    reading = UNMEASURED;
    expect(capNow(f.coord, f.deps.hostMachine)).toEqual({ mode: 'automatic', cap: 3, derived: { kind: 'unmeasured', why: 'no-reading' } });
  });
});

// The doors measure the cap more than once on one path: today's count, the armed count over the worker readings, and
// the shadow record after a refusal. Each of them is the cap now, or a refusal and its record would name two caps.
describe('every measurement on a door\'s path is at the derived cap (D-8792\'s armed count and shadow records)', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const GONE: WorkerFacts = { kind: 'gone', why: 'asleep' };
  const STOPPED: WorkerFacts = { kind: 'gone', why: 'stopped' };
  /** A worker port that cannot read: every worker is `unmeasured`, which keeps its slot. */
  const unread: NonNullable<DispatchRunDeps['workerFacts']> = async () => { throw new Error('unread'); };
  const shadowLines = (warn: { mock: { calls: unknown[][] } }): string[] =>
    warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('cap-counts-working'));

  it('armed dispatch: the count over the worker readings is against the derived cap', async () => {
    // Stored 3, derived 2, two runs whose workers keep their slots: the armed count is 2 of 2, never 2 of 3.
    const f = fixture(() => host(64, 2), { workerFacts: unread, armed: true });
    f.holders(2);
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 2, running: 2 });
  });

  it('armed send-back: the count over the worker readings is against the derived cap', async () => {
    const f = fixture(() => host(64, 2), { workerFacts: unread, armed: true });
    f.holders(2);
    expect((await sendBackCapCheck(f.coord, f.deps, f.parked('merging'), 'working'))()).toEqual({ limit: 2, running: 2 });
  });

  it('shadow dispatch: the record after the refusal names the derived cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture(() => host(64, 2), { workerFacts: async () => GONE });
    const [a, b] = f.holders(2);
    const id = f.fresh();
    expect(await dispatchRun(f.deps, id, 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 2, running: 2 });
    await f.settle();
    expect(shadowLines(warn)).toEqual([
      `ccrc-server: cap-counts-working shadow: dispatch of run ${id} refused at 2/2; armed, 2 left out would free a slot (run ${a} gone, run ${b} gone)`]);
  });

  it('shadow send-back: both records after the refusal name the derived cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A send-back arming would admit as a free resume (the worker is asleep).
    const f = fixture(() => host(64, 2), { workerFacts: async () => GONE });
    f.holders(2);
    const id = f.parked('awaiting-review');
    expect((await sendBackCapCheck(f.coord, f.deps, id, 'working'))()).toEqual({ limit: 2, running: 2 });
    await f.settle();
    expect(shadowLines(warn)).toEqual([
      `ccrc-server: cap-counts-working shadow: send-back of run ${id} refused at 2/2; armed, a send-back to a worker asleep is a resume and is not charged`]);
    // A charged send-back (the worker is stopped) that arming would admit through a freed slot.
    warn.mockClear();
    const g = fixture(() => host(64, 2), { workerFacts: async (sid) => (sid === 'demo-parked' ? STOPPED : GONE) });
    const [a, b] = g.holders(2);
    const charged = g.parked('merging');
    expect((await sendBackCapCheck(g.coord, g.deps, charged, 'working'))()).toEqual({ limit: 2, running: 2 });
    await g.settle();
    expect(shadowLines(warn)).toEqual([
      `ccrc-server: cap-counts-working shadow: send-back of run ${charged} refused at 2/2; armed, 2 left out would free a slot (run ${a} gone, run ${b} gone)`]);
  });
});

describe('override: the operator\'s number is the cap until they choose automatic again', () => {
  it('a number written is an override, below or above the derived cap', async () => {
    const f = fixture(() => host(64, 16));
    f.coord.setCaps({ maxConcurrentWorkers: 1 }, 5, 'override');
    expect(f.coord.capMode()).toBe('override');
    expect(capNow(f.coord, f.deps.hostMachine)).toMatchObject({ mode: 'override', cap: 1, derived: { kind: 'measured', cap: 16 } });
    f.holders(1);
    expect(await dispatchRun(f.deps, f.fresh(), 'go', undefined))
      .toEqual({ ok: false, kind: 'refused', code: 'cap-concurrency', limit: 1, running: 1 });
    f.coord.setCaps({ maxConcurrentWorkers: 40 }, 6, 'override');
    expect(capNow(f.coord, f.deps.hostMachine).cap).toBe(40);
  });

  it('setCaps with no mode writes an override: writing a number IS setting one', () => {
    const f = fixture(() => host(64, 16));
    f.coord.setCaps({ maxConcurrentWorkers: 5 });
    expect(f.coord.capMode()).toBe('override');
    expect(capNow(f.coord, f.deps.hostMachine).cap).toBe(5);
  });

  it('choosing automatic clears the override and keeps the stored number for an unmeasured host', () => {
    let reading: HostMachineReading = host(64, 16);
    const f = fixture(() => reading);
    f.coord.setCaps({ maxConcurrentWorkers: 5 }, 5, 'override');
    f.coord.setCaps(f.coord.caps(), 6, 'automatic');
    expect(f.coord.capMode()).toBe('automatic');
    expect(f.coord.caps()).toEqual({ maxConcurrentWorkers: 5 });
    expect(capNow(f.coord, f.deps.hostMachine).cap).toBe(16);
    reading = UNMEASURED;
    expect(capNow(f.coord, f.deps.hostMachine).cap).toBe(5);
  });
});

describe('the admission wake makes room at the cap the doors enforce', () => {
  const waiter = (f: ReturnType<typeof fixture>): number => {
    const id = f.fresh();
    f.coord.db.prepare('UPDATE runs SET admissionWaitSince = ?, lastRefusedAt = ? WHERE id = ?').run(Date.now() - 60_000, Date.now() - 60_000, id);
    return id;
  };
  const pass = (f: ReturnType<typeof fixture>, hostMachine: HostMachinePort): Promise<void> => admissionWakePass({
    coord: f.coord, names: [], serial: async (fn) => fn(), workerFacts: async () => { throw new Error('unread'); }, hostMachine,
    freedSlotRecent: () => [], memory: { recent: [], served: new Map() }, push: () => undefined, warn: () => undefined,
  });
  const woken = (f: ReturnType<typeof fixture>, id: number): boolean =>
    (f.coord.db.prepare('SELECT admissionWokenAt FROM runs WHERE id = ?').get(id) as { admissionWokenAt: number | null }).admissionWokenAt !== null;

  it('a derived cap with room wakes a waiter the stored number would leave waiting, and a full one wakes nobody', async () => {
    // Stored 3 with three holders: no room by the stored number. The host derives 16: room.
    const roomy = fixture();
    roomy.holders(3);
    const a = waiter(roomy);
    expect(roomy.coord.admissionWaiters().map((w) => w.runId), 'the fixture has a waiter').toEqual([a]);
    await pass(roomy, () => UNMEASURED);
    expect(woken(roomy, a), 'unmeasured: the stored 3 is full').toBe(false);
    await pass(roomy, () => host(64, 16));
    expect(woken(roomy, a), 'derived 16: room').toBe(true);

    // Stored 3 with two holders: room by the stored number. The host derives 2: none.
    const full = fixture();
    full.holders(2);
    const b = waiter(full);
    await pass(full, () => host(64, 2));
    expect(woken(full, b), 'derived 2: full').toBe(false);
  });
});

describe('migration 121: the upgrade moves no cap somebody set, and an untouched seed becomes automatic', () => {
  const SLOT = MIGRATIONS.findIndex((m) => m.includes('ADD COLUMN capMode')) + 1;
  /** A database at the version before the migration, its `coordinator_state` row set by `seed`, opened by this build. */
  const upgraded = (seed: string | null): CoordStore => {
    const p = path.join(mkTmp('ccrc-cap-derived-upgrade-'), 'coord.db');
    const raw = new DatabaseSync(p);
    raw.exec('BEGIN');
    for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
    raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    if (seed !== null) raw.exec(`UPDATE coordinator_state SET ${seed} WHERE id = 1`);
    raw.exec('COMMIT');
    raw.close();
    const s = new CoordStore(openCoordDb(p));
    opened.push(s);
    return s;
  };

  it('one column with a default on coordinator_state, and the one rule that keeps a number somebody set', () => {
    expect(SLOT, 'no MIGRATIONS entry adds capMode').toBeGreaterThanOrEqual(121);
    expect(MIGRATIONS[SLOT - 1]!.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim())
      .toBe("ALTER TABLE coordinator_state ADD COLUMN capMode TEXT NOT NULL DEFAULT 'automatic' CHECK (capMode IN ('automatic', 'override')); "
        + "UPDATE coordinator_state SET capMode = 'override' WHERE updatedAt > 0 OR maxConcurrentWorkers <> 3;");
  });

  it('an untouched seed (3, never written) opens automatic: nobody chose that number', () => {
    const s = upgraded(null);
    expect(s.caps()).toEqual({ maxConcurrentWorkers: 3 });
    expect(s.capsUpdatedAt()).toBeNull();
    expect(s.capMode()).toBe('automatic');
    expect(capNow(s, () => host(64, 16))).toMatchObject({ mode: 'automatic', cap: 16 });
    expect(capNow(s, () => UNMEASURED)).toMatchObject({ mode: 'automatic', cap: 3 });
  });

  // THE UPGRADE MUST NOT RAISE, OR DROP, A CAP SOMEBODY SET. Each row is a number an operator set before the upgrade;
  // each stays the cap in force, with the host measured, until they choose automatic. Red without the migration's UPDATE.
  it.each([
    ['a number lowered by hand, below the derived cap', 'maxConcurrentWorkers = 4, updatedAt = 7', 4],
    ['a number set by hand above the derived cap', 'maxConcurrentWorkers = 24, updatedAt = 7', 24],
    ['the seed\'s own 3, saved on purpose', 'maxConcurrentWorkers = 3, updatedAt = 7', 3],
    ['a number edited into the row with no stamp', 'maxConcurrentWorkers = 6', 6],
  ] as const)('%s opens as an override, and stays the cap', (_name, seed, cap) => {
    const s = upgraded(seed);
    expect(s.capMode(), 'a number somebody set is an override').toBe('override');
    expect(s.caps()).toEqual({ maxConcurrentWorkers: cap });
    expect(capNow(s, () => host(64, 16)), 'measured: still the operator\'s number, with what automatic would be')
      .toMatchObject({ mode: 'override', cap, derived: { kind: 'measured', cap: 16 } });
    expect(capNow(s, () => host(256, 64)).cap, 'a large host raises nothing').toBe(cap);
    expect(capNow(s, () => UNMEASURED).cap).toBe(cap);
  });

  it('the column takes the two words and no other', () => {
    const f = fixture();
    expect(() => f.coord.db.prepare("UPDATE coordinator_state SET capMode = 'manual' WHERE id = 1").run()).toThrow(/CHECK/);
    expect(f.coord.capMode()).toBe('automatic');
  });
});

// The automatic cap moves with no operator act (the first reading after an upgrade or a boot, a host that derives a new
// cap), so the pressure beat records it: ONE feed row, once, whatever restarts.
describe('the automatic cap\'s feed record rides the pressure beat (D-8920)', () => {
  const GiB = 2 ** 30;
  const size = (memGiB: number, cores: number): MeasuredPressure =>
    ({ ok: false, reason: 'unsupported', machine: { kind: 'measured', machine: { memTotalBytes: memGiB * GiB, cores, sessionMemLimit: 'none' } } });
  /** A store with a real ring, and a lane factory: each `lane()` is a server process of its own over the same store. */
  const rig = async () => {
    const home = mkTmp('ccrc-cap-feed-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    opened.push(coord);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const answer = { read: size(64, 16) };
    let now = 1_000_000;
    const lane = (): { beat: () => Promise<void> } => {
      const l = new PressureLane(() => ({ io: { ...localIO, pressureMeasured: async () => answer.read }, coord, notifyLog }), () => now);
      return { beat: async () => { now += PRESSURE_SWEEP_MS; await l.sweep(); } };
    };
    /** The `caps changed` bodies, sorted: two records of one millisecond have no order of their own. */
    const recorded = (): string[] => coord.feedEvents(50).filter((e) => e.title === 'caps changed').map((e) => e.body).sort();
    return { coord, lane, answer, recorded };
  };

  it('the first reading that puts a derived cap in force is recorded once, and no later beat repeats it', async () => {
    const r = await rig();
    const l = r.lane();
    await l.beat();
    expect(r.recorded()).toEqual(['workers 3 → automatic (16)']);
    await l.beat();
    await l.beat();
    expect(r.recorded()).toEqual(['workers 3 → automatic (16)']);
  });

  it('a quiet beat asks the archive nothing: the key last settled is remembered', async () => {
    const r = await rig();
    const asked = vi.spyOn(r.coord, 'hasNotice');
    const l = r.lane();
    await l.beat();
    await l.beat();
    await l.beat();
    expect(asked.mock.calls.length, 'the archive was asked on every beat').toBe(1);
    asked.mockRestore();
  });

  it('a restart repeats nothing: the archive already holds the record', async () => {
    const r = await rig();
    await r.lane().beat();
    await r.lane().beat();
    await r.lane().beat();
    expect(r.recorded()).toEqual(['workers 3 → automatic (16)']);
  });

  it('a host that derives a new cap is recorded again', async () => {
    const r = await rig();
    const l = r.lane();
    await l.beat();
    r.answer.read = size(128, 32);
    await l.beat();
    expect(r.recorded()).toEqual(['workers 3 → automatic (16)', 'workers 3 → automatic (32)']);
  });

  it('nothing is recorded for an override, an unmeasured host, or a derived cap equal to the stored number', async () => {
    const over = await rig();
    over.coord.setCaps({ maxConcurrentWorkers: 5 }, 9, 'override');
    await over.lane().beat();
    expect(over.recorded()).toEqual([]);

    const dark = await rig();
    dark.answer.read = { ok: false, reason: 'unsupported', machine: { kind: 'unmeasured', why: 'agent-older' } };
    await dark.lane().beat();
    expect(dark.recorded()).toEqual([]);

    const same = await rig();
    same.answer.read = size(17, 16);   // floor((17 - 8) / 3) = 3, the stored seed
    await same.lane().beat();
    expect(same.recorded()).toEqual([]);
  });

  it('the operator\'s own move to automatic, which the caps route records under the same key, is not recorded twice', async () => {
    const r = await rig();
    // What the route does on `{ mode: 'automatic' }` after an override of 12: the write, then its own keyed record.
    r.coord.setCaps({ maxConcurrentWorkers: 12 }, 41, 'automatic');
    const now = capNow(r.coord, () => host(64, 16));
    const mine = capAutomaticNotice(r.coord.caps(), r.coord.capsUpdatedAt(), now)!;
    expect(mine).toEqual({ body: 'workers 12 → automatic (16)', dedupeKey: 'run-cap:automatic:41:16' });
    const ring = new NotifyLog(path.join(mkTmp('ccrc-cap-feed-ring-'), 'notify.json'));
    await ring.load();
    notify({ notifyLog: ring, coord: r.coord }, { kind: 'coord', sessionId: '', runId: null, title: 'caps changed', body: 'workers 12 → automatic (16)' },
      'record-only', { dedupeKey: mine.dedupeKey });
    await r.lane().beat();
    expect(r.recorded()).toEqual(['workers 12 → automatic (16)']);
  });

  it('with no store there is nothing to record, and the beat still lands the size', async () => {
    const l = new PressureLane(() => ({ io: { ...localIO, pressureMeasured: async () => size(64, 16) } }), () => 5);
    await l.sweep();
    expect(l.machineReading().kind).toBe('measured');
  });
});

// A second reader of the stored number, or a caller that forgets the host, would enforce one cap and show another. The
// compiler holds the argument (it is required); these hold the single reader. Read through the parser's symbols and
// calls (`scan/symbols.ts`), never a literal read of a source file (ARCH-06).
describe('one reader of the cap now', () => {
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const DISPATCH = path.join(SRC, 'coord', 'dispatch.ts');
  const ROUTES = path.join(SRC, 'coord', 'routes.ts');
  const WATCH = path.join(SRC, 'watch.ts');
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  /** The files of `server/src` that call a zero-argument method `name` (`x.name()`), relative to `server/src`. */
  const callers = (name: string): string[] => sources(SRC)
    .filter((f) => parsedFile(f).calls.some((c) => c.name === name && c.callee.endsWith(`.${name}`) && c.args.length === 0))
    .map((f) => path.relative(SRC, f));
  const named = (file: string, symbol: string, name: string): number =>
    callsIn(symbolOf(file, symbol)).filter((c) => c.name === name).length;

  it('the scan sees real code', () => {
    expect(sources(SRC).length, 'the source walk found nothing').toBeGreaterThan(30);
    expect(callers('capsUsage'), 'the scanner no longer sees a store read it is known to hold').toContain(path.join('coord', 'routes.ts'));
  });

  it('dispatch.ts reads the stored number and its mode in capNow alone, and hands both to the one decision', () => {
    expect(named(DISPATCH, 'capNow', 'caps'), 'capNow reads the stored number').toBe(1);
    expect(named(DISPATCH, 'capNow', 'capMode'), 'capNow reads what the stored number is').toBe(1);
    expect(named(DISPATCH, 'capNow', 'capNowOf'), 'capNow asks the one decision').toBe(1);
    const all = parsedFile(DISPATCH).calls;
    expect(all.filter((c) => c.name === 'caps' && c.args.length === 0).length, 'a second read of the stored number in dispatch.ts').toBe(1);
    expect(all.filter((c) => c.name === 'capMode').length, 'a second read of the mode in dispatch.ts').toBe(1);
    expect(all.filter((c) => c.name === 'capNowOf').length, 'a second call of the decision in dispatch.ts').toBe(1);
  });

  it('capsMeasured takes its limit from capNow, never from the store', () => {
    expect(named(DISPATCH, 'capsMeasured', 'capNow')).toBe(1);
    expect(named(DISPATCH, 'capsMeasured', 'caps')).toBe(0);
    expect(sourceOfSymbol(DISPATCH, 'capsMeasured')).toContain('capsReadingOf(capNow(coord, hostMachine).cap,');
  });

  it('no other module of the server reads the mode or decides the cap now', () => {
    expect(callers('capMode')).toEqual([path.join('coord', 'dispatch.ts')]);
    // `caps()`: the one reader, the caps route (the stored number on the view, and the write's merge base), the pressure
    // beat's feed record (the stored number the automatic cap replaced: it words a record and decides no cap), and two
    // other facts under the same name: the admit step's thunk over a `CapsReading` already measured (`dispatchDecide.ts`)
    // and the agent client's `caps()` (ccd's capability words).
    expect(callers('caps')).toEqual([
      path.join('coord', 'dispatch.ts'), path.join('coord', 'dispatchDecide.ts'), path.join('coord', 'routes.ts'), 'pressureLane.ts',
      'refreshcaps.ts',
    ]);
    const deciders = sources(SRC).filter((f) => parsedFile(f).calls.some((c) => c.name === 'capNowOf')).map((f) => path.relative(SRC, f));
    expect(deciders).toEqual([path.join('coord', 'dispatch.ts')]);
  });

  it('the doors, the caps view and the admission wake are wired to the watcher\'s one host reading', () => {
    const reg = sourceOfSymbol(ROUTES, 'registerCoordRoutes');
    expect(reg, 'the cap ports no longer carry the watcher\'s host reading').toContain('hostMachine: () => watcher.hostMachine()');
    expect(reg, 'the caps view no longer asks the one reader over the doors\' port').toContain('capNow: capNow(store, capPorts.hostMachine)');
    expect(sourceOfSymbol(WATCH, 'FleetWatcher.sweepAdmissionWake')).toContain('hostMachine: () => this.hostMachine()');
    expect(sourceOfSymbol(WATCH, 'FleetWatcher.hostMachine')).toContain('return this.pressureLane.machineReading()');
  });
});
