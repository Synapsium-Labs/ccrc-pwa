// The drawer's two views (D-5005, D-5006; spec 2026-10-14 §5.2, §5.3; plan Task 9).
//
// One terminal, pinned at the window's 220x51, is the model for both views. The
// GRID shows it as tmux draws it, where 220 columns fit at 11px or more; the
// WRAPPED view re-wraps its screen to the glass, everywhere else. The terminal
// is opened on every pointer: in the wrapped view its host is moved off-screen,
// keeping the glass's own box, and a tap on the wrapped view focuses xterm's
// textarea, so phones and physical keyboards type live (operator ruling R-LIVE,
// 2026-10-15). A physical Escape with that textarea focused goes to Claude Code
// and does not close the drawer (P4).
//
// This file holds:
// - the pure chooser (`drawerView.ts`): the verdict, the override's read and
//   write under storage that throws, `wrapWidth`, the prompt glyph, the anchor
//   and the caret's place in the visual rows;
// - the drawer (jsdom, fakes): the two positions of the one host, the chip and
//   its persistence, the forced grid, the wrapped view's stickiness, anchor,
//   selection freeze, composition preview and not-Claude chip, the focus a tap
//   gives, and P4 against the real terminal and the real sheet.
//
// RED FIRST, measured 2026-10-15: against the tree before Task 9 (this file and
// `drawerView.ts` only), 19 of the 21 drawer cases failed; the two that passed
// are the "no offer" negative and the sheet with no prop, which is main's own
// behaviour.
//
// MUTATION TABLE (plan Task 9 Step 4; RUN 2026-10-15, each mutant applied, the
// named suite run alone, restored). Every row went RED:
//   readViewOverride without its try/catch ........ the throwing-store cases (2)
//   the chooser ignores the override ............... survives-a-remount, and 5 more
//   chooseView(null, …) answers grid ............... the unmeasured-refit case, and its pure twin
//   updates not frozen during a selection .......... the `paused` case
//   the off-screen position is display:none ........ the 1280 host-style case
//   the not-Claude chip keyed on a hasMenu-like row  the numbered-reply case, and 2 more
//   the Escape handler always preventDefault()s .... P4's focus-elsewhere case
//   the Escape handler dropped ..................... P4's xterm cases (both views)
//   the wrapped view leaves the terminal un-opened . the coarse-pointer case, and 18 more
//   the tap focuses without preventScroll .......... the real-terminal focus case
//   the composition preview never cleared .......... the composition case
//   flipping back to the glass's view pins it ...... survives-a-remount (the store is not cleared)
//   a tap ending a selection takes focus anyway .... the reading-not-typing case
//   the view never unsticks ........................ the sticky case
//   the stuck view ignores its anchor .............. the anchor case
//   the glass shrinking does not re-stick .......... the sticky case
//   the two host positions scroll differently ...... the 1280 host-style case
//   a new terminal keeps the last one's view ....... console-window-fit's "a new terminal" case
// The plan's row "the coarse-pointer wrapped view opens the terminal → the
// never-opened case RED" predates R-LIVE and contradicts it; its replacement
// row (un-opened → no focus target) is the one run above.
//
// THE VIEW SITS ON THE KEY BAR (spec §5.3; the stage-1 visual pass found it at
// the top). RED FIRST against the block scroller; rows RUN the same way, all RED:
//   the first row takes no slack (margin-top removed) ... the sits-on-the-key-bar case
//   bottom-anchored by justify-content: flex-end ........ the same case
//   rows may shrink (flex-shrink removed) ................ the same case
//   a block scroller again (display: flex removed) ....... the same case
//
// THREE CLAUSES THE STAGE-1 VERIFIER LEFT GREEN UNDER MUTATION, and the offer's
// lifetime (it outlived the close). RED FIRST for the offer's reset; the other
// four cases hold on the tree as built and are proved by their rows. RUN, all RED:
//   the offer is never put back when the drawer closes .. taken-closed-reopened
//   a chip flip does not end the offer ................... the chip-flip-survives-the-close case
//   the offer is stored as the device's choice ........... taken-closed-reopened
//   P4 keeps Escape for any textarea (host.contains) ..... the history-layer Escape case
//   no focus when the socket opens ....................... the takes-the-keyboard case
//   focus at attach, before the socket opens ............. the takes-the-keyboard case
//
// THE DEVICE'S OWN OVERRIDE COMES BACK WITH THE CLOSE. The stage-1 verifier's
// mutant (closing puts back no override) was GREEN before the
// device-has-its-own-override case: every offer case started with nothing
// stored, where "no override" and "the device's own" read the same. RUN
// 2026-10-15 on an isolated copy, the same way, both RED:
//   closing puts back no override, not the device's ...... the device-has-its-own-override case
//   closing puts nothing back ............................. that case, and taken-closed-reopened
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { Sheet } from '@ccrc/ui';
import {
  NOT_CLAUDE_MS,
  PROMPT_GLYPH,
  VIEW_OVERRIDE_KEY,
  anchorRow,
  caretIndex,
  chooseView,
  readViewOverride,
  showsPrompt,
  viewChip,
  wrapWidth,
  writeViewOverride,
  type StorageLike,
} from '../src/session/drawerView';
import { readModel, type ModelRow } from '../src/session/drawerModel';
import { wrapScreen } from '../src/session/wrapScreen';
import type { DrawerTerm, MakeTerm } from '../src/session/terminalFactory';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';
import { SYNTHETIC_SCREENS, STATUS_TEXT } from './fixtures/drawer/synthetic';
import { declaredValues } from './cssRule';

const made = vi.hoisted(() => ({ terms: [] as unknown[] }));
// The real Terminal, remembered as it is made, so a case can reach the one the
// drawer built by itself.
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

const SRC = PINNED_WINDOW_COLS;
const ID = 'lane-a:project-a';
const screenNamed = (name: string) => {
  const s = SYNTHETIC_SCREENS.find((x) => x.name === name);
  if (!s) throw new Error(`no synthetic screen ${name}`);
  return s;
};

/** A screen's model as the drawer reads it: its stream into an un-opened
 *  220x51 terminal, then the window's 50 rows. */
async function modelOf(stream: string): Promise<{ term: XTerm; model: () => ModelRow[] }> {
  const term = new Terminal({ cols: SRC, rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS });
  await new Promise<void>((resolve) => term.write(stream, resolve));
  return { term, model: () => readModel(term.buffer.active, SRC, PINNED_WINDOW_ROWS) };
}

/** A store that remembers, as localStorage does. */
const memStore = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
};
/** A store whose every access throws: a private window, a preview, a thumbnail
 *  capture, or site data the browser blocks. */
const throwingStore: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: the chooser, pure
// ─────────────────────────────────────────────────────────────────────────────

describe('chooseView: the type fit decides, the override wins, null keeps', () => {
  it('answers grid where 220 columns fit and wrapped where they do not', () => {
    expect(chooseView({ fontSize: 11.7, clipped: false }, null, null)).toBe('grid');
    expect(chooseView({ fontSize: 14, clipped: true }, null, null)).toBe('wrapped');
    expect(chooseView({ fontSize: 14, clipped: true }, null, 'grid')).toBe('wrapped');
  });

  it('keeps the current view when nothing was measured, and never reads null as grid', () => {
    expect(chooseView(null, null, 'wrapped')).toBe('wrapped');
    expect(chooseView(null, null, 'grid')).toBe('grid');
    expect(chooseView(null, null, null), 'an unmeasured first fit chose a view').toBeNull();
  });

  it('answers the override whenever one is set, measured or not', () => {
    expect(chooseView({ fontSize: 14, clipped: true }, 'grid', 'wrapped')).toBe('grid');
    expect(chooseView({ fontSize: 12, clipped: false }, 'wrapped', 'grid')).toBe('wrapped');
    expect(chooseView(null, 'grid', null)).toBe('grid');
  });
});

describe('the override survives storage that throws', () => {
  it('reads what was written, and nothing else', () => {
    const s = memStore();
    expect(readViewOverride(() => s)).toBeNull();
    writeViewOverride(() => s, 'grid');
    expect(s.map.get(VIEW_OVERRIDE_KEY)).toBe('grid');
    expect(readViewOverride(() => s)).toBe('grid');
    writeViewOverride(() => s, 'wrapped');
    expect(readViewOverride(() => s)).toBe('wrapped');
    writeViewOverride(() => s, null);
    expect(s.map.has(VIEW_OVERRIDE_KEY), 'clearing the override left a value behind').toBe(false);
    expect(readViewOverride(() => s)).toBeNull();
  });

  it('reads any other value as no override', () => {
    for (const v of ['', 'Grid', 'wrap', 'null', '{"view":"grid"}', ' grid']) {
      const s = memStore();
      s.map.set(VIEW_OVERRIDE_KEY, v);
      expect(readViewOverride(() => s), JSON.stringify(v)).toBeNull();
    }
  });

  it('reads null when the store getter throws, and when getItem throws', () => {
    expect(readViewOverride(() => { throw new Error('SecurityError'); })).toBeNull();
    expect(readViewOverride(() => throwingStore)).toBeNull();
  });

  it('swallows a throwing setItem, removeItem and getter', () => {
    expect(() => writeViewOverride(() => throwingStore, 'grid')).not.toThrow();
    expect(() => writeViewOverride(() => throwingStore, null)).not.toThrow();
    expect(() => writeViewOverride(() => { throw new Error('SecurityError'); }, 'wrapped')).not.toThrow();
  });
});

describe('wrapWidth', () => {
  it('floors the columns the glass holds past its gutter', () => {
    expect(wrapWidth(390, 8.4, 16)).toBe(44);
    expect(wrapWidth(412, 8.4, 0)).toBe(49);
    expect(wrapWidth(1280, 8.43, 16)).toBe(149);
  });

  it('is never below 1', () => {
    expect(wrapWidth(10, 8.4, 16)).toBe(1);
    expect(wrapWidth(0, 8.4, 0)).toBe(1);
    expect(wrapWidth(5, 8.4, 0)).toBe(1);
  });
});

describe('the prompt glyph, the anchor and the caret', () => {
  it('the prompt glyph is U+276F, and only it counts', () => {
    expect(PROMPT_GLYPH).toBe('❯');
    expect(showsPrompt(['', '❯ 1. Yes', ''])).toBe(true);
    expect(showsPrompt(['> plain', '1. one', '2. two'])).toBe(false);
    expect(showsPrompt([])).toBe(false);
  });

  it('a Claude Code screen shows the prompt, vim does not, and a quoted numbered reply does', async () => {
    for (const s of SYNTHETIC_SCREENS) {
      const { term, model } = await modelOf(s.stream);
      const text = model().map((r) => r.map((c) => c.ch).join(''));
      expect(showsPrompt(text), s.name).toBe(s.name !== 'not-claude');
      term.dispose();
    }
  });

  it('anchors on the caret row, else on the last ❯ row, else nowhere', async () => {
    const reply = screenNamed('prose-long-lines');
    const { term, model } = await modelOf(reply.stream);
    const rows = wrapScreen(model(), 45, SRC);
    const at = anchorRow(rows);
    expect(at).not.toBeNull();
    expect(caretIndex(rows[at!]!), 'the anchor is not the caret row').toBeGreaterThanOrEqual(0);
    term.dispose();

    // A menu has no caret: the selected option's ❯ is the anchor.
    const menu = screenNamed('single-select');
    const m = await modelOf(menu.stream);
    const menuRows = wrapScreen(m.model(), 45, SRC);
    const mAt = anchorRow(menuRows);
    expect(mAt).not.toBeNull();
    expect(menuRows.every((r) => caretIndex(r) < 0), 'the menu screen grew a caret').toBe(true);
    expect(menuRows[mAt!]!.cells.map((c) => c.ch).join('')).toContain(PROMPT_GLYPH);
    const lastPrompt = menuRows.map((r) => r.cells.some((c) => c.ch === PROMPT_GLYPH)).lastIndexOf(true);
    expect(mAt).toBe(lastPrompt);
    m.term.dispose();

    const vim = await modelOf(screenNamed('not-claude').stream);
    expect(anchorRow(wrapScreen(vim.model(), 45, SRC))).toBeNull();
    vim.term.dispose();
  });
});

describe('the view chip names the view and why', () => {
  it('reads wrapped, grid, and grid · scrolls for a forced grid', () => {
    expect(viewChip('wrapped', true).legend).toBe('wrapped');
    expect(viewChip('grid', false).legend).toBe('grid');
    expect(viewChip('grid', true).legend).toBe('grid · scrolls');
  });

  it('carries the sentence the pans notice used to, naming the window\'s width', () => {
    expect(viewChip('grid', true).label).toContain(`${PINNED_WINDOW_COLS} columns wide`);
    expect(viewChip('grid', true).label).toMatch(/scrolls sideways/);
    expect(viewChip('wrapped', true).label).toMatch(/re-wrapped/);
    expect(viewChip('grid', false).label).not.toMatch(/scrolls/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: the drawer
// ─────────────────────────────────────────────────────────────────────────────

const chatCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8');

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
  frames(): { type: string; data?: string }[] {
    return this.sent.map((raw) => JSON.parse(raw) as { type: string; data?: string });
  }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

/** The glass in CSS px, and the 14px cell the wrapped view's probe measures. */
const glass = { width: 1546, height: 900 };
const CELL_PX = 8.4;

class FakeViewport extends EventTarget {
  width = 1024;
  height = 768;
  offsetTop = 0;
  offsetLeft = 0;
  scale = 1;
}

/** The scroller's geometry, which jsdom does not lay out: its scroll height,
 *  its visible height, and the top of the row the view anchors on. */
const geo = { scrollHeight: 0, clientHeight: 0, anchorTop: 0 };

beforeEach(() => {
  glass.width = 1546;
  glass.height = 900;
  Object.assign(geo, { scrollHeight: 0, clientHeight: 0, anchorTop: 0 });
  const vv = new FakeViewport();
  vv.height = window.innerHeight;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  // jsdom has no layout: every element is the glass's width, which is what the
  // drawer reads to tell a laid-out glass from one that is not.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => glass.width });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains('term-wrap') ? geo.scrollHeight : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains('term-wrap') ? geo.clientHeight : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-anchor') ? geo.anchorTop : 0; },
  });
  // The probe: ten cells of the wrapped view's 14px face.
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('term-wrap-probe')) return new DOMRect(0, 0, CELL_PX * 10, 17);
    return realRect.call(this);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  FakeSocket.instances.length = 0;
  for (const t of made.terms) (t as XTerm).dispose();
  made.terms.length = 0;
  document.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(window, 'visualViewport');
  for (const p of ['clientWidth', 'scrollHeight', 'clientHeight', 'offsetTop']) {
    Reflect.deleteProperty(HTMLElement.prototype, p);
  }
});

/**
 * A terminal that measures like xterm and parses like xterm. Its screen is a
 * real, never-opened 220x51 Terminal (so `model()` is the drawer's own read),
 * and it opens by putting a textarea into its host, as xterm does, so focus
 * and composition have the element they have in the product.
 */
const fakeTerm = () => {
  const screenTerm = new Terminal({ cols: SRC, rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS });
  const opened: { host: HTMLElement; className: string }[] = [];
  const sizes: number[] = [];
  const focus = vi.fn();
  let open = false;
  let blind = false;
  let textarea: HTMLTextAreaElement | null = null;
  let dataCb: ((data: string) => void) | null = null;
  const makeTerm: MakeTerm = (): DrawerTerm => ({
    write: (d) => screenTerm.write(d),
    onData: (cb) => { dataCb = cb; },
    onWheel: () => {},
    pin: () => {},
    propose: (px) => (!open || blind
      ? null
      : { cols: Math.floor(glass.width / (px * 0.6)), rows: Math.floor(glass.height / (px * 1.2)) }),
    setFontSize: (px) => { sizes.push(px); },
    open: (host) => {
      if (open) return;
      open = true;
      opened.push({ host, className: host.className });
      textarea = document.createElement('textarea');
      textarea.className = 'xterm-helper-textarea';
      host.appendChild(textarea);
    },
    isOpen: () => open,
    model: () => readModel(screenTerm.buffer.active, SRC, PINNED_WINDOW_ROWS),
    statusRow: () => readModel(screenTerm.buffer.active, SRC, PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS).at(-1) ?? [],
    onParsed: (cb) => {
      const sub = screenTerm.onWriteParsed(cb);
      return () => sub.dispose();
    },
    focus: () => { focus(); textarea?.focus({ preventScroll: true }); },
    dispose: () => {},
  });
  return {
    makeTerm, opened, sizes, focus,
    blind: (v: boolean) => { blind = v; },
    textarea: () => textarea,
    type: (d: string) => dataCb?.(d),
    /** Paint a screen, as tmux's bytes would, and let the view draw it. */
    paint: (stream: string): Promise<void> => act(async () => {
      await new Promise<void>((resolve) => screenTerm.write(`\x1b[H\x1b[2J${stream}`, resolve));
      await nextFrame();
    }),
  };
};

const nextFrame = (): Promise<void> => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
const frame = (): Promise<void> => act(async () => { await nextFrame(); });

const mount = (t: ReturnType<typeof fakeTerm>, store?: () => StorageLike, onClose = vi.fn()) => {
  const view = render(
    <TerminalDrawer
      id={ID} open onClose={onClose} makeSocket={makeSocket} makeTerm={t.makeTerm}
      viewStorage={store ?? (() => memStore())}
    />,
  );
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('the drawer opened no socket');
  act(() => ws.onopen?.());
  return { view, ws, onClose };
};

const hostOf = (view: ReturnType<typeof render>): HTMLElement => {
  const el = view.baseElement.querySelector('.term-screen > .term-host');
  if (!(el instanceof HTMLElement)) throw new Error('the drawer rendered no terminal host');
  return el;
};
const wrapOf = (view: ReturnType<typeof render>): HTMLElement | null =>
  view.baseElement.querySelector<HTMLElement>('.term-wrap');
const viewChipEl = (): HTMLElement => screen.getByRole('button', { name: /^(Grid|Wrapped) view:/ });
const resizeWindow = (): void => { act(() => { window.dispatchEvent(new Event('resize')); }); };
/** Select the first few characters of the wrapped view's first text run, as a
 *  reader's long-press or drag would. The selection is emptied first:
 *  `addRange` does nothing while one range is already there, and the focused
 *  textarea holds one. */
const selectIn = (wrap: HTMLElement): void => {
  const textNode = wrap.querySelector('.term-wrap-row span')?.firstChild;
  if (!textNode) throw new Error('no text to select');
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(3, textNode.textContent?.length ?? 0));
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
};

describe('the grid where 220 columns fit, the wrapped view where they do not', () => {
  it('a glass that fits 220 at 11.7px shows the grid, its host visible, its type 11.7px', () => {
    glass.width = 1546;
    const t = fakeTerm();
    const { view } = mount(t);

    const host = hostOf(view);
    expect(host.classList.contains('term-host--grid'), 'the grid\'s host is not in its visible position').toBe(true);
    expect(host.classList.contains('term-host--off')).toBe(false);
    expect(wrapOf(view), 'a glass that fits shows the wrapped view').toBeNull();
    expect(t.sizes.at(-1), 'the grid is not at the fitted type size').toBe(11.7);
    expect(viewChipEl().textContent).toBe('grid ⇄');
  });

  it('a phone with a coarse pointer gets the wrapped view; the terminal is opened in the off-screen host, and a tap types live', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: q === '(pointer: coarse)', media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    glass.width = 390;
    const t = fakeTerm();
    const { view, ws } = mount(t);

    const host = hostOf(view);
    expect(wrapOf(view), 'the phone was not given the wrapped view').not.toBeNull();
    expect(host.classList.contains('term-host--off'), 'the host is not off-screen').toBe(true);
    expect(t.opened.map((o) => o.host), 'the terminal was not opened into the drawer\'s one host')
      .toEqual([host]);

    t.focus.mockClear();
    fireEvent.click(wrapOf(view)!);
    expect(t.focus, 'a tap on the wrapped view did not focus the terminal').toHaveBeenCalledTimes(1);
    expect(document.activeElement, 'xterm\'s textarea does not have focus').toBe(t.textarea());

    act(() => t.type('hi'));
    expect(ws.frames(), 'typing did not reach the session as one input frame').toEqual([{ type: 'input', data: 'hi' }]);
  });

  it('the tap focuses xterm\'s own textarea without scrolling anything (the real terminal)', () => {
    const store = memStore();
    store.map.set(VIEW_OVERRIDE_KEY, 'wrapped');
    const view = render(
      <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} viewStorage={() => store} />,
    );
    const term = made.terms.at(-1) as XTerm;
    const ta = term.textarea;
    if (ta === undefined) throw new Error('the drawer did not open its terminal');
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');

    fireEvent.click(wrapOf(view)!);
    const calls = focus.mock.contexts.map((c, i) => [c, focus.mock.calls[i]?.[0]] as const)
      .filter(([c]) => c === ta);
    expect(calls.length, 'the tap did not focus xterm\'s textarea').toBeGreaterThan(0);
    expect(calls.every(([, opts]) => (opts as FocusOptions | undefined)?.preventScroll === true),
      'the textarea was focused without preventScroll').toBe(true);
  });

  it('a 1280 glass with a fine pointer gets the wrapped view too, its host off-screen with the glass\'s box', () => {
    glass.width = 1280;
    const t = fakeTerm();
    const { view } = mount(t);
    const host = hostOf(view);

    expect(wrapOf(view), 'a laptop that cannot fit 220 at 11px got the grid').not.toBeNull();
    expect(host.classList.contains('term-host--off')).toBe(true);
    expect(t.opened.map((o) => o.host)).toEqual([host]);
    expect(host.getAttribute('style'), 'the host is hidden or resized inline').toBeNull();

    // The off-screen position is a translation and nothing else: the same
    // width, height and overflow as the grid's, never hidden (Task 1: the
    // textarea in it takes the keyboard).
    // Every rule naming the off-screen position, grouped or not.
    const off = (prop: string): string[] => declaredValues(chatCss, '.term-host--off', prop);
    expect(off('transform').join(' '), 'the off-screen host is not moved off the glass').toMatch(/translate/);
    for (const prop of ['display', 'visibility', 'width', 'height', 'position', 'inset', 'left', 'top', 'opacity']) {
      expect(off(prop), `the off-screen host sets ${prop}`).toEqual([]);
    }
    expect(off('overflow'), 'the two positions scroll differently, so they measure differently')
      .toEqual(declaredValues(chatCss, '.term-host--grid', 'overflow'));
  });

  it('an unmeasurable refit keeps the view it has; nothing measured means nothing moves', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view } = mount(t);
    expect(wrapOf(view)).not.toBeNull();

    t.blind(true);
    glass.width = 2600;
    resizeWindow();
    await frame();
    expect(wrapOf(view), 'an unmeasured glass flipped the view').not.toBeNull();
    expect(hostOf(view).classList.contains('term-host--off')).toBe(true);

    t.blind(false);
    resizeWindow();
    expect(wrapOf(view), 'a measured fit that fits did not give the grid').toBeNull();
  });
});

describe('the terminal takes the keyboard when its socket opens', () => {
  it('focused once the session is live, never before: a physical keyboard types at once, in either view', () => {
    for (const v of ['wrapped', 'grid'] as const) {
      const store = memStore();
      store.map.set(VIEW_OVERRIDE_KEY, v);
      const t = fakeTerm();
      const view = render(
        <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} viewStorage={() => store} />,
      );
      const ws = FakeSocket.instances.at(-1)!;
      expect(t.focus, `${v}: focused before the session was live`).not.toHaveBeenCalled();
      act(() => ws.onopen?.());
      expect(t.focus, `${v}: the open socket left the keyboard elsewhere`).toHaveBeenCalledTimes(1);
      expect(document.activeElement, v).toBe(t.textarea());
      view.unmount();
    }
  });
});

describe('the chip', () => {
  it('flips the view, and the choice survives a remount', () => {
    glass.width = 390;
    const store = memStore();
    const t = fakeTerm();
    const first = mount(t, () => store);
    expect(viewChipEl().textContent).toBe('wrapped ⇄');

    fireEvent.click(viewChipEl());
    expect(wrapOf(first.view), 'the chip did not flip to the grid').toBeNull();
    expect(hostOf(first.view).classList.contains('term-host--grid')).toBe(true);
    expect(store.map.get(VIEW_OVERRIDE_KEY)).toBe('grid');
    first.view.unmount();

    const t2 = fakeTerm();
    const second = mount(t2, () => store);
    expect(wrapOf(second.view), 'the choice did not survive a remount').toBeNull();
    expect(viewChipEl().textContent).toBe('grid · scrolls ⇄');

    // Flipping back to what the glass chooses by itself clears the override.
    fireEvent.click(viewChipEl());
    expect(wrapOf(second.view)).not.toBeNull();
    expect(store.map.has(VIEW_OVERRIDE_KEY), 'flipping back pinned the glass\'s own choice').toBe(false);
  });

  it('with a localStorage that throws on every access, still flips the view for the session, and nothing throws', () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view } = mount(t, () => throwingStore);
    expect(wrapOf(view)).not.toBeNull();
    expect(() => fireEvent.click(viewChipEl())).not.toThrow();
    expect(wrapOf(view), 'the chip did not flip with a throwing store').toBeNull();
    fireEvent.click(viewChipEl());
    expect(wrapOf(view)).not.toBeNull();
    view.unmount();

    const t2 = fakeTerm();
    const getterThrows = mount(t2, () => { throw new Error('SecurityError'); });
    expect(wrapOf(getterThrows.view), 'a store getter that throws broke the drawer').not.toBeNull();
    fireEvent.click(viewChipEl());
    expect(wrapOf(getterThrows.view)).toBeNull();
  });

  it('a grid forced on a glass it does not fit renders at consoleFit\'s size, scrolls sideways, and says so', () => {
    glass.width = 390;
    const store = memStore();
    store.map.set(VIEW_OVERRIDE_KEY, 'grid');
    const t = fakeTerm();
    const { view } = mount(t, () => store);

    expect(wrapOf(view)).toBeNull();
    const host = hostOf(view);
    expect(host.classList.contains('term-host--grid')).toBe(true);
    expect(t.sizes.at(-1), 'the forced grid is not at consoleFit\'s size for a glass it does not fit').toBe(14);
    expect(declaredValues(chatCss, '.term-host--grid', 'overflow'), 'the grid\'s host does not scroll').toEqual(['auto']);
    expect(viewChipEl().textContent).toBe('grid · scrolls ⇄');
  });

  it('the pans notice is gone, and its sentence is the chip\'s accessible name', () => {
    glass.width = 390;
    const store = memStore();
    store.map.set(VIEW_OVERRIDE_KEY, 'grid');
    const t = fakeTerm();
    const { view } = mount(t, () => store);
    expect(view.baseElement.querySelector('.term-clip'), 'the clip notice is still drawn').toBeNull();
    expect(view.baseElement.textContent).not.toMatch(/window \d+ cols/);
    expect(viewChipEl().getAttribute('aria-label')).toMatch(new RegExp(`${PINNED_WINDOW_COLS} columns wide.*scrolls sideways`));
  });
});

describe('the wrapped view', () => {
  it('drops tmux\'s status row and renders the screen as text', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view } = mount(t);
    await t.paint(screenNamed('busy').stream);
    const text = wrapOf(view)!.textContent ?? '';
    expect(text).toContain('Working…');
    expect(text, 'the status row reached the wrapped view').not.toContain(STATUS_TEXT);
    expect(wrapOf(view)!.querySelector('a'), 'pane text became an anchor').toBeNull();
  });

  it('sticks to the bottom, also when the glass shrinks, and stops once scrolled up', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view } = mount(t);
    Object.assign(geo, { scrollHeight: 2000, clientHeight: 600, anchorTop: 1900 });
    await t.paint(screenNamed('prose-long-lines').stream);
    const wrap = wrapOf(view)!;
    expect(wrap.scrollTop, 'the view is not at its bottom').toBe(1400);

    // The phone keyboard opens: the glass loses 300px, and the bottom follows.
    geo.clientHeight = 300;
    resizeWindow();
    expect(wrap.scrollTop, 'the keyboard covered the bottom').toBe(1700);

    // The reader goes up to read: new output does not snatch the view back.
    wrap.scrollTop = 500;
    fireEvent.scroll(wrap);
    await t.paint(screenNamed('busy').stream);
    expect(wrap.scrollTop, 'an update scrolled the view away from where the reader put it').toBe(500);
    geo.clientHeight = 200;
    resizeWindow();
    expect(wrap.scrollTop).toBe(500);

    // Back at the bottom, it sticks again.
    wrap.scrollTop = 1800;
    fireEvent.scroll(wrap);
    geo.clientHeight = 400;
    resizeWindow();
    expect(wrap.scrollTop).toBe(1600);
  });

  it('sits on the key bar when the screen is shorter than the glass, and still scrolls to its top when it is longer', () => {
    // Spec §5.3: the view sticks to the BOTTOM. MEASURED before this (the
    // visual pass): `wrapScreen` collapses blank runs, so a screen often
    // re-wraps shorter than the glass, and a plain block scroller put it at
    // the TOP — Claude Code's box and footer 41px above the key bar at
    // 430x932, 166px at 1440x900, the exit notice the ^C guard reads ~520px
    // away at 390x844 — with nothing to scroll, so sticking never acted.
    // jsdom lays nothing out, so the mechanism is read from chat.css: a column
    // whose first row takes the slack above it (`margin-top: auto`). An auto
    // margin resolves to 0 once the rows overflow, so the top stays reachable;
    // `justify-content: flex-end` would not (it overflows off the top, where no
    // scroll reaches).
    expect(declaredValues(chatCss, '.term-wrap', 'display')).toEqual(['flex']);
    expect(declaredValues(chatCss, '.term-wrap', 'flex-direction')).toEqual(['column']);
    expect(declaredValues(chatCss, '.term-wrap', 'justify-content')).not.toContain('flex-end');
    expect(declaredValues(chatCss, '.term-wrap-row:first-child', 'margin-top')).toEqual(['auto']);
    // A row never gives up its line to fit the glass: a table row scrolls
    // sideways, which makes its own minimum height 0, so without this it would
    // be squashed out of sight once the rows overflow.
    expect(declaredValues(chatCss, '.term-wrap-row', 'flex-shrink')).toEqual(['0']);
  });

  it('anchors on the caret row, else on the ❯ row', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view } = mount(t);
    // Below the anchor there is more than a glass of rows (a suggestion list
    // under the box): the anchor stays in sight rather than the bottom.
    Object.assign(geo, { scrollHeight: 2000, clientHeight: 600, anchorTop: 900 });
    await t.paint(screenNamed('prose-long-lines').stream);
    const wrap = wrapOf(view)!;
    const anchored = (): Element | null => wrap.querySelector('[data-anchor]');
    expect(wrap.scrollTop, 'the view did not keep its anchor in sight').toBe(900);
    const caretSpan = [...(anchored()?.querySelectorAll('span') ?? [])]
      .find((s) => (s as HTMLElement).style.backgroundColor !== '');
    expect(caretSpan, 'the anchor is not the caret\'s row').toBeDefined();

    await t.paint(screenNamed('single-select').stream);
    expect(anchored()?.textContent, 'with no caret, the anchor is not the ❯ row').toContain(PROMPT_GLYPH);
  });

  it('freezes behind a paused chip while a selection lies inside it, and resumes when it clears', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view } = mount(t);
    await t.paint(screenNamed('prose-long-lines').stream);
    const wrap = wrapOf(view)!;
    const before = wrap.textContent;

    act(() => {
      selectIn(wrap);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(screen.getByRole('status', { name: 'Updates paused while text is selected' })).toBeTruthy();

    await t.paint(screenNamed('busy').stream);
    expect(wrap.textContent, 'the rows moved under the selection').toBe(before);

    act(() => {
      document.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    await frame();
    expect(wrap.textContent, 'the held update never landed').toContain('Working…');
    expect(screen.queryByRole('status', { name: 'Updates paused while text is selected' })).toBeNull();
  });

  it('a tap that ends a selection is reading, not typing: it does not take focus', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view } = mount(t);
    await t.paint(screenNamed('prose-long-lines').stream);
    const wrap = wrapOf(view)!;
    selectIn(wrap);
    t.focus.mockClear();
    fireEvent.click(wrap);
    expect(t.focus, 'a tap ending a selection took focus, and the selection with it').not.toHaveBeenCalled();
  });

  it('shows an open composition at the caret, provisionally, sends nothing for it, and clears it at compositionend', async () => {
    glass.width = 390;
    const t = fakeTerm();
    const { view, ws } = mount(t);
    await t.paint(screenNamed('prose-long-lines').stream);
    const ta = t.textarea()!;

    act(() => {
      fireEvent.compositionStart(ta, { data: '' });
      fireEvent.compositionUpdate(ta, { data: 'wor' });
    });
    const ime = view.baseElement.querySelector('.term-wrap-ime');
    expect(ime?.textContent, 'the word in progress is not shown').toBe('wor');
    expect(ime?.hasAttribute('data-provisional')).toBe(true);
    // At the caret: the next cell after the preview is the caret block.
    const next = ime?.nextElementSibling as HTMLElement | null;
    expect(next?.style.backgroundColor, 'the preview is not at the caret').not.toBe('');
    expect(ws.frames(), 'a composition sent something before it committed').toEqual([]);

    act(() => { fireEvent.compositionEnd(ta, { data: 'word' }); });
    expect(view.baseElement.querySelector('.term-wrap-ime'), 'the preview outlived its composition').toBeNull();
  });

  it('offers the grid after 2 s with no ❯, clears the offer when one arrives, and sends nothing for it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    glass.width = 390;
    const t = fakeTerm();
    const { view, ws } = mount(t);
    const offer = (): HTMLElement | null => screen.queryByRole('button', { name: /shows no Claude Code prompt/ });

    await t.paint(screenNamed('not-claude').stream);
    expect(offer(), 'the offer came before two seconds').toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(NOT_CLAUDE_MS); });
    expect(offer(), 'two seconds without ❯ and no offer of the grid').not.toBeNull();

    await t.paint(screenNamed('busy').stream);
    expect(offer(), 'a ❯ arrived and the offer stayed').toBeNull();

    await t.paint(screenNamed('not-claude').stream);
    await act(async () => { await vi.advanceTimersByTimeAsync(NOT_CLAUDE_MS); });
    fireEvent.click(offer()!);
    expect(wrapOf(view), 'the offer did not show the grid').toBeNull();
    expect(ws.frames(), 'the chip sent the session something').toEqual([]);
  });

  it('a reply quoting a numbered list is still Claude Code: no offer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    glass.width = 390;
    const t = fakeTerm();
    mount(t);
    await t.paint(screenNamed('numbered-reply').stream);
    await act(async () => { await vi.advanceTimersByTimeAsync(NOT_CLAUDE_MS * 2); });
    expect(screen.queryByRole('button', { name: /shows no Claude Code prompt/ })).toBeNull();
  });
});

describe('the not-Claude offer lasts only while the drawer is open', () => {
  const offer = (): HTMLElement | null => screen.queryByRole('button', { name: /shows no Claude Code prompt/ });
  /** Close the drawer and open it again: a new attach, a new terminal. */
  const reopen = (view: ReturnType<typeof render>, t: ReturnType<typeof fakeTerm>, store: StorageLike): FakeSocket => {
    const el = (open: boolean) => (
      <TerminalDrawer id={ID} open={open} onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} viewStorage={() => store} />
    );
    view.rerender(el(false));
    view.rerender(el(true));
    const ws = FakeSocket.instances.at(-1)!;
    act(() => ws.onopen?.());
    return ws;
  };
  const takeOffer = async (t: ReturnType<typeof fakeTerm>): Promise<void> => {
    await t.paint(screenNamed('not-claude').stream);
    await act(async () => { await vi.advanceTimersByTimeAsync(NOT_CLAUDE_MS); });
    fireEvent.click(offer()!);
  };

  it('taken, closed and reopened on Claude Code, the glass chooses again, and nothing was stored', async () => {
    // MEASURED before this (the verifier's probe): the drawer stays mounted
    // per session screen, so the offer's grid outlived the close, and the next
    // open on a phone showed `grid · scrolls` over Claude Code with nothing
    // stored to explain it.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    glass.width = 390;
    const store = memStore();
    const t = fakeTerm();
    const { view } = mount(t, () => store);
    await takeOffer(t);
    expect(wrapOf(view), 'the offer did not show the grid').toBeNull();

    reopen(view, t, store);
    await t.paint(screenNamed('busy').stream);
    expect(wrapOf(view), 'the offer outlived the drawer it was taken in').not.toBeNull();
    expect(viewChipEl()).toHaveTextContent(/^wrapped/);
    expect(store.map.has(VIEW_OVERRIDE_KEY), 'the offer was stored as the device\'s choice').toBe(false);
  });

  it('a chip flip after the offer is the device\'s own choice, and that one survives the close', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    glass.width = 390;
    const store = memStore();
    const t = fakeTerm();
    const { view } = mount(t, () => store);
    await takeOffer(t);
    fireEvent.click(viewChipEl());   // grid → wrapped: the glass's own view, so no override
    fireEvent.click(viewChipEl());   // wrapped → grid: the device's choice, stored
    expect(store.map.get(VIEW_OVERRIDE_KEY)).toBe('grid');

    reopen(view, t, store);
    expect(wrapOf(view), 'closing threw away a choice the reader made with the chip').toBeNull();
    expect(viewChipEl()).toHaveTextContent(/^grid/);
  });

  it('a device that has its own override gets it back when the drawer closes, not the glass\'s choice', async () => {
    // The cases above start with nothing stored, so "put back what the offer
    // stood in for" and "put back no override" read the same there. Here the
    // two differ: a glass the grid fits (1546px), held to the wrapped view by
    // the device's stored choice. The offer takes the grid for this drawer
    // only; when it closes, the device's own `wrapped` must come back. With no
    // override put back, the glass would choose the grid against the reader's
    // stored choice, and the store would still say `wrapped`.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    glass.width = 1546;
    const store = memStore();
    store.map.set(VIEW_OVERRIDE_KEY, 'wrapped');
    const t = fakeTerm();
    const { view } = mount(t, () => store);
    expect(wrapOf(view), 'the stored override did not hold a grid-wide glass to the wrapped view').not.toBeNull();
    await takeOffer(t);
    expect(wrapOf(view), 'the offer did not show the grid').toBeNull();

    reopen(view, t, store);
    await t.paint(screenNamed('busy').stream);
    expect(wrapOf(view), 'closing put back no override: the glass chose the grid over the device\'s own choice')
      .not.toBeNull();
    expect(viewChipEl()).toHaveTextContent(/^wrapped/);
    expect(store.map.get(VIEW_OVERRIDE_KEY), 'the offer touched the stored choice').toBe('wrapped');
  });
});

describe('P4: a physical Escape goes to Claude Code while the terminal has focus', () => {
  const escape = (el: Element): void => {
    act(() => { fireEvent.keyDown(el, { key: 'Escape', code: 'Escape', keyCode: 27 }); });
  };

  it.each(['wrapped', 'grid'] as const)('in the %s view: \\e once, and the drawer stays open', (v) => {
    const store = memStore();
    store.map.set(VIEW_OVERRIDE_KEY, v);
    const onClose = vi.fn();
    render(
      <TerminalDrawer id={ID} open onClose={onClose} makeSocket={makeSocket} viewStorage={() => store} />,
    );
    const ws = FakeSocket.instances.at(-1)!;
    act(() => ws.onopen?.());
    const ta = (made.terms.at(-1) as XTerm).textarea!;
    act(() => ta.focus());
    expect(document.activeElement).toBe(ta);

    escape(ta);
    expect(onClose, 'Escape typed into the terminal closed the drawer').not.toHaveBeenCalled();
    expect(ws.frames(), 'Escape did not reach the session, once').toEqual([{ type: 'input', data: '\x1b' }]);
  });

  it('with focus on another control in the sheet, Escape closes it, once', () => {
    glass.width = 390;
    const t = fakeTerm();
    const onClose = vi.fn();
    const { ws } = mount(t, undefined, onClose);
    const chip = viewChipEl();
    act(() => chip.focus());
    expect(document.activeElement).toBe(chip);
    escape(chip);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ws.frames()).toEqual([]);
  });

  it('with focus in the history layer\'s own terminal, which is not the live one, Escape closes the drawer', async () => {
    // The clause: Escape stays in the drawer only while the focused textarea
    // is the LIVE terminal's, inside its host. The history layer is a second
    // xterm laid over the glass, outside that host; it sends nothing to the
    // session, so an Escape there is a reader leaving, as anywhere else.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: true, text: 'older output\nolder still\n', lines: 2000 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    try {
      const store = memStore();
      store.map.set(VIEW_OVERRIDE_KEY, 'grid');
      const onClose = vi.fn();
      render(<TerminalDrawer id={ID} open onClose={onClose} makeSocket={makeSocket} viewStorage={() => store} />);
      const ws = FakeSocket.instances.at(-1)!;
      act(() => ws.onopen?.());
      fireEvent.click(screen.getByRole('button', { name: 'Scroll back' }));
      const histTa = await waitFor(() => {
        const el = document.querySelector<HTMLTextAreaElement>('.term-history textarea');
        if (el === null) throw new Error('the history layer has no terminal yet');
        return el;
      });
      const liveHost = document.querySelector('.term-screen > .term-host')!;
      expect(liveHost.contains(histTa), 'the history terminal is inside the live host').toBe(false);
      act(() => histTa.focus());
      expect(document.activeElement).toBe(histTa);
      escape(histTa);
      expect(onClose, 'Escape in the history layer was kept as if it were the live terminal\'s').toHaveBeenCalledTimes(1);
      expect(ws.frames()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a sheet without the prop dismisses on Escape as it always has', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="t"><button type="button">inside</button></Sheet>);
    const inside = screen.getByRole('button', { name: 'inside' });
    act(() => inside.focus());
    escape(inside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
