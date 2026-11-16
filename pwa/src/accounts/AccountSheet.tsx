// THE ACCOUNT SHEETS' SHELL (spec §12.3, §12.4; accounts plan Tasks A18, A22 and A23, D-7871 (4)): the sheet, its one
// live region (a step change announced politely, a terminal state as an alert) and the offline sentence above the
// frame. The connect sheet and the method switch sheet draw the same shell, so it is written once here.
import type { ReactNode } from 'react';
import { Sheet } from '@ccrc/ui';

/** What the live region says: a step change (`status`) or a terminal state (`alert`). */
export type Announcement = { readonly kind: 'status' | 'alert'; readonly text: string };

export function AccountSheet({ open, onClose, title, eyebrow, frame, said, offline, testIds, className, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  /** The frame drawn, on `data-frame`. */
  frame: string;
  said: Announcement | null;
  /** The offline refusal, or `null`. */
  offline: string | null;
  /** The live region's test ids' prefix (`connect` → `connect-status`, `connect-alert`). */
  testIds: string;
  /** A hook class beside `acct-connect`, naming the sheet (the re-auth sheet's `acct-reauth`, Task A38). */
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Sheet open={open} onClose={onClose} title={title} eyebrow={eyebrow} size="md">
      <div className={className === undefined ? 'acct-connect' : `acct-connect ${className}`} data-frame={frame}>
        {/* One live region per sheet (spec §12.4): a step change is polite, a terminal state an alert. */}
        <div className="sr-only">
          <p role="status" data-testid={`${testIds}-status`}>{said?.kind === 'status' ? said.text : ''}</p>
          <p role="alert" data-testid={`${testIds}-alert`}>{said?.kind === 'alert' ? said.text : ''}</p>
        </div>
        {offline !== null && <p className="acct-offline">{offline}</p>}
        {children}
      </div>
    </Sheet>
  );
}
