/**
 * Which of the drawer's two views a glass gets, and the small readings the
 * wrapped view takes off its rows (spec 2026-10-14 §5.2, §5.3; D-5005, D-5006).
 *
 * The drawer's one terminal is pinned at the window's own 220x51. The GRID
 * shows it as tmux draws it; the WRAPPED view re-wraps its screen to the glass.
 * The type fit (`consoleFit`) is the measurement: where 220 columns fit at 11px
 * or more the glass gets the grid, and everywhere else the wrapped view. A
 * per-device override, the view chip, beats both.
 *
 * PURE: no React, no DOM. Storage arrives as a getter, so a store that throws
 * (a private window, a preview, a thumbnail capture) is a case a test can
 * hand it.
 */
import type { ConsoleFit } from './consoleFit';
import { isCaret } from './drawerModel';
import type { VisualRow } from './wrapScreen';
import { PINNED_WINDOW_COLS } from '../../../shared/api';

export type DrawerViewKind = 'grid' | 'wrapped';

/**
 * The view for this glass. `fit` is `consoleFit`'s verdict, `override` the
 * per-device choice, `current` the view showing now.
 *
 * NULL MEANS "NOT MEASURED YET: KEEP `current`", and it is never read as the
 * grid. A host with no layout (the sheet still sliding in) or a terminal that
 * cannot measure says nothing about the glass, so it moves nothing; the first
 * measured fit decides. `null` comes back only when nothing has been measured
 * and nothing chosen.
 */
export function chooseView(
  fit: ConsoleFit | null,
  override: DrawerViewKind | null,
  current: DrawerViewKind | null,
): DrawerViewKind | null {
  if (override !== null) return override;
  if (fit === null) return current;
  return fit.clipped ? 'wrapped' : 'grid';
}

/** Where the per-device override lives in `localStorage`. Versioned, so a later
 *  shape of the choice is a new key rather than a misread old one. */
export const VIEW_OVERRIDE_KEY = 'ccrc.drawer-view.v1';

/** The slice of `Storage` the override uses. */
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** The stored override, or null: for no value, for any value but the two
 *  views, and for a store that throws on the way (its getter included). */
export function readViewOverride(store: () => StorageLike): DrawerViewKind | null {
  try {
    const v = store().getItem(VIEW_OVERRIDE_KEY);
    return v === 'grid' || v === 'wrapped' ? v : null;
  } catch {
    return null;
  }
}

/** Store the override, or clear it with null. A store that throws is a no-op:
 *  the choice then lasts as long as the drawer that made it. */
export function writeViewOverride(store: () => StorageLike, v: DrawerViewKind | null): void {
  try {
    const s = store();
    if (v === null) s.removeItem(VIEW_OVERRIDE_KEY);
    else s.setItem(VIEW_OVERRIDE_KEY, v);
  } catch {
    /* private window, preview or blocked storage: the choice is this drawer's alone */
  }
}

/** The wrapped view's width W, in columns: the glass past its gutter over one
 *  14px cell, floored, and never below 1. The caller hands it a MEASURED cell;
 *  an unmeasurable one is the caller's to handle, not a width. */
export function wrapWidth(glassPx: number, cellPx: number, gutterPx: number): number {
  const w = Math.floor((glassPx - gutterPx) / cellPx);
  return Number.isFinite(w) && w >= 1 ? w : 1;
}

/** Claude Code's prompt and menu cursor, U+276F. Its absence for
 *  `NOT_CLAUDE_MS` is the one sign that the pane is something else. */
export const PROMPT_GLYPH = '❯';
/** How long a screen may go without `PROMPT_GLYPH` before the wrapped view
 *  offers the grid (spec §5.3). A display hint: it decides nothing sent. */
export const NOT_CLAUDE_MS = 2000;

/** Whether any row carries the prompt glyph. A reply that quotes `1. …` and
 *  `2. …` is still Claude Code's (its box carries the glyph); vim and less
 *  carry none. */
export function showsPrompt(rows: readonly string[]): boolean {
  return rows.some((r) => r.includes(PROMPT_GLYPH));
}

/** The index of the caret cell in a visual row, or −1. */
export function caretIndex(row: VisualRow): number {
  return row.cells.findIndex(isCaret);
}

/**
 * The visual row the wrapped view keeps in sight: the caret's row (the box the
 * operator is typing into), else the last row holding the prompt glyph (a
 * menu's selected option), else null.
 */
export function anchorRow(rows: readonly VisualRow[]): number | null {
  const caret = rows.findIndex((r) => caretIndex(r) >= 0);
  if (caret >= 0) return caret;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.cells.some((c) => c.ch === PROMPT_GLYPH)) return i;
  }
  return null;
}

/**
 * The view chip's words: the legend on the chip, and the sentence assistive
 * tech reads, which names the view, why, and what a tap does. It took over
 * the `pans` notice's sentence (D-5005): a forced grid on a glass it does not
 * fit is the one case where the console scrolls sideways.
 */
export function viewChip(view: DrawerViewKind, clipped: boolean): { legend: string; label: string } {
  if (view === 'wrapped') {
    return {
      legend: 'wrapped',
      label: `Wrapped view: the session window is ${PINNED_WINDOW_COLS} columns wide, so its lines are `
        + 're-wrapped to this screen. Show the grid',
    };
  }
  if (clipped) {
    return {
      legend: 'grid · scrolls',
      label: `Grid view: the session window is ${PINNED_WINDOW_COLS} columns wide, wider than this `
        + 'screen, so the console scrolls sideways. Wrap it to this screen',
    };
  }
  return {
    legend: 'grid',
    label: `Grid view: the session window's ${PINNED_WINDOW_COLS} columns, as tmux draws them. `
      + 'Wrap it to this screen',
  };
}
