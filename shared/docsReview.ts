// Draft review's L0 vocabulary and limits: the `shared/docsReview.ts` row of the draft-review design,
// `docs/superpowers/specs/2026-11-18-native-docs-draft-review-design.md`, and Task R1.1 of its plan.
//
// L0: it imports only `shared/docs.ts`, which names no host global, and it names none itself, so the PWA bundles it and
// the server compiles it. The grammars of a share's source are `shared/docs.ts`'s own (project, section, path, ref,
// commit, fingerprint), never a second copy; the one grammar added here is the capability token's.
//
// Every limit is declared once here (the export cap, which a share's snapshot also obeys, is in `shared/docs.ts`).

import {
  isDocsBareRef, isDocsCommit, isDocsFingerprint, isDocsProject, isDocsQualifiedRef, isDocsRelPath, isDocsSection,
  type DocSectionSlug,
} from './docs.js';

// ---- Limits ----------------------------------------------------------------------------------------------------

/** The most live shares the store holds at once. */
export const REVIEW_MAX_LIVE = 64;
/** The most bytes the store's snapshots may hold together (256 MiB). */
export const REVIEW_MAX_STORE_BYTES = 268435456;
/** A share not viewed for this long expires (7 days). */
export const REVIEW_IDLE_MS = 604800000;
/** A share is removed this long after it was first shared, whatever its views (30 days). */
export const REVIEW_RETENTION_MS = 2592000000;
/** A removal's tombstone is kept this long, so the owner's list shows why the share went (7 days). The link itself
 *  answers the same 404 whether a tombstone exists or not. */
export const REVIEW_TOMBSTONE_MS = 604800000;
/** Views closer together than this record one view (1 minute). */
export const REVIEW_VIEW_COARSEN_MS = 60000;
/** The sweep's period (10 minutes). */
export const REVIEW_SWEEP_MS = 600000;
/** The wait before a pending removal on disk is retried (10 seconds). */
export const REVIEW_PENDING_RETRY_MS = 10000;
/** The most sends of one share at once; past it, 429 `busy`. */
export const REVIEW_OPEN_STREAMS_PER_SHARE = 2;
/** The most sends at once in all, a backstop for memory and descriptors; past it, 429 `busy`. */
export const REVIEW_OPEN_STREAMS = 16;
/** A send whose socket has accepted no bytes for this long is destroyed: a no-progress timeout, reset by every
 *  drained write, never a total deadline (30 seconds). */
export const REVIEW_SEND_IDLE_MS = 30000;
/** The largest body an opening request may carry. */
export const REVIEW_OPEN_BODY_BYTES = 256;
/** The fixed header required before a capability can be looked up. */
export const REVIEW_MARKER_HEADER = 'x-ccrc-review';
export const REVIEW_MARKER_VALUE = '1';

// ---- The review page's response headers --------------------------------------------------------------------------

/** The review page's content security policy, sent as a response header (draft-review design §3.5, "The review
 *  page"). `script-src 'self'` names no inline script; a srcdoc frame inherits and intersects this policy, so the
 *  style, image and font sources are the ones the export's own meta grants a copy and nothing more. The page's
 *  policy is never widened to make an engine render a copy (the design stops and asks). One home: the page route
 *  and the browser harness both read it. */
export const REVIEW_PAGE_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline' data:; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Every response header of the review page (`GET /review`, design §3.5): the policy above, never cached, no
 *  referrer (the page's address held a capability once), no sniffing, never framed. Lower-case names, so a
 *  header map reads them as they are sent. */
export const REVIEW_PAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': REVIEW_PAGE_CSP,
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

// ---- The token ---------------------------------------------------------------------------------------------------

/** The capability token: 32 random bytes, base64url without padding, so 43 characters. The one grammar of it. */
export const REVIEW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isReviewToken(s: string): boolean {
  return typeof s === 'string' && REVIEW_TOKEN_RE.test(s);
}

// ---- Removal causes ----------------------------------------------------------------------------------------------

/** Why a share was removed. A record, so the list below derives from it and a cause is documented where it is named. */
const REVIEW_REMOVAL_MAP = {
  /** The owner revoked it. A revoke whose tombstone did not land stays `revoked`, so a revoked share never reads as
   *  unreadable (spec section 4, write failures). */
  revoked: true,
  /** It sat unviewed for `REVIEW_IDLE_MS`. */
  expired: true,
  /** The file was committed, so the review no longer stands for a draft. */
  committed: true,
  /** It reached `REVIEW_RETENTION_MS`. */
  retention: true,
  /** It cannot be read, for one of two causes: boot found an index entry whose bytes file is missing, or a removal by
   *  the sweep or by the read-time expiry decision whose tombstone did not land. */
  lost: true,
} as const;

export type ReviewRemoval = keyof typeof REVIEW_REMOVAL_MAP;

export const REVIEW_REMOVALS: readonly ReviewRemoval[] = Object.keys(REVIEW_REMOVAL_MAP) as ReviewRemoval[];

// ---- Wire types --------------------------------------------------------------------------------------------------

/** Why a create is refused. `auth-off` is the account gate's word, never this type's. */
export type ReviewCreateRefusal = 'too-large' | 'store-full' | 'store-unreadable' | 'not-durable' | 'bad-source';

/** Every create refusal once, so a new word is a compile error here until it is placed (the wire-totality rule). */
const REVIEW_CREATE_REFUSAL_MAP: Record<ReviewCreateRefusal, true> = {
  'too-large': true, 'store-full': true, 'store-unreadable': true, 'not-durable': true, 'bad-source': true,
};

export const REVIEW_CREATE_REFUSALS: readonly ReviewCreateRefusal[] =
  Object.keys(REVIEW_CREATE_REFUSAL_MAP) as ReviewCreateRefusal[];

/** What a share was made from: the file, the branch and head it was read at, and the draft's fingerprint. */
export interface ReviewSource {
  project: string;
  section: DocSectionSlug;
  path: string;
  branch: string;
  head: string;
  servedRef: string;
  baseCommit: string;
  fp: string;
  committedBlob: string | null;
}

export interface ReviewShareWire {
  id: string;
  source: ReviewSource;
  version: number;
  sharedAt: number;
  firstSharedAt: number;
  idleSince: number;
  lastViewedAt: number | null;
  pinned: boolean;
  sha256: string;
  size: number;
  credentialShapes: number;
  link: string | null;
  removed: { why: ReviewRemoval; at: number } | null;
  /** A removal is pending on disk. */
  revoking: boolean;
}

/** `replacedExpired` is additive: present only when the create replaced an expired share of the same source. */
export interface ReviewCreateAnswer { ok: true; share: ReviewShareWire; replacedExpired?: true }

/** The one reader of `replacedExpired`: absent reads false. */
export function replacedExpiredOf(a: ReviewCreateAnswer): boolean {
  return a.replacedExpired === true;
}

// ---- Source grammar ----------------------------------------------------------------------------------------------

const isStr = (v: unknown): v is string => typeof v === 'string';

/** True iff `x` is a share source whose every field passes the docs grammars (40 or 64 hex commits, so SHA-256
 *  repositories are served). `branch` is a bare name and `servedRef` a full refname, the spellings the docs reader's
 *  own pin parser takes (`server/src/docs/policy.ts`), so one file on one branch has one spelling and so one live
 *  share (D-8835). It checks the nine fields only; a caller that keeps the source copies those nine. */
export function isReviewSource(x: unknown): x is ReviewSource {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    isStr(s.project) && isDocsProject(s.project) &&
    isStr(s.section) && isDocsSection(s.section) &&
    isStr(s.path) && isDocsRelPath(s.path) &&
    isStr(s.branch) && isDocsBareRef(s.branch) &&
    isStr(s.head) && isDocsCommit(s.head) &&
    isStr(s.servedRef) && isDocsQualifiedRef(s.servedRef) &&
    isStr(s.baseCommit) && isDocsCommit(s.baseCommit) &&
    isStr(s.fp) && isDocsFingerprint(s.fp) &&
    (s.committedBlob === null || (isStr(s.committedBlob) && isDocsCommit(s.committedBlob)))
  );
}

// ---- Dates -------------------------------------------------------------------------------------------------------

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The one `{date}` formatter, here so the review page and the owner's rows share it: day, short month, year, in the
 *  runtime's time zone (the browser's, on the page), so 2026-11-26 reads "26 Nov 2026". */
export function reviewDate(ms: number): string {
  return DATE_FORMAT.format(new Date(ms));
}
