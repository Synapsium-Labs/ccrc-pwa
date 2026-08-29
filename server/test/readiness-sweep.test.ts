// program-leverage wave 3 (F3): the readiness sweep's CLOCK and its ROSTER
// WALK, which are the two things the pure measurement (`readiness.test.ts`)
// cannot speak about.
//
// The clock is load-bearing rather than cosmetic. One sweep is
// `2 * homeAble + 1` measured reads, and in remote fleet mode each of those is
// an agent round trip — so a sweep that ran on the 2 s poll would put ~9 agent
// requests per tick on the socket forever. Every interval case below exists to
// keep that from happening by accident.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher, READINESS_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO, type MeasuredRead } from '../src/io.js';
import { isSafeProjectSegment } from '../src/coord/ledgerseed.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;

afterEach(() => { vi.restoreAllMocks(); });

/** The suite's established clock idiom (`ledger-sweep.test.ts`): the sweeps
 *  read `Date.now()` directly, like every one of their neighbours. */
const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

/** The four `homeAble` accounts of `DEFAULT_TEST_ROSTER`. `gpt` is the fifth
 *  and is NOT homeAble — it has no HOME on this box, so asking about it would
 *  manufacture an `unmeasurable` that means nothing. */
const HOME_ABLE_SUFFIXES = ['.claude', '.claude-a', '.claude-b', '.claude-d'];

interface Fixture {
  watcher: FleetWatcher;
  reads: string[];
  home: string;
  fail: () => void;
}

const fixture = (over: { coord?: unknown } = {}): Fixture => {
  const home = mkTmp('ccrc-readiness-sweep-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home } as never);
  const reads: string[] = [];
  let failing = false;
  const io: FleetIO = {
    ...localIO,
    readFileMeasured: async (p: string): Promise<MeasuredRead> => {
      reads.push(p);
      return failing ? { ok: false, reason: 'unreadable' } : { ok: true, content: 'x' };
    },
  };
  const coord = 'coord' in over
    ? over.coord
    : new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const watcher = new FleetWatcher(
    { ...testDeps(home), cfg, io, coord } as never, new Bus(), 10_000);
  return { watcher, reads, home, fail: () => { failing = true; } };
};

describe('the readiness sweep — its clock', () => {
  it('has not swept yet, so it answers undefined — not a fabricated clean bill', () => {
    at(NOW);
    expect(fixture().watcher.currentReadiness()).toBeUndefined();
  });

  it('sweeps on the FIRST call rather than waiting out the interval', async () => {
    // A server restart must not leave every project's badge blank for ten
    // minutes. NOTE what actually makes this true, measured (D-1031): NOT the
    // `lastX !== 0` half of the guard, which is inert — with `lastSweep` at 0
    // and a real epoch clock, `now - 0` already dwarfs any interval, so the
    // first call falls through on the arithmetic alone. Deleting `!== 0` kills
    // no test here, and the same is true of the two ledger lanes that share
    // the idiom. It is kept for symmetry with them and because it states the
    // intent; it is not what enforces it.
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    expect(f.watcher.currentReadiness()?.worker).toBe('present');
  });

  it('does not re-sweep inside the interval', async () => {
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    const first = f.reads.length;
    expect(first).toBeGreaterThan(0);
    at(NOW + READINESS_SWEEP_MS - 1);
    await f.watcher.sweepReadiness();
    expect(f.reads.length).toBe(first);
  });

  it('re-sweeps once the interval has passed', async () => {
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    const first = f.reads.length;
    at(NOW + READINESS_SWEEP_MS + 1);
    await f.watcher.sweepReadiness();
    expect(f.reads.length).toBeGreaterThan(first);
  });

  it('a later failing sweep says so honestly rather than holding a stale clean bill', async () => {
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    expect(f.watcher.currentReadiness()?.worker).toBe('present');
    f.fail();
    at(NOW + READINESS_SWEEP_MS + 1);
    await f.watcher.sweepReadiness();
    expect(f.watcher.currentReadiness()?.worker).toBe('unmeasurable');
    expect(f.watcher.currentReadiness()?.boxToken).toBe('unmeasurable');
  });
});

describe('the readiness sweep — its roster walk', () => {
  it('walks every homeAble account, both skills, and no others', async () => {
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    const skillReads = f.reads.filter((p) => p.includes(`${path.sep}skills${path.sep}`));
    expect(skillReads).toEqual(HOME_ABLE_SUFFIXES.flatMap((suffix) => [
      path.join(f.home, suffix, 'skills', 'ccrc-worker', 'SKILL.md'),
      path.join(f.home, suffix, 'skills', 'ccrc-coordinator', 'SKILL.md'),
    ]));
  });

  it('never asks about a non-homeAble account', async () => {
    // `gpt` carries `configDirSuffix: '.claude-gpt'` and `homeAble: false`.
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    expect(f.reads.filter((p) => p.includes('.claude-gpt'))).toEqual([]);
  });

  it('measures the box token at the configured path, once', async () => {
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    expect(f.reads.filter((p) => p.endsWith('mail.token')))
      .toEqual([path.join(f.home, '.ccrc', 'mail.token')]);
  });
});

describe('the readiness sweep — the coord probe', () => {
  it('a healthy store answers available', async () => {
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    expect(f.watcher.currentReadiness()?.coordDb).toBe('available');
  });

  it('a coord.db read that THROWS is reported degraded, not swallowed', async () => {
    // The two existing sites that learn this (emitRuns, the socket cold start)
    // both drop it on the floor with a console.warn. This one records it.
    at(NOW);
    const f = fixture({ coord: { ledgerFloor() { throw new Error('SQLITE_BUSY'); } } });
    await f.watcher.sweepReadiness();
    expect(f.watcher.currentReadiness()?.coordDb).toBe('degraded');
  });

  it('no coord store at all is not-configured, which is a different word', async () => {
    at(NOW);
    const f = fixture({ coord: undefined });
    await f.watcher.sweepReadiness();
    expect(f.watcher.currentReadiness()?.coordDb).toBe('not-configured');
  });

  it('the probe is a REAL read, on a project name no real project can have', async () => {
    // A handle existing is not a handle answering, so the probe must actually
    // ask the store something — and the name it asks about must be one
    // `isSafeProjectSegment` rejects, or it could collide with a real row.
    at(NOW);
    const asked: string[] = [];
    const f = fixture({ coord: { ledgerFloor(p: string) { asked.push(p); return null; } } });
    await f.watcher.sweepReadiness();
    expect(asked).toHaveLength(1);
    expect(isSafeProjectSegment(asked[0])).toBe(false);
  });
});
