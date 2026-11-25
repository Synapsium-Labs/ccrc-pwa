// An outside folder's page (X2 P2.4) as the first page of a Docs tab, and its Back (the coordinator's requirement: a Docs
// tab is a tab whose first page was a Docs address; below the desk width it draws no bar and the reader's own Back leads to
// the console; at a desk it has a bar with a link back; it mounts no global keys). A folder is a Docs address, so its tab is
// a Docs tab at any width. The folder reads nothing but its own Docs doors: the stub `fetch` answers 503 to every request.
//
// The setup is copied from `docs-own-tab.test.tsx`, whose helpers are local to it and not exported: the mocks that record which
// pieces of the console's chrome mounted, the desk-width `matchMedia` stub, a recording socket and a recording `fetch`. Only
// the minimum is copied (the sign-in, reload and resize cases of that file are not needed here).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { REFINED } from '@ccrc/ui';

/** What the console's chrome mounted, by name: each mocked module below records its own mount. */
const mounted = vi.hoisted(() => new Set<string>());

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

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { clearAuthLost } = await import('../src/lib/auth');

const FOLDER_LEAF = '/docs/~notes/specs/a.md';

let deskWide = false;

/** A desk (or not) with a fine pointer: `(min-width: 900px)` answers `desk`. */
function stubWidth(desk: boolean): void {
  deskWide = desk;
  vi.stubGlobal('matchMedia', (q: string) => {
    const isDesk = q.includes('min-width: 900px');
    return {
      get matches(): boolean { return isDesk ? deskWide : q.includes('pointer: fine'); },
      media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

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

const pathOf = (u: string): string => new URL(u, 'http://x').pathname;

/** Mount the whole app at `at`, then let the mount's effects and their first requests run. */
async function mount(at: string): Promise<void> {
  navigate(at);
  render(<App />);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

beforeEach(() => {
  mounted.clear();
  requests = [];
  sockets = [];
  localStorage.clear();
  sessionStorage.clear();
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
  act(() => { useFleetStore.getState().disconnect(); });
  navigate('/fleet');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  act(() => { setSkin(REFINED); });
  localStorage.clear();
});

const shell = (): HTMLElement => document.querySelector<HTMLElement>('.app-shell')!;
const upButton = (): HTMLElement => screen.getByRole('button', { name: 'Up one level' });

/** The palette's own gestures: a chord and the slash. A mounted palette would answer with a dialog. */
function pressGlobalKeys(): void {
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  fireEvent.keyDown(document, { key: '/' });
}

describe('a folder leaf as the first page of a Docs tab', () => {
  it('at a phone width draws no bar, mounts no global keys, and its Back climbs the folder and then leads to the console', async () => {
    stubWidth(false);
    await mount(FOLDER_LEAF);
    expect(shell()).toHaveAttribute('data-tab', 'docs');
    expect(shell().querySelector('.shell-tab-bar')).toBeNull();
    expect(shell().querySelector('.shell-nav')).toBeNull();
    expect(shell().querySelector('.shell-phone-nav')).toBeNull();
    expect([...shell().children].map((el) => el.className.split(' ')[0])).toEqual(['skip-link', 'shell-detail']);
    expect(screen.queryByRole('link', { name: /^Console/ })).toBeNull();
    expect(document.querySelector('.docs-folder-head')).not.toBeNull();
    expect([...mounted]).toEqual([]);
    pressGlobalKeys();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sockets).toEqual([]);
    expect(requests.every((u) => pathOf(u).startsWith('/api/docs-folders/'))).toBe(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    // The reader's own Back, one level at a time: the section, the folder, the index, then the console in place.
    const seen: string[] = [];
    for (let i = 0; i < 6 && location.pathname !== '/fleet'; i += 1) {
      await act(async () => { fireEvent.click(upButton()); await new Promise((r) => setTimeout(r, 30)); });
      seen.push(location.pathname);
    }
    expect(seen).toEqual(['/docs/~notes/specs', '/docs/~notes', '/docs', '/fleet']);
    expect(open).not.toHaveBeenCalled();
    expect(shell()).not.toHaveAttribute('data-tab');
  });

  it('at a desk has the bar with its one link back, mounts no global keys, and its Back moves up within the tab', async () => {
    stubWidth(true);
    await mount(FOLDER_LEAF);
    expect(shell()).toHaveAttribute('data-tab', 'docs');
    const bar = document.querySelector<HTMLElement>('header.shell-tab-bar')!;
    expect(bar).not.toBeNull();
    const back = within(bar).getByRole('link', { name: 'Console, opens in a new tab' });
    expect(back).toHaveAttribute('href', '/');
    expect(back).toHaveAttribute('target', '_blank');
    expect(within(bar).getAllByRole('link')).toHaveLength(1);
    expect(back.closest('.docs-head')).toBeNull();
    expect(shell().querySelector('.shell-nav')).toBeNull();
    expect([...mounted]).toEqual([]);
    pressGlobalKeys();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sockets).toEqual([]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => { fireEvent.click(upButton()); await new Promise((r) => setTimeout(r, 30)); });
    expect(open).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/docs/~notes/specs');
    expect(shell()).toHaveAttribute('data-tab', 'docs');
  });
});

// Back from a folder page behaves as from a project page, in each place it can be; the folder root goes up to the index.
describe('Back from a folder root, as from a project root', () => {
  for (const desk of [false, true]) {
    const where = desk ? 'at a desk' : 'on a phone';
    // A folder root and a project root, side by side: Back goes up to the index and acts the same way in the console, which
    // at a desk opens a Docs address in its own tab (#3289) and on a phone moves in place.
    for (const [what, url] of [['a project root', '/docs/project-a'], ['a folder root', '/docs/~notes']] as const) {
      it(`in the console ${where}, Back from ${what} goes up to the Docs index ${desk ? 'in a new tab' : 'in place'}`, async () => {
        stubWidth(desk);
        await mount('/fleet');
        await act(async () => { navigate(url); await new Promise((r) => setTimeout(r, 30)); });
        expect(shell()).not.toHaveAttribute('data-tab');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        await act(async () => { fireEvent.click(upButton()); await new Promise((r) => setTimeout(r, 30)); });
        if (desk) {
          expect(open).toHaveBeenCalledTimes(1);
          expect(open.mock.calls[0]![0]).toBe('/docs');
          expect(open.mock.calls[0]![1]).toBe('_blank');
          expect(location.pathname).toBe(url);
        } else {
          expect(open).not.toHaveBeenCalled();
          expect(location.pathname).toBe('/docs');
        }
        expect(shell()).not.toHaveAttribute('data-tab');
      });
    }

    it(`in a Docs tab ${where}, Back from a folder root moves to the Docs index within the tab, opening nothing`, async () => {
      stubWidth(desk);
      await mount('/docs/~notes');
      expect(shell()).toHaveAttribute('data-tab', 'docs');
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      await act(async () => { fireEvent.click(upButton()); await new Promise((r) => setTimeout(r, 30)); });
      expect(open).not.toHaveBeenCalled();
      expect(location.pathname).toBe('/docs');
      expect(shell()).toHaveAttribute('data-tab', 'docs');
    });
  }
});
