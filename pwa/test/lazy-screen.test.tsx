// Console speed C1, review 1464 F2: a lazy screen whose chunk failed to load is asked again on the detail boundary's
// next reset, not kept failed for the life of the page (React's own `lazy` caches a rejected payload and rethrows it on
// every render). The rejection reaches the boundary as a `ScreenLoadError`, which `ScreenFallback` answers with Reload.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Suspense, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { RenderBoundary } from '../src/components/RenderBoundary';
import { PRELOAD_FALLBACK_MS, ScreenLoadError, lazyScreen, preloadWhenIdle } from '../src/lib/lazyScreen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const Hello = ({ who }: { who: string }): ReactNode => <h1>hello {who}</h1>;

const mount = (Screen: (p: { who: string }) => ReactNode, key: string): ReactNode => (
  <RenderBoundary where="test" resetKey={key} fallback={(e) => <p role="alert">{e instanceof ScreenLoadError ? 'load failed' : 'threw'}</p>}>
    <Suspense fallback={<p>Loading…</p>}><Screen who="a" /></Suspense>
  </RenderBoundary>
);

describe('lazyScreen', () => {
  it('a load that fails is asked again after the boundary resets, and then draws the screen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A state, not a count: React retries a failed render once by itself, which asks the loader again.
    let offline = true;
    const load = vi.fn(async () => {
      if (offline) throw new TypeError('Failed to fetch dynamically imported module');
      return Hello;
    });
    const Screen = lazyScreen(load);
    const view = render(mount(Screen, '/a'));
    expect(await screen.findByText('load failed')).toBeInTheDocument();
    const failed = load.mock.calls.length;
    offline = false;
    view.rerender(mount(Screen, '/a'));
    expect(screen.getByText('load failed'), 'the same key keeps the fallback').toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(failed);
    view.rerender(mount(Screen, '/b'));
    expect(await screen.findByRole('heading', { name: 'hello a' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(failed + 1);
  });

  it('a load that succeeded is never asked again', async () => {
    const load = vi.fn(async () => Hello);
    const Screen = lazyScreen(load);
    const view = render(mount(Screen, '/a'));
    await screen.findByRole('heading', { name: 'hello a' });
    view.unmount();
    render(mount(Screen, '/b'));
    expect(screen.getByRole('heading', { name: 'hello a' }), 'resolved: drawn at once, no loading line').toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('preload starts the load once and a later render uses it', async () => {
    const load = vi.fn(async () => Hello);
    const Screen = lazyScreen(load);
    await act(async () => { await Screen.preload(); });
    await act(async () => { await Screen.preload(); });
    expect(load).toHaveBeenCalledTimes(1);
    render(mount(Screen, '/a'));
    expect(await screen.findByRole('heading', { name: 'hello a' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed preload is forgotten too, and never an unhandled rejection', async () => {
    const load = vi.fn<() => Promise<typeof Hello>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Hello);
    const Screen = lazyScreen(load);
    await act(async () => { await Screen.preload(); });
    render(mount(Screen, '/a'));
    expect(await screen.findByRole('heading', { name: 'hello a' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('preloadWhenIdle (review 1464 F4)', () => {
  it('preloads once the page is idle, not before, and a cleanup before then cancels it', () => {
    let queued: Array<() => void> = [];
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => { queued.push(cb); return queued.length; });
    vi.stubGlobal('cancelIdleCallback', cancel);
    try {
      const preload = vi.fn(async () => {});
      const stop = preloadWhenIdle({ preload });
      expect(preload, 'nothing at mount').not.toHaveBeenCalled();
      queued.forEach((cb) => cb());
      expect(preload).toHaveBeenCalledTimes(1);
      queued = [];
      const stop2 = preloadWhenIdle({ preload });
      stop2();
      expect(cancel).toHaveBeenCalledWith(1);
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without requestIdleCallback it waits PRELOAD_FALLBACK_MS', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    try {
      const preload = vi.fn(async () => {});
      preloadWhenIdle({ preload });
      vi.advanceTimersByTime(PRELOAD_FALLBACK_MS - 1);
      expect(preload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(preload).toHaveBeenCalledTimes(1);
      const stop = preloadWhenIdle({ preload });
      stop();
      vi.advanceTimersByTime(PRELOAD_FALLBACK_MS);
      expect(preload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
