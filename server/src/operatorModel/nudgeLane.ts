// The mail lane's operator-message branch, after the nudge was typed (Overlord W1 private store, Task 5; open question 3,
// slug `message-nudge-rides-the-mail-lane`). Ring L4, context C11: it decides nothing. `FleetWatcher.sweepMail` calls it once
// `markDelivered` landed, and it moves the message on the private store (with its sequence line, `messageLine.ts`) and acks the delivery, reading each answer as the
// lane reads every write it makes: a refused write is logged, and nothing after it assumes it. The mail ack route calls
// `settleAckedOperatorNudge` for a session's own ack of the same nudge (review 2627 F-1).
import type { WatcherCoordPort } from '../coord/ports.js';
import type { OperatorModelStore } from './store.js';
import { isOperatorMessageMail, operatorMessageIdOf } from '../../../shared/operatorMessages.js';
import { fixedLineReplayOf } from '../coord/envelope.js';
import { moveOperatorMessage } from './messageLine.js';

const BEFORE_DELIVERED: ReadonlySet<string> = new Set(['recorded', 'queued']);

/** What the branch needs: the delivery writer's ack, the private store's one move (absent in a watcher with no store), the
 *  lane's clock reading and its log. */
export interface NudgeLaneDeps {
  readonly coord: Pick<WatcherCoordPort, 'markAcked' | 'db'>;
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
  deliverWhileQueued(deps, messageId, delivery.deliveredAt === null);
  ackDelivery(deps, delivery.id);
}

/** The delivery's ack through the one writer, a refusal logged and nothing after it assuming it. */
function ackDelivery(deps: Pick<NudgeLaneDeps, 'coord' | 'now' | 'warn'>, deliveryId: number): void {
  const acked = deps.coord.markAcked(deliveryId, deps.now);
  if (!acked.ok) deps.warn(`ccrc-server: mail sweep: delivery ${deliveryId}: ack refused (${acked.why})`);
}

/** The first delivery of a fixed line that moves nothing in the private store (a wake, a spot-probe notice): the delivery is acked on
 *  its first delivery only, through the same writer, and a refused ack is logged as `settleOperatorNudge` logs it. A replay (a
 *  delivery already delivered once) acks nothing here: `finishFixedLineAck` finished it before the pass could type. */
export function settleFixedLine(
  deps: Pick<NudgeLaneDeps, 'coord' | 'now' | 'warn'>, delivery: { readonly id: number; readonly deliveredAt: number | null },
): void {
  if (delivery.deliveredAt === null) ackDelivery(deps, delivery.id);
}

/** Before the mail lane types a due delivery: a fixed line delivered once whose ack never landed (`fixedLineReplayOf` answers
 *  `ack-only`, review 3389 F1) is acked through the same writer, and nothing is typed. True when the pass is done with the row; a
 *  refused ack (an ack already landed: terminal) is logged and changes nothing. */
export function finishFixedLineAck(
  deps: Pick<NudgeLaneDeps, 'coord' | 'now' | 'warn'>, delivery: { readonly id: number; readonly deliveredAt: number | null },
  nudge: { readonly firstDelivery?: 'none' },
): boolean {
  if (fixedLineReplayOf(nudge, delivery.deliveredAt) !== 'ack-only') return false;
  ackDelivery(deps, delivery.id);
  return true;
}

/** After the mail lane typed a nudge and `markDelivered` landed: an operator message's move and ack, a fixed line's
 *  first-delivery ack, or nothing for the generic nudge. The table row decided which (`mailNudgeOf`); this only dispatches. */
export function settleNudge(
  deps: NudgeLaneDeps, delivery: { readonly id: number; readonly deliveredAt: number | null },
  nudge: { readonly operatorMessageId: number | null; readonly firstDelivery?: 'none' },
): void {
  if (nudge.operatorMessageId !== null) settleOperatorNudge(deps, delivery, nudge.operatorMessageId);
  else if (nudge.firstDelivery === 'none') settleFixedLine(deps, delivery);
}

/** The ack route's half (review 2627 F-1): a session that acks its operator-message nudge itself, before the lane types it or
 *  while the lane's send is in flight (whose `markDelivered` is then refused as terminal), settles the row as the lane's own ack
 *  does, so a self-ack never leaves it `queued` until a boot. Called after an ack that landed; any other mail is left alone. */
export function settleAckedOperatorNudge(
  deps: Omit<NudgeLaneDeps, 'coord'> & { readonly coord: Pick<WatcherCoordPort, 'mailOrigin' | 'db'> }, mailId: number,
): void {
  const origin = deps.coord.mailOrigin(mailId);
  if (origin === null || !isOperatorMessageMail(origin)) return;
  deliverWhileQueued(deps, operatorMessageIdOf(origin.subject)!, false);
}

/** The `deliver` move, made at once when `due`, else only while the row, read text-free, is still `recorded` or `queued`. */
function deliverWhileQueued(deps: Omit<NudgeLaneDeps, 'coord'> & { readonly coord: Pick<WatcherCoordPort, 'db'> }, messageId: number, due: boolean): void {
  const om = deps.operatorModel;
  if (om === undefined) return;
  if (!due) {
    const state = om.messageStateOf(messageId);
    if (state.kind === 'unmeasured') { deps.warn(`ccrc-server: mail ack: operator message ${messageId}: state unmeasured (${state.why})`); return; }
    if (!BEFORE_DELIVERED.has(state.value)) return;
  }
  const moved = moveOperatorMessage({ store: om, coordDb: deps.coord.db, warn: deps.warn }, messageId, 'deliver', 'mail-lane', deps.now);
  if (!moved.ok) deps.warn(`ccrc-server: mail ack: operator message ${messageId}: deliver refused (${moved.error})`);
}
