// Terminal drawer — the app's basement (DIRECTION). A full-height Sheet cut
// from --bg-well (the drawer keeps its dark glass in BOTH themes) holding a
// real xterm attached to the session's tmux window over `/ws/pty/:id`. Raw
// utf8 frames stream into term.write; keystrokes — and the mobile quick-key
// bar's control sequences — flow back as {type:'input'} frames, and nothing
// else ever does. A paste is taken before xterm sees it and goes back as
// `typedFrame(text)`, sanitised, so a clipboard cannot end its own brackets
// (D-5007), and text a keyboard inserts goes the same way unless it is one key's
// bytes (`inserted-text-is-sanitised`). The attach dials the window's own size plus tmux's status
// row, 220x51, at every glass width, and the terminal is pinned there (D-5005,
// spec 2026-10-14 §5.1): a client exactly the window's size is one tmux has
// nothing to pan and nothing to fill, so the glass changes the type size and
// never the grid. Closing the drawer closes the socket, after which the
// server restores the session's canonical tmux window size.
//
// TWO VIEWS OF THE ONE TERMINAL (D-5005, D-5006, spec 2026-10-14 §5.2). Where
// the window's 220 columns fit at 11px or more the glass shows the GRID, the
// terminal itself; everywhere else the WRAPPED view, its screen re-wrapped to
// the glass as text (`WrappedView`). Which one is `chooseView`'s answer over the
// type fit, beaten by a per-device chip in the header. The terminal has ONE
// host in two positions — visible for the grid, moved off-screen for the
// wrapped view with the glass's own box — and is opened on every pointer, so a
// tap on the wrapped view types live into xterm's textarea (operator ruling
// R-LIVE, 2026-10-15). This file decides nothing of that itself: it measures,
// asks `drawerView.ts`, and places what it was told.
//
// THE WHEEL IS NOT PART OF THAT CONVERSATION. tmux attaches this client on the
// alternate screen, where xterm has no scrollback and turns a wheel notch into
// arrow keys aimed at the pane — so the wheel is swallowed here and scrolls the
// pane's own history instead, read over `GET /api/sessions/:id/pane/history`
// (tmux `capture-pane`, which mutates nothing on the box).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ATTACH, defaultMakeTerm, historyFailureSentence,
  type DrawerTerm, type HistoryTerm, type MakeHistoryTerm, type MakeTerm,
} from './terminalFactory';
import { attachHistoryPane } from './historyPane';
import { attachReachForHistory } from './reachForHistory';
import { histFromPane, histFromReadError, type Hist } from './historyRead';
import { Button, Chip, Keycap, Sheet } from '@ccrc/ui';
import { api } from '../lib/api';
import { checkAuth, onAuthRegained } from '../lib/auth';
import { useKeyboardInset } from '../lib/keyboard';
import { wsUrl } from '../lib/ws';
import { PINNED_WINDOW_COLS } from '../../../shared/api';
import { BASE_CONSOLE_FONT_PX, consoleFit, type ConsoleFit } from './consoleFit';
import { rowText } from './drawerModel';
import {
  chooseView, readViewOverride, viewChip, writeViewOverride,
  type DrawerViewKind, type StorageLike,
} from './drawerView';
import { KeyBar, useKeyInput } from './KeyBarView';
import { insertedFrame, inputLetter, keyLetter, typedFrame } from './typedFrame';
import { WrappedView } from './WrappedView';
import './chat.css';

/** Lines one wheel notch moves — xterm's own default step, and the amount the
 *  history view opens by so the gesture reads as a scroll rather than a jump. */

type Conn = 'connecting' | 'open' | 'down';

/** keyCode 229: a key an input method is handling, whose text xterm reads back
 *  out of its textarea a task later rather than from the key. */
const IME_KEY = 229;

/** Where the reader is. `live` is the attached pane; the other three are the
 *  one history read, in its three states. They are four VALUES rather than a
 *  pair of booleans because the view renders differently for each, and
 *  "reading" must not be mistakable for "there is nothing here". */

export interface TerminalDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  makeSocket?: (url: string) => WebSocket; // injectable for tests
  makeTerm?: MakeTerm; // injectable for tests
  makeHistoryTerm?: MakeHistoryTerm; // injectable for tests
  /** Where the view chip's per-device choice is kept; `localStorage` by
   *  default. Injectable for tests, which hand it a store that throws. */
  viewStorage?: () => StorageLike;
}

export function TerminalDrawer({
  id,
  open,
  onClose,
  makeSocket,
  makeTerm,
  makeHistoryTerm,
  viewStorage,
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
  /** The type size the live glass is rendering at, which is the size a history
   *  layer is built at. The fit does NOT reason from it: every fit starts from
   *  the base size, so the answer depends on the box alone (`consoleFit`). */
  const fontRef = useRef(BASE_CONSOLE_FONT_PX);
  /** The history layer's terminal while one is up, so a live refit that moves
   *  the type size can move the history's with it. */
  const histTermRef = useRef<HistoryTerm | null>(null);
  /** True while the glass cannot show the window's 220 columns even at the
   *  type's floor: the last MEASURED fit's verdict. It chooses the wrapped view
   *  unless the chip forced the grid, which then scrolls sideways and says so
   *  (`grid · scrolls`). */
  const [clipped, setClipped] = useState(false);
  /** The last measured fit, or null before one: what the view would be with
   *  no override, which is what the chip's flip compares against. */
  const fitRef = useRef<ConsoleFit | null>(null);
  /** The per-device override: read once, at mount, from a store that may
   *  throw (`readViewOverride`), and held here for this drawer whatever the
   *  store does with a write. */
  const store = viewStorage ?? ((): StorageLike => window.localStorage);
  const [storedOverride] = useState(() => readViewOverride(store));
  const overrideRef = useRef<DrawerViewKind | null>(storedOverride);
  /** The view showing. null only until something is measured or chosen: it is
   *  placed as the grid is (the host visible), and has no chip. */
  const [view, setView] = useState<DrawerViewKind | null>(() => chooseView(null, storedOverride, null));
  const viewRef = useRef<DrawerViewKind | null>(view);
  const showView = (v: DrawerViewKind | null): void => {
    viewRef.current = v;
    setView(v);
  };
  /** The live terminal while one is attached, for the wrapped view to read. */
  const [liveTerm, setLiveTerm] = useState<DrawerTerm | null>(null);
  /** What the wrapped view reports: a selection holding its rows still, and
   *  a screen that has shown no prompt glyph for two seconds. */
  const [paused, setPaused] = useState(false);
  const [notClaude, setNotClaude] = useState(false);
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
        goHist(histFromPane(r));
      },
      (e: unknown) => {
        if (req !== reqRef.current) return;
        if (histRef.current.at === 'reading') goHist(histFromReadError(e));
      },
    );
  };

  /**
   * THE TYPE MEETS THE GLASS; THE GRID IS THE WINDOW'S (D-5005).
   *
   * The terminal is pinned at the window's own size, 220 columns by 50 rows
   * plus tmux's status row, and nothing here resizes it. A client exactly the
   * window's size is one tmux has nothing to pan and nothing to fill (spec
   * 2026-10-14 §5.1, W6) — where a client narrower than the window was a
   * viewport tmux panned to follow the cursor, and a line's beginning slid off
   * to the left while its owner typed. The window is not narrowed to suit the
   * glass either: tmux reflows stored lines on a width change, destructively at
   * this fleet's `history-limit` (the measurement is in `PINNED_WINDOW_COLS`'
   * own docstring).
   *
   * So the glass changes the TYPE SIZE and the VIEW, never the grid. The type
   * shrinks, down to the floor, until all 220 columns are on screen, and the
   * glass shows the grid. Where even the floor cannot fit them, a phone above
   * all, the glass shows the wrapped view instead: the same screen re-wrapped
   * to its width (D-5006). Only a grid the reader forced there with the chip
   * scrolls sideways, and its chip says so.
   *
   * MEASURED, NEVER RESIZED. Every candidate size is measured with
   * `DrawerTerm.propose`, which does not touch the live grid, and only the chosen
   * size is applied. tmux attaches this client on the alternate screen, and
   * xterm's alternate buffer does not survive a shrink: rows below the cursor
   * are dropped, rows are trimmed off the top, the cursor is clamped, and
   * growing back restores none of it. An earlier revision measured by resizing
   * to a size and back, and typed text then echoed rows away from the prompt
   * (`console-window-fit-xterm.test.tsx` measures it against the real
   * terminal). A pinned grid ends that hazard rather than stepping around it:
   * no fit moves the grid at all.
   *
   * THE ROWS ARE FIXED TOO. A glass taller than the 51 rows leaves a margin
   * below them; on a shorter one the host scrolls vertically, held at its
   * bottom where the box is (`keepBottom`, in the attach).
   *
   * The search is `consoleFit`'s, and lives there so it can be tested without a
   * DOM. What is here is only the application of it.
   */
  const fitToWindow = (t: DrawerTerm): void => {
    // A HOST WITH NO LAYOUT IS UNMEASURED, NOT NARROW. The sheet portals its
    // content and animates in, so the first fit can land on an element with no
    // width at all. Taken as a measurement, it would size the type for a glass
    // that does not exist; the later fit recovers, but the reader has already
    // seen the jump. Nothing measured means nothing changes: the type, the clip
    // and the view stay as they are, and the first measured fit decides.
    //
    // ONE MEASUREMENT FOR BOTH POSITIONS. The host keeps the glass's own box
    // off-screen as well as on it (`.term-host--off` only translates it), and
    // the terminal is open in it on every pointer, so `propose` measures the
    // same glass whichever view is showing — and a verdict cannot flip the
    // view, re-measure a different box and flip it back.
    const want = host === null || host.clientWidth <= 0
      ? null
      : consoleFit((px) => t.propose(px)?.cols ?? null, PINNED_WINDOW_COLS);
    if (want !== null) {
      t.setFontSize(want.fontSize);
      fontRef.current = want.fontSize;
      histTermRef.current?.setFontSize?.(want.fontSize);
      // The search's own verdict, and a measured one: it answers "fits" only
      // for a size whose grid it measured at 220 columns or more. The grid the
      // terminal has says nothing here — it is 220 wide whatever the glass shows.
      setClipped(want.clipped);
      fitRef.current = want;
    }
    // THE VIEW IS THE CHOOSER'S (D-5005): the grid where 220 fit, the wrapped
    // view where they do not, the override over both, and an unmeasured glass
    // keeping what it shows.
    showView(chooseView(want, overrideRef.current, viewRef.current));
  };

  /**
   * THE VIEW CHIP's flip, kept per device (spec §5.2). Flipping BACK to what
   * the glass would choose by itself clears the override rather than pinning
   * it, so a device keeps following its glass until the reader overrules it.
   * The write may throw away the choice (a private window); the drawer keeps
   * it all the same, for as long as it is open.
   */
  const flipView = (): void => {
    const next: DrawerViewKind = viewRef.current === 'wrapped' ? 'grid' : 'wrapped';
    const fit = fitRef.current;
    const ov = fit !== null && chooseView(fit, null, null) === next ? null : next;
    overrideRef.current = ov;
    writeViewOverride(store, ov);
    showView(chooseView(fit, ov, viewRef.current));
  };

  /** The not-Claude chip's offer: the grid, for this drawer only. A pane in vim
   *  is a passing state, and a device that keeps it would open every later
   *  session in a grid it does not fit. */
  const gridForNow = (): void => {
    overrideRef.current = 'grid';
    showView('grid');
  };

  // Frames are inert until the socket reports open — quick keys pressed
  // during attach are dropped, never queued blind into a dead pipe.
  //
  // INPUT IS THE ONLY FRAME THIS DRAWER SENDS (D-5005), and the type says so:
  // a resize frame would hand the client's size back to the glass, which is
  // the panning this design ends, so it no longer compiles.
  const sendFrame = (frame: { type: 'input'; data: string }): void => {
    const ws = sockRef.current;
    if (!ws || connRef.current !== 'open') return;
    ws.send(JSON.stringify(frame));
  };

  /** A keystroke — from the keyboard or from the quick-key bar. It RETURNS TO
   *  LIVE first, the way a console jumps to the bottom when you type: the keys
   *  reach the session either way, and watching them land is the whole reason
   *  to type. A refit deliberately does not go through here — a rotation is
   *  not a keystroke and must not throw away the history. */
  const typed = (data: string): void => {
    if (histRef.current.at !== 'live') goHist({ at: 'live' });
    sendFrame({ type: 'input', data });
  };

  /** The live screen as text, one string per window row, read off the model
   *  WHEN IT IS CALLED: the ^C/^D guard reads it at the moment of the tap,
   *  because the exit notice it looks for appears after the first Ctrl-C. */
  const screenNow = (): readonly string[] => termRef.current?.model().map(rowText) ?? [];
  /** The bar's TAPS go through the ^C/^D guard, the latch's included (D-5007).
   *  Keys typed into the terminal do not: `term.onData` reaches `typed` with
   *  nothing but the latch's one-letter drop in between (in the attach), so a
   *  physical Ctrl-C reaches the session exactly as it always has. */
  const keys = useKeyInput(typed, screenNow);
  const cancelHeldKey = keys.guard.cancel;
  /** The latch as the textarea's listeners see it. They are installed once per
   *  attach, and the bar's latch is a new object every render. */
  const latchRef = useRef(keys.latch);
  useLayoutEffect(() => {
    latchRef.current = keys.latch;
  });

  useEffect(() => {
    if (!open || host === null) return undefined;

    const setState = (s: Conn): void => {
      connRef.current = s;
      setConn(s);
    };
    setState('connecting');

    const term = (makeTerm ?? defaultMakeTerm)();
    termRef.current = term;
    setLiveTerm(term);
    // THE GRID IS THE WINDOW'S, FIRST AND ONCE (D-5005). Pinned before the
    // socket exists, so the first byte tmux sends lands in a grid of the size
    // it was told; and never again, because nothing the glass does is a reason
    // to move it.
    term.pin(ATTACH.cols, ATTACH.rows);
    // ONE HOST, opened into once, ON EVERY POINTER (operator ruling R-LIVE,
    // 2026-10-15). Whichever position the view puts it in, the terminal is
    // there before the first fit: its own `propose` is the measurement, and
    // its textarea is what a tap on the wrapped view focuses. So the cell
    // probe spec §5.2 gave `colsAt` for a terminal never opened has nothing to
    // serve; the wrapped view's probe sets its width W alone.
    term.open(host);
    // A NEW TERMINAL STARTS AT THE BASE SIZE, whatever the last one settled
    // on, and nothing is known about its clip until it has been measured.
    fontRef.current = BASE_CONSOLE_FONT_PX;
    setClipped(false);
    fitRef.current = null;
    // AND NOTHING ABOUT ITS VIEW: the last terminal's was chosen for a glass
    // this one has not measured (a reopened sheet's is still sliding in). The
    // override alone stands until the first measured fit decides, which on a
    // glass that has layout is the fit just below, in this same render.
    showView(chooseView(null, overrideRef.current, null));

    /**
     * THE BOX IS AT THE BOTTOM, and so is the host's scroll. The grid's 51
     * rows are fixed, so a glass shorter than them scrolls the host — in the
     * browser; tmux pans nothing — and Claude Code's input box is on the last
     * rows. So the host is held at its bottom through every refit (a keyboard
     * opening, a rotation, the type changing size) UNLESS the operator has
     * scrolled it: a reader who went up to read the top rows keeps their place
     * until they scroll back down. `atBottom` is read off the host on every
     * scroll, the drawer's own included, so a scroll that ends at the bottom
     * re-arms it whoever made it.
     */
    let atBottom = true;
    const onHostScroll = (): void => {
      atBottom = host.scrollHeight - host.scrollTop - host.clientHeight <= 1;
    };
    const keepBottom = (): void => {
      if (atBottom) host.scrollTop = host.scrollHeight - host.clientHeight;
    };
    host.addEventListener('scroll', onHostScroll, { passive: true });

    fitToWindow(term);   // the type, measured at open where the glass allows
    keepBottom();

    const make = makeSocket ?? ((u: string) => new WebSocket(u));
    // THE CONSTANTS, NEVER A MEASUREMENT: whatever the glass, the client the
    // server attaches is the window's size.
    const ws = make(wsUrl(`/ws/pty/${encodeURIComponent(id)}?cols=${ATTACH.cols}&rows=${ATTACH.rows}`));
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
    // re-attach it for nothing the moment the operator signed back in: the
    // reader would watch their pane drop to `attaching…` and repaint for no
    // reason, and lose a ^C held for a confirm and a latched `ctrl`. This is
    // `ReconnectingSocket.nudge()`'s own early return (`ws.ts`: inert unless
    // started AND down), which the two paths were asymmetric on.
    const unsubAuth = onAuthRegained(() => {
      if (connRef.current !== 'open') setAttempt((a) => a + 1);
    });

    /**
     * THE LATCH'S LETTER (D-5007, plan Task 12; operator ruling R-LIVE,
     * 2026-10-15). With the bar's `ctrl` latched, the next ASCII letter typed
     * into the terminal is sent as its control code, through the ^C/^D guard
     * (`latch.take` sends through it), and the letter itself is not typed.
     * Where the letter arrives decides how it is stopped:
     *
     * - A PHONE'S KEYBOARD hands it over as a `beforeinput` on xterm's textarea
     *   (`inputLetter`). An `insertText` is cancelled, so it never reaches the
     *   textarea or xterm. The letter that OPENS a composition (Gboard composes
     *   every word) comes as an `insertCompositionText`, which a browser does
     *   not let be cancelled: xterm will still send that composition when it
     *   ends, so the next chunk it sends is dropped if it is the letter. One
     *   chunk: the drop is spent on it either way, and never waits to eat a
     *   letter typed later.
     * - A KEYBOARD THAT REPORTS REAL KEYS (a physical one; an on-screen one not
     *   composing) never fires a `beforeinput` for a letter: xterm sends it at
     *   keydown and cancels the event (`keyLetter`). So the keydown is taken
     *   here first and stopped, before xterm's own listener on its textarea.
     *
     * Both listeners are on the HOST, in the capture phase: the only place that
     * runs before xterm's listeners on its own textarea. Unlatched, neither
     * touches anything, and typing reaches the socket exactly as xterm sends it.
     */
    let dropOnce: string | null = null;
    /**
     * WHILE THE KEYBOARD IS INSERTING TEXT (`inserted-text-is-sanitised`, I5).
     * A keyboard inserts as well as reporting keys: an `input` event's
     * `insertText`, which xterm sends at once; a composition's commit, which it
     * reads back a task later; the textarea's growth after a keyCode-229
     * keydown, also a task later (or at once, when a key ends a composition).
     * None is a `paste` event, so the paste guard sees none of them, and a
     * keyboard's clipboard chip or suggestion may well arrive by one. Each opens
     * a window here, in the capture phase on the host — ahead of xterm's own
     * listeners on its textarea — and what xterm sends inside it goes out as
     * `insertedFrame` says: one key's bytes as they are, anything longer as a
     * paste. Outside a window nothing is touched, so a key, and every reply the
     * terminal sends of its own (a DCS or OSC report tmux asked for), reaches
     * the session exactly as xterm sends it.
     *
     * TWO TURNS OF THE TASK QUEUE: xterm's own read is a `setTimeout(0)` queued
     * by its listener, which runs after this one, so a window that closed on
     * the first turn would close before the text it was opened for.
     */
    let inserting = 0;
    const insertion = (): void => {
      inserting += 1;
      setTimeout(() => {
        setTimeout(() => {
          inserting -= 1;
        }, 0);
      }, 0);
    };
    const onInsertKeyDown = (ev: KeyboardEvent): void => {
      if (ev.keyCode === IME_KEY || ev.isComposing) insertion();
    };
    term.onData((data) => {
      if (dropOnce !== null) {
        const drop = data === dropOnce;
        dropOnce = null;
        if (drop) return;
      }
      const out = inserting > 0 ? insertedFrame(data) : data;
      if (out !== '') typed(out);
    });
    const onBeforeInput = (ev: InputEvent): void => {
      const letter = inputLetter(ev.inputType, ev.data);
      if (letter === null || !latchRef.current.take(letter)) return;
      ev.preventDefault();
      if (!ev.defaultPrevented) dropOnce = letter;
    };
    const onKeyDown = (ev: KeyboardEvent): void => {
      const letter = keyLetter(ev);
      if (letter === null || !latchRef.current.take(letter)) return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    /**
     * THE PASTE GUARD (D-5007, plan Refinement 11; P3 ruled yes: both views).
     * xterm 6.0.0's own paste brackets the clipboard's text without removing an
     * end marker inside it, so a clipboard holding `\e[201~` would close the
     * brackets early and TYPE what follows, Enter included. Every paste in the
     * host is taken here, in the capture phase, because xterm's own handler on
     * its textarea stops the event there: a listener that waited for it to
     * bubble would never run. The browser inserts nothing, xterm never sees it,
     * and the text goes out as `typedFrame(text)`: sanitised, and bracketed
     * exactly as xterm would bracket it when it holds a newline.
     */
    const onPaste = (ev: ClipboardEvent): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const data = typedFrame(ev.clipboardData?.getData('text/plain') ?? '');
      if (data !== '') typed(data);
    };
    host.addEventListener('beforeinput', onBeforeInput, true);
    host.addEventListener('keydown', onKeyDown, true);
    host.addEventListener('paste', onPaste, true);
    host.addEventListener('input', insertion, true);
    host.addEventListener('compositionend', insertion, true);
    host.addEventListener('keydown', onInsertKeyDown, true);

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
      // AND THE HOST DOES NOT SCROLL ON IT EITHER (D-5005). The host scrolls
      // now — the grid's 51 rows are fixed and a short glass shows part of
      // them — and `false` above stops xterm, not the browser, which would
      // otherwise scroll the host under the history it just asked for. The
      // vertical wheel keeps the one meaning it has had; the host's scrollbar
      // is how a short glass reaches its top rows. A pinch stays the browser's
      // zoom, and a sideways scroll stays the host's own.
      if (!ev.ctrlKey && ev.deltaY !== 0 && Math.abs(ev.deltaY) >= Math.abs(ev.deltaX)) {
        ev.preventDefault();
      }
      return false;
    });

    const detachReach = attachReachForHistory(host, openHistory);

    // Later size changes (rotation, keyboard, desktop resize) → refit: the
    // type follows the glass and the host keeps its bottom. Nothing is SENT —
    // the client is the window's size whatever the glass does (D-5005).
    const refit = (): void => {
      const t = termRef.current;
      if (!t) return;
      fitToWindow(t);
      keepBottom();
    };
    refitRef.current = refit;
    window.addEventListener('resize', refit);
    window.visualViewport?.addEventListener('resize', refit);

    return () => {
      window.removeEventListener('resize', refit);
      window.visualViewport?.removeEventListener('resize', refit);
      host.removeEventListener('scroll', onHostScroll);
      host.removeEventListener('beforeinput', onBeforeInput, true);
      host.removeEventListener('keydown', onKeyDown, true);
      host.removeEventListener('paste', onPaste, true);
      host.removeEventListener('input', insertion, true);
      host.removeEventListener('compositionend', insertion, true);
      host.removeEventListener('keydown', onInsertKeyDown, true);
      detachReach();
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
      setLiveTerm(null);
      term.dispose();
      // A re-attach is a fresh pane read: a history captured before the drop
      // is a snapshot of a session that has moved on since.
      goHist({ at: 'live' });
      // So is a ^C held for a confirm: it was asked about the screen this
      // attach showed, and must not be sent into the next one on a stale Send.
      cancelHeldKey();
      // And so is a latch: it was set against this attach's screen, and the
      // next attach starts unlatched, as it starts with nothing held.
      latchRef.current.setLatched(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendFrame reads refs only
  }, [open, host, attempt, id, makeSocket, makeTerm]);

  // The history view, mounted only while there is a history to show. The live
  // terminal underneath it keeps its socket and keeps consuming frames, so
  // coming back to it lands on the pane's newest line, not on a stale screen.
  useEffect(() => {
    if (hist.at !== 'history' || histHost === null) return undefined;
    // Every gesture, the throw and the terminal itself are `attachHistoryPane`'s
    // (`historyPane.ts`); this effect is the lifetime and the one way back. The
    // layer is built at the live pane's type size, and held in `histTermRef`
    // while it is up so `fitToWindow` can move it with the live one.
    return attachHistoryPane(
      histHost, hist, makeHistoryTerm, () => goHist({ at: 'live' }),
      fontRef.current, histTermRef,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goHist writes a ref + state only
  }, [hist, histHost, makeHistoryTerm]);

  // The keyboard inset changes the drawer's inner height — refit after paint,
  // so the host keeps its bottom on the glass that is left. So can the chips:
  // they sit in the header above the glass, and on a narrow phone they can
  // take the header onto a second line. And a view that changed has moved the
  // host: back on the glass, the grid keeps its bottom where the box is.
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => refitRef.current?.());
    return () => cancelAnimationFrame(raf);
  }, [kbInset, open, clipped, view, paused, notClaude]);

  // A LATCH THE VIEW NO LONGER SHOWS IS CLEARED. The `ctrl` cap lives on the
  // wrapped view's overflow row and the grid's strip has none, while the
  // latch's listeners serve the host in both views: carried into the grid, a
  // latch would turn the reader's next letter into a control code with nothing
  // on the glass to say so. Closing the row that holds the cap unlatches it for
  // the same reason (`KeyBar`).
  useEffect(() => {
    if (view !== 'wrapped') latchRef.current.setLatched(false);
  }, [view]);

  /**
   * THE CHIPS, in the drawer's header and not on the glass (D-5005).
   *
   * The view chip replaced the `pans` notice: it names the view, and its
   * accessible name says why and what a tap does. A view is a standing
   * condition, and on a phone it lasts the whole session, so it goes in the
   * header line beside the session it describes rather than over the glass's
   * top row. Before anything is measured or chosen there is no view to name,
   * and no chip.
   *
   * Beside it, only while the wrapped view reports them: `paused`, while a
   * selection holds its rows still, and the offer of the grid on a screen that
   * has shown no Claude Code prompt for two seconds (vim, less). Neither sends
   * a byte; a tap on a chip keeps the keyboard where it is.
   */
  const chip = view === null ? null : viewChip(view, clipped);
  const eyebrow = (
    <span className="term-eyebrow">
      <span>{`terminal · ${id}`}</span>
      <span className="term-chips">
        {view === 'wrapped' && paused && (
          <Chip className="term-paused" role="status" aria-label="Updates paused while text is selected">
            paused
          </Chip>
        )}
        {view === 'wrapped' && notClaude && (
          <button
            type="button"
            className="term-view"
            aria-label="This screen shows no Claude Code prompt, so the grid may read better. Show the grid"
            onPointerDown={(e) => e.preventDefault()}
            onClick={gridForNow}
          >
            <Chip className="term-view-pill">not claude code? grid</Chip>
          </button>
        )}
        {chip !== null && (
          <button
            type="button"
            className="term-view"
            aria-label={chip.label}
            onPointerDown={(e) => e.preventDefault()}
            onClick={flipView}
          >
            <Chip className="term-view-pill">{`${chip.legend} ⇄`}</Chip>
          </button>
        )}
      </span>
    </span>
  );

  /**
   * P4 (operator ruling, 2026-10-15): A PHYSICAL ESCAPE GOES TO CLAUDE CODE.
   * Radix's dismissable layer, under vaul's sheet, catches Escape on the
   * document in the capture phase, so with nothing in the way one Esc sent
   * `\e` to the session AND closed the drawer (measured in every engine on the
   * spike). While xterm's textarea has focus the dismissal is cancelled; the
   * keydown still reaches xterm, which sends the `\e`. With focus anywhere else
   * in the sheet, Escape closes it as it always has.
   */
  const keepEscapeInTerminal = (e: KeyboardEvent): void => {
    const ae = document.activeElement;
    if (host !== null && ae instanceof HTMLTextAreaElement && host.contains(ae)) e.preventDefault();
  };

  /*
   * THE HISTORY DOOR, beside the bar's keys and never one of them.
   *
   * A phone has no wheel, and MEASURED against the real Terminal, a touch drag
   * over xterm emits nothing to the pty in either buffer — so touch has no
   * gesture to fix and no gesture that opens this. This key IS its door, which
   * is why `KeyBar` renders it in the bar's tail, OUTSIDE both halves of keys,
   * and why the bar wraps where it does not fit rather than scrolling: the one
   * affordance touch has must never be the thing that went off the edge.
   *
   * An ACTION, not a sequence — outside KEY_SEQ so that table goes on meaning
   * "bytes the pane receives". The legend is a word rather than a glyph for the
   * same reason: every other legend here IS the key it transmits, and `⇞` would
   * promise a PageUp this button never sends.
   */
  const histDoor = (
    <Keycap
      className="keycap--act"
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
    </Keycap>
  );

  return (
    <Sheet
      open={open} onClose={onClose} full title="Terminal" eyebrow={eyebrow}
      onEscapeKeyDown={keepEscapeInTerminal}
    >
      <div className="term" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        <div className="term-screen">
          {/* The live terminal's ONE host, in one of two positions (D-5005):
              visible for the grid, where it scrolls if the pinned grid is
              larger than the glass; off-screen for the wrapped view, keeping
              the glass's own box, never `display: none`, so xterm still
              measures, renders and takes the keyboard there. */}
          <div
            ref={setHost}
            className={`term-host ${view === 'wrapped' ? 'term-host--off' : 'term-host--grid'}`}
          />
          {view === 'wrapped' && liveTerm !== null && host !== null && (
            <WrappedView
              term={liveTerm}
              host={host}
              srcCols={ATTACH.cols}
              onPaused={setPaused}
              onNotClaude={setNotClaude}
            />
          )}
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
                  <Button
                    variant="ghost" className="term-retry"
                    onClick={() => setAttempt((a) => a + 1)}
                  >
                    Reconnect
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {view === 'wrapped'
          ? <KeyBar view="wrapped" guard={keys.guard} latch={keys.latch} action={histDoor} />
          : <KeyBar view="grid" guard={keys.guard} action={histDoor} />}
      </div>
    </Sheet>
  );
}
