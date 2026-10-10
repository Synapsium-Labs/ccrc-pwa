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
import {
  defaultMakeTerm, historyFailureSentence,
  type DrawerTerm, type HistoryPane, type MakeHistoryTerm, type MakeTerm,
} from './terminalFactory';
import { attachHistoryPane } from './historyPane';
import { attachReachForHistory } from './reachForHistory';
import { Button, Keycap, Sheet } from '@ccrc/ui';
import { api, ApiError } from '../lib/api';
import { checkAuth, onAuthRegained } from '../lib/auth';
import { useKeyboardInset } from '../lib/keyboard';
import { wsUrl } from '../lib/ws';
import './chat.css';

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

    const detachReach = attachReachForHistory(host, openHistory);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendFrame reads refs only
  }, [open, host, attempt, id, makeSocket, makeTerm]);

  // The history view, mounted only while there is a history to show. The live
  // terminal underneath it keeps its socket and keeps consuming frames, so
  // coming back to it lands on the pane's newest line, not on a stale screen.
  useEffect(() => {
    if (hist.at !== 'history' || histHost === null) return undefined;
    // Every gesture, the throw and the terminal itself are `attachHistoryPane`'s
    // (`historyPane.ts`); this effect is the lifetime and the one way back.
    return attachHistoryPane(histHost, hist, makeHistoryTerm, () => goHist({ at: 'live' }));
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
              <Keycap
                key={k.label}
                /* No modifier and no hook class: `KEYCAP` carries `keycap`,
                   and `.term-keys .keycap` is what skins it. */
                aria-label={k.label}
                onPointerDown={(e) => e.preventDefault()} // keep focus in the terminal
                onClick={() => typed(k.seq)}
              >
                <span aria-hidden="true">{k.legend}</span>
              </Keycap>
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
        </div>
      </div>
    </Sheet>
  );
}
