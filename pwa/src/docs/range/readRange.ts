// L3 adapter, by declaration: it drives a range read through an injected port and the browser's digest.
// X2 P1 Task P1.4 (X2 spec section 4.3, "The snapshot", "Progress, Cancel and memory"): one range read, reassembled.
// The prepare snapshots the pinned bytes on the fleet box and answers its id, size and digest; every frame comes from
// that snapshot and carries the sha256 of its own bytes, which this checks before the bytes count. The frames are
// written into ONE buffer, allocated once from the prepare's size after that size is checked against the listing and
// the ceiling, so the page holds at most the file plus the frame being decoded. Nothing is handed out until every
// frame has arrived and checked; a cancel (the signal) drops the buffer and sends nothing more. A frame answering
// `snapshot-gone` restarts the read from the prepare, once.
//
// The loader is injected (the page's `api.docs` adapter in the app, a fake in tests). It makes no Blob: `objectUrls.ts`
// is the one place under `pwa/src/docs` that does (base spec 5.4). Each frame is checked with the browser's SHA-256
// (`crypto.subtle`), which exists only in a secure context: on an origin without it, a range read refuses `no-digest`
// before any request and reads nothing, rather than showing bytes it cannot check.
import {
  DOCS_RANGE_FRAME_BYTES, DOCS_RANGE_MAX_BYTES,
  type DocListPin, type DocsRangeFrame, type DocsRangePin, type DocsRangePrepared,
} from '../../../../shared/docs';
import type { DocsAnswer, DocsNotOk } from '../failures';
import { b64Bytes } from './rangePolicy';

/** What is read: the project and the page pin (which bytes the page shows), the range pin ccd checks, and the size the
 *  listing gave, which the prepare's size must equal. */
export interface RangeTarget { readonly project: string; readonly pin: DocListPin; readonly range: DocsRangePin; readonly size: number }

/** The two calls one read makes. Each resolves an answer, as every docs loader does; `signal` aborts the request. */
export interface RangeLoader {
  prepare(target: RangeTarget, signal: AbortSignal): Promise<DocsAnswer<DocsRangePrepared>>;
  frame(target: RangeTarget, snapshot: string, offset: number, length: number, signal: AbortSignal): Promise<DocsAnswer<DocsRangeFrame>>;
}

/** Why a read gave no bytes. `answer`: the server's or the client's own answer to a call, as is. `aborted`: the signal.
 *  `size-mismatch`: the prepare's size is not the listing's. `over-ceiling`: the size passes `DOCS_RANGE_MAX_BYTES`.
 *  `frame-mismatch`: a frame names another snapshot, offset or total, or holds another length than asked for.
 *  `frame-digest`: a frame's bytes do not hash to its digest. `no-digest`: this origin has no `crypto.subtle` (not a
 *  secure context), so no frame could be checked and nothing was read. `whole-digest`: every frame checked, but the
 *  reassembled bytes do not hash to the prepare's digest, which a stat-pinned draft's page pin would take as its `fp`.
 *  `threw`: the read threw (a loader or digest fault), not an abort; `readRange` itself rejects with it, and the leaf
 *  names it apart from a cancel. */
export type RangeReadFailure =
  | { kind: 'answer'; answer: DocsNotOk }
  | { kind: 'aborted' }
  | { kind: 'size-mismatch' }
  | { kind: 'over-ceiling' }
  | { kind: 'frame-mismatch'; offset: number }
  | { kind: 'frame-digest'; offset: number }
  | { kind: 'no-digest' }
  | { kind: 'whole-digest' }
  | { kind: 'threw' };

export type RangeReadResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; digest: string }
  | { ok: false; why: RangeReadFailure };

export interface RangeReadOptions {
  readonly signal: AbortSignal;
  /** Called after each checked frame with the bytes read so far and the whole size. */
  readonly onProgress: (done: number, total: number) => void;
  /** The one allocation, for a test to count; `new Uint8Array(n)` by default. */
  readonly alloc?: (n: number) => Uint8Array<ArrayBuffer>;
}

async function sha256Hex(subtle: SubtleCrypto, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}

const ABORTED: RangeReadResult = { ok: false, why: { kind: 'aborted' } };

/** One attempt from the prepare: `restart` when a frame answered `snapshot-gone`. */
async function attempt(loader: RangeLoader, target: RangeTarget, opts: RangeReadOptions, subtle: SubtleCrypto):
Promise<RangeReadResult | { restart: true }> {
  const { signal } = opts;
  if (signal.aborted) return ABORTED;
  const prep = await loader.prepare(target, signal);
  if (signal.aborted) return ABORTED;
  if (prep.s !== 'ok') return { ok: false, why: { kind: 'answer', answer: prep } };
  const { snapshot, size, digest } = prep.value;
  if (!Number.isSafeInteger(size) || size < 0 || size > DOCS_RANGE_MAX_BYTES) return { ok: false, why: { kind: 'over-ceiling' } };
  if (size !== target.size) return { ok: false, why: { kind: 'size-mismatch' } };
  let buf: Uint8Array<ArrayBuffer> | null = (opts.alloc ?? ((n: number) => new Uint8Array(n)))(size);
  for (let offset = 0; offset < size; offset += DOCS_RANGE_FRAME_BYTES) {
    const length = Math.min(DOCS_RANGE_FRAME_BYTES, size - offset);
    const ans = await loader.frame(target, snapshot, offset, length, signal);
    if (signal.aborted) { buf = null; return ABORTED; }
    if (ans.s !== 'ok') {
      buf = null;
      if (ans.s === 'failed' && ans.body.failure === 'snapshot-gone') return { restart: true };
      return { ok: false, why: { kind: 'answer', answer: ans } };
    }
    const f = ans.value;
    const bytes = b64Bytes(f.bytesB64);
    if (f.snapshot !== snapshot || f.offset !== offset || f.total !== size || bytes === null || bytes.length !== length) {
      buf = null;
      return { ok: false, why: { kind: 'frame-mismatch', offset } };
    }
    const got = await sha256Hex(subtle, bytes);
    if (signal.aborted) { buf = null; return ABORTED; }
    if (got !== f.digest) { buf = null; return { ok: false, why: { kind: 'frame-digest', offset } }; }
    buf!.set(bytes, offset);
    opts.onProgress(offset + length, size);
    if (signal.aborted) { buf = null; return ABORTED; }
  }
  // The whole: the digest the page pin takes is measured here, never only asserted by the prepare.
  const whole = await sha256Hex(subtle, buf!);
  if (signal.aborted) { buf = null; return ABORTED; }
  if (whole !== digest) { buf = null; return { ok: false, why: { kind: 'whole-digest' } }; }
  return { ok: true, bytes: buf!, digest };
}

/** Reads `target` by range: the bytes, checked frame by frame, and the snapshot's digest; or why not. */
export async function readRange(loader: RangeLoader, target: RangeTarget, opts: RangeReadOptions): Promise<RangeReadResult> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (subtle === undefined) return { ok: false, why: { kind: 'no-digest' } };
  // A loader rejects on abort (the fetch's own AbortError); after an abort, any rejection is the abort.
  const run = async (): Promise<RangeReadResult | { restart: true }> => {
    try {
      return await attempt(loader, target, opts, subtle);
    } catch (err) {
      if (opts.signal.aborted) return ABORTED;
      throw err;
    }
  };
  const first = await run();
  if (!('restart' in first)) return first;
  const second = await run();
  if (!('restart' in second)) return second;
  return { ok: false, why: { kind: 'answer', answer: { s: 'failed', body: { ok: false, failure: 'snapshot-gone' } } } };
}
