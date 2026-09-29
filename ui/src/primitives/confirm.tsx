// QuickConfirm — the confirm-with-consequence-sentence sheet used by stop and
// move-account flows. The consequence line does the explaining in plain
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
      <p className="qc-consequence mb-5 text-base leading-normal text-ink-secondary">{consequence}</p>
      <div className="qc-actions grid gap-2">
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
