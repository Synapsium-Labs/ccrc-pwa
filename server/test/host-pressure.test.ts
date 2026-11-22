// #1170: the host-pressure block. Under a thrash (memory PSI full above 50%) the agent's main thread blocks refaulting
// its own pages, its accept queue backs up, and the controller read every registry-dependent verb as unmeasurable with
// nothing saying why. Three layers:
//  - the decider (`pressure.ts`): a stalled link whose last reading showed the host stalling is `host-pressure`; a
//    stalled link with a calm last reading is still `link-down`; an agent that cannot answer the op is never a stall;
//  - the lane (`pressureLane.ts`) on a scripted io and clock: it records the reading, the unanswered ask and the ask
//    still out, and never sends a second while one is out;
//  - the route: `GET /api/fleet/health` carries `psi.memory` and `psi.io` once the lane has asked, and not before.
import { describe, expect, it } from 'vitest';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO, type MeasuredPressure } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { PressureLane } from '../src/pressureLane.js';
import {
  EMPTY_PRESSURE, PRESSURE_EVIDENCE_MS, PRESSURE_INFLIGHT_STALL_MS, PRESSURE_SWEEP_MS, machineAfter, machineReadingOf, memoryLevelOf,
  memoryReadingOf, pressureAskDue, pressureBlock, pressureLevelOf,
  type PressureState,
} from '../src/pressure.js';
import {
  readHostMachine, readHostPressure, type HostMachine, type HostMachineReading, type HostPsi, type HostUnmeasuredWhy,
} from '../../shared/pressure.js';
import { NotifyLog } from '../src/notifylog.js';
import { capNow } from '../src/coord/dispatch.js';
import { withRealHostSize } from './hostSize.js';
import { createIo } from '../src/remote/io.js';
import type { FleetClient } from '../src/remote/client.js';
import { PRESSURE_OP } from '../../shared/agent-protocol.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import path from 'node:path';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const psi = (memFull: number, ioFull = 0): HostPsi => ({
  memory: { some: { avg10: memFull, avg60: memFull }, full: { avg10: memFull, avg60: memFull } },
  io: { some: { avg10: ioFull, avg60: ioFull }, full: { avg10: ioFull, avg60: ioFull } },
});
const T = 1_800_000_000_000;
const held = (p: HostPsi, over: Partial<PressureState> = {}): PressureState => ({ ...EMPTY_PRESSURE, last: { at: T, psi: p }, ...over });

describe('the decider: a stalled link is classified by the last reading before it (#1170)', () => {
  it('a stalled link plus high PSI is host-pressure', () => {
    const s = held(psi(64), { unansweredAt: T + 15_000 });
    expect(pressureBlock(s, true, T + 20_000)).toMatchObject({ link: 'host-pressure', level: 'critical' });
  });

  it('a stalled link plus low PSI is still link-down', () => {
    const s = held(psi(1, 2), { unansweredAt: T + 15_000 });
    expect(pressureBlock(s, true, T + 20_000)).toMatchObject({ link: 'link-down', level: 'ok' });
  });

  it('a link that dropped after a thrashing reading is host-pressure; after a calm one, link-down', () => {
    expect(pressureBlock(held(psi(0, 55)), false, T + 30_000).link).toBe('host-pressure');
    expect(pressureBlock(held(psi(3)), false, T + 30_000).link).toBe('link-down');
  });

  it('an ask out past the inflight bound is a stall before its own deadline passes', () => {
    const s = held(psi(30), { inflightSince: T + 1_000 });
    expect(pressureBlock(s, true, T + 1_000 + PRESSURE_INFLIGHT_STALL_MS - 1).link).toBe('answering');
    expect(pressureBlock(s, true, T + 1_000 + PRESSURE_INFLIGHT_STALL_MS).link).toBe('host-pressure');
  });

  it('evidence older than the window explains nothing: the stall is link-down, the level unmeasured', () => {
    const s = held(psi(90), { unansweredAt: T + PRESSURE_EVIDENCE_MS + 2 });
    expect(pressureBlock(s, true, T + PRESSURE_EVIDENCE_MS + 1)).toMatchObject({ link: 'link-down', level: 'unmeasured' });
  });

  it('a link answering under pressure is answering, with the level from the reading', () => {
    expect(pressureBlock(held(psi(12)), true, T + 1)).toMatchObject({ link: 'answering', level: 'warn' });
    expect(pressureLevelOf(psi(9.99))).toBe('ok');
    expect(pressureLevelOf(psi(10))).toBe('warn');
    expect(pressureLevelOf(psi(0, 50))).toBe('critical');
  });

  it('no reading at all: unmeasured, and only a down link is down', () => {
    expect(pressureBlock(EMPTY_PRESSURE, true, T)).toEqual({ at: null, level: 'unmeasured', link: 'answering', memory: null, io: null });
    expect(pressureBlock(EMPTY_PRESSURE, false, T).link).toBe('link-down');
  });
});

describe('the lane on a scripted io and clock (#1170)', () => {
  function rig(answers: (MeasuredPressure | 'hang')[]) {
    let now = T;
    let n = 0;
    let asks = 0;
    const io = {
      ...localIO,
      pressureMeasured: (): Promise<MeasuredPressure> => {
        asks += 1;
        const a = answers[Math.min(n++, answers.length - 1)]!;
        return a === 'hang' ? new Promise(() => {}) : Promise.resolve(a);
      },
    } satisfies FleetIO;
    const lane = new PressureLane(() => ({ io }), () => now);
    return { lane, tick: (ms: number) => { now += ms; }, asks: () => asks };
  }

  it('D-8122: the lane keeps the reading\'s headroom and hands the wake gate the fresh level beside it', async () => {
    const r = rig([{ ok: true, psi: psi(12), headroomBytes: 5 * 2 ** 30 }, { ok: true, psi: psi(0) }]);
    expect(r.lane.memoryReading(), 'no reading yet: unmeasured').toEqual({ level: 'unmeasured', headroomBytes: null });
    await r.lane.sweep();
    expect(r.lane.memoryReading()).toEqual({ level: 'warn', headroomBytes: 5 * 2 ** 30 });
    r.tick(PRESSURE_SWEEP_MS);
    await r.lane.sweep();
    expect(r.lane.memoryReading(), 'an agent that sent no headroom: null, never room').toEqual({ level: 'ok', headroomBytes: null });
    r.tick(PRESSURE_EVIDENCE_MS + 1);
    expect(r.lane.memoryReading(), 'too old to say anything').toEqual({ level: 'unmeasured', headroomBytes: null });
  });

  // Review fix (D-8122): the wake gate is a memory gate and reads what the sweep reads on the box: memory `full avg10`.
  // Heavy io, or an avg60 still high after the 10-second window eased, raises the banner's level but not the gate's.
  it('D-8122: the wake gate reads memory full avg10 alone; io and avg60 move only the banner', () => {
    expect(memoryLevelOf(psi(0, 60)), 'io alone').toBe('ok');
    expect(pressureLevelOf(psi(0, 60)), 'the banner still sees io').toBe('critical');
    const eased: HostPsi = { ...psi(0), memory: { some: { avg10: 0, avg60: 30 }, full: { avg10: 2, avg60: 30 } } };
    expect(memoryLevelOf(eased), 'avg60 alone').toBe('ok');
    expect(memoryLevelOf(psi(10)), 'warn at PSI_WARN_FULL_PCT').toBe('warn');
    expect(memoryLevelOf(psi(50)), 'critical at PSI_CRITICAL_FULL_PCT').toBe('critical');
    expect(memoryReadingOf(held(psi(0, 60)), T).level).toBe('ok');
  });

  it('absent before the first ask; a reading lands; a later unanswered ask turns a high reading into host-pressure', async () => {
    const r = rig([{ ok: true, psi: psi(60) }, { ok: false, reason: 'unanswered' }]);
    expect(r.lane.block(true)).toBeNull();
    await r.lane.sweep();
    expect(r.lane.block(true)).toMatchObject({ link: 'answering', level: 'critical', at: T });
    r.tick(PRESSURE_SWEEP_MS);
    await r.lane.sweep();
    expect(r.lane.block(true)).toMatchObject({ link: 'host-pressure', level: 'critical', at: T });
  });

  it('throttled on its own clock, and never a second ask while one is out', async () => {
    const r = rig(['hang']);
    void r.lane.sweep();
    r.tick(PRESSURE_SWEEP_MS * 3);
    await r.lane.sweep();
    expect(r.asks()).toBe(1);
    expect(r.lane.block(true)?.link, 'no reading yet, but an ask out for 30 s is a stall').toBe('link-down');
  });

  it('an agent that cannot answer the op is unmeasured, never a stall', async () => {
    const r = rig([{ ok: false, reason: 'unsupported' }]);
    await r.lane.sweep();
    expect(r.lane.block(true)).toMatchObject({ link: 'answering', level: 'unmeasured' });
  });
});

// D-8920: the host's size rides the pressure beat, and the automatic run cap is derived from it. A size is
// not evidence that ages: it stands across an unanswered ask, a stale PSI reading and an answer that carries none. Why
// there is NO size is kept apart, one word per remedy, from the adapter to the caps view.
describe('the host\'s size on the pressure beat (D-8920)', () => {
  const GiB = 2 ** 30;
  const BIG: HostMachine = { memTotalBytes: 64 * GiB, cores: 16, sessionMemLimit: 'none' };
  const SMALL: HostMachine = { memTotalBytes: 16 * GiB, cores: 4, sessionMemLimit: 'none' };
  const size = (machine: HostMachine): HostMachineReading => ({ kind: 'measured', machine });
  const none = (why: HostUnmeasuredWhy): HostMachineReading => ({ kind: 'unmeasured', why });
  function rig(answers: (MeasuredPressure | 'reject')[]) {
    let now = T;
    let n = 0;
    let asks = 0;
    const io = { ...localIO, pressureMeasured: (): Promise<MeasuredPressure> => {
      asks += 1;
      const a = answers[Math.min(n++, answers.length - 1)]!;
      return a === 'reject' ? Promise.reject(new Error('link down')) : Promise.resolve(a);
    } } satisfies FleetIO;
    const lane = new PressureLane(() => ({ io }), () => now);
    const next = async (ms = PRESSURE_SWEEP_MS): Promise<void> => { now += ms; await lane.sweep(); };
    return { lane, next, asks: () => asks };
  }

  it('the decider: a measured size replaces the held one, and an answer with none keeps it', () => {
    expect(machineAfter(none('no-reading'), size(BIG))).toEqual(size(BIG));
    expect(machineAfter(size(BIG), size(SMALL))).toEqual(size(SMALL));
    for (const why of ['no-reading', 'agent-older', 'read-failed'] as const) {
      expect(machineAfter(size(BIG), none(why)), why).toEqual(size(BIG));
    }
    expect(machineAfter(size(BIG), undefined), 'an answerer that knows no size keeps the size').toEqual(size(BIG));
    expect(machineReadingOf(EMPTY_PRESSURE)).toEqual(none('no-reading'));
    expect(machineReadingOf({ ...EMPTY_PRESSURE, machine: size(BIG) })).toEqual(size(BIG));
  });

  it('the decider keeps WHY there is no size: an answered reason replaces the held one, and a link blip never erases it', () => {
    expect(machineAfter(none('no-reading'), none('agent-older'))).toEqual(none('agent-older'));
    expect(machineAfter(none('no-reading'), none('read-failed'))).toEqual(none('read-failed'));
    expect(machineAfter(none('agent-older'), none('read-failed'))).toEqual(none('read-failed'));
    expect(machineAfter(none('read-failed'), none('agent-older'))).toEqual(none('agent-older'));
    expect(machineAfter(none('agent-older'), none('no-reading')), 'a rejected ask says nothing about the agent').toEqual(none('agent-older'));
    expect(machineAfter(none('read-failed'), none('no-reading'))).toEqual(none('read-failed'));
    expect(machineAfter(none('no-reading'), undefined), 'an answerer that knows no size is an older one').toEqual(none('agent-older'));
  });

  it('unmeasured before the first answer, and after an answer from an agent that sends no size', async () => {
    const r = rig([{ ok: true, psi: psi(0), machine: none('agent-older') }]);
    expect(r.lane.machineReading()).toEqual(none('no-reading'));
    await r.next(0);
    expect(r.lane.machineReading(), 'an older agent: unmeasured with its reason, never a small machine').toEqual(none('agent-older'));
  });

  it('a size that landed stands across an unanswered ask, a sizeless answer, a failed read, an unsupported one and a stale PSI', async () => {
    const r = rig([
      { ok: true, psi: psi(0), machine: size(BIG) }, 'reject', { ok: true, psi: psi(0) },
      { ok: true, psi: psi(0), machine: none('read-failed') }, { ok: false, reason: 'unsupported', machine: none('agent-older') },
    ]);
    await r.next(0);
    expect(r.lane.machineReading()).toEqual(size(BIG));
    for (const why of ['rejected', 'no field', 'read failed', 'unsupported']) {
      await r.next();
      expect(r.lane.machineReading(), why).toEqual(size(BIG));
    }
    await r.next(PRESSURE_EVIDENCE_MS * 3);
    expect(r.lane.memoryReading().level, 'the PSI is too old to say anything').toBe('unmeasured');
    expect(r.lane.machineReading(), 'the size is not evidence that ages').toEqual(size(BIG));
  });

  it('a new size replaces the old one (a resized host)', async () => {
    const r = rig([{ ok: true, psi: psi(0), machine: size(BIG) }, { ok: true, psi: psi(0), machine: size(SMALL) }]);
    await r.next(0);
    await r.next();
    expect(r.lane.machineReading()).toEqual(size(SMALL));
  });

  it('a box with no PSI (a local server on a Mac) still has a size: it rides the unsupported answer', async () => {
    const r = rig([{ ok: false, reason: 'unsupported', machine: size(BIG) }]);
    await r.next(0);
    expect(r.lane.machineReading()).toEqual(size(BIG));
    expect(r.lane.block(true), 'and the PSI stays unmeasured, never a stall').toMatchObject({ link: 'answering', level: 'unmeasured' });
  });

  // After a restart the first ask goes out before the agent link is ready and is rejected at once. Waiting out the ten
  // seconds would enforce the stored number that long, with the link up: the lane asks again on the next tick instead.
  it('while nothing has answered about the size, the lane asks again on the next tick, not ten seconds later', async () => {
    const r = rig(['reject', { ok: false, reason: 'unsupported', machine: none('no-reading') }, { ok: true, psi: psi(0), machine: size(BIG) }, { ok: true, psi: psi(0), machine: size(BIG) }]);
    await r.next(0);
    expect(r.lane.machineReading(), 'the ask was rejected: nothing read').toEqual(none('no-reading'));
    await r.next(2_000);
    expect(r.asks(), 'a second ask two seconds later, not throttled').toBe(2);
    expect(r.lane.machineReading(), 'no ready frame yet is nothing read either').toEqual(none('no-reading'));
    await r.next(2_000);
    expect(r.asks()).toBe(3);
    expect(r.lane.machineReading()).toEqual(size(BIG));
    await r.next(2_000);
    expect(r.asks(), 'measured: back on the ten-second clock').toBe(3);
    await r.next(PRESSURE_SWEEP_MS);
    expect(r.asks()).toBe(4);
  });

  it('an ANSWERED reason waits the full interval: asking an older agent faster changes nothing', async () => {
    for (const why of ['agent-older', 'read-failed'] as const) {
      const r = rig([{ ok: false, reason: 'unsupported', machine: none(why) }]);
      await r.next(0);
      await r.next(2_000);
      expect(r.asks(), why).toBe(1);
      await r.next(PRESSURE_SWEEP_MS);
      expect(r.asks(), why).toBe(2);
    }
  });

  it('the ask rule, as the decider states it', () => {
    const at = T + 2_000;
    expect(pressureAskDue(EMPTY_PRESSURE, 0, at), 'never asked').toBe(true);
    expect(pressureAskDue(EMPTY_PRESSURE, T, at), 'asked, and nothing answered about the size').toBe(true);
    expect(pressureAskDue({ ...EMPTY_PRESSURE, machine: size(BIG) }, T, at)).toBe(false);
    expect(pressureAskDue({ ...EMPTY_PRESSURE, machine: none('agent-older') }, T, at)).toBe(false);
    expect(pressureAskDue({ ...EMPTY_PRESSURE, machine: size(BIG) }, T, T + PRESSURE_SWEEP_MS)).toBe(true);
  });

  it('local mode measures THIS box, with or without PSI', async () => {
    const read = await withRealHostSize(() => localIO.pressureMeasured());
    if (read.machine?.kind !== 'measured') throw new Error('the local adapter measured no size');
    const m = read.machine.machine;
    expect(Number.isSafeInteger(m.memTotalBytes) && m.memTotalBytes > 0).toBe(true);
    expect(Number.isSafeInteger(m.cores) && m.cores > 0).toBe(true);
  });

  // THE TEST BOX IS NOT THE FLEET HOST (`host-size.setup.mjs`). Unless a test asks by name (`withRealHostSize`), the
  // local adapter cannot measure the box's memory here, so no rig that leaves the cap automatic derives it from the
  // runner, and no rig's feed gains the automatic cap's record. Red when the setup file leaves `vitest.config.ts`.
  it('in this suite the test box is NOT measured: the local adapter answers read-failed, and the cap stays the stored number', async () => {
    expect((await localIO.pressureMeasured()).machine).toEqual(none('read-failed'));
    const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cap-pinned-'), 'coord.db')));
    try {
      const lane = new PressureLane(() => ({ io: localIO, coord }), () => T);
      await lane.sweep();
      expect(capNow(coord, () => lane.machineReading())).toEqual({ mode: 'automatic', cap: 3, derived: none('read-failed') });
      expect(coord.feedEvents(50)).toEqual([]);
    } finally { coord.db.close(); }
  });

  it('remote mode reads the agent\'s reply through the one reader, and keeps why there is no size', async () => {
    const remote = (reply: unknown): FleetIO => createIo({
      state: { agentOps: [PRESSURE_OP] }, request: async () => reply,
    } as unknown as FleetClient);
    expect(await remote({ ...psi(3), headroomBytes: 5, machine: BIG }).pressureMeasured())
      .toEqual({ ok: true, psi: psi(3), headroomBytes: 5, machine: size(BIG) });
    // The sessions' limit arrives beside the box's memory, never folded into it.
    expect(await remote({ ...psi(3), machine: { ...BIG, sessionMemLimit: 24 * GiB } }).pressureMeasured())
      .toMatchObject({ ok: true, machine: size({ ...BIG, sessionMemLimit: 24 * GiB }) });
    // A reply with no `machine` key: an agent that predates the field.
    expect(await remote({ ...psi(3), headroomBytes: 5 }).pressureMeasured())
      .toEqual({ ok: true, psi: psi(3), headroomBytes: 5, machine: none('agent-older') });
    // `machine: null`, or figures that are no size: the agent tried, and its read failed.
    expect(await remote({ ...psi(3), machine: null }).pressureMeasured()).toMatchObject({ ok: true, machine: none('read-failed') });
    expect(await remote({ ...psi(3), machine: { memTotalBytes: 0, cores: 16, sessionMemLimit: 'none' } }).pressureMeasured())
      .toMatchObject({ ok: true, machine: none('read-failed') });
    // A reply with a size and no PSI (a kernel with no PSI): unanswered for the PSI, and the size is kept.
    expect(await remote({ machine: BIG }).pressureMeasured()).toEqual({ ok: false, reason: 'unanswered', machine: size(BIG) });
    // The agent's ops do not name the op: an older agent. No ready frame yet: nothing read. A rejected request: nothing read.
    const old = createIo({ state: { agentOps: [] }, request: async () => { throw new Error('never sent'); } } as unknown as FleetClient);
    expect(await old.pressureMeasured()).toEqual({ ok: false, reason: 'unsupported', machine: none('agent-older') });
    const early = createIo({ state: { agentOps: undefined }, request: async () => { throw new Error('never sent'); } } as unknown as FleetClient);
    expect(await early.pressureMeasured()).toEqual({ ok: false, reason: 'unsupported', machine: none('no-reading') });
    const down = createIo({ state: { agentOps: [PRESSURE_OP] }, request: async () => { throw new Error('disconnected'); } } as unknown as FleetClient);
    expect(await down.pressureMeasured()).toEqual({ ok: false, reason: 'unanswered', machine: none('no-reading') });
  });

  it('the wire\'s one reader: the sessions\' limit is a number, none, or unreadable, and unknown is never "no limit"', () => {
    const read = (machine: unknown): unknown => readHostMachine({ machine });
    expect(read({ memTotalBytes: 5, cores: 2, sessionMemLimit: 'none' })).toEqual(size({ memTotalBytes: 5, cores: 2, sessionMemLimit: 'none' }));
    expect(read({ memTotalBytes: 5, cores: 2, sessionMemLimit: 3 })).toEqual(size({ memTotalBytes: 5, cores: 2, sessionMemLimit: 3 }));
    for (const limit of [undefined, null, 'unreadable', 'max', 0, -1, 1.5, '3', Number.NaN]) {
      expect(read({ memTotalBytes: 5, cores: 2, sessionMemLimit: limit }), String(limit))
        .toEqual(size({ memTotalBytes: 5, cores: 2, sessionMemLimit: 'unreadable' }));
    }
    expect(readHostMachine({}), 'no key: an older agent').toEqual(none('agent-older'));
    expect(readHostMachine({ machine: undefined })).toEqual(none('agent-older'));
    for (const machine of [null, 7, 'x', [], {}, { memTotalBytes: 5 }, { cores: 2 }, { memTotalBytes: 0, cores: 2 }, { memTotalBytes: 5, cores: 0 },
      { memTotalBytes: -5, cores: 2 }, { memTotalBytes: 5.5, cores: 2 }, { memTotalBytes: '5', cores: 2 }, { memTotalBytes: 5, cores: Number.POSITIVE_INFINITY }]) {
      expect(read(machine), JSON.stringify(machine)).toEqual(none('read-failed'));
    }
    expect(readHostMachine(null)).toEqual(none('read-failed'));
  });

  it('end to end: the watcher\'s reading is the caps view\'s, the cap follows it, and the move is recorded once', async () => {
    const home = mkTmp('ccrc-cap-host-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    const deadRunner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const io = { ...localIO, pressureMeasured: async (): Promise<MeasuredPressure> => ({ ok: false, reason: 'unsupported', machine: size(BIG) }) };
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const deps = {
      cfg, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner), io, queue: new KeyedQueue(), coord, notifyLog,
      fleetState: { connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null },
    } as never as Deps;
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    const app = await buildServer(deps, bus, watcher);
    const capNow = async (): Promise<unknown> => ((await app.inject({ method: 'GET', url: '/api/coord/caps' })).json() as { capNow: unknown }).capNow;
    const recorded = (): string[] => coord.feedEvents(50).filter((e) => e.title === 'caps changed').map((e) => e.body);
    try {
      expect(watcher.hostMachine()).toEqual(none('no-reading'));
      expect(await capNow(), 'before the first beat: the stored number').toEqual({ mode: 'automatic', cap: 3, derived: none('no-reading') });
      expect(recorded()).toEqual([]);
      await watcher.sweepPressure();
      expect(watcher.hostMachine()).toEqual(size(BIG));
      expect(await capNow()).toEqual({ mode: 'automatic', cap: 16,
        derived: { kind: 'measured', cap: 16, bound: 'cores', memTotalBytes: BIG.memTotalBytes, cores: 16 } });
      expect(recorded(), 'the cap moved with no operator act: the feed says so').toEqual(['workers 3 → automatic (16)']);
    } finally { await app.close(); coord.db.close(); }
  });
});

describe('/api/fleet/health: the psi block (#1170)', () => {
  const deadRunner: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
  for (const [name, env] of [['local', {}], ['remote', { CCRC_FLEET: 'remote' }]] as const) {
    it(`${name} mode: no \`psi\` key before the first ask, then psi.memory and psi.io`, async () => {
      const home = mkTmp('ccrc-fh-psi-');
      seedRoster(home);
      const cfg = loadConfig({ CCRC_HOME: home, ...env });
      const io = { ...localIO, pressureMeasured: async (): Promise<MeasuredPressure> => ({ ok: true, psi: psi(64, 8) }) };
      const deps = {
        cfg, runCcd: ccdRunner(deadRunner, cfg), tmux: new Tmux(deadRunner), io, queue: new KeyedQueue(),
        fleetState: { connected: true, downSince: null, ccdVerbs: [], rosterFp: null, build: null },
      } as never as Deps;
      const bus = new Bus();
      const watcher = new FleetWatcher(deps, bus);
      const app = await buildServer(deps, bus, watcher);
      const health = async (): Promise<Record<string, unknown>> =>
        (await app.inject({ method: 'GET', url: '/api/fleet/health' })).json() as Record<string, unknown>;
      try {
        const before = await health();
        expect('psi' in before, 'absent, never `null`: absence is UNKNOWN').toBe(false);
        await watcher.sweepPressure();
        const after = await health();
        const block = readHostPressure(after);
        expect(block?.memory).toEqual(psi(64, 8).memory);
        expect(block?.io).toEqual(psi(64, 8).io);
        expect(block).toMatchObject({ level: 'critical', link: 'answering' });
        const { psi: _block, ...rest } = after;
        expect(rest).toEqual(before);
      } finally { await app.close(); }
    });
  }

  it('the one reader refuses a malformed block, and absence reads as unknown', () => {
    expect(readHostPressure({})).toBeNull();
    expect(readHostPressure({ psi: { at: 1, level: 'calm', link: 'answering', memory: null, io: null } })).toBeNull();
    expect(readHostPressure({ psi: { at: 1, level: 'ok', link: 'flapping', memory: null, io: null } })).toBeNull();
    expect(readHostPressure({ psi: { at: 1, level: 'ok', link: 'answering', memory: { some: 1 }, io: null } })).toBeNull();
    expect(readHostPressure({ psi: { at: null, level: 'unmeasured', link: 'link-down', memory: null, io: null } }))
      .toEqual({ at: null, level: 'unmeasured', link: 'link-down', memory: null, io: null });
  });
});
