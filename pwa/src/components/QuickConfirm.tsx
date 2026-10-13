// QuickConfirm — the confirm-with-consequence-sentence sheet used by the
// release, forget and move-account flows. The consequence line does the explaining in plain
// language; confirming closes the sheet (callers surface progress/failure via
// toast). Cancel and scrim both just close.
//
// `consequence` is one line or several: a list renders one paragraph per line,
// in order, so the stall watch's sheet, built from the server's write effect,
// says each thing the write turns on or off on its own line (spec 2026-10-05
// §13, `confirm-on-stage-diff` (D-4034)). Every string caller is unchanged.
import type { ReactNode } from 'react';
import { Sheet } from './Sheet';
import './primitives.css';

export interface QuickConfirmProps {
  title: string;
  consequence: string | string[];
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
  const lines = typeof consequence === 'string' ? [consequence] : consequence;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {lines.map((line, i) => (
        <p key={i} className="qc-consequence">
          {line}
        </p>
      ))}
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
