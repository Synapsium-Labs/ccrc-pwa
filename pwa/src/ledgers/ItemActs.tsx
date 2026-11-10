// The controls an item or a review cap carries on `/waiting` (runs rebuild §8.7 and §10, F21; D-8076): one tap plus a confirm,
// on the row and in the item view, from this one place.
//   * An end-request item (`ItemAction` verb `end-run`): "Abandon run", which opens the single `AbandonSheet` whose confirm
//     calls `POST /api/items/:id/act`, and "Keep the run", which opens `KeepRunSheet` whose confirm calls `/decline`.
//   * A run whose review cap waits: "Lift cap", which opens the unchanged `LiftCapSheet`.
// The sheets are mounted ONCE by whichever screen draws the controls (`useItemActs`), on `RunsScreen`'s idiom, and the controls
// only tell it which target to open. A saved copy of the list draws the controls disabled (`enabled`), like every other act.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { isEndRunAction, type ItemView } from '../../../shared/ledgers';
import { AbandonSheet, abandonChildOf } from '../fleet/AbandonSheet';
import { KeepRunSheet, type KeepRunTarget } from '../fleet/KeepRunSheet';
import { LiftCapSheet } from '../fleet/LiftCapSheet';
import { capWaiting } from '../fleet/reviewCapWords';
import { workerOf } from '../fleet/runWords';
import './ledgers.css';

/** The controls' words, once. */
export const ITEM_ACT_WORDS = { abandon: 'Abandon run', keep: 'Keep the run', lift: 'Lift cap' } as const;

/** What a control does when tapped: opens the sheet of its target. */
export interface ItemActs {
  readonly abandon: (item: ItemView, run: RunSummary) => void;
  readonly keep: (item: ItemView, runId: number) => void;
  readonly lift: (run: RunSummary) => void;
}

/** The run an end-request item asks to end, or `null` when it is not one, is not open, or the run is not among the runs heard. */
export const endRunOf = (item: ItemView, runs: readonly RunSummary[] | null): { runId: number; run: RunSummary | null } | null => {
  const action = item.action ?? null;
  if (!isEndRunAction(action) || item.state !== 'open') return null;
  return { runId: action.runId, run: runs?.find((r) => r.id === action.runId) ?? null };
};

/** The three sheets and the three targets that open them. Render `sheets` once, anywhere under the screen. `sessions` (the fleet
 *  rows heard, or `null`) lets the abandon sheet say whether the run's workspace is a child's. `onActed` is told when an
 *  Abandon run or a Keep the run landed (the item page steps back to its list). */
export function useItemActs(sessions: readonly FleetSession[] | null = null, onActed?: () => void): { acts: ItemActs; sheets: ReactNode } {
  const [abandon, setAbandon] = useState<{ item: number; run: RunSummary } | null>(null);
  const [keep, setKeep] = useState<KeepRunTarget | null>(null);
  const [lift, setLift] = useState<RunSummary | null>(null);
  const acts: ItemActs = {
    abandon: (item, run) => setAbandon({ item: item.id, run }),
    keep: (item, runId) => setKeep({ itemId: item.id, runId }),
    lift: setLift,
  };
  const sheets = (
    <>
      <AbandonSheet run={abandon?.run ?? null} {...(abandon === null ? {} : { itemId: abandon.item })}
                    workspaceChild={abandonChildOf(abandon === null || sessions === null ? undefined : workerOf(abandon.run, new Map(sessions.map((s) => [s.id, s] as const))) ?? undefined)}
                    onClose={() => setAbandon(null)} {...(onActed === undefined ? {} : { onDone: onActed })} />
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

/** The Lift cap control of a run whose review cap waits. */
export function LiftCapControl({ run, acts, enabled = true }: { run: RunSummary; acts: ItemActs; enabled?: boolean }): ReactNode {
  if (capWaiting(run) !== 'waiting') return null;
  return (
    <div className="wl-acts" data-cap-acts={run.id}>
      <Button variant="primary" size="fit" disabled={!enabled} onClick={() => acts.lift(run)}>{ITEM_ACT_WORDS.lift}</Button>
    </div>
  );
}
