// D-5995 (the egress mask's post-merge audit, its follow-ups): how the masker meets the answer shapes the one
// `preSerialization` hook in `server.ts` never sees — a thrown error, and a string, Buffer or stream body — and the
// fleet row, whose server-built identity fields are never masked. `mask.ts` owns WHAT is masked; this file owns only
// which part of each shape it is applied to.
import { Transform, type Readable } from 'node:stream';
import { SECRET_MASK, SECRET_MASK_TOO_LARGE, type FleetSession } from '../../../shared/api.js';
import type { SecretMasker } from './mask.js';

/** A body of these media types is bytes, not text: decoding it to mask it would corrupt it, so it passes as it is. */
const BINARY_TYPE = /^\s*(?:(?:image|audio|video|font)\/|application\/(?:pdf|zip|gzip|wasm|octet-stream)\b)/i;
/** The most of a streamed text body that is read and masked; the rest is cut with the too-large notice. */
export const STREAM_BODY_MAX = 16 * 1024 * 1024;

const isStream = (v: unknown): v is Readable =>
  v !== null && typeof v === 'object' && typeof (v as { pipe?: unknown }).pipe === 'function';

/** A string, Buffer or stream body masked as text (D-5995): the backstop behind the answer hook, for a body that hook
 *  never saw. A body of a binary media type, and anything else, passes as it is. */
export function maskBody(mk: SecretMasker, payload: unknown, contentType: unknown): unknown {
  if (typeof payload === 'string') return mk.maskText(payload);
  const type = Array.isArray(contentType) ? contentType.join(',') : typeof contentType === 'string' ? contentType : '';
  if (BINARY_TYPE.test(type)) return payload;
  if (Buffer.isBuffer(payload)) return mk.maskText(payload.toString('utf8'));
  if (isStream(payload)) return maskStream(mk, payload);
  return payload;
}

/** A stream read whole (to `STREAM_BODY_MAX`), so a key split across its chunks is still matched, then masked. */
function maskStream(mk: SecretMasker, src: Readable): Readable {
  const parts: Buffer[] = [];
  let size = 0;
  let over = false;
  const out = new Transform({
    transform(chunk: unknown, _enc, cb) {
      if (!over) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += b.length;
        if (size > STREAM_BODY_MAX) over = true;
        else parts.push(b);
      }
      cb();
    },
    flush(cb) {
      mk.maskTextSliced(Buffer.concat(parts).toString('utf8'))
        .then((t) => cb(null, over ? t + SECRET_MASK_TOO_LARGE : t), (e: unknown) => cb(e as Error));
    },
  });
  src.on('error', (e) => out.destroy(e));
  return src.pipe(out);
}

/** The error with its message masked (D-5995), for the root error handler: the default handler sends `err.message`.
 *  A thrown non-Error becomes an Error carrying its masked text.
 *  The same error when nothing in it matched; otherwise a view over it with only the message replaced, so its status,
 *  code and type read through. */
export function maskedError(mk: SecretMasker, err: unknown): unknown {
  // A thrown non-Error would be sent as it is: as an Error, the default handler answers 500 with its text masked.
  if (!(err instanceof Error)) return new Error(mk.maskText(String(err)));
  const message = mk.maskText(err.message);
  if (message === err.message) return err;
  return Object.create(err, { message: { value: message, writable: true, configurable: true } }) as Error;
}

/** The fleet row's fields the server builds itself (D-5995): the registry's identity (id, wrapper, home, project,
 *  workdir, workspace), the names the operator gave (a live name the session did not derive, the board project), and
 *  `ask`, which names sessions by id. Never masked, so a name holding `-sk-` and 8 characters renders as typed. */
export const FLEET_SERVER_BUILT = [
  'id', 'wrapper', 'home', 'project', 'workdir', 'workspace', 'name', 'boardProject', 'ask',
] as const satisfies readonly (keyof FleetSession)[];
const KEPT: ReadonlySet<string> = new Set(FLEET_SERVER_BUILT);

/** A frame or answer carrying fleet rows, masked as one frame except each row's server-built fields (D-5995). A value
 *  with no `sessions` array is masked whole. */
export function maskFleetFrame<T>(mk: SecretMasker, frame: T): T {
  const rows = (frame as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(rows)) return mk.maskDeep(frame);
  const strip = rows.map((s: object) => Object.fromEntries(Object.entries(s).filter(([k]) => !KEPT.has(k))));
  const masked = mk.maskDeep({ ...frame, sessions: strip });
  return { ...masked, sessions: masked.sessions.map((m, i) => Object.assign({ ...(rows[i] as object) }, m)) } as T;
}

/** The spellings of one held secret a text could carry: its bytes, and its base64 and base64url forms, padded and not
 *  (`stdinB64` is the op's base64). Empty forms are dropped. */
function heldForms(secret: string): string[] {
  const b64 = Buffer.from(secret, 'utf8').toString('base64');
  const url = Buffer.from(secret, 'utf8').toString('base64url');
  return [...new Set([secret, b64, b64.replace(/=+$/, ''), url])].filter((f) => f !== '');
}

/**
 * The secrets a write route holds for one request, masked by their exact bytes and their base64 in every string of
 * `value` (spec §3.3, "the route also masks the exact secret bytes it holds, and their base64, in any text it returns";
 * accounts plan Task A17, D-7739). Defence in depth behind the answer hook, which masks the shapes and the fingerprinted
 * secrets: a pasted secret has no fingerprint row until the box's answer lands, and may have no shape at all. Walks
 * plain JSON values (strings, arrays, plain objects); anything else passes as it is. Pure.
 */
export function maskHeld<T>(value: T, held: readonly string[]): T {
  const forms = held.flatMap(heldForms).sort((a, b) => b.length - a.length);
  if (forms.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return forms.reduce((s, f) => s.split(f).join(SECRET_MASK), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
