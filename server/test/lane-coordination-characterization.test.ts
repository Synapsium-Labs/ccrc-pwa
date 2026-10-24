// Characterization (D-5862; ARCH-68 #803; spec K11): the eight lanes the watcher throttled on a wall-clock `last*` field
// and now throttles on the monotonic clock (OA-C4, ruled (a) on #803), around coordination: the claim pair (renew, lapse), the stall watch, the idle-compact nudge, the mail and ask sweeps,
// the approvals lane's daily prune and the digest's beat. Each is driven through the entry `tick` calls (the nudge, whose
// throttle sits in `tick` itself, through `tick`) on a fake wall clock, and what a lane did is read off an effect it
// cannot do without. Each rig injects `Deps.monotonicMs` (`mono`); `at` moves both clocks together (real time passing) and
// `wallAt` the wall clock alone (a step). Pinned per lane: the first call runs, a call inside the cadence skips, a wall clock
// stepped back no longer holds the lane (after, it runs at its cadence) and stepped forward never runs it early, a throw spends the slot and leaves the next due call running; per flight
// mode: the stall watch and the nudge skip a second run, the mail and ask sweeps overlap once their cadence has
// elapsed. `sweepApprovals` itself has no throttle: a held approval past its `notifyAt` lapses on the tick straight after
// a prune, and the prune runs once a day. The digest beat is due at any injected reading of the clock, `0` included.
// Fixture homes only.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, IDLE_NUDGE_SWEEP_MS, STALL_SWEEP_MS, type StallTick } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
/** The injected monotonic clock (`Deps.monotonicMs`), on the same epoch as the fake wall clock. */
let mono = NOW;
const monotonicMs = (): number => mono;
/** Real time passing: both clocks read `ms`. */
const at = (ms: number): void => { mono = ms; vi.spyOn(Date, 'now').mockReturnValue(ms); };
/** A wall-clock step with no real time passing: only the wall clock moves. */
const wallAt = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };
const warned = (text: string): number => warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes(text)).length;
const settleTurns = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res)); };

interface Hooks { readdir?: (p: string) => Promise<string[] | null> }
function rig(h: Hooks = {}) {
  const home = mkTmp('ccrc-lane-coord-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'mail.token'), 'fixture-token\n');
  const cfg = loadConfig({ CCRC_HOME: home } as never);
  const registryListings: string[] = [];
  const io: FleetIO = {
    ...localIO,
    readdir: async (p: string) => {
      if (p === cfg.registryDir) registryListings.push(p);
      return h.readdir !== undefined && p === cfg.registryDir ? h.readdir(p) : localIO.readdir(p);
    },
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const w = new FleetWatcher({ ...testDeps(home), monotonicMs, cfg, io, coord } as never, new Bus(), 10_000);
  return { home, cfg, coord, w, registryListings };
}
type Rig = ReturnType<typeof rig>;
const prime = (r: Rig): void => { (r.w as unknown as { primed: boolean }).primed = true; };
const TICK: StallTick = { panePids: new Map(), records: [], refused: new Set() };

interface Lane {
  key: string;
  cadenceMs: number;
  rigHooks?: Hooks;
  /** One call of the lane's entry. */
  run: (r: Rig) => Promise<void>;
  /** Prepare the rig so the lane's effect is observable (and return a counter of that effect). */
  watch: (r: Rig) => () => number;
  /** A way to make the lane's body throw, and the effect that survives it. */
  throwing: (r: Rig) => void;
}

const LANES: Lane[] = [
  { key: 'claimRenew', cadenceMs: 60_000, run: async (r) => { r.w.renewClaims([], new Set()); },
    watch: (r) => { const s = vi.spyOn(r.coord, 'activeClaims'); return () => s.mock.calls.length; },
    throwing: (r) => { vi.spyOn(r.coord, 'activeClaims').mockImplementation(() => { throw new Error('db gone'); }); } },
  { key: 'claimLapse', cadenceMs: 60_000, run: async (r) => { r.w.lapseClaims([], new Set()); },
    watch: (r) => { const s = vi.spyOn(r.coord, 'activeClaims'); return () => s.mock.calls.length; },
    throwing: (r) => { vi.spyOn(r.coord, 'activeClaims').mockImplementation(() => { throw new Error('db gone'); }); } },
  { key: 'stalls', cadenceMs: STALL_SWEEP_MS, run: async (r) => { prime(r); await r.w.sweepStalls([], [], TICK); },
    watch: (r) => { const s = vi.spyOn(r.w as unknown as { stallResolveNow(): unknown }, 'stallResolveNow'); return () => s.mock.calls.length; },
    throwing: (r) => { vi.spyOn(r.w as unknown as { stallResolveNow(): unknown }, 'stallResolveNow').mockImplementation(() => { throw new Error('settings gone'); }); } },
  { key: 'mail', cadenceMs: 10_000, run: async (r) => { prime(r); await r.w.sweepMail(); },
    watch: (r) => () => r.registryListings.length, throwing: () => {},
    rigHooks: { readdir: async () => { throw new Error('registry gone'); } } },
  { key: 'asks', cadenceMs: 10_000, run: async (r) => { prime(r); await r.w.sweepAsks(); },
    watch: (r) => () => r.registryListings.length, throwing: () => {},
    rigHooks: { readdir: async () => { throw new Error('registry gone'); } } },
  { key: 'approvalPrune', cadenceMs: DAY, run: async (r) => { await r.w.sweepApprovals(); },
    watch: (r) => { const s = vi.spyOn(r.coord, 'pruneApprovalInputs'); return () => s.mock.calls.length; },
    throwing: (r) => { vi.spyOn(r.coord, 'pruneApprovalInputs').mockImplementation(() => { throw new Error('db gone'); }); } },
  { key: 'digestBeat', cadenceMs: 60_000,
    run: async (r) => { (r.w as unknown as { lastDigestDay: string | null }).lastDigestDay = null; r.w.sweepDigest(); },
    watch: (r) => { const s = vi.spyOn(r.coord, 'claimDigestDay'); return () => s.mock.calls.length; },
    throwing: (r) => { vi.spyOn(r.coord, 'claimDigestDay').mockImplementation(() => { throw new Error('db gone'); }); } },
];

describe.each(LANES)('the $key lane (monotonic clock)', (lane) => {
  it('runs on the first call, skips inside its cadence, runs once the cadence has elapsed', async () => {
    const r = rig(); const ran = lane.watch(r);
    at(NOW);
    await lane.run(r);
    const first = ran();
    expect(first, 'did not run on the first call').toBeGreaterThan(0);
    await lane.run(r);
    expect(ran(), 'ran twice at once').toBe(first);
    at(NOW + lane.cadenceMs - 1);
    await lane.run(r);
    expect(ran(), 'ran inside its cadence').toBe(first);
    at(NOW + lane.cadenceMs);
    await lane.run(r);
    expect(ran(), 'did not run at its cadence').toBeGreaterThan(first);
  });

  // The AFTER row of OA-C4 (#803). BEFORE, the lane throttled on `Date.now()`: a wall clock stepped back one hour held it for
  // the hour (a whole cadence of real time did not run it), and one stepped forward a cadence ran it at once. AFTER, the
  // cadence is real time: the step back runs it at its cadence and the step forward never runs it early.
  it('a wall clock stepped back one hour runs the lane at its cadence; stepped forward it never runs early', async () => {
    const r = rig(); const ran = lane.watch(r);
    at(NOW);
    await lane.run(r);
    const first = ran();
    wallAt(NOW - HOUR);
    mono = NOW + lane.cadenceMs;
    await lane.run(r);
    expect(ran(), 'AFTER: a wall step back, a whole cadence of real time, runs the lane').toBeGreaterThan(first);
    const second = ran();
    wallAt(NOW + Math.max(HOUR, lane.cadenceMs));
    await lane.run(r);
    expect(ran(), 'AFTER: a wall step forward ran the lane early').toBe(second);
  });
});

describe('a throw spends the slot and the next due call runs', () => {
  for (const key of ['claimRenew', 'claimLapse']) {
    it(`${key}: the throw reaches the caller (tick's own catch), the slot is spent`, async () => {
      const lane = LANES.find((l) => l.key === key)!;
      const r = rig(); lane.throwing(r);
      const s = vi.spyOn(r.coord, 'activeClaims');
      at(NOW);
      await expect(lane.run(r)).rejects.toThrow('db gone');
      await lane.run(r);
      expect(s.mock.calls.length, 'a failed pass did not consume its slot').toBe(1);
      at(NOW + 60_000);
      await expect(lane.run(r)).rejects.toThrow('db gone');
      expect(s.mock.calls.length).toBe(2);
    });
  }

  it('stalls: caught with the lane\'s sentence; the slot is spent; the next due call runs', async () => {
    const lane = LANES.find((l) => l.key === 'stalls')!;
    const r = rig(); lane.throwing(r);
    const s = vi.spyOn(r.w as unknown as { stallResolveNow(): unknown }, 'stallResolveNow');
    at(NOW);
    await lane.run(r);
    expect(warned('stall-watch sweep failed (settings gone)')).toBe(1);
    await lane.run(r);
    expect(s.mock.calls.length, 'a failed pass did not consume its slot').toBe(1);
    at(NOW + STALL_SWEEP_MS);
    await lane.run(r);
    expect(s.mock.calls.length).toBe(2);
  });

  for (const key of ['mail', 'asks']) {
    it(`${key}: the rejection reaches the caller, the slot is spent, the next due call runs`, async () => {
      const lane = LANES.find((l) => l.key === key)!;
      const r = rig(lane.rigHooks); const n = lane.watch(r);
      at(NOW);
      await expect(lane.run(r)).rejects.toThrow('registry gone');
      await lane.run(r);
      expect(n(), 'a failed pass did not consume its slot').toBe(1);
      at(NOW + lane.cadenceMs);
      await expect(lane.run(r)).rejects.toThrow('registry gone');
      expect(n()).toBe(2);
    });
  }

  it('approvalPrune: caught with sweepApprovals\' sentence; the slot is spent; the next due day runs', async () => {
    const lane = LANES.find((l) => l.key === 'approvalPrune')!;
    const r = rig(); lane.throwing(r);
    const s = vi.spyOn(r.coord, 'pruneApprovalInputs');
    at(NOW);
    await lane.run(r);
    expect(warned('sweepApprovals failed (db gone) — the next sweep retries')).toBe(1);
    await lane.run(r);
    expect(s.mock.calls.length, 'a failed prune did not consume its slot').toBe(1);
    at(NOW + DAY);
    await lane.run(r);
    expect(s.mock.calls.length).toBe(2);
  });

  it('digestBeat: caught with the beat\'s sentence; the slot is spent; the next beat runs', async () => {
    const lane = LANES.find((l) => l.key === 'digestBeat')!;
    const r = rig(); lane.throwing(r);
    const s = vi.spyOn(r.coord, 'claimDigestDay');
    at(NOW);
    await lane.run(r);
    expect(warned('sweepDigest failed (db gone) — the next beat retries')).toBe(1);
    await lane.run(r);
    expect(s.mock.calls.length, 'a failed beat did not consume its slot').toBe(1);
    at(NOW + 60_000);
    await lane.run(r);
    expect(s.mock.calls.length).toBe(2);
  });
});

describe('the flight of each lane', () => {
  it('the mail and ask sweeps have no guard: a second call overlaps a run still awaiting once the cadence has elapsed', async () => {
    for (const key of ['mail', 'asks']) {
      const lane = LANES.find((l) => l.key === key)!;
      const r = rig({ readdir: () => new Promise<string[] | null>(() => {}) });
      const n = lane.watch(r);
      at(NOW);
      void lane.run(r); await settleTurns();
      expect(n(), `${key}: the first call did not start`).toBe(1);
      void lane.run(r); await settleTurns();
      expect(n(), `${key}: a call inside the cadence started`).toBe(1);
      at(NOW + lane.cadenceMs);
      void lane.run(r); await settleTurns();
      expect(n(), `${key}: a due call did not overlap the run in flight`).toBe(2);
    }
  });

  it('the stall watch is single-flight: a pass that never settles keeps a second call out, even once the cadence has elapsed', async () => {
    const r = rig();
    prime(r);
    const orphan = { id: 'demo-quiet-basin', project: 'demo' };
    const hang = vi.spyOn(r.w as unknown as { judgeStallOrphan(): Promise<void> }, 'judgeStallOrphan').mockImplementation(() => new Promise<void>(() => {}));
    const tick = { ...TICK, records: [orphan] } as unknown as StallTick;
    at(NOW);
    void r.w.sweepStalls([], [], tick); await settleTurns();
    expect(hang.mock.calls.length, 'the first pass did not reach its judging').toBe(1);
    void r.w.sweepStalls([], [], tick); await settleTurns();
    at(NOW + STALL_SWEEP_MS);
    void r.w.sweepStalls([], [], tick); await settleTurns();
    expect(hang.mock.calls.length, 'a second pass started while the first was running').toBe(1);
  });

  it('a stall pass that settles frees the flight, and the next due call runs', async () => {
    const r = rig();
    prime(r);
    const orphan = { id: 'demo-quiet-basin', project: 'demo' };
    const judged = vi.spyOn(r.w as unknown as { judgeStallOrphan(): Promise<void> }, 'judgeStallOrphan').mockResolvedValue(undefined);
    const tick = { ...TICK, records: [orphan] } as unknown as StallTick;
    at(NOW);
    await r.w.sweepStalls([], [], tick);
    at(NOW + STALL_SWEEP_MS);
    await r.w.sweepStalls([], [], tick);
    expect(judged.mock.calls.length).toBe(2);
  });
});

describe('the idle-compact nudge: the throttle sits in tick, the single flight in the method', () => {
  /** Ticks `n` times at `ms`, with the method replaced by a counter. */
  async function tickAt(r: Rig, ms: number): Promise<void> { at(ms); await r.w.tick(); await settleTurns(); }

  it('tick calls the method on the first tick, not inside the cadence, and again at the cadence', async () => {
    const r = rig();
    const m = vi.spyOn(r.w, 'sweepIdleCompactNudge').mockResolvedValue(undefined);
    await tickAt(r, NOW);
    expect(m.mock.calls.length, 'the first tick did not run the lane').toBe(1);
    await tickAt(r, NOW + 2_000);
    expect(m.mock.calls.length, 'a tick inside the cadence ran the lane').toBe(1);
    await tickAt(r, NOW + IDLE_NUDGE_SWEEP_MS - 1);
    expect(m.mock.calls.length).toBe(1);
    await tickAt(r, NOW + IDLE_NUDGE_SWEEP_MS);
    expect(m.mock.calls.length, 'the tick at the cadence did not run the lane').toBe(2);
  });

  // The AFTER row of OA-C4 (#803). BEFORE: a step back held the lane for the hour, a step forward ran it at once.
  it('a wall clock stepped back one hour runs the lane at its cadence; stepped forward it never runs early', async () => {
    const r = rig();
    const m = vi.spyOn(r.w, 'sweepIdleCompactNudge').mockResolvedValue(undefined);
    await tickAt(r, NOW);
    wallAt(NOW - HOUR); mono = NOW + IDLE_NUDGE_SWEEP_MS;
    await r.w.tick(); await settleTurns();
    expect(m.mock.calls.length, 'AFTER: a wall step back, a whole cadence of real time, runs the lane').toBe(2);
    wallAt(NOW + HOUR);
    await r.w.tick(); await settleTurns();
    expect(m.mock.calls.length, 'AFTER: a wall step forward ran the lane early').toBe(2);
  });

  it('the slot is spent before the method runs: a method that rejects is not retried inside the cadence', async () => {
    const r = rig();
    const m = vi.spyOn(r.w, 'sweepIdleCompactNudge').mockRejectedValue(new Error('nudge failed'));
    await tickAt(r, NOW);
    await tickAt(r, NOW + 2_000);
    expect(m.mock.calls.length).toBe(1);
    await tickAt(r, NOW + IDLE_NUDGE_SWEEP_MS);
    expect(m.mock.calls.length).toBe(2);
  });

  it('a method that never settles delays neither this tick nor the next', async () => {
    const r = rig();
    const m = vi.spyOn(r.w, 'sweepIdleCompactNudge').mockImplementation(() => new Promise<void>(() => {}));
    at(NOW);
    await expect(r.w.tick()).resolves.toBeUndefined();
    at(NOW + IDLE_NUDGE_SWEEP_MS);
    await expect(r.w.tick()).resolves.toBeUndefined();
    expect(m.mock.calls.length).toBeGreaterThan(0);
  });

  it('a tick at the cadence while a pass still runs spends the slot: the next tick after the pass settles does not start another', async () => {
    const r = rig();
    let settle: () => void = () => {};
    const m = vi.spyOn(r.w, 'sweepIdleCompactNudge').mockImplementation(() => new Promise<void>((res) => { settle = res; }));
    await tickAt(r, NOW);
    expect(m.mock.calls.length, 'the first tick did not start the pass').toBe(1);
    await tickAt(r, NOW + IDLE_NUDGE_SWEEP_MS);
    expect(m.mock.calls.length, 'a second pass started over the first').toBe(1);
    settle(); await settleTurns();
    await tickAt(r, NOW + IDLE_NUDGE_SWEEP_MS + 2_000);
    expect(m.mock.calls.length, 'the skipped beat did not spend its slot').toBe(1);
    await tickAt(r, NOW + 2 * IDLE_NUDGE_SWEEP_MS);
    expect(m.mock.calls.length, 'the next cadence did not run the lane').toBe(2);
  });

  it('the method keeps one pass at a time: a second call while a session\'s nudge never settles starts no other', async () => {
    const r = rig();
    prime(r);
    (r.w as unknown as { deps: { notifyLog: unknown } }).deps.notifyLog = {};
    const one = vi.spyOn(r.w as unknown as { idleNudgeOne(): Promise<void> }, 'idleNudgeOne').mockImplementation(() => new Promise<void>(() => {}));
    const session = {
      id: 'demo-quiet-basin', unmeasured: [], statusUnmeasured: false, lifecycle: 'running', archivedAt: null, status: 'idle',
      dialogPending: false, askSummary: null, ask: null,
    };
    // The single flight is the lane's row now (`runLane`), so both calls go through it, a cadence apart.
    const call = (): void => { void r.w.runLane('idleNudge', () => r.w.sweepIdleCompactNudge([session as never], [], TICK)); };
    at(NOW); call(); await settleTurns();
    expect(one.mock.calls.length, 'the first call did not reach a session').toBe(1);
    at(NOW + IDLE_NUDGE_SWEEP_MS); call(); await settleTurns();
    expect(one.mock.calls.length, 'a second call started while the first was running').toBe(1);
  });
});

describe('tick keeps the call shape of the fire-and-forget lanes', () => {
  for (const method of ['sweepMail', 'sweepAsks', 'sweepStalls']) {
    it(`${method}: a body that never settles delays neither this tick nor the next`, async () => {
      const r = rig();
      const m = vi.spyOn(r.w as unknown as Record<string, () => Promise<void>>, method).mockImplementation(() => new Promise<void>(() => {}));
      at(NOW);
      await expect(r.w.tick()).resolves.toBeUndefined();
      at(NOW + HOUR);
      await expect(r.w.tick()).resolves.toBeUndefined();
      expect(m.mock.calls.length).toBeGreaterThan(0);
    });
  }

  it('the claim pair is a synchronous call inside tick, and the digest beat too: tick answers with no lane pending', async () => {
    const r = rig();
    const renew = vi.spyOn(r.w, 'renewClaims');
    const lapse = vi.spyOn(r.w, 'lapseClaims');
    const digest = vi.spyOn(r.w, 'sweepDigest');
    at(NOW);
    await r.w.tick();
    expect(renew.mock.calls.length).toBe(1);
    expect(lapse.mock.calls.length).toBe(1);
    expect(digest.mock.calls.length).toBe(1);
    expect(renew.mock.results[0]!.value).toBeUndefined();
  });
});

describe('the digest beat is due at any reading of the monotonic clock', () => {
  const clearDay = (r: Rig): void => { (r.w as unknown as { lastDigestDay: string | null }).lastDigestDay = null; };

  it('a first beat at a monotonic reading of 0 runs (the row starts due), and the next beat 59.999 s later does not', () => {
    const r = rig();
    const s = vi.spyOn(r.coord, 'claimDigestDay');
    mono = 0; clearDay(r);
    r.w.sweepDigest(0);
    expect(s.mock.calls.length, 'a first beat at reading 0 did not run').toBe(1);
    mono = 59_999; clearDay(r);
    r.w.sweepDigest(59_999);
    expect(s.mock.calls.length, 'a beat inside the minute ran').toBe(1);
    mono = 60_000; clearDay(r);
    r.w.sweepDigest(60_000);
    expect(s.mock.calls.length, 'a beat at the minute did not run').toBe(2);
  });

  it('the beat measures its minute on the monotonic clock; the `now` it is handed is the verdict\'s, not the throttle\'s', () => {
    const r = rig();
    const s = vi.spyOn(r.coord, 'claimDigestDay');
    mono = 0; clearDay(r);
    r.w.sweepDigest(5_000_000_000);
    clearDay(r); mono = 1_000;
    r.w.sweepDigest(5_000_000_000 + 61_000);
    expect(s.mock.calls.length, 'the beat measured its minute on the `now` it was handed: a minute of wall time is not a minute of real time').toBe(1);
    clearDay(r); mono = 60_000;
    r.w.sweepDigest(5_000_000_000 + 61_000);
    expect(s.mock.calls.length, 'a beat a minute of real time later did not run').toBe(2);
  });
});

describe('sweepApprovals has no throttle; only its daily prune is a beat', () => {
  it('the lapse and the ceiling run on every call, and the prune once a day', async () => {
    const r = rig();
    const lapse = vi.spyOn(r.coord, 'approvalsInState');
    const prune = vi.spyOn(r.coord, 'pruneApprovalInputs');
    const prunedAsks = vi.spyOn(r.coord, 'pruneAskQuestions');
    at(NOW);
    await r.w.sweepApprovals();
    const readsOnce = lapse.mock.calls.length;
    expect(readsOnce, 'the lapse did not read the held rows').toBeGreaterThan(0);
    expect(prune.mock.calls.length).toBe(1);
    expect(prunedAsks.mock.calls.length).toBe(1);
    at(NOW + 1_000);
    await r.w.sweepApprovals();
    expect(lapse.mock.calls.length, 'the lapse was throttled with the prune').toBe(readsOnce * 2);
    expect(prune.mock.calls.length, 'the prune ran inside its day').toBe(1);
    at(NOW + DAY - 1);
    await r.w.sweepApprovals();
    expect(prune.mock.calls.length).toBe(1);
    at(NOW + DAY);
    await r.w.sweepApprovals();
    expect(prune.mock.calls.length, 'the prune did not run at its day').toBe(2);
    expect(prunedAsks.mock.calls.length).toBe(2);
  });

  it('tick calls the lane on every tick, whatever the prune day says', async () => {
    const r = rig();
    const m = vi.spyOn(r.w, 'sweepApprovals').mockResolvedValue(undefined);
    for (const ms of [NOW, NOW + 2_000, NOW + 4_000]) { at(ms); await r.w.tick(); await settleTurns(); }
    expect(m.mock.calls.length, 'a tick skipped the approvals lane').toBe(3);
  });

  it('a held approval past its notifyAt lapses on the call straight after a prune', async () => {
    const r = rig();
    at(NOW);
    await r.w.sweepApprovals();                                   // prunes
    const held = vi.spyOn(r.coord, 'approvalsInState').mockImplementation(((st: string) =>
      st === 'held' ? { ok: true, rows: [{ id: 7, notifyAt: NOW + 500, askAt: NOW }] } : { ok: true, rows: [] }) as never);
    const lapsed = vi.spyOn(r.coord, 'lapseApproval').mockImplementation((() => undefined) as never);
    at(NOW + 1_000);
    await r.w.sweepApprovals();
    expect(held.mock.calls.length).toBeGreaterThan(0);
    expect(lapsed.mock.calls.map((c) => c[0]), 'the lapse waited for the prune day').toEqual([7]);
  });
});
