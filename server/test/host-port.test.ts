// The port between `GET /api/host` and whichever box actually has the /proc.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HostStat } from '../../shared/hoststat.js';
import { HOST_REQUEST_TIMEOUT_MS, cachedHostStat, localHostStat, remoteHostStat } from '../src/hoststat.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

const MEMINFO = [
  'MemTotal:       16000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          500000 kB',
  'Cached:          4000000 kB',
  'SwapTotal:       2000000 kB',
  'SwapFree:        1500000 kB',
  'SReclaimable:     500000 kB',
  'Shmem:            200000 kB',
].join('\n');

const STAT_A = [
  'cpu  1000 0 500 8000 100 0 0 0 0 0',
  'cpu0 500 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4000 50 0 0 0 0 0',
].join('\n');

const reading = (at: number): HostStat => ({
  at, cpu: { ok: true, total: 12, perCpu: [{ id: 0, pct: 12 }], windowMs: 6000 },
  mem: { ok: false, why: 'absent' },
});

describe('localHostStat', () => {
  it('measures a memory reading from the root it is pointed at', async () => {
    const root = path.join(mkTmp('ccrc-host-'), 'proc');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'meminfo'), MEMINFO);
    writeFileSync(path.join(root, 'stat'), STAT_A);
    const stat = await localHostStat(localIO, root).read();
    expect(stat.mem.ok && stat.mem.usedKb).toBe(9200000);
    // The static fixture's CPU counters never advance, and the sampler says so
    // instead of drawing an idle box — the guard proved here through the REAL
    // io rather than a fake probe.
    expect(stat.cpu.ok === false && stat.cpu.why).toBe('unparsable');
  });

  it('says absent — not unreadable, not zero — when the root has no /proc at all', async () => {
    const stat = await localHostStat(localIO, path.join(mkTmp('ccrc-host-'), 'nowhere')).read();
    expect(stat.cpu.ok === false && stat.cpu.why).toBe('absent');
    expect(stat.mem.ok === false && stat.mem.why).toBe('absent');
  });

  it.runIf(process.platform === 'linux')('measures this box\'s own /proc end to end', async () => {
    const stat = await localHostStat(localIO).read();
    expect(stat.cpu.ok).toBe(true);
    expect(stat.mem.ok).toBe(true);
    if (stat.cpu.ok) {
      expect(stat.cpu.perCpu.length).toBeGreaterThan(0);
      expect(stat.cpu.total).toBeGreaterThanOrEqual(0);
      expect(stat.cpu.total).toBeLessThanOrEqual(100);
    }
  });
});

describe('remoteHostStat', () => {
  // A stand-in for FleetClient: only `request` is reached from this adapter.
  const asked: { timeoutMs?: number } = {};
  const clientThat = (answer: () => Promise<unknown>) =>
    ({ request: async (_req: unknown, timeoutMs?: number) => { asked.timeoutMs = timeoutMs; return answer(); } } as unknown as Parameters<typeof remoteHostStat>[0]);

  it('asks with a budget well under the client default — four seconds, not fifteen', async () => {
    // A guard with no test is a comment: delete the second argument to
    // `client.request` and every poll against a wedged agent would wait out
    // FleetClient's 15s default instead, with the whole branch still green.
    await remoteHostStat(clientThat(async () => ({ stat: reading(1) }))).read();
    expect(asked.timeoutMs).toBe(HOST_REQUEST_TIMEOUT_MS);
    expect(HOST_REQUEST_TIMEOUT_MS).toBe(4_000);
  });

  it('carries the agent\'s reading through, restamped with this box\'s clock', async () => {
    const before = Date.now();
    const stat = await remoteHostStat(clientThat(async () => ({ stat: reading(1) }))).read();
    expect(stat.cpu.ok && stat.cpu.total).toBe(12);
    // NOT the agent's `at: 1` — the PWA compares `at` to its own clock, and
    // across two boxes that comparison is what would lie.
    expect(stat.at).toBeGreaterThanOrEqual(before);
  });

  it('names each transport failure as its own condition', async () => {
    const why = async (message: string): Promise<string> => {
      const stat = await remoteHostStat(clientThat(async () => { throw new Error(message); })).read();
      return stat.cpu.ok === false ? stat.cpu.why : 'measured';
    };
    expect(await why('timeout')).toBe('timeout');
    // `bad-request` is what an agent's validateReq answers for an op it has
    // never heard of: the AGENT-FIRST deploy lag, and nothing else.
    expect(await why('bad-request')).toBe('unsupported');
    expect(await why('disconnected')).toBe('offline');
  });

  // REVIEW FOCUS 5: version skew. A frame that arrives well-formed and carries
  // a garbled payload must not reach the PWA as a half-built reading.
  it('refuses a payload it cannot recognise rather than passing a half-built reading on', async () => {
    for (const payload of [
      {}, { stat: null }, { stat: { at: 'now', cpu: {}, mem: {} } }, { stat: { at: 1, cpu: { ok: true }, mem: { ok: true } } },
      // The one that gets PAST a guard checking only `total`/`windowMs`: a
      // well-formed frame from a peer that renamed or dropped `perCpu`. The
      // tile reads `cpu.perCpu.length` the moment it renders, so letting this
      // through is the blank console the guard exists to prevent.
      { stat: { at: 1, cpu: { ok: true, total: 12, windowMs: 6000 }, mem: { ok: true, totalKb: 1, usedKb: 1, cacheKb: 0 } } },
      // …and the same hole one level in: a list whose entries are not loads.
      { stat: { at: 1, cpu: { ok: true, total: 12, windowMs: 6000, perCpu: [{ id: 0 }] }, mem: { ok: true, totalKb: 1, usedKb: 1, cacheKb: 0 } } },
    ]) {
      const stat = await remoteHostStat(clientThat(async () => payload)).read();
      expect(stat.cpu.ok === false && stat.cpu.why).toBe('unparsable');
    }
  });
});

describe('cachedHostStat', () => {
  it('serves one reading per window — twenty phones cost the fleet box one sample', async () => {
    let calls = 0;
    const port = cachedHostStat({ read: async () => { calls++; return reading(Date.now()); } }, 60_000);
    await port.read();
    await port.read();
    await port.read();
    expect(calls).toBe(1);
  });

  it('shares one IN-FLIGHT call, which a TTL alone would not: simultaneous polls all miss together', async () => {
    let calls = 0;
    let release = (): void => {};
    const gate = new Promise<void>((r) => { release = r; });
    const port = cachedHostStat({ read: async () => { calls++; await gate; return reading(Date.now()); } }, 60_000);
    const all = Promise.all([port.read(), port.read(), port.read()]);
    release();
    await all;
    expect(calls).toBe(1);
  });

  it('turns a port that breaks its never-throw contract into a named failure, not a rejection', async () => {
    const port = cachedHostStat({ read: async () => { throw new Error('timeout'); } }, 0);
    const stat = await port.read();
    expect(stat.cpu.ok === false && stat.cpu.why).toBe('timeout');
    // And it does not wedge: the next read runs the port again rather than
    // waiting forever on a promise that already rejected.
    expect((await port.read()).cpu.ok).toBe(false);
  });
});
