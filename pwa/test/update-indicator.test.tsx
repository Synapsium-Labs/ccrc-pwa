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
const { dismissRelease, readDismissed, resetDismissalForTests } = await import('../src/fleet/releaseDismissal');
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
  window.localStorage.clear();
  resetDismissalForTests();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDismissalForTests();
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

const DISMISS = 'Dismiss v0.0.9';
const TITLE = 'Hidden until a newer release; Settings › Updates still lists it';
const waitingAt = (tag: string): UpdatesView => ({
  ...waiting(), nodes: [nodeOf('fleet', { desiredTag: tag }), nodeOf('server', { desiredTag: tag })],
});

describe('UpdateIndicator — dismissed until a newer release (D-6327, part b)', () => {
  it('the dismiss control is named for its tag', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    for (const form of ['bar', 'status', 'row'] as const) {
      const { container } = renderFleet(<UpdateIndicator form={form} />);
      const x = await screen.findByRole('button', { name: DISMISS });
      expect(x, `${form}: beside the door, in the same line`).toBe(container.querySelector('.update-indicator')!.querySelector('button[aria-label="Dismiss v0.0.9"]'));
      expect(x, form).toHaveAttribute('title', TITLE);
      expect(x.querySelector('svg'), `${form}: the vendored x icon`).not.toBeNull();
      expect(screen.getByRole('button', { name: NAME }), `${form}: the door is still the door`).toBeInTheDocument();
      cleanup();
    }
    // The tag is the waiting one: v0.0.10 names itself, not v0.0.9.
    vi.spyOn(api, 'updates').mockResolvedValue(waitingAt('v0.0.10'));
    renderFleet(<UpdateIndicator form="row" />);
    expect(await screen.findByRole('button', { name: 'Dismiss v0.0.10' })).toBeInTheDocument();
    // Its size is the design system's `CloseButton` (the tap floor, borderless, transparent); the app sheet adds the
    // compact 24px under a fine pointer and nothing else: no border, colour or background of its own.
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/\.update-indicator-dismiss\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body).not.toMatch(/\b(border|background|color|outline)[\w-]*\s*:/);
    const fine = /@media \(pointer: fine\)\s*\{[^@]*?\.update-indicator-dismiss\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(fine).toMatch(/min-width:\s*24px/);
    expect(fine).toMatch(/min-height:\s*24px/);
    expect(screen.getByRole('button', { name: 'Dismiss v0.0.10' })).toHaveClass('min-w-tap', 'min-h-tap');
  });

  it('dismiss hides the indicator in the bar and the phone row alike', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    for (const [skin, width, form] of [
      [REFINED, 900, 'bar'], [INSTRUMENT, 900, 'status'], [REFINED, 899, 'row'], [INSTRUMENT, 899, 'row'],
    ] as const) {
      window.localStorage.clear();
      resetDismissalForTests();
      setSkin(skin);
      atWidth(width);
      act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-project-a', project: 'project-a' })] }));
      render(<App />);
      const at = `${skin} ${width}`;
      await until(() => expect(indicators().length, `${at}: shown first`).toBe(1));
      expect(indicators()[0]).toHaveAttribute('data-form', form);
      fireEvent.click(screen.getByRole('button', { name: DISMISS }));
      await until(() => expect(indicators(), `${at}: hidden`).toHaveLength(0));
      expect(screen.queryByRole('button', { name: NAME }), at).toBeNull();
      expect(screen.queryByRole('button', { name: DISMISS }), at).toBeNull();
      expect(document.body.textContent, `${at}: no stale words, nothing of the line`).not.toContain(WORDS);
      expect(readDismissed()).toBe('v0.0.9');
      cleanup();
    }
  });

  it('a dismissal survives a remount', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    const first = renderFleet(<UpdateIndicator form="row" />);
    fireEvent.click(await screen.findByRole('button', { name: DISMISS }));
    await until(() => expect(first.container.innerHTML).toBe(''));
    cleanup();
    // A new mount, with a fresh poll that names the same release: still hidden.
    const second = renderFleet(<UpdateIndicator form="row" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(second.container.innerHTML).toBe('');
    expect(window.localStorage.getItem('ccrc-release-dismissed')).toBe('v0.0.9');
    // And in the next page load, which keeps storage and loses the page's own mark.
    cleanup();
    resetDismissalForTests();
    const third = renderFleet(<UpdateIndicator form="bar" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(third.container.innerHTML).toBe('');
  });

  it('a newer waiting release shows it again', async () => {
    act(() => { dismissRelease('v0.0.9'); });
    // The same tag and an older one stay hidden.
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    const same = renderFleet(<UpdateIndicator form="row" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(same.container.innerHTML).toBe('');
    cleanup();
    // A newer one (v0.0.10 sorts before v0.0.9 as a string) shows, with its own dismiss.
    vi.spyOn(api, 'updates').mockResolvedValue(waitingAt('v0.0.10'));
    renderFleet(<UpdateIndicator form="row" />);
    expect(await screen.findByText('↑ v0.0.10 available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss v0.0.10' })).toBeInTheDocument();
    // Dismissing the newer one hides it too, and the older tag, which the fleet cannot be asked about, stays hidden.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss v0.0.10' }));
    await until(() => expect(screen.queryByText('↑ v0.0.10 available')).toBeNull());
    expect(readDismissed()).toBe('v0.0.10');
  });

  it('dismissing moves focus to the main landmark and toasts once', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(waiting());
    setSkin(REFINED);
    atWidth(900);
    act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-project-a', project: 'project-a' })] }));
    render(<App />);
    await until(() => expect(indicators().length).toBe(1));
    const x = screen.getByRole('button', { name: DISMISS });
    x.focus();
    expect(document.activeElement).toBe(x);
    fireEvent.click(x);
    await until(() => expect(indicators()).toHaveLength(0));
    const main = document.getElementById('content');
    expect(main, 'the main landmark exists').not.toBeNull();
    expect(document.activeElement, 'focus lands on the main landmark, never the body').toBe(main);
    const toasts = [...document.querySelectorAll('[role="status"].toast')];
    expect(toasts, 'exactly one toast').toHaveLength(1);
    expect(toasts[0]!.textContent).toBe('v0.0.9 is hidden until a newer release. Settings › Updates still lists it.');
    // A second tap cannot happen (the control is gone), and nothing re-toasts on a re-render.
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(document.querySelectorAll('[role="status"].toast')).toHaveLength(1);
  });

  it('a halt banner stands whatever the dismissal', async () => {
    const halted = (): UpdatesView => ({
      ...waiting(),
      nodes: [nodeOf('fleet', { update: { state: 'failed', target: 'v0.0.9', startedAt: 1, detail: 'gate: unit not up' } }), nodeOf('server')],
    });
    vi.spyOn(api, 'updates').mockResolvedValue(halted());
    setSkin(REFINED);
    atWidth(899);
    act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-project-a', project: 'project-a' })] }));
    render(<App />);
    await until(() => expect(indicators().length).toBe(1));
    expect(document.querySelector('.halt-banner'), 'the halt shows with the line').not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: DISMISS }));
    await until(() => expect(indicators()).toHaveLength(0));
    expect(document.querySelector('.halt-banner'), 'and stands after the line is dismissed').not.toBeNull();
    expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeInTheDocument();
  });

  it('a dismissed stale view draws no stale words in the indicator\'s place, and the screen\'s status region still says it', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue({ mode: 'remote', connected: true, downSince: null });
    const updates = vi.spyOn(api, 'updates')
      .mockImplementationOnce(() => Promise.resolve(waiting()))
      .mockImplementation(() => Promise.reject(new Error('offline')));
    act(() => { dismissRelease('v0.0.9'); });
    setSkin(REFINED);
    atWidth(899);
    act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-project-a', project: 'project-a' })] }));
    render(<App />);
    await until(() => expect(updates).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const region = (): string => [...document.querySelectorAll('.sr-only[role="status"]')].map((e) => e.textContent).join('|');
    await until(() => expect(region(), 'the view is stale: the screen announces it').toContain(UPDATES_STALE_TEXT));
    expect(indicators(), 'dismissed: nothing of the line renders').toHaveLength(0);
    expect(document.querySelector('.update-indicator-stale'), 'and no stale words in its place').toBeNull();
    // CONTROL: the same stale view, not dismissed, draws the line with its stale words.
    act(() => { window.localStorage.clear(); resetDismissalForTests(); });
    await until(() => expect(document.querySelector('.update-indicator-stale')).not.toBeNull());
    expect(region()).toContain(UPDATES_STALE_TEXT);
  });
});
