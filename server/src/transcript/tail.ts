import { EventEmitter } from 'node:events';
import { helperFactsOf, parseTranscriptLine, type HelperFact } from './parse.js';
import type { FleetIO } from '../io.js';
import type { ChatEvent } from '../../../shared/api.js';
import { READ_FROM_MAX_BYTES } from '../../../shared/agent-protocol.js';

// Read at most the last 1 MB of a transcript for the backlog, not the whole
// file. Transcripts reach tens of MB (project-d was 17.9 MB for the last 50
// events); reading them whole through the agent RPC ballooned the agent's RSS
// to ~1.9 GB and stalled its event loop. 1 MB comfortably covers BACKLOG_N=50
// events even at large (multi-KB) line sizes. Since wave 171 it is read as four bounded byte reads of the agent link's
// read cap, framed in bytes.
const BACKLOG_TAIL_BYTES = 4 * READ_FROM_MAX_BYTES;

/**
 * What `readBacklog` answers. THREE facts, not one:
 *   - `events`/`offset` as before;
 *   - `missing` — no {mtimeMs,size} came back for `file`. Byte-identical in
 *     meaning to `io.stat(file) === null`, which is what the `backlog` frame's
 *     own `missing` was derived from at `sessionws.ts:598` before this type
 *     existed, so the wire field's meaning does not move;
 *   - `measured` — false when that failure was NOT a proven absence. An
 *     UNMEASURED absence rendered as a confident empty chat is the defect
 *     D-114 closes, and `searchComplete` on the same frame already refuses it
 *     on the readdir side (`shared/api.ts`'s `backlog` docstring).
 */
export interface BacklogRead {
  events: ChatEvent[];
  offset: number;
  missing: boolean;
  measured: boolean;
  /** The tailer's SECOND output (session helpers H1b, D-8862): the helper facts of every whole line in the window read, not
   *  only the last `lastN` events' (they cost no read). Absent when there is none, so a read with none is what it was. */
  helpers?: HelperFact[];
  /** Where the tailer's reading begins (session helpers H1c, D-8873): the start scan's seam, so it reads only the bytes before
   *  it (`workflows/helperScan.ts`). The window's first byte; the file's size when the window could not be read, so the scan
   *  still reads what the window would have (review 3067 F5, HF1, D-8876); 0 for an empty file. Absent only when no file
   *  was measured (`missing`), so one absence no longer stands for absent, empty and unread. */
  scanEnd?: number;
  /** The partial line the window began inside, which the backlog drops and the scan joins to its head; absent at offset 0. */
  cut?: string;
}

const decoder = new TextDecoder();

/**
 * Return the last `lastN` events plus the byte offset a tailer should resume at, reading only the file's tail, and say
 * whether the answer rests on a completed measurement.
 *
 * THE SEAM (desktop polish wave 171). The window is framed in BYTES into whole records (a record is a line that ends in a
 * newline the window read). The backlog begins at a record start: the record holding the oldest of the last `lastN` events
 * is emitted whole, so the backlog may exceed `lastN` by the rest of that one record. An unterminated last line is not a
 * record: it is neither parsed nor counted, and the offset is held at the end of the last whole record, so the tailer
 * delivers that line whole once its newline lands (the coordinator's ruling on run 3609's ask). A window with no newline
 * at all after a non-zero start lies wholly inside one record; it frames nothing and its offset stays the file's size, as
 * before.
 */
export async function readBacklog(io: FleetIO, file: string, lastN: number): Promise<BacklogRead> {
  const st = await io.statMeasured(file);
  if (!st.ok) return { events: [], offset: 0, missing: true, measured: st.reason === 'absent' };
  if (st.size === 0) return { events: [], offset: 0, missing: false, measured: true, scanEnd: 0 };
  const start = Math.max(0, st.size - BACKLOG_TAIL_BYTES);
  const bytes = new Uint8Array(st.size - start);
  for (let at = start; at < st.size;) {
    const want = Math.min(READ_FROM_MAX_BYTES, st.size - at);
    const res = await io.readFileFromBytesMeasured(file, at, want);
    if (!res.ok || res.bytes.length !== want) {
      // Absent HERE is a real race — the file was stat'd and then unlinked — and
      // it is a MEASUREMENT, so it reports as missing-and-measured. Unreadable
      // is the opposite: the file is still there and its bytes never came, so
      // `missing` stays false and `measured` goes false, which is what stops the
      // PWA rendering an empty chat over a transcript nobody could read — the
      // empty-backlog-with-a-real-offset defect this replaced (D-1403). A read
      // that answered fewer bytes than it was owed is unreadable too.
      const absent = !res.ok && res.reason === 'absent';
      return { events: [], offset: st.size, missing: absent, measured: absent, ...(absent ? {} : { scanEnd: st.size }) };
    }
    bytes.set(res.bytes, at - start);
    at += want;
  }

  // A non-zero start almost certainly lands mid-line — drop the partial head so
  // we never hand half a JSON object to the parser (the start scan parses it, joined to its head).
  let head = 0;
  let cut: string | undefined;
  if (start > 0) {
    const nl = bytes.indexOf(0x0a);
    head = nl >= 0 ? nl + 1 : bytes.length;
    cut = decoder.decode(bytes.subarray(0, nl >= 0 ? nl : bytes.length));
  }
  const last = bytes.lastIndexOf(0x0a);
  /** Whole records are [head, recordsEnd): everything after the window's last newline is unterminated. */
  const recordsEnd = last + 1 >= head ? last + 1 : head;
  const offset = start > 0 && last < 0 ? st.size : start + recordsEnd;

  const records: { at: number; line: string; events: ChatEvent[] }[] = [];
  for (let from = head; from < recordsEnd;) {
    const nl = bytes.indexOf(0x0a, from);
    const line = decoder.decode(bytes.subarray(from, nl));
    if (line.trim() !== '') records.push({ at: from, line, events: parseTranscriptLine(line) });
    from = nl + 1;
  }
  const helpers = records.flatMap((r) => helperFactsOf(r.line));

  // The seam: walk back from the newest record until `lastN` events are covered; that record is emitted whole.
  let k = records.length;
  let count = 0;
  while (k > 0 && count < lastN) { k -= 1; count += records[k]!.events.length; }
  const covered = count >= lastN ? records.slice(k) : records;
  const events = covered.flatMap((r) => r.events);
  return {
    events, offset, missing: false, measured: true, ...(helpers.length > 0 ? { helpers } : {}),
    scanEnd: start, ...(cut !== undefined ? { cut } : {}),
  };
}

const NL = 0x0a;

/**
 * Tails a transcript JSONL file from a byte offset.
 * Events: ('events', ChatEvent[], newOffset) on appended complete lines;
 * ('helpers', HelperFact[]) on appended complete lines that carry an Agent launch result or a task notification, the
 * tailer's second output for the Helpers section (session helpers H1b, D-8862), emitted before that chunk's events;
 * ('rotated') then self-stop when the file shrinks (truncation/rotation).
 * Mechanics: delegates the raw byte-level watch to `io.tailFile`; this class
 * owns line-framing (partial trailing lines held in a carry buffer until the
 * closing newline arrives) and offset bookkeeping for its own public API.
 */
export class TranscriptTailer extends EventEmitter {
  private offset: number;
  private carry: Buffer = Buffer.alloc(0);
  private stopped = false;
  private closeFn: (() => void) | null = null;

  constructor(
    private readonly io: FleetIO,
    private readonly file: string,
    fromOffset: number,
  ) {
    super();
    this.offset = fromOffset;
  }

  override emit(event: 'events', events: ChatEvent[], newOffset: number): boolean;
  override emit(event: 'helpers', facts: HelperFact[]): boolean;
  override emit(event: 'rotated'): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: 'events', listener: (events: ChatEvent[], newOffset: number) => void): this;
  override on(event: 'helpers', listener: (facts: HelperFact[]) => void): this;
  override on(event: 'rotated', listener: () => void): this;
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override once(event: 'events', listener: (events: ChatEvent[], newOffset: number) => void): this;
  override once(event: 'helpers', listener: (facts: HelperFact[]) => void): this;
  override once(event: 'rotated', listener: () => void): this;
  override once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  override off(event: 'events', listener: (events: ChatEvent[], newOffset: number) => void): this;
  override off(event: 'helpers', listener: (facts: HelperFact[]) => void): this;
  override off(event: 'rotated', listener: () => void): this;
  override off(event: string, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  start(): void {
    if (this.stopped) return;
    void this.io
      .tailFile(this.file, this.offset, (chunk) => this.onChunk(chunk), (size) => this.onReset(size))
      .then((close) => {
        if (this.stopped) close();
        else this.closeFn = close;
      });
  }

  stop(): void {
    this.stopped = true;
    this.closeFn?.();
    this.closeFn = null;
  }

  private onChunk(chunk: Buffer): void {
    if (this.stopped) return;
    this.offset += chunk.byteLength;
    const buf = this.carry.byteLength > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    const nl = buf.lastIndexOf(NL);
    if (nl === -1) {
      this.carry = buf;
      return;
    }
    this.carry = Buffer.from(buf.subarray(nl + 1));
    const lines = buf
      .subarray(0, nl)
      .toString('utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    const helpers = lines.flatMap(helperFactsOf);
    if (helpers.length > 0) this.emit('helpers', helpers);
    const events = lines.flatMap(parseTranscriptLine);
    if (events.length > 0) this.emit('events', events, this.offset);
  }

  private onReset(_size: number): void {
    if (this.stopped) return;
    this.emit('rotated');
    this.stop();
  }
}
