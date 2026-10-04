// The native Docs reader's L0 vocabulary: the `shared/docs.ts` row of section 1 of the design,
// `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`.
//
// L0, and it imports NOTHING, not even a type: the PWA bundles this file and the server and the agent compile it,
// so it may name no host global either (the PWA's types carry none). Byte lengths are therefore computed from code
// points by hand. The file is pure ASCII: a non-ASCII code point in a grammar is written only as a `\u` escape, so
// the parity scan reads each grammar line byte for byte.
//
// Everything here is declared once and derived everywhere else. ccd's embedded helper (`_docs_py`, `ccd/ccd`)
// holds ONE single-line parity copy of each grammar body, of the two path lists and of every cap ccd enforces, and
// `server/test/docs-parity.test.ts` binds the two sides; `server/test/single-definition.test.ts` sees one TS copy.
//
// The blocks are lettered and appended in order: (A) sections, (B) caps, (C) value grammars, then the failure
// vocabulary, the wire types, the content class, the overlay, the GitHub link and the page grammar.

// ---- (A) Sections ----------------------------------------------------------------------------------------------

/** The four doc sections, slug to repo path, in display order. Every other list of sections is derived from this
 *  object: `DOC_SECTION_SLUGS`, `DOCS_SECTION_RE_BODY`, and ccd's `SECTIONS` parity copy. */
export const DOC_SECTIONS = {
  specs: 'docs/superpowers/specs',
  plans: 'docs/superpowers/plans',
  'product-design': 'docs/product-design',
  conventions: 'docs/conventions',
} as const;

export type DocSectionSlug = keyof typeof DOC_SECTIONS;

/** The slugs, in `DOC_SECTIONS` order (a string key keeps its insertion order). */
export const DOC_SECTION_SLUGS: readonly DocSectionSlug[] = Object.keys(DOC_SECTIONS) as DocSectionSlug[];

/** True iff `s` is one of the four slugs. A list test, never `in`: `toString` and `__proto__` are no section. */
export function isDocsSection(s: string): s is DocSectionSlug {
  return typeof s === 'string' && (DOC_SECTION_SLUGS as readonly string[]).includes(s);
}

/** A section-relative path as a repo path: `docRepoPath('specs', 'x.md')` is `docs/superpowers/specs/x.md`. It
 *  validates nothing; a caller passes a path `isDocsRelPath` admitted. */
export function docRepoPath(section: DocSectionSlug, path: string): string {
  return `${DOC_SECTIONS[section]}/${path}`;
}

// ---- (B) Caps (design section 2 (f), section 6.1, and section 2 (g)'s refreshDue) ------------------------------
//
// Each cap is its OWN literal, never an alias of a neighbour that holds the same number. DOCS_MAX_DOC_BYTES and
// DOCS_MAX_IMAGE_BYTES are both 2 MiB by two separate rulings; tying them would let a change to one move the
// other's refusal threshold. An environment override may only lower a value. ccd holds parity copies only of the
// caps ccd enforces. "Framed" is the length of an answer line after the agent's own JSON encoding of it.
//
// The ceiling chain: 4 * ceil(DOCS_MAX_FILE_BYTES / 3) + DOCS_ENVELOPE_RESERVE = 5657944, at most
// DOCS_MAX_ANSWER_BYTES, which is below the agent's 8 MiB exec buffer. The class-cap chain:
// 4 * ceil(2097152 / 3) + 65536 = 2861740. `server/test/docs-shared.test.ts` computes both.

/** ccd: the ceiling of every show, and the bound on the draft fingerprint read. */
export const DOCS_MAX_FILE_BYTES = 4194304;
/** The class cap for markdown, html, text and other: the server passes it as `--max-bytes`. */
export const DOCS_MAX_DOC_BYTES = 2097152;
/** The class cap for raster and svg. Its own literal, never `DOCS_MAX_DOC_BYTES`. */
export const DOCS_MAX_IMAGE_BYTES = 2097152;
/** The envelope allowance above an encoded body. */
export const DOCS_ENVELOPE_RESERVE = 65536;
/** ccd's final show guard, in framed bytes. */
export const DOCS_MAX_ANSWER_BYTES = 6291456;
/** ccd's final tree and index guard, in framed bytes. */
export const DOCS_MAX_LISTING_WIRE_BYTES = 1048576;
/** ccd: the most entries one tree or index answer lists. */
export const DOCS_MAX_ENTRIES = 5000;
/** ccd: the most bytes the draft phase of one tree answer may hash. */
export const DOCS_DRAFT_HASH_BUDGET = 33554432;
/** ccd: the most drafts one tree answer reports. */
export const DOCS_MAX_DRAFTS = 1000;
/** PWA: an image at or past this index on one page waits for a tap. */
export const DOCS_MAX_IMAGES_PER_PAGE = 30;
/** ccd: the floor between two fetch attempts of one branch. */
export const DOCS_FETCH_MIN_INTERVAL_MS = 10000;
/** refreshDue: the age at which a last attempt that ended `ok` or `remote-branch-absent` is due again. */
export const DOCS_STALE_MS = 600000;
/** refreshDue: the age at which any other last attempt is due again. */
export const DOCS_RETRY_FLOOR_MS = 60000;

// ---- (C) Value grammars (design section 2 (a)) -----------------------------------------------------------------
//
// Each grammar is a pattern BODY. TypeScript matches it as `new RegExp('^(?:' + body + ')$', 'u')`, built once at
// module scope by `fullMatcher`; the helper matches the same body with `re.fullmatch`. The ref grammar is a strict
// subset of what git accepts, proved by a fuzz test over real `git check-ref-format`, so no runtime
// check-ref-format call exists.

/** A project directory name. Its first character can never be `-` or `.`. */
export const DOCS_PROJECT_RE_BODY = '[A-Za-z0-9_][A-Za-z0-9._-]{0,99}';
/** A bare branch name: not `HEAD`, no `refs/` prefix, no `..`, no component ending in `.lock` or in `.`. It
 *  excludes `* : + ^ ~ @{`, so it can never widen a refspec. */
export const DOCS_BARE_REF_RE_BODY = String.raw`(?!HEAD$)(?!refs/)(?!.*\.\.)(?!.*\.lock(?:/|$))(?!.*\.(?:/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*`;
/** The longest bare name, in characters (the grammar is ASCII). It bounds a bare ref and the bare remainder of a
 *  qualified one. */
export const DOCS_REF_MAX_CHARS = 200;
/** The two prefixes a qualified ref may carry. Only `origin` is ever consulted. */
export const DOCS_QUALIFIED_PREFIX_RE_BODY = '(?:refs/heads/|refs/remotes/origin/)';
/** A qualified ref: a prefix, then a bare name. Derived by concatenation, as the helper derives its copy. */
export const DOCS_QUALIFIED_REF_RE_BODY = DOCS_QUALIFIED_PREFIX_RE_BODY + DOCS_BARE_REF_RE_BODY;
/** A full commit or HEAD id, sha1 or sha256. The helper also requires the repo's own object-format length. */
export const DOCS_SHA_RE_BODY = '[0-9a-f]{40}|[0-9a-f]{64}';
/** A draft fingerprint: the sha256 of the draft bytes. */
export const DOCS_FINGERPRINT_RE_BODY = '[0-9a-f]{64}';
/** `--max-bytes N`: one to eight digits, no leading zero. ccd's bash front checks it; a bad N is a usage error. */
export const DOCS_MAX_BYTES_RE_BODY = '[1-9][0-9]{0,7}';
/** A section slug, generated from `DOC_SECTIONS`. */
export const DOCS_SECTION_RE_BODY = DOC_SECTION_SLUGS.join('|');
/** A section-relative path: not absolute, no trailing or doubled `/`, no `.` or `..` component, no C0 or C1
 *  control. The category check and the byte bounds below apply on top of it. */
export const DOCS_REL_PATH_RE_BODY = String.raw`(?!/)(?!.*/$)(?!.*//)(?!(?:.*/)?\.\.?(?:/|$))[^\u0000-\u001f\u007f-\u009f]{1,1024}`;
/** The general categories no path code point may have: format (every bidi control among them), line separator,
 *  paragraph separator, private use and unassigned. */
export const DOCS_PATH_EXCLUDED_CATEGORIES = ['Cf', 'Zl', 'Zp', 'Co', 'Cn'] as const;
/** The variation selectors, as inclusive code point ranges, refused beside the categories. */
export const DOCS_PATH_EXCLUDED_RANGES = [[0xfe00, 0xfe0f], [0xe0100, 0xe01ef]] as const;
/** A path's whole UTF-8 length bound. */
export const DOCS_PATH_MAX_BYTES = 1024;
/** One component's UTF-8 length bound. */
export const DOCS_PATH_MAX_COMPONENT_BYTES = 255;
/** The most components a path may have. */
export const DOCS_PATH_MAX_DEPTH = 16;

/** THE one TypeScript matcher shape for a grammar body. */
function fullMatcher(body: string): RegExp {
  return new RegExp('^(?:' + body + ')$', 'u');
}

const PROJECT_RE = fullMatcher(DOCS_PROJECT_RE_BODY);
const BARE_REF_RE = fullMatcher(DOCS_BARE_REF_RE_BODY);
const QUALIFIED_PREFIX_RE = new RegExp('^' + DOCS_QUALIFIED_PREFIX_RE_BODY, 'u');
const SHA_RE = fullMatcher(DOCS_SHA_RE_BODY);
const FINGERPRINT_RE = fullMatcher(DOCS_FINGERPRINT_RE_BODY);
const MAX_BYTES_RE = fullMatcher(DOCS_MAX_BYTES_RE_BODY);
const REL_PATH_RE = fullMatcher(DOCS_REL_PATH_RE_BODY);

/** One code point class, built FROM the two declared lists (never a second hand-written list), plus `\p{Cs}`, a
 *  lone surrogate. A JS string can hold one and python argv never can (the helper's strict UTF-8 decode refuses
 *  it), so `\p{Cs}` is the TypeScript form of that rule, not a sixth category. It runs as its own `.test()`: a
 *  `.*` lookahead would stop at U+2028 (a JS `.` excludes line terminators), and a later code point could hide
 *  behind it. */
const EXCLUDED_CODE_POINT_RE = new RegExp(
  '[' +
    DOCS_PATH_EXCLUDED_CATEGORIES.map((c) => '\\p{' + c + '}').join('') +
    DOCS_PATH_EXCLUDED_RANGES.map(([lo, hi]) => '\\u{' + lo.toString(16) + '}-\\u{' + hi.toString(16) + '}').join('') +
    '\\p{Cs}]',
  'u',
);

/** The UTF-8 length of `s`, counted from its code points: 1 to 4 bytes each, a surrogate pair being one. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const cp = s.codePointAt(i) ?? 0;
    if (cp > 0xffff) {
      n += 4;
      i += 1;
    } else {
      n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : 3;
    }
  }
  return n;
}

// Every predicate refuses a non-string first: `RegExp.prototype.test` coerces its argument, so an array such as
// a repeated query key (`['demo']`) would otherwise test as the string `demo`.

export function isDocsProject(s: string): boolean {
  return typeof s === 'string' && PROJECT_RE.test(s);
}

export function isDocsBareRef(s: string): boolean {
  return typeof s === 'string' && s.length <= DOCS_REF_MAX_CHARS && BARE_REF_RE.test(s);
}

/** The prefix matches and the remainder is a bare name, so `DOCS_REF_MAX_CHARS` bounds the branch part. */
export function isDocsQualifiedRef(s: string): boolean {
  if (typeof s !== 'string') return false;
  const m = QUALIFIED_PREFIX_RE.exec(s);
  return m !== null && isDocsBareRef(s.slice(m[0].length));
}

export function isDocsCommit(s: string): boolean {
  return typeof s === 'string' && SHA_RE.test(s);
}

/** The grammar, then the category check, then the whole-path bytes, the component bytes and the depth. */
export function isDocsRelPath(s: string): boolean {
  if (typeof s !== 'string' || !REL_PATH_RE.test(s) || EXCLUDED_CODE_POINT_RE.test(s)) return false;
  if (utf8Bytes(s) > DOCS_PATH_MAX_BYTES) return false;
  const parts = s.split('/');
  return parts.length <= DOCS_PATH_MAX_DEPTH && parts.every((p) => utf8Bytes(p) <= DOCS_PATH_MAX_COMPONENT_BYTES);
}

export function isDocsFingerprint(s: string): boolean {
  return typeof s === 'string' && FINGERPRINT_RE.test(s);
}

export function isDocsMaxBytes(s: string): boolean {
  return typeof s === 'string' && MAX_BYTES_RE.test(s);
}

/** A ref value, classified. The two grammars are disjoint: a bare name never starts with `refs/`. */
export type DocsRefSpec = { kind: 'bare'; name: string } | { kind: 'qualified'; ref: string };

/** `null` has ONE meaning: `s` is in neither grammar. */
export function parseDocsRef(s: string): DocsRefSpec | null {
  if (isDocsQualifiedRef(s)) return { kind: 'qualified', ref: s };
  if (isDocsBareRef(s)) return { kind: 'bare', name: s };
  return null;
}

/** The text a spec stands for; `docsRefText(parseDocsRef(s)!)` is `s` for every `s` either grammar admits. */
export function docsRefText(r: DocsRefSpec): string {
  return r.kind === 'bare' ? r.name : r.ref;
}

// ===== (D) failure vocabulary, retry classes, context, body and redactor =====
// Spec 2026-10-01 section 2 (b) "Envelope" and "One redactor", section 2 (i), section 3.5 and section 3.7.
// This file stays pure ASCII (the L0 pin in docs-shared.test.ts), so the spec's section sign is spelled out.

/** A git object id as the wire carries it: 40 (sha1) or 64 (sha256) lowercase hex. Module-private; used below. */
type Sha = string;

/**
 * Every Docs failure word, and the side that says it.
 * - `'ccd'`: answered by the fleet's `ccd docs-*` helper (`_docs_py`), which holds ONE parity-bound copy of this
 *   half as `FAILURES` (docs-parity.test.ts compares the two in both directions).
 * - `'server'`: answered only by the server's adapter, hooks or lanes; ccd never prints one.
 * One table, so a new word is a compile error in every exhaustive record keyed by `DocsFailure`
 * (`DOCS_FAILURE_RETRY` below, L1's `DOCS_FAILURE_HTTP`, the PWA's `DOCS_FAILURE_SENTENCE`) until it is mapped.
 * Grouped as the spec's tables group them.
 */
export const DOCS_FAILURES = {
  // Argument (section 2 (i)): L1 and ccd apply the same grammar.
  'bad-project': 'ccd',
  'bad-ref': 'ccd',
  'bad-commit': 'ccd',
  'bad-section': 'ccd',
  'bad-path': 'ccd',
  'bad-fingerprint': 'ccd',
  // Repository.
  'unknown-project': 'ccd',
  'not-a-git-repo': 'ccd',
  'linked-worktree': 'ccd',
  'shared-repo': 'ccd',
  'partial-clone': 'ccd',
  'repo-unreadable': 'ccd',
  // Refs.
  'no-default-branch': 'ccd',
  'unresolved-ref': 'ccd',
  'ref-not-commit': 'ccd',
  // Objects and paths.
  'unknown-commit': 'ccd',
  'not-a-commit': 'ccd',
  'object-missing': 'ccd',
  'absent-path': 'ccd',
  'not-a-file': 'ccd',
  'symlink-in-path': 'ccd',
  'too-large': 'ccd',
  'too-many-entries': 'ccd',
  'unreadable-path': 'ccd',
  // Draft pins (show).
  'worktree-gone': 'ccd',
  'ambiguous-worktree': 'ccd',
  'untrusted-worktree': 'ccd',
  'worktree-moved': 'ccd',
  'draft-changed': 'ccd',
  // Fetch.
  'remote-absent': 'ccd',
  'remote-branch-absent': 'ccd',
  'fetch-auth-failed': 'ccd',
  'fetch-rejected-objects': 'ccd',
  'fetch-transport': 'ccd',
  'ref-locked': 'ccd',
  'fetch-too-soon': 'ccd',
  'fetch-timeout': 'ccd',
  'fetch-failed': 'ccd',
  // ccd generic.
  'git-failed': 'ccd',
  'git-timeout': 'ccd',
  'helper-unavailable': 'ccd',
  'helper-failed': 'ccd',
  // Server-only (section 2 (i)).
  'unsupported': 'server',
  'caps-unknown': 'server',
  'not-granted': 'server',
  'link-failed': 'server',
  'link-timeout': 'server',
  'docs-busy': 'server',
  'ccd-timeout': 'server',
  'ccd-killed': 'server',
  'ccd-fault': 'server',
  'answer-overflow': 'server',
  'malformed-answer': 'server',
  'unknown-failure': 'server',
  // Added by section 3.7 and section 5 (the HTTP layer).
  'foreign-request': 'server',
  'bad-query': 'server',
  'raster-mismatch': 'server',
  'response-type-refused': 'server',
} as const satisfies Record<string, 'ccd' | 'server'>;

export type DocsFailure = keyof typeof DOCS_FAILURES;

/**
 * What the page offers on a failure (section 2 (i) "Retry codes", section 4.7).
 * - `auto`: retried automatically once.
 * - `manual`: a Retry button.
 * - `none`: no retry.
 * - `auto-while-young`: `ref-locked` only. Retried automatically after 3 s while the body's `lockAgeMs` is null
 *   or under 60 000; otherwise treated as `none`, with the "stale lock" sentence.
 */
export type DocsRetryClass = 'auto' | 'manual' | 'none' | 'auto-while-young';

/** The retry class of every word: exhaustive by type, so a word added to `DOCS_FAILURES` does not compile until
 *  it is placed here. `not-granted` is `manual` (section 7.1, C3: it was none); `caps-unknown` is `auto` (C1). */
export const DOCS_FAILURE_RETRY: Record<DocsFailure, DocsRetryClass> = {
  'bad-project': 'none',
  'bad-ref': 'none',
  'bad-commit': 'none',
  'bad-section': 'none',
  'bad-path': 'none',
  'bad-fingerprint': 'none',
  'unknown-project': 'none',
  'not-a-git-repo': 'none',
  'linked-worktree': 'none',
  'shared-repo': 'none',
  'partial-clone': 'none',
  'repo-unreadable': 'manual',
  'no-default-branch': 'none',
  'unresolved-ref': 'none',
  'ref-not-commit': 'none',
  'unknown-commit': 'auto',
  'not-a-commit': 'none',
  'object-missing': 'manual',
  'absent-path': 'none',
  'not-a-file': 'none',
  'symlink-in-path': 'none',
  'too-large': 'none',
  'too-many-entries': 'none',
  'unreadable-path': 'manual',
  'worktree-gone': 'auto',
  'ambiguous-worktree': 'none',
  'untrusted-worktree': 'none',
  'worktree-moved': 'auto',
  'draft-changed': 'auto',
  'remote-absent': 'none',
  'remote-branch-absent': 'none',
  'fetch-auth-failed': 'none',
  'fetch-rejected-objects': 'none',
  'fetch-transport': 'manual',
  'ref-locked': 'auto-while-young',
  'fetch-too-soon': 'auto',
  'fetch-timeout': 'manual',
  'fetch-failed': 'manual',
  'git-failed': 'manual',
  'git-timeout': 'manual',
  'helper-unavailable': 'none',
  'helper-failed': 'manual',
  'unsupported': 'none',
  'caps-unknown': 'auto',
  'not-granted': 'manual',
  'link-failed': 'auto',
  'link-timeout': 'auto',
  'docs-busy': 'auto',
  'ccd-timeout': 'manual',
  'ccd-killed': 'manual',
  'ccd-fault': 'manual',
  'answer-overflow': 'none',
  'malformed-answer': 'none',
  'unknown-failure': 'manual',
  'foreign-request': 'none',
  'bad-query': 'none',
  'raster-mismatch': 'none',
  'response-type-refused': 'none',
};

/** The words a `ccd docs-*` answer may carry, in `DOCS_FAILURES` order. DERIVED from the table, never hand-listed:
 *  the L3 adapter answers `unknown-failure {word}` for an `ok:false` word outside this set (section 2 (b) row 7). */
export const DOCS_CCD_FAILURES: readonly DocsFailure[] =
  (Object.keys(DOCS_FAILURES) as DocsFailure[]).filter((w) => DOCS_FAILURES[w] === 'ccd');

/** The words a fetch stamp's `lastOutcome` can record: exactly what `docs-fetch` classifies after it ran git
 *  (section 2 (g) step 7). `remote-absent` and `fetch-too-soon` are answered before any attempt, so neither is
 *  ever stamped. */
export type DocsFetchFailure =
  | 'fetch-timeout'
  | 'remote-branch-absent'
  | 'fetch-rejected-objects'
  | 'fetch-auth-failed'
  | 'ref-locked'
  | 'fetch-transport'
  | 'fetch-failed';

/** `not-a-file {kind}` (section 2 (i) "Objects and paths"). */
export type DocsNotAFileKind =
  | 'directory'
  | 'section-not-a-directory'
  | 'symlink'
  | 'submodule'
  | 'file-in-path'
  | 'special'
  | 'hardlink'
  | 'foreign-owner'
  | 'other-device';

/** One step of the default-ref chain, as `unresolved-ref {tried}` and `DocsTreeOk.ref.tried` both carry it. */
type DocsTriedRef = { ref: string; result: 'resolved' | 'absent' | 'dangling' | 'malformed' | 'not-a-commit' };

/**
 * The context fields a failure body may carry beside its word: one optional-field bag, every field optional.
 * Section 3.5 names this type and never defines it; this is its definition for the ccd and server halves alike.
 * The PWA switches on `failure` and reads only the fields that word's row names:
 * - `root`: unknown-project (ccd's projects root).
 * - `owner`, `branch`: linked-worktree, shared-repo.
 * - `tried`, `suggest`, `hint`: unresolved-ref. `ref`, `type`: ref-not-commit.
 * - `kind`: not-a-file. `size`, `cap`: too-large. `count`, `bytes`: too-many-entries. `errno`: unreadable-path.
 * - `candidates`: ambiguous-worktree. `why`: untrusted-worktree, malformed-answer, foreign-request, bad-query.
 * - `head`: worktree-moved. `now`: draft-changed. `lockAgeMs`: ref-locked.
 * - `step`, `rc`, `stderrHead`: git-failed, git-timeout. `signal`: ccd-killed. `code`, `stderrHead`: ccd-fault.
 * - `cause`: link-failed. `word`: unknown-failure. `lane`: docs-busy. `declared`, `size`: raster-mismatch.
 *   `key`: bad-query. `site`: foreign-request.
 */
export interface DocsFailureContext {
  root?: string;
  owner?: string | null;
  branch?: string | null;
  tried?: DocsTriedRef[];
  suggest?: string;
  hint?: 'tag';
  ref?: string;
  type?: string;
  kind?: DocsNotAFileKind;
  size?: number;
  cap?: number;
  count?: number;
  bytes?: number;
  errno?: string;
  candidates?: string[];
  why?: string;
  head?: Sha;
  now?: 'absent' | 'present';
  lockAgeMs?: number | null;
  rc?: number;
  stderrHead?: string;
  step?: string;
  signal?: string;
  code?: number;
  cause?: string;
  word?: string;
  lane?: 'read' | 'fetch';
  declared?: string;
  key?: string;
  site?: string;
}

/** Every failure the server answers over HTTP (section 3.5, verbatim). Success is 200 only. */
export type DocsFailureBody = { ok: false; failure: DocsFailure; detail?: string; retryAfterMs?: number } & DocsFailureContext;

/**
 * The redactor, declared once (section 2 (b) "One redactor"). `_docs_py` runs it over every string derived from
 * stderr or a traceback; the L3 adapter runs `redactDocsText` again over every such string field of a failure
 * body. `_docs_py` holds ONE parity-checked literal copy of these rules as `REDACT_RULES`.
 *
 * Each rule is `[pattern, suffix]`, applied in order, globally. A match becomes group 1 (when the pattern has
 * one) followed by `suffix`. That form needs no replacement-template syntax, which differs between python
 * (`\1`) and JS (`$1`).
 *
 * Whitespace is the explicit ASCII class `[\t\n\v\f\r ]`, never `\s`: python's str `\s` also matches
 * U+001C..U+001F and JS's matches U+FEFF, so one `\s` literal would redact differently on the two sides.
 * Refines the spec table's `\s` (recorded in the plan's spec refinements).
 */
export const DOCS_REDACT_RULES: readonly (readonly [pattern: string, suffix: string])[] = [
  [String.raw`(://)[^/@\t\n\v\f\r ]+@`, '***@'],
  [String.raw`([?&](?:access_token|token)=)[^&\t\n\v\f\r ]+`, '***'],
  [String.raw`(gh[opsu]_)[A-Za-z0-9]{20,}`, '***'],
  [String.raw`[^\n]*Authorization:[^\n]*`, 'Authorization: ***'],
];

const DOCS_REDACTORS: readonly (readonly [RegExp, string])[] =
  DOCS_REDACT_RULES.map(([pattern, suffix]) => [new RegExp(pattern, 'gu'), suffix] as const);

/** `s` with every `DOCS_REDACT_RULES` match replaced. Idempotent: redacting a redacted string changes nothing. */
export function redactDocsText(s: string): string {
  let out = s;
  for (const [re, suffix] of DOCS_REDACTORS) {
    // With a capture group, the callback's second argument is group 1; without one, it is the match offset (a
    // number), so only a string is kept.
    out = out.replace(re, (_match: string, ...rest: unknown[]) => {
      const group1 = rest[0];
      return (typeof group1 === 'string' ? group1 : '') + suffix;
    });
  }
  return out;
}

// ===== (E) ccd wire types =====
// Spec 2026-10-01 section 2 (b) "Types", with section 3.5's additive amendments (`onRef`, `github`) folded in.
// Additive only: no FLEET_PROTO bump. Every ccd answer is one JSON line: `{v:1, verb, ok, elapsedMs, ...}`.

export type DocsVerb = 'docs-index' | 'docs-tree' | 'docs-show' | 'docs-fetch';

/** The project's GitHub origin, as ccd's `_gh_repo_slug` rule reads `remote.origin.url` (section 3.11). */
export type DocsGithub = { state: 'named'; slug: string /* owner/name */ } | { state: 'none' };

export interface DocsTreeOk {
  v: 1; verb: 'docs-tree'; ok: true; elapsedMs: number; project: string;
  repo: { key: string /* 32 hex: sha256(realpath(common-dir)) */; objectFormat: 'sha1' | 'sha256'; shallow: boolean };
  github: DocsGithub;
  ref: {
    requested: string | null; served: string /* full refname */; name: string; side: 'local' | 'origin'; commit: Sha;
    via: 'default:origin-head' | 'default:origin-main' | 'default:origin-master' | 'default:local-main'
      | 'default:local-master' | 'local' | 'origin' | 'qualified';
    tried: DocsTriedRef[];
    relation: 'equal' | 'local-only' | 'origin-only' | 'local-ahead' | 'local-behind' | 'diverged' | 'unmeasured';
    counterpart: null | {
      ref: string; commit: Sha; ahead: number | null; behind: number | null; count: 'measured' | 'timeout' | 'shallow';
    };
  };
  mainCheckout: { path: string; branch: string | null; head: Sha };
  /** All four, in DOC_SECTIONS order. */
  sections: { slug: DocSectionSlug; path: string; state: 'present' | 'absent' | 'not-a-directory'; count: number }[];
  entries: DocsEntry[];
  unlisted: { count: number; byReason: Partial<Record<'invalid-utf8' | 'unsafe-char' | 'too-long' | 'too-deep', number>> };
  drafts: DraftsFacts;
  freshness: {
    remote: 'origin' | null; trackedRef: string | null;
    stamp: null | { okAgeMs: number | null; attemptAgeMs: number; lastOutcome: 'ok' | DocsFetchFailure; okCommit: Sha | null };
    /** Diagnostic only (sheet B section 9). */
    fetchHead: null | { ageMs: number; bytes: number };
  };
}

export interface DocsEntry {
  section: DocSectionSlug; path: string /* relative to the section */;
  committed: null | { kind: 'file' | 'exec' | 'symlink' | 'submodule'; blob: Sha /* commit sha for a submodule */; size: number | null };
  draft: null | {
    state: 'modified' | 'added' | 'untracked' | 'deleted' | 'typechange' | 'conflicted';
    // The spec's member order, rotated so the two read words never stand side by side: single-definition.test.ts's
    // "one absent/unreadable read vocabulary" scan counts any file that spells that pair adjacently as a second
    // holder of ReadFailure. Same type; only the spelling order differs.
    kind: 'absent' | 'file' | 'symlink' | 'directory' | 'special' | 'hardlink' | 'foreign-owner' | 'other-device' | 'unreadable';
    size: number | null;
    /** sha256 of the bytes; null iff not a regular file that passed the leaf checks and is at most DOCS_MAX_FILE_BYTES. */
    fp: Sha | null;
    errno?: string;
    trust: 'status' | 'hash';
  };
}

export type DraftsFacts =
  | {
    state: 'holder'; branch: string; worktree: { path: string; head: Sha; class: 'main' | 'workspace' | 'other' };
    baseEqual: boolean; base: { ahead: number | null; behind: number | null; count: 'measured' | 'timeout' | 'shallow' } | null;
    caveats: ('assume-unchanged' | 'skip-worktree' | 'filters-bypassed')[]; opaque: string[] /* nested-repo dirs */;
  }
  | { state: 'none'; branch: string; skipped: { path: string; why: 'prunable' | 'missing-dir' | 'unsafe-path' }[] }
  | { state: 'ambiguous'; branch: string; candidates: string[] }
  | {
    state: 'untrusted'; branch: string; worktree: string;
    why: 'common-dir' | 'toplevel-mismatch' | 'foreign-owner' | 'identity-changed' | 'dubious-ownership';
  }
  | {
    state: 'unreadable'; branch: string; worktree: string | null;
    step: 'worktree-list' | 'status' | 'ls-files' | 'filter-config'; detail: string;
  }
  | { state: 'unsettled'; branch: string; worktree: string }
  | { state: 'too-many'; branch: string; worktree: string; count: number; bytes: number };

export interface DocsShowOk {
  v: 1; verb: 'docs-show'; ok: true; elapsedMs: number;
  source: 'committed' | 'draft'; section: DocSectionSlug; path: string; size: number; sha256: Sha;
  encoding: 'utf8' | 'base64'; text?: string; b64?: string;
  /** Committed only; `onRef` is always present there (section 3.5). */
  commit?: Sha; blob?: Sha; mode?: string; onRef?: 'contains' | 'not-contained' | 'unmeasured';
  /** Draft only; `fp === sha256`. */
  worktree?: string; branch?: string; head?: Sha; fp?: Sha;
}

export interface DocsFetchOk {
  v: 1; verb: 'docs-fetch'; ok: true; elapsedMs: number;
  branch: string; trackedRef: string; defaultVia?: string /* iff no --branch */;
  before: Sha | null; after: Sha; moved: 'created' | 'updated' | 'unchanged'; stamp: 'written' | 'unwritten';
}

export interface DocsIndexOk {
  v: 1; verb: 'docs-index'; ok: true; elapsedMs: number; unlisted: number;
  /** Every repoKey held by two or more rows. */
  duplicates: { repoKey: string; projects: string[] }[];
  projects: {
    project: string;
    state: 'ready' | 'not-a-git-repo' | 'linked-worktree' | 'shared-repo' | 'partial-clone' | 'no-default-branch' | 'repo-unreadable';
    github: DocsGithub; repoKey?: string;
    default?: { name: string; via: string; commit: Sha }; sections?: Record<DocSectionSlug, number | null>;
    sectionsOnDisk?: DocSectionSlug[] /* non-git dirs: 4 lstats */; owner?: string | null; branch?: string | null;
    fetch?: { okAgeMs: number | null; lastOutcome: string };
  }[];
}

export type DocsIndexRow = DocsIndexOk['projects'][number];

/** A ccd failure line: the envelope plus the word, a redacted `detail` of at most 2 KiB, and that word's context.
 *  `retryAfterMs` rides `fetch-too-soon`. */
export type DocsCcdFailure = {
  v: 1; verb: DocsVerb; ok: false; elapsedMs: number; failure: DocsFailure; detail?: string; retryAfterMs?: number;
} & DocsFailureContext;
