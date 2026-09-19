// The drawer applying `consoleFit` — the wiring, not the arithmetic.
//
// What it must get right: the type is actually SET, the grid that reaches the
// socket is the widened one, a glass that already fits is left alone, and the
// widened surface is cleared before the next measurement so a scrolling fit
// never measures its own last answer as the room available.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { TerminalDrawer, type DrawerTerm } from '../src/session/TerminalDrawer';
import { BASE_CONSOLE_FONT_PX, MIN_CONSOLE_FONT_PX } from '../src/session/consoleFit';
import { PINNED_WINDOW_COLS } from '../../shared/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  FakeSocket.instances.length = 0;
});

const ID = 'claude:OpenClawHetzner';

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

/**
 * A terminal that behaves like a real one about size: columns are inversely
 * proportional to the type size, so shrinking the type shows more of them.
 * `colsAtBase` is what the glass shows at `BASE_CONSOLE_FONT_PX`.
 */
const fakeTermFactory = (colsAtBase: number) => {
  const sizes: number[] = [];
  let font = BASE_CONSOLE_FONT_PX;
  let base = colsAtBase;
  const grid = () => ({ cols: Math.floor((base * BASE_CONSOLE_FONT_PX) / font), rows: 20 });
  const makeTerm = (_host: HTMLElement): DrawerTerm => ({
    write: () => {},
    onData: () => {},
    onWheel: () => {},
    fit: () => grid(),
    setFontSize: (px) => {
      sizes.push(px);
      font = px;
      return grid();
    },
    focus: () => {},
    dispose: () => {},
  });
  return {
    makeTerm, sizes, grid,
    /** The glass got wider — a rotation, or the same session opened on a
     *  desktop. The columns a box shows depend on BOTH its width and the type
     *  size, and a fake that modelled only the size could not tell a shrink
     *  that stuck from one that was re-measured. */
    widen: (cols: number) => { base = cols; },
  };
};

const mount = (colsAtBase: number, hostWidth = 1560) => {
  const t = fakeTermFactory(colsAtBase);
  const view = render(
    <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />,
  );
  const host = view.baseElement.querySelector('.term-screen > .term-host');
  if (!host) throw new Error('the drawer rendered no terminal host');
  // jsdom has no layout, so the one measurement the scrolling arm needs is
  // supplied here rather than pretended into existence by the component.
  if (hostWidth > 0) {
    Object.defineProperty(host, 'clientWidth', { value: hostWidth, configurable: true });
  }
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('the drawer opened no socket');
  act(() => ws.onopen?.());
  // The opening fit ran while the host had no width at all — jsdom gives none
  // until the line above plants one. A resize is how a real glass announces it
  // became measurable, and it is the same path a rotation takes.
  if (hostWidth > 0) act(() => { window.dispatchEvent(new Event('resize')); });
  return { t, ws, view, host: host as HTMLElement };
};

/**
 * The grid the SERVER ends up believing: the one dialled into the URL at
 * attach, unless a later fit sent a `resize` frame — which is how a drawer
 * whose glass was not measurable at open corrects itself.
 */
const clientGrid = (ws: FakeSocket): { cols: number; rows: number } => {
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

describe('the glass meets the pinned window', () => {
  it('shrinks the type until the whole window is on screen, and dials THAT grid', () => {
    // 166 columns at 14px is an ordinary desktop browser. The window is 220,
    // so tmux would pan it — and what must reach the server is the grid the
    // client really has after the fit, not the one it started with.
    const { t, ws } = mount(185);

    expect(t.sizes.at(-1), 'the type did not shrink').toBeLessThan(BASE_CONSOLE_FONT_PX);
    expect(clientGrid(ws).cols, 'the dialled client is still narrower than the window')
      .toBeGreaterThanOrEqual(PINNED_WINDOW_COLS);
  });

  it('leaves a glass that already shows the whole window alone', () => {
    // A wide desktop needs nothing done to it, and doing something anyway
    // would mean re-rendering every terminal on every fit for no reason.
    const { t, ws } = mount(240);

    expect(t.sizes.at(-1), 'a glass that already fitted did not end at the base size')
      .toBe(BASE_CONSOLE_FONT_PX);
    expect(clientGrid(ws).cols).toBe(240);
  });

  it('stops at the floor, and says why the lines begin off-screen', () => {
    // A phone: 48 columns at 14px. 220 would need 3px, which is not a size, so
    // the type stops at the app's own smallest text size and the pane goes back
    // to being what it is on `main` — a viewport tmux pans. The one thing left
    // to do about that is SAY it: a reader who knows the window is 220 wide is
    // in a different position from one watching text slide sideways for no
    // stated reason.
    const { t, view } = mount(48, 390);

    expect(t.sizes.at(-1), 'the type went below the floor').toBe(MIN_CONSOLE_FONT_PX);
    expect(view.baseElement.textContent, 'the clip was never explained')
      .toContain(`${PINNED_WINDOW_COLS} columns`);
  });

  it('says nothing about a window that fits', () => {
    const { view } = mount(240);

    expect(view.baseElement.textContent, 'a window that fits was reported as clipped')
      .not.toContain(`${PINNED_WINDOW_COLS} columns`);
  });

  it('hands the history layer the same size, so the two do not disagree', async () => {
    // The two terminals sit one over the other and one key moves between them.
    // A history at 14px over a live pane at 11.7 reads as the console having
    // changed rather than the layer having — which is exactly what the reader
    // reported: "when I scroll the font comes back".
    const sizes: (number | undefined)[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: true, text: 'a line\n', lines: 2000, scrollback: 40, alternate: false }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const t = fakeTermFactory(185);
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true, get: () => 1560,
    });
    try {
      const view = render(
        <TerminalDrawer
          id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm}
          makeHistoryTerm={(_host, _lines, _pane, fontSize) => {
            sizes.push(fontSize);
            return {
              write: (_d: string, done?: () => void) => done?.(),
              fit: () => ({ cols: 80, rows: 24 }),
              rowHeight: () => 0,
              scrollLines: () => {},
              onBottom: () => {},
              dispose: () => {},
            };
          }}
        />,
      );
      const back = view.baseElement.querySelector('[aria-label="Scroll back"]');
      if (!back) throw new Error('the drawer rendered no history key');
      fireEvent.click(back);

      await waitFor(() => expect(sizes.length, 'the history layer never opened').toBeGreaterThan(0));
      expect(sizes.at(-1), 'the history was built at a size the live pane is not using')
        .toBe(t.sizes.at(-1));
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  });

  it('does not compound — fitting twice lands on the same size', () => {
    // THE SPIRAL THIS REPLACES WAS REAL, and it was measured on the live
    // console: 14px fitted to 10.5, the next pass computed from 10.5 and asked
    // for 7.9, and the floor caught it at 8. Every fit now re-anchors on the
    // base size, so the question it asks depends on the box alone.
    const { t, host } = mount(185);
    const first = t.sizes.at(-1);

    Object.defineProperty(host, 'clientWidth', { value: 1560, configurable: true });
    act(() => { window.dispatchEvent(new Event('resize')); });

    expect(t.sizes.at(-1), 'a second fit shrank the type again').toBe(first);
    expect(first, 'the first fit already hit the floor').toBeGreaterThan(MIN_CONSOLE_FONT_PX);
  });

  it('changes nothing on a glass it cannot measure yet', () => {
    // The sheet portals its content and animates in, so the opening fit can
    // land on an element with no width. xterm answers that with the grid it
    // was CONSTRUCTED with, which is not a measurement — and read as columns it
    // asks for the floor and a surface metres wide.
    const { t, host } = mount(185, 0);

    expect(t.sizes, 'an unmeasurable glass was resized anyway').toEqual([]);
    expect(host.style.minWidth, 'an unmeasurable glass was widened').toBe('');
  });

});
