// D-8406: `useLaneModels`, the one read of `GET /api/models/:lane`. It asks only once a lane is named, shows only an
// answer for the lane it is asked about now, keeps the last good answer per lane in the screen cache, and reads a failed
// or malformed answer as nothing, so a caller shows class names.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LaneModelsRead } from '../../shared/models';
import { useLaneModels } from '../src/lib/useLaneModels';
import { clearScreenCache } from '../src/lib/screenCache';

afterEach(() => { clearScreenCache(); vi.restoreAllMocks(); });

const readOf = (opus: string): LaneModelsRead => ({
  kind: 'read',
  classes: {
    fable: { model: 'm-fable', label: 'Fable Model' }, opus: { model: `m-${opus}`, label: opus },
    sonnet: { model: 'm-sonnet', label: 'Sonnet Model' }, haiku: { model: 'm-haiku', label: 'Haiku Model' },
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
});
