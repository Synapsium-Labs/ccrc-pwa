// One account/window meter row: label, banded meter, %, reset countdown (the % is `windowReading`'s, R48).
//
// ONE implementation. AccountsStrip and AccountsScreen each carried a private
// copy of this JSX (`LimitRow` and `Bar`) that had drifted to byte-identical —
// two files that must agree on what a usage window LOOKS like, agreeing only
// by luck. The band thresholds had already drifted once before that (the strip
// carried its own `>= 75` against limitBand's `> 75`, so the same account read
// `crit` in one place and `warn` in the other at exactly 75); this is the same
// class of defect one level up, closed the same way.
//
// The ROW's layout is fleet.css's `.acct-*` family, which the strip's
// responsive shell rules (shell.css) also reach into — that is why this is not
// LimitBar, a 3-column bar with no reset countdown. The BAR is `Meter`, the one
// meter every gauge draws through (D-5098): it owns its height, radius, track
// and fill, so no sheet here sizes or paints it, and a skin's meter shape
// reaches the strip and the Accounts screen. `acct-meter`, `acct-fill` and
// `data-band` stay on the elements as hooks (fleet-screen.test.tsx counts
// `.acct-fill`).
import type { ReactNode } from 'react';
import { Meter, limitBand } from '@ccrc/ui';
import { formatReset } from './formatReset';
import { windowReading } from './laneWords';
import './fleet.css';

/** Band for the meter, with the one state `limitBand` has no word for. */
function band(pct: number | null): ReturnType<typeof limitBand> | 'none' {
  return pct === null ? 'none' : limitBand(pct);
}

/** The percentage cell: `shown` once, plus the spoken words only where they differ. */
function Reading({ reading }: { reading: ReturnType<typeof windowReading> }): ReactNode {
  const { shown, spoken } = reading;
  return (
    <span className="acct-pct">
      {spoken === shown ? shown : (
        <>
          <span aria-hidden="true">{shown}</span>
          <span className="sr-only">{spoken}</span>
        </>
      )}
    </span>
  );
}

export function AccountMeterRow({ label, pct, resetAt, nowSec, rolledOver, off = false }: {
  label: string;
  pct: number | null;
  resetAt: number | null;
  nowSec: number;
  rolledOver: boolean;
  /** The lane's readings stopped (disabled, or its sign-in expired): the fill
   *  greys while `data-band` keeps the frozen classification. */
  off?: boolean;
}): ReactNode {
  return (
    <div className="acct-row">
      <span className="acct-win">{label}</span>
      {/* An unmeasured window draws no fill at all: "never measured" stays a
          different picture from a measured 0%. */}
      <Meter pct={pct} band={band(pct)} off={off} trackClassName="acct-meter" fillClassName="acct-fill" />
      {/* R48: EVERY window prints a percentage, through `windowReading`, the one function that says how (the picker's
          `AccountRow` Gauge and the lanes' accessible names call it too). A rolled-over window (the window ended and
          nothing has measured the new one yet, so the zero is INFERRED from the reset timestamp) prints "0%" beside
          its countdown; a window never measured prints "—". The three stay three in what a screen reader hears:
          where `spoken` differs from `shown` the printed glyphs are `aria-hidden` and the words sit beside them in
          an `sr-only` span. A measured window speaks what it shows, so it prints once, in one node. */}
      <Reading reading={windowReading(pct, rolledOver)} />
      <span className="acct-reset" title="time until this window resets">↻ {formatReset(resetAt, nowSec)}</span>
    </div>
  );
}
