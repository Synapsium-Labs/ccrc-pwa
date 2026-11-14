// Overlord W1a, the card piece, PR B (plan `w1a-card.md` Task 4): `GET /api/sessions/:id/card`, the caller's own card. The
// box token, then the path's session is the caller, then the query's shape, then the registry's attribution of `byUuid`,
// then the gather, the render and the trim; the snapshot is stored once per id, the card hash names the trimmed text, a
// later page of a superseded card answers 409 `card-changed`, and a full read is recorded only once every page of one hash
// has been served to that conversation; the text is masked once, whole, before it is paged (review 2023 F2), and every
// answer says whether it `recorded` the read (F8). Fixture HOMEs only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { localIOFor, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MASKED_GET_ROUTES } from '../src/server.js';
import { registerContinuityRoutes, type ContinuityRouteDeps } from '../src/continuity/routes.js';
import { SECRET_MASK } from '../../shared/api.js';
import { CARD_NOTHING_LINE } from '../src/continuity/card.js';
import { CARD_PAGE_CHARS } from '../../shared/continuity-card.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '66666666-7777-8888-9999-000000000000';

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
let time: FakeTime;

beforeEach(() => {
  home = mkTmp('ccrc-card-route-');
  seedRow(home, ID, { uuid: UUID, project: 'project-a' });
  seedRow(home, OTHER, { uuid: OTHER_UUID, project: 'project-a' });
  time = fakeTime();
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});

const open = async (io?: FleetIO): Promise<FastifyInstance> => {
  const r = await appFor(home, recorder().run, { time: time.ports, ...(io ? { io } : {}) });
  coord = r.coord;
  await r.app.ready();
  return r.app;
};

const card = (a: FastifyInstance, q: Record<string, string | number> = {}, id = ID, token: string | null = ID_GATE_TOKEN) => {
  const query = new URLSearchParams(Object.entries({ byId: ID, byUuid: UUID, ...q }).map(([k, v]) => [k, String(v)]));
  return a.inject({ method: 'GET', url: `/api/sessions/${id}/card?${query}`, headers: token === null ? {} : { 'x-ccrc-mail-token': token } });
};

const reads = (): Record<string, unknown>[] => coord!.db.prepare('SELECT sessionId, uuid, snapshotId, hash, pages FROM continuity_card_reads ORDER BY id').all() as Record<string, unknown>[];
const snapshots = (): Record<string, unknown>[] => coord!.db.prepare('SELECT id, sessionId FROM continuity_snapshots').all() as Record<string, unknown>[];
/** Outstanding mail to the session, each with a long subject, so the card runs to several pages: `THREE_PAGES` of them make a
 *  three-page card. */
const THREE_PAGES = 15;
const mail = (n: number, tag = 's'): void => {
  for (let i = 0; i < n; i += 1) {
    const m = coord!.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status',
      subject: `${tag}${i} ${'x'.repeat(1000)}`, body: 'b', artifacts: [] });
    coord!.queueDelivery(m.id, ID, '<mail/>');
  }
};

describe('GET /api/sessions/:id/card: who may read it', () => {
  it('refuses without the box token (401), and reads nothing', async () => {
    app = await open();
    const res = await card(app, {}, ID, null);
    expect([res.statusCode, res.json().error]).toEqual([401, 'unauthenticated']);
    expect(snapshots()).toEqual([]);
  });

  it("refuses another session's card (403 not-owner), and a stale uuid (403 stale-uuid)", async () => {
    app = await open();
    const other = await card(app, {}, OTHER);
    expect([other.statusCode, other.json().error]).toEqual([403, 'not-owner']);
    const stale = await card(app, { byUuid: OTHER_UUID });
    expect([stale.statusCode, stale.json().error]).toEqual([403, 'stale-uuid']);
    expect(snapshots()).toEqual([]);
  });

  it('answers registry-unmeasurable (502) when the registry cannot be read', async () => {
    const io: FleetIO = { ...localIOFor(home), readdirMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    app = await open(io);
    const res = await card(app);
    expect([res.statusCode, res.json().error]).toEqual([502, 'registry-unmeasurable']);
    expect(snapshots()).toEqual([]);
  });

  it('refuses a malformed query 400: a page that is not a positive integer, a hash that is not one, a later page with no hash', async () => {
    app = await open();
    const bad: Record<string, string | number>[] = [{ page: '0' }, { page: 'x' }, { page: '-1' }, { hash: 'nope' }, { page: 2 }];
    for (const q of bad) {
      const res = await card(app, q);
      expect([res.statusCode, res.json().error]).toEqual([400, 'bad-request']);
    }
  });

  it('the card is masked in its handler, not by the answer hook (review 2023 F2: the hook masks each page alone)', () => {
    expect(MASKED_GET_ROUTES.has('/api/sessions/:id/card')).toBe(false);
  });
});

describe('GET /api/sessions/:id/card: the card, its snapshot and its read', () => {
  it('a one-page card: the never-empty line, a hash of its text, and a read recorded at once', async () => {
    app = await open();
    const res = await card(app);
    expect(res.statusCode).toBe(200);
    const b = res.json() as { ok: boolean; hash: string; snapshotId: string; page: number; pages: number; text: string };
    expect([b.ok, b.page, b.pages]).toEqual([true, 1, 1]);
    expect(b.text).toContain(CARD_NOTHING_LINE);
    expect(b.text).toContain('History: no read names this session');
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(reads()).toEqual([{ sessionId: ID, uuid: UUID, snapshotId: b.snapshotId, hash: b.hash, pages: 1 }]);
    expect(res.json().recorded).toBe(true);
  });

  it('two requests a minute apart over unchanged facts store one snapshot and answer one hash', async () => {
    app = await open();
    mail(2);
    const first = (await card(app)).json() as { hash: string; snapshotId: string };
    time.advance(60_000);
    const second = (await card(app)).json() as { hash: string; snapshotId: string };
    expect(second.hash).toBe(first.hash);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(snapshots()).toEqual([{ id: first.snapshotId, sessionId: ID }]);
    expect(reads()).toHaveLength(2);
  });

  it('a three-page card records a read only after page 3 with the same hash, and the pages join to the card', async () => {
    app = await open();
    mail(THREE_PAGES);
    const p1 = (await card(app)).json() as { hash: string; snapshotId: string; pages: number; text: string };
    expect(p1.pages).toBe(3);
    expect([...p1.text]).toHaveLength(CARD_PAGE_CHARS);
    expect(reads()).toEqual([]);
    const p2 = (await card(app, { page: 2, hash: p1.hash })).json() as { text: string; page: number; recorded: boolean };
    expect([p2.page, p2.recorded]).toEqual([2, false]);
    expect(reads()).toEqual([]);
    const p3 = (await card(app, { page: 3, hash: p1.hash })).json() as { text: string; recorded: boolean };
    expect(p3.recorded).toBe(true);
    expect(reads()).toEqual([{ sessionId: ID, uuid: UUID, snapshotId: p1.snapshotId, hash: p1.hash, pages: 3 }]);
    expect(p1.text + p2.text + p3.text).toContain('Card for lane-a-project-a');
    expect(p1.text + p2.text + p3.text).toMatch(/History: .*$/);
  });

  it('the last page alone is not a full read: a page that was not served keeps the read unrecorded', async () => {
    app = await open();
    mail(THREE_PAGES);
    const p1 = (await card(app)).json() as { hash: string };
    await card(app, { page: 3, hash: p1.hash });
    expect(reads()).toEqual([]);
    await card(app, { page: 2, hash: p1.hash });
    expect(reads()).toHaveLength(1);
  });

  it('a card that changed between pages answers 409 card-changed with the current hash, and records no read', async () => {
    app = await open();
    mail(THREE_PAGES);
    const p1 = (await card(app)).json() as { hash: string };
    mail(1, 'late');
    const res = await card(app, { page: 2, hash: p1.hash });
    expect(res.statusCode).toBe(409);
    const b = res.json() as { error: string; hash: string };
    expect(b.error).toBe('card-changed');
    expect(b.hash).not.toBe(p1.hash);
    expect(reads()).toEqual([]);
    // The snapshot of the new facts is stored before the refusal, so the current card is the one the 409 names.
    expect(snapshots()).toHaveLength(2);
    // Starting again at page 1 of the new hash, the pages served of the old one do not count toward it.
    const again = (await card(app)).json() as { hash: string; pages: number };
    expect(again.hash).toBe(b.hash);
    for (let p = 2; p <= again.pages; p += 1) await card(app, { page: p, hash: again.hash });
    expect(reads()).toEqual([expect.objectContaining({ hash: again.hash, pages: again.pages })]);
  });

  it('pages served of a superseded card never count toward the new one', async () => {
    app = await open();
    mail(THREE_PAGES);
    const old = (await card(app)).json() as { hash: string };
    await card(app, { page: 2, hash: old.hash });
    mail(1, 'late');
    const changed = (await card(app, { page: 3, hash: old.hash })).json() as { hash: string };
    await card(app, { page: 3, hash: changed.hash });
    expect(reads()).toEqual([]);
  });

  it('a page past the last is refused 400, naming how many there are', async () => {
    app = await open();
    const p1 = (await card(app)).json() as { hash: string };
    const res = await card(app, { page: 2, hash: p1.hash });
    expect([res.statusCode, res.json().error, res.json().detail]).toEqual([400, 'bad-request', 'the card has 1 page(s)']);
  });

  it('the snapshot is stored once per id, its facts without the time of rendering, and holds the last-served hash', async () => {
    app = await open();
    const a = (await card(app)).json() as { hash: string; snapshotId: string };
    mail(1);
    const b = (await card(app)).json() as { hash: string; snapshotId: string };
    expect(b.snapshotId).not.toBe(a.snapshotId);
    const rows = coord!.db.prepare('SELECT id, facts, hash, served FROM continuity_snapshots ORDER BY served').all() as
      { id: string; facts: string; hash: string; served: number }[];
    expect(rows.map((r) => [r.id, r.hash])).toEqual([[a.snapshotId, a.hash], [b.snapshotId, b.hash]]);
    for (const r of rows) expect(JSON.parse(r.facts)).not.toHaveProperty('at');
  });
});

describe('GET /api/sessions/:id/card: masking, the memo and the serve order (review 2023 F2, F8, F9, F11)', () => {
  const fill = (n: number, salt: string): string => {
    let out = '';
    for (let i = 0; out.length < n; i++) out += createHash('sha256').update(`${salt}:${i}`).digest('base64url');
    return out.slice(0, n);
  };
  /** An assembled credential of a masked shape, never a literal one. */
  const SECRET = ['sk', 'ant', 'oat01', fill(95, 'card')].join('-');

  it('a secret that crosses a page edge is masked whole: neither page carries any part of it', async () => {
    app = await open();
    const fillers: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const m = coord!.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status', subject: 'f'.repeat(900), body: 'b', artifacts: [] });
      coord!.queueDelivery(m.id, ID, '<mail/>');
      fillers.push(m.id);
    }
    const target = coord!.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status', subject: `${'Z'.repeat(SECRET.length)} tail`, body: 'b', artifacts: [] });
    coord!.queueDelivery(target.id, ID, '<mail/>');
    const whole = async (): Promise<{ pages: string[]; hash: string }> => {
      const p1 = (await card(app!)).json() as { hash: string; pages: number; text: string };
      const pages = [p1.text];
      for (let p = 2; p <= p1.pages; p += 1) pages.push(((await card(app!, { page: p, hash: p1.hash })).json() as { text: string }).text);
      return { pages, hash: p1.hash };
    };
    // Place the stand-in so it starts 20 characters before the first page's edge, by lengthening the last filler.
    const at = [...(await whole()).pages.join('')].join('').indexOf('Z'.repeat(SECRET.length));
    const shift = CARD_PAGE_CHARS - 20 - at;
    expect(shift).toBeGreaterThan(-900);
    expect(shift).toBeLessThan(100);
    coord!.db.prepare('UPDATE mail SET subject = ? WHERE id = ?').run('f'.repeat(900 + shift), fillers.at(-1)!);
    expect((await whole()).pages[0]!.endsWith('Z'.repeat(20))).toBe(true);
    coord!.db.prepare('UPDATE mail SET subject = ? WHERE id = ?').run(`${SECRET} tail`, target.id);
    const { pages } = await whole();
    const joined = pages.join('');
    expect(joined).toContain(SECRET_MASK);
    for (const piece of [SECRET, SECRET.slice(0, 20), SECRET.slice(-60), SECRET.slice(20, 60)]) expect(joined).not.toContain(piece);
  });

  /** The door alone, on a store of its own: attribution answers yes for any pair, so two conversations can read. */
  const bare = async (over: Partial<ContinuityRouteDeps> = {}): Promise<FastifyInstance> => {
    coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const a = Fastify({ logger: false });
    registerContinuityRoutes(a, {
      coord, mailToken: () => ID_GATE_TOKEN, attribute: async () => ({ ok: true }), wall: () => time.ports.clock.wall(),
      attributeReader: async () => ({ ok: true }),
      cardRegistry: { childMark: async () => ({ kind: 'none' }), incarnation: async () => ({ kind: 'absent' }), declaredIntent: () => false },
      setterStamp: async () => ({ kind: 'unmeasured', reason: 'absent' }),
      ...over,
    });
    await a.ready();
    return a;
  };
  const U = (n: number): string => `uuid-${n}`;

  it('the memo is keyed by conversation: pages served to another conversation of the session never complete a read', async () => {
    app = await bare();
    mail(THREE_PAGES);
    const p1 = (await card(app, { byUuid: U(1) })).json() as { hash: string };
    await card(app, { byUuid: U(1), page: 2, hash: p1.hash });
    expect((await card(app, { byUuid: U(2), page: 3, hash: p1.hash })).json().recorded).toBe(false);
    expect(reads()).toEqual([]);
    expect((await card(app, { byUuid: U(1), page: 3, hash: p1.hash })).json().recorded).toBe(true);
    expect(reads().map((r) => r['uuid'])).toEqual([U(1)]);
  });

  it('the memo is bounded: the conversation touched longest ago is dropped first', async () => {
    app = await bare({ cardMemoMax: 2 });
    mail(THREE_PAGES);
    const p1 = (await card(app, { byUuid: U(1) })).json() as { hash: string };
    await card(app, { byUuid: U(1), page: 2, hash: p1.hash });
    await card(app, { byUuid: U(2) });
    await card(app, { byUuid: U(3) });
    expect((await card(app, { byUuid: U(1), page: 3, hash: p1.hash })).json().recorded).toBe(false);
    expect(reads()).toEqual([]);
  });

  it('a snapshot write that fails answers write-failed, and records nothing', async () => {
    app = await bare();
    coord!.insertSnapshot = () => ({ ok: false });
    const res = await card(app);
    expect([res.statusCode, res.json().error]).toEqual([503, 'write-failed']);
    expect(reads()).toEqual([]);
  });

  it('a read write that fails answers write-failed and keeps the memo, so a retry of the last page records the read', async () => {
    app = await bare();
    mail(THREE_PAGES);
    const p1 = (await card(app)).json() as { hash: string };
    await card(app, { page: 2, hash: p1.hash });
    const real = coord!.insertCardRead.bind(coord);
    coord!.insertCardRead = () => ({ ok: false });
    const failed = await card(app, { page: 3, hash: p1.hash });
    expect([failed.statusCode, failed.json().error]).toEqual([503, 'write-failed']);
    coord!.insertCardRead = real;
    expect((await card(app, { page: 3, hash: p1.hash })).json().recorded).toBe(true);
    expect(reads()).toHaveLength(1);
  });

  it('answers unavailable (503) on a server with no coordination store, and gathers nothing', async () => {
    let gathered = 0;
    app = await bare({ coord: undefined, cardRegistry: { childMark: async () => { gathered += 1; return { kind: 'none' }; }, incarnation: async () => ({ kind: 'absent' }), declaredIntent: () => false } });
    const res = await card(app);
    expect([res.statusCode, res.json().error]).toEqual([503, 'unavailable']);
    expect(gathered).toBe(0);
  });

  it('A then B then A: serving A again makes it the current card (its serve order is recorded, not only its first)', async () => {
    app = await bare();
    const current = (): unknown => (coord!.db.prepare('SELECT id FROM continuity_snapshots WHERE sessionId = ? ORDER BY served DESC LIMIT 1').get(ID) as { id: string }).id;
    const a = (await card(app)).json() as { snapshotId: string };
    const m = coord!.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status', subject: 'b', body: 'b', artifacts: [] });
    const d = coord!.queueDelivery(m.id, ID, '<mail/>').id;
    const b = (await card(app)).json() as { snapshotId: string };
    expect(current()).toBe(b.snapshotId);
    coord!.db.prepare("UPDATE mail_deliveries SET state = 'acked' WHERE id = ?").run(d);
    expect(((await card(app)).json() as { snapshotId: string }).snapshotId).toBe(a.snapshotId);
    expect(current()).toBe(a.snapshotId);
  });

  it('the serve order is each session\'s own: another session\'s serves do not number this one\'s', async () => {
    app = await bare();
    await card(app);
    await card(app, { byId: OTHER }, OTHER);
    await card(app, { byId: OTHER }, OTHER);
    const served = coord!.db.prepare('SELECT sessionId, served FROM continuity_snapshots ORDER BY sessionId').all();
    expect(served).toEqual([{ sessionId: ID, served: 1 }, { sessionId: OTHER, served: 2 }]);
    // A first serve of a new session starts at 1, whatever another session has reached.
    coord!.db.prepare('DELETE FROM continuity_card_reads WHERE sessionId = ?').run(ID);   // reads before their snapshots (the foreign key)
    coord!.db.prepare('DELETE FROM continuity_snapshots WHERE sessionId = ?').run(ID);
    const m = coord!.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ID, runId: null, kind: 'status', subject: 'n', body: 'b', artifacts: [] });
    coord!.queueDelivery(m.id, ID, '<mail/>');
    await card(app);
    expect(coord!.db.prepare('SELECT served FROM continuity_snapshots WHERE sessionId = ?').get(ID)).toEqual({ served: 1 });
  });
});
