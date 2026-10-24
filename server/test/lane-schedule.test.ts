// D-5862 (ARCH-68 #803; spec 2026-10-19 K11, §2.3's clock row): `LANE_SCHEDULE` is the one table of the watcher's
// cadences, and `LaneRunner` (behind `FleetWatcher.runLane`) is the one place a lane is throttled, kept to a single
// flight and caught. The rows here pin the table's own rules and the runner's four flight modes on an injected clock;
// `lane-beats-characterization.test.ts` pins the same four beats through `tick`.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LANE_SCHEDULE, laneRow, type LaneRow } from '../src/laneSchedule.js';
import { LaneRunner } from '../src/laneRunner.js';
import { CATALOGUE_POLL_INTERVAL_MS, SERVER_CAPS_WRITE_MS } from '../src/laneSchedule.js';
import { parsedFile } from './scan/symbols.js';

const SRC = path.join(import.meta.dirname, '..', 'src');
const text = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8');
/** A file's declarations and import edges, read through scan/parse.ts (ARCH-06: a pin keyed on a binding, not a line). */
const parsed = (rel: string) => parsedFile(path.join(SRC, rel));
/** The initialiser of `rel`'s one binding `name`, or null when the file declares none. */
const initOf = (rel: string, name: string): string | null => {
  const found = parsed(rel).bindings.filter((b) => b.name === name);
  if (found.length > 1) throw new Error(`${rel} declares ${name} ${found.length} times`);
  return found[0]?.init ?? null;
};
/** True when `rel` re-exports `name` from `specifier` (`export { name } from '…'`). */
const reExports = (rel: string, name: string, specifier: string): boolean =>
  parsed(rel).imports.some((e) => e.kind === 'export-from' && e.specifier === specifier && e.names.includes(name));

/** The safety intervals that are NOT cadences (spec K11): a lane's cadence is never derived from one of these. */
const SAFETY_CONSTANTS = [
  'CHILD_RECLAIM_STALL_MS', 'COLLECT_AUDIT_STALL_MS', 'DELEGATION_RECOVERY_RETRY_MS', 'PR_SWEEP_STUCK_MS',
  'MAIL_REPLAY_MS', 'MAIL_BACKOFF_MS', 'PR_BACKOFF_MS',
];

const row = (over: Partial<LaneRow> & Pick<LaneRow, 'name'>): LaneRow => ({
  cadenceMs: 1000, derivedFrom: null, clock: 'wall', flight: 'none', warnKey: null, ...over,
});

/** A runner over test rows with a clock the test moves by hand. */
function rig(rows: LaneRow[], warn: (m: string) => void = () => {}) {
  const t = { wall: 1_000_000, mono: 5_000 };
  const runner = new LaneRunner({ wall: () => t.wall, mono: () => t.mono }, rows, warn);
  return { t, runner };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

describe('LANE_SCHEDULE — the table', () => {
  it('every row has a unique name and a positive finite cadence', () => {
    const names = LANE_SCHEDULE.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const r of LANE_SCHEDULE) {
      expect(Number.isFinite(r.cadenceMs) && r.cadenceMs > 0, `${r.name}'s cadence`).toBe(true);
      expect(['mono', 'wall']).toContain(r.clock);
      expect(['skip', 'join', 'join-rerun', 'none']).toContain(r.flight);
    }
  });

  it('every derivedFrom names a constant that exists, with a reason', () => {
    for (const r of LANE_SCHEDULE) {
      if (r.derivedFrom === null) continue;
      const named = LANE_SCHEDULE.find((o) => o.name === r.derivedFrom!.name);
      const declared = new RegExp(`export const ${r.derivedFrom.name}\\b`).test(text('laneSchedule.ts'));
      expect(named !== undefined || declared, `${r.name} is derived from ${r.derivedFrom.name}, which exists nowhere`).toBe(true);
      expect(r.derivedFrom.reason.length, `${r.name}'s derivation carries no reason`).toBeGreaterThan(0);
    }
  });

  it('a shared cadence has one home, here, and its old home re-exports it rather than declaring a second copy', () => {
    expect(initOf('laneSchedule.ts', 'CATALOGUE_POLL_INTERVAL_MS')).toBe('30 * 60_000');
    expect(initOf('laneSchedule.ts', 'SERVER_CAPS_WRITE_MS')).toBe('60_000');
    const table = initOf('laneSchedule.ts', 'LANE_SCHEDULE') ?? '';
    expect(table).toMatch(/cadenceMs: CATALOGUE_POLL_INTERVAL_MS\b/);
    expect(table).toMatch(/cadenceMs: SERVER_CAPS_WRITE_MS\b/);
    expect(initOf('update/catalogue.ts', 'CATALOGUE_POLL_INTERVAL_MS'), 'catalogue.ts declares a second copy').toBeNull();
    expect(reExports('update/catalogue.ts', 'CATALOGUE_POLL_INTERVAL_MS', '../laneSchedule.js')).toBe(true);
    expect(initOf('update/serverCaps.ts', 'SERVER_CAPS_WRITE_MS'), 'serverCaps.ts declares a second copy').toBeNull();
    expect(reExports('update/serverCaps.ts', 'SERVER_CAPS_WRITE_MS', '../laneSchedule.js')).toBe(true);
    expect(text('watch.ts'), 'the watcher holds a cadence of its own').not.toMatch(/\b(?:CAPS_REFRESH_MS|UPDATE_INVENTORY_MS|UPDATE_CATALOGUE_MS)\s*=/);
    expect(laneRow('catalogue').cadenceMs).toBe(CATALOGUE_POLL_INTERVAL_MS);
    expect(laneRow('serverCaps').cadenceMs).toBe(SERVER_CAPS_WRITE_MS);
  });

  it('no row\'s cadence is a safety constant', () => {
    for (const r of LANE_SCHEDULE) {
      expect(SAFETY_CONSTANTS, `${r.name} takes its cadence from a safety interval`).not.toContain(r.derivedFrom?.name);
    }
    const table = initOf('laneSchedule.ts', 'LANE_SCHEDULE') ?? '';
    for (const s of SAFETY_CONSTANTS) expect(table, `${s} is a row`).not.toMatch(new RegExp(`cadenceMs: ${s}\\b`));
  });

  it('a staleAfterMs rides a skip row only, and the four beats of this PR are the rows named', () => {
    for (const r of LANE_SCHEDULE) if (r.staleAfterMs !== undefined) expect(r.flight).toBe('skip');
    expect(LANE_SCHEDULE.map((r) => r.name)).toEqual(expect.arrayContaining(['caps', 'catalogue', 'inventory', 'serverCaps']));
    expect(laneRow('inventory').flight).toBe('join-rerun');
    expect(laneRow('serverCaps').flight).toBe('join');
  });
});

describe('LaneRunner — the throttle', () => {
  it('runs on the first call, then throttles on the row\'s cadence, at the boundary', async () => {
    const { t, runner } = rig([row({ name: 'caps' })]);
    const fn = vi.fn(async () => 1);
    await runner.run('caps', fn);
    expect(runner.run('caps', fn)).toBeNull();
    t.wall += 999;
    expect(runner.run('caps', fn)).toBeNull();
    t.wall += 1;
    await runner.run('caps', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stamps before it awaits: a second call during the first\'s await is throttled', async () => {
    const { runner } = rig([row({ name: 'caps' })]);
    const gate = deferred();
    const fn = vi.fn(() => gate.promise);
    const first = runner.run('caps', fn);
    expect(first).not.toBeNull();
    expect(runner.run('caps', fn), 'a tick landing mid-run ran the lane again').toBeNull();
    gate.resolve();
    await first;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reads the row\'s own clock', async () => {
    const { t, runner } = rig([row({ name: 'caps', clock: 'mono' })]);
    const fn = vi.fn(async () => {});
    await runner.run('caps', fn);
    t.wall += 10_000;                                   // the wall clock does not move a mono row
    expect(runner.run('caps', fn)).toBeNull();
    t.mono += 1000;
    await runner.run('caps', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns the lane\'s promise without awaiting it for its caller: a caller that does not await it is not delayed', async () => {
    const { runner } = rig([row({ name: 'caps' })]);
    const never = new Promise<void>(() => {});
    const p = runner.run('caps', () => never);
    expect(p).toBeInstanceOf(Promise);
    expect(runner.inFlight('caps')).not.toBeNull();
  });

  it('a synchronous throw becomes a rejection, not a throw out of the caller', async () => {
    const { runner } = rig([row({ name: 'caps' })]);
    const p = runner.run('caps', () => { throw new Error('boom'); });
    await expect(p).rejects.toThrow('boom');
  });
});

describe('LaneRunner — kick, stamp, restamp', () => {
  it('kick makes the next call run', async () => {
    const { runner } = rig([row({ name: 'caps' })]);
    const fn = vi.fn(async () => {});
    await runner.run('caps', fn);
    expect(runner.run('caps', fn)).toBeNull();
    runner.kick('caps');
    await runner.run('caps', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stamp pushes the beat back as a run would', async () => {
    const { t, runner } = rig([row({ name: 'caps' })]);
    t.wall += 5000;
    runner.stamp('caps');
    expect(runner.run('caps', async () => {}), 'an on-demand stamp did not defer the beat').toBeNull();
    t.wall += 1000;
    expect(runner.due('caps')).toBe(true);
  });

  it('restamp moves the stamp to the decision clock, and the next call is throttled from there', async () => {
    const { t, runner } = rig([row({ name: 'caps', clock: 'mono' })]);
    const gate = deferred();
    const first = runner.run('caps', () => gate.promise);
    t.mono += 900;                                      // a slow gather
    runner.restamp('caps');
    gate.resolve();
    await first;
    t.mono += 500;                                      // 1400 from the start, 500 from the decision
    expect(runner.run('caps', async () => {}), 'a slow gather re-stamps from the decision').toBeNull();
    t.mono += 500;
    expect(runner.due('caps')).toBe(true);
  });

  it('inFlight answers the run in flight, then null', async () => {
    const { runner } = rig([row({ name: 'caps', flight: 'join' })]);
    expect(runner.inFlight('caps')).toBeNull();
    const gate = deferred();
    const p = runner.run('caps', () => gate.promise)!;
    expect(runner.inFlight('caps')).toBe(p);
    gate.resolve();
    await p;
    expect(runner.inFlight('caps')).toBeNull();
  });
});

describe('LaneRunner — the four flight modes', () => {
  it('skip: a call during a run is refused', async () => {
    const { t, runner } = rig([row({ name: 'pr', flight: 'skip', cadenceMs: 10 })]);
    const gate = deferred();
    const fn = vi.fn(() => gate.promise);
    const first = runner.run('pr', fn);
    t.wall += 100;
    expect(runner.run('pr', fn), 'a due call during a run started a second').toBeNull();
    gate.resolve();
    await first;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('none: runs overlap', async () => {
    const { t, runner } = rig([row({ name: 'caps', flight: 'none', cadenceMs: 10 })]);
    const gate = deferred();
    const fn = vi.fn(() => gate.promise);
    runner.run('caps', fn);
    t.wall += 100;
    runner.run('caps', fn);
    expect(fn).toHaveBeenCalledTimes(2);
    gate.resolve();
  });

  it('join: a call during a run hands back the same promise and starts nothing', async () => {
    const { runner } = rig([row({ name: 'serverCaps', flight: 'join' })]);
    const gate = deferred<string>();
    const fn = vi.fn(() => gate.promise);
    const a = runner.runNow('serverCaps', fn);
    const b = runner.runNow('serverCaps', fn);
    expect(b, 'a second caller started a second run').toBe(a);
    gate.resolve('x');
    await expect(a).resolves.toBe('x');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('join-rerun: joiners queue exactly one rerun, however many come', async () => {
    const { runner } = rig([row({ name: 'inventory', flight: 'join-rerun' })]);
    const gate = deferred();
    const fn = vi.fn(() => gate.promise);
    const again = vi.fn();
    const first = runner.runNow('inventory', fn);
    for (let i = 0; i < 3; i++) { runner.runNow('inventory', fn); runner.requestRerun('inventory', again); }
    expect(fn).toHaveBeenCalledTimes(1);
    expect(again).not.toHaveBeenCalled();
    gate.resolve();
    await first;
    await Promise.resolve();
    expect(again, 'joiners during a run did not cause exactly one rerun').toHaveBeenCalledTimes(1);
  });

  it('join-rerun: a request while nothing runs queues nothing; on a join row it queues nothing at all', async () => {
    const { runner } = rig([row({ name: 'inventory', flight: 'join-rerun' }), row({ name: 'serverCaps', flight: 'join' })]);
    const again = vi.fn();
    runner.requestRerun('inventory', again);
    const gate = deferred();
    const joined = runner.runNow('serverCaps', () => gate.promise);
    runner.requestRerun('serverCaps', again);
    gate.resolve();
    await joined;
    await Promise.resolve();
    expect(again).not.toHaveBeenCalled();
  });

  it('a staleAfterMs row abandons a stuck run, and the old run cannot clear the new run', async () => {
    const { t, runner } = rig([row({ name: 'pr', flight: 'skip', cadenceMs: 10, staleAfterMs: 1000 })]);
    const oldGate = deferred();
    const newGate = deferred();
    const old = runner.run('pr', () => oldGate.promise)!;
    t.wall += 500;
    expect(runner.run('pr', () => newGate.promise), 'abandoned a run that was not stuck').toBeNull();
    t.wall += 600;
    const fresh = runner.run('pr', () => newGate.promise);
    expect(fresh, 'a stuck run was not abandoned').not.toBeNull();
    oldGate.resolve();
    await old;
    expect(runner.inFlight('pr'), 'the late run cleared the new run\'s flight').toBe(fresh);
    newGate.resolve();
    await fresh;
    expect(runner.inFlight('pr')).toBeNull();
  });
});

describe('LaneRunner — the catch', () => {
  it('a row with a warnKey catches a rejection with its sentence, and the next call runs', async () => {
    const said: string[] = [];
    const { t, runner } = rig([row({ name: 'catalogue', warnKey: 'ccrc-server: the lane rejected', cadenceMs: 10 })], (m) => said.push(m));
    await expect(runner.run('catalogue', async () => { throw new Error('nope'); })).resolves.toBeUndefined();
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^ccrc-server: the lane rejected: Error: nope/);
    t.wall += 10;
    const fn = vi.fn(async () => {});
    await runner.run('catalogue', fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a row with no warnKey hands the rejection back to its caller, whose own catch decides', async () => {
    const said: string[] = [];
    const { runner } = rig([row({ name: 'caps' })], (m) => said.push(m));
    await expect(runner.run('caps', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    expect(said).toEqual([]);
  });

  it('runNow refuses a skip row: an on-demand caller needs a run to join', () => {
    const { runner } = rig([row({ name: 'pr', flight: 'skip' })]);
    expect(() => runner.runNow('pr', async () => {})).toThrow(/skip row/);
  });

  it('runNow refuses a row that warns: an on-demand caller owns its own rejection', () => {
    const { runner } = rig([row({ name: 'catalogue', warnKey: 'x' })]);
    expect(() => runner.runNow('catalogue', async () => {})).toThrow(/warnKey/);
  });
});

describe('the nine sweep lanes outside coordination (D-5862, PR 1b)', () => {
  const NINE: Array<[string, number]> = [
    ['tasks', 10_000], ['usage', 60_000], ['pr', 120_000], ['names', 10_000], ['divergences', 60_000],
    ['lifecycle', 5_000], ['readiness', 600_000], ['ledgerReconcile', 900_000], ['ledgerFloor', 3_600_000],
  ];

  it.each(NINE)('the %s row exists, on the wall clock as it is today, at %i ms', (name, cadenceMs) => {
    const r = laneRow(name);
    expect(r.cadenceMs).toBe(cadenceMs);
    expect(r.clock).toBe('wall');
    expect(r.derivedFrom).toBeNull();
  });

  it('only the PR sweep is single-flight, abandoning a stuck run at the backoff ceiling, and it carries both cadences', () => {
    const pr = laneRow('pr');
    expect(pr.flight).toBe('skip');
    expect(pr.staleAfterMs).toBe(900_000);
    expect(pr.activeCadenceMs).toBe(30_000);
    for (const [name] of NINE) if (name !== 'pr') expect(laneRow(name).flight, `${name} has no guard today`).toBe('none');
  });

  it('each cadence has one home, here: the watcher declares none of them', () => {
    const w = text('watch.ts');
    for (const c of ['TASK_SWEEP_MS', 'USAGE_SWEEP_MS', 'NAME_SWEEP_MS', 'DIVERGENCE_SWEEP_MS', 'LC_SWEEP_MS', 'READINESS_SWEEP_MS',
      'LEDGER_FLOOR_SWEEP_MS', 'LEDGER_RECONCILE_SWEEP_MS', 'PR_SWEEP_MS', 'PR_SWEEP_ACTIVE_MS', 'PR_SWEEP_STUCK_MS', 'PR_BACKOFF_MAX_MS']) {
      expect(w, `${c} is declared a second time in watch.ts`).not.toMatch(new RegExp(`const ${c}\\s*=\\s*[0-9]`));
      expect(text('laneSchedule.ts'), `${c} is declared nowhere here`).toMatch(new RegExp(`export const ${c}\\b`));
    }
  });

  it('the watcher keeps no clock or guard of these lanes', () => {
    const w = text('watch.ts');
    for (const f of ['lastTaskSweep', 'lastUsageSweep', 'lastPrSweep', 'prSweepStartedAt', 'lastNameSweep', 'lastDivergenceSweep',
      'lastLifecycleSweep', 'lastReadinessSweep', 'lastLedgerFloor', 'lastLedgerReconcile']) {
      expect(w, `${f} is still a field of the watcher`).not.toMatch(new RegExp(`\\b${f}\\b`));
    }
  });

  it('due(name, true) reads a row\'s active cadence; a row without one ignores the flag', () => {
    const { t, runner } = rig([row({ name: 'pr', cadenceMs: 120, activeCadenceMs: 30 }), row({ name: 'plain', cadenceMs: 120 })]);
    runner.stamp('pr'); runner.stamp('plain');
    t.wall += 30;
    expect(runner.due('pr')).toBe(false);
    expect(runner.due('pr', true)).toBe(true);
    expect(runner.due('plain', true), 'a row with no active cadence ran early').toBe(false);
    t.wall += 90;
    expect(runner.due('pr')).toBe(true);
  });

  it('a run is abandoned at exactly staleAfterMs, not a millisecond later', async () => {
    const { t, runner } = rig([row({ name: 'pr', flight: 'skip', cadenceMs: 10, staleAfterMs: 1000 })]);
    const first = deferred();
    void runner.run('pr', () => first.promise);
    t.wall += 999;
    expect(runner.run('pr', async () => {}), 'abandoned a run younger than the ceiling').toBeNull();
    t.wall += 1;
    const fn = vi.fn(async () => {});
    await runner.run('pr', fn);
    expect(fn, 'did not abandon a run at the ceiling').toHaveBeenCalledTimes(1);
    first.resolve();
  });
});
