// Urgent mail's sender rule over the store's facts (mid-turn mail PR 2, plan Tasks 2.3 and 2.4; spec §3.1), the mail
// ingress that acts on it (PR 2b, Task 2.4), and the reclaim's repoint of an urgent mail to a displaced coordinator
// (review 2833 F3). `CoordStore.urgentVerdict` reads the binding's one view, the designation and the pair's outstanding
// urgent mail, and `urgentSenderVerdict` (L1) decides: who may mark a mail urgent, and one outstanding urgent mail per
// sender and recipient (P4). `POST /api/mail` reads `urgent`, asks that verdict, stores the role and echoes the mark.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  bindPendingGeneration, designatePending, goLive, type AuthorityAppender,
} from '../src/coord/overlordDesignationStore.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import type { ChildMark } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const UUID = 'a'.repeat(36);
const COORD = 'lane-a-coordinator';
const OTHER_COORD = 'lane-b-coordinator';
const WORKER = 'lane-a-worker';
const REVIEWER = 'lane-a-reviewer';
const PEER = 'lane-a-peer';
const OVERLORD = 'lane-a-overlord';
const ROWS = [COORD, OTHER_COORD, WORKER, REVIEWER, PEER, OVERLORD];
const NOW = 1_800_000_000_000;

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** `COORD` claims a work run `WORKER` works on and a review run `REVIEWER` works on; `OTHER_COORD` claims a run
 *  `COORD` itself works on (so `COORD` is a coordinator that is also another coordinator's worker). */
const rig = async () => {
  const home = mkTmp('ccrc-urgent-route-');
  for (const id of ROWS) seed(home, id);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const open = (program: string, claimedBy: string, extra: Record<string, unknown> = {}): number => {
    const r = coord.openRun({ program, title: program, project: 'project-a', wave: 1, waveOf: 3, claimedBy, ...extra });
    if (!('id' in r)) throw new Error('openRun refused');
    return r.id;
  };
  const work = open('program-a', COORD);
  coord.setSession(work, WORKER);
  const review = open('program-a', COORD, { kind: 'review', reviews: work });
  coord.setSession(review, REVIEWER);
  const outer = open('program-b', OTHER_COORD);
  coord.setSession(outer, COORD);
  const app = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord });
  return { home, coord, app, work, review, outer };
};
type Rig = Awaited<ReturnType<typeof rig>>;

const send = (app: FastifyInstance, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/mail', headers: { 'x-ccrc-mail-token': TOKEN },
    payload: { fromUuid: UUID, kind: 'status', body: 'stop and read this', artifacts: [], ...body } });
const urgentTo = (r: Rig, fromId: string, toId: string, subject = 'urgent', runId: number | null = r.work) =>
  send(r.app, { fromId, toId, runId, subject, urgent: true });
/** An urgent mail as the ingress will write it on an `allowed` answer: the row with its role, and its delivery. */
const writeUrgent = (c: CoordStore, fromId: string, toId: string, runId: number | null, role: 'coordinator' | 'overlord' = 'coordinator') => {
  const m = c.insertMail({ fromId, fromUuid: UUID, toId, runId, kind: 'status', subject: 'u', body: 'b', artifacts: [], urgentAs: role });
  return c.queueDelivery(m.id, toId, `<mail>${m.id}</mail>`).id;
};
/** Designates `OVERLORD` live, as the designation doors would. */
const designateOverlord = (r: Rig): void => {
  const journal = { appendInTx: () => ({ ok: true, kind: 'appended', record: {} }) } as unknown as AuthorityAppender;
  const operator = attributionIdentity({ attribute: async () => ({ ok: true }),
    incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) }).operator(gateActorOf('operator-a', '0123456789abcdef'));
  const gen = '11111111-2222-3333-4444-555555555555';
  expect(designatePending(r.coord.db, journal, { sessionId: OVERLORD, deadlineAt: NOW + 60_000, model: 'opus',
    accountPools: { pools: ['pool-a'], untagged: false }, actor: operator, at: NOW, opKey: 'op-live' }).ok).toBe(true);
  expect(bindPendingGeneration(r.coord.db, OVERLORD, gen, NOW + 1)).toEqual({ ok: true, changed: true });
  expect(goLive(r.coord.db, journal, OVERLORD, gen, NOW + 2)).toMatchObject({ ok: true, changed: true });
};
const NO_MARK: ChildMark = { kind: 'none' };
const answer = (c: CoordStore, fromId: string, toId: string, runId: number | null, mark: ChildMark = NO_MARK): string => {
  const v = c.urgentVerdict(fromId, toId, runId, mark);
  return v.kind === 'allowed' ? `allowed:${v.role}` : v.code;
};
const counts = (c: CoordStore) => ({
  mail: (c.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n,
  deliveries: (c.db.prepare('SELECT COUNT(*) AS n FROM mail_deliveries').get() as { n: number }).n,
});
const urgentAsOf = (c: CoordStore, id: number): unknown =>
  (c.db.prepare('SELECT urgentAs FROM mail WHERE id = ?').get(id) as { urgentAs: unknown }).urgentAs;

describe('CoordStore.urgentVerdict: the sender rule over the store facts (spec §3.1, plan P2 to P4)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (app) await app.close(); app = undefined; });

  it('a run coordinator to the worker of its work run, or the reviewer of its review run, naming that run: allowed, as coordinator', async () => {
    const r = await rig(); app = r.app;
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('allowed:coordinator');
    expect(answer(r.coord, COORD, REVIEWER, r.review)).toBe('allowed:coordinator');
  });

  it('the mail names no run, or a run that is not the one between them: urgent-wrong-run (F2)', async () => {
    const r = await rig(); app = r.app;
    expect(answer(r.coord, COORD, WORKER, null)).toBe('urgent-wrong-run');
    // The review run is COORD's but REVIEWER's, not WORKER's; the outer run is OTHER_COORD's.
    expect(answer(r.coord, COORD, WORKER, r.review)).toBe('urgent-wrong-run');
    expect(answer(r.coord, COORD, WORKER, r.outer)).toBe('urgent-wrong-run');
  });

  it('a peer, another coordinator, or a worker to its own coordinator: urgent-not-allowed', async () => {
    const r = await rig(); app = r.app;
    expect(answer(r.coord, PEER, WORKER, r.work)).toBe('urgent-not-allowed');
    expect(answer(r.coord, OTHER_COORD, WORKER, r.outer)).toBe('urgent-not-allowed');
    expect(answer(r.coord, WORKER, COORD, r.work)).toBe('urgent-not-allowed');
  });

  it('a coordinator to its worker on a terminal run: urgent-not-allowed', async () => {
    const r = await rig(); app = r.app;
    expect(r.coord.advance(r.work, 'failed', 'coordinator')).toMatchObject({ ok: true });
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('urgent-not-allowed');
  });

  it("a reused worker name: an earlier occupant's open run never lets its coordinator through for the new occupant (F1)", async () => {
    const r = await rig(); app = r.app;
    const OLD = 1_700_000_000_000;
    const BORN = OLD + 5_000_000;
    const at = (id: number, openedAt: number, dispatchStartedAt: number | null) =>
      r.coord.db.prepare('UPDATE runs SET openedAt = ?, dispatchStartedAt = ? WHERE id = ?').run(openedAt, dispatchStartedAt, id);
    // OTHER_COORD's run, still open, bound the name when an earlier occupant was born; PEER's run minted the occupant now.
    // Programme lifecycle W1 (R11, D-8993): OTHER_COORD owns program-b, so its ghost run is that programme's next wave.
    const ghost = r.coord.openRun({ program: 'program-b', title: 'program-b', project: 'project-a', wave: 2, waveOf: 3, claimedBy: OTHER_COORD });
    const live = r.coord.openRun({ program: 'program-new', title: 'new', project: 'project-a', wave: 1, waveOf: 3, claimedBy: PEER });
    if (!('id' in ghost) || !('id' in live)) throw new Error('openRun refused');
    at(ghost.id, OLD, OLD);
    r.coord.setSession(ghost.id, 'lane-a-reused', OLD);
    at(live.id, BORN, BORN);
    r.coord.setSession(live.id, 'lane-a-reused', BORN);
    const mark: ChildMark = { kind: 'child', runId: live.id };
    expect(answer(r.coord, OTHER_COORD, 'lane-a-reused', ghost.id, mark)).toBe('urgent-not-allowed');
    expect(answer(r.coord, PEER, 'lane-a-reused', live.id, mark)).toBe('allowed:coordinator');
    // CONTROL: by the bare id string (no mark), the earlier occupant's coordinator would pass.
    expect(answer(r.coord, OTHER_COORD, 'lane-a-reused', ghost.id, NO_MARK)).toBe('allowed:coordinator');
  });

  it('the designated Overlord to a coordinator, naming a run it claims: allowed, as overlord; no run: wrong-run; undesignated: not allowed', async () => {
    const r = await rig(); app = r.app;
    expect(answer(r.coord, OVERLORD, OTHER_COORD, r.outer)).toBe('urgent-not-allowed');
    designateOverlord(r);
    expect(answer(r.coord, OVERLORD, OTHER_COORD, r.outer)).toBe('allowed:overlord');
    expect(answer(r.coord, OVERLORD, OTHER_COORD, null)).toBe('urgent-wrong-run');
    expect(answer(r.coord, OVERLORD, PEER, r.outer)).toBe('urgent-not-allowed');
  });

  it('a mark that cannot be read, or a binding series the store cannot represent, is urgent-unmeasured (F1)', async () => {
    const r = await rig(); app = r.app;
    expect(answer(r.coord, COORD, WORKER, r.work, { kind: 'unreadable' })).toBe('urgent-unmeasured');
    const real = r.coord.bindingsOf.bind(r.coord);
    vi.spyOn(r.coord, 'bindingsOf').mockImplementation((id: string) => ({
      ...real(id), worker: () => ({ ok: false, kind: 'run-unreadable', detail: 'a row this build cannot represent' }),
    }));
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('urgent-unmeasured');
  });

  it('a fact read that throws is urgent-unmeasured, whichever read it is (F3)', async () => {
    const r = await rig(); app = r.app;
    const real = r.coord.bindingsOf.bind(r.coord);
    const boom = (): never => { throw new Error('SQLITE_IOERR: disk I/O error'); };
    vi.spyOn(r.coord, 'bindingsOf').mockImplementation((id: string) => ({ ...real(id), claimant: boom }));
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('urgent-unmeasured');
    vi.restoreAllMocks();
    vi.spyOn(r.coord, 'urgentOutstanding').mockImplementation(boom);
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('urgent-unmeasured');
    vi.restoreAllMocks();
    vi.spyOn(r.coord, 'bindingsOf').mockImplementation(boom);
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('urgent-unmeasured');
    vi.restoreAllMocks();
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('allowed:coordinator');
  });

  it('an urgent mail from the same sender to the same recipient still outstanding: urgent-outstanding until it is acked', async () => {
    const r = await rig(); app = r.app;
    const first = writeUrgent(r.coord, COORD, WORKER, r.work);
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('urgent-outstanding');
    expect(r.coord.markAcked(first, Date.now())).toMatchObject({ ok: true });
    expect(answer(r.coord, COORD, WORKER, r.work)).toBe('allowed:coordinator');
  });

  it("and is allowed again once its named run closes, which releases it (spec §3.2)", async () => {
    const r = await rig(); app = r.app;
    // Wave 2 opened before wave 1 closes: the first urgent mail names wave 1, whose close releases it.
    const wave2 = r.coord.openRun({ program: 'program-a', title: 'program-a', project: 'project-a', wave: 2, waveOf: 3, claimedBy: COORD });
    if (!('id' in wave2)) throw new Error('openRun refused');
    r.coord.setSession(wave2.id, WORKER);
    writeUrgent(r.coord, COORD, WORKER, r.work);
    expect(answer(r.coord, COORD, WORKER, wave2.id)).toBe('urgent-outstanding');
    r.coord.cancelOutstandingDeliveries(r.work);
    expect(answer(r.coord, COORD, WORKER, wave2.id)).toBe('allowed:coordinator');
  });

  it('keyed on the pair: a different allowed sender to the same recipient is allowed while the first stands', async () => {
    const r = await rig(); app = r.app;
    // COORD works on OTHER_COORD's run and on a run of a third coordinator, so two senders may mark mail to it.
    const third = r.coord.openRun({ program: 'program-c', title: 'c', project: 'project-a', wave: 1, waveOf: 3, claimedBy: PEER });
    if (!('id' in third)) throw new Error('openRun refused');
    r.coord.setSession(third.id, COORD);
    writeUrgent(r.coord, OTHER_COORD, COORD, r.outer);
    expect(answer(r.coord, PEER, COORD, third.id)).toBe('allowed:coordinator');
    expect(answer(r.coord, OTHER_COORD, COORD, r.outer)).toBe('urgent-outstanding');
  });
});

const rejections = (c: CoordStore): number => (c.db.prepare('SELECT COUNT(*) AS n FROM mail_rejections').get() as { n: number }).n;
const keyed = (r: Rig, clientKey: string, urgent: boolean | undefined) =>
  send(r.app, { fromId: COORD, toId: WORKER, runId: r.work, subject: 'keyed', clientKey, ...(urgent === undefined ? {} : { urgent }) });

describe('POST /api/mail: the urgent ingress (plan Task 2.4)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (app) await app.close(); app = undefined; });

  it('urgent: true from an allowed sender answers 202 with urgent: true, stores the role and holds the recipient', async () => {
    const r = await rig(); app = r.app;
    const res = await urgentTo(r, COORD, WORKER);
    expect(res.statusCode, res.body).toBe(202);
    const body = res.json() as { id: number };
    expect(body).toEqual({ ok: true, id: body.id, urgent: true });
    expect(urgentAsOf(r.coord, body.id)).toBe('coordinator');
    expect([...r.coord.urgentHolds().keys()]).toEqual([WORKER]);
  });

  it('a role address resolves first: urgent mail to the worker role of the named run is ruled for the resolved session', async () => {
    const r = await rig(); app = r.app;
    const res = await urgentTo(r, COORD, 'worker');
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ ok: true, urgent: true });
    expect([...r.coord.urgentHolds().keys()]).toEqual([WORKER]);
  });

  it('urgent absent, null or false answers as before, with no urgent field, and marks nothing', async () => {
    const r = await rig(); app = r.app;
    for (const urgent of [undefined, null, false]) {
      const res = await send(r.app, { fromId: COORD, toId: WORKER, runId: r.work, subject: `s ${String(urgent)}`,
        ...(urgent === undefined ? {} : { urgent }) });
      expect(res.statusCode, `${String(urgent)}: ${res.body}`).toBe(202);
      const body = res.json() as { id: number };
      expect(body).toEqual({ ok: true, id: body.id });
      expect(urgentAsOf(r.coord, body.id)).toBeNull();
    }
    expect(r.coord.urgentHolds().size).toBe(0);
    expect(counts(r.coord)).toEqual({ mail: 3, deliveries: 3 });
  });

  it('urgent that is not a boolean is refused bad-kind, and writes no mail', async () => {
    const r = await rig(); app = r.app;
    for (const urgent of ['true', 1, 0, {}, []]) {
      const res = await send(r.app, { fromId: COORD, toId: WORKER, runId: r.work, subject: 's', urgent });
      expect(res.statusCode, `${JSON.stringify(urgent)}: ${res.body}`).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-kind' });
    }
    expect(counts(r.coord)).toEqual({ mail: 0, deliveries: 0 });
  });

  it('a refused sender, a wrong run and an unreadable fact each answer their word, record it, write no mail and echo nothing', async () => {
    const r = await rig(); app = r.app;
    const cases: [() => Promise<{ statusCode: number; body: string; json: () => unknown }>, number, string][] = [
      [() => urgentTo(r, PEER, WORKER), 403, 'urgent-not-allowed'],
      [() => urgentTo(r, COORD, WORKER, 'urgent', r.review), 400, 'urgent-wrong-run'],
    ];
    for (const [go, status, code] of cases) {
      const res = await go();
      expect(res.statusCode, res.body).toBe(status);
      expect(res.json()).toMatchObject({ ok: false, error: code });
      expect(res.json()).not.toHaveProperty('urgent');
    }
    vi.spyOn(r.coord, 'bindingsOf').mockImplementation(() => { throw new Error('SQLITE_IOERR: disk I/O error'); });
    const unread = await urgentTo(r, COORD, WORKER);
    expect(unread.statusCode, unread.body).toBe(503);
    expect(unread.json()).toMatchObject({ ok: false, error: 'urgent-unmeasured' });
    expect(unread.json()).not.toHaveProperty('urgent');
    vi.restoreAllMocks();
    expect(counts(r.coord)).toEqual({ mail: 0, deliveries: 0 });
    expect(rejections(r.coord)).toBe(3);
  });

  it("a recipient whose registry mark cannot be read is urgent-unmeasured, never not-allowed (F1)", async () => {
    const r = await rig(); app = r.app;
    writeFileSync(path.join(r.home, '.cc-sessions', `${WORKER}.child`), 'not a run id');
    const res = await urgentTo(r, COORD, WORKER);
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'urgent-unmeasured' });
    expect(counts(r.coord)).toEqual({ mail: 0, deliveries: 0 });
  });

  it("a role address whose resolved session is listed but whose row cannot be built is urgent-unmeasured (review 3069 F2)", async () => {
    const r = await rig(); app = r.app;
    // WORKER's `.uuid` stays listed, but a missing field means its row cannot be built, so check 8.5 reads its mark as
    // unreadable. A literal id would be refused registry-unmeasurable at check 7; only a role address reaches this arm.
    rmSync(path.join(r.home, '.cc-sessions', `${WORKER}.workdir`));
    const res = await urgentTo(r, COORD, 'worker');
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'urgent-unmeasured' });
    expect(counts(r.coord)).toEqual({ mail: 0, deliveries: 0 });
  });

  it('a second urgent mail from the same sender to the same recipient is refused urgent-outstanding until the first is acked', async () => {
    const r = await rig(); app = r.app;
    const first = await urgentTo(r, COORD, WORKER, 'first');
    expect(first.statusCode, first.body).toBe(202);
    const second = await urgentTo(r, COORD, WORKER, 'second');
    expect(second.statusCode, second.body).toBe(409);
    expect(second.json()).toMatchObject({ ok: false, error: 'urgent-outstanding' });
    // The same second mail without urgent is ordinary mail, and accepted.
    const plain = await send(r.app, { fromId: COORD, toId: WORKER, runId: r.work, subject: 'second' });
    expect(plain.statusCode, plain.body).toBe(202);
    const delivery = (r.coord.db.prepare('SELECT id FROM mail_deliveries WHERE mailId = ?').get((first.json() as { id: number }).id) as { id: number }).id;
    expect(r.coord.markAcked(delivery, Date.now())).toMatchObject({ ok: true });
    const third = await urgentTo(r, COORD, WORKER, 'third');
    expect(third.statusCode, third.body).toBe(202);
  });

  it("is accepted again once the first mail's run closes, which releases it (spec §3.2)", async () => {
    const r = await rig(); app = r.app;
    const wave2 = r.coord.openRun({ program: 'program-a', title: 'program-a', project: 'project-a', wave: 2, waveOf: 3, claimedBy: COORD });
    if (!('id' in wave2)) throw new Error('openRun refused');
    r.coord.setSession(wave2.id, WORKER);
    expect((await urgentTo(r, COORD, WORKER, 'wave 1')).statusCode).toBe(202);
    expect((await urgentTo(r, COORD, WORKER, 'wave 2', wave2.id)).statusCode).toBe(409);
    r.coord.cancelOutstandingDeliveries(r.work);
    const res = await urgentTo(r, COORD, WORKER, 'wave 2', wave2.id);
    expect(res.statusCode, res.body).toBe(202);
  });

  it('keyed on the pair: another sender the rule allows may mark mail to the same recipient while the first stands', async () => {
    const r = await rig(); app = r.app;
    // COORD works on OTHER_COORD's run and on a run PEER claims, so two coordinators may mark mail to it.
    const third = r.coord.openRun({ program: 'program-c', title: 'c', project: 'project-a', wave: 1, waveOf: 3, claimedBy: PEER });
    if (!('id' in third)) throw new Error('openRun refused');
    r.coord.setSession(third.id, COORD);
    expect((await urgentTo(r, OTHER_COORD, COORD, 'from b', r.outer)).statusCode).toBe(202);
    const res = await urgentTo(r, PEER, COORD, 'from c', third.id);
    expect(res.statusCode, res.body).toBe(202);
    expect(r.coord.urgentHolds().get(COORD)?.length).toBe(2);
  });

  it('two concurrent urgent sends to one recipient write one urgent row (P4)', async () => {
    const r = await rig(); app = r.app;
    const both = await Promise.all([urgentTo(r, COORD, WORKER, 'one'), urgentTo(r, COORD, WORKER, 'two')]);
    expect(both.map((x) => x.statusCode).sort()).toEqual([202, 409]);
    expect(counts(r.coord)).toEqual({ mail: 1, deliveries: 1 });
  });

  it('urgent is part of a keyed mail: a retry answers the replay with urgent, never urgent-outstanding; adding or dropping it is key-conflict (N10)', async () => {
    const r = await rig(); app = r.app;
    const first = await keyed(r, 'k-urgent', true);
    expect(first.statusCode, first.body).toBe(202);
    const id = (first.json() as { id: number }).id;
    expect(first.json()).toEqual({ ok: true, id, clientKey: 'k-urgent', urgent: true });
    const retry = await keyed(r, 'k-urgent', true);
    expect(retry.statusCode, retry.body).toBe(202);
    expect(retry.json()).toEqual({ ok: true, id, already: true, clientKey: 'k-urgent', urgent: true });
    const dropped = await keyed(r, 'k-urgent', undefined);
    expect(dropped.statusCode, dropped.body).toBe(409);
    expect(dropped.json()).toMatchObject({ ok: false, error: 'key-conflict' });
    const plain = await keyed(r, 'k-plain', false);
    expect(plain.json()).toEqual({ ok: true, id: (plain.json() as { id: number }).id, clientKey: 'k-plain' });
    const added = await keyed(r, 'k-plain', true);
    expect(added.statusCode, added.body).toBe(409);
    expect(added.json()).toMatchObject({ ok: false, error: 'key-conflict' });
    expect((await keyed(r, 'k-plain', undefined)).json()).toMatchObject({ already: true, clientKey: 'k-plain' });
    expect((await keyed(r, 'k-plain', undefined)).json()).not.toHaveProperty('urgent');
    expect(counts(r.coord)).toEqual({ mail: 2, deliveries: 2 });
  });

  it("the designated Overlord's own session is refused at this door before the urgent rule runs (slug overlord-urgent-unreachable-at-the-ingress)", async () => {
    const r = await rig(); app = r.app;
    designateOverlord(r);
    const res = await urgentTo(r, OVERLORD, COORD, 'from the overlord', null);
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'overlord-uses-its-doors' });
  });
});

describe("a reclaim carries an urgent mail to the displaced coordinator, and its hold, to the heir (review 2833 F3)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (app) await app.close(); app = undefined; });

  it('the heir holds the urgent delivery and the displaced id does not; ordinary mail by id and a worker\'s hold stay put', async () => {
    const r = await rig(); app = r.app;
    // The Overlord arm's mail to OTHER_COORD about the run it claims, by session id; an ordinary mail beside it.
    const urgent = writeUrgent(r.coord, OVERLORD, OTHER_COORD, r.outer, 'overlord');
    const plain = r.coord.insertMail({ fromId: PEER, fromUuid: UUID, toId: OTHER_COORD, runId: r.outer, kind: 'status',
      subject: 'p', body: 'b', artifacts: [] });
    const plainDelivery = r.coord.queueDelivery(plain.id, OTHER_COORD, `<mail>${plain.id}</mail>`).id;
    // A coordinator-arm urgent mail to OTHER_COORD's worker (COORD): the worker is not displaced.
    const toWorker = writeUrgent(r.coord, OTHER_COORD, COORD, r.outer);
    expect(r.coord.urgentHolds().get(OTHER_COORD)).toEqual([{ deliveryId: urgent, role: 'overlord' }]);
    expect(r.coord.reclaimProgram(r.outer, PEER, NOW, null)).toMatchObject({ ok: true });
    const holds = r.coord.urgentHolds();
    expect(holds.get(PEER)).toEqual([{ deliveryId: urgent, role: 'overlord' }]);
    expect(holds.has(OTHER_COORD)).toBe(false);
    expect(holds.get(COORD)).toEqual([{ deliveryId: toWorker, role: 'coordinator' }]);
    expect(r.coord.delivery(plainDelivery)?.toId).toBe(OTHER_COORD);
  });

  it("a run coordinator's urgent mail to its worker stays put when that worker is later displaced as claimant (review 3069 F3)", async () => {
    const r = await rig(); app = r.app;
    // COORD's urgent mail to its worker WORKER about the work run. A reclaim hands the programme to WORKER itself, its own
    // live worker (D-3028), and a second reclaim displaces WORKER: the mail is a worker's, so it never moves. Programme
    // lifecycle W1 (R11, D-8993): the worker made heir is one that owns no other programme, so the rig's COORD (which owns
    // program-a) cannot be program-b's heir; program-a's own worker plays the part.
    const toWorker = writeUrgent(r.coord, COORD, WORKER, r.work);
    expect(r.coord.reclaimProgram(r.work, WORKER, NOW, null)).toMatchObject({ ok: true });
    expect(r.coord.reclaimProgram(r.work, PEER, NOW + 1, null)).toMatchObject({ ok: true });
    expect(r.coord.urgentHolds().get(WORKER)).toEqual([{ deliveryId: toWorker, role: 'coordinator' }]);
    expect(r.coord.urgentHolds().has(PEER)).toBe(false);
  });

  it("another programme's reclaim leaves it where it is", async () => {
    const r = await rig(); app = r.app;
    const urgent = writeUrgent(r.coord, OVERLORD, OTHER_COORD, r.outer, 'overlord');
    // Programme lifecycle W1 (R11, D-8993): openRun no longer lets OTHER_COORD claim a run in a second programme, but a
    // migration conflict (spec §13, `session-in-several`) or a hand-recovered row still leaves one session claiming runs in
    // two programmes, so program-d's run is opened by another claimant and then hand-written onto OTHER_COORD, as such a
    // row stands. The reclaim then displaces OTHER_COORD from program-d, and its program-b hold must stay where it is.
    const other = r.coord.openRun({ program: 'program-d', title: 'd', project: 'project-a', wave: 1, waveOf: 3, claimedBy: 'lane-a-legacy' });
    if (!('id' in other)) throw new Error('openRun refused');
    r.coord.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run(OTHER_COORD, other.id);
    expect(r.coord.reclaimProgram(other.id, PEER, NOW, null)).toMatchObject({ ok: true });
    expect(r.coord.urgentHolds().get(OTHER_COORD)).toEqual([{ deliveryId: urgent, role: 'overlord' }]);
    expect(r.coord.urgentHolds().has(PEER)).toBe(false);
  });
});
