// Accounts strip — per-account usage shown ONCE, read straight from telemetry
// (/api/accounts, backed by ~/.cc-limits) so it survives restarts, respawns and
// swaps regardless of which sessions are running. Each account shows its 5h and
// 7d windows with %, a meter, and the countdown to reset. Also the nav
// affordance onto the full accounts screen (Task 6, Build 3 PR G) — the same
// component mounts twice (desktop top bar, mobile fleet list) and tapping
// either one goes to /accounts.
import { useEffect, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { AccountUsage } from '../../../shared/api';
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
  const now = useNow(30_000); // tick the reset countdown

  useEffect(() => {
    let live = true;
    const load = (): void => {
      void api.accounts().then((r) => { if (live) setAccounts(r.accounts); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  if (!accounts || accounts.length === 0) return null;
  // `disabled` is optional on the wire in the sense that an older server omits
  // it — `a.disabled === true` treats that as enabled, so the PWA never needs
  // a server upgrade to render.
  const live = accounts.filter((a) => a.disabled !== true);
  if (live.length === 0) return null;
  const nowSec = Math.floor(now / 1000);

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
      {live.map((a) => (
        <div key={a.wrapper} className="account-gauge">
          <span className="account-gauge-label" style={{ color: `var(${accountColorVar(a.wrapper)})` }}>
            {accountLabel(a.wrapper)}
          </span>
          {/* Wrapped so the label can sit inline beside the windows on desktop
              (a flex row); on mobile this stays a plain block under the label.
              Only render a window that exists — gpt (Codex Pro) is weekly-only. */}
          <div className="acct-rows">
            {a.five !== null && <LimitRow label="5h" pct={a.five} resetAt={a.fiveResetAt} nowSec={nowSec} rolledOver={a.fiveRolledOver} />}
            {a.seven !== null && <LimitRow label="7d" pct={a.seven} resetAt={a.sevenResetAt} nowSec={nowSec} rolledOver={a.sevenRolledOver} />}
          </div>
        </div>
      ))}
    </div>
  );
}
