// What a skin switch preserves (spec §5.4; D-5466, D-5467; W2 Task S2b).
//
// A switch changes which parts the shared frame places, never the frame, the
// ladder or anything mounted above it. So the route, the composer's text, an
// open sheet, the terminal drawer and its live socket, an open command
// palette, a toast, keyboard focus and a reader following a running turn all
// survive it. Each case mounts the whole `App`, sets something up, switches
// with `setSkin` and asserts after the switch.
//
// The terminal is xterm's own, made the way `drawer-view.test.tsx` makes it
// (`vi.mock('@xterm/xterm')`), and `WebSocket` is a counting fake, so the
// drawer's socket is counted without any seam in production code. Virtuoso
// is mocked as in `jump-latest.test.tsx`, so its props and its imperative
// `scrollToIndex` are observable and its mounts countable.
//
// RED FIRST, measured on the task's base: this file did not compile there
// (no `skins/`). Against a planted `app.tsx` that renders the spec's literal
// mechanism, `<Shell>{ladder}</Shell>` with two distinct shell components per
// skin and the providers above them, 10 of 16 went red: every case whose
// state lives in the ladder. The six that held there are the ones mounted
// above the frame (the route, the palette, the toast, New session, the
// theme) and the frame-only focus case, which is the point of D-5467.
//
// MUTATION TABLE (plan Task S2b Step 3; RUN, each mutant applied to a copy,
// this suite run alone; all red):
//   ShellFrame given key={set.id} ....................... the 10 ladder cases
//   the ladder rendered inside set.Nav .................. composer text, sheets, drawer, focus, follow (9)
//   CommandLayer inside the frame, keyed per skin ....... the open palette, the palette's focus (2)
//   FleetFlows mounted inside set.Nav ................... the open sheet (New session)
//   the detail child keyed detail-${set.id} ............. same DOM node, composer text, and 8 more
//   the toast host mounted inside a skin part ........... the toast
//   ChatList never re-settles on a switch ............... the following reader
//   the palette's close leaves focus where it fell ...... the palette's focus
//   the frame drops focus when a replaced part held it .. the frame focus case
//
// W2 Task S2d adds "a switch keeps the ⋯ menu open", "a switch keeps the PR
// sheet open" and "Escape interrupts a busy turn in both skins". MEASURED:
// all three are green on the task's base too, and the "menuOpen moved back
// into SessionHeader" mutant leaves them green, because today both sets place
// the one shared SessionHeader, so a switch replaces no session chrome. They
// hold the contract for S7c and S12, whose chrome differs per skin;
// `session-flows.test.tsx` is the suite that reds the lift's mutants now, by
// unmounting the header under a mounted SessionScreen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { INSTRUMENT, REFINED, toast } from '@ccrc/ui';
import type { ChatEvent, FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';

const made = vi.hoisted(() => ({
  terms: [] as unknown[],
  virtuosoMounts: 0,
  virtuoso: null as Record<string, unknown> | null,
  scrolls: [] as unknown[],
}));

vi.mock('@xterm/xterm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@xterm/xterm')>();
  class Terminal extends real.Terminal {
    constructor(...args: ConstructorParameters<typeof real.Terminal>) {
      super(...args);
      made.terms.push(this);
    }
  }
  return { ...real, Terminal };
});

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: Record<string, unknown>) => {
      made.virtuoso = props;
      React.useEffect(() => { made.virtuosoMounts += 1; }, []);
      React.useImperativeHandle(props.ref as React.Ref<unknown>, () => ({
        scrollToIndex: (location: unknown) => { made.scrolls.push(location); },
      }));
      const count = props.totalCount as number;
      const content = props.itemContent as (i: number) => ReactNode;
      const keyOf = props.computeItemKey as (i: number) => string | number;
      return React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: count }, (_, i) => React.createElement('div', { key: keyOf(i), 'data-index': i }, content(i))),
      );
    },
  };
});

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { getSessionStore } = await import('../src/stores/session');
const { ShellFrame } = await import('../src/skins/frame');
const { SKIN_SETS } = await import('../src/skins');

/** A WebSocket that never connects, counting what opens and closes by path. */
class CountingFake extends EventTarget {
  static opened: string[] = [];
  static closed: string[] = [];
  readonly url: string;
  readyState = 0;
  binaryType = 'blob';
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    super();
    this.url = url;
    CountingFake.opened.push(new URL(url, 'http://localhost').pathname);
  }
  send(): void {}
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    CountingFake.closed.push(new URL(this.url, 'http://localhost').pathname);
  }
}
const pty = (list: readonly string[]): number => list.filter((p) => p.startsWith('/ws/pty/')).length;

const S: FleetSession = fleetSession({ id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: 'project-a' });
const TS = '2026-10-20T10:00:00.000Z';
const EVENTS: ChatEvent[] = [
  { kind: 'user', uuid: 'u1', ts: TS, text: 'run the suites' },
  { kind: 'assistant', uuid: 'a1', ts: TS, text: 'Running them now.' },
];

const root = document.documentElement;
const shell = (): Element => document.querySelector('.app-shell')!;
const detail = (): Element => document.getElementById('content')!;
const toInstrument = (): void => act(() => { setSkin(INSTRUMENT); });
const settle = (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

/** A fine pointer, as on a desk: the composer takes focus when a session opens. */
function stubPointer(fine: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

function openSession(session: FleetSession = S, status: 'idle' | 'busy' = 'idle'): void {
  act(() => useFleetStore.setState({ conn: 'open', sessions: [{ ...session, status }] }));
  navigate(`/s/${session.id}`);
  render(<App />);
  act(() => getSessionStore(session.id).setState({ uuid: 'u1', status, events: EVENTS }));
}

/** A workspace session, so its header carries the PR cap. */
const WS: FleetSession = fleetSession({
  id: 'project-a-quiet-basin', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'quiet-basin',
});

/** The session header's ⋯ menu, then one of its items. */
function menu(item: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const sheet = screen.getAllByRole('dialog').at(-1)!;
  fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`^${item}`) }));
}

beforeEach(() => {
  localStorage.clear();
  root.removeAttribute('data-skin');
  initSkin();
  act(() => { setSkin(REFINED); });
  CountingFake.opened = [];
  CountingFake.closed = [];
  made.virtuosoMounts = 0;
  made.scrolls = [];
  vi.stubGlobal('WebSocket', CountingFake);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  localStorage.clear();
  root.removeAttribute('data-skin');
});

describe('a skin switch keeps', () => {
  it('the route (on a session, /runs and /settings), and the frame takes the new set', () => {
    for (const [path, heading] of [[`/s/${S.id}`, null], ['/runs', /^runs$/i], ['/settings', /^settings$/i]] as const) {
      act(() => { setSkin(REFINED); });
      act(() => useFleetStore.setState({ conn: 'open', sessions: [S] }));
      navigate(path);
      const view = render(<App />);
      expect(shell()).toHaveClass(SKIN_SETS[REFINED].frameClass);
      toInstrument();
      expect(window.location.pathname, path).toBe(path);
      expect(shell(), path).toHaveClass(SKIN_SETS[INSTRUMENT].frameClass);
      expect(shell(), path).toHaveAttribute('data-view', 'session');
      if (heading !== null) expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      else expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("the composer's typed text", () => {
    openSession();
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'half a thought' } });
    toInstrument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('half a thought');
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(box);
  });

  it("an open sheet: a session's swap sheet", () => {
    openSession();
    menu('Move to another account');
    const sheet = screen.getByRole('dialog');
    toInstrument();
    expect(screen.getByRole('dialog')).toBe(sheet);
    expect(sheet).toHaveAttribute('data-state', 'open');
  });

  it("an open sheet: New session, opened through the fleet flows' command door", () => {
    act(() => useFleetStore.setState({ conn: 'open', sessions: [S] }));
    navigate('/');
    render(<App />);
    act(() => { window.dispatchEvent(new CustomEvent('ccrc:command', { detail: 'new-session' })); });
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getAllByText(/new session/i).length).toBeGreaterThan(0);
    toInstrument();
    expect(screen.getByRole('dialog')).toBe(sheet);
    expect(sheet).toHaveAttribute('data-state', 'open');
  });

  it('the terminal drawer open, and its socket neither closed nor opened again', () => {
    openSession();
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(pty(CountingFake.opened), 'the drawer opened its socket').toBe(1);
    const drawer = screen.getByRole('dialog', { name: 'Terminal' });
    const term = drawer.querySelector('.term')!;
    toInstrument();
    expect(pty(CountingFake.opened), 'not opened again').toBe(1);
    expect(pty(CountingFake.closed), 'not closed').toBe(0);
    expect(screen.getByRole('dialog', { name: 'Terminal' })).toBe(drawer);
    expect(drawer).toHaveAttribute('data-state', 'open');
    expect(drawer.querySelector('.term'), 'the same terminal host').toBe(term);
  });

  it('an open command palette, and its query', () => {
    openSession();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true, ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    fireEvent.change(input, { target: { value: 'runs' } });
    toInstrument();
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toBe(input);
    expect(input).toHaveValue('runs');
  });

  it('the history pane open', () => {
    openSession();
    menu('History');
    const pane = screen.getAllByRole('dialog').at(-1)!;
    toInstrument();
    expect(pane.isConnected).toBe(true);
    expect(pane).toHaveAttribute('data-state', 'open');
  });

  it('the model picker open', () => {
    openSession();
    menu('Change model');
    const picker = screen.getAllByRole('dialog').at(-1)!;
    toInstrument();
    expect(picker.isConnected).toBe(true);
    expect(picker).toHaveAttribute('data-state', 'open');
  });

  it('a toast that is showing', () => {
    openSession();
    act(() => { toast('Sent to lane-a'); });
    const shown = screen.getByText('Sent to lane-a');
    toInstrument();
    expect(screen.getByText('Sent to lane-a')).toBe(shown);
  });

  it('the theme: a switch leaves data-theme untouched', () => {
    root.setAttribute('data-theme', 'phosphor');
    openSession();
    toInstrument();
    expect(root.getAttribute('data-theme')).toBe('phosphor');
    root.removeAttribute('data-theme');
  });

  // W2 Task S2d (D-5466): the session's flows are `SessionFlows`', hosted by `SessionScreen`, never its chrome's.
  it('a switch keeps the ⋯ menu open', () => {
    openSession();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getAllByRole('dialog').at(-1)!;
    expect(within(sheet).getByRole('button', { name: /^Change model/ })).toBeTruthy();
    toInstrument();
    expect(sheet.isConnected).toBe(true);
    expect(sheet).toHaveAttribute('data-state', 'open');
  });

  it('a switch keeps the PR sheet open', () => {
    openSession(WS);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.keycap--pr')!);
    const sheet = screen.getByRole('dialog', { name: /quiet-basin/ });
    toInstrument();
    expect(sheet.isConnected).toBe(true);
    expect(sheet).toHaveAttribute('data-state', 'open');
  });

  it('the detail section: the same DOM node before and after', () => {
    openSession();
    const before = detail();
    expect(before.tagName).toBe('MAIN');
    toInstrument();
    expect(detail()).toBe(before);
  });
});

describe('the Escape interrupt (W2 Task S2d)', () => {
  it('Escape interrupts a busy turn in both skins', async () => {
    stubPointer(true);
    const { api } = await import('../src/lib/api');
    const spy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    try {
      openSession(S, 'busy');
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
      expect(spy, 'Refined').toHaveBeenCalledTimes(1);
      toInstrument();
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
      expect(spy, 'Instrument').toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith(S.id, 'escape-key');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('focus after a switch is never on <body>', () => {
  it('the palette run from the composer hands focus back to the composer it came from', async () => {
    stubPointer(true);
    openSession();
    await settle();
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: 'k', metaKey: true, ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    fireEvent.change(input, { target: { value: 'switch layout' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'instrument' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await settle();
    expect(root.getAttribute('data-skin')).toBe(INSTRUMENT);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(box);
  });

  it("the Layout radio that ran the switch keeps focus", () => {
    navigate('/settings/appearance');   // the Layout fieldset's page since the Settings sections (D-5504)
    render(<App />);
    const radio = screen.getByRole('radio', { name: /^Instrument/ });
    act(() => radio.focus());
    fireEvent.click(radio);
    expect(root.getAttribute('data-skin')).toBe(INSTRUMENT);
    expect(document.activeElement).toBe(radio);
  });

  it('a control inside a part the switch replaced: focus moves to #content', () => {
    // The frame is driven directly with two sets whose bars differ and that
    // place nothing else (Instrument's rail and status bar, W2 Task S9, read
    // providers this case does not mount).
    function BarA(): ReactNode { return <button type="button">Bar A</button>; }
    function BarB(): ReactNode { return <button type="button">Bar B</button>; }
    const a = { ...SKIN_SETS[REFINED], Bar: BarA, Banners: null, Rail: null, Nav: null, StatusBar: null };
    const b = { ...SKIN_SETS[INSTRUMENT], Bar: BarB, Banners: null, Rail: null, Nav: null, StatusBar: null };
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('min-width: 900px'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
    const ref = { current: null };
    const view = render(<ShellFrame set={a} view="fleet" detailRef={ref}><p>ladder</p></ShellFrame>);
    const bar = screen.getByRole('button', { name: 'Bar A' });
    act(() => bar.focus());
    expect(document.activeElement).toBe(bar);
    view.rerender(<ShellFrame set={b} view="fleet" detailRef={ref}><p>ladder</p></ShellFrame>);
    expect(document.activeElement).toBe(document.getElementById('content'));
  });
});

describe('a reader following a running turn', () => {
  it('is still following after the switch: the list stays mounted and is put back at the newest turn as it re-measures', () => {
    openSession();
    act(() => getSessionStore(S.id).setState({ status: 'busy' }));
    expect(made.virtuoso, 'the list rendered').not.toBeNull();
    const mounts = made.virtuosoMounts;
    // The list has finished opening: its own settle window is over (a wheel
    // ends it at once), so only the switch can open another.
    fireEvent.wheel(document.querySelector('.chat-list')!);
    toInstrument();
    expect(made.virtuosoMounts, 'the list was not opened again').toBe(mounts);
    // The re-wrap moves the list off the bottom on its own; a reader who was
    // there is put back.
    const report = made.virtuoso!.atBottomStateChange as (b: boolean) => void;
    act(() => report(false));
    expect(made.scrolls).toContainEqual({ index: 'LAST', align: 'end' });
    expect(screen.queryByRole('button', { name: /jump to latest/i })).toBeNull();
  });

  it('the column reads its line measures again on the switch, under the new tokens, not the old skin\'s', () => {
    openSession();
    const list = document.querySelector('.chat-list')!;
    // `measuresOf` lays a hidden probe frame (`[data-probe]`) into the column
    // and removes it: each one seen is one fresh read.
    let probes = 0;
    const seen = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n instanceof HTMLElement && n.querySelector('[data-probe]') !== null) probes += 1;
      }
    });
    seen.observe(list, { childList: true, subtree: true });
    toInstrument();
    seen.takeRecords().forEach((r) => r.addedNodes.forEach((n) => {
      if (n instanceof HTMLElement && n.querySelector('[data-probe]') !== null) probes += 1;
    }));
    seen.disconnect();
    expect(probes, 'one re-measure on the switch').toBeGreaterThanOrEqual(1);
  });
});

/** Layers a skin's own part owns that close on a switch, each with its reason.
 *  Empty in S2b: no skin part owns a layer yet. S11 and S12 add Instrument's
 *  More sheet, its quick bar's sheets and its inspector overlay if they close. */
export const SWITCH_CLOSES: Readonly<Record<string, string>> = {};

describe('SWITCH_CLOSES is exact', () => {
  it('every layer open before a switch is open after it, unless registered; every registered one closes', () => {
    openSession();
    menu('History');
    const before = [...document.querySelectorAll('[role="dialog"][data-state="open"]')];
    expect(before.length).toBeGreaterThan(0);
    toInstrument();
    const after = new Set(document.querySelectorAll('[role="dialog"][data-state="open"]'));
    const closed = before.filter((d) => !after.has(d)).map((d) => d.getAttribute('aria-label') ?? d.id);
    expect(closed.filter((c) => !(c in SWITCH_CLOSES)), 'closed on a switch, unregistered').toEqual([]);
    expect(Object.keys(SWITCH_CLOSES).filter((k) => !closed.includes(k)), 'registered, yet survived').toEqual([]);
  });
});

// W2 Task S7c (D-5471): SessionScreen mounts the skin's own chrome. Refined's is the short header (one chip rail, no
// esc cap on a coarse pointer); Instrument's set places none, so the shared header comes back. Red when SessionScreen
// ignores the set's `SessionChrome` and always draws the shared header.
describe("the session screen mounts the skin's chrome", () => {
  it("Refined's short header, then the shared one after a switch, with the same composer", () => {
    stubPointer(false);
    openSession(S, 'busy');
    expect(document.querySelectorAll('.ref-chip-rail')).toHaveLength(1);
    expect(document.querySelector('.keycap--esc')).toBeNull();
    const box = screen.getByRole('textbox', { name: 'Message' });
    toInstrument();
    expect(document.querySelectorAll('.ref-chip-rail')).toHaveLength(0);
    expect(document.querySelector('.chat-title-wrap')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(box);
  });
});
