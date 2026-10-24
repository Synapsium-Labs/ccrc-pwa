// The compact gauges both skins' shells place (W2 Task S2c; D-5471, D-5472): one `Meter` per lane with its name in
// mono and its binding percentage, the group one door to /accounts. `AccountsStrip` owns the poll and hands its lanes
// here; this file owns only how the lanes are laid into a box of whatever width the shell gives it.
//
// FIT IS MEASURED, NOT COUNTED. In `bar` and `led` the lanes sit in one row that wraps, and the row is one line tall
// and clips: a gauge that does not fit whole wraps out of sight instead of shrinking under its floor or painting over
// its neighbour. Each gauge has a floor (a 6ch name, the meter, a 5ch reading), so a name truncates before a gauge
// wraps. After layout the door counts the gauges that wrapped (`hiddenGauges`) and says them in the "+n", with the
// lanes past `COMPACT_FIT`'s cap. The first gauge opens the line and cannot wrap, so in a row narrower than its floor
// it is cut at the row's edge instead: a gauge whose right edge passes the row's is hidden and counted too (W2 Task
// S4b), and when every placed gauge is hidden the "+n" stands alone at the start. Hiding is `visibility`, which moves
// nothing, so the measure it follows from cannot change under it. `grid` (two columns, one row per two lanes) places
// every lane and measures nothing.
import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { AccountUsage, RosterWire } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { commandDoor } from '../command/door';
import { bindingPct } from './laneOrder';
import { limitBand, Meter } from '@ccrc/ui';
import './fleet.css';

/** `bar` is Refined's app-bar row, `led` Instrument's top-bar meters (the LED segments are the skin's
 *  `--meter-segments` token, not this arrangement's), `grid` Refined's phone 2×2. */
export type CompactArrangement = 'bar' | 'grid' | 'led';

/** The most lanes an arrangement places; the box's width may place fewer (above). `grid` wraps, so it places every
 *  lane. */
export const COMPACT_FIT: Readonly<Record<CompactArrangement, number>> = { bar: 4, led: 6, grid: Number.POSITIVE_INFINITY };

/** The reading beside a lane's meter, kept three ways like the full strip's `AccountMeterRow`: "reset" when the
 *  window that binds rolled over (the server zeroed it; the zero is inferred, not measured), "—" never measured, else
 *  the measured percentage. */
export function compactReading(a: Pick<AccountUsage, 'five' | 'seven' | 'fiveRolledOver' | 'sevenRolledOver'>): string {
  const pct = bindingPct(a);
  if (pct === null) return '—';
  const binding = [
    { pct: a.five, rolled: a.fiveRolledOver === true },
    { pct: a.seven, rolled: a.sevenRolledOver === true },
  ].filter((w) => w.pct === pct);
  return binding.every((w) => w.rolled) ? 'reset' : `${pct}%`;
}

/** Which gauges the one-line row does not show whole, from their boxes in order: every one below the first's line
 *  (it wrapped), and every one whose right edge passes the row's (it is cut; only the first can be, as it cannot wrap). */
export function hiddenGauges(boxes: readonly { top: number; right: number }[], rowRight: number): boolean[] {
  if (boxes.length === 0) return [];
  const line = boxes[0]!.top;
  return boxes.map((b) => b.top > line + 1 || b.right > rowRight + 1);
}

/** The door's bare name, the full strip's too: what it is and where it goes. */
export const ACCOUNTS_DOOR_LABEL = 'account usage — open accounts';

/** The door's accessible name: what it is, the fullest lane's reading, and where it goes. */
export function compactDoorLabel(lanes: readonly AccountUsage[], roster: readonly RosterWire[]): string {
  let top: AccountUsage | null = null;
  for (const a of lanes) if ((bindingPct(a) ?? -1) > (top === null ? -1 : bindingPct(top) ?? -1)) top = a;
  return top === null
    ? ACCOUNTS_DOOR_LABEL
    : `account usage, highest ${accountLabel(roster, top.wrapper)} ${compactReading(top)} — open accounts`;
}

export function CompactGauges({ compact, lanes, roster, placeholder }: {
  compact: CompactArrangement;
  /** The lanes to gauge, already filtered (no disabled lane). */
  lanes: readonly AccountUsage[];
  roster: readonly RosterWire[];
  /** The strip's placeholder body, when there is nothing to gauge; the door never renders nothing. */
  placeholder: string | null;
}): ReactNode {
  const placed = lanes.slice(0, COMPACT_FIT[compact]);
  const capped = lanes.length - placed.length;
  const row = useRef<HTMLSpanElement>(null);
  const [hidden, setHidden] = useState<readonly boolean[]>([]);
  const measures = compact !== 'grid' && placeholder === null;
  const laneKey = placed.map((a) => a.wrapper).join(' ');

  useLayoutEffect(() => {
    const el = row.current;
    if (!measures || el === null) { setHidden([]); return undefined; }
    const count = (): void => {
      const boxes = [...el.querySelectorAll<HTMLElement>('.accounts-compact-gauge')].map((g) => g.getBoundingClientRect());
      const next = hiddenGauges(boxes, el.getBoundingClientRect().right);
      setHidden((prev) => (prev.length === next.length && prev.every((h, i) => h === next[i]) ? prev : next));
    };
    count();
    // The "+n" appearing narrows the row, which may wrap one more gauge; the observer counts again, and it settles
    // because a wider "+n" only ever wraps more.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(count);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measures, laneKey]);

  const wrapped = hidden.filter(Boolean).length;
  const more = capped + wrapped;
  const allHidden = placed.length > 0 && wrapped === placed.length;
  // The group is the `go-accounts` door (W2 Task S4b; the plan's door table): the command layer navigates, as the
  // palette's "Go to Accounts" does. role="link" mirrors an <a> to /accounts: Enter activates, Space does not.
  const door = commandDoor('go-accounts');
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    door.onClick();
  };
  return (
    <div
      className="accounts-compact"
      data-compact={compact}
      data-lanes-hidden={allHidden ? '' : undefined}
      role="link"
      tabIndex={0}
      aria-label={placeholder === null ? compactDoorLabel(placed, roster) : ACCOUNTS_DOOR_LABEL}
      {...door}
      onKeyDown={onKeyDown}
    >
      {placeholder !== null ? (
        <span className="accounts-strip-empty">{placeholder}</span>
      ) : (
        <>
          <span className="accounts-compact-lanes" ref={row}>
            {placed.map((a, i) => {
              const pct = bindingPct(a);
              return (
                <span key={a.wrapper} className="accounts-compact-gauge font-mono" data-clipped={hidden[i] === true ? '' : undefined}>
                  <span className="accounts-compact-name min-w-0 truncate" style={{ color: `var(${accountColorVar(roster, a.wrapper)})` }}>
                    {accountLabel(roster, a.wrapper)}
                  </span>
                  <Meter pct={pct} band={pct === null ? 'none' : limitBand(pct)} off={a.authDead === true} className="w-10 flex-none" />
                  <span className="accounts-compact-pct">{compactReading(a)}</span>
                </span>
              );
            })}
          </span>
          {more > 0 && <span className="accounts-compact-more font-mono">{`+${more}`}</span>}
        </>
      )}
    </div>
  );
}
