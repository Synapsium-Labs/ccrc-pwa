// Getting around on a phone (desktop-polish PL10, D-7952; spec 2026-10-31 §2, D25; §9 "Getting around on a phone").
//
// The console's ONE list of places (`lib/places.ts`) is read by the phone's bottom bar (`PhoneBar`, both skins' `PhoneNav`),
// Refined's desk bar and Instrument's top bar doors. The phone bar shows every place, fleet first, with their badges and a Search door,
// on every page but an open session; a desk's navigation shows no fleet place; nothing changes inside a session. jsdom applies
// no media query, so the width is the frame's `useMediaQuery` answer (`atWidth`), and the bar's real layout is the browser
// leg's (`browser/phone-bar.browser.test.ts`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { fleetSession } from './fleetFixture';
import { itemView, waitingView } from './ledgersFixture';
import { labelInName } from './labelInName';
import { declValue, ruleIn } from './cssRule';

vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
  enablePush: async () => ({ status: 'enabled' }),
  disablePush: async () => {},
}));

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { DESK_PLACES, PLACES, phoneBarShown } = await import('../src/lib/places');
const { ROUTES, topRouteOf } = await import('../src/lib/routes');
const { DESK_DOORS } = await import('../src/skins/instrument/TopBar');
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

  // Review 1466 F14 (fix round 1): a path outside the table is under no place, so no door says the page is there, whatever it
  // starts with; a path the table routes is under the place it starts with, and a session under the fleet.
  it('a path outside the table is under no place; one in the table is under its place', () => {
    for (const path of ['/waiting/abc', '/runs/x', '/settings/a/b', '/docsx', '/nope', '/waiting/%E0%A4%A']) {
      expect(topRouteOf(path)?.id ?? null, path).toBeNull();
    }
    const under: Array<[string, string]> = [
      ['/waiting/1', 'waiting'], ['/settings/measure-highlighting', 'settings'], ['/docs/project-a/specs/a.md', 'docs'],
      [`/s/${SESSION.id}`, 'fleet'], ['/runs', 'runs'], ['/', 'fleet'],
    ];
    for (const [path, id] of under) expect(topRouteOf(path)?.id ?? null, path).toBe(id);
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

    // Review 1643 F5 (desktop-polish Task C14, D-8110): no contract change. At 100 or more the pill prints "99+" and the name
    // carries the real count, by design (`badgePrint`), so label in name is read on the door's word, not on its pill.
    it('at a count of 100 or more the pill prints 99+, the name the real count, and the word is in the name', () => {
      atWidth(390);
      mount('/');
      const items = Array.from({ length: 120 }, (_, i) => itemView({ id: i + 1 }));
      act(() => useFleetStore.setState({ waiting: waitingView({ items }) }));
      const door = within(phoneBar()!).getByRole('button', { name: 'Waiting on you, 120 waiting on you' });
      const name = door.getAttribute('aria-label')!;
      expect(door.querySelector('.phone-bar-count')).toHaveTextContent(/^99\+$/);
      expect(labelInName(door.querySelector('.phone-bar-word')!.textContent!, name)).toBe(true);
      // No whole-text false pin: this skin joins the word and count with no space, so it would be vacuous (review 1689 F9).
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

    // The ruling of 2026-11-04 and review 1466 F3: a phone's chrome keeps no door to a place the bar holds. The lane cards are
    // gauges (each opens its own lane) and are the only doors passed over; the strip's All accounts and its no-lane placeholder
    // are doors to the Accounts place and are not drawn on a phone. The head is each skin's phone head and the accounts strip,
    // wherever a skin puts it (Instrument's sits outside its `<header>`).
    it('no door in a phone head duplicates a bar place, with no lane to show and with lanes (the ruling of 2026-11-04, review 1466 F3)', () => {
      const lane = { wrapper: 'lane-a', five: 10, seven: 20, ts: null, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false };
      for (const usage of [null, [lane]]) {
        atWidth(390);
        mount('/');
        act(() => useFleetStore.setState({ usage }));
        const heads = [...document.querySelectorAll<HTMLElement>('.shell-nav .ref-phone-head, .shell-nav .fleet-head, .shell-nav .accounts-strip')];
        expect(heads.length, `${skin}: the phone head`).toBeGreaterThan(0);
        const doorish = 'button, a, [role="link"], [data-command]';
        const chrome = heads.flatMap((h) => [...(h.matches(doorish) ? [h] : []), ...h.querySelectorAll<HTMLElement>(doorish)])
          .filter((el) => el.closest('.account-gauge') === null);
        const titles = PLACES.map((p) => ROUTES.find((r) => r.id === p.id)!.title);
        const places = new Set(PLACES.map((p) => p.id));
        for (const el of chrome) {
          const name = el.getAttribute('aria-label') ?? el.textContent ?? '';
          for (const title of [...titles, 'Mail', 'Account', 'All accounts']) expect(name.startsWith(title), `${skin}, ${usage === null ? 'no lane' : 'a lane'}: "${name}"`).toBe(false);
          const command = el.getAttribute('data-command');
          if (command !== null) expect(places.has(command.replace(/^go-/, '')), `${skin}: ${command}`).toBe(false);
        }
        if (usage !== null) expect(document.querySelectorAll('.shell-nav .account-gauge').length, `${skin}: the lane gauges stay`).toBeGreaterThan(0);
        expect(within(document.querySelector<HTMLElement>('.shell-nav')!).getByRole('button', { name: /^Settings/ })).toBeInTheDocument();
        cleanup();
        act(() => useFleetStore.setState({ usage: null }));
      }
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

    // Desk-nav Task A (D-8100): Instrument's wordmark is the desk's one way home, a door that runs go-fleet; no place door does.
    it('the desk bar shows no fleet place, and the phone bar shows it first', () => {
      atWidth(1280);
      mount('/waiting');
      const primary = document.querySelector('nav[aria-label="Primary"]')!;
      const desk = doorsOf(primary).filter((c) => c.startsWith('go-') && c !== 'go-fleet' && c !== 'go-settings' && c !== 'go-archive');
      expect(desk, 'the desk navigation').toEqual(DESK_TABS);
      const home = [...document.querySelectorAll('[data-command="go-fleet"]')];
      expect(home, 'the one go-fleet at a desk is the wordmark door').toHaveLength(skin === INSTRUMENT ? 1 : 0);
      if (skin === INSTRUMENT) expect(home[0]!.querySelector('[data-wordmark]'), 'it holds the wordmark').not.toBeNull();
      cleanup();
      atWidth(390);
      mount('/waiting');
      expect(doorsOf(phoneBar()!)[0]).toBe('go-fleet');
    });

    // Named for what it checks (review 1466 F19): nothing of the bar reaches an open session, at either width.
    it('an open session draws no phone navigation and the shell publishes nothing inline, at phone and desk widths', () => {
      for (const width of [390, 1280]) {
        atWidth(width);
        mount(`/s/${SESSION.id}`);
        const navs = [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label'));
        // The navigation landmarks a session had before PL10: none of a phone's own, a desk's primary navigation.
        expect(navs.filter((n) => n === 'Navigation'), `${width}`).toEqual([]);
        expect(document.querySelector('.shell-phone-nav, .phone-bar'), `${width}`).toBeNull();
        expect(document.querySelector('.app-shell')!.getAttribute('style'), `${width}: the shell publishes nothing inline`).toBeNull();
        cleanup();
      }
    });
  });
}

// Review 1466 F19 (fix round 1): below 900 the shell lifts `--safe-bottom` above the bar, and `.fleet` reserves it at its foot,
// so the list inside it keeps only the device's inset under its own reservation for the round `+`: the bar is reserved once.
describe('the fleet reserves the bar once', () => {
  it("`.fleet` lifts above the bar through --safe-bottom; `.fleet-list` adds the device's inset alone", () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(declValue(ruleIn(css, '.fleet'), 'padding')).toContain('var(--safe-bottom)');
    const list = declValue(ruleIn(css, '.fleet-list'), 'padding-bottom');
    expect(list).not.toContain('--safe-bottom');
    expect(list).toContain('env(safe-area-inset-bottom,0px)');
  });
});

describe("Instrument's desk doors read the one list", () => {
  it('they are the desk places with Archive after Accounts', () => {
    const ids = DESK_DOORS.filter((i) => !('reserved' in i)).map((i) => i.id);
    expect(ids).toEqual(['waiting', 'inbox', 'runs', 'accounts', 'archive', 'docs']);
  });
});
