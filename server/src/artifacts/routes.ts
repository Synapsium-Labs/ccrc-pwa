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
// route answers the identical 404 page; A3 fills `/a/:token`, `/c/:token/*` and `/clear`. A3.1 fills `/a/:token`: the wrapper,
// built in `wrapper.ts` from the capability the store finds live for the token.
//
// THE FENCES. Every request first meets the host fence (421 when `Host` is not one of the two artifact hosts) and then the method
// fence (405 unless GET or HEAD). `installConsoleHostFence` is the console's side: a request naming an artifact host, in any
// port spelling, answers 421 before the auth gate runs. Both decide in `policy.ts`; this file acts.
//
// A FAILED LISTEN TURNS THE TIER OFF, NEVER THE CONSOLE: `listenArtifactServer` never throws. It writes one warning, marks the
// listen state `down`, and the console's own listen, which follows it in `index.ts`, still runs.
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  artifactMethodAllowed, clientErrorAction, frameworkErrorStatus, hostFence, namesArtifactHost, type ArtifactConfig, type ArtifactListenWord,
} from './policy.js';
import type { ArtifactStore } from './store.js';
import { ARTIFACT_ENDED_BODY, wrapperDestOk, wrapperDocument } from './wrapper.js';
import { refuseRoute } from '../refuse.js';
import { ARTIFACT_FENCE_REFUSALS } from '../../../shared/refusal.js';

/** The listen state of the artifact listener: `pending` until `listenArtifactServer` has run. Built once in `buildServer`'s body. */
export interface ArtifactListenerState {
  read(): ArtifactListenWord;
  mark(s: Exclude<ArtifactListenWord, 'pending'>): void;
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
  /** The capability store: the one thing a route reads (X5 A3.1). It asks the session store itself whether a capability's
   *  minting session still stands, so this instance has no other dependency and no cookie. */
  store: ArtifactStore;
}

/** The fixed page every unknown or unfilled path answers (spec 3.4): one sentence, no script, no reference to anything. */
export const ARTIFACT_NOT_FOUND_BODY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>ccrc artifacts</title></head><body><p>This host serves ccrc artifacts by private link only.</p></body></html>';

const MISDIRECTED_BODY = 'Misdirected request.';
const METHOD_BODY = 'Method not allowed.';
const ERROR_BODY = 'Something went wrong.';
const BAD_REQUEST_BODY = 'Bad request.';
const TIMEOUT_BODY = 'Request timeout.';
const EXPECTATION_BODY = 'Expectation failed.';
/** The wrapper's answer to a request that is not a top-level navigation (spec 3.4): no capability is read for it. */
const FORBIDDEN_BODY = 'Forbidden.';

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
function rawAnswer(status: 400 | 408 | 413 | 431, body: string): string {
  const reason = status === 431 ? 'Request Header Fields Too Large' : status === 413 ? 'Payload Too Large'
    : status === 408 ? 'Request Timeout' : 'Bad Request';
  const headers = { ...HARDENING, 'content-type': TEXT, 'content-length': String(Buffer.byteLength(body)), connection: 'close' };
  return `HTTP/1.1 ${status} ${reason}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n${body}`;
}

/** The artifact instance. Synchronous, with no plugin and no content-type parser, so no body is ever read. */
export function buildArtifactServer(deps: ArtifactRouteDeps): FastifyInstance {
  // `frameworkErrors`: Fastify answers a malformed percent-escape (400) and an over-long path parameter (414) itself, before any
  // hook, with a body that ECHOES the request path, and the path holds a capability token. Answered here with fixed words and
  // the same headers instead (the status from `frameworkErrorStatus`); the host fence has not run for these two, which reach no
  // route.
  // `clientErrorHandler`: a request Node cannot parse (a bad request line, an unknown method, Transfer-Encoding beside
  // Content-Length, an oversized header, a chunk extension past Node's limit) or one that outlives Node's request timeout is
  // answered on the socket before Fastify sees it; here with fixed words and the same headers, never the default bare answer.
  // `clientErrorAction` decides: the status from `clientErrorStatus` (400, 408, 413 or 431), or a destroy with nothing written
  // when the socket's response in flight has its headers on the wire. Nothing is logged and nothing of the request is echoed.
  // `http.requireHostHeader: false`: Node answers a request with no `Host` line with a bare 400 before Fastify runs; without
  // the check the request reaches the host fence, which answers its 421 with the hardening headers. Node's own default
  // handling of an `Expect` other than 100-continue is a bare 417, so a `checkExpectation` listener (below) answers it.
  // `return503OnClosing: false`: while the instance closes, Fastify's default answers a request still arriving on an open
  // connection with its own bare 503 and a JSON body, before any hook. Off, such a request meets the hook and the routes
  // like any other, so it too carries the hardening headers and the fixed words (X5 A2, the A1 review's item 3).
  const app = Fastify({
    logger: false,
    return503OnClosing: false,
    http: { requireHostHeader: false },
    frameworkErrors: (err, _req, reply) => {
      const status = frameworkErrorStatus((err as { code?: unknown }).code);
      return answer(reply, status, TEXT, status === 500 ? ERROR_BODY : BAD_REQUEST_BODY);
    },
    clientErrorHandler: (err, socket) => {
      // The response in flight on this socket, if any, and whether its headers are on the wire: the two fields Node's own
      // handler reads (`_httpMessage._headerSent`). Once they are, an answer written now would land inside its body, so
      // `clientErrorAction` destroys instead (X5 A3).
      const inflight = (socket as { _httpMessage?: { _headerSent?: unknown } | null })._httpMessage;
      const act = clientErrorAction((err as { code?: unknown }).code, socket.writable, inflight?._headerSent === true);
      if (act.kind === 'destroy') { socket.destroy(); return; }
      socket.end(rawAnswer(act.status, act.status === 408 ? TIMEOUT_BODY : BAD_REQUEST_BODY));
    },
  });
  const hosts = [deps.cfg.artifactHost, deps.cfg.contentHost];
  app.removeAllContentTypeParsers();
  // An `Expect` header other than `100-continue` (a bare 417 by Node's default): the same fixed words and headers as every
  // other answer, no request detail, no log line. The body is never read; the connection closes.
  app.server.on('checkExpectation', (_req, res) => {
    res.writeHead(417, { ...HARDENING, 'content-type': TEXT, 'content-length': String(Buffer.byteLength(EXPECTATION_BODY)), connection: 'close' });
    res.end(EXPECTATION_BODY);
  });

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
  // The wrapper (X5 A3.1). First the fetch-metadata fence, which reads no capability: a request that is not a top-level
  // navigation is the fixed 403. Then the one look-up: every token that does not name a live capability (malformed, unknown,
  // revoked, idle, expired, its session ended) gets the same 404 page, byte for byte. A live one has its idle clock moved and is
  // answered with the wrapper; its six headers replace the hardening CSP and the rest equal the hardening set. Nothing is logged.
  app.get<{ Params: { token: string } }>('/a/:token', (req, reply) => {
    if (!wrapperDestOk(req.headers['sec-fetch-dest'])) return answer(reply, 403, TEXT, FORBIDDEN_BODY);
    const { token } = req.params;
    const c = deps.store.lookup(token);
    if (c === null) return answer(reply, 404, HTML, ARTIFACT_ENDED_BODY);
    deps.store.touch(c.id);
    const doc = wrapperDocument(c, token, deps.cfg.contentOrigin);
    return reply.code(200).headers(HARDENING).headers(doc.headers).header('content-type', HTML).send(doc.html);
  });
  app.get('/c/:token/*', notFound);
  app.get('/clear', notFound);
  app.setNotFoundHandler(notFound);
  // A fixed body: no request detail, no error text, and no log line (the request path holds a token).
  app.setErrorHandler((_err, _req, reply) => answer(reply, 500, TEXT, ERROR_BODY));
  return app;
}

/** A fresh listen state, `pending`. */
export function createArtifactListenerState(): ArtifactListenerState {
  let state: ArtifactListenWord = 'pending';
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
