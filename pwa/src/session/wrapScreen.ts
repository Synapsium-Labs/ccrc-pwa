/**
 * The wrapped view's re-wrap (spec 2026-10-14 §5.3; D-5006).
 *
 * The drawer's model is Claude Code's own screen: 50 rows laid out by Claude
 * Code for a 220-column window (`readModel`, `drawerModel.ts`). A glass
 * narrower than that gets the same screen re-wrapped to its own width W:
 *
 * - each row is classified: blank (a run collapses to one row), rule (box-drawing
 *   rule characters at least srcCols / 2 long; one cell is kept for its colour),
 *   table (a box frame with inner `│┼┬┴`; never wrapped, it scrolls sideways),
 *   right (a segment after 8 or more spaces that reaches the right edge; its own
 *   row), or prose;
 * - a prose row joins the next one only when all four of the spec's conditions
 *   hold, which reverses Claude Code's own word wrap and nothing else; the join
 *   is a space, except after a row that is one token Claude Code hard-broke;
 * - prose is word-wrapped at W under a hanging indent taken from its marker or
 *   gutter (`● `, `⎿  `, `❯ `, `1. `, `│ `, `[ ]`, code line numbers), capped at
 *   W / 3; a token wider than the row is hard-broken, never inside a wide cell.
 *
 * At W >= srcCols the screen is returned as it is: one visual row per source
 * row. Every visual cell carries `src`, the source cell it shows, so a reader of
 * the wrapped view maps back to the 220-column model; inserted cells (an
 * indent, a join space) carry `null` and column −1.
 *
 * Nothing here chooses a key: the visual geometry is for display only, and a
 * keystroke is never derived from a visual row (spec §8, I5).
 *
 * PURE: no React, no DOM; it imports only the model's types and `isCaret`.
 */
import type { CellStyle, ModelCell, ModelRow } from './drawerModel';
import { isCaret } from './drawerModel';

export type VisualKind = 'text' | 'rule' | 'table' | 'right' | 'blank';
export interface SourceRef { row: number; col: number }
export interface VisualRow {
  kind: VisualKind;
  cells: readonly ModelCell[];
  /** One entry per cell: the source cell it shows, or null for inserted padding or a join space. */
  src: readonly (SourceRef | null)[];
}

/** The style of an inserted cell: the well's own ink and background. */
const DEFAULT_STYLE: CellStyle = Object.freeze({
  fg: -1, fgMode: 'default', bg: -1, bgMode: 'default',
  bold: false, dim: false, italic: false, underline: false, inverse: false,
}) as CellStyle;

/** One inserted space: indentation, or the space a join puts between two rows. */
const INSERTED: ModelCell = Object.freeze({ ch: ' ', width: 1, col: -1, style: DEFAULT_STYLE }) as ModelCell;

/** A list marker or gutter at the start of a row's text (after its leading spaces). Claude
 *  Code's input box draws its prompt as `❯` and a no-break space. */
const MARKER_RE = /^(?:[●✻✽✶✢*•❯-][ \u00a0](?:\d{1,3}\. )?(?:\[.\] )?|⎿ +|│ |\d{1,3}\. (?:\[.\] )?|\[.\] |\d{1,5} +(?=\S))/u;

const RULE_CHARS = new Set('─━═╌╍┄┅┈┉');
const TABLE_LEFT = new Set('┌├└│');
const TABLE_RIGHT = new Set('┐┤┘│');
const TABLE_INNER = new Set('│┼┬┴');
/** The spaces before a right-aligned segment. */
const RIGHT_GAP = 8;
/** How close to the right edge a right-aligned segment ends. */
const RIGHT_EDGE_SLACK = 2;
/** J3: Claude Code wraps a little short of the edge. */
const WRAP_SLACK = 6;

/** A cell a wrap may break at. The caret is a reverse-video space and is never one. */
const isBreakSpace = (c: ModelCell): boolean => c.ch === ' ' && !isCaret(c);

const cellsWidth = (cells: readonly ModelCell[]): number => {
  let w = 0;
  for (const c of cells) w += c.width;
  return w;
};

const lead = (row: readonly ModelCell[]): number => {
  let i = 0;
  while (i < row.length && isBreakSpace(row[i]!)) i++;
  return i;
};

/** The marker's width in cells: every marker character is a narrow single code point. */
const marker = (row: readonly ModelCell[]): number => {
  let rest = '';
  for (let i = lead(row); i < row.length; i++) rest += row[i]!.ch;
  const m = MARKER_RE.exec(rest);
  return m ? [...m[0]].length : 0;
};

const hang = (row: readonly ModelCell[]): number => lead(row) + marker(row);

/** The width of the first run of word cells after the leading spaces. */
const firstWord = (row: readonly ModelCell[]): number => {
  let w = 0;
  for (let i = lead(row); i < row.length && !isBreakSpace(row[i]!); i++) w += row[i]!.width;
  return w;
};

/** Where the row's text ends: a trailing styled space (not trimmed by the model) is no text. */
const textWidth = (row: readonly ModelCell[]): number => {
  for (let i = row.length - 1; i >= 0; i--) if (!isBreakSpace(row[i]!)) return row[i]!.col + row[i]!.width;
  return 0;
};

/** The row without its leading and trailing break spaces. */
const trimmed = (row: ModelRow): readonly ModelCell[] => {
  let end = row.length;
  while (end > 0 && isBreakSpace(row[end - 1]!)) end--;
  return row.slice(Math.min(lead(row), end), end);
};

type RowClass = 'blank' | 'rule' | 'table' | 'right' | 'prose';

interface RightSplit { left: readonly ModelCell[]; segment: readonly ModelCell[] }

/** The cells before and after the LAST run of RIGHT_GAP or more spaces that follows a word cell. */
function rightSplit(row: ModelRow, srcCols: number): RightSplit | null {
  if (textWidth(row) < srcCols - RIGHT_EDGE_SLACK) return null;
  let gap: { start: number; end: number } | null = null;
  let sawWord = false;
  let i = 0;
  while (i < row.length) {
    if (!isBreakSpace(row[i]!)) { sawWord = true; i++; continue; }
    const start = i;
    while (i < row.length && isBreakSpace(row[i]!)) i++;
    if (sawWord && i - start >= RIGHT_GAP && i < row.length) gap = { start, end: i };
  }
  return gap ? { left: row.slice(0, gap.start), segment: row.slice(gap.end) } : null;
}

function classify(row: ModelRow, srcCols: number): RowClass {
  if (row.every(isBreakSpace)) return 'blank';
  const t = trimmed(row);
  if (t.every((c) => RULE_CHARS.has(c.ch)) && cellsWidth(t) * 2 >= srcCols) return 'rule';
  const text = t.map((c) => c.ch).join('');
  if (text.length >= 3 && TABLE_LEFT.has(text[0]!) && TABLE_RIGHT.has(text[text.length - 1]!)
      && [...text.slice(1, -1)].some((ch) => TABLE_INNER.has(ch))) return 'table';
  if (rightSplit(row, srcCols)) return 'right';
  return 'prose';
}

/** Cells with their sources, as one run of a paragraph. */
interface Placed { cell: ModelCell; src: SourceRef | null }

const fromRow = (cells: readonly ModelCell[], row: number): Placed[] =>
  cells.map((cell) => ({ cell, src: { row, col: cell.col } }));

const toVisual = (kind: VisualKind, placed: readonly Placed[]): VisualRow => ({
  kind, cells: placed.map((p) => p.cell), src: placed.map((p) => p.src),
});

/**
 * J1–J5 (spec §5.3): `cur` joins `nxt` only when Claude Code's own wrap put the
 * break there: `cur` is long, `nxt`'s first word would not have fitted on it,
 * `nxt` continues at `cur`'s hanging indent, and `nxt` starts no new item.
 */
const joins = (cur: ModelRow, nxt: ModelRow, nxtClass: RowClass, srcCols: number): boolean =>
  nxtClass === 'prose'
  && textWidth(cur) * 2 >= srcCols
  && textWidth(cur) + 1 + firstWord(nxt) > srcCols - WRAP_SLACK
  && lead(nxt) === hang(cur)
  && marker(nxt) === 0;

/**
 * A row that is one unbroken token after its marker: Claude Code hard-broke it
 * (a long path, a run of CJK text), so its continuation joins with no space.
 */
const oneToken = (row: readonly ModelCell[]): boolean => {
  let end = row.length;
  while (end > 0 && isBreakSpace(row[end - 1]!)) end--;
  for (let i = hang(row); i < end; i++) if (isBreakSpace(row[i]!)) return false;
  return true;
};

/**
 * Lay out one paragraph at W. `L` is its leading indent and `H` its hanging
 * indent, both in source cells. A paragraph that fits is one row, unchanged.
 */
function layout(placed: readonly Placed[], L: number, H: number, W: number, kind: VisualKind): VisualRow[] {
  if (cellsWidth(placed.map((p) => p.cell)) <= W) return [toVisual(kind, placed)];
  const cap = Math.floor(W / 3);
  const contIndent = Math.min(H, cap);

  // Alternating separators (break spaces; the first one is empty) and words.
  const pieces: { sep: Placed[]; word: Placed[] }[] = [];
  let i = L;
  while (i < placed.length) {
    const sep: Placed[] = [];
    while (i < placed.length && isBreakSpace(placed[i]!.cell)) sep.push(placed[i++]!);
    const word: Placed[] = [];
    while (i < placed.length && !isBreakSpace(placed[i]!.cell)) word.push(placed[i++]!);
    if (word.length > 0) pieces.push({ sep, word });  // a trailing separator is dropped
  }

  const out: VisualRow[] = [];
  let row: Placed[] = [];
  let width = 0;
  let fresh = true;
  const open = (indent: number): void => {
    row = Array.from({ length: indent }, () => ({ cell: INSERTED, src: null }));
    width = indent;
    fresh = true;
  };
  const emit = (): void => {
    out.push(toVisual(kind, row));
    open(contIndent);
  };
  const append = (cells: readonly Placed[]): void => {
    for (const p of cells) { row.push(p); width += p.cell.width; }
  };
  /** A word wider than a fresh row: cell by cell, a cell never split, a row never empty. */
  const hardBreak = (word: readonly Placed[]): void => {
    for (const p of word) {
      if (width + p.cell.width > W && !fresh) emit();
      append([p]);
      fresh = false;
    }
  };

  open(Math.min(L, cap));
  for (const { sep, word } of pieces) {
    const wordWidth = cellsWidth(word.map((p) => p.cell));
    if (!fresh) {
      const sepWidth = cellsWidth(sep.map((p) => p.cell));
      if (width + sepWidth + wordWidth <= W) {
        append(sep);
        append(word);
        continue;
      }
      // A token no row could hold is hard-broken where it stands, so a marker or a
      // gutter is never left alone on its row.
      if (wordWidth > W - contIndent && width + sepWidth + word[0]!.cell.width <= W) {
        append(sep);
        hardBreak(word);
        continue;
      }
      emit();  // the separator at a break is dropped
    }
    if (width + wordWidth <= W) {
      append(word);
      fresh = false;
    } else {
      hardBreak(word);
    }
  }
  if (!fresh) out.push(toVisual(kind, row));
  return out;
}

/** Re-wrap a 220-column screen to W columns; at W >= srcCols the screen is returned unchanged. */
export function wrapScreen(rows: readonly ModelRow[], W: number, srcCols: number): VisualRow[] {
  if (W >= srcCols) {
    return rows.map((row, i) => {
      const cls = classify(row, srcCols);
      return toVisual(cls === 'right' || cls === 'prose' ? 'text' : cls, fromRow(row, i));
    });
  }
  const cls = rows.map((row) => classify(row, srcCols));
  const out: VisualRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    switch (cls[i]!) {
      case 'blank':
        out.push({ kind: 'blank', cells: [], src: [] });
        while (i < rows.length && cls[i] === 'blank') i++;
        continue;
      case 'rule': {
        const c = trimmed(row)[0]!;
        out.push({ kind: 'rule', cells: [c], src: [{ row: i, col: c.col }] });
        break;
      }
      case 'table':
        out.push(toVisual('table', fromRow(row, i)));
        break;
      case 'right': {
        const { left, segment } = rightSplit(row, srcCols)!;
        out.push(...layout(fromRow(left, i), lead(left), hang(left), W, 'text'));
        out.push(...layout(fromRow(segment, i), 0, 0, W, 'right'));
        break;
      }
      case 'prose': {
        const placed = fromRow(row, i);
        let cur = row;
        while (i + 1 < rows.length && joins(cur, rows[i + 1]!, cls[i + 1]!, srcCols)) {
          const nxt = rows[++i]!;
          while (placed.length > 0 && isBreakSpace(placed[placed.length - 1]!.cell)) placed.pop();
          if (!oneToken(cur)) placed.push({ cell: INSERTED, src: null });
          placed.push(...fromRow(nxt.slice(lead(nxt)), i));
          cur = nxt;
        }
        out.push(...layout(placed, lead(row), hang(row), W, 'text'));
        break;
      }
    }
    i++;
  }
  return out;
}
