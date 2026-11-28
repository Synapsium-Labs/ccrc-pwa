// Overlord W1 door process B1 (plan `w1-door-process.md` Task 7): `POST /api/sessions/:id/report`, the session hook's one
// door. The refusals in order (token, sender, shape, attribution), each stored kind's row, `picked-up` through a fake private
// store (moved, another session's, absent, already past picked up, unmeasured) and through the real one (a repeat report),
// a failed write, and the keep: rows past it are gone after the next insert. Fixture HOMEs only.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CoordStore } from '../src/coord/store.js';
import type { OperatorModelStore } from '../src/operatorModel/store.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { FAKE_T0 } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { REPORT_KEEP_MS, WITNESS_KEEP_MS } from '../../shared/continuity-reports.js';
import { OperatorModelStore as RealOperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { SecretMasker } from '../src/accounts/mask.js';
import { openCoordDb } from '../src/coord/db.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { MESSAGE_TEXT_MAX_BYTES, REPLY_REPORT_MAX_BYTES } from '../../shared/operatorMessages.js';
import type { ResponseStamp } from '../../shared/responses.js';

const STAMP: ResponseStamp = { boot: { kind: 'measured', epoch: 1 }, restore: { kind: 'measured', n: 0 } };

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
  messageStateOf: () => ({ kind: 'measured', value: 'recorded' }),
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
  it('the real private store: a repeat report of a message already picked up is 200 changed:false, never 502 (review 2870 F5)', async () => {
    const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-report-route-pm-')));
    let issued = 0;
    const journal: PrivacyIssuer = { kind: 'ready', issue: (highest) => { issued = Math.max(highest ?? 0, issued) + 1; return { ok: true, id: issued }; } };
    const store = new RealOperatorModelStore(db, journal);
    const actor = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
      .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
    const rec = store.recordMessage({ at: 1_000, sessionId: ID, term: 1, actor, text: 'hello', mark: false, composedKey: null, offRecord: false });
    if (!rec.ok) throw new Error('message not recorded');
    try {
      const r = await appFor(home, recorder().run, { operatorModel: store });
      app = r.app; coord = r.coord;
      await app.ready();
      const first = await report(app, { kind: 'picked-up', messageId: rec.value.id });
      expect([first.statusCode, first.json()]).toEqual([200, { ok: true, changed: true }]);
      expect(store.messageStateOf(rec.value.id)).toEqual({ kind: 'measured', value: 'picked-up' });
      // The pick-up's sequence line, written right after its move (sequence PR B1, call 1218): once, the hook's, the server's kind.
      const lines = () => coord!.db.prepare("SELECT id, state, actor, actorKind FROM overlord_sequence WHERE kind = 'message'").all();
      expect(lines()).toEqual([{ id: String(rec.value.id), state: 'picked-up', actor: 'hook', actorKind: 'server' }]);
      const again = await report(app, { kind: 'picked-up', messageId: rec.value.id });
      expect([again.statusCode, again.json()]).toEqual([200, { ok: true, changed: false }]);
      expect(store.messageStateOf(rec.value.id)).toEqual({ kind: 'measured', value: 'picked-up' });
      expect(lines()).toHaveLength(1);
    } finally { db.close(); }
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

// ── the reply report (Overlord W1 chat, PR B; plan `w1-chat.md` Task 5 step 2) ───────────────────────────────────────────────

describe('POST /api/sessions/:id/report: a reply is recorded in the private store, then its response row', () => {
  const ENTRY = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
  const TEXT = 'Done: project-a is green.';
  const VIEW = {} as never;
  const designated = (sessionId: string, term: number): DesignationRead => ({ kind: 'designated', sessionId, term, row: VIEW });
  const body = (over: Record<string, unknown> = {}) => ({ kind: 'reply', entryUuid: ENTRY, turnAt: 900, text: TEXT, truncated: false, answers: [], ...over });
  let pmDb: DatabaseSync | undefined;
  afterEach(() => { if (pmDb?.isOpen) pmDb.close(); pmDb = undefined; });

  /** A real private store with a counting issuer, a server over it, and the designation the coordination store answers. */
  async function replyRig(o: { designation?: DesignationRead; masker?: SecretMasker; responseStamp?: (() => ResponseStamp) | null } = {}) {
    pmDb = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-report-route-reply-')));
    let issued = 0;
    const journal: PrivacyIssuer = { kind: 'ready', issue: (highest) => { issued = Math.max(highest ?? 0, issued) + 1; return { ok: true, id: issued }; } };
    const store = new RealOperatorModelStore(pmDb, journal);
    const stamp = o.responseStamp === undefined ? () => STAMP : o.responseStamp;
    const r = await appFor(home, recorder().run, { operatorModel: store, ...(o.masker === undefined ? {} : { masker: o.masker }),
      ...(stamp === null ? {} : { responseStamp: stamp }) });
    app = r.app; coord = r.coord;
    vi.spyOn(r.coord, 'designationRead').mockReturnValue(o.designation ?? designated(ID, 3));
    await app.ready();
    return { store, db: pmDb };
  }
  const replyRows = (db: DatabaseSync) => db.prepare('SELECT id, sessionId, term, entryUuid, text, turnAt FROM overlord_replies ORDER BY id').all().map((x) => ({ ...x }));
  const responseRows = () => coord!.db.prepare("SELECT refId, insertedAt FROM operator_responses WHERE kind = 'reply' ORDER BY refId").all().map((x) => ({ ...x }));

  it('the designated session\'s reply records once at the current term, with its response row; a second report of the entry is a replay', async () => {
    const { db } = await replyRig();
    const first = await report(app!, body());
    expect([first.statusCode, first.json()]).toEqual([200, { ok: true, replyId: 1, replay: false }]);
    expect(replyRows(db)).toEqual([{ id: 1, sessionId: ID, term: 3, entryUuid: ENTRY, text: TEXT, turnAt: 900 }]);
    expect(responseRows()).toHaveLength(1);
    const again = await report(app!, body({ at: 2_000 }));
    expect([again.statusCode, again.json()]).toEqual([200, { ok: true, replyId: 1, replay: true }]);
    expect([replyRows(db).length, responseRows().length]).toEqual([1, 1]);
    expect(rows(), 'a reply is never a hook report row in coord.db').toEqual([]);
  });

  it('a session that is not the designated one, or designated at no term now, answers 403 not-the-overlord and records nothing', async () => {
    for (const designation of [designated('lane-b-project-a', 3), { kind: 'not-designated', row: null } as DesignationRead]) {
      const { db } = await replyRig({ designation });
      const res = await report(app!, body());
      expect([res.statusCode, err(res)], JSON.stringify(designation)).toEqual([403, 'not-the-overlord']);
      expect([replyRows(db), responseRows()]).toEqual([[], []]);
      await app!.close(); app = undefined; coord?.db.close(); coord = undefined;
    }
  });

  it('an unreadable designation answers 502 unmeasured and records nothing', async () => {
    const { db } = await replyRig({ designation: { kind: 'unmeasured', why: 'fixture' } });
    const res = await report(app!, body());
    expect([res.statusCode, err(res)]).toEqual([502, 'unmeasured']);
    expect(replyRows(db)).toEqual([]);
  });

  it('a text carrying a secret the masker knows is stored masked; the rest of the text rides', async () => {
    const SECRET = 'Zq7'.repeat(12);
    const mdb = openCoordDb(path.join(mkTmp('ccrc-report-route-mask-'), 'coord.db'));
    const masker = new SecretMasker({ db: mdb, token: () => ID_GATE_TOKEN, log: () => {} });
    try {
      expect(masker.ingestSecret('lane-a', SECRET)).toBe('masked');
      const { db } = await replyRig({ masker });
      expect((await report(app!, body({ text: `the key is ${SECRET} for now` }))).statusCode).toBe(200);
      const [row] = replyRows(db) as Array<{ text: string }>;
      expect(row!.text).not.toContain(SECRET);
      expect(row!.text).toContain('the key is');
    } finally { mdb.close(); }
  });

  // Review 4173's cut-before-the-mask point (call 1952): the hook cuts a reply at REPLY_REPORT_MAX_BYTES before this door masks it, so a
  // secret straddling that cut arrives as a fragment the masker may not know. The store keeps only its first MESSAGE_TEXT_MAX_BYTES,
  // below the cut, so no fragment reaches the record (REPLY_STORE_CAP_BELOW_REPORT_BOUND).
  it('a secret straddling the hook\'s cut never reaches the record: the store keeps only text well before the cut', async () => {
    const SECRET = 'Zq7'.repeat(12);
    const mdb = openCoordDb(path.join(mkTmp('ccrc-report-route-straddle-'), 'coord.db'));
    const masker = new SecretMasker({ db: mdb, token: () => ID_GATE_TOKEN, log: () => {} });
    try {
      expect(masker.ingestSecret('lane-a', SECRET)).toBe('masked');
      const { db } = await replyRig({ masker });
      const fragment = SECRET.slice(0, 20);   // what the hook's cut leaves of it: its head, at the very end of the report
      const text = `${'a'.repeat(REPLY_REPORT_MAX_BYTES - fragment.length)}${fragment}`;
      expect(Buffer.byteLength(text)).toBe(REPLY_REPORT_MAX_BYTES);
      expect((await report(app!, body({ text, truncated: true }))).statusCode).toBe(200);
      const [row] = replyRows(db) as Array<{ text: string }>;
      expect(row!.text).not.toContain(fragment);
      expect(row!.text).not.toContain(SECRET.slice(0, 8));
      expect(Buffer.byteLength(row!.text.replace(/ \[cut: \d+ more bytes\]$/, ''))).toBeLessThanOrEqual(MESSAGE_TEXT_MAX_BYTES);
    } finally { mdb.close(); }
  });

  it('the ids the turn names reach the store: an id it cannot verify records the reply off the record and unlinked (F2)', async () => {
    const { db } = await replyRig();
    expect((await report(app!, body({ answers: [77] }))).statusCode).toBe(200);
    expect(db.prepare('SELECT inReplyTo, offRecord FROM overlord_replies').all().map((x) => ({ ...x }))).toEqual([{ inReplyTo: null, offRecord: 1 }]);
    const res = await report(app!, body({ entryUuid: '0f1e2d3c-4b5a-4968-8776-000000000099', answers: 'all' }));
    expect([res.statusCode, err(res)], 'a bad list is a bad request, naming the field').toEqual([400, 'bad-request']);
    expect(res.json()).toMatchObject({ detail: 'answers' });
  });

  it('a response row that cannot be written still answers 200: the record holds, and the log names no text', async () => {
    const { db } = await replyRig({ responseStamp: () => { throw new Error('fixture stamp failure'); } });
    const res = await report(app!, body());
    expect([res.statusCode, res.json()]).toEqual([200, { ok: true, replyId: 1, replay: false }]);
    expect([replyRows(db).length, responseRows()]).toEqual([1, []]);
    expect(warns.some((w) => w.includes('response row was not written'))).toBe(true);
  });

  it('no line the reply arm or the door logs, and no refusal it answers, names the reply\'s text', async () => {
    const SPOKEN = 'fixture words about the operator';
    const { db } = await replyRig();
    await report(app!, body({ text: SPOKEN }));
    const reused = await report(app!, body({ text: `${SPOKEN} again` }));   // the same entry, other text
    expect([reused.statusCode, err(reused)]).toEqual([409, 'conflict']);
    const bad = await report(app!, body({ text: `${SPOKEN}`, entryUuid: 'not-a-uuid' }));
    expect(bad.statusCode).toBe(400);
    db.close();
    const closed = await report(app!, body({ entryUuid: '0f1e2d3c-4b5a-4968-8776-000000000002', text: SPOKEN }));
    expect(closed.statusCode).toBe(409);   // not-open
    for (const res of [reused, bad, closed]) expect(res.body).not.toContain(SPOKEN);
    expect(warns.join('\n')).not.toContain(SPOKEN);
  });

  it('a server without the private store answers 409 not-open for a reply, and every other kind is the table\'s', async () => {
    const r = await appFor(home, recorder().run);
    app = r.app; coord = r.coord;
    vi.spyOn(r.coord, 'designationRead').mockReturnValue(designated(ID, 3));
    await app.ready();
    const res = await report(app, body());
    expect([res.statusCode, err(res)]).toEqual([409, 'not-open']);
  });
});
