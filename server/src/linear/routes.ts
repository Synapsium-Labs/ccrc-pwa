import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isLinearKeyShape, type LinearConnectionAnswer, type LinearConnectionView } from '../../../shared/linear.js';
import { LINEAR_REF_MAX_CHARS } from '../workspaceCreate.js';
import { refuseRoute } from '../refuse.js';
import type { AccountGate } from '../accounts/gate.js';
import { valueDigestHex } from '../token/files.js';
import { verifyLinearKey, type FetchLike } from './client.js';
import {
  keyTailOf, readLinearDetails, readLinearKey, recordLinearCheck, removeLinearConnection,
  withConnectionLock, writeLinearConnection, type LinearKeyRead,
} from './connection.js';
import { resolveName } from './resolve.js';
import { checkOutcomeOf, linearConnectionView, type KeyMeasure } from './view.js';

export interface LinearRouteOpts {
  /** The config's ccrc dir (`cfg.ccrcDir`), where `linear.key` and `linear.json` live. */
  ccrcDir: string;
  /**
   * The account gate (`accounts/gate.ts`), built by the composition root. REQUIRED, not optional: the
   * connection's two writes take the credential posture through it, and a route file that could be registered
   * without one is a credential write with no gate.
   */
  gate: AccountGate;
  /** Test seams: the network, the deadline and the clock. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/** The body bound of the connection's write: a key is at most `LINEAR_KEY_MAX_CHARS` characters, so two kilobytes
 *  holds the whole JSON with room, and a larger body is refused before it is parsed. */
const PUT_BODY_LIMIT = 2048;

const NO_STORE = 'no-store';
const noStore = {
  onRequest: async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => { reply.header('cache-control', NO_STORE); },
};

/**
 * The connection's body errors, as fixed words. Fastify's own parse error text can quote a fragment of the
 * body, and on the key's route the body IS the key, so no parser message is ever forwarded.
 */
const bodyError = (err: Error & { statusCode?: number }, _req: FastifyRequest, reply: FastifyReply): FastifyReply =>
  refuseRoute(reply, err.statusCode === 413 ? 'oversize' : 'bad-request');

const measure = (k: LinearKeyRead): KeyMeasure =>
  k.kind === 'key' ? { kind: 'key', digest: valueDigestHex(k.key) } : { kind: k.kind };

/**
 * `GET /api/linear/resolve?ref=<text>`: the PREVIEW read. It tells the new-session
 * sheet what a pasted name would become, and the real title when Linear can be
 * asked, before the operator commits to a slug they cannot change.
 *
 * Session-gated like every PWA read (it is NOT in `auth/gate.ts`'s EXEMPT table)
 * and carries no box token. L4: it validates the query and replies; the answer
 * itself is `resolve.ts`'s (shared with the create route), the grammar is
 * `shared/slug.ts`, and every failure arm degrades to the offline title with its
 * fixed word as `reason`. The key is read at use time from its file, so a key
 * connected a moment ago is used on the next request.
 *
 * The one thing it writes is the 401 marker: a Linear `unauthorised` marks the
 * connection rejected (`markLinearRejected`, which compares digests so a key
 * replaced meanwhile is never condemned), so Settings tells the truth next time it
 * is opened. That write failing never changes the answer. Linear's response text,
 * the key and the digest never reach this reply or a log line.
 *
 * THE CONNECTION'S ROUTES (named workspaces S4b, design §5.1) are in this file too,
 * so `auth-gate.test.ts`'s scanner reads all of them. None is exempt and none takes
 * the box token. `GET` and `POST …/check` are session reads and acts; `PUT` and
 * `DELETE` put and remove a credential, so they take the account gate with a
 * step-up (D-5511, D-5512): refused while auth is unarmed, from an insecure origin,
 * and without a recent step-up. All four answer `Cache-Control: no-store`.
 */
export function registerLinearRoutes(app: FastifyInstance, opts: LinearRouteOpts): void {
  const now = opts.now ?? Date.now;
  const net = { fetch: opts.fetch, timeoutMs: opts.timeoutMs };

  app.get('/api/linear/resolve', noStore, async (req, reply) => {
    const q: unknown = req.query;
    const ref = typeof q === 'object' && q !== null && 'ref' in q ? (q as { ref: unknown }).ref : undefined;
    if (typeof ref !== 'string') return refuseRoute(reply, 'bad-ref');
    if (ref.length > LINEAR_REF_MAX_CHARS) return refuseRoute(reply, 'ref-too-long');
    return resolveName(ref, { ccrcDir: opts.ccrcDir, ...net, now });
  });

  /** The section's state, from two fresh reads. Never the key. */
  const currentView = async (): Promise<LinearConnectionView> => {
    const [key, details] = await Promise.all([readLinearKey(opts.ccrcDir), readLinearDetails(opts.ccrcDir)]);
    return linearConnectionView(measure(key), details);
  };
  const answer = (connection: LinearConnectionView): LinearConnectionAnswer => ({ ok: true, connection });

  app.get('/api/linear/connection', noStore, async () => answer(await currentView()));

  app.put('/api/linear/connection', { bodyLimit: PUT_BODY_LIMIT, errorHandler: bodyError }, async (req, reply) => {
    // The gate first: before the body is read, before Linear is asked. It sets `no-store` FIRST, so every answer of
    // this route, its refusals and its success alike, carries it (`account-gate.test.ts`, and this route's own test).
    if (!opts.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    const body: unknown = req.body;
    const key = typeof body === 'object' && body !== null && 'key' in body ? (body as { key: unknown }).key : undefined;
    if (typeof key !== 'string') return refuseRoute(reply, 'bad-request');
    // BEFORE any call: a key that fails the shape rule would be stored differently from how it was verified, or
    // make `fetch` throw on a header and be reported as unreachable.
    if (!isLinearKeyShape(key)) return refuseRoute(reply, 'bad-key');

    const v = await verifyLinearKey(key, net);
    if (!v.ok) {
      // One literal word per arm (`refusal-status.test.ts` reads each from its call), never Linear's text.
      switch (v.reason) {
        case 'unauthorised': return refuseRoute(reply, 'key-rejected');
        case 'timeout': return refuseRoute(reply, 'timeout');
        case 'malformed': return refuseRoute(reply, 'malformed');
        case 'unreachable': return refuseRoute(reply, 'unreachable');
      }
    }

    try {
      await withConnectionLock(opts.ccrcDir, () => writeLinearConnection(opts.ccrcDir, key, {
        org: v.org, user: v.user, keyTail: keyTailOf(key), keyDigest: v.keyDigest, checkedAt: now(), outcome: 'ok',
      }));
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    return answer(await currentView());
  });

  app.post('/api/linear/connection/check', noStore, async (_req, reply) => {
    const key = await readLinearKey(opts.ccrcDir);
    // Nothing to check, and the view says which kind of nothing (not connected, or unreadable, or unusable).
    if (key.kind !== 'key') return refuseRoute(reply, 'not-connected', { connection: await currentView() });

    const v = await verifyLinearKey(key.key, net);
    try {
      // Recorded only if the key checked is still the stored one: a Connect that landed while Linear was being
      // asked wins, and its record is the answer below.
      await recordLinearCheck(
        opts.ccrcDir, v.keyDigest, v.ok ? 'ok' : checkOutcomeOf(v.reason), v.ok ? { org: v.org, user: v.user } : null, now(),
      );
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    return answer(await currentView());
  });

  app.delete('/api/linear/connection', async (req, reply) => {
    if (!opts.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;   // sets `no-store` first, as above
    try {
      await withConnectionLock(opts.ccrcDir, () => removeLinearConnection(opts.ccrcDir));
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    return answer(await currentView());
  });
}
