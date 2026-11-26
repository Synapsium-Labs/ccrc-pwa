// Landing order wave 5k, Task 6: `useLandingLines` (`fleet/useLandingLines.ts`, L4), the one read of every card project's
// line on the one poll primitive (D-9108): one read per distinct project per mount, tick, return to the page, change of the
// project set (R4) or reload; one project's failure never drops another's answer; an unchanged line keeps its object.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { LandingEntry, LandingLineView } from '../../shared/landingLine';
import { LANDING_LINE_POLL_MS, useLandingLines, type LandingLineReader } from '../src/fleet/useLandingLines';

/** Every raw a request landed with, captured through a pass-through wrapper of the one poll primitive. */
const landedRaw: unknown[] = [];
vi.mock('../src/lib/usePoll', async (orig) => {
  const m = await orig<typeof import('../src/lib/usePoll')>();
  return { ...m, usePoll: (o: Parameters<typeof m.usePoll>[0]) => m.usePoll({ ...o, onOutcome: (out, i) => { if (out.ok) landedRaw.push(out.raw); o.onOutcome(out, i); } }) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

const e = (pr: number, over: Partial<LandingEntry> = {}): LandingEntry => ({
  id: pr + 900, project: 'project-a', pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'c'.repeat(40), runId: pr, state: 'pinned', baseSha: null,
  ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: 1000 + pr, ...over });
const answer = (project: string, entries: LandingEntry[], extra: Record<string, unknown> = {}): unknown => ({
  ok: true, project, operatorPaused: false, mainRedHold: false, entries,
  order: { paused: false, order: entries, head: entries[0] ?? null }, ...extra,
} satisfies { ok: true } & LandingLineView & Record<string, unknown>);

/** A fake reader: counts calls per project, answers from a table the test may change, records each signal. */
function fake(table: Record<string, () => unknown>) {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const read: LandingLineReader = (project, signal) => {
    calls.push(project);
    signals.push(signal);
    const f = table[project];
    return f === undefined ? Promise.reject(new Error('no such project')) : Promise.resolve(f());
  };
  const count = (p?: string): number => (p === undefined ? calls.length : calls.filter((c) => c === p).length);
  return { read, calls, signals, count, table };
}
const twoLines = () => fake({ 'project-a': () => answer('project-a', [e(101)]), 'project-b': () => answer('project-b', [e(201, { project: 'project-b' })]) });

describe('useLandingLines (wave 5k, D-9108)', () => {
  it('on mount reads each distinct project once, and the project-set effect adds no second read', async () => {
    const f = twoLines();
    renderHook(() => useLandingLines({ projects: ['project-b', 'project-a', 'project-a'], read: f.read }));
    await flush();
    expect([...f.calls].sort()).toEqual(['project-a', 'project-b']);
  });

  it('a re-render with the same set reads nothing; after 60 s every project is read once more, and not before', async () => {
    vi.useFakeTimers();
    const f = twoLines();
    const { rerender } = renderHook(({ p }) => useLandingLines({ projects: p, read: f.read }), { initialProps: { p: ['project-a', 'project-b'] } });
    await flush();
    rerender({ p: ['project-a', 'project-b'] });
    rerender({ p: ['project-b', 'project-a'] });
    await flush();
    expect(f.count()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(LANDING_LINE_POLL_MS - 1); });
    expect(f.count()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect([f.count('project-a'), f.count('project-b')]).toEqual([2, 2]);
    expect(LANDING_LINE_POLL_MS).toBe(60_000);
  });

  it('a cold load: mounted with no projects, then the list arrives, reads both at once, before any tick (R4)', async () => {
    vi.useFakeTimers();
    const f = twoLines();
    const { result, rerender } = renderHook(({ p }) => useLandingLines({ projects: p, read: f.read }), { initialProps: { p: [] as string[] } });
    await flush();
    expect(f.count()).toBe(0);
    rerender({ p: ['project-a', 'project-b'] });
    await flush();
    expect([...f.calls].sort()).toEqual(['project-a', 'project-b']);
    expect([...result.current.states.keys()].sort()).toEqual(['project-a', 'project-b']);
  });

  it('a project that joins is read at once, with every other project; one that leaves leaves the map', async () => {
    const f = fake({ 'project-a': () => answer('project-a', [e(101)]), 'project-b': () => answer('project-b', [e(201)]),
      'project-c': () => answer('project-c', [e(301)]) });
    const { result, rerender } = renderHook(({ p }) => useLandingLines({ projects: p, read: f.read }), { initialProps: { p: ['project-a', 'project-b'] } });
    await flush();
    rerender({ p: ['project-a', 'project-b', 'project-c'] });
    await flush();
    expect([f.count('project-a'), f.count('project-b'), f.count('project-c')]).toEqual([2, 2, 1]);
    expect(result.current.states.get('project-c')?.kind).toBe('line');
    rerender({ p: ['project-a', 'project-c'] });
    await flush();
    expect([...result.current.states.keys()].sort()).toEqual(['project-a', 'project-c']);
  });

  it('the request\'s raw is a Map with one PollOutcome per project read', async () => {
    landedRaw.length = 0;
    const f = twoLines();
    renderHook(() => useLandingLines({ projects: ['project-a', 'project-b', 'project-x'], read: f.read }));
    await flush();
    expect(landedRaw).toHaveLength(1);
    const raw = landedRaw[0] as Map<string, { ok: boolean }>;
    expect(raw).toBeInstanceOf(Map);
    expect([...raw.keys()]).toEqual(['project-a', 'project-b', 'project-x']);
    expect([...raw.values()].map((o) => o.ok)).toEqual([true, true, false]);
    expect(raw.get('project-a')).toEqual({ ok: true, raw: answer('project-a', [e(101)]) });
  });

  it('a return to the page reads every project once', async () => {
    const f = twoLines();
    renderHook(() => useLandingLines({ projects: ['project-a', 'project-b'], read: f.read }));
    await flush();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect([f.count('project-a'), f.count('project-b')]).toEqual([2, 2]);
  });

  it('a reader that throws synchronously settles as that project\'s failure; the other still gets its line', async () => {
    const f = twoLines();
    const read: LandingLineReader = (p, s) => { if (p === 'project-a') throw new Error('no landingLine on this mock'); return f.read(p, s); };
    const { result } = renderHook(() => useLandingLines({ projects: ['project-a', 'project-b'], read }));
    await flush();
    expect(result.current.states.get('project-a')).toEqual({ kind: 'none' });
    expect(result.current.states.get('project-b')?.kind).toBe('line');
  });

  it('one project\'s rejection leaves the other\'s line in place', async () => {
    const f = twoLines();
    const { result } = renderHook(() => useLandingLines({ projects: ['project-a', 'project-b'], read: f.read }));
    await flush();
    const b = result.current.states.get('project-b');
    f.table['project-a'] = () => { throw new Error('down'); };
    act(() => { result.current.reload(); });
    await flush();
    expect(result.current.states.get('project-b')).toBe(b);
    expect(result.current.states.get('project-a')).toMatchObject({ kind: 'line', stale: { scope: 'box' } });
  });

  it('an answer equal under sameLandingState keeps the same object; a changed answer replaces only that project\'s', async () => {
    const binding = (t: string) => ({ binding: { mode: 'ready', entryId: 1001, pr: 101, pinnedSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), landerAt: t, probeAt: t, healthAt: t, fixesMain: false } });
    let tick = 't1';
    let pin = 1101;
    const f = fake({ 'project-a': () => answer('project-a', [e(101, { pinnedAt: pin })], binding(tick)), 'project-b': () => answer('project-b', [e(201)]) });
    const { result } = renderHook(() => useLandingLines({ projects: ['project-a', 'project-b'], read: f.read }));
    await flush();
    const first = result.current.states;
    const [a1, b1] = [first.get('project-a'), first.get('project-b')];
    tick = 't2';
    act(() => { result.current.reload(); });
    await flush();
    expect(result.current.states.get('project-a')).toBe(a1);   // only the binding's times differ
    expect(result.current.states).toBe(first);                  // and nothing changed, so the map is kept too
    pin = 1999;                                                   // only one entry's pinnedAt differs
    act(() => { result.current.reload(); });
    await flush();
    expect(result.current.states.get('project-a')).not.toBe(a1);
    expect(result.current.states.get('project-b')).toBe(b1);
  });

  it('reload() reads every project once and keeps its identity across renders', async () => {
    const f = twoLines();
    const { result, rerender } = renderHook(() => useLandingLines({ projects: ['project-a', 'project-b'], read: f.read }));
    await flush();
    const reload = result.current.reload;
    rerender();
    expect(result.current.reload).toBe(reload);
    act(() => { reload(); });
    await flush();
    expect([f.count('project-a'), f.count('project-b')]).toEqual([2, 2]);
  });

  it('unmounting aborts the reads in flight', async () => {
    const signals: AbortSignal[] = [];
    const read: LandingLineReader = (_p, signal) => { signals.push(signal); return new Promise(() => {}); };
    const { unmount } = renderHook(() => useLandingLines({ projects: ['project-a', 'project-b'], read }));
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});
