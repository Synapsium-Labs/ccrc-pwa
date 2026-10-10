// QuickConfirm — the confirm-with-consequence-sentence sheet used by the
// release, forget and move-account flows. The consequence line does the explaining in plain
// language; confirming closes the sheet (callers surface progress/failure via
// toast). Cancel and scrim both just close.
//
// `qc-consequence` and `qc-actions` are structural hooks, not styling — see
// button.tsx's note. Callers and tests reach the confirm button through
// `.qc-actions .btn-primary`, because the opener button behind the sheet
// matches the same role and name.
import type { ReactNode } from 'react';
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
 *  `ArchiveSheet` is deliberately NOT a call site. It writes `qc-consequence`
 *  and `qc-actions` bare, with no utilities at all, because its body sits in
 *  `.abandon-sheet`'s own `display: grid; gap: var(--sp-3)` and takes its
 *  spacing from there. That renders differently from a sheet that also adds
 *  `mb-5`, and it is left exactly as it is: this wave moves no pixels. */
export const QC_CONSEQUENCE = 'qc-consequence mb-5 text-base leading-normal text-ink-secondary';
export const QC_ACTIONS = 'qc-actions grid gap-2';

export interface QuickConfirmProps {
  title: string;
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
  open: boolean;
  onClose: () => void;
}

export function QuickConfirm({
  title,
  consequence,
  confirmLabel,
  onConfirm,
  open,
  onClose,
}: QuickConfirmProps): ReactNode {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className={QC_CONSEQUENCE}>{consequence}</p>
      <div className={QC_ACTIONS}>
        <Button
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
