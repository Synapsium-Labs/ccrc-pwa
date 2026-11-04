// Console speed C1, review 1464 F2: a lazy screen whose chunk failed to load is asked again on the detail boundary's
// next reset, not kept failed for the life of the page (React's own `lazy` caches a rejected payload and rethrows it on
// every render). The rejection reaches the boundary as a `ScreenLoadError`, which `ScreenFallback` answers with Reload.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Suspense, useState, type ReactNode } from 'react';
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

  // Review 1473 F2: a load that rejects later than a React turn. Forgetting it before React saw the rejection had React
  // retry into a fresh load, and suspend again, without end: "Loading…" for good, and no Reload. The rejection is kept
  // until the boundary has drawn its fallback, and each reset asks once.
  it('a load that rejects after 30 ms draws the fallback, with one load per reset', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn(() => new Promise<typeof Hello>((_resolve, reject) => {
      setTimeout(() => reject(new TypeError('Failed to fetch dynamically imported module')), 30);
    }));
    const Screen = lazyScreen(load);
    const view = render(mount(Screen, '/a'));
    expect(await screen.findByText('load failed', undefined, { timeout: 3_000 })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(load, 'one load for the first open, however long it took to fail').toHaveBeenCalledTimes(1);
    view.rerender(mount(Screen, '/b'));
    expect(await screen.findByText('load failed', undefined, { timeout: 3_000 })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(load, 'and one more for the reset').toHaveBeenCalledTimes(2);
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

  // Review 1473 F3: a preloaded screen draws in the first commit, with no loading line. React's `lazy` suspends on its
  // first render even when the chunk is already here, and holds the reveal for 300 ms after the fallback commits.
  it('preload starts the load once, and a preloaded first open draws at once, with no loading line', async () => {
    const load = vi.fn(async () => Hello);
    const Screen = lazyScreen(load);
    await act(async () => { await Screen.preload(); });
    await act(async () => { await Screen.preload(); });
    expect(load).toHaveBeenCalledTimes(1);
    render(mount(Screen, '/a'));
    expect(screen.queryByText('Loading…'), 'no loading line on a preloaded first open').toBeNull();
    expect(screen.getByRole('heading', { name: 'hello a' }), 'drawn in the first commit').toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a screen first drawn through the lazy path keeps its mount when a later render finds the load resolved', async () => {
    let mounts = 0;
    const Counted = ({ who }: { who: string }): ReactNode => {
      const [n] = useState(() => ++mounts);
      return <h1>hello {who} {n}</h1>;
    };
    const Screen = lazyScreen(async () => Counted);
    const view = render(mount(Screen, '/a'));
    await screen.findByRole('heading', { name: 'hello a 1' });
    view.rerender(mount(Screen, '/a'));
    expect(screen.getByRole('heading', { name: 'hello a 1' })).toBeInTheDocument();
    expect(mounts).toBe(1);
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

  it('a reader who asked to save data gets no preload (review 1473 A7)', () => {
    vi.useFakeTimers();
    const idle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
    try {
      const preload = vi.fn(async () => {});
      const stop = preloadWhenIdle({ preload });
      vi.advanceTimersByTime(60_000);
      expect(idle).not.toHaveBeenCalled();
      expect(preload).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
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
