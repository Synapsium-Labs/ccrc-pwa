// The one act that queues an operator message's nudge (Overlord W1 private store, Task 5, fix round 1 N3). Context C11, the way `queueSystemMail` is a transaction over the mail writers:
// it decides nothing. In ONE `coord.db` transaction it queues the nudge mail (unless an outstanding one stands) and writes W1a's
// `@overlord` mark. The prompt route and the boot pass both call it, so a recovered nudge is registered with the operator-quiet
// reading exactly as a first one is. Names the id only, never the words.
import type { WatcherCoordPort } from '../coord/ports.js';
import { insertSystemMailTx } from '../coord/rundefsTx.js';
import type { CoordStore } from '../coord/store.js';
import { tx } from '../coord/tx.js';
import { OVERLORD_OPERATOR_MARK, operatorMessageNudgeBody, operatorMessageSubject } from '../../../shared/operatorMessages.js';

export type NudgeQueueCoord = WatcherCoordPort & Pick<CoordStore, 'putOperatorMark'>;

/** `true` when this call queued the mail, `false` when an outstanding one already stood. A throw (the transaction rolls back)
 *  is the caller's to catch. A mark that could not be written is warned, never thrown. */
export function queueOperatorNudge(
  coord: NudgeQueueCoord, sessionId: string, messageId: number, at: number, warn: (line: string) => void,
): boolean {
  const subject = operatorMessageSubject(messageId);
  return tx(coord.db, () => {
    const fresh = !coord.hasOutstandingMail('operator', null, sessionId, subject);
    if (fresh) {
      insertSystemMailTx(coord, null, { fromId: 'operator', toId: sessionId, runId: null, kind: 'status', subject, body: operatorMessageNudgeBody(messageId) });
    }
    if (!coord.putOperatorMark(OVERLORD_OPERATOR_MARK, at).ok) warn(`ccrc-server: nudge: the operator mark could not be written (message ${messageId})`);
    return fresh;
  });
}
