// Terminal drawer — the app's basement (DIRECTION). A full-height Sheet cut
// from --bg-well (the drawer keeps its dark glass in BOTH themes) holding a
// real xterm attached to the session's tmux window over `/ws/pty/:id`. Raw
// utf8 frames stream into term.write; keystrokes — and the mobile quick-key
// bar's control sequences — flow back as {type:'input'} frames; the fit on
// open dials the measured cols/rows into the URL and later refits ride
// {type:'resize'}. Closing the drawer closes the socket, after which the
// server restores the session's canonical tmux window size.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Sheet } from '../components/Sheet';
import { api, apiErrorText, uploadErrorText } from '../lib/api';
import { checkAuth, onAuthRegained } from '../lib/auth';

import { useKeyboardInset } from '../lib/keyboard';
import { wsUrl } from '../lib/ws';
import { toast } from '../components/Toast';
import { clipboardImages, MAX_IMAGES, namedClipboardImage, uploadPayload } from './useAttachImage';
import './chat.css';

/** The slice of xterm the drawer drives — injectable so tests can script it. */
export interface DrawerTerm {
  write(data: string): void;
  onData(cb: (data: string) => void): void;
  /** Install the key handler: `false` means "xterm must not process this", so
   *  the keystroke reaches no pane — xterm's own
   *  `attachCustomKeyEventHandler` contract. */
  onKey(cb: (ev: KeyboardEvent) => boolean): void;
  /** Fit the grid to the host element; returns the measured cols/rows. */
  fit(): { cols: number; rows: number };
  focus(): void;
  dispose(): void;
}
export type MakeTerm = (host: HTMLElement) => DrawerTerm;

/** A token's resolved value at attach time — xterm paints to canvas and
 *  cannot read CSS custom properties itself. `undefined` (token missing)
 *  falls back to xterm's own default rather than hardcoding a color here. */
const tokenValue = (name: string): string | undefined => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v === '' ? undefined : v;
};

const defaultMakeTerm: MakeTerm = (host) => {
  const term = new Terminal({
    // Voice and glass from the tokens: the mono face, well background,
    // on-well ink, phosphor cursor. --bg-well stays dark under
    // [data-theme='light'], so the terminal is dark regardless of theme.
    // 14px is the plan-fixed terminal size (xterm takes a number).
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
    cursorBlink: true,
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
    onKey: (cb) => term.attachCustomKeyEventHandler(cb),
    fit: () => {
      try {
        fit.fit();
      } catch {
        /* host not measurable yet — keep the current grid */
      }
      return { cols: term.cols, rows: term.rows };
    },
    focus: () => term.focus(),
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

type Conn = 'connecting' | 'open' | 'down';

export interface TerminalDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  makeSocket?: (url: string) => WebSocket; // injectable for tests
  makeTerm?: MakeTerm; // injectable for tests
}

export function TerminalDrawer({
  id,
  open,
  onClose,
  makeSocket,
  makeTerm,
}: TerminalDrawerProps): ReactNode {
  const [conn, setConn] = useState<Conn>('connecting');
  // Bumped by Reconnect — re-runs the attach effect for a fresh fit + dial.
  const [attempt, setAttempt] = useState(0);
  // The xterm host, held as STATE via callback ref: the sheet portals its
  // content in a later commit than this component's effects, so a plain ref
  // would still be null when the attach effect first runs. Keying the effect
  // on the host makes it run exactly when the glass exists.
  const [host, setHost] = useState<HTMLElement | null>(null);
  /** How many pasted images are on their way to the box right now. A COUNT and
   *  not a boolean: a paste carries up to four, they are staged one after
   *  another, and "three still to go" is a different thing to say than "busy". */
  const [staging, setStaging] = useState(0);
  const connRef = useRef<Conn>('connecting');
  const sockRef = useRef<WebSocket | null>(null);
  const termRef = useRef<DrawerTerm | null>(null);
  const gridRef = useRef({ cols: 80, rows: 24 });
  const refitRef = useRef<(() => void) | null>(null);
  const kbInset = useKeyboardInset({ active: open });

  // Frames are inert until the socket reports open — quick keys pressed
  // during attach are dropped, never queued blind into a dead pipe.
  const sendFrame = (
    frame: { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number },
  ): void => {
    const ws = sockRef.current;
    if (!ws || connRef.current !== 'open') return;
    ws.send(JSON.stringify(frame));
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

    term.onData((data) => sendFrame({ type: 'input', data }));

    /** Stage each image and type its path. Shared by the two ways a paste can
     *  arrive, so they cannot drift apart. */
    const stage = async (files: readonly File[]): Promise<void> => {
      // The tray's cap, for the tray's reason: four is what a message carries.
      const batch = files.slice(0, MAX_IMAGES);
      /*
       * SAY THAT SOMETHING IS HAPPENING, because the gap is not small and it
       * used to be silent. Between the paste and the path in the input box
       * there is a downscale and an upload, and the operator asked the right
       * question about it: on a slow link, what does a person see?
       *
       * Measured on a real screenshot from this fleet — 1,250,009 bytes, which
       * is an ordinary Retina capture — the upload alone is about a second at
       * 10 Mbit/s, ten at 1, and forty at 0.25. Four images multiply that.
       * Nothing was shown for any of it, so a slow link was indistinguishable
       * from a paste that had not worked, and the natural response is to press
       * again — which used to start a SECOND upload beside the first.
       *
       * The composer already had this and the drawer did not: `AttachTray`
       * renders an `uploading` chip per image. The upload moved here without
       * its visibility. This is that visibility, in the strip the drawer
       * already owns for the other thing a reader cannot see for themselves.
       */
      setStaging((n) => n + batch.length);
      for (const [i, file] of batch.entries()) {
        const named = namedClipboardImage(file, Date.now() + i);
        if (named === null) {
          toast(`Can't attach ${file.type || 'that'} — PNG, JPEG or WebP only`, 'error');
          setStaging((n) => n - 1);
          continue;
        }
        try {
          const clip = await api.upload(id, await uploadPayload(named));
          sendFrame({ type: 'input', data: `${clip.path} ` });
        } catch (err) {
          // The same sentence the composer would have shown, because it is
          // the same upload failing — a pane cannot carry a failed chip.
          toast(uploadErrorText(apiErrorText(err)), 'error');
        } finally {
          // ALWAYS, and that is the whole of it: a strip that outlives its
          // upload is a worse lie than the silence it replaced.
          setStaging((n) => n - 1);
        }
      }
    };

    const onPaste = (ev: ClipboardEvent): void => {
      const files = clipboardImages(ev.clipboardData);
      if (files.length > 0) {
        ev.preventDefault();
        void stage(files);
        return;
      }
      /*
       * AN EMPTY PASTE IS NOT A PASTE, and letting one through is what the
       * operator was actually seeing.
       *
       * xterm's `handlePasteEvent` forwards `getData('text/plain')`
       * UNCONDITIONALLY — there is no empty guard anywhere on that path — and
       * `paste('')` still goes through `bracketTextForPaste`, so with
       * bracketed-paste mode on (Claude Code turns it on) the pane receives
       * `ESC[200~ ESC[201~`: a paste of nothing at all. Claude Code answers
       * that with "No image found in clipboard. Use ctrl+v to paste images.",
       * which is the message that kept coming back after the 0x16 byte was
       * already stopped — caught live in the pane, not deduced.
       *
       * `stopPropagation` and not merely `preventDefault`: xterm reads the
       * clipboard off the event itself and never looks at `defaultPrevented`,
       * so the only thing that keeps an empty paste away from it is not
       * letting the event descend. This listener is on the capture phase,
       * which is what makes that possible.
       *
       * A paste carrying TEXT is untouched and still xterm's — that is the
       * ordinary case, and it is the one this must not break.
       */
      if ((ev.clipboardData?.getData('text/plain') ?? '') === '') {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    };

    /**
     * CTRL+V MUST NOT REACH THE PANE, on any platform, and the reason is not
     * ergonomics.
     *
     * xterm 6.0.0 special-cases nothing here: `Keyboard.ts`'s default arm turns
     * any Ctrl+letter into `String.fromCharCode(keyCode - 64)`, so Ctrl+V is
     * the byte 0x16 and it is sent to the session. What happens next depends on
     * a machine the person pressing the key is not sitting at. In a Claude Code
     * pane 0x16 is "paste", and the clipboard it reaches for is the FLEET BOX's
     * — measured on this box: no `DISPLAY`, and none of `xclip`, `xsel`,
     * `wl-paste` or `pbpaste` installed, so today it answers "nothing in the
     * clipboard" and looks merely broken. It is not merely broken. tmux's own
     * paste buffers on the same box are NOT empty (measured: six buffers, one
     * holding a URL, another a login), and the day anything teaches that pane
     * to read a clipboard that exists, a paste gesture made on a phone in
     * another country silently inserts whatever the server last copied. A
     * keystroke must never act on a clipboard other than the one belonging to
     * the hand that pressed it.
     *
     * In a shell pane 0x16 is not paste at all — it is readline's
     * `quoted-insert`, which swallows the NEXT keystroke and inserts it raw.
     *
     * And on Linux and Windows this is a double action today: the browser
     * treats Ctrl+V as its own paste accelerator, so the `paste` event above
     * fires AND the 0x16 goes to the pane. Swallowing the keystroke leaves that
     * path working through the event, exactly as it already does, minus the
     * stray byte.
     *
     * macOS is the one platform where no `paste` event follows, because there
     * the accelerator is ⌘V. So the keystroke is answered here instead, from
     * the clipboard of the browser that received it. `navigator.clipboard.read`
     * is permissioned and may be refused or absent; a refusal says so rather
     * than doing nothing, because "nothing happened" is the failure this whole
     * branch has already cost a day to.
     */
    const readOwnClipboard = async (): Promise<void> => {
      const hint = (): void => toast('Paste with ⌘V — Ctrl+V cannot read this browser\'s clipboard', 'error');
      const clip = navigator.clipboard;
      if (typeof clip?.read !== 'function') { hint(); return; }
      try {
        const items = await clip.read();
        const files: File[] = [];
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type === undefined) continue;
          const blob = await item.getType(type);
          files.push(new File([blob], 'clipboard', { type }));
        }
        if (files.length > 0) { await stage(files); return; }
        // Text is xterm's job everywhere else, so it is xterm's job here too:
        // type it into the pane exactly as a paste event would have.
        const text = await clip.readText();
        if (text !== '') sendFrame({ type: 'input', data: text });
        else hint();
      } catch {
        hint();   // refused, or a clipboard this browser will not hand over
      }
    };
    term.onKey((ev) => {
      if (ev.type !== 'keydown') return true;
      // THE PHYSICAL KEY, because that is what xterm decides on. Its control
      // byte comes from `ev.keyCode` (`Keyboard.ts`: keyCode 65-90 becomes
      // `String.fromCharCode(keyCode - 64)`, so 86 is 0x16), and keyCode is
      // layout-independent. `ev.key` is the CHARACTER — under a Ukrainian
      // layout the same physical key reports `м`, so a guard written on `key`
      // misses exactly when its owner is typing in their own language, while
      // xterm sends the byte regardless. Measured: the notice came back at
      // 00:36:55 on a freshly built console, with the byte guard already in
      // place, and this is the only way it could.
      //
      // `code` first because it is the modern spelling of the same fact;
      // `keyCode` because it is what xterm itself reads and this guard must
      // not disagree with it; `key` last for a browser that offers neither.
      const isV = ev.code === 'KeyV' || ev.keyCode === 86 || ev.key === 'v' || ev.key === 'V';
      if (!isV || !ev.ctrlKey || ev.metaKey || ev.altKey) return true;
      // Ctrl+Shift+V is the same gesture on a Linux terminal, and the same
      // byte is just as wrong.
      void readOwnClipboard();
      return false;   // xterm's own "do not process this" — no 0x16 is sent
    });
    // THE CAPTURE PHASE, and it is the whole difference between working and
    // not. xterm's `handlePasteEvent` calls `ev.stopPropagation()`
    // UNCONDITIONALLY and is bound both to its hidden textarea and to
    // `.terminal.xterm` — one level BELOW this host — so a listener on the
    // bubble phase here is never reached and the paste dies silently. Measured:
    // neither Ctrl+V nor Cmd+V put anything in the pane. Capturing runs before
    // the event descends, so xterm cannot take it away; a TEXT paste is left
    // entirely alone here and reaches xterm exactly as before.
    host.addEventListener('paste', onPaste, true);

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
      host.removeEventListener('paste', onPaste, true);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendFrame reads refs only
  }, [open, host, attempt, id, makeSocket, makeTerm]);

  // The keyboard inset changes the drawer's inner height — refit after paint.
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => refitRef.current?.());
    return () => cancelAnimationFrame(raf);
  }, [kbInset, open]);

  /** What the drawer's status strip should say, or null for nothing to say.
   *  One job today — an image on its way to the box — and the element renders
   *  only when there is a word for it. */
  const stripWord: string | null =
    staging === 0 ? null
      : staging === 1 ? 'staging image…'
        : `staging ${staging} images…`;

  return (
    <Sheet open={open} onClose={onClose} full title="Terminal" eyebrow={`terminal · ${id}`}>
      <div className="term" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        <div className="term-screen">
          <div ref={setHost} className="term-host" />
          {stripWord !== null && (
            <div className="term-histbar" role="status" aria-label="Terminal status">
              <span className="term-histbar-word">{stripWord}</span>
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
          {QUICK_KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              className="keycap"
              aria-label={k.label}
              onPointerDown={(e) => e.preventDefault()} // keep focus in the terminal
              onClick={() => sendFrame({ type: 'input', data: k.seq })}
            >
              <span aria-hidden="true">{k.legend}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
