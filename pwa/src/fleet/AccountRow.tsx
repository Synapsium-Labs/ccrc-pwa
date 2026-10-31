// The account picker's ROW — one chip, two gauges, one chevron.
//
// WHY IT IS ITS OWN FILE. It is shared by both pickers (SwapSheet's targets
// and NewSessionSheet's step 1) and was reached through one of them; ONE row
// component is the point, so it lives where neither sheet owns it.
//
// TWO SHARED VOCABULARIES, both deliberate and both argued below: a window's
// reading is `windowReading`'s (laneWords.ts, R48: every window prints a
// percentage), the same function `AccountMeterRow` renders, and the condemned
// lane says the Accounts screen's own sentence. A second visual language for
// the same fact is the thing this row refuses to invent.
//
// The classes stay `acct-*`: fleet.css grounds them. The shape moves, the
// ground stays.
import type { CSSProperties, ReactNode } from 'react';
import type { RosterWire } from '../../../shared/api';
import { Chip, ListRow, Meter, limitBand } from '@ccrc/ui';
import { accountHue, accountLabel, SIGN_IN_EXPIRED } from '../lib/accounts';
import { condemned, type AccountFacts } from './accountPicker';
import { windowReading } from './laneWords';
import { PoolTag } from './PoolTag';
import './fleet.css';

/** One thin gauge row — mono label · track · tabular percentage. Spans only,
 *  so the row stays valid inside the AccountRow button.
 *
 *  THE READING IS `windowReading`'s, NO LONGER `AccountsScreen`'s `Bar` WORD FOR
 *  WORD (R48, the coordinator's ruling: every window everywhere prints a
 *  percentage): a measured window prints `n%` once; a rolled-over one (an
 *  inferred zero) prints "0%", and a window nobody measured prints "—". Where
 *  the spoken words differ from what is shown, the glyphs are `aria-hidden`
 *  and the words sit beside them in an `sr-only` span, so the row's button name
 *  gains "inferred: the window reset" or "not measured". The track is left
 *  EMPTY for a rolled-over window, which `Meter` draws for a null `pct`: the 0
 *  a fill would draw is the inferred one, and a confident bar beside an
 *  inferred 0% would claim a measurement in the same row.
 *
 *  The bar itself is `Meter`, the one meter every gauge draws through
 *  (D-5098); this keeps only the `acct-gauge` wrapper and the words. */
function Gauge({ label, value, rolledOver, off = false }: {
  label: string; value: number | null; rolledOver: boolean; off?: boolean;
}): ReactNode {
  // The precedence (never measured, then rolled over) is `windowReading`'s, so the Gauge hands it the clamped value and
  // the flag and decides nothing itself. The meter gets no value for a rolled-over window (its track stays empty) nor
  // for a never-measured one.
  const clamped = value === null ? null : Math.min(100, Math.max(0, value));
  const pct = rolledOver ? null : clamped;
  const { shown, spoken } = windowReading(clamped === null ? null : Math.round(clamped), rolledOver);
  return (
    <span className="acct-gauge">
      <span>{label}</span>
      <Meter pct={pct} band={pct === null ? 'none' : limitBand(pct)} off={off} />
      <span className="acct-gauge-pct">
        {spoken === shown ? shown : (
          <>
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">{spoken}</span>
          </>
        )}
      </span>
    </span>
  );
}

/** A tappable account row: chip (label + hue), limit gauges, chevron.
 *  Shared by SwapSheet (targets) and NewSessionSheet (step 1) — ONE row
 *  component, so both pickers say the same thing about the same account, and
 *  both are fed from the same source (`useAccountUsage`) for the same reason.
 *
 *  A lane the health probe CONDEMNED is rendered here rather than removed
 *  upstream, and it says so in `AccountsScreen`'s own words ("sign-in expired
 *  on the fleet host") through `AccountsScreen`'s own `data-disabled`
 *  attribute — the second vocabulary this file is careful not to invent, for
 *  the same reason `Gauge` shares `windowReading`. The row stays TAPPABLE:
 *  a measurement can be wrong, and the manual swap it feeds accepts the target
 *  regardless (see `disabledWrappers`), so removing the affordance would only
 *  hide the one destination a bad probe run left. `condemned` is the single
 *  reader of the flag on this side. */
export function AccountRow({
  wrapper,
  facts,
  suggested = false,
  onPick,
  roster,
  poolChip,
}: {
  wrapper: string;
  facts: AccountFacts;
  suggested?: boolean;
  onPick: (wrapper: string) => void;
  roster: readonly RosterWire[];
  /** The account's pool name when a caller chooses to expose membership.
   *  Swap targets pass it for crossing rows; new-session account rows pass it
   *  for every known membership. A missing account pool stays quiet. */
  poolChip?: string | null;
}): ReactNode {
  // A direct hue lookup, not a re-parse of `accountColorVar`'s returned
  // token NAME: the string-inspection this replaced
  // (`colorVar.startsWith('--acct-')`) worked only by coincidence — it was
  // really asking "does this wrapper have a real hue", and `accountHue`
  // answers that directly, `undefined` for a wrapper the roster does not
  // have. The `--bg-raised` fallback is unchanged: a wrapper outside the
  // roster (a live session reporting an id this roster build does not know)
  // still gets a neutral chip, never an invented tint.
  const hue = accountHue(roster, wrapper);
  const colorVar = hue === undefined ? '--ink-tertiary' : `--acct-${hue}`;
  const chipStyle: CSSProperties = {
    color: `var(${colorVar})`,
    background: hue === undefined ? 'var(--bg-raised)' : `var(${colorVar}-tint)`,
  };
  const off = condemned(facts);
  // `acct-pick`, NEVER `acct-row`. `.acct-row` is `AccountMeterRow`'s gauge
  // line, an UNLAYERED grid rule in fleet.css, and unlayered app rules beat the
  // `@layer utilities` that give ListRow its shape: wearing that name turned
  // this row into a four-column grid (gap 5px, chip squeezed to 18px, the
  // "suggested" pill over the account name). One class, one element —
  // `hook-class-collision.test.ts` reds on a name worn by both.
  return (
    <ListRow
      className="acct-pick"
      data-disabled={off ? 'true' : 'false'}
      onClick={() => onPick(wrapper)}
    >
      {/* D-5570: the name and its secondary tags are ONE group, the part of
          the row that gives way at phone width. The group wraps, so the
          suggested pill and the pool tag drop under the name instead of
          crushing it, and only the pool tag truncates, past the group's own
          width. The name is what the operator chooses by: it wraps in an
          extreme case, never ellipses. fleet.css's `.acct-ident` says how. */}
      <span className="acct-ident">
        <Chip dot style={chipStyle}>
          {accountLabel(roster, wrapper)}
        </Chip>
        {suggested && <span className="acct-suggested">suggested</span>}
        <PoolTag pool={poolChip} />
      </span>
      <span className="acct-gauges">
        {/* Above the gauges, not instead of them: the numbers are still true of
            the last moment anything ran there, and this is the sentence that
            says why they stopped moving. The gauges take the meter's `off`
            for the reason AccountsScreen greys its own — a frozen crit-red bar
            reads as live pressure on a lane nothing is running on. It was a
            `[data-disabled]` rule in fleet.css reaching into the fill; the
            component owns its own appearance now. */}
        {off && <span className="acct-condemned">{`${SIGN_IN_EXPIRED} on the fleet host`}</span>}
        {facts === null ? (
          <span className="acct-unknown">limits unknown</span>
        ) : (
          <>
            <Gauge label="5h" value={facts.five} rolledOver={facts.fiveRolledOver === true} off={off} />
            <Gauge label="7d" value={facts.seven} rolledOver={facts.sevenRolledOver === true} off={off} />
          </>
        )}
      </span>
      <span className="acct-chev" aria-hidden="true">
        ›
      </span>
    </ListRow>
  );
}
