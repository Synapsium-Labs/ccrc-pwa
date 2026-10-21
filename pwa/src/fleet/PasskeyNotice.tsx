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
// while the box really is passphrase-only. That design is only honest if the
// retiring really happens and the line really is deserved, which is what every
// guard below is for.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus } from '../../../shared/api';
import { armedMode, onAuthPostureChanged, readAuthStatus } from '../lib/auth';
import { passkeyEnrollSupported } from '../lib/passkey';
import { navigate } from '../lib/router';
import './fleet.css';

// The armed-mode roster and its predicate live in `lib/auth.ts` since settings Task R2d (D-5508): Settings › Security's
// provider asks the same question before it reads the passkey list, and one roster cannot drift from itself.

/**
 * Exactly the condition the brief names, plus the one the destination screen
 * imposes: armed, signed in, nothing enrolled, and this browser can actually
 * enrol.
 *
 * ABSENCE IS NEVER PERMISSION, AND NEITHER IS A VALUE WE CANNOT READ. Every
 * field of `AuthStatus` is optional on the wire — the server MINIMIZES the body
 * for a caller it does not know, and an older server (or a proxy answering its
 * own 200) may not send a field at all — so each one is read as positive
 * evidence and anything else fails closed, the same rule `raiseAuthLostFrom`
 * holds one file over. Written as four separate refusals rather than one `&&`
 * chain because each has its own reason.
 *
 * That sentence is here on its third attempt, and the first two were both
 * measured wrong, which is why the fixtures matter more than the prose:
 *   - the two ABSENCES were only ever a comment — `mode` absent read as armed
 *     and `(passkeysEnrolled ?? 0) === 0` both passed the whole suite green
 *     until auth-door.test.tsx got a body with the field left out;
 *   - then `mode` was still a NEGATIVE list (anything that was neither
 *     `undefined` nor `'off'` counted as armed) while this docstring claimed
 *     positive evidence for it. `{authed: true, passkeysEnrolled: 0, mode:
 *     null}` and the same with `mode: 'wat'` both bought the nag, on a box that
 *     may have no gate at all — the docstring was the defect's cover, not its
 *     description. {@link armedMode} is the fix and the mode fixtures in
 *     auth-door.test.tsx are what hold it.
 *
 *   - `mode` — must be positively armed ({@link ARMED_MODES}). Absent is
 *     treated exactly like `'off'`, which is what `checkAuth` does with the
 *     same field; unlike `checkAuth`, an UNRECOGNISED mode is also silence
 *     here, and that divergence is deliberate rather than an oversight to be
 *     tidied away. The two guards fail in opposite directions: `checkAuth`
 *     erring toward "armed" puts up a login screen, which is recoverable and
 *     self-clearing (the next authed status read calls `clearAuthLost`), while
 *     this line erring toward "armed" is a NON-DISMISSIBLE nag with no way out
 *     except distrusting it. So this one is the stricter of the two on purpose.
 *   - `authed` — a gate that is armed and has refused us is the login screen's
 *     business. An anonymous caller's `passkeysEnrolled: 0` is a minimized
 *     body, not evidence that no passkey exists.
 *   - `passkeysEnrolled` — must be a positive 0. An absent count is "it didn't
 *     say", which is not evidence of anything.
 *   - `canEnrol` — the destination hides its Add button behind
 *     `passkeyEnrollSupported()` (WebAuthn Level 2, and `navigator.credentials`
 *     is absent outright in an insecure context — a plain-http box, which
 *     `cookieSecure: false` explicitly sanctions). A non-dismissible nag
 *     pointing at a button that is not there is a trap, not a hint.
 */
function nagWorthy(status: Partial<AuthStatus> | null, canEnrol: boolean): boolean {
  if (status === null) return false;
  if (!armedMode(status.mode)) return false;
  if (status.authed !== true) return false;
  if (status.passkeysEnrolled !== 0) return false;
  return canEnrol;
}

export function PasskeyNotice(): ReactNode {
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);
  useEffect(() => {
    let live = true;
    // THE NEWEST READ WINS, not the last one to land. Two posture changes
    // inside one round-trip invert otherwise: revoke key A (read A sees 1 left)
    // then revoke key B (read B sees 0); if A resolves after B, `setStatus`
    // lands `passkeysEnrolled: 1` last and the line stays hidden on a box that
    // is now passphrase-only, until the next posture change or a reload —
    // defeating the same "it changes the instant the fact changes" property the
    // whole component rests on. A generation counter, not an AbortController:
    // the request is a plain GET that must not be cancelled (its answer is
    // still the truth for whoever asked first), it just must not WRITE.
    let issued = 0;
    const read = (): void => {
      const mine = ++issued;
      // `readAuthStatus` is the app's one spelling of this route (lib/auth.ts),
      // and the one call that never raises the auth-lost signal — a failure
      // here can't put a login screen over a working console. On failure the
      // last known posture stands: a line that flickered off every time a
      // status read missed would be worse than one that is a moment stale.
      void readAuthStatus().then((s) => {
        if (live && mine === issued) setStatus(s);
      }).catch(() => {});
    };
    read();
    // No poll. The one event that retires this line — a passkey being enrolled
    // — happens on Settings › Security (R2d), which announces it (lib/auth.ts's
    // `authPostureChanged`); a minute-by-minute GET would be paying forever to
    // notice something that happens once.
    const off = onAuthPostureChanged(read);
    return () => { live = false; off(); };
  }, []);

  // Read at render, not captured in state: it is a property of the BROWSER, so
  // there is nothing to keep in sync and nothing to invalidate.
  if (!nagWorthy(status, passkeyEnrollSupported())) return null;
  return (
    <button
      type="button"
      className="passkey-notice"
      onClick={() => navigate('/settings/security')}
    >
      Passphrase only &mdash; add a passkey
    </button>
  );
}
