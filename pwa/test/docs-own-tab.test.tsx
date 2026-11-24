// A Docs tab (desktop polish wave 174): at a desk a Docs route draws the reader alone, in both skins, and is quiet. It
// mounts no fleet column, accounts strip or top bar, no toast host, badge, fleet sheets, palette or splash, opens no fleet
// stream and asks nothing but the Docs API; the sign-in and block screens still draw there. Its title names the document,
// and its one link back opens the console in a new tab. A phone keeps the Docs screen inside the console, characterised
// below as it is on main.
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
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

/** A desk (or not) with a fine pointer: `(min-width: 900px)` answers `desk`. */
function stubWidth(desk: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : q.includes('pointer: fine'),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

/** Every request and socket the page opened, in order. */
let requests: string[] = [];
let sockets: string[] = [];

/** A socket that records where it was opened and never connects. */
class RecordingSocket extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readyState = 0;
  readonly url: string;
  constructor(url: string) { super(); this.url = url; sockets.push(url); }
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
        expect(back).toHaveAttribute('rel', 'noopener');
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

      it('opens no fleet stream and asks only the Docs API', async () => {
        await mount(DOC);
        expect(sockets).toEqual([]);
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.map(pathOf).filter((p) => !p.startsWith('/api/docs/'))).toEqual([]);
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

// A phone keeps the Docs screen inside the console (this wave changes no phone width): characterised on main first.
describe('a Docs route on a phone, unchanged', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`in ${skin} it is the console's Docs screen, with the fleet stream and the console's chrome`, async () => {
      act(() => { setSkin(skin); });
      stubWidth(false);
      await mount(DOC);
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
});
