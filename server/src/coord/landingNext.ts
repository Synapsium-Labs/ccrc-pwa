// L1, context C5 (landing order wave 5i). PURE: no clock, no fs, no store, no crypto, no I/O; its imports are the binding
// decider and types. The landing line's ONE notice decision, two answers: from the guarded landing facts, one measured
// control bundle and the current run of the selected head, `nextLandingNoticeOf` answers why nothing is sent, the exact
// next-to-land cue on a ready binding, or the held-head notice (wave 5o, D-9159) on the one held binding the head entry's
// own coordinator alone can clear: a conflict the radar measured between its pinned head and the base. Each carries its
// recipient, its episode, its canonical identity tuple and its body. `CoordStore.applyLandingControl` (L3,
// `landingControlTx.ts`) gathers the facts inside its own transaction, digests the identity into the mail subject and
// queues the mail; nothing here acts. A cue is a reminder to run the fresh canonical checks, never landing permission, and
// the held-head notice is a cue to read the line and measure, never an instruction to eject.
//
// The recipient is never guessed, and both answers name it by one rule (`episodeOf`). A run-bound row goes to the CURRENT
// claimant of its same-project run, and only while that run waits at `merging` with a current episode whose PR and head are
// the pinned row's own. A no-run row goes to the claimant of its journal creation claim (a later order setter never
// replaces it). A missing source is a no-send.
import { landingBindingOf, probedHeadOf } from './landingLine.js';
import type { LandingInfrastructureFailure, LandingBindingReason, LandingEntry } from '../../../shared/landingLine.js';
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

/** The one held reason the head entry's own coordinator alone can clear (D-9159): a measured conflict of its pinned head
 *  with the base. Every other reason, `head-mismatch` included, is the operator's or time's, and sends nothing. */
export type LandingHeldNoticeReason = Extract<LandingBindingReason, 'composition-not-clean'>;

export type NextLandingNotice =
  | { kind: 'no-send'; reason: NextLandingNoSendReason }
  | { kind: 'send'; entryId: number; pr: number; runId: number | null; toId: string; episode: NextLandingEpisode;
      /** The canonical JSON tuple, not a digest: the L3 caller digests it into the subject. */
      identity: string; body: string }
  | { kind: 'held'; entryId: number; pr: number; runId: number | null; toId: string; episode: NextLandingEpisode;
      reason: LandingHeldNoticeReason; baseSha: string;
      /** The canonical JSON tuple, not a digest: the L3 caller digests it into the subject. */
      identity: string; body: string };

/** What `CoordStore.applyLandingControl` did. `holdChanged` is the transaction's committed `mainRedHold` change. `duplicate`
 *  is shared by both answers; `held-queued` is the held-head notice queued (D-9159). */
export type LandingControlApplyResult =
  | { kind: 'no-send'; reason: NextLandingNoSendReason; holdChanged: boolean }
  | { kind: 'duplicate'; holdChanged: boolean }
  | { kind: 'queued'; mailId: number; deliveryId: number; holdChanged: boolean }
  | { kind: 'held-queued'; mailId: number; deliveryId: number; holdChanged: boolean }
  | { kind: 'failure'; failure: LandingInfrastructureFailure };

/** The run id of the entry the flag-free walk selects, or null when there is none or it has no run: the one run the store
 *  needs to read before it can ask `nextLandingNoticeOf`. */
export function nextLandingRunId(facts: LandingMutationFacts, control: LandingControlRead, nowMs: number): number | null {
  const binding = landingBindingOf(facts, control, nowMs);
  const id = binding.mode === 'inert' ? null : binding.entryId;
  return facts.entries.find((e) => e.id === id)?.runId ?? null;
}

const noSend = (reason: NextLandingNoSendReason): NextLandingNotice => ({ kind: 'no-send', reason });

/** The cue's recipient rule (wave 5i), one private helper (wave 5o, D-9159): a run row's current claimant while its run waits
 *  at `merging` in the pinned episode, or a no-run row's journal creation claimant. A word is the no-send reason. */
function episodeOf(entry: LandingEntry, facts: LandingMutationFacts, run: NextLandingFacts['run']): NextLandingEpisode | NextLandingNoSendReason {
  if (entry.runId !== null) {
    if (run === 'missing' || run === 'unreadable' || run.id !== entry.runId || run.project !== entry.project) return 'run-unreadable';
    if (run.state !== 'merging') return 'run-not-merging';
    if (run.claimedBy === null) return 'recipient-missing';
    if (run.episode === null || !Number.isSafeInteger(run.episode.e)) return 'episode-unreadable';
    if (run.episode.pr !== entry.pr || run.episode.head !== entry.pinnedSha) return 'episode-changed';
    return { kind: 'run', runId: run.id, episode: run.episode.e, toId: run.claimedBy };
  }
  const creation = facts.creations.find((c) => c.id === entry.id);
  if (creation === undefined) return 'creation-unrecorded';
  return { kind: 'no-run', creationSeq: creation.seq, toId: creation.setBy };
}

/** D-9159's one rule: the held binding the head entry's own coordinator alone can clear, a conflict the radar measured
 *  between its pinned head and the base, read from the probe's one head for it. */
function heldOf(reason: LandingBindingReason, entry: LandingEntry, control: LandingControlRead):
  { reason: LandingHeldNoticeReason; baseSha: string } | null {
  if (reason !== 'composition-not-clean' || !control.probe.ok) return null;
  const probed = probedHeadOf(control.probe.doc, entry.pr);
  return probed !== null && probed.base.state === 'conflict' ? { reason, baseSha: control.probe.doc.baseSha } : null;
}

export function nextLandingNoticeOf(f: NextLandingFacts): NextLandingNotice {
  const { facts, control, run } = f;
  const binding = landingBindingOf(facts, control, f.nowMs);
  if (binding.mode === 'inert') return noSend('inert');
  if (binding.mode === 'held') {
    const headEntry = facts.entries.find((e) => e.id === binding.entryId);
    const heldAt = headEntry === undefined ? null : heldOf(binding.reason, headEntry, control);
    if (headEntry === undefined || heldAt === null) return noSend(binding.reason);
    const heldEpisode = episodeOf(headEntry, facts, run);
    if (typeof heldEpisode === 'string') return noSend(heldEpisode);
    const identity = JSON.stringify(['landing-head-held', 1, headEntry.project, headEntry.id, headEntry.pr, headEntry.pinnedSha,
      headEntry.handoffCommit, headEntry.pinnedAt, heldEpisode.kind, heldEpisode.kind === 'run' ? heldEpisode.runId : null,
      heldEpisode.kind === 'run' ? heldEpisode.episode : heldEpisode.creationSeq, heldAt.baseSha, heldEpisode.toId]);
    const body = [
      `Held head for ${headEntry.project} #${headEntry.pr}, entry ${headEntry.id}: the landing line's binding is held at its head with reason composition-not-clean. ` +
        `The conflict radar measured the pinned head ${headEntry.pinnedSha} as conflicting with base ${heldAt.baseSha}.`,
      'This is a cue to read the landing line again and measure what it names yourself, not an instruction to eject. ' +
        'Act only as the coordinator\'s landing reference says (its paragraph The landing line). ' +
        'Do not select another entry, bind a different head or send back another run\'s entry.',
      `Notice identity (the canonical tuple, for diagnosis):\n${identity}`,
    ].join('\n\n');
    return { kind: 'held', entryId: headEntry.id, pr: headEntry.pr, runId: headEntry.runId, toId: heldEpisode.toId, episode: heldEpisode,
      reason: heldAt.reason, baseSha: heldAt.baseSha, identity, body };
  }
  const entry = facts.entries.find((e) => e.id === binding.entryId);
  if (entry === undefined) return noSend('empty-or-blocked');

  const episode = episodeOf(entry, facts, run);
  if (typeof episode === 'string') return noSend(episode);

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
