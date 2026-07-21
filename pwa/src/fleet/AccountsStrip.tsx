// Accounts strip — account limits shown ONCE per account (they're account-scoped,
// so repeating them on every session card is noise). Derived from the fleet:
// one gauge per distinct account present, in canonical order.
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { accountLabel, accountColorVar, KNOWN_WRAPPERS } from '../lib/accounts';
import { LimitBar } from '../components/LimitBar';
import './fleet.css';

export function AccountsStrip({ sessions }: { sessions: FleetSession[] }): ReactNode {
  const byWrapper = new Map<string, FleetSession['limits']>();
  for (const s of sessions) {
    if (!byWrapper.has(s.wrapper) || (byWrapper.get(s.wrapper) === null && s.limits !== null)) {
      byWrapper.set(s.wrapper, s.limits);
    }
  }
  if (byWrapper.size === 0) return null;

  const order = (w: string): number => {
    const i = KNOWN_WRAPPERS.indexOf(w);
    return i < 0 ? KNOWN_WRAPPERS.length : i;
  };
  const accounts = [...byWrapper.entries()].sort((a, b) => order(a[0]) - order(b[0]));

  return (
    <div className="accounts-strip" role="group" aria-label="Account usage">
      {accounts.map(([wrapper, limits]) => (
        <div key={wrapper} className="account-gauge">
          <span className="account-gauge-label" style={{ color: `var(${accountColorVar(wrapper)})` }}>
            {accountLabel(wrapper)}
          </span>
          {limits ? (
            <LimitBar five={limits.five} seven={limits.seven} />
          ) : (
            <span className="account-gauge-nodata">no usage data</span>
          )}
        </div>
      ))}
    </div>
  );
}
