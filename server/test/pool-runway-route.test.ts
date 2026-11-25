// `GET /api/pools/runway` (Overlord W1 serviceability PR B; the home plan's question 6): each pool's runway from the
// samples, masked (no account id), 501 without a coordination store and 503 on a read that throws, never an empty list.
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PoolRunwayWire } from '../../shared/loadLines.js';
import { parseRoster } from '../../shared/roster.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { registerPoolRunwayRoute, RUNWAY_READ_FAILED, type PoolRunwayRouteDeps } from '../src/poolRunwayRoute.js';
import type { LimitSample } from '../src/poolRunway.js';
import { buildServer } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { fakeTime } from './fakeTime.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { testDeps } from './helpers.js';

const NOW = 2_000_000_000;
const roster = parseRoster({ version: 1, accounts: [
  { id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    pool: 'pool-a', fableBilling: 'included', continuity: { recordedAt: 1 } },
  { id: 'lane-b', label: 'lane-b', configDirSuffix: '.lane-b', exec: { kind: 'generated', provider: 'anthropic' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
] });
const sample = (account: string, ago: number, pct: number): LimitSample => ({
  account, ts: NOW - ago, five: pct, seven: pct, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000, fiveRolled: false, sevenRolled: false, fiveWindowMinutes: null,
});

async function get(deps: Partial<PoolRunwayRouteDeps>) {
  const app = Fastify({ logger: false });
  const asked: { accounts: readonly string[]; sinceS: number }[] = [];
  registerPoolRunwayRoute(app, {
    roster: () => roster, limits: async () => ({}), clock: { wall: () => NOW * 1000 },
    coord: { accountPoolEdges: () => new Map(), limitSamplesSince: (accounts, sinceS) => { asked.push({ accounts, sinceS }); return [sample('lane-a', 60, 99), sample('lane-b', 60, 10)]; } },
    ...deps,
  });
  const res = await app.inject({ method: 'GET', url: '/api/pools/runway' });
  await app.close();
  return { res, asked };
}

it('the composed server reads the ladder load from the watcher and the runway history from its store', async () => {
  const fixture = testDeps();
  const db = openCoordDb(':memory:');
  const coord = new CoordStore(db);
  const bus = new Bus();
  const deps = { ...fixture, cfg: { ...fixture.cfg, roster }, coord, time: fakeTime({ wallMs: NOW * 1000 }).ports };
  const watcher = quietAtTestEnd(new FleetWatcher(deps, bus, 2000));
  const cachedLimits = vi.spyOn(watcher, 'currentLimits');
  const setLiveLoad = (pct: number) => cachedLimits.mockReturnValue({ listedAt: NOW * 1000, limits: {
    'lane-a': { five: pct, seven: pct, ts: NOW - 30, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000,
      fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false },
  } });
  try {
    db.exec(`INSERT INTO overlord_designation (id, sessionId, generation, term, designatedTerm, model, accountPools, actor, updatedAt)
      VALUES (1, 'overlord-a', 'generation-a', 1, 1, 'opus', '{"pools":["pool-a"],"untagged":false}', 'actor', 1)`);
    coord.insertLimitSamples([sample('lane-a', 60, 99)], NOW);
    const app = await buildServer(deps, bus, watcher);
    try {
      const ladder = async () => {
        const res = await app.inject('/api/overlord/ladder');
        expect(res.statusCode).toBe(200);
        return res.json().conditions.find((c: { cause: string }) => c.cause === 'load-past-95');
      };
      setLiveLoad(96);
      expect(await ladder()).toMatchObject({ reading: 'standing' });
      setLiveLoad(94);
      expect(await ladder()).toMatchObject({ reading: 'lifted' });

      const runway = await app.inject('/api/pools/runway');
      expect(runway.statusCode).toBe(200);
      const body = runway.json<PoolRunwayWire>();
      expect(body.nowS).toBe(NOW);
      expect(body.pools.find((p) => p.pool === 'pool-a')?.runway.earliestReset).toEqual({ kind: 'at', atS: NOW + 300_000 });
    } finally { await app.close(); }
  } finally { db.close(); }
});

describe('GET /api/pools/runway', () => {
  it('answers each pool\'s runway, the untagged accounts under null, and names no account', async () => {
    const { res, asked } = await get({});
    expect(res.statusCode).toBe(200);
    const body = res.json() as PoolRunwayWire;
    expect(body.nowS).toBe(NOW);
    expect(body.pools.map((p) => [p.pool, p.runway.earliestReset])).toEqual([
      ['pool-a', { kind: 'at', atS: NOW + 9_000 + 291_000 }], [null, { kind: 'none-exhausted' }],
    ]);
    expect(res.body).not.toMatch(/lane-/);
    expect(asked).toEqual([{ accounts: ['lane-a', 'lane-b'], sinceS: NOW - 604_800 }]);
  });
  it('a disabled account is in no pool', async () => {
    const { res } = await get({ limits: async () => ({ 'lane-a': { disabled: true } as never }) });
    expect((res.json() as PoolRunwayWire).pools.map((p) => p.pool)).toEqual([null]);
  });
  it('no coordination store: 501 not-configured', async () => {
    const { res } = await get({ coord: undefined });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });
  it('a read that throws is a 503, never an empty list, naming the read in a fixed word and never the thrown text (review 3330 F6)', async () => {
    const gone = (): never => { throw new Error('disk gone: /tmp/fixture/.ccrc/coord.db lane-a'); };
    const cases: [Partial<PoolRunwayRouteDeps>, string][] = [
      [{ limits: async () => gone() }, RUNWAY_READ_FAILED.limits],
      [{ coord: { accountPoolEdges: gone, limitSamplesSince: () => [] } }, RUNWAY_READ_FAILED.edges],
      [{ coord: { accountPoolEdges: () => new Map(), limitSamplesSince: gone } }, RUNWAY_READ_FAILED.samples],
    ];
    for (const [deps, detail] of cases) {
      const { res } = await get(deps);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, error: 'unavailable', detail });
      expect(res.body).not.toMatch(/disk gone|fixture|lane-/);
    }
  });
});
