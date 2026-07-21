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
import { useKeyboardInset } from '../lib/keyboard';
import { wsUrl } from '../lib/ws';
import './chat.css';

/** The slice of xterm the drawer drives — injectable so tests can script it. */
export interface DrawerTerm {
  write(data: string): void;
  onData(cb: (data: string) => void): void;
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

    ws.onopen = () => {
      setState('open');
      term.focus();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') term.write(ev.data); // raw utf8 frames
    };
    ws.onclose = () => setState('down');
    ws.onerror = () => setState('down');

    term.onData((data) => sendFrame({ type: 'input', data }));

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

  return (
    <Sheet open={open} onClose={onClose} full title="Terminal" eyebrow={`terminal · ${id}`}>
      <div className="term" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        <div className="term-screen">
          <div ref={setHost} className="term-host" />
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
