import { TASKS_STALE_MS } from '../../../shared/api';

/** `stale-task-strip` (D-5372): the ms a task list has gone unwritten, when
 *  that is longer than `TASKS_STALE_MS`; undefined otherwise, and when the
 *  tasks frame carried no `touchedAt` (an older server, nothing open, no stat
 *  answered) — absence keeps the strip as it always was. The one place the
 *  threshold is read: `@ccrc/ui` takes no value from shared/, so `TaskStrip`
 *  is handed the answer rather than the rule. */
export function staleFor(touchedAt: number | undefined, now: number): number | undefined {
  if (touchedAt === undefined) return undefined;
  const age = now - touchedAt;
  return age > TASKS_STALE_MS ? age : undefined;
}
