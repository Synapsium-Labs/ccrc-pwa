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
  EMPTY_PRESSURE, PRESSURE_EVIDENCE_MS, PRESSURE_INFLIGHT_STALL_MS, PRESSURE_SWEEP_MS, pressureBlock, pressureLevelOf,
  type PressureState,
} from '../src/pressure.js';
import { readHostPressure, type HostPsi } from '../../shared/pressure.js';
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
