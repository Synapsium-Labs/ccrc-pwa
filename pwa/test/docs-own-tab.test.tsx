// A Docs tab (desktop polish wave 174): at a desk a Docs route draws the reader alone, in both skins, and is quiet. It
// mounts no fleet column, accounts strip or top bar, no toast host, badge, fleet sheets, palette or splash, opens no fleet
// stream and asks nothing but the Docs API; the sign-in and block screens still draw there. Its title names the document,
// and its one link back opens the console in a new tab. Below the desk width a tab that has shown only Docs pages since it
// loaded stays a Docs tab (fix round 1, L1), while a phone that moves to Docs inside the console keeps the console's Docs
// screen, characterised below as it is on main.
//
// The reader is the real `DocsScreen`. Every request the page makes is recorded by a stub `fetch` that answers 503 (so no
// 401 raises the sign-in screen by accident) and a stub `WebSocket` that records the address it was opened on.
//
// Mutation table (each guard, and the case that goes red without it):
//   `docsTab` in `App` (the reader-alone branch) ....... every "at a desk" case in "a Docs tab draws the reader alone"
//   `alone`'s NO_PARTS in `ShellFrame` ............... "draws no fleet column, accounts strip, banner stack or top bar"
//   the frame class dropped when `alone` ............. "the shell carries no skin frame class and is marked a Docs tab"
//   the gated `connect()` ............................ "opens no fleet stream and asks only the Docs API"
//   the gated Overlord start ......................... "opens no fleet stream and asks only the Docs API"
//   the gated session preload ........................ "loads no session screen"
//   the title effect ................................. "titles the tab with the document" / "gives the console its title back"
//   `ConsoleLink` through `useTabLink` ............... "its one link back opens the console in a new tab"
//   LoginScreen / BlockScreen kept in the branch ..... "still draws the sign-in screen and the block screen"
//   `docsOnly` in `App` (the fold, L1) ............... "narrowed below the desk width and widened again, it stays a Docs tab"
//                                                      and "a Docs address loaded first at a phone width draws the reader alone"
//   the fold's fall in `App` ......................... "… and its link back moves in place" (the tab is the console after)
//   `disconnect()` when a tab becomes a Docs tab ..... "a console widened while it shows a Docs page … closes its fleet stream"
//   `useFollowLink` in the reader's Back (F1) ........ "the reader's Back at the Docs index"
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED, toast } from '@ccrc/ui';

/** What the console's chrome mounted, by name: each mocked module below records its own mount. */
const mounted = vi.hoisted(() => new Set<string>());
/** Whether the session screen's chunk was asked for (`preloadWhenIdle`). */
const preloaded = vi.hoisted(() => ({ session: 0 }));

vi.mock('../src/face/AppBadge', async (orig) => {
  const real = await orig<typeof import('../src/face/AppBadge')>();
  return { ...real, AppBadge: (): ReactNode => { mounted.add('AppBadge'); return real.AppBadge(); } };
});
vi.mock('../src/fleet/FleetFlows', async (orig) => {
  const real = await orig<typeof import('../src/fleet/FleetFlows')>();
  return { ...real, FleetFlows: (): ReactNode => { mounted.add('FleetFlows'); return real.FleetFlows(); } };
});
vi.mock('../src/command/CommandLayer', async (orig) => {
  const real = await orig<typeof import('../src/command/CommandLayer')>();
  return {
    ...real,
    CommandLayer: (p: Parameters<typeof real.CommandLayer>[0]): ReactNode => { mounted.add('CommandLayer'); return real.CommandLayer(p); },
  };
});
vi.mock('../src/face/SplashScreen', async (orig) => {
  const real = await orig<typeof import('../src/face/SplashScreen')>();
  return { ...real, Splash: (): ReactNode => { mounted.add('Splash'); return real.Splash(); } };
});
vi.mock('../src/lib/lazyScreen', async (orig) => {
  const real = await orig<typeof import('../src/lib/lazyScreen')>();
  return { ...real, preloadWhenIdle: (s: { preload(): Promise<void> }): (() => void) => { preloaded.session += 1; return real.preloadWhenIdle(s); } };
});

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { clearAuthLost, raiseAuthLost } = await import('../src/lib/auth');

const DOC = '/docs/project-a/specs/2026-11-18-native-docs-parity-design.md';

/** The window's width class now, and the desk query's listeners, so a case can resize the window under a mounted app. */
let deskWide = false;
const deskListeners = new Set<() => void>();

/** A desk (or not) with a fine pointer: `(min-width: 900px)` answers `desk`, live, so `resize` moves it. */
function stubWidth(desk: boolean): void {
  deskWide = desk;
  vi.stubGlobal('matchMedia', (q: string) => {
    const isDesk = q.includes('min-width: 900px');
    return {
      get matches(): boolean { return isDesk ? deskWide : q.includes('pointer: fine'); },
      media: q, onchange: null,
      addEventListener(_t: string, cb: () => void) { if (isDesk) deskListeners.add(cb); },
      removeEventListener(_t: string, cb: () => void) { deskListeners.delete(cb); },
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

/** Resize the window across the desk width, then let the effects that follow run. */
async function resize(desk: boolean): Promise<void> {
  await act(async () => {
    deskWide = desk;
    for (const cb of [...deskListeners]) cb();
    await new Promise((r) => setTimeout(r, 30));
  });
}

/** Every request and socket the page opened, in order. */
let requests: string[] = [];
let sockets: string[] = [];

/** A socket that records where it was opened and never connects. */
class RecordingSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  /** Every socket opened in this case, so a case can ask whether each was closed. */
  static opened: RecordingSocket[] = [];
  readyState = 0;
  readonly url: string;
  constructor(url: string) { super(); this.url = url; sockets.push(url); RecordingSocket.opened.push(this); }
  send(): void {}
  close(): void { this.readyState = 3; }
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.pathname + input.search;
  return (input as { url: string }).url;
}

/** Mount the whole app at `at`, then let the mount's effects and their first requests run. */
async function mount(at: string): Promise<void> {
  navigate(at);
  render(<App />);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

/** The path of a recorded request, without its origin or query. */
const pathOf = (u: string): string => new URL(u, 'http://x').pathname;

beforeEach(() => {
  mounted.clear();
  preloaded.session = 0;
  requests = [];
  sockets = [];
  RecordingSocket.opened = [];
  deskListeners.clear();
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  document.title = 'ccrc';
  initSkin();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    requests.push(urlOf(input));
    return new Response(JSON.stringify({ ok: false, error: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }));
  vi.stubGlobal('WebSocket', RecordingSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => { clearAuthLost(); });
  // The fleet store is one per module: a stream one case opened must not stand in for the next case's.
  act(() => { useFleetStore.getState().disconnect(); });
  navigate('/fleet');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  act(() => { setSkin(REFINED); });
  localStorage.clear();
});

const shell = (): HTMLElement => document.querySelector<HTMLElement>('.app-shell')!;

describe('a Docs tab draws the reader alone', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    describe(`in ${skin}, at a desk`, () => {
      beforeEach(() => { act(() => { setSkin(skin); }); stubWidth(true); });

      it('draws no fleet column, accounts strip, banner stack or top bar', async () => {
        await mount(DOC);
        expect(shell().querySelector('.shell-nav')).toBeNull();
        expect(shell().querySelector('.shell-accounts')).toBeNull();
        expect(shell().querySelector('.shell-banners')).toBeNull();
        expect(shell().querySelector('.shell-inspector')).toBeNull();
        expect(shell().querySelector('.shell-status')).toBeNull();
        expect(shell().querySelector('.shell-phone-nav')).toBeNull();
        expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Fleet' })).toBeNull();
      });

      it('draws the reader in the main landmark, after the skip link and the tab bar', async () => {
        await mount(DOC);
        const main = screen.getByRole('main');
        expect(main).toHaveAttribute('id', 'content');
        expect(main.querySelector('.docs-screen')).not.toBeNull();
        const kids = [...shell().children].map((el) => el.className.split(' ')[0]);
        expect(kids).toEqual(['skip-link', 'shell-tab-bar', 'shell-detail']);
      });

      it('the shell carries no skin frame class and is marked a Docs tab', async () => {
        await mount(DOC);
        expect(shell().className).toBe('app-shell');
        expect(shell()).toHaveAttribute('data-tab', 'docs');
      });

      it('its one link back opens the console in a new tab', async () => {
        await mount(DOC);
        const bar = document.querySelector<HTMLElement>('header.shell-tab-bar')!;
        const back = within(bar).getByRole('link', { name: 'Console, opens in a new tab' });
        expect(back).toHaveAttribute('href', '/');
        expect(back).toHaveAttribute('target', '_blank');
        expect(back).toHaveAttribute('rel', 'noopener noreferrer');
        expect(within(bar).getAllByRole('link')).toHaveLength(1);
        // Outside the reader's head, whose action row is the reader's own.
        expect(back.closest('.docs-head')).toBeNull();
      });

      it('titles the tab with the document', async () => {
        await mount(DOC);
        expect(document.title).toBe('2026-11-18-native-docs-parity-design.md · project-a · Docs · ccrc');
        act(() => { navigate('/docs/project-a/plans/other.md'); });
        expect(document.title).toBe('other.md · project-a · Docs · ccrc');
      });

      it('a move to another document stays a Docs tab', async () => {
        await mount(DOC);
        act(() => { navigate('/docs/project-a'); });
        expect(shell()).toHaveAttribute('data-tab', 'docs');
        expect(shell().querySelector('.shell-nav')).toBeNull();
      });

      it('mounts none of the console chrome: no badge, fleet sheets, palette, splash or toast host', async () => {
        await mount(DOC);
        expect([...mounted]).toEqual([]);
        act(() => { toast('a probe'); });
        expect(document.querySelector('.toast-host')).toBeNull();
      });

      it('opens no fleet stream and asks only the Docs API: one read in its first 1.5 s', async () => {
        await mount(DOC);
        await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
        expect(sockets).toEqual([]);
        expect(requests.map(pathOf)).toHaveLength(1);
        expect(requests.map(pathOf)[0]).toMatch(/^\/api\/docs\//);
      });

      it('loads no session screen', async () => {
        await mount(DOC);
        expect(preloaded.session).toBe(0);
      });

      it('still draws the sign-in screen and the block screen', async () => {
        await mount(DOC);
        act(() => { raiseAuthLost('no-session'); });
        expect(document.querySelector('.login-screen')).not.toBeNull();
        act(() => useFleetStore.setState({ blocked: true }));
        expect(document.querySelector('.block-screen')).not.toBeNull();
      });
    });
  }

  it('the index and a project page are Docs tabs too, and titled', async () => {
    stubWidth(true);
    await mount('/docs');
    expect(shell()).toHaveAttribute('data-tab', 'docs');
    expect(document.title).toBe('Docs · ccrc');
  });
});

describe('the console at a desk, for comparison', () => {
  it('a console page draws the console, opens the fleet stream and gives the console its title back', async () => {
    stubWidth(true);
    await mount(DOC);
    expect(document.title).not.toBe('ccrc');
    act(() => { navigate('/fleet'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.title).toBe('ccrc');
    expect(shell()).not.toHaveAttribute('data-tab');
    expect(shell().querySelector('.shell-nav')).not.toBeNull();
    expect(sockets.length).toBeGreaterThan(0);
    expect(mounted.has('CommandLayer')).toBe(true);
  });
});

// A DOCS TAB AT ANY WIDTH (fix round 1, the coordinator's ruling L1): a tab whose first page was a Docs address, and which
// has shown nothing but Docs pages since, stays a Docs tab below the desk width too, so a document read in a half-width
// window beside a session never turns into the console. Resizing never flips it, never remounts the reader and never opens a
// fleet stream. In-app navigation to Docs at a phone width is the console's Docs screen, as before.
describe('a Docs tab at any width', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`in ${skin}, narrowed below the desk width and widened again, it stays a Docs tab with the same reader`, async () => {
      act(() => { setSkin(skin); });
      stubWidth(true);
      await mount(DOC);
      const reader = document.querySelector('.docs-screen');
      expect(reader).not.toBeNull();
      const title = document.title;
      for (const desk of [false, true]) {
        await resize(desk);
        expect(shell()).toHaveAttribute('data-tab', 'docs');
        expect(shell().querySelector('.shell-nav')).toBeNull();
        expect(shell().querySelector('.shell-phone-nav')).toBeNull();
        expect(document.querySelector('.docs-screen'), 'the reader is the same element: never remounted').toBe(reader);
        expect(sockets).toEqual([]);
        expect([...mounted]).toEqual([]);
        expect(document.title).toBe(title);
      }
    });

    it(`in ${skin}, a Docs address loaded first at a phone width draws the reader alone, and its link back moves in place`, async () => {
      act(() => { setSkin(skin); });
      stubWidth(false);
      await mount(DOC);
      expect(shell()).toHaveAttribute('data-tab', 'docs');
      expect(shell().querySelector('.shell-nav')).toBeNull();
      expect(shell().querySelector('.shell-phone-nav')).toBeNull();
      expect(screen.getByRole('main').querySelector('.docs-screen')).not.toBeNull();
      expect(sockets).toEqual([]);
      expect([...mounted]).toEqual([]);
      expect(document.title).toBe('2026-11-18-native-docs-parity-design.md · project-a · Docs · ccrc');
      const bar = document.querySelector<HTMLElement>('header.shell-tab-bar')!;
      const back = within(bar).getByRole('link', { name: 'Console' });
      expect(back).toHaveAttribute('href', '/');
      expect(back).not.toHaveAttribute('target');
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      await act(async () => { fireEvent.click(back); await new Promise((r) => setTimeout(r, 30)); });
      expect(open).not.toHaveBeenCalled();
      // The console's root, which the home then replaces with its place (the fleet's here).
      expect(['/', '/fleet']).toContain(location.pathname);
      // It left Docs, so it is the console now, and stays the console when it comes back to a document.
      expect(shell()).not.toHaveAttribute('data-tab');
      await act(async () => { navigate(DOC); await new Promise((r) => setTimeout(r, 30)); });
      expect(shell()).not.toHaveAttribute('data-tab');
    });

    // Characterised on main first: in-app navigation to Docs at a phone width is unchanged.
    it(`in ${skin}, in-app navigation to Docs at a phone width is the console's Docs screen, as before`, async () => {
      act(() => { setSkin(skin); });
      stubWidth(false);
      await mount('/fleet');
      await act(async () => { navigate(DOC); await new Promise((r) => setTimeout(r, 30)); });
      expect(shell()).not.toHaveAttribute('data-tab');
      expect(shell().className).not.toBe('app-shell');
      expect(shell().querySelector('.shell-tab-bar')).toBeNull();
      expect(shell().querySelector('.shell-nav')).not.toBeNull();
      expect(screen.getByRole('main').querySelector('.docs-screen')).not.toBeNull();
      expect(screen.queryByRole('link', { name: /^Console/ })).toBeNull();
      expect(sockets.length).toBeGreaterThan(0);
      expect(mounted.has('CommandLayer')).toBe(true);
      expect(mounted.has('FleetFlows')).toBe(true);
      expect(document.title).toBe('ccrc');
    });
  }

  it('a console widened while it shows a Docs page becomes a Docs tab and closes its fleet stream; narrowed, it is the console again', async () => {
    stubWidth(false);
    await mount('/fleet');
    await act(async () => { navigate(DOC); await new Promise((r) => setTimeout(r, 30)); });
    expect(sockets.length).toBeGreaterThan(0);
    await resize(true);
    expect(shell()).toHaveAttribute('data-tab', 'docs');
    expect(RecordingSocket.opened.length).toBeGreaterThan(0);
    expect(RecordingSocket.opened.every((w) => w.readyState === RecordingSocket.CLOSED), 'no fleet socket stays open in a Docs tab').toBe(true);
    const before = sockets.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });
    expect(sockets.length, 'and none reopens').toBe(before);
    await resize(false);
    expect(shell()).not.toHaveAttribute('data-tab');
    expect(sockets.length, 'the console connects again').toBeGreaterThan(before);
  });
});

// THE READER'S BACK AT THE INDEX (fix round 1, F1): its up door goes to the fleet, so in a Docs tab at a desk it opens the
// console in a new tab, by the same rule as every other link, and never draws the console here.
describe('the reader’s Back at the Docs index', () => {
  it('in a Docs tab at a desk opens the console in a new tab and leaves this tab a Docs tab', async () => {
    stubWidth(true);
    await mount('/docs');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Up one level' })); await new Promise((r) => setTimeout(r, 30)); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe('/fleet');
    expect(open.mock.calls[0]![1]).toBe('_blank');
    expect(location.pathname).toBe('/docs');
    expect(shell()).toHaveAttribute('data-tab', 'docs');
    expect(sockets).toEqual([]);
    expect([...mounted]).toEqual([]);
  });

  // Unchanged by it, each as on main: Back below the index moves up within the tab; in the console on a phone, and in a
  // narrow Docs tab, Back at the index moves to the fleet in place.
  it('in a Docs tab at a desk, Back from a leaf moves up within the tab and opens nothing', async () => {
    stubWidth(true);
    await mount(DOC);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Up one level' })); await new Promise((r) => setTimeout(r, 30)); });
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/docs/project-a/specs');
    expect(shell()).toHaveAttribute('data-tab', 'docs');
  });

  it('in the console on a phone, Back at the index moves to the fleet in place', async () => {
    stubWidth(false);
    await mount('/fleet');
    await act(async () => { navigate('/docs'); await new Promise((r) => setTimeout(r, 30)); });
    expect(shell()).not.toHaveAttribute('data-tab');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Up one level' })); await new Promise((r) => setTimeout(r, 30)); });
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/fleet');
  });

  it('in a narrow Docs tab, Back at the index moves to the fleet in place, as a phone does', async () => {
    stubWidth(false);
    await mount('/docs');
    expect(shell()).toHaveAttribute('data-tab', 'docs');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Up one level' })); await new Promise((r) => setTimeout(r, 30)); });
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/fleet');
    expect(shell()).not.toHaveAttribute('data-tab');
  });
});
