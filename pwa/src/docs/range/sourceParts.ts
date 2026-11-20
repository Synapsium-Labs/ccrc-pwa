// L1 policy (X2 P1, review F1; X2 spec section 4.3): the cutter of a text file shown as source in parts. A text file above
// its class cap, up to the range ceiling, and a stat-pinned text draft of any size are read by range and shown as source,
// one part at a time, each part at most the cap, so each part meets the highlight budgets as a file of that size would.
// Pure: no I/O, no DOM, one pass over the text (a character is scanned at most twice, the second time only when it
// follows a part's last line end), sizes counted in UTF-8 bytes as `utf8Bytes` counts them.
//
// Where a part ends: at the last line end (a `\n`) that leaves it within `maxBytes`; a part with no line end in it (one
// line longer than the part) is cut at a code point boundary, never inside a surrogate pair, and the part after it is
// `continued`. A `\r\n` is never split: a cut that would fall between the two backs off before the `\r`.
import { utf8CodePointBytes } from '../../../../shared/utf8';

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
export function splitSourceParts(text: string, maxBytes: number): { parts: SourcePart[]; bytes: number } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < SOURCE_PART_MIN_BYTES) {
    throw new RangeError(`splitSourceParts: maxBytes must be a whole number of at least ${String(SOURCE_PART_MIN_BYTES)}`);
  }
  const parts: SourcePart[] = [];
  const n = text.length;
  let start = 0;
  let i = 0;
  let partBytes = 0;
  // The offset after the last `\n` in the part being scanned, and the part's bytes up to it; -1: none yet.
  let lineEnd = -1;
  let lineEndBytes = 0;
  let total = 0;
  const close = (end: number, bytes: number): void => {
    parts.push({ start, end, bytes, continued: start > 0 && text.charCodeAt(start - 1) !== LF });
    total += bytes;
    start = end;
    i = end;
    partBytes = 0;
    lineEnd = -1;
    lineEndBytes = 0;
  };
  while (i < n) {
    const cp = text.codePointAt(i)!;
    const w = utf8CodePointBytes(cp);
    if (partBytes + w > maxBytes) {
      if (lineEnd > start) {
        close(lineEnd, lineEndBytes);
      } else if (i - 1 > start && text.charCodeAt(i) === LF && text.charCodeAt(i - 1) === CR) {
        close(i - 1, partBytes - 1);
      } else {
        close(i, partBytes);
      }
      continue;
    }
    partBytes += w;
    i += cp > 0xffff ? 2 : 1;
    if (cp === LF) {
      lineEnd = i;
      lineEndBytes = partBytes;
    }
  }
  if (start < n || parts.length === 0) close(n, partBytes);
  return { parts, bytes: total };
}
