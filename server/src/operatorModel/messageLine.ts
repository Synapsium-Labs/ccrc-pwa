// An operator message's move and its sequence line (Overlord §10.4; sequence PR B1, call 1218, slug
// `message-lines-stamp-after-the-move`). Ring L4, context C11: an act over two stores, as `nudgeLane.ts` is, deciding nothing of
// its own. `moveOperatorMessage` is the private store's one move, then, in the same synchronous segment (no `await` can fall between
// them), the line `stampMessageLine` writes in a coordination transaction of its own, only when the move changed the state word.
// Every mover goes through it: the prompt route, the mail lane and a session's own ack of its nudge, the boot pass and the hook's
// pick-up; the acknowledge door keeps its own after-commit stamp and answer (`overlordInboxRoutes.ts`).
//
// A REFUSED OR FAILED STAMP never changes what the mover answers or does: the move stands (no transaction spans the two files),
// only the line's transaction rolls back, and one `ccrc-server:` line names the message id and the state, never its words. If the
// process stops between the move and its line, the line is missing for good: a reader takes a state with no line as unmeasured.
import type { DatabaseSync } from 'node:sqlite';
import { stampMessageLine } from '../coord/overlordSequenceStore.js';
import type { MessageActor, MessageEvent, MessageState } from '../../../shared/operatorMessages.js';
import type { OperatorModelStore } from './store.js';

/** Where a line is written, and the log a missing one is reported to. `coordDb` is absent on a box with no coordination store. */
export interface MessageLineDeps { readonly coordDb: DatabaseSync | undefined; readonly warn: (line: string) => void }

/** Writes one message line now, logging a refusal or a missing store; never throws, and answers nothing a caller acts on. */
export function stampOperatorMessageLine(deps: MessageLineDeps, id: number, state: MessageState, actor: MessageActor, at: number): void {
  const missing = (why: string): void => { deps.warn(`ccrc-server: operator message ${id}: its sequence line (${state}) was not written (${why})`); };
  if (deps.coordDb === undefined) { missing('no coordination store'); return; }
  const s = stampMessageLine(deps.coordDb, { id, state, actor, at });
  if (!s.ok) missing(s.error);
}

/** The private store's move, answered exactly as the store answered it, then its line when the state word changed. */
export function moveOperatorMessage(
  deps: MessageLineDeps & { readonly store: Pick<OperatorModelStore, 'moveMessage'> }, id: number, event: MessageEvent, actor: MessageActor, at: number,
): ReturnType<OperatorModelStore['moveMessage']> {
  const moved = deps.store.moveMessage(id, event, actor, at);
  if (moved.ok && moved.value.from !== moved.value.state) stampOperatorMessageLine(deps, id, moved.value.state, actor, at);
  return moved;
}
