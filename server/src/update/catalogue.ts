import { isReleaseTag, type CatalogueErrorReason, type CatalogueState } from '../../../shared/api.js';
import type { ReleaseSourceRead } from '../config.js';
import type { ApplyReleaseListingResult, ListingCoverage, ReleaseListingRow } from '../coord/store.js';
import { openPoolReadDeadline } from '../pools.js';

/**
 * L3 — the release-catalogue poller (design 2026-09-20 §7).
 *
 * One conditional GET of GitHub's release listing, a defensive parse, and ONE
 * call to the store's one catalogue writer (`applyReleaseListing`, plan
 * D-3180). Nothing else here writes anything: the
 * port below has no delete and no per-row upsert, so "a yanked release is
 * kept" (§18) is a property of the only door this module holds.
 *
 * Quota (§7, measured): unauthenticated, 60 requests an hour per IP, and a
 * 304 still counts — the ETag saves bytes, not budget. The watcher polls every
 * 30 minutes; `POST /api/updates/refresh` reads `lastRequestAt()` for its
 * one-a-minute guard. No token is ever sent (decision 4: the repo carries no
 * secrets, and the server holds none for GitHub).
 *
 * Fail-soft, and the failure is an answer: every error arm sets `lastError`
 * and never `lastOkAt`, so no consumer can render a failed poll as "up to
 * date". `lastError` is the CURRENT failure — an answer clears it
 * (D-3197). The state and the ETag are this process's memory
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

/** GitHub's REST API refuses a request with no User-Agent; say who asks
 *  rather than send the runtime's default. */
const USER_AGENT = 'ccrc-server';
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DOWNLOAD_URL = /^https?:\/\/\S+$/;
const DOWNLOAD_URL_MAX = 2048;

/** The port this module needs, declared by the consumer (L2). */
export interface CatalogueStore {
  applyReleaseListing(listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage): ApplyReleaseListingResult;
}

export interface CatalogueDeps { source: ReleaseSourceRead; apiUrl: string; store: CatalogueStore; timeoutMs?: number }

export interface CataloguePoller {
  /** Single-flight: a poll during a poll returns the in-flight promise. Resolves
   *  with the state after this poll; rejects only if the store's writer throws. */
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

/** One listing element → one row, or null when any field this module relies on
 *  is missing or out of shape. A `prerelease` that is not a boolean is refused,
 *  never defaulted: `stable` is the channel a dev build must not reach. */
function parseReleaseElement(el: unknown): ReleaseListingRow | null {
  if (!isObject(el)) return null;
  const { tag_name: tag, prerelease, draft, published_at: published, target_commitish: commitish, assets, body } = el;
  if (!isReleaseTag(tag)) return null;
  if (typeof prerelease !== 'boolean') return null;
  if (typeof published !== 'string') return null;
  const publishedAt = Date.parse(published);
  if (!Number.isFinite(publishedAt)) return null;
  if (!Array.isArray(assets)) return null;
  const url = assetNamed(assets, `ccrc-${tag}.tar.gz`)?.browser_download_url;
  if (typeof url !== 'string' || url.length > DOWNLOAD_URL_MAX || !DOWNLOAD_URL.test(url)) return null;
  return {
    tag,
    channel: prerelease ? 'dev' : 'stable',
    publishedAt,
    commitSha: typeof commitish === 'string' && COMMIT_SHA.test(commitish) ? commitish : null,
    tarballUrl: url,
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
 *  until a poll parses it again (D-3206). */
export function parseReleaseListing(body: unknown): ParsedListing | null {
  if (!Array.isArray(body)) return null;
  const rows: ReleaseListingRow[] = [];
  let skipped = 0;
  for (const el of body) {
    const row = parseReleaseElement(el);
    if (row === null) skipped += 1;
    else rows.push(row);
  }
  return { rows, skipped, coverage: body.length < RELEASES_PER_PAGE ? 'complete' : 'newest-page' };
}

export function createCataloguePoller(deps: CatalogueDeps): CataloguePoller {
  const timeoutMs = deps.timeoutMs !== undefined && deps.timeoutMs > 0 ? deps.timeoutMs : CATALOGUE_TIMEOUT_MS;
  let lastOkAt: number | null = null;
  let lastError: { at: number; reason: CatalogueErrorReason } | null = null;
  /** The ETag of the last listing the store ACCEPTED — never of one it refused,
   *  or a 304 would pin the catalogue to a listing that was never written. */
  let etag: string | null = null;
  let requestedAt: number | null = null;
  let inflight: Promise<CatalogueState> | null = null;

  const snapshot = (): CatalogueState => ({ lastOkAt, lastError: lastError === null ? null : { ...lastError } });
  /** Every error arm: `lastOkAt` is untouched (§18 "errors never move lastOkAt"). */
  const failed = (now: number, reason: CatalogueErrorReason): CatalogueState => {
    lastError = { at: now, reason };
    return snapshot();
  };
  const answered = (now: number): CatalogueState => {
    lastOkAt = now;
    lastError = null;
    return snapshot();
  };

  async function pollOnce(now: number): Promise<CatalogueState> {
    const source = deps.source;
    if (!source.ok) return failed(now, 'no-release-source');
    const url = `${deps.apiUrl}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
      + `/releases?per_page=${RELEASES_PER_PAGE}`;
    const sentEtag = etag;
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT };
    if (sentEtag !== null) headers['if-none-match'] = sentEtag;
    const deadline = openPoolReadDeadline(timeoutMs);
    if (deadline === null) return failed(now, 'no-egress');   // unreachable: timeoutMs > 0
    requestedAt = now;
    let answer: { status: number; etag: string | null; text: string } | null;
    try {
      // The body is read INSIDE the race: `close()` aborts the controller, and
      // a body still streaming after it would be cut. A throw (refused, reset,
      // DNS) and the deadline both arrive as null — both are no egress.
      answer = await deadline.race((async () => {
        const res = await fetch(url, { headers, signal: deadline.signal });
        const text = res.status === 200 ? await res.text() : '';
        return { status: res.status, etag: res.headers.get('etag'), text };
      })());
    } finally {
      deadline.close();
    }
    if (answer === null) return failed(now, 'no-egress');
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
    const parsed = parseReleaseListing(body);
    if (parsed === null) return failed(now, 'malformed');
    const applied = deps.store.applyReleaseListing(parsed.rows, now, parsed.coverage);
    if (!applied.ok) return failed(now, 'malformed');
    etag = answer.etag;
    return answered(now);
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
