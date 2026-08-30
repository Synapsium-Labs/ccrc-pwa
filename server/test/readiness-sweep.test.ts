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
import { mkdirSync, writeFileSync } from 'node:fs';
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
  // A real token file on THIS box: the token is a server-local read now
  // (MAJOR 1), so the fixture has to be a real file rather than something the
  // fleet-io double can answer.
  writeFileSync(path.join(home, '.ccrc', 'mail.token'), 'fixture-token\n');
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
    // ...and the box token is UNAFFECTED, because it does not ride that io at
    // all (MAJOR 1). A fleet outage must not be able to make a server-local
    // fact unmeasurable — that conflation is the defect this split fixed.
    expect(f.watcher.currentReadiness()?.boxToken).toBe('configured');
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

  it('never asks the FLEET io for the box token — that read is server-local', async () => {
    // `f.reads` is the FLEET io's log. Before MAJOR 1 the token path was in
    // it, which is exactly how the live topology ended up permanently
    // unmeasurable.
    at(NOW);
    const f = fixture();
    await f.watcher.sweepReadiness();
    expect(f.reads.filter((p) => p.endsWith('mail.token'))).toEqual([]);
    expect(f.watcher.currentReadiness()?.boxToken).toBe('configured');
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

// --- fix round 1, MAJOR 1 -------------------------------------------------
describe('the sweep measures the box token on the SERVER box', () => {
  /** THE PRODUCTION TOPOLOGY, as a fixture. `CCRC_FLEET=remote` is standing
   *  config on the live server, so the watcher's `deps.io` is the agent-backed
   *  FleetIO — and the agent's read whitelist has no `.ccrc` arm
   *  (`agent/src/whitelist.ts`: .cc-sessions, .cc-limits, .cc-clips, the
   *  projects root, underClaudeGlob). This io refuses `.ccrc` exactly as that
   *  whitelist does, while the token file really exists on this box.
   *
   *  Before the local/fleet split this fixture answered `unmeasurable`, so the
   *  verdict could never read `ready` on the real fleet. */
  const fixtureRemote = () => {
    const home = mkTmp('ccrc-readiness-remote-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'mail.token'), 'a-real-looking-token-value\n');
    const cfg = loadConfig({ CCRC_HOME: home } as never);
    const refused: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p: string): Promise<MeasuredRead> => {
        if (p.includes(`${path.sep}.ccrc${path.sep}`)) {
          refused.push(p);
          return { ok: false, reason: 'unreadable' };
        }
        return { ok: true, content: 'x' };
      },
    };
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const watcher = new FleetWatcher(
      { ...testDeps(home), cfg, io, coord } as never, new Bus(), 10_000);
    return { watcher, refused, home };
  };

  it('answers configured even though the FLEET io refuses every .ccrc path', async () => {
    at(NOW);
    const f = fixtureRemote();
    await f.watcher.sweepReadiness();
    expect(f.watcher.currentReadiness()?.boxToken).toBe('configured');
  });

  it('never asks the FLEET io for the token at all', async () => {
    at(NOW);
    const f = fixtureRemote();
    await f.watcher.sweepReadiness();
    expect(f.refused.filter((p) => p.endsWith('mail.token'))).toEqual([]);
  });

  it('a verdict of ready is REACHABLE on this topology', async () => {
    // The whole point of MAJOR 1: not that one field reads better, but that
    // the aggregate can reach its positive answer on the live fleet at all.
    at(NOW);
    const f = fixtureRemote();
    // Plant both skills in every homeAble HOME so the wire half is clean too.
    for (const suffix of HOME_ABLE_SUFFIXES) {
      for (const dir of ['ccrc-worker', 'ccrc-coordinator']) {
        mkdirSync(path.join(f.home, suffix, 'skills', dir), { recursive: true });
      }
    }
    await f.watcher.sweepReadiness();
    const r = f.watcher.currentReadiness();
    expect(r?.worker).toBe('present');
    expect(r?.coordinator).toBe('present');
    expect(r?.boxToken).toBe('configured');
    expect(r?.coordDb).toBe('available');
  });

  it('the token VALUE never reaches the cached readiness', async () => {
    at(NOW);
    const f = fixtureRemote();
    await f.watcher.sweepReadiness();
    expect(JSON.stringify(f.watcher.currentReadiness()))
      .not.toContain('a-real-looking-token-value');
  });
});
