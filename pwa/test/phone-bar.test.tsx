// Getting around on a phone (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D25; §9 "Getting around on a phone").
//
// The console's ONE list of places (`lib/places.ts`) is read by the phone's bottom bar (`PhoneBar`, both skins' `PhoneNav`),
// Refined's desk bar and Instrument's rail. The phone bar shows every place, fleet first, with their badges and a Search door,
// on every page but an open session; a desk's navigation shows no fleet place; nothing changes inside a session. jsdom applies
// no media query, so the width is the frame's `useMediaQuery` answer (`atWidth`), and the bar's real layout is the browser
// leg's (`browser/phone-bar.browser.test.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { fleetSession } from './fleetFixture';
import { itemView, waitingView } from './ledgersFixture';

vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
  enablePush: async () => ({ status: 'enabled' }),
  disablePush: async () => {},
}));

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { DESK_PLACES, PLACES, phoneBarShown } = await import('../src/lib/places');
const { ROUTES } = await import('../src/lib/routes');
const { RAIL_ITEMS } = await import('../src/skins/instrument/Rail');
const { setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');

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

const SESSION = fleetSession({ id: 'lane-a-quiet', bucket: 'idle' });
/** The places as the operator steers them, written out here rather than read back from `PLACES`. */
const PHONE_DOORS = ['go-fleet', 'go-waiting', 'go-inbox', 'go-runs', 'go-accounts', 'go-docs', 'open-palette'];
const DESK_TABS = ['go-waiting', 'go-inbox', 'go-runs', 'go-accounts', 'go-docs'];

const phoneBar = (): HTMLElement | null => document.querySelector<HTMLElement>('nav.shell-phone-nav');
const doorsOf = (el: Element): string[] => [...el.querySelectorAll('[data-command]')].map((d) => d.getAttribute('data-command')!);

function mount(path: string): void {
  act(() => { navigate(path); });
  render(<App />);
  act(() => useFleetStore.setState({ conn: 'open', sessions: [SESSION], fleetFrameSeen: true, waiting: waitingView({ items: [itemView({ id: 1 })] }) }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => { navigate('/'); });
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], feed: [], runs: [], runsFrameSeen: false, fleetFrameSeen: false, waiting: null }));
});

describe('the one list of places', () => {
  it('every place is a top route, in the operator\'s order, fleet first; the desk list is the same less the fleet', () => {
    expect(PLACES.map((p) => `go-${p.id}`)).toEqual(PHONE_DOORS.slice(0, -1));
    for (const p of PLACES) expect(ROUTES.find((r) => r.id === p.id)?.top, p.id).toBe(true);
    expect(DESK_PLACES.map((p) => `go-${p.id}`)).toEqual(DESK_TABS);
  });

  it('the bar shows on every page but an open session', () => {
    for (const path of ['/', '/waiting', '/waiting/1', '/programmes/prog-a', '/docs', '/docs/project-a/specs/a.md', '/settings', '/runs', '/nope']) {
      expect(phoneBarShown(path), path).toBe(true);
    }
    expect(phoneBarShown(`/s/${SESSION.id}`)).toBe(false);
  });
});

for (const skin of [REFINED, INSTRUMENT] as const) {
  describe(`${skin}: getting around on a phone`, () => {
    beforeEach(() => { setSkin(skin); });

    it('the phone bar shows the desk places with their badges on the ledger pages', () => {
      for (const width of [360, 390, 899]) {
        for (const path of ['/waiting', '/waiting/1', '/programmes/prog-a', '/docs', '/settings', '/']) {
          atWidth(width);
          mount(path);
          const bar = phoneBar();
          expect(bar, `${width} ${path}: the bar`).not.toBeNull();
          expect(bar).toHaveAttribute('aria-label', 'Navigation');
          expect(doorsOf(bar!), `${width} ${path}`).toEqual(PHONE_DOORS);
          // The badge is the one count every door reads: one open item waits on the operator, one session asks nothing.
          expect(within(bar!).getByRole('button', { name: 'Waiting on you, 1 waiting on you' })).toHaveAttribute('data-command', 'go-waiting');
          expect(within(bar!).getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
          // Each door is named by its place's title, and the word it shows begins that name.
          for (const door of bar!.querySelectorAll<HTMLElement>('[data-command]')) {
            const word = door.querySelector('.phone-bar-word')?.textContent ?? '';
            expect(word, door.getAttribute('data-command')!).not.toBe('');
            expect(door.getAttribute('aria-label')!.startsWith(word), `${door.getAttribute('aria-label')} begins with ${word}`).toBe(true);
          }
          cleanup();
        }
      }
    });

    it('on a fleet with no sessions the Accounts and Inbox doors are there, the durable doors to both (D-161, D-2)', () => {
      atWidth(390);
      act(() => { navigate('/'); });
      render(<App />);
      act(() => useFleetStore.setState({ conn: 'open', sessions: [], fleetFrameSeen: true }));
      const bar = phoneBar();
      expect(within(bar!).getByRole('button', { name: 'Accounts' })).toHaveAttribute('data-command', 'go-accounts');
      expect(within(bar!).getByRole('button', { name: 'Inbox' })).toHaveAttribute('data-command', 'go-inbox');
    });

    it('no door in a phone head duplicates a bar place (the ruling of 2026-11-04)', () => {
      atWidth(390);
      mount('/');
      const head = document.querySelector<HTMLElement>('.shell-nav .ref-phone-head, .shell-nav .fleet-head');
      expect(head, 'the phone head').not.toBeNull();
      // Every door the head draws, by where it goes: a registry door by its command, a plain door by the route it names. The
      // lane gauges (the accounts strip, with its All accounts control) are not a door to a place but the gauges, which the
      // ruling keeps; the strip is the desk's too (slug pl10-strip-all-accounts-stays).
      const places = new Set(PLACES.map((p) => p.id));
      const outsideStrip = (el: Element): boolean => el.closest('.accounts-strip') === null;
      const headDoors = [...head!.querySelectorAll<HTMLElement>('button')].filter(outsideStrip).map((b) => b.getAttribute('aria-label') ?? '');
      const titles = PLACES.map((p) => ROUTES.find((r) => r.id === p.id)!.title);
      for (const name of headDoors) {
        for (const title of [...titles, 'Mail', 'Account']) expect(name.startsWith(title), `${skin}'s head door "${name}"`).toBe(false);
      }
      const commands = [...head!.querySelectorAll('[data-command]')].filter(outsideStrip).map((d) => d.getAttribute('data-command')!);
      for (const c of commands) expect(places.has(c.replace(/^go-/, '')), `${skin}'s head door ${c}`).toBe(false);
      expect(within(head!).getByRole('button', { name: /^Settings/ })).toBeInTheDocument();
    });

    it('the place the page is on or under is current; a tap goes there', () => {
      atWidth(390);
      mount('/docs/project-a/specs/a.md');
      const current = (): string[] => [...phoneBar()!.querySelectorAll('[aria-current="page"]')].map((d) => d.getAttribute('data-command')!);
      expect(current()).toEqual(['go-docs']);
      fireEvent.click(within(phoneBar()!).getByRole('button', { name: 'Fleet' }));
      expect(location.pathname).toBe('/');
      expect(current()).toEqual(['go-fleet']);
      fireEvent.click(within(phoneBar()!).getByRole('button', { name: /^Waiting on you/ }));
      expect(location.pathname).toBe('/waiting');
      expect(current()).toEqual(['go-waiting']);
    });

    it('the phone bar is absent in an open session and at a desk', () => {
      for (const width of [360, 390]) {
        atWidth(width);
        mount(`/s/${SESSION.id}`);
        expect(phoneBar(), `${width}: in a session`).toBeNull();
        cleanup();
      }
      for (const width of [900, 1280]) {
        for (const path of ['/waiting', '/waiting/1', '/', `/s/${SESSION.id}`]) {
          atWidth(width);
          mount(path);
          expect(phoneBar(), `${width} ${path}`).toBeNull();
          cleanup();
        }
      }
    });

    it('the desk bar and rail show no fleet place, and the phone bar shows it first', () => {
      atWidth(1280);
      mount('/waiting');
      const primary = document.querySelector('nav[aria-label="Primary"]')!;
      const desk = doorsOf(primary).filter((c) => c.startsWith('go-') && c !== 'go-settings' && c !== 'go-archive');
      expect(desk, 'the desk navigation').toEqual(DESK_TABS);
      expect(doorsOf(document.body)).not.toContain('go-fleet');
      cleanup();
      atWidth(390);
      mount('/waiting');
      expect(doorsOf(phoneBar()!)[0]).toBe('go-fleet');
    });

    it("an open session's chrome is unchanged at phone and desk widths", () => {
      for (const width of [390, 1280]) {
        atWidth(width);
        mount(`/s/${SESSION.id}`);
        const navs = [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label'));
        // The navigation landmarks a session had before PL10: none of a phone's own, a desk's primary navigation.
        expect(navs.filter((n) => n === 'Navigation'), `${width}`).toEqual([]);
        expect(document.querySelector('.app-shell')!.getAttribute('style'), `${width}: the shell publishes nothing inline`).toBeNull();
        cleanup();
      }
    });
  });
}

describe("Instrument's rail reads the one list", () => {
  it('its head is the desk places with Archive after Accounts, then its foot', () => {
    const ids = RAIL_ITEMS.filter((i) => !('reserved' in i)).map((i) => i.id);
    expect(ids).toEqual(['waiting', 'inbox', 'runs', 'accounts', 'archive', 'docs', 'bell', 'settings']);
  });
});
