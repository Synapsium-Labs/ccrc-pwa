// Overlord wave 164: the optional idempotency key on `POST /api/mail` (note
// `docs/superpowers/programs/overlord/mail-idempotency-key.md`). A sender names a `clientKey`; the ingress keeps one mail per
// (`fromId`, `clientKey`). A retry of the same mail answers the original id with `already: true` and queues no delivery; the same
// key on a different mail is refused `key-conflict` (409, recorded); a send without a key is exactly as before. The verdict is
// `mailKeyVerdict`'s (L1), and `mail_client_key_once` makes the uniqueness a fact of the database as well as of the route.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { isMailClientKey, MAIL_CLIENT_KEY_MAX } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, isMailClientKeyClash } from '../src/coord/store.js';
import * as mailKey from '../src/coord/mailKey.js';
import { mailKeyVerdictCases } from './sim/mailKeySets.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const UUID = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);

const seed = (home: string, id: string, uuid = UUID): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const dbPath = (home: string): string => path.join(home, '.ccrc', 'coord.db');

const withMail = async (home: string, over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(dbPath(home)));
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const send = (app: FastifyInstance, body: unknown) =>
  app.inject({ method: 'POST', url: '/api/mail', headers: { 'x-ccrc-mail-token': TOKEN },
    payload: body as Record<string, unknown> });

const PEER = { fromId: 'demo-quiet-mesa', fromUuid: UUID, toId: 'demo-calm-ridge',
               kind: 'status', subject: 'MERGED', body: 'the body', artifacts: [] as string[] };

const counts = (coord: CoordStore): [number, number] => [
  (coord.db.prepare('SELECT count(*) AS c FROM mail').get() as { c: number }).c,
  (coord.db.prepare('SELECT count(*) AS c FROM mail_deliveries').get() as { c: number }).c,
];

describe('mailKeyVerdict (L1): the oracle the mutation floor runs (sim/mailKeySets.ts)', () => {
  for (const [name, run] of Object.entries(mailKeyVerdictCases(mailKey))) it(name, run);
});

describe('isMailClientKey (L0)', () => {
  it('admits the client SAFE_RE words up to the bound, and nothing else', () => {
    for (const ok of ['a', 'merged-3045', 'A_b-9', 'x'.repeat(MAIL_CLIENT_KEY_MAX)]) expect(isMailClientKey(ok), ok).toBe(true);
    for (const bad of ['', 'x'.repeat(MAIL_CLIENT_KEY_MAX + 1), 'a b', 'a.b', 'a"b', 'é', 7, null, undefined, ['a']]) {
      expect(isMailClientKey(bad), String(bad)).toBe(false);
    }
  });
});

describe('POST /api/mail with a clientKey', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const two = async () => {
    const home = mkTmp('ccrc-mailkey-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge'); seed(home, 'demo-other', UUID_B);
    return { home, ...(await withMail(home)) };
  };

  it('the same key and the same mail give one mail and one delivery, and the retry answers the original id', async () => {
    const w = await two(); app = w.app;
    const first = await send(app, { ...PEER, clientKey: 'merged-3045' });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ ok: true, id: expect.any(Number), clientKey: 'merged-3045' });
    const again = await send(app, { ...PEER, clientKey: 'merged-3045' });
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ ok: true, id: first.json().id, already: true, clientKey: 'merged-3045' });
    expect(counts(w.coord)).toEqual([1, 1]);
    expect(w.coord.rejections()).toEqual([]);
  });

  it('a retry of an accepted peer mail answers same, never the outstanding-duplicate refusal', async () => {
    const w = await two(); app = w.app;
    const first = await send(app, { ...PEER, clientKey: 'k1' });
    // Without a key the same send is a 409 `duplicate` while the first is outstanding (mail-peer-quota.test.ts).
    expect((await send(app, PEER)).json()).toMatchObject({ error: 'duplicate' });
    const again = await send(app, { ...PEER, clientKey: 'k1' });
    expect(again.json()).toEqual({ ok: true, id: first.json().id, already: true, clientKey: 'k1' });
  });

  it('the same key on a different mail is refused key-conflict (409), recorded, and nothing is queued', async () => {
    const w = await two(); app = w.app;
    const first = await send(app, { ...PEER, clientKey: 'k1' });
    const other = await send(app, { ...PEER, body: 'another body', clientKey: 'k1' });
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ ok: false, error: 'key-conflict' });
    expect(other.json().detail).toContain(`mail ${first.json().id}`);
    expect(other.json().detail).toContain('body');
    expect(counts(w.coord)).toEqual([1, 1]);
    expect(w.coord.rejections().map((r) => [r.code, r.fromId])).toEqual([['key-conflict', 'demo-quiet-mesa']]);
  });

  it('the same key from another sender is a separate mail', async () => {
    const w = await two(); app = w.app;
    const a = await send(app, { ...PEER, clientKey: 'shared-key' });
    const b = await send(app, { ...PEER, fromId: 'demo-other', fromUuid: UUID_B, clientKey: 'shared-key' });
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(b.json()).toEqual({ ok: true, id: expect.any(Number), clientKey: 'shared-key' });
    expect(b.json().id).not.toBe(a.json().id);
    expect(counts(w.coord)).toEqual([2, 2]);
  });

  it('no key behaves as today: every accepted send is a new mail and the answer carries no already', async () => {
    const w = await two(); app = w.app;
    const a = await send(app, PEER);
    const b = await send(app, { ...PEER, subject: 'MERGED again' });
    const n = await send(app, { ...PEER, subject: 'third', clientKey: null });
    for (const r of [a, b, n]) {
      expect(r.statusCode).toBe(202);
      expect(r.json()).toEqual({ ok: true, id: expect.any(Number) });
    }
    expect(counts(w.coord)).toEqual([3, 3]);
    expect(w.coord.db.prepare('SELECT count(*) AS c FROM mail WHERE clientKey IS NOT NULL').get()).toEqual({ c: 0 });
  });

  it('the key survives a server restart', async () => {
    const w = await two(); app = w.app;
    const first = await send(app, { ...PEER, clientKey: 'k-restart' });
    await app.close(); app = undefined;
    w.coord.db.close();
    const again = await withMail(w.home); app = again.app;
    const retry = await send(app, { ...PEER, clientKey: 'k-restart' });
    expect(retry.json()).toEqual({ ok: true, id: first.json().id, already: true, clientKey: 'k-restart' });
    expect(counts(again.coord)).toEqual([1, 1]);
    const clash = await send(app, { ...PEER, subject: 'not the same', clientKey: 'k-restart' });
    expect(clash.statusCode).toBe(409);
  });

  it('a key of the wrong shape is refused bad-kind and nothing is stored', async () => {
    const w = await two(); app = w.app;
    for (const bad of ['', 'a b', 'x'.repeat(MAIL_CLIENT_KEY_MAX + 1), 7, ['k']]) {
      const r = await send(app, { ...PEER, clientKey: bad });
      expect([r.statusCode, r.json().error], String(bad)).toEqual([400, 'bad-kind']);
    }
    expect(counts(w.coord)).toEqual([0, 0]);
  });

  // Review 2725 F1: a different reply target under one key is a different mail, refused, never merged.
  it('the same key with a different inReplyTo is refused key-conflict naming inReplyTo', async () => {
    const w = await two(); app = w.app;
    const first = await send(app, { ...PEER, kind: 'answer', inReplyTo: 5, clientKey: 'k-reply' });
    expect(first.statusCode).toBe(202);
    const other = await send(app, { ...PEER, kind: 'answer', inReplyTo: 6, clientKey: 'k-reply' });
    expect([other.statusCode, other.json().error]).toEqual([409, 'key-conflict']);
    expect(other.json().detail).toContain('differs in inReplyTo');
    const none = await send(app, { ...PEER, kind: 'answer', clientKey: 'k-reply' });
    expect([none.statusCode, none.json().error]).toEqual([409, 'key-conflict']);
    const same = await send(app, { ...PEER, kind: 'answer', inReplyTo: 5, clientKey: 'k-reply' });
    expect(same.json()).toEqual({ ok: true, id: first.json().id, already: true, clientKey: 'k-reply' });
    expect(counts(w.coord)).toEqual([1, 1]);
  });

  // Review 2725 F4: SQLite keeps a lone surrogate as U+FFFD, so the retry compares as stored and is the same mail.
  it('a genuine retry of text holding a lone surrogate answers same', async () => {
    const w = await two(); app = w.app;
    const odd = { ...PEER, subject: 'half \ud800', body: 'x \udc00 y', clientKey: 'k-odd' };
    const first = await send(app, odd);
    expect(first.statusCode).toBe(202);
    const again = await send(app, odd);
    expect(again.json()).toEqual({ ok: true, id: first.json().id, already: true, clientKey: 'k-odd' });
    expect(counts(w.coord)).toEqual([1, 1]);
  });

  // Review 2725 F5: force the race through the store. The key read at check 6.5 answers no mail once, so the insert meets
  // `mail_client_key_once`; the route re-reads and answers same or key-conflict, never a 500.
  it('an insert that meets the unique index answers same or key-conflict, never a 500', async () => {
    const w = await two(); app = w.app;
    const first = await send(app, { ...PEER, clientKey: 'k-race' });
    for (const d of w.coord.dueDeliveries(Date.now(), 0)) w.coord.markAcked(d.id, Date.now());  // frees the peer duplicate arm
    const real = w.coord.mailByClientKey.bind(w.coord);
    let blind = 0;
    w.coord.mailByClientKey = (fromId: string, key: string) => (blind-- > 0 ? null : real(fromId, key));
    blind = 1;
    const same = await send(app, { ...PEER, clientKey: 'k-race' });
    expect([same.statusCode, same.json()]).toEqual([202, { ok: true, id: first.json().id, already: true, clientKey: 'k-race' }]);
    blind = 1;
    const clash = await send(app, { ...PEER, body: 'not the same', clientKey: 'k-race' });
    expect([clash.statusCode, clash.json().error]).toEqual([409, 'key-conflict']);
    expect(counts(w.coord)).toEqual([1, 1]);
    // A clash the re-read cannot explain (both reads blind) is not answered as anything: it fails as any insert error does,
    // and nothing is stored.
    blind = 2;
    const unexplained = await send(app, { ...PEER, subject: 'blind twice', clientKey: 'k-race' });
    expect(unexplained.statusCode).toBe(500);
    expect(counts(w.coord)).toEqual([1, 1]);
    blind = 0;
    // A send with no key never takes the catch's path: a keyless mail is accepted as ever.
    expect((await send(app, { ...PEER, subject: 'keyless' })).statusCode).toBe(202);
  });

  it('a stale sender is refused stale-uuid before the key is read', async () => {
    const w = await two(); app = w.app;
    await send(app, { ...PEER, clientKey: 'k1' });
    const r = await send(app, { ...PEER, fromUuid: UUID_B, clientKey: 'k1' });
    expect([r.statusCode, r.json().error]).toEqual([403, 'stale-uuid']);
  });
});

describe('mail_client_key_once (the database half)', () => {
  const store = (): CoordStore => new CoordStore(openCoordDb(dbPath(mkTmp('ccrc-mailkey-db-'))));
  const row = { fromId: 'demo-a', fromUuid: UUID, toId: 'demo-b', runId: null, kind: 'status' as const,
    subject: 's', body: 'b', artifacts: [] };

  it('refuses a second row with the same sender and key, and admits another sender, and any number of keyless rows', () => {
    const c = store();
    const first = c.insertMail({ ...row, clientKey: 'k' });
    expect(() => c.insertMail({ ...row, clientKey: 'k', body: 'other' })).toThrow(/UNIQUE/);
    expect(() => c.insertMail({ ...row, fromId: 'demo-c', clientKey: 'k' })).not.toThrow();
    c.insertMail(row); c.insertMail(row); c.insertMail({ ...row, clientKey: null });
    expect(c.mailByClientKey('demo-a', 'k')).toEqual({ id: first.id, toId: 'demo-b', runId: null, kind: 'status',
      subject: 's', body: 'b', artifacts: [], inReplyTo: null });
    expect(c.mailByClientKey('demo-a', 'absent')).toBeNull();
    expect(c.mailByClientKey('demo-z', 'k')).toBeNull();
  });

  it('stores inReplyTo as sent, and names its own clash and no other error', () => {
    const c = store();
    const r = c.insertMail({ ...row, clientKey: 'k2', inReplyTo: 9 });
    expect(c.mailByClientKey('demo-a', 'k2')).toMatchObject({ id: r.id, inReplyTo: 9 });
    let clash: unknown = null;
    try { c.insertMail({ ...row, clientKey: 'k2' }); } catch (e) { clash = e; }
    expect(isMailClientKeyClash(clash)).toBe(true);
    let other: unknown = null;
    try { c.db.exec('INSERT INTO mail (id, at) VALUES (1, 1)'); } catch (e) { other = e; }
    expect(other).not.toBeNull();
    expect(isMailClientKeyClash(other)).toBe(false);
    expect(isMailClientKeyClash(new Error('UNIQUE constraint failed: mail.answersMail'))).toBe(false);
    expect(isMailClientKeyClash('UNIQUE constraint failed: mail.fromId, mail.clientKey')).toBe(false);
  });
});
