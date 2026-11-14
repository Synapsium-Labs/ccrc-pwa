// Overlord W1a, the start report (Task 2): `POST /api/sessions/:id/start`, the hook's report of a SessionStart. The box
// token first, then the path's session is the sender, then the body's shape, then the registry's attribution of the
// sender (`attributionVerdict`, the gate every box-token lane shares), then `insertStart` with the server's own clock,
// recording the reported conversation's `startedUuid` (review 1911, F4). Fixture HOMEs only.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerContinuityRoutes } from '../src/continuity/routes.js';
import { localIOFor, type FleetIO } from '../src/io.js';
import type { CoordStore } from '../src/coord/store.js';
import { FAKE_T0 } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;

beforeEach(() => {
  home = mkTmp('ccrc-start-route-');
  seedRow(home, ID, { uuid: UUID, project: 'project-a' });
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});

const open = async (io?: FleetIO): Promise<FastifyInstance> => {
  const r = await appFor(home, recorder().run, io ? { io } : {});
  coord = r.coord;
  await r.app.ready();
  return r.app;
};

const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  fromId: ID, fromUuid: UUID, reportId: 'r-0001-abcd', source: 'clear', model: 'claude-opus-5-5', rowIncarnation: '0189abcd-1234-5678-9abc-0123456789ab',
  reportedAt: FAKE_T0 - 50, ...over,
});

const post = (a: FastifyInstance, b: unknown, id = ID, token: string | null = ID_GATE_TOKEN) =>
  a.inject({
    method: 'POST', url: `/api/sessions/${id}/start`, payload: b as never,
    headers: token === null ? {} : { 'x-ccrc-mail-token': token },
  });

const rows = (): unknown[] => coord!.db.prepare('SELECT * FROM continuity_starts ORDER BY id').all();

describe('POST /api/sessions/:id/start', () => {
  it('records a good report (202, fresh), stamped with the server\'s clock, and a resend is the same row (fresh: false)', async () => {
    app = await open();
    const first = await post(app, body());
    expect([first.statusCode, first.json()]).toEqual([202, { ok: true, id: 1, fresh: true }]);
    expect(rows()).toEqual([{ id: 1, sessionId: ID, reportId: 'r-0001-abcd', uuid: UUID, source: 'clear',
      model: 'claude-opus-5-5', rowIncarnation: '0189abcd-1234-5678-9abc-0123456789ab', reportedAt: FAKE_T0 - 50, receivedAt: FAKE_T0 }]);
    const again = await post(app, body());
    expect([again.statusCode, again.json()]).toEqual([202, { ok: true, id: 1, fresh: false }]);
    expect(rows()).toHaveLength(1);
  });

  it('takes a report with no model and no rowIncarnation, and stores both null', async () => {
    app = await open();
    const b = body();
    delete b['model'];
    delete b['rowIncarnation'];
    const res = await post(app, b);
    expect(res.statusCode, res.body).toBe(202);
    expect(rows()[0]).toMatchObject({ model: null, rowIncarnation: null });
    const nulls = await post(app, body({ reportId: 'r-0002-abcd', model: null, rowIncarnation: null }));
    expect(nulls.statusCode, nulls.body).toBe(202);
  });

  it('refuses a missing or wrong box token 401 and records nothing', async () => {
    app = await open();
    for (const t of [null, 'e'.repeat(64)]) {
      const res = await post(app, body(), ID, t);
      expect([res.statusCode, res.json().error]).toEqual([401, 'unauthenticated']);
    }
    expect(rows()).toEqual([]);
  });

  it('refuses a report for another session\'s id 403 and records nothing', async () => {
    seedRow(home, 'lane-b-project-a', { uuid: 'u-other', project: 'project-a' });
    app = await open();
    const res = await post(app, body(), 'lane-b-project-a');
    expect([res.statusCode, res.json().error]).toEqual([403, 'not-owner']);
    expect(rows()).toEqual([]);
  });

  it('refuses a stale uuid 403 stale-uuid, never accepting on the session id alone, and an unknown sender 403', async () => {
    app = await open();
    const stale = await post(app, body({ fromUuid: '99999999-2222-3333-4444-555555555555' }));
    expect([stale.statusCode, stale.json().error]).toEqual([403, 'stale-uuid']);
    const unknown = await post(app, body({ fromId: 'lane-c-project-a' }), 'lane-c-project-a');
    expect([unknown.statusCode, unknown.json().error]).toEqual([403, 'unknown-sender']);
    expect(rows()).toEqual([]);
  });

  it('answers registry-unmeasurable (502) when the registry cannot be read, and records nothing', async () => {
    const io: FleetIO = { ...localIOFor(home), readdirMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    app = await open(io);
    const res = await post(app, body());
    expect([res.statusCode, res.json().error]).toEqual([502, 'registry-unmeasurable']);
    expect(rows()).toEqual([]);
  });

  it('refuses a malformed body 400 bad-request and records nothing', async () => {
    app = await open();
    const bad: Record<string, unknown>[] = [
      { reportId: 'short' }, { reportId: 'has space in it' }, { reportId: 'x'.repeat(65) }, { reportId: 7 },
      { source: 7 }, { source: '' }, { source: 's'.repeat(33) },
      { reportedAt: 1.5 }, { reportedAt: '1' }, { reportedAt: Number.MAX_SAFE_INTEGER + 2 },
      { model: 7 }, { model: 'm'.repeat(129) }, { rowIncarnation: 4 }, { rowIncarnation: '0189ABCD-1234-5678-9abc-0123456789ab' }, { rowIncarnation: 'not-a-uuid' },
    ];
    for (const over of bad) {
      const res = await post(app, body(over));
      expect([res.statusCode, res.json().error], JSON.stringify(over)).toEqual([400, 'bad-request']);
    }
    for (const missing of ['fromId', 'fromUuid', 'reportId', 'source', 'reportedAt']) {
      const b = body();
      delete b[missing];
      const res = await post(app, b);
      expect(res.statusCode, missing).toBe(missing === 'fromId' ? 403 : 400);
    }
    expect(rows()).toEqual([]);
  });

  it('checks the body before the registry: a malformed report from a stale uuid is 400, not 403', async () => {
    app = await open();
    const res = await post(app, body({ fromUuid: '99999999-2222-3333-4444-555555555555', reportId: 'bad' }));
    expect([res.statusCode, res.json().error]).toEqual([400, 'bad-request']);
  });

  it('a resend spooled under uuid A lands from a sender the registry now knows as B, and records A (review 1911, F4)', async () => {
    const A = '99999999-2222-3333-4444-555555555555';
    app = await open();
    const res = await post(app, body({ fromUuid: UUID, startedUuid: A }));
    expect(res.statusCode, res.body).toBe(202);
    expect(rows()).toMatchObject([{ uuid: A }]);
    const spoofed = await post(app, body({ reportId: 'r-0002-abcd', fromUuid: A, startedUuid: A }));
    expect([spoofed.statusCode, spoofed.json().error], 'the sender, not the reported uuid, is attributed').toEqual([403, 'stale-uuid']);
    expect(rows()).toHaveLength(1);
  });

  it('a body with no startedUuid (an older hook) meets today\'s check on fromUuid and records it', async () => {
    app = await open();
    const ok = await post(app, body({ startedUuid: null }));
    expect(ok.statusCode, ok.body).toBe(202);
    expect(rows()).toMatchObject([{ uuid: UUID }]);
    const stale = await post(app, body({ reportId: 'r-0002-abcd', fromUuid: '99999999-2222-3333-4444-555555555555' }));
    expect([stale.statusCode, stale.json().error]).toEqual([403, 'stale-uuid']);
  });

  it('refuses a malformed startedUuid 400 and records nothing', async () => {
    app = await open();
    for (const startedUuid of [7, '', 'has space', 'x'.repeat(129)]) {
      const res = await post(app, body({ startedUuid }));
      expect([res.statusCode, res.json().error], JSON.stringify(startedUuid)).toEqual([400, 'bad-request']);
    }
    expect(rows()).toEqual([]);
  });

  it('answers unavailable (503) on a server with no coordination store', async () => {
    app = Fastify({ logger: false });
    registerContinuityRoutes(app, { coord: undefined, mailToken: () => ID_GATE_TOKEN, attribute: async () => ({ ok: true }), wall: () => FAKE_T0,
      attributeReader: async () => ({ ok: true }), cardRegistry: { childMark: async () => ({ kind: 'none' }), incarnation: async () => ({ kind: 'absent' }), declaredIntent: () => false },
      setterStamp: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
    await app.ready();
    const res = await post(app, body());
    expect([res.statusCode, res.json().error]).toEqual([503, 'unavailable']);
  });

  it('answers write-failed (503) when the store cannot write', async () => {
    app = await open();
    coord!.db.exec('DROP TABLE continuity_starts');
    const res = await post(app, body());
    expect([res.statusCode, res.json().error]).toEqual([503, 'write-failed']);
  });
});
