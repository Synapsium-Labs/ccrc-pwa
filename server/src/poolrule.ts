import { poolRule, declaredAccountPool } from '../../shared/poolrule.js';
import type { PoolVerdict } from '../../shared/poolrule.js';
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
    return poolRule({ state: 'tagged', pools: central as readonly [string, ...string[]], origin: 'central' }, pool);
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
 * STILL DECLARED-ONLY (account-pool-membership wave 1, task 7 deviation,
 * reported): this feeds `projectHome`/`projectPlacement`'s RANKING forecast
 * (`GET /api/projects`' `placement` field, `GET /api/accounts`' `projected`),
 * a different forecast from `poolVerdict`'s REFUSAL pre-check that
 * `refusePool` gates placement on. Giving this the same central-edge
 * precedence needs an `edges` parameter threaded through `projectHome` and
 * `projectPlacement` (`limits.ts`) and every one of their ~30 call sites in
 * `test/projected-home.test.ts` — out of this task's file list and mutation
 * table, and not exercised by anything `POST /api/pools/accounts/:id` or
 * `GET /api/pools/epoch` do. Left as a known gap for the task that owns the
 * ranking forecast: today it can still rank an account by its DECLARED pool
 * after a central tag has moved it elsewhere.
 */
export function poolEligible(roster: Roster, pool: ProjectPoolWire): AccountDef[] {
  return roster.homeAble.filter((a) => poolRule(declaredAccountPool(a.pool), pool).ok);
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
