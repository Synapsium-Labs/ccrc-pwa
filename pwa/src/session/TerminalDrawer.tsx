// Terminal drawer — the app's basement (DIRECTION). A full-height Sheet cut
// from --bg-well (the drawer keeps its dark glass in BOTH themes) holding a
// real xterm attached to the session's tmux window over `/ws/pty/:id`. Raw
// utf8 frames stream into term.write; keystrokes — and the mobile quick-key
// bar's control sequences — flow back as {type:'input'} frames, and nothing
// else ever does. The attach dials the window's own size plus tmux's status
// row, 220x51, at every glass width, and the terminal is pinned there (D-5005,
// spec 2026-10-14 §5.1): a client exactly the window's size is one tmux has
// nothing to pan and nothing to fill, so the glass changes the type size and
// never the grid. Closing the drawer closes the socket, after which the
// server restores the session's canonical tmux window size.
//
// THE WHEEL IS NOT PART OF THAT CONVERSATION. tmux attaches this client on the
// alternate screen, where xterm has no scrollback and turns a wheel notch into
// arrow keys aimed at the pane — so the wheel is swallowed here and scrolls the
// pane's own history instead, read over `GET /api/sessions/:id/pane/history`
// (tmux `capture-pane`, which mutates nothing on the box).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ATTACH, defaultMakeTerm, historyFailureSentence,
  type DrawerTerm, type HistoryTerm, type MakeHistoryTerm, type MakeTerm,
} from './terminalFactory';
import { attachHistoryPane } from './historyPane';
import { attachReachForHistory } from './reachForHistory';
import { histFromPane, histFromReadError, type Hist } from './historyRead';
import { Button, Keycap, Sheet } from '@ccrc/ui';
import { api } from '../lib/api';
import { checkAuth, onAuthRegained } from '../lib/auth';
import { useKeyboardInset } from '../lib/keyboard';
import { wsUrl } from '../lib/ws';
import { PINNED_WINDOW_COLS } from '../../../shared/api';
import { BASE_CONSOLE_FONT_PX, consoleFit } from './consoleFit';
import { rowText } from './drawerModel';
import { KeyBar, useKeyInput } from './KeyBarView';
import './chat.css';

/** Lines one wheel notch moves — xterm's own default step, and the amount the
 *  history view opens by so the gesture reads as a scroll rather than a jump. */

type Conn = 'connecting' | 'open' | 'down';

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
  /** The type size the live glass is rendering at, which is the size a history
   *  layer is built at. The fit does NOT reason from it: every fit starts from
   *  the base size, so the answer depends on the box alone (`consoleFit`). */
  const fontRef = useRef(BASE_CONSOLE_FONT_PX);
  /** The history layer's terminal while one is up, so a live refit that moves
   *  the type size can move the history's with it. */
  const histTermRef = useRef<HistoryTerm | null>(null);
  /** True while the glass cannot show the window's 220 columns even at the
   *  type's floor. tmux pans nothing — the client is the window's size — but
   *  the host then scrolls sideways, and the reader deserves to be told why
   *  their lines run off the right of the glass. */
  const [clipped, setClipped] = useState(false);
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
   * So the glass changes the TYPE SIZE and nothing else. The type shrinks, down
   * to the floor, until all 220 columns are on screen. Where even the floor
   * cannot fit them, a phone above all, the console stays at the base size, the
   * host scrolls sideways, and the drawer's header says why.
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
    // seen the jump. Nothing measured means nothing changes: the type and the
    // clip stay as they are, and the first measured fit decides.
    if (host === null || host.clientWidth <= 0) return;
    const want = consoleFit((px) => t.propose(px)?.cols ?? null, PINNED_WINDOW_COLS);
    if (want === null) return;   // unmeasurable: keep what we have
    t.setFontSize(want.fontSize);
    fontRef.current = want.fontSize;
    histTermRef.current?.setFontSize?.(want.fontSize);
    // The search's own verdict, and a measured one: it answers "fits" only for
    // a size whose grid it measured at 220 columns or more. The grid the
    // terminal has says nothing here — it is 220 wide whatever the glass shows.
    setClipped(want.clipped);
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
   *  Keys typed into the terminal do not: `term.onData` is `typed`, bare, so a
   *  physical Ctrl-C reaches the session exactly as it always has. */
  const keys = useKeyInput(typed, screenNow);
  const cancelHeldKey = keys.guard.cancel;

  useEffect(() => {
    if (!open || host === null) return undefined;

    const setState = (s: Conn): void => {
      connRef.current = s;
      setConn(s);
    };
    setState('connecting');

    const term = (makeTerm ?? defaultMakeTerm)();
    termRef.current = term;
    // THE GRID IS THE WINDOW'S, FIRST AND ONCE (D-5005). Pinned before the
    // socket exists, so the first byte tmux sends lands in a grid of the size
    // it was told; and never again, because nothing the glass does is a reason
    // to move it.
    term.pin(ATTACH.cols, ATTACH.rows);
    // ONE HOST, opened into once. It is always the visible position here.
    term.open(host);
    // A NEW TERMINAL STARTS AT THE BASE SIZE, whatever the last one settled
    // on, and nothing is known about its clip until it has been measured.
    fontRef.current = BASE_CONSOLE_FONT_PX;
    setClipped(false);

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
      term.dispose();
      // A re-attach is a fresh pane read: a history captured before the drop
      // is a snapshot of a session that has moved on since.
      goHist({ at: 'live' });
      // So is a ^C held for a confirm: it was asked about the screen this
      // attach showed, and must not be sent into the next one on a stale Send.
      cancelHeldKey();
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
  // so the host keeps its bottom on the glass that is left. So can the clip
  // notice: it sits in the header above the glass, and on a narrow phone it
  // can take the header onto a second line.
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => refitRef.current?.());
    return () => cancelAnimationFrame(raf);
  }, [kbInset, open, clipped]);

  /**
   * THE CLIP NOTICE, in the drawer's header and not on the glass.
   *
   * A clip is a standing condition rather than an event, and on a phone it
   * lasts the whole session. A strip laid over the live terminal would cover
   * its top row for as long as the drawer is open, so it goes in the header
   * line above the glass, beside the session it describes. The visible words
   * are short enough for a 360px phone; the full sentence is the accessible
   * name.
   */
  const eyebrow = (
    <span className="term-eyebrow">
      <span>{`terminal · ${id}`}</span>
      {clipped && (
        <span
          className="term-clip"
          role="status"
          aria-label={`The session window is ${PINNED_WINDOW_COLS} columns wide, wider than this screen, so the console scrolls sideways`}
        >
          {`window ${PINNED_WINDOW_COLS} cols · scrolls`}
        </span>
      )}
    </span>
  );

  /*
   * THE HISTORY DOOR, beside the key bar and never inside its strip.
   *
   * A phone has no wheel, and MEASURED against the real Terminal, a touch drag
   * over xterm emits nothing to the pty in either buffer — so touch has no
   * gesture to fix and no gesture that opens this. This key IS its door, which
   * is why `KeyBar` renders it OUTSIDE the scroller: the one affordance touch has
   * must never be the thing that scrolled off the edge.
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
    <Sheet open={open} onClose={onClose} full title="Terminal" eyebrow={eyebrow}>
      <div className="term" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        <div className="term-screen">
          {/* The live terminal's one host, in its visible position (D-5005):
              it scrolls where the pinned grid is larger than the glass. */}
          <div ref={setHost} className="term-host term-host--grid" />
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
        <KeyBar view="grid" guard={keys.guard} action={histDoor} />
      </div>
    </Sheet>
  );
}
