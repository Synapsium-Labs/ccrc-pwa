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

describe("today's peer refusal bodies, exactly (characterization for #2726)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });
  const two = async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f']) seed(home, to);
    return withMail(home);
  };

  it('duplicate', async () => {
    const w = await two(); app = w.app;
    await send(app, PEER);
    expect((await send(app, PEER)).json()).toEqual({ ok: false, error: 'duplicate',
      detail: 'an outstanding peer mail from demo-quiet-mesa to demo-calm-ridge with this subject is already queued' });
  });
  it('the pair arm', async () => {
    const w = await two(); app = w.app;
    for (let i = 0; i < 3; i++) await send(app, { ...PEER, subject: `q ${i}` });
    expect((await send(app, { ...PEER, subject: 'one more' })).json()).toEqual({ ok: false, error: 'peer-quota',
      detail: '3 peer mails from demo-quiet-mesa to demo-calm-ridge are already outstanding' });
  });
  it('the hourly arm', async () => {
    const w = await two(); app = w.app;
    for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e']) {
      for (let i = 0; i < 3; i++) await send(app, { ...PEER, toId: to, subject: `q ${i}` });
    }
    expect((await send(app, { ...PEER, toId: 'demo-f', subject: 'one more' })).json()).toEqual({ ok: false,
      error: 'peer-quota', detail: 'demo-quiet-mesa has sent 12 peer mails in the last hour' });
  });
  it('a kind answer with no inReplyTo is counted like any peer mail', async () => {
    const w = await two(); app = w.app;
    for (let i = 0; i < 3; i++) await send(app, { ...PEER, subject: `q ${i}` });
    expect((await send(app, { ...PEER, kind: 'answer', subject: 'a reply' })).statusCode).toBe(429);
  });
});

describe('an invited reply (#2726 (a))', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  // demo-quiet-mesa is the replier throughout; demo-calm-ridge asks it.
  const ASKER = { ...PEER, fromId: 'demo-calm-ridge', toId: 'demo-quiet-mesa' };
  const REPLY = { ...PEER, kind: 'answer', subject: 're: peer q' };
  const deliveryOf = (coord: CoordStore, mailId: number): number =>
    (coord.db.prepare('SELECT id FROM mail_deliveries WHERE mailId = ?').get(mailId) as { id: number }).id;
  const answersMail = (coord: CoordStore, mailId: number): number | null =>
    (coord.db.prepare('SELECT answersMail AS a FROM mail WHERE id = ?').get(mailId) as { a: number | null }).a;
  const sessions = async (...extra: string[]) => {
    const home = mkTmp('ccrc-peerq-');
    for (const id of ['demo-quiet-mesa', 'demo-calm-ridge', ...extra]) seed(home, id);
    return withMail(home);
  };
  /** demo-calm-ridge asks; answers the delivery id demo-quiet-mesa sees, and the asked mail's own id. */
  const ask = async (a: FastifyInstance, coord: CoordStore, subject = 'can you check') => {
    const res = await send(a, { ...ASKER, subject });
    expect(res.statusCode).toBe(202);
    const mailId = (res.json() as { id: number }).id;
    return { mailId, delivery: deliveryOf(coord, mailId) };
  };
  /** The replier's pair is full: three unacked mails out to demo-calm-ridge. */
  const fillPair = async (a: FastifyInstance) => {
    for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
      expect((await send(a, { ...PEER, subject: `unasked ${i}` })).statusCode).toBe(202);
    }
  };

  it('W0-20: with the pair full, the asked-for reply is accepted, recorded as answering the mail, and refuses nothing', async () => {
    const w = await sessions(); app = w.app;
    await fillPair(app);
    const q = await ask(app, w.coord);
    const res = await send(app, { ...REPLY, inReplyTo: q.delivery });
    expect(res.statusCode).toBe(202);
    expect(answersMail(w.coord, (res.json() as { id: number }).id)).toBe(q.mailId);
    expect(w.coord.rejections()).toEqual([]);
  });

  it('a second reply to the same mail is ordinary peer mail, and the full pair refuses it, saying why', async () => {
    const w = await sessions(); app = w.app;
    await fillPair(app);
    const q = await ask(app, w.coord);
    expect((await send(app, { ...REPLY, inReplyTo: q.delivery })).statusCode).toBe(202);
    const again = await send(app, { ...REPLY, subject: 're: peer q, again', inReplyTo: q.delivery });
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ error: 'peer-quota', detail: expect.stringContaining('already answered') });
  });

  it('the hourly arm does not refuse it, and it does not charge the hour', async () => {
    const w = await sessions('demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f'); app = w.app;
    for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e']) {
      for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
        expect((await send(app, { ...PEER, toId: to, subject: `q ${i}` })).statusCode).toBe(202);
      }
    }
    const q = await ask(app, w.coord);
    expect((await send(app, { ...REPLY, inReplyTo: q.delivery })).statusCode).toBe(202);
    expect(w.coord.peerMailAtsInLastHour('demo-quiet-mesa', Date.now())).toHaveLength(PEER_MAIL_HOURLY);
    expect((await send(app, { ...PEER, toId: 'demo-f', subject: 'unasked' })).statusCode).toBe(429);
  });

  it('invited replies hold no slot: three outstanding to one peer, and an unasked mail to it still goes', async () => {
    const w = await sessions(); app = w.app;
    for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
      const q = await ask(app, w.coord, `question ${i}`);
      expect((await send(app, { ...REPLY, subject: `re: question ${i}`, inReplyTo: q.delivery })).statusCode).toBe(202);
    }
    expect((await send(app, { ...PEER, subject: 'unasked' })).statusCode).toBe(202);
  });

  it('the duplicate probe does not stop it: its subject may repeat an outstanding unasked mail', async () => {
    const w = await sessions(); app = w.app;
    expect((await send(app, { ...PEER, subject: 'the answer' })).statusCode).toBe(202);
    const q = await ask(app, w.coord);
    expect((await send(app, { ...REPLY, subject: 'the answer', inReplyTo: q.delivery })).statusCode).toBe(202);
  });

  it.each([
    ['is not kind answer', 'status', 'asker', 'an invited reply is kind answer, not status'],
    ['answers a mail from a third session', 'answer', 'third-from', 'is not a mail from demo-calm-ridge'],
    ['answers a delivery to a third session', 'answer', 'third-to', 'was not delivered to demo-quiet-mesa'],
    ['names no delivery', 'answer', 'none', 'inReplyTo 999999 names no delivery'],
  ] as const)('not invited when it %s: counted, and the full pair refuses it with the reason', async (_w, kind, which, why) => {
    const w = await sessions('demo-third'); app = w.app;
    await fillPair(app);
    let inReplyTo = 999_999;
    if (which === 'asker') inReplyTo = (await ask(app, w.coord)).delivery;
    if (which === 'third-from') {
      const r = await send(app, { ...PEER, fromId: 'demo-third', toId: 'demo-quiet-mesa', subject: 'from a third' });
      inReplyTo = deliveryOf(w.coord, (r.json() as { id: number }).id);
    }
    if (which === 'third-to') {
      const r = await send(app, { ...ASKER, toId: 'demo-third', subject: 'to a third' });
      inReplyTo = deliveryOf(w.coord, (r.json() as { id: number }).id);
    }
    const res = await send(app, { ...REPLY, kind, inReplyTo });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'peer-quota', detail: expect.stringContaining(`not an invited reply: `) });
    expect((res.json() as { detail: string }).detail).toContain(why);
  });

  it('run mail stays dark: a reply with a runId and an inReplyTo records no answersMail', async () => {
    const w = await sessions(); app = w.app;
    const q = await ask(app, w.coord);
    const run = w.coord.openRun({ program: 'build9b', title: 'dark', project: 'demo', wave: 1, waveOf: 1,
      claimedBy: 'demo-coordinator' }) as { id: number };
    const res = await send(app, { ...REPLY, runId: run.id, inReplyTo: q.delivery });
    expect(res.statusCode).toBe(202);
    expect(answersMail(w.coord, (res.json() as { id: number }).id)).toBeNull();
    expect(w.coord.invitation(q.delivery)).toMatchObject({ answered: false });
  });

  it.each([['a string', '7'], ['zero', 0], ['a negative', -1], ['a fraction', 1.5]] as const)(
    'inReplyTo as %s is 400 bad-kind', async (_w, inReplyTo) => {
      const w = await sessions(); app = w.app;
      const res = await send(app, { ...REPLY, inReplyTo });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'bad-kind', detail: expect.stringContaining('inReplyTo') });
    });

  it('inReplyTo null is no inReplyTo', async () => {
    const w = await sessions(); app = w.app;
    expect((await send(app, { ...REPLY, inReplyTo: null })).statusCode).toBe(202);
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
    // The sender's peer-hour stands at 0 — `peerMailAtsInLastHour` reads
    // `runId IS NULL` rows only. If run rows bled into it, this send would
    // be the "13th" and 429.
    expect((await send(app, PEER)).statusCode).toBe(202);
  });
});
