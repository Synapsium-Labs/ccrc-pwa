// L3, context C5 (landing order wave 5i). The TRANSACTION BODY of `CoordStore.applyLandingControl`: inside the transaction the
// store opened and guards, it reads the project's coherent landing facts, applies the measured main health to
// `mainRedHold` (the flag's one writer: an upsert of that column alone, never `operatorPaused`), asks the pure L1 decider
// (`landingNext.ts`) for its notice against the EFFECTIVE flags (the next-to-land cue, or the held-head notice of wave 5o,
// D-9159), and queues it through one local queue over the existing notice bodies (`queueLandingNoticeTx` for a run episode,
// `queueRunlessNoticeTx` for a creation) in the same transaction. It opens
// no transaction, writes no journal record, reads no file and decides nothing the L1 deciders own. The store keeps what
// needs its private fields (the guard, the owned transaction, the fence); this file keeps the body.
// The store still grew against its merge-bases; the growth check passes through its new-file rule.
// The SHA-256 digest of each notice's identity is taken here (L3), never in the pure file.
import { createHash } from 'node:crypto';
import { mainRedNext } from './landingLine.js';
import { nextLandingNoticeOf, nextLandingRunId, type LandingControlApplyResult, type NextLandingNotice, type NextLandingRun } from './landingNext.js';
import { queueLandingNoticeTx, queueRunlessNoticeTx } from './rundefsTx.js';
import type { LandingControlRead } from './radar.js';
import type { LandingReadResult } from './landingWrites.js';
import type { WatcherCoordPort } from './ports.js';

/** How far the transaction got, for the store's catch: `decide` (reads), `apply` (a write began), `commit` (every write done,
 *  the COMMIT is next). A failure past `decide` fences the landing entrances, as the authority writer's does. */
export type LandingControlPhase = 'decide' | 'apply' | 'commit';

export interface LandingControlInput { project: string; control: LandingControlRead; nowMs: number }

/** Runs inside the store's transaction. Throws on any database fault (the store rolls back and classifies it by `phase`). */
export function applyLandingControlTx(coord: WatcherCoordPort, readFacts: () => LandingReadResult, input: LandingControlInput,
  phase: { at: LandingControlPhase }): LandingControlApplyResult {
  const { project, control, nowMs } = input;
  const read = readFacts();
  if (!read.ok) { const { ok: _ok, ...failure } = read; return { kind: 'failure', failure }; }
  const transition = mainRedNext(read.facts.flags.mainRedHold, control, nowMs, project);
  let facts = read.facts;
  let holdChanged = false;
  if (transition.kind === 'set') {
    phase.at = 'apply';
    coord.db.prepare('INSERT INTO landing_projects (project, mainRedHold) VALUES (?, ?) ON CONFLICT(project) DO UPDATE SET mainRedHold = excluded.mainRedHold')
      .run(project, transition.value ? 1 : 0);
    facts = { ...facts, flags: { ...facts.flags, mainRedHold: transition.value } };
    holdChanged = true;
  }
  const finish = (out: LandingControlApplyResult): LandingControlApplyResult => { if (phase.at === 'apply') phase.at = 'commit'; return out; };

  const runId = nextLandingRunId(facts, control, nowMs);
  const read2 = runId === null ? null : coord.run(runId);
  const row = read2 !== null && read2.ok ? read2.run : null;
  const ep = row === null ? null : coord.currentEpisode(row.id);
  // A missing run and one that does not read are two conditions, kept apart at this seam; the decider maps both to the one approved
  // refusal word, `run-unreadable`, and answers it before any `send`.
  const run: NextLandingRun | 'missing' | 'unreadable' = read2 !== null && !read2.ok ? 'unreadable' : row === null ? 'missing' : { id: row.id, project: row.project, state: row.state, claimedBy: row.claimedBy,
    program: row.program, wave: row.wave, waveOf: row.waveOf, episode: ep === null ? null : { e: ep.e, head: ep.head, pr: ep.pr } };
  const out = nextLandingNoticeOf({ facts, control, nowMs, run });
  if (out.kind === 'no-send') return finish({ kind: 'no-send', reason: out.reason, holdChanged });
  return finish(queueNotice(coord, row, out, nowMs, phase, holdChanged));
}

/** The one queue of both answers (the cue, and the held-head notice of wave 5o, D-9159): the digest of the identity names
 *  the subject and the run arm's detail, built here from the answer's kind as template literals; the run arm dedupes on its
 *  observation row and the run-less arm on its subject. */
function queueNotice(coord: WatcherCoordPort, row: Parameters<typeof queueLandingNoticeTx>[1] | null, out: Exclude<NextLandingNotice, { kind: 'no-send' }>, nowMs: number,
  phase: { at: LandingControlPhase }, holdChanged: boolean): LandingControlApplyResult {
  const digest = createHash('sha256').update(out.identity).digest('hex');
  const subject = out.kind === 'send' ? `next-to-land:#${out.pr}:${digest}` : `head-held:#${out.pr}:${digest}`;
  const detail = out.kind === 'send' ? `landing:next:v1:${digest}` : `landing:head-held:v1:${digest}`;
  let queued: ReturnType<typeof queueRunlessNoticeTx>;
  if (out.episode.kind === 'run') {
    // Invariant: a `send` or `held` answer for a run episode means the decider saw a run object (a missing run is a no-send
    // above). Unreachable by that contract; if it ever fires the body throws and the store rolls back and classifies it, never
    // an `episode-changed` no-send.
    if (row === null) throw new Error('landing-next: a run episode without a run row (landingNext.ts#nextLandingNoticeOf returns no-send for a missing run, for the cue and the held-head notice alike)');
    phase.at = 'apply';
    queued = queueLandingNoticeTx(coord, row, { detail, at: nowMs, episode: out.episode.episode, toId: out.toId, subject, body: out.body });
  } else {
    phase.at = 'apply';
    queued = queueRunlessNoticeTx(coord, { toId: out.toId, kind: 'status', subject, body: out.body });
  }
  if (queued.queued) {
    return { kind: out.kind === 'send' ? 'queued' : 'held-queued', mailId: queued.mailId, deliveryId: queued.deliveryId, holdChanged };
  }
  // The run arm's own `run-gone` is the episode predicate failing inside the transaction: the episode moved, nothing was sent.
  return queued.why === 'run-gone' ? { kind: 'no-send', reason: 'episode-changed', holdChanged } : { kind: 'duplicate', holdChanged };
}
