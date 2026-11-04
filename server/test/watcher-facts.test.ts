// The watcher publishes what it measured (console speed S1, Step 7): getters stamped with the listing time, and a
// `row:<id>` event when a row's record or verdict changes. Each getter is null before the first listed tick and after
// an unlistable one.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeHarness, LIVE, STOPPED, ARCHIVED, CRASHED, pidOf } from './tickListingHarness.js';
import type { FleetIO } from '../src/io.js';

describe('the watcher publishes what it measured (console speed S1, Step 7)', () => {
  it('currentLimits carries the tick\'s limits and listedAt, and assembleFleet did not read limits twice', async () => {
    let limitsListings = 0;
    const h = makeHarness({
      wrapIO: (io): FleetIO => ({
        ...io,
        async readdir(p, ...r) { if (path.basename(p) === '.cc-limits') limitsListings += 1; return io.readdir(p, ...r); },
      }),
    });
    expect(h.watcher.currentLimits()).toBeNull();
    const before = Date.now();
    await h.watcher.tick();
    const after = Date.now();
    expect(limitsListings).toBe(1);
    const got = h.watcher.currentLimits();
    expect(got).not.toBeNull();
    expect(got!.limits).toEqual({});
    expect(got!.listedAt).toBeGreaterThanOrEqual(before);
    expect(got!.listedAt).toBeLessThanOrEqual(after);
    expect(h.watcher.currentProjectPoolsRead()?.listedAt).toBe(got!.listedAt);
    expect(h.watcher.currentProjectPoolsRead()?.read.listed).toBe(true);
  });

  it('currentProjectPoolsRead keeps the last read, with its own listedAt, while the next tick\'s read is pending', async () => {
    let hold: Promise<void> | null = null;
    let release: () => void = () => {};
    let asked = false;
    const h = makeHarness({
      wrapIO: (io): FleetIO => ({
        ...io,
        async readdir(p, ...r) { if (hold !== null && path.basename(p) === 'pools') { asked = true; await hold; } return io.readdir(p, ...r); },
      }),
    });
    mkdirSync(path.join(h.reg, 'pools'), { recursive: true });
    writeFileSync(path.join(h.reg, 'pools', LIVE[0]!), 'pool-a');
    expect(h.watcher.currentProjectPoolsRead()).toBeNull();
    await h.watcher.tick();
    const first = h.watcher.currentProjectPoolsRead();
    expect(first?.read.listed).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    hold = new Promise<void>((r) => { release = r; });
    const tick2 = h.watcher.tick();
    await vi.waitFor(() => { expect(asked).toBe(true); });
    expect(h.watcher.currentProjectPoolsRead()).toEqual(first);
    expect(h.watcher.currentLimits()!.listedAt).toBeGreaterThan(first!.listedAt);
    release();
    await tick2;
    expect(h.watcher.currentProjectPoolsRead()!.listedAt).toBe(h.watcher.currentLimits()!.listedAt);
  });

  it('currentRowFacts answers a copy with verdict and pid', async () => {
    const h = makeHarness();
    expect(h.watcher.currentRowFacts(LIVE[0]!)).toBeNull();
    await h.watcher.tick();
    const live = h.watcher.currentRowFacts(LIVE[0]!);
    expect(live).not.toBeNull();
    expect(live!.verdict.verdict).toBe('live');
    expect(live!.pid).toBe(pidOf(LIVE[0]!));
    expect(live!.record.id).toBe(LIVE[0]);
    expect(live!.listedAt).toBe(h.watcher.currentLimits()!.listedAt);
    const gone = h.watcher.currentRowFacts(STOPPED[0]!);
    expect(gone!.verdict.verdict).toBe('gone');
    expect(gone!.pid).toBeNull();
    expect(h.watcher.currentRowFacts('lane-a-nothing')).toBeNull();
    // A copy: changing it changes nothing the watcher holds.
    live!.record.project = 'changed';
    expect(h.watcher.currentRowFacts(LIVE[0]!)!.record.project).toBe(LIVE[0]);
  });

  it('row:<id> fires when the record changes and not on an unchanged tick', async () => {
    const h = makeHarness();
    await h.watcher.tick();
    const seen: Array<{ id: string; listedAt: number }> = [];
    for (const id of [...LIVE, ...STOPPED, ARCHIVED, CRASHED]) h.bus.on(`row:${id}`, (e: { listedAt: number }) => seen.push({ id, listedAt: e.listedAt }));
    await h.watcher.tick();
    expect(seen).toEqual([]);
    writeFileSync(path.join(h.reg, `${LIVE[1]}.branch`), 'ws/changed');
    await h.watcher.tick();
    expect(seen.map((s) => s.id)).toEqual([LIVE[1]]);
    expect(seen[0]!.listedAt).toBe(h.watcher.currentLimits()!.listedAt);
    await h.watcher.tick();
    expect(seen).toHaveLength(1);
  });

  it('row:<id> fires when the row leaves the listing', async () => {
    const h = makeHarness();
    await h.watcher.tick();
    const seen: string[] = [];
    h.bus.on(`row:${ARCHIVED}`, () => seen.push(ARCHIVED));
    for (const f of readdirSync(h.reg).filter((n) => n.startsWith(`${ARCHIVED}.`))) rmSync(path.join(h.reg, f));
    await h.watcher.tick();
    expect(seen).toEqual([ARCHIVED]);
    expect(h.watcher.currentRowFacts(ARCHIVED)).toBeNull();
  });

  it('every getter is null after an unlistable tick', async () => {
    let unlistable = false;
    const h = makeHarness({
      wrapIO: (io): FleetIO => ({
        ...io,
        async readdir(p, ...r) { return unlistable && path.basename(p) === '.cc-sessions' ? null : io.readdir(p, ...r); },
        async readdirMeasured(p, ...r) {
          return unlistable && path.basename(p) === '.cc-sessions' ? { ok: false as const, reason: 'unreadable' as const } : io.readdirMeasured(p, ...r);
        },
      }),
    });
    await h.watcher.tick();
    expect(h.watcher.currentLimits()).not.toBeNull();
    unlistable = true;
    await h.watcher.tick();
    expect(h.watcher.currentLimits()).toBeNull();
    expect(h.watcher.currentProjectPoolsRead()).toBeNull();
    expect(h.watcher.currentRowFacts(LIVE[0]!)).toBeNull();
  });
});
