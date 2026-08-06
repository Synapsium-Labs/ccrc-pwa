import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CatchUp, NotifyEvent } from '../../shared/api.js';

const RING = 200;

/**
 * The notifications this server fired, with a seq the client can watermark
 * against — and the epoch that makes the seq mean anything.
 *
 * Orca's torn-write reasoning, adopted whole: a seq is meaningless without the
 * counter's LIFETIME. Written as two values, a death between the two writes
 * forges a valid-looking pair, and the client silently drops real
 * notifications believing it has already seen them. So {epoch, seq} is ONE
 * JSON object in ONE file, written tmp + rename — the same discipline
 * `push.ts` already uses for the subscription store.
 *
 * A new epoch is not an error path. It is the signal that says "stop trusting
 * your seq", and it is minted whenever continuity cannot be PROVEN: no file, an
 * unreadable one, a malformed one.
 */
export class NotifyLog {
  private events: NotifyEvent[] = [];
  private _epoch = '';
  private _seq = 0;

  constructor(private readonly storePath: string, private readonly ring = RING) {}

  get epoch(): string { return this._epoch; }
  get seq(): number { return this._seq; }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown;
      if (raw !== null && typeof raw === 'object' &&
          typeof (raw as { epoch?: unknown }).epoch === 'string' &&
          typeof (raw as { seq?: unknown }).seq === 'number' &&
          Number.isInteger((raw as { seq: number }).seq) && (raw as { seq: number }).seq >= 0) {
        this._epoch = (raw as { epoch: string }).epoch;
        this._seq = (raw as { seq: number }).seq;
        return;
      }
    } catch { /* missing or unreadable — fall through to a fresh epoch */ }
    this._epoch = randomUUID();
    this._seq = 0;
  }

  record(e: Omit<NotifyEvent, 'seq' | 'at'>): NotifyEvent {
    const ev: NotifyEvent = { ...e, seq: ++this._seq, at: Date.now() };
    this.events.push(ev);
    if (this.events.length > this.ring) this.events.splice(0, this.events.length - this.ring);
    return ev;
  }

  /** Never rejects: a failed flush costs at most a re-minted epoch on the next
   *  boot, which is exactly the conservative answer. */
  async flush(): Promise<void> {
    try {
      await mkdir(path.dirname(this.storePath), { recursive: true });
      const tmp = `${this.storePath}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ epoch: this._epoch, seq: this._seq }));
      await rename(tmp, this.storePath);
    } catch { /* best effort, by design */ }
  }

  catchUp(epoch: string | null, seq: number): CatchUp {
    const oldest = this.events[0]?.seq ?? this._seq + 1;
    // Both branches mean the same thing: I cannot PROVE you saw everything.
    const resync = epoch !== this._epoch || seq < oldest - 1;
    return {
      epoch: this._epoch, seq: this._seq, resync,
      events: resync ? [] : this.events.filter((e) => e.seq > seq),
    };
  }
}
