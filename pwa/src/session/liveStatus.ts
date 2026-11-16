// The session's status as its screen reads it (W2 Task S2d, D-5466): ONE derivation, called by `SessionScreen` (the
// Escape interrupt, the read-only and caret reads) and by `SessionHeader` (the status chip), so the two can never
// disagree and a test host calls the same function rather than its own copy.
import type { FleetSession, SessionStatus } from '../../../shared/api';

/** The live stream's status wins; the fleet snapshot fills in until the stream's first frame (it sends status only
 *  on change). Stopping a turn is a fact about the process now, not about how the fleet last filed it. */
export function liveStatus(
  status: SessionStatus | null, session: Pick<FleetSession, 'status'> | null | undefined,
): SessionStatus | null {
  return status ?? session?.status ?? null;
}
