// The drawer's type fit against the REAL xterm 6.0.0 — not a fake, because the
// defect this file exists for lives inside xterm's own buffer.
//
// tmux attaches the drawer's client on the ALTERNATE screen, and xterm's
// alternate buffer does not survive being shrunk: `Buffer.resize` pops the rows
// below the cursor, trims rows off the top and clamps the cursor, and growing
// back only appends blank lines. So a fit that resizes the live buffer to find
// out how many columns a size WOULD show, and then resizes it back, leaves a
// screen tmux no longer recognises — and because the grid ends where it began,
// no resize frame goes out and tmux never repaints it. The next keystroke's
// echo lands rows away from the prompt.
//
// The history layer is here for the same reason: whether it follows the live
// pane's type size is a fact about the drawer's real history terminal, which a
// fake that records the call cannot show.
//
// jsdom has no layout, so the two measurements xterm takes are supplied here
// and nothing else is: the char-measure element's size (xterm's own DOM
// measure strategy — jsdom has no OffscreenCanvas, so xterm falls back to it)
// scales with the font size the way a monospace face does, and the host's box
// is an inline width and height, which `getComputedStyle` reports and the fit
// addon reads. Everything between those two numbers and the buffer is xterm.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Terminal as XTerm } from '@xterm/xterm';

const made = vi.hoisted(() => ({ terms: [] as unknown[] }));
// The real Terminal, unchanged — only remembered, so the test can read its
// buffer. The drawer's own factory builds it, exactly as in the app.
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

const { TerminalDrawer } = await import('../src/session/TerminalDrawer');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeSocket.instances.length = 0;
  made.terms.length = 0;
});

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

/** A monospace face: 0.6em wide, 1.2em tall, measured over xterm's own run of
 *  32 glyphs and rounded to whole pixels as `offsetWidth` is. */
const measureLikeAMonospaceFace = (): void => {
  const fontPx = (el: HTMLElement): number => Number.parseFloat(el.style.fontSize);
  const isMeasure = (el: HTMLElement): boolean => el.classList.contains('xterm-char-measure-element');
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isMeasure(this) ? Math.round(fontPx(this) * 0.6 * 32) : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isMeasure(this) ? Math.round(fontPx(this) * 1.2) : 0;
  });
};

const resizeFrames = (ws: FakeSocket): string[] =>
  ws.sent.filter((raw) => (JSON.parse(raw) as { type: string }).type === 'resize');

/** Let xterm parse everything written so far — `write` is asynchronous. */
const parsed = (term: XTerm): Promise<void> => new Promise((resolve) => term.write('', resolve));

const line = (term: XTerm, y: number): string =>
  term.buffer.active.getLine(y)?.translateToString(true) ?? '';

/** Give a terminal's host a box, as a laid-out glass has. The fit addon reads
 *  the host's computed width and height; the drawer reads `clientWidth` only to
 *  tell an unlaid glass from a laid-out one. */
const layOut = (term: XTerm, width: number, height: number): void => {
  const host = term.element?.parentElement;
  if (!host || !term.element) throw new Error('the terminal is not mounted');
  term.element.style.padding = '0px';
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
};

describe('the type fit, against the real terminal', () => {
  it('leaves the live screen and its cursor alone on a refit that lands on the same grid', async () => {
    measureLikeAMonospaceFace();
    const view = render(
      <TerminalDrawer
        id="lane-a:project-a" open onClose={() => {}}
        makeSocket={(u) => new FakeSocket(u) as unknown as WebSocket}
      />,
    );
    const host = view.baseElement.querySelector('.term-screen > .term-host');
    if (!(host instanceof HTMLElement)) throw new Error('the drawer rendered no terminal host');
    const term = made.terms.at(-1) as XTerm | undefined;
    if (term?.element === undefined) throw new Error('the drawer opened no real terminal');
    term.element.style.padding = '0px';
    // A narrow desktop window: 185 columns at 14px, so the fit shrinks the type
    // and the whole 220-column window lands on the glass.
    host.style.width = '1570px';
    host.style.height = '700px';
    Object.defineProperty(host, 'clientWidth', { value: 1570, configurable: true });
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('the drawer opened no socket');
    act(() => ws.onopen?.());
    act(() => { window.dispatchEvent(new Event('resize')); });
    const settled = { cols: term.cols, rows: term.rows, font: term.options.fontSize };
    expect(settled.font, 'the fit did not shrink the type at all').toBeLessThan(14);
    expect(settled.cols, 'the shrunk type does not show the whole window').toBeGreaterThanOrEqual(220);

    // What tmux paints on attach: the alternate screen, every row numbered, and
    // the cursor parked near the bottom right, where a prompt sits.
    const y = settled.rows - 4;
    const x = settled.cols - 20;
    let screen = '\x1b[?1049h';
    for (let r = 1; r <= settled.rows; r += 1) screen += `\x1b[${r};1Hrow${r}`;
    screen += `\x1b[${y + 1};${x + 1}H`;
    act(() => ws.onmessage?.({ data: screen }));
    await parsed(term);
    expect(term.buffer.active.type).toBe('alternate');
    const framesBefore = resizeFrames(ws).length;

    // The window edge dragged by less than a cell: the box changes, the grid
    // it holds does not.
    host.style.height = '703px';
    act(() => { window.dispatchEvent(new Event('resize')); });
    await parsed(term);

    expect({ cols: term.cols, rows: term.rows }, 'the refit did not land on the same grid')
      .toEqual({ cols: settled.cols, rows: settled.rows });
    expect(resizeFrames(ws).length, 'a same-grid refit sent a resize frame').toBe(framesBefore);
    expect(
      { x: term.buffer.active.cursorX, y: term.buffer.active.cursorY },
      'the cursor moved, so the next echo lands away from where tmux put it',
    ).toEqual({ x, y });
    expect(line(term, 0), 'the top of the screen was trimmed away').toBe('row1');
    expect(line(term, settled.rows - 1), 'the rows below the cursor were dropped')
      .toBe(`row${settled.rows}`);

    // And the next byte tmux sends lands exactly where tmux believes the cursor is.
    act(() => ws.onmessage?.({ data: 'Z' }));
    await parsed(term);
    expect(line(term, y).charAt(x), 'the echo landed somewhere other than the prompt').toBe('Z');
  });

  it('builds the history layer at the live size, and moves it with the live size', async () => {
    // The two terminals sit one over the other in the same glass, and one key
    // moves between them. A history at another size reads as the console
    // having changed size, not the layer. This is the drawer's real history
    // factory, so the follow is xterm's own type size and grid, not a call
    // recorded on a fake.
    measureLikeAMonospaceFace();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: true, text: 'a line\nb line\n', lines: 2000, scrollback: 40, alternate: false }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const view = render(
      <TerminalDrawer
        id="lane-a:project-a" open onClose={() => {}}
        makeSocket={(u) => new FakeSocket(u) as unknown as WebSocket}
      />,
    );
    const live = made.terms.at(-1) as XTerm | undefined;
    if (live === undefined) throw new Error('the drawer opened no real terminal');
    layOut(live, 1700, 700);
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('the drawer opened no socket');
    act(() => ws.onopen?.());
    act(() => { window.dispatchEvent(new Event('resize')); });
    const shrunk = live.options.fontSize;
    expect(shrunk, 'the live pane did not shrink, so there is nothing to follow').toBeLessThan(14);

    const back = view.baseElement.querySelector('[aria-label="Scroll back"]');
    if (!back) throw new Error('the drawer rendered no history key');
    fireEvent.click(back);
    await waitFor(() => expect(made.terms.length, 'the history layer never opened').toBe(2));
    const hist = made.terms.at(-1) as XTerm;
    expect(hist.options.fontSize, 'the history was built at a size the live pane is not using')
      .toBe(shrunk);

    // The window widens while the reader is in the history. Both layers fill
    // the same glass, so both hosts grow.
    layOut(live, 3500, 700);
    layOut(hist, 3500, 700);
    act(() => { window.dispatchEvent(new Event('resize')); });

    expect(live.options.fontSize, 'the live pane did not grow back').toBe(14);
    expect(hist.options.fontSize, 'the history stayed at the old size').toBe(14);
    expect({ cols: hist.cols, rows: hist.rows }, 'the history layer shows another grid than the live pane')
      .toEqual({ cols: live.cols, rows: live.rows });
  });
});
