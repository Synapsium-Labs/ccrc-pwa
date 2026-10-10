// The accounts screen's AUTH section — enrol a passkey, sign out.
//
// WHY IT IS ITS OWN FILE. It shares a route with the account meters and
// nothing else: its own status read, its own five pieces of state, its own
// two failure lines, and a dark-box rule that makes the whole thing render
// nothing. `AccountsScreen` renders it and hands it no props at all, which is
// the measure of how little the two halves have to say to each other.
//
// The classes stay `acct-*`/`pk-*`: fleet.css grounds them and this is their
// only consumer. The shape moves, the ground stays.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus, PasskeyListResponse } from '../../../shared/api';
import { Button, useNow } from '@ccrc/ui';
import { formatAge } from '../fleet/formatReset';
import { api, apiErrorText } from '../lib/api';
import { authPostureChanged, raiseAuthLost, readAuthStatus } from '../lib/auth';
import { PasskeyCeremonyError, enrollPasskey, passkeyEnrollSupported } from '../lib/passkey';
import '../fleet/fleet.css';

/**
 * THE TWO SESSION-LEVEL CONTROLS THE GATE NEEDS — enrolling a passkey, and
 * signing out — behind ONE status read.
 *
 * They live HERE rather than on the login screen for the same reason, stated
 * once: both require an existing session. You must already be signed in to
 * enrol (the server gates `register/*`, which is what makes the whole
 * no-attestation design safe) and to sign out (`POST /api/auth/logout` is
 * deliberately NOT exempt — an ungated logout is a way for anyone on the tailnet
 * to revoke a session id they guessed). The login screen is the one place
 * neither could go. This is the closest thing the PWA has to a box-settings
 * surface, one back-tap from the fleet.
 *
 * ONE `readAuthStatus` FOR BOTH. They were nearly two components with two GETs
 * and two copies of the dark-box guard below; a second reader of the same route
 * on the same screen is how the two would come to disagree about whether this
 * box even has a gate.
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
export function AuthSection(): ReactNode {
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);
  const [list, setList] = useState<PasskeyListResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The session block's own failure line. SEPARATE from `note`, which is
   *  rendered inside the passkey block — a sign-out that failed must not print
   *  its reason under a list of authenticators it has nothing to do with. */
  const [signOutNote, setSignOutNote] = useState<string | null>(null);
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
      // The box's posture just changed, and something else on screen describes
      // it: on desktop the fleet sidebar's passphrase-only notice (D-161) is
      // mounted right beside this pane, and its whole design is that it retires
      // the instant a passkey exists rather than carrying a dismiss-state.
      // Announced from the WRITER, not polled by the reader (lib/auth.ts).
      authPostureChanged();
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
      // Same announcement as enrolment, and needed in BOTH directions:
      // revoking the last key puts the box back on the passphrase alone, which
      // is exactly when the notice has to come back.
      authPostureChanged();
    } catch (err) {
      setNote(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * SIGN OUT — the control that was missing entirely (D-145).
   *
   * The server side shipped in Task 5, gated and tested, and nothing called it,
   * so the only ways back to a login screen were an empty cookie jar, a
   * `ccrc passwd` rotation, or waiting out the 30-day absolute TTL.
   *
   * THE LOCAL HALF GOES THROUGH `raiseAuthLost`, NOT A SECOND PATH. The server
   * answers 204 with an expiring `Set-Cookie`, which no funnel in `api.ts`
   * reacts to (only a 401 body carrying a verdict does), so the signal has to be
   * raised here — and it is raised through the SAME seam a 401 uses, because
   * that seam already does three things this would otherwise have to reinvent:
   * it mounts `LoginScreen`, it parks both socket ladders (`ws.ts`'s connect
   * guard and `TerminalDrawer`'s bare socket) so neither climbs a backoff
   * against a gate that will not open, and it makes the next successful login's
   * `clearAuthLost` wake them both.
   *
   * `'no-session'` and not `'expired'`: the login screen's sentence for
   * `'expired'` is "You were signed out. Sign in to pick up where you were",
   * which is a claim about something that HAPPENED TO the operator. This is a
   * cold screen after a deliberate act, and `'no-session'` says exactly that.
   *
   * A FAILURE STILL ENDS SOMEWHERE SENSIBLE: the route is gated, so a session
   * that is already dead answers 401, the funnel raises the signal off the body,
   * and the operator lands on the login screen anyway — which is where they were
   * trying to go. `signOutNote` is for the genuinely odd failures (offline, 500)
   * where nothing has changed and they need to know it.
   */
  const signOut = async (): Promise<void> => {
    setBusy(true);
    setSignOutNote(null);
    try {
      await api.logout();
      raiseAuthLost('no-session');
    } catch (err) {
      setSignOutNote(apiErrorText(err));
    } finally {
      // Cleared even on the success path, where this component is still MOUNTED
      // behind the login screen (`LoginScreen` is a sibling of `.app-shell`, not
      // a replacement for it). Leaving it set would show a permanent "Signing
      // out…" to anyone who signs back in and returns to this screen.
      setBusy(false);
    }
  };

  /** The session block. Rendered in BOTH passkey branches below — including the
   *  unreadable-file one, where an operator whose credential store is broken
   *  still has every right to end their own session.
   *
   *  `.auth-block`, not `.accounts-row` (D-161) — see the passkey block's own
   *  note below; this block had the identical problem, reading as a fleet
   *  account named "This session". */
  const sessionBlock = (
    <section className="auth-block" aria-labelledby="session-title">
      <div className="auth-block-head">
        <h2 className="auth-block-title" id="session-title">This session</h2>
      </div>
      <p className="accounts-fresh">
        Signing out ends this browser&rsquo;s session only &mdash; other devices stay signed in, and
        enrolled passkeys are unaffected. To end every session at once, rotate the passphrase with
        <code> ccrc passwd</code> on the box.
      </p>
      <Button variant="primary" disabled={busy} onClick={() => void signOut()}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      {signOutNote !== null && <p className="accounts-fresh" role="status">{signOutNote}</p>}
    </section>
  );

  const count = status.passkeysEnrolled ?? 0;
  /**
   * THE UNREADABLE-FILE BRANCH, and it is not cosmetic (D-132). When the
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
      <>
        <section className="auth-block" aria-labelledby="auth-title">
          <div className="auth-block-head">
            <h2 className="auth-block-title" id="auth-title">Your sign-in</h2>
          </div>
          <h3 className="auth-block-sub" id="passkeys-title">Passkeys</h3>
          {/* THE PATH IS HEDGED, NOT ASSERTED (D-153). `CCRC_PASSKEYS_PATH` can
              redirect this file, and a BROWSER is the one surface in this tree
              that genuinely cannot resolve it — there is no route that
              publishes it, and adding one would publish a filesystem path to an
              anonymous-adjacent screen for the sake of a sentence. So it names
              the default and says what overrides it, exactly as
              `deploy/gen-auth-hash.mjs` hedges the session file it likewise
              cannot resolve. The alternative — dropping the path — would leave
              an operator with "fix the permissions" and no file to fix. */}
          <p className="accounts-fresh">
            This box&rsquo;s passkey file exists but cannot be read, so no passkey can sign in and
            enrolling is refused &mdash; adding one would overwrite the keys that are already there.
            Fix the permissions on <code>~/.ccrc/passkeys.json</code> (or wherever
            <code> CCRC_PASSKEYS_PATH</code> points on this box) and restart the server.
          </p>
        </section>
        {sessionBlock}
      </>
    );
  }

  return (
    <>
    {/* THIS BLOCK IS NOT AN ACCOUNT (D-161). It used to be a `.accounts-row`
        whose label was an `.account-gauge-label` — the same two classes every
        Claude account row above wears — so "Passkeys" scanned as a fifth fleet
        account named Passkeys, sitting in the same list as claude2 and gpt. It
        gets its own class and a heading that says WHOSE it is; "Passkeys"
        survives one level down, where it belongs, as the label of the list of
        keys rather than as the block's identity. */}
    <section className="auth-block" aria-labelledby="auth-title">
      <div className="auth-block-head">
        <h2 className="auth-block-title" id="auth-title">Your sign-in</h2>
      </div>
      <h3 className="auth-block-sub" id="passkeys-title">Passkeys</h3>
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
        /* `aria-labelledby` moved DOWN here with the heading (D-161): the
           section is "Your sign-in" now, and "Passkeys" labels the list it
           actually describes. */
        <ul className="accounts-sessions" aria-labelledby="passkeys-title">
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
        <Button variant="primary" disabled={busy} onClick={() => void enroll()}>
          {busy ? 'Waiting for the authenticator…' : 'Add a passkey on this device'}
        </Button>
      )}
      {note !== null && <p className="accounts-fresh" role="status">{note}</p>}
    </section>
    {sessionBlock}
    </>
  );
}
