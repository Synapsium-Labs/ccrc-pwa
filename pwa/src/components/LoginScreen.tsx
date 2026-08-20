// The session gate's one visible act (Stage 3a). Mounted in app.tsx OUTSIDE
// `.app-shell` — a sibling before it, not a descendant — the `BlockScreen`
// mount, for `BlockScreen`'s reason: a banner lives in a pane, and this has to
// cover panes, sheets and toasts alike. There is no partial-functionality story
// for a box that is refusing every route.
//
// IT LIVES INSIDE THE SPA, deliberately, and a separate `/login.html` would be a
// trap rather than a simplification: the service worker's `navigateFallback`
// serves `index.html` for every navigation that is not `/api/` or `/ws/`
// (`vite.config.ts`), so a second entry point would be answered by the app shell
// anyway — an installed PWA would show the console's chrome and then a blank
// page. One SPA, one overlay.
//
// Below BlockScreen when both are up: they share `--z-block`, so DOM order
// decides, and app.tsx renders this one FIRST. That is the right way round — a
// build that cannot speak the fleet protocol cannot be fixed by signing in.
//
// Styles live in styles/shell.css (`.login-screen`) beside `.block-screen`, not
// in a stylesheet of their own: the design gate discovers its stylesheet list
// from disk and pins it exactly (pwa/test/contrast.test.ts), so a new file here
// would be a test to update for no reason. `.btn-primary` (primitives.css) is
// already in the bundle via ToastHost.
import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { AuthStatus, AuthVerdict } from '../../../shared/api';
import { ApiError, api } from '../lib/api';
import { clearAuthLost, readAuthStatus, useAuthLost, verdictOf } from '../lib/auth';

/**
 * One sentence per verdict — the whole point of `AuthVerdict` being a six-member
 * union rather than a boolean, and the reason `single-definition.test.ts` now
 * names THIS FILE alongside `shared/api.ts`: a `Record<AuthVerdict, string>` is
 * where a seventh verdict becomes a compile error instead of a screen that
 * renders a bare slug. Same shape, same argument, as `PrKeycap.tsx`'s
 * `REASON_TEXT`.
 *
 * Each sentence names a DIFFERENT thing to do, because each verdict is a
 * different thing that happened:
 *   - `unconfigured` says `ccrc passwd` and never "try again": nothing the
 *     operator types can EVER match a box with no secret, and a retry sentence
 *     there is a lie that costs them the afternoon.
 *   - `locked-out` is a clock, not a keyboard.
 *   - `expired` says they WERE signed in — the distinction `no-session` exists
 *     to be separate from, so a phone that slept through its TTL is not shown a
 *     cold login screen as if it had never been here.
 *   - `ok` is never rendered by this component (an `ok` box has no login
 *     screen); it is here because the Record is exhaustive, and it says the
 *     honest thing rather than a placeholder.
 */
export const VERDICT_TEXT: Record<AuthVerdict, string> = {
  ok: 'Signed in.',
  wrong: "That passphrase didn't match.",
  unconfigured: 'No passphrase is set on this box — run `ccrc passwd` on it, then sign in.',
  'locked-out': 'Too many attempts. Wait a minute, then try again.',
  expired: 'You were signed out. Sign in to pick up where you were.',
  'no-session': 'Sign in to reach this box.',
};

/** The failure that is not a verdict: the box never answered at all. Kept
 *  distinct from `wrong` on purpose — telling someone their passphrase was
 *  refused when the request never arrived is how an evening gets spent retyping
 *  a correct secret. */
const UNREACHABLE_TEXT = "Couldn't reach the box — check the connection and try again.";

export function LoginScreen(): ReactNode {
  // WHY the session went (first-wins, `lib/auth.ts`) — set by whichever refusal
  // arrived first and never overwritten while the screen is up.
  const { verdict } = useAuthLost();
  // Why the LAST attempt bounced (last-wins). A different question, asked at a
  // different moment, so it is a different piece of state — and it outranks the
  // standing verdict below, because it is the newer fact.
  const [refusal, setRefusal] = useState<AuthVerdict | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  /** The anonymous half of `GET /api/auth/status` — the one route readable
   *  before login. `mode` is read below so a browser arriving mid-lockout is
   *  told to wait before it is offered a field that cannot succeed.
   *
   *  TASK 8'S SEAM: `status.passkeysEnrolled` is already measured here, and the
   *  passkey button goes in the marked slot in the form below — its condition is
   *  `(status?.passkeysEnrolled ?? 0) > 0`, and its ceremony
   *  (`PasskeyAssertStart`/`Finish`, `shared/api.ts`) needs nothing from this
   *  component but that count and a place to stand. */
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);

  useEffect(() => {
    let live = true;
    void readAuthStatus()
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {
        /* an older server, or an unreachable one: the field still works */
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || passphrase === '') return;
    setBusy(true);
    setRefusal(null);
    setUnreachable(false);
    try {
      await api.login({ passphrase });
      // 204 + Set-Cookie. Drop the secret from state first, then let go of the
      // signal — `clearAuthLost` unmounts this component AND wakes every parked
      // socket (`lib/auth.ts`'s `onAuthRegained`), so "reconnect the sockets" is
      // not a second step anyone has to remember here.
      setPassphrase('');
      clearAuthLost();
    } catch (err) {
      // 401 `wrong`/`unconfigured` and 429 `locked-out` all arrive this way. The
      // 429 is the reason this reads the body itself rather than leaning on the
      // funnel's 401 signal: a rate-limited refusal is not a 401 at all.
      const v = err instanceof ApiError ? verdictOf(err.body) : null;
      if (v === null) setUnreachable(true);
      else setRefusal(v);
    } finally {
      setBusy(false);
    }
  };

  // Newest fact first: what just happened, then what the box says about itself,
  // then why the session went in the first place.
  const message = unreachable
    ? UNREACHABLE_TEXT
    : refusal !== null
      ? VERDICT_TEXT[refusal]
      : status?.mode === 'locked-out'
        ? VERDICT_TEXT['locked-out']
        : verdict !== null
          ? VERDICT_TEXT[verdict]
          : VERDICT_TEXT['no-session'];

  return (
    <div className="login-screen" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <h1 className="login-title" id="login-title">
        ccrc
      </h1>
      {/* A live region: a refusal arrives after the tap, so it has to announce
          itself rather than wait to be looked at. */}
      <p className="login-copy" role="status">
        {message}
      </p>
      <form className="login-form" onSubmit={submit}>
        <label className="login-label" htmlFor="ccrc-passphrase">
          Passphrase
        </label>
        <input
          id="ccrc-passphrase"
          className="login-input"
          name="passphrase"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
        {/* Task 8 draws the passkey button here — see `status` above. */}
        <button type="submit" className="btn-primary" disabled={busy || passphrase === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
