// The router's search channel (native Docs reader, W4 Task 7; design 2026-10-01 section 4.2, row M4.R1's W4 half,
// the W4 plan's refinements (a) and (o)). `useLocation()` re-renders on a change of the search alone, splits at the
// FIRST '?', follows back/forward, and ends its subscription on unmount (through the one `popstate` dispatcher since X2
// P5.3); `usePath()` is its wrapper and still
// re-renders a component that reads nothing else; `navigate(href, {replace: true})` rewrites the current history
// entry instead of adding one. M4.R1's W5 half ("injected `loaders.tree` called with ref `b`") is W5's: this file
// proves the channel on probes, never on a Docs screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { navigate, useLocation, usePath } from '../src/lib/router';
import type { Loc } from '../src/lib/router';

/** Every `onPop` subscription, with the unsubscribe it handed back (X2 P5.3: the hooks subscribe through the dispatcher). */
const pops = vi.hoisted(() => ({ subscribed: [] as { listener: () => void; unsubscribe: ReturnType<typeof vi.fn> }[] }));
vi.mock('../src/lib/popstate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/popstate')>();
  return {
    ...real,
    onPop: (listener: () => void) => {
      const unsubscribe = vi.fn(real.onPop(listener));
      pops.subscribed.push({ listener, unsubscribe });
      return unsubscribe;
    },
  };
});

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

  // Changed by X2 P5.3 (D-8763), an intended behaviour change: the hook no longer adds a `popstate` listener of its own.
  // It subscribes through the one dispatcher (`lib/popstate.ts#onPop`), which holds the window's only listener.
  it('each mounted hook subscribes once through onPop, the window holds one popstate listener however many hooks are mounted, and unmount unsubscribes exactly what it subscribed', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    pops.subscribed.length = 0;
    try {
      const { unmount } = render(<><LocProbe seen={[]} /><LocProbe seen={[]} /><LocProbe seen={[]} /></>);
      expect(pops.subscribed, 'one subscription per mounted hook').toHaveLength(3);
      const added = add.mock.calls.filter(([type]) => type === 'popstate').map(([, fn]) => fn);
      expect(added, 'one window listener for the three hooks').toHaveLength(1);
      expect(pops.subscribed.every((s) => s.unsubscribe.mock.calls.length === 0)).toBe(true);
      unmount();
      expect(pops.subscribed.map((s) => s.unsubscribe.mock.calls.length), 'each subscription ended once').toEqual([1, 1, 1]);
      const removed = remove.mock.calls.filter(([type]) => type === 'popstate').map(([, fn]) => fn);
      expect(removed, 'and the window listener with the last').toEqual(added);
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

describe('T11 review 4-2: a replace rides the same view transition as a push', () => {
  const doc = document as { startViewTransition?: unknown };
  afterEach(() => { delete doc.startViewTransition; });

  const stub = (): ReturnType<typeof vi.fn> => {
    const vt = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    doc.startViewTransition = vt;
    return vt;
  };

  it('navigate(href, {replace: true}) calls document.startViewTransition once and still rewrites the entry', () => {
    navigate('/runs?x=1');
    const vt = stub();
    const before = history.length;
    navigate('/runs?x=2', { replace: true });
    expect(vt).toHaveBeenCalledTimes(1);
    expect(history.length).toBe(before);
    expect(location.pathname + location.search).toBe('/runs?x=2');
  });

  it('a push takes the same path: one startViewTransition call, one new entry', () => {
    navigate('/runs?x=1');
    const vt = stub();
    const before = history.length;
    navigate('/runs?x=2');
    expect(vt).toHaveBeenCalledTimes(1);
    expect(history.length).toBe(before + 1);
  });

  // Review 3319 F1 (Overlord W1 home): `from` names the address a move leaves. The history call runs inside the transition,
  // which a browser runs a frame later; a move whose page has changed meanwhile does nothing, at the call or at the run.
  it('a replace with `from` lands while the page is still there, and does nothing once a later navigation has moved it', () => {
    navigate('/');
    const held: Array<() => void> = [];
    doc.startViewTransition = vi.fn((cb: () => void) => { held.push(cb); return { finished: Promise.resolve() }; });
    const before = history.length;
    navigate('/fleet', { replace: true, from: '/' });
    expect(held).toHaveLength(1);
    history.pushState(null, '', '/runs');            // a tap, landed while the replace waited
    held.shift()!();
    expect(location.pathname).toBe('/runs');
    expect(history.length).toBe(before + 1);
    // The control: with the page still at `from`, the same replace lands.
    navigate('/');
    held.shift()!();
    const at = history.length;
    navigate('/fleet', { replace: true, from: '/' });
    held.shift()!();
    expect(location.pathname).toBe('/fleet');
    expect(history.length).toBe(at);
  });

  it('a move with `from` asked when the page is already elsewhere does nothing, not even start a transition', () => {
    navigate('/runs');
    const vt = stub();
    navigate('/fleet', { replace: true, from: '/' });
    expect(vt).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');
  });
});

describe('T11 review 4-3: usePath subscribes through useLocation', () => {
  it('a component that reads only usePath() re-renders on a search-only change', () => {
    navigate('/docs/p?ref=a');
    const seen: string[] = [];
    render(<PathProbe seen={seen} />);
    const rendered = seen.length;
    act(() => { navigate('/docs/p?ref=b'); });
    expect(seen.length).toBeGreaterThan(rendered);
    expect(last(seen)).toBe('/docs/p');
  });
});

// M4.R1's W5 half (W5 part 1 Task 9; design 2026-10-01 section 4.2): the Docs screen, mounted from `useLocation()`
// exactly as the app's `docs` arm mounts it, reads a change of the search alone: `?ref=a` then `?ref=b` on one path
// asks the injected `loaders.tree` for ref `b` last. A screen that read only the pathname would never ask for `b`.
describe('the Docs screen follows the search channel (M4.R1, W5 half)', () => {
  it("navigate('/docs/p?ref=a') then '/docs/p?ref=b': loaders.tree is last called with ('p', bare b)", async () => {
    const { DocsScreen } = await import('../src/screens/DocsScreen');
    const tree = vi.fn(async () => ({ s: 'unreachable' as const }));
    const loaders = {
      projects: vi.fn(async () => ({ s: 'unreachable' as const })),
      tree,
      file: vi.fn(async () => ({ s: 'unreachable' as const })),
      raster: vi.fn(async () => ({ s: 'unreachable' as const })),
      refresh: vi.fn(async () => ({ s: 'unreachable' as const })),
    };
    function Docs(): ReactNode {
      const { path, search } = useLocation();
      return <DocsScreen path={path} search={search} loaders={loaders} parser={async () => ({ kind: 'worker-unavailable' })} />;
    }
    navigate('/');
    render(<Docs />);
    act(() => { navigate('/docs/p?ref=a'); });
    await waitFor(() => expect(tree).toHaveBeenLastCalledWith('p', { kind: 'bare', name: 'a' }));
    act(() => { navigate('/docs/p?ref=b'); });
    await waitFor(() => expect(tree).toHaveBeenLastCalledWith('p', { kind: 'bare', name: 'b' }));
    expect(tree).toHaveBeenCalledTimes(2);
  });
});
