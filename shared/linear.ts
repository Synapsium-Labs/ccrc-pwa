/**
 * The Linear connection, as the Settings screen and the server both say it (named workspaces S4b, design
 * 2026-10-20 §5.1). L0: imports nothing, because the PWA bundles this file.
 *
 * ONE VOCABULARY for the section's state. `LinearConnectionView` is what `GET /api/linear/connection` answers,
 * and it is NEVER the key: the most the wire carries of a credential is `keyTail`, its last four characters.
 *
 * EVERY STATE ITS OWN. `readValueFile` tells `absent`, `unreadable`, `unusable` and `placeholder` apart, and the
 * details file (`linear.json`) adds three more conditions of its own, because each has a different remedy:
 * paste a key, fix permissions, edit the file, or just press Check again. Folding any two is the overloaded
 * result CLAUDE.md forbids.
 */
import type { NameRefusal } from './slug.js';

/** The shortest key the server will send to Linear. A personal API key is several dozen characters; the floor
 *  stops a pasted word from being stored and, with it, `keyTail` from showing a quarter of a short value. */
export const LINEAR_KEY_MIN_CHARS = 16;
/** The longest. A bound on what an authenticated caller can make the server hold, hash and send. */
export const LINEAR_KEY_MAX_CHARS = 256;
/** The characters a key is made of. Anything else (whitespace, a leading `#`, a newline) would be stored
 *  differently from how it was verified: `readValueFile` takes the first non-comment line and strips
 *  whitespace, and `fetch` throws on a control character in a header, which would be reported as unreachable. */
export const LINEAR_KEY_SHAPE = /^[A-Za-z0-9_-]+$/;

/** Whether `key` is a string worth sending to Linear. Pure: the server answers `bad-key` on false and calls
 *  nothing; the PWA uses it to say so before a round trip. */
export function isLinearKeyShape(key: unknown): key is string {
  return typeof key === 'string' && key.length >= LINEAR_KEY_MIN_CHARS && key.length <= LINEAR_KEY_MAX_CHARS
    && LINEAR_KEY_SHAPE.test(key);
}

/** What the last check of the stored key found. `ok`, `rejected` (Linear answered 401: the key is bad), `forbidden`
 *  (Linear answered 403: it refused this request, which is not a verdict on the key) or `unreachable` (a timeout, a
 *  5xx, a refused connection, an answer that was not the shape asked for: nothing was decided about the key). */
export const LINEAR_CHECK_OUTCOMES = ['ok', 'rejected', 'forbidden', 'unreachable'] as const;
export type LinearCheckOutcome = (typeof LINEAR_CHECK_OUTCOMES)[number];

/** Why a stored key has no usable details beside it: the file is `absent` (a crash between the two writes, or an
 *  older build), `unreadable`, `malformed`, or `stale` (it describes a key that is no longer the stored one). */
export const LINEAR_DETAILS_PROBLEMS = ['absent', 'unreadable', 'malformed', 'stale'] as const;
export type LinearDetailsProblem = (typeof LINEAR_DETAILS_PROBLEMS)[number];

/** What the section shows of a key it has checked. `org` and `user` are null only when the first check of this
 *  key could not name them (it was rejected, or Linear did not answer). */
export interface LinearShown {
  org: string | null;
  user: string | null;
  /** The last four characters of the key. The only part of it that ever leaves the server. */
  keyTail: string;
  /** Epoch ms of the last check, the server's clock. */
  checkedAt: number;
}

export type LinearConnectionView =
  | { state: 'not-connected' }
  | ({ state: 'connected' } & LinearShown & { outcome: 'ok' })
  | ({ state: 'key-rejected' } & LinearShown & { outcome: 'rejected' })
  /** Linear answered 403 at the last check. The key is not called bad: it may lack a scope, or a team. */
  | ({ state: 'key-forbidden' } & LinearShown & { outcome: 'forbidden' })
  | ({ state: 'unreachable' } & LinearShown & { outcome: 'unreachable' })
  /** A key is stored and no details describe it. The key may be fine: Check again says. */
  | { state: 'details-unknown'; why: LinearDetailsProblem }
  /** `linear.key` exists and cannot be read (permissions): not "not connected". */
  | { state: 'unreadable' }
  /** `linear.key` exists and holds no value line. */
  | { state: 'unusable' }
  /** `linear.key` still holds an example value. */
  | { state: 'placeholder' };

export const LINEAR_VIEW_STATES = [
  'not-connected', 'connected', 'key-rejected', 'key-forbidden', 'unreachable', 'details-unknown', 'unreadable', 'unusable', 'placeholder',
] as const satisfies readonly LinearConnectionView['state'][];

/** What `~/.ccrc/linear.json` holds: the DISPLAY record of the stored key (never a credential). `org`/`user` are
 *  null only when no check of this key has named them; `keyDigest` is the sha256 of the key it describes, which
 *  is how a record left by a different key is told from a current one. The server writes it; the wire never
 *  carries it (`LinearConnectionView` does not hold the digest). */
export interface LinearDetails {
  org: string | null;
  user: string | null;
  keyTail: string;
  keyDigest: string;
  checkedAt: number;
  outcome: LinearCheckOutcome;
}

/** The measured read of that file: absent, unreadable and malformed are three answers, never one `null`. */
export type LinearDetailsRead =
  | { kind: 'details'; details: LinearDetails }
  | { kind: 'absent' }
  | { kind: 'unreadable'; code: string }
  | { kind: 'malformed' };

/** The body of every successful `/api/linear/connection` answer. */
export interface LinearConnectionAnswer { ok: true; connection: LinearConnectionView }

/**
 * Why a lookup of a ticket's title produced none: THE ONE LIST of the failure arms, read by the server's client
 * (`server/src/linear/client.ts` makes them) and by the PWA (`LOOKUP_NOTE` says each in a sentence, a `satisfies
 * Record` over this type, so a new arm is a compile error until it has its words). EACH ITS OWN, because the operator
 * and the caller do different things about each: `not-configured` is a setup step, `unauthorised` a bad or expired
 * key (a 401, the ONLY answer that marks the stored key rejected), `forbidden` Linear refusing this request (a 403: a
 * scope or a team the key lacks, which says nothing against the key and never marks it), `not-found` a ticket that
 * does not exist, `timeout` is worth retrying,
 * `malformed` is an answer that was not the shape asked for, and `unreachable` is everything else the service or the
 * network did (a 5xx, a 429, a refused connection, a GraphQL errors array).
 */
export const LINEAR_FAILURES = [
  'not-configured', 'unauthorised', 'forbidden', 'not-found', 'timeout', 'malformed', 'unreachable',
] as const;
export type LinearFailure = (typeof LINEAR_FAILURES)[number];

/**
 * What `GET /api/linear/resolve` answers (named workspaces S4, S7). `reason` is the grammar's refusal for a `refused`
 * name, and, on a `named` one that fell back to `source: 'offline'`, the Linear failure arm that made it: the `kind`
 * says which vocabulary it is.
 */
export type ResolveAnswer =
  | { kind: 'auto'; slug: null; title: null; source: 'offline' }
  | { kind: 'refused'; slug: null; title: null; source: 'offline'; reason: NameRefusal }
  | { kind: 'named'; slug: string; title: string; source: 'linear' | 'offline'; reason?: LinearFailure };
