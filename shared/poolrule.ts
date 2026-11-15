// The one TypeScript spelling of the pool rule (design §5.2):
//
//   An account `a` may serve a project `p` iff pool(a) is null, or pool(p) is
//   null, or pool(a) === pool(p). If pool(p) cannot be read, NOBODY DECIDES.
//
// And its session side as a SET (spec 2026-11-09 §3.4 C46): a set serves an
// account in one of its pools, and an untagged account only by the set's own
// `untagged` yes. A set is never untagged, and a set that cannot be read never
// falls back to the project's tag.
//
// L0, like every other module in `shared/`: it imports TYPES plus one VALUE from its
// sibling `./poolset.js` (`poolSetSpelling`, the set's one spelling, which a set
// mismatch names), and not even `node:*`, because the PWA bundles this file. That is not a formality here —
// it is the whole reason the rule lives in `shared/` rather than under
// `server/src/`. The server's wave-3 pre-check now consumes it; the phone's
// wave-4 "show other pools" disclosure remains a future consumer. Two copies
// would drift: the phone could offer a swap the API refuses, which is the
// failure the shared fixture table (`server/test/fixtures/poolRule.ts`) exists
// to make impossible. `ccd`'s bash `_pool_ok` is the other spelling (wave 2a
// landed it) — it cannot share code across the language boundary, so it is
// driven over that same table instead (`server/test/ccd-pool-ok.test.ts`).
// (D-1664, corrected after wave 3 by D-2480.)
//
// PRECEDENCE IS THE POINT, and the order below is not arbitrary:
//
//  1. `unreadable` / `malformed` are decided FIRST, before either untagged
//     shortcut. An unreadable tag over an UNTAGGED account still answers
//     undecidable: the constraint is unknown, not absent, and answering "serve"
//     there would lift a constraint nobody has read. This is the one ordering
//     mistake that is invisible in every other row of the table.
//  2. `untagged-project` — ruling 3: tagging only ever tightens, so an untagged
//     project keeps today's unconstrained behaviour and nothing strands on
//     rollout.
//  3. `untagged-account` — an account with no pool serves anything.
//  4. Equal names serve; anything else is a mismatch, and the verdict CARRIES
//     BOTH NAMES so a 409 body, a die message and a chip can each say which two
//     pools disagreed without looking either of them up again.
//
// A SET side (C46) takes its own steps, after the project's two bad states:
//  a. `set-unreadable` / `set-malformed` are undecidable on the SET side over
//     every account state, an untagged one included (step 1's reason, again).
//  b. An account the side cannot read is undecidable on the ACCOUNT side.
//  c. An untagged account serves only by the set's `untagged` yes.
//  d. An account in any of the set's pools serves (`in-set`); else a mismatch
//     naming the account's side and the set's one spelling.
import type { ProjectPoolWire } from './api.js';
import { poolSetSpelling } from './poolset.js';
import type { PoolSet } from './poolset.js';

/** Where an account's pool tag came from — `central` is the authoritative
 *  `pool_edges` rows in `~/.ccrc/coord.db` (design §5.1's "the only writer of
 *  membership"); `declared` is `accounts.json`'s `pool` field, the retained
 *  LOWEST-precedence default (design §5.1, §5.6). Carried on the wire rather
 *  than inferred, so a reader never has to guess which of the two sources a
 *  `tagged`/`untagged` answer measured — the PWA renders it (design §5.9: "showing
 *  its `origin` when it is the declared default rather than central"). */
export type PoolOrigin = 'central' | 'declared';

/** D-6048 (ARCH-12): the runtime list, derived from the type (`SESSION_ROLE_MAP`'s idiom). */
const POOL_ORIGIN_MAP: Record<PoolOrigin, true> = { central: true, declared: true };
export const POOL_ORIGINS: readonly PoolOrigin[] = Object.keys(POOL_ORIGIN_MAP) as PoolOrigin[];

/**
 * The account side of the rule, as STATES rather than a bare name — wave 1
 * Task 5. `tagged`/`untagged` are the two states `accountPool: string | null`
 * used to carry; `malformed`/`unreadable`/`stale` are new, and each is a
 * projection this side could not READ, which `poolRule` below treats as
 * undecidable rather than permissive. See `poolRule`'s own docstring for why
 * `untagged` — not `unreadable` — is still what "an account this side cannot
 * see" answers.
 */
export type AccountPoolWire =
  | { state: 'tagged'; pools: readonly [string, ...string[]]; origin: PoolOrigin }
  | { state: 'untagged'; origin: PoolOrigin }
  | { state: 'malformed' }
  | { state: 'unreadable' }
  | { state: 'stale' };

/** The session's side of the rule: a project's tag as today, or a set read from the session's route record (C46).
 *  A set is never "untagged": an untagged account serves a set only by its explicit `untagged` yes. */
export type SessionPoolSide =
  | ProjectPoolWire
  | { readonly state: 'set'; readonly set: PoolSet }
  | { readonly state: 'set-unreadable' }
  | { readonly state: 'set-malformed' };

/** The arms a PROJECT side can produce — what every pre-set caller narrows on (`v.accountPool`). */
export type ProjectPoolVerdict =
  | { ok: true; why: 'untagged-project' | 'untagged-account' | 'same-pool' }
  | { ok: false; reason: 'pool-mismatch'; side: 'project'; accountPool: string; projectPool: string }
  | { ok: false; reason: 'pool-undecidable'; side: 'project' | 'account';
      state: 'unreadable' | 'malformed' | 'unrecognised' | 'stale' };

/**
 * Why an account may or may not serve a project.
 *
 * The `ok: true` arm keeps its REASON rather than collapsing to a boolean:
 * "served because the project is untagged" and "served because the names agree"
 * are different facts to a reader deciding whether tagging the project would
 * change anything, and the PWA builds its copy from that difference.
 *
 * `pool-undecidable` is not a third flavour of "no". A refusal says the operator
 * may override it on purpose (`--cross-pool`, a 409 with an override); an
 * undecidable says nobody has an answer, and its honest surfaces are a 503 and a
 * warning chip carrying the path — never a 409 offering a crossing over a
 * constraint that was never read.
 *
 * `side` names which side failed, on both failing arms (additive: the ok arm has none). The set mismatch arm names
 * the account's side as untagged rather than inventing a pool name; `set` is the spelling, or a label for a set that
 * has none: `-` for the empty set, `?name` or `?over-cap` for one the grammar cannot spell. The project arms are
 * `ProjectPoolVerdict`'s, defined once; the set arms are added to them.
 */
export type PoolVerdict =
  | ProjectPoolVerdict
  | { ok: true; why: 'in-set' | 'untagged-in-set' }
  | { ok: false; reason: 'pool-mismatch'; side: 'set'; account: { pool: string } | { untagged: true }; set: string }
  | { ok: false; reason: 'pool-undecidable'; side: 'set'; state: 'unreadable' | 'malformed' };

/**
 * The rule, once — now with an account side that has STATES, not just a name.
 *
 * WHAT DID NOT CHANGE, and must not: the project side decides first. An
 * untagged project is unconstrained and serves WITHOUT the account side being
 * consulted, so a control plane that has been down longer than the lease stops
 * placement only into projects somebody deliberately tagged. Reordering these
 * two blocks turns a quiet outage into a fleet-wide stop (spec §5.8).
 *
 * WHAT DID CHANGE: `unreadable` / `stale` / `malformed` on the ACCOUNT side are
 * now reachable, and each is undecidable. Previously the account side could
 * only be a name or `null`, and `null` meant BOTH "untagged" and "this side
 * cannot see it" — a fold that was honest when the only carrier was the roster.
 *
 * THE FOLD IS KEPT, DELIBERATELY. `{ state: 'untagged' }` still covers an
 * account this side cannot see, and that stays the PERMISSIVE direction for the
 * reason the old docstring gave: `ccd`'s `_is_valid_wrapper` is the authority on
 * which wrappers exist, the server's roster copy can lag the fleet's, and a
 * display that HID a live non-roster account would be worse than one that
 * offers it and lets `ccd` refuse. What is new is that a projection which could
 * not be READ is a different condition with a different answer. Collapsing
 * those two would re-create the fail-open this design exists to prevent.
 */
export function poolRule(account: AccountPoolWire, side: ProjectPoolWire): ProjectPoolVerdict;
export function poolRule(account: AccountPoolWire, side: SessionPoolSide): PoolVerdict;
export function poolRule(account: AccountPoolWire, projectPool: SessionPoolSide): PoolVerdict {
  if (projectPool.state === 'unreadable' || projectPool.state === 'malformed') {
    return { ok: false, reason: 'pool-undecidable', side: 'project', state: projectPool.state };
  }
  // A bad set is undecidable on the SET side whatever the account is, and never falls back to the project (C46).
  if (projectPool.state === 'set-unreadable' || projectPool.state === 'set-malformed') {
    return {
      ok: false, reason: 'pool-undecidable', side: 'set',
      state: projectPool.state === 'set-unreadable' ? 'unreadable' : 'malformed',
    };
  }
  if (projectPool.state === 'untagged') return { ok: true, why: 'untagged-project' };
  if (projectPool.state === 'tagged') {
    if (account.state === 'unreadable' || account.state === 'malformed' || account.state === 'stale') {
      return { ok: false, reason: 'pool-undecidable', side: 'account', state: account.state };
    }
    if (account.state === 'untagged') return { ok: true, why: 'untagged-account' };
    // Set membership, not equality — `pools` is length 1 today (never 0: the
    // tuple type makes an empty array a compile error, fix round T5-R2) and
    // the multi-pool wave drops an index without touching this line or the wire.
    if (account.pools.includes(projectPool.name)) return { ok: true, why: 'same-pool' };
    return {
      ok: false, reason: 'pool-mismatch', side: 'project',
      // `pools` is a non-empty tuple (`[string, ...string[]]`), so `[0]` is
      // TOTAL — no `?? ''` fabricating a pool name into an operator-facing 409.
      accountPool: account.pools[0], projectPool: projectPool.name,
    };
  }
  if (projectPool.state === 'set') {
    if (account.state === 'unreadable' || account.state === 'malformed' || account.state === 'stale') {
      return { ok: false, reason: 'pool-undecidable', side: 'account', state: account.state };
    }
    const set = projectPool.set;
    // The one spelling, never a second. A set with none is labelled by WHY, three labels a reader tells apart: `-`
    // for the empty set, `?name` and `?over-cap` for one the grammar cannot spell (`?` is outside the grammar).
    const spelling = poolSetSpelling(set);
    const spelled = spelling.kind === 'spelled' ? spelling.spelling
      : spelling.kind === 'empty' ? '-' : `?${spelling.why}`;
    if (account.state === 'untagged') {
      return set.untagged
        ? { ok: true, why: 'untagged-in-set' }
        : { ok: false, reason: 'pool-mismatch', side: 'set', account: { untagged: true }, set: spelled };
    }
    // Exact string equality per name (`includes` on the ARRAY), never a prefix or substring test on strings.
    if (account.pools.some((p) => set.pools.includes(p))) return { ok: true, why: 'in-set' };
    return { ok: false, reason: 'pool-mismatch', side: 'set', account: { pool: account.pools[0] }, set: spelled };
  }
  const unhandled: never = projectPool;
  void unhandled;
  return { ok: false, reason: 'pool-undecidable', side: 'project', state: 'unrecognised' };
}

/** Adapt a DECLARED-only pool name to the wire.
 *
 *  The roster is the declared carrier and the LOWEST precedence (design §5.6);
 *  a name it does not carry is `untagged`, which is what preserves `poolRule`'s
 *  documented permissive fold for an account this side cannot see. A caller
 *  holding a CENTRAL edge builds `{ state: 'tagged', pools, origin: 'central' }`
 *  itself — this helper is for the callers that have only the roster, and it
 *  exists so "a roster name is a declared tag" is stated once rather than at
 *  five call sites. */
export function declaredAccountPool(pool: string | null): AccountPoolWire {
  return pool === null
    ? { state: 'untagged', origin: 'declared' }
    : { state: 'tagged', pools: [pool], origin: 'declared' };
}
