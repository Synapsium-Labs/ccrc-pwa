// `GET /api/pools/runway`, the operator's read of each pool's runway (Overlord W1 serviceability PR B; the home plan's
// question 6, slug `runway-read-is-serviceabilitys`; spec §5.6's capacity line). Ring L4, context C1: it gathers the roster,
// the limits, the central pool edges and the samples, asks `poolRunway.ts#runwayPools` and `#runwayByPool`, and answers.
// It decides nothing. Session-gated when sign-in is armed (the auth gate's default: it is no exempt route), consults no box
// token, writes nothing, and answers pool names and numbers only, never an account id (masked). A read that throws is a 503
// `unavailable`, never an empty list, which home B would draw as "no runway"; its `detail` is a fixed word naming the read
// that failed, never the thrown text, which can carry a path or a file name. A server with no coordination store answers
// 501 `not-configured`, as the pool epoch read does.
import type { FastifyInstance } from 'fastify';
import type { PoolRunwayWire } from '../../shared/loadLines.js';
import type { Roster } from '../../shared/roster.js';
import { refuseRoute } from './refuse.js';
import type { AccountLimits } from './limits.js';
import { RUNWAY_READ_S, runwayByPool, runwayPools, type LimitSample } from './poolRunway.js';

export interface PoolRunwayRouteDeps {
  roster: () => Roster;
  limits: () => Promise<Readonly<Record<string, AccountLimits>>>;
  /** The coordination store's two reads, or undefined on a server without one. */
  coord: { accountPoolEdges(): ReadonlyMap<string, readonly string[]>; limitSamplesSince(accounts: readonly string[], sinceS: number): LimitSample[] } | undefined;
  clock: { wall(): number };
}

/** The read a 503 names, a fixed word each: the answer never carries the thrown text. */
export const RUNWAY_READ_FAILED = {
  limits: 'the limits could not be read',
  edges: 'the pool edges could not be read',
  samples: 'the limit samples could not be read',
  runway: 'the runway could not be computed',
} as const;

export function registerPoolRunwayRoute(app: FastifyInstance, deps: PoolRunwayRouteDeps): void {
  app.get('/api/pools/runway', async (_req, reply) => {
    const coord = deps.coord;
    if (coord === undefined) return refuseRoute(reply, 'not-configured');
    let step: keyof typeof RUNWAY_READ_FAILED = 'limits';
    try {
      const nowS = Math.floor(deps.clock.wall() / 1000);
      const limits = await deps.limits();
      step = 'edges';
      const edges = coord.accountPoolEdges();
      step = 'runway';
      const pools = runwayPools(deps.roster(), limits, edges);
      step = 'samples';
      const samples = coord.limitSamplesSince([...new Set(pools.flatMap((p) => p.accounts))], nowS - RUNWAY_READ_S);
      step = 'runway';
      const body: PoolRunwayWire = { ok: true, nowS, pools: runwayByPool(pools, samples, nowS) };
      return body;
    } catch {
      return refuseRoute(reply, 'unavailable', { detail: RUNWAY_READ_FAILED[step] });
    }
  });
}
