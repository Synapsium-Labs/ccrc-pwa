// Programme lifecycle W2 (spec 2026-11-24 §5, §8, §9, §11, §14; D-8987, D-8989, D-8992, D-8993): the operator's doors and
// the reads, driven through their handlers (`programmeDoors`) over a real coord.db and a fixture registry, with the account
// gate stubbed to pass or to refuse as the credential rule asks. Fixture HOME only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { programmeDoors, programmesWithLifecycle, raiseEndProposal } from '../src/coord/programmeLifecycleRoutes.js';
import { coordinatorReadingOf } from '../src/coord/programmeCoordinatorReading.js';
import { otherLaneReadsOf } from '../src/coord/otherLaneReads.js';
import * as lifecycle from '../src/coord/programmeLifecycleStore.js';
import type { CloseOutcome } from '../src/coord/close.js';
import type { ProgrammesAnswer } from '../../shared/api.js';
import { lifecycleOf } from '../../shared/programmeLifecycle.js';
import { seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; removeTmpFixtures(); });

interface Rig {
  app: FastifyInstance; coord: CoordStore; home: string;
  /** What the account gate answers: pass (signed in, stepped up), or refuse `auth-off` as it does dark. */
  gate: { mode: 'pass' | 'dark' };
  abandoned: number[];
}

/** prog-a: lane-a's, one open run dispatched (Active). lane-b and lane-c are registry rows that own nothing. */
async function rig(opts: { authEnabled?: boolean } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-programme-doors-');
  for (const id of ['lane-a', 'lane-b', 'lane-c', 'lane-d']) seedRow(home, id, { project: 'project-a' });
  const deps = testDeps(home);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const gate: Rig['gate'] = { mode: 'pass' };
  const abandoned: number[] = [];
  const otherLaneReads = otherLaneReadsOf({ coord, io: deps.io, cfg: deps.cfg });
  const doors = programmeDoors({
    coord, now: () => Date.now(), authEnabled: opts.authEnabled ?? false,
    gate: (_req, reply, ask) => {
      if (gate.mode === 'pass') return { pass: true, actor: (ask.stepUp === true ? 'device:stepped' : 'device:signed') as never, sessionIdHash: 'h' };
      reply.code(501).send({ ok: false, error: 'auth-off' });
      return { pass: false };
    },
    identity: { operator: (a) => ({ subject: String(a) }) as never },
    sessionAuth: () => ({ allow: true, verdict: 'ok', reason: 'session', device: 'phone' }) as never,
    withAbandon: async (_c, fn) => fn(async (runId: number): Promise<CloseOutcome> => {
      abandoned.push(runId);
      coord.closeRun({ runId, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'prog-a', viaClosing: false, detail: 'abandon:test' });
      return { ok: true } as never;
    }, () => null) as never,
    sendClose: (reply: FastifyReply, o: CloseOutcome) => reply.code(409).send(o),
    changed: () => undefined,
    ports: { reclaim: { coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux, otherLaneReads }, serial: (fn) => fn(),
      readingOf: (s) => coordinatorReadingOf(deps.io, deps.cfg, s) },
  });
  app = Fastify({ logger: false });
  app.post('/api/programmes', (req, reply) => doors.start(req, reply));
  app.post('/api/programmes/:slug/state', (req, reply) => doors.state(req, reply));
  app.post('/api/programmes/:slug/coordinator', (req, reply) => doors.handOver(req, reply));
  app.post('/api/items/:id/act', (req, reply) => doors.confirm(req, reply, coord.itemById(Number((req.params as { id: string }).id))!));
  app.post('/api/items/:id/decline', (req, reply) => doors.decline(req, reply, coord.itemById(Number((req.params as { id: string }).id))!));
  app.get('/api/programmes/:slug/history', (req, reply) => doors.history(req, reply));
  app.get('/api/sessions/:id/programme', (req, reply) => doors.sessionProgramme(req, reply));
  const id = (coord.openRun({ program: 'prog-a', title: 'Programme A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a', claimedByUuid: 'u-lane-a' }) as { id: number }).id;
  expect(coord.advance(id, 'dispatched', 'coordinator').ok).toBe(true);
  return { app, coord, home, gate, abandoned };
}

const post = (r: Rig, url: string, payload: unknown) => r.app.inject({ method: 'POST', url, payload: payload as never });
const events = (r: Rig, slug: string) => r.coord.db.prepare('SELECT edge, actorKind, actor, why, session, detail FROM programme_events WHERE program = ? ORDER BY id')
  .all(slug) as { edge: string; actorKind: string; actor: string; why: string; session: string | null; detail: string | null }[];
const mails = (r: Rig) => r.coord.db.prepare('SELECT toId, subject, body FROM mail ORDER BY id').all() as { toId: string; subject: string; body: string }[];
const row = (r: Rig, slug: string) => r.coord.programmeLifecycleRow(slug)!;
const closeAll = (r: Rig, slug: string) => {
  r.coord.db.prepare("UPDATE runs SET state = 'done', closedAt = ? WHERE program = ? AND state NOT IN ('done', 'failed')").run(Date.now(), slug);
};
const facts = (r: Rig, slug: string) => r.coord.programmeLifecycleRows().find((f) => f.slug === slug)!;

describe('POST /api/programmes: the start (spec §5 start row, R11 rule 4)', () => {
  it('refuses a start with no coordinator (coordinator-required, until W4 ships the pick) and a missing why', async () => {
    const r = await rig();
    expect((await post(r, '/api/programmes', { slug: 'prog-new', why: 'x' })).json()).toMatchObject({ error: 'coordinator-required' });
    expect((await post(r, '/api/programmes', { slug: 'prog-new', coordinator: 'lane-b' })).json()).toMatchObject({ error: 'why-required' });
    expect(row(r, 'prog-a')).toBeDefined();
    expect(r.coord.programmeLifecycleRow('prog-new')).toBeNull();
  });

  it('starts a programme naming a session: bound with its measured uuid, started and coordinator events, the session told', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes', { slug: 'prog-new', title: 'New objective', why: 'a business objective', coordinator: 'lane-b' });
    expect(res.statusCode, res.body).toBe(200);
    expect(row(r, 'prog-new')).toMatchObject({ state: 'active', coordinator: 'lane-b', coordinatorUuid: 'u-lane-b', placeholder: null });
    expect(events(r, 'prog-new').map((e) => [e.edge, e.actorKind, e.actor])).toEqual([
      ['started', 'operator', 'device:signed'], ['coordinator', 'operator', 'device:signed']]);
    expect(lifecycleOfRow(r, 'prog-new')).toBe('open');
    expect((await post(r, '/api/programmes', { slug: 'prog-new', why: 'again', coordinator: 'lane-c' })).json()).toMatchObject({ error: 'slug-taken' });
  });

  it('refuses a coordinator that owns another live programme (owns-another-programme), writing nothing', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes', { slug: 'prog-new', why: 'x', coordinator: 'lane-a' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'owns-another-programme', by: 'prog-a' });
    expect(r.coord.programmeLifecycleRow('prog-new')).toBeNull();
  });

  it('admits a coordinator that owns only an unfiled placeholder, and withdraws the placeholder', async () => {
    const r = await rig();
    r.coord.db.exec('BEGIN');
    lifecycle.mintInTx(r.coord.db, { slug: 'p-abc', title: 'p-abc', state: 'active', placeholder: 'unfiled', actor: { kind: 'system', id: 'sweep' },
      why: 'joined at spawn', coordinator: { session: 'lane-b', uuid: 'u-lane-b' } }, Date.now());
    r.coord.db.exec('COMMIT');
    const res = await post(r, '/api/programmes', { slug: 'prog-new', why: 'x', coordinator: 'lane-b' });
    expect(res.statusCode, res.body).toBe(200);
    expect(row(r, 'p-abc')).toMatchObject({ placeholder: 'withdrawn', coordinator: null });
    expect(row(r, 'prog-new').coordinator).toBe('lane-b');
  });

  it('takes the account gate: dark, it refuses and writes nothing', async () => {
    const r = await rig();
    r.gate.mode = 'dark';
    const res = await post(r, '/api/programmes', { slug: 'prog-new', why: 'x', coordinator: 'lane-b' });
    expect([res.statusCode, res.json().error]).toEqual([501, 'auth-off']);
    expect(r.coord.programmeLifecycleRow('prog-new')).toBeNull();
  });
});

const lifecycleOfRow = (r: Rig, slug: string) => { const f = facts(r, slug); return lifecycleOf(f.state, f.placeholder, f); };

describe('POST /api/programmes/:slug/state (spec §5)', () => {
  it('pause works while sign-in is dark, recording actor unmeasured and flag-off; resume takes the step-up', async () => {
    const r = await rig();
    r.gate.mode = 'dark';
    const res = await post(r, '/api/programmes/prog-a/state', { edge: 'pause', why: 'hold it' });
    expect(res.statusCode, res.body).toBe(200);
    expect(row(r, 'prog-a').state).toBe('paused');
    const pause = events(r, 'prog-a').at(-1)!;
    expect([pause.edge, pause.actorKind, pause.actor, JSON.parse(pause.detail!)]).toEqual(['pause', 'operator', 'unmeasured', { signIn: 'flag-off' }]);
    const dark = await post(r, '/api/programmes/prog-a/state', { edge: 'resume', why: 'go' });
    expect([dark.statusCode, dark.json().error]).toEqual([501, 'auth-off']);
    expect(row(r, 'prog-a').state).toBe('paused');
    r.gate.mode = 'pass';
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'resume', why: 'go' })).statusCode).toBe(200);
    expect(row(r, 'prog-a').state).toBe('active');
    expect(events(r, 'prog-a').at(-1)).toMatchObject({ edge: 'resume', actor: 'device:stepped' });
  });

  it('an armed pause records the signed-in device', async () => {
    const r = await rig({ authEnabled: true });
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'pause', why: 'hold' })).statusCode).toBe(200);
    expect(events(r, 'prog-a').at(-1)).toMatchObject({ edge: 'pause', actor: 'device:phone', detail: null });
  });

  it('end over open runs is refused without abandonRuns, and Done is refused even with it', async () => {
    const r = await rig();
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'end', outcome: 'abandoned', why: 'stop' })).json()).toMatchObject({ error: 'programme-runs-open' });
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'end', outcome: 'done', why: 'stop', abandonRuns: true })).json()).toMatchObject({ error: 'programme-runs-open' });
    expect(row(r, 'prog-a').state).toBe('active');
    expect(r.abandoned).toEqual([]);
  });

  it('end with abandonRuns abandons the open runs first, then ends Abandoned and releases the binding', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/state', { edge: 'end', outcome: 'abandoned', why: 'objective dropped', abandonRuns: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.abandoned).toHaveLength(1);
    expect(row(r, 'prog-a')).toMatchObject({ state: 'abandoned', planEnd: 'abandoned', coordinator: null });
    expect(JSON.parse(events(r, 'prog-a').at(-1)!.detail!)).toMatchObject({ released: 'lane-a' });
  });

  it('every end leaves the programme with no coordinator, mails "You own no programme now", and a reopen shows no coordinator', async () => {
    const r = await rig();
    closeAll(r, 'prog-a');
    expect(lifecycleOfRow(r, 'prog-a')).toBe('idle');
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'end', outcome: 'done', why: 'shipped' })).statusCode).toBe(200);
    expect(row(r, 'prog-a')).toMatchObject({ state: 'done', planEnd: 'done', coordinator: null });
    expect(mails(r).filter((m) => m.toId === 'lane-a').map((m) => m.subject)).toEqual(['You own no programme now']);
    expect(mails(r)[0]!.body).toMatch(/open no runs until then/);
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'end', outcome: 'abandoned', why: 'again' })).json()).toMatchObject({ error: 'programme-ended' });
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'reopen', why: 'more to do' })).statusCode).toBe(200);
    expect(row(r, 'prog-a')).toMatchObject({ state: 'active', planEnd: null, coordinator: null });
    expect(lifecycleOfRow(r, 'prog-a')).toBe('idle');
    const read = await programmesWithLifecycle(r.coord, { ok: true, programmes: [], closedToday: { operator: 0, sweep: 0, coordinator: 0 } } as ProgrammesAnswer,
      (s) => coordinatorReadingOf(testDeps(r.home).io, testDeps(r.home).cfg, s));
    expect(read.programmes.find((p) => p.slug === 'prog-a')).toMatchObject({ lifecycle: 'idle', coordinatorLine: 'no-coordinator', coordinator: null });
    expect(read.coordinatorsWithoutProgramme).toEqual([expect.objectContaining({ session: 'lane-a', why: 'ended', last: 'prog-a' })]);
  });

  it('repair: only an unreadable stored value, recording it', async () => {
    const r = await rig();
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'repair', to: 'paused', why: 'x' })).json()).toMatchObject({ error: 'not-unknown' });
    r.coord.db.prepare("UPDATE programs SET state = 'retired-by-hand' WHERE slug = 'prog-a'").run();
    expect((await post(r, '/api/programmes/prog-a/state', { edge: 'repair', to: 'paused', why: 'it was held' })).statusCode).toBe(200);
    expect(row(r, 'prog-a').state).toBe('paused');
    expect(JSON.parse(events(r, 'prog-a').at(-1)!.detail!)).toEqual({ unreadable: 'retired-by-hand' });
  });

  it('every edge is refused on a placeholder, and an unknown slug is unknown-programme', async () => {
    const r = await rig();
    r.coord.db.exec('BEGIN');
    lifecycle.mintInTx(r.coord.db, { slug: 'p-abc', title: 'p-abc', state: 'active', placeholder: 'unfiled', actor: { kind: 'system', id: 'sweep' }, why: 'w' }, Date.now());
    r.coord.db.exec('COMMIT');
    expect((await post(r, '/api/programmes/p-abc/state', { edge: 'pause', why: 'x' })).json()).toMatchObject({ error: 'programme-provisional' });
    expect((await post(r, '/api/programmes/p-abc/coordinator', { session: 'lane-b', why: 'x' })).json()).toMatchObject({ error: 'programme-provisional' });
    const none = await post(r, '/api/programmes/nope/state', { edge: 'pause', why: 'x' });
    expect([none.statusCode, none.json().error]).toEqual([404, 'unknown-programme']);
  });
});

describe('POST /api/programmes/:slug/coordinator: the hand-over (spec §3 ladder, §5)', () => {
  it('moves a LIVE coordinator\'s programme to an heir (rung 4 skipped), its claims with it, and mails both', async () => {
    const r = await rig();
    const res = await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-b', why: 'lane-a is needed elsewhere' });
    expect(res.statusCode, res.body).toBe(200);
    expect(row(r, 'prog-a')).toMatchObject({ coordinator: 'lane-b', coordinatorUuid: 'u-lane-b' });
    expect((r.coord.db.prepare("SELECT DISTINCT claimedBy FROM runs WHERE program = 'prog-a'").all() as { claimedBy: string }[]).map((x) => x.claimedBy)).toEqual(['lane-b']);
    expect(events(r, 'prog-a').at(-1)).toMatchObject({ edge: 'coordinator', session: 'lane-b', why: 'lane-a is needed elsewhere', actor: 'device:stepped' });
    const m = mails(r);
    expect(m.find((x) => x.toId === 'lane-a')!.body).toMatch(/prog-a was handed to lane-b: its runs are no longer yours/);
    expect(m.find((x) => x.toId === 'lane-b')!.subject).toBe('You are now the coordinator of prog-a');
    expect(r.coord.claimsProgramme('lane-a', 'prog-a', 'u-lane-a')).toBe(false);
  });

  it('refuses an heir that owns another live programme, and nothing moves', async () => {
    const r = await rig();
    await post(r, '/api/programmes', { slug: 'prog-b', why: 'x', coordinator: 'lane-b' });
    const res = await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-b', why: 'x' });
    expect(res.json()).toMatchObject({ error: 'owns-another-programme', by: 'prog-b' });
    expect(row(r, 'prog-a').coordinator).toBe('lane-a');
  });

  it('hands a programme with no binding and no claimed run over by its binding alone', async () => {
    const r = await rig();
    closeAll(r, 'prog-a');
    await post(r, '/api/programmes/prog-a/state', { edge: 'end', outcome: 'done', why: 'shipped' });
    await post(r, '/api/programmes/prog-a/state', { edge: 'reopen', why: 'more' });
    r.coord.db.prepare("UPDATE runs SET claimedBy = NULL WHERE program = 'prog-a'").run();
    const res = await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-c', why: 'take it' });
    expect(res.statusCode, res.body).toBe(200);
    expect(row(r, 'prog-a').coordinator).toBe('lane-c');
  });

  it('refuses an ended programme, and takes the step-up', async () => {
    const r = await rig();
    r.gate.mode = 'dark';
    expect((await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-b', why: 'x' })).statusCode).toBe(501);
    r.gate.mode = 'pass';
    closeAll(r, 'prog-a');
    await post(r, '/api/programmes/prog-a/state', { edge: 'end', outcome: 'done', why: 'x' });
    expect((await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-b', why: 'x' })).json()).toMatchObject({ error: 'programme-ended' });
  });
});

describe('the end proposal: confirm, decline, withdraw (spec §5, §8)', () => {
  const propose = (r: Rig, evidence = ['it shipped']) =>
    raiseEndProposal(r.coord, { slug: 'prog-a', by: 'lane-a', outcome: 'done', why: 'the objective is met', evidence, via: 'door' }, Date.now());

  it('is refused while a run is open, and raised once the runs closed', async () => {
    const r = await rig();
    expect(propose(r)).toMatchObject({ ok: false, why: 'programme-runs-open' });
    closeAll(r, 'prog-a');
    const p = propose(r);
    expect(p).toMatchObject({ ok: true });
    expect(propose(r)).toMatchObject({ ok: false, why: 'already-asked' });
    expect(events(r, 'prog-a').at(-1)).toMatchObject({ edge: 'end-proposed', actorKind: 'coordinator', actor: 'lane-a' });
  });

  it('confirm is refused dark, refused while a run is open (the item left open), and ends the programme with its evidence', async () => {
    const r = await rig();
    closeAll(r, 'prog-a');
    const p = propose(r) as { ok: true; id: number };
    r.gate.mode = 'dark';
    expect((await post(r, `/api/items/${p.id}/act`, {})).statusCode).toBe(501);
    r.gate.mode = 'pass';
    // A run opened since the proposal: openRun withdraws it in its own transaction.
    const id2 = (r.coord.openRun({ program: 'prog-a', title: 'A', project: 'project-a', wave: 2, waveOf: null, claimedBy: 'lane-a', claimedByUuid: 'u-lane-a' }) as { id: number }).id;
    expect(r.coord.itemById(p.id)!.state).toBe('done');
    expect(events(r, 'prog-a').at(-1)).toMatchObject({ edge: 'end-withdrawn', actorKind: 'system', why: `run ${id2} opened` });
    closeAll(r, 'prog-a');
    const q = propose(r) as { ok: true; id: number };
    const res = await post(r, `/api/items/${q.id}/act`, { programme: 'done' });
    expect(res.statusCode, res.body).toBe(200);
    expect(row(r, 'prog-a')).toMatchObject({ state: 'done', planEnd: 'done', coordinator: null });
    const ended = events(r, 'prog-a').at(-1)!;
    expect(ended).toMatchObject({ edge: 'ended', actor: 'device:stepped', why: 'the objective is met' });
    expect(JSON.parse(ended.detail!)).toMatchObject({ item: q.id, evidence: ['it shipped'], released: 'lane-a' });
    expect(r.coord.itemById(q.id)!.state).toBe('done');
    expect(mails(r).filter((m) => m.toId === 'lane-a').map((m) => m.subject)).toContain('You own no programme now');
  });

  it('confirm refuses while a run is open, leaving the item open', async () => {
    const r = await rig();
    closeAll(r, 'prog-a');
    const p = propose(r) as { ok: true; id: number };
    // A run left open behind the proposal's back (no openRun, so nothing withdrew it).
    r.coord.db.prepare("UPDATE runs SET state = 'working' WHERE program = 'prog-a'").run();
    expect((await post(r, `/api/items/${p.id}/act`, {})).json()).toMatchObject({ error: 'programme-runs-open' });
    expect(r.coord.itemById(p.id)!.state).toBe('open');
    expect(row(r, 'prog-a').state).toBe('active');
  });

  it('decline works dark, mails the coordinator bound at that moment, and a hand-over keeps the proposal for the heir', async () => {
    const r = await rig();
    closeAll(r, 'prog-a');
    const p = propose(r) as { ok: true; id: number };
    expect((await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-b', why: 'swap' })).statusCode).toBe(200);
    expect(r.coord.openEndProposalOf('prog-a')!.id).toBe(p.id);
    r.gate.mode = 'dark';
    const res = await post(r, `/api/items/${p.id}/decline`, { why: 'one more wave' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ mailed: 'lane-b' });
    expect(r.coord.itemById(p.id)!.state).toBe('dismissed');
    expect(mails(r).find((m) => m.subject === 'The end of prog-a was declined')!.toId).toBe('lane-b');
    expect(events(r, 'prog-a').at(-1)).toMatchObject({ edge: 'end-declined', actor: 'unmeasured' });
    expect(row(r, 'prog-a').state).toBe('active');
  });
});

describe('the reads (spec §11, §7)', () => {
  it('the history merges programme events and runs oldest first', async () => {
    const r = await rig();
    await post(r, '/api/programmes/prog-a/state', { edge: 'pause', why: 'hold' });
    const res = await r.app.inject({ method: 'GET', url: '/api/programmes/prog-a/history' });
    const h = res.json().history as { source: string; at: number; edge?: string; toState?: string }[];
    expect(h.map((e) => (e.source === 'programme' ? e.edge : `run:${e.toState}`))).toEqual(
      expect.arrayContaining(['started', 'coordinator', 'run:dispatched', 'pause']));
    for (let i = 1; i < h.length; i++) expect(h[i]!.at).toBeGreaterThanOrEqual(h[i - 1]!.at);
    const at = (k: string) => h.findIndex((e) => (e.source === 'programme' ? e.edge : `run:${e.toState}`) === k);
    expect(at('started')).toBeLessThan(at('pause'));
    expect(at('started')).toBeLessThanOrEqual(at('run:dispatched'));
    expect((await r.app.inject({ method: 'GET', url: '/api/programmes/nope/history' })).statusCode).toBe(404);
  });

  it('a session reads its one programme, or none with why', async () => {
    const r = await rig();
    expect((await r.app.inject({ method: 'GET', url: '/api/sessions/lane-a/programme' })).json())
      .toEqual({ ok: true, programme: { slug: 'prog-a', placeholder: null, lifecycle: 'active' } });
    expect((await r.app.inject({ method: 'GET', url: '/api/sessions/lane-c/programme' })).json()).toEqual({ ok: true, programme: 'none', why: 'never-joined' });
    await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-b', why: 'swap' });
    expect((await r.app.inject({ method: 'GET', url: '/api/sessions/lane-a/programme' })).json()).toEqual({ ok: true, programme: 'none', why: 'handed-over' });
  });

  it('a coordinator that handed over is listed without a programme; a conflict\'s party is not, and its programme carries the conflict', async () => {
    const r = await rig();
    await post(r, '/api/programmes/prog-a/coordinator', { session: 'lane-b', why: 'swap' });
    // lane-c holds an open run in prog-c, which nobody owns (a migration conflict's shape).
    r.coord.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-c', 'C', 1, 'active')").run();
    r.coord.db.prepare("INSERT INTO runs (program, wave, project, state, claimedBy, openedAt, kind) VALUES ('prog-c', 1, 'project-a', 'working', 'lane-c', 1, 'work')").run();
    const deps = testDeps(r.home);
    const read = await programmesWithLifecycle(r.coord, { ok: true, programmes: [], closedToday: { operator: 0, sweep: 0, coordinator: 0 } } as ProgrammesAnswer,
      (s) => coordinatorReadingOf(deps.io, deps.cfg, s));
    expect(read.coordinatorsWithoutProgramme!.map((c) => [c.session, c.why])).toEqual([['lane-a', 'handed-over']]);
    expect(read.programmes.find((p) => p.slug === 'prog-c')).toMatchObject({ claimConflict: { kind: 'session-in-several', claimants: ['lane-c'] } });
    expect(read.programmes.find((p) => p.slug === 'prog-a')).toMatchObject({ lifecycle: 'active', coordinatorLine: 'led', coordinator: 'lane-b' });
  });
});
