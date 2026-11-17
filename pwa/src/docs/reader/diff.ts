// The reader's bounded client line diff (native Docs reader, completion plan Task 11). Ring L1: a pure function of two
// strings, no I/O, no DOM, no timer, no worker; it imports only the L0 byte counter and the L0 Docs byte cap, so the
// reader's change marks and nothing else decide what a line is and when the answer is refused.
//
// `readerDiff(before, after)` answers which lines of `after` are new (`ranges`) and after which of its lines something
// of `before` is gone (`removedAfter`), in the numbering of the rendered `data-line`. The line model is the Markdown
// parser's: CRLF, a lone CR and LF each end one line, and the last line ending starts no line (`''` has no line, `'a\n'`
// has one, `'\n'` has one empty line). Lines compare as exact strings.
//
// The answer is bounded and all-or-nothing. A refusal names its bound and carries no partial result, and the bounds are
// decided in this order, each before the next stage's work: `bytes` (a side over `DOCS_MAX_DOC_BYTES` UTF-8 bytes),
// `lines` (a side over `READER_DIFF_MAX_LINES` lines), `work` (the search used more than `READER_DIFF_MAX_WORK` units)
// and `output` (more than `READER_DIFF_MAX_MARKS` marks, where a mark is one range or one removal: the two counts are
// added, the stricter reading of the spec's "512 output ranges/removals").
//
// The search trims the common head and tail, interns the middle lines to integers, and runs Myers' O(ND) greedy
// algorithm on what is left, keeping only the band of the frontier each step wrote (2d + 1 cells for step d), never a
// matrix. One counter pays for every unit: each line comparison (the trims and every compare in a snake, the failing one
// included), each frontier advance (one per (d, k) visited) and each trace cell copied. The moment it passes the cap the
// search returns `work`; there is no second algorithm behind it. When one side of the middle is empty the answer is the
// whole other side and nothing is searched. The same input always gives the same answer: a tie in a frontier takes the
// standard down move.
import { DOCS_MAX_DOC_BYTES } from '../../../../shared/docs';
import { utf8Bytes } from '../../../../shared/utf8';

/** What `readerDiff` answers. Lines are 1-based in the after text, ranges inclusive, ascending and apart; a removal is
 *  marked after the surviving line before its gap, and 0 means before the first line. */
export type ReaderDiff =
  | {
      kind: 'available';
      ranges: readonly (readonly [number, number])[];
      removedAfter: readonly number[];
    }
  | { kind: 'unavailable'; why: 'bytes' | 'lines' | 'work' | 'output' };

/** The most lines either side of a diff may have (the spec's 20 000). */
export const READER_DIFF_MAX_LINES = 20000;

/** The most work units one diff may use: line comparisons, frontier advances and copied trace cells (the spec's 2 000 000). */
export const READER_DIFF_MAX_WORK = 2000000;

/** The most marks, ranges plus removals, one diff may answer (the spec's 512). */
export const READER_DIFF_MAX_MARKS = 512;

const LINE_ENDING = /\r\n?|\n/;
const ENDS_WITH_LINE_ENDING = /(?:\r\n?|\n)$/;

/** The text's lines as the Markdown parser counts them. */
function splitLines(s: string): string[] {
  if (s === '') return [];
  const parts = s.split(LINE_ENDING);
  if (ENDS_WITH_LINE_ENDING.test(s)) parts.pop();
  return parts;
}

/** One edit step on the path from before to after: a line both texts hold, a line only after holds, or a line only before holds. */
const KEEP = 0;
const INSERT = 1;
const DELETE = 2;

/**
 * The edit path of the middle lines `a` (before) against `b` (after), as steps in order, or null when the search used
 * more than `READER_DIFF_MAX_WORK` units. `spent` is what the trims' comparisons already used of that one budget.
 */
function search(a: Int32Array, b: Int32Array, spent: number): Uint8Array | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    const only = new Uint8Array(n + m);
    only.fill(n === 0 ? INSERT : DELETE);
    return only;
  }
  let work = spent;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      work += 1;
      if (work > READER_DIFF_MAX_WORK) return null;
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m) {
        work += 1;
        if (work > READER_DIFF_MAX_WORK) return null;
        if (a[x] !== b[y]) break;
        x += 1;
        y += 1;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found < 0) {
      work += 2 * d + 1;
      if (work > READER_DIFF_MAX_WORK) return null;
      trace.push(v.slice(off - d, off + d + 1));
    }
  }
  // Walk back from (n, m) through the bands: step d came from step d - 1's band by a down move (an insertion) or a right
  // move (a deletion), then slid down a diagonal of kept lines.
  const back: number[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && prev[k - 1 + d - 1]! < prev[k + 1 + d - 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[prevK + d - 1]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      back.push(KEEP);
      x -= 1;
      y -= 1;
    }
    back.push(down ? INSERT : DELETE);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    back.push(KEEP);
    x -= 1;
    y -= 1;
  }
  const steps = new Uint8Array(back.length);
  for (let i = 0; i < back.length; i += 1) steps[i] = back[back.length - 1 - i]!;
  return steps;
}

/** The lines of `after` that `before` lacks, and where lines of `before` are gone, or the name of the bound that refused it. */
export function readerDiff(before: string, after: string): ReaderDiff {
  if (utf8Bytes(before) > DOCS_MAX_DOC_BYTES || utf8Bytes(after) > DOCS_MAX_DOC_BYTES) {
    return { kind: 'unavailable', why: 'bytes' };
  }
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  if (beforeLines.length > READER_DIFF_MAX_LINES || afterLines.length > READER_DIFF_MAX_LINES) {
    return { kind: 'unavailable', why: 'lines' };
  }

  // Trim the common head, then the common tail of what is left; every comparison is a unit of work.
  let work = 0;
  const shortest = Math.min(beforeLines.length, afterLines.length);
  let head = 0;
  while (head < shortest) {
    work += 1;
    if (beforeLines[head] !== afterLines[head]) break;
    head += 1;
  }
  let tail = 0;
  while (tail < shortest - head) {
    work += 1;
    if (beforeLines[beforeLines.length - 1 - tail] !== afterLines[afterLines.length - 1 - tail]) break;
    tail += 1;
  }

  // Intern the middle lines to integers, so a comparison in the search is an integer compare (interning is not counted).
  const ids = new Map<string, number>();
  const intern = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = new Int32Array(beforeLines.length - head - tail);
  const b = new Int32Array(afterLines.length - head - tail);
  for (let i = 0; i < a.length; i += 1) a[i] = intern(beforeLines[head + i]!);
  for (let i = 0; i < b.length; i += 1) b[i] = intern(afterLines[head + i]!);

  const steps = search(a, b, work);
  if (steps === null) return { kind: 'unavailable', why: 'work' };

  // Walk the path once. `survivor` is the after-number of the last line both texts hold (0 before the first), and a gap
  // between two survivors that lost a line is one removal, marked after the survivor before it.
  const ranges: [number, number][] = [];
  const removedAfter: number[] = [];
  let afterNumber = head;
  let survivor = head;
  let lostInGap = false;
  const keep = (): void => {
    if (lostInGap) {
      removedAfter.push(survivor);
      lostInGap = false;
    }
    afterNumber += 1;
    survivor = afterNumber;
  };
  for (const step of steps) {
    if (step === KEEP) {
      keep();
    } else if (step === INSERT) {
      afterNumber += 1;
      const last = ranges[ranges.length - 1];
      if (last !== undefined && last[1] === afterNumber - 1) last[1] = afterNumber;
      else ranges.push([afterNumber, afterNumber]);
    } else {
      lostInGap = true;
    }
  }
  if (tail > 0) keep();
  else if (lostInGap) removedAfter.push(survivor);

  if (ranges.length + removedAfter.length > READER_DIFF_MAX_MARKS) return { kind: 'unavailable', why: 'output' };
  return { kind: 'available', ranges, removedAfter };
}
