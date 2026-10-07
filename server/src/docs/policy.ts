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
  DOCS_PIN_KEYS, DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RETRY_FLOOR_MS,
  DOCS_STALE_MS, isDocsBareRef, isDocsCommit, isDocsFingerprint, isDocsProject, isDocsQualifiedRef, isDocsRelPath,
  isDocsSection, parseDocsRef,
  type DocPin, type DocSectionSlug, type DocsFailure, type DocsFailureBody, type DocsRefSpec, type DocsTreeOk,
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
 * - `docs-busy`: its body's `retryAfterMs`, rounded UP to a whole second; `null` when the body carries none, so a
 *   wait is never guessed.
 * - every other word: `null`. `fetch-too-soon`'s wait rides its body's `retryAfterMs` only (section 2 (i) names no
 *   header for it), and a `retryAfterMs` on any other word's body changes nothing here.
 */
export function docsRetryAfterSeconds(body: DocsFailureBody): number | null {
  if (body.failure === 'caps-unknown') return DOCS_CAPS_UNKNOWN_RETRY_AFTER_S;
  if (body.failure === 'docs-busy' && typeof body.retryAfterMs === 'number') return Math.ceil(body.retryAfterMs / 1000);
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
