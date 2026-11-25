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
  DOCS_ALLOWED_CONTENT_TYPES, DOCS_CLASS_CAP, DOCS_ENVELOPE_RESERVE, DOCS_FOLDER_ENTRY_KINDS, DOCS_FOLDER_LABEL_RE,
  DOCS_LOG_AUTHOR_MAX_CHARS, DOCS_LOG_MAX_ENTRIES,
  DOCS_LOG_MAX_WIRE_BYTES, DOCS_LOG_SUBJECT_MAX_CHARS, DOCS_MAX_LISTING_WIRE_BYTES, DOCS_PIN_KEYS,
  DOCS_QUALIFIED_PREFIX_RE_BODY, DOCS_RANGE_FRAME_BYTES, DOCS_RANGE_MAX_BYTES, DOCS_RASTER_EXT, DOCS_RASTER_TYPES,
  DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE,
  DOCS_RESPONSE_HEADERS, DOCS_RETRY_FLOOR_MS, DOCS_STALE_MS, contentClass, docsRangePinText, docsRefText, isDocsBareRef, isDocsCommit,
  isDocsFingerprint, isDocsMtimeNs, isDocsProject, isDocsQualifiedRef, isDocsRangeSnapshot, isDocsRelPath, isDocsSection,
  parseDocsRangeCount, parseDocsRangePinText, parseDocsRef, redactDocsText, sniffRaster,
  type DocContentClass, type DocFilePin, type DocPin, type DocSectionSlug, type DocsEntry, type DocsFailure, type DocsFailureBody,
  type DocsFetchOk, type DocsFileResponse, type DocsFolderFileResponse, type DocsFolderLabelRow, type DocsFolderListRow,
  type DocsFolderShowOk, type DocsFolderTreeOk, type DocsLogAsk, type DocsRangePin, type DocsRefreshFetch,
  type DocsRefreshResponse, type DocsRefSpec,
  type DocsShowOk, type DocsTreeOk, type DocsTreeResponse, type DocsVerb, type RasterMime, type RasterType,
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
  // Range reads (X2 P1): a gone snapshot is a conflict the page retries from prepare; a bound the request broke is a 413
  // as `too-large` is; a prepare the cache cannot take now is a 503.
  'snapshot-gone': 409,
  'range-too-large': 413,
  'prepare-busy': 503,
  // Outside folders (X2 P2.3): a label outside its grammar is a 400 like every argument word; a label the registry does not
  // hold is a 404 as `unknown-project` is, and one already taken a 409 conflict; a path that is not there is a 404 as
  // `absent-path` is; an admission refusal (not a directory, another owner's, protected) is a 422 as `not-a-git-repo` and
  // `untrusted-worktree` are; an unreadable registry, directory or cache is a 502 as `unreadable-path` is.
  'bad-label': 400,
  'unknown-folder': 404,
  'label-exists': 409,
  'absent': 404,
  'not-a-directory': 422,
  'foreign-owner': 422,
  'protected': 422,
  'unreadable': 502,
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
  // The outside-folder sign-in gate (X2 P2.3), the statuses the account gate gives the same words: a dark box answers 501, a
  // request without a session 401.
  'auth-off': 501,
  'unauthenticated': 401,
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

/** The five project GET routes, the outside-folder reads and the folder Remove DELETE (X2 P2.3), whose query
 *  `parseDocsApiQuery` reads (Remove's takes no key, like the listings'). The refresh POST's body is
 *  `parseDocsRefreshBody`'s and the folder Add's `parseDocsFolderAddBody`'s. */
export type DocsApiRoute = 'projects' | 'tree' | 'file' | 'history' | 'range' | 'folder-list' | 'folder-tree' | 'folder-file'
  | 'folder-range' | 'folder-remove';

/** Where a range read's leaf is: a committed doc at its commit, or a draft at its branch and head, as ccd's
 *  `docs-show-range` takes it. The file route's `servedRef` and `fp` are not here: ccd never reads them, and the range pin
 *  is the pin. */
export type DocsRangeWhere = { commit: string } | { branch: string; head: string };

/** The leaf a range read is of: its place and its range pin. */
export interface DocsRangeTarget { where: DocsRangeWhere; section: DocSectionSlug; path: string; pin: DocsRangePin }

/** One frame asked of a prepared snapshot. */
export interface DocsRangeFrameAsk { snapshot: string; offset: number; length: number }

/** A range query as `parseDocsApiQuery` leaves it: every value in its grammar, no cross-field bound checked yet
 *  (`docsRangePlan` does that). `frame: null` is a prepare, one meaning. */
export interface DocsRangeQuery { target: DocsRangeTarget; frame: DocsRangeFrameAsk | null }

/** The leaf an outside folder's range read is of: its place below the folder and its range pin, `fp` or `stat`, never `blob`
 *  (a folder has no commit). The label is the route's own and rides beside it. */
export interface DocsFolderRangeTarget { section: DocSectionSlug; path: string; pin: DocsRangePin }

/** A folder range query as `parseDocsApiQuery` leaves it; `frame: null` is a prepare, one meaning. */
export interface DocsFolderRangeQuery { target: DocsFolderRangeTarget; frame: DocsRangeFrameAsk | null }

/** What a folder file read asks for: the leaf's place and the fingerprint its listing row carried. */
export interface DocsFolderFileAsk { section: DocSectionSlug; path: string; fp: string }

/** A GET request, parsed. `ref: null` is the default view (the query has no `ref` key), one meaning. */
export type DocsApiRequest =
  | { route: 'projects' }
  | { route: 'tree'; ref: DocsRefSpec | null }
  | { route: 'file'; pin: DocFilePin }
  | { route: 'history'; ask: DocsLogAsk }
  | { route: 'range'; query: DocsRangeQuery }
  | { route: 'folder-list' }
  | { route: 'folder-remove' }
  | { route: 'folder-tree' }
  | { route: 'folder-file'; ask: DocsFolderFileAsk }
  | { route: 'folder-range'; query: DocsFolderRangeQuery };

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
  history: [PIN_COMMIT, 'section', 'path'],
  range: [PIN_COMMIT, PIN_BRANCH, PIN_HEAD, 'section', 'path', 'pin', 'prepare', 'snapshot', 'offset', 'length'],
  // A folder has no commit, branch or head: its reads name the leaf by section and path alone, and pin it by `fp` or `pin`.
  'folder-list': [],
  'folder-remove': [],
  'folder-tree': [],
  'folder-file': ['section', 'path', PIN_FP],
  'folder-range': ['section', 'path', 'pin', 'prepare', 'snapshot', 'offset', 'length'],
};

/** The refresh body's keys: exactly these two (section 3.4). */
const REFRESH_KEYS: readonly string[] = ['ref', 'reason'];

/** `bad-query`, with the key it names when it names one (`pin-shape` and a non-object body name none). The two range
 *  reasons: `range-step`, a query that is neither exactly a prepare (`prepare=1`) nor exactly a frame (`snapshot`,
 *  `offset`, `length`); `range-number`, an `offset` or `length` outside its count grammar, or a `length` of zero. */
function badQuery(why: 'unknown' | 'repeated' | 'pin-shape' | 'body' | 'range-step' | 'range-number', key?: string):
  DocsFailureBody {
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
function parseFilePin(query: Readonly<Record<string, unknown>>): { ok: true; pin: DocFilePin } | DocsFailureBody {
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
 * A range query (X2 spec 4.3). The shape first, before any value is read, each a `bad-query`: the place's keys are
 * exactly `commit` or exactly `branch` and `head`, and `section`, `path` and `pin` are present (`pin-shape`); the step is
 * `prepare` alone or `snapshot`, `offset` and `length` together (`range-step`). Then each value in ccd's argv order, the
 * first fault winning: `commit` (bad-commit), or `branch` (bad-ref, BARE only) and `head` (bad-commit); `section`; `path`;
 * `pin` (bad-fingerprint: ccd's own word for a pin outside the three forms); then `prepare` (the value `1`, else
 * `range-step`), or `snapshot` (a snapshot id, else `snapshot-gone`, ccd's own word for an id that names none), `offset`
 * and `length` (a count, and a length of at least 1, else `range-number`). Whether the pin's kind suits the place, and the
 * bounds, are `docsRangePlan`'s.
 */
function parseRangeQuery(query: Readonly<Record<string, unknown>>): { ok: true; query: DocsRangeQuery } | DocsFailureBody {
  const placeKeys = [PIN_COMMIT, PIN_BRANCH, PIN_HEAD].filter((k) => Object.hasOwn(query, k));
  const committed = sameKeys(placeKeys, [PIN_COMMIT]);
  if ((!committed && !sameKeys(placeKeys, [PIN_BRANCH, PIN_HEAD])) || !Object.hasOwn(query, 'section')
    || !Object.hasOwn(query, 'path') || !Object.hasOwn(query, 'pin')) return badQuery('pin-shape');
  const frameKeys = ['snapshot', 'offset', 'length'].filter((k) => Object.hasOwn(query, k));
  const prepare = Object.hasOwn(query, 'prepare');
  if (!(prepare ? frameKeys.length === 0 : frameKeys.length === 3)) return badQuery('range-step');
  let where: DocsRangeWhere;
  if (committed) {
    const commit = own(query, PIN_COMMIT);
    if (!isText(commit) || !isDocsCommit(commit)) return refused('bad-commit');
    where = { commit };
  } else {
    const branch = own(query, PIN_BRANCH);
    if (!isText(branch) || !isDocsBareRef(branch)) return refused('bad-ref');
    const head = own(query, PIN_HEAD);
    if (!isText(head) || !isDocsCommit(head)) return refused('bad-commit');
    where = { branch, head };
  }
  const tail = parseRangeTail(query, prepare);
  if (!tail.ok) return tail;
  return { ok: true, query: { target: { where, section: tail.section, path: tail.path, pin: tail.pin }, frame: tail.frame } };
}

/** What every range query shares after its place keys (a project's `commit` or `branch` and `head`, or a folder's none):
 *  the section, the path, the range pin and the step. */
type RangeTail = { ok: true; section: DocSectionSlug; path: string; pin: DocsRangePin; frame: DocsRangeFrameAsk | null };

/**
 * The tail of a range query, in ccd's argv order, the first fault winning: `section`, `path`, `pin` (bad-fingerprint:
 * ccd's own word for a pin outside the three forms), then the step the caller measured the keys of (`prepare`: the value
 * `1`, else `range-step`; otherwise `snapshot`, a snapshot id, else `snapshot-gone`, then `offset` and `length`, counts,
 * the length at least 1, else `range-number`). The project range read and the folder one both call it, so one grammar
 * reads both.
 */
function parseRangeTail(query: Readonly<Record<string, unknown>>, prepare: boolean): RangeTail | DocsFailureBody {
  const place = parsePinPlace(query);
  if (!place.ok) return place;
  const pinText = own(query, 'pin');
  const pin = isText(pinText) ? parseDocsRangePinText(pinText) : null;
  if (pin === null) return refused('bad-fingerprint');
  const at = { ok: true as const, section: place.section, path: place.path, pin };
  if (prepare) return own(query, 'prepare') === '1' ? { ...at, frame: null } : badQuery('range-step', 'prepare');
  const snapshot = own(query, 'snapshot');
  if (!isText(snapshot) || !isDocsRangeSnapshot(snapshot)) return refused('snapshot-gone');
  const offsetText = own(query, 'offset');
  const offset = isText(offsetText) ? parseDocsRangeCount(offsetText) : null;
  if (offset === null) return badQuery('range-number', 'offset');
  const lengthText = own(query, 'length');
  const length = isText(lengthText) ? parseDocsRangeCount(lengthText) : null;
  if (length === null || length === 0) return badQuery('range-number', 'length');
  return { ...at, frame: { snapshot, offset, length } };
}

/** A folder range query (X2 P2.3): `section`, `path` and `pin` present (`pin-shape`), the step exactly a prepare or exactly a
 *  frame (`range-step`), then `parseRangeTail`. A folder names its leaf by no commit, branch or head: those keys are unknown. */
function parseFolderRangeQuery(query: Readonly<Record<string, unknown>>):
    { ok: true; query: DocsFolderRangeQuery } | DocsFailureBody {
  if (!Object.hasOwn(query, 'section') || !Object.hasOwn(query, 'path') || !Object.hasOwn(query, 'pin')) return badQuery('pin-shape');
  const frameKeys = ['snapshot', 'offset', 'length'].filter((k) => Object.hasOwn(query, k));
  const prepare = Object.hasOwn(query, 'prepare');
  if (!(prepare ? frameKeys.length === 0 : frameKeys.length === 3)) return badQuery('range-step');
  const tail = parseRangeTail(query, prepare);
  return tail.ok ? { ok: true, query: { target: { section: tail.section, path: tail.path, pin: tail.pin }, frame: tail.frame } } : tail;
}

/** A folder file query: `section`, `path` and `fp` all present (`pin-shape`), then each in ccd's argv order (`bad-section`,
 *  `bad-path`, `bad-fingerprint`). The server derives the class cap itself, so no size or byte bound is read from the query. */
function parseFolderFileQuery(query: Readonly<Record<string, unknown>>): { ok: true; ask: DocsFolderFileAsk } | DocsFailureBody {
  if (!Object.hasOwn(query, 'section') || !Object.hasOwn(query, 'path') || !Object.hasOwn(query, PIN_FP)) return badQuery('pin-shape');
  const place = parsePinPlace(query);
  if (!place.ok) return place;
  const fp = own(query, PIN_FP);
  if (!isText(fp) || !isDocsFingerprint(fp)) return refused('bad-fingerprint');
  return { ok: true, ask: { section: place.section, path: place.path, fp } };
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
  if (route === 'folder-list') return { ok: true, req: { route } };
  if (route === 'folder-remove') return { ok: true, req: { route } };
  if (route === 'folder-tree') return { ok: true, req: { route } };
  if (route === 'folder-file') {
    const file = parseFolderFileQuery(query);
    return file.ok ? { ok: true, req: { route, ask: file.ask } } : file;
  }
  if (route === 'folder-range') {
    const range = parseFolderRangeQuery(query);
    return range.ok ? { ok: true, req: { route, query: range.query } } : range;
  }
  if (route === 'tree') {
    if (!Object.hasOwn(query, 'ref')) return { ok: true, req: { route, ref: null } };
    const text = own(query, 'ref');
    const ref = isText(text) ? parseDocsRef(text) : null;
    return ref === null ? refused('bad-ref') : { ok: true, req: { route, ref } };
  }
  if (route === 'history') {
    // Rich-docs spec G4: all three keys, then each value in ccd's argv order (commit, section, path).
    if (!Object.hasOwn(query, PIN_COMMIT) || !Object.hasOwn(query, 'section') || !Object.hasOwn(query, 'path')) {
      return badQuery('pin-shape');
    }
    const commit = own(query, PIN_COMMIT);
    if (!isText(commit) || !isDocsCommit(commit)) return refused('bad-commit');
    const place = parsePinPlace(query);
    return place.ok ? { ok: true, req: { route, ask: { commit, section: place.section, path: place.path } } } : place;
  }
  if (route === 'range') {
    const range = parseRangeQuery(query);
    return range.ok ? { ok: true, req: { route, query: range.query } } : range;
  }
  const pin = parseFilePin(query);
  return pin.ok ? { ok: true, req: { route, pin: pin.pin } } : pin;
}

/** Whether a section came to ccd with the sections token (rich-docs spec G1, W5b; `ccdargv.ts#DOCS_SECTIONS_CAP`, which
 *  this file never spells), so the adapter names it to ccd only on a box that lists that token. Keyed by the L0 type: a seventh section does not compile here until it is placed. */
export const DOCS_SECTION_GATED: Readonly<Record<DocSectionSlug, boolean>> = {
  specs: false, plans: false, 'product-design': false, conventions: false, vision: true, promise: true,
};

/** The `:project` route parameter: the project grammar, else `bad-project` (section 3.4), before any exec. */
export function parseDocsProjectParam(project: unknown): { ok: true; project: string } | DocsFailureBody {
  return isText(project) && isDocsProject(project) ? { ok: true, project } : refused('bad-project');
}

// ===== Outside folders (X2 P2.3; spec 4.1 and 7): the sign-in gate, the label, the Add path and the Add body =====

/** Whether sign-in is armed on this box, as the composition root measures it (`cfg.authEnabled`): one word each. */
export type DocsSignIn = 'dark' | 'armed';

/** What a folder read may do: `allow`, or the refusal's own word (the project's refusal vocabulary, as the account gate
 *  answers it). */
export type FolderReadGate = 'allow' | 'auth-off' | 'unauthenticated';

/**
 * THE folder read gate (spec 4.1, M11.6): a folder is a live working tree, and the walls forbid reading one without a
 * session. Every outside-folder read asks it first, before any exec:
 * - sign-in dark: `auth-off`, whatever `session` says (a dark box has no session worth the name, and the account gate
 *   refuses dark first for the same reason);
 * - armed and no session: `unauthenticated`;
 * - armed and a session: `allow`.
 * Pure: `session` is the caller's measured answer (the session verdict), never the request.
 */
export function folderReadGate(signIn: DocsSignIn, session: boolean): FolderReadGate {
  if (signIn === 'dark') return 'auth-off';
  return session ? 'allow' : 'unauthenticated';
}

/**
 * The folder Remove gate (spec 4.1 and 7): Remove is a narrowing, so it works while sign-in is dark, and asks no account
 * gate. With sign-in armed it still needs a session, which the root gate already measures; this restates it, as the account
 * gate restates the session question for its routes, so a Remove never reaches ccd without one:
 * - sign-in dark: `allow`, whatever `session` says;
 * - armed and no session: `unauthenticated`;
 * - armed and a session: `allow`.
 */
export function folderRemoveGate(signIn: DocsSignIn, session: boolean): Exclude<FolderReadGate, 'auth-off'> {
  if (signIn === 'dark') return 'allow';
  return session ? 'allow' : 'unauthenticated';
}

/** The refusal for a word `folderReadGate` or `folderRemoveGate` answered other than `allow`: the docs failure body of that
 *  word, sent through `sendDocsFailure` like every other docs refusal, so its status is `DOCS_FAILURE_HTTP`'s (501 and 401,
 *  the account gate's own statuses for the same two words) and the route quotes no word. */
export function folderGateRefusal(word: Exclude<FolderReadGate, 'allow'>): DocsFailureBody {
  return { ok: false, failure: word };
}

/** A folder label in the URL: the label grammar, else `bad-label`, ccd's own word for it (as `parseDocsProjectParam`
 *  answers `bad-project`), before any exec. The refused text is never echoed. */
export function parseDocsFolderLabel(label: unknown): { ok: true; label: string } | DocsFailureBody {
  return isText(label) && DOCS_FOLDER_LABEL_RE.test(label) ? { ok: true, label } : refused('bad-label');
}

/** The longest absolute path an Add may name, in UTF-8 bytes: Linux's `PATH_MAX`, the same bound ccd's own admission holds
 *  (`FOLDER_PATH_MAX_BYTES`). The server's check is a second decider of the same fact, legitimately different: ccd re-checks
 *  beside the files on another host (spec 4.1), and this one only keeps a hostile shape off the verb's argv. */
export const DOCS_FOLDER_PATH_MAX_BYTES = 4096;

/** A C0 or C1 control (DEL included) anywhere in a path. */
const FOLDER_PATH_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
/** A lone surrogate: a JS string can hold one, and a python argv never can. */
const FOLDER_PATH_LONE_SURROGATE = /\p{Cs}/u;
const FOLDER_PATH_ENCODER = new TextEncoder();

/**
 * The shape of an Add's path (spec 4.1: "absolute, no `.` or `..`, bounded length"): it starts with `/`, every other
 * component is non-empty and neither `.` nor `..` (so no `//`, no trailing `/`, and `/` alone is no folder), it holds no
 * control character or lone surrogate, and it is at most `DOCS_FOLDER_PATH_MAX_BYTES` bytes of UTF-8. Whether the path
 * names an admissible directory is ccd's, beside the files.
 */
export function isDocsFolderPath(path: string): boolean {
  if (!path.startsWith('/') || path.length > DOCS_FOLDER_PATH_MAX_BYTES) return false;
  if (FOLDER_PATH_CONTROL.test(path) || FOLDER_PATH_LONE_SURROGATE.test(path)) return false;
  if (FOLDER_PATH_ENCODER.encode(path).byteLength > DOCS_FOLDER_PATH_MAX_BYTES) return false;
  return path.slice(1).split('/').every((component) => component !== '' && component !== '.' && component !== '..');
}

/** The Add body's keys: exactly these two. */
const FOLDER_ADD_KEYS: readonly string[] = ['label', 'path'];

/** A parsed Add body. */
export type DocsFolderAddRequest = { label: string; path: string };

/**
 * Parse the Add POST's body (spec 4.1), in order, each refusal before any exec and none echoing the path:
 * 1. not a plain object: `bad-query {why:'body'}`;
 * 2. an extra key: `bad-query {key, why:'unknown'}`, the first in code-unit order;
 * 3. `label` or `path` missing or not a string: `bad-query {key, why:'body'}`;
 * 4. a label outside its grammar: `bad-label`; then a path outside `isDocsFolderPath`: `bad-path`, ccd's own word for a
 *    path outside its shape. Neither refusal carries the text.
 */
export function parseDocsFolderAddBody(body: unknown): { ok: true; req: DocsFolderAddRequest } | DocsFailureBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return badQuery('body');
  const record = body as Readonly<Record<string, unknown>>;
  const unknown = firstUnknownKey(record, FOLDER_ADD_KEYS);
  if (unknown !== undefined) return badQuery('unknown', unknown);
  const label = own(record, 'label');
  if (!isText(label)) return badQuery('body', 'label');
  const path = own(record, 'path');
  if (!isText(path)) return badQuery('body', 'path');
  const checked = parseDocsFolderLabel(label);
  if (!checked.ok) return checked;
  return isDocsFolderPath(path) ? { ok: true, req: { label, path } } : refused('bad-path');
}

// ===== The folder doors' backstop: nothing outside the known fields leaves, and no free text with it (spec 4.1) =====
// ccd never sends a folder's path in a tree, a show or a refusal, and the adapter redacts what it carries. These are the
// server's own second wall, so a ccd that broke that contract (or a field added later) cannot put a path on the wire from
// a folder door: bodies are BUILT from named fields, each held to a grammar, never copied with a spread.

/** An errno name as ccd words it (`errno.errorcode`'s names, or `E<number>` for a code with none). */
const FOLDER_ERRNO_RE = /^E[A-Z0-9]{1,15}$/;
/** A `reason` word: ccd's own words are lower-case kebab (`ssh`, `dot-config`, `registry-busy`) or an errno name. */
const FOLDER_REASON_RE = /^(?:E[A-Z0-9]{1,15}|[a-z0-9-]{1,40})$/;
/** A short kebab word: a failure's `why`, `key` and `kind` and a raster's `declared` type. */
const FOLDER_WORD_RE = /^[a-z0-9-]{1,40}$/;
/** A signal name (`SIGKILL`). */
const FOLDER_SIGNAL_RE = /^[A-Za-z0-9]{1,16}$/;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const wordIn = (re: RegExp) => (v: unknown): boolean => isText(v) && re.test(v);

/** The structured fields a folder door's refusal may carry beside its word, each with the test a value must pass. Every
 *  other key is dropped: `detail`, `stderrHead`, `cause`, `word`, `site` and every list or free text among them. */
const FOLDER_FAILURE_FIELDS: Readonly<Record<string, (v: unknown) => boolean>> = {
  reason: wordIn(FOLDER_REASON_RE), errno: wordIn(FOLDER_ERRNO_RE), why: wordIn(FOLDER_WORD_RE), key: wordIn(FOLDER_WORD_RE),
  kind: wordIn(FOLDER_WORD_RE), declared: wordIn(FOLDER_WORD_RE), signal: wordIn(FOLDER_SIGNAL_RE),
  now: (v) => v === 'absent' || v === 'present', lane: (v) => v === 'read' || v === 'fetch',
  size: isFiniteNumber, cap: isFiniteNumber, count: isFiniteNumber, bytes: isFiniteNumber, rc: isFiniteNumber,
  code: isFiniteNumber, retryAfterMs: isFiniteNumber, lockAgeMs: (v) => v === null || isFiniteNumber(v),
};

/**
 * A refusal as a folder door sends it: the word and the structured fields of `FOLDER_FAILURE_FIELDS` whose values pass their
 * test, and nothing else. The free-text fields (`detail`, `stderrHead`, `cause`, `word` and the like) are dropped, which
 * costs the page a sentence's detail and never its word, so no text ccd or the link produced can carry a path out.
 */
export function docsFolderFailureBody(body: DocsFailureBody): DocsFailureBody {
  const kept = Object.entries(body).filter(([key, value]) => Object.hasOwn(FOLDER_FAILURE_FIELDS, key) && FOLDER_FAILURE_FIELDS[key]!(value));
  return { ok: false, failure: body.failure, ...Object.fromEntries(kept) } as DocsFailureBody;
}

/** The unlisted reasons ccd names, the only keys of a tree's `byReason` that leave. */
const FOLDER_UNLISTED_REASONS = ['invalid-utf8', 'unsafe-char', 'too-long', 'too-deep'] as const;

/** A tree body built from the known fields of a tree answer that passed `docsFolderAnswerShape`: the envelope, the label,
 *  each row's six facts (and its errno, an `unreadable` row's, which the shape check held to `FOLDER_ERRNO_RE`), and the
 *  four unlisted reasons. An unknown key at any level is dropped. */
export function docsFolderTreeBody(answer: DocsFolderTreeOk): DocsFolderTreeOk {
  const by: Record<string, number> = {};
  for (const reason of FOLDER_UNLISTED_REASONS) {
    const n = (answer.unlisted.byReason as Readonly<Record<string, number | undefined>>)[reason];
    if (n !== undefined) by[reason] = n;
  }
  return {
    v: 1, verb: 'docs-folder-read', ok: true, elapsedMs: isFiniteNumber(answer.elapsedMs) ? answer.elapsedMs : 0, label: answer.label,
    entries: answer.entries.map((e) => ({
      section: e.section, path: e.path, kind: e.kind, size: e.size, mtimeNs: e.mtimeNs, fp: e.fp,
      ...(e.kind === 'unreadable' && e.errno !== undefined ? { errno: e.errno } : {}),
    })),
    unlisted: { count: answer.unlisted.count, byReason: by },
  };
}

/** A show body built from the known fields of a folder show the adapter held to its ask, its one content field rebuilt from
 *  the verified bytes (`servedShow`'s rule). An unknown key is dropped. */
function folderShowBody(answer: DocsFolderShowOk, bytes: Uint8Array): DocsFolderShowOk {
  const content = answer.encoding === 'utf8' ? { text: SHOW_UTF8.decode(bytes) } : { b64: answer.b64 };
  return {
    v: 1, verb: 'docs-folder-read', ok: true, elapsedMs: isFiniteNumber(answer.elapsedMs) ? answer.elapsedMs : 0, label: answer.label,
    source: 'folder', section: answer.section, path: answer.path, size: answer.size, sha256: answer.sha256, fp: answer.fp,
    mtimeNs: answer.mtimeNs, encoding: answer.encoding, ...content,
  };
}

/** The labels-only rows `GET /api/docs-folders` answers (spec 4.1): each folder's label and state, and NEVER its path.
 *  The one place a path is dropped, so no door can forget to. */
export function docsFolderLabelRows(rows: readonly DocsFolderListRow[]): DocsFolderLabelRow[] {
  return rows.map(({ label, state }) => ({ label, state }));
}

/** The rows `GET /api/docs-folders/paths` answers: exactly `{label, path, state}`, built from the three named fields so an
 *  extra key in a ccd row (which `docsFolderAnswerShape` does not refuse) never reaches the one door that carries a path. */
export function docsFolderPathRows(rows: readonly DocsFolderListRow[]): DocsFolderListRow[] {
  return rows.map(({ label, path, state }) => ({ label, path, state }));
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
export interface DocsJob { raw: number; wire: number; prepare?: true }

/** A read lane's load at the moment its head job is considered: execs in flight, their summed `wire` estimates, how
 *  many of them are large (`raw` over `DOCS_LANE_LARGE_RAW`) and how many are range prepares (`job.prepare`). The lane
 *  keeps the counters; this only reads them. */
export interface LaneLoad { execs: number; bytes: number; large: number; prepares: number }

/**
 * Whether the read lane admits `job` now (section 6.3), its five clauses in order, the first that answers winning:
 * 1. an idle lane always admits one job, so a job larger than the budget still runs, alone;
 * 2. `DOCS_LANE_EXECS` execs in flight refuse;
 * 3. the summed wire estimate past `DOCS_LANE_BYTES` refuses (exactly at it admits);
 * 4. a second answer over `DOCS_LANE_LARGE_RAW` refuses (exactly at it is not large);
 * 5. a second range prepare refuses (`job.prepare`). A prepare holds its exec for as long as ccd copies and hashes the
 *    snapshot: measured worst case about 23 s (ccd's 20 s helper deadline, its 2 s kill grace and its 1 s abort lock
 *    wait), against a 10 s queue wait (`DOCS_LANE_MAX_WAIT_MS`). Two of them would hold BOTH execs for that long and
 *    every tree, file read and image would answer `docs-busy`; so the lane keeps one exec free of prepares, the way
 *    clause 4 keeps big shows to one. One predicate and one counter, no second lane mechanism.
 * A refusal here is "not yet", never `docs-busy`: the lane keeps the job at the head of its FIFO (W3).
 */
export function laneAdmit(load: LaneLoad, job: DocsJob): boolean {
  if (load.execs === 0) return true;
  if (load.execs >= DOCS_LANE_EXECS) return false;
  if (load.bytes + job.wire > DOCS_LANE_BYTES) return false;
  if (laneLarge(job) && load.large > 0) return false;
  if (lanePrepare(job) && load.prepares > 0) return false;
  return true;
}

/**
 * The read lane pump's step for one queued job (X2 P1, the P1.2/P1.3 reviews' head-of-line finding), the fetch lane's
 * `fetchAdmit` shape: `'start'` when `laneAdmit` admits it; `'skip'` for a prepare refused only because a prepare
 * already runs (it keeps its place, and the pump considers the job behind it, so one range read never holds the page's
 * tree, files and images behind a second for up to a prepare's ~23 s); `'stop'` for any other refusal, which keeps the
 * FIFO for every other job exactly as before.
 */
export function laneStep(load: LaneLoad, job: DocsJob): 'start' | 'skip' | 'stop' {
  if (laneAdmit(load, job)) return 'start';
  return lanePrepare(job) && load.prepares > 0 && laneAdmit({ ...load, prepares: 0 }, job) ? 'skip' : 'stop';
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

/** The estimate of every history job: ccd's framed log bound on both sides (rich-docs spec G4). Frozen, as above. */
export const HISTORY_JOB: Readonly<DocsJob> =
  Object.freeze({ raw: DOCS_LOG_MAX_WIRE_BYTES, wire: DOCS_LOG_MAX_WIRE_BYTES });

/** The estimate of every range prepare: it carries no file bytes, only the snapshot's id, size and digest, so no content
 *  (`raw` 0) and one envelope's reserve on the wire. It still holds a lane exec for as long as ccd copies and hashes
 *  (up to about 23 s), so it carries the `prepare` mark that `laneAdmit` keeps to one exec. Frozen, as above. */
export const RANGE_PREPARE_JOB: Readonly<DocsJob> = Object.freeze({ raw: 0, wire: DOCS_ENVELOPE_RESERVE, prepare: true });

/** The estimate of one range frame of `length` raw bytes: those bytes, and their base64 framing (`showWire`). `length`
 *  is the frame's asked length, which `docsRangePlan` has held to `DOCS_RANGE_FRAME_BYTES`, so a frame is never large. */
export function rangeFrameJob(length: number): DocsJob {
  return { raw: length, wire: showWire(length) };
}

/** What `docsRangePlan` decided: the leaf, the step (`frame: null` is a prepare, one meaning) and the lane job. */
export type DocsRangePlan = { ok: true; target: DocsRangeTarget; frame: DocsRangeFrameAsk | null; job: DocsJob };

/**
 * Plan one range read from the parsed query alone (X2 spec 4.3, the plan's P1.3; pure, no exec), the first refusal
 * winning:
 * 1. The pin's kind suits the place: a committed doc takes a `blob` pin, a draft an `fp` or a `stat` pin; any other is
 *    `bad-fingerprint`, ccd's own word.
 * 2. A stat pin whose size passes `DOCS_RANGE_MAX_BYTES`: `range-too-large {size, cap}`, ccd's word for it, so the prepare
 *    is never sent.
 * 3. A frame: a length above `DOCS_RANGE_FRAME_BYTES`, or a range that ends past `DOCS_RANGE_MAX_BYTES`:
 *    `range-too-large {size, cap}` with the asked length (or end) and the bound it broke.
 * The job is `RANGE_PREPARE_JOB`, or `rangeFrameJob` of the frame's length.
 */
export function docsRangePlan(q: DocsRangeQuery): DocsRangePlan | DocsFailureBody {
  const { target, frame } = q;
  if (('commit' in target.where) !== (target.pin.kind === 'blob')) return refused('bad-fingerprint');
  const job = rangeBoundsJob(target.pin, frame);
  return job.ok ? { ok: true, target, frame, job: job.job } : job;
}

/** Steps 2 and 3 of a range plan, shared by a project's and a folder's: the bounds the pin and the step must keep, and the
 *  lane job of the step that keeps them. One reader of `DOCS_RANGE_MAX_BYTES` and `DOCS_RANGE_FRAME_BYTES` here. */
function rangeBoundsJob(pin: DocsRangePin, frame: DocsRangeFrameAsk | null): { ok: true; job: DocsJob } | DocsFailureBody {
  if (pin.kind === 'stat' && pin.size > DOCS_RANGE_MAX_BYTES) {
    return { ok: false, failure: 'range-too-large', size: pin.size, cap: DOCS_RANGE_MAX_BYTES };
  }
  if (frame === null) return { ok: true, job: RANGE_PREPARE_JOB };
  if (frame.length > DOCS_RANGE_FRAME_BYTES) {
    return { ok: false, failure: 'range-too-large', size: frame.length, cap: DOCS_RANGE_FRAME_BYTES };
  }
  if (frame.offset + frame.length > DOCS_RANGE_MAX_BYTES) {
    return { ok: false, failure: 'range-too-large', size: frame.offset + frame.length, cap: DOCS_RANGE_MAX_BYTES };
  }
  return { ok: true, job: rangeFrameJob(frame.length) };
}

/** What `docsFolderRangePlan` decided: the leaf, the step (`frame: null` is a prepare, one meaning) and the lane job. */
export type DocsFolderRangePlan = { ok: true; target: DocsFolderRangeTarget; frame: DocsRangeFrameAsk | null; job: DocsJob };

/**
 * Plan one outside-folder range read from the parsed query alone (X2 P2.3; pure, no exec), the first refusal winning:
 * a folder has no commit, so a `blob` pin is `bad-fingerprint`, ccd's own word for it; then the bounds a project's range
 * read keeps (`rangeBoundsJob`).
 */
export function docsFolderRangePlan(q: DocsFolderRangeQuery): DocsFolderRangePlan | DocsFailureBody {
  const { target, frame } = q;
  if (target.pin.kind === 'blob') return refused('bad-fingerprint');
  const job = rangeBoundsJob(target.pin, frame);
  return job.ok ? { ok: true, target, frame, job: job.job } : job;
}

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
const KEY_LOG = 'log';
const KEY_RANGE = 'range';
const KEY_PROJECT = 'project';
const KEY_BLOB = 'blob';
const KEY_LISTING = 'listing';
const KEY_FP = 'fp';
const KEY_NODE = 'node';
const KEY_FOLDER = 'folder';
const KEY_FOLDER_LIST = 'folder-list';
const KEY_FOLDER_TREE = 'folder-tree';
const KEY_FOLDER_SHOW = 'folder-show';
const KEY_FOLDER_RANGE = 'folder-range';

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
export function docsShowFlightKey(node: string, project: string, pin: DocFilePin, maxBytes: number): string {
  const fields = pin.kind === 'committed'
    ? [pin.kind, pin.commit, pin.servedRef, pin.section, pin.path]
    : [pin.kind, pin.branch, pin.head, pin.section, pin.path, pin.fp];
  return docsKey(KEY_SHOW, [node, project, ...fields, String(maxBytes)]);
}

/** A refresh flight (section 6.4): the fetched branch, the empty field for the origin default (`null`). */
export function docsRefreshFlightKey(node: string, project: string, branch: string | null): string {
  return docsKey(KEY_REFRESH, [node, project, branch ?? '']);
}

/** A history flight (rich-docs spec G4): the ask's three fields. A log at a fixed commit is the same answer for every
 *  joiner, so no generation is needed. */
export function docsLogFlightKey(node: string, project: string, ask: DocsLogAsk): string {
  return docsKey(KEY_LOG, [node, project, ask.commit, ask.section, ask.path]);
}

/** A range flight (X2 P1): the leaf's place, section, path and range pin, then the step: `prepare`, or the snapshot,
 *  offset and length. The same prepare, or the same frame of one snapshot, is the same answer for every joiner. */
export function docsRangeFlightKey(node: string, project: string, target: DocsRangeTarget,
  frame: DocsRangeFrameAsk | null): string {
  const where = 'commit' in target.where ? ['committed', target.where.commit] : ['draft', target.where.branch, target.where.head];
  const step = frame === null ? ['prepare'] : ['frame', frame.snapshot, String(frame.offset), String(frame.length)];
  return docsKey(KEY_RANGE, [node, project, ...where, target.section, target.path, docsRangePinText(target.pin), ...step]);
}

/** One project on one node: the generation counter's key and the fetch lane's queue key. */
export function docsProjectKey(node: string, project: string): string {
  return docsKey(KEY_PROJECT, [node, project]);
}

/** One outside folder on one node: the generation counter's key. A Remove bumps it, so a read that begins after a Remove never
 *  joins a flight begun before it (X2 P2.3, `folder: removed while open`). The label grammar excludes NUL. */
export function docsFolderKey(node: string, label: string): string {
  return docsKey(KEY_FOLDER, [node, label]);
}

/** The folder registry's flight: one listing read at a time per node and generation of the registry (`docsFolderKey` of the
 *  empty label, which no label is). */
export function docsFolderListFlightKey(node: string, gen: number): string {
  return docsKey(KEY_FOLDER_LIST, [node, String(gen)]);
}

/** A folder tree flight: the label and its generation. */
export function docsFolderTreeFlightKey(node: string, label: string, gen: number): string {
  return docsKey(KEY_FOLDER_TREE, [node, label, String(gen)]);
}

/** A folder show flight: the leaf's place and fingerprint, the `--max-bytes` asked, and the folder's generation. */
export function docsFolderShowFlightKey(node: string, label: string, ask: DocsFolderFileAsk, maxBytes: number,
  gen: number): string {
  return docsKey(KEY_FOLDER_SHOW, [node, label, ask.section, ask.path, ask.fp, String(maxBytes), String(gen)]);
}

/** A folder range flight: the leaf's place and range pin, then the step (`prepare`, or the snapshot, offset and length),
 *  and the folder's generation. */
export function docsFolderRangeFlightKey(node: string, label: string, target: DocsFolderRangeTarget,
  frame: DocsRangeFrameAsk | null, gen: number): string {
  const step = frame === null ? ['prepare'] : ['frame', frame.snapshot, String(frame.offset), String(frame.length)];
  return docsKey(KEY_FOLDER_RANGE,
    [node, label, target.section, target.path, docsRangePinText(target.pin), ...step, String(gen)]);
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

// ===== W3: the ok-answer shape guard (refinement (f); W2's review carry) =====
//
// The adapter checks an ok tree, index or fetch line's ENVELOPE only (`v`, `verb`, `ok`); a show line also passes
// check 8. What the routes read of an ok answer must be there before they read it: `refreshDue` dereferences
// `freshness` and `ref`, the caches key on `repo.key`, `ref.commit`, `ref.served` and each entry's facts, and every
// answer is serialised into a reply, which recurses. So the routes apply `docsAnswerShape` to every ok answer before
// `refreshDue`, a cache or the reply sees it.

/** The deepest container an ok answer may hold, the answer itself at depth 0 (refinement (f)). The deepest
 *  legitimate one sits at about depth 3 (a tree's `ref.tried[i]`, an entry's `committed`); a value nested past this
 *  is not ccd's contract, and one nested hundreds of thousands deep inside the listing bound makes reply
 *  serialisation throw a `RangeError`. */
export const DOCS_ANSWER_MAX_DEPTH = 16;

/** `malformed-answer {why:'schema'}`, a fresh body each call. */
function schemaFault(): DocsFailureBody {
  return { ok: false, failure: 'malformed-answer', why: 'schema' };
}

type AnswerRecord = Readonly<Record<string, unknown>>;

/** A plain object: not `null`, not an array (a JSON object, as `JSON.parse` builds one). */
function isRecord(v: unknown): v is AnswerRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Whether no container in `answer` sits deeper than `DOCS_ANSWER_MAX_DEPTH`. ITERATIVE, over an explicit stack of
 * `[value, depth]` pairs: a recursive walk would itself overflow on the input it exists to refuse. It descends into
 * arrays and plain objects only, and answers at the first container past the bound, so it never goes deeper.
 */
function withinDepth(answer: unknown): boolean {
  const stack: [value: unknown, depth: number][] = [[answer, 0]];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [value, depth] = top;
    if (typeof value !== 'object' || value === null) continue;
    if (depth > DOCS_ANSWER_MAX_DEPTH) return false;
    for (const child of Array.isArray(value) ? value : Object.values(value)) stack.push([child, depth + 1]);
  }
  return true;
}

/** Text a key is built from (refinement (p)): non-empty, and holding no NUL, the key separator. */
function isKeyText(v: unknown): v is string {
  return isText(v) && v.length > 0 && !v.includes(KEY_SEP);
}

/** A byte count: a non-negative safe integer. */
function isByteCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** A listing entry's committed kind, L0's own union (`DocsEntry`). */
type ListedKind = NonNullable<DocsEntry['committed']>['kind'];

/** Every committed kind, typed by the union: a kind added to `DocsEntry` does not compile here until it is placed. */
const LISTED_KINDS: Readonly<Record<ListedKind, true>> = { file: true, exec: true, symlink: true, submodule: true };

/** An entry's committed facts: `null`, or the kind, blob and size the listing map stores. */
function committedFactsOk(c: unknown): boolean {
  if (c === null) return true;
  if (!isRecord(c)) return false;
  const kind = own(c, 'kind');
  const blob = own(c, 'blob');
  const size = own(c, 'size');
  if (!isText(kind) || !Object.hasOwn(LISTED_KINDS, kind)) return false;
  return isText(blob) && isDocsCommit(blob) && (size === null || isByteCount(size));
}

/** An entry's draft facts: `null`, or the fingerprint and size the draft size map stores. */
function draftFactsOk(d: unknown): boolean {
  if (d === null) return true;
  if (!isRecord(d)) return false;
  const fp = own(d, 'fp');
  const size = own(d, 'size');
  return (fp === null || (isText(fp) && isDocsFingerprint(fp))) && (size === null || isByteCount(size));
}

/** One `entries[]` row: its section, its path (key text) and both fact slots, each present. */
function entryOk(e: unknown): boolean {
  if (!isRecord(e)) return false;
  const section = own(e, 'section');
  if (!isText(section) || !isDocsSection(section) || !isKeyText(own(e, 'path'))) return false;
  return committedFactsOk(own(e, 'committed')) && draftFactsOk(own(e, 'draft'));
}

/** A fetch stamp: `null` (never fetched), or one whose `attemptAgeMs` is a finite number and whose `lastOutcome` is
 *  text, the two fields `refreshDue` compares. */
function stampOk(s: unknown): boolean {
  if (s === null) return true;
  return isRecord(s) && Number.isFinite(own(s, 'attemptAgeMs')) && isText(own(s, 'lastOutcome'));
}

/** `freshness`: an object whose `remote` is `origin` or `null` and whose stamp passes `stampOk`. */
function freshnessOk(f: unknown): boolean {
  if (!isRecord(f)) return false;
  const remote = own(f, 'remote');
  return (remote === 'origin' || remote === null) && stampOk(own(f, 'stamp'));
}

/** The tree fields W3 reads: `repo.key`; `ref.served`, `ref.commit` and `ref.requested`; `freshness`; every entry. */
function treeShapeOk(t: AnswerRecord): boolean {
  const repo = own(t, 'repo');
  if (!isRecord(repo) || !isKeyText(own(repo, 'key'))) return false;
  const ref = own(t, 'ref');
  if (!isRecord(ref) || !isKeyText(own(ref, 'served'))) return false;
  const commit = own(ref, 'commit');
  if (!isText(commit) || !isDocsCommit(commit)) return false;
  const requested = own(ref, 'requested');
  if (requested !== null && !isText(requested)) return false;
  if (!freshnessOk(own(t, 'freshness'))) return false;
  const entries = own(t, 'entries');
  return Array.isArray(entries) && entries.every(entryOk);
}

/** Text of at most `max` code points that is what ccd's own transform leaves (refinement (f)): redact, then cut to the
 *  cap in code points. The check re-applies exactly that transform and wants the text back, so a text ccd redacted and
 *  then cut passes even when the cut ends inside a mask (`?token=*`, which the redactor alone would lengthen), while a
 *  secret left unredacted inside the cap differs from its mask and is refused. It proves this without rewriting the
 *  answer. */
function redactedText(v: unknown, max: number): boolean {
  return isText(v) && [...v].length <= max && [...redactDocsText(v)].slice(0, max).join('') === v;
}

/** One history entry: a full sha, a full sha or `null` parent, a text date, and an author and a subject inside their caps
 *  that are what ccd's redact-then-cut leaves. `date` and any extra key are not redaction-checked: the same rule as the
 *  tree's `entryOk`, since ccd is the one producer. */
function logEntryOk(e: unknown): boolean {
  if (!isRecord(e)) return false;
  const sha = own(e, 'sha');
  const parent = own(e, 'parent');
  return isText(sha) && isDocsCommit(sha) && (parent === null || (isText(parent) && isDocsCommit(parent)))
    && isText(own(e, 'date')) && redactedText(own(e, 'author'), DOCS_LOG_AUTHOR_MAX_CHARS)
    && redactedText(own(e, 'subject'), DOCS_LOG_SUBJECT_MAX_CHARS);
}

/** The log fields the history route sends: at most `DOCS_LOG_MAX_ENTRIES` entries, each `logEntryOk` (so each author and
 *  subject is what ccd's redact-then-cut leaves; `date` and extra keys are not redaction-checked), and a boolean
 *  `truncated`. */
function logShapeOk(l: AnswerRecord): boolean {
  const entries = own(l, 'entries');
  return Array.isArray(entries) && entries.length <= DOCS_LOG_MAX_ENTRIES && entries.every(logEntryOk)
    && typeof own(l, 'truncated') === 'boolean';
}

/** The index field W3 reads: `projects`, an array of plain objects. */
function indexShapeOk(i: AnswerRecord): boolean {
  const projects = own(i, 'projects');
  return Array.isArray(projects) && projects.every(isRecord);
}

/**
 * Whether an ok answer the adapter passed may be believed by the routes (refinement (f)), in order, the first fault
 * winning, each `malformed-answer {why:'schema'}` (502), never a `TypeError` in `refreshDue` or a `RangeError` at
 * serialisation:
 * 1. the answer is a plain object;
 * 2. no container in it sits deeper than `DOCS_ANSWER_MAX_DEPTH` (`withinDepth`, every verb);
 * 3. `docs-tree`: `repo.key` and `ref.served` are key text, `ref.commit` is a commit, `ref.requested` is `null` or
 *    text, `freshness.remote` is `origin` or `null`, `freshness.stamp` is `null` or carries a finite
 *    `attemptAgeMs` and a text `lastOutcome`, and `entries` is an array whose every row has an L0 section, a key-text
 *    path, a `committed` slot (`null`, or a listed kind, a commit-form blob and a byte count or `null`) and a
 *    `draft` slot (`null`, or a fingerprint or `null` and a byte count or `null`);
 * 4. `docs-index`: `projects` is an array of plain objects;
 * 5. `docs-log`: `logShapeOk`.
 * `docs-show` (check 8 ran in the adapter) and `docs-fetch` stop after 2. Takes `unknown`: this is the check that
 * makes the answer's static type true.
 */
export function docsAnswerShape(verb: DocsVerb, answer: unknown): { ok: true } | DocsFailureBody {
  if (!isRecord(answer)) return schemaFault();
  if (!withinDepth(answer)) return schemaFault();
  if (verb === 'docs-tree' && !treeShapeOk(answer)) return schemaFault();
  if (verb === 'docs-index' && !indexShapeOk(answer)) return schemaFault();
  if (verb === 'docs-log' && !logShapeOk(answer)) return schemaFault();
  return { ok: true };
}

/**
 * The shape a range answer must have before the route believes it (X2 P1; `docsAnswerShape` for the plain-object and
 * depth checks first, then the fields the route sends), `malformed-answer {why:'schema'}` on the first fault:
 * - a prepare: `snapshot` a snapshot id, `size` a byte count within `DOCS_RANGE_MAX_BYTES`, `digest` a fingerprint;
 * - a frame: `snapshot` a snapshot id, `offset` and `total` byte counts, `digest` a fingerprint, and `bytesB64` text no
 *   longer than a full frame's base64 (`showWire` less its reserve). Whether the bytes are canonical base64 and hash to
 *   `digest` is the adapter's check, which needs a hash this file has no access to.
 */
export function docsRangeAnswerShape(step: 'prepare' | 'frame', answer: unknown): { ok: true } | DocsFailureBody {
  const base = docsAnswerShape('docs-show-range', answer);
  if (!base.ok) return base;
  const a = answer as AnswerRecord;
  const snapshot = own(a, 'snapshot');
  const digest = own(a, 'digest');
  if (!isText(snapshot) || !isDocsRangeSnapshot(snapshot) || !isText(digest) || !isDocsFingerprint(digest)) return schemaFault();
  if (step === 'prepare') {
    const size = own(a, 'size');
    return isByteCount(size) && size <= DOCS_RANGE_MAX_BYTES ? { ok: true } : schemaFault();
  }
  const bytes = own(a, 'bytesB64');
  const framed = showWire(DOCS_RANGE_FRAME_BYTES) - DOCS_ENVELOPE_RESERVE;
  return isByteCount(own(a, 'offset')) && isByteCount(own(a, 'total')) && isText(bytes) && bytes.length <= framed
    ? { ok: true } : schemaFault();
}

/** A folder label as an answer carries it: text in the label grammar. */
function isFolderLabelText(v: unknown): v is string {
  return isText(v) && DOCS_FOLDER_LABEL_RE.test(v);
}

/** The kinds of a folder entry, typed by the L0 list. */
const FOLDER_ENTRY_KINDS: ReadonlySet<string> = new Set(DOCS_FOLDER_ENTRY_KINDS);

/** One folder listing row: its section, a section-relative path (`isDocsRelPath`, the request-side grammar, so an absolute
 *  path is a broken answer, never sent), a kind of the L0 list, and the facts that kind carries: a `file` a
 *  byte count, a decimal-string modified time and a fingerprint or `null`; every other kind `null` for all three; an
 *  `unreadable` row its errno name, no other row one. */
function folderEntryOk(e: unknown): boolean {
  if (!isRecord(e)) return false;
  const section = own(e, 'section');
  const kind = own(e, 'kind');
  const path = own(e, 'path');
  if (!isText(section) || !isDocsSection(section) || !isText(path) || !isDocsRelPath(path)) return false;
  if (!isText(kind) || !FOLDER_ENTRY_KINDS.has(kind)) return false;
  const size = own(e, 'size');
  const mtimeNs = own(e, 'mtimeNs');
  const fp = own(e, 'fp');
  const errno = own(e, 'errno');
  if (kind === 'unreadable' ? !(isText(errno) && FOLDER_ERRNO_RE.test(errno)) : errno !== undefined) return false;
  if (kind !== 'file') return size === null && mtimeNs === null && fp === null;
  return isByteCount(size) && isText(mtimeNs) && isDocsMtimeNs(mtimeNs) && (fp === null || (isText(fp) && isDocsFingerprint(fp)));
}

/** A folder listing's `unlisted`: a count and a record of per-reason counts. */
function folderUnlistedOk(u: unknown): boolean {
  if (!isRecord(u) || !isByteCount(own(u, 'count'))) return false;
  const by = own(u, 'byReason');
  return isRecord(by) && Object.values(by).every(isByteCount);
}

/** One registry row: a label, a state, and a path exactly when the state is `ok`. */
function folderListRowOk(r: unknown): boolean {
  if (!isRecord(r) || !isFolderLabelText(own(r, 'label'))) return false;
  const state = own(r, 'state');
  const path = own(r, 'path');
  return state === 'ok' ? isKeyText(path) : state === 'unreadable' && path === null;
}

/**
 * The shape an outside-folder ok answer must have before the adapter believes it (X2 P2.3; `docsAnswerShape`'s plain-object
 * and depth checks first, then the fields the doors send), `malformed-answer {why:'schema'}` on the first fault:
 * - `list`: `folders` an array of registry rows (`folderListRowOk`);
 * - `add`: `label` in the label grammar; `remove`: that, and `removed` the boolean `true`;
 * - `tree`: `label` in the grammar, `entries` an array of listing rows (`folderEntryOk`) and `unlisted` (`folderUnlistedOk`).
 * A show's checks need a hash and the ask, so they are the adapter's (`checkFolderShow`); a prepare and a frame are
 * `docsRangeAnswerShape`'s. Takes `unknown`: this is the check that makes the answer's static type true.
 */
export function docsFolderAnswerShape(step: 'list' | 'add' | 'remove' | 'tree', answer: unknown): { ok: true } | DocsFailureBody {
  const base = docsAnswerShape(step === 'tree' ? 'docs-folder-read' : 'docs-folder', answer);
  if (!base.ok) return base;
  const a = answer as AnswerRecord;
  if (step === 'list') {
    const folders = own(a, 'folders');
    return Array.isArray(folders) && folders.every(folderListRowOk) ? { ok: true } : schemaFault();
  }
  if (!isFolderLabelText(own(a, 'label'))) return schemaFault();
  if (step === 'add') return { ok: true };
  if (step === 'remove') return own(a, 'removed') === true ? { ok: true } : schemaFault();
  const entries = own(a, 'entries');
  return Array.isArray(entries) && entries.every(folderEntryOk) && folderUnlistedOk(own(a, 'unlisted'))
    ? { ok: true } : schemaFault();
}

// ===== The show bound, the raster check and the file representation (section 3.6, section 5.2; refinement (g)) =====

/**
 * Decoded show bytes held to the bound the server declared (refinement (g); W2's review carry): more than `job.raw`
 * (`showRawBound(maxBytes, knownSize)`, so at most the class cap) is `malformed-answer {why:'oversize'}`, check 9's
 * word: the answer broke the bound the server sent. Never `too-large`, ccd's word for a file over the cap, whose
 * `{size, cap}` the server would have to invent. `>`, never `>=`: exactly `raw` bytes is within the bound.
 */
export function docsShowBound(job: DocsJob, bytes: Uint8Array): { ok: true } | DocsFailureBody {
  if (bytes.byteLength > job.raw) return { ok: false, failure: 'malformed-answer', why: 'oversize' };
  return { ok: true };
}

/** `A-Z` to `a-z` by char code and nothing else: the rule `contentClass` applies (section 5.1, M5.3), so a KELVIN
 *  SIGN never lowers to `k`. L0's own helper is module-private; this is its twin for one table lookup. */
function lowerAscii(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : s.charAt(i);
  }
  return out;
}

type RasterExt = keyof typeof DOCS_RASTER_EXT;

/** The raster type a RASTER-CLASS path declares: its final component's text after the last `.`, lowered ASCII-only,
 *  looked up in `DOCS_RASTER_EXT`. An extension the table lacks means L0's two tables disagree (`contentClass` said
 *  raster), a defect: it throws, never answers `null`, whose one meaning is "not raster". */
function declaredRasterType(path: string): RasterType {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ext = lowerAscii(name.slice(name.lastIndexOf('.') + 1));
  if (!Object.hasOwn(DOCS_RASTER_EXT, ext)) {
    throw new Error(`declaredRasterType: '${path}' is raster by contentClass, but no raster type has its extension`);
  }
  return DOCS_RASTER_EXT[ext as RasterExt];
}

/** The raster type `path` declares (section 5.2 step 5's `t`), or `null`, whose one meaning is "`contentClass(path)`
 *  is not `raster`". */
export function docsRasterType(path: string): RasterType | null {
  return contentClass(path) === 'raster' ? declaredRasterType(path) : null;
}

/** Whether `bytes` are the raster type the path declared (section 5.2 step 5): L0's `sniffRaster` against the
 *  declared type alone, never a second copy of its table and never "any raster type". */
export function rasterVerdict(declared: RasterType, bytes: Uint8Array): 'match' | 'mismatch' {
  return sniffRaster(declared, bytes);
}

/** UTF-8 as the decoder of a show's verified bytes: a leading byte-order mark is KEPT (it is one of the file's
 *  bytes), and a malformed sequence would read as U+FFFD (the bytes came from a `text`, so none is). */
const SHOW_UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * The `show` a JSON file reply carries (W2's review: check 8 verifies the decoded bytes, not the answer it hands
 * back): the answer's facts with its ONE content field rebuilt from the verified bytes and the other dropped. A
 * `utf8` answer's `text` is the bytes decoded, so a lone surrogate (which encodes to U+FFFD's bytes) is served as
 * U+FFFD; a `base64` answer's `b64` is the answer's, which check 8 proved is exactly the bytes' canonical base64.
 * A stray `text` beside a `b64`, or a `b64` beside a `text`, never rides. A new object; the answer is never written.
 */
function servedShow<T extends Pick<DocsShowOk, 'encoding' | 'text' | 'b64'>>(answer: T, bytes: Uint8Array): T {
  const { text: _text, b64: _b64, ...facts } = answer;
  return (answer.encoding === 'utf8' ? { ...facts, text: SHOW_UTF8.decode(bytes) } : { ...facts, b64: answer.b64 }) as T;
}

/**
 * What the file route answers for a show that passed the adapter and `docsShowBound` (section 3.6, section 5.2
 * steps 5 and 6), decided here so the route decides nothing:
 * - `json`: every class but `raster`, the `DocsFileResponse` (`show` is `servedShow`'s: the answer's facts and the
 *   verified bytes, never the answer's own content field; `from` as given), sent as JSON with `no-store`;
 * - `bytes`: a raster whose bytes are its declared type, sent as `mime` with `cacheControl` (`cacheControlFor`:
 *   immutable for a committed pin, `no-store` for a draft) and these exact bytes;
 * - `refuse`: a raster whose bytes are not, `raster-mismatch {declared, size}` (422) with no bytes; `size` is the
 *   bytes' `byteLength` (equal to the answer's `size` after check 8).
 * The representation is a function of `contentClass(pin.path)` alone: no request parameter reaches it.
 */
export type DocsFileReply =
  | { kind: 'json'; body: DocsFileResponse }
  | { kind: 'bytes'; mime: RasterMime; cacheControl: string; bytes: Uint8Array }
  | { kind: 'refuse'; body: DocsFailureBody };

export function docsFileReply(pin: DocPin, answer: DocsShowOk, bytes: Uint8Array, from: 'ccd' | 'cache'):
    DocsFileReply {
  const cls = contentClass(pin.path);
  if (cls !== 'raster') {
    return { kind: 'json', body: { ok: true, contentClass: cls, show: servedShow(answer, bytes), from } };
  }
  return rasterReply(pin.path, bytes, cacheControlFor(pin, cls));
}

/** A raster path's reply: its bytes as the declared type when they are that type, else `raster-mismatch`. Shared by a
 *  project's file and a folder's. */
function rasterReply(path: string, bytes: Uint8Array, cacheControl: string): Exclude<DocsFileReply, { kind: 'json' }> {
  const declared = declaredRasterType(path);
  if (rasterVerdict(declared, bytes) === 'mismatch') {
    return { kind: 'refuse', body: { ok: false, failure: 'raster-mismatch', declared, size: bytes.byteLength } };
  }
  return { kind: 'bytes', mime: DOCS_RASTER_TYPES[declared].mime, cacheControl, bytes };
}

/** What a folder file door answers: `docsFileReply`'s three arms, the JSON one carrying a folder show. */
export type DocsFolderFileReply = { kind: 'json'; body: DocsFolderFileResponse } | Exclude<DocsFileReply, { kind: 'json' }>;

/**
 * The reply for a folder show that passed the adapter and `docsShowBound`: `docsFileReply`'s rule over the path's class alone.
 * Every class but `raster` answers JSON (the show rebuilt from the verified bytes, `servedShow`); a raster whose bytes are
 * its declared type answers those exact bytes, `no-store` because a folder is a live tree, never immutable; any other raster
 * is `raster-mismatch`. No request parameter reaches the representation.
 */
export function docsFolderFileReply(answer: DocsFolderShowOk, bytes: Uint8Array): DocsFolderFileReply {
  const cls = contentClass(answer.path);
  if (cls !== 'raster') return { kind: 'json', body: { ok: true, contentClass: cls, show: folderShowBody(answer, bytes) } };
  return rasterReply(answer.path, bytes, DOCS_CACHE_NO_STORE);
}

// ===== The known size and the committed cache's verdicts (section 6.2, section 6.5; refinement (l)) =====

/** What the listing map holds for one committed `section NUL path` (section 6.5): the blob, the listed size (`null`:
 *  the tree carried none) and the committed kind. Task 5's `cache.ts` stores exactly this. */
export type DocsListedFile = { blob: string; size: number | null; kind: ListedKind };

/**
 * The size the server holds for a show (section 6.2: from server facts only, never the request), for
 * `docsShowPlan`'s `knownSize`. A committed pin reads its listing entry's size; a draft reads the `fp -> size` map's
 * value (`draftSize`). `undefined` means "no size fact", one meaning: an unlisted entry and a listed `null` size are
 * both no fact. A listed 0 is a fact, so `??`, never `||`. The other side's value is ignored.
 */
export function docsKnownSize(pin: DocPin, listed: DocsListedFile | undefined, draftSize: number | undefined):
    number | undefined {
  return pin.kind === 'committed' ? listed?.size ?? undefined : draftSize;
}

/** Whether the cache may serve a committed hit (section 6.5): `eligible`, or why not, in this order: no listing
 *  entry (`unlisted`), a kind that is not file content (`kind`), a served ref not recorded recently (`provenance`). */
export type DocsCacheVerdict = { eligible: true } | { eligible: false; why: 'unlisted' | 'kind' | 'provenance' };

/** File content: the two committed kinds whose blob is the file's bytes. A symlink's blob is its target text and a
 *  submodule's is a commit, so neither may hit or fill, even when it shares a blob with a file. */
function cacheableKind(kind: ListedKind): boolean {
  return kind === 'file' || kind === 'exec';
}

/**
 * The committed hit verdict (section 6.5; refinement (l)): eligible iff the pin's listing entry exists, its kind is
 * `file` or `exec`, and its `servedRef` was recorded `servedRefAgeMs` ago with `0 <= age < DOCS_LISTING_PROVENANCE_MS`.
 * `servedRefAgeMs` is `undefined` when the listing never recorded that `servedRef`, one meaning; a negative age (a
 * clock that went back) and `NaN` vouch for nothing. The clock is the caller's.
 */
export function docsCacheVerdict(listed: DocsListedFile | undefined, servedRefAgeMs: number | undefined):
    DocsCacheVerdict {
  if (listed === undefined) return { eligible: false, why: 'unlisted' };
  if (!cacheableKind(listed.kind)) return { eligible: false, why: 'kind' };
  if (servedRefAgeMs === undefined || !(servedRefAgeMs >= 0 && servedRefAgeMs < DOCS_LISTING_PROVENANCE_MS)) {
    return { eligible: false, why: 'provenance' };
  }
  return { eligible: true };
}

/** Whether an ok show answer may FILL the blob cache (section 6.5): a committed pin whose listing entry exists and
 *  is file content. A draft never fills, and with no listing entry the answer is served but not cached. */
export function docsCacheFill(pin: DocPin, listed: DocsListedFile | undefined): boolean {
  return pin.kind === 'committed' && listed !== undefined && cacheableKind(listed.kind);
}

/**
 * A cache hit's `show` (refinement (l)): the STORED content (`size`, `sha256`, `encoding` and its one content field),
 * the REQUEST's pin echoes (`source:'committed'`, `section`, `path`, `commit`), the listing's `blob`,
 * `onRef:'contains'` (the listing vouched within `DOCS_LISTING_PROVENANCE_MS`) and `elapsedMs: 0`. No `mode`: it was
 * not measured for this request, so it is absent, never copied. The same blob under a new commit or path answers that
 * commit and path. A new object; the stored answer is never written.
 */
export function docsCacheHitAnswer(stored: DocsStoredShow, pin: Extract<DocPin, { kind: 'committed' }>, blob: string):
    DocsShowOk {
  const content = stored.encoding === 'base64' ? { b64: stored.b64 } : { text: stored.text };
  return {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 0, source: 'committed', section: pin.section, path: pin.path,
    size: stored.size, sha256: stored.sha256, encoding: stored.encoding, ...content,
    commit: pin.commit, blob, onRef: 'contains',
  };
}

// ===== Task 11 review 2-1: a response with no payload and no content type =====

/**
 * What the plugin's `onSend` hook applies (section 5.3), over `docsSendPolicy`. Fastify hands `onSend` a payload of
 * `undefined` when the route or hook sent none (`reply.code(401).send()`, as the root gate answers a refused
 * WebSocket upgrade) and sets no content-type then; a payload of any other value, `''` included, is a body and
 * Fastify gives it a content-type of its own. `payloadAbsent` is exactly that `undefined` test, one meaning.
 *
 * A response with NO payload and NO content type (`''`) is not a type to refuse: it passes, decorated exactly like
 * any passing response (the four `DOCS_RESPONSE_HEADERS`, `no-store` unless it is a 200 whose route set a
 * cache-control), and sets no content-type, since it carries nothing to type. Every other response, a body with no
 * content type (M5.5) and a payload-free one that DOES name a content type included, is `docsSendPolicy`'s verdict
 * unchanged.
 */
export function docsHookVerdict(
  payloadAbsent: boolean, statusCode: number, contentType: string, cacheControl: string | undefined,
): DocsSendVerdict {
  const typed = payloadAbsent && contentType === '' ? DOCS_JSON_CONTENT_TYPE : contentType;
  return docsSendPolicy(statusCode, typed, cacheControl);
}

// ===== Task 11 review 3-1: a tree answer names the project the request named =====

/**
 * Whether an ok tree the adapter passed answers the project the request named: its `project` is, with `===` and no
 * normalisation (no lowering, trimming or decoding), the `project` the route parsed from `:project`. The listing map
 * files a tree under the answer's own `project`, so a tree naming another project would be filed under that one: its
 * file reads would then be refused against a blob that is not theirs, or served another file's cached bytes. An
 * echo that is not that exact text (another project, a different case, absent, not text) is
 * `malformed-answer {why:'pin'}`, the word for an answer that does not echo its request. A fresh body each call.
 * Runs after `docsAnswerShape` and before anything records or replies.
 */
export function docsTreeEcho(answer: DocsTreeOk, project: string): { ok: true } | DocsFailureBody {
  if (answer.project === project) return { ok: true };
  return { ok: false, failure: 'malformed-answer', why: 'pin' };
}

// ===== Task 11 review 3-2: the blob cache holds only the verified content =====

/** What a blob cache entry keeps of a show answer (`docsCacheHitAnswer` reads exactly these): `size`, `sha256`,
 *  `encoding` and the ONE content field the encoding names. Every other key ccd sent is not kept. */
export type DocsStoredShow = Pick<DocsShowOk, 'size' | 'sha256' | 'encoding' | 'text' | 'b64'>;

/**
 * The show a committed fill stores (section 6.5): `servedShow`'s content (the field the `encoding` names, rebuilt from
 * the verified bytes; the other content field never rides) under the three facts `docsCacheHitAnswer` reads, and no
 * other key. A new object; the answer is never written. The blob cache charges the one content field held here.
 */
export function docsStoredShow(answer: DocsShowOk, bytes: Uint8Array): DocsStoredShow {
  const { size, sha256, encoding, text, b64 } = servedShow(answer, bytes);
  return encoding === 'base64' ? { size, sha256, encoding, b64 } : { size, sha256, encoding, text };
}

// ===== Review 361 F8: the lane verdicts live here (section 6.3, section 6.4) =====

/**
 * Whether `job` is a large answer (section 6.3): `raw` over `DOCS_LANE_LARGE_RAW`, so exactly at it is not large.
 * THE one large-job predicate: `laneAdmit`'s fourth clause refuses a second large answer with it, and the read lane
 * counts a started and a finished job in `LaneLoad.large` with it.
 */
export function laneLarge(job: DocsJob): boolean {
  return job.raw > DOCS_LANE_LARGE_RAW;
}

/**
 * Whether `job` is a range prepare (the mark `RANGE_PREPARE_JOB` carries). THE one prepare predicate: `laneAdmit`'s
 * fifth clause refuses a second prepare with it, and the read lane counts a started and a finished job in
 * `LaneLoad.prepares` with it.
 */
export function lanePrepare(job: DocsJob): boolean {
  return job.prepare === true;
}

/**
 * Whether a lane's jobs that have not started, COUNTING the one just arriving, exceed that lane's queue bound
 * (section 6.3, section 6.4): `DOCS_LANE_QUEUE` for the read lane, `DOCS_FETCH_QUEUE` for the fetch lane. Exactly at
 * the bound is not over it. The read lane asks before it queues a job (`waiting` is its FIFO plus the new job); the
 * fetch lane asks after it has queued and pumped (`waiting` is the FIFO).
 */
export function laneOverflow(lane: DocsLaneName, waiting: number): boolean {
  return waiting > (lane === 'read' ? DOCS_LANE_QUEUE : DOCS_FETCH_QUEUE);
}

/**
 * The fetch lane's admission for ONE queued job (section 6.4), in order: `running` fetches at `DOCS_FETCH_GLOBAL` is
 * `'full'` (the pump stops, whatever the key); else a fetch already running under the job's key is `'skip'` (jobs
 * under one key run one at a time: it stays queued and the pump considers the next); else `'start'`. A word for the
 * lane's own bookkeeping, never a body.
 */
export function fetchAdmit(running: number, keyRunning: boolean): 'start' | 'skip' | 'full' {
  if (running >= DOCS_FETCH_GLOBAL) return 'full';
  if (keyRunning) return 'skip';
  return 'start';
}
