import { isReleaseTag, type CatalogueErrorReason, type CatalogueState } from '../../../shared/api.js';
import { BASE_URL_OK } from '../../../shared/base-url.js';
import { compareReleaseTags } from '../../../shared/semver.js';
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
 * stable release (§7's window) is not silently unresolvable. Fix round 2
 * (N1): the latest probe runs FIRST, every poll — the listing reads its
 * answer (`lastLatestTag`) as its own yank exclusion (`keepTags`), and doing
 * that with a POLL-STALE answer (the probe running second) let a genuinely
 * withdrawn stable release stay un-yanked indefinitely; see `pollOnce`. Fix
 * round 1, item 5 (ruling A): a withdrawn or demoted stable OFF the
 * listing's own window was still never re-judged by any of the above —
 * `measureWithdrawn` confirms the moment `/latest` moves away from the kept
 * tag K (a 404, or a 200 naming a tag OLDER than K) with a THIRD request,
 * `GET /releases/tags/{K}`, before anything yields; see `pollLatest`. Fix
 * round 2 (R2, review 143): the check's own 404/200 answer is measured
 * immediately, but its WRITE — the yank, or the demotion/still-stable
 * upsert — is applied only once THIS SAME POLL's listing has itself
 * answered with a fresh 200 body. A repository that is not answering at all
 * (every endpoint 404s — misconfigured, private or deleted) must never be
 * read as evidence that one specific release is gone, or the poller would
 * walk the whole known catalogue down to nothing, one release per poll, on
 * no real evidence. See `pollOnce`'s `pendingWithdrawal`.
 *
 * Quota (§7, measured; D-3215 doubles it): unauthenticated, 60 requests an
 * hour per IP (`UNAUTHENTICATED_HOURLY_REQUEST_BUDGET`), and a 304 still
 * counts — the ETag saves bytes, not budget. Each poll sends AT MOST
 * `CATALOGUE_MAX_REQUESTS_PER_POLL` (3) requests: the latest-release probe,
 * the listing, and — only on a poll where `/latest` has moved away from K and
 * the check has not yet resolved — one further tag fetch, rare and bounded to
 * one extra request per poll, never a loop within one poll. The watcher's
 * steady-state 30-minute cadence therefore spends at most 6 requests an
 * hour, well under the 60/hour budget. Fix round 2 (R1, D-3218; corrected
 * C3): `POST /api/updates/refresh` (`routes.ts`) gates `lastRequestAt()` at
 * an interval DERIVED from these two constants AND `CATALOGUE_POLL_INTERVAL_MS`
 * below — never a hand-typed one — admitting a poll once a MINUTE (fix
 * round 1's own text) let a thumb spend up to 180 requests an hour, three
 * times the budget, since each admitted poll could itself cost three
 * requests; deriving the door's interval from the door alone (R1's first
 * fix) still ignored the SCHEDULED poll's own share of the same budget
 * (C3) — the two lanes' worst cases are summed before the door's interval
 * is sized. Fix round 3 (B3, D-3218 amended): that sizing now also leaves
 * `MARGIN_POLLS_PER_HOUR` (`routes.ts`) worth of headroom, covering a
 * restart's immediate first poll (both clocks live only in this process's
 * memory), and each request stamps the budget clock at its OWN send time —
 * never the poll's shared start `now` — so a poll whose tag check or
 * listing goes out a deadline late is not under-counted against the hour it
 * actually lands in. No token is ever sent (decision 4: the repo carries no
 * secrets, and the server holds none for GitHub).
 *
 * Fail-soft, and the failure is an answer: every LISTING error arm sets
 * `lastError` and never `lastOkAt`, so no consumer can render a failed poll
 * as "up to date". `lastError` is the CURRENT failure — an answer clears it
 * (D-3197). `catalogueState`
 * (`{lastOkAt, lastError}`) follows the LISTING alone (D-3215) — neither the
 * latest-release probe nor the moved-away check ever sets either: each
 * failure is warned once per distinct cause (on its OWN dedupe key, so a
 * check that keeps failing is not silenced by the unrelated `/latest` probe
 * succeeding) and re-armed on its own next success. The state and both
 * ETags are this process's memory
 * (D-3182): a restarted server polls on its first
 * tick and says "never checked" until then; the rows themselves persist in
 * the store. K itself is NEVER stored — `currentK` derives it from the
 * store's `newestUnyankedStable()` whenever the remembered tag has gone
 * null, so a restart re-derives the same pending check with no new column
 * and no new process-memory slot.
 *
 * `bundleListed` is a FILENAME in an unauthenticated listing, not a
 * verification — the node verifies (§5) and reports `provenance` (§8).
 */
export const RELEASES_PER_PAGE = 30;
/** Fix round 2 (R1, D-3218; corrected C3): the max HTTP requests a single
 *  `poll()` can issue — the latest-release probe, the listing, and the rare
 *  moved-away tag check (never a loop within one poll; see the module
 *  docstring's Quota paragraph). `routes.ts`'s refresh door derives its
 *  interval from THIS constant, `UNAUTHENTICATED_HOURLY_REQUEST_BUDGET` and
 *  `CATALOGUE_POLL_INTERVAL_MS` below, never a hand-typed interval — these
 *  three constants are the only place any of those numbers is spelled. */
export const CATALOGUE_MAX_REQUESTS_PER_POLL = 3;
/** Fix round 2 (R1, D-3218): spec §7's unauthenticated budget, GitHub's own
 *  limit for the whole server process's IP — one named constant so the
 *  refresh door's interval is computed, never re-typed. */
export const UNAUTHENTICATED_HOURLY_REQUEST_BUDGET = 60;
/** A GitHub listing that has not answered in 10 s is not going to; the lane
 *  is void-dispatched, so this bounds a request, not the tick. */
export const CATALOGUE_TIMEOUT_MS = 10_000;
/** Fix round 2 (C3, ruling): the SCHEDULED poll's own cadence (`watch.ts`'s
 *  `tick()`, gated above the registry's fail-shut return, D-3198) — moved
 *  here, catalogue.ts owning it, so `routes.ts`'s refresh-door interval can
 *  derive `SCHEDULED_POLLS_PER_HOUR` from the SAME constant `watch.ts`
 *  polls on, rather than a second copy. GitHub's unauthenticated listing
 *  budget is 60 requests an hour per IP and a 304 still spends one, so every
 *  30 minutes is 2 scheduled polls an hour, leaving the rest of the budget
 *  to `POST /api/updates/refresh`. */
export const CATALOGUE_POLL_INTERVAL_MS = 30 * 60_000;
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
export const DOWNLOAD_URL_MAX = 2048;
/** F10 (fix round 1, D-3216): every byte of a download URL must be printable
 *  ASCII (`\x21`-`\x7e`) — no control byte, no non-ASCII byte a naive
 *  terminal or log line would mis-render. */
const PRINTABLE_ASCII_URL = /^[\x21-\x7e]+$/;

/** The port this module needs, declared by the consumer (L2). `keepTags`
 *  (fix round 1, review round 2, I3) is optional so an older test double
 *  written against the three-argument shape still type-checks; the real
 *  store always accepts it. `withdrawTag` (fix round 1, item 5, ruling A) is
 *  likewise optional, and read only under `'withdrawn'` coverage.
 *  `newestUnyankedStable` is ALSO optional, for the same reason — a test
 *  double that never exercises the moved-away mechanism need not implement
 *  it; `currentK` below reads it through `?.() ?? null`. */
export interface CatalogueStore {
  applyReleaseListing(
    listing: readonly ReleaseListingRow[], now: number, coverage: ListingCoverage,
    keepTags?: readonly string[], withdrawTag?: string | null,
  ): ApplyReleaseListingResult;
  newestUnyankedStable?(): string | null;
}

/** Fix round 3 (B3, D-3218 amended, review 146): an injectable monotonic
 *  clock — `performance.now()` by default — the ONE thing `stampRequest`
 *  (below) reads to know how far a given request's own send sits past the
 *  poll's start. A test injects a controllable source so `lastRequestAt()`
 *  can be pinned to an exact value across a poll issuing more than one
 *  request; production never overrides it. */
export interface CatalogueDeps {
  source: ReleaseSourceRead; apiUrl: string; store: CatalogueStore; timeoutMs?: number; elapsedMs?: () => number;
}

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

/** I1 (fix round 1, review round 2): `'@'` ANYWHERE in the raw base is
 *  refused before `BASE_URL_OK` even runs, with its own word and NO
 *  scheme/host suffix at all. A GitHub API base never legitimately contains
 *  one. This is not redundant with `BASE_URL_OK`'s own credential check: a
 *  `'@'` preceded by a `/`, `?` or `#` sits OUTSIDE the URL's authority (WHATWG
 *  ends the authority at the first such delimiter), so `u.username`/
 *  `u.password` both read empty and `BASE_URL_OK` never sees it as
 *  credentials — instead the text BEFORE the delimiter parses as the
 *  hostname (or, past a leading `/`, the path), and printing "the host"
 *  would print the secret's own head (measured: `https://se?cret@host`
 *  parses with `hostname: 'se'`). It also refuses
 *  `https://ghp_TOKEN/@api.github.com`, which `BASE_URL_OK` alone ACCEPTS
 *  (hostname `ghp_token`, `https:` needs no loopback check) and which would
 *  send a live token out as a DNS lookup every poll — closed here, without
 *  touching the shared gate. */
function apiBaseHasAt(raw: string): boolean {
  return raw.includes('@');
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
 *  never carries any fragment of the base's userinfo, query, fragment or
 *  path in clear (F3, fix round 1; hardened I1, review round 2) — a raw base
 *  containing `'@'` anywhere prints the refusal word alone; otherwise, when
 *  the value parses at all with a real host, its scheme and host; an
 *  unparseable base, or one with no real host, prints neither. */
export function apiBaseProblem(apiUrl: string): string | null {
  if (apiBaseHasAt(apiUrl)) return 'apiUrl refused (base-url-has-at)';
  const verdict = BASE_URL_OK(apiUrl);
  return verdict.ok ? null : `apiUrl refused (${verdict.reason})${safeSchemeHost(apiUrl)}`;
}

export interface CataloguePoller {
  /** Single-flight: a poll during a poll returns the in-flight promise.
   *  Resolves only after BOTH the listing request and the latest-release
   *  probe (D-3215) have fully settled (fix round 1, review round 2, I2),
   *  with the state AS IT STANDS THEN — never a snapshot captured before the
   *  probe ran. Never rejects — every failure, including the store's writer
   *  throwing, is folded into the resolved state's `lastError` (see the
   *  `applyReleaseListing` call site below), except the latest probe's own
   *  failures, which are warned, never reflected in `lastError`/`lastOkAt`. */
  poll(now: number): Promise<CatalogueState>;
  /** `{lastOkAt: null, lastError: null}` until the first answer — "never checked". A copy. */
  state(): CatalogueState;
  /** The `now` of the last poll that SENT a request; `null` = never requested.
   *  A poll with no release source sends nothing and does not move it. */
  lastRequestAt(): number | null;
}

export interface ParsedListing { rows: ReleaseListingRow[]; skipped: number; coverage: ListingCoverage }

/** Fix round 4 (F1, coordinator's reshaped B2 ruling, review 149): what a
 *  fresh listing's own row says about ONE tag — never just "is it named at
 *  all". `draft` and `channel` are the two facts a pending withdrawal's
 *  contradiction check needs; see `listingContradictsPending`. */
export interface ListingFact { draft: boolean; channel: ReleaseListingRow['channel'] }

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
 *  listed; only this one untrusted field is withheld.
 *
 *  R7 (fix round 2, D-3216, review 143): the raw string is untrusted TEXT a
 *  DIFFERENT client — not this process's own WHATWG parser — will read. A
 *  `\` before an authority-shaped `@` is a measured parser differential:
 *  `https://github.com\@evil.example/x` parses here with `hostname`
 *  `github.com` and empty `username`/`password` (WHATWG folds `\` to `/` on
 *  a special scheme, so the whole `\@evil.example/x` lands in the PATH), but
 *  curl 8.5.0 given the same raw text connects to the host AFTER the `@` —
 *  refused outright, never parsed around. What is stored is the PARSED,
 *  NORMALISED form (`u.href`), never the raw string: a raw value that
 *  survives here unexamined (a default port, an unnormalised path) is
 *  exactly the shape a different client could read differently than this
 *  parse did — the same lesson `safeSchemeHost` applies one layer up. */
function safeDownloadUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > DOWNLOAD_URL_MAX || !PRINTABLE_ASCII_URL.test(raw)) return null;
  if (raw.includes('\\')) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
  // S2 (fix round 2): `DOWNLOAD_URL_MAX` above bounds the RAW string, but
  // WHATWG percent-encoding of `u.href` — the STORED, parsed form — can be
  // several times longer (measured: 2019 printable-ASCII `"` bytes raw,
  // 6019 once encoded). Re-check the form that actually reaches
  // `tarballUrl` before returning it, so the field's bound is the one it is
  // documented to have (D-3216).
  if (u.href.length > DOWNLOAD_URL_MAX) return null;
  return u.href;
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
  /** Fix round 3 (B3, D-3218 amended, review 146): read once at the START of
   *  each poll (`pollOnce`) and again immediately before each of the three
   *  `stampRequest` call sites — never cached across polls. */
  const elapsedMs = deps.elapsedMs ?? ((): number => performance.now());
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
  /** I3 (fix round 1, review round 2): the stable tag the listing must not
   *  yank — process memory, like the ETags (D-3182). Set by a 200 the probe
   *  applied UNCONDITIONALLY (T is real regardless of K); unchanged by a 304
   *  or any probe failure; on a move AWAY from K (a 404 or an older tag,
   *  ruling A) it moves only once BOTH K's own tag fetch has resolved AND —
   *  fix round 2 (R2, review 143) — the SAME poll's listing has itself
   *  answered with a fresh 200 body (see `pollOnce`'s `pendingWithdrawal`),
   *  and stays at K until then. R16 (fix round 2, review 143) corrects what
   *  it moves TO: `applyWithdrawn` sets it to T, the `/latest` answer that
   *  triggered the check — `null` only when `/latest` itself answered a
   *  bare 404, never on a confirmed demotion, where T is the real, older
   *  tag `/latest` named (a previous version of this comment claimed
   *  "to null after a bare 404 or a confirmed withdrawal", which was true
   *  only for the 404 arm). When it is null, `currentK()` re-derives K from
   *  the store (restart). The LISTING's yank statement excludes it
   *  (`pollListing`'s `keepTags`), so a `complete`/`newest-page` listing
   *  that omits it (the off-page-stable shape D-3215 exists for) never
   *  marks it absent out from under the probe that just confirmed it. */
  let lastLatestTag: string | null = null;
  /** Fix round 4 (F3, coordinator's ruling, review 149): true iff K is NOT
   *  trustworthy from `lastLatestTag` alone and `currentK()` must re-read
   *  the store — set on a `measuredCurrentK()` throw on the 200 arm (which
   *  still sets `lastLatestTag = row.tag` so `keepTags` protects THIS
   *  poll's `/latest` answer even though K itself stayed unmeasured), and
   *  cleared only where a real store answer is trusted: a clean adopt (no
   *  move-away) or `applyWithdrawn`'s own success. A move-away that is
   *  MEASURED but not yet applied (dropped, deferred, or the check itself
   *  failed) leaves it exactly where it was — set if a throw put it there,
   *  so the next poll re-reads K again rather than silently trusting
   *  `lastLatestTag`; unset if nothing has ever thrown. See `currentK()`. */
  let kNeedsReread = false;
  /** Fix round 1, item 5 (ruling A): the moved-away tag-fetch's own dedupe
   *  key — separate from `lastWarnedLatestError` so a check that keeps
   *  failing while `/latest` itself keeps answering fine is not re-armed
   *  every poll by that unrelated success (which would spam the log). */
  let lastWarnedWithdrawnError: string | null = null;
  /** Fix round 4 (F1, coordinator's reshaped ruling, review 149): the
   *  listing-contradicts-the-check warning's own dedupe key — keyed on K
   *  itself (a DIFFERENT K always warns), and re-armed by `withdrawnAnswered()`
   *  so the next episode where a check actually applies warns again, rather
   *  than being silenced forever by one earlier, unrelated cause's reset. */
  let lastWarnedListingWinsFor: string | null = null;
  /** Fix round 2 (S1): `currentK()`'s own dedupe key — a throw from
   *  `deps.store.newestUnyankedStable` is a DIFFERENT failure than any of
   *  the three requests', so it gets its own message-keyed warn rather than
   *  sharing `lastWarnedLatestError`/`lastWarnedWithdrawnError`, which would
   *  let an unrelated request success re-arm it or a store failure silence
   *  an unrelated request failure. */
  let lastWarnedCurrentKError: string | null = null;
  /** B2 (fix round 3, coordinator's ruling, review 146): the per-tag facts a
   *  fresh, ACCEPTED listing last named — process memory, like the ETags
   *  (D-3182). `null` until the first accepted listing; set only where
   *  `etag` itself is (see `pollListing`). Fix round 4 (F1, coordinator's
   *  reshaped ruling, review 149): widened from a bare tag SET to a
   *  draft/channel FACT per tag — a bare "named at all" cannot tell a
   *  contradicting listing from an AGREEING one (F1's own defect). Read only
   *  through `listingContradictsPending`, the SAME helper the apply-decision
   *  site uses on THIS poll's own fresh facts, so the ETag-keep decision and
   *  the apply-decision can never disagree about what "already settles
   *  this" means (see `pollOnce`). */
  let lastAcceptedListingFacts: ReadonlyMap<string, ListingFact> | null = null;
  /** Fix round 3 (B3, D-3218 amended, review 146): `elapsedMs()`'s reading at
   *  THIS poll's own start — captured once, at the top of `pollOnce`, so
   *  every `stampRequest` call this poll measures its own request's send
   *  time relative to the SAME baseline, never a moving one. */
  let pollStartElapsed = 0;

  /** Fix round 2 (S1, review 143): ruling 1's "every catalogue REQUEST stamps
   *  the budget clock" — the ONE place `requestedAt` moves, called at every
   *  one of the three fetch sites (the listing, the latest-release probe, the
   *  moved-away tag check) immediately before that site's own `fetchOne`
   *  call, so a request that is SENT is what stamps the clock — never a
   *  side effect of some other site's success. Fixing the class here (one
   *  helper, three call sites) rather than at each site's own assignment is
   *  what keeps them from drifting apart again.
   *
   *  Fix round 3 (B3, D-3218 amended, review 146): `now` alone used to BE the
   *  stamp — every one of the three sites shared the SAME poll-start value,
   *  even though the tag check and the listing can go out one or two
   *  deadlines later than the probe, letting up to 61 requests land inside
   *  one nominal GitHub hour. The stamp is now `now` PLUS how far
   *  `elapsedMs()` has moved since `pollStartElapsed` was captured at this
   *  poll's start, so a call made after a real request's round trip stamps
   *  LATER than one made before it. Floored at 0 — `elapsedMs()` is
   *  monotonic in practice, but `routes.ts`'s door treats a `lastRequestAt`
   *  in the future as "the clock stepped back" and ADMITS, so a stamp must
   *  never land ahead of a LATER caller's own `now` either; the floor keeps
   *  every stamp within `[now, now + observed elapsed]`. */
  const stampRequest = (now: number): void => {
    requestedAt = now + Math.max(0, Math.floor(elapsedMs() - pollStartElapsed));
  };

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
  const warnWithdrawn = (cause: string): void => {
    if (cause === lastWarnedWithdrawnError) return;
    console.warn(`ccrc-server: update catalogue moved-away tag check failed (${cause})`);
    lastWarnedWithdrawnError = cause;
  };
  /** Fix round 4 (F1, coordinator's reshaped ruling, review 149): a
   *  SEPARATE dedupe from `warnWithdrawn` — this is not a check FAILURE
   *  (the check succeeded and answered), so it must never say "check
   *  failed". Deduped on K itself; re-armed by `withdrawnAnswered()`. */
  const warnListingWins = (k: string): void => {
    if (k === lastWarnedListingWinsFor) return;
    console.warn(`ccrc-server: update catalogue listing contradicts the moved-away tag check for ${k} (listing wins)`);
    lastWarnedListingWinsFor = k;
  };
  const withdrawnAnswered = (): void => { lastWarnedWithdrawnError = null; lastWarnedListingWinsFor = null; };
  /** Fix round 1, item 5 (ruling A): K is never a stored column — derived on
   *  demand, whenever the poller's own remembered tag has gone null, as the
   *  store's newest un-yanked stable release BY TAG. `null` when the store
   *  holds no such release, or the port is a test double that never
   *  implements the read (an older double, or one that never exercises this
   *  mechanism). Fix round 4 (F3, coordinator's ruling, review 149): also
   *  re-reads when `kNeedsReread` is set — a PERSISTENT store throw on the
   *  200 arm still lets `lastLatestTag` carry T for `keepTags`'s sake, but
   *  that value is never K itself, so it must not be trusted here until a
   *  real store answer clears the flag. */
  const currentK = (): string | null =>
    (lastLatestTag !== null && !kNeedsReread) ? lastLatestTag : (deps.store.newestUnyankedStable?.() ?? null);

  /** Fix round 2 (S1): `currentK()`'s only caller-visible read that can throw
   *  — a SQLite error, or a `RangeError` from `newestTag` over any non-tag
   *  `releases.tag` row (`store.ts:5913-5917`) — sat outside any try, so it
   *  could reject `poll()` itself, breaking its own "Never rejects"
   *  docstring and silently freezing the catalogue lane (the listing never
   *  ran either, since it comes after in `pollOnce`). A throw here is read
   *  as "K unknown THIS poll": no moved-away tag check is attempted, so
   *  nothing is yanked on its account, and the listing still runs.
   *  Fix round 3 (B1, D-3215 amended, review 146): the 200 arm used to fold
   *  `threw` into `k: null` and then advance `lastLatestTag`/`latestEtag` to
   *  the tag it had just confirmed, exactly as a legitimate "no K yet"
   *  would — but that fold is PERMANENT: once `lastLatestTag` is non-null,
   *  `currentK()` never reads the store again, so one transient throw could
   *  leave a genuinely withdrawn stable release un-yanked until a restart.
   *  The 200 arm now treats `threw` exactly like the 404 arm always did — a
   *  FAILED PROBE, advancing neither var — so the very next poll re-reads
   *  the store. `threw` and `k: null` therefore no longer lead to the same
   *  next step on the 200 arm; they still stay two distinct values so
   *  neither arm's caller can mistake a failed read for "no stable release".
   *  The warning is deduped on the message and not re-armed on recovery. */
  const measuredCurrentK = (): { threw: true } | { threw: false; k: string | null } => {
    try {
      return { threw: false, k: currentK() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastWarnedCurrentKError) {
        console.warn(`ccrc-server: update catalogue currentK threw: ${message}`);
        lastWarnedCurrentKError = message;
      }
      return { threw: true };
    }
  };

  /** `freshOk` (fix round 2, R2, review 143): true iff THIS call answered
   *  with a fresh 200 body the store accepted — never on a 304 (no body at
   *  all) and never on any failure. `pollOnce` reads it as the ONLY evidence
   *  a pending withdrawal (a yank, or a demotion upsert) may act on: a
   *  repository that is not answering must never be read as proof that one
   *  specific release is gone. */
  async function pollListing(
    now: number, source: { owner: string; repo: string },
  ): Promise<{ state: CatalogueState; freshOk: boolean; facts: ReadonlyMap<string, ListingFact> | null }> {
    // B2: built from `validatedBase` — the SAME trimmed/normalised base the
    // gate accepted — never `deps.apiUrl` raw.
    const url = `${validatedBase}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
      + `/releases?per_page=${RELEASES_PER_PAGE}`;
    const sentEtag = etag;
    stampRequest(now);
    const notFresh = (state: CatalogueState): { state: CatalogueState; freshOk: boolean; facts: ReadonlyMap<string, ListingFact> | null } =>
      ({ state, freshOk: false, facts: null });
    const answer = await fetchOne(url, sentEtag, timeoutMs);
    if (answer === null) return notFresh(failed(now, 'no-egress'));
    if (answer === 'over-cap') return notFresh(failed(now, 'malformed'));   // D-3209
    if (answer === 'redirect') return notFresh(failed(now, 'redirect'));   // F9
    // A 304 is an answer only to a question that carried an ETag; unsolicited,
    // nothing was held to be "not modified". Either way it carries no fresh
    // body, so it is never evidence for a pending withdrawal.
    if (answer.status === 304) return notFresh(sentEtag === null ? failed(now, httpReason(304)) : answered(now));
    if (answer.status === 403 || answer.status === 429) return notFresh(failed(now, 'rate-limited'));
    if (answer.status !== 200) return notFresh(failed(now, httpReason(answer.status)));
    let body: unknown;
    try {
      body = JSON.parse(answer.text);
    } catch {
      return notFresh(failed(now, 'malformed'));
    }
    // D-3209: the request's own `per_page` makes a longer raw array out of
    // contract — refuse it rather than hand `Math.min(...)`/`tag NOT IN (…)`
    // (one SQL parameter per row) an unbounded listing.
    if (Array.isArray(body) && body.length > RELEASES_PER_PAGE) return notFresh(failed(now, 'malformed'));
    const parsed = parseReleaseListing(body);
    if (parsed === null) return notFresh(failed(now, 'malformed'));
    let applied: ApplyReleaseListingResult;
    try {
      // D-3209: a throw from the store (e.g. a still-oversized listing that
      // slips past the length gate above) must set `lastError`, never reject
      // `pollOnce` — a rejection is exactly what left `lastOkAt` reading
      // "up to date" after a failed poll before this fix. I3: `lastLatestTag`
      // rides along as the yank exclusion — `null` becomes `[]` inside the
      // store, changing nothing when the latest probe has never succeeded.
      applied = deps.store.applyReleaseListing(
        parsed.rows, now, parsed.coverage, lastLatestTag === null ? [] : [lastLatestTag],
      );
    } catch (err) {
      // B6: the cause was otherwise silent — `lastError` said 'malformed'
      // and nothing else. Warned once per distinct message; a repeat of the
      // same message (e.g. a wedged coordination database, every 30 minutes) stays quiet.
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastWarnedStoreError) {
        console.warn(`ccrc-server: update catalogue store threw: ${message}`);
        lastWarnedStoreError = message;
      }
      return notFresh(failed(now, 'malformed'));
    }
    if (!applied.ok) return notFresh(failed(now, 'malformed'));
    etag = answer.etag;
    // B2 (fix round 3, coordinator's ruling, review 146): remembered ONLY
    // where `etag` itself is — a fresh, ACCEPTED listing's own content, kept
    // so a LATER poll's pending withdrawal on a tag THIS listing already
    // named needs no forced fresh re-answer purely on the pending's account
    // (see `pollOnce`). Fix round 4 (F1): per-tag FACTS now, not a bare tag
    // set — draft and channel are exactly what `listingContradictsPending`
    // needs, and nothing less lets it tell an agreeing listing from a
    // contradicting one.
    lastAcceptedListingFacts = new Map(parsed.rows.map((r) => [r.tag, { draft: r.draft, channel: r.channel }]));
    return { state: answered(now), freshOk: true, facts: lastAcceptedListingFacts };
  }

  /**
   * D-3215: the second, independent conditional GET — GitHub's own answer to
   * "what is the current stable release", which is not a function of any
   * page window. Never touches `lastOkAt`/`lastError` (those are the
   * LISTING's alone, per the ruling in the module docstring); every failure
   * is a `console.warn`, deduped on its cause and re-armed on the next
   * answer. A 404 (no stable release exists yet) and a 304 (unchanged) are
   * both answers, never failures. Fix round 1, review round 2: a `draft` or
   * `prerelease` element is out of GitHub's own contract for this endpoint
   * (`/releases/latest` never answers either) and is treated as a FAILED
   * latest — warned, deduped, `latestEtag` and `lastLatestTag` both left
   * exactly where they were — never written, so it can neither yank nor
   * alter an existing row.
   *
   * Fix round 2 (N1): runs BEFORE `pollListing` now (see `pollOnce`), so the
   * `lastLatestTag` it leaves behind is THIS poll's answer, never a
   * poll-stale one. Fix round 1, item 5 (ruling A) replaces the plain "a 404
   * clears it, everything else leaves it alone" rule below with a CONFIRMED
   * transition: `/latest` moving AWAY from the kept tag K — a 404, or a 200
   * naming a tag OLDER than K (`compareReleaseTags`) — is not itself proof
   * that K is gone (a listing window or a transient probe answer proves
   * nothing about a release outside itself, exactly D-3215's own lesson one
   * layer up), so `measureWithdrawn` fetches K's own tag before `lastLatestTag`
   * or `latestEtag` move at all. A NEWER tag implies nothing about K and is
   * adopted immediately, with no extra request — the ordinary forward case.
   *
   * Fix round 2 (R2, review 143): a MOVE-AWAY (the 404 arm with a kept K, or
   * the older-tag arm) no longer WRITES anything itself — it MEASURES the
   * confirming tag fetch (`measureWithdrawn`) and returns what it would do
   * as a `PendingWithdrawal`, for `pollOnce` to apply only once this same
   * poll's listing has itself answered fresh. A repository that answers
   * every endpoint 404 (misconfigured, private or deleted) must never be
   * read as proof that one specific release is gone.
   */
  async function pollLatest(
    now: number, source: { owner: string; repo: string },
  ): Promise<PendingWithdrawal | null> {
    const url = `${validatedBase}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases/latest`;
    const sentEtag = latestEtag;
    stampRequest(now);
    const answer = await fetchOne(url, sentEtag, timeoutMs);
    if (answer === null) { warnLatest('no-egress'); return null; }
    if (answer === 'over-cap') { warnLatest('over-cap'); return null; }
    if (answer === 'redirect') { warnLatest('redirect'); return null; }
    // Ruling A: a 404 means "no stable release exists" ONLY when there was
    // no kept tag to begin with — otherwise it is the clean "moved away"
    // signal, confirmed against K's own endpoint before anything yields.
    if (answer.status === 404) {
      // S1: a throwing read is "K unknown this poll" — never treated as the
      // legitimate "no stable release" null, which would wrongly clear a
      // real K out from under a store that merely failed to answer.
      const measured = measuredCurrentK();
      if (measured.threw) { latestAnswered(); return null; }
      if (measured.k === null) {
        lastLatestTag = null;
        latestEtag = null;
        kNeedsReread = false;   // F3: a genuine "no K" needs no re-read
        latestAnswered();
        return null;
      }
      latestAnswered();   // the /latest fetch itself is a clean answer
      return measureWithdrawn(now, source, measured.k, null, null);
    }
    if (answer.status === 304) {
      if (sentEtag === null) { warnLatest(httpReason(304)); return null; }
      latestAnswered();
      return null;
    }
    if (answer.status !== 200) { warnLatest(httpReason(answer.status)); return null; }
    let body: unknown;
    try {
      body = JSON.parse(answer.text);
    } catch {
      warnLatest('malformed-json');
      return null;
    }
    const row = parseReleaseElement(body);
    if (row === null) { warnLatest('malformed-element'); return null; }
    // Fix round 1, review round 2: out of contract for this endpoint — never
    // written, so it can neither yank nor un-yank, nor become `lastLatestTag`.
    if (row.draft || row.channel === 'dev') { warnLatest('latest-not-stable'); return null; }
    let applied: ApplyReleaseListingResult;
    try {
      // D-3215: the ONE catalogue writer, under 'single' coverage — no
      // absence judgment, so this call can never yank another release. T
      // (this row) is real regardless of what happens to K below, so it is
      // upserted unconditionally — this write is never deferred: it never
      // judges any OTHER release absent, so R2's evidence gate does not
      // apply to it.
      applied = deps.store.applyReleaseListing([row], now, 'single');
    } catch (err) {
      warnLatest(err instanceof Error ? err.message : String(err));
      return null;
    }
    if (!applied.ok) { warnLatest(`store-refused-${applied.why}`); return null; }
    latestAnswered();   // the /latest fetch itself succeeded
    // Fix round 3 (B1, D-3215 amended, review 146): a throwing read is a
    // FAILED PROBE here too — never folded into "no K", which advanced
    // lastLatestTag/latestEtag to T exactly as a legitimate null did and
    // made the fold PERMANENT (currentK() never re-reads the store once
    // lastLatestTag is non-null). T's own upsert above already ran and is
    // harmless (D-3215's own "T is real regardless of what happens to K");
    // nothing else here advances on the throw's account, so the very next
    // poll re-reads the store instead of trusting a stale memory.
    //
    // Fix round 4 (F3, coordinator's ruling, review 149): B1's refusal to
    // advance was right for a TRANSIENT throw but left a PERSISTENT one
    // disabling `keepTags`'s protection forever — `lastLatestTag` would stay
    // null (or a stale pre-throw value) across every later poll, so the
    // listing's own absence judgment would never exclude T (this poll's
    // confirmed `/latest` answer) from a yank. `lastLatestTag = row.tag`
    // still runs on a throw, so `keepTags` protects T THIS poll and every
    // later one until a real K is read — but `kNeedsReread` is set alongside
    // it, so `currentK()` never mistakes that borrowed value for K itself.
    const measured = measuredCurrentK();
    if (measured.threw) {
      lastLatestTag = row.tag;   // keepTags protects T even though K is unmeasured
      kNeedsReread = true;       // ...but T is never mistaken for a measured K
      return null;
    }
    const k = measured.k;
    if (k !== null && compareReleaseTags(row.tag, k) < 0) {
      // Ruling A: moved AWAY from K to an OLDER tag T. `latestEtag`/
      // `lastLatestTag` stay pointed at K until the check resolves AND this
      // poll's listing answers fresh (R2) — never advanced to T here — so a
      // failed or deferred check cannot earn a cheap 304 in T's place next
      // poll and is retried in full against the SAME K. F3: `kNeedsReread`
      // (if a prior throw set it) STAYS set here too — only `applyWithdrawn`'s
      // own success clears it — so a dropped, deferred or failed check still
      // re-reads K from the store next poll rather than trusting a value a
      // throw once borrowed for `keepTags` alone.
      return measureWithdrawn(now, source, k, row.tag, answer.etag);
    }
    latestEtag = answer.etag;   // never advanced on any failure arm above
    lastLatestTag = row.tag;    // I3: the LISTING's yank exclusion from now on
    kNeedsReread = false;       // F3: a real store answer was just trusted
    return null;
  }

  /** Fix round 2 (R2): what a confirmed moved-away transition WOULD do to
   *  the store, computed by `measureWithdrawn` but not yet applied. `t`/
   *  `tEtag` are always the triggering `/latest` answer (R16: `t` is `null`
   *  only when `/latest` itself answered a bare 404). */
  type PendingWithdrawal =
    | { kind: 'yank'; k: string; t: string | null; tEtag: string | null }
    | { kind: 'demote'; row: ReleaseListingRow; t: string | null; tEtag: string | null };

  /** Fix round 4 (F1, coordinator's reshaped B2 ruling, review 149): whether
   *  a listing's own per-tag facts CONTRADICT a pending withdrawal — the
   *  ONLY condition under which the listing overrules the moved-away tag
   *  check. A pending `'yank'` is contradicted by ANY non-draft row named K
   *  (the listing just showed K is still there, in either channel); a
   *  pending `'demote'` carries whatever `tags/K` answered — a dev row, but
   *  also a still-STABLE or a DRAFT row (`measureWithdrawn` returns
   *  `'demote'` for every 200) — so it AGREES with a non-draft listing row
   *  only when BOTH say non-draft dev: then the demote applies, moving the
   *  kept tag to T (the listing's own upsert having already written that
   *  same channel is harmless, never a reason to also drop the pending).
   *  Every other non-draft listing row DISAGREES and drops it: a STABLE
   *  listing row, or a check row that is still stable or a draft (fix round
   *  4 task review, I1: applying a stale "still stable" or "draft" check
   *  over a fresh listing that says non-draft dev would re-promote a
   *  demoted K, or yank a live one — the listing wins). A row absent from
   *  the facts, or present only as a DRAFT, never vouches either way —
   *  drafts are never evidence, so that case reads as "no verdict", exactly
   *  like an absent row: the pending proceeds to `applyWithdrawn` as it
   *  would with no listing at all. Used at BOTH the apply-decision site
   *  (`pollOnce`, this poll's own fresh facts) and the ETag-keep decision
   *  (`pollOnce`, the remembered facts) — the SAME helper at both sites, so
   *  a remembered listing that would NOT contradict (would let the pending
   *  apply) never suppresses the ETag reset that gets it a fresh answer. */
  function listingContradictsPending(
    pending: PendingWithdrawal, facts: ReadonlyMap<string, ListingFact> | null,
  ): boolean {
    if (facts === null) return false;
    const fact = facts.get(pending.kind === 'yank' ? pending.k : pending.row.tag);
    if (fact === undefined || fact.draft) return false;
    if (pending.kind === 'yank') return true;
    return fact.channel === 'stable' || pending.row.draft || pending.row.channel !== 'dev';
  }

  /**
   * Fix round 1, item 5 (ruling A): the confirming half of the moved-away
   * transition — `GET {api}/repos/{owner}/{repo}/releases/tags/{k}`, the
   * same base gate, deadline, body cap, element parse and `redirect:
   * 'error'` the other two requests use, with NO ETag of its own (an ad-hoc
   * check, not a tracked poll). `t`/`tEtag` are the `/latest` answer that
   * triggered this call (the new, older-than-K tag and its etag), or both
   * `null` when `/latest` itself answered 404.
   *
   * Fix round 2 (R2, review 143): this function only MEASURES — it never
   * writes. It returns the `PendingWithdrawal` a confirmed withdrawal (404)
   * or a confirmed demotion (200) would apply, for `pollOnce` to hand to
   * `applyWithdrawn` only once this same poll's listing has answered fresh —
   * fix round 3 (B2, coordinator's ruling, review 146) adds a SECOND
   * condition: AND that same fresh listing does not itself name K. Any
   * failure of the check (no-egress, over-cap, a redirect, a non-2xx
   * status, a malformed body) or R8's identity check failing warns and
   * returns `null` — nothing pending, so `lastLatestTag`/`latestEtag` stay
   * exactly where they were and the check is retried, against the SAME K,
   * on the next poll.
   */
  async function measureWithdrawn(
    now: number, source: { owner: string; repo: string }, k: string, t: string | null, tEtag: string | null,
  ): Promise<PendingWithdrawal | null> {
    const url = `${validatedBase}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
      + `/releases/tags/${encodeURIComponent(k)}`;
    stampRequest(now);
    const answer = await fetchOne(url, null, timeoutMs);
    if (answer === null) { warnWithdrawn('no-egress'); return null; }
    if (answer === 'over-cap') { warnWithdrawn('over-cap'); return null; }
    if (answer === 'redirect') { warnWithdrawn('redirect'); return null; }
    if (answer.status === 404) return { kind: 'yank', k, t, tEtag };
    if (answer.status !== 200) { warnWithdrawn(httpReason(answer.status)); return null; }
    let body: unknown;
    try {
      body = JSON.parse(answer.text);
    } catch {
      warnWithdrawn('malformed-json');
      return null;
    }
    const row = parseReleaseElement(body);
    if (row === null) { warnWithdrawn('malformed-element'); return null; }
    // R8 (fix round 2, review 143): this is an IDENTITY check, not just a
    // shape check — the endpoint is asked about k, and an untrusted upstream
    // (or a mirror behind CCRC_RELEASE_API_URL) answering with a DIFFERENT
    // tag's element must never be upserted in k's place, silently dropping
    // k out of `keepTags`/eligibility with no judgment ever having been made
    // about k itself. Treated exactly like any other failed check: nothing
    // pending, retried against the SAME k next poll.
    if (row.tag !== k) { warnWithdrawn('tag-mismatch'); return null; }
    return { kind: 'demote', row, t, tEtag };
  }

  /** Fix round 2 (R2): applies a `PendingWithdrawal` the moved-away check
   *  measured earlier this SAME poll, now that the listing has answered
   *  fresh. A store failure here behaves exactly as a failed check did
   *  before this fix: warned, nothing moved, retried next poll. */
  function applyWithdrawn(now: number, pending: PendingWithdrawal): void {
    let applied: ApplyReleaseListingResult;
    try {
      applied = pending.kind === 'yank'
        // The one catalogue writer, under 'withdrawn' coverage — yanks
        // EXACTLY k, never the general since/window judgment.
        ? deps.store.applyReleaseListing([], now, 'withdrawn', [], pending.k)
        // The same one writer, under 'single' coverage: whatever K's own
        // page reports now (a demotion to dev, or still stable) is upserted
        // with no absence judgment; a draft answer yanks it via the
        // ordinary birth rule (`applyReleaseListing`'s
        // `yanked = r.draft ? 1 : 0`).
        : deps.store.applyReleaseListing([pending.row], now, 'single');
    } catch (err) {
      warnWithdrawn(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!applied.ok) { warnWithdrawn(`store-refused-${applied.why}`); return; }
    latestEtag = pending.tEtag;
    lastLatestTag = pending.t;
    kNeedsReread = false;   // F3: this poll's own store write is a real, fresh answer
    withdrawnAnswered();
  }

  async function pollOnce(now: number): Promise<CatalogueState> {
    // B3 (fix round 3, D-3218 amended): captured ONCE, at this poll's own
    // start, so every `stampRequest` call this poll measures its own
    // request's send time against the SAME baseline.
    pollStartElapsed = elapsedMs();
    // D-3209: an unusable base is exactly as unusable as a missing release
    // source — same reason, no request, `requestedAt` untouched.
    if (baseProblem !== null || validatedBase === null) return failed(now, 'no-release-source');
    const source = deps.source;
    if (!source.ok) return failed(now, 'no-release-source');
    // N1 (fix round 2): the latest probe runs FIRST. `pollListing` reads
    // `lastLatestTag` as its `keepTags` argument, so running the probe first
    // makes that read THIS poll's answer (200 → the confirmed tag; 304 →
    // unchanged; any other failure → unchanged) rather than the previous
    // poll's, which is what let a genuinely withdrawn stable release stay
    // un-yanked forever (the regression the re-review found). A confirmed
    // move-away is no longer among these immediate changes (R2): it is
    // returned as `pendingWithdrawal` and applied below, only once this
    // poll's own listing has answered fresh — so `lastLatestTag` still
    // reads K here, exactly as a poll where the check had not yet resolved
    // always has, and `keepTags` below still protects K for this poll.
    const prevLatestTag = lastLatestTag;
    const pendingWithdrawal = await pollLatest(now, source);
    const pendingK = pendingWithdrawal === null
      ? null
      : (pendingWithdrawal.kind === 'yank' ? pendingWithdrawal.k : pendingWithdrawal.row.tag);
    // B2 (fix round 3, coordinator's ruling, review 146), reshaped fix round
    // 4 (F1, review 149): "do not drop the listing's ETag for it" — but only
    // when the REMEMBERED listing already CONTRADICTS this pending, i.e.
    // would drop it if it were fresh evidence. In that case a later poll's
    // pending withdrawal on the SAME K needs no forced fresh re-answer
    // purely on its own account: the remembered content already tells us
    // the outcome (a drop), so a 304 that carries no fresh evidence either
    // way saves only the listing's body (the request itself still counts,
    // F7 below) — the check is simply DEFERRED,
    // exactly as any check with no listing evidence at all would be, never
    // dropped by a remembered listing (F6: only THIS poll's OWN fresh
    // listing can drop a pending — see below). When the remembered listing
    // does NOT contradict (it is silent, names K only as a draft, or
    // AGREES), the reset must NOT be suppressed: an agreeing pending needs a
    // FRESH listing this poll to actually get applied, or it would sit
    // deferred forever behind a 304 that never carries the fresh evidence
    // `applyWithdrawn` requires — exactly F1's own defect.
    // `lastAcceptedListingFacts` is that remembered content, updated only
    // where `etag` itself is (see `pollListing`).
    const pendingAlreadyVouchedFor = pendingWithdrawal !== null
      && listingContradictsPending(pendingWithdrawal, lastAcceptedListingFacts);
    if (lastLatestTag !== prevLatestTag || (pendingWithdrawal !== null && !pendingAlreadyVouchedFor)) {
      // The stable identity CHANGED this poll (a fresh confirmation, or a
      // 404-with-no-kept-tag clearing it) — unchanged trigger — OR a
      // moved-away transition was just CONFIRMED and is waiting on this
      // poll's own listing (R2), and the remembered listing does not already
      // contradict its K: either way a stale 304 here must not stand in for
      // a real answer that was never actually given. Dropping the ETag
      // forces a full re-answer.
      etag = null;
    }
    // Fix round 4 (F7, review 149): this reset does not shrink the per-poll
    // request COUNT either way — `/latest` and the listing are still asked
    // every poll (spec §7's partial-mirror shape), so a poll that accepts a
    // 304 here still spends the maximum `CATALOGUE_MAX_REQUESTS_PER_POLL`
    // (3) requests; only the FLIP (a stale yank/demote re-applying against
    // a K the listing just re-confirmed) is gone, never the cost.
    const listing = await pollListing(now, source);
    // R2 (ruling on review 143's R2): a moved-away judgment acts ONLY when
    // THIS poll's listing itself answered with a fresh 200 body — never on
    // the evidence of a repository that might simply not be answering at
    // all. If it did not, the withdrawal judgment is deferred: nothing
    // changes, and the very next poll retries the same check against the
    // same K (`measureWithdrawn` re-fetches; nothing here remembers the
    // discarded `pendingWithdrawal`).
    //
    // B2 (fix round 3, coordinator's ruling, review 146), reshaped fix round
    // 4 (F1, coordinator's ruling, review 149): THE LISTING WINS ONLY WHEN
    // IT DISAGREES with the check. A pending 'yank' meeting a listing that
    // names K as any non-draft release DISAGREES (the listing just showed K
    // is still there) — dropped. A pending 'demote' meeting a listing that
    // names K as a non-draft STABLE release DISAGREES (the check's own
    // "still stable" verdict is stale next to it) — dropped; so does one
    // whose OWN check row is still stable or a draft while the listing
    // names K as non-draft dev (task review I1). Otherwise they AGREE — a
    // pending 'demote' whose check found non-draft dev meeting a listing
    // that already names K as dev (the check found exactly what the listing
    // shows), or a pending
    // 'yank' meeting a listing that does not name K at all — or the listing
    // gives NO VERDICT (K named only as a DRAFT — a draft row never
    // vouches, in either direction) — and `applyWithdrawn` runs exactly as
    // it would with no listing at all, moving the kept tag to T. Before this
    // fix a repository whose listing endpoint alone stayed live (a partial
    // mirror, spec §7's own example) could either apply a stale yank/demote
    // against a K the SAME poll's listing had just re-confirmed (the
    // original defect), or — B2's own first shape, F1 — drop an AGREEING
    // demote right along with a contradicting one, so a demotion the
    // listing itself already confirmed could never settle: `/latest` stayed
    // pinned to the demoted K forever, and an off-page stable the listing
    // never lists stayed resolvable after real deletion.
    if (pendingWithdrawal !== null && listing.freshOk) {
      if (listingContradictsPending(pendingWithdrawal, listing.facts)) {
        warnListingWins(pendingK!);
      } else {
        applyWithdrawn(now, pendingWithdrawal);
      }
    }
    // Fix round 1, review round 2 (I2): resolved only after BOTH requests
    // have fully settled, with the state AS IT STANDS THEN — never a
    // snapshot captured before `pollLatest` ran, which hid a state-touching
    // bug in `pollLatest` from every caller of `poll()` (the ruling that
    // `pollLatest` never touches `lastOkAt`/`lastError` is enforced by
    // `pollLatest` itself; this return makes any future violation of it
    // OBSERVABLE here instead of silently absorbed).
    return snapshot();
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
