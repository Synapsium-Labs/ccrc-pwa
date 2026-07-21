import { EventEmitter } from 'node:events';
import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseTranscriptLine } from './parse.js';
import type { ChatEvent } from '../../../shared/api.js';

/**
 * Parse the whole transcript file and return the last `lastN` events plus the
 * end-of-file byte offset (where a tailer should resume). Missing file → empty.
 */
export async function readBacklog(file: string, lastN: number): Promise<{ events: ChatEvent[]; offset: number }> {
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch {
    return { events: [], offset: 0 };
  }
  const events = buf
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .flatMap(parseTranscriptLine);
  return { events: events.slice(-lastN), offset: buf.byteLength };
}

/** Read bytes [start, size) of `file` (createReadStream `end` is inclusive). */
function readRange(file: string, start: number, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(file, { start, end: size - 1 })
      .on('data', (c) => chunks.push(c as Buffer))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

const POLL_MS = 1500;
const NL = 0x0a;

/**
 * Tails a transcript JSONL file from a byte offset.
 * Events: ('events', ChatEvent[], newOffset) on appended complete lines;
 * ('rotated') then self-stop when the file shrinks (truncation/rotation).
 * Mechanics: fs.watch on the file's directory (rename-safe) plus a poll
 * fallback; partial trailing lines are held in a carry buffer until the
 * closing newline arrives.
 */
export class TranscriptTailer extends EventEmitter {
  private offset: number;
  private carry: Buffer = Buffer.alloc(0);
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private inFlight = false;
  private pending = false;
  private stopped = false;

  constructor(
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
    try {
      this.watcher = watch(path.dirname(this.file), (_event, filename) => {
        if (!filename || filename.toString() === path.basename(this.file)) this.trigger();
      });
    } catch {
      // directory may not exist yet — the poll fallback keeps checking
    }
    this.poll = setInterval(() => this.trigger(), POLL_MS);
    this.trigger();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  /** Single read loop: watch + poll can't double-read; triggers during a read re-run it. */
  private trigger(): void {
    if (this.stopped) return;
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    void this.loop();
  }

  private async loop(): Promise<void> {
    this.inFlight = true;
    try {
      do {
        this.pending = false;
        await this.readOnce();
      } while (this.pending && !this.stopped);
    } finally {
      this.inFlight = false;
    }
  }

  private async readOnce(): Promise<void> {
    let size: number;
    try {
      size = (await stat(this.file)).size;
    } catch {
      return; // file missing (not created yet) — keep waiting
    }
    if (size < this.offset) {
      this.emit('rotated');
      this.stop();
      return;
    }
    if (size === this.offset) return;
    let chunk: Buffer;
    try {
      chunk = await readRange(this.file, this.offset, size);
    } catch {
      return; // transient read failure — retry on next trigger
    }
    this.offset = size;
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
    if (!this.stopped && events.length > 0) this.emit('events', events, this.offset);
  }
}
