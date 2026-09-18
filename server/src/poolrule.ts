import { poolRule, declaredAccountPool } from '../../shared/poolrule.js';
import type { AccountPoolWire, PoolVerdict } from '../../shared/poolrule.js';
import type { ProjectPlacement, ProjectPoolWire } from '../../shared/api.js';
import type { AccountDef, Roster } from '../../shared/roster.js';

/**
 * THE SERVER'S MIRROR of the pool rule (spec §5.6), ring L1: pure decisions,
 * type-only imports plus the ONE value import of L0's `poolRule` — which is
 * the point of the file. The rule is spelled once per LANGUAGE, not once per
 * module: `shared/poolrule.ts` holds the TypeScript spelling and this module
 * consumes it. The wave-4 PWA renderer has not landed yet; when it does, it can
 * consume the same L0 rule instead of minting another spelling (D-2480).
 *
 * What this module adds that L0 cannot: a ROSTER. L0 takes an account's pool;
 * the server takes a wrapper NAME and has to look it up, and the lookup can
 * miss. `pools.test.ts` purity-scans this file (no clock, no `node:`, no
 * `reply`, no store, no `FleetIO`) the way `coord-caps-policy.test.ts` scans
 * `caps.ts`.
 *
 * The server REFUSES and FORECASTS; it never places (spec §5.1). Every verdict
 * below is a pre-check the box will re-take for itself.
 */

/**
 * L0's verdict plus the one answer only a roster-holder can give.
 *
 * `account-not-in-roster` is an `ok` member on purpose: `ccd`'s
 * `_is_valid_wrapper` is the authority on what a wrapper is, and the PWA
 * already offers live wrappers this box's `accounts.json` does not name (spec
 * §5.6). Refusing an account we merely cannot see would 409 a swap the fleet
 * would have carried out — the server inventing a policy instead of mirroring
 * one.
 */
export type RosterVerdict = PoolVerdict | { ok: true; why: 'account-not-in-roster' };

/** Build the wire shape for a CENTRAL edge — the one place `{ state: 'tagged',
 *  origin: 'central' }` is spelled, shared by every reader of `pool_edges`
 *  below so they cannot disagree about what a central row means. `pools` is
 *  asserted non-empty by every caller before this runs (T5-R2's tuple type
 *  makes an empty array a compile error at the point of construction, so the
 *  cast here is not smuggling one past the type). */
function centralAccountPool(pools: readonly string[]): AccountPoolWire {
  return { state: 'tagged', pools: pools as readonly [string, ...string[]], origin: 'central' };
}

/**
 * The pool this ACCOUNT is in, RESOLVED — central beats declared beats
 * untagged (design §5.6, T7-R2, D-TBD-resolved-pool-wire). Distinct question
 * from {@link poolVerdict}:
 * this names a pool, `poolVerdict` names a VERDICT against one project's tag.
 * `GET /api/accounts`'s wire uses this so the PWA can render (and reason
 * about crossings from) the same precedence the server enforces, rather than
 * re-deriving it from the declared `RosterWire.pool` field alone — the defect
 * T7-R2 found live in `NewSessionSheet.tsx` before this field existed.
 */
export function resolvedAccountPool(
  account: AccountDef, edges: ReadonlyMap<string, readonly string[]>,
): AccountPoolWire {
  const central = edges.get(account.id);
  if (central !== undefined && central.length > 0) return centralAccountPool(central);
  return declaredAccountPool(account.pool);
}

/**
 * May `wrapper` serve a project whose tag reads `pool`?
 *
 * EVERY ANSWER COMES OUT OF `poolRule`, including the not-in-roster one: the
 * miss is handled by asking the rule with `declaredAccountPool(null)` — an
 * untagged account, adapted — and then RELABELLING only its `ok` arm. That is
 * what keeps the precedence intact —
 * an `unreadable`/`malformed` tag is undecidable for everyone, roster member
 * or not, so it must still answer `pool-undecidable` here (spec §5.2's "nobody
 * decides"). A `null` account pool can never produce `pool-mismatch`, so the
 * relabel provably cannot swallow a refusal.
 *
 * `edges` is REQUIRED, not optional (T5-R4, account-pool-membership wave 1
 * task 7). An optional parameter would let a caller that HAS the central
 * `pool_edges` rows silently fall back to the declared roster tag by simply
 * forgetting to pass them — a fail-open that compiles clean. Making it
 * required turns every call site into a compile error that forces its author
 * to answer "do I have the central edges here?" A caller that genuinely has
 * none passes `new Map()` and says why in a comment at the call site.
 *
 * NOT WRITTEN AS `poolRule(resolvedAccountPool(...), pool)`, deliberately: a
 * central edge decides the verdict DIRECTLY, without ever consulting
 * `roster.byId` — so a wrapper this box's roster does not have still gets a
 * real mismatch/match answer (never the `account-not-in-roster` relabel) when
 * a central row exists for it. `resolvedAccountPool` requires an already-known
 * `AccountDef` for exactly this reason: it answers "what pool is THIS
 * (roster-known) account in", not "does this wrapper exist".
 */
export function poolVerdict(
  roster: Roster, wrapper: string, pool: ProjectPoolWire,
  edges: ReadonlyMap<string, readonly string[]>,
): RosterVerdict {
  // PRECEDENCE, in the one place that can enforce it: projected beats
  // declared beats untagged (design §5.6). A central edge is authoritative —
  // it came from `pool_edges`, which is the only writer — so it is consulted
  // before the roster's retained default, and the roster is not read at all
  // when one exists.
  const central = edges.get(wrapper);
  if (central !== undefined && central.length > 0) {
    return poolRule(centralAccountPool(central), pool);
  }
  const account = roster.byId.get(wrapper);
  if (account !== undefined) return poolRule(declaredAccountPool(account.pool), pool);
  const v = poolRule(declaredAccountPool(null), pool);
  return v.ok ? { ok: true, why: 'account-not-in-roster' } : v;
}

/**
 * The home-able accounts that may serve a project with this tag, in roster
 * declaration order — `_ws_least_loaded`'s candidate set, pool-filtered.
 *
 * EMPTY for an undecidable tag, and that is not the same fact as "every lane
 * is disabled": callers must ask {@link poolUndecidable} first if they need to
 * tell the two apart (`projectPlacement` in `limits.ts` does).
 *
 * `edges` is REQUIRED (T7-R1, account-pool-membership wave 1,
 * D-TBD-poolEligible-required-edges), on `poolVerdict`'s exact reasoning: an
 * optional parameter lets a caller that HAS central edges silently fall back
 * to declared-only by forgetting to pass them, which is the fail-open T5-R4
 * was written to close at every call site, not only `refusePool`'s.
 *
 * WIRED THROUGH FOR REAL (ruling T7-R3, reversing T7-R1's deferral): this
 * function's ONE call site, `projectHome` (`limits.ts`), now passes a live
 * `edges` from its own caller — `server.ts`'s `GET /api/projects` and `GET
 * /api/accounts` both read `deps.coord?.accountPoolEdges() ?? new Map()` —
 * so the RANKING forecast (`ProjectRow.placement`, `AccountsResponse.projected`)
 * and the REFUSAL pre-check (`refusePool`) now agree: an account centrally
 * tagged into a different pool than its declared default can no longer be
 * forecast eligible for a project `POST /api/sessions` would then refuse.
 * `test/projected-home.test.ts`'s fixture-driven parity harness against
 * `_ws_least_loaded` is the one caller that still passes `NO_EDGES`
 * deliberately — it tests the declared-only rule against bash's own
 * declared-only positional, not this precedence.
 */
export function poolEligible(
  roster: Roster, pool: ProjectPoolWire, edges: ReadonlyMap<string, readonly string[]>,
): AccountDef[] {
  return roster.homeAble.filter((a) => poolRule(resolvedAccountPool(a, edges), pool).ok);
}

/**
 * Are we in the state where NOBODY decides — `unreadable` or `malformed`?
 *
 * DERIVED FROM THE RULE, not from a second list of state tokens: an untagged
 * account is the most permissive input there is, so
 * `poolRule(declaredAccountPool(null), pool)` refuses exactly when the tag
 * itself is undecidable. A hand-written
 * `state === 'unreadable' || state === 'malformed'` here would be the second
 * copy that drifts the day a fifth state is added.
 */
export function poolUndecidable(pool: ProjectPoolWire): boolean {
  return !poolRule(declaredAccountPool(null), pool).ok;
}

/**
 * Does ANY rostered account carry this pool name?
 *
 * EVERY account, not just the home-able ones — `ccd`'s own stderr warning
 * walks `CCRC_ACCOUNTS` (spec §5.4.2), and a pool whose only member is the
 * non-home-able lane is a real pool. Drives the tag route's
 * `warning: 'unknown-pool'`, which is a WARNING and not a refusal because this
 * box's roster copy can lag the fleet's (spec §3.3, O4).
 */
export function poolRostered(roster: Roster, name: string): boolean {
  return roster.accounts.some((a) => a.pool === name);
}

/** Re-exported so a reader who looks for the placement type beside the rule
 *  finds it. DECLARED in `shared/api.ts`, because the PWA renders it. */
export type { ProjectPlacement };
