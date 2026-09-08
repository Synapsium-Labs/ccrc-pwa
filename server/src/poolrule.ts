import { poolRule } from '../../shared/poolrule.js';
import type { PoolVerdict } from '../../shared/poolrule.js';
import type { ProjectPlacement, ProjectPoolWire } from '../../shared/api.js';
import type { AccountDef, Roster } from '../../shared/roster.js';

/**
 * THE SERVER'S MIRROR of the pool rule (spec §5.6), ring L1: pure decisions,
 * type-only imports plus the ONE value import of L0's `poolRule` — which is
 * the point of the file. The rule is spelled once per LANGUAGE, not once per
 * module: `shared/poolrule.ts` holds the TypeScript spelling and both this
 * module and the PWA consume it, so a "second copy" here would be a third
 * spelling of a two-spelling rule.
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
 * miss is handled by asking the rule with a `null` account pool and then
 * RELABELLING only its `ok` arm. That is what keeps the precedence intact —
 * an `unreadable`/`malformed` tag is undecidable for everyone, roster member
 * or not, so it must still answer `pool-undecidable` here (spec §5.2's "nobody
 * decides"). A `null` account pool can never produce `pool-mismatch`, so the
 * relabel provably cannot swallow a refusal.
 */
export function poolVerdict(roster: Roster, wrapper: string, pool: ProjectPoolWire): RosterVerdict {
  const account = roster.byId.get(wrapper);
  if (account !== undefined) return poolRule(account.pool, pool);
  const v = poolRule(null, pool);
  return v.ok ? { ok: true, why: 'account-not-in-roster' } : v;
}

/**
 * The home-able accounts that may serve a project with this tag, in roster
 * declaration order — `_ws_least_loaded`'s candidate set, pool-filtered.
 *
 * EMPTY for an undecidable tag, and that is not the same fact as "every lane
 * is disabled": callers must ask {@link poolUndecidable} first if they need to
 * tell the two apart (`projectPlacement` in `limits.ts` does).
 */
export function poolEligible(roster: Roster, pool: ProjectPoolWire): AccountDef[] {
  return roster.homeAble.filter((a) => poolRule(a.pool, pool).ok);
}

/**
 * Are we in the state where NOBODY decides — `unreadable` or `malformed`?
 *
 * DERIVED FROM THE RULE, not from a second list of state tokens: an untagged
 * account is the most permissive input there is, so `poolRule(null, pool)`
 * refuses exactly when the tag itself is undecidable. A hand-written
 * `state === 'unreadable' || state === 'malformed'` here would be the second
 * copy that drifts the day a fifth state is added.
 */
export function poolUndecidable(pool: ProjectPoolWire): boolean {
  return !poolRule(null, pool).ok;
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
