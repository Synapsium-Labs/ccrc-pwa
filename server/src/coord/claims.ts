import { CLAIM_LEASE_MS, type ClaimConflict, type PeerDeliverable } from '../../../shared/api.js';

/**
 * L1: pure, clock-free, fs-free, fastify-free — `journalparse.ts`'s exact
 * stance, and the same coord-ring scan (`single-definition.test.ts`)
 * polices it: no `./db.js`, no `node:sqlite`, no handle. The CAS itself is
 * NOT here (D11): it is the in-transaction read part B's store method runs
 * inside `tx()`, which is sound only there — one server process,
 * `DatabaseSync` with no async surface. This file is the DECISION that read
 * feeds, so route, sweep and test all consume one table instead of three
 * hand-rolled copies.
 *
 * `existing` is the set of LIVE rows the store read inside the same
 * transaction, expiry already applied (the feed_events prune-on-write
 * idiom, D12) — that precondition is the store's contract, which is why
 * `decideClaim` carries no clock: handing it one would be a second expiry
 * implementation waiting to drift from the first.
 */
export interface ClaimRow {
  readonly id: number;
  readonly project: string;
  /** The claim's path set, normalized at insert (`normalizeClaimPath`). */
  readonly paths: readonly string[];
  readonly heldBy: string;
  readonly heldByUuid: string;
  readonly intent: string;
  readonly runId: number | null;
  readonly expiresAt: number;
  /** The holder's deliverability, MEASURED BY THE CALLER (`peerDeliverable`
   *  over the same records the route already holds) — an input, so the
   *  decision stays pure. Required, not defaulted: every caller must answer,
   *  and 'unknown' is the honest answer when it did not measure. */
  readonly holderDeliverable: PeerDeliverable;
}

export interface ClaimRequest {
  readonly project: string;
  readonly paths: readonly string[];
  readonly sessionId: string;
}

/** Three arms, three facts a caller handles differently — never collapsed:
 *  granted (with the normalized set to insert), refused outright (bad
 *  paths, named in full), or lost to a holder (every conflicting path
 *  named, D12 — partial acquisition is how two workers each end up holding
 *  half of what the other needs, so there is no partial arm to have). */
export type ClaimDecision =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly refused: 'bad-path'; readonly paths: readonly string[] }
  | { readonly conflict: readonly ClaimConflict[] };

/**
 * Repo-relative, forward-slash, no trailing slash, no dot segments — or
 * null. `'.'` and `''` are refused because claiming the whole repo IS the
 * module wedge (D12); absolute paths and `..`/`.` segments are refused
 * because containment below is string-prefix arithmetic, and a path that
 * can alias another path defeats it. Refuse, never repair beyond the two
 * spelling normalizations (`./x` -> `x`, `x/` -> `x`) that make one
 * directory one string.
 */
export function normalizeClaimPath(raw: string): string | null {
  let p = raw;
  while (p.startsWith('./')) p = p.slice(2);
  while (p.endsWith('/')) p = p.slice(0, -1);
  if (p === '' || p === '.') return null;
  if (p.startsWith('/')) return null;
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return null;
  return p;
}

/** Exact match OR directory-prefix containment, BOTH directions — the rule
 *  no index can express (D11), stated once. Inputs are normalized paths;
 *  the `+ '/'` is what keeps `shared` out of `shared-utils`. */
export function pathsOverlap(a: string, b: string): boolean {
  return a === b || b.startsWith(a + '/') || a.startsWith(b + '/');
}

/** The pre-addressed envelope (D12): the 409 does not stop at telling you
 *  who holds the path — it hands you the address. A holder measured
 *  'no:<reason>' degrades the hint to NULL — the L0 contract's spelling of
 *  "escalate to the operator" (`ClaimConflict.mailHint`'s docstring), NEVER
 *  a silent send: the measured reason still rides `deliverable` beside it.
 *  'unknown' still gets the envelope, because unknown is not no (D9). */
function claimMailHint(
  path: string, heldBy: string, deliverable: PeerDeliverable,
): ClaimConflict['mailHint'] {
  if (deliverable.startsWith('no:')) return null;
  return { toId: heldBy, subject: `claim conflict: ${path}` };
}

export function decideClaim(existing: readonly ClaimRow[], req: ClaimRequest): ClaimDecision {
  // Bad paths first, and ALL of them: a caller fixing its request one 400
  // at a time is a caller that retries four times.
  const bad = req.paths.filter((p) => normalizeClaimPath(p) === null);
  if (bad.length > 0) return { refused: 'bad-path', paths: bad };
  // Dedupe AFTER normalization, preserving first-seen order, so
  // ['shared/', 'shared'] is one path, not a self-collision.
  const paths: string[] = [];
  for (const p of req.paths) {
    const n = normalizeClaimPath(p)!;
    if (!paths.includes(n)) paths.push(n);
  }

  const conflicts: ClaimConflict[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    for (const c of existing) {
      if (c.project !== req.project) continue;      // per-project namespace
      // The holder's own rows never conflict: re-POSTing the same paths is
      // the RENEWAL door (D12 ruling 3), and the 409's whole job is to hand
      // the caller someone ELSE's address.
      if (c.heldBy === req.sessionId) continue;
      for (const claimedPath of c.paths) {
        if (!pathsOverlap(path, claimedPath)) continue;
        const key = `${path}\x00${c.id}`;         // one address per (path, claim)
        if (seen.has(key)) continue;
        seen.add(key);
        // An object LITERAL against the L0 interface, so a ClaimConflict
        // member this file forgets — or invents — is a compile error, the
        // reviveFleetSession mechanism.
        conflicts.push({
          path, claimedPath, claimId: c.id, heldBy: c.heldBy, heldByUuid: c.heldByUuid,
          intent: c.intent, runId: c.runId, expiresAt: c.expiresAt,
          deliverable: c.holderDeliverable,
          mailHint: claimMailHint(path, c.heldBy, c.holderDeliverable),
        });
      }
    }
  }
  // ALL-OR-NOTHING (D12): five paths, one conflict, zero acquired — and the
  // 409 names EVERY conflicting path, not the first.
  if (conflicts.length > 0) return { conflict: conflicts };
  return { ok: true, paths };
}

/** What the renew sweep can answer about a holder, from records the tick
 *  has ALREADY read — never a fresh per-claim exec. Three words because
 *  there are three facts: measured running, measured gone, and could-not-
 *  measure, which is neither. */
export type LivenessVerdict = 'running' | 'gone' | 'unmeasurable';

/** The L2 port, declared BY THE CONSUMER (this file is the consumer: the
 *  decision below is what needs a verdict). Part B's watcher implements it
 *  over the registry/tmux facts its tick already holds — D12: no
 *  session-side heartbeat, no protocol a model must remember. */
export interface LivenessProbe {
  liveness(sessionId: string): LivenessVerdict;
}

export type ClaimExpiryDecision =
  | { readonly act: 'renew'; readonly expiresAt: number }
  | { readonly act: 'lapse'; readonly endedBy: 'session-gone' | 'hard-cap' }
  | { readonly act: 'hold' };

/**
 * D12's table, in order — the order is the specification:
 *
 *   now >= hardExpiresAt            -> lapse 'hard-cap'   (checked FIRST: the
 *                                      one bound no measurement can extend)
 *   running                         -> renew to min(now + CLAIM_LEASE_MS,
 *                                      hardExpiresAt); a no-op renewal is a hold
 *   gone  + now >= expiresAt        -> lapse 'session-gone' (at the STANDING
 *                                      lease, never early — the lease is the grace)
 *   gone  + now <  expiresAt        -> hold
 *   unmeasurable                    -> HOLD. Doubt is not death: a fleet-box
 *                                      hiccup must not mass-expire every claim
 *                                      (registry.ts's HOLD_UNREADABLE stance,
 *                                      one table over)
 */
export function claimExpiry(
  row: { readonly expiresAt: number; readonly hardExpiresAt: number },
  now: number,
  verdict: LivenessVerdict,
): ClaimExpiryDecision {
  if (now >= row.hardExpiresAt) return { act: 'lapse', endedBy: 'hard-cap' };
  switch (verdict) {
    case 'running': {
      const next = Math.min(now + CLAIM_LEASE_MS, row.hardExpiresAt);
      return next > row.expiresAt ? { act: 'renew', expiresAt: next } : { act: 'hold' };
    }
    case 'gone':
      return now >= row.expiresAt
        ? { act: 'lapse', endedBy: 'session-gone' }
        : { act: 'hold' };
    case 'unmeasurable':
      return { act: 'hold' };
  }
}
