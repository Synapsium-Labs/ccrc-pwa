// Tag an account into a pool, or clear it — the account-side twin of
// PoolSheet.
//
/** Unlike `PoolSheet` (the PROJECT side), this sheet accepts a pool name no
 *  account yet carries. That asymmetry is principled, not accidental: a pool
 *  exists iff some account is in it, so THE ACCOUNT SIDE IS WHERE A POOL IS
 *  CREATED. A free-text name on the project side would strand the project
 *  against a pool with no members; here it is the only way to make one. */
//
// The other deliberate difference from `PoolSheet`: this component does not
// call the API itself. `PoolSheet` owns its own fetch, a per-request
// generation counter and a subscription to the fleet store's `pools` frame,
// because a project's tag can also change out from under an open sheet via
// that live frame. There is no equivalent live frame for account pools in
// this wave — `AccountsScreen` re-measures with its own 20s
// `GET /api/accounts` poll, the same poll every other fact on that screen
// already rides — so the write and its toast/remeasure side effects live
// with the caller (`onSet`), and this component stays a plain, easily-tested
// renderer over whatever `roster`/`current` it is handed. POOL_NAME_RE is
// checked here purely as a courtesy before a request is ever built; the
// server is still the gate (`POST /api/pools/accounts/:id`, Task 7).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RosterWire } from '../../../shared/api';
import type { AccountPoolWire } from '../../../shared/poolrule';
import { POOL_NAME_RE } from '../../../shared/roster';
import { Sheet } from '../components/Sheet';
import { poolOptions } from '../lib/pools';
import './fleet.css';

export interface AccountPoolSheetProps {
  /** `null` while no account row has been selected. */
  account: string | null;
  /** For deriving the roster-declared option buttons (`poolOptions`). */
  roster: readonly RosterWire[];
  /** This account's already-measured pool state — the caller's own
   *  `accountPoolState` read, so the sheet renders what was already
   *  computed rather than a second, possibly differently-timed one. */
  current?: AccountPoolWire;
  open: boolean;
  onClose: () => void;
  /** The pools to WRITE for this account — `[]` clears. The caller performs
   *  the actual `api.setAccountPools` call (and its toast/remeasure), on
   *  the same terms `PoolSheet`'s `onPoolChanged` documents for the project
   *  side, just one level earlier: here the callback IS the write intent,
   *  not a notification after one already happened. */
  onSet: (accountId: string, pools: string[]) => void;
}

const currentCopy = (account: string, current: AccountPoolWire | undefined): string => {
  if (current === undefined) return `This app has not measured ${account}'s pool yet.`;
  if (current.state === 'tagged') {
    const carrier = current.origin === 'central' ? '' : ' (the roster default — no central tag is set)';
    return `${account} is in pool ${current.pools[0]}${carrier}.`;
  }
  if (current.state === 'untagged') return `${account} is in no pool — it may serve any project.`;
  return `This app is older than the fleet; reload to understand ${account}'s pool.`;
};

export function AccountPoolSheet({
  account, roster, current, open, onClose, onSet,
}: AccountPoolSheetProps): ReactNode {
  const [name, setName] = useState('');

  // A reopened or re-targeted sheet starts the free-text field empty rather
  // than carrying over whatever a previous account or a previous open left
  // typed — the same "scope reset" instinct `PoolSheet` gives its own
  // measured-pool state, simplified: there is no in-flight request state to
  // invalidate here because there is no in-flight request here at all.
  useEffect(() => {
    setName('');
  }, [account, open]);

  if (account === null) return null;

  const options = poolOptions(roster);
  const trimmed = name.trim();
  const validNew = POOL_NAME_RE.test(trimmed);

  const create = (): void => {
    if (!validNew) return;
    onSet(account, [trimmed]);
    setName('');
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="account pool" title="Which pool is this account in?">
      <p className="sheet-copy">
        {currentCopy(account, current)}{' '}
        An account may serve a project when either side is untagged or the names agree.
      </p>
      <div className="pool-list">
        {options.map((poolName) => (
          <button
            key={poolName}
            type="button"
            className="pool-row"
            aria-label={`pool ${poolName}`}
            onClick={() => onSet(account, [poolName])}
          >
            {poolName}
          </button>
        ))}
        <button
          type="button"
          className="pool-row"
          data-none="true"
          aria-label="no pool — this account may serve any project"
          onClick={() => onSet(account, [])}
        >
          no pool
        </button>
      </div>
      <div className="pool-new-row">
        <label className="pool-new-label" htmlFor="account-pool-new-name">New pool name</label>
        <input
          id="account-pool-new-name"
          className="pool-new-input"
          type="text"
          value={name}
          placeholder="pool-name"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="btn-primary pool-new-create" disabled={!validNew} onClick={create}>
          Create
        </button>
      </div>
    </Sheet>
  );
}
