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
// RED FIRST, measured on the task's base (see the PR): this file did not
// compile there (no `skins/`). Against a planted `app.tsx` that renders the
// spec's literal mechanism, `<SKIN_SETS[skin].Shell>{ladder}</…>` with two
// distinct shell components and the providers above them, the cases that
// hold state in the ladder went red; the table is in the PR body.
//
// MUTATION TABLE (plan Task S2b Step 3; RUN, each mutant applied to a copy,
// this suite run alone):
//   ShellFrame given key={set.id} ....................... every app case
//   the ladder rendered inside set.Nav .................. composer text, same DOM node
//   CommandLayer inside the frame, keyed per skin ....... the open palette
//   FleetFlows mounted inside set.Nav ................... the open sheet (New session)
//   the detail child keyed detail-${set.id} ............. same DOM node, composer text
//   the toast host mounted inside a skin part ........... the toast
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

function openSession(): void {
  act(() => useFleetStore.setState({ conn: 'open', sessions: [S] }));
  navigate(`/s/${S.id}`);
  render(<App />);
  act(() => getSessionStore(S.id).setState({ uuid: 'u1', status: 'idle', events: EVENTS }));
}

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

  it('the detail section: the same DOM node before and after', () => {
    openSession();
    const before = detail();
    expect(before.tagName).toBe('MAIN');
    toInstrument();
    expect(detail()).toBe(before);
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
    navigate('/settings');
    render(<App />);
    const radio = screen.getByRole('radio', { name: /^Instrument/ });
    act(() => radio.focus());
    fireEvent.click(radio);
    expect(root.getAttribute('data-skin')).toBe(INSTRUMENT);
    expect(document.activeElement).toBe(radio);
  });

  it('a control inside a part the switch replaced: focus moves to #content', () => {
    // Today's two sets place the same parts, so the frame is driven directly
    // with two sets whose bars differ.
    function BarA(): ReactNode { return <button type="button">Bar A</button>; }
    function BarB(): ReactNode { return <button type="button">Bar B</button>; }
    const a = { ...SKIN_SETS[REFINED], Bar: BarA, Nav: null };
    const b = { ...SKIN_SETS[INSTRUMENT], Bar: BarB, Nav: null };
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
