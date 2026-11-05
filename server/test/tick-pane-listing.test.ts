// The watcher tick asks tmux once (console speed S1, Step 4). RED before the tick uses `Tmux.listPanes`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LIVE, STOPPED, ARCHIVED, CRASHED, pidOf, makeHarness } from './tickListingHarness.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('FleetWatcher.tick with one tmux listing (console speed S1)', () => {
  it('one list-panes -a per tick and no has-session or per-row list-panes', async () => {
    const h = makeHarness();
    await h.watcher.tick();
    expect(h.calls.listPanesAll).toBe(1);
    expect(h.calls.hasSession).toBe(0);
    expect(h.calls.listPanesRow).toBe(0);
    h.reset();
    await h.watcher.tick();
    expect(h.calls.listPanesAll).toBe(1);
    expect(h.calls.hasSession).toBe(0);
    expect(h.calls.listPanesRow).toBe(0);
  });

  it('capture-pane runs for live rows only', async () => {
    const h = makeHarness();
    await h.watcher.tick();
    expect(h.calls.capture.slice().sort()).toEqual([...LIVE].sort());
    expect(h.calls.capture).not.toContain(STOPPED[0]);
    expect(h.calls.capture).not.toContain(ARCHIVED);
    expect(h.calls.capture).not.toContain(CRASHED);
  });

  it('a failed listing falls back per row and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness({ listing: 'fail' });
    await h.watcher.tick();
    // The old way: a has-session per row, a capture per row, and no row goes from live to dead.
    expect(h.calls.hasSession).toBe(6);
    expect(h.calls.capture).toHaveLength(6);
    const first = h.frames.at(-1)!;
    expect(first.filter((s) => s.status !== 'dead').map((s) => s.id).sort()).toEqual([...LIVE].sort());
    await h.watcher.tick();
    const notices = warn.mock.calls.filter((c) => String(c[0]).includes('ccrc-server:') && String(c[0]).includes('list-panes'));
    expect(notices).toHaveLength(1);
    expect(String(notices[0]![0])).toContain('error connecting to tmux');
  });

  it("a live row's live-state read uses the pid the listing gave", async () => {
    const h = makeHarness();
    await h.watcher.tick();
    // assembleFleet hands the listing's pid to the live-state reader: it reads <configDir>/sessions/<pid>.json.
    for (const id of LIVE) expect(h.reads.some((p) => p.endsWith(`/sessions/${pidOf(id)}.json`))).toBe(true);
    expect(h.calls.listPanesRow).toBe(0);
  });

  it('the failure latch resets on an ok listing: fail, ok, fail warns twice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness({ listing: 'fail' });
    const notices = (): number => warn.mock.calls.filter((c) => String(c[0]).includes('list-panes failed')).length;
    await h.watcher.tick();
    expect(notices()).toBe(1);
    h.state.listing = 'ok';
    await h.watcher.tick();
    expect(notices()).toBe(1);
    h.state.listing = 'fail';
    await h.watcher.tick();
    expect(notices()).toBe(2);
  });

  it('a listing that throws falls back per row, like a failed one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness();
    (h.watcher as unknown as { deps: { tmux: { listPanes: () => Promise<never> } } }).deps.tmux.listPanes = async () => { throw new Error('boom'); };
    await h.watcher.tick();
    expect(h.calls.hasSession).toBe(6);
  });

  it('the listing path and the per-row fallback emit the same frame', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listed = makeHarness();
    const fallback = makeHarness({ listing: 'fail' });
    await listed.watcher.tick(); await listed.watcher.tick();
    await fallback.watcher.tick(); await fallback.watcher.tick();
    expect(listed.frames).toHaveLength(1);
    expect(JSON.stringify(listed.frames[0])).toBe(JSON.stringify(fallback.frames[0]));
  });

  it('a listing that never answers is a failed listing after 10 s and the tick falls back per row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const h = makeHarness({ listing: 'hang' });
      const tick = h.watcher.tick();
      let done = false;
      void tick.then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(h.calls.hasSession).toBe(0);   // the deadline has not fired: no row fell back yet
      await vi.advanceTimersByTimeAsync(1);
      await tick;
      expect(done).toBe(true);
      expect(h.calls.listPanesAll).toBe(1);
      expect(h.calls.hasSession).toBe(6);
      expect(h.calls.capture).toHaveLength(6);
      expect(h.frames.at(-1)!.filter((s) => s.status !== 'dead').map((s) => s.id).sort()).toEqual([...LIVE].sort());
      const notices = warn.mock.calls.filter((c) => String(c[0]).includes('list-panes') && String(c[0]).includes('did not answer within 10 s'));
      expect(notices).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('the tick times the listing from its start and the Finished loop as a whole (health().tick.phases)', async () => {
    const h = makeHarness({ listingDelayMs: 60, perf: true });
    await h.watcher.tick();   // priming
    const w = h.watcher as unknown as {
      prevStatus: Map<string, string>; episodeBusySince: Map<string, number>;
      finishedEvidence: () => Promise<boolean>;
    };
    w.prevStatus.set(LIVE[0]!, 'busy');
    w.episodeBusySince.set(LIVE[0]!, 1);
    w.finishedEvidence = async () => { await new Promise((r) => setTimeout(r, 60)); return false; };
    await h.watcher.tick();
    const phases = h.watcher.perfHealth()!.tick.phases;
    expect(phases.listing!.lastMs).toBeGreaterThanOrEqual(40);   // the wait for tmux, not 0 ms after the registry read
    expect(phases.finished!.lastMs).toBeGreaterThanOrEqual(40);  // the loop's awaits, inside the phase
  });
});
