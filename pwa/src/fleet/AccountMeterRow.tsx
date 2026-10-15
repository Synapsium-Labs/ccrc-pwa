// One account/window meter row: label, banded meter, %, reset countdown.
//
// ONE implementation. AccountsStrip and AccountsScreen each carried a private
// copy of this JSX (`LimitRow` and `Bar`) that had drifted to byte-identical —
// two files that must agree on what a usage window LOOKS like, agreeing only
// by luck. The band thresholds had already drifted once before that (the strip
// carried its own `>= 75` against limitBand's `> 75`, so the same account read
// `crit` in one place and `warn` in the other at exactly 75); this is the same
// class of defect one level up, closed the same way.
//
// Styling is fleet.css's `.acct-*` family, which the strip's responsive shell
// rules (shell.css) also reach into — that is why this is not LimitBar: the
// `.limit-*` primitive is a 3-column bar with no reset countdown, a different
// component that happens to draw a bar too.
import type { ReactNode } from 'react';
import { limitBand } from '@ccrc/ui';
import { formatReset } from './formatReset';
import './fleet.css';

/** Band for the meter, with the one state `limitBand` has no word for. */
function band(pct: number | null): string {
  return pct === null ? 'none' : limitBand(pct);
}

export function AccountMeterRow({ label, pct, resetAt, nowSec, rolledOver }: {
  label: string;
  pct: number | null;
  resetAt: number | null;
  nowSec: number;
  rolledOver: boolean;
}): ReactNode {
  return (
    <div className="acct-row">
      <span className="acct-win">{label}</span>
      <span className="acct-meter" data-band={band(pct)}>
        <span className="acct-fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </span>
      {/* A three-way, never collapsed: "reset" (the window ended and nothing has
          measured the new one yet, so the zero is INFERRED from the reset
          timestamp) ≠ a measured "0%" (something ran, the account really is
          empty) ≠ "—" (never measured at all). Callers differ on whether a row
          renders at all — the strip drops a window an account does not have,
          the screen always renders both — but not on what the three mean. */}
      <span className="acct-pct">{rolledOver ? 'reset' : pct === null ? '—' : `${pct}%`}</span>
      <span className="acct-reset" title="time until this window resets">↻ {formatReset(resetAt, nowSec)}</span>
    </div>
  );
}
