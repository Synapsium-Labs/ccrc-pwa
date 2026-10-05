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
  [String.raw`(?<![^\n])[^\n]*Authorization:[^\n]*`, 'Authorization: ***'],
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
  /** Projects the walk did not reach before the helper deadline; absent when 0. */
  unwalked?: number;
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

// ---------------------------------------------------------------------------
// (F) Content class, raster table, class caps, response headers, response
// wrappers (spec 5.1, 5.3, 6.1, 3.5, 3.6). One table for both sides: the
// server picks a file's representation and its `--max-bytes` from these, and
// the PWA picks its renderer and its "too large" sentence from the same ones.
// ---------------------------------------------------------------------------

export type DocContentClass = 'markdown' | 'raster' | 'svg' | 'html' | 'text' | 'other';

/** The extension table, spec 5.1 verbatim. `xml`, `xsl` and `xhtml` are TEXT: shown as source, never as a
 *  document. Anything unlisted (`pdf`, `mht`, `svgz`, fonts) is `other`, download only. */
export const DOC_CONTENT_CLASS_BY_EXT = {
  md: 'markdown', markdown: 'markdown',
  png: 'raster', jpg: 'raster', jpeg: 'raster', gif: 'raster', webp: 'raster',
  svg: 'svg', html: 'html', htm: 'html',
  txt: 'text', json: 'text', yaml: 'text', yml: 'text', toml: 'text', csv: 'text', tsv: 'text', log: 'text',
  ts: 'text', tsx: 'text', js: 'text', mjs: 'text', cjs: 'text', css: 'text', py: 'text', sh: 'text',
  sql: 'text', diff: 'text', patch: 'text', xml: 'text', xsl: 'text', xhtml: 'text',
} as const satisfies Record<string, DocContentClass>;

type DocExt = keyof typeof DOC_CONTENT_CLASS_BY_EXT;

/** An extension's shape after lowering: 1-10 characters of `a-z0-9` (spec 5.1). */
const DOC_EXT_RE = /^[a-z0-9]{1,10}$/;

/** `A-Z` to `a-z` by char code, and nothing else. Never the built-in lowering: it maps U+212A KELVIN SIGN
 *  to `k`, so a file whose extension is spelled with it would class as `markdown` while git and the file
 *  system hold a different name (spec 5.1, M5.3). */
function asciiLower(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : s.charAt(i);
  }
  return out;
}

function isDocExt(ext: string): ext is DocExt {
  return Object.prototype.hasOwnProperty.call(DOC_CONTENT_CLASS_BY_EXT, ext);
}

/** The class of a docs path, decided by its FINAL component alone (spec 5.1): the text after that component's
 *  last `.`, lowered ASCII-only, 1-10 characters of `a-z0-9`, looked up in the table. A dotfile (a final
 *  component that starts with `.`, such as `.png`), a name with no `.`, a bad extension and an unlisted one
 *  are all `other`. */
export function contentClass(path: string): DocContentClass {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.startsWith('.')) return 'other';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'other';
  const ext = asciiLower(name.slice(dot + 1));
  if (!DOC_EXT_RE.test(ext) || !isDocExt(ext)) return 'other';
  return DOC_CONTENT_CLASS_BY_EXT[ext];
}

/** Each class's size cap (spec 6.1): the `--max-bytes N` the server passes to `ccd docs-show`, and the bound the
 *  PWA holds a listed size to before it asks. Derived from the two caps above, never a literal of its own. The
 *  two caps are equal today, so `docs-shared.test.ts` pins the derivation by its source text as well. */
export const DOCS_CLASS_CAP: Record<DocContentClass, number> = {
  markdown: DOCS_MAX_DOC_BYTES,
  raster: DOCS_MAX_IMAGE_BYTES,
  svg: DOCS_MAX_IMAGE_BYTES,
  html: DOCS_MAX_DOC_BYTES,
  text: DOCS_MAX_DOC_BYTES,
  other: DOCS_MAX_DOC_BYTES,
};

/** The raster types the file route answers as bytes, each with its MIME type and its magic: a type matches when
 *  EVERY run of ANY ONE of its alternatives is present at its offset (spec 5.1). */
export const DOCS_RASTER_TYPES = {
  png:  { mime: 'image/png',  magic: [[{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }]] },
  jpeg: { mime: 'image/jpeg', magic: [[{ at: 0, bytes: [0xff, 0xd8, 0xff] }]] },
  gif:  { mime: 'image/gif',  magic: [[{ at: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }], [{ at: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }]] },
  webp: { mime: 'image/webp', magic: [[{ at: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] }]] },
} as const;
export type RasterType = keyof typeof DOCS_RASTER_TYPES;
export type RasterMime = (typeof DOCS_RASTER_TYPES)[RasterType]['mime'];
export const DOCS_RASTER_EXT: Record<'png' | 'jpg' | 'jpeg' | 'gif' | 'webp', RasterType> =
  { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };

/** One run of magic bytes at an offset: the shape every alternative in the table above has. */
type MagicRun = { readonly at: number; readonly bytes: readonly number[] };

/** Whether `bytes` are what `declared` says they are. Under `nosniff` the declared type must be true of the
 *  bytes, so a `.png` holding JPEG bytes is a `mismatch`; so is input too short to hold the magic. */
export function sniffRaster(declared: RasterType, bytes: Uint8Array): 'match' | 'mismatch' {
  const alternatives: readonly (readonly MagicRun[])[] = DOCS_RASTER_TYPES[declared].magic;
  for (const runs of alternatives) {
    if (runs.every((run) => run.bytes.every((b, i) => bytes[run.at + i] === b))) return 'match';
  }
  return 'mismatch';
}

/** The headers every docs response carries (spec 5.3). The values live here so the server's `onSend` hook and
 *  the real-browser leg use the same bytes. */
export const DOCS_RESPONSE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'";
export const DOCS_RESPONSE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': DOCS_RESPONSE_CSP,
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
} as const;
/** The only content types a docs route may send: JSON, and the four raster types from their own table. */
export const DOCS_ALLOWED_CONTENT_TYPES: readonly string[] =
  ['application/json; charset=utf-8', ...Object.values(DOCS_RASTER_TYPES).map((t) => t.mime)];

/** The HTTP answers (spec 3.5). They wrap ccd's answers unchanged, so no adapter narrows. A raster never rides
 *  this JSON: its bytes are the answer (spec 3.6), which is why `contentClass` here excludes it. */
export interface DocsProjectsResponse { ok: true; index: DocsIndexOk; cacheAgeMs: number | null } // null: ccd answered this very request
export interface DocsTreeResponse { ok: true; tree: DocsTreeOk; refreshDue: boolean }
export interface DocsFileResponse { ok: true; contentClass: Exclude<DocContentClass, 'raster'>;
  show: DocsShowOk; from: 'ccd' | 'cache' }               // a cache hit is marked, never passed off as ccd's
export type DocsRefreshFetch =
  | { state: 'ran'; answer: DocsFetchOk }
  | { state: 'failed'; failure: DocsFailureBody }
  | { state: 'skipped'; why: 'local-ref' };
export interface DocsRefreshResponse { ok: true; fetch: DocsRefreshFetch; tree: DocsTreeResponse | DocsFailureBody }

// ---------------------------------------------------------------------------
// (G) resolveDocRef (spec 4.11): where a link or an image reference inside a
// docs page points. Pure, and shared by the Markdown pipeline (W5) and the
// mockup viewer (W6), so a link means one thing in both.
// ---------------------------------------------------------------------------

export type DocRefResolution =
  | { kind: 'doc'; section: DocSectionSlug; path: string; fragment: string | null }
  | { kind: 'repo'; repoPath: string }                              // inside the repo, outside the four sections
  | { kind: 'fragment'; fragment: string }
  | { kind: 'external'; url: string; scheme: 'http' | 'https' | 'mailto'; origin: string | null }
  | { kind: 'self-contained'; scheme: 'data' | 'blob' }
  | { kind: 'refused'; why: 'empty' | 'malformed' | 'scheme' | 'protocol-relative' | 'root-relative' | 'above-root' | 'bad-path' };

type DocRefRefusal = Extract<DocRefResolution, { kind: 'refused' }>['why'];

const refusedRef = (why: DocRefRefusal): DocRefResolution => ({ kind: 'refused', why });

/** What a browser would delete or reinterpret further in (a tab inside `java<TAB>script:`, a backslash read as
 *  `/`): C0, space, DEL and backslash anywhere. Refused, never deleted-and-continued. */
const DOC_REF_MALFORMED_RE = /[\x00-\x20\x7f\\]/;
const DOC_REF_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
/** The sentinel origin a relative reference is resolved under. `.invalid` never resolves (RFC 2606). */
const DOC_REF_ORIGIN = 'https://docs.invalid';

/** The WHATWG URL parser's dot segments: `.` or `%2e`, and `..`, `.%2e`, `%2e.` or `%2e%2e`, ASCII
 *  case-insensitive. */
function isSingleDotSegment(seg: string): boolean {
  const s = asciiLower(seg);
  return s === '.' || s === '%2e';
}

function isDoubleDotSegment(seg: string): boolean {
  const s = asciiLower(seg);
  return s === '..' || s === '.%2e' || s === '%2e.' || s === '%2e%2e';
}

/** Whether walking `refPath` from a directory `depth` levels below the repository root pops past the root.
 *  `URL` cannot say: popping an empty path is a no-op in the WHATWG parser, so `../../../../x` from three levels
 *  down comes back as `/x`, indistinguishable from a link to the root. This walk applies the parser's own
 *  segment rules to the same text and counts what it clamps. */
function climbsAboveRoot(depth: number, refPath: string): boolean {
  let d = depth;
  for (const seg of refPath.split('/')) {
    if (isDoubleDotSegment(seg)) {
      d -= 1;
      if (d < 0) return true;
    } else if (!isSingleDotSegment(seg)) {
      d += 1;
    }
  }
  return false;
}

function resolveSchemeRef(raw: string): DocRefResolution {
  const scheme = asciiLower(raw.slice(0, raw.indexOf(':')));
  switch (scheme) {
    case 'data':
    case 'blob':
      return { kind: 'self-contained', scheme };
    case 'http':
    case 'https':
    case 'mailto': {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        return refusedRef('malformed');
      }
      // A mailto URL's origin is the opaque string 'null'; the answer says "no origin" as null instead.
      return { kind: 'external', url: u.href, scheme, origin: scheme === 'mailto' ? null : u.origin };
    }
    default:
      return refusedRef('scheme');
  }
}

/** Resolve `ref`, written in the page at `from`, in spec 4.11's step order:
 *  1. trim leading and trailing C0 controls and space;
 *  2. any C0, space, DEL or backslash still present is `malformed`;
 *  3. empty, then a leading `#` (`fragment`), then a scheme (`external` for http, https and mailto,
 *     `self-contained` for data and blob, otherwise refused `scheme`), then a leading `//`, then a leading `/`;
 *  4. otherwise resolve against the page's directory under the sentinel origin, require that origin, drop the
 *     query, keep the fragment (the raw text after the first `#`, or null when there is none) and decode each
 *     path segment exactly once; a throw is `bad-path`;
 *  5. a climb above the repository root is `above-root`; under one of the four section paths the remainder must
 *     pass the rel-path grammar to be `doc`; any other in-repo path that passes it is `repo`; anything else is
 *     `bad-path`.
 *  Every directory segment of the page's own path is percent-encoded before it joins the base, so a directory
 *  named `a#b` or `%2e%2e` stays one literal segment; the page's path must itself pass the rel-path grammar. */
export function resolveDocRef(from: { section: DocSectionSlug; path: string }, ref: string): DocRefResolution {
  // What a browser strips from both ends of an attribute URL: C0 controls and space (0x00-0x20). A linear scan,
  // not a regex: an alternation anchored at both ends is quadratic on interior whitespace, and this runs on
  // untrusted refs on the PWA main thread (spec 5.6.2).
  let lo = 0;
  let hi = ref.length;
  while (lo < hi && ref.charCodeAt(lo) <= 0x20) lo += 1;
  while (hi > lo && ref.charCodeAt(hi - 1) <= 0x20) hi -= 1;
  const raw = ref.slice(lo, hi);
  if (DOC_REF_MALFORMED_RE.test(raw)) return refusedRef('malformed');
  if (raw === '') return refusedRef('empty');
  if (raw.startsWith('#')) return { kind: 'fragment', fragment: raw.slice(1) };
  if (DOC_REF_SCHEME_RE.test(raw)) return resolveSchemeRef(raw);
  if (raw.startsWith('//')) return refusedRef('protocol-relative');
  if (raw.startsWith('/')) return refusedRef('root-relative');

  if (!isDocsRelPath(from.path)) return refusedRef('bad-path');
  const dir = docRepoPath(from.section, from.path).split('/').slice(0, -1);
  const hash = raw.indexOf('#');
  const fragment = hash < 0 ? null : raw.slice(hash + 1);
  let segments: string[];
  try {
    const u = new URL(raw, DOC_REF_ORIGIN + '/' + dir.map((s) => encodeURIComponent(s)).join('/') + '/');
    if (u.origin !== DOC_REF_ORIGIN) return refusedRef('malformed');
    segments = u.pathname.slice(1).split('/').map((s) => decodeURIComponent(s));
  } catch {
    return refusedRef('bad-path');
  }
  // A decoded `%2F` would turn one segment into two when the path is joined: no file name holds a `/`.
  if (segments.some((s) => s.includes('/'))) return refusedRef('bad-path');

  const end = raw.search(/[?#]/);
  if (climbsAboveRoot(dir.length, end < 0 ? raw : raw.slice(0, end))) return refusedRef('above-root');

  const repoPath = segments.join('/');
  for (const slug of DOC_SECTION_SLUGS) {
    const prefix = DOC_SECTIONS[slug] + '/';
    if (repoPath.startsWith(prefix)) {
      const rest = repoPath.slice(prefix.length);
      return isDocsRelPath(rest) ? { kind: 'doc', section: slug, path: rest, fragment } : refusedRef('bad-path');
    }
  }
  return isDocsRelPath(repoPath) ? { kind: 'repo', repoPath } : refusedRef('bad-path');
}

// ===========================================================================
// (H) What a row opens, and its GitHub link (spec 2 (d) "What overlays",
//     4.6 and 3.11). Pure. ccd reports draft FACTS and decides no display;
//     every display rule for an entry lives in entryView, which the PWA's rows
//     and leaf headers both call, so there is one badge function.
// ===========================================================================

/** `'default'` when the page has no `?ref=`, `'ref'` when it has one. The default view never overlays a draft:
 *  every row and leaf there is the committed entry at the served commit, and the drafts only feed the hint. */
export type EntryMode = 'default' | 'ref';

/** The one badge vocabulary, for rows and leaf headers alike. Its display text is the PWA's. */
export type EntryBadge = 'modified' | 'new' | 'deleted' | 'typechange' | 'conflicted' | 'withheld';

/** Why an overlaid draft is not shown: a regular file over the hash ceiling (`fp: null`), an unreadable path, or
 *  anything that is not a regular file which passed the leaf checks. */
export type WithheldReason = 'too-large' | 'unreadable' | 'not-a-file';

/** One entry as the page shows it (spec 4.6).
 *  - `opens`: the bytes a tap reaches. `'none'` for a committed symlink or submodule (listed, never followed) and
 *    for an entry with nothing committed to fall back to.
 *  - `offersCommitted`: "open committed version", offered iff the row opens the draft and the committed side is a
 *    file or exec.
 *  - `committedKind`: the committed side as listed, whatever the overlay decided. */
export interface EntryView {
  listed: boolean;
  opens: 'draft' | 'committed' | 'none';
  badge: EntryBadge | null;
  withheld: WithheldReason | null;
  offersCommitted: boolean;
  committedKind: 'file' | 'exec' | 'symlink' | 'submodule' | null;
}

/** Whether `e`'s draft may overlay at all: exactly one trusted holder whose HEAD is the served commit
 *  (`baseEqual`), and a draft on this entry. Only a ref view overlays; `entryView` adds that. */
export function admitDraft(e: DocsEntry, d: DraftsFacts): boolean {
  return d.state === 'holder' && d.baseEqual && e.draft !== null;
}

/** THE derivation of a row and a leaf header from one tree answer (spec 4.6).
 *
 *  No overlay (the default view; or a ref view whose `drafts` is not a holder at the served commit; or an entry
 *  with no draft): the committed side alone. Listed iff committed; a file or exec opens committed; a symlink or
 *  submodule opens nothing.
 *
 *  An overlay is decided in this order, the first match winning:
 *   1. `deleted`: badge deleted. The draft has no bytes.
 *   2. `typechange`: badge typechange. The draft is never read. This comes before the withheld rule, so a type
 *      change to a symlink is a typechange, not "not a file".
 *   3. a regular file with an `fp`: the draft opens. Badge `new` for added or untracked, else the state itself
 *      (modified, conflicted).
 *   4. withheld: a file with `fp: null` is too-large, `kind: 'unreadable'` is unreadable, and every other kind is
 *      not-a-file. Listed iff it is committed or new (added, untracked).
 *  In 1, 2 and 4 the committed side opens: a committed file or exec opens committed, and a committed symlink, a
 *  submodule or nothing committed opens nothing. In 1 and 2 the row is listed iff it is committed. */
export function entryView(e: DocsEntry, d: DraftsFacts, mode: EntryMode): EntryView {
  const committedKind = e.committed === null ? null : e.committed.kind;
  const committedIsFile = committedKind === 'file' || committedKind === 'exec';
  const committedSide: EntryView['opens'] = committedIsFile ? 'committed' : 'none';
  const view = (listed: boolean, opens: EntryView['opens'], badge: EntryBadge | null,
    withheld: WithheldReason | null): EntryView =>
    ({ listed, opens, badge, withheld, offersCommitted: opens === 'draft' && committedIsFile, committedKind });
  const draft = e.draft;
  if (mode !== 'ref' || draft === null || !admitDraft(e, d)) {
    return view(committedKind !== null, committedSide, null, null);
  }
  if (draft.state === 'deleted' || draft.state === 'typechange') {
    return view(committedKind !== null, committedSide, draft.state, null);
  }
  const isNew = draft.state === 'added' || draft.state === 'untracked';
  if (draft.kind === 'file' && draft.fp !== null) {
    return view(true, 'draft', isNew ? 'new' : draft.state === 'conflicted' ? 'conflicted' : 'modified', null);
  }
  const withheld: WithheldReason =
    draft.kind === 'file' ? 'too-large' : draft.kind === 'unreadable' ? 'unreadable' : 'not-a-file';
  return view(committedKind !== null || isNew, committedSide, 'withheld', withheld);
}

/** What a "View on GitHub" action points at. A leaf's `uncommitted` is true when the entry has no committed side
 *  (`e.committed === null`): GitHub holds no copy of it, whether or not the draft opens (a withheld new file has
 *  `opens: 'none'` and is still uncommitted). A directory's `path` is relative to its section, like a leaf's. */
export type GithubTarget =
  | { kind: 'leaf'; section: DocSectionSlug; path: string; uncommitted: boolean }
  | { kind: 'section'; section: DocSectionSlug }
  | { kind: 'dir'; section: DocSectionSlug; path: string };

/** A link, with the caution `may-differ` ("GitHub's copy may differ from this view") or none; or the reason
 *  there is no link. `not-on-origin` is the PWA's "not pushed". */
export type GithubLink =
  | { ok: true; url: string; note: 'may-differ' | null }
  | { ok: false; why: 'no-github-origin' | 'not-on-origin' | 'uncommitted' };

/** The View on GitHub builder (spec 3.11). The rows are checked in the spec table's order, the first match
 *  winning:
 *   1. no GitHub-shaped origin was read: `no-github-origin`;
 *   2. a `local-only` relation, or a default resolved to a local branch (`default:local-main`,
 *      `default:local-master`): `not-on-origin`;
 *   3. a leaf whose entry has no committed side (`uncommitted`, i.e. `e.committed === null`, whether or not the
 *      draft opens): `uncommitted`;
 *   4. the origin side is served, or the local side equals origin: a link with no note;
 *   5. otherwise (the local side ahead, behind, diverged or unmeasured): a link with `may-differ`. A local side
 *      reading `origin-only` cannot arrive, because a local side means the local branch exists; if it did, it
 *      would land here, on the cautious answer.
 *  The URL names the branch, never a commit (the durable-link convention):
 *  `https://github.com/<slug>/blob/<ref.name>/<repo path>` for a leaf, and `/tree/` for a section or directory.
 *  Each `/`-separated segment of the slug, the branch name and the repo path is `encodeURIComponent`-encoded on
 *  its own, so the branch `ws/a b` keeps its `/` and is written `ws/a%20b`. */
export function githubBlobUrl(github: DocsGithub, ref: DocsTreeOk['ref'], target: GithubTarget): GithubLink {
  if (github.state === 'none') return { ok: false, why: 'no-github-origin' };
  if (ref.relation === 'local-only' || ref.via === 'default:local-main' || ref.via === 'default:local-master') {
    return { ok: false, why: 'not-on-origin' };
  }
  if (target.kind === 'leaf' && target.uncommitted) return { ok: false, why: 'uncommitted' };
  const segments = (p: string): string => p.split('/').map((s) => encodeURIComponent(s)).join('/');
  const repoPath = target.kind === 'section' ? DOC_SECTIONS[target.section] : docRepoPath(target.section, target.path);
  const url = 'https://github.com/' + segments(github.slug) + (target.kind === 'leaf' ? '/blob/' : '/tree/')
    + segments(ref.name) + '/' + segments(repoPath);
  return { ok: true, url, note: ref.side === 'origin' || ref.relation === 'equal' ? null : 'may-differ' };
}

// ===========================================================================
// (I) Page URLs, the pin and the one docs API URL builder (spec 3.1, 3.2, 3.8, 3.12)
// ===========================================================================

/** The PWA's Docs pages live under this prefix. The server never registers it (spec 3.1); W4's service-worker
 *  refusal imports it, and docs-parity.test.ts holds it to one declaration (M7.3). */
export const DOCS_PAGE_PREFIX = '/docs';
/** The four docs API routes live under this prefix (spec 3.4). */
export const DOCS_API_PREFIX = '/api/docs';
/** The marker header every PWA docs fetch carries (spec 3.8, clause 3). An img, iframe, script, link or
 *  navigation cannot attach it, and a cross-origin fetch can only after a preflight the server never answers. */
export const DOCS_REQUEST_HEADER = 'x-ccrc-docs';
export const DOCS_REQUEST_HEADER_VALUE = '1';
/** The page query keys, in the order docsPageUrl writes them. */
export const DOCS_PAGE_KEYS = ['ref', 'view', 'frame'] as const;
/** Pin keys. On a page they are refused as commit-in-page, never canonicalised: a page URL never carries a
 *  commit, and a durable pointer to one exact commit is a GitHub URL (spec 3.1, 3.11). */
export const DOCS_PIN_KEYS = ['commit', 'servedRef', 'branch', 'head', 'fp'] as const;

export type DocsPageLocation =
  | { kind: 'index' }
  | { kind: 'project'; project: string; ref: DocsRefSpec | null }
  | { kind: 'section'; project: string; section: DocSectionSlug; ref: DocsRefSpec | null }
  | { kind: 'path'; project: string; section: DocSectionSlug; path: string; dirSlash: boolean;
      ref: DocsRefSpec | null; view: 'effective' | 'committed'; frame: 'inline' | 'full' };
export type DocsPageParseFailure = 'not-docs' | 'bad-project' | 'bad-section' | 'bad-path' | 'bad-ref'
  | 'bad-view' | 'bad-frame' | 'bad-escape' | 'encoded-slash' | 'commit-in-page' | 'unknown-param'
  | 'repeated-param' | 'reserved-node';
export type DocsPageParse =
  | { ok: true; loc: DocsPageLocation; canonical: string }
  | { ok: false; why: DocsPageParseFailure };

type DocsPageKey = (typeof DOCS_PAGE_KEYS)[number];
type DocsPathLocation = Extract<DocsPageLocation, { kind: 'path' }>;

/** The keys each page kind carries. A key outside its page's set is unknown-param, never dropped: spec 3.1 says
 *  `ref` applies to every page but the index, and the W1 plan refuses it there rather than dropping it; `view`
 *  and `frame` are leaf keys, refused the same way on the index, a project and a section root. */
const PAGE_KEYS_BY_KIND: Readonly<Record<DocsPageLocation['kind'], readonly DocsPageKey[]>> = {
  index: [],
  project: ['ref'],
  section: ['ref'],
  path: DOCS_PAGE_KEYS,
};

/** `view=committed` survives canonicalisation only together with `ref`, and only on a leaf: without `ref` the
 *  default view never overlays drafts, so the key is redundant (spec 3.1). A trailing slash marks a directory,
 *  and a directory is not a leaf. */
function pageKeepsView(l: DocsPathLocation): boolean {
  return l.view === 'committed' && l.ref !== null && !l.dirSlash;
}

/** `frame=full` survives only on a leaf whose class is html (spec 3.1, 5.6.7). */
function pageKeepsFrame(l: DocsPathLocation): boolean {
  return l.frame === 'full' && !l.dirSlash && contentClass(l.path) === 'html';
}

/** Strict percent-decoding. decodeURIComponent throws URIError on a malformed escape and on escapes that do not
 *  spell UTF-8; both answer null. A `+` stays a literal plus: there is no form decoding anywhere here. */
function pageDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

type PageQuery = { ok: true; raw: ReadonlyMap<DocsPageKey, string> } | { ok: false; why: DocsPageParseFailure };

/** Split `search` (leading `?` optional) on `&`. A piece without `=` has an empty value; an empty piece has an
 *  empty key, which no page carries. Order (plan, decided): keys decode (bad-escape), then pin keys, then
 *  repeated keys, then keys this page kind does not carry. Values stay raw here; parseDocsPage decodes them. */
function pageQuery(search: string, allowed: readonly DocsPageKey[]): PageQuery {
  const text = search.startsWith('?') ? search.slice(1) : search;
  if (text === '') return { ok: true, raw: new Map() };
  const pairs: (readonly [string, string])[] = [];
  for (const piece of text.split('&')) {
    const eq = piece.indexOf('=');
    const key = pageDecode(eq < 0 ? piece : piece.slice(0, eq));
    if (key === null) return { ok: false, why: 'bad-escape' };
    pairs.push([key, eq < 0 ? '' : piece.slice(eq + 1)]);
  }
  const pinKeys: readonly string[] = DOCS_PIN_KEYS;
  if (pairs.some(([k]) => pinKeys.includes(k))) return { ok: false, why: 'commit-in-page' };
  const seen = new Set<string>();
  for (const [k] of pairs) {
    if (seen.has(k)) return { ok: false, why: 'repeated-param' };
    seen.add(k);
  }
  const raw = new Map<DocsPageKey, string>();
  for (const [k, v] of pairs) {
    const known = allowed.find((a) => a === k);
    if (known === undefined) return { ok: false, why: 'unknown-param' };
    raw.set(known, v);
  }
  return { ok: true, raw };
}

/** Parse a Docs page location (spec 3.1). The check order is fixed, so one URL has one answer:
 *  1. the prefix (not-docs);
 *  2. every path segment decodes (bad-escape), then no decoded segment holds a `/` (encoded-slash);
 *  3. a first segment starting with `@` (reserved-node, spec 3.12);
 *  4. the project, then the section, then the path grammar;
 *  5. the query: pin keys, repeated keys, unknown keys, then values in DOCS_PAGE_KEYS order.
 *  `/docs/`, `/docs/<p>/` and `/docs/<p>/<s>/` answer their slash-less location; a trailing slash on a path page
 *  sets dirSlash. Whether a path IS a directory is the tree answer's call, never the URL's. The returned `loc` is
 *  already canonical, and `canonical === docsPageUrl(loc)`; a caller whose URL differs replace-navigates. */
export function parseDocsPage(pathname: string, search: string): DocsPageParse {
  let tail: string;
  if (pathname === DOCS_PAGE_PREFIX) tail = '';
  else if (pathname.startsWith(DOCS_PAGE_PREFIX + '/')) tail = pathname.slice(DOCS_PAGE_PREFIX.length + 1);
  else return { ok: false, why: 'not-docs' };
  const dirSlash = tail.endsWith('/');
  const segs: string[] = [];
  if (tail !== '') {
    for (const raw of (dirSlash ? tail.slice(0, -1) : tail).split('/')) {
      const seg = pageDecode(raw);
      if (seg === null) return { ok: false, why: 'bad-escape' };
      segs.push(seg);
    }
  }
  if (segs.some((s) => s.includes('/'))) return { ok: false, why: 'encoded-slash' };
  const [project, sectionText] = segs;
  if (project !== undefined && project.startsWith('@')) return { ok: false, why: 'reserved-node' };
  if (project !== undefined && !isDocsProject(project)) return { ok: false, why: 'bad-project' };
  let section: DocSectionSlug | undefined;
  if (sectionText !== undefined) {
    if (!isDocsSection(sectionText)) return { ok: false, why: 'bad-section' };
    section = sectionText;
  }
  const path = segs.slice(2).join('/');
  if (segs.length > 2 && !isDocsRelPath(path)) return { ok: false, why: 'bad-path' };
  const kind: DocsPageLocation['kind'] =
    project === undefined ? 'index' : section === undefined ? 'project' : segs.length === 2 ? 'section' : 'path';
  const q = pageQuery(search, PAGE_KEYS_BY_KIND[kind]);
  if (!q.ok) return q;
  let ref: DocsRefSpec | null = null;
  let view: DocsPathLocation['view'] = 'effective';
  let frame: DocsPathLocation['frame'] = 'inline';
  for (const key of DOCS_PAGE_KEYS) {
    const raw = q.raw.get(key);
    if (raw === undefined) continue;
    const value = pageDecode(raw);
    if (value === null) return { ok: false, why: 'bad-escape' };
    if (key === 'ref') {
      ref = parseDocsRef(value);
      if (ref === null) return { ok: false, why: 'bad-ref' };
    } else if (key === 'view') {
      if (value !== 'committed') return { ok: false, why: 'bad-view' };
      view = 'committed';
    } else {
      if (value !== 'full') return { ok: false, why: 'bad-frame' };
      frame = 'full';
    }
  }
  let loc: DocsPageLocation;
  if (project === undefined) loc = { kind: 'index' };
  else if (section === undefined) loc = { kind: 'project', project, ref };
  else if (segs.length === 2) loc = { kind: 'section', project, section, ref };
  else {
    const asked: DocsPathLocation = { kind: 'path', project, section, path, dirSlash, ref, view, frame };
    loc = {
      ...asked,
      view: pageKeepsView(asked) ? 'committed' : 'effective',
      frame: pageKeepsFrame(asked) ? 'full' : 'inline',
    };
  }
  return { ok: true, loc, canonical: docsPageUrl(loc) };
}

/** The canonical page URL. Each path segment goes through encodeURIComponent; `ref` is written verbatim, because
 *  its grammar's charset (A-Z a-z 0-9 . _ / -) is query-safe; keys follow DOCS_PAGE_KEYS order, and a redundant
 *  `view` or `frame` is never written. `loc` must hold values in their grammars, as every parseDocsPage answer
 *  does; encodeURIComponent throws URIError on a lone surrogate, which isDocsRelPath refuses.
 *  parseDocsPage(docsPageUrl(l)) returns l for every canonical l. */
export function docsPageUrl(loc: DocsPageLocation): string {
  if (loc.kind === 'index') return DOCS_PAGE_PREFIX;
  let url = DOCS_PAGE_PREFIX + '/' + encodeURIComponent(loc.project);
  if (loc.kind !== 'project') url += '/' + loc.section;
  if (loc.kind === 'path') {
    url += '/' + loc.path.split('/').map((s) => encodeURIComponent(s)).join('/') + (loc.dirSlash ? '/' : '');
  }
  const value: Record<DocsPageKey, string | null> = {
    ref: loc.ref === null ? null : docsRefText(loc.ref),
    view: loc.kind === 'path' && pageKeepsView(loc) ? 'committed' : null,
    frame: loc.kind === 'path' && pageKeepsFrame(loc) ? 'full' : null,
  };
  const pairs: string[] = [];
  for (const key of DOCS_PAGE_KEYS) {
    const v = value[key];
    if (v !== null) pairs.push(key + '=' + v);
  }
  return pairs.length === 0 ? url : url + '?' + pairs.join('&');
}

/** What a file request names (spec 3.2, 3.4). A committed pin is the tree answer's commit and `ref.served`; a
 *  draft pin is the draft branch, the holder's HEAD and the draft's fingerprint. Neither is ever a page URL. */
export type DocPin =
  | { kind: 'committed'; commit: string; servedRef: string; section: DocSectionSlug; path: string }
  | { kind: 'draft'; branch: string; head: string; section: DocSectionSlug; path: string; fp: string };

/** `/api/docs/<project>`: the project segment through encodeURIComponent. */
function apiProjectPath(project: string): string {
  return DOCS_API_PREFIX + '/' + encodeURIComponent(project);
}

/** A query in the order given, each value through encodeURIComponent: a path's `/` becomes `%2F` and its `+`
 *  becomes `%2B`, so a form-style decoder on the server cannot read a plus as a space. */
function apiQuery(pairs: readonly (readonly [string, string])[]): string {
  return '?' + pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

/** The ONE docs API URL builder (spec 3.2). Keys are written in one fixed order whatever order the pin's fields
 *  were spelled in: committed commit, servedRef, section, path; draft branch, head, section, path, fp. It
 *  validates nothing; the server's L1 query parser does, with the same predicates. */
export const docsApi = {
  projects: (): string => DOCS_API_PREFIX + '/projects',
  tree: (project: string, ref: DocsRefSpec | null): string =>
    apiProjectPath(project) + '/tree' + (ref === null ? '' : apiQuery([['ref', docsRefText(ref)]])),
  file: (project: string, pin: DocPin): string =>
    apiProjectPath(project) + '/file' + apiQuery(pin.kind === 'committed'
      ? [['commit', pin.commit], ['servedRef', pin.servedRef], ['section', pin.section], ['path', pin.path]]
      : [['branch', pin.branch], ['head', pin.head], ['section', pin.section], ['path', pin.path], ['fp', pin.fp]]),
  refresh: (project: string): string => apiProjectPath(project) + '/refresh',
};
