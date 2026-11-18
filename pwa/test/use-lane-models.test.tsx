// D-8406: `useLaneModels`, the one read of `GET /api/models/:lane`. It asks only once a lane is named, shows only an
// answer for the lane it is asked about now, keeps the last good answer per lane in the screen cache, and reads a failed
// or malformed answer as nothing, so a caller shows class names.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LaneModelsRead } from '../../shared/models';
import { useLaneModels } from '../src/lib/useLaneModels';
import { clearScreenCache } from '../src/lib/screenCache';
import { ApiError } from '../src/lib/apiError';
import type { LaneModelsReadOutcome } from '../src/lib/useLaneModels';

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
      { ok: false, failure: 'unreadable' }, { ok: true },
    ]);
  });

  it('an existing caller that passes no observer is unchanged: a failed read is still nothing', async () => {
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { result } = renderHook(() => useLaneModels('lane-a', failing));
    await waitFor(() => expect(failing).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
