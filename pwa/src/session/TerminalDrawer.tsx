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
  /** Called when the reader, having scrolled up, comes back down to the newest
   *  line — the gesture that means "I'm done with the history". NOT called for
   *  the arrival at the bottom that writing the history itself causes. */
  onBottom(cb: () => void): void;
  dispose(): void;
}
export type MakeHistoryTerm = (host: HTMLElement, lines: number) => HistoryTerm;

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
const defaultMakeHistoryTerm: MakeHistoryTerm = (host, lines) => {
  const term = new Terminal({
    ...glass(),
    cursorBlink: false,
    disableStdin: true,
    // DERIVED from the number of lines the server actually sent, never a second
    // constant to keep in step with it. The factor is the WRAP: a stored line
    // was written at the pane's width and tmux does not reflow it, so a phone
    // renders one as several rows — measured at 500 captured lines becoming 948
    // rows at 48 columns (1.9×), against 527 at 220. 3× leaves headroom over
    // the narrowest phone rather than silently dropping the oldest history.
    scrollback: lines * 3,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  return {
    write: (d, done) => term.write(d, done),
    fit: fitter(term, fit),
    // THE ROW HEIGHT, BY IDENTITY RATHER THAN BY ESTIMATE. The DOM renderer
    // sets `.xterm-screen`'s height to `css.cell.height * rows` exactly, so
    // dividing it back out IS xterm's own cell height — no private API, and no
    // reliance on the HOST's height, which `rows` was floored from and which
    // therefore over-states a row by up to a whole cell. `getBoundingClientRect`
    // rather than `clientHeight` so the answer is in the same visual pixels a
    // PointerEvent's `clientY` speaks, under whatever transform the sheet has
    // the panel in mid-animation.
    rowHeight: () => {
      const screen = host.querySelector('.xterm-screen');
      const px = screen === null ? 0 : screen.getBoundingClientRect().height;
      return px > 0 && term.rows > 0 ? px / term.rows : 0;
    },
    scrollLines: (n) => term.scrollLines(n),
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

type Conn = 'connecting' | 'open' | 'down';

/** Where the reader is. `live` is the attached pane; the other three are the
 *  one history read, in its three states. They are four VALUES rather than a
 *  pair of booleans because the view renders differently for each, and
 *  "reading" must not be mistakable for "there is nothing here". */
type Hist =
  | { at: 'live' }
  | { at: 'reading' }
  | { at: 'history'; text: string; lines: number }
  | { at: 'empty'; why: string };

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
    goHist({ at: 'reading' });
    void api.paneHistory(id).then(
      (r) => {
        if (histRef.current.at !== 'reading') return;
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
        goHist({ at: 'history', text: r.text, lines: r.lines });
      },
      (e: unknown) => {
        // WHY, not just "failed": a dead pane and an unreachable box are
        // different facts to the reader, and the server already told them
        // apart. `ApiError.body` carries the route's own word for it.
        const body = e instanceof ApiError ? (e.body as { error?: unknown }) : null;
        const why = typeof body?.error === 'string' ? body.error : 'unreachable';
        if (histRef.current.at === 'reading') goHist({ at: 'empty', why });
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
      if (ev.deltaY < 0) openHistory();
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
     */
    let from: { x: number; y: number } | null = null;
    const openDown = (ev: PointerEvent): void => {
      if (ev.defaultPrevented) { from = null; return; }   // xterm's own scrollbar
      from = { x: ev.clientX, y: ev.clientY };
    };
    const openMove = (ev: PointerEvent): void => {
      if (from === null) return;
      const dy = ev.clientY - from.y;
      const dx = ev.clientX - from.x;
      // DOWN, and more down than sideways: a swipe across the glass is not a
      // reach for older output, and a wobble is not a swipe. The threshold is
      // about a row and a half, which is the smallest travel that reads as
      // deliberate on a phone rather than as a tap that moved.
      if (dy < TOUCH_OPEN_PX || Math.abs(dx) > Math.abs(dy)) return;
      from = null;
      openHistory();
    };
    const openEnd = (): void => { from = null; };
    host.addEventListener('pointerdown', openDown);
    host.addEventListener('pointermove', openMove);
    host.addEventListener('pointerup', openEnd);
    host.addEventListener('pointercancel', openEnd);

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
    const term = (makeHistoryTerm ?? defaultMakeHistoryTerm)(histHost, hist.lines);
    term.fit();
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
    const pointers = new Set<number>();
    let active: number | null = null;
    let lastY = 0;
    /** Sub-row travel, kept across moves: a slow drag is many fractions of a
     *  row, and truncating each one on its own swallows the whole gesture. */
    let carry = 0;

    const down = (ev: PointerEvent): void => {
      pointers.add(ev.pointerId);
      if (ev.defaultPrevented) return;
      // A pinch is not a scroll. Abandon rather than follow one of the two.
      if (pointers.size > 1) { active = null; return; }
      active = ev.pointerId;
      lastY = ev.clientY;
      carry = 0;
      try {
        histHost.setPointerCapture(ev.pointerId);
      } catch { /* jsdom, or a pointer someone else already holds */ }
    };
    const move = (ev: PointerEvent): void => {
      if (active !== ev.pointerId) return;
      const travel = ev.clientY - lastY + carry;
      lastY = ev.clientY;
      const px = term.rowHeight();
      // UNMEASURABLE IS NOT ZERO: keep the travel and try again on the next
      // move rather than dividing by a number the terminal could not give.
      if (px <= 0) return;
      const rows = Math.trunc(travel / px);
      carry = travel - rows * px;
      // The content follows the finger: dragging DOWN reaches older output,
      // which is a scroll UP.
      if (rows !== 0) term.scrollLines(-rows);
      ev.preventDefault();
    };
    const end = (ev: PointerEvent): void => {
      pointers.delete(ev.pointerId);
      if (active === ev.pointerId || pointers.size === 0) active = null;
    };

    histHost.addEventListener('pointerdown', down);
    histHost.addEventListener('pointermove', move);
    histHost.addEventListener('pointerup', end);
    histHost.addEventListener('pointercancel', end);
    return () => {
      histHost.removeEventListener('pointerdown', down);
      histHost.removeEventListener('pointermove', move);
      histHost.removeEventListener('pointerup', end);
      histHost.removeEventListener('pointercancel', end);
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
                {hist.at === 'reading' ? 'reading history…' : `no history · ${hist.why}`}
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
