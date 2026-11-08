// The held-rows list (cleanup un-wedge R2): the registry rows that hold the automatic cleanup, one line each, in
// `AttentionList`'s shape. Each line carries ONE control, and a tap only opens its confirm; only the confirm acts.
// The server decided the act and wrote the sentence (`heldByRowControl` is the console's own check that forget is
// never offered beyond gone-unrecorded, nor where the session sheet would not offer it: a row listed dead, with no
// workspace and not asleep, Task C15). Forget calls the existing forget door with exactly the row id the server named;
// "Check again" sends nothing: it re-reads the latest status the store already holds, and the line says ccrc reads the
// row again when it next checks what it holds, at their own pace (minutes to hours), and nothing while the cleanup is
// paused. It never implies it asked the server. Nothing here stops a process or offers any other act.
import { useEffect, useState, type ReactNode } from 'react';
import type { CleanupHeldByAct, FleetSession } from '../../../shared/api';
import { Button, QuickConfirm, toast } from '@ccrc/ui';
import { api, failedTo } from '../lib/api';
import { AttentionList } from './AttentionList';
import {
  CLEANUP_HELD_BY_CONTROL, CLEANUP_HELD_BY_LABEL, CLEANUP_HELD_BY_RECHECKED, heldByRowControl, heldByRowForgot,
  heldByRowLine, heldByRowsOf, heldByRowWho,
} from './heldByRowsWords';

export function HeldByRows(
  { coord, sessions, forget = api.forget }: {
    coord: unknown;
    /** The fleet's rows, for Forget's presence check: the session sheet's own (`forgetOffered`). */
    sessions: readonly FleetSession[];
    forget?: (id: string) => Promise<void>;
  },
): ReactNode {
  // The open confirm, as `{rowId, act}` captured when it opened, and the rows checked again (rowId -> the line as it read
  // then). A confirm stays open only while its row is listed with the same control; a note only while its line reads
  // as it did when checked. Either is dropped for good otherwise, so neither comes back with an old frame.
  const [open, setOpen] = useState<{ rowId: string; act: CleanupHeldByAct } | null>(null);
  const [rechecked, setRechecked] = useState<Readonly<Record<string, string>>>({});
  const items = heldByRowsOf(coord);
  const listed = new Map(sessions.map((s) => [s.id, s]));
  const controlOf = (item: (typeof items)[number]): CleanupHeldByAct => heldByRowControl(item, listed.get(item.rowId));
  const listedOpen = open === null ? undefined : items.find((i) => i.rowId === open.rowId);
  const confirming = open !== null && listedOpen !== undefined && controlOf(listedOpen) === open.act ? listedOpen : null;
  const control = open === null || confirming === null ? null : CLEANUP_HELD_BY_CONTROL[open.act];
  const openStale = open !== null && confirming === null;
  useEffect(() => { if (openStale) setOpen(null); }, [openStale]);
  // A note whose line now differs (or whose row left) is dropped WHILE RENDERING, so React re-renders before it commits
  // and the note never shows beside a changed line, not even for one frame. It converges: the drop empties the list.
  const lines = new Map(items.map((i) => [i.rowId, heldByRowLine(i)]));
  const staleNotes = new Set(Object.keys(rechecked).filter((id) => lines.get(id) !== rechecked[id]));
  if (staleNotes.size > 0) setRechecked((r) => Object.fromEntries(Object.entries(r).filter(([id]) => !staleNotes.has(id))));

  const confirm = (): void => {
    if (open === null || confirming === null) return;
    const { rowId } = confirming;
    if (open.act === 'recheck') {
      const line = heldByRowLine(confirming);
      setRechecked((r) => ({ ...r, [rowId]: line }));
      return;
    }
    void (async () => {
      try {
        await forget(rowId);
        toast(heldByRowForgot(rowId));
      } catch (err) {
        toast(failedTo('forget', err), 'error');
      }
    })();
  };

  return (
    <>
      <AttentionList
        label={CLEANUP_HELD_BY_LABEL}
        lines={items.map((item) => ({
          key: item.rowId,
          who: [heldByRowWho(item)],
          sentence: item.sentence,
          control: (
            <>
              <Button variant="quiet" size="fit" aria-label={CLEANUP_HELD_BY_CONTROL[controlOf(item)].ariaLabel(item.rowId)}
                onClick={() => setOpen({ rowId: item.rowId, act: controlOf(item) })}>
                {CLEANUP_HELD_BY_CONTROL[controlOf(item)].button}
              </Button>
              {rechecked[item.rowId] !== undefined && (
                <span className="child-reclaim-sentence">{CLEANUP_HELD_BY_RECHECKED}</span>
              )}
            </>
          ),
        }))}
      />
      <QuickConfirm
        open={confirming !== null}
        onClose={() => setOpen(null)}
        title={control === null || confirming === null ? '' : control.title(confirming.rowId)}
        consequence={control === null || confirming === null ? '' : control.consequence(confirming)}
        confirmLabel={control === null ? '' : control.confirmLabel}
        onConfirm={confirm}
      />
    </>
  );
}
