// GET /api/host — the one door the tile has.
import { describe, it, expect } from 'vitest';
import { hostStatFailed, type HostStat } from '../../shared/hoststat.js';
import type { HostStatPort } from '../src/hoststat.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const fixed: HostStat = {
  at: 1_700_000_000_000,
  cpu: { ok: true, total: 34, perCpu: [{ id: 0, pct: 91 }, { id: 1, pct: 12 }], windowMs: 6000 },
  mem: { ok: true, totalKb: 16000000, usedKb: 9200000, cacheKb: 4800000, availableKb: 6000000, swapTotalKb: 2000000, swapUsedKb: 500000 },
};

async function get(port?: HostStatPort): Promise<{ code: number; body: HostStat }> {
  const home = mkTmp('ccrc-host-route-');
  const app = await buildServer({ ...testDeps(home), ...(port ? { hostStat: port } : {}) });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/host' });
    return { code: res.statusCode, body: res.json() as HostStat };
  } finally {
    await app.close();
  }
}

describe('GET /api/host', () => {
  it('answers the reading its port produced, per-CPU list intact', async () => {
    const { code, body } = await get({ read: async () => fixed });
    expect(code).toBe(200);
    // Whole, not pre-reduced to the two hottest: the reduction is a rendering
    // decision, and an adapter may not narrow a distinction it received.
    expect(body).toEqual(fixed);
  });

  it('answers 200 with a NAMED failure when there is no reading to be had', async () => {
    // Not a 500 and not an empty body: "the agent is too old" is something the
    // operator has to be able to read off the tile.
    const { code, body } = await get({ read: async () => hostStatFailed('unsupported', 1) });
    expect(code).toBe(200);
    expect(body.cpu.ok === false && body.cpu.why).toBe('unsupported');
    expect(body.mem.ok === false && body.mem.why).toBe('unsupported');
  });

  it('is mounted even on a Deps with no host port, and says which condition that is', async () => {
    const { code, body } = await get();
    expect(code).toBe(200);
    expect(body.cpu.ok === false && body.cpu.why).toBe('unsupported');
  });
});
