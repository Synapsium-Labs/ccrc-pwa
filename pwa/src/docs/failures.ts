// The Docs client's own words (spec 2026-10-01 4.3, 4.7 and 5.4): the slots a loader answers when the server did not
// answer a page, the answer unions every `api.docs.*` call resolves to, the loader seam `DocsScreen` takes, the one
// classifier from a rejected request to a slot, the two 200-answer readers, and the retry plan with the three waits
// the PWA keeps itself.
//
// A loader NEVER rejects for a docs word or a server answer: a word is `{s: 'failed', body}` (an unknown word from a
// newer server kept whole), and everything else that is not a page is one of the client slots below. It rejects in
// exactly two cases, both the caller's own: an abort (the caller's signal) and a defect (anything that is neither a
// server answer nor a `TypeError`, rethrown as is). A `TypeError` anywhere in the read counts as `unreachable`, a
// defect's included: the classifier cannot tell a network failure's `TypeError` from a bug's.
import {
  DOCS_FAILURE_RETRY, DOCS_FAILURES, DOCS_RASTER_EXT, DOCS_RASTER_TYPES, contentClass, sniffRaster,
  type DocPin, type DocsFailure, type DocsFailureBody, type DocsFileResponse, type DocsProjectsResponse,
  type DocsRefreshResponse, type DocsRefSpec, type DocsTreeResponse, type RasterMime, type RasterType,
} from '../../../shared/docs';
// A type-only import, erased at build time: lib/api.ts imports this module, so a value import back would be a cycle.
import type { ApiError } from '../lib/api';

/** What a loader answers when the server did not answer a page or a docs word (spec 4.3, 4.7):
 *  - `auth`: a 401; `request` has already raised the login overlay when the body named a verdict.
 *  - `unreachable`: `fetch` rejected (offline, DNS, a dropped connection), or a 2xx body could not be read. A
 *    non-2xx body that cannot be read is not this: `request` folds it to '' and throws an `ApiError`, so it arrives
 *    as `unexpected-response`.
 *  - `no-docs-route`: a pre-Docs server, a 404 whose body is `{error: 'not-found'}` with no `failure` (spec 7.1).
 *  - `unexpected-response`: any other answer that is not a docs envelope. `contentType` is the response's
 *    `content-type` header as sent, and `''` means it was absent or empty. */
export type DocsClientSlot =
  | { s: 'auth' }
  | { s: 'unreachable' }
  | { s: 'no-docs-route' }
  | { s: 'unexpected-response'; status: number; contentType: string };

/** Every arm of a loader's answer that is not a page: a docs word, known or not, or a client slot. */
export type DocsNotOk = { s: 'failed'; body: DocsFailureBody } | DocsClientSlot;

/** A loader's answer: the server's envelope as is, or why there is none. */
export type DocsAnswer<T> = { s: 'ok'; value: T } | DocsNotOk;

export type DocsIndexAnswer = DocsAnswer<DocsProjectsResponse>;
export type DocsTreeAnswer = DocsAnswer<DocsTreeResponse>;
export type DocsFileAnswer = DocsAnswer<DocsFileResponse>;
/** A raster's bytes and its MIME type. `mime` comes from `DOCS_RASTER_TYPES` for the path's declared type, never
 *  from the response or a Blob (spec 5.4). `bytes` is backed by a plain `ArrayBuffer`, which is what a `Blob` part
 *  takes. */
export interface DocsRasterBytes { readonly bytes: Uint8Array<ArrayBuffer>; readonly mime: RasterMime }
export type DocsRasterAnswer = DocsAnswer<DocsRasterBytes>;
/** Spec 4.3's `DocsRefreshAnswer`, renamed: server/src/docs/policy.ts already exports that name (the route's own
 *  verdict), and single-definition.test.ts holds every server/src/docs export to one declaration in the four roots. */
export type DocsRefreshLoaderAnswer = DocsAnswer<DocsRefreshResponse>;

/** The loader seam (spec 4.3). `api.docs` is the default; tests inject their own.
 *  - `tree`'s `ref: null` is the default view (no `?ref=`).
 *  - `file`'s and `raster`'s `signal` absent means the request is never aborted.
 *  - `refresh`'s `body.ref: null` is the default branch.
 *  - `file` serves every class but `raster` and THROWS `wrong-representation` for a raster path; `raster` serves
 *    the raster class only and throws the same for any other path. Both are programming errors (spec 5.4). */
export interface DocsLoaders {
  projects(): Promise<DocsIndexAnswer>;
  tree(project: string, ref: DocsRefSpec | null): Promise<DocsTreeAnswer>;
  file(project: string, pin: DocPin, signal?: AbortSignal): Promise<DocsFileAnswer>;
  raster(project: string, pin: DocPin, signal?: AbortSignal): Promise<DocsRasterAnswer>;
  refresh(project: string, body: { ref: string | null; reason: 'auto' | 'manual' }): Promise<DocsRefreshLoaderAnswer>;
}

/** Whether `w` is a word this build knows. An unknown word is kept whole and rendered as unknown, never folded. */
export function isDocsFailureWord(w: string): w is DocsFailure {
  return Object.hasOwn(DOCS_FAILURES, w);
}

/** `ApiError` without importing its class (see the import above): it is the one error that names itself so. */
function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && err.name === 'ApiError';
}

function hasFailureWord(body: unknown): body is DocsFailureBody {
  return typeof body === 'object' && body !== null && typeof (body as { failure?: unknown }).failure === 'string';
}

function errorCodeOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
}

/** A rejected docs request as a slot (refinement (k)), first match wins:
 *  1. an `ApiError` whose body has a string `failure` is that word, known or not, whatever the status;
 *  2. a 401 is `auth` (`request` raised the overlay before it threw, when the body named a verdict);
 *  3. a 404 whose body's `error` is `not-found` is `no-docs-route`: the status AND the code, never either alone;
 *  4. any other `ApiError` is `unexpected-response`;
 *  5. a `TypeError` (what `fetch` and a body read reject with when the network fails) is `unreachable`;
 *  6. anything else is RETHROWN: an abort (the caller's signal: a `DOMException` named `AbortError`, which is
 *     neither of the two above), for which there is no slot, and a defect. */
export function docsAnswerFromError(err: unknown): DocsNotOk {
  if (isApiError(err)) {
    if (hasFailureWord(err.body)) return { s: 'failed', body: err.body };
    if (err.status === 401) return { s: 'auth' };
    if (err.status === 404 && errorCodeOf(err.body) === 'not-found') return { s: 'no-docs-route' };
    return { s: 'unexpected-response', status: err.status, contentType: err.contentType ?? '' };
  }
  if (err instanceof TypeError) return { s: 'unreachable' };
  throw err;
}

function unexpected(res: Response): DocsClientSlot {
  return { s: 'unexpected-response', status: res.status, contentType: res.headers.get('content-type') ?? '' };
}

/** A 2xx JSON answer as the route's envelope: an object with `ok: true` and every one of `fields` present. Anything
 *  else (a proxy's page, a JSON that is not an object, `ok` not `true`, a field missing) is `unexpected-response`
 *  with the response's own status and content type. A body that cannot be read rejects (a `TypeError`), for the
 *  caller's `docsAnswerFromError`. */
export async function readDocsEnvelope<T>(res: Response, fields: readonly string[]): Promise<DocsAnswer<T>> {
  const text = await res.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return unexpected(res);
  }
  if (typeof value !== 'object' || value === null) return unexpected(res);
  const record = value as Record<string, unknown>;
  if (record['ok'] !== true || fields.some((f) => record[f] === undefined)) return unexpected(res);
  return { s: 'ok', value: value as T };
}

/** The raster type a path declares, or `null`, whose one meaning is "`contentClass(path)` is not `raster`". When
 *  `contentClass` says raster, the extension is one of `DOCS_RASTER_EXT`'s keys after ASCII-only lowering, so every
 *  character of it is ASCII and `toLowerCase` lowers it the same way. A raster class with no table entry would mean
 *  L0's two tables disagree: a defect, thrown. */
export function declaredRaster(path: string): RasterType | null {
  if (contentClass(path) !== 'raster') return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (!Object.hasOwn(DOCS_RASTER_EXT, ext)) throw new Error(`declaredRaster: no raster type for '${path}'`);
  return DOCS_RASTER_EXT[ext as keyof typeof DOCS_RASTER_EXT];
}

/** A 2xx raster answer, checked twice (spec 5.4, M5.18): its `content-type` must EQUAL the declared type's MIME, else
 *  `unexpected-response`; then `sniffRaster` must match, else a client-built `raster-mismatch {declared, size}`. */
export async function readDocsRaster(res: Response, declared: RasterType): Promise<DocsRasterAnswer> {
  const mime = DOCS_RASTER_TYPES[declared].mime;
  if (res.headers.get('content-type') !== mime) return unexpected(res);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (sniffRaster(declared, bytes) === 'mismatch') {
    return { s: 'failed', body: { ok: false, failure: 'raster-mismatch', declared, size: bytes.byteLength } };
  }
  return { s: 'ok', value: { bytes, mime } };
}

/** The PWA's own waits (spec 4.7, refinement (l)). The server's `Retry-After` never reaches the PWA (`ApiError`
 *  keeps no headers), and `caps-unknown` carries no wait in its body, so these three are the client's. */
export const DOCS_REF_LOCKED_RETRY_MS = 3000;
/** A `ref-locked` lock at least this old is stale: no automatic retry, "stale lock on {ref}". */
export const DOCS_LOCK_STALE_MS = 60000;
export const DOCS_CAPS_UNKNOWN_RETRY_MS = 5000;

/** What a page offers on a failure: one automatic retry after `afterMs`, a Retry button, or nothing. */
export type DocsRetryPlan = { kind: 'auto'; afterMs: number } | { kind: 'manual' } | { kind: 'none' };

/** The retry plan for one failure body, from L0's `DOCS_FAILURE_RETRY` (spec 4.7, refinement (l)):
 *  - an unknown word: `none` (its sentence says to reload; the same server would answer the same word);
 *  - `none` and `manual`: as the class says;
 *  - `auto`: wait the body's `retryAfterMs` when it is a finite number at least 0, else 5 000 ms for
 *    `caps-unknown`, else 0;
 *  - `ref-locked` (`auto-while-young`): `lockAgeMs` a number under 60 000, or `null` (the lock already went), waits
 *    3 000 ms; a number at or over 60 000 is `none` (a stale lock); ABSENT (ccd could not measure it) is `manual`,
 *    never folded into `null`. */
export function docsRetryPlan(body: DocsFailureBody): DocsRetryPlan {
  const word: string = body.failure;
  if (!isDocsFailureWord(word)) return { kind: 'none' };
  const cls = DOCS_FAILURE_RETRY[word];
  if (cls === 'none') return { kind: 'none' };
  if (cls === 'manual') return { kind: 'manual' };
  if (cls === 'auto-while-young') {
    const age = body.lockAgeMs;
    if (age === undefined) return { kind: 'manual' };
    if (age === null || age < DOCS_LOCK_STALE_MS) return { kind: 'auto', afterMs: DOCS_REF_LOCKED_RETRY_MS };
    return { kind: 'none' };
  }
  const after = body.retryAfterMs;
  if (typeof after === 'number' && Number.isFinite(after) && after >= 0) return { kind: 'auto', afterMs: after };
  return { kind: 'auto', afterMs: word === 'caps-unknown' ? DOCS_CAPS_UNKNOWN_RETRY_MS : 0 };
}
