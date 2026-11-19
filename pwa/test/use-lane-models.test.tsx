// D-8406: `useLaneModels`, the one read of `GET /api/models/:lane`. It asks only once a lane is named, shows only an
// answer for the lane it is asked about now, keeps the last good answer per lane in the screen cache, and reads a failed
// or malformed answer as nothing, so a caller shows class names.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LaneModelsRead } from '../../shared/models';
import { LANE_TRANSIENT_RETRY_MS, useLaneModels, useLaneModelsView } from '../src/lib/useLaneModels';
import { clearScreenCache, laneModelsKey, peek } from '../src/lib/screenCache';
import { ApiError } from '../src/lib/apiError';
import type { LaneModelsControl, LaneModelsReadOutcome } from '../src/lib/useLaneModels';

afterEach(() => { clearScreenCache(); vi.restoreAllMocks(); });

const readOf = (opus: string): LaneModelsRead => ({
  kind: 'read',
  classes: {
    fable: { model: 'm-fable', label: 'Fable Model', efforts: null }, opus: { model: `m-${opus}`, label: opus, efforts: null },
    sonnet: { model: 'm-sonnet', label: 'Sonnet Model', efforts: null }, haiku: { model: 'm-haiku', label: 'Haiku Model', efforts: null },
  },
});
const answer = (lane: string, models: LaneModelsRead) => ({ ok: true, lane, models });

describe('useLaneModels (D-8406)', () => {
  it('asks nothing without a lane, then asks once a lane is named and shows its answer', async () => {
    const load = vi.fn(async (lane: string) => answer(lane, readOf(`Opus of ${lane}`)));
    const { result, rerender } = renderHook(({ lane }: { lane: string | null }) => useLaneModels(lane, load),
      { initialProps: { lane: null as string | null } });
    expect(result.current).toBeNull();
    expect(load).not.toHaveBeenCalled();
    rerender({ lane: 'lane-a' });
    await waitFor(() => expect(result.current).toEqual(readOf('Opus of lane-a')));
    expect(load.mock.calls.map((c) => c[0])).toEqual(['lane-a']);
  });

  it('a move to another lane asks about it, and never shows the first lane\'s answer for it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const load = vi.fn(async (lane: string) => {
      if (lane === 'lane-a') await gate; // the first lane answers late
      return answer(lane, readOf(`Opus of ${lane}`));
    });
    const { result, rerender } = renderHook(({ lane }: { lane: string }) => useLaneModels(lane, load),
      { initialProps: { lane: 'lane-a' } });
    rerender({ lane: 'lane-b' });
    await waitFor(() => expect(result.current).toEqual(readOf('Opus of lane-b')));
    await act(async () => { release(); await gate; });
    expect(result.current).toEqual(readOf('Opus of lane-b'));
    expect(load.mock.calls.map((c) => c[0])).toEqual(['lane-a', 'lane-b']);
  });

  it('a surface opening again (refreshOn turning true) asks again, so a class that moved since is named', async () => {
    let opus = 'Opus before';
    const load = vi.fn(async (lane: string) => answer(lane, readOf(opus)));
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => useLaneModels('lane-a', load, open),
      { initialProps: { open: false } });
    await waitFor(() => expect(result.current).toEqual(readOf('Opus before')));
    expect(load).toHaveBeenCalledTimes(1);
    opus = 'Opus after'; // the registry advanced the class while the screen stayed open
    rerender({ open: true });
    await waitFor(() => expect(result.current).toEqual(readOf('Opus after')));
    expect(load).toHaveBeenCalledTimes(2);
    rerender({ open: false }); // closing asks nothing
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failed or malformed answer is nothing; a second mount draws the last good answer at once', async () => {
    const failing = vi.fn(async () => { throw new Error('404'); });
    const first = renderHook(() => useLaneModels('lane-a', failing));
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(first.result.current).toBeNull();
    first.unmount();

    const odd = vi.fn(async () => ({ ok: true, lane: 'lane-a', models: { kind: 'read', classes: {} } }));
    const second = renderHook(() => useLaneModels('lane-a', odd));
    await waitFor(() => expect(odd).toHaveBeenCalled());
    expect(second.result.current).toBeNull();
    second.unmount();

    const good = vi.fn(async (lane: string) => answer(lane, readOf('Kept')));
    const third = renderHook(() => useLaneModels('lane-a', good));
    await waitFor(() => expect(third.result.current).toEqual(readOf('Kept')));
    third.unmount();

    const never = vi.fn(() => new Promise<unknown>(() => {}));
    const fourth = renderHook(() => useLaneModels('lane-a', never));
    expect(fourth.result.current).toEqual(readOf('Kept'));
  });

  it('a caller asking again (refreshKey changing) reads the lane again, and a first render asks nothing extra', async () => {
    let opus = 'Opus before';
    const load = vi.fn(async (lane: string) => answer(lane, readOf(opus)));
    const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModels('lane-a', load, false, key),
      { initialProps: { key: 0 } });
    await waitFor(() => expect(result.current).toEqual(readOf('Opus before')));
    expect(load).toHaveBeenCalledTimes(1);
    opus = 'Opus after';
    rerender({ key: 1 });
    await waitFor(() => expect(result.current).toEqual(readOf('Opus after')));
    expect(load).toHaveBeenCalledTimes(2);
    rerender({ key: 1 }); // the same key asks nothing
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a read begun BEFORE the caller asked again lands stale and replaces nothing, so an act\'s answer is never put back (F6)', async () => {
    let first!: (v: unknown) => void;
    const calls: number[] = [];
    const load = vi.fn((lane: string) => {
      calls.push(calls.length);
      return calls.length === 1 ? new Promise<unknown>((r) => { first = r; }) : Promise.resolve(answer(lane, readOf('Opus after the act')));
    });
    const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModels('lane-a', load, false, key), { initialProps: { key: 0 } });
    expect(result.current).toBeNull(); // the opening read is still in flight
    rerender({ key: 1 }); // the sheet\'s act answered: it asks again
    await waitFor(() => expect(result.current).toEqual(readOf('Opus after the act')));
    await act(async () => { first(answer('lane-a', readOf('Opus before the act'))); await Promise.resolve(); });
    expect(result.current).toEqual(readOf('Opus after the act')); // the late, older read changed nothing
  });

  it('reports each landed read to an optional observer: ok, or the class of failure; a stale or aborted read reports nothing (F12)', async () => {
    const seen: LaneModelsReadOutcome[] = [];
    const modes: (() => Promise<unknown>)[] = [
      async () => { throw new ApiError(401, { error: 'unauthenticated' }); },
      async () => { throw new TypeError('Failed to fetch'); },
      async () => ({ ok: true, lane: 'lane-a', models: { kind: 'read', classes: {} } }),
      async () => { throw new ApiError(404, { error: 'not-found' }); },
      async () => answer('lane-a', readOf('Fine')),
    ];
    let i = 0;
    const load = vi.fn(() => modes[i++]!());
    const { rerender } = renderHook(({ key }: { key: number }) => useLaneModels('lane-a', load, false, key, (o) => seen.push(o)), { initialProps: { key: 0 } });
    for (let k = 1; k <= 4; k += 1) {
      await waitFor(() => expect(seen).toHaveLength(k));
      rerender({ key: k });
    }
    await waitFor(() => expect(seen).toHaveLength(5));
    expect(seen).toEqual([
      { ok: false, failure: 'signed-out' }, { ok: false, failure: 'no-answer' }, { ok: false, failure: 'unreadable' },
      { ok: false, failure: 'not-in-roster' }, { ok: true },
    ]);
  });

  it('a stale read (an older one landing after a newer) and an aborted one (the hook unmounted) report nothing to the observer (F12, review 2523 F8)', async () => {
    const seen: LaneModelsReadOutcome[] = [];
    let older!: (v: unknown) => void;
    let calls = 0;
    const load = vi.fn((lane: string) => {
      calls += 1;
      return calls === 1 ? new Promise<unknown>((r) => { older = r; }) : Promise.resolve(answer(lane, readOf('Newer')));
    });
    const { rerender, unmount } = renderHook(({ key }: { key: number }) => useLaneModels('lane-a', load, false, key, (o) => seen.push(o)), { initialProps: { key: 0 } });
    rerender({ key: 1 }); // a newer read is issued while the first is in flight
    await waitFor(() => expect(seen).toEqual([{ ok: true }]));
    await act(async () => { older(answer('lane-a', readOf('Older'))); await Promise.resolve(); });
    expect(seen).toEqual([{ ok: true }]); // the stale one reported nothing
    let last!: (v: unknown) => void;
    load.mockImplementationOnce(() => new Promise<unknown>((r) => { last = r; }));
    rerender({ key: 2 });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    unmount(); // its read is aborted
    await act(async () => { last(answer('lane-a', readOf('After unmount'))); await Promise.resolve(); });
    expect(seen).toEqual([{ ok: true }]);
  });

  it('a caller\'s control supersedes every read in flight: it lands nothing, and the next read is asked as usual (review 2523 F2)', async () => {
    const seen: LaneModelsReadOutcome[] = [];
    const control: { current: LaneModelsControl | null } = { current: null };
    let opening!: (v: unknown) => void;
    let calls = 0;
    const load = vi.fn((lane: string) => {
      calls += 1;
      return calls === 1 ? new Promise<unknown>((r) => { opening = r; }) : Promise.resolve(answer(lane, readOf('After the act')));
    });
    const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModels('lane-a', load, false, key, (o) => seen.push(o), control), { initialProps: { key: 0 } });
    expect(control.current).not.toBeNull();
    act(() => { control.current!.supersede(); });
    await act(async () => { opening(answer('lane-a', readOf('Before the act'))); await Promise.resolve(); });
    expect(result.current).toBeNull(); // the superseded read landed nothing
    expect(seen).toEqual([]);
    rerender({ key: 1 });
    await waitFor(() => expect(result.current).toEqual(readOf('After the act')));
  });

  it('an existing caller that passes no observer is unchanged: a failed read is still nothing', async () => {
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { result } = renderHook(() => useLaneModels('lane-a', failing));
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  // R3b fix rounds 1 and 2, F2, N1 and N3: `busy` and `not-started` say nothing ran. They keep the lane's last
  // non-transient answer in the hook and in the screen cache, say their word beside it, and ask once more on their own;
  // the retry's answer schedules nothing.
  describe('a transient answer (F2)', () => {
    afterEach(() => { vi.useRealTimers(); });
    const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

    it.each(['busy', 'not-started'] as const)('a good read, then %s: the labels stay, the word rides beside, the cache keeps the good read, and it re-reads once', async (kind) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const answers: unknown[] = [answer('lane-a', readOf('Good')), answer('lane-a', { kind }), answer('lane-a', { kind })];
      let i = 0;
      const load = vi.fn(async () => answers[Math.min(i++, answers.length - 1)]);
      const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModelsView('lane-a', load, false, key), { initialProps: { key: 0 } });
      await flush();
      expect(result.current).toEqual({ read: readOf('Good'), transient: null });
      const cachedGood = peek(laneModelsKey('lane-a'))?.raw;
      rerender({ key: 1 }); // a surface asks again, and the box is busy
      await flush();
      expect(result.current).toEqual({ read: readOf('Good'), transient: kind });
      expect(peek(laneModelsKey('lane-a'))?.raw, 'the cache keeps the last good read').toBe(cachedGood);
      expect(load).toHaveBeenCalledTimes(2);
      // one retry, on its own, after the bound
      await act(async () => { vi.advanceTimersByTime(LANE_TRANSIENT_RETRY_MS); });
      await flush();
      expect(load).toHaveBeenCalledTimes(3);
      expect(result.current).toEqual({ read: readOf('Good'), transient: kind });
      // the retry's own transient answer schedules nothing more: no loop
      await act(async () => { vi.advanceTimersByTime(LANE_TRANSIENT_RETRY_MS * 3); });
      await flush();
      expect(load).toHaveBeenCalledTimes(3);
    });

    it('the retry that answers recovers the models and clears the word', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const answers: unknown[] = [answer('lane-a', readOf('Before')), answer('lane-a', { kind: 'busy' }), answer('lane-a', readOf('After'))];
      let i = 0;
      const load = vi.fn(async () => answers[i++]);
      const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModelsView('lane-a', load, false, key), { initialProps: { key: 0 } });
      await flush();
      rerender({ key: 1 });
      await flush();
      expect(result.current.transient).toBe('busy');
      await act(async () => { vi.advanceTimersByTime(LANE_TRANSIENT_RETRY_MS); });
      await flush();
      expect(result.current).toEqual({ read: readOf('After'), transient: null });
    });

    it('with no good read to keep, the transient arm is the read; useLaneModels returns the kept read alone', async () => {
      const load = vi.fn(async () => answer('lane-a', { kind: 'busy' }));
      const view = renderHook(() => useLaneModelsView('lane-a', load));
      await waitFor(() => expect(view.result.current).toEqual({ read: { kind: 'busy' }, transient: null }));
      view.unmount();
      const plain = renderHook(() => useLaneModels('lane-a', load));
      await waitFor(() => expect(plain.result.current).toEqual({ kind: 'busy' }));
    });

    it.each([
      ['refused', { kind: 'refused', why: 'bad-lane' }], ['unsupported', { kind: 'unsupported' }],
      ['unreadable', { kind: 'unreadable' }], ['absent', { kind: 'absent' }],
    ] as const)('a %s answer still replaces the good read, and asks nothing more', async (_n, models) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const answers: unknown[] = [answer('lane-a', readOf('Good')), answer('lane-a', models as LaneModelsRead)];
      let i = 0;
      const load = vi.fn(async () => answers[Math.min(i++, 1)]);
      const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModelsView('lane-a', load, false, key), { initialProps: { key: 0 } });
      await flush();
      rerender({ key: 1 });
      await flush();
      expect(result.current).toEqual({ read: models, transient: null });
      await act(async () => { vi.advanceTimersByTime(LANE_TRANSIENT_RETRY_MS * 2); });
      expect(load).toHaveBeenCalledTimes(2);
    });

    // Fix round 2, N1: any non-transient answer is kept beside a transient one, not only a read, so an Anthropic lane's
    // absent rides through a busy (and the picker says nothing over its alias rows).
    it.each([
      ['an Anthropic lane\'s absent', { kind: 'absent', laneKind: 'anthropic' }], ['an unreadable', { kind: 'unreadable' }],
    ] as const)('%s, then busy: the answer stays, the word rides beside, and the cache keeps it', async (_n, models) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const answers: unknown[] = [answer('lane-a', models as LaneModelsRead), answer('lane-a', { kind: 'busy' })];
      let i = 0;
      const load = vi.fn(async () => answers[Math.min(i++, 1)]);
      const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModelsView('lane-a', load, false, key), { initialProps: { key: 0 } });
      await flush();
      const kept = peek(laneModelsKey('lane-a'))?.raw;
      rerender({ key: 1 });
      await flush();
      expect(result.current).toEqual({ read: models, transient: 'busy' });
      expect(peek(laneModelsKey('lane-a'))?.raw).toBe(kept);
    });

    // Fix round 2, N3: the retry is known by its issue number. A retry a newer read made stale never lands, and the newer
    // read's own transient answer is not the retry's: it asks once more.
    it('a retry superseded by a newer read: the newer transient answer still asks once more', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let releaseRetry: (v: unknown) => void = () => {};
      const answers: Array<() => Promise<unknown>> = [
        async () => answer('lane-a', readOf('Good')),
        async () => answer('lane-a', { kind: 'busy' }),
        () => new Promise((resolve) => { releaseRetry = resolve; }), // the retry, held in flight
        async () => answer('lane-a', { kind: 'busy' }), // a surface's newer read, which supersedes it
        async () => answer('lane-a', readOf('After')),
      ];
      let i = 0;
      const load = vi.fn(() => answers[Math.min(i++, answers.length - 1)]!());
      const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModelsView('lane-a', load, false, key), { initialProps: { key: 0 } });
      await flush();
      rerender({ key: 1 });
      await flush();
      await act(async () => { vi.advanceTimersByTime(LANE_TRANSIENT_RETRY_MS); });
      await flush();
      expect(load).toHaveBeenCalledTimes(3); // the retry is in flight
      rerender({ key: 2 });
      await flush();
      expect(load).toHaveBeenCalledTimes(4);
      releaseRetry(answer('lane-a', readOf('Stale'))); // lands stale: dropped
      await flush();
      expect(result.current).toEqual({ read: readOf('Good'), transient: 'busy' });
      await act(async () => { vi.advanceTimersByTime(LANE_TRANSIENT_RETRY_MS); });
      await flush();
      expect(load).toHaveBeenCalledTimes(5);
      expect(result.current).toEqual({ read: readOf('After'), transient: null });
    });

    it('a non-transient answer drops a retry still pending: nothing more is asked', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const answers: unknown[] = [answer('lane-a', readOf('Good')), answer('lane-a', { kind: 'busy' }), answer('lane-a', readOf('Next'))];
      let i = 0;
      const load = vi.fn(async () => answers[Math.min(i++, answers.length - 1)]);
      const { result, rerender } = renderHook(({ key }: { key: number }) => useLaneModelsView('lane-a', load, false, key), { initialProps: { key: 0 } });
      await flush();
      rerender({ key: 1 }); // busy: a retry is pending
      await flush();
      rerender({ key: 2 }); // a surface's next read answers before the retry is due
      await flush();
      expect(result.current).toEqual({ read: readOf('Next'), transient: null });
      await act(async () => { vi.advanceTimersByTime(LANE_TRANSIENT_RETRY_MS * 2); });
      await flush();
      expect(load).toHaveBeenCalledTimes(3);
    });
  });
});
