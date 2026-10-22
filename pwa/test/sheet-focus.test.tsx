// The Sheet owns focus (D-5931, spec 2026-10-20 §2.4 (b)): in on open, trapped while open, back to the opener on
// close. A caller's `initialFocus` wins; with none the panel itself takes it, never an input, so a phone's keyboard
// never rises unasked. It moves the focus on two events only: the panel mounting while open (a stable callback ref:
// a first open, and every open of a sheet whose parent mounts it already open), and `open` turning true while the
// closing panel is still mounted (a reopen during the close transition, where no ref fires). Never again while open,
// so the terminal's own focus on its socket's open is kept. A text-field opener gets the focus back only on a fine
// pointer. `useCancelFirst` keeps only the choice of Cancel; the give-back has one owner.
//
// Rows that hold elsewhere and are run with this suite: QuickConfirm opens on Cancel, scrolled to the top
// (`quick-confirm-focus.test.tsx`); after an Ack commit the row has the focus (`halt-banner.test.tsx`,
// `update-halt-controls.test.tsx`); the terminal drawer row is in `drawer-view.test.tsx`, beside its harness.
//
// RED FIRST, measured 2026-10-20 against origin/main (this file and the drawer row only): 13 of these 17 failed, and
// the drawer row. The four that passed are pins of what main already did and must keep doing: UpdateMoveSheet's first
// open on Cancel, Tab, Shift+Tab, and an opener removed while open.
//
// MUTATION TABLE (plan Task P3-2 Step 3; RUN 2026-10-20 on an isolated copy, each mutant alone). Every row went RED:
//   no focus move on open ............................ first-open, and 11 more
//   callback-ref path removed (effect only) .......... first-open, UpdateMoveSheet first-open, and 8 more
//   the Sheet refocuses the panel on every render .... drawer-view's terminal row, and its keyboard row
//   vaul `autoFocus` set instead ..................... the input-first, NewSessionSheet and DialogSheet rows, and 9 more
//   give-back removed ................................ on-close-the-opener, and 4 more
//   give-back left in `useCancelFirst` as well ........ the confirm.tsx source scan
//   focus moved through `onOpenAutoFocus` instead ..... both reopen-during-the-close-transition rows
//   text-field give-back on every pointer ............ the coarse-pointer textarea row
//   `preventScroll` dropped .......................... quick-confirm-focus's reopen and preventScroll rows
//   `preventScroll` dropped from the give-back ........ the fine-pointer textarea row
// The every-render mutant is an undeps'd effect: an unstable callback ref is inert here, because vaul's composed ref
// on `Drawer.Content` does not re-fire when the Sheet's ref changes (measured: six renders, one ref call).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sheet, ToastHost, useCancelFirst } from '@ccrc/ui';
import { api } from '../src/lib/api';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { DialogSheet } from '../src/session/DialogSheet';
import { UpdateMoveSheet } from '../src/fleet/UpdateMoveSheet';
import { planMove } from '../src/fleet/movePlan';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';
import { CACHING_TRACING, pane } from './askPanes';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';
import type { NodeWire, UpdatesView } from '../../shared/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Lets Radix's portal mount and its focus scope settle (both are effects, one of them a timeout). */
const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

const dialog = (): HTMLElement => screen.getByRole('dialog');

/** A sheet with three plain controls, opened from a button. */
function Host({ initial, children }: { initial?: 'second'; children?: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  const second = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="A sheet"
        {...(initial === 'second' ? { initialFocus: second } : {})}>
        {children}
        <button type="button">First</button>
        <button type="button" ref={second}>Second</button>
        <button type="button" onClick={() => setOpen(false)}>Last</button>
      </Sheet>
    </>
  );
}

const openFrom = async (name = 'Open it'): Promise<HTMLElement> => {
  const opener = screen.getByRole('button', { name });
  opener.focus();
  fireEvent.click(opener);
  await settle();
  return opener;
};

/** Keeps a closed dialog mounted, as a browser's exit animation does (jsdom has none): its computed style names an
 *  exit animation that never ends, so Radix's Presence holds the closing content (quick-confirm-focus's device). */
const holdClosingContent = (): (() => void) => {
  const real = window.getComputedStyle.bind(window);
  const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const style = real(el, pseudo);
    if (el.getAttribute('role') !== 'dialog') return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === 'animationName') return el.getAttribute('data-state') === 'closed' ? 'sheet-out' : 'sheet-in';
        const v: unknown = Reflect.get(target, key, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  });
  return () => { spy.mockRestore(); };
};

/** A pointer of the given kind, through the `(pointer: fine)` query the Sheet asks. */
const pointer = (kind: 'fine' | 'coarse'): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(pointer: fine)' ? kind === 'fine' : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
};

describe('in on open', () => {
  it('on a first open the active element is inside the panel: the panel itself, named by its title', async () => {
    render(<Host />);
    await openFrom();
    const panel = dialog();
    expect(panel.contains(document.activeElement), 'the focus stayed behind the scrim').toBe(true);
    expect(document.activeElement).toBe(panel);
    expect(panel.getAttribute('tabindex')).toBe('-1');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe('A sheet');
  });

  it('`initialFocus` wins', async () => {
    render(<Host initial="second" />);
    await openFrom();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  });

  it('every focus the Sheet moves passes preventScroll', async () => {
    const calls: Array<FocusOptions | undefined> = [];
    const real = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
      if (this.getAttribute('role') === 'dialog' || this.textContent === 'Second') calls.push(opts);
      real.call(this, opts);
    });
    render(<Host initial="second" />);
    await openFrom();
    expect(calls.length).toBeGreaterThan(0);
    for (const o of calls) expect(o?.preventScroll).toBe(true);
  });

  it('the first open of a sheet whose parent mounts it already open (UpdateMoveSheet) focuses Cancel, and closing gives it back', async () => {
    const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
    const node: NodeWire = {
      nodeId: '12121212-1212-4212-8212-121212121212', role: 'fleet', label: 'fleet', os: 'linux',
      current: { sha: 'f'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false, version: 'v0.0.9' },
      stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['verify', 'node-id', 'floor'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
      measuredAt: T0, reachable: true, unreachableSince: null,
      channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
      request: null, report: null,
      update: { state: 'idle', target: null, startedAt: null, detail: null },
    };
    const view: UpdatesView = { catalogue: { lastOkAt: T0, lastError: null }, releases: [], nodes: [node], intent: [] };
    const plan = planMove(view, { scope: 'fleet', direction: 'rollback', to: 'v0.0.8' });
    function MoveHost(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <ToastHost />
          <button type="button" onClick={() => setOpen(true)}>Roll back</button>
          <UpdateMoveSheet open={open} plan={plan} onClose={() => setOpen(false)} onDone={() => {}} tone="danger" />
        </>
      );
    }
    render(<MoveHost />);
    const opener = await openFrom('Roll back');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    await settle();
    expect(document.activeElement, 'closing did not give the focus back').toBe(opener);
  });
});

describe('no input on open: a phone keyboard never rises unasked', () => {
  it('a sheet whose first control is an input opens on its panel, not the input', async () => {
    render(<Host><input aria-label="Filter" /></Host>);
    await openFrom();
    expect(document.activeElement).toBe(dialog());
    expect(document.activeElement).not.toBe(screen.getByLabelText('Filter'));
  });

  it('NewSessionSheet: no input or textarea has the focus on open', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: { wrapper: 'lane-a', score: 0 }, roster: [] });
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [{ name: 'project-a', workdir: 'project-a' }] });
    const fleet = createFleetStore({ makeSocket: () => ({ close(): void {} }) as unknown as WebSocket });
    act(() => { fleet.setState({ conn: 'open', roster: TEST_ROSTER, sessions: [fleetSession()] }); });
    function NewHost(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>New session</button>
          <NewSessionSheet open={open} onClose={() => setOpen(false)} fleet={fleet} />
        </>
      );
    }
    render(<NewHost />);
    await openFrom('New session');
    const active = document.activeElement;
    expect(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement).toBe(false);
    expect(active).toBe(dialog());
  });

  it('DialogSheet with a free-text row: no input or textarea has the focus on open', async () => {
    const store = createSessionStore('lane-a:project-a', {
      makeSocket: () => ({ close(): void {} }) as unknown as WebSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    render(<><DialogSheet id="lane-a:project-a" store={store} onOpenTerminal={vi.fn()} /><ToastHost /></>);
    act(() => {
      store.getState().apply({ type: 'dialog', dialog: pane('cc300-ask-same-labels-q2') });
      store.getState().apply({ type: 'ask', ask: CACHING_TRACING, key: null });
    });
    await settle();
    // D-6325: the free-text row is an `Other` row, and its field opens only when the row is chosen, so on open there is
    // no input in the sheet at all, and the panel has the focus.
    expect(screen.getByRole('button', { name: /^Other/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your own answer')).toBeNull();
    const active = document.activeElement;
    expect(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement).toBe(false);
    expect(active).toBe(dialog());
  });
});

describe('trapped while open', () => {
  it('Tab from the last control lands on the first', async () => {
    render(<Host />);
    await openFrom();
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
  });

  it('Shift+Tab from the first lands on the last', async () => {
    render(<Host />);
    await openFrom();
    const first = screen.getByRole('button', { name: 'First' });
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }));
  });
});

describe('back on close', () => {
  it('on close the opener has focus', async () => {
    render(<Host />);
    const opener = await openFrom();
    expect(document.activeElement).toBe(dialog());
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    await settle();
    expect(document.activeElement).toBe(opener);
  });

  it('an opener removed while open is left alone', async () => {
    function Gone(): ReactNode {
      const [open, setOpen] = useState(false);
      const [shown, setShown] = useState(true);
      return (
        <>
          {shown ? <button type="button" onClick={() => setOpen(true)}>Open it</button> : null}
          <Sheet open={open} onClose={() => setOpen(false)} title="A sheet">
            <button type="button" onClick={() => setShown(false)}>Remove the opener</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </Sheet>
        </>
      );
    }
    render(<Gone />);
    const opener = await openFrom();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the opener' }));
    expect(opener.isConnected).toBe(false);
    const focus = vi.spyOn(opener, 'focus');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settle();
    expect(focus).not.toHaveBeenCalled();
  });

  for (const kind of ['fine', 'coarse'] as const) {
    it(`a sheet opened by state over a focused composer textarea: ${kind === 'fine'
      ? 'on a fine pointer the textarea has the focus after close'
      : 'on a coarse pointer it does not'}`, async () => {
      pointer(kind);
      let show: (v: boolean) => void = () => {};
      function Composer(): ReactNode {
        const [open, setOpen] = useState(false);
        show = setOpen;
        return (
          <>
            <textarea aria-label="Message" />
            <Sheet open={open} onClose={() => setOpen(false)} title="Claude is asking">
              <button type="button" onClick={() => setOpen(false)}>Answer</button>
            </Sheet>
          </>
        );
      }
      render(<Composer />);
      const field = screen.getByLabelText('Message');
      field.focus();
      act(() => { show(true); });
      await settle();
      expect(document.activeElement, 'a modal left the composer focused behind its scrim').toBe(dialog());
      const back = vi.spyOn(field, 'focus');
      fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
      await settle();
      if (kind === 'fine') {
        expect(document.activeElement).toBe(field);
        // The give-back never scrolls the page to the field either (spec §2.4, D-5931).
        expect(back.mock.calls.length).toBeGreaterThan(0);
        for (const [o] of back.mock.calls) expect(o?.preventScroll).toBe(true);
      } else expect(document.activeElement).not.toBe(field);
    });
  }
});

describe('a reopen during the close transition', () => {
  for (const initial of [undefined, 'second'] as const) {
    it(`focuses ${initial === undefined ? 'the panel' : '`initialFocus`'} again, without scrolling`, async () => {
      const restore = holdClosingContent();
      try {
        render(<Host {...(initial === undefined ? {} : { initial })} />);
        const opener = await openFrom();
        const panel = dialog();
        fireEvent.click(screen.getByRole('button', { name: 'Last' }));
        await settle();
        expect(document.activeElement).toBe(opener);
        expect(panel.isConnected, 'the closing content was not held').toBe(true);
        const calls: Array<FocusOptions | undefined> = [];
        const real = HTMLElement.prototype.focus;
        const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
          if (this !== opener) calls.push(opts);
          real.call(this, opts);
        });
        try {
          fireEvent.click(opener);
          await settle();
        } finally {
          spy.mockRestore();
        }
        expect(dialog()).toBe(panel);
        const want: HTMLElement = initial === undefined ? panel : screen.getByRole('button', { name: 'Second' });
        expect(document.activeElement).toBe(want);
        expect(calls.length).toBeGreaterThan(0);
        for (const o of calls) expect(o?.preventScroll).toBe(true);
      } finally {
        restore();
      }
    });
  }
});

describe('one give-back owner', () => {
  it('`useCancelFirst` moves no focus: it only chooses Cancel (confirm.tsx, a source scan)', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'primitives', 'confirm.tsx'), 'utf8');
    const at = src.indexOf('export function useCancelFirst');
    expect(at, 'useCancelFirst is gone').toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n}\n', at));
    expect(body).not.toMatch(/\.focus\(/);
    expect(body).not.toMatch(/useEffect|useLayoutEffect/);
  });

  it('`useCancelFirst` hands the Sheet its Cancel only while open and on', () => {
    const seen: Array<HTMLElement | null> = [];
    function Probe({ on }: { on: boolean }): ReactNode {
      const ref: RefObject<HTMLButtonElement | null> = useCancelFirst(true, on);
      return (
        <>
          <button type="button" ref={ref}>Cancel</button>
          <button type="button" onClick={() => { seen.push(ref.current); }}>Read</button>
        </>
      );
    }
    const { rerender } = render(<Probe on />);
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    rerender(<Probe on={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    expect(seen[0]).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(seen[1]).toBeNull();
  });
});
