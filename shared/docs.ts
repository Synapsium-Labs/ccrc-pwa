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
