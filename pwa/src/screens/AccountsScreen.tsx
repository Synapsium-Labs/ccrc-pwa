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
import type { AccountUsage, AuthStatus, PasskeyListResponse, ProjectedHome, RosterWire } from '../../../shared/api';
import { limitBand } from '../components/LimitBar';
import { Skeleton } from '../components/Skeleton';
import { formatAge, formatReset } from '../fleet/formatReset';
import { sessionLabel } from '../fleet/sessionLabel';
import { accountColorVar, accountLabel, homeAbleLabelList, rosterWrapperIds } from '../lib/accounts';
import { api, apiErrorText } from '../lib/api';
import { readAuthStatus } from '../lib/auth';
import { PasskeyCeremonyError, enrollPasskey, passkeyEnrollSupported } from '../lib/passkey';
import { navigate } from '../lib/router';
import { useNow } from '../lib/useNow';
import { useFleetStore } from '../stores/fleet';
import '../fleet/fleet.css';

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
            console.warn('ccrc: GET /api/accounts answered with a non-array roster; keeping the last known one.', r);
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
  const { accounts, projected, roster } = useAccountsPoll();
  const sessions = useFleetStore((s) => s.sessions);
  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);

  const order = rowOrder(roster, accounts ?? []);

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
                  style={{ color: disabled ? 'var(--ink-tertiary)' : `var(${accountColorVar(roster, wrapper)})` }}
                >
                  {accountLabel(roster, wrapper)}
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

      <PasskeySection />
    </div>
  );
}

/**
 * ENROLLING A PASSKEY — the one control the passkey feature needs behind the
 * gate, and the reason it lives HERE rather than on the login screen: you must
 * already be signed in to enrol (the server gates `register/*`, which is what
 * makes the whole no-attestation design safe), so the login screen is the one
 * place it could not go. This is the closest thing the PWA has to a box-settings
 * surface, one back-tap from the fleet.
 *
 * IT RENDERS NOTHING ON A DARK BOX, and that is three independent falsy checks
 * rather than one, each failing closed:
 *   - `mode` absent or `'off'` — `CCRC_AUTH` is off, or this server has no gate
 *     at all (an older build, a proxy answering its own 200). There is nothing
 *     to enrol into.
 *   - `passkeySupported()` — this browser cannot run the ceremony (no WebAuthn,
 *     or a non-secure context). A button that opens a dialog it cannot finish is
 *     worse than no button.
 *   - the status read failed — `status` stays `null` and nothing draws.
 *
 * It costs ONE extra GET on a screen the operator visits rarely, and
 * `readAuthStatus` is deliberately the one call in the app that never raises the
 * auth-lost signal (`lib/auth.ts`), so a failure here cannot put a login screen
 * over a working console.
 */
function PasskeySection(): ReactNode {
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);
  const [list, setList] = useState<PasskeyListResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const now = useNow(60_000);

  const refresh = (): void => {
    void readAuthStatus().then(setStatus).catch(() => { /* no gate, or unreachable — draw nothing */ });
    // The gated list. It 401s before login and 501s on a dark box, and either
    // way the catch leaves `list` null — the count from `status` still renders,
    // so the section degrades to what it showed before revocation existed
    // rather than disappearing.
    void api.passkeys().then(setList).catch(() => setList(null));
  };
  useEffect(refresh, []);

  if (status === null || status.mode === undefined || status.mode === 'off') return null;

  const enroll = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await enrollPasskey();
      setNote('Passkey added. It can sign you in from now on.');
      refresh();
    } catch (err) {
      // The ceremony's own failure and the box's refusal read differently, for
      // `LoginScreen`'s reason: telling someone their key was rejected when they
      // tapped Cancel sends them hunting for a problem that is not there.
      setNote(err instanceof PasskeyCeremonyError
        ? 'That passkey ceremony was cancelled or could not finish.'
        : apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await api.revokePasskey(id);
      setNote('Passkey revoked. It cannot sign in again.');
      refresh();
    } catch (err) {
      setNote(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const count = status.passkeysEnrolled ?? 0;
  /**
   * THE UNREADABLE-FILE BRANCH, and it is not cosmetic (D-119). When the
   * credential file exists and cannot be read, the server reports zero
   * credentials — and the sentence this screen used to render for zero was "No
   * passkey is enrolled on this box". An operator who believes it enrols, and
   * the enrolment rewrites the file from an empty in-memory array, destroying
   * the credentials that were there. The server refuses that enrolment now; this
   * is the half that stops the operator trying in the first place, and tells
   * them what to actually fix.
   */
  if (list?.storeUnreadable === true) {
    return (
      <section className="accounts-row" aria-labelledby="passkeys-title">
        <div className="accounts-row-head">
          <span className="account-gauge-label" id="passkeys-title">Passkeys</span>
        </div>
        <p className="accounts-fresh">
          This box&rsquo;s passkey file exists but cannot be read, so no passkey can sign in and
          enrolling is refused &mdash; adding one would overwrite the keys that are already there.
          Fix the permissions on <code>~/.ccrc/passkeys.json</code> and restart the server.
        </p>
      </section>
    );
  }

  return (
    <section className="accounts-row" aria-labelledby="passkeys-title">
      <div className="accounts-row-head">
        <span className="account-gauge-label" id="passkeys-title">Passkeys</span>
      </div>
      <p className="accounts-fresh">
        {count === 0
          ? 'No passkey is enrolled on this box — the passphrase is the only way in.'
          : `${count} passkey${count === 1 ? '' : 's'} enrolled on this box.`}
      </p>

      {/* One row per key, so REVOKING is a decision the operator can actually
          make: "the phone I lost, last used three weeks ago" needs the label and
          the dates, which is why `PasskeySummary` carries them and the anonymous
          `assert/start` body does not. `label` is the enrolling device's
          user-agent — attacker-controlled text — and is rendered as TEXT, which
          React does by default. */}
      {list !== null && list.credentials.length > 0 && (
        <ul className="accounts-sessions">
          {list.credentials.map((c) => (
            <li key={c.credentialIdB64url}>
              <span className="acct-win">{c.label}</span>
              <span className="accounts-fresh">
                {` added ${formatAge(Math.floor(now / 1000) - Math.floor(c.enrolledAt / 1000))} ago`}
                {c.lastUsedAt > c.enrolledAt
                  ? `, last used ${formatAge(Math.floor(now / 1000) - Math.floor(c.lastUsedAt / 1000))} ago`
                  : ', never used'}
              </span>
              <button
                type="button"
                className="accounts-session"
                disabled={busy}
                aria-label={`Revoke passkey ${c.label}`}
                onClick={() => void revoke(c.credentialIdB64url)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The ENROL button needs the STRICTER support check — `getPublicKey()` and
          friends are WebAuthn Level 2 — while the login button on `LoginScreen`
          needs only Level 1. A browser that can sign in with a key enrolled on a
          phone but cannot create one gets the list and no Add button. */}
      {passkeyEnrollSupported() && (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void enroll()}>
          {busy ? 'Waiting for the authenticator…' : 'Add a passkey on this device'}
        </button>
      )}
      {note !== null && <p className="accounts-fresh" role="status">{note}</p>}
    </section>
  );
}
