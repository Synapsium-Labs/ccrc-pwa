// L1 policy (X2 P1 Task P1.5; X2 spec section 4.3, "Markdown in parts", amended by the coordinator's render-gate
// carry of 2026-11-19): Markdown above the render gate is read in parts no larger than the gate, each part mounting rich
// in the reader frame as its own mount. Pure: it cuts a text, it reads and writes nothing.
//
// The cut, in this order of preference, taking the latest cut of the best kind that keeps the part within `maxBytes`:
//   1. before a top-level heading (an ATX `#` or `##` line) outside a fence;
//   2. after a blank line outside a fence (the next part is "continued");
//   3. after any line outside a fence (continued);
//   4. after a line inside a fence: the part ends with the fence's closing line and the next part reopens it (its
//      marker and the first word of its info string), so a fence longer than the gate still renders as code in every
//      part (continued);
//   5. inside a line longer than the gate, at a code point boundary, never between a surrogate pair (continued).
// Sizes are UTF-8 bytes, counted by `shared/utf8.ts` as the gate counts them; `start` and `end` are string offsets.
// Every part, its added fence lines counted, is at most `maxBytes`. A line ends at `\n`; a `\r` before it is not part
// of what the line is tested as, so a CRLF file cuts as an LF one does. The scan holds O(1) state: one window of at most
// `maxBytes` is scanned per part, never a table of every line, so a 64 MiB text costs no memory beyond the text.
import { utf8Bytes, utf8CodePointBytes } from '../../../../shared/utf8';

/** One part of a text: `text.slice(start, end)`, after `reopen` (a fence's opening line, for a part that starts inside
 *  that fence) and before `close` (the fence's closing line, for a part that ends inside it). `continued` is true for a
 *  part that does not begin at a top-level heading. */
export interface MdPart { start: number; end: number; continued: boolean; reopen: string | null; close: string | null }

/** A part's text as the reader mounts it. */
export function partText(text: string, p: MdPart): string {
  return (p.reopen ?? '') + text.slice(p.start, p.end) + (p.close ?? '');
}

/** Which part a fragment opens (spec 4.3): the first part whose heading ids hold it, as the whole document would name
 *  the first. `ids[k]` is part k's ids from the pre-pass render, or `null` when the budget refused that part (its ids
 *  stay unknown). A fragment no known part holds opens part 0; `note` says whether a part with unknown ids might hold it,
 *  so the page can say why it opened the first part. */
export function partForFragment(ids: readonly (ReadonlySet<string> | null)[], fragment: string): { part: number; note: boolean } {
  for (let k = 0; k < ids.length; k += 1) {
    if (partHolds(ids[k] ?? null, fragment)) return { part: k, note: false };
  }
  return { part: 0, note: ids.some((s) => s === null) };
}

/** Whether a part's ids hold `fragment`, as written or percent-decoded once: `DocLink.tsx#fragmentTarget`'s rule, so a
 *  fragment that finds its heading on the page finds its part. */
export function partHolds(ids: ReadonlySet<string> | null, fragment: string): boolean {
  if (ids === null || fragment === '') return false;
  if (ids.has(fragment)) return true;
  try {
    return ids.has(decodeURIComponent(fragment));
  } catch {
    return false;
  }
}

const HEADING_RE = /^ {0,3}#{1,2}(?:[ \t]|$)/;
const BLANK_RE = /^[ \t]*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** The longest fence marker a part may reopen. A longer marker (a pathological document) is still tracked, so no
 *  heading inside it is a cut, but no cut is made inside it: its fence is not reopenable. */
const REOPEN_MARKER_MAX = 64;
/** The most bytes of the info string's first word a reopened fence carries (its language, for highlighting). */
const REOPEN_INFO_MAX = 64;

/** An open fence: its marker, and the lines a part reopens and closes it with (null when it is not reopenable). */
interface Fence { mark: string; reopen: string | null; close: string | null }

const RANK_HEADING = 4;
const RANK_BLANK = 3;
const RANK_LINE = 2;
const RANK_FENCE = 1;

/** A line's text as tested: without its `\n` and without one `\r` before it. */
function lineAt(text: string, off: number, limit: number, probe?: Probe): { end: number; line: string; bytes: number } {
  // Only `[off, limit)` is looked at, never the rest of a long line. A line that does not end before `limit` ends at
  // `limit` here: it is longer than the window, and its tail is never read.
  const w = text.slice(off, limit);
  const i = w.indexOf('\n');
  const stop = i < 0 ? w.length : i;
  const end = i < 0 ? w.length : i + 1;
  const line = w.slice(0, stop > 0 && w.charCodeAt(stop - 1) === 13 ? stop - 1 : stop);
  const bytes = utf8Bytes(i < 0 ? w : w.slice(0, end));
  if (probe !== undefined) probe.chars += (i < 0 ? w.length : i + 1) + line.length + end;
  return { end: off + end, line, bytes };
}

/** How far past a window's end a line is read: enough for a heading test, which needs six characters of a line. */
const LINE_SLACK = 8;

/** The fence state after `line`, given the state before it. */
function fenceAfter(fence: Fence | null, line: string): Fence | null {
  if (fence === null) {
    const m = FENCE_OPEN_RE.exec(line);
    if (m === null) return null;
    const mark = m[1]!;
    const info = m[2]!;
    if (mark[0] === '`' && info.includes('`')) return null;
    if (mark.length > REOPEN_MARKER_MAX) return { mark, reopen: null, close: null };
    const word = info.trim().split(/[ \t]/)[0] ?? '';
    const keep = word !== '' && utf8Bytes(word) <= REOPEN_INFO_MAX ? word : '';
    return { mark, reopen: mark + (keep === '' ? '' : ' ' + keep) + '\n', close: mark + '\n' };
  }
  const m = FENCE_CLOSE_RE.exec(line);
  return m !== null && m[1]![0] === fence.mark[0] && m[1]!.length >= fence.mark.length ? null : fence;
}

/** The fence a part starting at a cut is inside, for reopening: only a reopenable one. */
const reopenable = (f: Fence | null): Fence | null => (f !== null && f.reopen !== null ? f : null);

/** A test-only counter: `chars` grows by every character the cutter examines (searched, sliced or measured). It changes
 *  nothing the cutter answers; it lets a test bound the work by an operation count, never by wall time. */
export interface Probe { chars: number }

interface Cut { off: number; bytes: number; fence: Fence | null }

/** The largest offset in `[from, to)` whose prefix `text.slice(from, off)` is at most `budget` UTF-8 bytes, at a code
 *  point boundary, and at least one code point past `from`, so a cut always makes progress. */
function codePointCut(text: string, from: number, to: number, budget: number): { off: number; bytes: number } {
  let off = from;
  let bytes = 0;
  while (off < to) {
    const c = text.codePointAt(off)!;
    const w = utf8CodePointBytes(c);
    if (bytes + w > budget && off > from) break;
    bytes += w;
    off += c > 0xffff ? 2 : 1;
  }
  return { off, bytes };
}

/** Cuts `text` into parts of at most `maxBytes` UTF-8 bytes each (above). A text at or below `maxBytes` is one part. */
export function splitMarkdownParts(text: string, maxBytes: number, probe?: Probe): { parts: MdPart[] } {
  if (probe !== undefined) probe.chars += text.length;
  if (utf8Bytes(text) <= maxBytes) return { parts: [{ start: 0, end: text.length, continued: false, reopen: null, close: null }] };
  const parts: MdPart[] = [];
  let start = 0;
  let inside: Fence | null = null; // the reopenable fence this part starts inside
  let state: Fence | null = null; // the fence state at `start`, reopenable or not
  let continued = false;
  while (start < text.length) {
    const reopen = inside === null ? null : inside.reopen;
    const head = reopen === null ? 0 : utf8Bytes(reopen);
    // A part holds at most `maxBytes` bytes, so at most `maxBytes` characters: no line is read past this limit.
    const limit = Math.min(text.length, start + maxBytes + LINE_SLACK);
    // One window: scan lines from `start` while the part still fits, keeping the latest cut of each rank.
    const best: (Cut | undefined)[] = [];
    let off = start;
    let bytes = 0;
    let fence = state;
    let prevRank = RANK_LINE;
    let firstLineEnd = -1;
    let atEnd = false;
    while (off < text.length) {
      const { end, line, bytes: lineBytes } = lineAt(text, off, limit, probe);
      if (firstLineEnd < 0) firstLineEnd = end;
      if (off > start) {
        const rank = fence === null && HEADING_RE.test(line) ? RANK_HEADING : prevRank;
        const tail = fence !== null && fence.close !== null ? utf8Bytes(fence.close) : 0;
        if (rank !== RANK_FENCE || fence?.reopen != null) {
          if (head + bytes + tail <= maxBytes) best[rank] = { off, bytes, fence };
        }
      }
      const blank = fence === null && BLANK_RE.test(line);
      fence = fenceAfter(fence, line);
      if (head + bytes + lineBytes > maxBytes) break;
      bytes += lineBytes;
      off = end;
      prevRank = fence !== null ? RANK_FENCE : blank ? RANK_BLANK : RANK_LINE;
      if (off >= text.length) atEnd = true;
    }
    if (atEnd) {
      parts.push({ start, end: text.length, continued, reopen, close: null });
      break;
    }
    const pick = best[RANK_HEADING] ?? best[RANK_BLANK] ?? best[RANK_LINE] ?? best[RANK_FENCE];
    if (pick !== undefined) {
      const atFence = pick.fence !== null && pick.fence.close !== null ? pick.fence : null;
      parts.push({ start, end: pick.off, continued, reopen, close: atFence === null ? null : atFence.close });
      continued = best[RANK_HEADING] !== pick;
      start = pick.off;
      state = pick.fence;
      inside = reopenable(pick.fence);
      continue;
    }
    // No line boundary fits: the first line is longer than what is left. Cut it at a code point boundary. Inside a
    // reopenable fence, the part closes it on a line of its own and the next part reopens it; when even that leaves no
    // room, the fence is not reopened (a pathological document), so every part still fits and the cut still moves.
    let closeText = inside === null ? null : '\n' + inside.close!;
    let budget = maxBytes - head - (closeText === null ? 0 : utf8Bytes(closeText));
    if (closeText !== null && budget < 4) { closeText = null; budget = maxBytes - head; }
    const cut = codePointCut(text, start, firstLineEnd, budget);
    parts.push({ start, end: cut.off, continued, reopen, close: closeText });
    if (cut.off >= firstLineEnd) {
      // The whole first line went: the fence state moves past it.
      state = fenceAfter(state, lineAt(text, start, limit, probe).line);
      inside = reopenable(state);
    } else if (closeText === null) {
      inside = null;
    }
    start = cut.off;
    continued = true;
  }
  return { parts };
}
