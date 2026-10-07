// The ONE Ack (centralised-update design 2026-09-20 §13; programme wave 14, R15(a)). Two surfaces offer it, the
// node's row in Settings and the home screen's halt banner. Both take the button's gate (`canAck`) and the tap
// (`sendAck`) from this file. A second copy of either could let the two buttons disagree about one row. Both moved
// here from `screens/SettingsScreen.tsx` (D-4267). The screen re-exports `canAck` and `ACK_UNREADABLE_TEXT`, not the
// tap, so a fleet component never imports a screen.
//
// Ack is offered only on a SETTLED lease, because W2's ackNode acks from nothing else (D-3183; D-3310). The route
// stays the authority: a row that went busy between the poll and the tap comes back as a 409 `busy`, rendered as
// updateErrorText's sentence. The caller re-polls either way.
import type { NodeWire, ReleaseWire } from '../../../shared/api';
import { SETTLED_UPDATE_STATES } from '../../../shared/api';
import { toast } from '../components/Toast';
import { ApiError, api, updateErrorText } from '../lib/api';

export const ACK_UNREADABLE_TEXT = "Acknowledged — the server's answer could not be read; the screen will re-check.";

export function canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean {
  const state = n.update?.state;
  // A busy lease (pending, applying, unknown), an absent state or a word this build cannot name: ackNode answers busy.
  if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return false;
  if (state === 'failed' || state === 'reverted') return true;
  if (typeof n.request === 'object' && n.request !== null) return true;
  return releases.some((r) => Array.isArray(r.refused) && r.refused.some((x: unknown) =>
    typeof x === 'object' && x !== null && (x as { by?: unknown }).by === n.nodeId));
}

/** How one Ack ended (D-4272):
 *  - `acked`: a clean 200;
 *  - `unreadable`: a 2xx whose body would not parse, which may still have cleared the row;
 *  - `refused`: an `ApiError` whose status is 4xx, the server's own answer, said as its sentence;
 *  - `unanswered`: any other rejection (a fetch TypeError, an `ApiError` 5xx such as a proxy's 502/504, a timeout or
 *    an abort). The server gave no answer, so the Ack may have landed. */
export type AckOutcome = 'acked' | 'unreadable' | 'refused' | 'unanswered';

/** `POST /api/updates/ack` for one node, said as a toast: nothing on a clean 200, ACK_UNREADABLE_TEXT when the
 *  answer could not be read, and the error's sentence on a rejection. It never rejects, so the caller's `.finally`
 *  (clear its busy flag, re-poll) always runs; it answers the outcome, so a caller can hold its button down until
 *  a poll shows the row changed (ackNode acks ANY settled row, idle included, and clears its request). A rejection
 *  ends `refused` only for a 4xx `ApiError`; every other rejection ends `unanswered`. */
export function sendAck(nodeId: string): Promise<AckOutcome> {
  return api.ackUpdateNode(nodeId).then(
    (answer): AckOutcome => {
      if (answer === 'unreadable') { toast(ACK_UNREADABLE_TEXT); return 'unreadable'; }
      return 'acked';
    },
    (err: unknown): AckOutcome => {
      toast(updateErrorText(err), 'error');
      return err instanceof ApiError && err.status >= 400 && err.status < 500 ? 'refused' : 'unanswered';
    },
  );
}
