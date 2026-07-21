// QuickConfirm — the confirm-with-consequence-sentence sheet used by stop and
// move-account flows. The consequence line does the explaining in plain
// language; confirming closes the sheet (callers surface progress/failure via
// toast). Cancel and scrim both just close.
import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import './primitives.css';

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
      <p className="qc-consequence">{consequence}</p>
      <div className="qc-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
