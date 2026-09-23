import { isReleaseTag, type CatalogueErrorReason, type CatalogueState } from '../../../shared/api.js';
import { BASE_URL_OK } from '../../../shared/base-url.js';
import type { ReleaseSourceRead } from '../config.js';
import type { ApplyReleaseListingResult, ListingCoverage, ReleaseListingRow } from '../coord/store.js';
import { openPoolReadDeadline } from '../pools.js';
import { isIngestibleReleaseTag } from './resolve.js';

/**
 * L3 — the release-catalogue poller (design 2026-09-20 §7).
 *
 * One conditional GET of GitHub's release listing, a defensive parse, and ONE
 * call to the store's one catalogue writer (`applyReleaseListing`, plan
 * D-3180). Nothing else here writes anything: the
 * port below has no delete and no per-row upsert, so "a yanked release is
 * kept" (§18) is a property of the only door this module holds. Fix round 1
 * (D-3215) adds a SECOND, independent conditional GET of
 * `/releases/latest`, with its own ETag, upserted through the same one
 * writer under `'single'` coverage (no absence judgment) — an off-page
 * stable release (§7's window) is not silently unresolvable.
 *
 * Quota (§7, measured; D-3215 doubles it): unauthenticated, 60 requests an
 * hour per IP, and a 304 still counts — the ETag saves bytes, not budget.
 * Each poll now sends TWO requests (the listing and the latest-release
 * probe), so the watcher's 30-minute cadence spends 4 requests an hour, well
 * under the 60/hour budget. `POST /api/updates/refresh` reads
 * `lastRequestAt()` for its one-a-minute guard, measured against the LISTING
 * request only. No token is ever sent (decision 4: the repo carries no
 * secrets, and the server holds none for GitHub).
 *
 * Fail-soft, and the failure is an answer: every LISTING error arm sets
 * `lastError` and never `lastOkAt`, so no consumer can render a failed poll
 * as "up to date". `lastError` is the CURRENT failure — an answer clears it
 * (D-3197). `catalogueState`
 * (`{lastOkAt, lastError}`) follows the LISTING alone (D-3215) — the
 * latest-release probe never sets either: its own failure is warned once per
 * distinct cause and re-armed on its own next success. The state and both
 * ETags are this process's memory
 * (D-3182): a restarted server polls on its first
 * tick and says "never checked" until then; the rows themselves persist in
 * the store.
 *
 * `bundleListed` is a FILENAME in an unauthenticated listing, not a
 * verification — the node verifies (§5) and reports `provenance` (§8).
 */
export const RELEASES_PER_PAGE = 30;
/** A GitHub listing that has not answered in 10 s is not going to; the lane
 *  is void-dispatched, so this bounds a request, not the tick. */
export const CATALOGUE_TIMEOUT_MS = 10_000;
export const NOTES_CAP_BYTES = 4096;
export const NOTES_MARKER = '…';
/** D-3209: a hostile or oversized listing must never reach `JSON.parse` or
 *  the store. A `content-length` over this cap refuses the request without
 *  reading the body; otherwise the body is read as a stream with a running
 *  byte count that stops — and cancels the reader — at the same cap. About
 *  sixty times the largest page GitHub returns for thirty releases. */
export const CATALOGUE_BODY_MAX_BYTES = 8 * 1024 * 1024;

/** GitHub's REST API refuses a request with no User-Agent; say who asks
 *  rather than send the runtime's default. */
const USER_AGENT = 'ccrc-server';
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DOWNLOAD_URL_MAX = 2048;
/** F10 (fix round 1, D-3216): every byte of a download URL must be printable
 *  ASCII (`\x21`-`\x7e`) — no control byte, no non-ASCII byte a naive
 *  terminal or log line would mis-render. */
const PRINTABLE_ASCII_URL = /^[\x21-\x7e]+$/;

/** The port this module needs, declared by the consumer (L2). */
export interface CatalogueStore {
  applyReleaseListing(listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage): ApplyReleaseListingResult;
}

export interface CatalogueDeps { source: ReleaseSourceRead; apiUrl: string; store: CatalogueStore; timeoutMs?: number }

/** F3 (fix round 1): a REFUSED base must never put a working URL — with or
 *  without credentials — into a log line. `new URL` is re-parsed here inside
 *  a `try` (the base already failed `BASE_URL_OK`, so it may not parse at
 *  all, and `redactUserinfo`'s old regex printed the raw string regardless);
 *  when it DOES parse, only the scheme and `URL.hostname` are printed — never
 *  `.host` (which would carry a port) and never `.username`/`.password` or
 *  any other component, so userinfo, a query, a fragment or a path can never
 *  reach the line through this function. An unparseable base, or one whose
 *  scheme carries no real host (`u.hostname === ''` — an opaque, non-`http(s)`
 *  scheme such as `u:pw@host`, where the colon after `u` is not a scheme
 *  boundary a caller should trust), prints nothing at all: there is no safe
 *  fragment to show, and showing the scheme alone risked printing
 *  attacker-controlled text with no host to anchor it. */
function safeSchemeHost(raw: string): string {
  try {
    const u = new URL(raw.trim());
    return u.hostname === '' ? '' : `: ${u.protocol}//${u.hostname}`;
  } catch {
    return '';
  }
}

/** D-3209: validated ONCE when the poller is created, never per poll. `null`
 *  = fine. Delegates to `shared/base-url.ts`'s `BASE_URL_OK` — the SAME gate
 *  (parses, empty query/fragment, `https:` anywhere or `http:` only to its
 *  closed loopback set) an existing endpoint decision already declares once;
 *  re-spelling the loopback set here would be a second copy of a decision
 *  `single-definition.test.ts` polices ("the loopback SET … is the other
 *  value a second copy would be spelled from"). A refused base answers every
 *  poll `no-release-source` with no request — the same reason a missing
 *  release source reports, since a bad base is just as unusable. The message
 *  never carries the base's userinfo, query, fragment or path in clear (F3,
 *  fix round 1) — only the refusal word and, when the value parses at all
 *  with a real host, its scheme and host; an unparseable base, or one with no
 *  real host, prints neither. */
export function apiBaseProblem(apiUrl: string): string | null {
  const verdict = BASE_URL_OK(apiUrl);
  return verdict.ok ? null : `apiUrl refused (${verdict.reason})${safeSchemeHost(apiUrl)}`;
}

export interface CataloguePoller {
  /** Single-flight: a poll during a poll returns the in-flight promise. Resolves
   *  with the state after this poll; never rejects — every failure, including
   *  the store's writer throwing, is folded into the resolved state's
   *  `lastError` (see the `applyReleaseListing` call site below). */
  poll(now: number): Promise<CatalogueState>;
  /** `{lastOkAt: null, lastError: null}` until the first answer — "never checked". A copy. */
  state(): CatalogueState;
  /** The `now` of the last poll that SENT a request; `null` = never requested.
   *  A poll with no release source sends nothing and does not move it. */
  lastRequestAt(): number | null;
}

export interface ParsedListing { rows: ReleaseListingRow[]; skipped: number; coverage: ListingCoverage }

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const httpReason = (status: number): CatalogueErrorReason => `http-${status}` as const;

/** null = no body (absent, empty, not a string); otherwise at most
 *  NOTES_CAP_BYTES UTF-8 bytes, cut on a code-point boundary, plus
 *  NOTES_MARKER when cut. Stored as text; rendering it as plain text, never
 *  markdown or HTML, is the PWA's half of §18 "notes are capped and plain". */
export function capNotes(body: unknown): string | null {
  if (typeof body !== 'string' || body === '') return null;
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length <= NOTES_CAP_BYTES) return body;
  // bytes[end] is the first byte NOT kept. A continuation byte (10xxxxxx)
  // there means a code point straddles the cap: back up to its lead byte and
  // cut before it.
  let end = NOTES_CAP_BYTES;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8') + NOTES_MARKER;
}

function assetNamed(assets: readonly unknown[], name: string): Json | null {
  for (const a of assets) if (isObject(a) && a.name === name) return a;
  return null;
}

/** F10 (fix round 1, D-3216): a listing's download URL is untrusted input a
 *  node will eventually fetch a tarball from and run. `new URL` must parse
 *  it, the protocol must be exactly `https:` (never plain `http:`), every
 *  byte must be printable ASCII, and it must carry no userinfo. `null` on
 *  ANY failure, including no matching asset at all (`raw === undefined`) —
 *  the caller stores that as `tarballUrl: null` and keeps the release
 *  listed; only this one untrusted field is withheld. */
function safeDownloadUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > DOWNLOAD_URL_MAX || !PRINTABLE_ASCII_URL.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
  return raw;
}

/** One listing element → one row, or null when any field this module relies on
 *  is missing or out of shape. A `prerelease` that is not a boolean is refused,
 *  never defaulted: `stable` is the channel a dev build must not reach.
 *  F11 (fix round 1, D-3216): the tag bound is `isIngestibleReleaseTag`, not
 *  the bare `isReleaseTag` — a byte-length cap and a same-value-twice guard
 *  against a leading zero (`v0.0.010` beside `v0.0.10`), so `compareReleaseTags`
 *  never has to arbitrate two spellings of one version; a tag that fails it
 *  is SKIPPED here exactly like any other malformed element (D-3206). F10:
 *  a bad or absent download URL no longer skips the whole element — see
 *  `safeDownloadUrl`. */
function parseReleaseElement(el: unknown): ReleaseListingRow | null {
  if (!isObject(el)) return null;
  const { tag_name: tag, prerelease, draft, published_at: published, target_commitish: commitish, assets, body } = el;
  if (!isIngestibleReleaseTag(tag)) return null;
  if (typeof prerelease !== 'boolean') return null;
  if (typeof published !== 'string') return null;
  const publishedAt = Date.parse(published);
  if (!Number.isFinite(publishedAt) || publishedAt < 0) return null;
  if (!Array.isArray(assets)) return null;
  const rawUrl = assetNamed(assets, `ccrc-${tag}.tar.gz`)?.browser_download_url;
  return {
    tag,
    channel: prerelease ? 'dev' : 'stable',
    publishedAt,
    commitSha: typeof commitish === 'string' && COMMIT_SHA.test(commitish) ? commitish : null,
    tarballUrl: safeDownloadUrl(rawUrl),
    bundleListed: assetNamed(assets, `ccrc-${tag}.tar.gz.sigstore.json`) !== null,
    notes: capNotes(body),
    draft: draft === true,
  };
}

/** null = the body is not an array (the poll reads it as 'malformed'); a
 *  malformed element is skipped and counted, never thrown. `coverage` is
 *  'complete' iff the RAW array held fewer than RELEASES_PER_PAGE elements —
 *  a skipped element on a full page must not make the page look like the
 *  whole catalogue (D-3185). A skipped element is NOT in `rows`,
 *  so the store reads a known release skipped here as absent and yanks it
 *  until a poll parses it again (D-3206). D-3209: a later element repeating a
 *  tag already parsed is also skipped — GitHub's own listing is ordered
 *  newest-first, so the FIRST occurrence is kept — so the parser never hands
 *  the store a listing carrying the same tag twice, which `applyReleaseListing`
 *  would otherwise refuse whole. */
export function parseReleaseListing(body: unknown): ParsedListing | null {
  if (!Array.isArray(body)) return null;
  const rows: ReleaseListingRow[] = [];
  const seenTags = new Set<string>();
  let skipped = 0;
  for (const el of body) {
    const row = parseReleaseElement(el);
    if (row === null || seenTags.has(row.tag)) { skipped += 1; continue; }
    seenTags.add(row.tag);
    rows.push(row);
  }
  return { rows, skipped, coverage: body.length < RELEASES_PER_PAGE ? 'complete' : 'newest-page' };
}

/** The IIFE's raw answer, read inside the deadline race. `'over-cap'` (D-3209)
 *  is the sibling of the race's own `null` (no egress) — a distinct reason
 *  the poll reads as 'malformed', never conflated with a timeout. `'redirect'`
 *  (F9, fix round 1) is the sibling for a 3xx: `fetch` under `redirect:
 *  'error'` rejects rather than answering with a status, so it is caught and
 *  named before the throw would otherwise reach `race`'s own catch and be
 *  folded into the generic no-egress `null`. */
type RawAnswer = { status: number; etag: string | null; text: string } | 'over-cap' | 'redirect';

/** F9 (fix round 1): the shape Node's `fetch` (undici) throws for a redirect
 *  under `redirect: 'error'` — a `TypeError` whose `cause` names the reason,
 *  measured on this runtime as `cause.message === 'unexpected redirect'`.
 *  Every other throw (refused connection, reset, DNS) does not match and is
 *  re-thrown, so it still reaches `race`'s own `.catch(() => null)` as
 *  no-egress. */
function isRedirectRefusal(err: unknown): boolean {
  return err instanceof TypeError && err.cause instanceof Error && err.cause.message === 'unexpected redirect';
}

/** One request against the loopback-or-GitHub base, shared by the listing
 *  and the latest-release probe (D-3215): builds the headers from `etagIn`,
 *  races it against `deadlineMs`, and reads the body under the same cap.
 *  Never throws — a redirect, a cap breach and a genuine no-egress are all
 *  read back as a `RawAnswer` (or `null` for no-egress) by the caller. */
async function fetchOne(url: string, etagIn: string | null, deadlineMs: number): Promise<RawAnswer | null> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT };
  if (etagIn !== null) headers['if-none-match'] = etagIn;
  const deadline = openPoolReadDeadline(deadlineMs);
  if (deadline === null) return null;   // unreachable: timeoutMs > 0
  try {
    // The body is read INSIDE the race: `close()` aborts the controller, and
    // a body still streaming after it would be cut. A throw (refused, reset,
    // DNS) and the deadline both arrive as null — both are no egress.
    return await deadline.race((async (): Promise<RawAnswer> => {
      let res: Response;
      try {
        res = await fetch(url, { headers, signal: deadline.signal, redirect: 'error' });
      } catch (err) {
        if (isRedirectRefusal(err)) return 'redirect';
        throw err;
      }
      if (res.status !== 200) return { status: res.status, etag: res.headers.get('etag'), text: '' };
      // D-3209: capped and streamed — never a bare `res.text()`.
      const text = await readCappedBody(res);
      if (text === null) return 'over-cap';
      return { status: 200, etag: res.headers.get('etag'), text };
    })());
  } finally {
    deadline.close();
  }
}

/** D-3209: reads `res`'s body under `CATALOGUE_BODY_MAX_BYTES`. A declared
 *  `content-length` over the cap refuses without reading a byte; otherwise the
 *  body is read as a stream with a running count that stops — cancelling the
 *  reader — the moment the count crosses the cap. `null` = over cap either
 *  way; the caller reads that as 'malformed', never as a partial body. */
async function readCappedBody(res: Response): Promise<string | null> {
  const declared = res.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > CATALOGUE_BODY_MAX_BYTES) {
      await res.body?.cancel().catch(() => { /* the socket is being dropped either way */ });
      return null;
    }
  }
  const reader = res.body?.getReader();
  if (!reader) return res.text();   // no stream available (e.g. a body-less fetch polyfill)
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CATALOGUE_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => { /* the socket is being dropped either way */ });
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

export function createCataloguePoller(deps: CatalogueDeps): CataloguePoller {
  const timeoutMs = deps.timeoutMs !== undefined && deps.timeoutMs > 0 ? deps.timeoutMs : CATALOGUE_TIMEOUT_MS;
  /** D-3209: computed once, not per poll — an unusable base is a boot-time
   *  fact, not a per-request one. */
  const baseProblem = apiBaseProblem(deps.apiUrl);
  /** B2: `BASE_URL_OK`'s own `ok` arm is the base the gate ACCEPTED —
   *  `u.href`, trimmed and normalised — never `deps.apiUrl` raw, which a
   *  whitespace-padded value would carry, unparsed, straight into the
   *  request URL. `.href` adds a trailing slash to a bare origin
   *  (`new URL('http://h:1').href === 'http://h:1/'`), stripped here so the
   *  concatenation below never doubles it. `null` iff `baseProblem !== null`. */
  const baseVerdict = BASE_URL_OK(deps.apiUrl);
  const validatedBase = baseVerdict.ok ? baseVerdict.url.replace(/\/$/, '') : null;
  let lastOkAt: number | null = null;
  let lastError: { at: number; reason: CatalogueErrorReason } | null = null;
  /** The ETag of the last listing the store ACCEPTED — never of one it refused,
   *  or a 304 would pin the catalogue to a listing that was never written. */
  let etag: string | null = null;
  /** D-3215: the LATEST probe's own ETag — independent of the listing's; a
   *  304 here says nothing about the listing and vice versa. */
  let latestEtag: string | null = null;
  let requestedAt: number | null = null;
  let inflight: Promise<CatalogueState> | null = null;
  /** B6: a store throw inside a poll is otherwise silent — `lastError` says
   *  'malformed' but names no cause. Warned ONCE per distinct message, so a
   *  wedged store does not spam the log every 30 minutes; reset on the next
   *  answered poll, so a NEW cause after a recovery is warned again. */
  let lastWarnedStoreError: string | null = null;
  /** D-3215: the latest-release probe's own dedupe key. Ruled: a failed
   *  latest fetch never touches `lastError`/`lastOkAt` (those follow the
   *  LISTING alone) — it only warns, once per distinct cause, re-armed the
   *  next time the probe answers (200 applied, 304, or 404 — all three are
   *  answers, not failures). */
  let lastWarnedLatestError: string | null = null;

  const snapshot = (): CatalogueState => ({ lastOkAt, lastError: lastError === null ? null : { ...lastError } });
  /** Every error arm: `lastOkAt` is untouched (§18 "errors never move lastOkAt"). */
  const failed = (now: number, reason: CatalogueErrorReason): CatalogueState => {
    lastError = { at: now, reason };
    return snapshot();
  };
  const answered = (now: number): CatalogueState => {
    lastOkAt = now;
    lastError = null;
    lastWarnedStoreError = null;   // B6: a recovery re-arms the next distinct cause
    return snapshot();
  };
  const warnLatest = (cause: string): void => {
    if (cause === lastWarnedLatestError) return;
    console.warn(`ccrc-server: update catalogue latest-release probe failed (${cause})`);
    lastWarnedLatestError = cause;
  };
  const latestAnswered = (): void => { lastWarnedLatestError = null; };

  async function pollListing(now: number, source: { owner: string; repo: string }): Promise<CatalogueState> {
    // B2: built from `validatedBase` — the SAME trimmed/normalised base the
    // gate accepted — never `deps.apiUrl` raw.
    const url = `${validatedBase}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
      + `/releases?per_page=${RELEASES_PER_PAGE}`;
    const sentEtag = etag;
    requestedAt = now;
    const answer = await fetchOne(url, sentEtag, timeoutMs);
    if (answer === null) return failed(now, 'no-egress');
    if (answer === 'over-cap') return failed(now, 'malformed');   // D-3209
    if (answer === 'redirect') return failed(now, 'redirect');    // F9
    // A 304 is an answer only to a question that carried an ETag; unsolicited,
    // nothing was held to be "not modified".
    if (answer.status === 304) return sentEtag === null ? failed(now, httpReason(304)) : answered(now);
    if (answer.status === 403 || answer.status === 429) return failed(now, 'rate-limited');
    if (answer.status !== 200) return failed(now, httpReason(answer.status));
    let body: unknown;
    try {
      body = JSON.parse(answer.text);
    } catch {
      return failed(now, 'malformed');
    }
    // D-3209: the request's own `per_page` makes a longer raw array out of
    // contract — refuse it rather than hand `Math.min(...)`/`tag NOT IN (…)`
    // (one SQL parameter per row) an unbounded listing.
    if (Array.isArray(body) && body.length > RELEASES_PER_PAGE) return failed(now, 'malformed');
    const parsed = parseReleaseListing(body);
    if (parsed === null) return failed(now, 'malformed');
    let applied: ApplyReleaseListingResult;
    try {
      // D-3209: a throw from the store (e.g. a still-oversized listing that
      // slips past the length gate above) must set `lastError`, never reject
      // `pollOnce` — a rejection is exactly what left `lastOkAt` reading
      // "up to date" after a failed poll before this fix.
      applied = deps.store.applyReleaseListing(parsed.rows, now, parsed.coverage);
    } catch (err) {
      // B6: the cause was otherwise silent — `lastError` said 'malformed'
      // and nothing else. Warned once per distinct message; a repeat of the
      // same message (e.g. a wedged coordination database, every 30 minutes) stays quiet.
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastWarnedStoreError) {
        console.warn(`ccrc-server: update catalogue store threw: ${message}`);
        lastWarnedStoreError = message;
      }
      return failed(now, 'malformed');
    }
    if (!applied.ok) return failed(now, 'malformed');
    etag = answer.etag;
    return answered(now);
  }

  /**
   * D-3215: the second, independent conditional GET — GitHub's own answer to
   * "what is the current stable release", which is not a function of any
   * page window. Never touches `lastOkAt`/`lastError` (those are the
   * LISTING's alone, per the ruling in the module docstring); every failure
   * is a `console.warn`, deduped on its cause and re-armed on the next
   * answer. A 404 (no stable release exists yet) and a 304 (unchanged) are
   * both answers, never failures.
   */
  async function pollLatest(now: number, source: { owner: string; repo: string }): Promise<void> {
    const url = `${validatedBase}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases/latest`;
    const sentEtag = latestEtag;
    const answer = await fetchOne(url, sentEtag, timeoutMs);
    if (answer === null) return warnLatest('no-egress');
    if (answer === 'over-cap') return warnLatest('over-cap');
    if (answer === 'redirect') return warnLatest('redirect');
    if (answer.status === 404) return latestAnswered();   // an answer: no stable release yet
    if (answer.status === 304) {
      if (sentEtag === null) return warnLatest(httpReason(304));
      return latestAnswered();
    }
    if (answer.status !== 200) return warnLatest(httpReason(answer.status));
    let body: unknown;
    try {
      body = JSON.parse(answer.text);
    } catch {
      return warnLatest('malformed-json');
    }
    const row = parseReleaseElement(body);
    if (row === null) return warnLatest('malformed-element');
    let applied: ApplyReleaseListingResult;
    try {
      // D-3215: the ONE catalogue writer, under 'single' coverage — no
      // absence judgment, so this call can never yank another release.
      applied = deps.store.applyReleaseListing([row], now, 'single');
    } catch (err) {
      return warnLatest(err instanceof Error ? err.message : String(err));
    }
    if (!applied.ok) return warnLatest(`store-refused-${applied.why}`);
    latestEtag = answer.etag;   // never advanced on any failure arm above
    latestAnswered();
  }

  async function pollOnce(now: number): Promise<CatalogueState> {
    // D-3209: an unusable base is exactly as unusable as a missing release
    // source — same reason, no request, `requestedAt` untouched.
    if (baseProblem !== null || validatedBase === null) return failed(now, 'no-release-source');
    const source = deps.source;
    if (!source.ok) return failed(now, 'no-release-source');
    const listingState = await pollListing(now, source);
    // D-3215: independent of the listing's outcome, and never allowed to
    // change what pollListing already decided.
    await pollLatest(now, source);
    return listingState;
  }

  return {
    poll(now: number): Promise<CatalogueState> {
      if (inflight !== null) return inflight;
      const run = pollOnce(now).finally(() => { inflight = null; });
      inflight = run;
      return run;
    },
    state: snapshot,
    lastRequestAt: () => requestedAt,
  };
}
