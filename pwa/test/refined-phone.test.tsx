// Refined's phone header, subtitle, gauges and FAB (W2 Task S5, D-5471).
//
// What a person on a phone sees first, held through `App` in the Refined skin: one header row of the wordmark and four
// icon doors (each a registry command, each named by its word, a badged one by its count too), one mono readout under
// it from `fleetSummary`, the full accounts strip (each lane's 5h and 7d rows, the strip one `go-accounts` door), and
// an extended `+ New` in the thumb's corner that publishes its height so a toast clears it. jsdom applies no media
// queries and no layout, so a width is a `matchMedia` stub that answers every `min-width` and `max-width` query against
// one number, and what this file counts is what is MOUNTED; what is visible at each width is the per-width render pass.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { INSTRUMENT, REFINED, toast } from '@ccrc/ui';
import type { AccountUsage, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { seventeenLanes } from './seventeenLanes';
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
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], feed: [], runs: [], runsFrameSeen: false, fleetFrameSeen: false }));
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
    // Only what waits on the operator is counted (T2d, D-6330): two sessions ask, and one run's worker is one of them.
    const sessions = [
      fleetSession({ id: 'ask-a', bucket: 'attention' }),
      fleetSession({ id: 'ask-b', bucket: 'attention' }),
      fleetSession({ id: 'calm', bucket: 'idle' }),
    ];
    const run = (id: number, sessionId: string): RunSummary =>
      ({ id, program: 'p', state: 'working', closedAt: null, sessionId, claimedBy: 'calm' }) as unknown as RunSummary;
    atWidth(390);
    render(<App />);
    act(() => useFleetStore.setState({ conn: 'open', sessions, fleetFrameSeen: true, runs: [run(1, 'ask-a'), run(2, 'calm')], runsFrameSeen: true }));
    const h = head();
    expect(within(h).getByRole('button', { name: 'Inbox, 2 waiting for you' })).toHaveAttribute('data-command', 'go-inbox');
    expect(within(h).getByRole('button', { name: 'Runs, 1 needs you' })).toHaveAttribute('data-command', 'go-runs');
    act(() => useFleetStore.setState({ sessions: [fleetSession({ id: 'calm', bucket: 'idle' })] }));
    expect(within(h).getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
    expect(within(h).getByRole('button', { name: 'Runs' })).toBeInTheDocument();
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

  it("the phone header shows the full strip: each lane's 5h and 7d rows, each card its lane's door, All accounts the go-accounts door", async () => {
    const lanes = [lane('lane-a', 30, 80), lane('lane-b', 12, null), lane('lane-c', null, 5), lane('lane-d', 1, 2), lane('lane-e', 3, 4)];
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: lanes, projected: { wrapper: 'lane-a', score: 0 }, roster: [] });
    atWidth(390);
    render(<App />);
    const strip = await within(head()).findByRole('group', { name: /^account usage, highest lane-a 80%/ });
    await within(strip).findByText('lane-a');
    expect(strip).toHaveClass('accounts-strip');
    // The strip is no door itself: its cards are, and the end cell's All accounts is the `go-accounts` door.
    expect(strip).not.toHaveAttribute('data-command');
    const cards = [...strip.querySelectorAll<HTMLElement>('.account-gauge')];
    expect(cards).toHaveLength(lanes.length);
    // Most free first: lane-d (2), lane-e (4), lane-c (5), lane-b (12), lane-a (80).
    const name = (card: HTMLElement): string => card.querySelector('.account-gauge-label')?.textContent ?? '';
    expect(cards.map(name)).toEqual(['lane-d', 'lane-e', 'lane-c', 'lane-b', 'lane-a']);
    const windows = (card: HTMLElement): string[] => [...card.querySelectorAll('.acct-win')].map((w) => w.textContent ?? '');
    expect(windows(cards.find((c) => name(c) === 'lane-a')!)).toEqual(['5h', '7d']);
    expect(windows(cards.find((c) => name(c) === 'lane-b')!)).toEqual(['5h']);
    expect(windows(cards.find((c) => name(c) === 'lane-c')!)).toEqual(['7d']);
    // One readout of the lanes on the page: the full strip is the phone's.
    expect(document.querySelectorAll('.accounts-strip')).toHaveLength(1);
    // A card opens its lane; All accounts is a command door, which the layer navigates.
    fireEvent.click(cards.find((c) => name(c) === 'lane-b')!);
    expect(location.pathname).toBe('/accounts');
    expect(location.search).toBe('?lane=lane-b');
    act(() => { navigate('/'); });
    const all = await within(head()).findByRole('button', { name: 'All accounts' });
    expect(all).toHaveAttribute('data-command', 'go-accounts');
    fireEvent.click(all);
    expect(location.pathname).toBe('/accounts');
    expect(location.search).toBe('');
  });

  // The strip folds at every width (S5b, D-6530): four cards on a phone, whatever its width, and the control's words say
  // what the fold hides that needs the operator.
  const stubSeventeen = (): void => {
    const f = seventeenLanes(nowSec);
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: f.accounts, projected: { wrapper: 'w0', score: 0 }, roster: f.roster });
  };
  const cardNames = (strip: HTMLElement): string[] =>
    [...strip.querySelectorAll<HTMLElement>('.account-gauge')].map((c) => c.querySelector('.account-gauge-label')?.textContent ?? '');

  it("at 390 with 17 lanes the phone header shows four cards and '+13 more · 1 sign-in expired · 1 rate-limited'", async () => {
    stubSeventeen();
    atWidth(390);
    render(<App />);
    const strip = await within(head()).findByRole('group', { name: /^account usage, highest lane-q 100%/ });
    await within(strip).findByText('lane-a');
    expect(cardNames(strip)).toEqual(['lane-a', 'lane-f', 'lane-with-a-very-long-name-q', 'lane-e']);
    const more = within(strip).getByRole('button', { name: '+13 more · 1 sign-in expired · 1 rate-limited' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    // The end cell holds the control, then All accounts: still one strip on the page.
    expect(more.closest('.accounts-end')!.lastElementChild).toBe(within(strip).getByRole('button', { name: 'All accounts' }));
    expect(document.querySelectorAll('.accounts-strip')).toHaveLength(1);
  });

  it('the choice to expand is remembered across a remount', async () => {
    stubSeventeen();
    atWidth(390);
    const first = render(<App />);
    const strip = await within(head()).findByRole('group', { name: /^account usage/ });
    await within(strip).findByText('lane-a');
    fireEvent.click(within(strip).getByRole('button', { name: /^\+13 more/ }));
    expect(cardNames(strip)).toHaveLength(17);
    first.unmount();
    render(<App />);
    const again = await within(head()).findByRole('group', { name: /^account usage/ });
    await within(again).findByText('lane-a');
    expect(cardNames(again)).toHaveLength(17);
    expect(within(again).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
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
