import type { ReactNode } from 'react';

/** One line of the step ledger: its words, and the instant it was written (this device's clock). */
export interface LedgerLine { readonly text: string; readonly at: number }

const clock = (ms: number): string => {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

/**
 * "Run" (spec §12.3 frame 5; accounts plan Task A18): the step ledger, in mono, each line with its own clock. The line
 * still running breathes (`data-live`); a line that is done is still. The URL and code cards of the sign-in methods
 * join this frame in a later task; the paste method needs neither.
 */
export function RunFrame({ lines, live }: { lines: readonly LedgerLine[]; live: boolean }): ReactNode {
  return (
    <div className="acct-frame" data-frame="run">
      <ol className="acct-ledger">
        {lines.map((l, i) => (
          <li key={i} data-live={live && i === lines.length - 1 ? 'true' : undefined}>
            <span className="acct-ledger-dot" aria-hidden="true" />
            <span className="acct-ledger-clock">{clock(l.at)}</span>
            <span className="acct-ledger-text">{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
