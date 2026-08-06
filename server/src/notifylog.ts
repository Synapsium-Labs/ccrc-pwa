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
  /** Serializes `flush()` calls. `pushOne` can dispatch several in one tick
   *  (one per event pushed), all `void`-fired against the SAME tmp path — see
   *  `flush()`'s own comment for why concurrent writers there are the actual
   *  hazard, not just a cosmetic race. */
  private flushChain: Promise<void> = Promise.resolve();

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
   *  boot, which is exactly the conservative answer.
   *
   *  Serialized behind `flushChain` rather than fired independently: `pushOne`
   *  can call this several times in one tick, and every call writes the SAME
   *  tmp path (`push.ts`'s own pattern, copied — but there `persist()` is
   *  awaited and rare, never overlapping itself). Two writers interleaved on
   *  one tmp file can drop a rename (ENOENT, swallowed by the catch below) or
   *  land one writer's bytes under the other's in-flight `rename` — and a
   *  torn file is safe (the next `load()` mints a new epoch), but a
   *  STALE-BUT-VALID landing — the same epoch, a LOWER seq than a client
   *  already holds — is exactly the case `catchUp` cannot tell apart from the
   *  truth. Chaining onto the previous call's promise is enough: only one
   *  write is ever in flight, and later calls always land after earlier
   *  ones, so the persisted file always matches the LAST call in program
   *  order.
   */
  async flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.doFlush());
    return this.flushChain;
  }

  private async doFlush(): Promise<void> {
    try {
      await mkdir(path.dirname(this.storePath), { recursive: true });
      const tmp = `${this.storePath}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ epoch: this._epoch, seq: this._seq }));
      await rename(tmp, this.storePath);
    } catch { /* best effort, by design */ }
  }

  catchUp(epoch: string | null, seq: number): CatchUp {
    const oldest = this.events[0]?.seq ?? this._seq + 1;
    // Three branches, one meaning: I cannot PROVE you saw everything.
    //  - epoch differs: a different counter's lifetime entirely.
    //  - seq < oldest - 1: the ring evicted an event this client hasn't seen.
    //  - seq > this._seq: a client claiming to have seen events that, under
    //    THIS epoch, this server has never issued. Reachable even with the
    //    flush serialization above: a kill or a swallowed write error
    //    between `record()` bumping `_seq` and the file actually landing
    //    leaves the store holding an OLDER seq than a client already saw
    //    acknowledged. Without this branch, that client's seq reads as
    //    "ahead but plausible" and `catchUp` would answer `resync: false,
    //    events: []` — a confident, wrong "nothing happened" — and every
    //    event this server subsequently records at or below that watermark
    //    would be silently dropped, which is precisely the failure the
    //    epoch exists to prevent.
    const resync = epoch !== this._epoch || seq < oldest - 1 || seq > this._seq;
    return {
      epoch: this._epoch, seq: this._seq, resync,
      events: resync ? [] : this.events.filter((e) => e.seq > seq),
    };
  }
}
