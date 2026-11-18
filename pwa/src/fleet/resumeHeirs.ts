// Who could take a programme over (spec 2026-11-04 §9.5, step 3 of the Resume sheet): the live coordinators of the
// programme's project, by the name the fleet shows, never the claimant being replaced. Pure (L1): the caller hands the
// fleet's sessions and its frame flag, and `coordinatorPresence` decides alive.
import type { FleetSession } from '../../../shared/api';
import { coordinatorPresence } from './presence';
import { coordinatorRole } from './sessionFacts';
import { sessionLabel } from './sessionLabel';

/** A live coordinator of the programme's project that could take the programme over: its session id and the name it shows. */
export interface ResumeHeir { readonly id: string; readonly name: string }

export function resumeHeirs(
  sessions: readonly FleetSession[], project: string, claimedBy: string | null, frameSeen: boolean,
): ResumeHeir[] {
  // The claimant being replaced is no heir; the set keeps this a membership test, not a run-to-session match (ARCH-61).
  const replaced: ReadonlySet<string> = new Set(claimedBy === null ? [] : [claimedBy]);
  return sessions
    .filter((s) => coordinatorRole(s) && s.project === project && !replaced.has(s.id)
      && coordinatorPresence(s.id, s, frameSeen) === 'alive')
    .map((s) => ({ id: s.id, name: sessionLabel(s) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The reclaim door and the archive hand-over refuse an heir that is the Overlord's body (Overlord W1 other lanes, C48),
 *  answered `overlord-not-a-coordinator`. Both sheets say it in this one sentence. */
export const OVERLORD_HEIR_TEXT = 'that session is the Overlord, which never takes a programme';
/** The same doors' `unmeasured`: the designation could not be read, so neither door could rule the heir out as the
 *  Overlord's body (question 4). Both sheets say it in this one sentence; the server's `detail` is the evidence. */
export const OVERLORD_HEIR_UNMEASURED_TEXT = "the Overlord's designation could not be read, so the heir could not be checked; try again";
