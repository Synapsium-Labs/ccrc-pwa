// Refined's phone header, subtitle, gauges and FAB (W2 Task S5, D-5471).
//
// What a person on a phone sees first, held through `App` in the Refined skin: one header row of the wordmark and four
// icon doors (each a registry command, each named by its word, a badged one by its count too), one mono readout under
// it from `fleetSummary`, the lane gauges as a grid, and an extended `+ New` in the thumb's corner that publishes its
// height so a toast clears it. jsdom applies no media queries and no layout, so a width is a `matchMedia` stub that
// answers every `min-width` and `max-width` query against one number, and what this file counts is what is MOUNTED;
// what is visible at each width is the per-width render pass.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { INSTRUMENT, REFINED, toast } from '@ccrc/ui';
import type { AccountUsage, NotifyEvent, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { pageAt, treeOk, treeResponse } from './docsFixtures';
import type { DocsVisit } from '../src/docs/useDocsVisit';

// The bell renders only where the browser can push; this one can, so a bell left in the header would show.
vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
  enablePush: async () => ({ status: 'enabled' }),
  disablePush: async () => {},
}));

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { ack, FEED_ACK_KEY } = await import('../src/lib/seen');
const { fleetSummary } = await import('../src/fleet/fleetSummary');
const { api } = await import('../src/lib/api');
const { DocsHead } = await import('../src/docs/DocsHead');

/** A Docs visit whose actions are inert: the up door reads only the page. */
const docsVisit = (): DocsVisit => ({
  tree: { s: 'ok', answer: treeResponse(treeOk()), receivedAt: Date.now() },
  file: { s: 'none' }, freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null,
  retryTree: vi.fn(), retryFile: vi.fn(), refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
});

const SRC = path.join(import.meta.dirname, '..', 'src');

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

const nowSec = Math.floor(Date.now() / 1000);
const lane = (wrapper: string, five: number | null, seven: number | null): AccountUsage => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  setSkin(REFINED);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => { navigate('/'); });
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], feed: [], runs: [], runsFrameSeen: false }));
  setSkin(REFINED);
});

const head = (): HTMLElement => {
  const h = document.querySelector<HTMLElement>('header.ref-phone-head');
  expect(h, 'the phone header is mounted').not.toBeNull();
  return h!;
};
const DOORS = [
  ['go-inbox', 'Inbox'],
  ['go-runs', 'Runs'],
  ['go-docs', 'Docs'],
  ['go-settings', 'Settings'],
] as const;

describe("Refined's phone header (W2 Task S5)", () => {
  it('the phone header holds the wordmark and the four doors, each with its word as its accessible name, each at least --tap-min, each carrying its data-command', () => {
    atWidth(390);
    render(<App />);
    const h = head();
    expect(h.querySelector('[data-wordmark]'), 'the identity core').not.toBeNull();
    const doors = [...within(h).getByRole('navigation', { name: 'Primary' }).querySelectorAll<HTMLElement>('[data-command]')];
    expect(doors.map((d) => d.getAttribute('data-command'))).toEqual(DOORS.map(([id]) => id));
    for (const [i, [, word]] of DOORS.entries()) {
      expect(doors[i], word).toHaveAccessibleName(word);
      // jsdom has no layout: the floor is the tap utilities on the door itself (the census measures the rule).
      expect(doors[i], `${word} is at least --tap-min high`).toHaveClass('min-h-tap');
      expect(doors[i], `${word} is at least --tap-min wide`).toHaveClass('min-w-tap');
      expect(doors[i]!.className, word).not.toMatch(/(^|\s)h-\d/);
    }
    // A door runs its command: the layer navigates.
    fireEvent.click(within(h).getByRole('button', { name: 'Runs' }));
    expect(location.pathname).toBe('/runs');
  });

  it("a badged door's name carries its count", () => {
    const stamp = Date.now();
    act(() => { ack(FEED_ACK_KEY, stamp); });
    const feed: NotifyEvent[] = [
      { seq: 1, at: stamp - 60_000, kind: 'mail', sessionId: 'x', title: 'read already', body: '', runId: null },
      { seq: 2, at: stamp + 60_000, kind: 'mail', sessionId: 'x', title: 'unread', body: '', runId: null },
      { seq: 3, at: stamp + 60_001, kind: 'mail', sessionId: 'x', title: 'unread too', body: '', runId: null },
    ];
    const open = { id: 1, program: 'p', state: 'working', closedAt: null } as unknown as RunSummary;
    atWidth(390);
    render(<App />);
    act(() => useFleetStore.setState({ conn: 'open', feed, runs: [open], runsFrameSeen: true }));
    const h = head();
    expect(within(h).getByRole('button', { name: 'Inbox, 2 unread' })).toHaveAttribute('data-command', 'go-inbox');
    expect(within(h).getByRole('button', { name: 'Runs, 1 active' })).toHaveAttribute('data-command', 'go-runs');
    act(() => useFleetStore.setState({ feed: [] }));
    expect(within(h).getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
  });

  it("the subtitle is `fleetSummary`'s readout", () => {
    const sessions = [fleetSession({ id: 'a', bucket: 'attention' }), fleetSession({ id: 'b' }), fleetSession({ id: 'c' })];
    const runs = [{ id: 1, program: 'p', state: 'working', closedAt: null } as unknown as RunSummary];
    atWidth(390);
    render(<App />);
    act(() => useFleetStore.setState({ conn: 'open', sessions, runs, runsFrameSeen: true }));
    const line = head().querySelector('.ref-phone-sub');
    expect(line).toHaveTextContent(fleetSummary(sessions, runs).readout);
    // The one function counts; the header counts nothing itself (W2 plan, "one derived value, one function").
    const code = readFileSync(path.join(SRC, 'skins', 'refined', 'PhoneHeader.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/import \{[^}]*\bfleetSummary\b[^}]*\} from '..\/..\/fleet\/fleetSummary'/);
    expect(code).not.toMatch(/\.length\b|\.filter\(|\.reduce\(/);
  });

  it('the FAB opens New session, and no FAB is mounted at ≥900', () => {
    atWidth(390);
    render(<App />);
    act(() => useFleetStore.setState({ conn: 'open' }));
    const fab = document.querySelector<HTMLElement>('.ref-fab');
    expect(fab).not.toBeNull();
    expect(fab).toHaveAttribute('data-command', 'new-session');
    expect(fab).toHaveAccessibleName(/New/);
    fireEvent.click(fab!);
    expect(screen.getByRole('dialog', { name: /start a session/i })).toBeInTheDocument();
    cleanup();
    for (const width of [900, 1280]) {
      atWidth(width);
      render(<App />);
      expect(document.querySelector('.ref-fab'), `${width}`).toBeNull();
      // The bar's `+ New session` is the one door to the command at a desk.
      expect(document.querySelectorAll('[data-command="new-session"]'), `${width}`).toHaveLength(1);
      cleanup();
    }
  });

  it('a toast shown on the fleet sits above the FAB', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains('ref-fab') ? 56 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
    });
    atWidth(390);
    render(<App />);
    const published = (): string => document.documentElement.style.getPropertyValue('--phone-nav-h');
    expect(published()).toMatch(/56px/);
    act(() => { toast('Saved'); });
    const host = document.querySelector('.toast-host');
    expect(host).not.toBeNull();
    // The host's offset sums the composer and whatever is fixed to the bottom edge.
    expect(host!.className).toMatch(/var\(--composer-h,0px\)\+var\(--phone-nav-h,0px\)/);
    // Off the fleet route the FAB is not mounted, so nothing is published for a toast to clear.
    act(() => { navigate('/runs'); });
    expect(document.querySelector('.ref-fab')).toBeNull();
    expect(published()).toBe('');
  });

  it('the gauges grid has one gauge per lane, two columns, the grid one door to /accounts', async () => {
    const lanes = [lane('lane-a', 30, 80), lane('lane-b', 12, null), lane('lane-c', null, 5), lane('lane-d', 1, 2), lane('lane-e', 3, 4)];
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: lanes, projected: { wrapper: 'lane-a', score: 0 }, roster: [] });
    atWidth(390);
    render(<App />);
    const grid = await within(head()).findByRole('link', { name: /^account usage.* — open accounts$/ });
    await within(grid).findByText('lane-a');
    expect(grid).toHaveAttribute('data-compact', 'grid');
    expect(grid).toHaveAttribute('data-command', 'go-accounts');
    expect(grid.querySelectorAll('.accounts-compact-gauge')).toHaveLength(lanes.length);
    // One readout of the lanes on the page: the grid replaces the phone's strip.
    expect(document.querySelectorAll('.accounts-strip, .accounts-compact')).toHaveLength(1);
    const css = readFileSync(path.join(SRC, 'fleet', 'fleet.css'), 'utf8');
    expect(css).toMatch(/\.accounts-compact\[data-compact='grid'\] \.accounts-compact-lanes \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });

  it('Refined renders neither FleetHead nor `.fab`; Instrument still renders both', () => {
    atWidth(390);
    render(<App />);
    expect(document.querySelector('.fleet-head')).toBeNull();
    expect(document.querySelector('.fab')).toBeNull();
    // The bell lives in Settings' notifications section on a Refined phone.
    expect(within(head()).queryByRole('button', { name: /^Notifications/ })).toBeNull();
    cleanup();
    setSkin(INSTRUMENT);
    atWidth(390);
    render(<App />);
    expect(document.querySelector('.fleet-head')).not.toBeNull();
    expect(document.querySelector('.fab')).not.toBeNull();
    expect(document.querySelector('header.ref-phone-head')).toBeNull();
    expect(document.querySelector('.ref-fab')).toBeNull();
  });
});

describe('the back door to the fleet (W2 Task S5, the door table\'s go-fleet row)', () => {
  for (const route of ['/runs', '/accounts', '/mail', '/settings', '/archive', '/digest', '/s/a']) {
    it(`the back button on ${route} carries go-fleet`, () => {
      atWidth(390);
      render(<App />);
      act(() => { navigate(route); });
      const back = screen.getAllByRole('button', { name: 'Back to fleet' });
      expect(back.length, route).toBeGreaterThan(0);
      for (const b of back) expect(b, route).toHaveAttribute('data-command', 'go-fleet');
    });
  }

  it('a back button whose target is not the fleet carries no go-fleet', () => {
    atWidth(390);
    render(<App />);
    act(() => { navigate('/settings/updates'); });
    const back = screen.getByRole('button', { name: 'Back to Settings' });
    expect(back).not.toHaveAttribute('data-command');
  });

  it("the Docs index's up door, whose target is the fleet, carries go-fleet; deeper up doors do not", () => {
    const upDoor = (url: string): HTMLElement => {
      cleanup();
      const visit = { ...docsVisit(), tree: null };
      render(<DocsHead page={pageAt(url)} visit={visit} tree={null} />);
      const b = document.querySelector<HTMLElement>('.docs-back');
      expect(b, url).not.toBeNull();
      return b!;
    };
    expect(upDoor('/docs')).toHaveAttribute('data-command', 'go-fleet');
    for (const url of ['/docs/demo', '/docs/demo/specs', '/docs/demo/specs/a.md']) {
      expect(upDoor(url), url).not.toHaveAttribute('data-command');
    }
  });
});
