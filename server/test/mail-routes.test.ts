// The ingress. Two halves: the rejection table (pinned BOTH directions, the
// discipline `whitelist-subset.test.ts` and `wsaudit.test.ts` already
// established), and the happy path.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { MAIL_REJECT_CODES } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const UUID = 'a'.repeat(36);

const seed = (home: string, id: string, uuid = UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const withMail = async (home: string) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord });
  return { app, coord };
};

const send = (app: FastifyInstance, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: '/api/mail',
    headers: token === null ? {} : { 'x-ccrc-mail-token': token },
    payload: body as Record<string, unknown> });

const ack = (app: FastifyInstance, id: number, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: `/api/mail/${id}/ack`,
    headers: token === null ? {} : { 'x-ccrc-mail-token': token },
    payload: body as Record<string, unknown> });

const GOOD = { fromId: 'demo-quiet-mesa', fromUuid: UUID, toId: 'coordinator',
               kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [] };

describe('POST /api/mail — the rejection table', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('accepts a well-formed message and records one queued delivery', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'demo-coordinator' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ ok: true, id: expect.any(Number) });
    // `dueDeliveries` needs a `replayMs` second arg (deviation D-10, already
    // landed in Task 3) — the literal here stands in for Task 8's own
    // `MAIL_REPLAY_MS`, which does not exist in this tree yet; a freshly
    // queued row (`nextAttemptAt` defaults to 0) is due regardless of its
    // value.
    expect(w.coord.dueDeliveries(Date.now(), 60_000).length).toBe(1);
  });

  // Data-only rows (never a closure in the tuple: `it.each`'s generic
  // inference over a mixed array-of-arrays does not reliably keep a function
  // value callable at its own position, and a spread of a widened union type
  // is a compile error waiting to happen) — the override merges onto GOOD,
  // and only the `unauthenticated` row swaps the token instead.
  const REJECT_CASES: [code: string, status: number, override: Record<string, unknown>][] = [
    ['unauthenticated', 401, {}],
    ['unknown-sender', 403, { fromId: 'nobody-here' }],
    ['stale-uuid', 403, { fromUuid: 'b'.repeat(36) }],
    ['unknown-recipient', 404, { toId: 'nobody-here' }],
    ['unknown-run', 404, { runId: 4242 }],
    ['bad-kind', 400, { kind: 'gossip' }],
    ['oversize', 413, { body: 'x'.repeat(8 * 1024 + 1) }],
  ];

  it.each(REJECT_CASES)('refuses %s', async (code, status, override) => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const token = code === 'unauthenticated' ? 'wrong' : TOKEN;
    const res = await send(app!, { ...GOOD, ...override }, token);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ ok: false, error: code });
    // "a rejected message is a fact about the fleet" (spec:147-148)
    expect(w.coord.rejections().map((r) => r.code)).toContain(code);
    // …and nothing was queued for delivery.
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  // Fix-round finding 3/5: `/api/notify`'s one-deploy-generation `legacy`
  // tolerance (an ABSENT token, checkMailToken's `'legacy'` verdict) does NOT
  // extend to `/api/mail` — it has no pre-existing deployed caller a rollout
  // could strand, and the spec lists `unauthenticated` as a plain, total
  // rejection code for it (spec:136-148) with no tolerance carved out. This
  // was entirely unpinned before: `send`'s `token` parameter supports `null`
  // (no header at all) but nothing in this file ever called it that way, so
  // a mutant widening `verdict === 'bad'` back to `!== 'ok'` — accepting a
  // tokenless request as `/api/notify` does — survived the whole suite.
  it('refuses a request with NO token header at all — /api/mail grants no legacy tolerance', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const res = await send(app, GOOD, null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    // Unlike `/api/notify` (which has no coordination store to write into and
    // relies on a `console.warn`), the mail routes DO have one — the refusal
    // must be recorded, so "was a tokenless POST ever accepted" stays an
    // answerable question through the rollout window.
    expect(w.coord.rejections().map((r) => r.code)).toContain('unauthenticated');
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('measures the 8KB cap in UTF-8 BYTES, not code units', async () => {
    // A body of 2100 astral characters is 2100 string units and 8400 bytes —
    // `hookstate.ts:128-135` already had to learn this distinction.
    const home = mkTmp('ccrc-mail-'); seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'demo-coordinator', body: '𝔘'.repeat(2100) });
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize' });
  });

  it('rejects an artifact list that carries a PAYLOAD instead of a path', async () => {
    // spec:52-53 — artifact = PATHS, not payloads. A non-string entry, and a
    // relative path, are both a bad-kind of artifact and reuse the ingress
    // vocabulary rather than growing a fourteenth code.
    const home = mkTmp('ccrc-mail-'); seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    const payload = await send(app, { ...GOOD, toId: 'demo-coordinator', artifacts: [{ data: 'x' }] });
    expect(payload.statusCode).toBe(400);
    expect(payload.json()).toMatchObject({ ok: false, error: 'bad-kind' });
    const relative = await send(app, { ...GOOD, toId: 'demo-coordinator', artifacts: ['relative/path.png'] });
    expect(relative.statusCode).toBe(400);
    expect(relative.json()).toMatchObject({ ok: false, error: 'bad-kind' });
  });
});

describe('the rejection table is total, in both directions', () => {
  // The linkage discipline `wsaudit.test.ts:52-100` established: the union and
  // the emitters are one set, and neither may grow alone. A code nobody emits
  // is a promise the server does not keep; an emitted code nobody declared is
  // a 500 waiting for a client that switches on it.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const coordDir = path.resolve(here, '../src/coord');
  const sources = (): string =>
    readdirSync(coordDir).filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(path.join(coordDir, f), 'utf8')).join('\n');

  it('every declared INGRESS/DONE-AUTHORITY code is emitted somewhere in server/src/coord', () => {
    // 'undeliverable' is the one DELIVERY-group code (MAIL_REJECT_CODES's own
    // comment names three groups: ingress, delivery, done-authority). It is
    // emitted by `watch.ts`'s mail sweep — Task 8, not landed in this tree —
    // and `watch.ts` sits outside `server/src/coord` entirely, so asserting it
    // here would fail through no fault of this task's own diff. Recorded as a
    // deviation rather than silently narrowing MAIL_REJECT_CODES or widening
    // this scan to a file this task does not touch.
    const src = sources();
    for (const code of MAIL_REJECT_CODES) {
      if (code === 'undeliverable') continue;
      expect(src, code).toContain(`'${code}'`);
    }
  });

  it('every quoted kebab token in server/src/coord that looks like a code is declared', () => {
    // Deliberately over-broad, then filtered by an explicit allowlist of
    // NON-code kebab literals, so a new code cannot slip in unnamed.
    const NOT_CODES = new Set([
      'x-ccrc-mail-token',   // coord/token.ts's header name
      'not-configured',      // the generic "no store wired" answer, shared with push/notifyLog
      'no-commits',          // coord/fingerprint.ts — a DoneRun verdict, not a mail code
      'packed-refs',         // coord/gitref.ts — a git filename
      'bad-transition',      // coord/store.ts — AdvanceResult, not a mail code
      'claimed-by-another',  // coord/store.ts — OpenRunResult, not a mail code
    ]);
    for (const m of sources().matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)) {
      const tok = m[1]!;
      if (NOT_CODES.has(tok)) continue;
      expect((MAIL_REJECT_CODES as readonly string[]).includes(tok), `${tok} is not a declared code`)
        .toBe(true);
    }
  });
});

describe('POST /api/mail/:id/ack', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('acks once, and a second ack is not an error but is not a second ack either', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = w.coord.dueDeliveries(Date.now(), 60_000)[0]!.id;

    const first = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, already: false });

    const second = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, already: true });
  });

  it('applies the SAME token and attribution gate as the ingress', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = w.coord.dueDeliveries(Date.now(), 60_000)[0]!.id;

    const wrongToken = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID }, 'wrong');
    expect(wrongToken.statusCode).toBe(401);
    expect(wrongToken.json()).toMatchObject({ ok: false, error: 'unauthenticated' });

    // Fix-round finding 3/5: no legacy tolerance on the ack route either —
    // see the matching ingress test above for the full rationale.
    const noToken = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID }, null);
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json()).toMatchObject({ ok: false, error: 'unauthenticated' });

    const staleUuid = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: 'b'.repeat(36) });
    expect(staleUuid.statusCode).toBe(403);
    expect(staleUuid.json()).toMatchObject({ ok: false, error: 'stale-uuid' });

    const unknownSender = await ack(app, deliveryId, { fromId: 'nobody-here', fromUuid: UUID });
    expect(unknownSender.statusCode).toBe(403);
    expect(unknownSender.json()).toMatchObject({ ok: false, error: 'unknown-sender' });
  });

  it('refuses to let one session ack another session\'s delivery', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = w.coord.dueDeliveries(Date.now(), 60_000)[0]!.id;

    const res = await ack(app, deliveryId, { fromId: 'demo-quiet-mesa', fromUuid: UUID });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
    // The delivery itself is untouched — still queued, not acked.
    expect(w.coord.delivery(deliveryId)?.state).toBe('queued');
  });
});
