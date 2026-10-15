// The wrapped view (D-5006, spec 2026-10-14 §5.3): the drawer's one terminal's
// screen, re-wrapped to the glass and rendered as DOM text.
//
// The terminal stays pinned at the window's own 220 columns and keeps parsing
// every byte tmux sends; this view reads its buffer (`term.model()`, which never
// includes tmux's status row), re-wraps it at W columns of 14px type
// (`wrapScreen`), and renders the visual rows. W comes from a monospace probe in
// this view's own type, never from xterm's measurement: these rows are DOM
// text, and the probe measures the face they are drawn in.
//
// PANE OUTPUT REACHES THE DOM AS TEXT. Every cell is a character in a React text
// node; its style passes through `cellCss`, a closed set of six properties. A
// link the pane prints is text here, never an anchor.
//
// TYPING IS LIVE (operator ruling R-LIVE, 2026-10-15): the terminal is open in
// its host, off-screen, on every pointer, and a tap here focuses xterm's own
// textarea, so a phone's keyboard and a physical one both type straight into the
// session. While a composition is open on that textarea (a phone keyboard's word
// in progress, an IME), its text is shown at the caret as provisional; nothing is
// sent until it commits, which is xterm's own behaviour.
//
// Nothing here sends a byte, and nothing here chooses one: the visual geometry
// is for the eye only (spec §8, I5).
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DrawerTerm } from './terminalFactory';
import { BASE_CONSOLE_FONT_PX } from './consoleFit';
import { cellCss, rowText, type CellStyle, type ModelCell } from './drawerModel';
import { wrapScreen, type VisualRow } from './wrapScreen';
import { NOT_CLAUDE_MS, anchorRow, caretIndex, showsPrompt, wrapWidth } from './drawerView';

/** The probe's run: ten cells of one wide glyph, so a sub-pixel cell is read to
 *  a tenth of a pixel. */
const PROBE = 'MMMMMMMMMM';
/** How far from the anchored bottom a scroll may rest and still be "at the
 *  bottom": a flick shorter than this is noise, not a reader going up. */
const STICK_SLACK_PX = 8;

export interface WrappedViewProps {
  term: DrawerTerm;
  /** The terminal's host. xterm's textarea is inside it, and the composition
   *  events this view previews bubble up to it. */
  host: HTMLElement;
  /** The grid the model is laid out at: the columns the terminal was pinned to. */
  srcCols: number;
  /** True while a selection inside this view holds its rows still. */
  onPaused(paused: boolean): void;
  /** True once no prompt glyph has been on screen for `NOT_CLAUDE_MS`. */
  onNotClaude(notClaude: boolean): void;
}

const styleSig = (s: CellStyle): string =>
  `${s.fgMode}${s.fg}/${s.bgMode}${s.bg}/${+s.bold}${+s.dim}${+s.italic}${+s.underline}${+s.inverse}`;

/** `cellCss` with its unset properties left out, as React's `style` wants. */
const cssOf = (s: CellStyle): CSSProperties => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cellCss(s))) if (v !== undefined) out[k] = v;
  return out;
};

/** Consecutive cells of one style, as one span. */
function runs(cells: readonly ModelCell[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < cells.length) {
    const sig = styleSig(cells[i]!.style);
    let j = i + 1;
    while (j < cells.length && styleSig(cells[j]!.style) === sig) j++;
    out.push(
      <span key={i} style={cssOf(cells[i]!.style)}>
        {cells.slice(i, j).map((c) => c.ch).join('')}
      </span>,
    );
    i = j;
  }
  return out;
}

/** A row's identity: its kind, its first source row, its text and its style
 *  runs. Equal identity, equal rendering, so an unchanged row is not redrawn. */
function rowSig(row: VisualRow): string {
  const src = row.src.find((s) => s !== null)?.row ?? -1;
  let styles = '';
  let last = '';
  for (const c of row.cells) {
    const s = styleSig(c.style);
    if (s !== last) styles += `|${s}`;
    last = s;
  }
  return `${row.kind}:${src}:${row.cells.map((c) => c.ch).join('')}${styles}`;
}

interface RowProps {
  row: VisualRow;
  sig: string;
  /** The open composition's text, on the caret's row only. */
  ime: string | null;
  anchor: boolean;
}

const WrapRow = memo(
  function WrapRow({ row, ime, anchor }: RowProps): ReactNode {
    const mark = anchor ? { 'data-anchor': '' } : {};
    if (row.kind === 'blank') return <div className="term-wrap-row" {...mark}>{' '}</div>;
    if (row.kind === 'rule') {
      // A CSS rule in the source colour, never a run of box-drawing glyphs
      // that would wrap at a narrower width.
      const color = cssOf(row.cells[0]!.style).color;
      return <div className="term-wrap-row term-wrap-rule" style={{ color }} aria-hidden="true" {...mark}>{' '}</div>;
    }
    const kind = row.kind === 'table' ? ' term-wrap-row--table' : row.kind === 'right' ? ' term-wrap-row--right' : '';
    const at = ime === null || ime === '' ? -1 : caretIndex(row);
    return (
      <div className={`term-wrap-row${kind}`} {...mark}>
        {at < 0 ? runs(row.cells) : (
          <>
            {runs(row.cells.slice(0, at))}
            <span className="term-wrap-ime" data-provisional="">{ime}</span>
            {runs(row.cells.slice(at))}
          </>
        )}
      </div>
    );
  },
  (a, b) => a.sig === b.sig && a.ime === b.ime && a.anchor === b.anchor,
);

export function WrappedView({ term, host, srcCols, onPaused, onNotClaude }: WrappedViewProps): ReactNode {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [rows, setRows] = useState<readonly VisualRow[]>([]);
  const [ime, setIme] = useState<string | null>(null);
  /** Held in refs too: the drawer re-renders with new callbacks, and the
   *  listeners below are installed once per terminal. */
  const cbRef = useRef({ onPaused, onNotClaude });
  useLayoutEffect(() => {
    cbRef.current = { onPaused, onNotClaude };
  });
  /** True while the view follows its anchored bottom (spec §5.3). */
  const stickRef = useRef(true);

  /** Where a stuck view rests: its bottom, unless the anchor row (the caret's,
   *  else the prompt's) would be above it, when the anchor row is the top. */
  const targetOf = (el: HTMLElement): number => {
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
    const anchor = el.querySelector<HTMLElement>('[data-anchor]');
    return anchor === null ? bottom : Math.min(bottom, anchor.offsetTop);
  };
  const stick = (el: HTMLElement): void => {
    if (stickRef.current) el.scrollTop = targetOf(el);
  };

  useEffect(() => {
    if (scroller === null) return undefined;
    /** False once this view is gone: the font promise below can settle after
     *  that, and the terminal it would read may be disposed by then. */
    let live = true;
    let w = srcCols;
    let raf = 0;
    let paused = false;
    let dirty = false;
    let judgeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPromptAt = Date.now();
    let notClaude = false;

    /** W from the probe, in this view's own face at 14px. An unmeasurable
     *  probe (no layout yet) keeps the width already in use. */
    const measure = (): boolean => {
      const probe = probeRef.current;
      const cell = probe === null ? 0 : probe.getBoundingClientRect().width / PROBE.length;
      if (!(cell > 0)) return false;
      const cs = getComputedStyle(scroller);
      const gutter = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
      const next = wrapWidth(scroller.clientWidth, cell, gutter);
      if (next === w) return false;
      w = next;
      return true;
    };

    const setNotClaude = (v: boolean): void => {
      if (v === notClaude) return;
      notClaude = v;
      cbRef.current.onNotClaude(v);
    };
    /** No prompt glyph for NOT_CLAUDE_MS → the chip; one arriving clears it.
     *  The model is read again when the timer fires, so a screen that stopped
     *  changing is still judged. */
    const judge = (texts: readonly string[]): void => {
      const now = Date.now();
      if (showsPrompt(texts)) {
        lastPromptAt = now;
        setNotClaude(false);
        return;
      }
      const left = NOT_CLAUDE_MS - (now - lastPromptAt);
      if (left <= 0) {
        setNotClaude(true);
        return;
      }
      judgeTimer ??= setTimeout(() => {
        judgeTimer = null;
        if (live) judge(term.model().map(rowText));
      }, left);
    };

    const update = (): void => {
      raf = 0;
      if (!live) return;
      const model = term.model();
      judge(model.map(rowText));
      // A SELECTION HOLDS THE ROWS STILL: re-rendering them would move the
      // text under it. The change is remembered and lands when it clears.
      if (paused) {
        dirty = true;
        return;
      }
      dirty = false;
      setRows(wrapScreen(model, w, srcCols));
    };
    const schedule = (): void => {
      if (raf === 0) raf = requestAnimationFrame(update);
    };

    const resized = (): void => {
      if (!live) return;
      if (measure()) schedule();
      stick(scroller);
    };

    const onSelection = (): void => {
      const sel = document.getSelection();
      const inside = sel !== null && !sel.isCollapsed
        && (scroller.contains(sel.anchorNode) || scroller.contains(sel.focusNode));
      if (inside === paused) return;
      paused = inside;
      cbRef.current.onPaused(inside);
      if (!inside && dirty) schedule();
    };

    const onScroll = (): void => {
      stickRef.current = scroller.scrollTop >= targetOf(scroller) - STICK_SLACK_PX;
    };

    const onCompStart = (): void => setIme('');
    const onCompUpdate = (e: Event): void => setIme((e as CompositionEvent).data);
    const onCompEnd = (): void => setIme(null);

    measure();
    update();
    const unParsed = term.onParsed(schedule);
    const ro = new ResizeObserver(resized);
    ro.observe(scroller);
    window.addEventListener('resize', resized);
    window.visualViewport?.addEventListener('resize', resized);
    // The face may load after the first measure, and its cell is the one
    // that counts.
    void document.fonts?.ready.then(resized);
    document.addEventListener('selectionchange', onSelection);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    host.addEventListener('compositionstart', onCompStart);
    host.addEventListener('compositionupdate', onCompUpdate);
    host.addEventListener('compositionend', onCompEnd);

    return () => {
      live = false;
      if (raf !== 0) cancelAnimationFrame(raf);
      if (judgeTimer !== null) clearTimeout(judgeTimer);
      unParsed();
      ro.disconnect();
      window.removeEventListener('resize', resized);
      window.visualViewport?.removeEventListener('resize', resized);
      document.removeEventListener('selectionchange', onSelection);
      scroller.removeEventListener('scroll', onScroll);
      host.removeEventListener('compositionstart', onCompStart);
      host.removeEventListener('compositionupdate', onCompUpdate);
      host.removeEventListener('compositionend', onCompEnd);
      // What this view reported is over with it.
      if (paused) cbRef.current.onPaused(false);
      if (notClaude) cbRef.current.onNotClaude(false);
    };
  }, [scroller, term, host, srcCols]);

  // After every render the rows may have grown or the composition moved the
  // caret's row: a view that is stuck follows its anchored bottom.
  useLayoutEffect(() => {
    if (scroller !== null) stick(scroller);
  });

  /** A tap types: it focuses xterm's textarea, unless it ended a selection,
   *  which is reading, not typing. */
  const onTap = (): void => {
    const sel = document.getSelection();
    if (sel !== null && !sel.isCollapsed && scroller?.contains(sel.anchorNode)) return;
    term.focus();
  };

  const anchor = anchorRow(rows);
  const seen = new Map<string, number>();
  return (
    <div
      ref={setScroller}
      className="term-wrap"
      style={{ fontSize: BASE_CONSOLE_FONT_PX }}
      onClick={onTap}
    >
      {rows.map((row, i) => {
        const sig = rowSig(row);
        const n = seen.get(sig) ?? 0;
        seen.set(sig, n + 1);
        const atCaret = ime !== null && caretIndex(row) >= 0;
        return (
          <WrapRow
            key={`${sig}#${n}`}
            row={row}
            sig={sig}
            ime={atCaret ? ime : null}
            anchor={i === anchor}
          />
        );
      })}
      <span ref={probeRef} className="term-wrap-probe" aria-hidden="true">{PROBE}</span>
    </div>
  );
}
