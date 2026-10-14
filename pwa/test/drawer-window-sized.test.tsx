// The drawer's attach: a client exactly the window's size, and never a resize
// frame (D-5005, spec 2026-10-14 §5.1).
//
// A tmux client smaller than its window is a viewport tmux pans to follow the
// cursor, and one larger than it is a client tmux fills with `·` past the
// window's edge. A client of PINNED_WINDOW_COLS × (PINNED_WINDOW_ROWS +
// TMUX_STATUS_ROWS) is neither: tmux has nothing to pan and nothing to fill
// (W6, measured on real tmux by `server/test/drawer-window-sized-client.test.ts`).
// So the drawer dials that size at every glass width, pins its one terminal at
// it, and answers every later change of the glass with the type size alone.
//
// What this file holds still:
// (a) the URL dials the window's size at every glass width, read from the
//     constants;
// (b) no frame other than `input` is ever sent, across every trigger that
//     refits the drawer — `sendFrame` no longer types a resize frame, and this
//     is the behaviour half of that;
// (c) the terminal is pinned at the window's size before the socket is made,
//     and never again; against the real xterm, no fit ever moves the grid;
// (d) typing still sends `{type:'input', data}`;
// (e) the terminal is opened into the drawer's one host, once;
// (f) the grid's 51 rows are fixed, so a shorter glass scrolls the host, held
//     at its bottom (where the box is) until the operator scrolls it;
// (g) the wheel keeps its meaning — the history — so it does not scroll the
//     host as well; a pinch and a sideways scroll stay the browser's;
// (h) a glass the terminal cannot measure changes nothing: the type and the
//     clip stay as they were, and nothing is sent (plan Refinement 9).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { DrawerTerm, MakeTerm } from '../src/session/TerminalDrawer';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';

const made = vi.hoisted(() => ({ terms: [] as unknown[], resizes: [] as [number, number][] }));
// The real Terminal, unchanged, except that every `resize` it is asked for is
// remembered — so a fit that moves the grid, by any path, is seen.
vi.mock('@xterm/xterm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@xterm/xterm')>();
  class Terminal extends real.Terminal {
    constructor(...args: ConstructorParameters<typeof real.Terminal>) {
      super(...args);
      made.terms.push(this);
    }
    resize(cols: number, rows: number): void {
      made.resizes.push([cols, rows]);
      super.resize(cols, rows);
    }
  }
  return { ...real, Terminal };
});

const { TerminalDrawer } = await import('../src/session/TerminalDrawer');

/** The window's own size plus tmux's status row: what every attach dials. */
const WINDOW = { cols: PINNED_WINDOW_COLS, rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS };

const ID = 'lane-a:project-a';

/** One record of everything the drawer does to the terminal and the socket, in
 *  the order it did it — (c) is a statement about order. */
let log: string[] = [];

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
    log.push('socket');
    FakeSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { /* nothing to tear down */ }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

/** The glass, in CSS px. Mutable: a rotation, a window drag and a keyboard all
 *  change it, and the fake terminal measures whatever it is now. */
const glass = { width: 1700, height: 900 };

/** A visualViewport, which jsdom lacks: the keyboard inset is read off it. */
class FakeViewport extends EventTarget {
  width = 1024;
  height = 768;
  offsetTop = 0;
  offsetLeft = 0;
  scale = 1;
}
let vv: FakeViewport;

beforeEach(() => {
  log = [];
  glass.width = 1700;
  glass.height = 900;
  vv = new FakeViewport();
  vv.height = window.innerHeight;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  // jsdom has no layout. The drawer reads the host's width only to tell a glass
  // that has been laid out from one that has not; the columns come from the
  // fake terminal, or from the real one's own measurement below.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true, get: () => glass.width,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeSocket.instances.length = 0;
  made.terms.length = 0;
  made.resizes.length = 0;
  Reflect.deleteProperty(window, 'visualViewport');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

/**
 * A terminal that measures like xterm and records what the drawer asks of it.
 * `propose` answers only once the terminal is open, as `FitAddon` does: an
 * unopened terminal has no host to measure.
 */
const fakeTerm = () => {
  const pins: [number, number][] = [];
  const opened: HTMLElement[] = [];
  const sizes: number[] = [];
  const probes: number[] = [];
  let open = false;
  /** Laid out, but nothing the terminal measures there is a measurement. */
  let blind = false;
  let dataCb: ((data: string) => void) | null = null;
  let wheelCb: ((ev: WheelEvent) => boolean) | null = null;
  const makeTerm: MakeTerm = (): DrawerTerm => ({
    write: () => {},
    onData: (cb) => { dataCb = cb; },
    onWheel: (cb) => { wheelCb = cb; },
    pin: (cols, rows) => { pins.push([cols, rows]); log.push(`pin ${cols}x${rows}`); },
    propose: (px) => {
      probes.push(px);
      if (!open || blind) return null;
      return { cols: Math.floor(glass.width / (px * 0.6)), rows: Math.floor(glass.height / (px * 1.2)) };
    },
    setFontSize: (px) => { sizes.push(px); },
    open: (host) => { opened.push(host); open = true; log.push('open'); },
    isOpen: () => open,
    model: () => [],
    statusRow: () => [],
    onParsed: () => () => {},
    focus: () => {},
    dispose: () => {},
  });
  return {
    makeTerm, pins, opened, sizes, probes,
    blind: (v: boolean) => { blind = v; },
    type: (d: string) => dataCb?.(d),
    wheel: (init: WheelEventInit) => {
      const ev = new WheelEvent('wheel', { cancelable: true, ...init });
      const handled = wheelCb?.(ev);
      return { ev, handled };
    },
  };
};

const liveHost = (view: ReturnType<typeof render>): HTMLElement => {
  const el = view.baseElement.querySelector('.term-screen > .term-host');
  if (!(el instanceof HTMLElement)) throw new Error('the drawer rendered no terminal host');
  return el;
};

const mount = (t: ReturnType<typeof fakeTerm>) => {
  const view = render(
    <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />,
  );
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('the drawer opened no socket');
  act(() => ws.onopen?.());
  return { view, ws };
};

const dialled = (ws: FakeSocket): { cols: number; rows: number } => {
  const q = new URL(ws.url, 'https://x').searchParams;
  return { cols: Number(q.get('cols')), rows: Number(q.get('rows')) };
};

const frameTypes = (ws: FakeSocket): string[] =>
  ws.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);

const resizeWindow = (): void => {
  act(() => { window.dispatchEvent(new Event('resize')); });
};

/** One animation frame, inside act: the drawer refits after paint when the
 *  keyboard inset or the clip notice changes. */
const frame = (): Promise<void> => act(async () => {
  await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
});

describe('the attach dials the window\'s own size (D-5005)', () => {
  it.each([390, 1280, 1700, 2600])('(a) at a %ipx glass the URL carries the window\'s size, 220x51', (width) => {
    glass.width = width;
    const t = fakeTerm();
    const { ws } = mount(t);

    expect(ws.url).toContain(`/ws/pty/${encodeURIComponent(ID)}?cols=${WINDOW.cols}&rows=${WINDOW.rows}`);
    expect(dialled(ws), 'the attach dialled a grid other than the window\'s').toEqual(WINDOW);
    // The glass was measured all the same: the TYPE follows it, the grid does not.
    expect(t.probes.length, 'the opening fit never measured the glass').toBeGreaterThan(0);
  });

  it('(b) sends no frame but input across every refit: a window drag, the viewport, the keyboard, the clip, a rotation', async () => {
    const t = fakeTerm();
    const { view, ws } = mount(t);
    act(() => t.type('x'));
    /** Each trigger must actually refit, or "nothing was sent" proves nothing. */
    const refits = (what: string, before: number): void => {
      expect(t.probes.length, `${what} did not refit the drawer`).toBeGreaterThan(before);
    };

    let before = t.probes.length;
    glass.width = 2600;
    resizeWindow();
    refits('a window drag', before);

    before = t.probes.length;
    vv.width = 2000;
    act(() => { vv.dispatchEvent(new Event('resize')); });
    refits('a visualViewport resize', before);

    // The keyboard opens: the visual viewport loses 300px at the bottom.
    before = t.probes.length;
    vv.height = window.innerHeight - 300;
    act(() => { vv.dispatchEvent(new Event('resize')); });
    await frame();
    refits('a keyboard-inset change', before);

    // The clip changes: a glass that fits becomes one that cannot, and back.
    before = t.probes.length;
    glass.width = 390;
    resizeWindow();
    expect(view.baseElement.querySelector('.term-clip'), 'the clip never changed').not.toBeNull();
    await frame();
    refits('the clip changing', before);
    glass.width = 1700;
    resizeWindow();
    await frame();

    // A rotation: the glass's two sides swap.
    before = t.probes.length;
    Object.assign(glass, { width: glass.height, height: glass.width });
    act(() => {
      window.dispatchEvent(new Event('orientationchange'));
      window.dispatchEvent(new Event('resize'));
    });
    refits('a rotation', before);

    expect(new Set(t.sizes).size, 'the type never moved, so the refits were not exercised').toBeGreaterThan(1);
    expect(frameTypes(ws).filter((type) => type !== 'input'),
      'a refit sent the pane a frame: the client followed the glass').toEqual([]);
    expect(frameTypes(ws), 'the typed key never reached the pane').toContain('input');
  });

  it('(c) pins the terminal at the window\'s size before the socket is made, and never again', async () => {
    const t = fakeTerm();
    mount(t);

    expect(log.indexOf(`pin ${WINDOW.cols}x${WINDOW.rows}`), 'the terminal was never pinned at 220x51')
      .toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`pin ${WINDOW.cols}x${WINDOW.rows}`), 'the socket was made before the pin')
      .toBeLessThan(log.indexOf('socket'));

    glass.width = 390;
    resizeWindow();
    await frame();
    glass.width = 2600;
    resizeWindow();
    await frame();

    expect(t.pins, 'the grid was pinned again, or at another size').toEqual([[WINDOW.cols, WINDOW.rows]]);
  });

  it('(c) against the real terminal: no fit ever moves the grid off the window\'s size', async () => {
    // A monospace face: 0.6em wide, 1.2em tall, measured over xterm's own run
    // of 32 glyphs and rounded to whole pixels as `offsetWidth` is.
    const fontPx = (el: HTMLElement): number => Number.parseFloat(el.style.fontSize);
    const isMeasure = (el: HTMLElement): boolean => el.classList.contains('xterm-char-measure-element');
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return isMeasure(this) ? Math.round(fontPx(this) * 0.6 * 32) : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return isMeasure(this) ? Math.round(fontPx(this) * 1.2) : 0;
    });

    render(<TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} />);
    const term = made.terms.at(-1) as XTerm | undefined;
    if (term?.element === undefined) throw new Error('the drawer opened no real terminal');
    const host = term.element.parentElement;
    if (host === null) throw new Error('the terminal has no host');
    const layOut = (width: number, height: number): void => {
      glass.width = width;
      host.style.width = `${width}px`;
      host.style.height = `${height}px`;
    };
    term.element.style.padding = '0px';
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('the drawer opened no socket');
    act(() => ws.onopen?.());

    // A glass that fits 220 columns only below 14px: the fit shrinks the type,
    // and a fit that also fitted the grid to the host would land under 220.
    layOut(1700, 700);
    resizeWindow();
    expect(term.options.fontSize, 'the type did not follow the glass').toBeLessThan(14);
    expect({ cols: term.cols, rows: term.rows }, 'a fit moved the grid').toEqual(WINDOW);

    // A wide glass, then a phone: the type moves both ways, the grid never.
    layOut(3500, 1400);
    resizeWindow();
    expect(term.options.fontSize).toBe(14);
    layOut(390, 700);
    resizeWindow();
    expect({ cols: term.cols, rows: term.rows }, 'a fit moved the grid').toEqual(WINDOW);

    expect(made.resizes.filter(([c, r]) => c !== WINDOW.cols || r !== WINDOW.rows),
      'the terminal was resized to something other than the window').toEqual([]);
    expect(frameTypes(ws), 'the real terminal\'s drawer sent a frame').toEqual([]);
    expect(dialled(ws)).toEqual(WINDOW);
  }, 20_000);

  it('(d) typing still sends {type:"input", data}', () => {
    const t = fakeTerm();
    const { ws } = mount(t);
    act(() => t.type('ls\r'));
    expect(ws.sent.map((raw) => JSON.parse(raw) as unknown)).toEqual([{ type: 'input', data: 'ls\r' }]);
  });

  it('(e) opens the terminal into the drawer\'s one host, once', async () => {
    const t = fakeTerm();
    const { view } = mount(t);
    const host = liveHost(view);

    glass.width = 390;
    resizeWindow();
    await frame();
    glass.width = 2600;
    resizeWindow();
    act(() => { vv.dispatchEvent(new Event('resize')); });
    await frame();

    expect(t.opened, 'the terminal was opened more than once, or somewhere else').toEqual([host]);
    expect(host.classList.contains('term-host--grid'), 'the host is not in its visible position').toBe(true);
    expect(view.baseElement.querySelectorAll('.term-screen > .term-host'),
      'the drawer has more than one live host').toHaveLength(1);
  });
});

describe('the grid\'s rows are fixed, so the host scrolls and keeps the box in view', () => {
  it('(f) holds a shorter glass at its bottom, until the operator scrolls it', () => {
    const t = fakeTerm();
    const { view } = mount(t);
    const host = liveHost(view);
    // 51 rows at the type size are 900px; the glass shows 600 of them.
    const geo = { scrollHeight: 900, clientHeight: 600 };
    Object.defineProperty(host, 'scrollHeight', { configurable: true, get: () => geo.scrollHeight });
    Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => geo.clientHeight });

    resizeWindow();
    expect(host.scrollTop, 'the host is not at its bottom, where the box is').toBe(300);

    // The operator scrolls up to read the top rows. A refit must not snatch
    // the view back from them.
    host.scrollTop = 120;
    fireEvent.scroll(host);
    resizeWindow();
    expect(host.scrollTop, 'a refit scrolled the host away from where the operator put it').toBe(120);

    // They come back to the bottom, and the keyboard takes 200px of the glass:
    // the host follows its bottom down.
    host.scrollTop = 300;
    fireEvent.scroll(host);
    geo.clientHeight = 400;
    resizeWindow();
    expect(host.scrollTop, 'the keyboard covered the box').toBe(500);
  });

  it('(g) the wheel opens the history and does not scroll the host as well', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const t = fakeTerm();
    mount(t);

    const up = t.wheel({ deltaY: -120 });
    expect(up.handled, 'xterm was let process the wheel').toBe(false);
    expect(up.ev.defaultPrevented, 'the wheel up would scroll the host as well as open the history').toBe(true);
    const down = t.wheel({ deltaY: 120 });
    expect(down.ev.defaultPrevented, 'the wheel down would scroll the host').toBe(true);

    // A pinch is the browser's zoom, and a sideways scroll is the host's own.
    expect(t.wheel({ deltaY: -120, ctrlKey: true }).ev.defaultPrevented, 'a pinch was taken from the browser')
      .toBe(false);
    expect(t.wheel({ deltaX: 120, deltaY: 0 }).ev.defaultPrevented, 'a sideways scroll was taken from the host')
      .toBe(false);
  });
});

describe('a glass the terminal cannot measure keeps what it has (Refinement 9)', () => {
  // `consoleFit` answers null when the terminal cannot measure the glass. That
  // is "not measured", never "fits" and never "clipped": the type and the clip
  // the last measured fit chose stay, and the next measured fit decides.
  //
  // MUTATION ROWS (fitToWindow's `want === null` arm; RUN 2026-10-14, each
  // applied, this file run alone, restored): null raises the clip → the first
  // case RED; null clears the clip → the second RED; null re-types to the base
  // size → both RED; null treated as a phone (base size and clip) → both RED.
  const clipNotice = (view: ReturnType<typeof render>): Element | null =>
    view.baseElement.querySelector('.term-clip');

  it('(h) keeps a fitted type, and raises no clip it never measured', async () => {
    const t = fakeTerm();
    const { view, ws } = mount(t);
    await frame();
    const typed = [...t.sizes];
    expect(typed.at(-1), 'the measured 1700px glass did not shrink the type').toBeLessThan(14);
    expect(clipNotice(view), 'a glass that fits was called clipped').toBeNull();

    t.blind(true);
    glass.width = 390;
    resizeWindow();
    await frame();

    expect(t.sizes, 'an unmeasurable glass was re-typed').toEqual(typed);
    expect(clipNotice(view), 'an unmeasurable glass was called clipped').toBeNull();
    expect(frameTypes(ws), 'an unmeasurable glass sent the pane a frame').toEqual([]);
  });

  it('(h) keeps a clip it measured, until a measured fit clears it', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view, ws } = mount(t);
    await frame();
    expect(clipNotice(view), 'the 390px glass was not called clipped').not.toBeNull();
    const typed = [...t.sizes];

    t.blind(true);
    glass.width = 2600;
    resizeWindow();
    await frame();
    expect(t.sizes, 'an unmeasurable glass was re-typed').toEqual(typed);
    expect(clipNotice(view), 'an unmeasurable glass cleared a measured clip').not.toBeNull();

    t.blind(false);
    resizeWindow();
    await frame();
    expect(clipNotice(view), 'a measured fit that fits did not clear the clip').toBeNull();
    expect(frameTypes(ws)).toEqual([]);
  });
});
