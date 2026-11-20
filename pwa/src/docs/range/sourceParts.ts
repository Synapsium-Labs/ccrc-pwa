// L1 policy (X2 P1, review F1; X2 spec section 4.3): the cutter of a text file shown as source in parts. A text file above
// its class cap, up to the range ceiling, and a stat-pinned text draft of any size are read by range and shown as source,
// one part at a time, each part at most the cap, so each part meets the highlight budgets as a file of that size would.
// Pure: no I/O, no DOM. The text can be 64 MiB on the main thread, so the scan goes a LINE at a time: `indexOf('\n')`
// finds the next line end, `utf8Bytes` counts the run, and only a line that overflows a part is walked code point by code
// point (at most one part's worth of it). A character is read a bounded number of times: at most twice by a count (once
// in the part that cut before its line, again in the next), and a line longer than the part's room is never counted, only
// walked once. Sizes are UTF-8 bytes, as `utf8Bytes` counts them.
//
// Where a part ends: at the last line end (a `\n`) that leaves it within `maxBytes`; a part with no line end in it (one
// line longer than the part) is cut at a code point boundary, never inside a surrogate pair, and the part after it is
// `continued`. A `\r\n` is never split: a cut that would fall between the two backs off before the `\r`.
import { utf8Bytes, utf8CodePointBytes } from '../../../../shared/utf8';

/** One part: the string offsets it spans (`end` exclusive), its UTF-8 bytes, and whether it carries on a line the part
 *  before it left unfinished (it does not start at a line start). */
export interface SourcePart { readonly start: number; readonly end: number; readonly bytes: number; readonly continued: boolean }

const LF = 10;
const CR = 13;

/** The smallest part that can hold any one code point. */
export const SOURCE_PART_MIN_BYTES = 4;

/**
 * Cuts `text` into parts of at most `maxBytes` UTF-8 bytes each. Text that fits is one part (the empty text too). Every
 * part is non-empty, the parts are contiguous and cover the whole text, and none passes `maxBytes`. Throws `RangeError` for
 * a `maxBytes` below `SOURCE_PART_MIN_BYTES`, which no part could honour.
 */
export function splitSourceParts(text: string, maxBytes: number): { parts: SourcePart[] } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < SOURCE_PART_MIN_BYTES) {
    throw new RangeError(`splitSourceParts: maxBytes must be a whole number of at least ${String(SOURCE_PART_MIN_BYTES)}`);
  }
  const parts: SourcePart[] = [];
  const n = text.length;
  let start = 0;
  // The next line end at or after the scan position, searched for once: a line end found beyond a part's end stays found
  // for the next part, and -1 (none left) is never searched for again.
  let nextLf = -2;
  const lfFrom = (from: number): number => {
    if (nextLf !== -1 && nextLf < from) nextLf = text.indexOf('\n', from);
    return nextLf;
  };
  const close = (end: number, bytes: number): void => {
    parts.push({ start, end, bytes, continued: start > 0 && text.charCodeAt(start - 1) !== LF });
    start = end;
  };
  while (start < n) {
    let pos = start;
    let partBytes = 0;
    // The offset after the last `\n` in this part, and the part's bytes up to it; `start` or less: none yet.
    let lineEnd = start;
    let lineEndBytes = 0;
    for (;;) {
      const lf = lfFrom(pos);
      const runEnd = lf === -1 ? n : lf + 1;
      const room = maxBytes - partBytes;
      // A run of more UTF-16 units than the room holds more bytes than it (a byte at least a unit), so it overflows
      // uncounted; any other run is counted whole.
      const runBytes = runEnd - pos > room ? room + 1 : utf8Bytes(text.slice(pos, runEnd));
      if (runBytes <= room) {
        partBytes += runBytes;
        pos = runEnd;
        if (lf !== -1) { lineEnd = pos; lineEndBytes = partBytes; }
        if (pos >= n) { close(n, partBytes); break; }
        continue;
      }
      if (lineEnd > start) {
        close(lineEnd, lineEndBytes);
        break;
      }
      // One line longer than a part: walk it, a code point at a time, to the first one that does not fit.
      let i = pos;
      let b = partBytes;
      for (;;) {
        const cp = text.codePointAt(i)!;
        const w = utf8CodePointBytes(cp);
        if (b + w > maxBytes) break;
        b += w;
        i += cp > 0xffff ? 2 : 1;
      }
      if (i - 1 > start && text.charCodeAt(i) === LF && text.charCodeAt(i - 1) === CR) close(i - 1, b - 1);
      else close(i, b);
      break;
    }
  }
  if (parts.length === 0) close(0, 0);
  return { parts };
}
