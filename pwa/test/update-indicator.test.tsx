// UpdateIndicator (D-6327): the fleet's "a release is out" line, one quiet door to Settings › Updates, replacing the
// full-width banner. Held through `App` in each skin at 899 and 900 (what is MOUNTED, since jsdom lays nothing out), and
// through `FleetChromeProvider` alone where the case is about the component. A width is a `matchMedia` stub answering
// every min-width query against one number, as the shell suites do.
//
// RED FIRST, on the task's base: this file did not compile there (no `fleet/UpdateIndicator.tsx`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { NodeWire, UpdatesView } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { renderFleet } from './fleetHost';

const { App } = await import('../src/app');
const { api } = await import('../src/lib/api');
const { navigate } = await import('../src/lib/router');
const { setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { DOOR_EVENT } = await import('../src/command/door');
const { BANNER_ORDER } = await import('../src/fleet/BannerStack');
const { UpdateIndicator } = await import('../src/fleet/UpdateIndicator');
const { UPDATES_STALE_TEXT } = await import('../src/fleet/useUpdatesView');

const MIN = 60_000;
const NAME = 'Update v0.0.9 available, open Settings › Updates';
const WORDS = '↑ v0.0.9 available';

const nodeOf = (role: 'fleet' | 'server', over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: role === 'fleet' ? '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10' : '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93',
  role, label: role, os: 'linux',
  current: { sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version: 'v0.0.7' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: role === 'server' ? null : [], highestVersion: 'v0.0.7', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const waiting = (): UpdatesView => ({
  catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null }, releases: [],
  nodes: [nodeOf('fleet'), nodeOf('server')], intent: [],
});
const current = (): UpdatesView => ({
  ...waiting(), nodes: [nodeOf('fleet', { desiredTag: 'v0.0.7' }), nodeOf('server', { desiredTag: 'v0.0.7' })],
});

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

/** `until`, not `waitFor`: other suites leave `setInterval` as a fake-clock wrapper; `setTimeout` is real. */
const until = async (check: () => void): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    try { check(); return; } catch { /* not yet */ }
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  check();
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => { navigate('/'); });
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], feed: [], runs: [], runsFrameSeen: false }));
});

const SESSION = '/s/lane-a-project-a';
const indicators = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.update-indicator')];

describe('UpdateIndicator (D-6327)', () => {
  it('no update banner renders in any stack at any width', async () => {
    expect(Object.keys(BANNER_ORDER), 'the stack ranks no update banner').not.toContain('update');
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    for (const skin of [REFINED, INSTRUMENT]) {
      for (const width of [899, 900]) {
        setSkin(skin);
        atWidth(width);
        act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-project-a', project: 'project-a' })] }));
        render(<App />);
        // The release IS waiting (the indicator shows), and still no banner slot, class or sentence names it.
        await until(() => expect(indicators().length).toBe(1));
        const at = `${skin} ${width}`;
        expect(document.querySelector('[data-banner="update"]'), at).toBeNull();
        expect(document.querySelector('.update-banner'), at).toBeNull();
        expect(document.body.textContent, at).not.toContain('is out on stable');
        expect(screen.queryByRole('button', { name: 'Update all' }), at).toBeNull();
        cleanup();
      }
    }
  });

  it('the indicator is one door to Settings › Updates through its command', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    renderFleet(<UpdateIndicator form="row" />);
    const door = await screen.findByRole('button', { name: NAME });
    expect(door).toHaveAttribute('data-command', 'go-settings-updates');
    expect(door).toHaveTextContent(WORDS);
    const before = location.pathname;
    const heard: string[] = [];
    const listen = (e: Event): void => { heard.push((e as CustomEvent<string>).detail); };
    window.addEventListener(DOOR_EVENT, listen);
    fireEvent.click(door);
    window.removeEventListener(DOOR_EVENT, listen);
    expect(heard, 'the click asks the command layer to run the command').toEqual(['go-settings-updates']);
    expect(location.pathname, 'and navigates by nothing of its own').toBe(before);
  });

  it('one indicator per width: the bar at ≥900 (Refined), the status bar (Instrument), under the phone header (Refined) and in the fleet column (Instrument) below 900', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    const mount = async (skin: typeof REFINED | typeof INSTRUMENT, width: number, at = '/'): Promise<HTMLElement> => {
      setSkin(skin);
      act(() => { navigate(at); });
      atWidth(width);
      act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-project-a', project: 'project-a' })] }));
      render(<App />);
      await until(() => expect(indicators().length).toBeGreaterThan(0));
      // Settle: a second instance mounted by another branch would have drawn by now.
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(indicators(), `${skin === REFINED ? 'Refined' : 'Instrument'} at ${width}: one indicator`).toHaveLength(1);
      return indicators()[0]!;
    };
    // Refined at a desk: the app bar's door group, before the bell.
    let el = await mount(REFINED, 900);
    expect(el.closest('header.shell-accounts'), 'Refined 900: in the app bar').not.toBeNull();
    expect(el.parentElement!.matches('.ref-bar-doors'), 'Refined 900: among the bar\'s doors').toBe(true);
    expect(el.parentElement!.firstElementChild, 'Refined 900: the first of them, before the bell').toBe(el);
    expect(el).toHaveAttribute('data-form', 'bar');
    cleanup();
    // The same on a session route (the bars are on every route, and the fleet column sits beside the session).
    el = await mount(REFINED, 900, SESSION);
    expect(el.closest('header.shell-accounts'), 'Refined 900, session route: in the app bar').not.toBeNull();
    expect(el).toHaveAttribute('data-form', 'bar');
    cleanup();
    // Instrument at a desk: the status bar, between the summary and the keys.
    el = await mount(INSTRUMENT, 900);
    expect(el.closest('footer.shell-status'), 'Instrument 900: in the status bar').not.toBeNull();
    expect(el.previousElementSibling?.matches('.ins-status-summary'), 'after the summary').toBe(true);
    expect(el.nextElementSibling?.matches('.ins-status-keys'), 'before the keys').toBe(true);
    expect(el).toHaveAttribute('data-form', 'status');
    cleanup();
    el = await mount(INSTRUMENT, 900, SESSION);
    expect(el.closest('footer.shell-status'), 'Instrument 900, session route: in the status bar').not.toBeNull();
    expect(el).toHaveAttribute('data-form', 'status');
    cleanup();
    // Refined on a phone: a row of the phone header, after the accounts strip.
    el = await mount(REFINED, 899);
    expect(el.closest('header.ref-phone-head'), 'Refined 899: under the phone header').not.toBeNull();
    expect(el.previousElementSibling?.matches('.accounts-strip, .accounts-compact'), 'after the accounts strip').toBe(true);
    expect(el).toHaveAttribute('data-form', 'row');
    cleanup();
    // Instrument on a phone: in the fleet column, where the banner sat (directly after the banner stack's slots).
    el = await mount(INSTRUMENT, 899);
    expect(el.closest('section[aria-label="Fleet"]'), 'Instrument 899: in the fleet column').not.toBeNull();
    expect(el.closest('header.shell-accounts, footer.shell-status'), 'and in neither bar').toBeNull();
    expect(el).toHaveAttribute('data-form', 'row');
  });

  it('nothing renders when no release waits, and nothing before the first updates answer', async () => {
    // Before the first answer: the poll never lands.
    const pending = vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    const first = renderFleet(<UpdateIndicator form="row" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(pending).toHaveBeenCalledTimes(1);
    expect(first.container.querySelector('.update-indicator')).toBeNull();
    expect(first.container.innerHTML).toBe('');
    cleanup();
    // An answer naming nothing newer.
    vi.spyOn(api, 'updates').mockResolvedValue(current());
    const second = renderFleet(<UpdateIndicator form="row" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(second.container.innerHTML).toBe('');
    cleanup();
    // CONTROL: the same host with a release waiting does draw it.
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    renderFleet(<UpdateIndicator form="row" />);
    expect(await screen.findByText(WORDS)).toBeInTheDocument();
  });

  it('a stale view shows the stale words beside the version', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue({ mode: 'remote', connected: true, downSince: null });
    const updates = vi.spyOn(api, 'updates')
      .mockImplementationOnce(() => Promise.resolve(waiting()))
      .mockImplementation(() => Promise.reject(new Error('offline')));
    const { container } = renderFleet(<UpdateIndicator form="row" />);
    await screen.findByText(WORDS);
    expect(container.textContent, 'the first read landed: nothing is stale yet').not.toContain(UPDATES_STALE_TEXT);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await until(() => expect(updates).toHaveBeenCalledTimes(2));
    await until(() => expect(container.textContent).toContain(UPDATES_STALE_TEXT));
    const line = container.querySelector('.update-indicator')!;
    expect(line.textContent!.split(UPDATES_STALE_TEXT)).toHaveLength(2);
    const stale = [...line.querySelectorAll('[aria-hidden="true"]')].find((e) => e.textContent === UPDATES_STALE_TEXT);
    expect(stale, 'said once, hidden from assistive tech (the fleet screen\'s one status region announces it)').toBeDefined();
    // Beside the version, after it, and the door still names only the tag.
    expect(line.textContent!.indexOf(WORDS)).toBeLessThan(line.textContent!.indexOf(UPDATES_STALE_TEXT));
    expect(screen.getByRole('button', { name: NAME })).toBeInTheDocument();
  });

  it("its words are releaseWaitingWords'", () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'UpdateIndicator.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/import \{[^}]*\breleaseWaitingWords\b[^}]*\} from '\.\/releaseWaiting'/);
    expect(code).toMatch(/releaseWaitingWords\(/);
    // It builds no sentence of its own: the word never appears in the code, as a string, a template, JSX text or an
    // identifier (`↑ {tag} available` as JSX text is the idiomatic way to build it inline).
    expect(code).not.toMatch(/\bavailable\b/);
    // The title is the banner's sentence from its one owner, never rebuilt here.
    expect(code).toMatch(/updateBannerText\(/);
    expect(code).not.toMatch(/is out on/);
  });
});
