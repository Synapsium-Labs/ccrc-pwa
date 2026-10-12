// The router's search channel (native Docs reader, W4 Task 7; design 2026-10-01 section 4.2, row M4.R1's W4 half,
// the W4 plan's refinements (a) and (o)). `useLocation()` re-renders on a change of the search alone, splits at the
// FIRST '?', follows back/forward, and removes its listener on unmount; `usePath()` is its wrapper and still
// re-renders a component that reads nothing else; `navigate(href, {replace: true})` rewrites the current history
// entry instead of adding one. M4.R1's W5 half ("injected `loaders.tree` called with ref `b`") is W5's: this file
// proves the channel on probes, never on a Docs screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { navigate, useLocation, usePath } from '../src/lib/router';
import type { Loc } from '../src/lib/router';

afterEach(() => {
  cleanup();
  navigate('/');
});

/** Records every value `useLocation()` hands a render, in render order. */
function LocProbe({ seen }: { seen: Loc[] }): ReactNode {
  seen.push(useLocation());
  return null;
}

/** Records `usePath()` beside `useLocation().path`, both read in the same render. */
function PairProbe({ seen }: { seen: (readonly [string, string])[] }): ReactNode {
  const viaPath = usePath();
  const viaLocation = useLocation().path;
  seen.push([viaPath, viaLocation]);
  return null;
}

/** Reads ONLY `usePath()`: it re-renders on a path change only if `usePath` subscribes through `useLocation`. */
function PathProbe({ seen }: { seen: string[] }): ReactNode {
  seen.push(usePath());
  return null;
}

/** The last recorded value; a missing one fails here rather than reading as `undefined`. */
function last<T>(xs: readonly T[]): T {
  expect(xs.length, 'the probe rendered at least once').toBeGreaterThan(0);
  return xs[xs.length - 1] as T;
}

describe('useLocation: the search channel (M4.R1, W4 half)', () => {
  it('a change of the search alone re-renders: ?ref=a then ?ref=b, one render each after the first', () => {
    navigate('/');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    act(() => { navigate('/docs/p?ref=a'); });
    act(() => { navigate('/docs/p?ref=b'); });
    expect(seen).toEqual([
      { path: '/', search: '' },
      { path: '/docs/p', search: '?ref=a' },
      { path: '/docs/p', search: '?ref=b' },
    ]);
  });

  it("a path with no '?' has an empty search", () => {
    navigate('/runs');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    expect(last(seen)).toEqual({ path: '/runs', search: '' });
  });

  it("splits at the FIRST '?': a later '?' belongs to the search, as the URL parser reads it", () => {
    navigate('/docs/p?ref=a?b');
    // The platform's own reading, so the case states the parser's answer rather than assuming it.
    expect([location.pathname, location.search]).toEqual(['/docs/p', '?ref=a?b']);
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    expect(last(seen)).toEqual({ path: '/docs/p', search: '?ref=a?b' });
  });

  it('back restores the previous search (jsdom fires popstate on the traversal)', async () => {
    navigate('/docs/p?ref=a');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    act(() => { navigate('/docs/p?ref=b'); });
    expect(last(seen)).toEqual({ path: '/docs/p', search: '?ref=b' });
    history.back();
    await waitFor(() => expect(last(seen)).toEqual({ path: '/docs/p', search: '?ref=a' }));
  });

  it('removes on unmount exactly the popstate listener it added on mount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const { unmount } = render(<LocProbe seen={[]} />);
      const added = add.mock.calls.filter(([type]) => type === 'popstate').map(([, fn]) => fn);
      expect(added, 'one listener per mounted hook').toHaveLength(1);
      unmount();
      const removed = remove.mock.calls.filter(([type]) => type === 'popstate').map(([, fn]) => fn);
      expect(removed).toEqual(added);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});

describe('usePath is a wrapper over useLocation', () => {
  it('usePath() equals useLocation().path in every render, across search and path changes', () => {
    navigate('/runs?x=1');
    const seen: (readonly [string, string])[] = [];
    render(<PairProbe seen={seen} />);
    act(() => { navigate('/runs?x=2'); });
    act(() => { navigate('/mail'); });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const [viaPath, viaLocation] of seen) expect(viaPath).toBe(viaLocation);
    expect(last(seen)).toEqual(['/mail', '/mail']);
  });

  it('a component that reads only usePath() re-renders on a path change', () => {
    navigate('/mail');
    const seen: string[] = [];
    render(<PathProbe seen={seen} />);
    act(() => { navigate('/runs'); });
    expect(last(seen)).toBe('/runs');
  });
});

describe('navigate(href, {replace})', () => {
  it('a push (no options) adds one history entry and moves location', () => {
    navigate('/runs?x=1');
    const before = history.length;
    navigate('/runs?x=2');
    expect(history.length).toBe(before + 1);
    expect(location.pathname + location.search).toBe('/runs?x=2');
  });

  it('replace: false is a push too', () => {
    navigate('/runs?x=1');
    const before = history.length;
    navigate('/runs?x=2', { replace: false });
    expect(history.length).toBe(before + 1);
  });

  it('replace: true rewrites the current entry: history.length unchanged, location moved, the hook re-rendered', () => {
    navigate('/runs?x=1');
    const seen: Loc[] = [];
    render(<LocProbe seen={seen} />);
    const before = history.length;
    act(() => { navigate('/runs?x=2', { replace: true }); });
    expect(history.length).toBe(before);
    expect(location.pathname + location.search).toBe('/runs?x=2');
    expect(last(seen)).toEqual({ path: '/runs', search: '?x=2' });
  });

  it('back after a replace skips the replaced entry', async () => {
    navigate('/mail');
    navigate('/runs?x=1');
    navigate('/runs?x=2', { replace: true });
    history.back();
    await waitFor(() => expect(location.pathname + location.search).toBe('/mail'));
  });
});
