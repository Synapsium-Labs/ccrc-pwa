import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { PerfRecorder, timed } from '../src/perf/recorder.js';
import { bootAgent, connectToAgent, makeFixture, type RemoteFixture } from './remoteHelpers.js';
import type { RunningAgent } from '../../agent/src/server.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const perfLines = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map((c) => String(c[0])).filter((l: string) => l.startsWith('ccrc-server: perf'));

describe('PerfRecorder (console speed S1)', () => {
  it('a tick over its interval logs one line', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new PerfRecorder();
    p.tickDone(100, 2000);
    expect(perfLines(warn)).toHaveLength(0);
    p.tickDone(2500, 2000);
    expect(perfLines(warn)).toHaveLength(1);
    expect(p.health(Date.now()).tick.overIntervalCount).toBe(1);
  });

  it('eleven slow routes in a minute log ten lines and count the eleventh', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new PerfRecorder();
    for (let i = 0; i < 11; i++) p.route('GET', `/r${i}`, 700);
    expect(perfLines(warn)).toHaveLength(10);
    p.start();
    vi.advanceTimersByTime(60_000);
    const summary = perfLines(warn).at(-1)!;
    expect(summary).toContain('suppressed=1');
    p.stop();
    expect(p.health(Date.now()).slowRoutes).toHaveLength(11);
  });

  it('the event-line window runs on the monotonic clock, not the wall clock', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let wall = 1_700_000_000_000;
    let mono = 5_000;
    const p = new PerfRecorder({ now: () => wall, monotonic: () => mono });
    const burst = (n: number): void => { for (let i = 0; i < n; i++) p.route('GET', `/r${i}`, 700); };
    burst(10);
    expect(perfLines(warn)).toHaveLength(10);
    wall -= 3_600_000;               // the wall clock steps back an hour
    burst(5);
    expect(perfLines(warn)).toHaveLength(10);   // still limited to ten per window
    mono += 60_000;                  // 60 s of monotonic time: the window resets
    burst(3);
    expect(perfLines(warn)).toHaveLength(13);
  });

  it('health() has every field after one tick', () => {
    vi.useFakeTimers();
    const p = new PerfRecorder();
    p.phase('hooks', 5);
    p.tickDone(40, 2000);
    p.link('readdir', 9);
    const h = p.health(Date.now());
    expect(h.since).toBeTypeOf('number');
    expect(h.tick).toMatchObject({ count: 1, lastMs: 40, p50Ms: 40, p95Ms: 40, maxMs: 40, overIntervalCount: 0, phases: { hooks: { lastMs: 5, p95Ms: 5 } } });
    expect(h.link['readdir']).toEqual({ count: 1, p50Ms: 9, p95Ms: 9, maxMs: 9 });
    expect(h.loop).toBeNull();
    expect(h.slowRoutes).toEqual([]);
  });

  it('stop() clears the timer and the monitor', () => {
    vi.useFakeTimers();
    const hist = { enable: vi.fn(), disable: vi.fn(), reset: vi.fn(), count: 0, percentile: () => 0, max: 0 };
    const p = new PerfRecorder({ monitor: () => hist });
    p.start();
    expect(vi.getTimerCount()).toBe(1);
    expect(hist.enable).toHaveBeenCalledTimes(1);
    p.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(hist.disable).toHaveBeenCalledTimes(1);
  });

  it('timed() records the phase and rethrows a rejection after recording', async () => {
    const p = new PerfRecorder();
    expect(await timed(p, 'a', Promise.resolve(3))).toBe(3);
    await expect(timed(p, 'b', Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(Object.keys(p.health(Date.now()).tick.phases).sort()).toEqual(['a', 'b']);
    expect(await timed(undefined, 'c', Promise.resolve(1))).toBe(1);
  });
});

describe('the client round trip (console speed S1)', () => {
  let agent: RunningAgent | undefined;
  let fixture: RemoteFixture | undefined;
  afterEach(async () => {
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) { rmSync(fixture.home, { recursive: true, force: true }); rmSync(fixture.projectsRoot, { recursive: true, force: true }); }
    fixture = undefined;
  });

  it('the client calls onRoundTrip once per settled request with exec:<cmd>, never arguments', async () => {
    fixture = makeFixture();
    agent = await bootAgent(fixture);
    const seen: Array<[string, number]> = [];
    const fleet = connectToAgent(agent.port, { onRoundTrip: (op, ms) => { seen.push([op, ms]); } });
    try {
      await vi.waitFor(() => expect(fleet.state.connected).toBe(true));
      seen.length = 0;
      await fleet.client.request({ t: 'req', op: 'readdir', path: fixture.projectsRoot });
      await fleet.client.request({ t: 'req', op: 'exec', cmd: 'definitely-not-a-command', args: ['SECRET-ARG'], timeoutMs: 2000 }).catch(() => {});
      await fleet.client.request({ t: 'req', op: 'read', path: `${fixture.projectsRoot}/nope` }).catch(() => {});
      expect(seen.map(([op]) => op)).toEqual(['readdir', 'exec:definitely-not-a-command', 'read']);
      expect(JSON.stringify(seen)).not.toContain('SECRET-ARG');
      for (const [, ms] of seen) expect(ms).toBeGreaterThanOrEqual(0);
    } finally { await fleet.close(); }
  });
});
