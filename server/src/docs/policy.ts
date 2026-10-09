// The native Docs reader's L1 policy (design 2026-10-01, section 1's policy row): pure decisions over narrow
// inputs, a typed answer out. W3's routes and hooks APPLY these verdicts and decide nothing themselves; L3
// (`ccdsource.ts`) classifies ccd's answers into the words whose status this file owns.
//
// Ring, checked by imports (M7.10; this file's purity scan is in `docs-policy.test.ts`, the cross-file ring guard in
// `single-definition.test.ts`): every import is from `shared/docs.ts`. No node builtin, no Buffer, no clock, no
// timer, no fastify, no reply, no console. A server log line belongs to the layer that applies a verdict.
//
// Spelled nowhere here, by rule: the two qualified ref prefixes (derived below from L0's prefix body, refinement
// (q)), any grammar body, the redactor's rules, and the docs cap token.
import {
  DOCS_ALLOWED_CONTENT_TYPES, DOCS_CLASS_CAP, DOCS_ENVELOPE_RESERVE, DOCS_MAX_LISTING_WIRE_BYTES, DOCS_PIN_KEYS,
  DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RESPONSE_HEADERS,
  DOCS_RETRY_FLOOR_MS, DOCS_STALE_MS, contentClass, docsRefText, isDocsBareRef, isDocsCommit, isDocsFingerprint,
  isDocsProject, isDocsQualifiedRef, isDocsRelPath, isDocsSection, parseDocsRef,
  type DocContentClass, type DocPin, type DocSectionSlug, type DocsFailure, type DocsFailureBody, type DocsFetchOk,
  type DocsRefreshFetch, type DocsRefreshResponse, type DocsRefSpec, type DocsTreeOk, type DocsTreeResponse,
} from '../../../shared/docs.js';

// ===== HTTP status and Retry-After (section 2 (i), section 3.7) =====

/**
 * The HTTP status of every failure word: the ONLY status source (section 3.7). Success is 200 only, so every value
 * here is a 4xx or 5xx. Typed by the vocabulary, so a word added to `DOCS_FAILURES` does not compile until it is
 * placed, and a word not in it is an excess property. Listed in `DOCS_FAILURES`'s order.
 *
 * `ref-locked` is a 409 of its own, never the 502 of a failed fetch: a held lock is a conflict the page retries
 * while it is young (`DOCS_FAILURE_RETRY`'s `auto-while-young`), not a broken fetch.
 */
export const DOCS_FAILURE_HTTP: Record<DocsFailure, number> = {
  // Argument (400; L1 and ccd apply the same grammar).
  'bad-project': 400,
  'bad-ref': 400,
  'bad-commit': 400,
  'bad-section': 400,
  'bad-path': 400,
  'bad-fingerprint': 400,
  // Repository.
  'unknown-project': 404,
  'not-a-git-repo': 422,
  'linked-worktree': 422,
  'shared-repo': 422,
  'partial-clone': 422,
  'repo-unreadable': 502,
  // Refs.
  'no-default-branch': 404,
  'unresolved-ref': 404,
  'ref-not-commit': 422,
  // Objects and paths.
  'unknown-commit': 404,
  'not-a-commit': 422,
  'object-missing': 502,
  'absent-path': 404,
  'not-a-file': 422,
  'symlink-in-path': 422,
  'too-large': 413,
  'too-many-entries': 413,
  'unreadable-path': 502,
  // Draft pins (show).
  'worktree-gone': 409,
  'ambiguous-worktree': 409,
  'untrusted-worktree': 422,
  'worktree-moved': 409,
  'draft-changed': 409,
  // Fetch.
  'remote-absent': 422,
  'remote-branch-absent': 404,
  'fetch-auth-failed': 502,
  'fetch-rejected-objects': 502,
  'fetch-transport': 502,
  'ref-locked': 409,
  'fetch-too-soon': 429,
  'fetch-timeout': 504,
  'fetch-failed': 502,
  // ccd generic.
  'git-failed': 502,
  'git-timeout': 504,
  'helper-unavailable': 503,
  'helper-failed': 502,
  // Server-only.
  'unsupported': 501,
  'caps-unknown': 503,
  'not-granted': 501,
  'link-failed': 503,
  'link-timeout': 504,
  'docs-busy': 503,
  'ccd-timeout': 504,
  'ccd-killed': 502,
  'ccd-fault': 502,
  'answer-overflow': 502,
  'malformed-answer': 502,
  'unknown-failure': 502,
  // Added by section 3.7 (the HTTP layer).
  'foreign-request': 403,
  'bad-query': 400,
  'raster-mismatch': 422,
  'response-type-refused': 500,
};

/** `caps-unknown`'s `Retry-After`, in seconds (section 3.7: 503, `Retry-After: 5`; section 7.1, C1). */
export const DOCS_CAPS_UNKNOWN_RETRY_AFTER_S = 5;

/**
 * The `Retry-After` header a failure body gets, in whole seconds, or `null`: send NO header (one meaning).
 * - `caps-unknown`: `DOCS_CAPS_UNKNOWN_RETRY_AFTER_S`.
 * - `docs-busy`: its body's `retryAfterMs`, rounded UP to a whole second, only when it is finite and above 0; `null`
 *   otherwise (none, NaN, an infinity, 0 or below), so a wait is never guessed and never sent empty or negative.
 * - every other word: `null`. `fetch-too-soon`'s wait rides its body's `retryAfterMs` only (section 2 (i) names no
 *   header for it), and a `retryAfterMs` on any other word's body changes nothing here.
 */
export function docsRetryAfterSeconds(body: DocsFailureBody): number | null {
  if (body.failure === 'caps-unknown') return DOCS_CAPS_UNKNOWN_RETRY_AFTER_S;
  const ms = body.retryAfterMs;
  if (body.failure === 'docs-busy' && ms !== undefined && Number.isFinite(ms) && ms > 0) return Math.ceil(ms / 1000);
  return null;
}

// ===== The requested ref (refinement (q); section 3.4's refresh flow) =====

/** The two qualified prefixes, local then origin, DERIVED from L0's `DOCS_QUALIFIED_PREFIX_RE_BODY` (a
 *  non-capturing group of two literal alternatives): its `(?:` and `)` stripped, split on `|`. Never spelled here, so
 *  the grammar and this file cannot drift apart. `docs-policy.test.ts` pins the pair. */
export const DOCS_REF_PREFIXES = DOCS_QUALIFIED_PREFIX_RE_BODY
  .slice('(?:'.length, -')'.length)
  .split('|') as unknown as readonly [local: string, origin: string];

const [LOCAL_REF_PREFIX, ORIGIN_REF_PREFIX] = DOCS_REF_PREFIXES;

/** What a ref spec names: the branch, and which side holds it. `bare` is a name ccd resolves itself (origin first,
 *  section 2 (c)); `local` and `origin` come from a qualified ref, its prefix stripped. */
export type DocsRefTarget = { side: 'bare' | 'local' | 'origin'; branch: string };

/**
 * The target of a ref spec. A bare spec is its name; a qualified spec is its branch, read after whichever derived
 * prefix it starts with. A qualified spec under neither prefix is a caller's bug (`parseDocsRef` never builds one),
 * so it throws rather than guessing a side.
 */
export function docsRefTarget(ref: DocsRefSpec): DocsRefTarget {
  if (ref.kind === 'bare') return { side: 'bare', branch: ref.name };
  if (ref.ref.startsWith(LOCAL_REF_PREFIX)) return { side: 'local', branch: ref.ref.slice(LOCAL_REF_PREFIX.length) };
  if (ref.ref.startsWith(ORIGIN_REF_PREFIX)) {
    return { side: 'origin', branch: ref.ref.slice(ORIGIN_REF_PREFIX.length) };
  }
  throw new Error(`docsRefTarget: '${ref.ref}' starts with neither qualified prefix`);
}

/** What a refresh fetches. `branch: null` is the origin default branch (no `--branch`), one meaning; `skipped`
 *  is a local ref, which a fetch cannot move. */
export type DocsFetchPlan = { kind: 'fetch'; branch: string | null } | { kind: 'skipped'; why: 'local-ref' };

/**
 * `fetchBranchFor` (section 2 (g) Flow, section 3.4's table; M3.9):
 * - `null` (the default view): fetch with no `--branch`;
 * - bare `b`: `--branch b`;
 * - `refs/remotes/origin/b`: `--branch b` (everything after the prefix, so `a/b` stays `a/b`);
 * - `refs/heads/b`: skipped, `local-ref`, with no fetch exec at all.
 */
export function fetchBranchFor(ref: DocsRefSpec | null): DocsFetchPlan {
  if (ref === null) return { kind: 'fetch', branch: null };
  const target = docsRefTarget(ref);
  if (target.side === 'local') return { kind: 'skipped', why: 'local-ref' };
  return { kind: 'fetch', branch: target.branch };
}

// ===== Stale on open (section 2 (g); M3.10, row 53's L1 half) =====

/**
 * Whether the PWA should fire one automatic refresh for this tree: section 2 (g)'s pseudocode, line for line.
 * Takes an OK tree only, so an `unresolved-ref` answer can never be due (structural, not a flag). Never due for a
 * `refs/heads/<b>` view (a fetch cannot move a local ref) or a repo with no origin remote; always due when the
 * fleet has no stamp; otherwise due once the last attempt is at least `DOCS_STALE_MS` old after an `ok` or a
 * `remote-branch-absent` outcome, or at least `DOCS_RETRY_FLOOR_MS` old after any other outcome. Ages are on the
 * fleet clock (`attemptAgeMs`), so no clock is read here.
 */
export function refreshDue(tree: DocsTreeOk): boolean {
  const stamp = tree.freshness.stamp;
  return !(tree.ref.requested ?? '').startsWith(LOCAL_REF_PREFIX) &&
    tree.freshness.remote !== null && (
    stamp === null ||
      stamp.attemptAgeMs >= (stamp.lastOutcome === 'ok' || stamp.lastOutcome === 'remote-branch-absent'
        ? DOCS_STALE_MS : DOCS_RETRY_FLOOR_MS));
}

// ===== The API query, :project and refresh-body parsers (section 3.4 "Parameter rules"; refinement (n); M3.4) =====
//
// Each parser takes what Fastify hands a route and answers a typed request, or the failure body W3 sends before any
// exec. Every value test is an L0 predicate from `shared/docs.ts` (section 3.2: no second grammar in server/src),
// and the pin keys are read from `DOCS_PIN_KEYS`, never re-spelled. A query arrives decoded by Fastify's default
// parser (fast-querystring: form-style, so `%2B` is a plus, a bare `+` is a space, and a repeated key is an array).
// `docsApi` writes every value through `encodeURIComponent`, so only a hand-typed URL meets a bare `+`, and it reads
// as a space.

/** The three GET routes whose query `parseDocsApiQuery` reads. The refresh POST's body is `parseDocsRefreshBody`'s. */
export type DocsApiRoute = 'projects' | 'tree' | 'file';

/** A GET request, parsed. `ref: null` is the default view (the query has no `ref` key), one meaning. */
export type DocsApiRequest =
  | { route: 'projects' }
  | { route: 'tree'; ref: DocsRefSpec | null }
  | { route: 'file'; pin: DocPin };

/** The pin keys by name, in `DOCS_PIN_KEYS`'s order: a committed pin's two, then a draft pin's three. */
const [PIN_COMMIT, PIN_SERVED_REF, PIN_BRANCH, PIN_HEAD, PIN_FP] = DOCS_PIN_KEYS;
const COMMITTED_PIN_KEYS: readonly string[] = [PIN_COMMIT, PIN_SERVED_REF];
const DRAFT_PIN_KEYS: readonly string[] = [PIN_BRANCH, PIN_HEAD, PIN_FP];

/** The keys each route carries, in the order a repeated key is reported. Any other key is unknown: a client
 *  `size` or `maxBytes` (the server derives the cap from the path's class) and a `node` (section 3.12) included. */
const API_KEYS: Readonly<Record<DocsApiRoute, readonly string[]>> = {
  projects: [],
  tree: ['ref'],
  file: [...DOCS_PIN_KEYS, 'section', 'path'],
};

/** The refresh body's keys: exactly these two (section 3.4). */
const REFRESH_KEYS: readonly string[] = ['ref', 'reason'];

/** `bad-query`, with the key it names when it names one (`pin-shape` and a non-object body name none). */
function badQuery(why: 'unknown' | 'repeated' | 'pin-shape' | 'body', key?: string): DocsFailureBody {
  return key === undefined ? { ok: false, failure: 'bad-query', why } : { ok: false, failure: 'bad-query', key, why };
}

/** A grammar refusal: the word alone, no context (section 2 (i)'s Argument rows carry none). */
function refused(failure: DocsFailure): DocsFailureBody {
  return { ok: false, failure };
}

function isText(v: unknown): v is string {
  return typeof v === 'string';
}

/** The value of an OWN key, or `undefined` when the record has no such own key: an inherited name is no key. The
 *  one reader of a value, so a repeated key (an array) reaches every check as the array it is. */
function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The first own key outside `allowed`, in code-unit order, so the answer does not depend on the order the keys
 *  arrived in; `undefined` when every key is allowed. */
function firstUnknownKey(record: Readonly<Record<string, unknown>>, allowed: readonly string[]): string | undefined {
  return Object.keys(record).sort().find((k) => !allowed.includes(k));
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** The section and the path every pin carries, in ccd's argv order: section, then path. */
function parsePinPlace(query: Readonly<Record<string, unknown>>):
    { ok: true; section: DocSectionSlug; path: string } | DocsFailureBody {
  const section = own(query, 'section');
  if (!isText(section) || !isDocsSection(section)) return refused('bad-section');
  const path = own(query, 'path');
  if (!isText(path) || !isDocsRelPath(path)) return refused('bad-path');
  return { ok: true, section, path };
}

/**
 * A file query's pin. Its pin keys must be EXACTLY a committed pin's or a draft pin's, and `section` and `path` must
 * both be present, else `pin-shape` (a mixed or incomplete pin) before any value is read. Then each value, in ccd's
 * argv order, the first fault winning:
 * - committed: `commit` (bad-commit), `servedRef` (bad-ref; QUALIFIED only, because it is the tree answer's
 *   `ref.served`, which `docs-show --commit` receives as `--ref`), `section`, `path`;
 * - draft: `branch` (bad-ref; BARE only), `head` (bad-commit), `section`, `path`, `fp` (bad-fingerprint).
 * The pin is assembled only after every value passed.
 */
function parseFilePin(query: Readonly<Record<string, unknown>>): { ok: true; pin: DocPin } | DocsFailureBody {
  const pinKeys = DOCS_PIN_KEYS.filter((k) => Object.hasOwn(query, k));
  const committed = sameKeys(pinKeys, COMMITTED_PIN_KEYS);
  if ((!committed && !sameKeys(pinKeys, DRAFT_PIN_KEYS)) ||
    !Object.hasOwn(query, 'section') || !Object.hasOwn(query, 'path')) return badQuery('pin-shape');
  if (committed) {
    const commit = own(query, PIN_COMMIT);
    if (!isText(commit) || !isDocsCommit(commit)) return refused('bad-commit');
    const servedRef = own(query, PIN_SERVED_REF);
    if (!isText(servedRef) || !isDocsQualifiedRef(servedRef)) return refused('bad-ref');
    const place = parsePinPlace(query);
    if (!place.ok) return place;
    return { ok: true, pin: { kind: 'committed', commit, servedRef, section: place.section, path: place.path } };
  }
  const branch = own(query, PIN_BRANCH);
  if (!isText(branch) || !isDocsBareRef(branch)) return refused('bad-ref');
  const head = own(query, PIN_HEAD);
  if (!isText(head) || !isDocsCommit(head)) return refused('bad-commit');
  const place = parsePinPlace(query);
  if (!place.ok) return place;
  const fp = own(query, PIN_FP);
  if (!isText(fp) || !isDocsFingerprint(fp)) return refused('bad-fingerprint');
  return { ok: true, pin: { kind: 'draft', branch, head, section: place.section, path: place.path, fp } };
}

/**
 * Parse a docs GET route's query (section 3.4 "Parameter rules"; M3.4's L1 half). One fixed precedence, so one
 * query has one answer whatever order its keys arrived in:
 * 1. an unknown key: `bad-query {key, why:'unknown'}`, the first in code-unit order;
 * 2. a repeated key (an array value): `bad-query {key, why:'repeated'}`, the first in the route's key order;
 * 3. (file) a mixed or incomplete pin: `bad-query {why:'pin-shape'}`;
 * 4. a value outside its grammar: its own `bad-*` word, in ccd's argv order. A tree's `ref` is bare or qualified.
 */
export function parseDocsApiQuery(route: DocsApiRoute, query: Readonly<Record<string, unknown>>):
    { ok: true; req: DocsApiRequest } | DocsFailureBody {
  const allowed = API_KEYS[route];
  const unknown = firstUnknownKey(query, allowed);
  if (unknown !== undefined) return badQuery('unknown', unknown);
  const repeated = allowed.find((k) => Array.isArray(own(query, k)));
  if (repeated !== undefined) return badQuery('repeated', repeated);
  if (route === 'projects') return { ok: true, req: { route } };
  if (route === 'tree') {
    if (!Object.hasOwn(query, 'ref')) return { ok: true, req: { route, ref: null } };
    const text = own(query, 'ref');
    const ref = isText(text) ? parseDocsRef(text) : null;
    return ref === null ? refused('bad-ref') : { ok: true, req: { route, ref } };
  }
  const pin = parseFilePin(query);
  return pin.ok ? { ok: true, req: { route, pin: pin.pin } } : pin;
}

/** The `:project` route parameter: the project grammar, else `bad-project` (section 3.4), before any exec. */
export function parseDocsProjectParam(project: unknown): { ok: true; project: string } | DocsFailureBody {
  return isText(project) && isDocsProject(project) ? { ok: true, project } : refused('bad-project');
}

/** A parsed refresh body. `ref: null` is the default view, one meaning; `reason` changes nothing on the server but
 *  the wording of a failure log line (section 3.4). */
export type DocsRefreshRequest = { ref: DocsRefSpec | null; reason: 'auto' | 'manual' };

/**
 * Parse the refresh POST's body: an object with exactly the keys `ref` and `reason` (section 3.4). In order:
 * 1. not a plain object (a string, which Fastify's `text/plain` parser yields, an array, `null`, a number, no
 *    body): `bad-query {why:'body'}`;
 * 2. an extra key: `bad-query {key, why:'unknown'}`, the first in code-unit order;
 * 3. `ref` missing or neither `null` nor a string, then `reason` missing or not `auto`/`manual`:
 *    `bad-query {key, why:'body'}`;
 * 4. a string `ref` in neither ref grammar: `bad-ref`. A local qualified ref is ACCEPTED here: `fetchBranchFor`
 *    skips its fetch, and the follow-up tree still runs.
 */
export function parseDocsRefreshBody(body: unknown): { ok: true; req: DocsRefreshRequest } | DocsFailureBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return badQuery('body');
  const record = body as Readonly<Record<string, unknown>>;
  const unknown = firstUnknownKey(record, REFRESH_KEYS);
  if (unknown !== undefined) return badQuery('unknown', unknown);
  const ref = own(record, 'ref');
  if (ref !== null && !isText(ref)) return badQuery('body', 'ref');
  const reason = own(record, 'reason');
  if (reason !== 'auto' && reason !== 'manual') return badQuery('body', 'reason');
  if (ref === null) return { ok: true, req: { ref: null, reason } };
  const spec = parseDocsRef(ref);
  return spec === null ? refused('bad-ref') : { ok: true, req: { ref: spec, reason } };
}

// ===== Request provenance (section 3.8; refinement (o)) =====

/** A request's headers as node hands them over: structurally `IncomingHttpHeaders` (names lower-cased; a value
 *  a string, an array for a repeated header node does not join, or absent). Declared here because L1 imports no
 *  node type; `docs-policy.test.ts` assigns an `IncomingHttpHeaders` to it under `typecheck-tests`. */
export type DocsHeaderBag = Readonly<Record<string, string | readonly string[] | undefined>>;

/** `docsProvenance`'s verdict. `site` rides only a `site` refusal: the header's text, cut to 64 characters. */
export type DocsProvenance = { ok: true } | { ok: false; why: 'navigation' | 'site' | 'marker'; site?: string };

/** How much of a refused `sec-fetch-site` value the refusal carries. */
const PROVENANCE_SITE_MAX_CHARS = 64;

/** A header's text: absent stays `undefined`; an array reads as its `', '`-join (node's own join), so it never
 *  equals a single expected value. */
function headerText(v: string | readonly string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return isText(v) ? v : v.join(', ');
}

/**
 * Whether a docs API request came from the PWA's own `fetch()` (section 3.8), its three clauses in order, the first
 * refusal winning:
 * 1. `sec-fetch-mode` is `navigate`: `navigation` (every top-level and frame navigation, through the service worker
 *    too);
 * 2. `sec-fetch-site` is present and not `same-origin`: `site` (a same-site sibling, cross-site, `none`, and an
 *    empty value), carrying the value cut to 64 characters;
 * 3. the marker header (`DOCS_REQUEST_HEADER`) is not exactly `DOCS_REQUEST_HEADER_VALUE`: `marker`.
 * Clause 3 is the wall on a browser that sends no `Sec-Fetch-*`; clauses 1 and 2 hold even when the marker is
 * present. W3's `onRequest` hook applies the verdict (403 `foreign-request`, its log line); this decides only.
 */
export function docsProvenance(headers: DocsHeaderBag): DocsProvenance {
  if (headerText(headers['sec-fetch-mode']) === 'navigate') return { ok: false, why: 'navigation' };
  const site = headerText(headers['sec-fetch-site']);
  if (site !== undefined && site !== 'same-origin') {
    return { ok: false, why: 'site', site: site.slice(0, PROVENANCE_SITE_MAX_CHARS) };
  }
  if (headerText(headers[DOCS_REQUEST_HEADER]) !== DOCS_REQUEST_HEADER_VALUE) return { ok: false, why: 'marker' };
  return { ok: true };
}

// ===== The read lane and wire estimates (section 6.2, section 6.3; refinement (l); M6.1, M6.4) =====
//
// The lane itself (`lane.ts`, a per-node FIFO with its queue, wait and `docs-busy`) is W3's L4; it applies
// `laneAdmit` to its head job and decides nothing. Each constant is its OWN integer literal, never an alias of a
// neighbour that holds the same number (W1's rule for the caps): `DOCS_LANE_LARGE_RAW` equals
// `DOCS_MAX_LISTING_WIRE_BYTES` today, and tying them would let the listing bound move the large-answer threshold.
// The inequalities that tie them to the caps (`showWire(class cap) <= DOCS_LANE_BYTES`, the listing bound within it,
// `DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2`) are computed by `docs-budget.test.ts`.

/** The most docs execs in flight on one node's read lane (section 6.3). */
export const DOCS_LANE_EXECS = 2;
/** The most estimated framed answer bytes in flight on one read lane: 3 MiB, so any single show at a class cap
 *  (2 861 740 framed) fits alone, and head-of-line blocking stays near 252 ms at 100 Mbit (section 6.3). */
export const DOCS_LANE_BYTES = 3145728;
/** "At most one answer over 1 MiB": a job whose RAW estimate exceeds this is large (section 6.3). */
export const DOCS_LANE_LARGE_RAW = 1048576;
/** The most jobs queued behind a read lane; `docs-busy {lane:'read'}` past it (section 6.3). */
export const DOCS_LANE_QUEUE = 32;
/** The longest a queued read job waits for admission; `docs-busy {lane:'read'}` past it (section 6.3). */
export const DOCS_LANE_MAX_WAIT_MS = 10000;

/** One read job's estimate: `raw`, the most content bytes its answer can carry; `wire`, the most framed bytes the
 *  answer line can take on the link. */
export interface DocsJob { raw: number; wire: number }

/** A read lane's load at the moment its head job is considered: execs in flight, their summed `wire` estimates, and
 *  how many of them are large (`raw` over `DOCS_LANE_LARGE_RAW`). The lane keeps the counters; this only reads them. */
export interface LaneLoad { execs: number; bytes: number; large: number }

/**
 * Whether the read lane admits `job` now (section 6.3), its four clauses in order, the first that answers winning:
 * 1. an idle lane always admits one job, so a job larger than the budget still runs, alone;
 * 2. `DOCS_LANE_EXECS` execs in flight refuse;
 * 3. the summed wire estimate past `DOCS_LANE_BYTES` refuses (exactly at it admits);
 * 4. a second answer over `DOCS_LANE_LARGE_RAW` refuses (exactly at it is not large).
 * A refusal here is "not yet", never `docs-busy`: the lane keeps the job at the head of its FIFO (W3).
 */
export function laneAdmit(load: LaneLoad, job: DocsJob): boolean {
  if (load.execs === 0) return true;
  if (load.execs >= DOCS_LANE_EXECS) return false;
  if (load.bytes + job.wire > DOCS_LANE_BYTES) return false;
  if (job.raw > DOCS_LANE_LARGE_RAW && load.large > 0) return false;
  return true;
}

/**
 * The most content bytes a show can answer (section 6.2): the class cap, lowered by a size the server already holds.
 * `knownSize` is `undefined` when the server holds no size fact, one meaning; it comes from the listing map for a
 * committed pin or the `fp -> size` map for a draft (W3), NEVER from the request (M6.4: the query refuses `size` and
 * `maxBytes`). A listed size of 0 is a fact, so `??`, never `||`.
 */
export function showRawBound(classCap: number, knownSize: number | undefined): number {
  return Math.min(classCap, knownSize ?? classCap);
}

/** A show answer's framed bound for `raw` content bytes (section 6.1's encoding rule): base64's
 *  `4 * ceil(raw / 3)` plus `DOCS_ENVELOPE_RESERVE`. `showWire(2097152)` is 2 861 740. */
export function showWire(raw: number): number {
  return 4 * Math.ceil(raw / 3) + DOCS_ENVELOPE_RESERVE;
}

/** The estimate of every tree and index job: ccd's framed listing bound on both sides (section 6.2). Frozen, so
 *  no caller can change every other caller's estimate. */
export const LISTING_JOB: Readonly<DocsJob> =
  Object.freeze({ raw: DOCS_MAX_LISTING_WIRE_BYTES, wire: DOCS_MAX_LISTING_WIRE_BYTES });

/** A show's server-side plan: the path's class, the `--max-bytes` it sends ccd, and the lane job it books. */
export interface DocsShowPlan { cls: DocContentClass; maxBytes: number; job: DocsJob }

/**
 * Plan one show from server facts alone (section 5.2 steps 2-3, section 6.2): `cls` is `contentClass(path)`,
 * `maxBytes` is that class's cap (`docs-show --max-bytes`), and the job's `raw` is `showRawBound(maxBytes,
 * knownSize)`, its `wire` `showWire(raw)`. Takes no query: nothing a client sends can reach the estimate (M6.4).
 */
export function docsShowPlan(path: string, knownSize: number | undefined): DocsShowPlan {
  const cls = contentClass(path);
  const maxBytes = DOCS_CLASS_CAP[cls];
  const raw = showRawBound(maxBytes, knownSize);
  return { cls, maxBytes, job: { raw, wire: showWire(raw) } };
}

// ===== Browser cache and the response-header verdict (section 5.2, section 5.3, section 6.6; refinement (m)) =====

/** A committed raster's bytes are a pure function of `(commit, section, path)`, so the browser may keep them. */
export const DOCS_CACHE_IMMUTABLE = 'private, max-age=31536000, immutable';
/** Everything else: every JSON answer (its `onRef` and `from` are not a function of the URL), a draft, a failure. */
export const DOCS_CACHE_NO_STORE = 'no-store';
/** The one JSON content type a docs route sends, and the type a refused response is answered in. It is one of
 *  `DOCS_ALLOWED_CONTENT_TYPES` (pinned by `docs-policy.test.ts`). */
export const DOCS_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * The `Cache-Control` of a 200 file answer (section 6.6): immutable only for a committed pin of class `raster`,
 * `no-store` for everything else. A non-200 is never asked: `docsSendPolicy` makes every failure `no-store`.
 */
export function cacheControlFor(pin: DocPin, cls: DocContentClass): string {
  return pin.kind === 'committed' && cls === 'raster' ? DOCS_CACHE_IMMUTABLE : DOCS_CACHE_NO_STORE;
}

/** The headers a refused response removes: no length of the refused payload, and never a `Content-Disposition`. */
const REFUSED_RESPONSE_REMOVES: readonly string[] = ['content-length', 'content-disposition'];
/** How much of a refused content type the verdict carries, for W3's log line. */
const REFUSED_TYPE_MAX_CHARS = 80;

/**
 * What W3's `onSend` hook does to a docs response (section 5.3), decided here so the hook decides nothing:
 * - `pass`: set every header in `headers` (a fresh object every call: `DOCS_RESPONSE_HEADERS`' four, plus
 *   `cache-control: no-store` when the status is not 200 or the route set no cache-control) and send the payload;
 * - `refuse`, for a content type outside `DOCS_ALLOWED_CONTENT_TYPES` (compared exactly): remove `remove`, answer
 *   `status` with `headers` and the JSON of `body`, and log `contentType` (cut to 80 characters).
 */
export type DocsSendVerdict =
  | { kind: 'pass'; headers: Readonly<Record<string, string>> }
  | {
    kind: 'refuse'; status: number; headers: Readonly<Record<string, string>>; remove: readonly string[];
    body: DocsFailureBody; contentType: string;
  };

/**
 * The response-header verdict over W1's headers table (section 5.3; refinement (m)). `contentType` is the reply's
 * content-type header as text (`''` when none was set); `cacheControl` is the reply's cache-control header, or
 * `undefined` when the route set none, one meaning. Never writes into the L0 table.
 */
export function docsSendPolicy(statusCode: number, contentType: string, cacheControl: string | undefined):
    DocsSendVerdict {
  if (!DOCS_ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return {
      kind: 'refuse',
      status: DOCS_FAILURE_HTTP['response-type-refused'],
      headers: {
        ...DOCS_RESPONSE_HEADERS, 'content-type': DOCS_JSON_CONTENT_TYPE, 'cache-control': DOCS_CACHE_NO_STORE,
      },
      remove: REFUSED_RESPONSE_REMOVES,
      body: { ok: false, failure: 'response-type-refused' },
      contentType: contentType.slice(0, REFUSED_TYPE_MAX_CHARS),
    };
  }
  const headers: Record<string, string> = { ...DOCS_RESPONSE_HEADERS };
  if (statusCode !== 200 || cacheControl === undefined) headers['cache-control'] = DOCS_CACHE_NO_STORE;
  return { kind: 'pass', headers };
}

// ===== W3: the fetch lane, the caches and the refusal log (section 6.4, section 6.5; refinement (b)) =====
//
// The lanes and caches themselves (`lane.ts`, `cache.ts`) are W3's L4; they apply these numbers and decide nothing.
// Each numeric constant is its OWN integer literal, never an alias of a neighbour that holds the same number (W1's
// rule for the caps, W2's for the read lane), with one stated exception: `DOCS_LISTING_PROVENANCE_MS` IS
// `DOCS_STALE_MS` by the spec's definition (section 6.5), so it is derived, never typed twice.

/** The one fleet node this build has (section 3.12): every docs key, flight and cache entry carries it, so a second
 *  node arrives as a second value, never as a re-key. Not a wire field: the API has no `node` key. */
export const DOCS_PRIMARY_NODE = 'primary';
/** The read lane's `docs-busy` wait (section 6.3: 503, `Retry-After: 2`). */
export const DOCS_READ_BUSY_RETRY_MS = 2000;
/** The most fetches running at once across every (node, project) key (section 6.4). */
export const DOCS_FETCH_GLOBAL = 2;
/** The most accepted fetch jobs not yet started, behind their key or the global bound (section 6.4; refinement
 *  (n)); the next is `docs-busy {lane:'fetch'}`. */
export const DOCS_FETCH_QUEUE = 8;
/** The longest an accepted fetch job waits to start, from acceptance (section 6.4). */
export const DOCS_FETCH_MAX_WAIT_MS = 20000;
/** The fetch lane's `docs-busy` wait (section 6.4: 503, `Retry-After: 5`). */
export const DOCS_FETCH_BUSY_RETRY_MS = 5000;
/** The committed blob cache's budget: 64 MiB of stored bytes (section 6.5). */
export const DOCS_CACHE_BYTES = 67108864;
/** The most FILE entries the listing map holds across every commit it keeps (section 6.5). */
export const DOCS_LISTING_MAP_ENTRIES = 50000;
/** How recently a listing's `servedRef` must have been recorded for a cache hit to vouch for it (section 6.5):
 *  the stale threshold itself, derived. */
export const DOCS_LISTING_PROVENANCE_MS = DOCS_STALE_MS;
/** The per-node index micro-cache's lifetime (section 6.5); any refresh drops it. */
export const DOCS_INDEX_CACHE_MS = 30000;
/** The most entries the draft `fp -> size` map holds (section 6.5, section 3.12). */
export const DOCS_DRAFT_SIZE_ENTRIES = 10000;
/** The shortest gap between two log lines for the same refusal reason (section 3.8: "at most once a minute"). */
export const DOCS_REFUSAL_LOG_MS = 60000;

// ===== The bodies the HTTP layer sends before any exec (section 3.7, section 3.8; refinements (e), (h), (o)) =====

/** A lane's name, as `docs-busy`'s `lane` field spells it: derived from L0's failure context, never re-listed. */
export type DocsLaneName = NonNullable<DocsFailureBody['lane']>;

/**
 * `docs-busy` for a lane (section 6.3, section 6.4): `{lane, retryAfterMs}`, the wait being that lane's constant.
 * The only producer of a `docs-busy` body, so `docsRetryAfterSeconds` always meets one of the two constants. A
 * fresh object every call.
 */
export function docsBusyBody(lane: DocsLaneName): DocsFailureBody {
  return {
    ok: false, failure: 'docs-busy', lane,
    retryAfterMs: lane === 'read' ? DOCS_READ_BUSY_RETRY_MS : DOCS_FETCH_BUSY_RETRY_MS,
  };
}

/**
 * The 403 body for a refused provenance verdict (section 3.7, section 3.8): `{why}`, plus `site` only when the
 * verdict carries one (a `site` refusal). Never a `verdict` key, so it can never raise the PWA's login overlay.
 */
export function docsForeignRequestBody(v: Exclude<DocsProvenance, { ok: true }>): DocsFailureBody {
  return v.site === undefined
    ? { ok: false, failure: 'foreign-request', why: v.why }
    : { ok: false, failure: 'foreign-request', why: v.why, site: v.site };
}

/** The error-code prefix of every request-body refusal the HTTP framework raises before a handler runs (invalid
 *  or empty JSON, a body over its limit, an unparsed media type, a bad content length). */
const BODY_ERROR_CODE_PREFIX = 'FST_ERR_CTP_';

/** What the docs plugin's error handler does with an error: `body`, answer this `bad-query` body; `defect`,
 *  re-throw to the framework's default handler as a fresh error carrying `DOCS_DEFECT_MESSAGE` (a defect stays a
 *  default 500, and its body never carries the thrower's own message). */
export type DocsBodyError = { kind: 'body'; body: DocsFailureBody } | { kind: 'defect' };

/**
 * Refinement (e): an error whose `code` is a string starting `FST_ERR_CTP_` is a refused request body, answered as
 * `bad-query {why:'body'}` (status `DOCS_FAILURE_HTTP['bad-query']`); any other code, a missing one or a non-string
 * one is a defect. Takes the code as `unknown` because an error's `code` is whatever the thrower set.
 */
export function docsBodyErrorVerdict(code: unknown): DocsBodyError {
  return typeof code === 'string' && code.startsWith(BODY_ERROR_CODE_PREFIX)
    ? { kind: 'body', body: badQuery('body') }
    : { kind: 'defect' };
}

/** The message of the 500 a docs-route defect answers (refinement (e)): the plugin's error handler re-throws every
 *  defect to the framework's default handler as a fresh error carrying this text, the original kept as its
 *  `cause`, so the default body (`{statusCode, error, message}`) never carries a thrower's own message: no host
 *  path, no stderr. */
export const DOCS_DEFECT_MESSAGE = 'docs route defect';

/**
 * Whether a refusal log line is due (refinement (o)): `lastMs` is when this reason last logged, `undefined` when it
 * never has (one meaning); due when it never has, or when at least `DOCS_REFUSAL_LOG_MS` has passed. The clock is
 * the caller's (`nowMs`), so nothing here reads time.
 */
export function docsLogDue(lastMs: number | undefined, nowMs: number): boolean {
  return lastMs === undefined || nowMs - lastMs >= DOCS_REFUSAL_LOG_MS;
}

// ===== The refresh's fetch half (section 3.4's refresh flow; refinement (m)) =====

/** The words a refresh half can only meet BEFORE an exec: the adapter's gate (`caps-unknown`, `unsupported`) and
 *  a lane's own refusal (`docs-busy`). The same gate would refuse the tree, so the request ends there. */
const REFRESH_PRE_EXEC: ReadonlySet<DocsFailure> = new Set<DocsFailure>(['caps-unknown', 'unsupported', 'docs-busy']);

/** The refresh's verdict on its fetch half: `refuse`, end the request with this body's own status (section 3.4: "a
 *  refusal before any exec returns that word's own status"); `half`, carry this fetch half and run the tree. */
export type DocsRefreshHalf = { kind: 'refuse'; body: DocsFailureBody } | { kind: 'half'; fetch: DocsRefreshFetch };

/**
 * The fetch half of a refresh (refinement (m)), from the fetch port's answer or the fetch lane's refusal:
 * - a pre-exec word (`REFRESH_PRE_EXEC`): `refuse`, carrying the body itself;
 * - any other failure: a `failed` half carrying the body VERBATIM (the same object: `fetch-too-soon`'s
 *   `retryAfterMs` rides it, and `ref-locked`'s `lockAgeMs` stays a number, `null` or absent as ccd said);
 * - ok: a `ran` half carrying the answer.
 * The skipped half (a local ref, no exec) is `DOCS_REFRESH_SKIPPED`; it never reaches this function.
 */
export function docsRefreshFetchHalf(run: { ok: true; answer: DocsFetchOk } | DocsFailureBody): DocsRefreshHalf {
  if (run.ok) return { kind: 'half', fetch: { state: 'ran', answer: run.answer } };
  if (REFRESH_PRE_EXEC.has(run.failure)) return { kind: 'refuse', body: run };
  return { kind: 'half', fetch: { state: 'failed', failure: run } };
}

/** The fetch half of a refresh whose ref is local (`fetchBranchFor`'s `skipped`): no exec ran. Frozen, so no
 *  caller can change every other caller's half. */
export const DOCS_REFRESH_SKIPPED: Readonly<DocsRefreshFetch> = Object.freeze({ state: 'skipped', why: 'local-ref' });

/** The refresh's answer once both halves are known: `refuse`, end the request with this body's own status and
 *  `Retry-After`; `send`, the 200 `{ok: true, fetch, tree}`. */
export type DocsRefreshAnswer = { kind: 'refuse'; body: DocsFailureBody } | { kind: 'send'; body: DocsRefreshResponse };

/**
 * The refresh's answer (refinement (m); section 3.4: "a refusal before any exec returns that word's own status"). A
 * SKIPPED fetch half (a local ref) ran no exec, so when the tree half was refused before any exec too (a
 * `REFRESH_PRE_EXEC` word: the adapter's gate, or the read lane's own `docs-busy`) the request ran none at all:
 * `refuse`, carrying the tree's body itself. Every other pair ran an exec or answered: `send`, the tree half a body
 * in the 200 (a ran or failed fetch made an exec, so even a pre-exec tree word rides as the tree half).
 */
export function docsRefreshAnswer(fetch: DocsRefreshFetch, tree: DocsTreeResponse | DocsFailureBody):
    DocsRefreshAnswer {
  if (fetch.state === 'skipped' && !tree.ok && REFRESH_PRE_EXEC.has(tree.failure)) {
    return { kind: 'refuse', body: tree };
  }
  return { kind: 'send', body: { ok: true, fetch, tree } };
}

// ===== Node-first keys (section 3.12, section 6.4, section 6.5; refinement (p)) =====
//
// Every key is its kind tag, then the node, then its fields, joined by NUL. No field can hold a NUL (the project,
// ref, section and path grammars and the hex forms exclude it), so a key names one tuple: one flight map can hold
// every kind, and no two tuples share a key. An absent field (the default view's ref, the default branch) is the
// empty field, which no parsed value is.

/** The field separator: NUL, written as an escape so the source holds no raw control character. */
const KEY_SEP = '\u0000';
const KEY_INDEX = 'index';
const KEY_TREE = 'tree';
const KEY_SHOW = 'show';
const KEY_REFRESH = 'refresh';
const KEY_PROJECT = 'project';
const KEY_BLOB = 'blob';
const KEY_LISTING = 'listing';
const KEY_FP = 'fp';
const KEY_NODE = 'node';

function docsKey(kind: string, fields: readonly string[]): string {
  return [kind, ...fields].join(KEY_SEP);
}

/** The index flight: one per node (`docs-index --all` names no project) and per node generation (`docsNodeKey`'s
 *  counter, bumped when a refresh's fetch half settles), so a GET after a refresh never joins an index begun
 *  before its fetch, as a refresh's tree never joins an older tree. */
export function docsIndexFlightKey(node: string, gen: number): string {
  return docsKey(KEY_INDEX, [node, String(gen)]);
}

/** A tree flight (section 6.4): the requested ref's text, the empty field for the default view (`null`), and the
 *  project's generation, so a refresh's tree never joins a flight that started before its fetch. */
export function docsTreeFlightKey(node: string, project: string, ref: DocsRefSpec | null, gen: number): string {
  return docsKey(KEY_TREE, [node, project, ref === null ? '' : docsRefText(ref), String(gen)]);
}

/** A show flight (section 6.4): the pin's kind and every pin field in `docsApi`'s order, then `--max-bytes`. */
export function docsShowFlightKey(node: string, project: string, pin: DocPin, maxBytes: number): string {
  const fields = pin.kind === 'committed'
    ? [pin.kind, pin.commit, pin.servedRef, pin.section, pin.path]
    : [pin.kind, pin.branch, pin.head, pin.section, pin.path, pin.fp];
  return docsKey(KEY_SHOW, [node, project, ...fields, String(maxBytes)]);
}

/** A refresh flight (section 6.4): the fetched branch, the empty field for the origin default (`null`). */
export function docsRefreshFlightKey(node: string, project: string, branch: string | null): string {
  return docsKey(KEY_REFRESH, [node, project, branch ?? '']);
}

/** One project on one node: the generation counter's key and the fetch lane's queue key. */
export function docsProjectKey(node: string, project: string): string {
  return docsKey(KEY_PROJECT, [node, project]);
}

/** A committed blob in the blob cache (section 6.5): node, repository key, blob. */
export function docsBlobKey(node: string, repoKey: string, blob: string): string {
  return docsKey(KEY_BLOB, [node, repoKey, blob]);
}

/** One commit's listing in the listing map (section 6.5). */
export function docsListingKey(node: string, project: string, commit: string): string {
  return docsKey(KEY_LISTING, [node, project, commit]);
}

/** A draft's size in the `fp -> size` map (section 3.12, section 6.5). */
export function docsDraftSizeKey(node: string, fp: string): string {
  return docsKey(KEY_FP, [node, fp]);
}

/** One node: the generation counter's key for that node's index (section 6.5: the index is dropped by any refresh;
 *  the counter is how an index answer begun before a refresh's fetch is kept out of the micro-cache). */
export function docsNodeKey(node: string): string {
  return docsKey(KEY_NODE, [node]);
}

/** Whether an ok index answer may fill the node's micro-cache (section 6.5: the index is "dropped by any refresh";
 *  refinement (p)): only while the node's generation (`docsNodeKey`'s counter) is still `genAtStart`, the one its
 *  flight began at. An index begun before a refresh's fetch settled is served to the requests that joined it, and
 *  never cached past that refresh. */
export function docsIndexCacheable(genAtStart: number, genNow: number): boolean {
  return genAtStart === genNow;
}
