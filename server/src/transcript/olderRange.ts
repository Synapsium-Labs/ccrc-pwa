// L3 adapter (C3 Session Conversation): every read below calls the FleetIO port, through the shared back-reader.
//
// OLDER CHAT RECORD FRAMING (desktop polish run 3531, the isolated slice). One page of complete transcript records,
// read BACKWARD from a cursor the caller holds, in bounded reads: at most `chunks` range reads of at most `chunkBytes`
// each (production: four of the agent link's 256 KiB cap, 1 MiB) and at most `records` records (production: 50). It
// frames BYTES and nothing else: no decoding, no parsing, no event, no file identity. A successful page proves only that
// these bytes were framed from these reads; it does not prove the file is the incarnation an earlier page read (the
// future stream owns identity and authorization, and no browser request feeds this module).
//
// THE WALKER IS THE SHARED ONE (`backread.ts#walkBack`), unchanged. This file wraps the port it hands the walker, to
// refuse a read the walker would join wrongly: a range read that answers fewer bytes than it was asked for (the file no
// longer reaches the cursor) would join non-adjacent bytes, so it is `invalid-boundary` here, never a short page or a
// start. A file that shrank BELOW a read's offset never gets that far: both adapters answer such a read `unreadable`
// themselves, and that word passes through unchanged. So a file that changed under a page reads as `invalid-boundary` or
// as `unreadable`, depending on where it was cut; neither is ever a page.
//
// THE CURSOR. `line-start`: `before` is the first byte of a record (the byte before it is a newline, or `before` is 0).
// The page reads [.., before) and so never reads the record that starts at `before`; the observed byte before it must be
// a newline, checked inside the page's own first read. `skip-record`: `before` lies inside a record too long for a page,
// whose tail an earlier page already skipped. Its bytes are walked, never framed: the walker's carry holds them as
// undecoded bytes, and once the newline that ends the record before it is found, the partial record is dropped and the
// page goes on with the whole records before it. So no suffix of an oversized record, however valid it looks, is ever
// answered as a record. A file whose last bytes have no trailing newline: those bytes are not a record, and a `line-start`
// cursor at the file's size refuses `invalid-boundary` (the byte before it is not a newline). A caller starts such a file
// with `skip-record` at its size, which drops the unterminated tail and answers the whole records before it.
//
// THE CONTINUATION. `start`: the page reached offset 0 and framed every record down to it. `more`: a lower cursor (the
// first byte of the oldest record answered; or, for a skip that has not found its delimiter, the lowest byte read; or the
// first byte of the skipped record when the skip used part of the budget). `gap`: a page that read its whole window from a
// line start framed no record, because the record ending at the cursor is AT LEAST as long as the window. A record exactly
// one window long, its newline included, lands here too: every byte was read, but the page cannot prove the window's
// lowest byte is a line start. The page enters a skip, and the caller marks exactly one gap for it. The next
// cursor is always strictly lower than this one, so repeated pages progress even when a page answers no record.
import type { FleetIO, ReadFailure } from '../io.js';
import { walkBack } from '../backread.js';
import { READ_FROM_MAX_BYTES } from '../../../shared/agent-protocol.js';

export interface OlderRangeCursor { readonly kind: 'line-start' | 'skip-record'; readonly before: number }
export interface OlderRangeLimits { readonly chunkBytes: number; readonly chunks: number; readonly records: number }
/** One record: [start, end) in file bytes, `end` exclusive and including the record's terminating newline; `bytes` are
 *  the record's own bytes, without that newline (an empty array for a blank line). */
export interface OlderRecord { readonly start: number; readonly end: number; readonly bytes: Uint8Array }
export type OlderContinuation =
  | { readonly kind: 'start' }
  | { readonly kind: 'more' | 'gap'; readonly cursor: OlderRangeCursor };
export type OlderRangeRead =
  | { readonly ok: true; readonly records: OlderRecord[]; readonly continuation: OlderContinuation }
  | { readonly ok: false; readonly reason: ReadFailure | 'invalid-boundary' };

/** The production hard caps. A fixture may inject a smaller budget; nothing may raise one of these. */
export const OLDER_RANGE_LIMITS: OlderRangeLimits = Object.freeze({ chunkBytes: READ_FROM_MAX_BYTES, chunks: 4, records: 50 });

const NL = 10;
const START: OlderContinuation = { kind: 'start' };
const INVALID: OlderRangeRead = { ok: false, reason: 'invalid-boundary' };

const within = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= lo && n <= hi;

const validLimits = (l: OlderRangeLimits): boolean =>
  within(l.chunkBytes, 1, OLDER_RANGE_LIMITS.chunkBytes)
  && within(l.chunks, 1, OLDER_RANGE_LIMITS.chunks)
  && within(l.records, 1, OLDER_RANGE_LIMITS.records);

const validCursor = (c: OlderRangeCursor): boolean =>
  (c.kind === 'line-start' || c.kind === 'skip-record') && within(c.before, 0, Number.MAX_SAFE_INTEGER);

/** One page of complete records before `cursor`, oldest first. Failure contract: `absent` and `unreadable` are a read's own
 *  words (`unreadable` includes a read whose offset the file has shrunk below); `invalid-boundary` is a cursor or limits
 *  out of bounds, a line-start cursor whose byte before is not a newline, or a range read that answered fewer bytes than
 *  asked. Any failure discards every record the page had framed. */
export async function readOlderRange(
  io: FleetIO, file: string, cursor: OlderRangeCursor, limits: OlderRangeLimits = OLDER_RANGE_LIMITS,
): Promise<OlderRangeRead> {
  if (!validLimits(limits) || !validCursor(cursor)) return INVALID;
  const { before } = cursor;
  if (before === 0) return { ok: true, records: [], continuation: START };

  // The port the walker reads through: an exact length for every answer. (The walker itself never reads past `before`,
  // more than `chunks` times or more than `chunkBytes` a read: the fixtures' read log pins that, not a check here.)
  let refused = false;
  const exact: FleetIO = Object.create(io, {
    readFileFromBytesMeasured: {
      value: async (p: string, offset: number, maxBytes: number, timeoutMs?: number, signal?: AbortSignal) => {
        const r = await io.readFileFromBytesMeasured(p, offset, maxBytes, timeoutMs, signal);
        if (r.ok && r.bytes.length !== maxBytes) {
          refused = true;
          return { ok: false, reason: 'unreadable' } as const;
        }
        return r;
      },
    },
  });

  const walk = walkBack(exact, file, before, Array<number>(limits.chunks).fill(limits.chunkBytes));
  const newestFirst: OlderRecord[] = [];
  /** A skip whose enclosing delimiter has not been found: the bytes walked so far belong to the skipped record. */
  let skipping = cursor.kind === 'skip-record';
  /** The line start whole-record framing began at: `before` for a line start, the skipped record's first byte after a skip. */
  let framedFrom = before;
  let first = true;
  let lowest = before;

  const answer = (continuation: OlderContinuation): OlderRangeRead =>
    ({ ok: true, records: newestFirst.slice().reverse(), continuation });

  while (walk.more()) {
    const step = await walk.next();
    if (!step.ok) return refused ? INVALID : { ok: false, reason: step.reason };
    const { bytes, cut, start } = step.segment;
    lowest = start;
    if (first && !skipping && bytes[bytes.length - 1] !== NL) return INVALID;
    first = false;

    // [cut, top) holds whole records only: every one ends in a newline inside it.
    let top = bytes.length;
    if (skipping) {
      const delimiter = bytes.lastIndexOf(NL);
      if (delimiter < 0) {
        if (start === 0) return answer(START);   // the skipped record runs to offset 0: nothing older
        continue;
      }
      top = delimiter + 1;                       // drop the partial record after its enclosing delimiter
      framedFrom = start + top;
      skipping = false;
    }

    const segment: OlderRecord[] = [];
    for (let from = cut, nl = bytes.indexOf(NL, from); nl >= 0 && nl < top; from = nl + 1, nl = bytes.indexOf(NL, from)) {
      segment.push({ start: start + from, end: start + nl + 1, bytes: bytes.slice(from, nl) });
    }
    for (let i = segment.length - 1; i >= 0; i -= 1) {
      const record = segment[i]!;
      newestFirst.push(record);
      if (newestFirst.length === limits.records) {
        return answer(record.start === 0 ? START : { kind: 'more', cursor: { kind: 'line-start', before: record.start } });
      }
    }
  }

  if (lowest === 0) return answer(START);
  if (skipping) return answer({ kind: 'more', cursor: { kind: 'skip-record', before: lowest } });
  const oldest = newestFirst[newestFirst.length - 1];
  if (oldest !== undefined) return answer({ kind: 'more', cursor: { kind: 'line-start', before: oldest.start } });
  // No record framed. From a line start with the whole window read, the record ending there is at least a window long: skip it.
  if (framedFrom === before) return answer({ kind: 'gap', cursor: { kind: 'skip-record', before: lowest } });
  // The skip used part of the window; the record before it starts fresh next page.
  return answer({ kind: 'more', cursor: { kind: 'line-start', before: framedFrom } });
}
