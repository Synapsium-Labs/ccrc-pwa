// One backward walk over a JSONL file read through the FleetIO range read (D-6434): from EOF toward offset 0 in
// chunks of the caller's sizes, each chunk joined to the first piece of the one after it, so a line that straddles a
// boundary is whole in the older segment. The two readers that walk a transcript backward share it: a done agent's
// last usage line (`workflows/read.ts`) and the slash menu's skill listing (`commands.ts`). What a segment MEANS is
// the caller's; this file only frames bytes, and it decodes nothing (a boundary can split a multibyte character).
import type { FleetIO, ReadFailure } from './io.js';

/** One segment of a backward walk: the chunk just read plus the piece carried from the chunk after it.
 *  `bytes` = chunk ++ carried; `cut` = the length of the leading cut piece (0 when `start` is 0, where the first line
 *  is whole; `bytes.length` when the chunk holds no newline); `start` = the chunk's file offset. */
export interface BackSegment { bytes: Uint8Array; cut: number; start: number }

export type BackStep = { ok: true; segment: BackSegment } | { ok: false; reason: ReadFailure };

/** Walk `file` (of `size` bytes) backward, one read of `sizes[i]` bytes at most per `next()`.
 *  `more()` says a read remains: a size is left and the walk has not reached offset 0.
 *  Failure contract: a read that is not ok answers its reason, so a caller tells absent from unreadable.
 *  Framing relies on `readFileFromBytesMeasured`'s contract that an ok read is exactly `min(maxBytes, size - offset)`
 *  bytes: `localIO` answers `unreadable` for fewer (`io.ts`, the `bytes.length !== owed` check) and the remote adapter
 *  likewise (`remote/io.ts`, the `bytes.length !== Math.min(maxBytes, size - offset)` check), so a short read never
 *  joins non-adjacent bytes into one segment. */
export function walkBack(io: FleetIO, file: string, size: number, sizes: readonly number[]):
  { more(): boolean; next(): Promise<BackStep> } {
  let end = size;
  let i = 0;
  let carry = new Uint8Array(0); // the cut first piece of the segment read last
  return {
    more: () => i < sizes.length && end > 0,
    async next() {
      const start = Math.max(0, end - sizes[i++]!);
      const r = await io.readFileFromBytesMeasured(file, start, Math.max(1, end - start));
      if (!r.ok) return { ok: false, reason: r.reason };
      const bytes = new Uint8Array(r.bytes.length + carry.length);
      bytes.set(r.bytes, 0);
      bytes.set(carry, r.bytes.length);
      const nl = r.bytes.indexOf(10);
      carry = nl < 0 ? bytes : bytes.slice(0, nl + 1);
      end = start;
      return { ok: true, segment: { bytes, cut: start === 0 ? 0 : carry.length, start } };
    },
  };
}

/** The whole lines of a segment, oldest first: the bytes after `cut`, split on the newline byte (no empty pieces). */
export function wholeLines(seg: BackSegment): Uint8Array[] {
  const out: Uint8Array[] = [];
  let from = seg.cut;
  for (let nl = seg.bytes.indexOf(10, from); nl >= 0; nl = seg.bytes.indexOf(10, from)) {
    if (nl > from) out.push(seg.bytes.subarray(from, nl));
    from = nl + 1;
  }
  if (from < seg.bytes.length) out.push(seg.bytes.subarray(from));
  return out;
}
