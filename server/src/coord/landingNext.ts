// L1, context C5 (landing order wave 5i). PURE: no clock, no fs, no store, no crypto, no I/O; its imports are the binding
// decider and types. The next-to-land cue's ONE decision: from the guarded landing facts, one measured control bundle and
// the current run of the selected head, `nextLandingNoticeOf` answers either why nothing is sent or the exact cue: its
// recipient, its episode, its canonical identity tuple and its body. `CoordStore.applyLandingControl` (L3,
// `landingControlTx.ts`) gathers the facts inside its own transaction, digests the identity into the mail subject and
// queues the mail; nothing here acts. A cue is a reminder to run the fresh canonical checks, never landing permission.
//
// The recipient is never guessed. A run-bound row goes to the CURRENT claimant of its same-project run, and only while
// that run waits at `merging` with a current episode whose PR and head are the pinned row's own. A no-run row goes to the
// claimant of its journal creation claim (a later order setter never replaces it). A missing source is a no-send.
import { landingBindingOf } from './landingLine.js';
import type { LandingInfrastructureFailure, LandingBindingReason } from '../../../shared/landingLine.js';
import type { LandingControlRead } from './radar.js';
import type { LandingMutationFacts } from './landingWrites.js';

/** Why no cue is sent: a binding refusal (its own word), a proven marker absence, or a recipient or episode that cannot be
 *  named. An eligibility refusal and nothing else: a durable prior mail is `duplicate` and an unproven operation `failure`. */
export type NextLandingNoSendReason = LandingBindingReason
  | 'inert' | 'run-unreadable' | 'run-not-merging' | 'episode-unreadable' | 'episode-changed' | 'recipient-missing' | 'creation-unrecorded';

/** The episode a cue is minted for: a run's verified `merging` entry, or the immutable creation of a no-run row. */
export type NextLandingEpisode =
  | { kind: 'run'; runId: number; episode: number; toId: string }
  | { kind: 'no-run'; creationSeq: number; toId: string };

/** The current run of the selected head, as the store reads it (`waveOf` null is a run with no wave total, carried as is). */
export interface NextLandingRun {
  id: number; project: string; state: string; claimedBy: string | null; program: string; wave: number; waveOf: number | null;
  episode: { e: number; head: string; pr: number | null } | null;
}
export interface NextLandingFacts { facts: LandingMutationFacts; control: LandingControlRead; nowMs: number;
  /** `missing`: the run row is not there; `unreadable`: it is there and does not read. Two conditions, never one null. */
  run: NextLandingRun | 'missing' | 'unreadable' }

export type NextLandingNotice =
  | { kind: 'no-send'; reason: NextLandingNoSendReason }
  | { kind: 'send'; entryId: number; pr: number; runId: number | null; toId: string; episode: NextLandingEpisode;
      /** The canonical JSON tuple, not a digest: the L3 caller digests it into the subject. */
      identity: string; body: string };

/** What `CoordStore.applyLandingControl` did. `holdChanged` is the transaction's committed `mainRedHold` change. */
export type LandingControlApplyResult =
  | { kind: 'no-send'; reason: NextLandingNoSendReason; holdChanged: boolean }
  | { kind: 'duplicate'; holdChanged: boolean }
  | { kind: 'queued'; mailId: number; deliveryId: number; holdChanged: boolean }
  | { kind: 'failure'; failure: LandingInfrastructureFailure };

/** The run id of the entry the flag-free walk selects, or null when there is none or it has no run: the one run the store
 *  needs to read before it can ask `nextLandingNoticeOf`. */
export function nextLandingRunId(facts: LandingMutationFacts, control: LandingControlRead, nowMs: number): number | null {
  const binding = landingBindingOf(facts, control, nowMs);
  const id = binding.mode === 'inert' ? null : binding.entryId;
  return facts.entries.find((e) => e.id === id)?.runId ?? null;
}

const noSend = (reason: NextLandingNoSendReason): NextLandingNotice => ({ kind: 'no-send', reason });

export function nextLandingNoticeOf(f: NextLandingFacts): NextLandingNotice {
  const { facts, control, run } = f;
  const binding = landingBindingOf(facts, control, f.nowMs);
  if (binding.mode === 'inert') return noSend('inert');
  if (binding.mode === 'held') return noSend(binding.reason);
  const entry = facts.entries.find((e) => e.id === binding.entryId);
  if (entry === undefined) return noSend('empty-or-blocked');

  let episode: NextLandingEpisode;
  if (entry.runId !== null) {
    if (run === 'missing' || run === 'unreadable' || run.id !== entry.runId || run.project !== entry.project) return noSend('run-unreadable');
    if (run.state !== 'merging') return noSend('run-not-merging');
    if (run.claimedBy === null) return noSend('recipient-missing');
    if (run.episode === null || !Number.isSafeInteger(run.episode.e)) return noSend('episode-unreadable');
    if (run.episode.pr !== entry.pr || run.episode.head !== entry.pinnedSha) return noSend('episode-changed');
    episode = { kind: 'run', runId: run.id, episode: run.episode.e, toId: run.claimedBy };
  } else {
    const creation = facts.creations.find((c) => c.id === entry.id);
    if (creation === undefined) return noSend('creation-unrecorded');
    episode = { kind: 'no-run', creationSeq: creation.seq, toId: creation.setBy };
  }

  const identity = JSON.stringify(['landing-next', 1, entry.project, entry.id, entry.pr, entry.pinnedSha, entry.handoffCommit, entry.pinnedAt,
    episode.kind, episode.kind === 'run' ? episode.runId : null, episode.kind === 'run' ? episode.episode : episode.creationSeq,
    binding.baseSha, episode.toId]);
  const red = control.health.ok && control.health.doc.state === 'red';
  const body = [
    `Next-to-land cue for ${entry.project} #${entry.pr} at ${entry.pinnedSha}, measured against base ${binding.baseSha}.`,
    'This is not merge permission. Read the landing line again and run the fresh canonical landing verdict and required-checks gate. ' +
      'Do not select another entry, bind a different head, relax a required check or infer that main is still at this base.',
    ...(binding.fixesMain && red ? ['Main is red. This entry fixes main, the one exception the line makes while main is red; the same fresh checks still apply.'] : []),
    `Cue identity (the canonical tuple, for diagnosis):\n${identity}`,
  ].join('\n\n');
  return { kind: 'send', entryId: entry.id, pr: entry.pr, runId: entry.runId, toId: episode.toId, episode, identity, body };
}
