// O6 browser spike harness for the terminal drawer — plan
// docs/superpowers/plans/2026-10-14-terminal-drawer-every-width-stage1.md, Task 1
// (rows S1–S8).
//
// This page mounts the product's own Sheet (full), a DOM scroller with a static
// Claude-Code-shaped screen word-wrapped to the measured width, and a real
// @xterm/xterm 6.0.0 Terminal pinned at 220x51 opened into a host that is
// translated outside the viewport. It measures the input path on a fine pointer
// (the off-screen xterm) and the phone layout (the field and bar over a soft
// keyboard, inside vaul's sheet) — the two things jsdom cannot tell us.
//
// Nothing this page does reaches a pane. It touches no session, socket or
// server. It is not in tsconfig.json's include nor the build's input.
//
// Automation hooks on `window` (read by the device rows):
//   spikeLog        — Entry[], append-only; every logged event with a ms stamp.
//   spikeClear()    — empties spikeLog in place.
//   spikeOffsets()  — scroll offsets of page, sheet, screen, host, scroller.
//   spikeFocus()    — describes document.activeElement.
//   spikeTerm       — the Terminal, once created.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import '../src/styles/base.css';
import '../src/session/chat.css';
import { Keycap, Sheet } from '@ccrc/ui';
import { useKeyboardInset } from '../src/lib/keyboard';
import { useMediaQuery } from '../src/lib/useMediaQuery';
import { PINNED_WINDOW_COLS, PINNED_WINDOW_ROWS, TMUX_STATUS_ROWS } from '../../shared/api';

// ── The log (module scope, before React) ──────────────────────────────────

type Entry = { t: number; kind: string; detail: string };

declare global {
  interface Window {
    spikeLog: Entry[];
    spikeClear: () => void;
    spikeOffsets: () => Record<'page' | 'sheet' | 'screen' | 'host' | 'scroller', [number, number]>;
    spikeFocus: () => string;
    spikeTerm: Terminal | undefined;
  }
}

const subscribers = new Set<() => void>();

function esc(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x1b) out += '\\e';
    else if (c === 0x0d) out += '\\r';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x5c) out += '\\\\';
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += s[i]!;
  }
  return out;
}

function log(kind: string, detail: string): void {
  window.spikeLog.push({ t: Math.round(performance.now()), kind, detail });
  for (const fn of subscribers) fn();
}

// ── The echo (a pretend Claude Code, so the operator SEES what they type) ──
// Every byte the page would send to the session is fed here as well. A printable
// character joins the input line, DEL takes the last character off, \r submits
// the line into the transcript above the box, ^C clears it, and ESC sequences
// (arrows, bracketed-paste markers) are skipped. Not a terminal: a picture of
// what Claude Code's own box would show.
const echo: { line: string; sent: string[]; composing: string } = { line: '', sent: [], composing: '' };

function feed(bytes: string): void {
  const cps = Array.from(bytes);
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i]!;
    if (ch === '\x1b') {
      // skip ESC [ params final, ESC O x, or a lone ESC
      const nx = cps[i + 1];
      if (nx === '[') { i += 2; while (i < cps.length && !/[@-~]/.test(cps[i]!)) i++; }
      else if (nx === 'O') i += 2;
      continue;
    }
    if (ch === '\r') { echo.sent.push(echo.line); if (echo.sent.length > 6) echo.sent.shift(); echo.line = ''; continue; }
    if (ch === '\x7f' || ch === '\b') { echo.line = Array.from(echo.line).slice(0, -1).join(''); continue; }
    if (ch === '\x03') { echo.line = ''; continue; }
    if (ch === '\n') { echo.line += ' '; continue; }
    if (ch.charCodeAt(0) < 0x20) continue;
    echo.line += ch;
  }
  for (const fn of subscribers) fn();
}

window.spikeLog = [];
window.spikeClear = (): void => {
  window.spikeLog.length = 0;
  for (const fn of subscribers) fn();
};
window.spikeOffsets = (): Record<'page' | 'sheet' | 'screen' | 'host' | 'scroller', [number, number]> => {
  const pair = (el: Element | null): [number, number] =>
    el === null ? [0, 0] : [el.scrollLeft, el.scrollTop];
  const page = document.scrollingElement;
  const sheet = document.querySelector('.sheet-body');
  const screen = document.querySelector('.term-screen');
  const host = document.querySelector('[data-testid="spike-host"]');
  const scroller = document.querySelector('[data-testid="spike-scroller"]');
  return {
    page: pair(page),
    sheet: pair(sheet),
    screen: pair(screen),
    host: pair(host),
    scroller: pair(scroller),
  };
};
window.spikeFocus = (): string => {
  const el = document.activeElement;
  if (el === null || el === document.body) return 'none';
  if (el.classList.contains('xterm-helper-textarea')) return 'xterm';
  const testid = el.getAttribute('data-testid');
  if (testid !== null) return testid;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '';
  return cls !== '' ? `${tag}.${cls}` : tag;
};
window.spikeTerm = undefined;

// ── CSS custom property reader (3 lines, like the product's tokenValue) ──

function readToken(name: string): string | undefined {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v === '' ? undefined : v;
}

// ── Word wrap (greedy, ~10 lines) ───────────────────────────────────────

function wrapWords(text: string, width: number, indent: number): string[] {
  const rows: string[] = [];
  const pad = ' '.repeat(indent);
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (word === '') continue;
    if (line === '') {
      if (word.length > width) {
        for (let i = 0; i < word.length; i += width) rows.push(word.slice(i, i + width));
        line = '';
      } else {
        line = word;
      }
    } else if (line.length + 1 + word.length <= width) {
      line += ' ' + word;
    } else {
      rows.push(line);
      if (word.length > width) {
        for (let i = 0; i < word.length; i += width) rows.push(pad + word.slice(i, i + width));
        line = '';
      } else {
        line = pad + word;
      }
    }
  }
  if (line !== '') rows.push(line);
  return rows;
}

// ── Synthetic screen (static, Claude-Code-shaped) ───────────────────────

const REPLY_TEXT =
  'I have updated the config loader in src/config/loader.ts so the fallback ' +
  'path is read from the environment before the hard-coded default. The ' +
  'loader now validates the shape on first read and logs the resolved source.';

function buildScreenRows(cols: number): string[] {
  const rows: string[] = [];

  // Reply line with 2-col hanging indent
  for (const row of wrapWords('● ' + REPLY_TEXT, cols, 2)) rows.push(row);

  // Tool result
  rows.push('  ⎿  Read 2 files (ctrl+o to expand)');

  // Blank
  rows.push('');

  // Permission prompt box
  const title = 'Edit file';
  const question = 'Do you want to make this edit to loader.ts?';

  const boxW = Math.min(cols, 76);
  const boxInner = boxW - 4; // "│ " + content + " │"
  const top = '╭' + '─'.repeat(boxW - 2) + '╮';
  const bottom = '╰' + '─'.repeat(boxW - 2) + '╯';

  rows.push(top);
  rows.push('│ ' + title.padEnd(boxInner) + ' │');
  rows.push('├' + '─'.repeat(boxW - 2) + '┤');
  for (const w of wrapWords(question, boxInner, 0)) rows.push('│ ' + w.padEnd(boxInner) + ' │');

  // The options keep their prefix and wrap with a hanging indent under the
  // label, the way Claude Code lays a long option out at a narrow width.
  for (const [prefix, label] of [
    ['❯ 1. ', 'Yes'],
    ['  2. ', 'Yes, allow all edits during this session, and do not ask again for this project until the session ends (shift+tab)'],
    ['  3. ', 'No, and tell Claude what to do differently (esc)'],
  ] as const) {
    const wrapped = wrapWords(label, Math.max(1, boxInner - prefix.length), 0);
    wrapped.forEach((w, i) => {
      const row = (i === 0 ? prefix : ' '.repeat(prefix.length)) + w;
      rows.push('│ ' + row.padEnd(boxInner) + ' │');
    });
  }
  rows.push(bottom);

  // Blank
  rows.push('');

  // What the operator submitted, as Claude Code echoes a sent prompt
  rows.push('__SENT__' + String(cols));

  // Input box with caret
  const inputW = Math.min(cols, 76);
  const inputTop = '╭' + '─'.repeat(inputW - 2) + '╮';
  const inputBottom = '╰' + '─'.repeat(inputW - 2) + '╯';

  rows.push(inputTop);
  // The caret row is special — rendered with a span for reverse video.
  // Stored as a sentinel with the width so the renderer can pad it.
  rows.push('__CARET__' + String(inputW));
  rows.push(inputBottom);

  // Last line
  rows.push('  ? for shortcuts');

  return rows;
}

// ── The page ─────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')!).render(<Spike />);

function Spike(): ReactNode {
  const kbInset = useKeyboardInset({ active: true });
  const coarse = useMediaQuery('(pointer: coarse)');
  const [fieldToggle, setFieldToggle] = useState(false);
  const [logShown, setLogShown] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [cols, setCols] = useState(80);
  const [vv, setVv] = useState<{ w: number; h: number; top: number } | null>(null);
  const [, forceLog] = useState(0);
  const termRef = useRef<Terminal | null>(null);
  // State, not a ref: the Sheet portals its content in after this component's
  // first effects run, so an effect reading a ref on mount would find nothing.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);

  // The live path (tap the box, type into xterm's own textarea, as the drawer on
  // main does today) is under test now, so the separate field is opt-in.
  const fieldShown = fieldToggle;

  // Subscribe to log changes for re-render
  useEffect(() => {
    const fn = (): void => forceLog((n) => n + 1);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);

  // visualViewport live tracking
  useEffect(() => {
    const vvel = window.visualViewport;
    const update = (): void => {
      if (window.visualViewport) {
        setVv({
          w: Math.round(window.visualViewport.width),
          h: Math.round(window.visualViewport.height),
          top: Math.round(window.visualViewport.offsetTop),
        });
      } else {
        setVv(null);
      }
    };
    update();
    vvel?.addEventListener('resize', update);
    vvel?.addEventListener('scroll', update);
    return () => {
      vvel?.removeEventListener('resize', update);
      vvel?.removeEventListener('scroll', update);
    };
  }, []);

  // Document-level listeners (focus, scroll)
  useEffect(() => {
    const onFocus = (): void => log('focus', window.spikeFocus());
    const onScrollDoc = (ev: Event): void => {
      const target = ev.target as Document | Element;
      let desc: string;
      if (target === document) {
        desc = 'document';
      } else if (target instanceof Element) {
        desc = target.tagName.toLowerCase() + (target.className ? '.' + String(target.className).split(/\s+/)[0] : '');
      } else {
        desc = 'unknown';
      }
      log('scroll', desc + ' ' + JSON.stringify(window.spikeOffsets()));
    };
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('scroll', onScrollDoc, { capture: true, passive: true });
    window.addEventListener('scroll', onScrollDoc, { passive: true });
    return () => {
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('scroll', onScrollDoc, true);
      window.removeEventListener('scroll', onScrollDoc);
    };
  }, []);

  // Measure scroller columns
  useEffect(() => {
    const probe = probeRef.current;
    if (scroller === null || probe === null) return undefined;
    const measure = (): void => {
      const probeW = probe.getBoundingClientRect().width / 10;
      if (probeW > 0) {
        const c = Math.max(10, Math.floor(scroller.clientWidth / probeW));
        setCols(c);
      }
    };
    measure();
    // The mono face may load after the first measure; its cell is the one that counts.
    void document.fonts.ready.then(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);

  // STICK TO THE BOTTOM, as the product's wrapped view does: the input box is the
  // bottom of the screen, so a glass the keyboard shrinks, or a box the echo
  // grows, keeps it in view. Scrolling up unsticks; scrolling back down resticks.
  const stickRef = useRef(true);
  useEffect(() => {
    if (scroller === null) return undefined;
    const onScroll = (): void => {
      stickRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 8;
    };
    const ro = new ResizeObserver(() => {
      if (stickRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(scroller);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); scroller.removeEventListener('scroll', onScroll); };
  }, [scroller]);
  useLayoutEffect(() => {
    if (scroller !== null && stickRef.current) scroller.scrollTop = scroller.scrollHeight;
  });

  // Create the terminal ONCE, keyed on host
  useEffect(() => {
    if (host === null) return undefined;

    const term = new Terminal({
      cols: PINNED_WINDOW_COLS,
      rows: PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS, // the drawer's attach: the window plus tmux's status row
      fontFamily: readToken('--font-mono') ?? 'monospace',
      fontSize: 14,
      cursorBlink: true,
      theme: {
        background: readToken('--bg-well'),
        foreground: readToken('--ink-on-well'),
        cursor: readToken('--accent'),
      },
    });
    term.open(host);
    term.write('\x1b[?2004h'); // bracketed paste on, as Claude Code turns it on
    term.write('spike: off-screen xterm, typed keys are logged below\r\n');
    term.onData((d) => { log('data', esc(d)); feed(d); });
    window.spikeTerm = term;
    termRef.current = term;
    log('term', `${term.cols}x${term.rows}`);

    // Native beforeinput + composition on the textarea
    const ta = term.textarea;
    const onBeforeInput = (ev: InputEvent): void => {
      log('beforeinput:xterm', ev.inputType + ' ' + esc(ev.data ?? ''));
    };
    const onCompStart = (ev: CompositionEvent): void => { log('compositionstart:xterm', esc(ev.data)); };
    const onCompUpdate = (ev: CompositionEvent): void => { echo.composing = ev.data; log('compositionupdate:xterm', esc(ev.data)); };
    const onCompEnd = (ev: CompositionEvent): void => { echo.composing = ''; log('compositionend:xterm', esc(ev.data)); };
    if (ta !== undefined) {
      ta.addEventListener('beforeinput', onBeforeInput);
      ta.addEventListener('compositionstart', onCompStart);
      ta.addEventListener('compositionupdate', onCompUpdate);
      ta.addEventListener('compositionend', onCompEnd);
    }

    // Host-level capture-phase listeners
    const onKeyDown = (ev: KeyboardEvent): void => {
      log('keydown:xterm', ev.key + ' ' + ev.code);
    };
    const onPaste = (ev: ClipboardEvent): void => {
      const text = ev.clipboardData?.getData('text/plain') ?? '';
      log('guard', 'guard saw paste ' + esc(text));
      ev.preventDefault();
      ev.stopPropagation();
    };
    host.addEventListener('keydown', onKeyDown, true);
    host.addEventListener('paste', onPaste, true);

    return () => {
      host.removeEventListener('keydown', onKeyDown, true);
      host.removeEventListener('paste', onPaste, true);
      if (ta !== undefined) {
        ta.removeEventListener('beforeinput', onBeforeInput);
        ta.removeEventListener('compositionstart', onCompStart);
        ta.removeEventListener('compositionupdate', onCompUpdate);
        ta.removeEventListener('compositionend', onCompEnd);
      }
      term.dispose();
      termRef.current = null;
      window.spikeTerm = undefined;
    };
  }, [host]);

  const screenRows = buildScreenRows(cols);
  const caretColor = readToken('--ink-on-well');
  const caretBg = readToken('--bg-well');

  return (
    <>
      {/* Behind the sheet: a 100dvh block so the page is fixed-height */}
      <div style={{ height: '100dvh' }}>page behind the sheet</div>
      <Sheet
        open
        full
        onClose={() => log('sheet', 'close requested')}
        title="Drawer input spike"
        eyebrow="spike · drawer input"
      >
        <div className="term" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
          {/* 3a. Header */}
          <div data-testid="spike-header" style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--ink-on-well)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {kbInset > 0 ? null : <div>{navigator.userAgent}</div>}
            <div>{`coarse: ${String(coarse)}  inner: ${window.innerWidth}x${window.innerHeight}  term: ${PINNED_WINDOW_COLS}x${PINNED_WINDOW_ROWS + TMUX_STATUS_ROWS}  cols: ${cols}`}</div>
            <div>{`vv: ${vv === null ? 'none' : `${vv.w}x${vv.h} top ${vv.top}`}  kb: ${kbInset}`}</div>
          </div>

          {/* 3b. The glass */}
          <div className="term-screen">
            {/* The scroller */}
            <div
              ref={setScroller}
              data-testid="spike-scroller"
              style={{
                position: 'absolute',
                inset: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                lineHeight: 1.2,
                color: 'var(--ink-on-well)',
                whiteSpace: 'pre',
                userSelect: 'text',
              }}
              onClick={() => { const ta = termRef.current?.textarea; if (ta) ta.focus({ preventScroll: true }); else termRef.current?.focus(); }}
            >
              {screenRows.map((row, i) => {
                if (row.startsWith('__SENT__')) {
                  const w = Math.max(8, Number(row.slice('__SENT__'.length)));
                  return echo.sent.flatMap((line, j) => {
                    const cps = Array.from('> ' + line);
                    const out: ReactNode[] = [];
                    for (let k = 0; k < Math.max(1, cps.length); k += w - 1) {
                      out.push(<div key={`s${i}-${j}-${k}`} style={{ opacity: 0.7 }}>{cps.slice(k, k + w - 1).join('')}</div>);
                    }
                    out.push(<div key={`s${i}-${j}-gap`}>{' '}</div>);
                    return out;
                  });
                }
                if (row.startsWith('__CARET__')) {
                  const w = Number(row.slice('__CARET__'.length));
                  const inner = Math.max(1, w - 5); // "│ ❯ " (4) … "│" (1)
                  const cps = Array.from(echo.line);
                  const chunks: string[] = [];
                  for (let k = 0; k < cps.length; k += inner) chunks.push(cps.slice(k, k + inner).join(''));
                  if (chunks.length === 0 || Array.from(chunks[chunks.length - 1]!).length === inner) chunks.push('');
                  return chunks.map((c, j) => {
                    const last = j === chunks.length - 1;
                    const pad = inner - Array.from(c).length - (last ? 1 : 0);
                    return (
                      <div key={`c${i}-${j}`}>
                        {(j === 0 ? '│ ❯ ' : '│   ') + c}
                        {last ? <span data-testid="spike-caret" style={{ background: caretColor, color: caretBg }}>{' '}</span> : null}
                        {' '.repeat(Math.max(0, pad)) + '│'}
                      </div>
                    );
                  });
                }
                return <div key={i}>{row}</div>;
              })}
              {/* Width probe */}
              <span ref={probeRef} style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' }}>{'MMMMMMMMMM'}</span>
            </div>

            {/* The host (off-screen, never display:none) */}
            <div
              ref={setHost}
              data-testid="spike-host"
              className="term-host"
              style={{
                position: 'absolute',
                inset: 0,
                transform: 'translateX(calc(-100% - 100vw))',
              }}
            />
          </div>

          {/* 3c0. The spike's own controls, OFF the key bar so the bar is the product's width */}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', padding: '0 var(--sp-3)', justifyContent: 'flex-end' }}>
            <Keycap
              className="keycap--act"
              data-testid="spike-toggle-field"
              aria-pressed={fieldToggle}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setFieldToggle((v) => !v)}
            >
              <span aria-hidden="true">field</span>
            </Keycap>
            <Keycap
              className="keycap--act"
              data-testid="spike-show-log"
              aria-pressed={logShown}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setLogShown((v) => !v)}
            >
              <span aria-hidden="true">log</span>
            </Keycap>
            <Keycap
              className="keycap--act"
              data-testid="spike-clear-log"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => window.spikeClear()}
            >
              <span aria-hidden="true">clear</span>
            </Keycap>
          </div>

          {/* 3c. The key bar */}
          <div className="term-keys" role="toolbar" aria-label="Terminal keys">
            {/* The sequence keys scroll inside .term-keys-seq, as in the product drawer,
                so a phone-width bar never widens the glass. */}
            <div className="term-keys-seq">
            {([
              { legend: 'esc', label: 'Escape', seq: '\x1b' },
              { legend: '↑', label: 'Arrow up', seq: '\x1b[A' },
              { legend: '↓', label: 'Arrow down', seq: '\x1b[B' },
              { legend: '⏎', label: 'Enter', seq: '\r' },
              { legend: '^C', label: 'Ctrl C', seq: '\x03' },
              { legend: '⌫', label: 'Backspace', seq: '\x7f' },
            ] as const).map((k) => (
              <Keycap
                key={k.label}
                aria-label={k.label}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => { log('bar', esc(k.seq)); feed(k.seq); }}
              >
                <span aria-hidden="true">{k.legend}</span>
              </Keycap>
            ))}
            </div>
          </div>

          {/* 3d. The field row */}
          {fieldShown && <FieldRow />}

          {/* 3e. The log */}
          {logShown && (
            <pre
              data-testid="spike-log"
              style={{
                userSelect: 'text',
                maxHeight: '30vh',
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-2xs)',
                color: 'var(--ink-on-well)',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {window.spikeLog.map((e) => `${e.t} ${e.kind} ${e.detail}`).join('\n')}
            </pre>
          )}
        </div>
      </Sheet>
    </>
  );
}

// ── The field row (3d) ───────────────────────────────────────────────────

function FieldRow(): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = ref.current;
    if (ta === null) return undefined;
    const onBeforeInput = (ev: InputEvent): void => {
      log('beforeinput:field', ev.inputType + ' ' + esc(ev.data ?? ''));
    };
    const onCompStart = (ev: CompositionEvent): void => { log('compositionstart:field', esc(ev.data)); };
    const onCompUpdate = (ev: CompositionEvent): void => { log('compositionupdate:field', esc(ev.data)); };
    const onCompEnd = (ev: CompositionEvent): void => { log('compositionend:field', esc(ev.data)); };
    ta.addEventListener('beforeinput', onBeforeInput);
    ta.addEventListener('compositionstart', onCompStart);
    ta.addEventListener('compositionupdate', onCompUpdate);
    ta.addEventListener('compositionend', onCompEnd);
    return () => {
      ta.removeEventListener('beforeinput', onBeforeInput);
      ta.removeEventListener('compositionstart', onCompStart);
      ta.removeEventListener('compositionupdate', onCompUpdate);
      ta.removeEventListener('compositionend', onCompEnd);
    };
  }, []);

  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', padding: '0 var(--sp-3)' }}>
      <textarea
        ref={ref}
        data-testid="spike-field"
        rows={2}
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 16,
          color: 'var(--ink-on-well)',
          background: 'var(--bg-well)',
          border: '1px solid var(--edge-subtle)',
          borderRadius: 'var(--r-sm)',
          minHeight: 'var(--tap-min)',
          resize: 'none',
        }}
      />
      <Keycap
        data-testid="spike-type"
        className="keycap--act"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          const ta = ref.current;
          if (ta !== null) {
            log('type', esc(ta.value));
            feed(ta.value);
            ta.value = '';
          }
        }}
      >
        <span aria-hidden="true">Type</span>
      </Keycap>
    </div>
  );
}
