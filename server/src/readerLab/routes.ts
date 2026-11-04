// The reader lab's door (native Docs reader, the reader lab plan of 2026-11-03, Task 3; the reader lab design, section
// 4; the rich-docs spec's rows M10.2 to M10.8). Ring L4: the counter hook and the five registrations over `runs.ts`.
//
// The three run routes are the lab page's and are session-gated like every route not in `EXEMPT`: a session opens a
// run and is handed a nonce minted here, reads the run's counts, and closes it. A run is bound to the session that opened
// it through a one-way digest of its cookie (`labOwnerOf`), never the cookie itself: any other session's read or close
// answers exactly as an unknown nonce's does. The door is present on every box and inert until a session opens a run.
// The probe pair is `EXEMPT` (gate.ts
// reason 8): its callers are the lab's sandboxed frames, whose requests carry no session cookie by design. Every answer
// the probe route itself gives is one `204` with no body and `no-store`, whatever the nonce, the run or the name, by GET
// or POST, a refused body included. What a request that reaches no probe handler gets (a malformed percent-escape 400, an
// over-long name 414, a HEAD or a wrong-shaped path 404 on a dark box, and on an armed one the gate's 401 `no-session`
// for a caller with no session, since every onRequest hook still runs) or what the upgrade layer does (a WebSocket
// upgrade past the gate is completed, then closed) depends on the request's method, its path text and its cookie, never
// on whether a run exists, so a probe learns nothing. The counter is an `onRequest` hook the composition root adds immediately
// BEFORE the gate's, so a probe the gate refuses (a frame's WebSocket upgrade, `Origin: null`, on an armed box) is still
// counted. It never answers, reads no body and awaits nothing; the gate still decides every request. The door logs
// nothing of its own; on an armed box the gate's foreign-origin line for a frame's WebSocket upgrade is the gate's.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, parseCookies } from '../auth/cookie.js';
import {
  READER_LAB_PROBE_ROUTE, type LabCloseAnswer, type LabOpenAnswer, type LabReadAnswer,
} from '../../../shared/readerLab.js';
import { READER_LAB_RUN_TTL_MS, labOriginClass, labSiteClass, type ReaderLabRuns } from './runs.js';

const NO_STORE = 'no-store';

/** What Fastify may buffer of a probe POST before the handler, which never reads it. */
export const READER_LAB_PROBE_BODY_MAX = 1024;

/** The owner of every run opened without a session cookie: a box with the gate dark, where every route is open to anyone
 *  who reaches the port, and so is a run to anyone who holds its nonce. */
export const LAB_NO_SESSION = '-';

/** A run's owner: a one-way digest of the session cookie's value, prefixed so it is never the session store's own key,
 *  or LAB_NO_SESSION when the request carries none. The store keeps this, never the cookie. */
export function labOwnerOf(cookieHeader: string | undefined): string {
  const token = parseCookies(cookieHeader).get(SESSION_COOKIE);
  return token === undefined || token === '' ? LAB_NO_SESSION : createHash('sha256').update(`reader-lab:${token}`).digest('base64url');
}

/** The probe's one answer. */
const probeAnswer = (reply: FastifyReply): FastifyReply => reply.code(204).header('cache-control', NO_STORE).send();

/** The counter. `server.ts#buildServer` calls this immediately before `installGate`. */
export function installReaderLabCounter(app: FastifyInstance, runs: ReaderLabRuns): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (req.routeOptions.url !== READER_LAB_PROBE_ROUTE) return;
    const params = req.params as { readonly nonce?: unknown; readonly name?: unknown };
    if (typeof params.nonce !== 'string' || typeof params.name !== 'string') return;
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    runs.count(params.nonce, params.name, {
      cookie: token !== undefined && token !== '',
      upgrade: req.ws === true,
      site: labSiteClass(req.headers['sec-fetch-site']),
      origin: labOriginClass(req.headers.origin),
    }, Date.now());
  });
}

/** The three run routes and the probe pair, registered on the root instance. */
export function registerReaderLabRoutes(app: FastifyInstance, runs: ReaderLabRuns): void {
  app.post('/api/reader-lab/runs', async (req, reply) => {
    const nonce = randomBytes(16).toString('base64url');
    runs.open(nonce, labOwnerOf(req.headers.cookie), Date.now());
    return reply.code(200).header('cache-control', NO_STORE)
      .send({ ok: true, nonce, ttlMs: READER_LAB_RUN_TTL_MS } satisfies LabOpenAnswer);
  });

  app.get('/api/reader-lab/runs/:nonce', { exposeHeadRoute: false }, async (req, reply) => {
    const run = runs.read((req.params as { readonly nonce: string }).nonce, labOwnerOf(req.headers.cookie), Date.now());
    const answer: LabReadAnswer = run === null ? { ok: false, error: 'unknown-run' } : { ok: true, run };
    return reply.code(run === null ? 404 : 200).header('cache-control', NO_STORE).send(answer);
  });

  app.post('/api/reader-lab/runs/:nonce/close', async (req, reply) => reply.code(200).header('cache-control', NO_STORE)
    .send({ ok: true, closed: runs.close((req.params as { readonly nonce: string }).nonce, labOwnerOf(req.headers.cookie)) } satisfies LabCloseAnswer));

  app.get('/api/reader-lab/probe/:nonce/:name', { exposeHeadRoute: false }, async (_req, reply) => probeAnswer(reply));

  app.post('/api/reader-lab/probe/:nonce/:name', {
    bodyLimit: READER_LAB_PROBE_BODY_MAX,
    // A body Fastify refuses before the handler (a 413, a 415, a parse 400) answers exactly as an accepted one does.
    errorHandler: (_err, _req, reply) => probeAnswer(reply),
  }, async (_req, reply) => probeAnswer(reply));
}
