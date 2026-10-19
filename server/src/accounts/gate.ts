import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AccountOriginClass } from '../../../shared/api.js';
import { refuseRoute } from '../refuse.js';
import type { GateDecision } from '../auth/gate.js';
import { parseCookies, SESSION_COOKIE } from '../auth/cookie.js';
import { sessionIdHash } from '../auth/sessions.js';
import type { StepUp } from '../auth/stepup.js';
import { capSupported } from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import { actorOf, type AccountActor } from './audit.js';

/**
 * THE ACCOUNT GATE (D-5511; spec §3.2, §13; plan Task A7): the ONE chokepoint every account route calls first,
 * before it reads a body or asks the fleet anything. It is not the server's session gate (`auth/gate.ts`'s
 * `installGate`), which runs before it on every request; it restates the session question on its own, so an
 * account route that some day lands in `EXEMPT`, or a session gate that some day lets something through, still
 * refuses here.
 *
 * It refuses, IN THIS ORDER, and the order is the design:
 *  1. A dark gate → `auth-off`. No exception, loopback included: the default bind is loopback and the default origin
 *     `http://localhost:<port>`, so every dark box looks like loopback whichever of the two you read; in local fleet
 *     mode sessions share loopback with the server; and `installGate` skips the origin check while dark.
 *  2. A plain-HTTP `cfg.origin` on a host that is not loopback → `insecure-origin`. Derived from `cfg.origin` ONLY,
 *     never from `Host`, `cfg.host` or `X-Forwarded-*`, all of which a request (or a proxy's config) chooses.
 *  3. Any verdict but `session` → 401 `unauthenticated`. A box token is never one: this file does not read it.
 *  4. The route's cap word absent from the fleet's measured `ccd caps` → `501 unsupported`, with the refusing
 *     no-evidence polarity (`capSupported`: an unmeasured fleet state refuses).
 *  5. When the route asks, no step-up from the last five minutes on this session → `step-up-required` (D-5512,
 *     A5's `requireRecentAssertion`).
 *
 * `Cache-Control: no-store` is set FIRST, so every answer of a gated route carries it, each refusal included.
 *
 * L4 delivery: the decisions are `accountOriginClass` (pure), the session verdict the caller measured, and
 * `capSupported`. A pass hands back the act's actor, minted from what the gate verified (`audit.ts`).
 */

/** What the gate reads. Values and readers only, measured by the composition root. */
export interface AccountGateDeps {
  /** `cfg.authEnabled`. */
  enabled: boolean;
  /** `cfg.origin`: the ONE input to the origin class. */
  origin: string;
  /** The session question (`server.ts`'s `sessionAuth`, `sessionVerdict` over the boot-loaded store). */
  sessionAuth: (req: FastifyRequest) => GateDecision;
  /** The fleet's measured caps, read at request time (local mode fills them in after boot). */
  fleetState: () => Pick<FleetState, 'ccdVerbs'> | undefined;
  /** A5's guard. */
  stepUp: Pick<StepUp, 'requireRecentAssertion'>;
}

/** What one route asks of the gate. */
export interface AccountGateAsk {
  /** The cap word the route's subs need (N4's `ACCOUNT_CAPS`, from A16). */
  cap: string;
  /** True for the acts that put, replace or delete a credential (D-5512). */
  stepUp?: boolean;
}

/** `pass: false` means the gate has answered the request and the handler stops. */
export type AccountGateAnswer = { pass: true; actor: AccountActor } | { pass: false };

export type AccountGate = (req: FastifyRequest, reply: FastifyReply, ask: AccountGateAsk) => AccountGateAnswer;

/** A loopback host as `URL` spells it: `localhost`, any `127.0.0.0/8` address, or `[::1]`. */
const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);

/**
 * The class of `cfg.origin` (D-5511): `https`, `loopback` (plain HTTP on a loopback host) or `insecure` (anything
 * else, an unparseable origin included). Pure, and given `cfg.origin` alone.
 */
export function accountOriginClass(origin: string): AccountOriginClass {
  let url: URL;
  try { url = new URL(origin); } catch { return 'insecure'; }
  if (url.protocol === 'https:') return 'https';
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return 'loopback';
  return 'insecure';
}

export function createAccountGate(deps: AccountGateDeps): AccountGate {
  // Measured once: `cfg.origin` is boot configuration, and nothing a request carries can move it.
  const originClass = accountOriginClass(deps.origin);
  return (req, reply, ask) => {
    reply.header('cache-control', 'no-store');
    if (!deps.enabled) {
      void refuseRoute(reply, 'auth-off');
      return { pass: false };
    }
    if (originClass === 'insecure') {
      void refuseRoute(reply, 'insecure-origin');
      return { pass: false };
    }
    const decision = deps.sessionAuth(req);
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (!decision.allow || decision.reason !== 'session' || token === undefined || token === '') {
      void refuseRoute(reply, 'unauthenticated', { verdict: decision.allow ? 'no-session' : decision.verdict });
      return { pass: false };
    }
    if (!capSupported(deps.fleetState(), ask.cap)) {
      void refuseRoute(reply, 'unsupported');
      return { pass: false };
    }
    if (ask.stepUp === true && deps.stepUp.requireRecentAssertion()(req, reply)) return { pass: false };
    return { pass: true, actor: actorOf(decision.device, sessionIdHash(token)) };
  };
}
