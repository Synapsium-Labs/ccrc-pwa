// The controls an item or a review cap carries on `/waiting` (runs rebuild §8.7 and §10, F21; D-8076): one tap plus a confirm,
// on the row and in the item view, from this one place.
//   * An end-request item (`ItemAction` verb `end-run`): "Abandon run", which opens the single `AbandonSheet` whose confirm
//     calls `POST /api/items/:id/act`, and "Keep the run", which opens `KeepRunSheet` whose confirm calls `/decline`.
//   * A refused-close item (`ItemAction` verb `close-refused`, Task 27): one control per door it carries. "Abandon" and "Abandon
//     anyway" open the same `AbandonSheet` (its confirm calls `/act`; "Abandon anyway" adds "The branch stays on disk."), "Hand to
//     a coordinator" opens `ResumeSheet` at its third step, and the three links open the run, its worker or its coordinator.
//   * A run whose review cap waits: "Lift cap", which opens the unchanged `LiftCapSheet`.
// The sheets are mounted ONCE by whichever screen draws the controls (`useItemActs`), on `RunsScreen`'s idiom, and the controls
// only tell it which target to open. A saved copy of the list draws the controls disabled (`enabled`), like every other act.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, cn } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { isCloseRefusedAction, isEndRunAction, type CloseRefusedAction, type ItemDoor, type ItemView } from '../../../shared/ledgers';
import { AbandonSheet, abandonChildOf } from '../fleet/AbandonSheet';
import { KeepRunSheet, type KeepRunTarget } from '../fleet/KeepRunSheet';
import { LiftCapSheet } from '../fleet/LiftCapSheet';
import { ResumeSheet } from '../fleet/ResumeSheet';
import { resumeHeirs } from '../fleet/resumeHeirs';
import { inAppClick } from '../fleet/settingsText';
import { capWaiting } from '../fleet/reviewCapWords';
import { workerOf } from '../fleet/runWords';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { runPath, sessionPath } from '../lib/routes';
import './ledgers.css';

/** The controls' words, once. */
export const ITEM_ACT_WORDS = { abandon: 'Abandon run', keep: 'Keep the run', lift: 'Lift cap' } as const;

/** The words of each door of a refused-close item (spec §12.2, A19). */
export const ITEM_DOOR_WORDS: Readonly<Record<ItemDoor, string>> = {
  'open-pr': 'Open the PR',
  'hand-to-coordinator': 'Hand to a coordinator',
  abandon: 'Abandon',
  'abandon-anyway': 'Abandon anyway',
  'open-worker': 'Open the worker',
  'open-coordinator': 'Open the coordinator',
};

/** The page each link door opens (all three exist for the run): the run's own page, its worker's session, its coordinator's session.
 *  A session the run does not name falls back to the run's page, where the next act is. */
export function doorPath(door: 'open-pr' | 'open-worker' | 'open-coordinator', runId: number, run: RunSummary | null): string {
  if (door === 'open-worker' && run?.sessionId != null) return sessionPath(run.sessionId);
  if (door === 'open-coordinator' && run?.claimedBy != null) return sessionPath(run.claimedBy);
  return runPath(runId);
}

/** What a control does when tapped: opens the sheet of its target. */
export interface ItemActs {
  /** `anyway` is the "Abandon anyway" door: the same sheet and the same `/act`, with the line that the branch stays on disk. */
  readonly abandon: (item: ItemView, run: RunSummary, anyway?: boolean) => void;
  readonly hand: (item: ItemView, run: RunSummary) => void;
  readonly keep: (item: ItemView, runId: number) => void;
  readonly lift: (run: RunSummary) => void;
}

/** The run an end-request item asks to end, or `null` when it is not one, is not open, or the run is not among the runs heard. */
export const endRunOf = (item: ItemView, runs: readonly RunSummary[] | null): { runId: number; run: RunSummary | null } | null => {
  const action = item.action ?? null;
  if (!isEndRunAction(action) || item.state !== 'open') return null;
  return { runId: action.runId, run: runs?.find((r) => r.id === action.runId) ?? null };
};

/** The refused-close action an open item carries, or `null`. */
export const closeRefusedOf = (item: ItemView): CloseRefusedAction | null => {
  const action = item.action ?? null;
  return isCloseRefusedAction(action) && item.state === 'open' ? action : null;
};

/** Does this item carry controls of its own (an end request, or a refused close)? The row then lays them beside itself. */
export const carriesControls = (item: ItemView, runs: readonly RunSummary[] | null): boolean =>
  endRunOf(item, runs) !== null || closeRefusedOf(item) !== null;

/** The sheets and the targets that open them. Render `sheets` once, anywhere under the screen. `sessions` (the fleet
 *  rows heard, or `null`) lets the abandon sheet say whether the run's workspace is a child's. `onActed` is told when an
 *  Abandon run or a Keep the run landed (the item page steps back to its list). */
export function useItemActs(sessions: readonly FleetSession[] | null = null, onActed?: () => void): { acts: ItemActs; sheets: ReactNode } {
  const [abandon, setAbandon] = useState<{ item: number; run: RunSummary; anyway: boolean } | null>(null);
  const [hand, setHand] = useState<RunSummary | null>(null);
  const [keep, setKeep] = useState<KeepRunTarget | null>(null);
  const [lift, setLift] = useState<RunSummary | null>(null);
  const acts: ItemActs = {
    abandon: (item, run, anyway = false) => setAbandon({ item: item.id, run, anyway }),
    hand: (_item, run) => setHand(run),
    keep: (item, runId) => setKeep({ itemId: item.id, runId }),
    lift: setLift,
  };
  const sheets = (
    <>
      <AbandonSheet run={abandon?.run ?? null} {...(abandon === null ? {} : { itemId: abandon.item })}
                    workspaceChild={abandonChildOf(abandon === null || sessions === null ? undefined : workerOf(abandon.run, new Map(sessions.map((s) => [s.id, s] as const))) ?? undefined)}
                    {...(abandon?.anyway === true ? { anyway: true } : {})}
                    onClose={() => setAbandon(null)} {...(onActed === undefined ? {} : { onDone: onActed })} />
      <ResumeSheet run={hand} atReclaim onClose={() => setHand(null)} {...(onActed === undefined ? {} : { onDone: onActed })}
                   heirs={hand === null || sessions === null ? [] : resumeHeirs(sessions, hand.project, hand.claimedBy, true)} />
      <KeepRunSheet target={keep} onClose={() => setKeep(null)} {...(onActed === undefined ? {} : { onDone: onActed })} />
      <LiftCapSheet run={lift} onClose={() => setLift(null)} />
    </>
  );
  return { acts, sheets };
}

/** An end-request item's two controls, or nothing for any other item. "Abandon run" needs the run itself (the sheet names it),
 *  so it is drawn only once the run is among the runs heard; a run that has closed is the server's to settle. */
export function EndRunControls({ item, runs, acts, enabled = true }: {
  item: ItemView; runs: readonly RunSummary[] | null; acts: ItemActs; enabled?: boolean;
}): ReactNode {
  const end = endRunOf(item, runs);
  if (end === null) return null;
  return (
    <div className="wl-acts" role="group" aria-label={`Run ${end.runId}`} data-item-acts={item.id}>
      {end.run !== null && (
        <Button variant="danger" size="fit" disabled={!enabled} onClick={() => acts.abandon(item, end.run!)}>{ITEM_ACT_WORDS.abandon}</Button>
      )}
      <Button variant="ghost" size="fit" disabled={!enabled} onClick={() => acts.keep(item, end.runId)}>{ITEM_ACT_WORDS.keep}</Button>
    </div>
  );
}

/** A refused-close item's controls, one per door, or nothing for any other item. The abandoning and hand-over doors need the run
 *  itself (the sheet names it), so they are drawn once the run is among the runs heard; the three links need no run. */
export function CloseRefusedControls({ item, runs, acts, enabled = true }: {
  item: ItemView; runs: readonly RunSummary[] | null; acts: ItemActs; enabled?: boolean;
}): ReactNode {
  const action = closeRefusedOf(item);
  if (action === null) return null;
  const run = runs?.find((r) => r.id === action.runId) ?? null;
  return (
    <div className="wl-acts" role="group" aria-label={`Run ${action.runId}`} data-item-acts={item.id}>
      {action.doors.map((door) => {
        const words = ITEM_DOOR_WORDS[door];
        if (door === 'open-pr' || door === 'open-worker' || door === 'open-coordinator') {
          const href = doorPath(door, action.runId, run);
          return <a key={door} className={cn(GHOST_ANCHOR, 'wl-door')} href={href} data-door={door} onClick={inAppClick(href)}>{words}</a>;
        }
        if (run === null) return null;
        if (door === 'hand-to-coordinator') {
          return <Button key={door} variant="primary" size="fit" disabled={!enabled} data-door={door} onClick={() => acts.hand(item, run)}>{words}</Button>;
        }
        return (
          <Button key={door} variant="danger" size="fit" disabled={!enabled} data-door={door} onClick={() => acts.abandon(item, run, door === 'abandon-anyway')}>{words}</Button>
        );
      })}
    </div>
  );
}

/** Whatever controls an item carries: an end request's two, a refused close's doors, or nothing. */
export function ItemControls(props: { item: ItemView; runs: readonly RunSummary[] | null; acts: ItemActs; enabled?: boolean }): ReactNode {
  return (
    <>
      <EndRunControls {...props} />
      <CloseRefusedControls {...props} />
    </>
  );
}

/** The Lift cap control of a run whose review cap waits. */
export function LiftCapControl({ run, acts, enabled = true }: { run: RunSummary; acts: ItemActs; enabled?: boolean }): ReactNode {
  if (capWaiting(run) !== 'waiting') return null;
  return (
    <div className="wl-acts" data-cap-acts={run.id}>
      <Button variant="primary" size="fit" disabled={!enabled} onClick={() => acts.lift(run)}>{ITEM_ACT_WORDS.lift}</Button>
    </div>
  );
}
