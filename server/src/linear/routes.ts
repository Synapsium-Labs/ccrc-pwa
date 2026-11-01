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
import { oneCallOutcome, type LinearRateRefusal, type LinearRateService } from './rate.js';
import { checkLinearSlot, type LinearRefresher } from './refresher.js';
import { resolveName } from './resolve.js';
import { LEGACY_SLOT, writeLegacyTeams } from './store.js';
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
  /**
   * The ONE Linear rate service (D-7670, spec §6.7), built by the composition root and passed through by `server.ts`.
   * REQUIRED as the service or `null`, so a direct caller decides. The preview and the Check again ask it on the
   * `request` lane (cookie-gated: reachable with no token while sign-in is unarmed); the Connect, account-gated with a
   * step-up, on the `floor`. Null (a test, a script): the preview's title is the offline one, and the Check again and
   * the Connect answer `linear-unavailable` before any Linear call (D-7684). The GET and the DELETE never call Linear
   * and are unchanged.
   */
  rate: LinearRateService | null;
  /**
   * The ONE background refresher (D-7668, spec §4.3), built by the composition root and passed through by `server.ts`.
   * REQUIRED as the refresher or `null`, as `rate` is. The Check again's key check counts as its slot's refresh, so a
   * miss straight after it does not ask Linear again. Null: the Check again answers `linear-unavailable` before any
   * Linear call (D-7684); no other route here needs it.
   */
  refresher: LinearRefresher | null;
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

/** `rate-limited` (429) with its detail and its wait, in the `Retry-After` header and the body (spec §6.7, §6.8). */
const refuseRate = (reply: FastifyReply, detail: LinearRateRefusal, retryAfterS: number): FastifyReply => {
  reply.header('retry-after', String(retryAfterS));
  return refuseRoute(reply, 'rate-limited', { detail, retryAfterS });
};

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
    const ref = typeof q === 'object' && q !== null && 'ref' in q ? q.ref : undefined;
    if (typeof ref !== 'string') return refuseRoute(reply, 'bad-ref');
    if (ref.length > LINEAR_REF_MAX_CHARS) return refuseRoute(reply, 'ref-too-long');
    return resolveName(ref, { ccrcDir: opts.ccrcDir, rate: opts.rate, ...net, now });
  });

  /** The section's state, from two fresh reads. Never the key. */
  const currentView = async (): Promise<LinearConnectionView> => {
    const [key, details] = await Promise.all([readLinearKey(opts.ccrcDir), readLinearDetails(opts.ccrcDir)]);
    return linearConnectionView(measure(key), details);
  };
  const answer = (connection: LinearConnectionView): LinearConnectionAnswer => ({ ok: true, connection });

  app.get('/api/linear/connection', noStore, async () => answer(await currentView()));

  // THE BODY ERRORS TOO. A parse error (400) or an oversize body (413) answers from `bodyError` BEFORE any handler or
  // gate runs, so the `no-store` they set never reaches it: the `onRequest` hook runs first of all, and carries the header
  // on those answers. The gate still sets it, harmlessly, for the refusals it makes.
  const write = { bodyLimit: PUT_BODY_LIMIT, errorHandler: bodyError, ...noStore };

  app.put('/api/linear/connection', write, async (req, reply) => {
    // The gate first: before the body is read, before Linear is asked. Every answer of this route, its refusals and
    // its success alike, carries `no-store` (`account-gate.test.ts`, and this route's own test).
    if (!opts.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    const body: unknown = req.body;
    const key = typeof body === 'object' && body !== null && 'key' in body ? body.key : undefined;
    if (typeof key !== 'string') return refuseRoute(reply, 'bad-request');
    // BEFORE any call: a key that fails the shape rule would be stored differently from how it was verified, or
    // make `fetch` throw on a header and be reported as unreachable.
    if (!isLinearKeyShape(key)) return refuseRoute(reply, 'bad-key');

    // The rate service before Linear (spec §6.7): the Connect is an account-gated key act, so it spends the floor of
    // the legacy slot, the one this key becomes, and never the request lane a tokenless caller can reach.
    const rate = opts.rate;
    if (rate === null) return refuseRoute(reply, 'linear-unavailable');
    const ask = rate.take({ lane: 'floor', slot: LEGACY_SLOT, calls: 1 });
    if (!ask.ok) return refuseRate(reply, ask.detail, ask.retryAfterS);
    const v = await verifyLinearKey(key, net);
    rate.settle(ask.grant, oneCallOutcome(v));
    if (!v.ok) {
      // One literal word per arm (`refusal-status.test.ts` reads each from its call), never Linear's text.
      switch (v.reason) {
        case 'unauthorised': return refuseRoute(reply, 'key-rejected');
        case 'forbidden': return refuseRoute(reply, 'key-forbidden');
        case 'timeout': return refuseRoute(reply, 'timeout');
        case 'malformed': return refuseRoute(reply, 'malformed');
        case 'unreachable': return refuseRoute(reply, 'unreachable');
        // Linear's own refusal over its limit (spec §6.7, §6.8): `rate-limited` `linear`, with the wait it gave.
        case 'rate-limited': return refuseRate(reply, 'linear', v.retryAfterS);
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
    // No rate service or no refresher, no Linear call: before any other work (D-7684).
    const { rate, refresher } = opts;
    if (rate === null || refresher === null) return refuseRoute(reply, 'linear-unavailable');
    const key = await readLinearKey(opts.ccrcDir);
    // Nothing to check, and the view says which kind of nothing (not connected, or unreadable, or unusable).
    if (key.kind !== 'key') return refuseRoute(reply, 'not-connected', { connection: await currentView() });

    // The §4.1 key check (spec §3.4): its query asks what the v1 record shows and also the workspace and its teams, a
    // page at a time, the key read again from `linear.key` before each page. The request lane: this route is
    // cookie-gated, so a tokenless caller on an unarmed box can reach it (spec §6.7).
    const checked = await checkLinearSlot({ ccrcDir: opts.ccrcDir, slot: LEGACY_SLOT, lane: 'request', rate, ...net });
    if (checked.kind === 'refused') return refuseRate(reply, checked.detail, checked.retryAfterS);
    const v = checked.check;
    // A check that reached Linear is this slot's refresh: its window starts again (spec §4.3).
    if (v.pagesSent > 0) refresher.checked(LEGACY_SLOT);
    // The key was gone, or replaced, when a page was due: nothing the check found describes the key now stored, so
    // nothing is recorded, and the answer is the pair as it now is (a Connect that landed meanwhile wins).
    if (!v.ok && v.reason === 'key-changed') return answer(await currentView());
    try {
      // Recorded only if the key checked is still the stored one: a Connect that landed while Linear was being
      // asked wins, and its record is the answer below.
      await recordLinearCheck(
        opts.ccrcDir, v.keyDigest, v.ok ? 'ok' : checkOutcomeOf(v.reason), v.ok ? { org: v.org, user: v.user } : null, now(),
      );
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    // What the check learned beyond the v1 record goes to `linear/legacy-teams.json`, under the lock and by the same
    // digest rule, and never into the pair. Learning it is not this route's answer, which stays the pair's view, so a
    // failure to write it is a fixed line and the answer below.
    const ws = v.ok ? v.workspace : null;
    if (ws !== null) {
      await writeLegacyTeams(opts.ccrcDir, v.keyDigest, {
        workspaceId: ws.id, name: ws.name, urlKey: ws.urlKey, teams: ws.teams, teamsAt: now(),
      }).catch(() => { console.warn('ccrc-server: linear: could not record what the legacy key reaches'); });
    }
    return answer(await currentView());
  });

  // DELETE reads no body, but a client may send one: it gets the same fixed-word refusal and bound as the PUT, never
  // Fastify's own parser text.
  app.delete('/api/linear/connection', write, async (req, reply) => {
    if (!opts.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    try {
      await withConnectionLock(opts.ccrcDir, () => removeLinearConnection(opts.ccrcDir));
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    return answer(await currentView());
  });
}
