// The artifact tier's second listener (native Docs HTML artifacts X5, plan Task A1.3; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md sections 2.2 and 3.4). Ring L4: delivery over the pure
// decisions in `policy.ts` (host and method), and the only module of the tier that makes a Fastify instance.
//
// WHY A SECOND INSTANCE. A page's own code runs on the artifact hosts, outside the console's site, so the console's instance
// (its gate, its cookie plugin, its static shell, its websockets, its not-found handler that answers the app) must never be able
// to answer there. This instance is built with NO plugin and NO content-type parser, has exactly four routes, and its not-found
// handler is its own fixed page, so a path it does not know can never be answered by the console's shell. It listens on loopback
// only (`listenArtifactServer`); the reverse proxy in front of it names the two artifact hosts.
//
// WHAT IT NEVER DOES. It sets no cookie, reads no body, and writes no log line on any request path: a request path on this tier
// holds a capability token, so the instance never has a console call on a request path, the error handler included. In A1 every
// route answers the identical 404 page; A3 fills `/a/:token`, `/c/:token/*` and `/clear`.
//
// THE FENCES. Every request first meets the host fence (421 when `Host` is not one of the two artifact hosts) and then the method
// fence (405 unless GET or HEAD). `installConsoleHostFence` is the console's side: a request naming an artifact host, in any
// port spelling, answers 421 before the auth gate runs. Both decide in `policy.ts`; this file acts.
//
// A FAILED LISTEN TURNS THE TIER OFF, NEVER THE CONSOLE: `listenArtifactServer` never throws. It writes one warning, marks the
// listen state `down`, and the console's own listen, which follows it in `index.ts`, still runs.
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { artifactMethodAllowed, hostFence, namesArtifactHost, type ArtifactConfig } from './policy.js';
import { refuseRoute } from '../refuse.js';
import { ARTIFACT_FENCE_REFUSALS } from '../../../shared/refusal.js';

/** The listen state of the artifact listener: `pending` until `listenArtifactServer` has run. Built once in `buildServer`'s body. */
export interface ArtifactListenerState {
  read(): 'pending' | 'listening' | 'down';
  mark(s: 'listening' | 'down'): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The artifact tier's own instance, or null when the tier is off. Closed with the console. */
    artifactServer: FastifyInstance | null;
    /** The artifact listener's state, or null when the tier is off. */
    artifactListener: ArtifactListenerState | null;
  }
}

export interface ArtifactRouteDeps {
  cfg: Extract<ArtifactConfig, { state: 'on' }>;
}

/** The fixed page every unknown or unfilled path answers (spec 3.4): one sentence, no script, no reference to anything. */
export const ARTIFACT_NOT_FOUND_BODY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>ccrc artifacts</title></head><body><p>This host serves ccrc artifacts by private link only.</p></body></html>';

const MISDIRECTED_BODY = 'Misdirected request.';
const METHOD_BODY = 'Method not allowed.';
const ERROR_BODY = 'Something went wrong.';
const BAD_REQUEST_BODY = 'Bad request.';

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';

/** The headers every answer of this instance carries, whatever its status. `set-cookie` is never among them. */
const HARDENING: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/** The hardening headers on a reply, and its content type. Idempotent, so every answering path may call it. */
function answer(reply: FastifyReply, status: number, contentType: string, body: string): FastifyReply {
  return reply.code(status).headers(HARDENING).header('content-type', contentType).send(body);
}

/** A whole HTTP/1.1 answer for a socket no request object reached: the status, the hardening headers, a fixed text body, and
 *  `connection: close`. */
function rawAnswer(status: 400 | 431, body: string): string {
  const reason = status === 431 ? 'Request Header Fields Too Large' : 'Bad Request';
  const headers = { ...HARDENING, 'content-type': TEXT, 'content-length': String(Buffer.byteLength(body)), connection: 'close' };
  return `HTTP/1.1 ${status} ${reason}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n${body}`;
}

/** The artifact instance. Synchronous, with no plugin and no content-type parser, so no body is ever read. */
export function buildArtifactServer(deps: ArtifactRouteDeps): FastifyInstance {
  // `frameworkErrors`: Fastify answers a malformed percent-escape (400) and an over-long path parameter (414) itself, before any
  // hook, with a body that ECHOES the request path, and the path holds a capability token. Answered here with fixed words and
  // the same headers instead; the host fence has not run for these two, which reach no route.
  // `clientErrorHandler`: a request Node cannot parse (a bad request line, an unknown method, Transfer-Encoding beside
  // Content-Length, an oversized header) is answered on the socket before Fastify sees it; here with the same fixed words and
  // headers, never the default bare answer. Nothing is logged and nothing of the request is echoed.
  const app = Fastify({
    logger: false,
    frameworkErrors: (err, _req, reply) =>
      answer(reply, (err as { code?: unknown }).code === 'FST_ERR_MAX_PARAM_LENGTH' ? 414 : 400, TEXT, BAD_REQUEST_BODY),
    clientErrorHandler: (err, socket) => {
      const code = (err as { code?: unknown }).code;
      if (code === 'ECONNRESET' || !socket.writable) { socket.destroy(); return; }
      socket.end(rawAnswer(code === 'HPE_HEADER_OVERFLOW' ? 431 : 400, BAD_REQUEST_BODY));
    },
  });
  const hosts = [deps.cfg.artifactHost, deps.cfg.contentHost];
  app.removeAllContentTypeParsers();

  // The one hook, first: the hardening headers go on before any answer (so a refusal carries them too), then the host fence,
  // then the method fence. A hook that answers must return the reply.
  app.addHook('onRequest', async (req, reply) => {
    reply.headers(HARDENING);
    if (hostFence(req.headers.host, hosts) === 'misdirected') return answer(reply, ARTIFACT_FENCE_REFUSALS.misdirected, TEXT, MISDIRECTED_BODY);
    if (!artifactMethodAllowed(req.method)) return answer(reply.header('allow', 'GET, HEAD'), 405, TEXT, METHOD_BODY);
    return undefined;
  });

  const notFound = (_req: unknown, reply: FastifyReply): FastifyReply => answer(reply, 404, HTML, ARTIFACT_NOT_FOUND_BODY);
  // The four routes of spec 3.4. A1 answers the identical 404 on all of them; A3 fills three.
  app.get('/', notFound);
  app.get('/a/:token', notFound);
  app.get('/c/:token/*', notFound);
  app.get('/clear', notFound);
  app.setNotFoundHandler(notFound);
  // A fixed body: no request detail, no error text, and no log line (the request path holds a token).
  app.setErrorHandler((_err, _req, reply) => answer(reply, 500, TEXT, ERROR_BODY));
  return app;
}

/** A fresh listen state, `pending`. */
export function createArtifactListenerState(): ArtifactListenerState {
  let state: 'pending' | 'listening' | 'down' = 'pending';
  return { read: () => state, mark: (s) => { state = s; } };
}

/** Listen the artifact instance on loopback. NEVER throws: a failed listen (the port is taken) writes one warning, marks the
 *  tier `down` and resolves `down`, so the console's own listen after it still runs. With the tier off there is nothing to
 *  listen on and it resolves `down` with no log. */
export async function listenArtifactServer(app: FastifyInstance, port: number): Promise<'listening' | 'down'> {
  const instance = app.artifactServer;
  const state = app.artifactListener;
  if (instance === null || state === null) return 'down';
  try {
    await instance.listen({ host: '127.0.0.1', port });
  } catch (err) {
    const raw = (err as { code?: unknown } | null)?.code;
    const code = typeof raw === 'string' && raw !== '' ? raw : 'error';
    console.warn(`ccrc-server: artifact tier off — could not listen on 127.0.0.1:${port} (${code})`);
    state.mark('down');
    return 'down';
  }
  state.mark('listening');
  return 'listening';
}

/** The console instance's side of the fence: a request naming either artifact host answers 421 before any other hook, the auth
 *  gate included, so an artifact host never reaches the console's routes. With the tier off it adds nothing. */
export function installConsoleHostFence(app: FastifyInstance, cfg: ArtifactConfig): void {
  if (cfg.state !== 'on') return;
  const hosts = [cfg.artifactHost, cfg.contentHost];
  app.addHook('onRequest', async (req, reply) => {
    if (namesArtifactHost(req.headers.host, hosts)) return refuseRoute(reply, 'misdirected');
    return undefined;
  });
}
