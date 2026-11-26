// The box frames recipe on the build capture runner (Desktop polish wave 187; plan docs/superpowers/plans/2026-11-26-box-frames-recipe.md).
// L1, pure: what the frames recipe decides before any process runs, beside `captureDelivery.ts`. The runner
// (`captureRunner.ts`) acts on it; the cases, the reducer and the result are `shared/framesCapture.ts`'s and
// `shared/framesResult.ts`'s.

import { TESTBOX_CAPTURE_DEADLINE_MS, UPDATE_SPAWN_DRAIN_MS } from '../../../shared/agent-protocol.js';
import { FRAMES_HOLD_MARK, FRAMES_REPLY_TEXT, framesDriveSteps } from '../../../shared/framesCapture.js';
import { FRAMES_PARTS } from '../../../shared/framesResult.js';
import { CAPTURE_DEADLINE_MARGIN_MS, type CaptureStep, type CaptureTimings, type StandInReply } from './capture.js';
import { DELIVERY_STEPS_BEFORE, DELIVERY_STEP_AFTER } from './captureDelivery.js';

// ── the stand-in's reply ─────────────────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The text of a request's LAST user message (a string is one text block), or ''. */
function lastUserText(body: unknown): string {
  if (!isObj(body) || !Array.isArray(body['messages'])) return '';
  const messages = body['messages'] as unknown[];
  const last = messages[messages.length - 1];
  if (!isObj(last) || last['role'] !== 'user') return '';
  const c = last['content'];
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(isObj).filter((b) => b['type'] === 'text' && typeof b['text'] === 'string').map((b) => b['text'] as string).join('\n');
}

/** THE frames reply rule, for a stand-in that holds a marked turn for `holdMs`: a short text for every request, and the
 *  same text with `holdMs` when the request's last user message carries `FRAMES_HOLD_MARK`. */
export const framesStandInReplyOf = (holdMs: number) => (body: unknown): StandInReply =>
  (lastUserText(body).includes(FRAMES_HOLD_MARK)
    ? { kind: 'text', text: FRAMES_REPLY_TEXT, holdMs }
    : { kind: 'text', text: FRAMES_REPLY_TEXT });

/** The frames reply rule with no hold: every request a short text, the marked turn included. */
export const framesStandInReply = (_body: unknown): StandInReply => ({ kind: 'text', text: FRAMES_REPLY_TEXT });

// ── the timings ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The worst case of one frames capture (one part) under `t`: the setup allowance and the start; the two steps before
 *  (the delivery recipe's, so the same objects); per drive step, its driver bound (the person's for `person`), the kill
 *  grace and one drain, and for a send that ends a turn its settle and quiet, for the held turn its settle, each with one
 *  poll's overrun; then the `/exit` step, the exit wait and the teardown, as `capture.ts#captureWorstCaseMs` counts them. */
export function framesWorstCaseMs(t: CaptureTimings, part: number): number {
  const call = t.tmuxCallMs + UPDATE_SPAWN_DRAIN_MS;
  const step = (s: CaptureStep): number => (s.type === null ? 0 : 2 * call) + t.stepMs + t.pollMs;
  const start = t.setupMs + call;
  const before = DELIVERY_STEPS_BEFORE.reduce((ms, s) => ms + step(s), 0);
  const drive = framesDriveSteps(part).reduce((ms, s) => {
    const run = (s.kind === 'person' ? t.framesPersonDriveMs : t.framesDriveMs) + t.deliveryKillGraceMs + UPDATE_SPAWN_DRAIN_MS;
    const wait = s.kind === 'turn' || s.kind === 'send' ? t.deliverySettleMs + t.pollMs + t.deliveryQuietMs + t.pollMs
      : s.kind === 'held' ? t.deliverySettleMs + t.pollMs : 0;
    return ms + run + wait;
  }, 0);
  const exit = t.exitMs + t.pollMs;
  const teardown = call + t.stopWaitMs + t.pollMs + t.standInCloseMs + t.removeMs;
  return start + before + drive + step(DELIVERY_STEP_AFTER) + exit + teardown;
}

/** The longest part's worst case: the busy point a trust capture may wait behind. */
export const framesLongestMs = (t: CaptureTimings): number => FRAMES_PARTS.reduce((m, _, i) => Math.max(m, framesWorstCaseMs(t, i)), 0);

/** Whether a frames capture of `part` that has waited `waitedMs` must not start (the late check, on its own worst case). */
export function framesStartsLate(waitedMs: number, t: CaptureTimings, part: number, deadlineMs: number = TESTBOX_CAPTURE_DEADLINE_MS): boolean {
  return waitedMs + framesWorstCaseMs(t, part) + CAPTURE_DEADLINE_MARGIN_MS > deadlineMs;
}
