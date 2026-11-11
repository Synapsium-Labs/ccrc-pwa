// D-8181 (design 2026-11-10 §4.4): a work run attaches to exactly one ticket of its programme's plan, in the same transaction
// that inserts it. Over a real coord.db and the real route (`POST /api/runs`), with the plan declared through the plan route.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { planStorePort, type PlanStorePort } from '../src/coord/planStore.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { seedLegacyProgramme } from './helpers/plan.js';
import { okRuns } from './coordReadHelpers.js';

const TOKEN = 'f'.repeat(64);
const COORD = 'coord-a';
const runner: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
const epic = (key: string, waves: number[], over: Record<string, unknown> = {}) => ({
  key, title: `Epic ${key}`, summary: 's', waves, checkpoints: [{ key: `${key}-c1`, title: 'c', kind: 'acceptance' }], ...over,
});
const OPEN = { program: 'prog-a', title: 'Wave one', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD, homeProject: 'project-a' };

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

interface W { app: FastifyInstance; coord: CoordStore; plan: PlanStorePort }
const world = async (): Promise<W> => {
  const home = mkTmp('ccrc-plan-run-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: `/w/${COORD}`, uuid: `u-${COORD}`,
    started: '1', workspace: COORD, branch: `ws/${COORD}`, base: 'origin/main' })) {
    writeFileSync(path.join(home, '.cc-sessions', `${COORD}.${k}`), v);
  }
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const plan = planStorePort(coord.db);
  app = await buildServer({ ...testDeps(home, runner), mailToken: TOKEN, coord, plan });
  return { app, coord, plan };
};
const headers = { 'x-ccrc-mail-token': TOKEN };
const declare = (w: W, body: unknown, slug = 'prog-a', path_ = '') =>
  w.app.inject({ method: 'POST', url: `/api/programmes/${slug}/plan${path_}?byId=${COORD}&byUuid=u-${COORD}`, headers, payload: body as never });
const open = (w: W, body: Record<string, unknown> = OPEN) =>
  w.app.inject({ method: 'POST', url: '/api/runs', headers, payload: { claimedByUuid: `u-${COORD}`, ...body } });
const refused = (r: { statusCode: number; json: () => unknown }) => [r.statusCode, (r.json() as { refused?: string }).refused];
const ticketsOf = (w: W) => w.plan.planOf('prog-a').epics.flatMap((e) => e.tickets);
const FIRST = { home: 'project-a', epics: [epic('e1', [1]), epic('e2', [2])] };

describe('runs attach to tickets (D-8181)', () => {
  it('a run with no ticket gets one in its wave\'s epic, keyed run-<id>', async () => {
    const w = await world();
    expect((await declare(w, FIRST)).statusCode).toBe(200);
    const res = await open(w, { ...OPEN, wave: 2 });
    expect(res.statusCode, res.body).toBe(200);
    const id = (res.json() as { id: number }).id;
    const stored = w.plan.planOf('prog-a');
    const e2 = stored.epics.find((e) => e.key === 'e2')!;
    expect(e2.tickets.map((t) => [t.key, t.project, t.title, t.kind, t.runId, t.state])).toEqual([[`run-${id}`, 'project-a', 'Wave one', 'work', id, 'open']]);
    expect(stored.epics.find((e) => e.key === 'e1')!.tickets).toEqual([]);
  });

  it('a run opened with a ticket of project-a in project-b re-projects the ticket', async () => {
    const w = await world();
    await declare(w, { home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'work', title: 'T', project: 'project-a' }] })] });
    const res = await open(w, { ...OPEN, project: 'project-b', ticket: 't1' });
    expect(res.statusCode, res.body).toBe(200);
    expect(ticketsOf(w).map((t) => [t.key, t.project, t.runId])).toEqual([['t1', 'project-b', (res.json() as { id: number }).id]]);
  });

  it('an older programme (planRequired 0) with no plan opens as today', async () => {
    const w = await world();
    seedLegacyProgramme(w.coord.db, 'prog-a', 'project-a');
    const res = await open(w);
    expect(res.statusCode, res.body).toBe(200);
    expect(ticketsOf(w)).toEqual([]);
    expect(okRuns(w.coord.runs())).toHaveLength(1);
  });

  it('a review run never gets a ticket', async () => {
    const w = await world();
    await declare(w, FIRST);
    const work = (await open(w)).json() as { id: number };
    for (const to of ['dispatched', 'working', 'awaiting-review'] as const) expect(w.coord.advance(work.id, to, 'test').ok).toBe(true);
    const res = await open(w, { kind: 'review', reviews: work.id, program: 'prog-a', title: 'Review', claimedBy: COORD, homeProject: 'project-a' });
    expect(res.statusCode, res.body).toBe(200);
    expect(ticketsOf(w).map((t) => t.runId)).toEqual([work.id]);
  });

  it('a later wave still opens after its epic settled done, and the epic is live again', async () => {
    const w = await world();
    await declare(w, { home: 'project-a', epics: [epic('e1', [1, 2], { checkpoints: [] })] });
    const a = (await open(w)).json() as { id: number };
    for (const to of ['dispatched', 'closing', 'done'] as const) expect(w.coord.advance(a.id, to, 'test').ok, to).toBe(true);
    expect(w.plan.planOf('prog-a').epics[0]!.state).toBe('done');
    const b = await open(w, { ...OPEN, wave: 2 });
    expect(b.statusCode, b.body).toBe(200);
    expect(w.plan.planOf('prog-a').epics[0]!.state).toBe('active');
    expect((await open(w, { ...OPEN, title: 'Again' })).statusCode).toBe(200);
  });

  it('a named ticket in a programme with no epics (planRequired 0) is ticket-unavailable', async () => {
    const w = await world();
    seedLegacyProgramme(w.coord.db, 'prog-a', 'project-a');
    expect(refused(await open(w, { ...OPEN, ticket: 't1' }))).toEqual([409, 'ticket-unavailable']);
  });

  it('a new slug with no row and no plan is plan-missing', async () => {
    const w = await world();
    expect(refused(await open(w))).toEqual([409, 'plan-missing']);
    expect(okRuns(w.coord.runs())).toHaveLength(0);
    expect(w.coord.programs()).toEqual([]);
  });

  it('a wave no epic lists is wave-epic-mismatch', async () => {
    const w = await world();
    await declare(w, FIRST);
    expect(refused(await open(w, { ...OPEN, wave: 9 }))).toEqual([409, 'wave-epic-mismatch']);
    expect(okRuns(w.coord.runs())).toHaveLength(0);
  });

  it('a ticket of another epic than the wave\'s is wave-epic-mismatch', async () => {
    const w = await world();
    await declare(w, { home: 'project-a', epics: [epic('e1', [1]), epic('e2', [2], { tickets: [{ key: 't2', kind: 'work', title: 'T' }] })] });
    expect(refused(await open(w, { ...OPEN, wave: 1, ticket: 't2' }))).toEqual([409, 'wave-epic-mismatch']);
  });

  it('a ticket another run started, or that does not exist, is ticket-unavailable', async () => {
    const w = await world();
    await declare(w, { home: 'project-a', epics: [epic('e1', [1, 2], { tickets: [{ key: 't1', kind: 'work', title: 'T' }] })] });
    expect((await open(w, { ...OPEN, ticket: 't1' })).statusCode).toBe(200);
    expect(refused(await open(w, { ...OPEN, wave: 2, ticket: 't1' }))).toEqual([409, 'ticket-unavailable']);
    expect(refused(await open(w, { ...OPEN, wave: 2, ticket: 'nope' }))).toEqual([409, 'ticket-unavailable']);
  });

  it('the reserved linear-sync programme is reserved-programme', async () => {
    const w = await world();
    expect(refused(await open(w, { ...OPEN, program: 'linear-sync' }))).toEqual([409, 'reserved-programme']);
  });

  it('runs open after plan close is plan-closed', async () => {
    const w = await world();
    await declare(w, FIRST);
    expect((await declare(w, { outcome: 'done' }, 'prog-a', '/close')).statusCode).toBe(200);
    expect(refused(await open(w))).toEqual([409, 'plan-closed']);
  });

  it('a retried open answers the same run and leaves one ticket', async () => {
    const w = await world();
    await declare(w, FIRST);
    const a = (await open(w)).json() as { id: number };
    const b = (await open(w)).json() as { id: number };
    expect(b.id).toBe(a.id);
    expect(ticketsOf(w)).toHaveLength(1);
  });

  it('a retried open that names its ticket is answered too', async () => {
    const w = await world();
    await declare(w, { home: 'project-a', epics: [epic('e1', [1], { tickets: [{ key: 't1', kind: 'work', title: 'T' }] })] });
    const a = (await open(w, { ...OPEN, ticket: 't1' })).json() as { id: number };
    const b = await open(w, { ...OPEN, ticket: 't1' });
    expect([b.statusCode, (b.json() as { id: number }).id]).toEqual([200, a.id]);
  });
});

describe('the attach is atomic (D-8181)', () => {
  it('an epic dropped between the gate and the insert refuses wave-epic-mismatch and leaves no planned row', async () => {
    const w = await world();
    await declare(w, FIRST);
    const e1 = w.plan.planOf('prog-a').epics.find((e) => e.key === 'e1')!;
    // The gate read the plan with e1 live; e1 is dropped before the insert (a `plan put` waits for the mutex in the route,
    // so the store seam is driven directly with the verdict the gate had made).
    w.plan.applyPlanChanges('prog-a', { epics: { insert: [], update: [], drop: [{ id: e1.id, why: 'cut' }] },
      checkpoints: { insert: [], update: [], drop: [] }, tickets: { insert: [], update: [], drop: [] } }, COORD, 1, null);
    const r = w.coord.openRun({ program: 'prog-a', title: 't', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD,
      ticket: { kind: 'new', epicId: e1.id, project: 'project-a', title: 't' } });
    expect(r).toEqual({ refused: 'wave-epic-mismatch' });
    expect(okRuns(w.coord.runs({ includeClosed: true }))).toEqual([]);
    expect(ticketsOf(w)).toEqual([]);
  });

  it('a throw after the run insert rolls back the run and its ticket', async () => {
    const w = await world();
    await declare(w, FIRST);
    const e1 = w.plan.planOf('prog-a').epics.find((e) => e.key === 'e1')!;
    // The auto ticket's key is run-<id>; a ticket already holding the next id's key makes the attach's INSERT throw.
    w.plan.insertTicket({ program: 'prog-a', epicKey: 'e1', checkpointKey: null, key: 'run-1', kind: 'work', title: 'x', body: '', project: 'project-a', source: 'plan' }, 1);
    expect(() => w.coord.openRun({ program: 'prog-a', title: 't', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD,
      ticket: { kind: 'new', epicId: e1.id, project: 'project-a', title: 't' } })).toThrow();
    expect(okRuns(w.coord.runs({ includeClosed: true }))).toEqual([]);
    expect(ticketsOf(w).map((t) => t.key)).toEqual(['run-1']);
  });
});
