// Overlord W2, request ids A: the mail door's lift of the Overlord's recipient (check 7), over the real `POST /api/mail`. The
// rule is `requestMailVerdict`'s (`coord/requestMail.ts`); this file drives the door end to end: status, body, the rejection
// rows, the stored mail row, its delivery and the request's news.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { REPORTS_TO_OVERLORD_HOURLY, REQUEST_NEWS_CHARS } from '../../shared/overlordRequests.js';
import { SECRET_MASK } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { stampRequestNewsInTx } from '../src/coord/overlordRequestStore.js';
import { OVERLORD_TAKES_ONLY_ITS_OWNERS, requestNotYoursDetail } from '../src/coord/requestMail.js';
import { OVERLORD_IDENTITY } from '../src/roleOf.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { legacyOpens } from './helpers/plan.js';
import { landingStoreOver } from './landingFixture.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const PROJECT = 'demo';
const C1 = 'demo-coord-one';
const C2 = 'demo-coord-two';
const PEER_ID = 'demo-peer-one';
const UUIDS: Record<string, string> = { [C1]: 'a'.repeat(36), [C2]: 'b'.repeat(36), [PEER_ID]: 'c'.repeat(36) };
const BOUND = 'demo-overlord-session';
const P1 = 'build4';
const P2 = 'build5';

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: UUIDS[id] ?? 'd'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const quietRunner: Runner = async () => ({ ran: true as const, code: 0, stdout: '', stderr: '' });

const open = async () => {
  const home = mkTmp('ccrc-mail-overlord-');
  for (const id of [C1, C2, PEER_ID, BOUND]) seed(home, id);
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
  const app = legacyOpens(await buildServer({ ...testDeps(home, quietRunner), mailToken: TOKEN, coord }), coord.db);
  return { app, coord };
};

const post = (app: FastifyInstance, url: string, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: { 'x-ccrc-mail-token': TOKEN }, payload: body });

/** Opens the programme's first run, claimed by `claimedBy`; returns the run id. */
const openRun = async (app: FastifyInstance, program: string, claimedBy: string): Promise<number> => {
  const res = await post(app, '/api/runs', { program, title: 'T', project: PROJECT, wave: 1, waveOf: 3, claimedBy,
    claimedByUuid: UUIDS[claimedBy], homeProject: PROJECT });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { id: number }).id;
};

const insertRequest = (coord: CoordStore, id: number, owner: string | null, state = 'routed'): void => {
  coord.db.prepare('INSERT INTO overlord_requests (id, origin, summary, owner, state, openedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'operator', `request ${id}`, owner, state, Date.now());
};

const NOT_SET = null;
/** The designation row, written directly: a bound session, or none bound (a row with no binding); `accountPools` can be spoiled. */
const designate = (coord: CoordStore, sessionId: string | null, accountPools = '{"pools":[],"untagged":false}'): void => {
  coord.db.prepare('INSERT INTO overlord_designation (id, sessionId, generation, term, designatedTerm, model, accountPools, actor, updatedAt) '
    + 'VALUES (1, ?, ?, 1, 1, ?, ?, ?, ?)')
    .run(sessionId, sessionId === null ? NOT_SET : 'g-1', 'opus', accountPools, 'operator-device', Date.now());
};

const report = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  fromId: C1, fromUuid: UUIDS[C1], toId: OVERLORD_IDENTITY, kind: 'status', subject: 'the wave is merged', body: 'details', artifacts: [], ...over,
});

const mailRow = (coord: CoordStore, subject: string) =>
  coord.db.prepare('SELECT id, toId, requestId, runId FROM mail WHERE subject = ?').get(subject) as
    { id: number; toId: string; requestId: number | null; runId: number | null } | undefined;
const requestRow = (coord: CoordStore, id: number) =>
  coord.db.prepare('SELECT lastNewsAt, news, revision FROM overlord_requests WHERE id = ?').get(id) as
    { lastNewsAt: number | null; news: string | null; revision: number };
const mailCount = (coord: CoordStore): number => (coord.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n;

/** The rejection rows a call added: the rows before, then after. */
const withRejections = async <T>(coord: CoordStore, f: () => Promise<T>) => {
  const before = new Set(coord.rejections().map((r) => r.id));
  const out = await f();
  return { out, added: coord.rejections().filter((r) => !before.has(r.id)) };
};

const UNKNOWN = REFUSAL_STATUS['unknown-recipient'];

describe('POST /api/mail — the Overlord as a recipient (request ids A)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('1. characterization: mail to the Overlord naming no request is refused unknown-recipient with today\'s detail, recorded', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report()));
    expect(out.statusCode).toBe(UNKNOWN);
    expect(out.json()).toMatchObject({ ok: false, error: 'unknown-recipient', detail: "the Overlord's role takes no mail in W1" });
    expect(OVERLORD_TAKES_ONLY_ITS_OWNERS).toBe("the Overlord's role takes no mail in W1");
    expect(added.map((r) => r.code)).toEqual(['unknown-recipient']);
    expect(mailCount(w.coord)).toBe(0);
  });

  it('2. no oracle: a non-owner reads the same status and body whether the request is unnamed, unknown, unowned or another programme\'s', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1); await openRun(app, P2, C2);
    insertRequest(w.coord, 11, null);
    insertRequest(w.coord, 12, P2);
    designate(w.coord, BOUND);
    const answers: { status: number; body: string; codes: string[] }[] = [];
    for (const requestId of [undefined, 999, 11, 12]) {
      const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail',
        report({ subject: `s ${String(requestId)}`, ...(requestId === undefined ? {} : { requestId }) })));
      answers.push({ status: out.statusCode, body: JSON.stringify(out.json()), codes: added.map((r) => r.code) });
    }
    for (const a of answers) {
      expect(a.status).toBe(UNKNOWN);
      expect(a.codes).toEqual(['unknown-recipient']);
      expect(a.body).toBe(answers[0]!.body);
    }
    expect(JSON.parse(answers[0]!.body)).toMatchObject({ ok: false, error: 'unknown-recipient', detail: OVERLORD_TAKES_ONLY_ITS_OWNERS });
    expect(mailCount(w.coord)).toBe(0);
  });

  it('3. the owner\'s report is accepted: stored to the role, delivered to the bound session, the news stamped and masked', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    designate(w.coord, BOUND);
    expect(w.coord.claimsProgramme(C1, P1, UUIDS[C1]!)).toBe(true);
    const subject = 'merged '.padEnd(200, 'x');
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7, subject })));
    expect(out.statusCode, out.body).toBe(202);
    expect(added).toEqual([]);
    const row = mailRow(w.coord, subject)!;
    expect([row.toId, row.requestId]).toEqual([OVERLORD_IDENTITY, 7]);
    const d = w.coord.db.prepare('SELECT toId FROM mail_deliveries WHERE mailId = ?').all(row.id) as { toId: string }[];
    expect(d.map((x) => x.toId)).toEqual([BOUND]);
    const rq = requestRow(w.coord, 7);
    expect(rq.lastNewsAt).toBeGreaterThan(0);
    expect(rq.news).toBe(subject);
    expect(rq.news!.length).toBe(REQUEST_NEWS_CHARS);
    expect(rq.revision).toBe(0);

    const secret = 'token sk-ant-api03-abcdefgh12345678 done';
    expect((await post(app, '/api/mail', report({ requestId: 7, subject: secret }))).statusCode).toBe(202);
    const news = requestRow(w.coord, 7).news!;
    expect(news).not.toContain('sk-ant-api03-abcdefgh12345678');
    expect(news).toContain(SECRET_MASK);
  });

  it('4. the owner\'s report about a closed request is unknown-recipient "request R is closed", recorded, nothing stored', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1, 'done');
    designate(w.coord, BOUND);
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7 })));
    expect(out.statusCode).toBe(UNKNOWN);
    expect(out.json()).toMatchObject({ ok: false, error: 'unknown-recipient', detail: 'request 7 is closed' });
    expect(added.map((r) => r.code)).toEqual(['unknown-recipient']);
    expect(mailCount(w.coord)).toBe(0);
    expect(requestRow(w.coord, 7)).toMatchObject({ lastNewsAt: null, news: null });
  });

  it('5. no Overlord designated: unknown-recipient "no Overlord is designated", recorded', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7 })));
    expect(out.statusCode).toBe(UNKNOWN);
    expect(out.json()).toMatchObject({ ok: false, error: 'unknown-recipient', detail: 'no Overlord is designated' });
    expect(added.map((r) => r.code)).toEqual(['unknown-recipient']);
    expect(mailCount(w.coord)).toBe(0);
  });

  it('6. designated with no session bound: accepted, the delivery names the role\'s own identity', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    designate(w.coord, null);
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7 })));
    expect(out.statusCode, out.body).toBe(202);
    expect(added).toEqual([]);
    const row = mailRow(w.coord, 'the wave is merged')!;
    const d = w.coord.db.prepare('SELECT toId FROM mail_deliveries WHERE mailId = ?').all(row.id) as { toId: string }[];
    expect(d.map((x) => x.toId)).toEqual([OVERLORD_IDENTITY]);
    expect(requestRow(w.coord, 7).news).toBe('the wave is merged');
  });

  it('7. an unreadable request record is 503 run-unreadable, an unreadable designation 502 unmeasured, neither recorded', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    // The designation row cannot be narrowed (its account set is no set): the owner's report meets `unmeasured`.
    designate(w.coord, BOUND, 'not json');
    const a = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7 })));
    expect(a.out.statusCode).toBe(REFUSAL_STATUS['unmeasured']);
    expect(a.out.statusCode).toBe(502);
    expect(a.out.json()).toMatchObject({ ok: false, error: 'unmeasured' });
    expect(a.added).toEqual([]);
    expect(mailCount(w.coord)).toBe(0);
    // The request table is gone: nothing about the request can be read.
    w.coord.db.exec('DROP TABLE overlord_requests');
    const b = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7 })));
    expect(b.out.statusCode).toBe(503);
    expect(b.out.json()).toMatchObject({ ok: false, error: 'run-unreadable' });
    expect(b.added).toEqual([]);
    expect(mailCount(w.coord)).toBe(0);
  });

  it('8. mail to a peer naming a request: the owner\'s is stamped, a foreign, unknown or unowned one is request-not-yours, one answer', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1); await openRun(app, P2, C2);
    insertRequest(w.coord, 7, P1); insertRequest(w.coord, 8, P2); insertRequest(w.coord, 9, null);
    const peer = (over: Record<string, unknown>) => report({ toId: PEER_ID, ...over });
    const ok = await post(app, '/api/mail', peer({ requestId: 7, subject: 'to a peer' }));
    expect(ok.statusCode, ok.body).toBe(202);
    expect(mailRow(w.coord, 'to a peer')!.requestId).toBe(7);
    expect(requestRow(w.coord, 7).news).toBe('to a peer');

    const answers: { status: number; body: string }[] = [];
    for (const requestId of [8, 999, 9]) {
      const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', peer({ requestId, subject: `p ${requestId}` })));
      expect(out.statusCode).toBe(REFUSAL_STATUS['request-not-yours']);
      expect(out.json()).toMatchObject({ ok: false, error: 'request-not-yours', detail: requestNotYoursDetail(requestId) });
      expect(added.map((r) => r.code)).toEqual(['request-not-yours']);
      answers.push({ status: out.statusCode, body: JSON.stringify(out.json()).replace(String(requestId), 'N') });
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(requestRow(w.coord, 8)).toMatchObject({ lastNewsAt: null, news: null });
  });

  it('9. a malformed requestId is bad-kind, recorded, as the neighbouring fields are', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    for (const requestId of [0, -1, 1.5, '7', true]) {
      const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId })));
      expect(out.statusCode, String(requestId)).toBe(REFUSAL_STATUS['bad-kind']);
      expect(out.json()).toMatchObject({ ok: false, error: 'bad-kind' });
      expect(added.map((r) => r.code), String(requestId)).toEqual(['bad-kind']);
    }
    expect(mailCount(w.coord)).toBe(0);
  });

  it('10. the reports quota: the 61st report in the hour is peer-quota, retry on time, recorded; peer mail meets its own bound only', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    designate(w.coord, BOUND);
    tx(w.coord.db, () => {
      for (let i = 0; i < REPORTS_TO_OVERLORD_HOURLY; i++) {
        w.coord.insertMail({ fromId: C1, fromUuid: UUIDS[C1]!, toId: OVERLORD_IDENTITY, runId: null, kind: 'status',
          subject: `old report ${i}`, body: 'b', artifacts: [] });
      }
    });
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7, subject: 'one more' })));
    expect(out.statusCode).toBe(REFUSAL_STATUS['peer-quota']);
    expect(out.json()).toMatchObject({ ok: false, error: 'peer-quota', retry: { on: 'time' } });
    expect(added.map((r) => r.code)).toEqual(['peer-quota']);
    expect(mailRow(w.coord, 'one more')).toBeUndefined();
    // The same coordinator's run-less mail to a peer is not refused by the reports quota.
    const peer = await post(app, '/api/mail', report({ toId: PEER_ID, subject: 'a peer question', kind: 'question' }));
    expect(peer.statusCode, peer.body).toBe(202);
  });

  it('11. a report naming a run meets the reports quota, not the peer bound', async () => {
    const w = await open(); app = w.app;
    const runId = await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    designate(w.coord, BOUND);
    const res = await post(app, '/api/mail', report({ requestId: 7, runId, subject: 'report with a run' }));
    expect(res.statusCode, res.body).toBe(202);
    expect(mailRow(w.coord, 'report with a run')).toMatchObject({ toId: OVERLORD_IDENTITY, requestId: 7, runId });
  });

  it('10b. held reports to the Overlord\'s session leave a raw mail to that session unbounded and un-duplicated', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    designate(w.coord, BOUND);
    for (let i = 0; i < 3; i++) {
      expect((await post(app, '/api/mail', report({ requestId: 7, subject: `held ${i}` }))).statusCode).toBe(202);
    }
    const held = w.coord.db.prepare("SELECT COUNT(*) AS n FROM mail_deliveries WHERE toId = ? AND state = 'queued'").get(BOUND) as { n: number };
    expect(held.n).toBe(3);
    const raw = (subject: string) => post(app!, '/api/mail', report({ toId: BOUND, kind: 'question', subject }));
    const fresh = await raw('a raw question');
    expect(fresh.statusCode, fresh.body).toBe(202);
    const dup = await raw('held 1');
    expect(dup.statusCode, dup.body).toBe(202);
  });

  it('12a. the binding stands after the last run closes (RI18 measured: main\'s owner test)', async () => {
    const w = await open(); app = w.app;
    const runId = await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    designate(w.coord, BOUND);
    const gone = await post(app, `/api/runs/${runId}/abandon`, {});
    expect(gone.statusCode, gone.body).toBe(200);
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7 })));
    expect(out.statusCode, out.body).toBe(202);
    expect(added).toEqual([]);
  });

  it('12b. once the programme\'s coordinator binding names another session, the former coordinator reads the one non-owner refusal', async () => {
    const w = await open(); app = w.app;
    await openRun(app, P1, C1);
    insertRequest(w.coord, 7, P1);
    designate(w.coord, BOUND);
    // No hand-over writer is reachable here without a second run's claim move: the binding is rewritten directly.
    w.coord.db.prepare('UPDATE programs SET coordinator = ?, coordinatorUuid = NULL WHERE slug = ?').run('someone-else', P1);
    const { out, added } = await withRejections(w.coord, () => post(app!, '/api/mail', report({ requestId: 7 })));
    expect(out.statusCode).toBe(UNKNOWN);
    expect(out.json()).toMatchObject({ ok: false, error: 'unknown-recipient', detail: OVERLORD_TAKES_ONLY_ITS_OWNERS });
    expect(added.map((r) => r.code)).toEqual(['unknown-recipient']);
  });
});

describe('stampRequestNewsInTx (the news writer)', () => {
  const store = async () => {
    const home = mkTmp('ccrc-news-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return coord;
  };
  const news = (coord: CoordStore, id: number) =>
    coord.db.prepare('SELECT lastNewsAt, news, revision FROM overlord_requests WHERE id = ?').get(id) as
      { lastNewsAt: number | null; news: string | null; revision: number };

  it('cuts at 200 code points, never mid-character, inside a transaction, and never raises the revision', async () => {
    const coord = await store();
    insertRequest(coord, 1, P1);
    expect(tx(coord.db, () => stampRequestNewsInTx(coord.db, 1, 'y'.repeat(250), 111))).toBe('stamped');
    expect(news(coord, 1)).toEqual({ lastNewsAt: 111, news: 'y'.repeat(200), revision: 0 });
    expect(tx(coord.db, () => stampRequestNewsInTx(coord.db, 1, '😀'.repeat(250), 222))).toBe('stamped');
    const n = news(coord, 1);
    expect(n.news).toBe('😀'.repeat(200));
    expect([...n.news!].length).toBe(200);
    expect(n).toMatchObject({ lastNewsAt: 222, revision: 0 });
  });

  it('outside a transaction answers not-in-transaction and writes nothing', async () => {
    const coord = await store();
    insertRequest(coord, 1, P1);
    expect(stampRequestNewsInTx(coord.db, 1, 'line', 5)).toBe('not-in-transaction');
    expect(news(coord, 1)).toEqual({ lastNewsAt: null, news: null, revision: 0 });
  });

  it('on a closed request answers closed and writes nothing; on an absent id, absent', async () => {
    const coord = await store();
    insertRequest(coord, 1, P1, 'done');
    expect(tx(coord.db, () => stampRequestNewsInTx(coord.db, 1, 'line', 5))).toBe('closed');
    expect(news(coord, 1)).toEqual({ lastNewsAt: null, news: null, revision: 0 });
    expect(tx(coord.db, () => stampRequestNewsInTx(coord.db, 404, 'line', 5))).toBe('absent');
  });
});
