// Accounts strip — per-account usage shown ONCE, read straight from telemetry
// (/api/accounts, backed by ~/.cc-limits) so it survives restarts, respawns and
// swaps regardless of which sessions are running. Each account shows its 5h and
// 7d windows with %, a meter, and the countdown to reset.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AccountUsage } from '../../../shared/api';
import { accountLabel, accountColorVar } from '../lib/accounts';
import { api } from '../lib/api';
import { useNow } from '../lib/useNow';
import { formatReset } from './formatReset';
import './fleet.css';

function band(pct: number | null): string {
  if (pct === null) return 'none';
  if (pct >= 75) return 'crit';
  if (pct >= 50) return 'warn';
  return 'ok';
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
  const nowSec = Math.floor(now / 1000);

  return (
    <div className="accounts-strip" role="group" aria-label="Account usage">
      {accounts.map((a) => (
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
