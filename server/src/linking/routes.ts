// The linking standard's routes (D-8147). L4: they own the reply and decide nothing; `policy.ts` parses the body and
// `coord/linkingStore.ts` is the table. Task 2 registers the operator's write; the session's read and the template
// pull request join it in this file. Task 3 adds the session's read, `GET /api/linking`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LinkingShowAnswer } from '../../../shared/linking.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import type { SingleRead } from '../registry.js';
import { parseLinkingWrite } from './policy.js';

export interface LinkingRouteOpts {
  /** The coordination store, or undefined on a server without one (a test, a script): the write answers `unavailable`. */
  coord: CoordStore | undefined;
  /** Who is writing: the device the request's session names (`server.ts`'s `pwaDec`). */
  by: (req: FastifyRequest) => string;
  now?: () => number;
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  mailToken?: () => string | BoxTokenHolder | null;
  /** The box-token lanes' sender check (`attributionVerdict` over the registry). Absent: the session read answers `unavailable`. */
  attribute?: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The caller's registry record (`readSessionRecord`), the project it names being the one the read answers for. */
  readRecord?: (id: string) => Promise<SingleRead>;
}

/** The identity pair's grammar: the client's SAFE_RE, bounded as the Linear proxy bounds it. */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;

const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

export function registerLinkingRoutes(app: FastifyInstance, opts: LinkingRouteOpts): void {
  const now = opts.now ?? Date.now;

  /**
   * `POST /api/projects/:project/linking`: the operator sets a project's Linear team key and visibility override. NOT in
   * `auth/gate.ts`'s EXEMPT table: session-gated when armed, open dark, no box token (the pool route's stance). The project
   * name goes into a bound SQL parameter only and is not refused for a name the walk has not listed yet: an operator may
   * set a project's key before its first walk. The 200 is MEASURED, not echoed: the row is read back after the write.
   */
  app.post('/api/projects/:project/linking', async (req, reply) => {
    const { project } = req.params as { project: string };
    const parsed = parseLinkingWrite(req.body);
    if (!parsed.ok) return refuseRoute(reply, parsed.error);
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    try {
      coord.setLinking(project, parsed.write, opts.by(req), now());
      return { ok: true, linking: coord.linkingOf(project) };
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * `GET /api/linking?byId=&byUuid=`: a session reads its own project's linking row (the team key, the override, the
   * measured visibility and the mode that follows), through `ccrc-api linking show`. A box-token machine lane, an
   * `auth/gate.ts` EXEMPT entry: the token first (never the cookie, whatever the sign-in flag), then the identity pair's
   * shape, then the registry's attribution, then the caller's own record for its project, then the row. The project is
   * the RECORD's, never a query key: a session cannot read another project's row through this lane. A record naming no
   * project is `no-project` (404); an unreadable one is the registry's `registry-unmeasurable`, as the other lanes say.
   */
  app.get('/api/linking', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(opts.mailToken?.() ?? null, req.headers[MAIL_TOKEN_HEADER], 'GET /api/linking');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const q = (typeof req.query === 'object' && req.query !== null ? req.query : {}) as Record<string, unknown>;
    const id = q['byId'];
    if (typeof id !== 'string' || !IDENTITY_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'byId' });
    const uuid = q['byUuid'];
    if (typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) return refuseRoute(reply, 'bad-request', { detail: 'byUuid' });
    const coord = opts.coord;
    if (coord === undefined || opts.attribute === undefined || opts.readRecord === undefined) return refuseRoute(reply, 'unavailable');
    const attributed = await opts.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const read = await opts.readRecord(id);
    if (read.kind === 'unlistable' || read.kind === 'unmeasurable') {
      return refuseRoute(reply, 'registry-unmeasurable', { detail: 'the caller\'s registry record could not be read: transient' });
    }
    if (read.kind !== 'found' || read.record.projectEvidence !== 'measured' || read.record.project === '') {
      return refuseRoute(reply, 'no-project', { detail: 'the registry record names no project' });
    }
    const project = read.record.project;
    const row = coord.linkingOf(project);
    const answer: LinkingShowAnswer = { ok: true, project, ...row };
    return answer;
  });
}
