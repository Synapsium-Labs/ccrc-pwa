// The fleet frame leaves straight after assembly (console speed S1, Step 5). Pools, the state cache and the lanes that
// follow the frame must not delay it; a slow pools read must not hold it. `emitRuns` needs a CoordStore, which this
// harness does not wire, so the order pinned here is fleet vs pools vs state-cache write.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeHarness } from './tickListingHarness.js';
import type { FleetIO } from '../src/io.js';

const timeline: string[] = [];
let cacheFile = '';
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (to === cacheFile) timeline.push('snapshot');
      return actual.rename(from, to);
    },
  };
});

const isPoolsPath = (p: string): boolean => p.includes(`${path.sep}pools`) || p.includes('pool-epoch');

const plantPool = (reg: string): void => {
  mkdirSync(path.join(reg, 'pools'), { recursive: true });
  writeFileSync(path.join(reg, 'pools', 'lane-a-project-a'), 'pool-a');
};

describe('the fleet frame leaves first (console speed S1, Step 5)', () => {
  it('the fleet frame is emitted before the pools read and the state-cache write', async () => {
    timeline.length = 0;
    const h = makeHarness({
      wrapIO: (io): FleetIO => ({
        ...io,
        async readdir(p, ...r) { if (isPoolsPath(p)) timeline.push('pools'); return io.readdir(p, ...r); },
        async readFileMeasured(p, ...r) { if (isPoolsPath(p)) timeline.push('pools'); return io.readFileMeasured(p, ...r); },
      }),
    });
    cacheFile = h.cachePath;
    plantPool(h.reg);
    h.bus.on('fleet', () => timeline.push('fleet'));
    await h.watcher.tick();
    expect(timeline.indexOf('fleet')).toBe(0);
    expect(timeline).toContain('pools');
    expect(timeline).toContain('snapshot');
  });

  it('a slow pools read does not delay the fleet frame', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let poolsAsked = false;
    const h = makeHarness({
      wrapIO: (io): FleetIO => ({
        ...io,
        async readdir(p, ...r) { if (isPoolsPath(p)) { poolsAsked = true; await gate; } return io.readdir(p, ...r); },
      }),
    });
    cacheFile = h.cachePath;
    plantPool(h.reg);
    const tick = h.watcher.tick();
    await vi.waitFor(() => { expect(h.frames).toHaveLength(1); }, { timeout: 500 });
    release();
    await tick;
    expect(poolsAsked).toBe(true);
  });
});
