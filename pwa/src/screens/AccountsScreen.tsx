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
import type { AccountUsage, ProjectedHome, RosterWire } from '../../../shared/api';
import type { AccountPoolWire } from '../../../shared/poolrule';
import { BackButton, Skeleton, toast, useNow } from '@ccrc/ui';
import { AccountMeterRow } from '../fleet/AccountMeterRow';
import { AccountPoolSheet } from '../fleet/AccountPoolSheet';
import { formatAge } from '../fleet/formatReset';
import { sessionLabel } from '../fleet/sessionLabel';
import { accountColorVar, accountLabel, accountPoolState, homeAbleLabelList, rosterWrapperIds, warnNonArrayRoster } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import { useFleetStore } from '../stores/fleet';
import { AuthSection } from './AuthSection';
import '../fleet/fleet.css';
import { poolCleared, poolWriteFailed } from '../fleet/poolWords';

/** The chip's short text, accessible name and `data-pool`/`data-origin` for
 *  EVERY `AccountPoolWire` state — review round 1, I4. `malformed`,
 *  `unreadable` and `stale` are just as UNDECIDABLE to `poolRule` as each
 *  other (a 503, never a crossing offer, design §5.7) — collapsing any of
 *  them to "no pool" claims the opposite of what the server actually does
 *  with them: unconstrained, may serve any project. Distinct words for
 *  `stale` vs `unreadable` on purpose (design §5.7's own words: "one's
 *  remedy is file permissions, the other's is the control-plane link").
 *  Not producible by today's server (`resolvedAccountPool` only ever
 *  returns `tagged`/`untagged` — server/src/poolrule.ts), so this is latent,
 *  forward-looking coverage, not a reachable-today path.
 *
 *  Exhaustive over the current five-member union: the `never` assignment in
 *  the default arm is what makes a sixth member (a future server) a compile
 *  error here, rather than a silent "no pool" narrowing — `ProjectCard`'s own
 *  `PoolChip` makes the identical argument for its `unrecognised` fallback,
 *  the one condition TypeScript cannot see: a value that arrives at runtime
 *  off the type this build was compiled against. */
/** What the account-pool chip discloses when the fleet host's `ccd` has no
 *  ACCOUNT-pool machinery yet (`accountPools: 'unavailable'`) — the sibling
 *  fact `ProjectCard.tsx`'s `POOL_UNAVAILABLE_TEXT` states for project pools,
 *  named separately because the two are independent capabilities
 *  (`poolsEnforcement` reads `PROJECT_POOL_VERB`; `accountPoolsEnforcement`
 *  reads `ACCOUNT_POOLS_CAP` — a fleet can have one without the other).
 *
 *  UNLIKE the project chip, this one stays a clickable button when dimmed
 *  (see its `data-dim` usage below) rather than degrading to an inert span:
 *  a project tag write dispatches a `ccd` verb that a `poolsEnforcement:
 *  'unavailable'` fleet genuinely cannot run, but an account tag write is a
 *  central `coord.db` row this SERVER always accepts — `accountPools:
 *  'unavailable'` means no fleet node reads it YET, not that the write would
 *  fail. Disabling the control would also be the only way an operator could
 *  ever see this text, since the chip is the sheet's one entry point.
 *
 *  Exported so the suite pins the sentence rather than a paraphrase of it. */
export const ACCOUNT_POOL_UNAVAILABLE_TEXT = 'fleet ccd predates account pools';

function acctPoolChip(state: AccountPoolWire): {
  word: string; ariaLabel: string; dataPool: string; origin?: 'central' | 'declared';
} {
  switch (state.state) {
    case 'tagged':
      return {
        word: state.pools[0], dataPool: 'tagged', origin: state.origin,
        ariaLabel: `pool ${state.pools[0]}, opens the account pool editor`,
      };
    case 'untagged':
      return {
        word: 'no pool', dataPool: 'untagged', origin: state.origin,
        ariaLabel: 'no pool, opens the account pool editor',
      };
    case 'malformed':
      return {
        word: 'pool malformed', dataPool: 'malformed',
        ariaLabel: "this account's pool tag is malformed — nobody can decide whether it may serve a tagged project, opens the account pool editor",
      };
    case 'unreadable':
      return {
        word: 'pool unreadable', dataPool: 'unreadable',
        ariaLabel: "this account's pool tag could not be read — check permissions on the fleet host, opens the account pool editor",
      };
    case 'stale':
      return {
        word: 'pool stale', dataPool: 'stale',
        ariaLabel: "this account's pool projection is stale — the control-plane link may be down, opens the account pool editor",
      };
    default: {
      const unhandled: never = state;
      void unhandled;
      return {
        word: 'pool unrecognised', dataPool: 'unrecognised',
        ariaLabel: 'app bundle is older than the fleet; reload to understand this account pool, opens the account pool editor',
      };
    }
  }
}

// `accountPoolState(roster, wrapper)` — no edges map (ruling T9-R1). This
// screen's own `GET /api/accounts` poll (`useAccountsPoll` below) carries the
// roster, and `RosterWire.resolvedPool` (Task 7's T7-R2 fix round) rides the
// same response when the server has one to offer — see `lib/accounts.ts`'s
// own docstring. Every row below renders whatever `accountPoolState` returns
// without this screen having to know whether that came from a resolved
// central tag or the declared fallback.

interface AccountsPoll {
  accounts: AccountUsage[] | null;               // null: no poll has landed yet
  projected: ProjectedHome | null | undefined;    // undefined: no poll has landed yet; null: landed, nothing placeable
  roster: RosterWire[];                           // []: no poll has landed yet, same as accounts/projected
}

function useAccountsPoll(): AccountsPoll {
  const [state, setState] = useState<AccountsPoll>({ accounts: null, projected: undefined, roster: [] });
  useEffect(() => {
    let live = true;
    const load = (): void => {
      void api.accounts()
        .then((r) => {
          if (!live) return;
          // `Array.isArray`, not a bare trust: a fetch stub answering an
          // unmatched route with bare `{}` (several fixtures across this
          // suite predate Task 7 and do exactly that) hands back `r.roster
          // === undefined`, and `rowOrder` below does `roster.map(...)`
          // unguarded — same reasoning as `stores/fleet.ts`'s own roster
          // poll. `accounts`/`projected` need no equivalent guard: both
          // already degrade a bare `undefined` to their own "no poll landed"
          // branch (the falsy `!accounts` check, the three-state `projected`
          // read) rather than indexing into it.
          //
          // Functional update, not a flat object literal (fix round 1,
          // finding 5): the flat form clobbered an already-good roster with
          // `[]` the instant one later poll came back malformed, while
          // `stores/fleet.ts` and `AccountsStrip.tsx` both already preserved
          // it by simply skipping the write. `prev.roster` is the same
          // preservation here, where `accounts`/`projected` still need to
          // update on every read regardless. Warn once on the malformed
          // branch — a genuine protocol break has no other signal anywhere
          // (finding 6).
          setState((prev) => {
            if (Array.isArray(r.roster)) return { accounts: r.accounts, projected: r.projected, roster: r.roster };
            warnNonArrayRoster(r);
            return { accounts: r.accounts, projected: r.projected, roster: prev.roster };
          });
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return state;
}

/** The roster's declaration order first, then any wrapper the server has
 *  telemetry for that the roster doesn't (yet) know about — the same union
 *  SwapSheet's pickableWrappers uses, so a fifth account never goes missing
 *  from either surface.
 *
 *  BEFORE THE FIRST POLL: `roster` and `accounts` arrive on the exact same
 *  `GET /api/accounts` response, so they are unknown for exactly the same
 *  instant — there is no wrapper id to key a row on yet, roster-derived or
 *  not. Unlike the compile-time `KNOWN_WRAPPERS` this replaces (five ids,
 *  always available, so `rowOrder` was never empty), an empty roster
 *  genuinely has nothing to enumerate — `rowOrder` returns `[]` here, and the
 *  loading branch below renders a plain, count-free skeleton instead of one
 *  row per (unknown) account. That is the honest degrade this task's brief
 *  asks for: guessing at a row count before the roster says what the
 *  accounts ARE would be inventing accounts, the exact failure class this
 *  whole stage exists to end. */
function rowOrder(roster: readonly RosterWire[], accounts: readonly AccountUsage[]): string[] {
  const order: string[] = rosterWrapperIds(roster);
  for (const a of accounts) if (!order.includes(a.wrapper)) order.push(a.wrapper);
  return order;
}

export function AccountsScreen(): ReactNode {
  const { accounts, projected, roster } = useAccountsPoll();
  const sessions = useFleetStore((s) => s.sessions);
  // Item 3 (I1, wave-1 fix round A): the fleet-level `pools` frame's
  // `accountPools` capability — produced (T9-R2/F2, `server/src/pools.ts`'s
  // `accountPoolsEnforcement`) and, until this round, read by nothing in
  // `pwa/`. `null` (no frame yet) and `undefined` (an older server that never
  // sends the field) both mean "no evidence", the same as `ProjectCard`'s own
  // `pools?.enforcement` read — only a MEASURED `'unavailable'` dims the chip.
  const accountPools = useFleetStore((s) => s.pools?.accountPools);
  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);

  const order = rowOrder(roster, accounts ?? []);

  // The account-pool editor — one sheet, retargeted per tap, on the exact
  // terms `PoolSheet`/`FleetScreen`'s own pool sheet already use: the route-
  // owned subject lives here, not inside the sheet.
  const [poolSheetAccount, setPoolSheetAccount] = useState<string | null>(null);
  const [poolSheetOpen, setPoolSheetOpen] = useState(false);

  // `POST /api/pools/accounts/:id` (Task 7) does not echo the account's
  // resulting tag — only the epoch the write produced — so this toasts off
  // the REQUEST, not a remeasurement, and leans on `useAccountsPoll`'s own
  // 20s interval to bring the row's next `accountPoolState` read in line
  // with what the fleet host actually converges to (ccd-pool-sync's pull,
  // `OnUnitActiveSec=60s` — the same lag the fleet head's epoch/observed
  // indicator exists to make visible elsewhere).
  const setAccountPool = (accountId: string, pools: string[]): void => {
    void api.setAccountPools(accountId, pools).then(
      (response) => {
        if (response.warning === 'unknown-account') {
          toast(
            `Tagged ${accountId}${pools.length > 0 ? ` into pool ${pools[0]}` : ''}, but this box's roster `
              + 'does not know that account yet.',
            'error',
          );
        } else {
          toast(pools.length > 0 ? `${accountId} is now in pool ${pools[0]}.` : poolCleared(accountId));
        }
      },
      (error: unknown) => toast(poolWriteFailed(apiErrorText(error)), 'error'),
    );
    setPoolSheetOpen(false);
  };

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
  //
  // `homeAbleNames === ''` (fix round 1, finding 7): `projected` and `roster`
  // arrive on the same poll response in the steady state, but a first
  // response that lands with a valid `projected: null` and a malformed
  // `roster` leaves `roster` at its `[]` default (`useAccountsPoll`
  // preserves rather than clobbers on a malformed read — see its own
  // comment) — same degenerate case ProjectCard's `addLabel` guards.
  const homeAbleNames = homeAbleLabelList(roster);
  const projectionLine = projected === undefined
    ? null
    : projected === null
      ? homeAbleNames === ''
        ? 'Next workspace: all disabled — nothing can take it'
        : `Next workspace: ${homeAbleNames} all disabled — nothing can take it`
      : `Next workspace lands on ${accountLabel(roster, projected.wrapper)} — least-loaded`;

  return (
    <div className="accounts-screen">
      <header className="accounts-head">
        <BackButton className="accounts-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </BackButton>
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
          //
          // NOT one skeleton row per `order` entry any more: `order` is
          // DERIVED from `roster`, which arrives on this same unlanded poll —
          // before it lands there is no wrapper id to key a row on, roster or
          // not (unlike the compile-time `KNOWN_WRAPPERS` this replaced,
          // which always had five). Guessing a row count from the roster this
          // screen has not received yet would be inventing accounts, so a
          // single count-free skeleton block stands in for "loading" instead
          // — see `rowOrder`'s own comment.
          <section className="accounts-row" data-loading="true">
            <Skeleton lines={3} />
          </section>
        ) : order.map((wrapper) => {
          const a = accounts.find((x) => x.wrapper === wrapper) ?? null;
          // TWO facts, ONE affordance. `disabled` is the operator's kill-switch
          // (`~/.cc-sessions/<w>-disabled`, touched by hand); `authDead` is the
          // health probe's measurement (`<w>-authdead`). They are never folded
          // into one boolean upstream — the server keeps them apart for exactly
          // the reason the note below says both when both are true — but on this
          // screen they answer the same question, "can this lane take work?", so
          // they render through the attribute and the note that already exist
          // rather than a second vocabulary beside them.
          //
          // `=== true` on both, never truthiness: a server built before
          // `authDead` omits it, and absence must read as "not condemned".
          const disabled = a?.disabled === true;
          const authDead = a?.authDead === true;
          const off = disabled || authDead;
          // Both, when both — an operator switch does not hide a measurement,
          // and a measurement does not explain away a switch. The two are
          // cleared by different acts.
          const offNote = disabled && authDead
            ? 'disabled on the fleet host; sign-in expired'
            : disabled
              ? 'disabled on the fleet host'
              : 'sign-in expired on the fleet host';
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
          // `accountPoolState`, not `accountPool` — this chip is the one
          // surface in the app whose whole job is to say WHICH carrier
          // decided (`data-origin`), so an operator who just cleared a
          // central tag sees the declared default take over rather than a
          // chip that looks unchanged. `acctPoolChip` covers all five states,
          // not just tagged/untagged (I4).
          //
          // Review round 1, Minor: `inRoster` gates the chip entirely for a
          // wrapper `rowOrder` added from LIVE TELEMETRY the roster does not
          // (yet) have an entry for (`rowOrder`'s own docstring). Without
          // this, `accountPoolState` still answers `{state:'untagged',
          // origin:'declared'}` for such a wrapper — a POSITIVE claim ("the
          // roster declares this untagged") about an account this roster has
          // no entry to declare anything about, which is a different, worse
          // claim than the old code's silence. `accountLabel`'s raw-name
          // fallback is a safe degrade for the SAME condition because it
          // asserts nothing; an origin claim is not that.
          const inRoster = roster.some((a) => a.id === wrapper);
          const poolState = accountPoolState(roster, wrapper);
          const chip = acctPoolChip(poolState);
          // Item 3 (I1): measured `'unavailable'` only — `undefined`/`'unknown'`
          // are no-evidence-either-way, same polarity as `ProjectCard`'s
          // `poolDim`, so a fleet nobody has measured yet never dims the chip
          // on a guess.
          const acctPoolDim = accountPools === 'unavailable';
          return (
            <section key={wrapper} className="accounts-row" data-disabled={off ? 'true' : 'false'}>
              <div className="accounts-row-head">
                <span
                  className="account-gauge-label"
                  style={{ color: off ? 'var(--ink-tertiary)' : `var(${accountColorVar(roster, wrapper)})` }}
                >
                  {accountLabel(roster, wrapper)}
                </span>
                {/* Disabled lanes are shown switched off, never hidden — the
                    strip's compact filter (AccountsStrip.tsx) is right for an
                    always-on bar, wrong here. A lane whose credential the probe
                    measured dead is shown for a sharper version of the same
                    reason: it is the one lane an operator has to go and fix. */}
                {off && <span className="accounts-disabled-note">{offNote}</span>}
                {inRoster && (
                  <button
                    type="button"
                    className="proj-card-pool acct-pool-chip"
                    data-testid={`acct-pool-chip-${wrapper}`}
                    data-pool={chip.dataPool}
                    data-origin={chip.origin}
                    data-dim={acctPoolDim || undefined}
                    aria-label={acctPoolDim ? `${chip.ariaLabel} — ${ACCOUNT_POOL_UNAVAILABLE_TEXT}` : chip.ariaLabel}
                    title={acctPoolDim ? ACCOUNT_POOL_UNAVAILABLE_TEXT : undefined}
                    onClick={() => { setPoolSheetAccount(wrapper); setPoolSheetOpen(true); }}
                  >
                    {chip.word}
                  </button>
                )}
              </div>

              <div className="acct-rows">
                <AccountMeterRow label="5h" pct={a?.five ?? null} resetAt={a?.fiveResetAt ?? null} nowSec={nowSec} rolledOver={a?.fiveRolledOver ?? false} />
                <AccountMeterRow label="7d" pct={a?.seven ?? null} resetAt={a?.sevenResetAt ?? null} nowSec={nowSec} rolledOver={a?.sevenRolledOver ?? false} />
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

      <AuthSection />

      <AccountPoolSheet
        account={poolSheetAccount}
        roster={roster}
        current={poolSheetAccount === null ? undefined : accountPoolState(roster, poolSheetAccount)}
        unenforced={accountPools === 'unavailable'}
        open={poolSheetOpen}
        onClose={() => setPoolSheetOpen(false)}
        onSet={setAccountPool}
      />
    </div>
  );
}
