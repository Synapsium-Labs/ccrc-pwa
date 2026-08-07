// Accounts screen (route `/accounts`, Task 6 of Build 3 PR G) — every account
// ccd knows about, not just the ones with headroom to spare. The compact
// strip (AccountsStrip) hides a switched-off lane and only shows a window
// that "exists" for the account type; this screen's brief is the opposite —
// "show me my accounts" — so a disabled lane still gets a row (greyed, with
// its reason) and both windows always render, the %/reset/— three-way saying
// "unknown" rather than the row disappearing.
//
// Same /api/accounts pipeline the strip and useProjectedHome already poll —
// a third reader, not a new route. Its own 20s poller rather than sharing
// theirs: useProjectedHome.ts:9-12 makes the same call for ProjectCard and
// defends the duplication — one more GET against two small local JSON files
// beats coupling component trees that must not depend on each other mounting.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AccountUsage, ProjectedHome } from '../../../shared/api';
import { limitBand } from '../components/LimitBar';
import { Skeleton } from '../components/Skeleton';
import { formatAge, formatReset } from '../fleet/formatReset';
import { sessionLabel } from '../fleet/sessionLabel';
import { accountColorVar, accountLabel, homeAbleLabelList, KNOWN_WRAPPERS } from '../lib/accounts';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { useNow } from '../lib/useNow';
import { useFleetStore } from '../stores/fleet';
import '../fleet/fleet.css';

interface AccountsPoll {
  accounts: AccountUsage[] | null;               // null: no poll has landed yet
  projected: ProjectedHome | null | undefined;    // undefined: no poll has landed yet; null: landed, nothing placeable
}

function useAccountsPoll(): AccountsPoll {
  const [state, setState] = useState<AccountsPoll>({ accounts: null, projected: undefined });
  useEffect(() => {
    let live = true;
    const load = (): void => {
      void api.accounts()
        .then((r) => { if (live) setState({ accounts: r.accounts, projected: r.projected }); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return state;
}

/** ccd's rotation order first, then any wrapper the server has telemetry for
 *  that ccd doesn't know about — the same union SwapSheet's pickableWrappers
 *  uses, so a fifth account never goes missing from either surface. */
function rowOrder(accounts: readonly AccountUsage[]): string[] {
  const order = [...KNOWN_WRAPPERS];
  for (const a of accounts) if (!order.includes(a.wrapper)) order.push(a.wrapper);
  return order;
}

function Bar({ label, pct, resetAt, nowSec, rolledOver }: {
  label: string; pct: number | null; resetAt: number | null; nowSec: number; rolledOver: boolean;
}): ReactNode {
  return (
    <div className="acct-row">
      <span className="acct-win">{label}</span>
      <span className="acct-meter" data-band={pct === null ? 'none' : limitBand(pct)}>
        <span className="acct-fill" style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
      </span>
      {/* The strip's exact three-way (AccountsStrip.tsx), never collapsed:
          "reset" (inferred zero) ≠ measured "0%" ≠ "—" (never measured). This
          screen never gates the row on `pct !== null` the way the strip does
          for gpt's absent 5h window — every account gets both bars, always,
          so an unmeasured window reads "—" instead of vanishing. */}
      <span className="acct-pct">{rolledOver ? 'reset' : pct === null ? '—' : `${pct}%`}</span>
      <span className="acct-reset" title="time until this window resets">↻ {formatReset(resetAt, nowSec)}</span>
    </div>
  );
}

export function AccountsScreen(): ReactNode {
  const { accounts, projected } = useAccountsPoll();
  const sessions = useFleetStore((s) => s.sessions);
  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);

  const order = rowOrder(accounts ?? []);

  // ccd's own rule, restated ("next workspace lands here — least-loaded"),
  // including the Rider B case where nothing is placeable. `undefined`
  // (nothing polled yet) says nothing — same three-state read ProjectCard's
  // addLabel already makes, never collapsing "don't know yet" into either
  // defined answer.
  //
  // `projected === null` is a claim about HOME_ABLE lanes only (gpt is never
  // consulted — see homeAbleLabelList) — this same screen renders a gpt row
  // right below, so "all accounts disabled" would read as a claim about the
  // list under it that the server never actually checked. Naming the three
  // lanes individually is what ccd's own placement refusal already does.
  const projectionLine = projected === undefined
    ? null
    : projected === null
      ? `Next workspace: ${homeAbleLabelList()} all disabled — nothing can take it`
      : `Next workspace lands on ${accountLabel(projected.wrapper)} — least-loaded`;

  return (
    <div className="accounts-screen">
      <header className="accounts-head">
        <button type="button" className="accounts-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="accounts-title">Accounts</h1>
      </header>

      {projectionLine !== null && <p className="accounts-projection">{projectionLine}</p>}

      <div className="accounts-list">
        {!accounts ? (
          // No poll has landed yet — still in flight, or every attempt so
          // far has failed (host down, PWA opened offline, mid restart).
          // Rendering the rows below in that state would find `a === null`
          // for every account and print "last reported —" across the board:
          // literally true of the fixture ("nothing measured") but false of
          // the account ("never asked" reads as "never landed" to whoever's
          // looking). Same three-state discipline as `projectionLine` above
          // — "don't know yet" gets its own render, not a borrowed one.
          // Falsy, not `=== null`: a same-shape sibling (AccountsStrip) was
          // handed a bare `undefined` by a test fixture whose stub returns
          // `{}` for an unmatched route, despite the declared `T[] | null` —
          // `!accounts` degrades to this branch instead of crashing on it.
          order.map((wrapper) => (
            <section key={wrapper} className="accounts-row" data-loading="true">
              <Skeleton lines={3} />
            </section>
          ))
        ) : order.map((wrapper) => {
          const a = accounts.find((x) => x.wrapper === wrapper) ?? null;
          const disabled = a?.disabled === true;
          const ts = a?.ts ?? null;
          // "Sessions on this account" means LIVE sessions (Rider A §4): a
          // workspace that is archived, mid-cleanup, or whose tmux session is
          // gone (`status: 'dead'`) is not load on this account, even though
          // it still carries the account's `wrapper` and stays in the fleet
          // store until reaped. `archivedAt !== null` is `sessionBucket`'s own
          // first check (shared/api.ts) — it alone covers both 'archived' and
          // 'cleanup', so this predicate is exactly "neither of those, nor
          // dead" without re-deriving the bucket ladder here.
          const onAccount = sessions.filter(
            (s) => s.wrapper === wrapper && s.archivedAt === null && s.status !== 'dead',
          );
          return (
            <section key={wrapper} className="accounts-row" data-disabled={disabled ? 'true' : 'false'}>
              <div className="accounts-row-head">
                <span
                  className="account-gauge-label"
                  style={{ color: disabled ? 'var(--ink-tertiary)' : `var(${accountColorVar(wrapper)})` }}
                >
                  {accountLabel(wrapper)}
                </span>
                {/* Disabled lanes are shown switched off, never hidden — the
                    strip's compact filter (AccountsStrip.tsx) is right for an
                    always-on bar, wrong here. */}
                {disabled && <span className="accounts-disabled-note">disabled on the fleet host</span>}
              </div>

              <div className="acct-rows">
                <Bar label="5h" pct={a?.five ?? null} resetAt={a?.fiveResetAt ?? null} nowSec={nowSec} rolledOver={a?.fiveRolledOver ?? false} />
                <Bar label="7d" pct={a?.seven ?? null} resetAt={a?.sevenResetAt ?? null} nowSec={nowSec} rolledOver={a?.sevenRolledOver ?? false} />
              </div>

              {/* Telemetry is a byproduct of a session rendering its
                  statusline — an idle account simply stops reporting. This
                  reads as "last known", never as live: no refresh button,
                  because there is nothing to refresh until a session runs. */}
              <p className="accounts-fresh">last reported {formatAge(ts === null ? null : nowSec - ts)}</p>

              {onAccount.length > 0 && (
                <ul className="accounts-sessions">
                  {onAccount.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="accounts-session" onClick={() => navigate(`/s/${s.id}`)}>
                        {sessionLabel(s)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
