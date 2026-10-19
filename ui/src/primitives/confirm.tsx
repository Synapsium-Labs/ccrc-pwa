// QuickConfirm — the confirm-with-consequence-sentence sheet used by the
// release, forget and move-account flows. The consequence line does the explaining in plain
// language; confirming closes the sheet (callers surface progress/failure via
// toast). Cancel and scrim both just close.
//
// `consequence` is one line or several: a list renders one paragraph per line,
// in order, so the stall watch's sheet, built from the server's write effect,
// says each thing the write turns on or off on its own line (spec 2026-10-05
// §13, `confirm-on-stage-diff` (D-4034)). Every string caller is unchanged.
// Each line is its own `QC_CONSEQUENCE` paragraph, margin included — the
// spacing the one-line sheet always had, once per line.
//
// `qc-consequence` and `qc-actions` are structural hooks, not styling — see
// button.tsx's note. Callers and tests reach the confirm button through
// `.qc-actions .btn-primary` (`.btn-danger` under `tone="danger"`), because
// the opener button behind the sheet matches the same role and name.
import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button } from './button';
import { Sheet } from './sheet';

/** The consequence sentence, and the row of answers under it.
 *
 *  TWO CONSTANTS, TWELVE CALL SITES. The markup census counted the
 *  consequence string at SEVEN and the actions row at FIVE — and one of each
 *  was right here, in the component the other eleven were copying. Four app
 *  sheets (`AbandonSheet`, `ArchiveConflictSheet`, `ResumeSheet`,
 *  `UpdateMoveSheet`) could not use `QuickConfirm` itself, because each needs
 *  a busy state, a disabled pair or extra content above the row — so each
 *  copied its INNARDS instead, hook class and utilities together.
 *
 *  That is the failure this names. The hooks were already shared; what was
 *  copied is the composition around them, which no stylesheet guard can see
 *  because it is not in a stylesheet.
 *
 *  `ArchiveSheet` and `UpdateMoveSheet` are call sites too. They once wrote
 *  `qc-consequence` and `qc-actions` bare, on the belief that the body's grid
 *  supplied the look; it did not. Main styled both classes in a stylesheet this
 *  package deleted, so bare hooks rendered unstyled (ink colour, no margin,
 *  buttons touching), caught by the takeover's per-width visual check. Both
 *  hooks are in `design-system-boundary`'s OWNED list now. */
export const QC_CONSEQUENCE = 'qc-consequence mb-5 text-base leading-normal text-ink-secondary';
export const QC_ACTIONS = 'qc-actions grid gap-2';

/** Cancel first (D-5507, settings spec §6.3; the give-back is D-5610): while `on`, the confirm's Cancel takes the focus on open (its caller
 *  sets `autoFocus` on it), and closing hands the focus back to the control that opened it.
 *
 *  WHY BOTH HALVES. `Sheet` is vaul, whose `autoFocus` is false: the sheet takes no focus on open, so today the
 *  opener keeps it, and that is every untouched caller's behaviour. Moving the focus to Cancel means something must
 *  give it back, because Radix's modal dialog returns it only to its own `Dialog.Trigger`, which no sheet here uses:
 *  without the second half a closed danger confirm leaves the focus on <body>.
 *
 *  The opener is read in an effect of the commit that opens the sheet. The sheet's portal mounts its content one
 *  pass later (Radix's `Portal` waits for a layout effect of its own, and React flushes this effect before that pass
 *  renders), so Cancel's `autoFocus` has not run yet and `document.activeElement` is still the opener
 *  (`quick-confirm-focus.test.tsx` pins it). It is given back in the effect's cleanup: by then the dialog's
 *  focus trap (`trapped={open}`) has released, and a focus moved outside a live trap would be pulled back in. An
 *  opener that has left the document is left alone; one that is disabled ignores the call (an Ack in flight), and its
 *  caller places the focus itself.
 *
 *  A REOPEN REUSES CANCEL (`cancelRef`, D-5610). `autoFocus` runs only when Cancel mounts, and a sheet keeps its closing
 *  content mounted through the close transition, so a confirm reopened inside it opens on the very same Cancel and
 *  `autoFocus` never fires: measured in a browser, the focus stayed on the opener behind the open modal. When the
 *  caller's Cancel is already in the document as the sheet opens, this effect focuses it itself (after reading the
 *  opener); a first open, with the content not mounted yet, is still `autoFocus`'s. */
export function useCancelFirst(open: boolean, on: boolean, cancelRef?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open || !on) return undefined;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const cancel = cancelRef?.current ?? null;
    if (cancel !== null && cancel.isConnected && cancel !== active) cancel.focus();
    return () => {
      if (opener !== null && opener.isConnected) opener.focus();
    };
  }, [open, on, cancelRef]);
}

export interface QuickConfirmProps {
  title: string;
  consequence: string | string[];
  confirmLabel: string;
  onConfirm: () => void;
  open: boolean;
  onClose: () => void;
  /** What the confirm does (D-5099). `commit` (the default) is the phosphor
   *  `primary`; `danger` is the filled red `danger` button, for a confirm that
   *  destroys something (the fleet host's reboot, Archive all). Cancel is the
   *  ghost either way. A caller reaching the confirm by its hook class reads
   *  `.qc-actions .btn-danger` under `danger`. */
  tone?: 'commit' | 'danger';
  /** Which answer holds the focus when the sheet opens (D-5507). `confirm`, the default, is today's behaviour: the
   *  sheet moves no focus, so every caller that does not pass it is unchanged. `cancel` focuses Cancel, and closing
   *  returns the focus to the opener (`useCancelFirst`): a danger confirm answered by habit answers no. */
  defaultFocus?: 'confirm' | 'cancel';
}

export function QuickConfirm({
  title,
  consequence,
  confirmLabel,
  onConfirm,
  open,
  onClose,
  tone = 'commit',
  defaultFocus = 'confirm',
}: QuickConfirmProps): ReactNode {
  const cancelFirst = defaultFocus === 'cancel';
  const cancelRef = useRef<HTMLButtonElement>(null);
  useCancelFirst(open, cancelFirst, cancelRef);
  const lines = typeof consequence === 'string' ? [consequence] : consequence;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {lines.map((line, i) => (
        <p key={i} className={QC_CONSEQUENCE}>
          {line}
        </p>
      ))}
      <div className={QC_ACTIONS}>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} variant="ghost" autoFocus={cancelFirst} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
