// Overlord W1 door process B1 (plan `w1-door-process.md` Task 7): `POST /api/sessions/:id/report`, the session hook's one
// door. The refusals in order (token, sender, shape, attribution), each stored kind's row, `picked-up` through a fake private
// store (moved, another session's, absent, already past picked up, unmeasured), a failed write, and the keep: rows past it are
// gone after the next insert. Fixture HOMEs only.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CoordStore } from '../src/coord/store.js';
import type { OperatorModelStore } from '../src/operatorModel/store.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { FAKE_T0 } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { REPORT_KEEP_MS, WITNESS_KEEP_MS } from '../../shared/continuity-reports.js';

const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const KEY = 'cd'.repeat(32);

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
let warns: string[];
/** The fake private store: message 7 is this session's, 8 another's, anything else absent; `unmeasured` reads fail. */
let fake: { owners: Record<number, string>; unmeasured: boolean; moves: Array<[number, string, string, number]>; changed: boolean; fail: boolean };

beforeEach(() => {
  home = mkTmp('ccrc-report-route-');
  seedRow(home, ID, { uuid: UUID, project: 'project-a' });
  warns = [];
  fake = { owners: { 7: ID, 8: 'lane-b-project-a' }, unmeasured: false, moves: [], changed: true, fail: false };
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warns.push(a.map(String).join(' ')); });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});

const operatorModel = {
  messageSessionOf: (m: number) => {
    if (fake.unmeasured) return { kind: 'unmeasured', why: 'the store is unreadable' };
    const o = fake.owners[m];
    return { kind: 'measured', value: o === undefined ? 'absent' : { sessionId: o } };
  },
  moveMessage: (m: number, e: string, a: string, at: number) => {
    fake.moves.push([m, e, a, at]);
    return fake.fail ? { ok: false, error: 'write-failed', detail: 'x' } : { ok: true, value: { changed: fake.changed, state: 'picked-up' } };
  },
} as unknown as OperatorModelStore;

const open = async (): Promise<FastifyInstance> => {
  const r = await appFor(home, recorder().run, { operatorModel });
  coord = r.coord;
  await r.app.ready();
  return r.app;
};
const report = (a: FastifyInstance, b: Record<string, unknown>, token: string | null = ID_GATE_TOKEN, id = ID) =>
  a.inject({ method: 'POST', url: `/api/sessions/${id}/report`, headers: token === null ? {} : { 'x-ccrc-mail-token': token },
    payload: { fromId: id, fromUuid: UUID, at: 1_000, ...b } });
const err = (res: { json: () => unknown }): string => (res.json() as { error: string }).error;
const rows = (): Array<Record<string, unknown>> => coord!.db.prepare('SELECT * FROM continuity_hook_reports ORDER BY id').all() as Array<Record<string, unknown>>;

describe('POST /api/sessions/:id/report: the refusals, in order', () => {
  it('1. a missing or wrong box token: 401, nothing written', async () => {
    app = await open();
    for (const t of [null, 'e'.repeat(64)]) expect((await report(app, { kind: 'readers-clear' }, t)).statusCode).toBe(401);
    expect(rows()).toEqual([]);
  });
  it('2. the path\'s session is not the sender: not-owner', async () => {
    app = await open();
    const res = await report(app, { kind: 'readers-clear', fromId: 'lane-b-project-a' });
    expect([res.statusCode, err(res)]).toEqual([403, 'not-owner']);
  });
  it('2. a malformed fromUuid: 400 bad-request', async () => {
    app = await open();
    for (const fromUuid of [7, null, 'a b', '']) {
      const res = await report(app, { kind: 'readers-clear', fromUuid });
      expect([res.statusCode, err(res)], String(fromUuid)).toEqual([400, 'bad-request']);
    }
  });
  it('3. an unknown kind or a bad field: 400 bad-request naming the field, with no echo of the key', async () => {
    app = await open();
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ kind: 'nope' }, 'kind'], [{ kind: 'witness', key: 'NOT-HEX', tool: 'mcp__door__card' }, 'key'],
      [{ kind: 'witness', key: KEY, tool: 'Bash' }, 'tool'], [{ kind: 'reader-stop', agentId: 'a b' }, 'agentId'],
      [{ kind: 'picked-up', messageId: 1.5 }, 'messageId'], [{ kind: 'readers-clear', at: -1 }, 'at'],
    ];
    for (const [b, f] of bad) {
      const res = await report(app, b);
      expect([res.statusCode, err(res), (res.json() as { detail: string }).detail], JSON.stringify(b)).toEqual([400, 'bad-request', f]);
    }
    expect(rows()).toEqual([]);
  });
  it('4. a sender the registry does not attribute: stale-uuid, nothing written or moved', async () => {
    app = await open();
    const res = await report(app, { kind: 'picked-up', messageId: 7, fromUuid: '99999999-2222-3333-4444-555555555555' });
    expect([res.statusCode, err(res)]).toEqual([403, 'stale-uuid']);
    expect(fake.moves).toEqual([]);
  });
});

describe('POST /api/sessions/:id/report: each stored kind stores its row', () => {
  it('witness, reader-start, reader-stop, readers-clear and model-switch each store their columns and answer the id', async () => {
    app = await open();
    const sent: Array<Record<string, unknown>> = [
      { kind: 'witness', key: KEY, tool: 'mcp__door__card', agentId: 'agent-1' }, { kind: 'reader-start', agentId: 'agent-1', agentType: 'reader' },
      { kind: 'reader-stop', agentId: 'agent-1' }, { kind: 'readers-clear' },
      { kind: 'model-switch', how: 'switched', from: 'model-a', to: 'model-b' },
    ];
    const ids: number[] = [];
    for (const b of sent) {
      const res = await report(app, b);
      expect([res.statusCode, (res.json() as { ok: boolean }).ok], JSON.stringify(b)).toEqual([200, true]);
      ids.push((res.json() as { id: number }).id);
    }
    expect(rows().map((r) => r['id'])).toEqual(ids);
    expect(rows().map((r) => [r['sessionId'], r['kind'], r['key'], r['agentId'], r['detail'], r['at']])).toEqual([
      [ID, 'witness', KEY, 'agent-1', 'mcp__door__card', 1_000], [ID, 'reader-start', 'agent-1', null, 'reader', 1_000],
      [ID, 'reader-stop', 'agent-1', null, null, 1_000], [ID, 'readers-clear', null, null, null, 1_000],
      [ID, 'model-switch', null, null, '{"how":"switched","from":"model-a","to":"model-b"}', 1_000],
    ]);
    expect(rows().every((r) => typeof r['receivedAt'] === 'number' && (r['receivedAt'] as number) > 0)).toBe(true);
  });
  it('no log line names the witness key', async () => {
    app = await open();
    await report(app, { kind: 'witness', key: KEY, tool: 'mcp__door__card' });
    expect(warns.join('\n')).not.toContain(KEY);
  });
  it('a failed write answers 502 unmeasured', async () => {
    app = await open();
    coord!.db.exec('DROP TABLE continuity_hook_reports');
    const res = await report(app, { kind: 'readers-clear' });
    expect([res.statusCode, err(res)]).toEqual([502, 'unmeasured']);
  });
  it('rows past their keep are gone after the next insert, each kind by its own keep', async () => {
    app = await open();
    const now = FAKE_T0;   // the server's wall clock under the test's fake time
    const ins = coord!.db.prepare("INSERT INTO continuity_hook_reports (sessionId, kind, key, at, receivedAt) VALUES (?, ?, ?, 1, ?)");
    ins.run(ID, 'witness', KEY, now - WITNESS_KEEP_MS - 60_000);   // past its 24 h keep
    ins.run(ID, 'witness', KEY, now - 3_600_000);                  // within it
    ins.run(ID, 'reader-stop', 'a', now - WITNESS_KEEP_MS - 60_000); // past 24 h, within its 7 days
    ins.run(ID, 'readers-clear', null, now - REPORT_KEEP_MS - 60_000); // past its keep
    const res = await report(app, { kind: 'readers-clear' });
    expect(res.statusCode).toBe(200);
    expect(rows().map((r) => `${String(r['kind'])}:${r['key'] === null ? '-' : String(r['key']).slice(0, 2)}`)).toEqual(['witness:cd', 'reader-stop:a', 'readers-clear:-']);
  });
});

describe('POST /api/sessions/:id/report: picked-up moves the operator message', () => {
  it('moves the session\'s own message through the port: pick-up by hook, at the server\'s clock, never a row', async () => {
    app = await open();
    const res = await report(app, { kind: 'picked-up', messageId: 7 });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, changed: true }]);
    expect(fake.moves).toHaveLength(1);
    expect(fake.moves[0]!.slice(0, 3)).toEqual([7, 'pick-up', 'hook']);
    expect(fake.moves[0]![3]).toBeGreaterThan(0);
    expect(rows()).toEqual([]);
  });
  it('another session\'s message: 403 not-owner, nothing moved', async () => {
    app = await open();
    const res = await report(app, { kind: 'picked-up', messageId: 8 });
    expect([res.statusCode, err(res)]).toEqual([403, 'not-owner']);
    expect(fake.moves).toEqual([]);
  });
  it('an absent message: 404 unknown-message', async () => {
    app = await open();
    const res = await report(app, { kind: 'picked-up', messageId: 99 });
    expect([res.statusCode, err(res)]).toEqual([404, 'unknown-message']);
    expect(fake.moves).toEqual([]);
  });
  it('a message already past picked up (changed false): 200, never a refusal', async () => {
    app = await open();
    fake.changed = false;
    const res = await report(app, { kind: 'picked-up', messageId: 7 });
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, changed: false }]);
  });
  it('an unreadable store, and a failed move: 502 unmeasured', async () => {
    app = await open();
    fake.unmeasured = true;
    expect([(await report(app, { kind: 'picked-up', messageId: 7 })).statusCode]).toEqual([502]);
    fake.unmeasured = false;
    fake.fail = true;
    const res = await report(app, { kind: 'picked-up', messageId: 7 });
    expect([res.statusCode, err(res)]).toEqual([502, 'unmeasured']);
  });
  it('a server without the private store answers 502 unmeasured for picked-up only (the port is always built; its store may be absent)', async () => {
    const r = await appFor(home, recorder().run);
    app = r.app; coord = r.coord;
    await app.ready();
    const res = await report(app, { kind: 'picked-up', messageId: 7 });
    expect([res.statusCode, err(res)]).toEqual([502, 'unmeasured']);
    expect((await report(app, { kind: 'readers-clear' })).statusCode).toBe(200);
  });
});
