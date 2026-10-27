// Accounts strip: the lanes row. Every lane is a card (its name, then a row for each window it has: the window, a
// meter, the percentage and the countdown to its reset), read straight from telemetry (/api/accounts, backed by
// ~/.cc-limits) so it survives restarts, respawns and swaps whichever sessions are running, and drawn most free first
// (`lanesByFree`).
//
// WHERE IT MOUNTS. One component at every width. At the desk both bars mount it under their line, inside the frame's
// header; on a phone it sits in Refined's phone header and in Instrument's phone fleet column.
//
// WHAT IT OPENS. Each card is a link to its own lane, /accounts?lane=<id> (`accountsLaneHref` builds it): a per-row
// `actionDoor('open-lane', …)` that navigates by itself, and Enter activates it as it does an anchor. The cards are
// ONE tab stop, a roving `tabIndex` (the card last focused, the first at mount), and the arrow keys, Home and End move
// across them without wrapping (`rovingStep`). After the last card the end cell holds All accounts, the `go-accounts`
// command door, the next tab stop; so a phone, where a card is a small target, still has the whole screen one tap
// away. The row itself is a group, not a door.
//
// THE PLACEHOLDER DOOR (D-161). With no lane to show the strip is exactly one `go-accounts` door and never renders
// nothing. As a full-width readout of meters the strip read as DATA rather than navigation, so an operator hunting for
// the passkey enrolment button on the screen behind it never found it. FleetScreen's header now carries a named
// control ("Your sign-in and accounts"), and PasskeyNotice is a third route in the one posture that most needs it, but
// the state the strip used to bail out on entirely (every lane markered `-disabled`, or no poll landed or succeeded
// yet) is exactly the state the Accounts screen exists to explain (its bespoke "<home-able accounts>, all disabled"
// copy, see homeAbleLabelList in lib/accounts.ts). So the link stays mounted, with a quiet placeholder body, instead
// of disappearing with the cards.
import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { Button, useNow } from '@ccrc/ui';
import { actionDoor, commandDoor } from '../command/door';
import { rovingStep } from '../lib/rovingStep';
import { accountsLaneHref } from '../lib/routes';
import { navigate } from '../lib/router';
import { lanesByFree } from './laneOrder';
import { ACCOUNTS_DOOR_LABEL, ALL_ACCOUNTS, laneDoorLabel, lanesRowLabel, NO_READING } from './laneWords';
import { AccountMeterRow } from './AccountMeterRow';
import './fleet.css';

/** `store` defaults to the app-wide fleet store (`RunsScreen`'s idiom). The strip reads the store's `usage` and
 *  `roster`, which its one `/api/accounts` poll writes (C8, D-6440); the strip runs no poll of its own, so its four
 *  mounts (one per width) cost no request. `usage` is `null` until a good answer lands, and a malformed or failed
 *  read keeps the last good rows, so the cards never fall back to the placeholder once they have drawn. */
export function AccountsStrip({ store = useFleetStore }: { store?: FleetStore } = {}): ReactNode {
  const accounts = store((s) => s.usage);
  const roster = store((s) => s.roster);
  const now = useNow(30_000); // tick the reset countdown
  // The roving tab stop is tracked by lane id, not by index: a re-sort moves the cards, and the stop stays on the lane
  // it was on. `null` (nothing focused yet) and an id no longer in the list both read as the first card.
  const [stopId, setStopId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  // `disabled` is optional on the wire in the sense that an older server omits
  // it — `a.disabled === true` treats that as enabled, so the PWA never needs
  // a server upgrade to render.
  const live = lanesByFree((accounts ?? []).filter((a) => a.disabled !== true));
  const nowSec = Math.floor(now / 1000);

  // Three flavours of "nothing to gauge", each still worth naming rather than
  // collapsing into one silence: no good answer has landed in the store yet
  // (or every read so far has failed or was malformed — the store writes
  // nothing then, so this is indistinguishable from "hasn't landed" and stays
  // named as one thing), a read landed with zero accounts (fresh host, no
  // `.cc-limits/*.json` yet), or every account that DID report is markered
  // `-disabled`. The strip's own filter for which GAUGES render stays exactly
  // as it was ("the strip's filter stays as is", Rider A) — only the element
  // itself no longer vanishes with them.
  // `accounts` is the store's `usage`: `null` until a good answer lands, an
  // array after it, and never `undefined` (the store keeps the last good rows
  // across a malformed answer, C8, D-6440).
  let placeholder: string | null = null;
  if (!accounts) placeholder = 'checking accounts…';
  else if (accounts.length === 0) placeholder = 'no accounts reporting';
  else if (live.length === 0) placeholder = 'all lanes disabled';

  // With no lane to show the strip is the `go-accounts` door itself: it asks the command layer, which navigates, as the
  // palette's "Go to Accounts" does.
  if (placeholder !== null) {
    const door = commandDoor('go-accounts');
    // role="link" (not "button"): this mirrors an <a> to /accounts, so it takes the anchor's own keyboard contract:
    // Enter activates, Space does not (Space belongs to role="button"). tabIndex=0 is what makes a <div> reach the
    // tab order at all; the tap-target floor is `.accounts-strip[role="link"]`'s own rule in fleet.css.
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      door.onClick();
    };
    return (
      <div className="accounts-strip" role="link" tabIndex={0} aria-label={ACCOUNTS_DOOR_LABEL} {...door} onKeyDown={onKeyDown}>
        <span className="accounts-strip-empty">{placeholder}</span>
      </div>
    );
  }

  const stop = live.some((a) => a.wrapper === stopId) ? stopId : live[0]!.wrapper;
  // Enter opens the lane (a link, so Space does not); the arrow keys, Home and End step across the cards, none
  // wrapping, and moving focus moves the stop (`onFocus` records it). `live` is never empty here, so `rovingStep` has
  // at least one card to land on.
  const onCardKey = (e: KeyboardEvent<HTMLElement>, i: number, open: () => void): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      open();
      return;
    }
    const to = rovingStep(e.key, i, live.length, { wrap: false });
    if (to === null) return;
    e.preventDefault();
    cardRefs.current.get(live[to]!.wrapper)?.focus();
  };

  return (
    <div className="accounts-strip" role="group" aria-label={lanesRowLabel(live, roster)}>
      {live.map((a, i) => {
        // `off` as the Accounts screen computes it (D-5494). The filter above
        // already dropped a switched-off lane, so here it is a sign-in-expired
        // one: its numbers are frozen, so its fills grey while each meter keeps
        // its band. `=== true`: a server built before `authDead` omits it.
        const off = a.disabled === true || a.authDead === true;
        const door = actionDoor('open-lane', () => navigate(accountsLaneHref(a.wrapper)));
        const name = accountLabel(roster, a.wrapper);
        return (
          <div
            key={a.wrapper}
            className="account-gauge"
            role="link"
            tabIndex={a.wrapper === stop ? 0 : -1}
            aria-label={laneDoorLabel(a, roster, nowSec)}
            ref={(el) => { if (el === null) cardRefs.current.delete(a.wrapper); else cardRefs.current.set(a.wrapper, el); }}
            onFocus={() => setStopId(a.wrapper)}
            onKeyDown={(e) => onCardKey(e, i, door.onClick)}
            {...door}
          >
            <span className="account-gauge-label" title={name} style={{ color: `var(${accountColorVar(roster, a.wrapper)})` }}>
              {name}
            </span>
            {/* Wrapped so the label can sit inline beside the windows on desktop
                (a flex row); on mobile this stays a plain block under the label.
                Only render a window that exists (gpt, Codex Pro, is weekly-only); a lane with neither says
                NO_READING and draws no row, so no meter claims a zero nobody measured. */}
            <div className="acct-rows">
              {a.five === null && a.seven === null && <span className="acct-unread">{NO_READING}</span>}
              {a.five !== null && <AccountMeterRow label="5h" pct={a.five} resetAt={a.fiveResetAt} nowSec={nowSec} rolledOver={a.fiveRolledOver} off={off} />}
              {a.seven !== null && <AccountMeterRow label="7d" pct={a.seven} resetAt={a.sevenResetAt} nowSec={nowSec} rolledOver={a.sevenRolledOver} off={off} />}
            </div>
          </div>
        );
      })}
      <div className="accounts-end">
        <Button variant="ghost" size="fit" {...commandDoor('go-accounts')}>{ALL_ACCOUNTS}</Button>
      </div>
    </div>
  );
}
