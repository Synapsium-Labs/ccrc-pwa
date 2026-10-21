// Refined's shell at laptop and wide (W2 Task S4b, D-5471): the app bar, the sidebar and the banners.
//
// What a person at a desk sees first, held through `App` in the Refined skin: the bar's controls in their order, each
// one a door to its registry command (§The door table), one current tab, the Inbox badge counted by the one function
// the fleet's mail door reads, and one accounts readout and one banner stack at any width (the plan's "one instance
// per width"). jsdom applies no media queries and no layout, so a width is a `matchMedia` stub that answers every
// `min-width` and `max-width` query against one number, and what this file counts is what is MOUNTED; what is
// visible at each width is the per-width render pass.
//
// THE ROUTE TABLE IS PLANTED. `lib/routes` is mocked with Inbox moved from `/mail` to `/letters`, for the whole
// file: a tab that hard-codes its path instead of reading `ROUTES` is current on the wrong page and goes red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REFINED } from '@ccrc/ui';
import type { NotifyEvent } from '../../shared/api';

vi.mock('../src/lib/routes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/routes')>();
  const ROUTES = real.ROUTES.map((r) => (r.id === 'inbox' ? { ...r, pattern: /^\/letters\/?$/, path: '/letters' } : r));
  const matchRoute = (p: string): ReturnType<typeof real.matchRoute> => {
    for (const route of ROUTES) {
      const m = route.pattern.exec(p);
      if (m !== null) return { route, param: m[1] === undefined ? null : decodeURIComponent(m[1]) };
    }
    return null;
  };
  return { ...real, ROUTES, matchRoute };
});

// The bell renders only where the browser can push; this one can, so the bar's full order is on screen.
vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
  enablePush: async () => ({ status: 'enabled' }),
  disablePush: async () => {},
}));

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { ROUTES } = await import('../src/lib/routes');
const { setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { ack, FEED_ACK_KEY } = await import('../src/lib/seen');

/** Every width query answered against one viewport width. */
function atWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1]))
      && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

const TAB_IDS = ['fleet', 'inbox', 'runs', 'accounts', 'docs'] as const;
const tabTitle = (id: string): string => ROUTES.find((r) => r.id === id)!.title;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  setSkin(REFINED);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => { navigate('/'); });
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], feed: [], runs: [], runsFrameSeen: false }));
});

const bar = (): HTMLElement => document.querySelector<HTMLElement>('header.shell-accounts')!;
const primary = (): HTMLElement => within(bar()).getByRole('navigation', { name: 'Primary' });
const tabs = (): HTMLElement[] => [...primary().querySelectorAll<HTMLElement>('[data-command^="go-"]')];

describe('the app bar (W2 Task S4b)', () => {
  it('the app bar renders the wordmark, the five tabs from ROUTES, the gauges door, the bell, search, settings and New session, in that order', () => {
    atWidth(1280);
    render(<App />);
    const b = bar();
    expect(b).not.toBeNull();
    // The tabs say what ROUTES calls each place, in the order the bar draws them.
    expect(tabs().map((t) => t.textContent?.trim())).toEqual(TAB_IDS.map(tabTitle));
    const order = [
      b.querySelector('[data-wordmark]'),
      ...tabs(),
      b.querySelector('.accounts-compact'),
      within(b).getByRole('button', { name: /^Notifications/ }),
      within(b).getByRole('button', { name: 'Search and commands' }),
      within(b).getByRole('button', { name: /^Settings/ }),
      within(b).getByRole('button', { name: /New session/ }),
    ];
    for (const el of order) expect(el, 'every control is in the bar').not.toBeNull();
    for (let i = 1; i < order.length; i += 1) {
      // eslint-disable-next-line no-bitwise
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `control ${i}`).toBeTruthy();
    }
  });

  it('every tab, the gauges door, search, settings and New session carry their data-command', () => {
    atWidth(1280);
    render(<App />);
    expect(tabs().map((t) => t.getAttribute('data-command'))).toEqual(TAB_IDS.map((id) => `go-${id}`));
    const b = bar();
    expect(b.querySelector('.accounts-compact')).toHaveAttribute('data-command', 'go-accounts');
    expect(within(b).getByRole('button', { name: 'Search and commands' })).toHaveAttribute('data-command', 'open-palette');
    expect(within(b).getByRole('button', { name: /^Settings/ })).toHaveAttribute('data-command', 'go-settings');
    expect(within(b).getByRole('button', { name: /New session/ })).toHaveAttribute('data-command', 'new-session');
    // A tab runs its command: the layer navigates to the route's own path.
    fireEvent.click(within(primary()).getByRole('button', { name: /^Runs/ }));
    expect(location.pathname).toBe('/runs');
    fireEvent.click(within(primary()).getByRole('button', { name: /^Inbox/ }));
    expect(location.pathname).toBe('/letters');
  });

  it('the active tab carries aria-current=page, and only one does', () => {
    atWidth(1280);
    const current = (): string[] => tabs().filter((t) => t.getAttribute('aria-current') === 'page').map((t) => t.getAttribute('data-command')!);
    render(<App />);
    expect(current()).toEqual(['go-fleet']);
    act(() => { navigate('/runs'); });
    expect(current()).toEqual(['go-runs']);
    act(() => { navigate('/letters'); });
    expect(current()).toEqual(['go-inbox']);
    act(() => { navigate('/s/a'); });
    expect(current()).toEqual([]);
    for (const t of tabs()) if (t.getAttribute('aria-current') !== 'page') expect(t).not.toHaveAttribute('aria-current');
  });

  it("the Inbox badge counts what the fleet's unread count counts, and the tab's name carries it", () => {
    const stamp = Date.now();
    act(() => { ack(FEED_ACK_KEY, stamp); });
    const after = stamp + 60_000;
    const feed: NotifyEvent[] = [
      { seq: 1, at: stamp - 60_000, kind: 'mail', sessionId: 'x', title: 'read already', body: '', runId: null },
      { seq: 2, at: after, kind: 'mail', sessionId: 'x', title: 'unread', body: '', runId: null },
      { seq: 3, at: after + 1, kind: 'interrupt', sessionId: 'x', title: 'interrupt · keycap', body: 'source=keycap outcome=sent', runId: null },
      { seq: 4, at: after + 2, kind: 'coord', sessionId: '', title: 'caps changed', body: 'workers 3 → 5', runId: null },
    ];
    // The same feed through the phone's mail door and the desk's Inbox tab.
    atWidth(899);
    render(<App />);
    act(() => useFleetStore.setState({ conn: 'open', feed }));
    expect(screen.getByRole('button', { name: 'Mail — 2 unread' })).toBeInTheDocument();
    cleanup();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    atWidth(900);
    render(<App />);
    expect(within(primary()).getByRole('button', { name: 'Inbox, 2 unread' })).toBeInTheDocument();
    act(() => useFleetStore.setState({ feed: [] }));
    expect(within(primary()).getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('New session opens the fleet flow\'s sheet; search opens the palette', () => {
    atWidth(1280);
    render(<App />);
    act(() => useFleetStore.setState({ conn: 'open' }));
    fireEvent.click(within(bar()).getByRole('button', { name: /New session/ }));
    expect(screen.getByRole('dialog', { name: /start a session/i })).toBeInTheDocument();
    cleanup();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    atWidth(1280);
    render(<App />);
    // The palette's field (the fleet's own `<select>` is a combobox too).
    const palette = (): Element | null => document.querySelector('input[role="combobox"]');
    expect(palette()).toBeNull();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Search and commands' }));
    expect(palette()).not.toBeNull();
  });

  for (const width of [899, 900]) {
    it(`one accounts strip and one banner stack at any width (${width})`, () => {
      atWidth(width);
      render(<App />);
      const fleet = screen.getByRole('region', { name: 'Fleet' });
      const readouts = document.querySelectorAll('.accounts-strip, .accounts-compact');
      expect(readouts).toHaveLength(1);
      // Every banner keeps a slot while it is mounted, shown or not, so one slot per id is one stack.
      for (const id of ['fleet-host', 'halt', 'update', 'substrate', 'offline', 'connecting', 'passkey']) {
        expect(document.querySelectorAll(`.banner-slot[data-banner="${id}"]`), id).toHaveLength(1);
      }
      const slot = document.querySelector('.banner-slot[data-banner="fleet-host"]')!;
      if (width >= 900) {
        expect(bar().contains(readouts[0]!), 'the gauges are the bar\'s').toBe(true);
        expect(fleet.contains(slot), 'the banners span the frame, not the sidebar').toBe(false);
        expect(slot.closest('.shell-banners')).not.toBeNull();
        // The sidebar's head keeps its readouts and gives its wordmark and doors to the bar: one identity mark.
        expect(document.querySelectorAll('[data-wordmark], .wordmark')).toHaveLength(1);
        expect(within(fleet).queryByRole('button', { name: /^Mail —/ })).toBeNull();
        expect(within(fleet).queryByRole('button', { name: /^Settings/ })).toBeNull();
      } else {
        expect(document.querySelector('header.shell-accounts')).toBeNull();
        expect(fleet.contains(readouts[0]!)).toBe(true);
        expect(fleet.contains(slot)).toBe(true);
        expect(within(fleet).getByRole('button', { name: /^Mail —/ })).toBeInTheDocument();
      }
    });
  }
});

describe("Refined's frame (refined.css)", () => {
  const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'skins', 'refined', 'refined.css'), 'utf8');
  /** The body of the first `@media` block whose query is exactly `query`. */
  const block = (query: string): string => {
    const at = css.indexOf(`@media ${query} {`);
    expect(at, query).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = css.indexOf('{', at); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(at, i); }
    }
    return '';
  };

  it('the sidebar is clamp(320px, 24vw, 400px), and 400 at ≥1600', () => {
    expect(block('(min-width: 900px)')).toMatch(/grid-template-columns:\s*clamp\(320px, 24vw, 400px\) minmax\(0, 1fr\);/);
    expect(block('(min-width: 900px)')).toMatch(/grid-template-rows:\s*56px auto minmax\(0, 1fr\);/);
    expect(block('(min-width: 1600px)')).toMatch(/grid-template-columns:\s*400px minmax\(0, 1fr\);/);
  });
});
