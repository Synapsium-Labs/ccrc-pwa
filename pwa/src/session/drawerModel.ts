/**
 * The 220-column model (spec 2026-10-14 §5.2, §5.3; D-5006).
 *
 * The drawer's one terminal is pinned at the window's own grid, and its buffer
 * is the screen every reader reads: the wrapped view re-wraps it, the key bar's
 * guard reads its last rows, and stage 1b's taps find the menu in it. This
 * module turns that buffer into styled cells. It is PURE: it imports nothing,
 * touches no DOM, and reads xterm only through the slices declared below, so a
 * test hands it a real buffer and nothing else.
 *
 * Its rows are `capture-pane -p`'s rows: `drawer-model-equals-capture.test.ts`
 * holds `rowText(readModel(…))` equal to the capture recorded in the same rig
 * run, on every recorded fixture (W6). That equality is what lets a decision
 * taken on the model and one taken by the server on a capture read one screen.
 */

/** The slices of xterm's `IBufferCell` this reads. METHOD signatures, so a
 *  real `IBuffer` is assignable to `BufferLike` with no cast. */
export interface CellLike {
  getChars(): string;
  getWidth(): number;
  getFgColor(): number;
  getBgColor(): number;
  isFgDefault(): boolean;
  isFgPalette(): boolean;
  isFgRGB(): boolean;
  isBgDefault(): boolean;
  isBgPalette(): boolean;
  isBgRGB(): boolean;
  isBold(): number;
  isDim(): number;
  isItalic(): number;
  isUnderline(): number;
  isInverse(): number;
}
/** The slice of xterm's `IBufferLine` this reads. */
export interface LineLike {
  readonly length: number;
  getCell(x: number, cell?: CellLike): CellLike | undefined;
}
/** The slices of xterm's IBuffer, IBufferLine and IBufferCell this reads, so a test hands it a real buffer. */
export interface BufferLike {
  readonly viewportY: number;
  getLine(y: number): LineLike | undefined;
  getNullCell(): CellLike;
}

export interface CellStyle {
  /** xterm's own value: a palette index, a 24-bit RGB value, or −1 for default. */
  fg: number; fgMode: 'default' | 'palette' | 'rgb';
  bg: number; bgMode: 'default' | 'palette' | 'rgb';
  bold: boolean; dim: boolean; italic: boolean; underline: boolean; inverse: boolean;
}
/** One cell as shown. `col` is the source column, so a wide character's
 *  successor reads its own column (two on), never its trailing half's. */
export interface ModelCell { ch: string; width: 1 | 2; style: CellStyle; col: number }
export type ModelRow = readonly ModelCell[];

const isDefaultStyle = (s: CellStyle): boolean =>
  s.fgMode === 'default' && s.bgMode === 'default'
  && !s.bold && !s.dim && !s.italic && !s.underline && !s.inverse;

const colourMode = (rgb: boolean, palette: boolean): CellStyle['fgMode'] =>
  rgb ? 'rgb' : palette ? 'palette' : 'default';

/**
 * Rows `viewportY` to `viewportY + rows − 1` as styled cells; always `rows`
 * rows. A wide character's trailing half (width 0) is skipped, so the row's
 * text is the one a capture prints. An empty cell is a space, as xterm's own
 * `translateToString` reads it.
 *
 * Trailing cells are trimmed only while they are a space in the DEFAULT style.
 * A trailing cell with any other style is kept, because Claude Code's caret is
 * a reverse-video space and is often the last thing on its row (W11).
 */
export function readModel(buf: BufferLike, srcCols: number, rows: number): ModelRow[] {
  const cell = buf.getNullCell();
  const out: ModelRow[] = [];
  for (let y = buf.viewportY; y < buf.viewportY + rows; y++) {
    const line = buf.getLine(y);
    const row: ModelCell[] = [];
    if (line) {
      const width = Math.min(srcCols, line.length);
      for (let x = 0; x < width; x++) {
        const c = line.getCell(x, cell);
        if (!c) continue;
        const w = c.getWidth();
        if (w === 0) continue;
        row.push({
          ch: c.getChars() || ' ',
          width: w === 2 ? 2 : 1,
          col: x,
          style: {
            fg: c.getFgColor(), fgMode: colourMode(c.isFgRGB(), c.isFgPalette()),
            bg: c.getBgColor(), bgMode: colourMode(c.isBgRGB(), c.isBgPalette()),
            bold: c.isBold() !== 0,
            dim: c.isDim() !== 0,
            italic: c.isItalic() !== 0,
            underline: c.isUnderline() !== 0,
            inverse: c.isInverse() !== 0,
          },
        });
      }
    }
    while (row.length > 0) {
      const last = row[row.length - 1]!;
      if (last.ch !== ' ' || !isDefaultStyle(last.style)) break;
      row.pop();
    }
    out.push(row);
  }
  return out;
}

/** The row's text with trailing spaces trimmed: `capture-pane -p`'s shape. */
export const rowText = (row: ModelRow): string => row.map((c) => c.ch).join('').replace(/ +$/, '');

/** A reverse-video cell: Claude Code's caret (W11). */
export function isCaret(cell: ModelCell): boolean {
  return cell.style.inverse;
}

/**
 * The 16-colour palette, in xterm's ANSI 0–15 order (black red green yellow
 * blue magenta cyan white, then the eight bright ones). ONE home: the
 * terminal's `glass()` theme and the wrapped view's `cellCss` both read it.
 *
 * On-brand ANSI palette (Phosphor & Ink) so 16-colour content reads
 * cohesively. 256/truecolor content bypasses this and paints direct —
 * Claude emits truecolor once COLORTERM+tmux RGB are in place (ccd spawn).
 */
export const GLASS_ANSI = [
  '#1B1F1D', '#F08A78', '#57E08B', '#F2B84B',
  '#96B4F4', '#C7A7F4', '#6FD6EA', '#ADB6AE',
  '#5A635C', '#FF9E8A', '#7BEDA6', '#FFD27A',
  '#B3C8FF', '#DDC2FF', '#93E6F5', '#EDF1EE',
] as const;

const hex = (v: number): string => `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;

/** xterm's 256-colour palette above 15: the 6×6×6 cube, then the grey ramp. */
const palette256 = (n: number): string => {
  if (n >= 232) {
    const g = 8 + 10 * (n - 232);
    return hex((g << 16) | (g << 8) | g);
  }
  const i = n - 16;
  const level = (v: number): number => (v === 0 ? 0 : 55 + 40 * v);
  return hex((level(Math.floor(i / 36)) << 16) | (level(Math.floor(i / 6) % 6) << 8) | level(i % 6));
};

const resolve = (v: number, mode: CellStyle['fgMode']): string | undefined => {
  if (mode === 'rgb') return hex(v);
  if (mode === 'palette') return v >= 0 && v < 16 ? GLASS_ANSI[v] : palette256(v);
  return undefined;
};

/**
 * A cell's style as inline CSS, from a CLOSED set of six properties (the
 * wrapped view renders cells as text; nothing else of the pane reaches the
 * DOM). Default colours are `undefined`, so the well's own ink and background
 * show. Inverse swaps foreground and background, the well's background and ink
 * standing in for a default one, so the caret reads as a block.
 */
export function cellCss(style: CellStyle): Readonly<Record<'color' | 'backgroundColor' | 'fontWeight' | 'fontStyle' | 'textDecoration' | 'opacity', string | undefined>> {
  const fg = resolve(style.fg, style.fgMode);
  const bg = resolve(style.bg, style.bgMode);
  return {
    color: style.inverse ? (bg ?? 'var(--bg-well)') : fg,
    backgroundColor: style.inverse ? (fg ?? 'var(--ink-on-well)') : bg,
    fontWeight: style.bold ? 'bold' : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    opacity: style.dim ? '0.5' : undefined,
  };
}
