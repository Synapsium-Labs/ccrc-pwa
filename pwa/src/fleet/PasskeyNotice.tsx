// The passphrase-only notice on the fleet screen (D-161) — one compact line
// that says the box has no passkey on it, and goes to the screen where you add
// one.
//
// WHY IT EXISTS. The gate shipped with enrolment reachable only from
// /accounts, and /accounts was reachable only from the AccountsStrip — a
// full-width usage readout that reads as data, not as navigation. So a box
// running on the passphrase alone said so nowhere, and the operator had no
// reason to go looking. The door in the fleet header is the other half of the
// fix; this is the half that tells you there is something to go and do.
//
// IT IS NOT DISMISSIBLE, and that is the design rather than an omission: it
// retires the instant a passkey exists, so there is no dismiss-state to
// persist, no stale flag to migrate — and no way to permanently silence it
// while the box really is passphrase-only.
//
// THE `mode !== 'off'` GUARD IS THE LOAD-BEARING ONE. `CCRC_AUTH` is off by
// default for every OSS install, and on a dark box there is no gate to add a
// passkey to: the advice would be about a lock that does not exist. Same
// three-falsy-checks discipline as AccountsScreen's AuthSection — an absent
// `mode` (an older server, a proxy answering its own 200) is treated exactly
// like `'off'`.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus } from '../../../shared/api';
import { onAuthPostureChanged, readAuthStatus } from '../lib/auth';
import { navigate } from '../lib/router';
import './fleet.css';

/**
 * Exactly the condition the brief names: armed, signed in, nothing enrolled.
 *
 * `passkeysEnrolled === 0` and not `(x ?? 0) === 0`: the server MINIMIZES the
 * status body for a caller it does not know, so an absent count is "it didn't
 * say", which is not evidence that no passkey exists. Positive evidence only,
 * the same rule `raiseAuthLostFrom` holds one file over.
 */
function nagWorthy(status: Partial<AuthStatus> | null): boolean {
  if (status === null) return false;
  if (status.mode === undefined || status.mode === 'off') return false;
  return status.authed === true && status.passkeysEnrolled === 0;
}

export function PasskeyNotice(): ReactNode {
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      // `readAuthStatus` is the app's one spelling of this route (lib/auth.ts),
      // and the one call that never raises the auth-lost signal — a failure
      // here can't put a login screen over a working console. On failure the
      // last known posture stands: a line that flickered off every time a
      // status read missed would be worse than one that is a moment stale.
      void readAuthStatus().then((s) => { if (live) setStatus(s); }).catch(() => {});
    };
    read();
    // No poll. The one event that retires this line — a passkey being enrolled
    // — happens in AccountsScreen, which announces it (lib/auth.ts's
    // `authPostureChanged`); a minute-by-minute GET would be paying forever to
    // notice something that happens once.
    const off = onAuthPostureChanged(read);
    return () => { live = false; off(); };
  }, []);

  if (!nagWorthy(status)) return null;
  return (
    <button
      type="button"
      className="passkey-notice"
      onClick={() => navigate('/accounts')}
    >
      Passphrase only &mdash; add a passkey
    </button>
  );
}
