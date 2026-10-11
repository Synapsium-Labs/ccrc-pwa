// The account picker's ROW — one chip, two gauges, one chevron.
//
// WHY IT IS ITS OWN FILE. It is shared by both pickers (SwapSheet's targets
// and NewSessionSheet's step 1) and was reached through one of them; ONE row
// component is the point, so it lives where neither sheet owns it.
//
// TWO BORROWED VOCABULARIES, both deliberate and both argued below: the
// three-way "reset" / "0%" / "—" is `AccountsScreen`'s `Bar` word for word,
// and the condemned lane says that screen's own sentence. A second visual
// language for the same fact is the thing this row refuses to invent.
//
// The classes stay `acct-*`: fleet.css grounds them. The shape moves, the
// ground stays.
import type { CSSProperties, ReactNode } from 'react';
import type { RosterWire } from '../../../shared/api';
import { Chip, LIMIT_TRACK, ListRow, fillVariants, limitBand } from '@ccrc/ui';
import { accountHue, accountLabel } from '../lib/accounts';
import { condemned, type AccountFacts } from './accountPicker';
import { PoolTag } from './PoolTag';
import './fleet.css';

/** One thin gauge row — mono label · track · tabular percentage. Spans only,
 *  so the row stays valid inside the AccountRow button.
 *
 *  THE THREE-WAY IS `AccountsScreen`'s `Bar`, WORD FOR WORD: "reset" (an
 *  inferred zero) ≠ a measured "0%" ≠ "—" (nobody measured it). That screen
 *  already owns the vocabulary for exactly this state and this is the same fact
 *  on a second surface, so it says the same word rather than inventing a second
 *  visual language for it. The track is left EMPTY for a rolled-over window,
 *  which is what `Bar` renders too — its fill is `width: 0%` there, because the
 *  0 it would draw is the inferred one. A confident bar and the word "reset"
 *  would contradict each other in the same row. */
function Gauge({ label, value, rolledOver, off = false }: {
  label: string; value: number | null; rolledOver: boolean; off?: boolean;
}): ReactNode {
  const pct = rolledOver || value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <span className="acct-gauge">
      <span>{label}</span>
      <span className={LIMIT_TRACK}>
        {pct !== null && (
          <span
            className={fillVariants({ band: off ? 'off' : limitBand(pct) })}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className="acct-gauge-pct">
        {rolledOver ? 'reset' : pct === null ? '—' : `${Math.round(pct)}%`}
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
 *  the same reason `Gauge` borrows "reset" from `Bar`. The row stays TAPPABLE:
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
  return (
    <ListRow
      className="acct-row"
      data-disabled={off ? 'true' : 'false'}
      onClick={() => onPick(wrapper)}
    >
      <Chip dot style={chipStyle}>
        {accountLabel(roster, wrapper)}
      </Chip>
      {suggested && <span className="acct-suggested">suggested</span>}
      <PoolTag pool={poolChip} />
      <span className="acct-gauges">
        {/* Above the gauges, not instead of them: the numbers are still true of
            the last moment anything ran there, and this is the sentence that
            says why they stopped moving. The gauges take LimitBar's `off` band
            for the reason AccountsScreen greys its own — a frozen crit-red bar
            reads as live pressure on a lane nothing is running on. It was a
            `[data-disabled]` rule in fleet.css reaching into `.limit-fill`;
            the component owns its own appearance now. */}
        {off && <span className="acct-condemned">sign-in expired on the fleet host</span>}
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
