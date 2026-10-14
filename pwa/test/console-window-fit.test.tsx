// The drawer applying `consoleFit`: the wiring, not the search.
//
// What it must get right:
// - the type is actually SET, and the grid that reaches the socket is the one
//   the terminal really has afterwards;
// - a glass that already fits is left at the base size;
// - a glass that cannot fit the window even at the floor stays at the base
//   size, which is the console `main` shows, and says why in the header;
// - MEASURING IS NOT RESIZING. Every candidate size is measured without
//   touching the live grid, and a refit that lands on the grid it started from
//   changes nothing at all. The real-terminal half of that, where the damage
//   actually happens, is `console-window-fit-xterm.test.tsx`;
// - the answer depends on the box alone, never on the size the glass happened
//   to be at;
// - the history layer is built at the live pane's size and follows it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { TerminalDrawer, type DrawerTerm, type HistoryTerm } from '../src/session/TerminalDrawer';
import { BASE_CONSOLE_FONT_PX, MIN_CONSOLE_FONT_PX } from '../src/session/consoleFit';
import { PINNED_WINDOW_COLS } from '../../shared/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeSocket.instances.length = 0;
});

const ID = 'lane-a:project-a';

class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { /* nothing to tear down */ }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

type Grid = { cols: number; rows: number };

/**
 * A terminal that behaves like xterm about size, and keeps a record of it.
 *
 * `box` is the glass's usable width in units of the type size: the glass shows
 * `floor(box / px)` columns at `px`, so 2600 shows 185 at 14px and 222 at
 * 11.7px. `quirk` lets a test say "at this size the terminal shows one column
 * fewer than the straight line predicts", which is what xterm's rounding of
 * its cell width really does at some widths.
 *
 * `propose` measures and changes nothing, as `FitAddon.proposeDimensions`
 * does. `setFontSize` and `fit` are the only two calls that move the live
 * grid, and every move they make is written to `grids` — so a fit that
 * resizes the buffer to find something out cannot hide it.
 */
const fakeTermFactory = (box: number, quirk?: (px: number, cols: number) => number) => {
  let width = box;
  let font = BASE_CONSOLE_FONT_PX;
  let grid: Grid = { cols: 80, rows: 24 };
  const at = (px: number): Grid => {
    const cols = Math.floor(width / px);
    return { cols: quirk ? quirk(px, cols) : cols, rows: Math.floor(700 / (px * 1.2)) };
  };
  const sizes: number[] = [];
  const probes: number[] = [];
  const grids: Grid[] = [];
  const settle = (next: Grid): Grid => {
    if (next.cols !== grid.cols || next.rows !== grid.rows) {
      grid = next;
      grids.push(next);
    }
    return { ...grid };
  };
  const makeTerm = (_host: HTMLElement): DrawerTerm => ({
    write: () => {},
    onData: () => {},
    onWheel: () => {},
    fit: () => settle(at(font)),
    propose: (px) => {
      probes.push(px);
      return at(px);
    },
    setFontSize: (px) => {
      sizes.push(px);
      font = px;
      return settle(at(px));
    },
    focus: () => {},
    dispose: () => {},
  });
  return {
    makeTerm, sizes, probes, grids,
    font: () => font,
    /** The glass changed width: a rotation, a window drag, the same session
     *  opened on another screen. */
    resize: (next: number) => { width = next; },
  };
};

const resizeWindow = (): void => {
  act(() => { window.dispatchEvent(new Event('resize')); });
};

const mount = (t: ReturnType<typeof fakeTermFactory>, hostWidth = 1560) => {
  const view = render(
    <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />,
  );
  const host = view.baseElement.querySelector('.term-screen > .term-host');
  if (!host) throw new Error('the drawer rendered no terminal host');
  // jsdom has no layout. The drawer reads the host's width only to tell a
  // glass that has not been laid out yet from one that has; the columns
  // themselves come from the fake terminal.
  if (hostWidth > 0) {
    Object.defineProperty(host, 'clientWidth', { value: hostWidth, configurable: true });
  }
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('the drawer opened no socket');
  act(() => ws.onopen?.());
  // The opening fit ran while the host had no width, because jsdom gives it
  // none until the line above plants one. A resize is how a real glass says it
  // became measurable, and it is the same path a rotation takes.
  if (hostWidth > 0) resizeWindow();
  return { ws, view, host: host as HTMLElement };
};

/**
 * The grid the SERVER ends up believing: the one dialled into the URL at
 * attach, unless a later fit sent a `resize` frame.
 */
const clientGrid = (ws: FakeSocket): Grid => {
  const frames = ws.sent
    .map((raw) => JSON.parse(raw) as { type: string; cols?: number; rows?: number })
    .filter((f) => f.type === 'resize');
  const last = frames.at(-1);
  if (last?.cols !== undefined && last.rows !== undefined) {
    return { cols: last.cols, rows: last.rows };
  }
  const q = new URL(ws.url, 'https://x').searchParams;
  return { cols: Number(q.get('cols')), rows: Number(q.get('rows')) };
};

/** The clip notice, found by the name a screen reader hears. */
const notice = (view: ReturnType<typeof render>): HTMLElement | null =>
  within(view.baseElement).queryByRole('status', { name: /columns wide/ });

describe('the glass meets the pinned window', () => {
  it('shrinks the type until the whole window is on screen, and dials THAT grid', () => {
    // 185 columns at 14px is an ordinary desktop browser window. The tmux
    // window is 220, so tmux would pan it. What must reach the server is the
    // grid the client really has after the fit, not the one it started with.
    const t = fakeTermFactory(2600);
    const { ws, view } = mount(t);

    expect(t.font(), 'the type did not shrink').toBe(11.7);
    expect(clientGrid(ws).cols, 'the dialled client is still narrower than the window')
      .toBeGreaterThanOrEqual(PINNED_WINDOW_COLS);
    expect(notice(view), 'a window that fits was reported as clipped').toBeNull();
  });

  it('leaves a glass that already shows the whole window at the base size', () => {
    const t = fakeTermFactory(240 * 14);
    const { ws, view } = mount(t);

    expect(t.font()).toBe(BASE_CONSOLE_FONT_PX);
    expect(t.sizes.every((px) => px === BASE_CONSOLE_FONT_PX), 'a glass that fits was re-typed')
      .toBe(true);
    expect(clientGrid(ws).cols).toBe(240);
    expect(notice(view)).toBeNull();
  });

  it('stays at the base size when even the floor cannot show the window: a phone gets main\'s console', () => {
    // A phone: 48 columns at 14px. 220 would need 3px. At the floor it would
    // show about 61, and tmux would still pan, so shrinking buys nothing but
    // smaller type. The console stays at 14px, as it is on `main`, and the
    // header says why the lines begin off-screen.
    const t = fakeTermFactory(48 * 14 + 5);
    const { ws, view } = mount(t, 390);

    expect(t.font(), 'the phone console left the base size').toBe(BASE_CONSOLE_FONT_PX);
    expect(t.sizes.every((px) => px === BASE_CONSOLE_FONT_PX), 'the phone console was re-typed')
      .toBe(true);
    // NOTHING IS EVEN MEASURED at another size. A phone a whole order of
    // magnitude short of the window does not need the floor tried to know it
    // will not fit, and trying it re-renders the live terminal on every
    // keyboard and zoom event.
    expect(t.probes.every((px) => px === BASE_CONSOLE_FONT_PX), 'a phone measured other sizes')
      .toBe(true);
    expect(clientGrid(ws).cols).toBe(48);
    expect(notice(view), 'the clip was never explained').not.toBeNull();
  });

  it('trusts the measured grid over the straight-line guess, both ways', () => {
    // UP: 172 columns at 14px puts the straight-line guess at 10.9, under the
    // floor, but at 11px this glass shows exactly 220. The window fits, and
    // the console must neither stay at 14 nor say it is clipped.
    const fitsAtTheFloor = fakeTermFactory(2420.5);
    const a = mount(fitsAtTheFloor);
    expect(fitsAtTheFloor.font(), 'a glass that fits at the floor was not shrunk to it')
      .toBe(MIN_CONSOLE_FONT_PX);
    expect(clientGrid(a.ws).cols).toBe(PINNED_WINDOW_COLS);
    expect(notice(a.view), 'a window that fits at the floor was reported clipped').toBeNull();
    cleanup();

    // DOWN: 209 columns at 14px guesses 13.3, but at 13.3 this glass shows
    // 219, one short of the window, which tmux would pan by a column with no
    // notice at all. The fit steps down until the measured grid holds it.
    const oneShort = fakeTermFactory(2930, (px, cols) => (px === 13.3 ? cols - 1 : cols));
    const b = mount(oneShort);
    expect(oneShort.font(), 'the fit kept a size that shows one column short').toBe(13.2);
    expect(clientGrid(b.ws).cols).toBeGreaterThanOrEqual(PINNED_WINDOW_COLS);
  });

  it('changes nothing on a refit that lands where it started: no grid move, no frame', () => {
    // THE DEFECT THIS PINS LIVES IN THE TERMINAL'S BUFFER. tmux attaches on
    // the alternate screen, where shrinking the grid drops rows and clamps the
    // cursor and growing it back restores neither. A fit that resized the
    // live grid to measure a size, and then resized it back, sent no frame
    // because the grid ended where it began, so tmux never repainted the
    // damage. Every move of the live grid is recorded here, so measuring by
    // resizing fails this test however briefly it does it.
    //
    // 2600 is chosen so that computing the next size from the CURRENT one
    // (222 columns at 11.7px suggests 11.8) answers differently from the base
    // size (185 at 14px suggests 11.7). The answer must depend on the box
    // alone, or a refit that changes nothing re-types the console anyway.
    const t = fakeTermFactory(2600);
    const { ws } = mount(t);
    const settled = { font: t.font(), grids: t.grids.length, frames: ws.sent.length };
    expect(settled.font).toBe(11.7);

    resizeWindow();
    resizeWindow();

    expect(t.grids.length, 'a refit on an unchanged box moved the live grid').toBe(settled.grids);
    expect(ws.sent.length, 'a refit on an unchanged box sent a frame').toBe(settled.frames);
    expect(t.font(), 'a refit on an unchanged box re-typed the console').toBe(settled.font);
  });

  it('lands on the same size for the same box, whatever size it came from', () => {
    // THE RATCHET AND THE SPIRAL, both of which an earlier revision of this
    // fit had: the size a glass ends at must not depend on the size it was at.
    const fresh = fakeTermFactory(2600);
    mount(fresh);
    const want = fresh.font();
    cleanup();

    // From a desktop wide enough for the base size, narrowed.
    const fromWide = fakeTermFactory(260 * 14);
    mount(fromWide);
    expect(fromWide.font()).toBe(BASE_CONSOLE_FONT_PX);
    fromWide.resize(2600);
    resizeWindow();
    expect(fromWide.font(), 'narrowing from the base size landed elsewhere').toBe(want);

    // From a phone, widened, then widened again past the base: it grows back.
    fromWide.resize(48 * 14 + 5);
    resizeWindow();
    expect(fromWide.font()).toBe(BASE_CONSOLE_FONT_PX);
    fromWide.resize(2600);
    resizeWindow();
    expect(fromWide.font(), 'widening from a phone landed elsewhere').toBe(want);
    fromWide.resize(260 * 14);
    resizeWindow();
    expect(fromWide.font(), 'a shrunk console never grew back').toBe(BASE_CONSOLE_FONT_PX);
  });

  it('clears the notice when the window starts to fit, and raises it when it stops', () => {
    const t = fakeTermFactory(48 * 14 + 5);
    const { view } = mount(t, 390);
    expect(notice(view), 'the phone was not told why its lines begin off-screen').not.toBeNull();

    // The same session's drawer, its window dragged wide.
    t.resize(2600);
    resizeWindow();
    expect(notice(view), 'the notice outlived the clip').toBeNull();

    t.resize(48 * 14 + 5);
    resizeWindow();
    expect(notice(view), 'the notice did not come back with the clip').not.toBeNull();
  });

  it('puts the notice in the header, outside the glass, under its own name', () => {
    // NOT OVER THE TERMINAL. On a phone the clip is permanent, so a strip laid
    // over the live glass would cover its top row for the whole session. And
    // not the history's strip either: this has nothing to do with history.
    const t = fakeTermFactory(48 * 14 + 5);
    const { view } = mount(t, 390);
    const n = notice(view);
    if (n === null) throw new Error('no clip notice');

    expect(n.closest('.term-screen'), 'the notice sits over the live terminal').toBeNull();
    expect(n.closest('.sheet-eyebrow'), 'the notice is not in the drawer header').not.toBeNull();
    expect(n.getAttribute('aria-label')).toContain(`${PINNED_WINDOW_COLS} columns wide`);
    expect(view.baseElement.querySelector('.term-histbar'), 'the history strip is up over a live pane')
      .toBeNull();
    // SHORT ENOUGH FOR A 360px PHONE. The header is 11px mono with 0.08em
    // tracking (about 7.5px a character) inside 16px of padding each side,
    // so 328px holds about 43 characters. The notice must fit on a line of
    // its own there, whatever the session id beside it does.
    expect(n.textContent?.length ?? 0, 'the notice is too long for a phone header')
      .toBeLessThanOrEqual(30);
  });

  it('builds the history layer at the live size, and keeps it there when the live size moves', async () => {
    // The two terminals sit one over the other and one key moves between them.
    // A history at 14px over a live pane at 11.7 reads as the console having
    // changed size, not the layer: "when I scroll the font comes back".
    const born: (number | undefined)[] = [];
    const followed: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: true, text: 'a line\n', lines: 2000, scrollback: 40, alternate: false }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const t = fakeTermFactory(2600);
    const view = render(
      <TerminalDrawer
        id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm}
        makeHistoryTerm={(_host, _lines, _pane, fontSize): HistoryTerm => {
          born.push(fontSize);
          return {
            write: (_d: string, done?: () => void) => done?.(),
            fit: () => ({ cols: 80, rows: 24 }),
            setFontSize: (px: number) => { followed.push(px); },
            rowHeight: () => 0,
            scrollLines: () => {},
            onBottom: () => {},
            dispose: () => {},
          };
        }}
      />,
    );
    const host = view.baseElement.querySelector('.term-screen > .term-host');
    if (!host) throw new Error('the drawer rendered no terminal host');
    Object.defineProperty(host, 'clientWidth', { value: 1560, configurable: true });
    resizeWindow();
    expect(t.font()).toBe(11.7);

    const back = view.baseElement.querySelector('[aria-label="Scroll back"]');
    if (!back) throw new Error('the drawer rendered no history key');
    fireEvent.click(back);
    await waitFor(() => expect(born.length, 'the history layer never opened').toBeGreaterThan(0));
    expect(born.at(-1), 'the history was built at a size the live pane is not using').toBe(11.7);

    // The window widens while the reader is in the history.
    t.resize(260 * 14);
    resizeWindow();
    expect(t.font()).toBe(BASE_CONSOLE_FONT_PX);
    expect(followed.at(-1), 'the history stayed at the old size').toBe(BASE_CONSOLE_FONT_PX);
  });

  it('fits at open when the glass is already laid out, so the URL dials the fitted grid', () => {
    // The opening fit's grid rides the attach URL. A glass with layout at
    // open must be fitted there, not first attached at the wrong width and
    // corrected by a resize frame.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1560 });
    try {
      const t = fakeTermFactory(2600);
      render(<TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />);
      const ws = FakeSocket.instances.at(-1);
      if (!ws) throw new Error('the drawer opened no socket');
      const q = new URL(ws.url, 'https://x').searchParams;
      expect(Number(q.get('cols')), 'the attach URL dialled an unfitted grid')
        .toBeGreaterThanOrEqual(PINNED_WINDOW_COLS);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  });

  it('refits after the notice comes or goes, because the header it sits in can change height', async () => {
    // On a narrow phone the notice can take the header onto a second line,
    // and the glass below loses that height with no window event to say so.
    // Unrefitted, the terminal keeps rows the glass no longer has, and the
    // bottom one is cut off under the host's `overflow: hidden`.
    const frame = (): Promise<void> => act(async () => {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
    });
    const t = fakeTermFactory(48 * 14 + 5);
    const view = render(
      <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />,
    );
    const host = view.baseElement.querySelector('.term-screen > .term-host');
    if (!host) throw new Error('the drawer rendered no terminal host');
    Object.defineProperty(host, 'clientWidth', { value: 390, configurable: true });
    const ws = FakeSocket.instances.at(-1);
    act(() => ws?.onopen?.());
    // The drawer's own after-paint refit, the one it schedules on opening,
    // is the first fit that can measure this glass, and it raises the notice.
    await frame();
    expect(notice(view), 'the opening refit did not raise the notice').not.toBeNull();
    const before = t.probes.length;
    // Nothing else happens: no window event, no keyboard. Only the notice.
    await frame();
    expect(t.probes.length, 'the notice changed the header and nothing refitted').toBeGreaterThan(before);
  });

  it('changes nothing on a glass it cannot measure yet', () => {
    // The sheet portals its content and animates in, so the opening fit can
    // land on an element with no width. xterm answers that with the grid it
    // was CONSTRUCTED with, which is not a measurement.
    const t = fakeTermFactory(2600);
    mount(t, 0);

    expect(t.sizes, 'an unmeasurable glass was re-typed').toEqual([]);
    expect(t.probes, 'an unmeasurable glass was measured').toEqual([]);
  });
});
