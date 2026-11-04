// Cold rows cost the tick nothing (console speed S1, Step 4). RED before the tick passes the row cache.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { usageSidecarPath } from '../src/usage.js';
import { LIVE, STOPPED, STAMP, makeHarness } from './tickListingHarness.js';

afterEach(() => { vi.useRealTimers(); });

describe('FleetWatcher.tick cold rows (console speed S1)', () => {
  it('a stopped child costs no field reads, no hook-state read and no capture on a quiet tick', async () => {
    const h = makeHarness();
    await h.watcher.tick();
    h.reset();
    await h.watcher.tick();
    for (const id of STOPPED) expect(h.readsOf(id)).toEqual([]);
    expect(h.calls.capture.some((id) => STOPPED.includes(id))).toBe(false);
    // The live rows are still read every tick.
    expect(h.readsOf(LIVE[0]!).length).toBeGreaterThan(0);
  });

  it('a restart is seen on the next tick', async () => {
    const h = makeHarness();
    await h.watcher.tick();
    await h.watcher.tick();
    const id = STOPPED[0]!;
    expect(h.frames.at(-1)!.find((s) => s.id === id)!.status).toBe('dead');
    // The session appears in the listing (and its stamp is cleared, as a restart does).
    h.state.live.add(id);
    writeFileSync(path.join(h.reg, `${id}.stopped`), '');
    h.reset();
    await h.watcher.tick();
    expect(h.readsOf(id).length).toBeGreaterThan(0);
    expect(h.calls.capture).toContain(id);
    expect(h.frames.at(-1)!.find((s) => s.id === id)!.status).not.toBe('dead');
  });

  it('a cold row is re-read after 30 s', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const h = makeHarness();
    await h.watcher.tick();
    await h.watcher.tick();
    h.reset();
    await h.watcher.tick();
    expect(h.readsOf(STOPPED[0]!)).toEqual([]);
    vi.setSystemTime(Date.now() + 31_000);
    h.reset();
    await h.watcher.tick();
    expect(h.readsOf(STOPPED[0]!).length).toBeGreaterThan(0);
  });

  it('cold rows keep their previous hook-state and usage entries', async () => {
    const h = makeHarness();
    const [a, b] = STOPPED as [string, string];
    writeFileSync(path.join(h.reg, `${a}.hookstate.json`), JSON.stringify({
      v: 1, state: 'working', event: 'PreToolUse', sessionId: `uuid-${a}`, pid: 4100, updatedAt: Date.now(), ask: null, subagents: [],
    }));
    mkdirSync(path.dirname(usageSidecarPath(h.reg, b)), { recursive: true });
    writeFileSync(usageSidecarPath(h.reg, b), JSON.stringify({ ts: STAMP, model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost: 1.25 }));
    await h.watcher.tick();
    await h.watcher.tick();   // the rows are cold from here
    const hook = (h.watcher as unknown as { hookStates: Map<string, unknown> }).hookStates.get(a);
    const usage = h.watcher.currentUsage().get(b);
    expect(hook).toBeDefined();
    expect(usage).toBeDefined();
    h.reset();
    await h.watcher.tick();
    expect(h.readsOf(a)).toEqual([]);
    expect(h.readsOf(b)).toEqual([]);
    expect((h.watcher as unknown as { hookStates: Map<string, unknown> }).hookStates.get(a)).toEqual(hook);
    expect(h.watcher.currentUsage().get(b)).toEqual(usage);
  });
});
