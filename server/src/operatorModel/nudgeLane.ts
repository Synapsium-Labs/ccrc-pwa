// The mail lane's operator-message branch, after the nudge was typed (Overlord W1 private store, Task 5; open question 3,
// slug `message-nudge-rides-the-mail-lane`). Ring L4, context C11: it decides nothing. `FleetWatcher.sweepMail` calls it once
// `markDelivered` landed, and it moves the message on the private store and acks the delivery, reading each answer as the
// lane reads every write it makes: a refused write is logged, and nothing after it assumes it.
import type { WatcherCoordPort } from '../coord/ports.js';
import type { OperatorModelStore } from './store.js';

const BEFORE_DELIVERED: ReadonlySet<string> = new Set(['recorded', 'queued']);

/** What the branch needs: the delivery writer's ack, the private store's one move (absent in a watcher with no store), the
 *  lane's clock reading and its log. */
export interface NudgeLaneDeps {
  readonly coord: Pick<WatcherCoordPort, 'markAcked'>;
  readonly operatorModel: Pick<OperatorModelStore, 'moveMessage' | 'messageStateOf'> | undefined;
  readonly now: number;
  readonly warn: (line: string) => void;
}

/** `delivery` is the row as the sweep read it BEFORE `markDelivered`. The `deliver` move runs at the ack whenever the row is
 *  still before `delivered`: always on a first delivery (`deliveredAt` null), and on a replay when the row's state, read text-free,
 *  is still `recorded` or `queued` (the earlier move was refused, or the process died between `markDelivered` and this call; F3).
 *  A refused move is logged and left for the boot pass, which delivers a `queued` row whose nudge is acked. The ack keeps the
 *  delivery from ever being replayed or parked. Names the message id only, never its words. */
export function settleOperatorNudge(
  deps: NudgeLaneDeps, delivery: { readonly id: number; readonly deliveredAt: number | null }, messageId: number,
): void {
  const om = deps.operatorModel;
  if (om !== undefined) {
    let due = delivery.deliveredAt === null;
    if (!due) {
      const state = om.messageStateOf(messageId);
      if (state.kind === 'unmeasured') deps.warn(`ccrc-server: mail sweep: operator message ${messageId}: state unmeasured (${state.why})`);
      else due = BEFORE_DELIVERED.has(state.value);
    }
    if (due) {
      const moved = om.moveMessage(messageId, 'deliver', 'mail-lane', deps.now);
      if (!moved.ok) deps.warn(`ccrc-server: mail sweep: operator message ${messageId}: deliver refused (${moved.error})`);
    }
  }
  const acked = deps.coord.markAcked(delivery.id, deps.now);
  if (!acked.ok) deps.warn(`ccrc-server: mail sweep: delivery ${delivery.id}: ack refused (${acked.why})`);
}
