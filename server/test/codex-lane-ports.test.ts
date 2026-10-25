// The fixture's port allocator (D-6856).
// A port is chosen free, released, and bound LATER by a listener or by ccrc, so
// a parallel test in the same CI shard can take it in between. The kernel hands
// a port-0 bind its ephemeral range; `freePort` therefore chooses outside it,
// outside `shutdown-seal.test.ts`'s fixed band, and from a slice no other live
// vitest worker draws from.
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freePort, freePorts, poolSlot, portAllocator, PORT_SLICE, PORT_SLICES, SEAL_PORTS } from './codexLaneFixture.js';

/** The lowest ephemeral port any supported kernel uses (Linux 32768). */
const EPHEMERAL_FLOOR = 32768;

const held: Server[] = [];
afterEach(() => { for (const s of held.splice(0)) s.close(); });

function bindZero(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      held.push(s);
      resolve((s.address() as { port: number }).port);
    });
  });
}

describe('codexLaneFixture ports — a chosen port is not one the kernel hands out next', () => {
  it('freePort returns ports below the kernel ephemeral range', async () => {
    for (let i = 0; i < 20; i++) expect(await freePort()).toBeLessThan(EPHEMERAL_FLOOR);
  });

  it('a port-0 bind never lands on a port freePort handed out and released', async () => {
    const chosen = new Set<number>();
    for (let i = 0; i < 30; i++) chosen.add(await freePort());
    for (let i = 0; i < 300; i++) expect(chosen.has(await bindZero())).toBe(false);
  });

  it('freePort never repeats a port within the process, and freePorts stays distinct', async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const p = await freePort();
      expect(seen.has(p)).toBe(false);
      seen.add(p);
    }
    const four = await freePorts(4);
    expect(new Set(four).size).toBe(4);
  });

  it('the seal suite\'s fixed band is never in any slice', async () => {
    // shutdown-seal.test.ts: `26000 + (process.pid % 3000)`.
    expect(SEAL_PORTS).toEqual([26_000, 29_000]);
    for (const [lo, hi] of PORT_SLICES) expect(hi <= SEAL_PORTS[0] || lo >= SEAL_PORTS[1]).toBe(true);
    for (let i = 0; i < 50; i++) {
      const p = await freePort();
      expect(p >= SEAL_PORTS[0] && p < SEAL_PORTS[1]).toBe(false);
    }
  });
});

// Every real-port case above draws from this process's one slice, so together
// they stay well under PORT_SLICE.
describe('codexLaneFixture ports — parallel workers never share one', () => {
  const always = async () => true;
  /** Every port one slot's allocator can issue, with nothing bound anywhere. */
  async function drain(slot: number): Promise<number[]> {
    const next = portAllocator({ slot, probe: always });
    const out: number[] = [];
    for (let i = 0; i < PORT_SLICE; i++) out.push(await next());
    return out;
  }

  it('two allocators with different pool ids issue disjoint ports, every slot', async () => {
    expect(PORT_SLICES.length).toBeGreaterThanOrEqual(16);
    const owner = new Map<number, number>();
    for (let slot = 0; slot < PORT_SLICES.length; slot++) {
      for (const p of await drain(slot)) {
        expect(owner.get(p), `port ${p} issued to slots ${owner.get(p)} and ${slot}`).toBeUndefined();
        owner.set(p, slot);
        expect(p).toBeGreaterThanOrEqual(12_000);
        expect(p).toBeLessThan(EPHEMERAL_FLOOR);
        expect(p >= SEAL_PORTS[0] && p < SEAL_PORTS[1]).toBe(false);
      }
    }
  });

  it('the slot comes from VITEST_POOL_ID, so live workers land in different slices', () => {
    expect(poolSlot({ VITEST_POOL_ID: '1' })).toBe(0);
    expect(poolSlot({ VITEST_POOL_ID: '2' })).toBe(1);
    expect(poolSlot({ VITEST_POOL_ID: '3', VITEST_WORKER_ID: '9' })).toBe(2);
    expect(poolSlot({ VITEST_WORKER_ID: '4' })).toBe(3);
    expect(poolSlot({})).toBe(0);
    expect(poolSlot({ VITEST_POOL_ID: String(PORT_SLICES.length + 1) })).toBe(0);
  });

  it('the fixture\'s freePort draws from the slice its VITEST_POOL_ID names', async () => {
    vi.stubEnv('VITEST_POOL_ID', '7');
    vi.resetModules();
    try {
      const fresh = await import('./codexLaneFixture.js');
      const [lo, hi] = PORT_SLICES[6]!;
      for (let i = 0; i < 10; i++) {
        const p = await fresh.freePort();
        expect(p).toBeGreaterThanOrEqual(lo);
        expect(p).toBeLessThan(hi);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('an allocator never issues a port twice: a drained slice throws instead of repeating', async () => {
    const next = portAllocator({ slot: 0, probe: always });
    const seen = new Set<number>();
    for (let i = 0; i < PORT_SLICE; i++) seen.add(await next());
    expect(seen.size).toBe(PORT_SLICE);
    await expect(next()).rejects.toThrow(/no free port left/);
  });

  it('the walk starts at a random point in the slice, not at its floor', async () => {
    const [lo] = PORT_SLICES[5]!;
    // A fixed random value pins the arithmetic...
    expect(await portAllocator({ slot: 5, probe: always, random: () => 0.5 })()).toBe(lo + PORT_SLICE / 2);
    // ...and the real one spreads first picks across the slice.
    const firsts = new Set<number>();
    for (let i = 0; i < 20; i++) firsts.add(await portAllocator({ slot: 5, probe: always })());
    expect(firsts.size).toBeGreaterThan(5);
  });

  it('a port the probe finds taken is skipped, not issued', async () => {
    const [lo] = PORT_SLICES[0]!;
    const next = portAllocator({ slot: 0, probe: async (p) => p !== lo, random: () => 0 });
    expect(await next()).toBe(lo + 1);
  });
});
