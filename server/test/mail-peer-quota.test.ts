// WAVE 0 (Build 9b) — the peer-mail door (spec D10 hole 2): for
// `runId === null` traffic ONLY, three bounds at the ingress — one of a
// kind per (fromId,toId,subject) outstanding (409 duplicate), three
// outstanding per (fromId,toId) pair, twelve accepted an hour per sender
// (both 429 peer-quota) — every refusal recorded in mail_rejections.
// "Bound the producer, never the record": nothing DELETEs from mail/
// mail_deliveries, so the cap lives at the door or nowhere. Task 4 appends
// the dark-behavior pin: the identical traffic WITH a runId is
// byte-identically accepted.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PEER_MAIL_HOURLY, PEER_MAIL_MAX_OUTSTANDING } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
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

const withMail = async (home: string, over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const send = (app: FastifyInstance, body: unknown) =>
  app.inject({ method: 'POST', url: '/api/mail',
    headers: { 'x-ccrc-mail-token': TOKEN },
    payload: body as Record<string, unknown> });

// No runId — the peer lane. Concrete toId: role resolution is
// mail-routes.test.ts's subject, not this file's.
const PEER = { fromId: 'demo-quiet-mesa', fromUuid: UUID, toId: 'demo-calm-ridge',
               kind: 'question', subject: 'peer q', body: 'the body', artifacts: [] };

/** Ack every outstanding delivery — frees pair/duplicate slots WITHOUT
 *  touching the hourly count, which is a count of ACCEPTED mail rows, not
 *  of outstanding deliveries. (All rows here are still 'queued' — no sweep
 *  runs in this file — and dueDeliveries selects every queued row whose
 *  nextAttemptAt has passed, which a fresh row's default 0 always has.) */
const ackAll = (coord: CoordStore): void => {
  for (const d of coord.dueDeliveries(Date.now(), 0)) coord.markAcked(d.id, Date.now());
};

describe('POST /api/mail — peer-mail bounds (runId === null only)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses the same (fromId,toId,subject) while one is outstanding — 409 duplicate, recorded; an ack clears it', async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    const w = await withMail(home); app = w.app;
    expect((await send(app, PEER)).statusCode).toBe(202);
    const dup = await send(app, PEER);
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ ok: false, error: 'duplicate' });
    // "a rejected message is a fact about the fleet" — recorded with WHOSE
    // duplicate it was (the mail_rejections shape, store.ts recordRejection).
    expect(w.coord.rejections().map((r) => [r.code, r.fromId, r.toId, r.subject]))
      .toContainEqual(['duplicate', 'demo-quiet-mesa', 'demo-calm-ridge', 'peer q']);
    // …and nothing extra was queued.
    expect(w.coord.dueDeliveries(Date.now(), 0).length).toBe(1);
    // Outstanding, not forever: acked mail may be restated.
    ackAll(w.coord);
    expect((await send(app, PEER)).statusCode).toBe(202);
  });

  it('refuses a 4th outstanding mail to the same pair — 429 peer-quota, recorded; an ack frees the slot', async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    const w = await withMail(home); app = w.app;
    for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
      expect((await send(app, { ...PEER, subject: `q ${i}` })).statusCode).toBe(202);
    }
    const overflow = await send(app, { ...PEER, subject: 'one more' });
    expect(overflow.statusCode).toBe(429);
    expect(overflow.json()).toMatchObject({ ok: false, error: 'peer-quota' });
    expect(w.coord.rejections().map((r) => r.code)).toContain('peer-quota');
    ackAll(w.coord);
    expect((await send(app, { ...PEER, subject: 'one more' })).statusCode).toBe(202);
  });

  it('refuses the 13th accepted mail from one sender inside an hour — 429 peer-quota — and the window SLIDES', async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa');
    for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f']) seed(home, to);
    const w = await withMail(home); app = w.app;
    // 12 accepted = PEER_MAIL_MAX_OUTSTANDING (3, exactly AT the pair cap,
    // which refuses only the pair's 4th) x 4 recipients = PEER_MAIL_HOURLY.
    for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e']) {
      for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
        expect((await send(app, { ...PEER, toId: to, subject: `q ${i}` })).statusCode).toBe(202);
      }
    }
    // 13th: fresh recipient, fresh subject — only the hourly arm can refuse it.
    const res = await send(app, { ...PEER, toId: 'demo-f', subject: 'one more' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ ok: false, error: 'peer-quota' });
    // The window slides — it is `at > now - hour`, not a lifetime count:
    // age every accepted row past the hour and the same send passes.
    w.coord.db.prepare('UPDATE mail SET at = at - 3700000').run();
    expect((await send(app, { ...PEER, toId: 'demo-f', subject: 'one more' })).statusCode).toBe(202);
  });

  it('treats an explicit runId: null exactly as an absent one — the peer lane either way', async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    const w = await withMail(home); app = w.app;
    expect((await send(app, PEER)).statusCode).toBe(202);                      // runId absent
    const dup = await send(app, { ...PEER, runId: null });                      // runId explicit null
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ ok: false, error: 'duplicate' });
    expect(w.coord.rejections().map((r) => r.code)).toContain('duplicate');
  });
});

describe('run mail is DARK — the bounds structurally cannot touch runId-carrying traffic (D10)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const openRun = (coord: CoordStore) =>
    coord.openRun({ program: 'build9b', title: 'Wave 0 dark pin', project: 'demo',
                    wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' }) as { id: number };

  it('13 identical run mails — one pair, one subject, one hour — are all accepted, none recorded', async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    const w = await withMail(home); app = w.app;
    const r = openRun(w.coord);
    // ONE loop that violates ALL THREE peer bounds at once — the same
    // triple every time (duplicate), far past 3 outstanding to one pair,
    // past 12 in the hour — and every send is accepted with the same body
    // the route answered before this wave existed. 13 = PEER_MAIL_HOURLY+1
    // so the loop provably crosses the widest bound, not just the pair.
    for (let i = 0; i < PEER_MAIL_HOURLY + 1; i++) {
      const res = await send(app, { ...PEER, runId: r.id, kind: 'status', subject: 'wave-brief' });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ ok: true, id: expect.any(Number) });
    }
    expect(w.coord.rejections()).toEqual([]);          // no refusal was even RECORDED
    expect(w.coord.dueDeliveries(Date.now(), 0).length).toBe(PEER_MAIL_HOURLY + 1);
  });

  it('a FULL peer ledger does not shadow run mail — same pair, same subject, cap already spent', async () => {
    // THE mutant catcher for `if (runId === null)` itself. The store
    // probes are ALSO scoped `runId IS NULL`, so bare run mails sail
    // through even a leaked fence (their own rows never count) — the test
    // above cannot see that mutant. What a leaked fence DOES break is
    // this: a sender whose peer ledger is already full sending a RUN mail
    // through the same pair with the same subject — every peer bound
    // would refuse it, reading the standing peer rows.
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    const w = await withMail(home); app = w.app;
    // Spend the pair cap and leave 'peer q' outstanding.
    expect((await send(app, PEER)).statusCode).toBe(202);
    for (let i = 1; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
      expect((await send(app, { ...PEER, subject: `q ${i}` })).statusCode).toBe(202);
    }
    // A run mail across the same pair, SAME subject as an outstanding peer
    // mail: with the fence honest this is 202; with the fence leaked, the
    // duplicate arm answers 409 off the peer row.
    const r = openRun(w.coord);
    const res = await send(app, { ...PEER, runId: r.id, kind: 'status' });
    expect(res.statusCode).toBe(202);
    expect(w.coord.rejections()).toEqual([]);
  });

  it('run traffic never charges the peer hourly budget — 12 run mails, then a peer mail still passes', async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    const w = await withMail(home); app = w.app;
    const r = openRun(w.coord);
    for (let i = 0; i < PEER_MAIL_HOURLY; i++) {
      expect((await send(app, { ...PEER, runId: r.id, kind: 'status', subject: `run ${i}` }))
        .statusCode).toBe(202);
    }
    // The sender's peer-hour stands at 0 — `peerMailInLastHour` counts
    // `runId IS NULL` rows only. If run rows bled into it, this send would
    // be the "13th" and 429.
    expect((await send(app, PEER)).statusCode).toBe(202);
  });
});
