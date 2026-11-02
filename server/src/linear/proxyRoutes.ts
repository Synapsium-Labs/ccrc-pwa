/**
 * THE LINEAR PROXY (#1444, D-7670, D-7671, D-7672, D-7675, D-7682 R2; spec 2026-10-31 §6): the twelve
 * `/api/linear/proxy/*` routes a fleet session's `ccrc-api linear …` verbs call, so that a session reaches Linear
 * through the key ccrc holds and never holds a key of its own.
 *
 * L4 DELIVERY. It owns the request and the reply and decides nothing the operation table (`ops.ts`, L1), the router
 * (`route.ts`, L1), the rate service (`rate.ts`), the policy point (`policyPoint.ts`) or the journal (`journal.ts`) has
 * not decided. Registered by `server.ts` beside `registerLinearRoutes`.
 *
 * AUTH FIRST, AND UNCONDITIONAL (spec §6.2, R2). Each route is an `auth/gate.ts` EXEMPT entry, and each route's own
 * `onRequest` hook calls `checkMailToken` and refuses anything but `'ok'` with 401 `unauthenticated`. It never reads
 * `cfg.authEnabled`, so a box whose sign-in gate is unarmed still refuses a tokenless call, and it takes no session
 * cookie in place of the token: the PWA never calls these routes. The same hook checks the identity pair's shape,
 * read from the QUERY (`byId`, `byUuid`, each one SAFE_RE string), which Fastify has parsed before `onRequest` runs
 * while the body has not been. Only then the outer limiter (`{max: 1200, timeWindow: '1 minute'}`, on `preHandler`),
 * so a refused call spends no budget and tokenless calls cannot drain the shared bucket.
 *
 * THE ORDER OF CHECKS (spec §6.3) is the handler's order: attribution (`coord/attribution.ts`), the operation's
 * validator with `linear-egress` over the outbound text, routing (a miss queues the background refresher and answers
 * at once), the session's and the slot's buckets in one take, the slot's key read from its file for each Linear call,
 * the resolve and the moved-issue rule, the policy point, the journal's `pending` row, names from the directory (a
 * miss queues the refresher), the operation's one call, shaping with `viaFleet`, and the journal's outcome. A refusal
 * answers at once and nothing after it runs. Nothing before the resolve calls Linear, and a route makes at most two
 * Linear calls: the resolve, then the operation.
 *
 * DEADLINES (spec §6.6). Each call keeps `callLinear`'s eight seconds; the route has twenty, and does not start a
 * second call with fewer than eight left (`timeout` `not-sent`, journaled `refused`). A write that times out after it
 * was sent answers `timeout` with a detail saying it may have happened, journaled `unknown`.
 *
 * THE KEY. It is read from its file (`readLinearSlotKey`) at the moment of each call, handed to `callLinear` and
 * dropped: no variable outside one call holds it, and nothing here logs, answers or journals it or its digest.
 *
 * ABSENT SERVICES (D-7684). Each Linear service is `T | null`; a route that needs one that is absent answers
 * `linear-unavailable` after its `onRequest` checks and before anything else, and calls Linear for nothing.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteRefusal } from '../../../shared/refusal.js';
import { cleanName } from '../../../shared/unprintable.js';
import type { AttributionRead } from '../coord/openRun.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRateLimited, refuseRoute } from '../refuse.js';
import { valueDigestHex } from '../token/files.js';
import { callLinear, type FetchLike, type LinearCall } from './client.js';
import type { LinearJournal, LinearJournalCode, LinearSettledOutcome, LinearWriteOp } from './journal.js';
import {
  LINEAR_OPS, linearErrorWord, linearMoved, linearOutbound, linearResolvePlan, linearRouteAsk, shapeLinearResolve,
  shapeLinearTeams, shapeLinearWorkspaces, validateLinearCall,
  type LinearCallRow, type LinearOpInput, type LinearResolved, type LinearVerb,
} from './ops.js';
import type { LinearWritePolicy } from './policy.js';
import { askWithDeadline } from './policyPoint.js';
import type { LinearRateService } from './rate.js';
import { LINEAR_MISS_RETRY_AFTER_S, type LinearRefresher } from './refresher.js';
import { routableSlots, routeLinear, type LinearRoute, type LinearRouteSlot } from './route.js';
import {
  clearLinearSlotVerdict, markLinearSlotRejected, readLinearSlotKey, readLinearStore, type LinearStoreRead,
} from './store.js';
import { linearSlotViewState } from './view.js';

/** Each verb's route, as the policy point and the token check name it (spec §5.1). The registrations below spell each
 *  path literally, and `linear-proxy-routes.test.ts` holds the two equal. */
export const LINEAR_PROXY_ROUTES: Readonly<Record<LinearVerb, string>> = Object.freeze({
  workspaces: 'GET /api/linear/proxy/workspaces',
  teams: 'GET /api/linear/proxy/teams',
  issue: 'GET /api/linear/proxy/issues/:id',
  search: 'POST /api/linear/proxy/search',
  comments: 'GET /api/linear/proxy/issues/:id/comments',
  statuses: 'GET /api/linear/proxy/statuses',
  projects: 'GET /api/linear/proxy/projects',
  labels: 'GET /api/linear/proxy/labels',
  users: 'GET /api/linear/proxy/users',
  create: 'POST /api/linear/proxy/issues',
  update: 'POST /api/linear/proxy/issues/:id',
  comment: 'POST /api/linear/proxy/issues/:id/comments',
});

/** The outer limiter's bound (spec §6.7): it protects the server, not Linear; the rate service protects Linear. */
export const LINEAR_PROXY_RATE_LIMIT = { max: 1200, timeWindow: '1 minute' } as const;
/** A route's whole budget, and the least of it a second call needs (`callLinear`'s own deadline): spec §6.6. Both stay
 *  inside `ccrc-api`'s thirty-second `curl -m 30`. */
export const LINEAR_ROUTE_BUDGET_MS = 20_000;
export const LINEAR_CALL_BUDGET_MS = 8_000;

/** The identity pair's grammar: the client's SAFE_RE, bounded as the journal bounds it. */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface LinearProxyDeps {
  /** The config's ccrc dir (`cfg.ccrcDir`), where the slots and the legacy pair live. */
  ccrcDir: string;
  /** The box token (`coord/token.ts`), read at request time as every lane reads it; null is a server never given one,
   *  which refuses every call. */
  mailToken: () => string | BoxTokenHolder | null;
  /** The box-token lanes' sender check, `attributionVerdict` over the registry (`coord/attribution.ts`). */
  attribute: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The ONE rate service, the ONE refresher, the ONE journal and the policy point, each passed through as it is. */
  rate: LinearRateService | null;
  refresher: LinearRefresher | null;
  journal: LinearJournal | null;
  policy: LinearWritePolicy | null;
  /** Test seams: the network, a call's deadline and the clock the route's budget is measured on. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

type Query = Record<string, unknown>;

/** The identity pair from the query, or the field that is not one string in its grammar (spec §6.2). */
function identityOf(query: unknown): { ok: true; id: string; uuid: string } | { ok: false; field: 'byId' | 'byUuid' } {
  const q = (typeof query === 'object' && query !== null ? query : {}) as Query;
  const id = q['byId'];
  if (typeof id !== 'string' || !IDENTITY_RE.test(id)) return { ok: false, field: 'byId' };
  const uuid = q['byUuid'];
  if (typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) return { ok: false, field: 'byUuid' };
  return { ok: true, id, uuid };
}

/** The refusal a token verdict other than `'ok'` answers, in the mail path's words. */
const TOKEN_DETAIL: Readonly<Record<'legacy' | 'bad' | 'unconfigured', string>> = {
  legacy: `no box token presented — the Linear proxy takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server — the Linear proxy fails shut, it does not fail open',
};

/** Fixed details. A detail never carries Linear's text, a key or a digest. */
const DETAIL = {
  legacyUnlearned: 'the saved Linear key has not learned its workspace yet: press Check again in Settings → Linear',
  noSlot: 'no Linear key in Settings reaches this call',
  noKey: "the workspace's key is missing or unusable: add it again in Settings → Linear",
  detailsUnknown: "this workspace's key has not been checked: press Check again in Settings → Linear",
  workspaceUnknown: 'no Linear key in Settings is for that workspace',
  workspaceRequired: 'more than one Linear workspace is configured: pass --workspace',
  storeUnreadable: 'the Linear key store could not be read',
  mayHaveHappened: 'the change may have happened: read the issue before a retry',
  notSent: 'not-sent',
} as const;

/** Why a Linear call's answer refuses: the word, and what a write's journal row says about the change. */
interface CallRefusal { word: RouteRefusal; detail?: string; retryAfterS?: number; outcome: 'failed' | 'unknown' }

/** A failed `callLinear` (spec §6.8). Linear's own refusals (401, 403, its rate limit) failed the change; a timeout, no
 *  answer, or an answer out of its grammar may have come after it happened. */
function callRefusal(r: Exclude<LinearCall, { ok: true }>, write: boolean): CallRefusal {
  switch (r.reason) {
    case 'unauthorised': return { word: 'linear-unauthorised', outcome: 'failed' };
    case 'forbidden': return { word: 'linear-forbidden', outcome: 'failed' };
    case 'rate-limited': return { word: 'rate-limited', detail: 'linear', retryAfterS: r.retryAfterS, outcome: 'failed' };
    case 'timeout': return { word: 'timeout', ...(write ? { detail: DETAIL.mayHaveHappened } : {}), outcome: 'unknown' };
    case 'unreachable': return { word: 'unreachable', outcome: 'unknown' };
    case 'malformed': return { word: 'malformed', outcome: 'unknown' };
  }
}

/** A shaped answer's word: an answer that carries Linear's `errors` refused the change; one out of its grammar may have
 *  come after it happened. */
const shapedOutcome = (body: unknown, word: string): 'failed' | 'unknown' =>
  (linearErrorWord(body) !== null || word !== 'malformed' ? 'failed' : 'unknown');

/** A write the route journals: what it knows at the moment it refuses or sends. */
interface WriteRecord {
  op: LinearWriteOp;
  sessionId: string;
  sessionUuid: string;
  workspaceId: string;
  teamKey: string | null;
  target: string | null;
  fields: string[];
}

/** The changed fields a write names, from its validated body (the journal's closed list orders them). */
const writeFields = (input: LinearOpInput): string[] =>
  (input.op === 'create' ? ['team', ...Object.keys(input.fields)] : Object.keys(input.fields));

/** The record of a slot's teams with their ids, from the store read the call was routed against. */
function slotTeams(store: Extract<LinearStoreRead, { kind: 'listed' }>, slot: LinearRouteSlot): { id: string; key: string; name: string }[] {
  if (slot.ref.source === 'legacy') return store.legacy?.workspace?.teams ?? [];
  const id = slot.ref.id;
  const s = store.slots.find((x) => x.id === id);
  if (s === undefined || s.key.kind !== 'key' || s.record.kind !== 'details' || s.record.details.keyDigest !== s.key.digest) return [];
  return s.record.details.teams;
}

export function registerLinearProxyRoutes(app: FastifyInstance, deps: LinearProxyDeps): void {
  const now = deps.now ?? Date.now;

  /** `onRequest`, for every route: the token verdict (computed by the route's own registration, which names its lane),
   *  then the identity pair's shape. Sends and returns the reply on a refusal; undefined lets the request on. */
  const admit = (reply: FastifyReply, verdict: ReturnType<typeof checkMailToken>, query: unknown): FastifyReply | undefined => {
    if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
    const who = identityOf(query);
    if (!who.ok) return refuseRoute(reply, 'bad-request', { detail: who.field });
    return undefined;
  };

  /** Each route's options: the outer limiter, its 429 and Fastify's body refusals in ccrc's words, and `onRequest`. */
  const opts = (verdict: (req: FastifyRequest) => ReturnType<typeof checkMailToken>) => ({
    config: { rateLimit: LINEAR_PROXY_RATE_LIMIT },
    errorHandler: (err: FastifyError, _req: FastifyRequest, reply: FastifyReply) => {
      const status = err.statusCode ?? 500;
      if (status === 429) return refuseRateLimited(reply);
      if (status === 413) return refuseRoute(reply, 'too-large');
      if (status === 415) return refuseRoute(reply, 'unsupported-type');
      if (status === 400) return refuseRoute(reply, 'bad-request', { detail: 'body' });
      return refuseRoute(reply, 'internal');
    },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => admit(reply, verdict(req), req.query),
  });

  app.get('/api/linear/proxy/workspaces', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.workspaces)), (req, reply) => handle('workspaces', req, reply));
  app.get('/api/linear/proxy/teams', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.teams)), (req, reply) => handle('teams', req, reply));
  app.get('/api/linear/proxy/issues/:id', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.issue)), (req, reply) => handle('issue', req, reply));
  app.post('/api/linear/proxy/search', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.search)), (req, reply) => handle('search', req, reply));
  app.get('/api/linear/proxy/issues/:id/comments', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.comments)), (req, reply) => handle('comments', req, reply));
  app.get('/api/linear/proxy/statuses', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.statuses)), (req, reply) => handle('statuses', req, reply));
  app.get('/api/linear/proxy/projects', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.projects)), (req, reply) => handle('projects', req, reply));
  app.get('/api/linear/proxy/labels', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.labels)), (req, reply) => handle('labels', req, reply));
  app.get('/api/linear/proxy/users', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.users)), (req, reply) => handle('users', req, reply));
  app.post('/api/linear/proxy/issues', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.create)), (req, reply) => handle('create', req, reply));
  app.post('/api/linear/proxy/issues/:id', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.update)), (req, reply) => handle('update', req, reply));
  app.post('/api/linear/proxy/issues/:id/comments', opts((req) => checkMailToken(deps.mailToken(), req.headers[MAIL_TOKEN_HEADER], LINEAR_PROXY_ROUTES.comment)), (req, reply) => handle('comment', req, reply));

  /** A refusal that carries a wait: `Retry-After` beside the word. */
  const refuseAfter = (reply: FastifyReply, word: RouteRefusal, seconds: number, extra: Record<string, unknown>): FastifyReply => {
    reply.header('retry-after', String(Math.max(1, Math.ceil(seconds))));
    return refuseRoute(reply, word, extra);
  };

  /** A routing refusal (spec §4.2, §4.3, §3.4). A team or prefix miss queues the background refresher and answers at
   *  once; nothing here calls Linear, and no journal row is written (no slot was chosen). */
  const routeRefusal = (reply: FastifyReply, routed: Extract<LinearRoute, { kind: 'refused' }>,
    store: Extract<LinearStoreRead, { kind: 'listed' }>, refresher: LinearRefresher | null): FastifyReply => {
    switch (routed.word) {
      case 'not-configured': {
        const unlearned = store.slots.length === 0 && store.legacy !== null && store.legacy.workspace === null;
        return refuseRoute(reply, 'not-configured', { detail: unlearned ? DETAIL.legacyUnlearned : DETAIL.noSlot });
      }
      case 'team-unknown': {
        const detail = refresher === null ? 'unknown' : refresher.miss(store);
        return detail === 'refreshing'
          ? refuseAfter(reply, 'team-unknown', LINEAR_MISS_RETRY_AFTER_S, { detail })
          : refuseRoute(reply, 'team-unknown', { detail });
      }
      case 'team-ambiguous': {
        const names = routed.candidates.map((c) => cleanName(c)).filter((c): c is string => c !== null);
        return refuseRoute(reply, 'team-ambiguous', { detail: names.join(', ') });
      }
      case 'workspace-unknown': return refuseRoute(reply, 'workspace-unknown', { detail: DETAIL.workspaceUnknown });
      case 'workspace-required': return refuseRoute(reply, 'workspace-required', { detail: DETAIL.workspaceRequired });
    }
  };

  /** The store-answered verbs (spec §5.4): `workspaces` and `teams`, read from the slots' records, no Linear call. */
  const storeAnswer = (verb: 'workspaces' | 'teams', input: LinearOpInput, reply: FastifyReply,
    store: Extract<LinearStoreRead, { kind: 'listed' }>, refresher: LinearRefresher | null): FastifyReply => {
    if (verb === 'workspaces') {
      const rows = store.slots.map((s) => {
        const d = s.key.kind === 'key' && s.record.kind === 'details' && s.record.details.keyDigest === s.key.digest ? s.record.details : null;
        return { urlKey: d?.urlKey ?? null, name: d?.name ?? null, teamKeys: (d?.teams ?? []).map((t) => t.key), state: linearSlotViewState(s.key, s.record) };
      });
      const legacy = store.legacy;
      if (legacy !== null && !legacy.superseded) {
        const w = legacy.workspace;
        rows.push({ urlKey: w?.urlKey ?? null, name: w?.name ?? null, teamKeys: (w?.teams ?? []).map((t) => t.key), state: legacy.view.state });
      }
      return reply.send({ ok: true, items: shapeLinearWorkspaces(rows), next: null });
    }
    const routed = routeLinear(routableSlots(store), linearRouteAsk(input));
    if (routed.kind === 'refused') return routeRefusal(reply, routed, store, refresher);
    if (routed.slot.urlKey === null) return refuseRoute(reply, 'not-configured', { detail: DETAIL.detailsUnknown });
    return reply.send({ ok: true, items: shapeLinearTeams(routed.slot.urlKey, slotTeams(store, routed.slot)), next: null });
  };

  async function handle(verb: LinearVerb, req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const startedAt = now();
    reply.header('cache-control', 'no-store');
    const row = LINEAR_OPS[verb];
    const { rate, refresher, journal, policy } = deps;

    // Absent services (D-7684): after the onRequest checks, before any other work, and nothing calls Linear.
    if (row.source === 'linear' && (rate === null || refresher === null || journal === null || (row.class === 'write' && policy === null))) {
      return refuseRoute(reply, 'linear-unavailable');
    }

    // 3. Attribution: the pair the client derived from its pane, which the registry vouches for (spec §6.2).
    const who = identityOf(req.query);
    if (!who.ok) return refuseRoute(reply, 'bad-request', { detail: who.field });
    const attributed = await deps.attribute(who.id, who.uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });

    // 5. The body and the query against the operation's validator, then `linear-egress` over the outbound text.
    const params = req.params as { id?: unknown };
    const validated = validateLinearCall(verb, { ref: params.id, query: req.query, body: req.body });
    if (!validated.ok) return refuseRoute(reply, validated.word, validated.field === null ? {} : { detail: validated.field });
    const { input, masked } = row.class === 'write' || verb === 'search'
      ? linearOutbound(validated.input) : { input: validated.input, masked: 0 };

    // 6. Routing, which never calls Linear.
    const store = await readLinearStore(deps.ccrcDir);
    if (store.kind !== 'listed') return refuseRoute(reply, 'unavailable', { detail: DETAIL.storeUnreadable });
    if (row.source === 'store') return storeAnswer(verb === 'workspaces' ? 'workspaces' : 'teams', input, reply, store, refresher);
    // Narrowed above: a Linear row has every service it needs.
    const call = row as LinearCallRow;
    const routed = routeLinear(routableSlots(store), linearRouteAsk(input));
    if (routed.kind === 'refused') return routeRefusal(reply, routed, store, refresher);
    const slot = routed.slot;
    if (slot.urlKey === null) return refuseRoute(reply, 'not-configured', { detail: DETAIL.detailsUnknown });
    const urlKey = slot.urlKey;
    return run(call, input, masked, slot, urlKey, slotTeams(store, slot), who, startedAt, reply, rate!, refresher!, journal!, policy);
  }

  async function run(
    row: LinearCallRow, input: LinearOpInput, masked: number, slot: LinearRouteSlot, urlKey: string,
    teams: { id: string; key: string; name: string }[], who: { id: string; uuid: string }, startedAt: number,
    reply: FastifyReply, rate: LinearRateService, refresher: LinearRefresher, journal: LinearJournal,
    policy: LinearWritePolicy | null,
  ): Promise<FastifyReply> {
    const write = row.class === 'write';
    const plan = linearResolvePlan(input);
    // What a write's journal row says. Before the resolve, the target is the reference the caller named (the only
    // identifier known yet) and the team only a create's own; after it, both are the resolved ones (spec §4.5, §7).
    const record: WriteRecord | null = write ? {
      op: row.op as LinearWriteOp, sessionId: who.id, sessionUuid: who.uuid, workspaceId: slot.workspaceId,
      teamKey: row.op === 'create' ? input.team : null,
      target: row.op === 'create' ? (input.fields.parent ?? null) : input.ref,
      fields: writeFields(input),
    } : null;
    let pendingId: number | null = null;
    let decisionId: string | null = null;

    /** Ends a write's journal row: the pending one when it was written, else a row written and settled now (a write
     *  refused at steps 7 to 10 still gets one, spec §7). A journal that refuses here changes no answer: nothing was
     *  sent. */
    const journalEnd = (outcome: LinearSettledOutcome, code?: LinearJournalCode, result?: string | null): void => {
      if (record === null) return;
      let id = pendingId;
      if (id === null) {
        const w = journal.pending({ ...record, actor: null });
        if (!w.ok) return;
        id = w.id;
      }
      pendingId = null;
      journal.settle(id, outcome, code, result ?? null, masked, decisionId);
    };
    const refuseWrite = (outcome: LinearSettledOutcome, word: RouteRefusal, extra: Record<string, unknown> = {}, retryAfterS?: number): FastifyReply => {
      journalEnd(outcome, word);
      return retryAfterS === undefined ? refuseRoute(reply, word, extra) : refuseAfter(reply, word, retryAfterS, extra);
    };

    // 4 and 7. The session's buckets and the slot's proxy lane, in one take of the worst case (two calls with a resolve).
    const take = rate.take({ lane: 'proxy', slot: slot.ref, calls: plan === null ? 1 : 2, session: { id: who.id, write } });
    if (!take.ok) return refuseWrite('refused', 'rate-limited', { detail: take.detail }, take.retryAfterS);

    let spent = 0;
    let closeForS: number | null = null;
    /** One Linear call with the key just read, counted for the settle. */
    const send = async (key: string, document: string, variables: Record<string, unknown>): Promise<LinearCall> => {
      spent += 1;
      const r = await callLinear(key, document, variables, { fetch: deps.fetch, timeoutMs: deps.timeoutMs });
      if (!r.ok && r.reason === 'rate-limited') closeForS = r.retryAfterS;
      return r;
    };
    /** A failed call: a 401 marks a file slot rejected, by the digest of the key it used (the legacy pair is the legacy
     *  routes' alone, spec §3.4). */
    const failed = async (r: Exclude<LinearCall, { ok: true }>, digest: string, sent: boolean): Promise<FastifyReply> => {
      const why = callRefusal(r, write && sent);
      if (r.reason === 'unauthorised' && slot.ref.source === 'file') {
        await markLinearSlotRejected(deps.ccrcDir, slot.ref.id, digest, now())
          .catch(() => { console.warn('ccrc-server: linear: could not record a rejected workspace key'); });
      }
      const outcome: LinearSettledOutcome = sent ? why.outcome : 'refused';
      return refuseWrite(outcome, why.word, why.detail === undefined ? {} : { detail: why.detail }, why.retryAfterS);
    };

    try {
      // 8 and 9. The resolve (spec §4.5), the first Linear call, with the slot's key read now.
      let resolved: LinearResolved | null = null;
      if (plan !== null) {
        const k = await readLinearSlotKey(deps.ccrcDir, slot.ref);
        if (k.kind !== 'key') return refuseWrite('refused', 'not-configured', { detail: DETAIL.noKey });
        const digest = valueDigestHex(k.key);
        const r = await send(k.key, plan.document, plan.variables);
        if (!r.ok) return await failed(r, digest, false);
        const s = shapeLinearResolve(r.body, plan);
        if (!s.ok) return refuseWrite('refused', s.word, s.detail === undefined ? {} : { detail: s.detail });
        resolved = s.resolved;
        if (record !== null) {
          if (resolved.issue !== null) { record.teamKey = resolved.issue.teamKey; record.target = resolved.issue.identifier; }
          else if (resolved.parent !== null) record.target = resolved.parent.identifier;
        }
        const moved = linearMoved(input, resolved);
        if (moved !== null) return refuseWrite('refused', 'issue-moved', moved.identifier === null ? {} : { detail: moved.identifier });
      }

      // 10 and 11. The policy point, asked with the resolved team, then the journal's pending row (spec §8, §7).
      if (write && record !== null && policy !== null) {
        const verdict = await askWithDeadline(policy, {
          actor: { kind: 'session', id: who.id, uuid: who.uuid },
          verb: 'operate',
          route: LINEAR_PROXY_ROUTES[row.op],
          resource: {
            workspaceId: slot.workspaceId,
            teamKey: record.teamKey ?? '',
            issue: resolved?.issue?.identifier ?? null,
            parentTeamKey: resolved?.parent?.teamKey ?? null,
            op: row.op as LinearWriteOp,
          },
        });
        decisionId = verdict.decisionId;
        if (!verdict.allow) return refuseWrite(verdict.code === 'policy-denied' ? 'denied' : 'refused', verdict.code);
        const w = journal.pending({ ...record, actor: null });
        if (!w.ok) return refuseRoute(reply, 'journal-unavailable');
        pendingId = w.id;
      }

      // 12. Names from the directory, for the key read now; a miss queues the background refresher (spec §4.4).
      const k = await readLinearSlotKey(deps.ccrcDir, slot.ref);
      if (k.kind !== 'key') return refuseWrite('refused', 'not-configured', { detail: DETAIL.noKey });
      const digest = valueDigestHex(k.key);
      const vars = row.variables(input, { teams, resolved, directory: refresher.directory.get(slot.ref, digest) });
      if (!vars.ok) {
        switch (vars.word) {
          case 'name-unknown': {
            const detail = refresher.nameMiss(slot.ref, digest);
            return detail === 'refreshing'
              ? refuseWrite('refused', 'name-unknown', { detail, field: vars.field }, LINEAR_MISS_RETRY_AFTER_S)
              : refuseWrite('refused', 'name-unknown', { detail, field: vars.field });
          }
          case 'name-ambiguous':
            return refuseWrite('refused', 'name-ambiguous', { detail: `${vars.field}: ${vars.candidates.join(', ')}`, field: vars.field });
          case 'team-unknown': return refuseWrite('refused', 'team-unknown', { detail: 'unknown' });
          case 'unresolved': return refuseWrite('refused', 'internal');
        }
      }

      // 13. The operation's one call. A second call needs a call's whole deadline left of the route's (spec §6.6).
      if (spent > 0 && LINEAR_ROUTE_BUDGET_MS - (now() - startedAt) < LINEAR_CALL_BUDGET_MS) {
        return refuseWrite('refused', 'timeout', { detail: DETAIL.notSent });
      }
      const r = await send(k.key, row.document, vars.vars);
      if (!r.ok) return await failed(r, digest, true);

      // 14. Shaping, with the items a fleet write created (spec §5.4).
      const shaped = row.shape(r.body, { urlKey, fleet: journal.viaFleet(row.fleetKeys(r.body)) });
      if (!shaped.ok) {
        const outcome = write ? shapedOutcome(r.body, shaped.word) : 'failed';
        return refuseWrite(outcome, shaped.word, shaped.detail === undefined ? {} : { detail: shaped.detail });
      }
      if (slot.ref.source === 'file') {
        await clearLinearSlotVerdict(deps.ccrcDir, slot.ref.id, digest, now())
          .catch(() => { console.warn('ccrc-server: linear: could not clear a stale workspace key verdict'); });
      }
      // 15. The journal's outcome, with what the write created.
      journalEnd('ok', undefined, shaped.result);
      const counted = (write || row.op === 'search') && masked > 0 ? { masked } : {};
      return reply.send({ ok: true, ...shaped.answer, ...counted });
    } finally {
      rate.settle(take.grant, { spent, closeForS });
      // A route that left without settling its pending row (a throw) leaves it pending: "outcome unknown", the truth.
    }
  }
}
