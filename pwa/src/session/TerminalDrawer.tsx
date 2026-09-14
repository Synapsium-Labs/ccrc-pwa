// Terminal drawer — the app's basement (DIRECTION). A full-height Sheet cut
// from --bg-well (the drawer keeps its dark glass in BOTH themes) holding a
// real xterm attached to the session's tmux window over `/ws/pty/:id`. Raw
// utf8 frames stream into term.write; keystrokes — and the mobile quick-key
// bar's control sequences — flow back as {type:'input'} frames; the fit on
// open dials the measured cols/rows into the URL and later refits ride
// {type:'resize'}. Closing the drawer closes the socket, after which the
// server restores the session's canonical tmux window size.
//
// THE WHEEL IS NOT PART OF THAT CONVERSATION. tmux attaches this client on the
// alternate screen, where xterm has no scrollback and turns a wheel notch into
// arrow keys aimed at the pane — so the wheel is swallowed here and scrolls the
// pane's own history instead, read over `GET /api/sessions/:id/pane/history`
// (tmux `capture-pane`, which mutates nothing on the box).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Sheet } from '../components/Sheet';
import { api, ApiError } from '../lib/api';
import { checkAuth, onAuthRegained } from '../lib/auth';
import { useKeyboardInset } from '../lib/keyboard';
import { wsUrl } from '../lib/ws';
import './chat.css';

/** The slice of xterm the drawer drives — injectable so tests can script it. */
export interface DrawerTerm {
  write(data: string): void;
  onData(cb: (data: string) => void): void;
  /** Install the wheel handler. `false` means "xterm must not process this" —
   *  the return value xterm's own `attachCustomWheelEventHandler` takes. */
  onWheel(cb: (ev: WheelEvent) => boolean): void;
  /** Fit the grid to the host element; returns the measured cols/rows. */
  fit(): { cols: number; rows: number };
  focus(): void;
  dispose(): void;
}
export type MakeTerm = (host: HTMLElement) => DrawerTerm;

/** The history view's terminal: written once, never typed into. Separate from
 *  `DrawerTerm` because it is a different job — it has no pty behind it, and
 *  it is the one of the two that HAS scrollback (the live one is on tmux's
 *  alternate screen, where xterm keeps none). */
export interface HistoryTerm {
  /** `done` fires when the data is PARSED, not merely queued — xterm's own
   *  `write(data, cb)` contract. The opening scroll has to wait for it: a
   *  `scrollLines` against a buffer that has not grown yet moves nothing, and
   *  the reader is then sitting at the bottom with the bottom latch unarmed. */
  write(data: string, done?: () => void): void;
  fit(): { cols: number; rows: number };
  /** One row's height in CSS pixels, or 0 when it cannot be measured yet — the
   *  drag needs it to turn a finger's travel into lines, and 0 means "do not
   *  guess", not "zero". */
  rowHeight(): number;
  /** Scroll the view; negative is up, in lines. */
  scrollLines(amount: number): void;
  /**
   * Shift the rendered rows by a SUB-ROW amount, in CSS pixels, positive
   * downward — the fraction of a row that `scrollLines` cannot express.
   *
   * A terminal scrolls in whole rows, and at speed that is invisible: at
   * 4 px/ms a row goes past every four milliseconds. It stops being invisible
   * exactly where a throw ends, because the time between whole-row steps is
   * the row height divided by the speed — so as the glide decays the steps
   * spread out, the last ones arrive hundreds of milliseconds apart, and the
   * final one is the longest of all. That is the stutter, and no amount of
   * tuning the curve removes it: it is the quantum, not the speed.
   *
   * So the remainder is rendered rather than merely remembered. Optional on
   * the interface because a terminal that cannot offer it still scrolls
   * correctly — it just scrolls in steps.
   */
  offset?(px: number): void;
  /** Called when the reader, having scrolled up, comes back down to the newest
   *  line — the gesture that means "I'm done with the history". NOT called for
   *  the arrival at the bottom that writing the history itself causes. */
  onBottom(cb: () => void): void;
  dispose(): void;
}
/** What the server measured about the pane this history came out of — the two
 *  numbers the reader needs to size its own buffer. Absent when the probe was
 *  not `ok`, and absent is not zero. */
export interface HistoryPane {
  history: number;
  width: number;
}

/**
 * HOW MANY ROWS THE READER MUST BE ABLE TO HOLD.
 *
 * `capture-pane -J` returns LOGICAL lines, and the reader re-wraps each of them
 * at its own width: a line stored at `pane.width` columns becomes at most
 * `ceil(pane.width / cols)` rows here. `-S -N` also returns the visible screen
 * along with the history above it, so the screen's own rows are added (F13's
 * shape, one layer up: the screen counts).
 *
 * `lines * 3` was the old rule and it was derived from ONE pane at 220 columns
 * read on ONE phone. The fleet census of 2026-09-14 holds a 302-column window,
 * where a 43-column reader needs 8 rows per stored line — and xterm answers an
 * under-provisioned scrollback by silently dropping the oldest history, which
 * is the half of the read the reader scrolled up for.
 *
 * AND THE WIDTH THIS DIVIDES BY IS THE READER'S, NOT THE PANE'S HELD STILL.
 * The comment this replaces claimed the factor was safe because a stored line
 * keeps the width it was written at — that tmux leaves it alone across a
 * resize. That is FALSE and F1 measured it false on a private tmux 3.4 socket:
 * `resize-window -x 43` on a 220-column pane holding 1853 stored lines took
 * `history_size` to 9460, and at `history-limit 2000` the next output shed the
 * overflow permanently. What actually holds the pane's width still is the
 * server's own pin at the canonical grid before any client attaches
 * (`GET /ws/pty/:id`, spec §5.1) — not tmux's good manners. This arithmetic is
 * about the READER re-wrapping a logical line at its own width, which is a
 * different question and stays true either way.
 *
 * PURE, and exported for its own tests: jsdom cannot measure a row, so the
 * arithmetic is what can be held still.
 */
export function historyScrollback(
  lines: number,
  cols: number,
  rows: number,
  pane?: HistoryPane,
): number {
  if (pane === undefined) return lines * 3;
  const wrap = cols > 0 ? Math.max(1, Math.ceil(pane.width / cols)) : 1;
  return pane.history * wrap + rows;
}

/**
 * WHY THERE IS NO HISTORY, as a sentence rather than as a wire token.
 *
 * The route answers three distinct failures and PR #96 rendered all three raw —
 * `no history · gone`, `· unmeasured`, `· unreachable` — on the one layer whose
 * entire job is to explain a missing history. `detail` was discarded outright,
 * which is the half that says WHICH tmux refusal it was.
 *
 * Anything that is not one of the three tokens is already a sentence (the two
 * MEASURED-empty reasons the success path writes) and is returned untouched, so
 * this never has to know about them.
 */
export function historyFailureSentence(error: string, detail?: string): string {
  if (error === 'gone') return 'this session is gone — there is no pane to read';
  if (error === 'unreachable') return 'could not reach the box to read this pane';
  if (error === 'bad-session-id') return 'that is not a session id this box will read';
  if (error === 'unmeasured') {
    return detail !== undefined && detail !== ''
      ? `could not read this pane — ${detail}`
      : 'could not read this pane';
  }
  // ALREADY A SENTENCE, OR A TOKEN NOBODY TAUGHT THIS FUNCTION — and it cannot
  // tell them apart, so it decides by SHAPE rather than by hope. The success
  // path writes real sentences here ("nothing has scrolled off this pane yet"),
  // and every wire token in `PaneHistoryReply['error']` is a single lower-case
  // hyphenated word. Returning an unhandled token raw is how `bad-session-id`
  // reached the glass as `no history · bad-session-id` — a declared member of
  // the union with no branch, reachable from a hand-typed URL.
  return /^[a-z][a-z0-9-]*$/.test(error)
    ? `could not read this pane — the box answered ${error}`
    : error;
}

export type MakeHistoryTerm = (host: HTMLElement, lines: number, pane?: HistoryPane) => HistoryTerm;

/** A token's resolved value at attach time — xterm paints to canvas and
 *  cannot read CSS custom properties itself. `undefined` (token missing)
 *  falls back to xterm's own default rather than hardcoding a color here. */
const tokenValue = (name: string): string | undefined => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v === '' ? undefined : v;
};

/** Voice and glass from the tokens: the mono face, well background, on-well
 *  ink, phosphor cursor. --bg-well stays dark under [data-theme='light'], so
 *  the terminal is dark regardless of theme. 14px is the plan-fixed terminal
 *  size (xterm takes a number). Spelled once, worn by both terminals — the
 *  live one and the history one have to read as the same glass or scrolling
 *  back would look like leaving the session. */
const glass = () => ({
  fontFamily: tokenValue('--font-mono') ?? 'monospace',
  fontSize: 14,
  theme: {
    background: tokenValue('--bg-well'),
    foreground: tokenValue('--ink-on-well'),
    cursor: tokenValue('--accent'),
    cursorAccent: tokenValue('--bg-well'),
    // On-brand ANSI palette (Phosphor & Ink) so 16-colour content reads
    // cohesively. 256/truecolor content bypasses this and paints direct —
    // Claude emits truecolor once COLORTERM+tmux RGB are in place (ccd spawn).
    black: '#1B1F1D', red: '#F08A78', green: '#57E08B', yellow: '#F2B84B',
    blue: '#96B4F4', magenta: '#C7A7F4', cyan: '#6FD6EA', white: '#ADB6AE',
    brightBlack: '#5A635C', brightRed: '#FF9E8A', brightGreen: '#7BEDA6',
    brightYellow: '#FFD27A', brightBlue: '#B3C8FF', brightMagenta: '#DDC2FF',
    brightCyan: '#93E6F5', brightWhite: '#EDF1EE',
  },
});

/**
 * THE ROWS AND THE PIXELS DO NOT LAND TOGETHER, and this is what holds them
 * together anyway.
 *
 * The drag moves the history two ways at once: whole rows through
 * `scrollLines`, and the leftover fraction of a row through a transform. The
 * transform is a style write and is on the glass at the next paint; the rows
 * are not. xterm's `scrollLines` updates the buffer and then asks its render
 * debouncer for a repaint, which it schedules with its OWN
 * `requestAnimationFrame` — and a frame callback registered from inside a
 * frame callback runs in the NEXT frame. So on the step that crosses a row
 * boundary, the transform snaps back by a row while the rows it was standing
 * in for are still one frame away.
 *
 * At speed that is invisible: a dozen rows go past per frame and a one-row
 * error is a fraction of the motion. As a throw decelerates it becomes the
 * whole motion, and the rows shake — which is exactly where the operator saw
 * it ("під час замедлення строки скачуть вверх-вниз").
 *
 * So the transform stands in for the rows until they are actually painted.
 * `scrolled` records a displacement asked for and not yet seen, `painted`
 * clears it on xterm's own `onRender`, and the invariant across all of it is
 * one line: what is on the glass — painted rows plus transform — is always
 * exactly what was asked for. Exported for its own tests, because that
 * invariant is the whole of the fix and jsdom cannot see a pixel.
 */
export interface PaintLag {
  /** The terminal scrolled — `rows` is the displacement the VIEWPORT actually
   *  made, and `rowPx` the row height at that moment.
   *
   *  MEASURED, NOT REQUESTED, and that distinction is the whole of one fix:
   *  xterm CLAMPS `scrollLines` at both ends of the buffer, so a throw that
   *  reaches the oldest line goes on asking for rows for the rest of its curve.
   *  Crediting the ASK made the transform stand in for a displacement the rows
   *  were never going to make, and the view slid and snapped back for the whole
   *  tail of the throw. The call site reads `term.buffer.active.viewportY`
   *  either side of the scroll and hands the difference here.
   *
   *  The sign lives HERE rather than at the call site: a viewport moving toward
   *  OLDER output is a negative `viewportY` delta and the content moves DOWN,
   *  so a helper that took "px, downward" would put that flip in an adapter no
   *  test can reach. */
  scrolled(rows: number, rowPx: number): void;
  /** The sub-row remainder the drag wants shown, positive downward. */
  sub(px: number): void;
  /** xterm says the rows are on the glass. */
  painted(): void;
  /** What the transform must be right now. */
  transform(): number;
}
export function paintLag(): PaintLag {
  let pending = 0;
  let subPx = 0;
  return {
    scrolled: (rows, rowPx) => { pending += -rows * rowPx; },
    sub: (px) => { subPx = px; },
    painted: () => { pending = 0; },
    transform: () => subPx + pending,
  };
}

/** `fit()` over a FitAddon, with the one failure both terminals share. */
const fitter = (term: Terminal, fit: FitAddon) => () => {
  try {
    fit.fit();
  } catch {
    /* host not measurable yet — keep the current grid */
  }
  return { cols: term.cols, rows: term.rows };
};

const defaultMakeTerm: MakeTerm = (host) => {
  const term = new Terminal({
    ...glass(),
    cursorBlink: true,
    // INERT ON THIS TERMINAL, and kept for the one case where it is not:
    // `tmux attach` puts the client on the ALTERNATE screen (every attach
    // begins ESC[?1049h, measured off a real pty), and xterm keeps no
    // scrollback there. The history the reader wants is tmux's, not this
    // buffer's — see `openHistory`.
    scrollback: 4000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  return {
    write: (d) => term.write(d),
    onData: (cb) => {
      term.onData(cb);
    },
    onWheel: (cb) => term.attachCustomWheelEventHandler(cb),
    fit: fitter(term, fit),
    focus: () => term.focus(),
    dispose: () => term.dispose(),
  };
};

/** The history terminal: the same glass, no cursor, no keyboard, and a real
 *  scrollback — this one is in the NORMAL buffer, so the wheel scrolls it and a
 *  touch-drag scrolls it, exactly as a console does. */
export const defaultMakeHistoryTerm: MakeHistoryTerm = (host, lines, pane) => {
  const term = new Terminal({
    ...glass(),
    cursorBlink: false,
    disableStdin: true,
    // ZERO, EXPLICITLY, because a measurement leans on it: the call site below
    // reads `viewportY` either side of `scrollLines`, and a smooth scroll would
    // not have arrived when the second read happens. xterm's own default is
    // already 0; saying it here keeps a future default change from silently
    // un-synchronising the read. This terminal is dragged and thrown by hand at
    // 60 Hz and wants none of xterm's easing either way.
    smoothScrollDuration: 0,
    // A FIRST GUESS, replaced by a measurement below. xterm needs some
    // scrollback at construction and `term.cols` does not exist until the addon
    // has fitted against a mounted host, so the real number is set once both
    // facts are in hand. See `historyScrollback` for what it means, and for the
    // reflow claim the comment this replaces got wrong.
    scrollback: lines * 3,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  const fitTo = fitter(term, fit);
  /** Fit, then re-derive the buffer at the width that fit produced — so a
   *  rotation re-sizes the scrollback as well as the grid. */
  const sized = (): { cols: number; rows: number } => {
    const grid = fitTo();
    term.options.scrollback = historyScrollback(lines, grid.cols, grid.rows, pane);
    return grid;
  };
  sized();
  const cellHeight = (): number => {
    const screen = host.querySelector('.xterm-screen');
    const px = screen === null ? 0 : screen.getBoundingClientRect().height;
    return px > 0 && term.rows > 0 ? px / term.rows : 0;
  };
  const lag = paintLag();
  const paint = (): void => {
    const el = host.querySelector('.xterm');
    if (!(el instanceof HTMLElement)) return;
    const px = lag.transform();
    el.style.transform = px === 0 ? '' : `translateY(${px}px)`;
  };
  // xterm's own word for "the rows are on the glass". Until it comes, the
  // transform is carrying them — see `paintLag`.
  term.onRender(() => {
    lag.painted();
    paint();
  });
  return {
    write: (d, done) => term.write(d, done),
    fit: sized,
    // THE ROW HEIGHT, BY IDENTITY RATHER THAN BY ESTIMATE. The DOM renderer
    // sets `.xterm-screen`'s height to `css.cell.height * rows` exactly, so
    // dividing it back out IS xterm's own cell height — no private API, and no
    // reliance on the HOST's height, which `rows` was floored from and which
    // therefore over-states a row by up to a whole cell. `getBoundingClientRect`
    // rather than `clientHeight` so the answer is in the same visual pixels a
    // PointerEvent's `clientY` speaks, under whatever transform the sheet has
    // the panel in mid-animation.
    rowHeight: cellHeight,
    // The TERMINAL element, not the host: `.term-host` is the one with
    // `overflow: hidden`, so it is what must stay put and clip while its child
    // slides. A transform is cosmetic to xterm — it lays its rows out inside
    // this element and never measures against the page — and it costs a
    // compositor layer rather than a relayout, which is what a per-frame shift
    // beside a repainting terminal needs.
    scrollLines: (n) => {
      // ROW HEIGHT FIRST: after the scroll the buffer has moved, and this
      // reads the rendered cell, which must be the one the rows were standing
      // at when they were asked to move.
      const px = cellHeight();
      // AND THE DISPLACEMENT IS MEASURED, NOT ASSUMED. xterm clamps at both
      // ends of the buffer, so `n` is a REQUEST and `viewportY`'s delta is the
      // answer — see `PaintLag.scrolled`. NOTE FOR ANYONE TESTING THIS:
      // `viewportY` does not move under jsdom at all (measured — 60 lines
      // written, rows 24, baseY 37, viewportY 37 before, after, and 50 ms
      // later), because jsdom has no layout and xterm's scroll is a virtual
      // re-render off it. So the guard on this line is a source scan in
      // `terminal-scrollback.test.tsx` — it can see that this call site reads
      // the viewport either side, not that it computes the right number.
      //
      // THE NUMBER IS PINNED TOO, against a FAKE Terminal that clamps the way
      // xterm clamps: `history-term-viewport.test.tsx` (spec §11 ruling 11). An
      // earlier version of this comment said a behavioural proof was "its own
      // work" and still to come; it arrived in this same branch. Crediting `n`
      // reds three of its four cases, crediting a constant reds two, and the
      // partially-clamped case — asked for 10, moved 2 — reds either way.
      const before = term.buffer.active.viewportY;
      term.scrollLines(n);
      lag.scrolled(term.buffer.active.viewportY - before, px);
      paint();
    },
    offset: (px) => {
      lag.sub(px);
      paint();
    },
    onBottom: (cb) => {
      // LATCHED, and that is the whole of it: writing the history scrolls the
      // view to the newest line, which is a bottom arrival nobody asked for.
      // Only a reader who has been AWAY from the bottom can come back to it.
      let away = false;
      term.onScroll(() => {
        const b = term.buffer.active;
        if (b.viewportY < b.baseY) away = true;
        else if (away) cb();
      });
    },
    dispose: () => term.dispose(),
  };
};

// The phone keyboard's missing keys, with the exact control sequences a tmux
// pane expects: Esc \x1b · arrows CSI A/B/D/C · Tab \t · Shift+Tab CSI Z ·
// Enter \r. Legends are mono keycaps (DIRECTION); labels name them for AT.
const QUICK_KEYS: { legend: string; label: string; seq: string }[] = [
  { legend: 'esc', label: 'Escape', seq: '\x1b' },
  { legend: '↑', label: 'Arrow up', seq: '\x1b[A' },
  { legend: '↓', label: 'Arrow down', seq: '\x1b[B' },
  { legend: '←', label: 'Arrow left', seq: '\x1b[D' },
  { legend: '→', label: 'Arrow right', seq: '\x1b[C' },
  { legend: 'tab', label: 'Tab', seq: '\t' },
  { legend: '⇧tab', label: 'Shift Tab', seq: '\x1b[Z' },
  { legend: '⏎', label: 'Enter', seq: '\r' },
];

/** Lines one wheel notch moves — xterm's own default step, and the amount the
 *  history view opens by so the gesture reads as a scroll rather than a jump. */
/** How far a finger must travel DOWN the live glass before it counts as a
 *  reach for the history, in CSS pixels. About a row and a half: smaller reads
 *  as a tap that moved, and the reader gets a history they did not ask for. */
const TOUCH_OPEN_PX = 24;
const WHEEL_LINES = 3;

/* — the throw, which a console on a phone is expected to have —
 *
 * A drag that stops dead the instant the finger lifts does not read as
 * scrolling; every list on the device keeps moving and slows down. The history
 * is not a native scroller (xterm's viewport is an empty leftover and the real
 * scroll is a virtual re-render), so the deceleration has to be written here
 * too. These are the four numbers it takes, in CSS pixels and milliseconds.
 */
/** A flick, not a placement: the least speed that keeps the history moving
 *  after the finger has gone. Below it the reader was positioning the view. */
const FLING_MIN_PX_MS = 0.25;
/** A finger that rested this long before lifting is placing the view, not
 *  throwing it — so the speed it had before the pause is not its speed now. */
const FLING_IDLE_MS = 80;
/** How much of the newest sample the smoothed speed takes. Raw per-move speed
 *  is far too noisy on a phone: one 2 ms gap between moves turns an ordinary
 *  drag into a fling. */
const FLING_SMOOTH = 0.35;
/** What is left of the speed one 60 Hz frame later — the decay, expressed per
 *  frame and applied per elapsed millisecond so a slow frame does not slow the
 *  glide down with it. */
const GLIDE_DECAY = 0.95;
/** Below this there is nothing left to SHOW — half a pixel per 60 Hz frame.
 *  Stated in pixels rather than in rows on purpose: since the remainder is
 *  rendered (`HistoryTerm.offset`), the end of a throw is a sub-pixel creep
 *  rather than a row waiting to drop, and the question the threshold answers
 *  is "can the eye still see this move", not "is another step coming". */
const GLIDE_STOP_PX_MS = 0.5 / (1000 / 60);
const FRAME_MS = 1000 / 60;
/** The longest gap a single glide frame may account for. A drawer that was
 *  backgrounded mid-throw comes back with a gap of seconds, and without this
 *  the history would jump the whole distance in one frame. */
const GLIDE_MAX_STEP_MS = 50;

type Conn = 'connecting' | 'open' | 'down';

/** Where the reader is. `live` is the attached pane; the other three are the
 *  one history read, in its three states. They are four VALUES rather than a
 *  pair of booleans because the view renders differently for each, and
 *  "reading" must not be mistakable for "there is nothing here". */
type Hist =
  | { at: 'live' }
  | { at: 'reading' }
  | { at: 'history'; text: string; lines: number; pane?: HistoryPane }
  | { at: 'empty'; why: string; detail?: string };

export interface TerminalDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  makeSocket?: (url: string) => WebSocket; // injectable for tests
  makeTerm?: MakeTerm; // injectable for tests
  makeHistoryTerm?: MakeHistoryTerm; // injectable for tests
}

export function TerminalDrawer({
  id,
  open,
  onClose,
  makeSocket,
  makeTerm,
  makeHistoryTerm,
}: TerminalDrawerProps): ReactNode {
  const [conn, setConn] = useState<Conn>('connecting');
  // Bumped by Reconnect — re-runs the attach effect for a fresh fit + dial.
  const [attempt, setAttempt] = useState(0);
  // The xterm host, held as STATE via callback ref: the sheet portals its
  // content in a later commit than this component's effects, so a plain ref
  // would still be null when the attach effect first runs. Keying the effect
  // on the host makes it run exactly when the glass exists.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [hist, setHist] = useState<Hist>({ at: 'live' });
  const [histHost, setHistHost] = useState<HTMLElement | null>(null);
  const connRef = useRef<Conn>('connecting');
  const sockRef = useRef<WebSocket | null>(null);
  const termRef = useRef<DrawerTerm | null>(null);
  const gridRef = useRef({ cols: 80, rows: 24 });
  const refitRef = useRef<(() => void) | null>(null);
  const histRef = useRef<Hist>({ at: 'live' });
  /** WHICH READ, not merely "a read is running". `reading` is a state and two
   *  reads share it: a reader who leaves the history and opens it again has two
   *  requests in flight, and the old guard admitted whichever RESOLVED last —
   *  painting a history captured before they left. A number that only ever goes
   *  up gives each response an identity to be checked against. */
  const reqRef = useRef(0);
  const kbInset = useKeyboardInset({ active: open });
  /** Live, or one of the three history states — the only distinction the key
   *  bar's door and its legend turn on. */
  const atLive = hist.at === 'live';

  const goHist = (next: Hist): void => {
    histRef.current = next;
    setHist(next);
  };

  /**
   * The one place the pane's history is read. Idempotent while a read is in
   * flight or a history is already up, so a flick of the wheel is ONE request.
   *
   * It is a READ — `capture-pane` on the server — and never a keystroke: the
   * pane is left exactly as it was found, which is what lets a second client
   * (the operator's own terminal on the box) go on using the session while a
   * phone scrolls back through it.
   */
  const openHistory = (): void => {
    if (histRef.current.at !== 'live') return;
    reqRef.current += 1;
    const req = reqRef.current;
    goHist({ at: 'reading' });
    void api.paneHistory(id).then(
      (r) => {
        // THE ANSWER HAS TO BE THE ONE THAT WAS ASKED FOR. The state check
        // stays — a reader who typed their way back to live wants no layer at
        // all — and the identity check is what keeps a stale answer from
        // standing in for a newer one.
        if (req !== reqRef.current || histRef.current.at !== 'reading') return;
        // NOTHING ABOVE THE SCREEN IS NOT A HISTORY. `capture-pane` answers
        // with the visible screen even when no line has ever scrolled off, so
        // a successful read alone would put up a second copy of what the
        // reader is already looking at — with an empty scrollbar on it and a
        // wheel that moves nothing. Measured on this fleet: four of ten live
        // panes hold no scrollback at all.
        //
        // The COUNT decides, never the screen the pane is on: a pane on the
        // alternate screen keeps the scrollback it already had (measured on a
        // private socket — 453 stored lines still captured at
        // `alternate_on=1`), so refusing on that flag would hide a real
        // history behind a full-screen app. The flag only says a zero will
        // stay zero while the app is up.
        //
        // `=== 0` and not `!r.scrollback`: an older server omits the field and
        // an unmeasurable pane sends nothing, and neither is a zero. Both keep
        // the behaviour this drawer shipped with.
        if (r.scrollback === 0) {
          goHist({
            at: 'empty',
            why: r.alternate === true
              ? 'a full-screen app is up — nothing scrolls off while it is'
              : 'nothing has scrolled off this pane yet',
          });
          return;
        }
        // ABSENT IS NOT ZERO, one last time: only a probe that answered `ok`
        // gives the reader two numbers to size itself by, and an older server
        // or an unmeasurable pane leaves it on the `lines * 3` fallback that
        // shipped before either field existed.
        const pane = typeof r.scrollback === 'number' && typeof r.width === 'number'
          ? { history: r.scrollback, width: r.width }
          : undefined;
        goHist({ at: 'history', text: r.text, lines: r.lines, pane });
      },
      (e: unknown) => {
        if (req !== reqRef.current) return;
        // WHY, not just "failed": a dead pane, a tmux that could not answer and
        // an unreachable box are three different facts to the reader, and the
        // server already told them apart. `ApiError.body` carries the route's
        // own word for it AND, for a 502, the tmux message underneath.
        const body = e instanceof ApiError ? (e.body as { error?: unknown; detail?: unknown }) : null;
        const why = typeof body?.error === 'string' ? body.error : 'unreachable';
        const detail = typeof body?.detail === 'string' ? body.detail : undefined;
        if (histRef.current.at === 'reading') goHist({ at: 'empty', why, detail });
      },
    );
  };

  // Frames are inert until the socket reports open — quick keys pressed
  // during attach are dropped, never queued blind into a dead pipe.
  const sendFrame = (
    frame: { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number },
  ): void => {
    const ws = sockRef.current;
    if (!ws || connRef.current !== 'open') return;
    ws.send(JSON.stringify(frame));
  };

  /** A keystroke — from the keyboard or from the quick-key bar. It RETURNS TO
   *  LIVE first, the way a console jumps to the bottom when you type: the keys
   *  reach the session either way, and watching them land is the whole reason
   *  to type. The resize frame deliberately does not go through here — a
   *  rotation is not a keystroke and must not throw away the history. */
  const typed = (data: string): void => {
    if (histRef.current.at !== 'live') goHist({ at: 'live' });
    sendFrame({ type: 'input', data });
  };

  useEffect(() => {
    if (!open || host === null) return undefined;

    const setState = (s: Conn): void => {
      connRef.current = s;
      setConn(s);
    };
    setState('connecting');

    const term = (makeTerm ?? defaultMakeTerm)(host);
    termRef.current = term;
    gridRef.current = term.fit(); // fit-on-open → measured grid rides the URL

    const make = makeSocket ?? ((u: string) => new WebSocket(u));
    const { cols, rows } = gridRef.current;
    const ws = make(wsUrl(`/ws/pty/${encodeURIComponent(id)}?cols=${cols}&rows=${rows}`));
    sockRef.current = ws;

    // The SECOND websocket path, and it needs the same treatment as
    // `ReconnectingSocket` (lib/ws.ts's AuthGate) for the same reason: a refused
    // upgrade is a bare 401 the browser never shows us, so an attach that dies
    // without ever opening might be a gate rather than a network. Un-asked, this
    // drawer would sit on "connection lost" behind a Reconnect button that can
    // never work and never says why.
    //
    // No reconnect ladder here to stand still — the drawer retries only when
    // tapped — so the two halves are: ASK on a failed attach, and re-attach by
    // itself when the operator is back in (the `attempt` bump the Reconnect
    // button already uses).
    // `asked` because a browser fires `onerror` AND `onclose` for one dead
    // handshake, and `ReconnectingSocket`'s socket-identity guard — which makes
    // its own probe once-per-attempt — has no equivalent here.
    let opened = false;
    let asked = false;
    const down = (): void => {
      setState('down');
      if (opened || asked) return;
      asked = true;
      checkAuth();
    };

    ws.onopen = () => {
      opened = true;
      setState('open');
      term.focus();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') term.write(ev.data); // raw utf8 frames
    };
    ws.onclose = down;
    ws.onerror = down;
    // ONLY when this socket is not already carrying the session (review F2).
    // The gate runs at UPGRADE time, so an open pty survives an auth-lost
    // episode raised anywhere else — a REST 401, or the fleet socket's own
    // probe. Unconditionally bumping `attempt` would close a live terminal and
    // re-attach it for nothing the moment the operator signed back in, and the
    // server restores the session's canonical tmux window size on the way past,
    // so the reader would watch their pane resize for no reason. This is
    // `ReconnectingSocket.nudge()`'s own early return (`ws.ts`: inert unless
    // started AND down), which the two paths were asymmetric on.
    const unsubAuth = onAuthRegained(() => {
      if (connRef.current !== 'open') setAttempt((a) => a + 1);
    });

    term.onData(typed);

    // THE WHEEL IS NOT AN ARROW KEY. `tmux attach` puts this client on the
    // ALTERNATE screen (every attach starts ESC[?1049h, measured off a real
    // pty) and turns on application cursor keys; in that buffer xterm has no
    // scrollback, so it translates a wheel notch into Up/Down and sends them to
    // the pane. Measured through this very drawer: one notch each way put
    // {"type":"input","data":"\u001bOA"} and "\u001bOB" on the socket — which
    // is Claude Code's prompt history paging and its agent blocks stepping,
    // from a scroll gesture. Returning false is xterm's own "do not process
    // this", and it is the only thing standing between the wheel and the pane:
    // delete this and `terminal-scrollback.test.tsx` measures the two arrows
    // again.
    //
    // Scrolling UP asks for the console history instead. Scrolling down while
    // live has nothing to do — the pane's newest line is already on screen.
    term.onWheel((ev) => {
      // A PINCH IS NOT A SCROLL. A trackpad pinch reaches the page as a `wheel`
      // event with `ctrlKey` set — there is no separate event for it, which is
      // why xterm's own `attachCustomWheelEventHandler` docs use this very case
      // as their example. Reading `deltaY` alone turned a zoom-in into a
      // request to the box and a second terminal over the reader's live pane.
      //
      // It still returns `false`: the modifier decides whether to READ, never
      // whether xterm may process the event. Handing a pinch back to xterm in
      // the alternate buffer would put arrow keys on the pty, which is the
      // whole defect this handler exists to stop.
      if (!ev.ctrlKey && ev.deltaY < 0) openHistory();
      return false;
    });

    /**
     * THE DOOR A FINGER CAN OPEN. A phone has no wheel, and on this glass there
     * is nothing to scroll anyway — tmux attaches the client on the alternate
     * screen, where xterm keeps no scrollback — so the key bar was the only way
     * in. The gesture still has one obvious meaning, and it is the wheel's:
     * reach for what is above the screen.
     *
     * NOTHING IS PREVENTED HERE. A tap must still reach xterm's textarea, so
     * the press is only watched, never claimed; the history opens on the move
     * that crosses the threshold and the pointer is left to xterm either way.
     *
     * AND IT IS WATCHED TWICE, because on the phone the pointer half cannot
     * work alone. vaul installs `preventScrollMobileSafari` while a drawer is
     * open — `document`, capture phase, `passive: false` — and it calls
     * `preventDefault()` on touchmove for any touch whose scroll parent is the
     * document, which on this glass is every touch (`.term-host` and every
     * xterm element inside it are `overflow: hidden`). Safari answers a
     * prevented touchmove by tearing down the POINTER stream for that gesture,
     * so `pointermove` never arrives and the drag that opens the history could
     * never have fired on an iPhone. It never did: measured on the operator's
     * own phone across four builds, "не реагує зовсім".
     *
     * The touch listeners are not affected by that — `preventDefault` stops
     * the default action, not the other listeners, and vaul never calls
     * `stopPropagation`. One finger is still counted once: a touch gesture
     * takes ownership for its duration and the pointer echo stands down.
     */
    let from: { x: number; y: number } | null = null;
    let openViaTouch = false;
    const reach = (x: number, y: number): void => {
      if (from === null) return;
      const dy = y - from.y;
      const dx = x - from.x;
      // DOWN, and more down than sideways: a swipe across the glass is not a
      // reach for older output, and a wobble is not a swipe. The threshold is
      // about a row and a half, which is the smallest travel that reads as
      // deliberate on a phone rather than as a tap that moved.
      if (dy < TOUCH_OPEN_PX || Math.abs(dx) > Math.abs(dy)) return;
      from = null;
      openHistory();
    };
    const openDown = (ev: PointerEvent): void => {
      if (openViaTouch) return;                           // the finger owns this
      // THE MOUSE IS SELECTING TEXT, NOT REACHING FOR HISTORY — the same
      // stand-down the history layer's own drag makes one level down, and for
      // the same reason. xterm starts a selection on mousedown and follows it
      // with a document-level mousemove; a reader dragging across the live pane
      // to copy a line got a history layer over their selection, and the
      // selection with it. The mouse loses nothing by standing down: its
      // gesture for this is the wheel, which opens the history already.
      if (ev.pointerType === 'mouse') { from = null; return; }
      if (ev.defaultPrevented) { from = null; return; }   // xterm's own scrollbar
      from = { x: ev.clientX, y: ev.clientY };
    };
    const openMove = (ev: PointerEvent): void => {
      if (openViaTouch) return;
      reach(ev.clientX, ev.clientY);
    };
    const openEnd = (): void => { if (!openViaTouch) from = null; };
    const openTouchStart = (ev: TouchEvent): void => {
      openViaTouch = true;
      if (ev.touches.length !== 1) { from = null; return; }  // a pinch, not a reach
      from = { x: ev.touches[0]!.clientX, y: ev.touches[0]!.clientY };
    };
    const openTouchMove = (ev: TouchEvent): void => {
      if (ev.touches.length !== 1) { from = null; return; }
      reach(ev.touches[0]!.clientX, ev.touches[0]!.clientY);
    };
    const openTouchEnd = (): void => { from = null; openViaTouch = false; };
    host.addEventListener('pointerdown', openDown);
    host.addEventListener('pointermove', openMove);
    host.addEventListener('pointerup', openEnd);
    host.addEventListener('pointercancel', openEnd);
    // CAPTURE for the touch pair, and it is insurance rather than a measured
    // need: xterm 6.0.0 binds no touch listener at all (measured — nothing in
    // `browser/` listens for one), but it DOES call `stopPropagation()`
    // unconditionally in its paste handler one level below this host, which is
    // how the clipboard fix was lost for a day. A listener that must not be
    // taken away belongs above the elements that could take it.
    host.addEventListener('touchstart', openTouchStart, { passive: true, capture: true });
    host.addEventListener('touchmove', openTouchMove, { passive: true, capture: true });
    host.addEventListener('touchend', openTouchEnd, { passive: true, capture: true });
    host.addEventListener('touchcancel', openTouchEnd, { passive: true, capture: true });

    // Later size changes (rotation, keyboard, desktop resize) → refit; only a
    // changed grid is worth a resize frame.
    const refit = (): void => {
      const t = termRef.current;
      if (!t) return;
      const next = t.fit();
      if (next.cols === gridRef.current.cols && next.rows === gridRef.current.rows) return;
      gridRef.current = next;
      sendFrame({ type: 'resize', cols: next.cols, rows: next.rows });
    };
    refitRef.current = refit;
    window.addEventListener('resize', refit);
    window.visualViewport?.addEventListener('resize', refit);

    return () => {
      window.removeEventListener('resize', refit);
      window.visualViewport?.removeEventListener('resize', refit);
      host.removeEventListener('pointerdown', openDown);
      host.removeEventListener('pointermove', openMove);
      host.removeEventListener('pointerup', openEnd);
      host.removeEventListener('pointercancel', openEnd);
      host.removeEventListener('touchstart', openTouchStart, true);
      host.removeEventListener('touchmove', openTouchMove, true);
      host.removeEventListener('touchend', openTouchEnd, true);
      host.removeEventListener('touchcancel', openTouchEnd, true);
      unsubAuth();
      refitRef.current = null;
      // Detach handlers first so our own close() can't echo a 'down' overlay.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      sockRef.current = null;
      try {
        ws.close(); // the server restores the canonical tmux window size
      } catch {
        /* already closed */
      }
      termRef.current = null;
      term.dispose();
      // A re-attach is a fresh pane read: a history captured before the drop
      // is a snapshot of a session that has moved on since.
      goHist({ at: 'live' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendFrame reads refs only
  }, [open, host, attempt, id, makeSocket, makeTerm]);

  // The history view, mounted only while there is a history to show. The live
  // terminal underneath it keeps its socket and keeps consuming frames, so
  // coming back to it lands on the pane's newest line, not on a stale screen.
  useEffect(() => {
    if (hist.at !== 'history' || histHost === null) return undefined;
    const term = (makeHistoryTerm ?? defaultMakeHistoryTerm)(histHost, hist.lines, hist.pane);
    // THE LATCH, AND THE READER'S OWN GESTURE IS WHY IT EXISTS. xterm's
    // `write(data, done)` parses ASYNCHRONOUSLY, so `done` can land after this
    // effect has been torn down and has called `dispose()` — and `scrollLines`
    // on a disposed Terminal throws, out of a callback nothing catches, into
    // React's commit. A blank drawer and a TypeError.
    //
    // THE TEAR-DOWN THAT ACTUALLY RACES IT is a keystroke: the history lands,
    // xterm starts parsing, and the reader types to go back to live — which is
    // the drawer's own documented way out and runs this cleanup mid-parse.
    //
    // NOT STRICTMODE, and saying so is the point of this paragraph. An earlier
    // version of this comment named StrictMode's double mount as the hazard.
    // React double-invokes an effect only on a component's INITIAL mount commit,
    // and this effect returns early until `hist` flips to 'history' — which
    // happens later, on a state change of an already-mounted component — so it
    // is never double-invoked. Measured: with the guard below deleted, a
    // StrictMode-shaped test stays GREEN. Anyone writing a test for this latch
    // should reach for the keystroke race; `terminal-scrollback.test.tsx` has it.
    //
    // A flag rather than a try/catch: swallowing the throw would also swallow a
    // real one, and what this needs to express is "the terminal this callback
    // was written for is gone", which is a fact the effect knows and the
    // callback does not.
    let alive = true;
    term.fit();
    // AND AGAIN WHENEVER THE GLASS CHANGES SHAPE. Fitted once, the history kept
    // whatever grid it was born with: a phone rotated while reading went on
    // wrapping against columns it no longer had, and the keyboard opening did
    // the same thing a softer way. The live terminal has refit on both events
    // since it shipped (`refit`, in the attach effect); this is the same pair,
    // for the layer that exists to be read.
    //
    // No grid comparison here, unlike the live one: there is no resize frame to
    // send and nothing downstream to spare, so a fit that changes nothing is
    // cheaper than the bookkeeping to avoid it.
    const refitHistory = (): void => { term.fit(); };
    window.addEventListener('resize', refitHistory);
    window.visualViewport?.addEventListener('resize', refitHistory);
    // ARMED BEFORE THE DEPARTURE IT LATCHES. `onBottom` fires only for a
    // reader who has been AWAY from the newest line, and the opening scroll
    // below is that departure. Registered after it, the latch never saw it, so
    // the first scroll DOWN read as an arrival nobody had left — and returning
    // to live cost two notches up and two back instead of one each way, which
    // is exactly what the operator measured.
    term.onBottom(() => goHist({ at: 'live' }));
    // A capture is LF-separated; a terminal needs the carriage return too, or
    // every line starts where the last one ended. Done HERE rather than with
    // xterm's `convertEol` so the bytes a `HistoryTerm` receives are the same
    // whoever implements it.
    term.write(hist.text.replace(/\r?\n/g, '\r\n'), () => {
      // One notch up, so the gesture that opened this visibly did something —
      // and so the bottom latch is armed by a reader who is genuinely above
      // it. INSIDE the parse callback: xterm writes asynchronously, and a
      // scroll issued beside the write runs against the buffer as it stood
      // BEFORE the history landed, which moves nothing and arms nothing.
      //
      // AND GUARDED, because "asynchronously" includes "after this effect was
      // torn down" — see the `alive` note above.
      if (!alive) return;
      term.scrollLines(-WHEEL_LINES);
    });

    /**
     * THE FINGER, because xterm has nothing for it to pan.
     *
     * `.xterm-viewport` still carries `overflow-y: scroll`, but it is an empty
     * leftover — measured on a real Terminal: zero children, empty innerHTML —
     * and the actual scroll is a virtual VS Code `Scrollable` that re-renders
     * rows, whose only input is a `wheel` listener. A touch drag across the
     * glass left `viewportY` exactly where it was and put nothing on the pty,
     * and so did its pointer-event twin. On top of that the sheet computes
     * `touch-action: none` over the whole panel, so even a real scroller would
     * not have been panned. The drag is ours to write or the phone has none.
     *
     * `defaultPrevented` IS THE GUARD, and it is not decoration: xterm binds
     * `pointerdown` on its own scrollbar slider and takes the pointer capture
     * through `GlobalPointerMoveMonitor`, but calls only `preventDefault()` —
     * never `stopPropagation()`. The press therefore reaches this element too,
     * and capturing it here would steal the capture xterm took an instant
     * earlier and break dragging the scrollbar. Reading the flag rather than
     * the target's class survives xterm renaming its internals.
     */
    let dragging = false;
    let lastY = 0;
    /** Sub-row travel, kept across moves: a slow drag is many fractions of a
     *  row, and truncating each one on its own swallows the whole gesture. */
    let carry = 0;
    /** MEASURED ONCE PER GESTURE. A cell cannot change height mid-drag, and
     *  `getBoundingClientRect` forces layout — reading it on every move is a
     *  synchronous relayout per frame, beside a terminal that repaints on every
     *  scroll. 0 means "not measurable yet", so the first move that can measure
     *  fills it in rather than dividing by a number nobody gave us. */
    let rowPx = 0;

    /** When the last move was seen, and how fast the finger was going then —
     *  smoothed, because raw per-move speed on a phone is noise. */
    let lastT = 0;
    let vel = 0;
    /** The running throw, if there is one. */
    let raf = 0;
    const stopGlide = (): void => {
      if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
    };

    /** Turn travel into rows and scroll by them, keeping the sub-row
     *  remainder. Shared by the finger and by the throw that follows it, so
     *  the two cannot disagree about which way is older or about what happens
     *  to the fraction of a row between them. */
    const advance = (travel: number): number => {
      const rows = Math.trunc(travel / rowPx);
      // The content follows the finger: dragging DOWN reaches older output,
      // which is a scroll UP.
      if (rows !== 0) term.scrollLines(-rows);
      const rest = travel - rows * rowPx;
      // AND THE REMAINDER IS SHOWN, not just carried. Without this the view
      // only ever moves in whole rows, which is fine at speed and is the whole
      // of what a decelerating throw looks wrong doing — see `offset`'s own
      // note. Nothing is snapped back when the motion stops: a view resting
      // part of a row off its grid is what every pixel-smooth scroller on the
      // device leaves behind, and snapping to the grid would put back a
      // hitch at the exact moment this is meant to remove one.
      term.offset?.(rest);
      return rest;
    };

    /**
     * THE THROW. Everything on a phone keeps moving when the finger leaves and
     * slows to a stop; a view that halts dead does not read as a scroll at all,
     * which is what the operator met — "працює виключно поки ведеш пальцем".
     * The history cannot borrow the platform's deceleration because it is not a
     * native scroller: xterm's `.xterm-viewport` is an empty leftover and the
     * real scroll is a virtual re-render. So the curve is written here.
     *
     * It carries the finger's own remainder in rather than starting from zero,
     * so the hand-off is continuous — the throw picks up mid-row exactly where
     * the drag left off.
     *
     * IT DOES NOT KNOW WHERE THE EDGES ARE, deliberately: a throw that runs
     * past the oldest line simply scrolls nothing for the rest of its curve,
     * which is invisible and costs one short animation. Asking the terminal for
     * its viewport position every frame to stop a few hundred milliseconds
     * earlier would buy a new method on the seam for nothing anyone can see.
     * The other end needs no such care — arriving at the newest line is what
     * `onBottom` latches, and it takes the whole layer down with it.
     */
    const glide = (v0: number): void => {
      let v = v0;
      // Seeded from the same clock the drag measured its speed with —
      // `requestAnimationFrame`'s argument and `performance.now()` are one
      // timeline — so the first frame of the throw carries the gap since the
      // finger left rather than being spent establishing one.
      let prev = performance.now();
      const frame = (now: number): void => {
        const dt = Math.min(now - prev, GLIDE_MAX_STEP_MS);
        prev = now;
        carry = advance(v * dt + carry);
        v *= GLIDE_DECAY ** (dt / FRAME_MS);
        if (Math.abs(v) < GLIDE_STOP_PX_MS) { raf = 0; return; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };

    const begin = (y: number): void => {
      // A touch during a throw stops it where it is — the one thing every
      // scroller on the device does, and the only way to catch a line going
      // past.
      stopGlide();
      dragging = true;
      lastY = y;
      lastT = performance.now();
      vel = 0;
      carry = 0;
      rowPx = term.rowHeight();
    };
    const step = (y: number): void => {
      if (!dragging) return;
      if (rowPx <= 0) {
        rowPx = term.rowHeight();
        if (rowPx <= 0) { lastY = y; lastT = performance.now(); return; }
      }
      const now = performance.now();
      const dy = y - lastY;
      const dt = now - lastT;
      lastY = y;
      lastT = now;
      // A pause discards the speed rather than averaging it away: a finger that
      // rested and then lifted is placing the view, and the flick it made on
      // the way in is not what it is asking for now.
      if (dt > 0) vel = dt > FLING_IDLE_MS ? 0 : vel * (1 - FLING_SMOOTH) + (dy / dt) * FLING_SMOOTH;
      carry = advance(dy + carry);
    };
    const finish = (): void => {
      dragging = false;
      if (rowPx > 0 && Math.abs(vel) >= FLING_MIN_PX_MS) glide(vel);
      // Spent either way: a second `finish` for the same gesture — the pointer
      // echo of a touch that already ended — must not throw the view twice.
      vel = 0;
    };

    /**
     * TWO INPUT PATHS, AND THE TOUCH ONE IS NOT A LUXURY. The ask picker and
     * this drawer are siblings that can be open over the same session, and
     * every open vaul sheet installs a document-level capturing `touchmove`
     * with `preventDefault` on iOS. Preventing a touch there cancels the
     * POINTER stream, so a drag driven by pointer events alone dies the moment
     * another sheet is up — which is how the operator met it: with a picker
     * raised, the console would not scroll at all. Touch listeners keep
     * running regardless; `preventDefault` stops the default action, not the
     * other listeners.
     *
     * ONE FINGER IS COUNTED ONCE. A browser fires both families for the same
     * finger, so a touch gesture takes ownership for its duration and the
     * pointer echo is ignored until it lifts.
     */
    const pointers = new Set<number>();
    let active: number | null = null;
    let viaTouch = false;

    const down = (ev: PointerEvent): void => {
      pointers.add(ev.pointerId);
      if (viaTouch) return;                       // the finger already owns this
      // THE MOUSE IS NOT DRAGGING THE VIEW, IT IS SELECTING TEXT. xterm starts
      // a selection on `mousedown` and follows it with a document-level
      // `mousemove`; this handler captures the pointer and calls
      // `preventDefault()` on every move, which suppresses exactly those
      // compatibility mouse events. Left in, a mouse drag across the history
      // scrolls it and selects nothing — so the one way to copy a line out of
      // the console stops working, on the layer that exists for reading.
      //
      // The mouse loses nothing by standing down: the history terminal is in
      // the NORMAL buffer with a real scrollback and no custom wheel handler,
      // so xterm's own wheel scrolls it. The wheel is the mouse's gesture and
      // the drag is the finger's.
      if (ev.pointerType === 'mouse') return;
      if (ev.defaultPrevented) return;            // xterm's own scrollbar took it
      // A pinch is not a scroll. Abandon rather than follow one of the two.
      if (pointers.size > 1) { active = null; finish(); return; }
      active = ev.pointerId;
      begin(ev.clientY);
      try {
        histHost.setPointerCapture(ev.pointerId);
      } catch { /* jsdom, or a pointer someone else already holds */ }
    };
    const move = (ev: PointerEvent): void => {
      if (viaTouch || active !== ev.pointerId) return;
      step(ev.clientY);
      ev.preventDefault();
    };
    const end = (ev: PointerEvent): void => {
      pointers.delete(ev.pointerId);
      // AND THIS IS THE HALF THAT MATTERS. When another sheet preventDefaults
      // the touch at document level, iOS answers by CANCELLING the pointer
      // stream — a `pointercancel` arrives for a gesture the finger is still
      // making. Ending the drag on it would kill exactly the drag the touch
      // path exists to keep alive.
      if (viaTouch) return;
      if (active === ev.pointerId || pointers.size === 0) { active = null; finish(); }
    };

    const touchStart = (ev: TouchEvent): void => {
      viaTouch = true;
      if (ev.touches.length !== 1) { finish(); return; }   // a pinch, not a scroll
      begin(ev.touches[0]!.clientY);
    };
    const touchMove = (ev: TouchEvent): void => {
      if (ev.touches.length !== 1) { finish(); return; }
      step(ev.touches[0]!.clientY);
    };
    const touchEnd = (): void => {
      finish();
      viaTouch = false;
    };

    histHost.addEventListener('pointerdown', down);
    histHost.addEventListener('pointermove', move);
    histHost.addEventListener('pointerup', end);
    histHost.addEventListener('pointercancel', end);
    // The pointer pair stays in the BUBBLE phase on purpose: `down` reads
    // `defaultPrevented`, which only carries xterm's scrollbar claim once
    // xterm's own handler has run. The touch pair goes in the CAPTURE phase,
    // where nothing below can take it away.
    histHost.addEventListener('touchstart', touchStart, { passive: true, capture: true });
    histHost.addEventListener('touchmove', touchMove, { passive: true, capture: true });
    histHost.addEventListener('touchend', touchEnd, { passive: true, capture: true });
    histHost.addEventListener('touchcancel', touchEnd, { passive: true, capture: true });
    return () => {
      histHost.removeEventListener('pointerdown', down);
      histHost.removeEventListener('pointermove', move);
      histHost.removeEventListener('pointerup', end);
      histHost.removeEventListener('pointercancel', end);
      histHost.removeEventListener('touchstart', touchStart, true);
      histHost.removeEventListener('touchmove', touchMove, true);
      histHost.removeEventListener('touchend', touchEnd, true);
      histHost.removeEventListener('touchcancel', touchEnd, true);
      window.removeEventListener('resize', refitHistory);
      window.visualViewport?.removeEventListener('resize', refitHistory);
      stopGlide();
      // Before `dispose()` because that is the order that states the intent — but
      // the ordering carries NO mechanism, and saying so here is the honest half:
      // both statements run in this one synchronous block and the parse callback
      // fires strictly after it returns (measured, xterm 6.0.0 — `dispose()` does
      // not flush the write queue early), so `alive` is false by then either way.
      // What is load-bearing is the FLAG, and `terminal-scrollback.test.tsx` reds
      // when its check is removed. Do not add a test for this line's position; no
      // test can distinguish the two orderings.
      alive = false;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goHist writes a ref + state only
  }, [hist, histHost, makeHistoryTerm]);

  // The keyboard inset changes the drawer's inner height — refit after paint.
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => refitRef.current?.());
    return () => cancelAnimationFrame(raf);
  }, [kbInset, open]);

  return (
    <Sheet open={open} onClose={onClose} full title="Terminal" eyebrow={`terminal · ${id}`}>
      <div className="term" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        <div className="term-screen">
          <div ref={setHost} className="term-host" />
          {/* The history layer sits OVER the live one rather than replacing it:
              the live terminal keeps its socket, its grid and its scroll
              position, so leaving the history is not a re-attach. */}
          {hist.at === 'history' && (
            <div className="term-history">
              <div ref={setHistHost} className="term-host" />
            </div>
          )}
          {/* NO BADGE OVER A HISTORY THAT IS UP: the reader can see the
              history, the line count told them nothing they had asked for, and
              the `live` button beside it was a second door for the job the key
              bar's toggle now does both ways. Only the two states a reader
              cannot read off the glass still speak. */}
          {(hist.at === 'reading' || hist.at === 'empty') && (
            <div className="term-histbar" role="status" aria-label="History">
              <span className="term-histbar-word">
                {hist.at === 'reading'
                  ? 'reading history…'
                  : `no history · ${historyFailureSentence(hist.why, hist.detail)}`}
              </span>
            </div>
          )}
          {conn !== 'open' && (
            <div className={`term-overlay term-overlay--${conn}`} role="status">
              {conn === 'connecting' ? (
                <span className="term-overlay-word">attaching…</span>
              ) : (
                <>
                  <span className="term-overlay-word term-overlay-word--lost">
                    connection lost
                  </span>
                  <button
                    type="button"
                    className="btn-ghost term-retry"
                    onClick={() => setAttempt((a) => a + 1)}
                  >
                    Reconnect
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="term-keys" role="toolbar" aria-label="Terminal keys">
          {/* The sequence caps are the half allowed to scroll away. MEASURED:
              nine caps at --tap-min plus eight gaps and this bar's padding
              come to 9x44 + 8x8 + 2x12 = 484px before a legend is laid out,
              and `.sheet-panel--full` drops the drawer's side padding to zero
              — so on a 390px phone the ninth cap starts at x=428, entirely off
              the right edge. Survivable while every cap was a key the phone's
              own keyboard also lacks; not survivable once the strip holds the
              only door touch has to the console history. */}
          <div className="term-keys-seq">
            {QUICK_KEYS.map((k) => (
              <button
                key={k.label}
                type="button"
                className="keycap"
                aria-label={k.label}
                onPointerDown={(e) => e.preventDefault()} // keep focus in the terminal
                onClick={() => typed(k.seq)}
              >
                <span aria-hidden="true">{k.legend}</span>
              </button>
            ))}
          </div>
          {/* A phone has no wheel, and MEASURED against the real Terminal, a
              touch drag over xterm emits nothing to the pty in either buffer —
              so touch has no gesture to fix and no gesture that opens this.
              This key IS its door, which is why it sits OUTSIDE the scroller
              above: the one affordance touch has must never be the thing that
              scrolled off the edge.

              An ACTION, not a sequence — outside QUICK_KEYS so that table goes
              on meaning "bytes the pane receives". The legend is a word rather
              than a glyph for the same reason: every other legend here IS the
              key it transmits, and `⇞` would promise a PageUp this button
              never sends. */}
          <button
            type="button"
            className="keycap keycap--act"
            aria-label={atLive ? 'Scroll back' : 'Back to live'}
            /* A real toggle, not two buttons: one key in, the same key out.
               `aria-pressed` is what carries the engaged state to AT and,
               through the attribute selector, to the inverted fill in CSS —
               one fact, one source, with no `data-` twin to drift from it.
               ENGAGED MEANS A LAYER IS UP, so it reads the history state
               itself and not `!atLive`: `reading` and `empty` are also "not
               live", but in neither has anything been entered, and `empty` is
               where every reader lands after a swap re-creates the pane with
               no scrollback. A pressed cap over the live pane tells them they
               are somewhere they are not. The LEGEND still names the
               destination in those states, because the cap's job there is to
               dismiss the notice — engaged and useful are different claims. */
            aria-pressed={hist.at === 'history'}
            onPointerDown={(e) => e.preventDefault()} // keep focus in the terminal
            onClick={() => (atLive ? openHistory() : goHist({ at: 'live' }))}
          >
            {/* The legend names the destination, the way every other cap here
                names what it sends: from live it offers `hist`, and from the
                history it offers the way back. */}
            <span aria-hidden="true">{atLive ? 'hist' : 'live'}</span>
          </button>
        </div>
      </div>
    </Sheet>
  );
}
