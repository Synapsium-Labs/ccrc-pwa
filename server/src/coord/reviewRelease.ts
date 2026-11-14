// D-8293 (spec 2026-10-20-workspace-disk-and-registry-truth §2.6, amended): A REVIEW CHILD PAST ITS CEILING IS AN ITEM WITH ITS
// OWN CONTROL. D-5942 named the keep on the banner (`review-report-stale`) once a review's own run had been closed seven days
// while the run it reviewed stayed open, and nothing could end that keep but the reviewed run's close. This file adds the
// release, as the "action sits on the item" ruling asks: the child reclaim sweep raises ONE Waiting on you item per review run
// (`release-review`, raised by ccrc), held first for the coordinator the way a refused close is (`askNotifyAt`), whose one
// control, Release, is the operator's `act` (`POST /api/items/:id/act`). The act is the release: `CoordStore.reviewChildReleased`
// reads it back, the sweep's verdict stops keeping the child for that run (`childReclaimReviewedRun`), and the ordinary reclaim
// takes the workspace, which pins its work under attic refs before anything is removed. Nothing here removes anything.
//
// The coordinator's ways out are the ones it already has: closing or abandoning the reviewed run releases the child and settles
// the item (the item's `runId` is that run, so its close settles it as every action item of a run is settled), and a coordinator
// that still cites the report withdraws the item inside the hold. An item is raised once per review run and never again, so a
// withdraw is not undone by the next pass.
//
// `reviewReleasePlan` decides (pure); `routeReviewReleases` does what it says, called once per judging pass by the sweep. A
// doubt or a hold this pass is not "the reason has gone": only a definite verdict settles an item.
import { askGraceSeconds, askNotifyAt } from '../askwindow.js';
import { MAIL_SUBJECT_MAX_BYTES } from '../../../shared/api.js';
import { ITEM_TITLE_MAX, isReleaseReviewAction, itemRunName, releaseReviewAction, type ReleaseReviewAction } from '../../../shared/ledgers.js';
import { CHILD_RECLAIM_SKIP, type ChildReclaimSweepVerdict } from '../childReclaimSweep.js';
import { readCoordinatorOfRun } from './bindingReads.js';
import type { WatcherCoordPort } from './ports.js';
import { insertSystemMailTx } from './rundefsTx.js';

/** One review child the pass judged `review-report-stale`: the child, the review run that minted it and the run it reviewed. */
export interface ReviewReleaseSighting {
  readonly sessionId: string;
  readonly reviewRunId: number;
  readonly reviewedRunId: number;
}

/** What one judging pass does: the items to raise, and the open items to settle with their note. */
export interface ReviewReleasePlan {
  readonly raise: readonly ReviewReleaseSighting[];
  readonly settle: readonly { readonly id: number; readonly note: string }[];
}

/** The notes an item settles with. */
export const REVIEW_RELEASE_GONE_NOTE = 'The workspace is no longer a marked child.';
export const REVIEW_RELEASE_HANDLED_NOTE = 'The run it reviewed no longer keeps the workspace.';

/** The item's step words. */
export const REVIEW_RELEASE_HOW: readonly string[] = [
  'Release the workspace: ccrc stops keeping it for the run it reviewed and reclaims it on its next passes, pinning its work under attic refs first.',
  'Or leave it: closing or abandoning the run it reviewed releases it too.',
];

/** Does this verdict leave the item's question open? The same review still kept past its ceiling, or a pass that could not say
 *  (a doubt), or a hold that stands (the release still matters once it lapses). Every other verdict answers it. */
function stillAsks(v: ChildReclaimSweepVerdict, action: ReleaseReviewAction): boolean {
  if (v.eligible) return false;
  if (v.why === 'review-report-stale') return v.runId === action.reviewRunId;
  const cls = CHILD_RECLAIM_SKIP[v.why].class;
  return cls === 'doubt' || cls === 'held';
}

/** THE DECIDER. `judged` is every marked child this pass judged, by id; a child absent from it is no longer a marked child.
 *  `raised` answers whether an item was ever raised for a review run, in any state. Pure. */
export function reviewReleasePlan(i: {
  readonly sightings: readonly ReviewReleaseSighting[];
  readonly judged: ReadonlyMap<string, ChildReclaimSweepVerdict>;
  readonly open: readonly { readonly id: number; readonly action: ReleaseReviewAction }[];
  readonly raised: (reviewRunId: number) => boolean;
}): ReviewReleasePlan {
  const raise: ReviewReleaseSighting[] = [];
  const seen = new Set<number>();
  for (const s of i.sightings) {
    if (seen.has(s.reviewRunId)) continue;
    seen.add(s.reviewRunId);
    if (i.open.some((o) => o.action.reviewRunId === s.reviewRunId) || i.raised(s.reviewRunId)) continue;
    raise.push(s);
  }
  const settle: { id: number; note: string }[] = [];
  for (const o of i.open) {
    const v = i.judged.get(o.action.sessionId);
    if (v === undefined) settle.push({ id: o.id, note: REVIEW_RELEASE_GONE_NOTE });
    else if (!stillAsks(v, o.action)) settle.push({ id: o.id, note: REVIEW_RELEASE_HANDLED_NOTE });
  }
  return { raise, settle };
}

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** The notice the reviewed run's coordinator gets when the item is raised and held for it. It names the item, because the held
 *  item is on no list the coordinator reads: without the id it cannot withdraw it. */
export function reviewReleaseAskMail(r: {
  itemId: number; sessionId: string; reviewRunId: number; reviewedRunId: number; reviewName: string; graceSeconds: number;
}): { subject: string; body: string } {
  let subject = [...`review workspace kept: item ${r.itemId}: run ${r.reviewRunId}`];
  while (subject.length > 0 && bytes(subject.join('')) > MAIL_SUBJECT_MAX_BYTES) subject = subject.slice(0, -1);
  const body = [
    `The workspace ${r.sessionId} of review run ${r.reviewRunId} (${r.reviewName}) has been kept more than seven days after that review closed, because the run it reviewed, run ${r.reviewedRunId}, is still open.`,
    `In ${r.graceSeconds} seconds the operator is asked to release it. If you no longer cite its report, do nothing, or close or abandon run ${r.reviewedRunId}.`,
    'If you still cite the report, withdraw the item with your identity in the body, and the workspace stays kept:',
    `"$API" items withdraw ${r.itemId} --json - <<JSON`,
    '{"byId":"<your id>","byUuid":"<your uuid>"}',
    'JSON',
  ].join('\n');
  return { subject: subject.join(''), body };
}

/** The line the item's why ends in: who it reached the operator through. */
export const reviewReleaseOrigin = (held: boolean): string => (held ? 'Its coordinator did not answer' : 'No coordinator on record');

export interface ReviewReleaseDeps {
  readonly coord: WatcherCoordPort;
}

/** What a pass did, for its tests and its log. */
export interface ReviewReleaseOutcome { readonly raised: readonly number[]; readonly settled: readonly number[] }

/** Raise and settle as `reviewReleasePlan` says. SYNCHRONOUS, and called once per judging pass after the verdicts. Never throws:
 *  an item that cannot be raised or settled is warned and decided again next pass. */
export function routeReviewReleases(
  deps: ReviewReleaseDeps, sightings: readonly ReviewReleaseSighting[], judged: ReadonlyMap<string, ChildReclaimSweepVerdict>, now: number,
): ReviewReleaseOutcome {
  const { coord } = deps;
  const raised: number[] = [];
  const settled: number[] = [];
  let plan: ReviewReleasePlan;
  try {
    const open = coord.openReleaseReviewItems().flatMap((it) => (isReleaseReviewAction(it.action) ? [{ id: it.id, action: it.action }] : []));
    plan = reviewReleasePlan({ sightings, judged, open, raised: (id) => coord.releaseReviewItemRaised(id) });
  } catch (err) {
    console.warn(`ccrc-server: reviewRelease: the items could not be read (${err instanceof Error ? err.message : String(err)}) — decided again next pass`);
    return { raised, settled };
  }
  for (const s of plan.raise) {
    try {
      const reviewed = coord.run(s.reviewedRunId);
      const review = coord.run(s.reviewRunId);
      if (!reviewed.ok || reviewed.run === null || !review.ok || review.run === null) continue;
      const claim = readCoordinatorOfRun(coord, s.reviewedRunId);
      if (!claim.ok) continue;
      const coordinator = claim.id;
      const reviewName = itemRunName(review.run);
      const why = [
        `This review's workspace (${s.sessionId}) is kept because the run it reviewed, run ${s.reviewedRunId}, is still open, `
          + `though the review's own run ${s.reviewRunId} closed more than seven days ago. Its coordinator may still cite the report; nothing else keeps the workspace.`,
        reviewReleaseOrigin(coordinator !== null),
      ].join('\n');
      const input = {
        program: reviewed.run.program, runId: s.reviewedRunId, raisedBy: 'ccrc', kind: 'do' as const,
        title: [...`Review workspace kept: ${reviewName}`].slice(0, ITEM_TITLE_MAX).join(''),
        why, how: [...REVIEW_RELEASE_HOW], options: null, neededBy: 'later' as const, soonLabel: null, secretSlot: null,
        action: releaseReviewAction(s.reviewedRunId, s.reviewRunId, s.sessionId),
        heldUntil: coordinator === null ? null : askNotifyAt(now),
      };
      const out = coord.raiseItemWithMail(input, now, 'ccrc', (itemId) => {
        if (coordinator === null) return null;
        const mail = reviewReleaseAskMail({ itemId, sessionId: s.sessionId, reviewRunId: s.reviewRunId, reviewedRunId: s.reviewedRunId,
          reviewName, graceSeconds: askGraceSeconds() });
        return insertSystemMailTx(coord, null, { fromId: 'operator', toId: coordinator, runId: null, kind: 'status',
          subject: mail.subject, body: mail.body, wake: 'never' });
      });
      raised.push(out);
    } catch (err) {
      console.warn(`ccrc-server: reviewRelease: the item for review run ${s.reviewRunId} could not be raised `
        + `(${err instanceof Error ? err.message : String(err)}) — raised again next pass`);
    }
  }
  for (const s of plan.settle) {
    try {
      const res = coord.moveItem(s.id, 'settle', 'ccrc', { note: s.note }, now, { programmeHasOpenRun: true });
      if (res.ok) settled.push(s.id);
    } catch (err) {
      console.warn(`ccrc-server: reviewRelease: item ${s.id} could not be settled (${err instanceof Error ? err.message : String(err)}) — settled next pass`);
    }
  }
  return { raised, settled };
}
