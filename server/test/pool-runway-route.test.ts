// `GET /api/pools/runway` (Overlord W1 serviceability PR B; the home plan's question 6): each pool's runway from the
// samples, masked (no account id), 501 without a coordination store and 503 on a read that throws, never an empty list.
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { PoolRunwayWire } from '../../shared/loadLines.js';
import { parseRoster } from '../../shared/roster.js';
import { registerPoolRunwayRoute, type PoolRunwayRouteDeps } from '../src/poolRunwayRoute.js';
import type { LimitSample } from '../src/poolRunway.js';

const NOW = 2_000_000_000;
const roster = parseRoster({ version: 1, accounts: [
  { id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic', pool: 'pool-a' },
  { id: 'lane-b', label: 'lane-b', configDirSuffix: '.lane-b', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
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
  it('a read that throws is a 503, never an empty list', async () => {
    const { res } = await get({ coord: { accountPoolEdges: () => new Map(), limitSamplesSince: () => { throw new Error('disk gone'); } } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'unavailable' });
  });
});
