// Accounts strip: the lanes row. Every lane is a card (its name, then a row for each window it has: the window, a
// meter, the percentage and the countdown to its reset), read straight from telemetry (/api/accounts, backed by
// ~/.cc-limits) so it survives restarts, respawns and swaps whichever sessions are running, and drawn most free first
// (`lanesByFree`).
//
// THE FOLD (desktop polish S5b, D-6530). The strip folds at every width, and `foldLanes` (stripFold.ts) decides it all:
// a phone shows its four freest lanes, and the desk one line of the freest lanes that fit beside the end cell (the
// width is `useRowWidth`'s measure, the count `rowFit`'s and `foldShown`'s). The lanes left out are not mounted at all,
// never hidden by CSS. A folded strip never hides fewer than two lanes, so a short one shows every lane and no
// control. When it folds, the end cell holds one control before All accounts, worded by `foldWords` alone ("+13 more"
// and a count of the hidden lanes that need the operator, or "Show fewer"). The choice is kept on the device
// (`useStripExpanded`). This component only renders what the fold answers and reads no lane count of its own.
//
// WHERE IT MOUNTS. One component at every width. At the desk both bars mount it under their line, inside the frame's
// header; on a phone it sits in Refined's phone header and in Instrument's phone fleet column.
//
// WHAT IT OPENS. Each card is a link to its own lane, /accounts?lane=<id> (`accountsLaneHref` builds it): a per-row
// `actionDoor('open-lane', …)` that navigates by itself, and Enter activates it as it does an anchor. The cards are
// ONE tab stop, a roving `tabIndex` (the card last focused, the first at mount), and the arrow keys, Home and End move
// across the SHOWN cards without wrapping (`rovingStep`); a stop on a lane that folded away falls to the first shown
// card. After the last card the end cell holds the fold's control, if any, then All accounts, the `go-accounts`
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
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { AccountUsage, RosterWire } from '../../../shared/api';
import { accountColorVar, accountLabel, warnNonArrayRoster } from '../lib/accounts';
import { api } from '../lib/api';
import { Button, useNow } from '@ccrc/ui';
import { actionDoor, commandDoor } from '../command/door';
import { useDesk } from '../lib/useMediaQuery';
import { rovingStep } from '../lib/rovingStep';
import { accountsLaneHref } from '../lib/routes';
import { navigate } from '../lib/router';
import { lanesByFree } from './laneOrder';
import { foldLanes, foldShown, foldWords, LANE_CARD_MIN, rowFit } from './stripFold';
import { setStripExpanded, useStripExpanded } from './stripExpanded';
import { useRowWidth } from './useRowWidth';
import { ACCOUNTS_DOOR_LABEL, ALL_ACCOUNTS, laneDoorLabel, lanesRowLabel, NO_READING } from './laneWords';
import { AccountMeterRow } from './AccountMeterRow';
import './fleet.css';

export function AccountsStrip(): ReactNode {
  const [accounts, setAccounts] = useState<AccountUsage[] | null>(null);
  // Same poll, same response — `roster` is read alongside `accounts` rather
  // than through the fleet store, since this component already runs its own
  // `/api/accounts` cadence (its own file comment on why: coupling to a
  // shared store beats nothing, but a second GET against two small local
  // JSON files beats coupling this component to whichever store instance a
  // caller happens to be using). Defaults to `[]`, the same "unarrived
  // roster" state `accountLabel`/`accountColorVar` already degrade for.
  const [roster, setRoster] = useState<readonly RosterWire[]>([]);
  const now = useNow(30_000); // tick the reset countdown
  // The roving tab stop is tracked by lane id, not by index: a re-sort moves the cards, and the stop stays on the lane
  // it was on. `null` (nothing focused yet) and an id no longer in the list both read as the first card.
  const [stopId, setStopId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  // The fold: the stored choice, the width class, and (at the desk only) the cards' group measured. The group's id is
  // what the control's `aria-controls` names.
  const expanded = useStripExpanded();
  const desk = useDesk();
  const { ref: groupRef, row } = useRowWidth(desk);
  const groupId = useId();
  const controlRef = useRef<HTMLButtonElement>(null);
  // Set by a user's "Show fewer" click and read once the strip has folded: the control scrolls itself into view then,
  // never on mount and never when another tab's choice arrives.
  const scrollAfterFold = useRef(false);
  useEffect(() => {
    if (expanded || !scrollAfterFold.current) return;
    scrollAfterFold.current = false;
    controlRef.current?.scrollIntoView({ block: 'nearest' });
  }, [expanded]);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      void api.accounts().then((r) => {
        if (!live) return;
        setAccounts(r.accounts);
        // `Array.isArray`, not a bare trust: a fetch stub answering an
        // unmatched route with bare `{}` (several fixtures across this suite
        // predate Task 7 and do exactly that) hands back `r.roster ===
        // undefined`, and every `accountLabel`/`accountColorVar` call below
        // does `roster.find(...)` unguarded — same reasoning as
        // `stores/fleet.ts`'s own roster poll. Preserves the last good
        // roster rather than clobbering it with `[]` on a malformed
        // response (fix round 1, finding 5), and warns once so a genuine
        // protocol break has some signal (finding 6) instead of silently
        // reverting every label to a raw wrapper id.
        if (Array.isArray(r.roster)) {
          setRoster(r.roster);
        } else {
          warnNonArrayRoster(r);
        }
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  // `disabled` is optional on the wire in the sense that an older server omits
  // it — `a.disabled === true` treats that as enabled, so the PWA never needs
  // a server upgrade to render.
  const live = lanesByFree((accounts ?? []).filter((a) => a.disabled !== true));
  const nowSec = Math.floor(now / 1000);

  // Three flavours of "nothing to gauge", each still worth naming rather than
  // collapsing into one silence: no poll has landed/succeeded yet (or every
  // poll so far has failed — `.catch` never sets state either, so this is
  // indistinguishable from "hasn't landed" and stays named as one thing), a
  // poll landed with zero accounts (fresh host, no `.cc-limits/*.json` yet),
  // or every account that DID report is markered `-disabled`. The strip's own
  // filter for which GAUGES render stays exactly as it was ("the strip's
  // filter stays as is", Rider A) — only the element itself no longer
  // vanishes with them.
  // `!accounts`, not `accounts === null`: the original bail-out this
  // replaces was falsy-checked, and a malformed/short JSON body (a stub in
  // one test returns bare `{}` for every unmatched route, `.accounts`
  // reading `undefined`) is a real shape `.then` can hand `setAccounts`
  // despite the declared `AccountUsage[] | null` — the strict check crashed
  // on exactly that instead of degrading to the same placeholder `null` did.
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

  // An unmeasured desk row answers a null count, which folds nothing (`foldLanes`).
  const count = foldShown(desk, desk ? rowFit(row?.width ?? null, LANE_CARD_MIN, row?.gap ?? 0) : null);
  const fold = foldLanes(live, expanded, count);
  const { shown } = fold;
  const words = foldWords(fold, now);
  const toggle = (): void => {
    // "Show fewer" is the click that folds: remember to scroll once the cards are gone.
    scrollAfterFold.current = fold.expanded;
    setStripExpanded(!fold.expanded);
  };

  const stop = shown.some((a) => a.wrapper === stopId) ? stopId : shown[0]!.wrapper;
  // Enter opens the lane (a link, so Space does not); the arrow keys, Home and End step across the shown cards, none
  // wrapping, and moving focus moves the stop (`onFocus` records it). `shown` is never empty here, so `rovingStep` has
  // at least one card to land on.
  const onCardKey = (e: KeyboardEvent<HTMLElement>, i: number, open: () => void): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      open();
      return;
    }
    const to = rovingStep(e.key, i, shown.length, { wrap: false });
    if (to === null) return;
    e.preventDefault();
    cardRefs.current.get(shown[to]!.wrapper)?.focus();
  };

  return (
    <div
      className="accounts-strip"
      role="group"
      id={groupId}
      ref={groupRef}
      aria-label={lanesRowLabel(live, roster)}
      style={{ '--lane-card-min': `${LANE_CARD_MIN}px` } as CSSProperties}
    >
      {shown.map((a, i) => {
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
        {/* Rendered iff the fold folds, the same element folded and expanded (never keyed on state), so focus stays on it
            across a toggle. Its words are its name; it is no door (no data-command, no data-action). */}
        {fold.foldable && (
          <Button ref={controlRef} variant="quiet" size="fit" aria-expanded={fold.expanded} aria-controls={groupId} onClick={toggle}>
            {words}
          </Button>
        )}
        <Button variant="ghost" size="fit" {...commandDoor('go-accounts')}>{ALL_ACCOUNTS}</Button>
      </div>
    </div>
  );
}
