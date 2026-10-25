// D-6778 / D-6779 (mail inbox, MI-5): `GET /api/mail/inbox`, the caller's own ackable mail, read-only,
// and its refusals record nothing.
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_REPLAY_CEILING_ERROR } from '../src/coord/store.js';
import { renderEnvelope } from '../src/coord/envelope.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { SECRET_MASK, readMailInboxAnswer, MAIL_INBOX_PAGE_MAX_BYTES } from '../../shared/api.js';

const TOKEN = 'f'.repeat(64);
const UUID = 'a'.repeat(36);
const ME = 'demo-quiet-mesa';
const OTHER = 'demo-calm-ridge';

const seed = (home: string, id: string, uuid = UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };

const fill = (n: number): string => {
  let s = '';
  for (let i = 0; s.length < n; i++) s += createHash('sha256').update(`inbox:${i}`).digest('base64url');
  return s.slice(0, n);
};
const SECRET = ['sk', 'ant', 'oat01', fill(95)].join('-');

const open = async (over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-inbox-route-');
  seed(home, ME);
  seed(home, OTHER, 'c'.repeat(36));
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  return { app, coord, home };
};

/** Queue one delivery whose stored envelope is the real renderer's, so the inbox parses it back. */
const queue = (coord: CoordStore, toId: string, body: string, runId: number | null = null, subject = 'fixture'): number => {
  const m = coord.insertMail({ fromId: 'demo-sender', fromUuid: 'u-sender', toId, runId,
                               kind: 'status', subject, body, artifacts: [] });
  // The delivery id is only known after queueing; render with a placeholder and re-store is not possible, so
  // queue first with the mail id and rewrite the envelope to carry the delivery id (what the ingress does).
  const d = coord.queueDelivery(m.id, toId, 'pending');
  coord.db.prepare('UPDATE mail_deliveries SET envelope = ? WHERE id = ?').run(
    renderEnvelope({ id: d.id, fromId: 'demo-sender', toId, runId: null, program: null, wave: null, waveOf: null,
                     kind: 'status', subject, body, artifacts: [] }), d.id);
  return d.id;
};

const get = (app: FastifyInstance, q: string, token: string | null = TOKEN) =>
  app.inject({ method: 'GET', url: `/api/mail/inbox${q}`, headers: token === null ? {} : { 'x-ccrc-mail-token': token } });
const mine = `?fromId=${ME}&fromUuid=${UUID}`;

const rejectionCount = (c: CoordStore): number =>
  (c.db.prepare('SELECT COUNT(*) AS n FROM mail_rejections').get() as { n: number }).n;

describe('GET /api/mail/inbox (D-6778)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('without the box token: 401 unauthenticated', async () => {
    const w = await open(); app = w.app;
    const res = await get(app, mine, null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });

  it('with a missing pair: 400 bad-kind', async () => {
    const w = await open(); app = w.app;
    const res = await get(app, `?fromId=${ME}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-kind' });
  });

  it('with a stale uuid: 403 stale-uuid', async () => {
    const w = await open(); app = w.app;
    const res = await get(app, `?fromId=${ME}&fromUuid=${'b'.repeat(36)}`);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'stale-uuid' });
  });

  it('with an unlistable registry: registry-unmeasurable', async () => {
    const w = await open({ io: unlistableIO }); app = w.app;
    const res = await get(app, mine);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
  });

  it('no refusal of the read writes a mail_rejections row', async () => {
    const w = await open(); app = w.app;
    const before = rejectionCount(w.coord);
    await get(app, mine, null);                                              // 401
    await get(app, `?fromId=${ME}`);                                         // bad pair
    await get(app, `?fromId=demo-nobody&fromUuid=${UUID}`);                  // unknown-sender
    await get(app, `?fromId=${ME}&fromUuid=${'b'.repeat(36)}`);              // stale-uuid
    expect(rejectionCount(w.coord)).toBe(before);
    await app.close();
    const u = await open({ io: unlistableIO }); app = u.app;
    const b2 = rejectionCount(u.coord);
    const res = await get(app, mine);                                        // registry-unmeasurable
    expect(res.json()).toMatchObject({ error: 'registry-unmeasurable' });
    expect(rejectionCount(u.coord)).toBe(b2);
  });

  it('the caller\'s two ackable deliveries come back oldest first, each with its deliveryId', async () => {
    const w = await open(); app = w.app;
    const a = queue(w.coord, ME, 'first body');
    const b = queue(w.coord, ME, 'second body');
    const res = await get(app, mine);
    expect(res.statusCode).toBe(200);
    const ans = readMailInboxAnswer(res.json());
    expect(ans).not.toBeNull();
    expect(ans!.deliveries.map((d) => d.deliveryId)).toEqual([a, b]);
    expect(ans!.deliveries[0]!.text).toContain('first body');
    expect(ans!.deliveries[0]!.text).toContain(`delivery: ${a}`);
    expect(ans!.remaining).toBe(0);
    expect(ans!.abandoned).toBe(0);
  });

  it('another session\'s mail is never in the answer', async () => {
    const w = await open(); app = w.app;
    queue(w.coord, OTHER, 'not for me');
    const mineId = queue(w.coord, ME, 'for me');
    const ans = readMailInboxAnswer((await get(app, mine)).json())!;
    expect(ans.deliveries.map((d) => d.deliveryId)).toEqual([mineId]);
    expect(JSON.stringify(ans)).not.toContain('not for me');
  });

  it('a park-ceiling rejection is counted in abandoned and not returned', async () => {
    const w = await open(); app = w.app;
    const ok = queue(w.coord, ME, 'live');
    const parked = queue(w.coord, ME, 'parked forever');
    w.coord.rejectDelivery(parked, 'undeliverable', 'park ceiling fixture');
    const ans = readMailInboxAnswer((await get(app, mine)).json())!;
    expect(ans.deliveries.map((d) => d.deliveryId)).toEqual([ok]);
    expect(ans.abandoned).toBe(1);
  });

  it('a replay-ceiling park whose run is closed is neither returned nor counted in abandoned', async () => {
    const w = await open(); app = w.app;
    const r = w.coord.openRun({ program: 'program-a', title: 'run-a', project: 'project-a', wave: 1, waveOf: 2,
                                claimedBy: 'demo-coordinator' });
    if (!('id' in r)) throw new Error('openRun refused');
    const d = queue(w.coord, ME, 'closed brief', r.id);
    w.coord.rejectDelivery(d, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
    expect(w.coord.advance(r.id, 'failed', 'coordinator')).toMatchObject({ ok: true });
    const ans = readMailInboxAnswer((await get(app, mine)).json())!;
    expect(ans.deliveries).toEqual([]);
    expect(ans.abandoned).toBe(0);
  });

  it('the text is masked', async () => {
    const w = await open(); app = w.app;
    queue(w.coord, ME, `rotate ${SECRET} now`);
    const res = await get(app, mine);
    expect(res.body).toContain(SECRET_MASK);
    expect(res.body).not.toContain(SECRET);
  });

  it('pages at MAIL_INBOX_PAGE_MAX_BYTES and counts the rest in remaining', async () => {
    const w = await open(); app = w.app;
    const big = 'y'.repeat(8 * 1024);
    for (let i = 0; i < 4; i++) queue(w.coord, ME, big);
    const ans = readMailInboxAnswer((await get(app, mine)).json())!;
    expect(ans.deliveries.length).toBe(2);
    expect(ans.remaining).toBe(2);
    expect(ans.deliveries.reduce((n, d) => n + Buffer.byteLength(d.text), 0)).toBeLessThanOrEqual(MAIL_INBOX_PAGE_MAX_BYTES);
  });

  it('the read changes no row', async () => {
    const w = await open(); app = w.app;
    queue(w.coord, ME, 'one'); queue(w.coord, ME, 'two');
    const parked = queue(w.coord, ME, 'three');
    w.coord.rejectDelivery(parked, 'undeliverable', 'park ceiling fixture');
    const dump = (): string => JSON.stringify([
      w.coord.db.prepare('SELECT * FROM mail_deliveries ORDER BY id').all(),
      w.coord.db.prepare('SELECT * FROM mail ORDER BY id').all(),
      w.coord.db.prepare('SELECT * FROM mail_rejections ORDER BY id').all(),
    ]);
    const before = dump();
    await get(app, mine);
    await get(app, `?fromId=${ME}&fromUuid=${'b'.repeat(36)}`);
    expect(dump()).toBe(before);
  });

  it('GET /api/mail/inbox is not answered by the :id route', async () => {
    const w = await open(); app = w.app;
    const res = await get(app, mine);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, deliveries: [], remaining: 0, abandoned: 0 });
    expect(res.json().error).toBeUndefined();
  });
});

describe('readMailInboxAnswer (D-6778)', () => {
  it('reads the shape and refuses anything else', () => {
    expect(readMailInboxAnswer({ ok: true, deliveries: [{ deliveryId: 3, text: 't' }], remaining: 0, abandoned: 1 }))
      .toEqual({ ok: true, deliveries: [{ deliveryId: 3, text: 't' }], remaining: 0, abandoned: 1 });
    for (const bad of [null, 'x', {}, { ok: false }, { ok: true, deliveries: 'x', remaining: 0, abandoned: 0 },
      { ok: true, deliveries: [{ deliveryId: '3', text: 't' }], remaining: 0, abandoned: 0 },
      { ok: true, deliveries: [], remaining: -1, abandoned: 0 }, { ok: true, deliveries: [], remaining: 0 }]) {
      expect(readMailInboxAnswer(bad)).toBeNull();
    }
  });
});
