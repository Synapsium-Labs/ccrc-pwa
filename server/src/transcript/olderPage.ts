// L3 adapter (C3 Session Conversation): one older chat page (desktop polish wave 171), every read through the FleetIO port.
//
// A page is served only when the file still measures as the one its continuation was issued for, and every read made for
// it says so:
//   - THE WITNESS first: one read of the `len` bytes at the witness offset (the backlog's anchor), hashed and compared. A
//     file truncated and regrown with other bytes, or replaced, fails here (`changed`).
//   - THE IDENTITY on every read: each read that answers bytes must carry an identity token, and its tag must equal the
//     continuation's. A read with none is `unmeasured`; one with another is `changed` (a file replaced by one of the same
//     size has another inode or birth time, so another token). No read's bytes are used before its token is checked.
//   - THE FRAMING is `readOlderRange` (unchanged): at most four reads of at most 256 KiB, one MiB scanned, fifty records.
// Then the records are decoded and parsed by the parser the backlog and the tailer use (`parseTranscriptLine`), newest
// first, under two caps of this page's own that hold independently: parsed events, and the serialized events' bytes (the
// caller adds a bounded frame around them). A cap that cuts a page keeps the records nearest the boundary and moves the
// cursor to the start of the oldest record kept: progress is committed only at a record start. A record that alone
// exceeds a cap is a gap: it is skipped whole (the cursor moves to its start), never sent in part.
import { createHash } from 'node:crypto';
import type { FleetIO, ReadFailure } from '../io.js';
import type { ChatEvent } from '../../../shared/api.js';
import { OLDER_RANGE_LIMITS, readOlderRange, type OlderRangeLimits } from './olderRange.js';
import { parseTranscriptLine } from './parse.js';
import type { PageCursor, PageWitness } from './continuation.js';

export interface OlderPageLimits {
  readonly range: OlderRangeLimits;
  /** The most parsed events one page answers. */
  readonly events: number;
  /** The most bytes the page's events serialize to (`JSON.stringify` of the array, UTF-8). */
  readonly eventBytes: number;
}

/** The production caps (measured: the task note's §Limits). A fixture may lower one; nothing raises one. */
export const OLDER_PAGE_LIMITS: OlderPageLimits = Object.freeze({
  range: OLDER_RANGE_LIMITS,
  events: 400,
  eventBytes: 1024 * 1024,
});

export type OlderPageRead =
  | { ok: true; events: ChatEvent[]; gap: boolean; next: { kind: 'start' } | { kind: 'more'; cursor: PageCursor } }
  | { ok: false; reason: 'changed' | ReadFailure | 'unmeasured' };

/** What a page checks every read against. `identOk` answers whether a read's token is the continuation's. `mask` is the
 *  stream's own masker, applied before an event is counted, so the byte cap holds on what is sent. */
export interface OlderPageBinding {
  readonly identOk: (ident: string) => boolean;
  readonly witness: PageWitness;
  readonly mask: <T>(v: T) => T;
}

const decoder = new TextDecoder();
const within = (n: number, lo: number, hi: number): boolean => Number.isSafeInteger(n) && n >= lo && n <= hi;

/** One page of events before `cursor`, oldest first. Failure contract: never rejects; `absent`/`unreadable` are a read's
 *  own words, `changed` and `unmeasured` as above; any failure discards everything the page had read. */
export async function readOlderPage(
  io: FleetIO, file: string, cursor: PageCursor, bind: OlderPageBinding, limits: OlderPageLimits = OLDER_PAGE_LIMITS,
): Promise<OlderPageRead> {
  if (!within(limits.events, 1, OLDER_PAGE_LIMITS.events) || !within(limits.eventBytes, 2, OLDER_PAGE_LIMITS.eventBytes)) {
    return { ok: false, reason: 'unmeasured' };
  }
  /** The first identity failure any read met; it decides the answer over whatever the walker made of it. */
  let identFailure: 'changed' | 'unmeasured' | null = null;
  const checked: FleetIO = Object.create(io, {
    readFileFromBytesMeasured: {
      value: async (p: string, offset: number, maxBytes: number, timeoutMs?: number, signal?: AbortSignal) => {
        const r = await io.readFileFromBytesMeasured(p, offset, maxBytes, timeoutMs, signal);
        if (!r.ok || r.bytes.length === 0) return r;
        const fail = r.ident === undefined ? 'unmeasured' : bind.identOk(r.ident) ? null : 'changed';
        if (fail === null) return r;
        identFailure ??= fail;
        return { ok: false, reason: 'unreadable' } as const;
      },
    },
  });

  const w = bind.witness;
  const seen = await checked.readFileFromBytesMeasured(file, w.at, w.len);
  if (identFailure !== null) return { ok: false, reason: identFailure };
  if (!seen.ok) return { ok: false, reason: seen.reason };
  // A short witness read (a file cut inside it) can never hash equal, so the hash alone decides.
  if (createHash('sha256').update(seen.bytes).digest('hex') !== w.sha256) {
    return { ok: false, reason: 'changed' };
  }

  const framed = await readOlderRange(checked, file, cursor, limits.range);
  if (identFailure !== null) return { ok: false, reason: identFailure };
  // A short read or a line-start whose byte before is no longer a newline: the bytes moved under the page.
  if (!framed.ok) return { ok: false, reason: framed.reason === 'invalid-boundary' ? 'changed' : framed.reason };

  // Newest first, under the two caps. The serialized array is `[`, the events joined by `,`, and `]`.
  const serialized = (n: number, sum: number): number => 2 + sum + Math.max(0, n - 1);
  const kept: ChatEvent[][] = [];
  let events = 0;
  let sum = 0;
  for (let i = framed.records.length - 1; i >= 0; i -= 1) {
    const record = framed.records[i]!;
    const parsed = bind.mask(parseTranscriptLine(decoder.decode(record.bytes)));
    const size = parsed.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0);
    if (parsed.length > limits.events || serialized(parsed.length, size) > limits.eventBytes) {
      // Overlong for a page on its own. Nearest the boundary: a gap, skipped whole. Behind kept records: the page ends
      // before it, and the next page meets it nearest its boundary.
      return kept.length === 0
        ? { ok: true, events: [], gap: true, next: moreOrStart(record.start) }
        : cut(kept, framed.records[i + 1]!.start);
    }
    if (events + parsed.length > limits.events || serialized(events + parsed.length, sum + size) > limits.eventBytes) {
      return cut(kept, framed.records[i + 1]!.start);
    }
    kept.push(parsed);
    events += parsed.length;
    sum += size;
  }
  const all = kept.reverse().flat();
  const c = framed.continuation;
  if (c.kind === 'start') return { ok: true, events: all, gap: false, next: { kind: 'start' } };
  return { ok: true, events: all, gap: c.kind === 'gap', next: { kind: 'more', cursor: c.cursor } };
}

const moreOrStart = (start: number): { kind: 'start' } | { kind: 'more'; cursor: PageCursor } =>
  start === 0 ? { kind: 'start' } : { kind: 'more', cursor: { kind: 'line-start', before: start } };

/** A page a cap cut: the kept records (newest first) in file order, and the next page ending at the oldest kept one. */
const cut = (kept: ChatEvent[][], oldestKept: number): OlderPageRead =>
  ({ ok: true, events: kept.slice().reverse().flat(), gap: false, next: moreOrStart(oldestKept) });
