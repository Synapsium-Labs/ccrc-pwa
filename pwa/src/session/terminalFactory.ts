// HOW A TERMINAL IS BUILT — the xterm factories, the theme they read, the
// fit, and the two readings the history pane needs.
//
// WHY IT IS ITS OWN FILE. `TerminalDrawer.tsx` was 1287 lines, and the two
// halves answer different questions: this one is "what is an xterm here"
// (the injectable slices the drawer drives, the token-read theme, the
// paint-lag measurement, the fit, and the two real factories), and the
// drawer is "when to attach, when to let go, and what a gesture means".
// Nothing here renders JSX and nothing here holds React state, so the file
// is `.ts`.
//
// The theme is READ FROM THE TOKENS at construction time rather than
// restated — see `glass` — so the drawer's dark glass stays the one the
// stylesheet defines. The shape moves, the ground stays.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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
  // `--family-mono`, NOT `--font-mono`. Wave 1 renamed the six token families
  // that collided with Tailwind v4's reserved namespaces, and `--font-*` is one
  // of them: `--font-mono` now exists only inside theme.css's `@theme inline`
  // block, which emits `var(--family-mono)` into utilities instead of defining
  // `--font-mono` on :root. `tokenValue` returns undefined for a property that
  // resolves to '', so the old name would silently fall through to the generic
  // `monospace` here and the terminal would quietly lose its token stack.
  fontFamily: tokenValue('--family-mono') ?? 'monospace',
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

export const defaultMakeTerm: MakeTerm = (host) => {
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
      // reds three of its four cases and crediting the constant ZERO reds two
      // — the word `constant` alone was wrong, because a non-zero constant (5)
      // reds all four — and the partially-clamped case, asked for 10 and moved
      // 2, reds either way.
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
