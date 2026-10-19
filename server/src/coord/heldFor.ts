/**
 * WHO A CHILD'S QUESTION OR PERMISSION PROMPT IS HELD FOR (coordinator-first routing spec 2026-10-17 §5.2 and §6.3
 * server step 1, D-5290, D-5362, D-5530, D-5531). One decision, two lanes: `watch.ts`'s `tryHold` (questions) and
 * `POST /api/approvals` (permission prompts) both read it, so the asks lane and the approvals lane hold for the same
 * claimant and fail closed for the same reasons, in the same words.
 *
 * The rule (D-5530, the operator's ruling of 2026-10-18): a child's prompt is held for its run's recorded, ATTRIBUTED
 * claimant wherever that claimant sits. No project is compared, and no registry `project` is read. In order:
 *  - `not-a-child`: the registry's `ChildMark` is not `{kind: 'child', runId}`; the session is its own claimant (the
 *    self-claim guard); the run the mark names does not exist; or no open run names the session at all (spec §4).
 *    Nothing is minted: the prompt raises to the operator as today.
 *  - `released`, held for nobody (parent `ASK_OPERATOR_PRINCIPAL`): `run-unclaimed` (the newest open run naming the
 *    child, or the run the mark names, records no claimant), `run-other-programme` (the run the mark names is claimed
 *    by someone other than the newest open run's claimant, D-5362's comparison), `run-unattributed` (D-5531: the run
 *    the mark names is journaled `unattributed` or carries no `coordProject` stamp, so its claimant was never proven).
 *  - `released`, held for the claimant but not live (parent kept, so the journal names it): `parent-not-live` (no
 *    registry row, archived, stopped, or measured dead by `claimantMeasuredDead`, the dead-coordinator sweep's
 *    predicate) or `parent-unmeasured` (the claimant ladder answered `unmeasurable`: doubt is not a hold).
 *  - `held`, for the claimant.
 *
 * L3: it reads the store and the claimant ladder and returns a verdict; the caller mints and pushes. A store read that
 * fails THROWS, and both callers already fall back to the operator on a throw.
 */
import { ASK_OPERATOR_PRINCIPAL, type AskMintReleaseReason, type ChildMark } from '../../../shared/api.js';
import type { SessionRecord } from '../registry.js';
import { claimantMeasuredDead, measureClaimant, type ReclaimDeps } from './reclaim.js';

export type HeldFor =
  | { readonly kind: 'not-a-child' }
  | { readonly kind: 'held'; readonly parent: string; readonly runId: number }
  | { readonly kind: 'released'; readonly parent: string; readonly runId: number; readonly reason: AskMintReleaseReason };

export async function heldFor(
  deps: ReclaimDeps, childId: string, mark: ChildMark, recs: readonly Pick<SessionRecord, 'id' | 'archivedAt' | 'stopped'>[],
  nowMs: number,
): Promise<HeldFor> {
  const notAChild = { kind: 'not-a-child' } as const;
  if (mark.kind !== 'child') return notAChild;
  const coord = deps.coord;
  const parent = coord.parentOfSession(childId);
  if (parent === childId) return notAChild;
  // D-5362: the binding is "the parent is the claimant of the run the mark names", not "the mark names the newest
  // open run": a wave N >= 2 run resumes the same workspace, whose `.child` still names wave 1.
  const minting = coord.run(mark.runId);
  if (!minting.ok) throw new Error(`heldFor: ${minting.detail}`);
  if (minting.run === null) return notAChild;
  const runId = mark.runId;
  const nobody = (reason: AskMintReleaseReason): HeldFor => ({ kind: 'released', parent: ASK_OPERATOR_PRINCIPAL, runId, reason });
  if (parent === null) {
    // No claimant on the newest open run naming the child — or no open run at all, which is not a child (spec §4).
    const sib = coord.openRunsForSession(childId);
    if (!sib.ok) throw new Error(`heldFor: ${sib.detail}`);
    if (sib.siblings.length === 0) return notAChild;
    return nobody('run-unclaimed');
  }
  if (minting.run.claimedBy === null) return nobody('run-unclaimed');
  if (minting.run.claimedBy !== parent) return nobody('run-other-programme');
  // D-5531: the binding run's claimant was never attributed, wherever it sits. Fail closed.
  if (minting.run.unattributed || minting.run.coordProject === null) return nobody('run-unattributed');
  const row = recs.find((x) => x.id === parent) ?? null;
  if (row === null || row.archivedAt !== null || row.stopped !== null) {
    return { kind: 'released', parent, runId, reason: 'parent-not-live' };
  }
  const verdict = await measureClaimant(deps, parent, nowMs);
  if (claimantMeasuredDead(verdict)) return { kind: 'released', parent, runId, reason: 'parent-not-live' };
  if (verdict.state === 'unmeasurable') return { kind: 'released', parent, runId, reason: 'parent-unmeasured' };
  return { kind: 'held', parent, runId };
}
