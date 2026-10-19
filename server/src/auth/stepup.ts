import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StepUpAnswer, StepUpStart } from '../../../shared/api.js';
import { STEP_UP_FRESH_MS, isStepUpFresh, stepUpFreshUntil } from '../../../shared/accounts.js';
import { refuseRoute } from '../refuse.js';
import { actorOf, type AccountAudit } from '../accounts/audit.js';
import { parseCookies, SESSION_COOKIE } from './cookie.js';
import type { PasskeyStore } from './credentials.js';
import type { SecretState } from './gate.js';
import { StepUpRateLimiter } from './ratelimit.js';
import { verifyPassphrase } from './secret.js';
import { sessionIdHash, type SessionStore } from './sessions.js';
import { ChallengeStore, verifyAssertion } from './webauthn.js';

/**
 * STEP-UP THAT KEEPS THE SESSION (D-5512; spec §3.2; plan Task A5).
 *
 * Every act that puts, replaces or deletes a credential needs a step-up from the last five minutes on the
 * SAME session. The login doors cannot serve: each mints a new session, which would change the session's
 * `idHash` mid-flow (breaking the same-session check of a sign-in attempt, spec §3.7), leave a live session
 * row per step-up, and spend the login lockout budget. So step-up has its own three routes, registered in
 * `server.ts` (where `auth-gate.test.ts`'s sweep reads them) and handled here:
 *
 *   POST /api/auth/step-up/start       the passkey ceremony's challenge, bound to the requesting session
 *   POST /api/auth/step-up/finish      the assertion; stamps `assertedAt` on the requesting session
 *   POST /api/auth/step-up/passphrase  the fallback on a box with no passkey; the same stamp
 *
 * WHAT THEY DO NOT DO is the design: no session is minted, no cookie is set, nothing is rotated, and the
 * session keeps its `generation`. `SessionRecord.assertedAt` is the only change.
 *
 * THE WALLS, in the order a request meets them:
 *  - The session gate (`gate.ts`). None of the three is in `EXEMPT`, so on an armed gate a caller with no live
 *    session cookie, a box-token holder included, gets the gate's own 401 before any handler runs.
 *  - A dark gate answers `auth-off` (501, the status the other auth routes answer dark): there is no session to
 *    step up.
 *  - The per-session budget (`StepUpRateLimiter`): `step-up-locked` once spent, until the session ends or the
 *    operator signs in again; another session keeps its own. Never `LoginRateLimiter`.
 *  - The passphrase arm is refused `passkey-enrolled` whenever a passkey is enrolled, so a stolen session cannot
 *    step down to the weaker factor.
 *  - `Cache-Control: no-store` on every answer, refusals included (spec §3.3): {@link StepUp.noStore} is an
 *    `onSend` hook, so it also reaches the gate's 401, which is sent before any handler runs.
 *
 * A FAILED ATTEMPT (D-5618) answers `step-up-required` with `verdict: 'wrong'`, at 403 and never 401: the caller's
 * session is live, and a 401 with a verdict raises the PWA's login screen over it (`lib/api.ts`'s funnel). The
 * journal gets the reason; the wire gets one shape for every failure, as on the passkey door.
 *
 * L4 delivery: the decisions are `isStepUpFresh` (`shared/accounts.ts`, L1-pure), `verifyAssertion`
 * (`webauthn.ts`, pure) and the limiter's counts. Logs name the route and the session's first 8 hex only.
 */

/** Every step-up route lives under this prefix, and {@link StepUp.noStore} keys on it. */
export const STEP_UP_PATH_PREFIX = '/api/auth/step-up/';

/** What a lock reports to its one listener: the session, and the device label its row carries. The
 *  `step-up-locked` audit row is written beside it, through {@link StepUpDeps.audit} (A7). */
export interface StepUpLockedEvent {
  idHash: string;
  device: string | null;
}

export interface StepUpDeps {
  /** `cfg.authEnabled`. Dark ⇒ every route answers `auth-off`. */
  enabled: boolean;
  /** The server's one session store, loaded at boot (`server.ts`). */
  store: SessionStore;
  /** The enrolled passkeys, loaded at boot. */
  passkeys: PasskeyStore;
  /** The measured passphrase secret, now (`server.ts`'s `secretNow`). */
  secretNow: () => SecretState;
  /** The box's relying-party problem, or `null` when passkeys work (`server.ts`'s `rpProblem`). */
  rpProblem: () => string | null;
  /** `cfg.rpId`, echoed to the ceremony. */
  rpId: string;
  /** The device label of the session presenting `req` (the gate's `device`), for {@link onStepUpLocked}. */
  device: (req: FastifyRequest) => string | null;
  /** Called once, when a session's step-up budget is spent. */
  onStepUpLocked?: (event: StepUpLockedEvent) => void;
  /** The account audit (D-5516, A7): the lock writes one `step-up-locked` row, with no lane, through it. */
  audit?: Pick<AccountAudit, 'write'>;
  /** The node-id the fleet stands at for that row, or `null` when it is not known (`knownFleetIdentity`). */
  fleetIdentity?: () => string | null;
  /** The clock. A parameter so a test can stand at the window's edge. */
  now?: () => number;
  /** The budget. Built here when absent; a parameter for tests. */
  limiter?: StepUpRateLimiter;
}

export interface StepUp {
  start: (req: FastifyRequest, reply: FastifyReply) => Promise<StepUpStart | void>;
  finish: (req: FastifyRequest, reply: FastifyReply) => Promise<StepUpAnswer | void>;
  passphrase: (req: FastifyRequest, reply: FastifyReply) => Promise<StepUpAnswer | void>;
  /** The `onSend` hook: `Cache-Control: no-store` on every answer under {@link STEP_UP_PATH_PREFIX}. */
  noStore: (req: FastifyRequest, reply: FastifyReply, payload: unknown) => Promise<unknown>;
  /**
   * THE GUARD every step-up-gated act calls (A17 onward): `true` when it has refused the request with
   * `step-up-required` (the handler stops), `false` when this session stepped up within the last `ms`.
   * Default five minutes, from `shared/accounts.ts`.
   */
  requireRecentAssertion: (ms?: number) => (req: Pick<FastifyRequest, 'headers'>, reply: FastifyReply) => boolean;
  /** The ONE reader `GET /api/accounts` carries as `connect.stepUpFreshUntil` (A12): the first instant this
   *  session's step-up is no longer fresh, or `null` when it never stepped up. */
  stepUpFreshUntil: (req: Pick<FastifyRequest, 'headers'>) => number | null;
}

/** The requesting session's `idHash`, from its cookie; `null` with no cookie. Whether the session is LIVE is the
 *  gate's question, answered before any handler runs; the store is asked again only for the row. */
const requesterIdHash = (req: Pick<FastifyRequest, 'headers'>): string | null => {
  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  return token === undefined || token === '' ? null : sessionIdHash(token);
};

export function createStepUp(deps: StepUpDeps): StepUp {
  const now = deps.now ?? Date.now;
  const limiter = deps.limiter ?? new StepUpRateLimiter();
  // The THIRD challenge store: a step-up challenge never satisfies a login, nor a login challenge a step-up.
  const challenges = new ChallengeStore('step-up');

  /** A dark gate, refused. `true` when answered. */
  const dark = (reply: FastifyReply): boolean => {
    if (deps.enabled) return false;
    void refuseRoute(reply, 'auth-off');
    return true;
  };

  /** One failed attempt: counted against THIS session, the lock reported once, and one wire shape. */
  const failed = (req: FastifyRequest, reply: FastifyReply, idHash: string, why: string): FastifyReply => {
    console.warn(`ccrc-server: step-up refused for session ${idHash.slice(0, 8)} (${why})`);
    if (limiter.fail(idHash)) {
      console.warn(`ccrc-server: step-up-locked for session ${idHash.slice(0, 8)}`);
      const device = deps.device(req);
      // THE AUDIT ROW (D-5512, D-5516): the lock is an account-security fact, recorded with the session's actor and
      // no lane. The row's answer is not awaited for anything: the refusal below is sent either way.
      deps.audit?.write({
        act: 'step-up-locked', laneId: null, provider: null, outcome: 'refused', code: 'step-up-locked',
        fleetIdentity: deps.fleetIdentity?.() ?? null, actor: actorOf(device, idHash),
      });
      deps.onStepUpLocked?.({ idHash, device });
    }
    return refuseRoute(reply, 'step-up-required', { verdict: 'wrong' });
  };

  /** The stamp, and the answer carrying it. */
  const stamped = async (reply: FastifyReply, idHash: string, at: number): Promise<StepUpAnswer | void> => {
    limiter.succeed(idHash);
    // The session ended between the gate and here: nothing to stamp, and nothing proven for anyone.
    if (!(await deps.store.stampAsserted(idHash, at))) return void refuseRoute(reply, 'step-up-required');
    return { ok: true, stepUpFreshUntil: stepUpFreshUntil(at) };
  };

  const start: StepUp['start'] = async (req, reply) => {
    if (dark(reply)) return;
    const problem = deps.rpProblem();
    if (problem !== null) return void refuseRoute(reply, 'not-configured');
    const idHash = requesterIdHash(req);
    if (idHash === null) return void refuseRoute(reply, 'step-up-required');
    if (limiter.isLocked(idHash)) return void refuseRoute(reply, 'step-up-locked');
    return {
      challengeB64url: challenges.issue(now(), idHash),
      rpId: deps.rpId,
      allowCredentialIdsB64url: deps.passkeys.ids(),
    };
  };

  const finish: StepUp['finish'] = async (req, reply) => {
    if (dark(reply)) return;
    if (deps.rpProblem() !== null) return void refuseRoute(reply, 'not-configured');
    const idHash = requesterIdHash(req);
    if (idHash === null) return void refuseRoute(reply, 'step-up-required');
    const slot = limiter.reserve(idHash);
    if (!slot.ok) return void refuseRoute(reply, slot.reason === 'locked' ? 'step-up-locked' : 'rate-limited');
    try {
      const at = now();
      const body = (req.body ?? {}) as Record<string, unknown>;
      const credentialId = body['credentialIdB64url'];
      const cred = typeof credentialId === 'string' && credentialId !== '' ? deps.passkeys.find(credentialId) : undefined;
      if (cred === undefined) return void failed(req, reply, idHash, 'unknown-credential');
      const result = verifyAssertion({
        credentialIdB64url: credentialId,
        authenticatorDataB64url: body['authenticatorDataB64url'],
        clientDataJsonB64url: body['clientDataJsonB64url'],
        signatureB64url: body['signatureB64url'],
      }, cred, challenges, at, idHash);
      if (!result.ok) return void failed(req, reply, idHash, result.reason);
      // The counter advances before the stamp, as on the login door.
      await deps.passkeys.recordUse(cred.credentialId, result.signCount, at);
      return await stamped(reply, idHash, at);
    } finally {
      slot.release();
    }
  };

  const passphrase: StepUp['passphrase'] = async (req, reply) => {
    if (dark(reply)) return;
    const idHash = requesterIdHash(req);
    if (idHash === null) return void refuseRoute(reply, 'step-up-required');
    if (limiter.isLocked(idHash)) return void refuseRoute(reply, 'step-up-locked');
    // NO STEP-DOWN. An enrolled passkey refuses the weaker factor; a passkey file this process cannot read is
    // not "no passkey", and refuses too (`unmeasured`), so an unreadable store cannot open the passphrase arm.
    const state = deps.passkeys.loadState();
    if (state !== 'ok' && state !== 'absent') return void refuseRoute(reply, 'unmeasured');
    if (deps.passkeys.count() > 0) return void refuseRoute(reply, 'passkey-enrolled');
    const slot = limiter.reserve(idHash);
    if (!slot.ok) return void refuseRoute(reply, slot.reason === 'locked' ? 'step-up-locked' : 'rate-limited');
    try {
      const body = (req.body ?? {}) as { passphrase?: unknown };
      if (typeof body.passphrase !== 'string' || body.passphrase === '') return void refuseRoute(reply, 'bad-request');
      const measured = deps.secretNow();
      // The gate refuses an armed box with no usable secret before this runs; stated anyway, denying.
      if (measured.kind !== 'ok') return void refuseRoute(reply, 'step-up-required');
      if (!(await verifyPassphrase(measured.secret, body.passphrase))) return void failed(req, reply, idHash, 'wrong passphrase');
      return await stamped(reply, idHash, now());
    } finally {
      slot.release();
    }
  };

  const noStore: StepUp['noStore'] = async (req, reply, payload) => {
    // Keyed on the ROUTE fastify matched, not only the raw URL: the router decodes percent-escapes, so
    // `/api/auth/step%2Dup/passphrase` reaches the passphrase handler (and the gate's 401) while its raw URL
    // does not start with the prefix. The raw path is kept for answers no route matched (the 404s).
    const routed = req.routeOptions.url;
    const pathOnly = req.url.split('?', 1)[0] ?? '';
    if ((routed !== undefined && routed.startsWith(STEP_UP_PATH_PREFIX)) || pathOnly.startsWith(STEP_UP_PATH_PREFIX)) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  };

  const requireRecentAssertion: StepUp['requireRecentAssertion'] = (ms = STEP_UP_FRESH_MS) => (req, reply) => {
    const idHash = requesterIdHash(req);
    const assertedAt = idHash === null ? undefined : deps.store.assertedAtOf(idHash);
    if (isStepUpFresh(assertedAt, now(), ms)) return false;
    void refuseRoute(reply, 'step-up-required');
    return true;
  };

  const freshUntil: StepUp['stepUpFreshUntil'] = (req) => {
    const idHash = requesterIdHash(req);
    const assertedAt = idHash === null ? undefined : deps.store.assertedAtOf(idHash);
    return assertedAt === undefined ? null : stepUpFreshUntil(assertedAt);
  };

  return { start, finish, passphrase, noStore, requireRecentAssertion, stepUpFreshUntil: freshUntil };
}
