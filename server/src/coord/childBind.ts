import { readSessionRecord } from '../registry.js';
import { childBirthOf, childSpent, type ChildBirthRunRead, type ChildSpentDeps } from './childSpent.js';

/** The port the gate reads a child's BIRTH through — declared HERE, by its
 *  consumer (L2): one run row by id, answered as `CoordStore.run` answers
 *  (row, no row, or unreadable). `CoordStore` satisfies it structurally, so
 *  both doors hand over the store they already hold and `store.ts` owes this
 *  gate nothing. */
export interface ChildBindRuns { run(id: number): ChildBirthRunRead }

/**
 * Rule 3's verdict for one bind (child-reclamation spec §5.4). `ok: true` is
 * a workspace that is not a child — no marker, or no registry row, which is
 * today's behaviour — or a child that has had no PR of its OWN incarnation
 * (every PR on its branch provably predates its birth). The two refusals are
 * the two `RunRefuseCode`s of the same names; `shared/api.ts` argues why they
 * are two.
 */
export type ChildBindVerdict =
  | { readonly ok: true }   // not a child (no marker, or no registry row — today's behaviour), or an unspent child
  | { readonly ok: false; readonly code: 'workspace-spent'; readonly pr: number }
  | { readonly ok: false; readonly code: 'spent-unmeasured'; readonly detail: string };

/**
 * THE ONE GATE both doors call — `POST /api/runs` naming a `sessionId`
 * (`coord/routes.ts`) and dispatch's resume arm (`coord/dispatch.ts`) — so the
 * two cannot drift into two readings of one rule.
 *
 * It re-reads the registry at the instant it decides, never a snapshot:
 * `readSessionRecord` costs one listing plus that session's field reads, 32
 * [registry-read-census:single] agent-WS operations in remote mode. Its
 * answers, and none folds into another:
 *   - a listing that FAILED → `spent-unmeasured`: it proves nothing about this
 *     session, so it cannot be "no row". This holds for ANY `sessionId`,
 *     marked or not — the one place the gate changes the non-child path,
 *     because it cannot tell a non-child from a child without the listing;
 *   - `absent` → ONE MORE LISTING, because `absent` is two populations
 *     (`readSessionRecord`'s own docstring): no `.uuid` in the listing, and a
 *     row `buildRecord` DROPPED (an identity field read back empty, or
 *     listed-then-gone) or the reconfirm listing lost. The second can be a
 *     MARKED child. A `.child` the listing names with no row built around it
 *     → `spent-unmeasured`; no `.child` → `ok` (no registry row; the open or
 *     the `ensure` that follows answers for it exactly as it always has); a
 *     failed listing → `spent-unmeasured`. Paid only on a miss;
 *   - `child.kind === 'none'` → `ok`: non-children are untouched, even one
 *     whose branch has had a PR;
 *   - `child.kind === 'unreadable'` → `spent-unmeasured`: a bind REFUSES what
 *     it cannot read (wave 3's reclaim will DEFER on the same answer).
 * A child is then asked `childSpent`, whose three answers map one to one —
 * with its BIRTH, read from the minting run its marker names (`runs.run(
 * mark.runId)`, through `childBirthOf`). A spent answer refuses in EITHER
 * incarnation: `this` and `unplaced` alike (spec §5.3). A bind does not date
 * the fast path, and an undated row — an older ccd's, or one against a birth
 * that cannot be placed — refuses exactly as every spent row did before
 * placement existed. Only a row proven to predate the birth stops counting.
 */
export async function childBindGate(
  deps: ChildSpentDeps, runs: ChildBindRuns, sessionId: string,
): Promise<ChildBindVerdict> {
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  if (!read.found) {
    if (read.reason === 'unlistable') {
      return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
    }
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
    if (names.includes(`${sessionId}.child`)) {
      return { ok: false, code: 'spent-unmeasured',
        detail: 'the child marker is listed but its registry row could not be built' };
    }
    return { ok: true };
  }
  const mark = read.record.child;
  if (mark.kind === 'none') return { ok: true };
  if (mark.kind === 'unreadable') {
    return { ok: false, code: 'spent-unmeasured', detail: 'the child marker could not be read' };
  }
  const birth = childBirthOf(runs.run(mark.runId), sessionId);
  const spent = await childSpent(deps, read.record, birth);
  if (spent.kind === 'spent') return { ok: false, code: 'workspace-spent', pr: spent.pr };
  if (spent.kind === 'unmeasured') return { ok: false, code: 'spent-unmeasured', detail: spent.detail };
  return { ok: true };
}
