// Cold rows cost the tick nothing (console speed S1, Step 4). RED before the tick passes the row cache.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { usageSidecarPath, USAGE_FRESH_S } from '../src/usage.js';
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
    expect(h.readsOf(id).some((p) => p.endsWith(`${id}.hookstate.json`))).toBe(true);
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

  it('a carried usage entry turns stale on the clock while its row stays cold', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const h = makeHarness();
    const b = STOPPED[1]!;
    mkdirSync(path.dirname(usageSidecarPath(h.reg, b)), { recursive: true });
    const ts = Math.floor(Date.now() / 1000) - (USAGE_FRESH_S - 10);   // fresh for 10 more seconds
    writeFileSync(usageSidecarPath(h.reg, b), JSON.stringify({ ts, model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost: 1.25 }));
    await h.watcher.tick();
    expect(h.watcher.currentUsage().get(b)!.stale).toBe(false);
    vi.setSystemTime(Date.now() + 25_000);   // under the 30 s re-read: the row stays cold
    h.watcher.kick('usage');
    h.reset();
    await h.watcher.tick();
    expect(h.readsOf(b)).toEqual([]);   // cold: the sidecar was not read
    expect(h.watcher.currentUsage().get(b)!.stale).toBe(true);
  });

  const writeUsage = (h: ReturnType<typeof makeHarness>, id: string, cost: number): void => {
    mkdirSync(path.dirname(usageSidecarPath(h.reg, id)), { recursive: true });
    writeFileSync(usageSidecarPath(h.reg, id), JSON.stringify({ ts: Math.floor(Date.now() / 1000), model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost }));
  };

  it('a stopped row\'s changed usage sidecar shows within one usage tick once 30 s have passed since its last read', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const h = makeHarness();
    const b = STOPPED[1]!;
    writeUsage(h, b, 1.25);
    await h.watcher.tick();      // the usage lane's first run reads the sidecar
    await h.watcher.tick();      // the row is cold from here
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(1.25);
    writeUsage(h, b, 9.5);       // the final statusline write lands while the row is cold
    vi.setSystemTime(Date.now() + 31_000);
    await h.watcher.tick();      // the row's 30 s re-read is hot, but the usage lane is not due on this tick
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(1.25);
    vi.setSystemTime(Date.now() + 1_000);
    h.watcher.kick('usage');
    await h.watcher.tick();      // the row is cold again; the lane runs; the carried entry is 32 s old
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(9.5);
  });

  it('inside 30 s of its last read a cold row\'s sidecar is not read again by a lane run', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const h = makeHarness();
    const b = STOPPED[1]!;
    writeUsage(h, b, 1.25);
    await h.watcher.tick();
    await h.watcher.tick();
    writeUsage(h, b, 9.5);
    vi.setSystemTime(Date.now() + 10_000);
    h.watcher.kick('usage');
    h.reset();
    await h.watcher.tick();
    expect(h.readsOf(b)).toEqual([]);
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(1.25);
  });

  it('a lane run that only carries a cold row does not renew its read time', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const h = makeHarness();
    const b = STOPPED[1]!;
    writeUsage(h, b, 1.25);
    await h.watcher.tick();      // read at t0
    await h.watcher.tick();      // cold from here
    writeUsage(h, b, 9.5);
    vi.setSystemTime(Date.now() + 10_000);
    h.watcher.kick('usage');
    await h.watcher.tick();      // +10 s: carried, and still 1.25
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(1.25);
    vi.setSystemTime(Date.now() + 21_000);
    await h.watcher.tick();      // +31 s: the row's own re-read; the usage lane is not due
    vi.setSystemTime(Date.now() + 1_000);
    h.watcher.kick('usage');
    await h.watcher.tick();      // +32 s from the first read: due, though the +10 s run carried it
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(9.5);
  });

  it('an unreadable sidecar is not a read: the next lane run inside 30 s reads it again', async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const h = makeHarness();
    const b = STOPPED[1]!;
    const sidecar = usageSidecarPath(h.reg, b);
    writeUsage(h, b, 1.25);
    await h.watcher.tick();      // read at t0
    await h.watcher.tick();
    rmSync(sidecar);
    mkdirSync(sidecar);          // a directory where the file was: the read is unreadable
    vi.setSystemTime(Date.now() + 31_000);
    h.watcher.kick('usage');
    await h.watcher.tick();      // +31 s: the row is hot (its own re-read), the sidecar cannot be read, the old entry stays
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(1.25);
    rmSync(sidecar, { recursive: true });
    writeUsage(h, b, 9.5);
    vi.setSystemTime(Date.now() + 1_000);
    h.watcher.kick('usage');
    await h.watcher.tick();      // +32 s: the row is cold again; the failed read was no read, so the row is still due
    expect(h.watcher.currentUsage().get(b)!.cost).toBe(9.5);
  });
});
