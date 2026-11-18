// The mail lane's operator-message branch, after the nudge was typed (Overlord W1 private store, Task 5; open question 3,
// slug `message-nudge-rides-the-mail-lane`). Ring L4, context C11: it decides nothing. `FleetWatcher.sweepMail` calls it once
// `markDelivered` landed, and it moves the message on the private store and acks the delivery, reading each answer as the
// lane reads every write it makes: a refused write is logged, and nothing after it assumes it.
import type { WatcherCoordPort } from '../coord/ports.js';
import type { OperatorModelStore } from './store.js';

/** What the branch needs: the delivery writer's ack, the private store's one move (absent in a watcher with no store), the
 *  lane's clock reading and its log. */
export interface NudgeLaneDeps {
  readonly coord: Pick<WatcherCoordPort, 'markAcked'>;
  readonly operatorModel: Pick<OperatorModelStore, 'moveMessage'> | undefined;
  readonly now: number;
  readonly warn: (line: string) => void;
}

/** `delivery` is the row as the sweep read it BEFORE `markDelivered`: a first delivery (`deliveredAt` null) moves the message
 *  to `delivered`; a replay (the earlier ack was refused) moves nothing, the move having been made, and only tries the ack
 *  again. The ack keeps the delivery from ever being replayed or parked. Names the message id only, never its words. */
export function settleOperatorNudge(
  deps: NudgeLaneDeps, delivery: { readonly id: number; readonly deliveredAt: number | null }, messageId: number,
): void {
  if (delivery.deliveredAt === null && deps.operatorModel !== undefined) {
    const moved = deps.operatorModel.moveMessage(messageId, 'deliver', 'mail-lane', deps.now);
    if (!moved.ok) deps.warn(`ccrc-server: mail sweep: operator message ${messageId}: deliver refused (${moved.error})`);
  }
  const acked = deps.coord.markAcked(delivery.id, deps.now);
  if (!acked.ok) deps.warn(`ccrc-server: mail sweep: delivery ${delivery.id}: ack refused (${acked.why})`);
}
