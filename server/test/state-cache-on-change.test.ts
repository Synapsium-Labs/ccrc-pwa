// The state cache is written only on change (console speed S1, Step 6). The watcher keeps the snapshot it last wrote in
// memory, loads the file once, and the shrink rule reads that memory, not the file. Reads and writes of the cache file
// are counted at `node:fs/promises` (the module `fleetstate.ts` uses), so the test does not depend on a spy on ESM.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeHarness } from './tickListingHarness.js';

const count = { reads: 0, writes: 0 };
let cacheFile = '';
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (p: string, ...r: unknown[]) => {
      if (p === cacheFile) count.reads += 1;
      return (actual.readFile as (...a: unknown[]) => Promise<never>)(p, ...r);
    },
    rename: async (from: string, to: string) => {
      if (to === cacheFile) count.writes += 1;
      return actual.rename(from, to);
    },
  };
});

const plantRow = (reg: string, id: string): void => {
  const fields: Record<string, string> = { wrapper: 'claude', project: id, workdir: `/data/projects/${id}`, uuid: `uuid-${id}`, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

beforeEach(() => { count.reads = 0; count.writes = 0; });

describe('the state cache is written only on change (console speed S1, Step 6)', () => {
  it('two identical ticks write once', async () => {
    const h = makeHarness();
    cacheFile = h.cachePath;
    await h.watcher.tick();
    await h.watcher.tick();
    expect(count.writes).toBe(1);
  });

  it('a changed tick writes again', async () => {
    const h = makeHarness();
    cacheFile = h.cachePath;
    await h.watcher.tick();
    plantRow(h.reg, 'lane-a-project-c');
    await h.watcher.tick();
    expect(count.writes).toBe(2);
  });

  it('the shrink rule reads the in-memory last snapshot, not the file', async () => {
    const h = makeHarness();
    cacheFile = h.cachePath;
    await h.watcher.tick();
    plantRow(h.reg, 'lane-a-project-c');
    await h.watcher.tick();
    // A row whose files all left the registry: a genuine purge, so the shrink is written.
    for (const f of ['wrapper', 'project', 'workdir', 'uuid', 'started']) rmSync(path.join(h.reg, `lane-a-project-c.${f}`));
    await h.watcher.tick();
    await h.watcher.tick();
    expect(count.writes).toBe(3);
    // The file was read once, at prime; the shrink check on the third tick consulted memory.
    expect(count.reads).toBe(1);
  });

  it('an unmeasured row still skips the write', async () => {
    const h = makeHarness();
    cacheFile = h.cachePath;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await h.watcher.tick();
    expect(count.writes).toBe(1);
    // A row with a blank wrapper is assembled with an unmeasured identity field: the cache must not persist the guess.
    writeFileSync(path.join(h.reg, 'lane-a-project-a.wrapper'), '');
    await h.watcher.tick();
    expect(count.writes).toBe(1);
    expect(warn.mock.calls.filter(([m]) => typeof m === 'string' && m.includes('snapshot write skipped'))).toHaveLength(1);
    warn.mockRestore();
  });
});
