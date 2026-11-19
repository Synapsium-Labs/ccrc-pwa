// D-8126 wave A6 (coordinator-autonomy-default plan, Tasks A6-2, A6-3 and A6-4): the store reads behind the coord-ball mail
// rung, the R7 count and the idle nudge's open-run fact. Each reads only, and answers a fact that could not be read as its
// own value, never as absence: `coordBallInputOf` answers null (the rung holds this sweep), `idleNudgeOpenRunOf` answers
// `{ ok: false }` (the nudge holds `unmeasured`). The deciders are `coordBall.ts` and `idlenudge.ts` (L1); `watch.ts` applies their verdicts.
import {
  BACKLOG_HORIZON_MS, stallReactivation, stallRunMail,
  type StallCoordBlockedInput, type StallCoordEpisode, type StallInput, type StallRunRow, type StallSessionInput,
} from './stall.js';
import { coordBallSince, coordWaitSentAt, stallR7Breach, type StallCoordBallInput } from './coordBall.js';
import type { IdleNudgeOpenRun } from '../idlenudge.js';
import type { WatcherCoordPort } from './ports.js';

/** The coord-ball rung's input for one coordinator: every non-terminal run it claims, whether any of their programmes holds
 *  a `blocking` open item, its live blocks, its newest `wait:` mail, and the newest time the ball sat with it on a claimed
 *  run (each run judged on its own mail and re-activation). Null when a read failed (warned) or it claims no open run. */
export function coordBallInputOf(
  store: WatcherCoordPort, si: StallSessionInput, now: number, warn: (line: string) => void,
): StallCoordBallInput | null {
  const id = si.sessionId;
  const claimed = store.openRunsOfClaimant(id);
  if (!claimed.ok) {
    warn(`ccrc-server: stall-watch coord-ball runs of ${id} unreadable (${claimed.kind}: ${claimed.detail}) — held this sweep`);
    return null;
  }
  if (claimed.runs.length === 0) return null;
  const perRun: StallInput[] = [];
  for (const run of claimed.runs) {
    if (run.sessionId === '') continue;
    const read = store.stallMailFor(run.sessionId, [run.id], now - BACKLOG_HORIZON_MS);
    if (!read.ok) {
      warn(`ccrc-server: stall-watch coord-ball mail of run ${run.id} unreadable (${read.kind}: ${read.detail}) — held this sweep`);
      return null;
    }
    perRun.push({
      subject: { primary: run, runs: [run] }, worker: si.worker, mail: stallRunMail(read.mail, [run.id]), notices: [],
      arming: si.arming, coordinationPaused: si.coordinationPaused, coordinator: null,
      activation: stallReactivation(store.runEvents(run.id)),
    });
  }
  const programmes = [...new Set(claimed.runs.map((r) => r.program))];
  return {
    session: si, runs: claimed.runs, blockingItem: programmes.some((p) => store.programmeHasBlockingItem(p)),
    liveBlock: store.liveBlocksOf(id, now).length > 0, waitSentAt: coordWaitSentAt(si), ballSince: coordBallSince(perRun),
  };
}

/** The nudge's open-run fact: the non-terminal runs the session claims, whether any of their programmes holds a blocking
 *  item, and the newest run event across them. Null when it claims none; a read that throws or fails is `{ ok: false }`. */
export function idleNudgeOpenRunOf(store: WatcherCoordPort, id: string): IdleNudgeOpenRun {
  try {
    const claimed = store.openRunsOfClaimant(id);
    if (!claimed.ok) return { ok: false };
    if (claimed.runs.length === 0) return null;
    const blocked = [...new Set(claimed.runs.map((r) => r.program))].some((p) => store.programmeHasBlockingItem(p));
    let lastEventAt: number | null = null;
    for (const run of claimed.runs) {
      for (const e of store.runEvents(run.id)) if (lastEventAt === null || e.at > lastEventAt) lastEventAt = e.at;
    }
    return { ok: true, lastEventAt, blocked };
  } catch {
    return { ok: false };
  }
}

/** One coordinator the stall pass judges: the active runs it claims, and `ballOnly` for a claimant with none, which gets
 *  the coord-ball mail rung alone. */
export interface StallCoordinatorSubject { readonly sessionId: string; readonly runs: readonly StallRunRow[]; readonly ballOnly?: true }

/** The coord-ball rung's other coordinators: claimants of open runs none of which is active (an `awaiting-review` run is
 *  no `stallCandidates` row), so the pass names none of them. Each gets that rung alone (`ballOnly`); one already judged is
 *  left out. An unreadable list holds the rung this sweep (warned) and answers none. */
export function ballOnlySubjects(store: WatcherCoordPort, judged: ReadonlySet<string>, warn: (line: string) => void): StallCoordinatorSubject[] {
  let ids: string[];
  try {
    ids = store.openCoordinatorIds();
  } catch (err) {
    warn(`ccrc-server: stall-watch coord-ball claimants unreadable (${err instanceof Error ? err.message : String(err)}) — the rung skips this sweep`);
    return [];
  }
  return ids.filter((id) => id !== '' && !judged.has(id)).map((sessionId) => ({ sessionId, runs: [], ballOnly: true }));
}

/** R7's count (design 2026-11-09 §10, M2): an open coord-blocked episode held by a pending dialog on a pinned programme is
 *  ONE `r7-breach` feed row, keyed on the episode's start through `hasNotice`'s once-only key. The row to record (always,
 *  and record-only: the coord-blocked push is unchanged), or null when the episode is no breach or already counted. */
export function r7BreachNotice(store: WatcherCoordPort, blocked: StallCoordBlockedInput, episode: StallCoordEpisode | null):
  { readonly kind: 'coord'; readonly sessionId: string; readonly title: string; readonly body: string; readonly dedupeKey: string } | null {
  if (episode === null) return null;
  if (!stallR7Breach(blocked, blocked.runs.some((r) => store.isPinned(r.program)))) return null;
  const sessionId = blocked.session.sessionId;
  const dedupeKey = `r7-breach:${Math.trunc(episode.since)}`;
  if (store.hasNotice('coord', sessionId, dedupeKey)) return null;
  return { kind: 'coord', sessionId, title: 'r7-breach', body: 'a coordinator holds mail behind an open dialog on a pinned programme', dedupeKey };
}
