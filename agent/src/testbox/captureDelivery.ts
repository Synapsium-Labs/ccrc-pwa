// The paste delivery recipe on the build capture runner (Desktop polish wave 178; task note
// docs/superpowers/programs/desktop-polish/paste-delivery.md). L1, pure and clock-free, beside `capture.ts`: what the
// delivery recipe decides before any process runs. The runner (`captureRunner.ts`) acts on it; the verdict and the result
// are `shared/deliveryCapture.ts`'s.
//
// - THE DRIVE: the build-trust drive's first two steps (the start, and the model switch before any turn, so no cache
//   dialog), then each case through the product's own send (`server/src/inject/deliveryDrive.ts`, run as a bounded child),
//   then `/exit`. The build-trust drive itself (`capture.ts#CAPTURE_STEPS`) is not changed.
// - THE STAND-IN'S REPLY: every request a short text that ends the turn, so a case's turn ends at once and nothing else
//   (a tool, an error, a subagent) is asked of the build.
// - THE WINDOW of one case: what the stand-in received and what the hooks recorded between that case's send and its
//   settle, read into `DeliveryObserved`.
// - THE TIMINGS and the recipe's worst case, under the fleet agent's fixed wait.
import { TESTBOX_CAPTURE_DEADLINE_MS, UPDATE_SPAWN_DRAIN_MS } from '../../../shared/agent-protocol.js';
import type { CaptureRecord } from '../../../shared/claudeBuildCapture.js';
import { hookEventIs } from '../../../shared/hook-events.js';
import { turnOf, type DeliveryObserved } from '../../../shared/deliveryCapture.js';
import { DELIVERY_CASE_IDS, deliveryParts } from '../../../shared/deliveryResult.js';
import { CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_STEPS, captureWorstCaseMs, type CaptureStep, type CaptureTimings, type StandInReply } from './capture.js';

// ── the drive ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The steps before the cases: the build-trust drive's start and its model switch, the same objects. */
export const DELIVERY_STEPS_BEFORE: readonly CaptureStep[] = Object.freeze(CAPTURE_STEPS.slice(0, 2));

/** The step after the cases: the build-trust drive's `/exit`, the same object. */
export const DELIVERY_STEP_AFTER: CaptureStep = CAPTURE_STEPS[CAPTURE_STEPS.length - 1]!;

/** The capture pane's size for this recipe: the fleet's (`ccd/ccd`'s spawn and `resizeWindow`), so the box the send reads
 *  wraps as a fleet session's does. The build-trust recipe keeps its own 200x50. */
export const DELIVERY_PANE = Object.freeze({ cols: 220, rows: 50 });

// ── the stand-in's reply ─────────────────────────────────────────────────────────────────────────────────────────

/** The text every delivery request is answered with. */
export const DELIVERY_REPLY_TEXT = 'ccrc delivery: ok';

/** THE delivery reply rule: a short text, whatever the request (a turn, a side request, a summary). */
export const deliveryStandInReply = (_body: unknown): StandInReply => ({ kind: 'text', text: DELIVERY_REPLY_TEXT });

// ── one case's window ────────────────────────────────────────────────────────────────────────────────────────────

/** What one case's window held: the stand-in's requests in it (in arrival order) and the hooks recorded in it, with the
 *  driver's word for the send. A request that is a turn (`turnOf`) is counted as one; every other is a side request. */
export function observeWindow(send: string, requests: readonly unknown[], records: readonly CaptureRecord[]): DeliveryObserved {
  const turns: string[] = [];
  let sideRequests = 0;
  for (const r of requests) {
    const t = turnOf(r);
    if (t === null) sideRequests += 1; else turns.push(t.prompt);
  }
  const hookPrompts = records.flatMap((r) => {
    if (r.kind !== 'hook' || !hookEventIs(r.event, 'UserPromptSubmit')) return [];
    const p = typeof r.payload === 'object' && r.payload !== null ? (r.payload as Record<string, unknown>)['prompt'] : undefined;
    return typeof p === 'string' ? [p] : [];
  });
  return { send, turns, sideRequests, hookPrompts };
}

/** Whether the case's turn has ended: a Stop or StopFailure recorded in the window. */
export const turnEnded = (records: readonly CaptureRecord[]): boolean =>
  records.some((r) => r.kind === 'hook' && (hookEventIs(r.event, 'Stop') || hookEventIs(r.event, 'StopFailure')));

// ── the timings ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The delivery recipe's own bounds, beside the capture's (`CaptureTimings`, whose step, exit, poll, tmux, stop, close,
 *  setup and removal bounds it reuses for the steps it shares). */
export interface DeliveryTimings {
  /** How long the driver child may take for one case (its node start, and `sendPrompt` with its own echo, clear and
   *  submit budgets); past it the child is killed and the capture answers no verdict. */
  readonly driveMs: number;
  /** How long, after the send, a turn may take to end (a Stop recorded). */
  readonly settleMs: number;
  /** How long the window stays open after the turn ended (or the settle bound passed), so a late second submit still
   *  falls in this case's window. */
  readonly quietMs: number;
}

export const DELIVERY_TIMINGS: DeliveryTimings = Object.freeze({ driveMs: 25_000, settleMs: 15_000, quietMs: 2_000 });

/** The worst case of one delivery capture under `t` and `d`: the setup allowance and the start (one tmux call); the two
 *  steps before (the model switch's two calls), each with its wait and one poll's overrun; per case, the driver's bound
 *  plus the child's drain, the settle bound and the quiet period, each with one poll's overrun; the `/exit` step; the exit
 *  wait; and the teardown, as `capture.ts#captureWorstCaseMs` counts it. */
export function deliveryWorstCaseMs(t: CaptureTimings, d: DeliveryTimings = DELIVERY_TIMINGS, cases: number = DELIVERY_PART_LARGEST): number {
  const call = t.tmuxCallMs + UPDATE_SPAWN_DRAIN_MS;
  const step = (s: CaptureStep): number => (s.type === null ? 0 : 2 * call) + t.stepMs + t.pollMs;
  const start = t.setupMs + call;
  const before = DELIVERY_STEPS_BEFORE.reduce((ms, s) => ms + step(s), 0);
  const perCase = d.driveMs + UPDATE_SPAWN_DRAIN_MS + d.settleMs + t.pollMs + d.quietMs + t.pollMs;
  const exit = t.exitMs + t.pollMs;
  const teardown = call + t.stopWaitMs + t.pollMs + t.standInCloseMs + t.removeMs;
  return start + before + cases * perCase + step(DELIVERY_STEP_AFTER) + exit + teardown;
}

/** The largest part's case count: a delivery capture runs one part (`shared/deliveryResult.ts#deliveryParts`), and the
 *  parts are split evenly, the larger first. */
export const DELIVERY_PART_LARGEST = deliveryParts()[0]!.length;

/** The pair bound (review 3226 F8): a capture with one capture ahead of it in the queue ends, with the margin, before the
 *  fleet agent stops waiting. */
const pairFits = (aheadMs: number, ownMs: number): boolean => aheadMs + ownMs + CAPTURE_DEADLINE_MARGIN_MS <= TESTBOX_CAPTURE_DEADLINE_MS;

/** THE derivation of the delivery recipe's part count (the capture owner's call 1148): the smallest count whose largest
 *  part, with the cases split evenly, fits the pair bound in every pairing (trust then trust, trust then a part, a part
 *  then trust, a part then a part), under `t`. `null` when no count fits, which is a timing a release must not ship.
 *  `shared/deliveryResult.ts#DELIVERY_PART_COUNT` is held equal to this by an agent test that goes red on any drift, either way. */
export function deliveryPartCount(t: CaptureTimings, d: DeliveryTimings = DELIVERY_TIMINGS, cases: number = DELIVERY_CASE_IDS.length): number | null {
  const trust = captureWorstCaseMs(t);
  for (let k = 1; k <= cases; k++) {
    const part = deliveryWorstCaseMs(t, d, Math.ceil(cases / k));
    // A pair's time is a sum, so trust then a part and a part then trust are one check, and it never exceeds twice the
    // longer of the two: when both same-kind pairs fit, every mixed pair does too.
    if (pairFits(trust, trust) && pairFits(part, part)) return k;
  }
  return null;
}

/** Whether a delivery capture that has waited `waitedMs` must not start (the late check of `capture.ts#captureStartsLate`,
 *  on this recipe's worst case). */
export function deliveryStartsLate(waitedMs: number, t: CaptureTimings, d: DeliveryTimings = DELIVERY_TIMINGS, deadlineMs: number = TESTBOX_CAPTURE_DEADLINE_MS): boolean {
  return waitedMs + deliveryWorstCaseMs(t, d) + CAPTURE_DEADLINE_MARGIN_MS > deadlineMs;
}
