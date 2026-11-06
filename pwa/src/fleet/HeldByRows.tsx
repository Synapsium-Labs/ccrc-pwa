// The held-rows list (cleanup un-wedge R2): the registry rows that hold the automatic cleanup, one line each, in
// `AttentionList`'s shape. Each line carries ONE control, and a tap only opens its confirm; only the confirm acts.
// The server decided the act and wrote the sentence (`heldByRowControl` is the console's own check that forget is
// never offered beyond gone-unrecorded). Forget calls the existing forget door with exactly the row id the server named;
// "Check again" sends nothing: it re-reads the latest status the store already holds, and the line says ccrc reads the
// row again when it next checks the children it holds, at their own pace (minutes to hours). It never implies it asked
// the server. Nothing here stops a process or offers any other act.
import { useEffect, useState, type ReactNode } from 'react';
import { Button, QuickConfirm, toast } from '@ccrc/ui';
import { api, failedTo } from '../lib/api';
import { AttentionList } from './AttentionList';
import {
  CLEANUP_HELD_BY_CONTROL, CLEANUP_HELD_BY_LABEL, CLEANUP_HELD_BY_RECHECKED, heldByRowControl, heldByRowForgot,
  heldByRowLine, heldByRowsOf, heldByRowWho,
} from './heldByRowsWords';

export function HeldByRows(
  { coord, forget = api.forget }: { coord: unknown; forget?: (id: string) => Promise<void> },
): ReactNode {
  // Which row's confirm is open, and which rows were checked again (rowId -> the line as it read then), both keyed by
  // rowId. A note shows only while its row's line reads as it did when checked, so a changed line drops it.
  const [openId, setOpenId] = useState<string | null>(null);
  const [rechecked, setRechecked] = useState<Readonly<Record<string, string>>>({});
  const items = heldByRowsOf(coord);
  const confirming = items.find((i) => i.rowId === openId) ?? null;
  const control = confirming === null ? null : CLEANUP_HELD_BY_CONTROL[heldByRowControl(confirming)];
  // A confirm whose row left the list is closed for good: it never reopens by itself when the row comes back.
  const openGone = openId !== null && confirming === null;
  useEffect(() => { if (openGone) setOpenId(null); }, [openGone]);

  const confirm = (): void => {
    if (confirming === null) return;
    const { rowId } = confirming;
    if (heldByRowControl(confirming) === 'recheck') {
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
              <Button variant="quiet" size="fit" aria-label={CLEANUP_HELD_BY_CONTROL[heldByRowControl(item)].ariaLabel(item.rowId)}
                onClick={() => setOpenId(item.rowId)}>
                {CLEANUP_HELD_BY_CONTROL[heldByRowControl(item)].button}
              </Button>
              {rechecked[item.rowId] === heldByRowLine(item) && (
                <span className="child-reclaim-sentence">{CLEANUP_HELD_BY_RECHECKED}</span>
              )}
            </>
          ),
        }))}
      />
      <QuickConfirm
        open={confirming !== null}
        onClose={() => setOpenId(null)}
        title={control === null || confirming === null ? '' : control.title(confirming.rowId)}
        consequence={control === null || confirming === null ? '' : control.consequence(confirming)}
        confirmLabel={control === null ? '' : control.confirmLabel}
        onConfirm={confirm}
      />
    </>
  );
}
