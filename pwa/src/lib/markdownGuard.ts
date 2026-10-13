// The Markdown pre-scan and the UTF-8 byte count (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10).
// `prescanMarkdown` runs before any parse, in chat's synchronous path and in the parse worker: one iterative pass
// over the lines that refuses two shapes. The first is more container markers on one line than the spec allows: a
// `>` run of 10 000 makes the parser throw a RangeError, so this is the shape the pre-scan exists for. Container
// depth is counted on every line, fenced or not, and a tab advances to the next multiple of 4 columns as CommonMark
// does. The second is a run of one emphasis delimiter longer than the spec allows: a bound the spec sets, not a
// measured overflow. The pre-scan is a cheap first line, not a proof. Nesting built across lines by indentation
// is not seen by it, and it does not claim to prevent every overflow. What bounds the rest is, in order: this
// pre-scan for the shapes it covers; `parseMarkdown`'s try/catch, which turns any exception into 'threw';
// `MD_MAX_TREE_DEPTH`, which turns a deep tree into 'too-deep'; and the worker's budget, the only time bound.
//
// Imports only `markdownLimits.ts`: the parse worker's closure reaches this file (`markdown-purity.test.ts`).
import { MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN } from './markdownLimits';

export type PrescanResult =
  | { ok: true }
  | { ok: false; why: 'container-depth' | 'delimiter-run'; line: number; value: number };

/** The open fence a line starts (up to 3 spaces, then 3 or more backticks or tildes), or `undefined`. A backtick
 *  fence's info string may not contain a backtick (CommonMark), so "```a`b" opens nothing. */
function fenceOpen(line: string): { ch: string; len: number } | undefined {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 0x20) i += 1;
  const ch = line[i];
  if (ch !== '`' && ch !== '~') return undefined;
  let j = i;
  while (line[j] === ch) j += 1;
  if (j - i < 3) return undefined;
  if (ch === '`' && line.indexOf('`', j) !== -1) return undefined;
  return { ch, len: j - i };
}

/** Whether `line` closes a fence of `ch` at least `len` long: up to 3 spaces, the run, then only spaces or tabs. */
function fenceCloses(line: string, ch: string, len: number): boolean {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 0x20) i += 1;
  let j = i;
  while (line[j] === ch) j += 1;
  if (j - i < len) return false;
  for (; j < line.length; j += 1) {
    const c = line.charCodeAt(j);
    if (c !== 0x20 && c !== 0x09) return false;
  }
  return true;
}

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isBlank = (c: number): boolean => c === 0x20 || c === 0x09;

/** The columns a blank at `line[i]` spans when it starts at column `col`: a space is 1, a tab runs to the next
 *  multiple of 4, anything else 0. */
function blankWidth(line: string, i: number, col: number): number {
  const c = line.charCodeAt(i);
  return c === 0x20 ? 1 : c === 0x09 ? 4 - (col % 4) : 0;
}

/** The index just past the `:` of a GFM footnote-definition label (`[^label]:`) that starts at `line[i]`, or -1 when
 *  none does. A label is 1 to 999 characters with no whitespace and no `[`; a `]` ends it unless a backslash escapes
 *  it (`\[`, `\]` and `\\` are two characters each), and it needs at least one character. */
function footnoteLabelEnd(line: string, i: number): number {
  if (line.charCodeAt(i + 1) !== 0x5e /* ^ */) return -1;
  let j = i + 2;
  let size = 0;
  for (;;) {
    const c = line.charCodeAt(j);
    if (size > 999 || Number.isNaN(c) || c === 0x5b /* [ */ || isBlank(c)) return -1;
    if (c === 0x5d /* ] */) {
      if (j === i + 2) return -1;
      return line.charCodeAt(j + 1) === 0x3a /* : */ ? j + 2 : -1;
    }
    size += 1;
    j += 1;
    const d = line.charCodeAt(j);
    if (c === 0x5c /* \ */ && (d === 0x5b || d === 0x5c || d === 0x5d)) {
      size += 1;
      j += 1;
    }
  }
}

/** The container depth of one line, with tabs counted by column as CommonMark does. Repeatedly: skip up to 3
 *  columns of indentation, then consume `>` (and one optional space or tab column), a list marker (`-`, `+`, `*`, or
 *  1-9 digits then `.` or `)`) together with the blanks it needs, or a footnote-definition label (`[^a]:`) with all
 *  the blanks after it (the parser eats them, so no indented code follows). A tab after `>` is only partly used by
 *  the optional space; the rest of its columns count as indentation for the next marker. After a list marker, 1 to
 *  4 columns of blanks are its padding and 5 or more make what follows indented code. The count runs to the end of
 *  the markers, so a refusal reports the line's whole depth. */
function containerDepth(line: string): number {
  let depth = 0;
  let i = 0;
  let col = 0;
  let carried = 0;
  for (;;) {
    let indent = carried;
    carried = 0;
    for (;;) {
      const w = blankWidth(line, i, col);
      if (w === 0 || indent + w > 3) break;
      i += 1;
      col += w;
      indent += w;
    }
    const c = line.charCodeAt(i);
    if (c === 0x3e /* > */) {
      i += 1;
      col += 1;
      depth += 1;
      const w = blankWidth(line, i, col);
      if (w > 0) {
        i += 1;
        col += w;
        carried = w - 1;
      }
      continue;
    }
    if (c === 0x5b /* [ */) {
      const after = footnoteLabelEnd(line, i);
      if (after < 0) return depth;
      depth += 1;
      col += after - i;
      i = after;
      while (blankWidth(line, i, col) > 0) {
        col += blankWidth(line, i, col);
        i += 1;
      }
      continue;
    }
    let end = -1;
    if ((c === 0x2d /* - */ || c === 0x2b /* + */ || c === 0x2a /* * */) && isBlank(line.charCodeAt(i + 1))) {
      end = i + 1;
    } else if (isDigit(c)) {
      let j = i;
      while (isDigit(line.charCodeAt(j))) j += 1;
      const d = line.charCodeAt(j);
      if (j - i <= 9 && (d === 0x2e /* . */ || d === 0x29 /* ) */) && isBlank(line.charCodeAt(j + 1))) end = j + 1;
    }
    if (end < 0) return depth;
    depth += 1;
    col += end - i;
    let k = end;
    let cols = 0;
    for (let w = blankWidth(line, k, col + cols); w > 0; w = blankWidth(line, k, col + cols)) {
      k += 1;
      cols += w;
    }
    if (cols > 4) return depth;
    i = k;
    col += cols;
  }
}

/** The longest run of `*` or of `_` on one line (a run is one character repeated). */
function longestRun(line: string): number {
  let best = 0;
  let run = 0;
  let prev = -1;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charCodeAt(i);
    if (c === 0x2a || c === 0x5f) {
      run = c === prev ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prev = c;
  }
  return best;
}

/** The two limits a pre-scan applies: the most container markers on one line and the longest delimiter run. */
export interface PrescanLimits {
  readonly containerDepth: number;
  readonly delimiterRun: number;
}

/** One pass over the lines (LF, CRLF and CR each end one): the first line whose container depth is over
 *  `limits.containerDepth`, or whose longest delimiter run is over `limits.delimiterRun`, refuses, with its 1-based
 *  number and its measured value. The depth is counted on every line, because this scan does not know where the
 *  parser's containers end, so it cannot know where a fence really does; only the delimiter-run check skips fenced
 *  blocks (a fence is tracked by its own delimiter run). An unclosed fence runs to the end. Production calls it only through `prescanMarkdown`; tests call it with lower
 *  limits to measure how deep a real document goes. */
export function prescanWithin(src: string, limits: PrescanLimits): PrescanResult {
  const lines = src.split(/\r\n|\r|\n/);
  let fence: { ch: string; len: number } | undefined;
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n]!;
    const depth = containerDepth(line);
    if (depth > limits.containerDepth) return { ok: false, why: 'container-depth', line: n + 1, value: depth };
    if (fence !== undefined) {
      if (fenceCloses(line, fence.ch, fence.len)) fence = undefined;
      continue;
    }
    fence = fenceOpen(line);
    if (fence !== undefined) continue;
    const run = longestRun(line);
    if (run > limits.delimiterRun) return { ok: false, why: 'delimiter-run', line: n + 1, value: run };
  }
  return { ok: true };
}

/** The pre-scan at `MD_MAX_CONTAINER_DEPTH` and `MD_MAX_DELIMITER_RUN`: what runs before every parse. */
export function prescanMarkdown(src: string): PrescanResult {
  return prescanWithin(src, { containerDepth: MD_MAX_CONTAINER_DEPTH, delimiterRun: MD_MAX_DELIMITER_RUN });
}

/** The UTF-8 byte length of `s`, counted without allocating: a surrogate pair is 4 bytes, and a lone surrogate is
 *  3 (`TextEncoder` writes it as U+FFFD). */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
