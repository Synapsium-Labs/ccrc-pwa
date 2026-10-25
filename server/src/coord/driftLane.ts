// THE DRIFT RECONCILER'S LANE (coordinator-durability tail spec §4.1, §4.3 to §4.5; D-5922; #760). L4: it gathers
// plain rows, hands them to the decider (`drift.ts`) and the budget (`driftPush.ts`), records the findings and tells
// the operator through the notice funnel. It decides nothing itself.
//
// THE RECONCILER NEVER ACTS. Its only store writers are `recordDriftPass`, `markDriftPushed` and `markDriftShadowed`;
// it never mails a session, calls a door, closes, abandons, reclaims, re-dispatches or restarts. The funnel's own
// archive write is the one other row, and the funnel's, not the lane's.
//
// ARMING: while `drift-push-live` is absent the lane is SHADOW: it records the findings (state only) and raises ONE
// record-only notice naming what it would have pushed, once per key (`shadowAt`); nothing reaches the operator's
// phone. The marker is hand-armed and nothing in the tree writes it.
import type { ChildMark } from '../../../shared/api.js';
import { DRIFT_PUSH_LIVE_MARKER } from '../../../shared/switches.js';
import type { ClaimantReading } from '../deadCoordinator.js';
import type { NoticeSink } from '../notice.js';
import { deadCoordinatorLaneArmed } from './endDeadCoordinator.js';
import { driftFindings, type DriftInput, type DriftWorkerRow } from './drift.js';
import { chooseDriftPushes } from './driftPush.js';
import { childBirthOf } from './childSpent.js';
import { childParentOf, incarnationOf } from './runBinding.js';
import type { CoordStore } from './store.js';

/** The lane's two fixed notice tags: the summary push and the shadow notice. A tag names a ring row, never a
 *  `refused` or `reject.code`; an item's tag is `drift-<key>`, built from the finding's key. */
export const DRIFT_LANE_TAGS = { summary: 'drift-summary', shadow: 'drift-shadow' } as const;

/** True when `v` is one of the lane's fixed notice tags (the mail-routes kebab census reads it). */
export function isDriftLaneTag(v: string): boolean {
  return Object.values(DRIFT_LANE_TAGS).some((t) => t === v);
}

export interface DriftLaneDeps {
  readonly coord: Pick<CoordStore, 'driftOpenRuns' | 'driftOutstandingDeliveries' | 'driftAwaitingReview'
    | 'driftHeldQuestions' | 'driftFindingRows' | 'driftStallToldRows' | 'driftPushesOnDay' | 'parentOfSession' | 'bindingRunsOf' | 'run'
    | 'recordDriftPass' | 'markDriftPushed' | 'markDriftShadowed'>;
  /** The reclaim ladder's verdict for one claimant (`measureClaimant`, bound by the watcher): no second vocabulary. */
  readonly measure: (id: string, at: number) => Promise<ClaimantReading>;
  /** The child marks off the last LISTED registry read, or null when none was listed. */
  readonly childMarks: ReadonlyMap<string, ChildMark> | null;
  /** The registry listing's names, or null when it could not be listed: then nothing is recorded or cleared. */
  readonly names: readonly string[] | null;
  readonly notice: NoticeSink;
  readonly warn: (line: string) => void;
}

const DAY_MS = 86_400_000;

/** The stored kinds this process already warned it cannot name: one warn per kind, not one per pass. */
const warnedUnknownKinds = new Set<string>();

/** One pass. Never throws: a bad read warns and the next pass retries. */
export async function runDriftPass(d: DriftLaneDeps, now: number): Promise<void> {
  try {
    await pass(d, now);
  } catch (err) {
    d.warn(`ccrc-server: sweepDrift: ${err instanceof Error ? err.message : String(err)} — nothing recorded this pass`);
  }
}

async function pass(d: DriftLaneDeps, now: number): Promise<void> {
  if (d.names === null) return; // an unreadable registry listing records nothing and clears nothing
  const runs = d.coord.driftOpenRuns();
  const deliveries = d.coord.driftOutstandingDeliveries();
  const reviews = d.coord.driftAwaitingReview();
  const asks = d.coord.driftHeldQuestions();
  const before = d.coord.driftFindingRows();
  const told = d.coord.driftStallToldRows();
  for (const r of [runs, deliveries, reviews, asks, before, told]) {
    if (!r.ok) { d.warn(`ccrc-server: sweepDrift could not read the coordination store (${r.detail}) — nothing recorded this pass`); return; }
  }
  if (!runs.ok || !deliveries.ok || !reviews.ok || !asks.ok || !before.ok || !told.ok) return;
  for (const k of before.unknownKinds) {
    if (warnedUnknownKinds.has(k)) continue;
    warnedUnknownKinds.add(k);
    d.warn(`ccrc-server: sweepDrift skips stored findings of kind '${k}', which this build does not know — they clear`);
  }

  const claimants = new Map<string, ClaimantReading>();
  const ids = new Set<string>();
  for (const r of [...runs.rows, ...reviews.rows]) if (r.claimedBy !== null) ids.add(r.claimedBy);
  for (const id of ids) {
    try { claimants.set(id, await d.measure(id, Date.now())); } catch { /* unmeasured: no finding for it */ }
  }
  const claimedBy = new Map(runs.rows.map((r) => [r.id, r.claimedBy]));
  const workers: DriftWorkerRow[] = [];
  for (const [sessionId, mark] of d.childMarks ?? []) {
    if (mark.kind !== 'child') continue;
    // The worker's incarnation, from the birth the run its mark names recorded: a reused name has no ghost parent (ARCH-62).
    const minting = d.coord.run(mark.runId);
    const incarnation = incarnationOf(sessionId, childBirthOf(minting, sessionId));
    const proven = d.coord.parentOfSession(sessionId, incarnation);
    const parentId = proven !== null || !minting.ok || minting.run === null ? proven
      : childParentOf(proven, d.coord.bindingRunsOf(sessionId), minting.run.claimedBy, incarnation);
    workers.push({ sessionId, markRunId: mark.runId, parentId,
      // The mark's run may be closed and so absent from `runs.rows`; its claimant is the minting run's own.
      runClaimedBy: claimedBy.get(mark.runId) ?? (minting.ok ? minting.run?.claimedBy ?? null : null) });
  }
  const input: DriftInput = { runs: runs.rows, claimants, deliveries: deliveries.rows, reviews: reviews.rows,
    asks: asks.rows, workers, approvals: [] };
  const found = driftFindings(input, now);
  const tableWasEmpty = before.rows.length === 0;
  d.coord.recordDriftPass(found, now);

  const after = d.coord.driftFindingRows();
  if (!after.ok) { d.warn(`ccrc-server: sweepDrift could not re-read its findings (${after.detail}) — no push this pass`); return; }
  const plan = chooseDriftPushes({
    rows: after.rows, tableWasEmpty, armed: d.names.includes(DRIFT_PUSH_LIVE_MARKER),
    deadCoordinatorArmed: deadCoordinatorLaneArmed(d.names),
    told: {
      quietRuns: new Set(told.rows.filter((t) => t.arm === 'quiet').map((t) => t.runId)),
      stuckDeliveries: new Set(told.rows.filter((t) => t.arm === 'mail-stuck').map((t) => t.key)),
    },
    escalatedDeliveries: new Set(deliveries.rows.filter((x) => x.parkEscalatedAt !== null).map((x) => x.id)),
    pushedToday: d.coord.driftPushesOnDay(now - (now % DAY_MS)), now,
  });
  const day = new Date(now).toISOString().slice(0, 10);

  if (plan.summary.length > 0) {
    // Stamp before the push, so a restart between the two never pushes the same keys again.
    const won = d.coord.markDriftPushed(plan.summary.map((r) => r.key), now, 'summary');
    if (won.length > 0) {
      d.notice({ kind: 'coord', sessionId: '', runId: null, title: 'Out of step',
        body: `${won.length} ${won.length === 1 ? 'item is' : 'items are'} out of step; see today's digest` },
      'push', { tag: DRIFT_LANE_TAGS.summary, url: `/digest?day=${day}` });
    }
  }
  for (const r of plan.items) {
    if (d.coord.markDriftPushed([r.key], now, 'item').length === 0) continue;
    const url = r.runId !== null ? '/runs' : r.sessionId !== null ? `/s/${r.sessionId}` : `/digest?day=${day}`;
    // 'record-always': `pushedAt` is already stamped, so a session kind chosen while the operator views that session
    // must still leave its Inbox row (in 'push' the funnel would drop it, and the finding would never be told).
    d.notice({ kind: 'coord', sessionId: r.sessionId ?? '', runId: r.runId, title: 'Out of step', body: r.detail },
      'record-always', { tag: `drift-${r.key}`, url });
  }
  if (plan.shadow.length > 0) {
    const won = d.coord.markDriftShadowed(plan.shadow.map((r) => r.key), now);
    if (won.length > 0) {
      const lines = plan.shadow.filter((r) => won.includes(r.key)).map((r) => r.detail).join('; ');
      d.notice({ kind: 'coord', sessionId: '', runId: null, title: 'Drift reconciler (shadow)',
        body: `would have pushed ${won.length} ${won.length === 1 ? 'item' : 'items'} out of step: ${lines}` },
      'record-only', { tag: DRIFT_LANE_TAGS.shadow });
    }
  }
}
