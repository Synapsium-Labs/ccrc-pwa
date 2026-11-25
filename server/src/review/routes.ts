// Capability read door. The store owns the snapshot and the expiry decision is shared with its writers.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  isReviewToken, REVIEW_IDLE_DAYS_HEADER, REVIEW_IDLE_MS, REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_OPEN_BODY_BYTES,
  REVIEW_OPEN_HEADERS, REVIEW_OPEN_STREAMS, REVIEW_OPEN_STREAMS_PER_SHARE, REVIEW_PAGE_HEADERS, REVIEW_SEND_IDLE_MS,
  REVIEW_SHARED_AT_HEADER, REVIEW_VERSION_HEADER,
} from '../../../shared/docsReview.js';
import { REFUSAL_STATUS } from '../../../shared/refusal.js';
import { expiryOf, type ReviewEntry } from './policy.js';
import type { ReviewRemoval } from '../../../shared/docsReview.js';
import type { ReviewStore } from './store.js';

type ReviewAccess = { store: ReviewStore; wall: () => number };

export function registerReviewOpenRoute(app: FastifyInstance, access: ReviewAccess | null): void {
  let active = 0;
  const shares = new Map<string, number>();
  const cleaning = new Set<string>();
  const cleanup = (store: ReviewStore, entry: ReviewEntry, why: ReviewRemoval, now: number): void => {
    const key = `${entry.tokenHash}:${entry.rev}`;
    if (cleaning.has(key)) return;
    cleaning.add(key);
    void Promise.resolve().then(() => store.remove(entry.tokenHash, entry.rev, why, now))
      .catch(() => undefined).finally(() => { cleaning.delete(key); });
  };
  void app.register(async (scope) => {
    // Once the bounded body has been read, rejected JSON is an absent token, not a transport error.
    // Keep Fastify's JSON safety checks and leave framing and body-limit failures to Fastify.
    const parseJson = scope.getDefaultJsonParser('error', 'error');
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser<string>('application/json', { parseAs: 'string' }, (req, body, done) => {
      parseJson(req, body, (error, value) => done(null, error ? undefined : value));
    });
    // Let Fastify enforce the same bounded read for every other media type; none supplies a token.
    scope.addContentTypeParser<Buffer>('*', { parseAs: 'buffer' }, (_req, _body, done) => done(null, undefined));
    const headers = (reply: FastifyReply): void => {
      for (const [name, value] of Object.entries(REVIEW_OPEN_HEADERS)) reply.header(name, value);
    };
    const failure = (reply: FastifyReply, error: 'not-found' | 'too-large' | 'busy') => {
      headers(reply);
      // The review wire says `busy` for send capacity, not the generic 409 conflict with that word.
      return reply.code(REFUSAL_STATUS[error === 'busy' ? 'rate-limited' : error]).send({ ok: false, error });
    };
    scope.setErrorHandler((error, _req, reply) => {
      if (reply.raw.headersSent || reply.raw.destroyed || reply.raw.writableEnded) return;
      // Fastify stages stream headers on both reply and raw response before the first byte.
      for (const name of ['content-type', REVIEW_SHARED_AT_HEADER, REVIEW_VERSION_HEADER, REVIEW_IDLE_DAYS_HEADER]) {
        reply.removeHeader(name);
      }
      const tooLarge = typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
      failure(reply, tooLarge ? 'too-large' : 'not-found');
    });
    scope.post('/api/review/open', {
      bodyLimit: REVIEW_OPEN_BODY_BYTES,
      onRequest: async (req, reply) => {
        if (req.headers[REVIEW_MARKER_HEADER] !== REVIEW_MARKER_VALUE) return failure(reply, 'not-found');
        // Invalid metadata must reach the bounded fallback, never the JSON parser.
        if (req.headers['content-type'] !== undefined && req.mediaType === undefined) {
          req.headers = { 'content-type': undefined };
        }
      },
    }, async (req, reply) => {
      const body = req.body as { token?: unknown } | null;
      const token = body?.token;
      if (typeof token !== 'string' || !isReviewToken(token) || access === null) return failure(reply, 'not-found');
      const { store, wall } = access;
      const entry = store.byToken(token);
      if (entry === null) return failure(reply, 'not-found');
      const now = wall();
      const expiry = expiryOf(entry, now);
      if (!expiry.live) {
        cleanup(store, entry, expiry.why, now);
        return failure(reply, 'not-found');
      }
      const count = shares.get(entry.tokenHash) ?? 0;
      if (count >= REVIEW_OPEN_STREAMS_PER_SHARE || active >= REVIEW_OPEN_STREAMS) return failure(reply, 'busy');
      active++;
      shares.set(entry.tokenHash, count + 1);
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let source: Awaited<ReturnType<ReviewStore['openBytes']>> = null;
      const release = () => {
        if (closed) return;
        closed = true;
        if (timer !== undefined) clearTimeout(timer);
        active--;
        const remaining = (shares.get(entry.tokenHash) ?? 1) - 1;
        if (remaining === 0) shares.delete(entry.tokenHash); else shares.set(entry.tokenHash, remaining);
        source?.stream.destroy();
      };
      const reset = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => reply.raw.destroy(), REVIEW_SEND_IDLE_MS);
        timer.unref();
      };
      reply.raw.once('close', release);
      reply.raw.once('finish', release);
      reset();
      try { source = await store.openBytes(entry.tokenHash, entry.version); } catch { source = null; }
      if (closed) { source?.stream.destroy(); return reply; }
      if (source === null) { release(); return failure(reply, 'not-found'); }
      const current = store.byToken(token);
      const checkedAt = wall();
      if (current === null || current.version !== entry.version) {
        release();
        return failure(reply, 'not-found');
      }
      const currentExpiry = expiryOf(current, checkedAt);
      if (!currentExpiry.live) {
        release();
        cleanup(store, current, currentExpiry.why, checkedAt);
        return failure(reply, 'not-found');
      }
      // A successful write callback marks bytes handed to the socket, not a source read or a peer acknowledgement.
      const write = reply.raw.write.bind(reply.raw);
      let viewed = false;
      reply.raw.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
        const cb = typeof encoding === 'function' ? encoding : callback;
        const enc = typeof encoding === 'string' ? encoding : undefined;
        return write(chunk as Uint8Array, enc as BufferEncoding, (error) => {
          if (!closed && !error) {
            reset();
            if (!viewed && reply.raw.headersSent) {
              viewed = true;
              void store.markViewed(current.tokenHash, current.rev, wall());
            }
          }
          if (typeof cb === 'function') cb(error);
        });
      }) as typeof reply.raw.write;
      headers(reply);
      reply.header(REVIEW_SHARED_AT_HEADER, String(entry.sharedAt))
        .header(REVIEW_VERSION_HEADER, String(entry.version))
        .header(REVIEW_IDLE_DAYS_HEADER, String(REVIEW_IDLE_MS / 86400000))
        .type('application/octet-stream');
      return reply.send(source.stream);
    });
  });
}

/**
 * The review page (draft-review design §3.5, Task R2.2). `GET /review` sends the built `review.html` with the page's
 * own header policy (`REVIEW_PAGE_HEADERS`, one home in L0). It reads the file itself and sends the bytes with
 * `reply.send`; it never calls the static plugin's `sendFile`, which runs the plugin's path filter (that refuses this
 * very file) and its `setHeaders` (which would turn `no-store` into `no-cache`), review finding N6.
 *
 * The file is read on every request, not once at registration: it is a few kilobytes, the operating system caches
 * it, and the shell (`index.html`) is read per request by the plugin too, so a tree replaced under a running server
 * (the fallback deploy) never pairs a stale page with new hashed assets. A missing root or an unreadable file is a
 * 404 with `no-store`, never the app shell: the page's own policy must not be replaced by the shell's.
 *
 * `GET /review.html` and `GET /review/` are registered only to answer 404 with `no-store`. They are not exempt from
 * the auth gate, so armed and with no session the gate answers 401 first; either way a mistyped `/review/#token`
 * never lands under the app shell's policy. A query string on `/review` reaches the page route, as Fastify routes
 * on the path. The routes are registered on `app` itself, in the form the source scanners read.
 */
export function registerReviewPageRoutes(app: FastifyInstance, pwaRoot: string | null): void {
  const notFound = (reply: FastifyReply) =>
    reply.code(404).header('cache-control', 'no-store').send({ ok: false, error: 'not-found' });
  app.get('/review', async (_req, reply) => {
    if (pwaRoot === null) return notFound(reply);
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(pwaRoot, 'review.html'));
    } catch {
      return notFound(reply);
    }
    for (const [name, value] of Object.entries(REVIEW_PAGE_HEADERS)) reply.header(name, value);
    return reply.type('text/html; charset=utf-8').send(bytes);
  });
  app.get('/review.html', async (_req, reply) => {
    return notFound(reply);
  });
  app.get('/review/', async (_req, reply) => {
    return notFound(reply);
  });
}
