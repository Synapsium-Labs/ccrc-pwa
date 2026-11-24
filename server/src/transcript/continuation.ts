// L3 adapter (C3 Session Conversation): the older-page continuation's codec (desktop polish wave 171).
//
// A SECURITY BOUNDARY. A continuation is a value the server hands a browser on the session socket and the browser sends
// back, unchanged, to ask for the page of chat records before it. The browser never names a path, an offset, a size or a
// file generation: everything a page reads is decided by the stream that serves the socket, and the continuation only
// carries where in THAT stream's file the next page ends, and the witness that the file is still the one it was issued
// for. It is integrity-protected, never secret: an HMAC-SHA256 under a key this process makes when the module loads, keeps
// only in memory, and never stores, logs or sends. A continuation from before a restart names another key id and is
// `expired`; one whose MAC does not verify, or that is not of this grammar, is `invalid`. Both are decided before any file
// I/O and before any field is trusted. (A forger can make any token read as `expired` by naming another key id; that
// costs it nothing and gains it nothing: an `expired` answer reads nothing.)
//
// WHAT IT BINDS, and how. Every field is under the MAC. The session id is carried in clear (the browser already holds it).
// The transcript path and the read identity token are carried only as keyed tags (`tag`), so the token never reaches a
// browser in any form it could compare across files, and the path's tag reveals nothing the backlog frame's `file` does
// not already say. The cursor (`line-start` or `skip-record`, and its byte offset) and the boundary witness's offset and
// length are carried in clear, under the MAC; the witness's sha256 is carried only as a keyed tag, as the path and the
// identity are, so nothing derived from the transcript's raw bytes without the key reaches the browser (review 3643).
//
// THE ENCODING is lowercase hex only, so no part of it can take a credential shape the stream's masker replaces (base64url
// of a JSON object begins `eyJ`, the JWT shape's prefix).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WITNESS_MAX_BYTES } from './tail.js';

export interface PageCursor { readonly kind: 'line-start' | 'skip-record'; readonly before: number }
/** The boundary witness the backlog measured: `len` bytes at `at`, and their sha256 (server-side only). */
export interface PageWitness { readonly at: number; readonly len: number; readonly sha256: string }
/** The witness as a continuation carries it: the hash only as `ContinuationKey.tag('witness', sha256)`. */
export interface BoundWitness { readonly at: number; readonly len: number; readonly tag: string }
/** A continuation's fields once its MAC verified. `pathTag`, `identTag` and the witness's `tag` are `ContinuationKey.tag`
 *  values. */
export interface OpenedContinuation {
  readonly session: string;
  readonly pathTag: string;
  readonly identTag: string;
  readonly cursor: PageCursor;
  readonly witness: BoundWitness;
}
export type OpenAnswer = { ok: true; value: OpenedContinuation } | { ok: false; reason: 'invalid' | 'expired' };

/** The longest continuation the server issues or reads; anything longer is `invalid` before it is parsed. */
export const CONTINUATION_MAX_CHARS = 2048;
/** A session id's longest form in a continuation (a registry id is far shorter). */
const SESSION_MAX_CHARS = 256;
const VERSION = 'c1';
const SHAPE = /^c1\.([0-9a-f]{16})\.((?:[0-9a-f]{2})+)\.([0-9a-f]{64})$/;
const TAG = /^[0-9a-f]{32}$/;

const safeOffset = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

export class ContinuationKey {
  readonly #key = randomBytes(32);
  /** Names this key in every continuation it issues, so one from another process reads as `expired`, not `invalid`. */
  readonly keyId = randomBytes(8).toString('hex');

  /** A keyed tag of a path, an identity token or a witness hash: 128 bits of HMAC, domain-separated by `kind`. */
  tag(kind: 'path' | 'ident' | 'witness', value: string): string {
    return createHmac('sha256', this.#key).update(`ccrc-older-${kind}-v1\0${value}`).digest('hex').slice(0, 32);
  }

  /** Whether `tag` is this key's tag of `value`, compared in constant time; a malformed tag is no match. */
  matches(kind: 'path' | 'ident' | 'witness', value: string, tag: string): boolean {
    return TAG.test(tag) && timingSafeEqual(Buffer.from(this.tag(kind, value), 'hex'), Buffer.from(tag, 'hex'));
  }

  #mac(body: string): Buffer {
    return createHmac('sha256', this.#key).update(`ccrc-older-page-v1\0${body}`).digest();
  }

  /** A continuation for these facts. `path`, `ident` and the witness hash are tagged here and never appear in it. */
  issue(f: { session: string; path: string; ident: string; cursor: PageCursor; witness: PageWitness }): string {
    const witness = { at: f.witness.at, len: f.witness.len, tag: this.tag('witness', f.witness.sha256) };
    return this.#seal({ session: f.session, pathTag: this.tag('path', f.path), identTag: this.tag('ident', f.ident), cursor: f.cursor, witness });
  }

  /** The next continuation of an opened one: every bound field kept, only the cursor moved. */
  reissue(c: OpenedContinuation, cursor: PageCursor): string {
    return this.#seal({ ...c, cursor });
  }

  #seal(c: OpenedContinuation): string {
    const payload = JSON.stringify({
      s: c.session, p: c.pathTag, i: c.identTag,
      c: [c.cursor.kind === 'line-start' ? 'l' : 's', c.cursor.before],
      w: [c.witness.at, c.witness.len, c.witness.tag],
    });
    const body = `${VERSION}.${this.keyId}.${Buffer.from(payload, 'utf8').toString('hex')}`;
    return `${body}.${this.#mac(body).toString('hex')}`;
  }

  /** Verify a continuation a client sent. Failure contract: never throws; `expired` only for a well-formed token under
   *  another key id; every other failure, a MAC that does not verify included, is `invalid`. No field is read before the
   *  MAC verified. */
  open(token: unknown): OpenAnswer {
    const invalid = { ok: false, reason: 'invalid' } as const;
    if (typeof token !== 'string' || token.length > CONTINUATION_MAX_CHARS) return invalid;
    const m = SHAPE.exec(token);
    if (m === null) return invalid;
    if (m[1] !== this.keyId) return { ok: false, reason: 'expired' };
    const body = token.slice(0, token.lastIndexOf('.'));
    if (!timingSafeEqual(Buffer.from(m[3]!, 'hex'), this.#mac(body))) return invalid;
    let o: unknown;
    try { o = JSON.parse(Buffer.from(m[2]!, 'hex').toString('utf8')); } catch { return invalid; }
    const v = o as { s?: unknown; p?: unknown; i?: unknown; c?: unknown; w?: unknown } | null;
    if (v === null || typeof v !== 'object') return invalid;
    if (typeof v.s !== 'string' || v.s === '' || v.s.length > SESSION_MAX_CHARS) return invalid;
    if (typeof v.p !== 'string' || !TAG.test(v.p) || typeof v.i !== 'string' || !TAG.test(v.i)) return invalid;
    if (!Array.isArray(v.c) || v.c.length !== 2 || (v.c[0] !== 'l' && v.c[0] !== 's') || !safeOffset(v.c[1])) return invalid;
    if (!Array.isArray(v.w) || v.w.length !== 3 || !safeOffset(v.w[0]) || !safeOffset(v.w[1])) return invalid;
    const [at, len, tag] = v.w as [number, number, unknown];
    if (len < 1 || len > WITNESS_MAX_BYTES || typeof tag !== 'string' || !TAG.test(tag)) return invalid;
    const before = v.c[1] as number;
    if (before > at) return invalid;
    return {
      ok: true,
      value: {
        session: v.s, pathTag: v.p, identTag: v.i,
        cursor: { kind: v.c[0] === 'l' ? 'line-start' : 'skip-record', before },
        witness: { at, len, tag },
      },
    };
  }
}

/** This process's one key: made when the module loads, so a restart makes a new one and every earlier continuation reads
 *  as `expired`. Held only here, in memory. */
export const PROCESS_CONTINUATION_KEY = new ContinuationKey();
