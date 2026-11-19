// D-8126 wave A6 (coordinator-autonomy-default plan, Tasks A6-1 and A6-3; design 2026-11-09 §8.3 items 1 and 2, R7):
// the coord-ball mail rung's decider and the R7 count's predicate. L1: pure decisions, no I/O. They sit beside
// `stall.ts`, whose session and coord-blocked readers they reuse, because that file is at its growth cap (D-8635).
// The lane that measures their facts is `coordBallLane.ts`; `watch.ts`'s coordinator pass applies their verdicts.
import {
  STALL_WAIT_PREFIX, VERDICT_NONE, stallCoordBallFrom, stallCoordBallMail, stallCoordGate, stallCoordHeld, stallFacts,
  stallMailDisabledHold, stallSelfMail, stallSessionLive,
  type StallCoordBlockedInput, type StallInput, type StallRunRow, type StallSessionInput, type StallVerdict,
} from './stall.js';

/** Whether the episode counts as an R7 breach (design 2026-11-09 R7, measure M2): a coordinator with mail held behind a
 *  PENDING DIALOG (the gate reads `waiting` through `dialogPending`, never through the live word alone) whose claimed
 *  programme is pinned. The push of `stallCoordBlockedStep` is unchanged; this only says the lane counts it. */
export function stallR7Breach(input: StallCoordBlockedInput, pinned: boolean): boolean {
  const si = input.session;
  if (!pinned || si.role !== 'coordinator' || input.runs.length === 0) return false;
  if (si.worker.present !== true || !si.worker.dialogPending) return false;
  return stallCoordHeld(si).length > 0 && stallCoordGate(si) === 'waiting';
}

// ── coord-ball's mail rungs (design 2026-11-09 §8.3 items 1 and 2) ────────────────────────────────────────────

/** An idle coordinator that claims open runs and holds the ball is mailed after this long (rung 2). */
export const COORD_BALL_MAIL_MS = 20 * 60_000;
/** Rung 3, the one repeat, falls due this long after rung 2 when the session is still idle with no turn since. */
export const COORD_BALL_MAIL_AGAIN_MS = 30 * 60_000;

/** The arm's input: the coordinator's session facts, every non-terminal run it claims (review runs included), the
 *  lane's facts (an open blocking item, a live block row, the newest `wait:` mail it sent) and the newest per-run
 *  ball-to-coordinator time across its claimed runs. */
export interface StallCoordBallInput {
  readonly session: StallSessionInput; readonly runs: readonly StallRunRow[]; readonly blockingItem: boolean;
  readonly liveBlock: boolean; readonly waitSentAt: number | null; readonly ballSince: number | null;
}

function stallCoordBallMailInner(input: StallCoordBallInput, now: number): StallVerdict {
  const si = input.session;
  const live = stallSessionLive(si);
  if (live === null || live.word !== 'idle') return VERDICT_NONE;
  if (si.deliveries.some((d) => d.toId === si.sessionId && d.state === 'queued')) return VERDICT_NONE;
  if (input.runs.length === 0 || input.ballSince === null) return VERDICT_NONE;
  const ballSince = input.ballSince;
  if (now - ballSince < COORD_BALL_MAIL_MS) return VERDICT_NONE;
  if (input.runs.some((r) => r.state === 'dispatched' || r.state === 'working' || r.state === 'merging' || r.kind === 'review')) return VERDICT_NONE;
  if (input.blockingItem || input.liveBlock || si.coordinationPaused) return VERDICT_NONE;
  // The coordinator's own `wait:` mail is itself the newest exchange on its run (`ballToCoordinator` gives the ball to the
  // coordinator on it), so `ballSince` is never earlier than it: a wait at or after the ball holds, only a later exchange
  // or re-activation (a ball time past the wait) lets the rung run.
  if (input.waitSentAt !== null && input.waitSentAt >= ballSince) return VERDICT_NONE;
  // A coordinator is a session without a run: its rungs are the watch's own mail to it, found by the exact subject
  // `stallCoordBallMail` gives each rung (`stallSelfMail`), never `rungDoneAt` over notices a run-less session lacks.
  const sent2 = stallSelfMail(si, stallCoordBallMail({ key: ballSince, rung: 2 }).subject);
  if (sent2 === null) return { act: 'notify', arm: 'coord-ball', rung: 2, key: ballSince, to: 'worker' };
  if (stallSelfMail(si, stallCoordBallMail({ key: ballSince, rung: 3 }).subject) !== null) return VERDICT_NONE;
  const done2 = sent2.at;
  if (now - done2 >= COORD_BALL_MAIL_AGAIN_MS && live.since <= done2) return { act: 'notify', arm: 'coord-ball', rung: 3, key: ballSince, to: 'worker' };
  return VERDICT_NONE;
}

/** The coordinator-ball mail rung's decider: rung 2 mails the idle coordinator, rung 3 once more; never a third. */
export function stallCoordBallMailStep(input: StallCoordBallInput, now: number): StallVerdict {
  return stallMailDisabledHold(stallCoordBallMailInner(input, now), input.session.arming);
}

/** The newest time the ball sat with the coordinator across its claimed runs: each run's own `stallFacts`, restarted by
 *  a re-activation (`stallCoordBallFrom`). A run whose ball is elsewhere counts nothing; null when none holds it. */
export function coordBallSince(perRun: readonly StallInput[]): number | null {
  let since: number | null = null;
  for (const input of perRun) {
    const f = stallFacts(input);
    if (f.ball !== 'coordinator') continue;
    const from = stallCoordBallFrom(input, f);
    if (from !== null && (since === null || from > since)) since = from;
  }
  return since;
}

/** The newest `wait:` mail the coordinator itself sent, or null. */
export function coordWaitSentAt(si: StallSessionInput): number | null {
  return si.mail.reduce<number | null>(
    (best, m) => (m.fromId === si.sessionId && m.subject.startsWith(STALL_WAIT_PREFIX) && (best === null || m.at > best) ? m.at : best), null);
}
