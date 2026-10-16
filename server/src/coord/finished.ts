import type { TurnMarkRead } from './stall.js';

/**
 * FINISHED NEEDS A MAIN STOP (D-5233, working-state spec §5.3). L1, pure: no fs, no clock.
 *
 * The watcher's "✓ Finished" push fires at a live busy→idle edge only when a main-thread Stop falls inside that busy
 * episode. The episode starts at the busy row's `statusUpdatedAt` (the live file writes on change, so that stamp is
 * the stretch's start), which the watcher keeps per id while the row stays busy and hands in as `busySince`.
 *
 * The evidence, read at the edge for that id only:
 * - the turn marker, `ok`: state `done`, a `stopAt`, `stopAt` not before `turnAt` (no newer turn opened after the
 *   last Stop: an Escape- or kill-ended turn writes no Stop), and `stopAt` at or after `busySince` less
 *   `FINISHED_EPISODE_SLACK_MS` (a Stop from before the stretch, as in a compaction-only stretch, is not this
 *   episode's);
 * - an `absent` marker (an older hook, or a row ccd did not create): the hookstate the tick already holds, `done` from
 *   a `Stop` at or after `busySince`. With no hookstate read at all there is nothing newer to judge by, so the edge
 *   keeps the push it had before this rule (absent means the old behaviour);
 * - every other reading (`unmeasured`, `malformed`, `foreign`, `stale`): nothing is pushed. A stale marker is a
 *   restart: the Stop it records belongs to a process that is gone.
 */

/** The marker's `stopAt` and the live file's busy write come from two writers; a Stop this close before the busy
 *  stamp still belongs to the episode (§5.3, "less 2 s"). */
export const FINISHED_EPISODE_SLACK_MS = 2_000;

/** The hookstate facts the absent-marker fallback reads (`HookState`'s `state`, `event`, `updatedAt`). */
export interface FinishedHookFact { readonly state: string; readonly event: string | null; readonly updatedAt: number }

export function finishedAfter(mark: TurnMarkRead, hook: FinishedHookFact | null, busySince: number): boolean {
  if (mark.ok) {
    if (mark.state !== 'done' || mark.stopAt === null) return false;
    if (mark.turnAt !== null && mark.stopAt < mark.turnAt) return false;
    return mark.stopAt >= busySince - FINISHED_EPISODE_SLACK_MS;
  }
  if (mark.reason !== 'absent') return false;
  if (hook === null) return true;
  return hook.state === 'done' && hook.event === 'Stop' && hook.updatedAt >= busySince;
}
