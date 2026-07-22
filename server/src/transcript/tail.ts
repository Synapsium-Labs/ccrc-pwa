import { EventEmitter } from 'node:events';
import { parseTranscriptLine } from './parse.js';
import type { FleetIO } from '../io.js';
import type { ChatEvent } from '../../../shared/api.js';

// Read at most the last 1 MB of a transcript for the backlog, not the whole
// file. Transcripts reach tens of MB (custom-tools was 17.9 MB for the last 50
// events); reading them whole through the agent RPC ballooned the agent's RSS
// to ~1.9 GB and stalled its event loop. 1 MB comfortably covers BACKLOG_N=50
// events even at large (multi-KB) line sizes.
const BACKLOG_TAIL_BYTES = 1024 * 1024;

/**
 * Return the last `lastN` events plus the end-of-file byte offset (where a
 * tailer should resume), reading only the file's tail. Missing/empty → empty.
 */
export async function readBacklog(io: FleetIO, file: string, lastN: number): Promise<{ events: ChatEvent[]; offset: number }> {
  const st = await io.stat(file);
  if (st === null || st.size === 0) return { events: [], offset: st?.size ?? 0 };
  const start = Math.max(0, st.size - BACKLOG_TAIL_BYTES);
  const res = await io.readFileFrom(file, start);
  if (res === null) return { events: [], offset: st.size };
  let text = res.data;
  // A non-zero start almost certainly lands mid-line — drop the partial head so
  // we never hand half a JSON object to the parser.
  if (start > 0) {
    const nl = text.indexOf('\n');
    text = nl >= 0 ? text.slice(nl + 1) : '';
  }
  const events = text.split('\n').filter((l) => l.trim() !== '').flatMap(parseTranscriptLine);
  return { events: events.slice(-lastN), offset: res.size };
}

const NL = 0x0a;

/**
 * Tails a transcript JSONL file from a byte offset.
 * Events: ('events', ChatEvent[], newOffset) on appended complete lines;
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
  override emit(event: 'rotated'): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: 'events', listener: (events: ChatEvent[], newOffset: number) => void): this;
  override on(event: 'rotated', listener: () => void): this;
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override once(event: 'events', listener: (events: ChatEvent[], newOffset: number) => void): this;
  override once(event: 'rotated', listener: () => void): this;
  override once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  override off(event: 'events', listener: (events: ChatEvent[], newOffset: number) => void): this;
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
    const events = buf
      .subarray(0, nl)
      .toString('utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .flatMap(parseTranscriptLine);
    if (events.length > 0) this.emit('events', events, this.offset);
  }

  private onReset(_size: number): void {
    if (this.stopped) return;
    this.emit('rotated');
    this.stop();
  }
}
