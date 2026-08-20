import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthVerdict } from '../../../shared/api.js';
import { AuthSecretUnusable, readAuthSecret, type AuthSecret } from './secret.js';
import { SESSION_COOKIE, expireCookie, parseCookies } from './cookie.js';
import type { SessionStore } from './sessions.js';

/**
 * THE GATE. One `onRequest` hook stands in front of all 49 routes, the static
 * wildcard, the SPA fallback and all three websocket upgrades.
 *
 * ONE HOOK, NOT A PER-ROUTE CHECK, and that is the whole design: a route added
 * next month is gated because it exists, not because someone remembered. The
 * complement of that is the {@link EXEMPT} table below — the only way past the
 * gate is to be NAMED in it, with a reason, in a file whose test asserts the set
 * in both directions.
 *
 * IT FAILS SHUT. Every ambiguous state denies: no cookie, an unparseable cookie,
 * a session past its TTL, a session stamped with a superseded generation, an
 * ABSENT passphrase file, a present-but-unreadable one, and — the belt-and-braces
 * case — a caller that armed the flag without measuring the secret at all. The
 * one paid lesson this inverts is `server/src/coord/token.ts`'s D-39: there,
 * `'unconfigured'` was folded into `'ok'`, so a box that had never been given a
 * token answered the same as a box whose token matched, and `/api/mail` ran
 * unauthenticated for every caller. THE SAME MISTAKE, INVERTED, IS THE TRAP HERE:
 * `'unconfigured'` must never mean "let them in". It is spelled as its own arm of
 * {@link authVerdict}'s switch, denying, with this comment beside it.
 *
 * THE VERDICT IS PURE; THE HOOK IS NOT. {@link authVerdict} reads three values it
 * is handed — the flag, an already-MEASURED secret state, and an in-memory
 * session store — plus three fields off the request, and touches no disk, no
 * clock and no `reply`. {@link measureSecret} (the disk) and {@link installGate}
 * (the clock, the `reply`, the socket) are the L4 half. That split is what lets
 * the decision be exercised against a plain object in `auth-gate.test.ts` without
 * a server, and it is why `now` is a parameter here and `Date.now()` appears
 * exactly once, in the hook.
 */

/**
 * EXEMPT — the routes the gate lets through, each with the reason it is here.
 *
 * KEYED BY METHOD **AND** PATH, which is not decoration: `/api/runs` is a
 * box-token machine lane as a POST (the coordinator opens a run) and a PWA read
 * as a GET (the run list on the console). A path-only table would have exempted
 * the GET along with the POST and published every open program to anyone on the
 * tailnet. `HEAD` is normalised to `GET` by {@link exemptKey} — HEAD is GET
 * without a body, and Fastify auto-exposes one per GET route.
 *
 * THE PATH IS THE MATCHED ROUTE, NEVER THE RAW URL (`exemptKey` takes
 * `request.routeOptions.url`, which Fastify fills in with the pattern the router
 * chose — `/api/mail/:id`, not `/api/mail/7?x=1`). A raw-url comparison would be
 * two defects at once: every param route would fall out of the table and start
 * 401ing the fleet's own machine lanes, and — the direction that matters — a
 * crafted url that differs from a table entry only in a query string, a trailing
 * slash or a percent-escape would be judged against a string the router never
 * used to pick the handler. Set membership on the ROUTER's own answer cannot
 * disagree with the handler that is about to run.
 *
 * THE FOUR REASONS, and there are only four:
 *
 *  1. `/health` — the liveness probe. `deploy/deploy.sh`'s final gate reads the
 *     shipped sha out of it to decide whether a deploy succeeded, from a shell
 *     with no browser and no session; a gated `/health` makes every deploy fail
 *     the moment the operator arms the flag. It publishes an `ok` and a build
 *     stamp and nothing about the fleet.
 *
 *  2. The NINE box-token machine lanes plus `/api/notify` — the fleet host's
 *     ingress. These callers are `curl` inside a Claude Code session and ccd's
 *     `notify.sh`; they have no cookie jar and never will. All ten CHECK the box
 *     token (`checkMailToken`), and the mail pair records every refusal — but
 *     "checks" is not "requires" for one of them, and the difference is worth
 *     stating rather than rounding off: the nine coordination lanes refuse every
 *     verdict but `'ok'`, while `/api/notify` still passes `'legacy'` (no token
 *     presented) and `'unconfigured'` (this box was never given one) THROUGH, by
 *     the operator's one-deploy-generation rollout ruling. So `/api/notify` is
 *     the one exempt route that a caller with no credential at all can still
 *     reach on a box mid-rollout. That tolerance has a scheduled removal —
 *     `coord/token.ts:207`, "REMOVE `/api/notify`'S `'legacy'` TOLERANCE ONE
 *     DEPLOY AFTER THIS SHIPS" — and this exemption inherits its lifetime: the
 *     day the tolerance goes, this entry is a plain box-token lane like the
 *     other nine. Session-gating it instead is not the fix, because the caller
 *     genuinely has no cookie; the fix is the removal already scheduled.
 *
 *  3. `POST /api/auth/login` and `GET /api/auth/status` — the door, and the sign
 *     on it. A gate that gated its own login route would be a box nobody can
 *     enter; and the login screen has to know, BEFORE anyone types, whether the
 *     gate is even armed, whether a passkey exists to offer, and whether the
 *     rate-limit window is closed. `status` answers a MINIMIZED body to an
 *     unauthenticated caller (`ANON_VISIBLE`, `server.ts`) — the leak is
 *     enumerated in one place so a field added later cannot widen it silently.
 *     `POST /api/auth/logout` is deliberately NOT here: logging out is something
 *     only a logged-in caller can do.
 *
 *  4. `GET /*` — the static/SPA shell. The login screen has to be able to LOAD;
 *     the client bundle is public and the API is not. `@fastify/static` registers
 *     exactly one wildcard route for the whole of `dist-pwa/`, and every url that
 *     matches no other route lands on it — including the SPA fallback that
 *     `setNotFoundHandler` turns back into `index.html`. It can serve nothing but
 *     files under that directory (the `send` library refuses traversal), i.e.
 *     nothing but the bundle a browser downloads before it has logged in anyway.
 *
 * NOT EXEMPT, and worth saying out loud because their absence is a decision:
 *  - `POST /api/auth/logout` — see 3 above.
 *  - `POST /api/coord/pause` and `POST /api/runs/:id/abandon` — `coord/routes.ts`
 *    leaves these off the BOX-TOKEN gate on purpose (D-B4-9: the coordinator
 *    holds that token, and a pause it can lift is not a pause). That argument is
 *    about the box token specifically and does not transfer: they are the
 *    OPERATOR's doors, the operator is the one holding a session, and a session
 *    cookie is precisely the credential the coordinator does not have. Gating
 *    them here strengthens D-B4-9 rather than reversing it.
 */
export const EXEMPT: ReadonlyMap<string, string> = new Map([
  ['GET /health',
    'the liveness probe deploy.sh reads the shipped sha from — no browser, no session, and a ' +
    'gated one fails every deploy the moment the flag is armed'],

  ['POST /api/notify',
    'ccd notify.sh on the fleet host — checks the box token but still tolerates `legacy`/`unconfigured` ' +
    'for one deploy generation (coord/token.ts:207 schedules the removal); it has no cookie jar either way'],
  ['POST /api/mail',
    'the mail ingress — box-token gated and every refusal recorded (coord/routes.ts check 1)'],
  ['POST /api/mail/:id/ack',
    'a worker acking its own delivery — box-token gated, same check as the ingress'],
  ['GET /api/mail',
    "a session's own outstanding mail — box-token gated (requireMailToken)"],
  ['GET /api/mail/:id',
    'the envelope body channel the nudge points a worker at — box-token gated'],
  ['POST /api/runs',
    'the coordinator opens a run — box-token gated. GET /api/runs is the PWA read and is NOT here'],
  ['POST /api/runs/:id/dispatch',
    'the coordinator dispatches a wave — box-token gated'],
  ['POST /api/runs/:id/close',
    'the coordinator closes a wave — box-token gated'],
  ['POST /api/runs/:id/advance',
    'the coordinator advances a run — box-token gated'],
  ['POST /api/runs/:id/items',
    'the coordinator settles the wave ledger — box-token gated'],

  ['POST /api/auth/login',
    'the door — a gate that gated its own login route would be a box nobody can enter'],
  ['GET /api/auth/status',
    'the sign on the door: the login screen must know, before anyone types, whether the gate is armed, ' +
    'whether a passkey exists to offer, and whether the rate-limit window is closed. An unauthenticated ' +
    'caller gets a MINIMIZED body (ANON_VISIBLE, server.ts) — the leak is enumerated, not incidental'],

  ['GET /*',
    'the static/SPA shell: the login screen must be able to load. @fastify/static serves only ' +
    'dist-pwa/, i.e. the public client bundle; the API behind it is not exempt',
  ],
]);

/**
 * The exempt-table key for one request, or `null` when the router matched no
 * route at all.
 *
 * `routePath` is `request.routeOptions.url` — `undefined` exactly when
 * `request.is404` is true, which on a box with no `dist-pwa/` (API-only mode, no
 * static plugin, no `/*` route) is every unmatched url. `null` is NOT a key, so
 * such a request is gated: a 401 rather than a 404 tells an unauthenticated
 * caller less, not more.
 */
export function exemptKey(method: string, routePath: string | undefined): string | null {
  if (routePath === undefined) return null;
  return `${method === 'HEAD' ? 'GET' : method} ${routePath}`;
}

/** Exactly what the decision reads off a request — a structural subset of
 *  `FastifyRequest`, so `authVerdict` can be exercised against a plain object and
 *  so nothing about `reply`, the socket or the body is in reach of it. */
export interface GateRequest {
  method: string;
  routeOptions: { url: string | undefined };
  headers: { cookie?: string | undefined };
}

/**
 * The MEASURED state of `cfg.authSecretPath`, as of one request — the disk read
 * already done, so {@link authVerdict} can stay pure.
 *
 * FOUR STATES, NOT A NULLABLE SECRET (`CLAUDE.md`'s "no overloaded null at a
 * seam"). `'absent'` and `'unusable'` deny identically TODAY, but they are
 * different facts about the box — one is "no passphrase was ever set", the other
 * is "there is a passphrase here and this process cannot read it" — and
 * `secret.ts` went to some length to keep them apart; collapsing them at this
 * seam would throw that away in the one file that most needs it. `'unread'` is
 * the state a caller is in before anything was measured, and it exists so that
 * "nobody looked" can DENY rather than borrow the meaning of some other value.
 */
export type SecretState =
  | { kind: 'unread' }
  | { kind: 'absent' }
  | { kind: 'unusable'; detail: string }
  | { kind: 'ok'; secret: AuthSecret };

/** The `'unread'` singleton — the value the hook passes when the flag is OFF and
 *  no disk was touched. Named so a reader can see at the call site that nothing
 *  was measured, rather than inferring it from an empty object. */
export const SECRET_UNREAD: SecretState = { kind: 'unread' };

/**
 * Read `path` and say what is there. THE L3 HALF — the one function in this file
 * that touches a disk, split out so {@link authVerdict} does not.
 *
 * NEVER THROWS, where `readAuthSecret` does: at BOOT a garbled secret must kill
 * the process (`secret.ts`'s stated contract, and `buildServer` calls
 * `readAuthSecret` directly for exactly that), but at REQUEST time — the file was
 * chmod'ed or truncated while the server ran — an uncaught throw inside the
 * `onRequest` hook is a 500, and a 500 is not a refusal: it is an error page on a
 * path that must answer 401. So the throw becomes `'unusable'`, which denies.
 *
 * ONE READ PER GATED REQUEST, and that is deliberate rather than unnoticed. The
 * generation this returns is what makes `ccrc passwd` invalidate every live
 * session "at once, with no restart and no file rewrite" (`sessions.ts`) — cache
 * it at boot and a rotated passphrase leaves every stolen cookie working until
 * someone restarts the service. The file is ~150 bytes and warm in the page
 * cache; the routes behind this gate already do far more I/O than one `readFileSync`.
 */
export function measureSecret(path: string): SecretState {
  try {
    const secret = readAuthSecret(path);
    return secret === null ? { kind: 'absent' } : { kind: 'ok', secret };
  } catch (err) {
    if (err instanceof AuthSecretUnusable) return { kind: 'unusable', detail: err.message };
    // Not ours: `readAuthSecret` throws exactly one type. Anything else is a
    // programming error and must not be swallowed into a verdict.
    throw err;
  }
}

/**
 * WHY the gate allowed a request. Three genuinely different facts, and a caller
 * that treats them as one is the "no overloaded null at a seam" rule
 * (`CLAUDE.md`) broken in the file that can least afford it:
 *
 *  - `'flag-off'` — the gate is dark. NOTHING was checked: no secret was read,
 *    no cookie was parsed. Everyone is through, which is the pre-slice
 *    behaviour and the shipped default.
 *  - `'exempt'`   — this route is named in {@link EXEMPT}. Also nothing was
 *    checked, and for the same reason it must not be mistaken for the next one:
 *    on an exempt route the caller is ANONYMOUS unless something else proves
 *    otherwise, INCLUDING on a box whose secret is `'absent'`.
 *  - `'session'`  — and only this one — means a credential was presented and
 *    verified.
 *
 * `GET /api/auth/status` is why this is load-bearing rather than tidy: it is an
 * exempt route that publishes `authed`, and reading that field off `allow` would
 * tell every anonymous browser it was signed in. `server.ts` computes it from
 * `reason === 'session'`, and `auth-routes.test.ts` reds if that ever regresses.
 */
export type GateAllowReason = 'flag-off' | 'exempt' | 'session';

/**
 * What the gate decided, and why — a discriminated union, so `allow: true`
 * cannot be read without also being handed the reason it is true.
 *
 * `verdict` rides onto the 401 body so the PWA can pick a sentence — "you were
 * signed out" (`'expired'`) reads differently from a cold login screen
 * (`'no-session'`) and from "run `ccrc passwd`" (`'unconfigured'`); that
 * distinction is the entire reason `AuthVerdict` is a union and not a boolean
 * (`shared/api.ts`).
 */
export type GateDecision =
  | { allow: true; verdict: 'ok'; reason: GateAllowReason }
  | { allow: false; verdict: AuthVerdict; reason: 'refused' };

/** Everything {@link authVerdict} is allowed to consult. All three are VALUES,
 *  already measured by the caller — there is no port here to reach through. */
export interface GateDeps {
  /** `cfg.authEnabled`. False ⇒ the gate is a passthrough (the shipped default). */
  enabled: boolean;
  /** The measured secret ({@link measureSecret}), or {@link SECRET_UNREAD}. */
  secret: SecretState;
  /** The session store. `verify` is SYNCHRONOUS and does no I/O (`sessions.ts`),
   *  which is what lets the hottest path in the server stay pure. */
  store: SessionStore;
}

/**
 * THE DECISION. Pure: no `fs`, no `reply`, no clock (`now` is a parameter), no
 * timers.
 *
 * The order of the arms IS the design, and each one is a deny except the two that
 * are not:
 *
 *  1. flag off  → ALLOW. The shipped default and the pre-slice behaviour, decided
 *     before anything else is read so a box with the gate dark pays nothing and
 *     behaves exactly as it did.
 *  2. exempt    → ALLOW, by NAME, from {@link EXEMPT} — see that table's reasons.
 *  3. no usable secret (`'unread'`/`'absent'`/`'unusable'`) → DENY
 *     `'unconfigured'`. **THE D-39 INVERSION.** An absent passphrase file with
 *     the flag armed is a MISCONFIGURED box, not an open one; folding it into
 *     `'ok'` is precisely the defect that ran `/api/mail` unauthenticated, and it
 *     is spelled here as its own denying arm so that deleting it is a visible
 *     act. `'unread'` denies for the belt-and-braces version of the same rule: a
 *     caller that armed the flag and measured nothing gets refused, never admitted.
 *  4. no cookie → DENY `'no-session'`. The ordinary first visit.
 *  5. otherwise the store's own verdict, and ONLY `'ok'` allows — written as a
 *     positive test rather than as `!== 'no-session'` or a truthiness check, so a
 *     seventh `AuthVerdict` added tomorrow denies by default instead of falling
 *     through into the open branch.
 */
export function authVerdict(req: GateRequest, deps: GateDeps, now: number): GateDecision {
  if (!deps.enabled) return { allow: true, verdict: 'ok', reason: 'flag-off' };

  const key = exemptKey(req.method, req.routeOptions.url);
  // `reason: 'exempt'`, NEVER `'session'`: this arm returns before the secret or
  // the cookie has been read, so it says nothing at all about who is calling.
  if (key !== null && EXEMPT.has(key)) return { allow: true, verdict: 'ok', reason: 'exempt' };

  return sessionVerdict(req, deps, now);
}

/**
 * THE CREDENTIAL QUESTION, on its own: does this request carry a live session?
 *
 * Arms 3–5 of {@link authVerdict}, split out because ONE caller needs to ask it
 * without the two shortcuts above — `GET /api/auth/status`, which is EXEMPT and
 * still has to report `authed` honestly. Calling `authVerdict` there would get
 * `allow: true, reason: 'exempt'` for an anonymous browser and, if that were
 * read as authentication, would tell it that it was signed in — most loudly on a
 * box whose secret is `'absent'`, the exact state the D-39 arm exists to refuse.
 *
 * Never returns `reason: 'exempt'` or `'flag-off'`: those are not answers to
 * this question, which is why they live one level up.
 */
export function sessionVerdict(req: GateRequest, deps: GateDeps, now: number): GateDecision {
  if (deps.secret.kind !== 'ok') {
    // D-39, inverted. Do not turn this into an allow. See the module docstring.
    return { allow: false, verdict: 'unconfigured', reason: 'refused' };
  }

  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  // THE NO-COOKIE ARM. Everything below it knows a cookie WAS presented, and
  // that difference is the whole of D-114 — see the note on the return.
  if (token === undefined || token === '') return { allow: false, verdict: 'no-session', reason: 'refused' };

  const verdict = deps.store.verify(token, deps.secret.secret.generation, now);
  if (verdict === 'ok') return { allow: true, verdict, reason: 'session' };
  /**
   * D-114. A cookie was PRESENTED and matched nothing, so this is `'expired'` —
   * NOT the `'no-session'` the store answered.
   *
   * `SessionStore.verify` returns `'no-session'` for an unmatched hash and it is
   * right to: it only ever sees a presented token, so it cannot know whether the
   * caller had a cookie at all. THIS function knows — it read the header six
   * lines up — and collapsing its two facts into the store's one is the
   * "no overloaded null at a seam" rule (`CLAUDE.md`) broken in the file that can
   * least afford it. The two conditions a caller handles differently: no cookie
   * means the operator never had a session ("Sign in to reach this box"); a
   * cookie that matches nothing means the row lapsed and the five-minute sweep
   * reclaimed it ("You were signed out"). `pwa/src/components/LoginScreen.tsx`
   * renders a different sentence for each, and a test there pins that they
   * differ — under the conflation the server simply never sent the second one.
   *
   * NOT COSMETIC: THE CONFLATION MADE THE EXPIRE-COOKIE GUARD INERT in the case
   * it was written for. `installGate` sheds a dead cookie only on `'expired'`,
   * because a browser holding one has no other way to drop it (logout is gated,
   * the cookie is HttpOnly). A row past its idle TTL answers `'expired'` only in
   * the window between lapsing and the sweep DELETING it — and the browser is
   * idle by definition in that window, so in practice it returns after the sweep,
   * hit this arm, and kept presenting a dead cookie for the rest of its 30-day
   * `Max-Age`. Only the `ccrc passwd` generation bump fired the guard reliably
   * (`sweep()` ignores generation, so those rows survive to be matched).
   *
   * THIS REVEALS NOTHING AND REMOVES AN ORACLE. The answer is now a pure function
   * of the caller's own request — did you send a cookie or not — and says nothing
   * about the box or about whether that token was ever real. Before, an attacker
   * could tell "this token never existed" (`'no-session'`) from "this token
   * existed and is dead" (`'expired'`); uniform `'expired'` deletes that
   * distinguisher. A malformed cookie lands here too and is called "signed out",
   * which is mildly imprecise and far cheaper than the alternative.
   *
   * The ternary, not a bare `'expired'`: `'expired'` from the store (a stale
   * generation, or a TTL lapse caught before the sweep) is already the right
   * answer and is passed through unchanged, and any FUTURE verdict `verify`
   * learns to return must not be overwritten by this one.
   */
  return {
    allow: false,
    verdict: verdict === 'no-session' ? 'expired' : verdict,
    reason: 'refused',
  };
}

/** What {@link installGate} needs from the composition root. Deliberately NOT the
 *  server's whole `Deps`: the gate reads a flag, a path and a store, and a
 *  narrower parameter is a narrower blast radius. */
export interface InstallGateDeps {
  enabled: boolean;
  secretPath: string;
  store: SessionStore;
  /** `cfg.cookieSecure` — needed only so an `'expired'` refusal can hand back a
   *  matching expiry line (see {@link installGate}). */
  cookieSecure: boolean;
}

/**
 * THE ONE HOOK. Added unconditionally — the flag is checked INSIDE
 * {@link authVerdict}, not around this call — so there is exactly one place in
 * the tree where "is this request allowed" is decided, and `auth-gate.test.ts`'s
 * sweep is measuring the same hook in both flag positions.
 *
 * WHY `onRequest` AND NOT `preHandler`: `onRequest` is the first lifecycle stage
 * after routing, which is early enough that a refusal costs no body parsing, no
 * multipart consumption and no `preValidation`, and late enough that
 * `request.routeOptions.url` is already filled in with the route the router
 * chose. Both halves matter — the exempt check needs the matched route, and a
 * gate that ran after the body was read would have let an unauthenticated caller
 * push 25 MiB through `@fastify/multipart` before being told no.
 *
 * WEBSOCKETS NEED NO SPECIAL CASE, which is the happy accident this whole shape
 * rests on: `@fastify/websocket` dispatches the HTTP upgrade through normal
 * Fastify routing (its `onUpgrade` calls `fastify.routing`), so all three
 * `/ws/*` routes reach this hook as ordinary GETs with `request.ws === true`,
 * and replying 401 here short-circuits before any socket is handed to `ws`.
 * The only difference is the BODY: an upgrade's client is parsing an HTTP
 * response it expected to be `101`, so it gets a bare 401 with no JSON — the
 * status line is the whole message. `injectWS` surfaces it as
 * `Unexpected server response: 401`, which is what `auth-gate.test.ts` asserts.
 */
export function installGate(app: FastifyInstance, deps: InstallGateDeps): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // The ternary is a COST gate, not a decision gate, and it is fail-safe by
    // construction: measuring when the flag is off would only waste a read, and
    // NOT measuring when it is on yields `'unread'`, which `authVerdict` denies.
    // Neither mistake can open the gate. (The flag is still decided in exactly
    // one place — `authVerdict`'s first line.)
    const secret = deps.enabled ? measureSecret(deps.secretPath) : SECRET_UNREAD;
    const decision = authVerdict(req, { enabled: deps.enabled, secret, store: deps.store }, Date.now());
    if (decision.allow) return;
    // A DEAD token is swept out of the jar on the way past. `'expired'` is the
    // one verdict where the browser is holding something the server has already
    // written off — a session past its TTL, or one stamped with a generation
    // `ccrc passwd` has since bumped — and it would otherwise sit there for the
    // rest of its 30-day `Max-Age` being presented on every request: `POST
    // /api/auth/logout` is gated, so there is no in-app way to shed it, and the
    // login screen cannot clear an `HttpOnly` cookie from script. Attached on
    // the socket path too: it costs one header, and a rejected upgrade is
    // exactly where a phone that has been asleep for a week finds out.
    if (decision.verdict === 'expired') {
      reply.header('set-cookie', expireCookie(SESSION_COOKIE, { secure: deps.cookieSecure }));
    }
    // A bare 401 on an upgrade; JSON on an ordinary request. The upgrade's client
    // is parsing an HTTP response it expected to be 101 — the status line is the
    // whole message, and a JSON body it will never read is noise on a socket that
    // is about to close. Never logs the cookie, the token, or any part of either
    // — the rule `server.ts:443-446` states for the box token applies with more
    // force to a bearer session.
    if (req.ws === true) return reply.code(401).send();
    return reply.code(401).send({ ok: false, error: 'unauthenticated', verdict: decision.verdict });
  });
}
