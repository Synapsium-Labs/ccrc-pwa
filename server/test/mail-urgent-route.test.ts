// Urgent mail's sender rule over the store's facts (mid-turn mail PR 2, plan Tasks 2.3 and 2.4; spec §3.1), and the mail
// ingress as it stands until its own PR lands (slug `ingress-waits-for-routes`). `CoordStore.urgentVerdict` reads the
// binding's one view, the designation and the pair's outstanding urgent mail, and `urgentSenderVerdict` (L1) decides:
// who may mark a mail urgent, and one outstanding urgent mail per sender and recipient (P4). `POST /api/mail` does not
// read `urgent` yet, so every send is treated as today and no mail is marked urgent.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  bindPendingGeneration, designatePending, goLive, type AuthorityAppender,
} from '../src/coord/overlordDesignationStore.js';
import { actorOf } from '../src/accounts/audit.js';
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
    incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) }).operator(actorOf('operator-a', '0123456789abcdef'));
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
    const ghost = r.coord.openRun({ program: 'program-old', title: 'old', project: 'project-a', wave: 1, waveOf: 3, claimedBy: OTHER_COORD });
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

describe('POST /api/mail until its ingress lands (slug ingress-waits-for-routes)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (app) await app.close(); app = undefined; });

  it('the route ignores urgent: a send carrying it, of any value, is treated as today, echoes nothing and marks nothing', async () => {
    const r = await rig(); app = r.app;
    for (const urgent of [true, false, 'true', 1, null]) {
      const res = await send(r.app, { fromId: COORD, toId: WORKER, runId: r.work, subject: `s ${JSON.stringify(urgent)}`, urgent });
      expect(res.statusCode, `${JSON.stringify(urgent)}: ${res.body}`).toBe(202);
      const body = res.json() as { id: number };
      expect(body).toEqual({ ok: true, id: body.id });
      expect(urgentAsOf(r.coord, body.id)).toBeNull();
    }
    expect(r.coord.urgentHolds().size).toBe(0);
    expect(counts(r.coord)).toEqual({ mail: 5, deliveries: 5 });
  });

  it("the designated Overlord's own session is refused at this door before the urgent rule runs (slug overlord-urgent-unreachable-at-the-ingress)", async () => {
    const r = await rig(); app = r.app;
    designateOverlord(r);
    const res = await urgentTo(r, OVERLORD, COORD, 'from the overlord', null);
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'overlord-uses-its-doors' });
  });
});
