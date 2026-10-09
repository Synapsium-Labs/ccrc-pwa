// The native Docs reader's request and response policy hooks (design 2026-10-01, section 3.8, section 5.3, section
// 3.4's registration; W3 refinements (e) and (o)): L4. They are installed INSIDE the one encapsulated docs plugin,
// so they run for the docs routes alone, after the root gate's own `onRequest` (F1), and never for a route outside
// the plugin or an unmatched URL.
//
// Ring (M7.10; the ring guard in `single-definition.test.ts`): this file may import fastify and name `reply`, and it
// DECIDES NOTHING. The provenance verdict, the refusal bodies, the log cadence, the body-error verdict, the response
// headers, the content-type allowlist, every status and the `Retry-After` seconds are L1's (`policy.ts`); this file
// applies them. It quotes no failure word and spells none of the response-policy header names or values: it sets
// whatever headers the verdict carries. A log line is `console.warn('ccrc-server: ...')`: the server runs
// `Fastify({ logger: false })`, so the request logger is a silent no-op.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DocsFailureBody } from '../../../shared/docs.js';
import {
  DOCS_DEFECT_MESSAGE, DOCS_FAILURE_HTTP, docsBodyErrorVerdict, docsForeignRequestBody, docsLogDue, docsProvenance,
  docsRetryAfterSeconds, docsSendPolicy,
} from './policy.js';

/**
 * Send one docs failure body: the status is `DOCS_FAILURE_HTTP`'s for its word, and `Retry-After` is sent exactly
 * when `docsRetryAfterSeconds` answers a number (`docs-busy` with a finite positive wait, `caps-unknown`); `null`
 * sends no header. Returns the reply, so an async hook or handler can `return sendDocsFailure(...)`.
 */
export function sendDocsFailure(reply: FastifyReply, body: DocsFailureBody): FastifyReply {
  reply.code(DOCS_FAILURE_HTTP[body.failure]);
  const retryAfterS = docsRetryAfterSeconds(body);
  if (retryAfterS !== null) reply.header('retry-after', String(retryAfterS));
  return reply.send(body);
}

/** A reply header as text for L1: absent stays `undefined` (one meaning: the route set none); a number reads as its
 *  decimal text; an array as its `', '`-join, so it never equals one allowed value. */
function replyHeaderText(reply: FastifyReply, name: string): string | undefined {
  const v = reply.getHeader(name);
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/** A thrown value's `code`, whatever the thrower set; `undefined` when the value is not an object or carries none.
 *  Fastify types a thrown value as `unknown`, and `docsBodyErrorVerdict` reads the code as `unknown` too. */
function errorCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
}

/**
 * The plugin's request policy, installed on the docs plugin's own instance (never the root):
 * - an `onRequest` hook applying `docsProvenance` to the request headers: a refusal answers `foreign-request`
 *   (`docsForeignRequestBody`, no `verdict`) through `sendDocsFailure`, so no handler runs and no exec is made, and
 *   logs `ccrc-server: docs refused a <why> request` when `docsLogDue` says so for that `why`;
 * - an error handler applying `docsBodyErrorVerdict` to the error's code: a refused request body answers its
 *   `bad-query` body; a defect is re-thrown as a fresh error carrying L1's `DOCS_DEFECT_MESSAGE` (the original as
 *   its `cause`), which hands it to the parent's (Fastify's default) error handler, so a defect stays a default 500,
 *   is never dressed as a docs word, and its body never carries the thrower's own message (a host path, stderr).
 * `lastLogged` is per call, so each server instance (and each test app) keeps its own minute per `why`. `nowMs` is
 * the clock; the test passes its own.
 */
export function installDocsRequestPolicy(app: FastifyInstance, nowMs: () => number = Date.now): void {
  const lastLogged = new Map<string, number>();
  app.addHook('onRequest', async (req, reply) => {
    const v = docsProvenance(req.headers);
    if (v.ok) return;
    const now = nowMs();
    if (docsLogDue(lastLogged.get(v.why), now)) {
      lastLogged.set(v.why, now);
      console.warn(`ccrc-server: docs refused a ${v.why} request`);
    }
    return sendDocsFailure(reply, docsForeignRequestBody(v));
  });
  app.setErrorHandler((err, _req, reply) => {
    const v = docsBodyErrorVerdict(errorCode(err));
    if (v.kind === 'defect') throw new Error(DOCS_DEFECT_MESSAGE, { cause: err });
    sendDocsFailure(reply, v.body);
  });
}

/**
 * The plugin's response policy: an `onSend` hook applying `docsSendPolicy` to every docs response, a gate refusal,
 * a provenance refusal and a default 500 included (each runs the matched route's `onSend`). It sets every header the
 * verdict carries; on `pass` it sends the payload unchanged; on `refuse` it removes the verdict's `remove` headers,
 * answers the verdict's status with the JSON of its body, and logs the refused type.
 */
export function installDocsResponsePolicy(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    const v = docsSendPolicy(
      reply.statusCode, replyHeaderText(reply, 'content-type') ?? '', replyHeaderText(reply, 'cache-control'),
    );
    reply.headers(v.headers);
    if (v.kind === 'pass') return payload;
    for (const name of v.remove) reply.removeHeader(name);
    reply.code(v.status);
    console.warn(`ccrc-server: docs response refused, content-type ${JSON.stringify(v.contentType)}`);
    return JSON.stringify(v.body);
  });
}
