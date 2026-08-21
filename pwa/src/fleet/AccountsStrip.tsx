// Accounts strip — per-account usage shown ONCE, read straight from telemetry
// (/api/accounts, backed by ~/.cc-limits) so it survives restarts, respawns and
// swaps regardless of which sessions are running. Each account shows its 5h and
// 7d windows with %, a meter, and the countdown to reset. Also the nav
// affordance onto the full accounts screen (Task 6, Build 3 PR G) — the same
// component mounts twice (desktop top bar, mobile fleet list) and tapping
// either one goes to /accounts.
//
// NO LONGER THE ONLY DOOR to /accounts, and it should never have been the only
// one (D-161): as a full-width readout of 5h/7d meters it reads as DATA rather
// than navigation, so an operator hunting for the passkey enrolment button on
// the screen behind it never found it. FleetScreen's header now carries a named
// control ("Your sign-in and accounts"), and PasskeyNotice is a third route in
// the one posture that most needs it. This stays a door — it is where a gauge
// is being looked at anyway — and it still must never render nothing: the state
// it used to bail out on entirely — every lane markered `-disabled`, or no poll
// landed/succeeded yet — is exactly the state the accounts screen exists to
// explain (its bespoke "<home-able accounts>, all disabled" copy — see
// homeAbleLabelList in lib/accounts.ts). The link stays mounted with a quiet
// placeholder body instead of disappearing with the gauges.
import { useEffect, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { AccountUsage, RosterWire } from '../../../shared/api';
import { limitBand } from '../components/LimitBar';
import { accountLabel, accountColorVar } from '../lib/accounts';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { useNow } from '../lib/useNow';
import { formatReset } from './formatReset';
import './fleet.css';

// One writer for the band thresholds — DIRECTION.md's `crit` is `> 75`, not
// `>= 75` (LimitBar.tsx's `limitBand`, test-pinned). This used to carry its
// own `>= 75` copy, so the same account rendered `crit` here and `warn` on
// the limits bar at exactly 75. `null` ("no telemetry") has no equivalent in
// limitBand, which is why it stays a local wrapper rather than a re-export.
function band(pct: number | null): string {
  return pct === null ? 'none' : limitBand(pct);
}

function LimitRow({ label, pct, resetAt, nowSec, rolledOver }: {
  label: string; pct: number | null; resetAt: number | null; nowSec: number; rolledOver: boolean;
}): ReactNode {
  return (
    <div className="acct-row">
      <span className="acct-win">{label}</span>
      <span className="acct-meter" data-band={band(pct)}>
        <span className="acct-fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </span>
      {/* "reset" rather than "0%": the window ended and nothing has measured the
          new one yet, so the zero is inferred from the reset timestamp. A
          measured zero — something ran and the account really is empty — still
          reads 0%, and the two must not look the same. */}
      <span className="acct-pct">{rolledOver ? 'reset' : pct === null ? '—' : `${pct}%`}</span>
      <span className="acct-reset" title="time until this window resets">↻ {formatReset(resetAt, nowSec)}</span>
    </div>
  );
}

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
          console.warn('ccrc: GET /api/accounts answered with a non-array roster; keeping the last known one.', r);
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
  const live = (accounts ?? []).filter((a) => a.disabled !== true);
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

  const openAccounts = (): void => navigate('/accounts');
  // role="link" (not "button"): this mirrors an <a> to /accounts, so it takes
  // the anchor's own keyboard contract — Enter activates, Space does not
  // (Space belongs to role="button"). tabIndex=0 is what makes a <div> reach
  // the tab order at all; the tap-target floor is `.accounts-strip`'s own
  // rule in fleet.css.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    openAccounts();
  };

  return (
    <div
      className="accounts-strip"
      role="link"
      tabIndex={0}
      aria-label="account usage — open accounts"
      onClick={openAccounts}
      onKeyDown={onKeyDown}
    >
      {placeholder !== null ? (
        <span className="accounts-strip-empty">{placeholder}</span>
      ) : (
        live.map((a) => (
          <div key={a.wrapper} className="account-gauge">
            <span className="account-gauge-label" style={{ color: `var(${accountColorVar(roster, a.wrapper)})` }}>
              {accountLabel(roster, a.wrapper)}
            </span>
            {/* Wrapped so the label can sit inline beside the windows on desktop
                (a flex row); on mobile this stays a plain block under the label.
                Only render a window that exists — gpt (Codex Pro) is weekly-only. */}
            <div className="acct-rows">
              {a.five !== null && <LimitRow label="5h" pct={a.five} resetAt={a.fiveResetAt} nowSec={nowSec} rolledOver={a.fiveRolledOver} />}
              {a.seven !== null && <LimitRow label="7d" pct={a.seven} resetAt={a.sevenResetAt} nowSec={nowSec} rolledOver={a.sevenRolledOver} />}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
