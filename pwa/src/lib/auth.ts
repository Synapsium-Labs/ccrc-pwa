// The auth-lost signal — one module-level fact the whole app reads: is the box
// refusing us right now, and why.
//
// WHY A SIGNAL AND NOT A THROW. Every REST call already rejects with `ApiError`
// (`lib/api.ts`), and a 401 rejects like any other status — callers need that,
// or their spinners never stop and their optimistic edits never roll back. What
// a rejection CANNOT do is raise one screen: there are ~40 call sites, and a
// "catch the 401 and show the login" rule written into each of them is forty
// chances to write it differently and one silent omission away from a console
// that just stops working. So the funnel sets THIS, once, and `app.tsx` renders
// the screen from it. Nobody has to catch anything for the door to appear.
//
// FIRST WINS, deliberately (see {@link raiseAuthLost}): four calls failing
// together are one event, and the first refusal is the one carrying the server's
// own explanation.
//
// POSITIVE EVIDENCE ONLY (see {@link raiseAuthLostFrom}). With `CCRC_AUTH` off
// the gate is a passthrough and no route can produce an auth refusal, so this
// signal can never rise on a dark box — which is the whole dark-by-default
// requirement, held by a mechanism rather than by a promise. A bare 401 from a
// proxy or a stale service worker is not proof of a gate and raises nothing.
//
// This module imports NOTHING from the app (only React and the L0 wire types),
// so `lib/api.ts`, `lib/ws.ts`, `components/Toast.tsx` and the screens can all
// reach it without a cycle. It is also why `GET /api/auth/status` is spelled
// HERE rather than in `lib/api.ts`: it is the one route that must be readable
// while everything else is being refused, and it must never itself raise.
import { useSyncExternalStore } from 'react';
import { isAuthVerdict, type AuthStatus, type AuthVerdict } from '../../../shared/api';

export interface AuthLost {
  /** Is the login screen up? */
  lost: boolean;
  /** WHY the session went — the verdict the server actually sent. `null`
   *  whenever `lost` is false; the two move together and are read as one
   *  snapshot so a render can never see a half-updated pair. */
  verdict: AuthVerdict | null;
}

const LIVE: AuthLost = { lost: false, verdict: null };

let current: AuthLost = LIVE;
const watchers = new Set<() => void>();
const regained = new Set<() => void>();

/** Copied before iterating: a watcher that unsubscribes itself in its own
 *  callback (React does exactly this on unmount) would otherwise mutate the set
 *  mid-loop. */
const announce = (fns: Set<() => void>): void => {
  for (const fn of [...fns]) fn();
};

/** The current snapshot. Stable by identity between changes — `useSyncExternalStore`
 *  requires that, and re-rendering every subscriber on every probe would be a
 *  render storm on a healthy box. */
export function authLost(): AuthLost {
  return current;
}

export function isAuthLost(): boolean {
  return current.lost;
}

/**
 * Raise the signal. FIRST WINS while it is up.
 *
 * The four background reads a cold PWA fires (fleet, accounts, catch-up, feed)
 * all fail together, and the websocket probe lands moments later with the
 * VAGUER answer — `GET /api/auth/status` is deliberately unable to say whether a
 * cookie expired or was never there. Last-wins would let that vaguer answer
 * overwrite the server's own `'expired'`, and the operator would be shown a cold
 * "sign in" instead of "you were signed out": the exact distinction `AuthVerdict`
 * carries two members for.
 *
 * A REFUSED LOGIN ATTEMPT is not this — the login screen keeps its own
 * last-wins refusal state, because "why the session went" and "why that
 * passphrase bounced" are different questions asked at different moments.
 */
export function raiseAuthLost(verdict: AuthVerdict): void {
  if (current.lost) return;
  current = { lost: true, verdict };
  announce(watchers);
}

/**
 * The session is back. Clears the signal AND wakes every socket that parked
 * itself while the gate was shut ({@link onAuthRegained}) — "reconnect the
 * sockets" is not a second step the caller has to remember.
 */
export function clearAuthLost(): void {
  if (!current.lost) return;
  current = LIVE;
  announce(watchers);
  announce(regained);
}

/** Fires when auth comes back — the sockets' cue to try again at once rather
 *  than waiting out a backoff they stopped climbing. Returns an unsubscribe. */
export function onAuthRegained(fn: () => void): () => void {
  regained.add(fn);
  return () => {
    regained.delete(fn);
  };
}

const posture = new Set<() => void>();

/**
 * SUBSCRIBE TO "THE BOX'S POSTURE CHANGED" — the cue for anything standing on
 * screen that describes `GET /api/auth/status` to read it again (D-161).
 *
 * A NUDGE AND NOT A CACHE, deliberately. The fleet screen's passphrase-only
 * notice and the accounts screen's auth section are on screen TOGETHER on
 * desktop (sidebar + detail pane), and the notice's whole design is that it
 * retires by itself the instant a passkey exists rather than carrying a
 * dismiss-state anyone could permanently silence. Enrolment happens in the
 * other component, so something has to tell it. The three alternatives all
 * cost more: a poll spends a GET a minute forever to notice a thing that
 * happens once; a module-level cached snapshot would make one test's posture
 * the next test's initial render (this module's state outlives a `cleanup()`);
 * and lifting the read into a shared parent would couple two screens that have
 * no other reason to know about each other. This carries no state, so there is
 * nothing to leak and nothing to invalidate — every subscriber still reads the
 * route through {@link readAuthStatus}, which stays the one place it is spelled.
 *
 * Returns an unsubscribe.
 */
export function onAuthPostureChanged(fn: () => void): () => void {
  posture.add(fn);
  return () => {
    posture.delete(fn);
  };
}

/** Say the posture changed — called by whoever CHANGED it (enrolled a passkey,
 *  revoked one), not by whoever merely read it. */
export function authPostureChanged(): void {
  announce(posture);
}

function subscribe(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

/** The signal, as a React value. Same snapshot on the server render path —
 *  there is no server render, and a signal that could differ between the two
 *  would tear. */
export function useAuthLost(): AuthLost {
  return useSyncExternalStore(subscribe, authLost, authLost);
}

/** The verdict carried by a refusal body, or `null` if there isn't one. Takes
 *  the BODY rather than the error so this module never imports `lib/api.ts`
 *  (which imports this one). `isAuthVerdict` is the shared predicate — an
 *  untrusted string is narrowed, never asserted. */
export function verdictOf(body: unknown): AuthVerdict | null {
  if (typeof body !== 'object' || body === null) return null;
  const v = (body as { verdict?: unknown }).verdict;
  return isAuthVerdict(v) ? v : null;
}

/**
 * What the 401 branch of `request` calls. Raises ONLY on a body that names a
 * verdict this build knows — the positive-evidence rule the module docstring
 * states, and the reason a dark box can never show a login screen.
 *
 * `'ok'` is refused too: a gate that allowed the request does not send 401, so a
 * 401 claiming `'ok'` is a body this build has no story for, and inventing one
 * would put a login screen in front of an operator with no way to satisfy it.
 */
export function raiseAuthLostFrom(body: unknown): void {
  const verdict = verdictOf(body);
  if (verdict === null || verdict === 'ok') return;
  raiseAuthLost(verdict);
}

/** The one route readable BEFORE login (`server/src/auth/gate.ts`'s EXEMPT
 *  table). Spelled once, here. */
const STATUS_PATH = '/api/auth/status';

/**
 * `GET /api/auth/status` — the box's standing posture, as an anonymous caller
 * sees it (`authed`, `mode`, `passkeysEnrolled`; `Partial` because the server
 * minimizes the body for a caller it does not know).
 *
 * Throws on a non-2xx, which an older server with no such route will give:
 * every caller treats that as "this box has told me nothing", not as a refusal.
 */
export async function readAuthStatus(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<Partial<AuthStatus>> {
  const res = await fetchImpl(STATUS_PATH, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`auth status ${res.status}`);
  return (await res.json()) as Partial<AuthStatus>;
}

/**
 * ASK THE BOX WHY A SOCKET WOULD NOT OPEN. Fire-and-forget.
 *
 * A refused websocket upgrade is a bare 401 on the wire (`gate.ts`: an upgrade's
 * client is parsing a response it expected to be 101, so a JSON body would be
 * noise) — and the browser's `WebSocket` exposes NEITHER the status nor the
 * body, only an `error` and a 1006 close that look exactly like a dropped
 * connection. So the socket cannot tell the two apart by itself, and a client
 * that guesses "network" climbs its backoff ladder against a gate that will
 * never let it in. This is the question that separates them, asked of the one
 * route that answers without a session.
 *
 * Three answers, three actions, and the two "do nothing" arms are as
 * load-bearing as the raise:
 *   - `mode` absent, or `'off'` — the gate is dark (or this server has no gate
 *     at all). Nothing to lose; a login screen here would be unenterable.
 *   - `authed: true` — we ARE signed in; the socket failed for some other
 *     reason. Clears a stale signal (another tab may have logged in).
 *   - otherwise — armed and anonymous. Raise, with the only distinction this
 *     deliberately-minimized body can make: a closed rate-limit window is
 *     `'locked-out'`, everything else is `'no-session'`. `'expired'` never comes
 *     from here — the status route does not publish it — which is exactly why
 *     {@link raiseAuthLost} is first-wins.
 */
export function checkAuth(): void {
  void readAuthStatus()
    .then((s) => {
      if (s.mode === undefined || s.mode === 'off') return;
      if (s.authed === true) {
        clearAuthLost();
        return;
      }
      raiseAuthLost(s.mode === 'locked-out' ? 'locked-out' : 'no-session');
    })
    .catch(() => {
      /* offline, or a server with no such route — silence is the honest answer */
    });
}
