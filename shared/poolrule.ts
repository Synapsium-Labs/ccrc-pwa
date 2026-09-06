// The one TypeScript spelling of the pool rule (design §5.2):
//
//   An account `a` may serve a project `p` iff pool(a) is null, or pool(p) is
//   null, or pool(a) === pool(p). If pool(p) cannot be read, NOBODY DECIDES.
//
// L0, like every other module in `shared/`: it imports nothing but TYPES,
// not even `node:*`, because the PWA bundles this file. That is not a formality here —
// it is the whole reason the rule lives in `shared/` rather than under
// `server/src/`. The server's 409 pre-check (wave 3) and the phone's "show
// other pools" disclosure (wave 4) will be two renderings of ONE decision, and
// two copies of it would drift; the copy the phone showed would then offer a
// swap the copy the API enforces refuses, which is the failure the shared
// fixture table (`server/test/fixtures/poolRule.ts`) exists to make impossible.
// `ccd`'s bash `_pool_ok` will be the other spelling (wave 2a) — it cannot
// share code across the language boundary, so it shares that same table
// instead. Nothing outside this wave imports this function yet; every consumer
// named in this file is an obligation on the wave that names it, not a report.
// (D-1664 — plan-time refinement of spec §5.2/§8.)
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
import type { ProjectPoolWire } from './api.js';

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
 */
export type PoolVerdict =
  | { ok: true; why: 'untagged-project' | 'untagged-account' | 'same-pool' }
  | { ok: false; reason: 'pool-mismatch'; accountPool: string; projectPool: string }
  | { ok: false; reason: 'pool-undecidable'; state: 'unreadable' | 'malformed' };

/**
 * The rule, once.
 *
 * `accountPool` is `null` for an untagged account — and, deliberately, also for
 * an account THIS SIDE CANNOT SEE. The PWA will read it through `accountPool`
 * (`pwa/src/lib/accounts.ts`, wave 4), which must answer `null` for a wrapper the
 * roster on the wire does not carry, and that fold is the permissive direction on
 * purpose:
 * `ccd`'s `_is_valid_wrapper` is the authority on which wrappers exist, the
 * server's roster copy can lag the fleet's, and a display that HID a live
 * non-roster account would be worse than one that offers it and lets `ccd`
 * refuse. The fold is disclosed here rather than left for a reader to discover.
 */
export function poolRule(accountPool: string | null, projectPool: ProjectPoolWire): PoolVerdict {
  if (projectPool.state === 'unreadable' || projectPool.state === 'malformed') {
    return { ok: false, reason: 'pool-undecidable', state: projectPool.state };
  }
  if (projectPool.state === 'untagged') return { ok: true, why: 'untagged-project' };
  if (accountPool === null) return { ok: true, why: 'untagged-account' };
  return accountPool === projectPool.name
    ? { ok: true, why: 'same-pool' }
    : { ok: false, reason: 'pool-mismatch', accountPool, projectPool: projectPool.name };
}
