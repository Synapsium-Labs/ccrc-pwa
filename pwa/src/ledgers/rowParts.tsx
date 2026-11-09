// The two pieces every row of the Waiting on you list shares (D-8123: extracted from `WaitingScreen.tsx` when the usage-limit
// row became a third wearer of the same shape, so the markup census does not count a block rendered by hand twice). A leaf:
// it imports no screen, so `WaitingScreen` and `LimitWaitRow` can both use it without importing each other.
import type { ReactNode } from 'react';
import type { Pill } from './ledgerWords';

/** The right-hand end of a row: its pills and when, ONE block for an item, a session's question and a usage-limit row. */
export function RowMeta({ pills, when }: { pills: readonly Pill[]; when: string }): ReactNode {
  return (
    <span className="wl-meta">
      {pills.map((p) => <span key={p.tone} className="wl-pill" data-tone={p.tone}>{p.word}</span>)}
      <span>{when}</span>
    </span>
  );
}

/** The middle of a question row and a usage-limit row: what it is, and why it is on the list. (An item's has a third line.) */
export function RowMain({ what, why }: { what: string; why: string }): ReactNode {
  return (
    <span className="wl-main">
      <span className="wl-what">{what}</span>
      <span className="wl-why">{why}</span>
    </span>
  );
}
