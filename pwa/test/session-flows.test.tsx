// The session's flows, lifted above its chrome (W2 Task S2d, D-5466).
//
// The ⋯ menu and the PR sheet are `SessionFlows`', hosted by `SessionScreen`; the desktop Escape interrupt is
// `useEscapeInterrupt`, called once by `SessionScreen`. So a skin switch that replaces the session's chrome keeps an
// open sheet, a skin whose chrome is not `SessionHeader` still interrupts on Escape, and neither holds behaviour.
//
// "The chrome" here is `SessionHeader`, mocked to render either the real header or nothing, so a case can unmount
// it under a mounted `SessionScreen` exactly as a skin switch to another chrome would.
//
// RED FIRST, measured on the task's base (origin/main 3cbc76c7d): the suite did not compile there (no
// `SessionFlows`, no `useEscapeInterrupt`). With the imports stubbed to the base's shape, every case was red: the
// menu and the PR sheet unmounted with the header, and with no header mounted Escape interrupted nothing.
//
// MUTATION TABLE (plan Task S2d Step 3; RUN, each mutant applied to a git-archive copy, this suite run alone):
//   the Escape effect left inside SessionHeader ........ "Escape interrupts a busy turn with no SessionHeader mounted"
//   menuOpen moved back into SessionHeader ............. "the ⋯ menu stays open when the header unmounts"
//   the open-dialog guard dropped from the hook ........ "Escape does nothing while a dialog is open…"
//   a menu item with its own onClick ................... "every ⋯ menu item carries data-command…"
//   (extra) the target's run-time gate re-check dropped . "a command run from a stale list still meets the gate…"
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { Sheet } from '@ccrc/ui';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';

const chrome = vi.hoisted(() => ({ mounted: true }));

vi.mock('../src/session/SessionHeader', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/session/SessionHeader')>();
  return {
    ...real,
    SessionHeader: (p: Parameters<typeof real.SessionHeader>[0]) =>
      (chrome.mounted ? createElement(real.SessionHeader, p) : null),
  };
});

const { api } = await import('../src/lib/api');
const { CommandLayer } = await import('../src/command/CommandLayer');
const { baseCommands } = await import('../src/command/commands');
const { DOOR_EVENT } = await import('../src/command/door');
const { SessionScreen } = await import('../src/screens/SessionScreen');
const { useSessionCommandTarget } = await import('../src/session/SessionFlows');
const { createFleetStore } = await import('../src/stores/fleet');
const { createSessionStore } = await import('../src/stores/session');

const ID = 'project-a-quiet-basin';
const S: FleetSession = fleetSession({ id: ID, project: 'project-a', workspace: 'quiet-basin', branch: 'ws/quiet-basin' });

const stubPointer = (fine: boolean): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null,
    dispatchEvent: () => false,
  }));
};

const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

/** `SessionScreen` with the command layer beside it, as `app.tsx` mounts them; `rerender` swaps the chrome. */
function mount(status: 'idle' | 'busy' = 'idle', extra: ReactNode = null): { rerender: (extra?: ReactNode) => void } {
  const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
  const fleet = createFleetStore({ makeSocket: fakeSocket });
  act(() => { fleet.setState({ sessions: [{ ...S, status }], conn: 'open' }); });
  const tree = (more: ReactNode): ReactNode => (
    <>
      <CommandLayer openNewSession={() => {}} />
      <SessionScreen id={ID} store={store} fleet={fleet} />
      {more}
    </>
  );
  const r = render(tree(extra));
  act(() => { store.setState({ uuid: 'u1', status }); });
  return { rerender: (more = extra) => r.rerender(tree(more)) };
}

/** Replace the chrome with one that renders nothing, as a switch to another skin's chrome would. */
function unmountChrome(r: { rerender: () => void }): void {
  chrome.mounted = false;
  r.rerender();
}

const menuSheet = (): HTMLElement =>
  screen.getAllByRole('dialog').find((d) => within(d).queryByText('Change model') !== null)!;

afterEach(() => {
  cleanup();
  chrome.mounted = true;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the session flows outlive the chrome that opened them', () => {
  it('the ⋯ menu stays open when the header unmounts', () => {
    const r = mount();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = menuSheet();
    expect(sheet).toHaveAttribute('data-state', 'open');
    unmountChrome(r);
    expect(screen.queryByRole('button', { name: 'More' }), 'the chrome is gone').toBeNull();
    expect(sheet.isConnected, 'the menu is the same node').toBe(true);
    expect(sheet).toHaveAttribute('data-state', 'open');
  });

  it('the PR sheet stays open when the header unmounts', () => {
    const r = mount();
    const cap = document.querySelector<HTMLButtonElement>('.keycap--pr')!;
    expect(cap).not.toBeNull();
    fireEvent.click(cap);
    const sheet = screen.getByRole('dialog', { name: /quiet-basin/ });
    unmountChrome(r);
    expect(document.querySelector('.keycap--pr'), 'the chrome is gone').toBeNull();
    expect(sheet.isConnected).toBe(true);
    expect(sheet).toHaveAttribute('data-state', 'open');
  });
});

describe('the Escape interrupt is the session screen\'s', () => {
  it('Escape interrupts a busy turn with no SessionHeader mounted', () => {
    stubPointer(true);
    const spy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    chrome.mounted = false;
    mount('busy');
    expect(document.querySelector('.chat-head'), 'no header is mounted').toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ID, 'escape-key');
  });

  it('Escape does nothing while a dialog is open, or when the event\'s default is prevented (D-5235)', () => {
    stubPointer(true);
    const spy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    chrome.mounted = false;
    const r = mount('busy', <Sheet open onClose={() => {}} title="Something open">body</Sheet>);
    // An Escape that reaches the window without Radix preventing it, with a dialog open: nothing interrupted.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(spy, 'an Escape with a dialog open interrupted the turn').not.toHaveBeenCalled();
    // Nothing open, but something earlier already handled this Escape.
    r.rerender(null);
    const stop = (e: KeyboardEvent): void => e.preventDefault();
    document.addEventListener('keydown', stop, { capture: true });
    try {
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    } finally {
      document.removeEventListener('keydown', stop, { capture: true });
    }
    expect(spy, 'an already-handled Escape interrupted the turn').not.toHaveBeenCalled();
    // The control: nothing open, nothing handled — Escape interrupts, once.
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('the live status wins over the fleet snapshot: Escape interrupts a turn the stream calls busy, once', () => {
    // The fleet still files the session idle; the stream already says busy. The screen reads `liveStatus`, so the
    // turn is interruptible now, not when the next snapshot catches up. (The inverse is the snapshot-only mutant.)
    stubPointer(true);
    const spy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    chrome.mounted = false;
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => { fleet.setState({ sessions: [{ ...S, status: 'idle' }], conn: 'open' }); });
    render(<SessionScreen id={ID} store={store} fleet={fleet} />);
    act(() => { store.setState({ uuid: 'u1', status: 'busy' }); });
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(spy).toHaveBeenCalledTimes(1);
    // And the other way round: a stream that says idle overrules a snapshot still filed busy.
    spy.mockClear();
    act(() => { fleet.setState({ sessions: [{ ...S, status: 'busy' }], conn: 'open' }); });
    act(() => { store.setState({ status: 'idle' }); });
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(spy, 'a snapshot still filed busy interrupted an idle stream').not.toHaveBeenCalled();
  });

  it('a coarse pointer has no Escape binding: the keycap is the control there (unchanged)', () => {
    stubPointer(false);
    const spy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    chrome.mounted = false;
    mount('busy');
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the ⋯ menu\'s items are registry commands', () => {
  it('every ⋯ menu item carries data-command and runs the same command as the palette', () => {
    mount();
    const ids = new Set(baseCommands().map((c) => c.id));
    const doors: string[] = [];
    const heard = (e: Event): void => { doors.push((e as CustomEvent<string>).detail); };
    window.addEventListener(DOOR_EVENT, heard);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      const items = [...menuSheet().querySelectorAll<HTMLButtonElement>('.menu-item')];
      expect(items.length, 'the menu has items').toBeGreaterThanOrEqual(5);
      const commands = items.map((b) => b.getAttribute('data-command'));
      for (const [i, id] of commands.entries()) {
        expect(id, `${items[i]!.textContent} carries data-command`).not.toBeNull();
        expect(ids.has(id!), `${id} is a registry command`).toBe(true);
      }
      // Each enabled item's click is its command's door: the layer hears exactly that id, and nothing else runs it.
      for (const id of commands) {
        // By selector: a follow-up sheet the previous item opened hides the page from the role queries.
        fireEvent.click(document.querySelector<HTMLButtonElement>('.keycap--more')!);
        const item = document.querySelector<HTMLButtonElement>(`.menu [data-command="${id}"]`)!;
        if (item.disabled) continue;
        doors.length = 0;
        fireEvent.click(item);
        expect(doors, `${id}: its click asked the layer to run it`).toEqual([id]);
      }
    } finally {
      window.removeEventListener(DOOR_EVENT, heard);
    }
  });

  it('the palette offers the menu\'s commands on a session and runs the same flow: History opens the history pane', () => {
    mount();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Show history' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: /What happened here/ })).toHaveAttribute('data-state', 'open');
  });

  it('the palette never offers what the menu shows disabled: under a substrate fault there is no swap and no archive', () => {
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => { fleet.setState({ sessions: [{ ...S, substrate: { at: 1, text: 'x' } }], conn: 'open' }); });
    render(<><CommandLayer openNewSession={() => {}} /><SessionScreen id={ID} store={store} fleet={fleet} /></>);
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const offered = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(offered.some((t) => t.includes('Show history')), 'the control: a session command is offered').toBe(true);
    expect(offered.some((t) => t.includes('Move to another account'))).toBe(false);
    expect(offered.some((t) => t.includes('Archive this session'))).toBe(false);
  });

  it('a main checkout has no PR: the palette does not offer "Open the pull request" where the header has no PR cap', () => {
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => { fleet.setState({ sessions: [{ ...S, workspace: null, branch: 'main' }], conn: 'open' }); });
    render(<><CommandLayer openNewSession={() => {}} /><SessionScreen id={ID} store={store} fleet={fleet} /></>);
    expect(document.querySelector('.keycap--pr'), 'the header shows no PR cap on a main checkout').toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const offered = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(offered.some((t) => t.includes('Show history')), 'the control: a session command is offered').toBe(true);
    expect(offered.some((t) => t.includes('Open the pull request'))).toBe(false);
  });

  it('a workspace session offers "Open the pull request" in the palette, as its header shows the PR cap', () => {
    mount();
    expect(document.querySelector('.keycap--pr')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const offered = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(offered.some((t) => t.includes('Open the pull request'))).toBe(true);
  });

  it('a command run from a stale list still meets the gate: under a fault, running session-swap opens no swap sheet', () => {
    const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => { fleet.setState({ sessions: [{ ...S, substrate: { at: 1, text: 'x' } }], conn: 'open' }); });
    let target: ReturnType<typeof useSessionCommandTarget> = null;
    function Probe(): ReactNode { target = useSessionCommandTarget(); return null; }
    render(<><Probe /><SessionScreen id={ID} store={store} fleet={fleet} /></>);
    expect(target, 'the screen published its target').not.toBeNull();
    act(() => { target!.run('session-swap'); });
    expect(screen.queryByRole('dialog'), 'a swap sheet opened past the substrate gate').toBeNull();
    act(() => { target!.run('open-history'); });
    expect(screen.getByRole('dialog', { name: /What happened here/ }), 'the control: an ungated item runs').toBeTruthy();
  });

  it('off a session screen no session command is offered', () => {
    render(<CommandLayer openNewSession={() => {}} />);
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const offered = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(offered.some((t) => t.includes('Show history') || t.includes('Change model'))).toBe(false);
  });
});
