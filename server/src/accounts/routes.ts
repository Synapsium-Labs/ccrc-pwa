import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ACCOUNT_CAPS, LANE_NOT_READY_REASONS, type AccountCheckAnswer, type AccountOutcome, type AccountSub,
  type AccountSwitchAnswer, type LaneWire, type RosterWire,
} from '../../../shared/api.js';
import type { ProviderId } from '../../../shared/providers.js';
import type { RouteRefusal } from '../../../shared/refusal.js';
import { ACCOUNT_ID_RE } from '../../../shared/roster.js';
import { refuseRoute } from '../refuse.js';
import type { AccountAudit } from './audit.js';
import type { AccountGate } from './gate.js';
import type { AccountOpResult, AccountOps } from './ops.js';

/**
 * THE LANE ROUTES: Check, and the kill switch (spec §10, §13.1; D-5511, D-5518; accounts plan Task A14, D-7732).
 *
 *  - `POST /api/accounts/:id/check` runs `ccrc account check` (one probe turn, which spends a request, then the seed
 *    in-verb, A13) and answers `{ok, lane}`.
 *  - `POST /api/accounts/:id/enable` and `/disable` run the verbs of those names and answer `{ok, roster, lane}`.
 *
 * Each takes the account gate FIRST (A7: dark, insecure origin, any verdict but a session, and the fleet's measured
 * `account-v2` cap, in that order), before the id is read or the fleet asked. No step-up: the three are reversible and
 * touch no secret (spec §13.1). No body is read, so none can carry a flag: `enable`'s `--force` is the CLI's alone,
 * and the argv builder (`shared/account-argv.ts`) has no field that becomes it.
 *
 * THE ANSWER IS RE-READ, NEVER INFERRED. After an act that ran, the route reads the lane back (`view`: the telemetry
 * row, the lane-state file and the kill-switch marker, through the same `lanesWire` as `GET /api/accounts`), so the
 * screen's knob moves to what the box now holds.
 *
 * A REFUSAL IS A WORD, NEVER THE VERB'S SENTENCE. The verb's envelope names a code and a sentence that can carry paths
 * and commands; only the code crosses, mapped to a route word (`not-ready` with its reason, `lane-busy`,
 * `last-enabled-home`, `not-found`), or `lane-act-refused` with the code as `verbCode` when it is a plain word. The
 * screen words every refusal from these.
 *
 * AN UNKNOWN OUTCOME IS SAID SO. A timeout, a lost answer or an output past its cap answers `outcome-unknown`: the
 * `ops` port is the reconciling wrapper (`reconcile.ts`), which has already run the `roster` sub and written its
 * `reconcile` row; the route never retries (D-5518).
 *
 * Every act writes one `account_events` row (D-5516) with what ran and how it ended.
 *
 * L4: it reads the request and answers on the reply; every decision it takes is `routeOutcomeOf` (pure), and every
 * read and act is a port the composition root wires.
 */

/** The lane subs these routes run. */
export const LANE_ROUTE_SUBS = ['check', 'enable', 'disable'] as const satisfies readonly AccountSub[];
export type LaneRouteSub = (typeof LANE_ROUTE_SUBS)[number];

export interface AccountRouteDeps {
  /** The account gate (`gate.ts`), built by the composition root. REQUIRED: an account route with no gate is a fleet
   *  act any reader could run. */
  gate: AccountGate;
  /** The ONE `AccountOps` arm, wrapped for reconcile (`reconcile.ts`). */
  ops: Pick<AccountOps, 'run'>;
  /** The roster's lane by id: its provider for the audit row (null when the roster names none), or null for an id the
   *  roster does not hold. */
  laneOf: (id: string) => { provider: ProviderId | null } | null;
  /** The roster `GET /api/accounts` answers, and lane `id` as it reads now (null when the roster no longer holds it). */
  view: (id: string) => Promise<{ roster: RosterWire[]; lane: LaneWire | null }>;
  audit?: Pick<AccountAudit, 'write'>;
  /** The node-id of the fleet the act ran against, or null when it is not known. */
  fleetIdentity: () => string | null;
}

/** What one run means for the route: the act ran to a good end, or the refusal word to answer, its extra fields, and
 *  the audit row's outcome. */
export type RouteOutcome =
  | { kind: 'ok' }
  | { kind: 'refuse'; word: RouteRefusal; extra: Readonly<Record<string, string>>; audit: Exclude<AccountOutcome, 'ok'> };

/** A verb's code as a word: the verbs' own codes are kebab words (`_acct_refuse`'s second argument). */
const VERB_CODE_RE = /^[a-z][a-z0-9-]{0,47}$/;

/** The verb's refusal code, read off its one JSON envelope (`{ok: false, error, reason?, detail}`), or null. Only the
 *  code and the reason are read; the sentence never is. */
function envelopeOf(stdout: string): { error: string; reason: unknown } | null {
  const text = stdout.trim();
  // The verbs answer one JSON document; a line of output before it is tolerated by reading the last line too.
  for (const candidate of [text, text.slice(text.lastIndexOf('\n') + 1)]) {
    try {
      const j: unknown = JSON.parse(candidate);
      if (typeof j === 'object' && j !== null && (j as { ok?: unknown }).ok === false
          && typeof (j as { error?: unknown }).error === 'string') {
        return { error: (j as { error: string }).error, reason: (j as { reason?: unknown }).reason };
      }
    } catch { /* not this candidate */ }
  }
  return null;
}

/** The route's reading of one run (pure). */
export function routeOutcomeOf(r: AccountOpResult): RouteOutcome {
  switch (r.kind) {
    case 'exited': {
      if (r.code === 0) return { kind: 'ok' };
      const env = envelopeOf(r.stdout);
      if (env === null) return { kind: 'refuse', word: 'lane-act-refused', extra: {}, audit: 'failed' };
      switch (env.error) {
        case 'not-ready': {
          const reason: Record<string, string> =
            typeof env.reason === 'string' && (LANE_NOT_READY_REASONS as readonly string[]).includes(env.reason)
              ? { reason: env.reason } : {};
          return { kind: 'refuse', word: 'not-ready', extra: reason, audit: 'refused' };
        }
        case 'lane-busy': return { kind: 'refuse', word: 'lane-busy', extra: {}, audit: 'refused' };
        case 'last-enabled-home': return { kind: 'refuse', word: 'last-enabled-home', extra: {}, audit: 'refused' };
        case 'unknown-id': return { kind: 'refuse', word: 'not-found', extra: {}, audit: 'refused' };
        default:
          return {
            kind: 'refuse', word: 'lane-act-refused', audit: 'refused',
            extra: VERB_CODE_RE.test(env.error) ? { verbCode: env.error } : {},
          };
      }
    }
    // The box may have acted: the wrapper reconciled, and the screen re-reads.
    case 'timeout': case 'lost': case 'too-large':
      return { kind: 'refuse', word: 'outcome-unknown', extra: {}, audit: 'unknown' };
    // Nothing ran.
    case 'not-started': return { kind: 'refuse', word: 'unavailable', extra: {}, audit: 'failed' };
    case 'unsupported': return { kind: 'refuse', word: 'unsupported', extra: {}, audit: 'refused' };
    case 'refused': return { kind: 'refuse', word: 'bad-request', extra: {}, audit: 'refused' };
    default: return r satisfies never;
  }
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const act = (sub: LaneRouteSub) => async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    // The gate first: before the id is read, before the fleet is asked. It sets `no-store` on every answer.
    const g = deps.gate(req, reply, { cap: ACCOUNT_CAPS[0] });
    if (!g.pass) return reply;
    const id = (req.params as { id?: unknown }).id;
    if (typeof id !== 'string' || !ACCOUNT_ID_RE.test(id)) return refuseRoute(reply, 'bad-account-id');
    const lane = deps.laneOf(id);
    if (lane === null) return refuseRoute(reply, 'not-found');
    const outcome = routeOutcomeOf(await deps.ops.run(sub, id, {}));
    deps.audit?.write({
      act: sub, laneId: id, provider: lane.provider,
      ...(outcome.kind === 'ok' ? { outcome: 'ok' } : { outcome: outcome.audit, code: outcome.word }),
      fleetIdentity: deps.fleetIdentity(), actor: g.actor,
    });
    if (outcome.kind === 'refuse') return refuseRoute(reply, outcome.word, outcome.extra);
    const v = await deps.view(id);
    // The roster lost the lane between the act and the read (a removal raced it): say so rather than answer a lane.
    if (v.lane === null) return refuseRoute(reply, 'not-found');
    if (sub === 'check') return { ok: true, lane: v.lane } satisfies AccountCheckAnswer;
    return { ok: true, roster: v.roster, lane: v.lane } satisfies AccountSwitchAnswer;
  };
  app.post('/api/accounts/:id/check', act('check'));
  app.post('/api/accounts/:id/enable', act('enable'));
  app.post('/api/accounts/:id/disable', act('disable'));
}
