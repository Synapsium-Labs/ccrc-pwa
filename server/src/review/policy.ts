// Draft review's L1 deciders: pure. No fs, no fastify, no clock read; every time comes in as an argument.
// Task R1.2 of the draft-review plan. Limits and wire types are L0's (`shared/docsReview.ts`); this file only decides.

import { DOCS_EXPORT_MAX_BYTES, type DocsTreeOk } from '../../../shared/docs.js';
import {
  REVIEW_IDLE_MS, REVIEW_MAX_LIVE, REVIEW_MAX_STORE_BYTES, REVIEW_RETENTION_MS, REVIEW_VIEW_COARSEN_MS,
  type ReviewShareWire,
} from '../../../shared/docsReview.js';

/** A live share as the store holds it: the wire row without what the wire derives (`link`, `removed`), plus the three
 *  things that never leave the server: the token (to build a link for a signed-in owner), its hash (the lookup key)
 *  and `rev`, bumped by every write, where `version` counts content changes only. */
export type ReviewEntry = Omit<ReviewShareWire, 'link' | 'removed'> & {
  tokenHash: string;
  token: string;
  rev: number;
};

/** A removed share as the store hands it to the owner's list. It holds no token, so it can never make a link: it is the
 *  wire row without `link` and `revoking` (a tombstone is no longer pending), with its removal always present. */
export type ReviewTombstone = Omit<ReviewShareWire, 'link' | 'removed' | 'revoking'> & {
  removed: { why: NonNullable<ReviewShareWire['removed']>['why']; at: number };
};

export type ReviewExpiry = { live: true } | { live: false; why: 'expired' | 'retention' };

/** Retention first, pinned or not: a pin keeps a share from idling out, never past its 30 days. Then idle, measured from
 *  `idleSince` (the last view or the share's own time), not from `sharedAt`. */
export function expiryOf(e: ReviewEntry, now: number): ReviewExpiry {
  if (now - e.firstSharedAt >= REVIEW_RETENTION_MS) return { live: false, why: 'retention' };
  if (!e.pinned && now - e.idleSince >= REVIEW_IDLE_MS) return { live: false, why: 'expired' };
  return { live: true };
}

/** Whether the file a share was made from has been committed since. Only a tree of the share's own project, read at
 *  its own served ref, that holds the share's section and path can say; anything else is `unmeasured`, which removes
 *  nothing. Every project has a `refs/heads/main`, so the project is checked too: a removal is irreversible, and a
 *  caller that grouped by ref alone must not remove one project's share on another's tree. The blob alone decides
 *  (never the draft's fingerprint): a draft that changed again is still a draft. */
export function commitVerdict(e: ReviewEntry, tree: DocsTreeOk | null): 'keep' | 'committed' | 'unmeasured' {
  if (tree === null || tree.project !== e.source.project || tree.ref.served !== e.source.servedRef) return 'unmeasured';
  const found = tree.entries.find((x) => x.section === e.source.section && x.path === e.source.path);
  if (found === undefined) return 'unmeasured';
  return (found.committed?.blob ?? null) !== e.source.committedBlob ? 'committed' : 'keep';
}

/** Whether a read is a new view: views closer together than `REVIEW_VIEW_COARSEN_MS` record one. */
export function viewDue(e: ReviewEntry, now: number): boolean {
  return e.lastViewedAt === null || now - e.lastViewedAt >= REVIEW_VIEW_COARSEN_MS;
}

export interface CreateAdmission {
  /** The new snapshot's size in bytes. */
  size: number;
  /** Live shares now, the replaced one included. */
  live: number;
  /** Snapshot bytes held now, the replaced one included. */
  storeBytes: number;
  /** The share this create replaces (a re-share of the same source), or null for a new source. Its slot and its bytes
   *  are counted out, so a re-share at a full store is admitted. */
  replacing: { size: number } | null;
}

/** The store's admission rule, in order: `too-large`, then `store-full`. `auth-off` is never decided here: the account
 *  gate is its one writer. Landing exactly on the bytes cap is admitted. */
export function admitCreate(a: CreateAdmission): { ok: true } | { ok: false; why: 'too-large' | 'store-full' } {
  if (a.size > DOCS_EXPORT_MAX_BYTES) return { ok: false, why: 'too-large' };
  const live = a.live - (a.replacing === null ? 0 : 1) + 1;
  const bytes = a.storeBytes - (a.replacing?.size ?? 0) + a.size;
  if (live > REVIEW_MAX_LIVE || bytes > REVIEW_MAX_STORE_BYTES) return { ok: false, why: 'store-full' };
  return { ok: true };
}

export interface ListContext {
  /** Sign-in is armed on this server. */
  armed: boolean;
  /** This request carries a signed-in session. */
  signedIn: boolean;
  /** The public origin the link is built on, no trailing slash. */
  origin: string;
}

/** The owner's list: live shares first, then removed ones. A link exists only for a signed-in owner on an armed server
 *  and never for a share whose removal is pending. Token, token hash and `rev` are never on the wire. */
export function projectList(
  entries: readonly ReviewEntry[], tombstones: readonly ReviewTombstone[], ctx: ListContext,
): ReviewShareWire[] {
  const live: ReviewShareWire[] = entries.map((e) => ({
    id: e.id, source: e.source, version: e.version, sharedAt: e.sharedAt, firstSharedAt: e.firstSharedAt,
    idleSince: e.idleSince, lastViewedAt: e.lastViewedAt, pinned: e.pinned, sha256: e.sha256, size: e.size,
    credentialShapes: e.credentialShapes,
    link: ctx.armed && ctx.signedIn && !e.revoking ? `${ctx.origin}/review#${e.token}` : null,
    removed: null,
    revoking: e.revoking,
  }));
  const gone: ReviewShareWire[] = tombstones.map((t) => ({
    id: t.id, source: t.source, version: t.version, sharedAt: t.sharedAt, firstSharedAt: t.firstSharedAt,
    idleSince: t.idleSince, lastViewedAt: t.lastViewedAt, pinned: t.pinned, sha256: t.sha256, size: t.size,
    credentialShapes: t.credentialShapes, link: null, removed: { why: t.removed.why, at: t.removed.at },
    revoking: false,
  }));
  return [...live, ...gone];
}
