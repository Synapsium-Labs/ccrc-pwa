// The plan's deciders (Linear hierarchy design 2026-11-10, D-8181): pure, no I/O, no clock. L1. Task 2.2 lands the one
// decider the plan store needs (`epicIsDone`); Task 2.3 adds the rest of this file.
import type { CheckpointState, TicketState } from '../../../shared/plan.js';

/** An epic is done when no checkpoint is `open`, no ticket is `open` or `started`, and at least one checkpoint is `met` or
 *  one ticket `done` (design §4.1). An epic with nothing in it, or with everything dropped, is not done: a plan declared
 *  with an empty epic must not close it on the spot, and a fully dropped epic is dropped, not finished. */
export function epicIsDone(
  checkpoints: readonly { state: CheckpointState }[], tickets: readonly { state: TicketState }[],
): boolean {
  if (checkpoints.some((c) => c.state === 'open')) return false;
  if (tickets.some((t) => t.state === 'open' || t.state === 'started')) return false;
  return checkpoints.some((c) => c.state === 'met') || tickets.some((t) => t.state === 'done');
}
