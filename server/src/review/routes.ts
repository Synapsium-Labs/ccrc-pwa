// Capability read door. The store owns the snapshot and the expiry decision is shared with its writers.
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  isReviewToken, REVIEW_IDLE_MS, REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_OPEN_BODY_BYTES,
  REVIEW_OPEN_STREAMS, REVIEW_OPEN_STREAMS_PER_SHARE, REVIEW_SEND_IDLE_MS,
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
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff').header('content-disposition', 'attachment');
    };
    const failure = (reply: FastifyReply, error: 'not-found' | 'too-large' | 'busy') => {
      headers(reply);
      // The review wire says `busy` for send capacity, not the generic 409 conflict with that word.
      return reply.code(REFUSAL_STATUS[error === 'busy' ? 'rate-limited' : error]).send({ ok: false, error });
    };
    scope.setErrorHandler((error, _req, reply) => {
      if (reply.raw.headersSent || reply.raw.destroyed || reply.raw.writableEnded) return;
      // Fastify stages stream headers on both reply and raw response before the first byte.
      for (const name of ['content-type', 'x-ccrc-review-shared-at', 'x-ccrc-review-version', 'x-ccrc-review-idle-days']) {
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
      reply.header('x-ccrc-review-shared-at', String(entry.sharedAt))
        .header('x-ccrc-review-version', String(entry.version))
        .header('x-ccrc-review-idle-days', String(REVIEW_IDLE_MS / 86400000))
        .type('application/octet-stream');
      return reply.send(source.stream);
    });
  });
}
