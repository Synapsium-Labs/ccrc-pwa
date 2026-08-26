import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthVerdict } from '../../../shared/api.js';
import { AuthSecretUnusable, readAuthSecret, type AuthSecret } from './secret.js';
import { SESSION_COOKIE, expireCookie, parseCookies } from './cookie.js';
import type { SessionStore } from './sessions.js';

/**
 * THE GATE. One `onRequest` hook stands in front of all 55 routes, the static
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
 * KEYED BY METHOD **AND** PATH, which is not decoration — though the example
 * that used to justify it has since moved, and saying so is the honest version.
 * `/api/runs` was the illustration: a box-token machine lane as a POST, gated as
 * a GET. D-149 made the GET exempt-but-authenticated too, so today BOTH methods
 * of both multi-method paths on this surface (`/api/runs`, `/api/mail`) are in
 * the table. The mechanism is unchanged and still load-bearing, but its argument
 * is now forward-looking rather than illustrated by a live pair:
 *
 * AN EXEMPTION IS A DECISION ABOUT A (METHOD, PATH) PAIR, AND ONLY THAT PAIR.
 * Under a path-only table, `DELETE /api/runs` registered next month would be
 * exempt for free — inheriting a hole nobody decided about, from an entry
 * written for a read. Each of the two `/api/runs` entries carries its own,
 * DIFFERENT reason precisely because they are two different decisions that
 * happen to agree today. `HEAD` is normalised to `GET` by {@link exemptKey} —
 * HEAD is GET without a body, and Fastify auto-exposes one per GET route.
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
 * THE SIX REASONS, and there are only six:
 *
 *  1. `/health` — the liveness probe. `deploy/deploy.sh`'s final gate reads the
 *     shipped sha out of it to decide whether a deploy succeeded, from a shell
 *     with no browser and no session; a gated `/health` makes every deploy fail
 *     the moment the operator arms the flag. It publishes an `ok` and a build
 *     stamp and nothing about the fleet.
 *
 *  2. The SEVENTEEN box-token machine lanes plus `/api/notify` — the fleet
 *     host's ingress. These callers are `curl` inside a Claude Code session and
 *     ccd's `notify.sh`; they have no cookie jar and never will. All eighteen
 *     CHECK the box token (`checkMailToken`), and the mail pair records every
 *     refusal — but "checks" is not "requires" for one of them, and the
 *     difference is worth stating rather than rounding off: the seventeen
 *     coordination lanes refuse every
 *     verdict but `'ok'`, while `/api/notify` still passes `'legacy'` (no token
 *     presented) and `'unconfigured'` (this box was never given one) THROUGH, by
 *     the operator's one-deploy-generation rollout ruling. So `/api/notify` is
 *     the one exempt route that a caller with no credential at all can still
 *     reach on a box mid-rollout. That tolerance has a scheduled removal —
 *     `coord/token.ts:207`, "REMOVE `/api/notify`'S `'legacy'` TOLERANCE ONE
 *     DEPLOY AFTER THIS SHIPS" — and this exemption inherits its lifetime: the
 *     day the tolerance goes, this entry is a plain box-token lane like the
 *     other seventeen. Session-gating it instead is not the fix, because the caller
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
 *  5. `POST /api/auth/passkey/assert/start` and `…/assert/finish` — the passkey
 *     door. Identical in kind to reason 3: these two routes ARE how a passkey
 *     logs in, so gating them makes every enrolled key unusable. Their
 *     credential test is their OWN (`webauthn.ts`: origin, rpIdHash, a
 *     single-use challenge, a monotonic signature counter and an ECDSA
 *     signature over `authData ‖ sha256(clientDataJSON)`), which is a stronger
 *     check than the session gate could make — the gate has no session to look
 *     at yet, which is the point. They spend a SEPARATE, looser rate-limit
 *     budget (`PASSKEY_MAX_FAILURES`), and `assert/start` publishes the
 *     credential ids without which no browser can run the ceremony at all.
 *     The REGISTER pair is deliberately NOT here — see below.
 *
 *  6. `GET /api/runs` — EXEMPT-BUT-AUTHENTICATED, and the newest entry (D-149),
 *     found by the whole-branch review rather than by any task review. It is
 *     reason 3's shape — a route that authenticates for ITSELF because the gate
 *     cannot make the right decision for it — arrived at from the opposite
 *     direction: not "the gate would lock everyone out", but "the gate reads the
 *     wrong credential for one of two callers".
 *
 *     THE LESSON, WHICH IS BIGGER THAN THE ROUTE. This table's entry for
 *     `POST /api/runs` used to end "GET /api/runs is the PWA read and is NOT
 *     here", and that sentence was FALSE one corpus over:
 *     `ccd/coordinator-skill/references/wave-lifecycle.md` makes the GET part of
 *     the pinned protocol, performed cookieless from the fleet host. The sweep
 *     in `auth-gate.test.ts` validated this table against the server's own route
 *     table in both directions and against every `checkMailToken` call site —
 *     and NEVER against consumers outside `server/`. The skills and `ccd/ccrc`
 *     read this HTTP surface too, and a route's "who calls this" is not a fact
 *     the server package can see about itself.
 *
 *     The handler requires a live session OR a valid box token, so the
 *     confidentiality the method-keyed table bought is unchanged.
 *
 * NOT EXEMPT, and worth saying out loud because their absence is a decision:
 *  - `POST /api/auth/logout` — see 3 above.
 *  - `POST /api/auth/passkey/register/start` and `…/register/finish` — ENROLLING
 *    A KEY REQUIRES ALREADY BEING IN. This is the single most load-bearing
 *    exemption decision in Task 8, and it is the one that makes
 *    `attestation: 'none'` safe: an ungated enrol route would let anyone on the
 *    tailnet register their own authenticator and then log in with it forever,
 *    which is not a weakness in the crypto but a door beside it. Behind the
 *    gate, the only caller who can enrol is one who has already proven the
 *    passphrase — so a forged registration is an operator enrolling a key they
 *    control, i.e. exactly what enrolling a key is. (`webauthn.ts`'s module
 *    docstring states the same argument from the crypto side.)
 *  - `POST /api/coord/pause`, `POST /api/runs/:id/abandon` and
 *    `POST /api/claims/:id/break` — `coord/routes.ts` leaves these off the
 *    BOX-TOKEN gate on purpose (D-282 (was D-B4-9): the coordinator holds that token, and a
 *    pause it can lift is not a pause; build 9 D12 applies the same argument to
 *    the claim-break door, the third instance — the sessions that hold claims
 *    hold that token too). That argument is about the box token specifically and
 *    does not transfer: they are the OPERATOR's doors, the operator is the one
 *    holding a session, and a session cookie is precisely the credential the
 *    coordinator does not have. Gating them here strengthens D-282 rather than
 *    reversing it.
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
    'the coordinator opens a run — box-token gated'],
  ['GET /api/runs',
    'EXEMPT-BUT-AUTHENTICATED (D-149), the `GET /api/auth/status` pattern: this route has TWO ' +
    'callers, and the second one has no cookie jar. The coordinator skill reads it COOKIELESS from ' +
    'the fleet host — `wave-lifecycle.md:34` makes "ask GET /api/runs and read the run row\'s own ' +
    'wave" the standing re-orientation after every compaction, and :95/:386 make it the documented ' +
    '`unknown-run` recovery — so a gated one wedges the coordinator out of its own run at exactly ' +
    'the two moments it cannot diagnose itself. The handler requires a live session OR a valid box ' +
    'token (coord/routes.ts), so nothing is published to the tailnet that was published before'],
  ['GET /api/runs/:id/items',
    "EXEMPT-BUT-AUTHENTICATED (D-149's pattern), the same shape as `GET /api/runs` above and for " +
    'the same caller: the coordinator reads its own wave ledger COOKIELESS from the fleet host. ' +
    'It has to — settling the ledger (`POST` on this same path) keys on item IDS, and this route ' +
    'is the only thing that publishes them; `GET /api/runs` carries the tally and no ids. Gated, ' +
    'a coordinator can declare a ledger it can never settle, which is exactly the state one live ' +
    'programme reached. The handler requires a live session OR a valid box token ' +
    '(coord/routes.ts), so nothing is published to the tailnet that was not before'],
  ['GET /api/lifecycle',
    "EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled for this route by build 9 D16), the same " +
    'shape as `GET /api/runs` directly above and for a sharper reason: a WORKER asks this route ' +
    'what happened to its own workspace, cookieless, from the fleet host — and the workspace it ' +
    'is asking about may already be gone, since `_reg_purge` deletes every per-session registry ' +
    'field on ws-rm/ws-reap/ws-gc/forget. Gated, the one surface that outlives a destruction is ' +
    'unreachable from the box that performed it. The handler requires a live session OR a valid ' +
    'box token (coord/routes.ts), so nothing is published to the tailnet that was not before'],
  ['GET /api/peers',
    "EXEMPT-BUT-AUTHENTICATED (D-149's pattern, ruled by build 9 D9): a fleet-host session asks " +
    '"who else is on my project" cookieless — same-project discovery is the feature, and the ' +
    'fleet host has no cookie jar — while the PWA asks with a cookie. The handler requires a ' +
    'live session OR a valid box token (coord/routes.ts), so nothing is published to the ' +
    'tailnet that was not before'],
  ['GET /api/claims',
    "EXEMPT-BUT-AUTHENTICATED (D-149's pattern): the coordinator asks it cookieless before " +
    "splitting work (clause 10), and the PWA's HotFilesStrip reads it with a cookie. The " +
    'handler requires a live session OR a valid box token (coord/routes.ts)'],
  ['POST /api/runs/:id/dispatch',
    'the coordinator dispatches a wave — box-token gated'],
  ['POST /api/runs/:id/close',
    'the coordinator closes a wave — box-token gated'],
  ['POST /api/runs/:id/advance',
    'the coordinator advances a run — box-token gated'],
  ['POST /api/runs/:id/items',
    'the coordinator settles the wave ledger — box-token gated'],
  ['POST /api/claims',
    'a session claims the paths it is about to edit — box-token gated, attribution checked ' +
    'against the registry exactly as the mail ingress checks its sender'],
  ['POST /api/claims/:id/release',
    'the claimant releases on the final merge — box-token gated, same attribution as the claim; ' +
    'the ownership check is the route\'s own, against the live claim table'],
  ['POST /api/ledger/deviations',
    'the coordinator allocates a D-number block at run-open — box-token gated; a session that ' +
    'cannot reach the allocator must not invent a number, so the allocator must be reachable ' +
    'from the fleet host (build 9 D13, the bb47c9e failure)'],
  ['GET /api/ledger',
    "the allocation record and a project's floor, read cookieless from the fleet host — " +
    'box-token gated (requireMailToken), the GET /api/mail convention: no attribution to check'],

  ['POST /api/auth/login',
    'the door — a gate that gated its own login route would be a box nobody can enter'],
  ['POST /api/auth/passkey/assert/start',
    'the passkey door: this route IS how you log in, so gating it would make every enrolled key ' +
    'unusable — the same argument as POST /api/auth/login, and it publishes only the credential ids ' +
    'the ceremony cannot run without. On its own looser rate-limit budget (PASSKEY_MAX_FAILURES)'],
  ['POST /api/auth/passkey/assert/finish',
    'the passkey door, second half — it verifies a signature and mints the session, exactly as the ' +
    'login route verifies a passphrase and mints one. Its OWN checks (origin, rpIdHash, challenge, ' +
    'signCount, signature) are the credential test; the session gate has nothing to check yet'],
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
 *
 * `device` is ATTRIBUTION, never authentication and never an input to `allow`.
 * It is the matched session row's own label — the browser that logged in — and
 * it is `null` on every arm that did not verify a credential, including the two
 * allows that are true for reasons other than a session. NON-OPTIONAL on both
 * arms deliberately: `device?` would let a construction site forget the field,
 * and a reader cannot tell a forgotten field from a measured absence. Its one
 * consumer is `ccdargv.ts`'s `deviceActor`, which turns it into the `--actor` a
 * workspace verb records — which is exactly why it must never widen into a
 * decision: an attacker-controlled user-agent that could change what a route
 * ALLOWS would be a hole, while one that changes what a route RECORDS is the
 * feature (spec D2: `dec` is self-asserted, and `corroboration()` is what
 * catches a lie).
 */
export type GateDecision =
  | { allow: true; verdict: 'ok'; reason: GateAllowReason; device: string | null }
  | { allow: false; verdict: AuthVerdict; reason: 'refused'; device: string | null };

/**
 * THE DENYING DECISION, named — the `SECRET_UNREAD` idiom for the other axis.
 *
 * It exists for one caller: `registerCoordRoutes`' `sessionAuth` parameter
 * defaults to `() => NO_SESSION`, so a composition root that forgets to wire the
 * session layer falls back on the box token rather than on nothing (D-149).
 * Naming it keeps the literal `'no-session'` out of `server/src/coord/`, where
 * `mail-routes.test.ts` scans every quoted kebab token and requires it to be a
 * declared reject code — a guard worth not weakening with an exception.
 */
export const NO_SESSION: GateDecision = { allow: false, verdict: 'no-session', reason: 'refused', device: null };

/** Everything {@link authVerdict} is allowed to consult. All three are VALUES,
 *  already measured by the caller — there is no port here to reach through. */
export interface GateDeps {
  /** `cfg.authEnabled`. False ⇒ the gate is a passthrough (the shipped default). */
  enabled: boolean;
  /** The measured secret ({@link measureSecret}), or {@link SECRET_UNREAD}. */
  secret: SecretState;
  /** The session store. `verifyMeasured` — the method this file actually calls —
   *  is SYNCHRONOUS and does no I/O (`sessions.ts`), which is what lets the
   *  hottest path in the server stay pure. */
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
  if (!deps.enabled) return { allow: true, verdict: 'ok', reason: 'flag-off', device: null };

  const key = exemptKey(req.method, req.routeOptions.url);
  // `reason: 'exempt'`, NEVER `'session'`: this arm returns before the secret or
  // the cookie has been read, so it says nothing at all about who is calling —
  // and `device: null` for the same reason.
  if (key !== null && EXEMPT.has(key)) return { allow: true, verdict: 'ok', reason: 'exempt', device: null };

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
    return { allow: false, verdict: 'unconfigured', reason: 'refused', device: null };
  }

  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  // THE NO-COOKIE ARM. Everything below it knows a cookie WAS presented, and
  // that difference is the whole of D-127 — see the note on the return.
  if (token === undefined || token === '') return { allow: false, verdict: 'no-session', reason: 'refused', device: null };

  const measured = deps.store.verifyMeasured(token, deps.secret.secret.generation, now);
  const verdict = measured.verdict;
  if (verdict === 'ok') return { allow: true, verdict, reason: 'session', device: measured.label };
  /**
   * D-127. A cookie was PRESENTED and matched nothing, so this is `'expired'` —
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
    // A cookie that matched nothing measured no row, so there is no device —
    // and saying so is not the same as saying `''`.
    device: null,
  };
}

/**
 * WHAT THE `Origin` HEADER SAYS. Three states, never a boolean — the two "allow"
 * arms mean genuinely different things and a caller that collapsed them would be
 * unable to log the interesting one.
 *
 * ── THE ATTACK THIS CLOSES (deferred to Task 8 by the Task 5 review) ──
 *
 * CROSS-SITE WEBSOCKET HIJACKING. A page the operator visits can open
 * `new WebSocket('wss://<this-box>.<tailnet>.ts.net/ws/fleet')`, and the browser
 * attaches the session cookie to the handshake. There is no preflight on a
 * WebSocket upgrade and no same-origin policy on the socket that results, so a
 * successful hijack streams the whole fleet — every session, every statusline,
 * every transcript frame — to a page the operator did not write.
 *
 * …AND ITS TWIN, CROSS-SITE REQUEST FORGERY (D-128). The socket was only half
 * the surface, and the half that was left open was the WRITE half. The same
 * same-site page can auto-submit
 * `<form method=POST action="https://<this-box>…/api/fleet/reboot">`, and the
 * cookie rides that too. Three measured facts make it work, none of them
 * obvious:
 *
 *   1. `POST /api/fleet/reboot` (`server.ts`) reads NO body and NO params — it
 *      gates on `fleetMode === 'remote'` plus Hetzner credentials, which is the
 *      live box's standing config. The attacker cannot read the response and
 *      does not need to: the fleet host reboots. The same shape reaches
 *      `/interrupt`, `/ensure`, `/stop`, `/archive`, `/restore`, `/forget` and
 *      `/projects/:project/workspaces`.
 *   2. **THE 415 ESCAPE DOES NOT EXIST.** The comfortable answer — "a form can
 *      only send `application/x-www-form-urlencoded`, `multipart/form-data` or
 *      `text/plain`, and Fastify 415s all three" — is FALSE, measured on this
 *      build: Fastify seeds its content-type parsers with `application/json`
 *      **and `text/plain`**, so `enctype="text/plain"` (CORS-safelisted, no
 *      preflight) parses instead of 415ing. The two others do 415. Routes that
 *      read a body were therefore safe only INCIDENTALLY — a defence nobody
 *      chose and nothing tested.
 *   3. There is no CSRF plugin and no other `preHandler` anywhere in the tree.
 *
 * WHY `SameSite=Lax` STOPS NEITHER, and it is one fact with two consequences.
 * Lax withholds a cookie on CROSS-SITE requests, and "site" means registrable
 * domain. **`ts.net` is on the Public Suffix List**, so the registrable domain
 * of every node on one tailnet is `<tailnet>.ts.net` — which makes
 * `<other-box>.<tailnet>.ts.net` and `<this-box>.<tailnet>.ts.net` SAME-SITE.
 * Lax sends the cookie between them happily. Any page served by any other node
 * on the tailnet — a colleague's dev server, a container someone ran, a
 * compromised device — reaches this box with the operator's credential
 * attached. (`tailscale serve` gives every node an https origin, and the fleet
 * host runs ~11 sessions with their dev servers.) The same public suffix that
 * makes `rpId` dangerous to derive makes `SameSite` insufficient to rely on.
 *
 * An earlier version of this file drew the line at the socket and justified it
 * with "ordinary requests are guarded by `SameSite=Lax` plus every write being a
 * POST" — a sentence contradicted by the paragraph above it, in the same file.
 * That was D-128.
 *
 * ── THE POLICY, AND WHY `'absent'` ALLOWS ──
 *
 * A BROWSER ALWAYS SENDS `Origin` — required of it on a WebSocket handshake
 * (RFC 6455 §4.1) and sent by every current browser on every POST regardless of
 * content type — and it is one of the few headers a page cannot forge. So a
 * MISMATCH is positive evidence of a browser on the wrong page, and it is
 * refused. A sandboxed frame sends the literal string `"null"`, which is a
 * mismatch, not an absence.
 *
 * ABSENCE MEANS NO BROWSER, and refusing it would buy nothing while breaking
 * real callers. A non-browser client (`curl`, a monitoring script, `injectWS` in
 * this repo's own suite) sends no `Origin` and can set any value it likes if
 * required to — so a presence requirement stops nobody who is not already
 * stopped. More to the point, such a client has NO AMBIENT COOKIE JAR: it can
 * only present a session token someone gave it, and a caller who already holds
 * the cookie does not need a cross-site page to use it. The forgery shape needs
 * a browser; the check is aimed at browsers.
 *
 * This is the one place in this file where an ambiguous input does not deny, so
 * it is spelled as its own named state with this paragraph attached, rather than
 * disappearing into an `!== expected` that happens to be true for `undefined`.
 */
export type OriginVerdict = 'ok' | 'absent' | 'mismatch';

/**
 * Compare a request's `Origin` against the box's configured one (`cfg.origin`) —
 * pure, no request object, no clock.
 *
 * WHOLE-STRING EQUALITY: scheme, host AND port. Not `endsWith`, not a hostname
 * comparison, not a prefix — `https://box.example` and
 * `https://box.example.evil.test` share a prefix, and `https://box:8443` and
 * `http://box:8443` differ only in the part that carries the transport
 * guarantee. `cfg.origin` is validated at boot to be a bare serialized origin
 * (`webauthn.ts`'s `originProblem`), which is what makes equality the right
 * comparison rather than a fragile one.
 *
 * DUPLICATE `Origin` HEADERS COMMA-JOIN; THEY DO NOT ARRIVE AS AN ARRAY. An
 * earlier version of this docstring claimed node delivered them as an array and
 * leaned on a `typeof` guard to refuse them — measured on node 24.14.1, both
 * through `app.inject` and through a raw socket, two `Origin:` lines arrive as
 * the single string `"https://a.example, https://b.example"`. That is not equal
 * to any configured origin, so it is refused by the ordinary comparison and the
 * `typeof` guard was dead code testing an input that cannot be constructed. The
 * guard is KEPT — `headers.origin` is typed `string | undefined` but this
 * function takes `unknown`, and a caller handing it something else must not fall
 * through into `===` against a non-string — but it is no longer claimed to be
 * the thing that stops duplicates.
 */
export function originVerdict(origin: unknown, expected: string): OriginVerdict {
  if (origin === undefined || origin === '') return 'absent';
  if (typeof origin !== 'string') return 'mismatch';
  return origin === expected ? 'ok' : 'mismatch';
}

/**
 * Does this request need an origin check? True for every WebSocket upgrade and
 * every STATE-CHANGING request that is not exempt.
 *
 * THE METHOD TEST IS AN ALLOW-LIST OF SAFE VERBS, not a deny-list of unsafe
 * ones: `GET`/`HEAD`/`OPTIONS` are the methods a browser will issue
 * cross-origin without a preflight AND which this server treats as read-only, so
 * they are named and everything else — `POST` today, a `DELETE` or a `PATCH`
 * added next month — is checked by default. Written the other way round, a new
 * verb would ship unguarded.
 *
 * READS ARE NOT CHECKED, and that is deliberate rather than an oversight. A
 * cross-site `GET` cannot be READ by the attacking page (no CORS headers are
 * sent, so the response is opaque), and the socket — which is how the fleet's
 * live state actually leaves this box — is checked unconditionally by the first
 * clause. Checking reads would additionally refuse `<img>`/`<link>` style
 * same-site loads of the SPA shell for no gain.
 *
 * EXEMPT ROUTES ARE SKIPPED, and it costs nothing: the seventeen box-token machine
 * lanes plus `/api/notify` are `curl` inside a Claude Code session (no `Origin`
 * at all, hence `'absent'`, hence permitted even if they were checked), and
 * their real guard is a header a cross-site page cannot add without triggering a
 * preflight it will fail. `POST /api/auth/login` and the two passkey assert
 * routes are the doors: a forged login is not a state change an attacker
 * benefits from, and the assert pair verifies an origin of its own, from inside
 * `clientDataJSON`, against the value RECORDED ON THE CREDENTIAL — a stronger
 * check than this one.
 */
export function needsOriginCheck(method: string, routePath: string | undefined, isWs: boolean): boolean {
  if (isWs) return true;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const key = exemptKey(method, routePath);
  return key === null || !EXEMPT.has(key);
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
  /** `cfg.origin` — the ONE origin a websocket upgrade OR a non-exempt write may
   *  come from. See {@link OriginVerdict} for the two attacks this closes and
   *  {@link needsOriginCheck} for the scope. */
  origin: string;
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
    /**
     * THE ORIGIN CHECK — EVERY UPGRADE AND EVERY NON-EXEMPT WRITE, BEFORE THE
     * CREDENTIAL CHECK.
     *
     * BEFORE, not after, and the order is the whole defence: a cross-site
     * request arrives WITH a perfectly valid cookie (that is what makes it an
     * attack), so a session check running first would ALLOW it and there would
     * be nothing left to refuse. The question "is this page allowed to talk to
     * us" has to be asked before "does this request carry a credential".
     *
     * SCOPE is {@link needsOriginCheck} — see it for why reads and exempt routes
     * are skipped. It was UPGRADES ONLY until D-128, on a justification
     * (`SameSite=Lax` covers the rest) that the module docstring above refutes
     * three paragraphs earlier: on a public-suffix domain every tailnet node is
     * same-site, so Lax sends the cookie to a form POST exactly as it sends it to
     * a handshake.
     *
     * ONLY WHEN THE GATE IS ARMED. With `CCRC_AUTH` off there is no credential to
     * forge with — every route and every socket is already open to anyone who
     * can reach the port, so a cross-site request obtains precisely what a
     * one-line script would. Gating it on the flag keeps the promise the whole
     * slice is built on ("arming the flag is the only thing that changes
     * behaviour").
     *
     * ── THE COST, STATED (D-129) ──
     *
     * THIS REFUSES A PWA LOADED FROM ANY HOST ALIAS THAT IS NOT `CCRC_ORIGIN`.
     * An operator who has armed the flag with `CCRC_ORIGIN=https://mybox.…`
     * and then opens `http://203.0.113.7:7788` (the box's bare address, which
     * serves the same bundle) gets a console whose reads work and whose every write and
     * every socket is refused. That is a real cost and it is the intended one —
     * the box has ONE origin and says so — but it is the shape an operator will
     * meet before they meet an attacker, so the refusal names `CCRC_ORIGIN`
     * explicitly and the journal line says which value was expected. The socket
     * check already carried this cost on a narrower surface since Task 8.
     */
    if (deps.enabled && needsOriginCheck(req.method, req.routeOptions.url, req.ws === true)) {
      const origin = originVerdict(req.headers.origin, deps.origin);
      if (origin === 'mismatch') {
        // The received origin is attacker-chosen text: bounded and quoted before
        // it reaches the journal, so it can neither flood the log nor forge a
        // line. Never logs the cookie or any part of it.
        const what = req.ws === true ? 'websocket upgrade' : `${req.method} request`;
        console.warn(`ccrc-server: refused a ${what} from a foreign origin ` +
          `${JSON.stringify(String(req.headers.origin).slice(0, 120))} — this box accepts only ` +
          `${JSON.stringify(deps.origin)} (CCRC_ORIGIN). If that is wrong, fix the config; if it ` +
          'is right, a page somewhere tried to drive this box with your session.');
        /**
         * 403, NOT 401, AND IT CARRIES NO `verdict`.
         *
         * The credential was fine — this is not "who are you", it is "you may not
         * do that from there", which is what 403 means and 401 does not. The
         * absence of a `verdict` field is the load-bearing half: `lib/api.ts`'s
         * funnel raises the login screen from a 401 body that names an
         * `AuthVerdict` (`raiseAuthLostFrom`), so answering 401-with-a-verdict
         * here would throw a full-screen login in front of an operator whose
         * session is perfectly live — and no passphrase they typed could clear
         * it, because the problem is the URL in the address bar.
         *
         * The upgrade path gets the same code with NO body, for the reason every
         * refused upgrade does: its client is parsing a response it expected to
         * be `101`, so the status line is the whole message.
         */
        if (req.ws === true) return reply.code(403).send();
        return reply.code(403).send({ ok: false, error: 'foreign-origin' });
      }
    }
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
