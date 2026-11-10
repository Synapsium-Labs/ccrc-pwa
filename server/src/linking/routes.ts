// The linking standard's routes (D-8147). L4: they own the reply and decide nothing; `policy.ts` parses the body and
// `coord/linkingStore.ts` is the table. Task 2 registers the operator's write; the session's read and the template
// pull request join it in this file. Task 3 adds the session's read, `GET /api/linking`; Task 5 the template pull request.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LinkingShowAnswer } from '../../../shared/linking.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import { measuredProjectOf, type SingleRead } from '../registry.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import type { CcdArgv } from '../ccdargv.js';
import type { CcdResult } from '../lifecycle.js';
import type { FleetState } from '../fleetstate.js';
import { withoutCcdRefusal } from '../../../shared/ccd-refusal.js';
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
  /** The ccd runner, and the fleet's verb list it is asked against: the template pull request's act. Absent: `unavailable`. */
  runCcd?: (argv: CcdArgv) => Promise<CcdResult>;
  fleetState?: () => Pick<FleetState, 'ccdVerbs'> | undefined;
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
    const project = measuredProjectOf(read);
    if (project === null) return refuseRoute(reply, 'no-project', { detail: 'the registry record names no project' });
    const row = coord.linkingOf(project);
    const answer: LinkingShowAnswer = { ok: true, project, ...row };
    return answer;
  });

  /**
   * `POST /api/projects/:project/pr-template` (no body): the operator's tap that opens a pull request adding the pull
   * request template to a PRIVATE project. NOT in `auth/gate.ts`'s EXEMPT table: session-gated when armed, open dark, no
   * box token. The route decides nothing but the order of its refusals (all from the stored row, before any ccd call):
   * no key stored, nothing measured and no override, the mode public. The act is `ccd pr-template`; ccd re-reads the
   * visibility itself and refuses a public repository and a template already on the default branch in its own words.
   * On success the stored reading's template cell is written `present` (a project never measured has no cell to update).
   */
  app.post('/api/projects/:project/pr-template', async (req, reply) => {
    const { project } = req.params as { project: string };
    const coord = opts.coord;
    if (coord === undefined || opts.runCcd === undefined) return refuseRoute(reply, 'unavailable');
    const row = coord.linkingOf(project);
    if (row.teamKey === null) return refuseRoute(reply, 'no-team-key');
    const mode = row.mode;
    if (mode === 'unknown') return refuseRoute(reply, 'repo-unmeasured');
    if (mode === 'public') return refuseRoute(reply, 'repo-public');
    if (!ccdCan(opts.fleetState?.(), 'prTemplate')) return refuseRoute(reply, 'unsupported');
    let argv: CcdArgv;
    try { argv = CCD_ARGV.prTemplate(project, row.teamKey); } catch { return refuseRoute(reply, 'bad-team-key'); }
    const res = await opts.runCcd(argv);
    // A call that never ran has no ccd refusal to read, only the runner's own words (D-6840).
    if (res.ran === false) return refuseRoute(reply, 'template-failed', { stderr: withoutCcdRefusal(res.stderr) });
    if (!res.ok) {
      const reason = ccdReason(res.stdout);
      if (reason === 'repo-public' || reason === 'template-exists') return refuseRoute(reply, reason);
      return refuseRoute(reply, 'template-failed', { stderr: withoutCcdRefusal(res.stderr) });
    }
    const url = openPrUrl(res.stdout);
    if (url === null) return refuseRoute(reply, 'template-failed', { stderr: 'ccd answered no open pull request' });
    const m = row.measured;
    if (m.state === 'measured') coord.recordLinkingReading(project, { ...m, template: 'present', at: now() });
    return { ok: true, url };
  });
}

/** The `{"reason":...}` ccd prints on a refusal, or null. */
function ccdReason(stdout: string): string | null {
  try {
    const v = JSON.parse(stdout.split('\n')[0] ?? '') as { reason?: unknown };
    return typeof v.reason === 'string' ? v.reason : null;
  } catch { return null; }
}

/** The first open pull request's https URL in the rows ccd printed, or null. */
function openPrUrl(stdout: string): string | null {
  try {
    const rows = JSON.parse(stdout.split('\n')[0] ?? '') as unknown;
    if (!Array.isArray(rows)) return null;
    for (const r of rows as Array<Record<string, unknown>>) {
      if (r['state'] === 'OPEN' && typeof r['url'] === 'string' && /^https:\/\/github\.com\/[^\s]+$/.test(r['url'])) return r['url'];
    }
  } catch { /* falls to null */ }
  return null;
}
