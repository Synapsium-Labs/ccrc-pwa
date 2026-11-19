// The programme work map WM0's characterization fixture (D-8715): two stored plans shaped like the two live ones (one of six
// epics, each one wave, with 26 tickets; one of a single epic), driven through the plan verbs and `runs open` that were on
// `main` before WM0, so the same builder runs against the old code and the new. `plan-phases.test.ts` reads both plans and
// compares them with `fixtures/plan-phases/characterization.json`, which this builder produced on `main` before WM0.
// It uses ONLY routes and store calls that exist before WM0: no phase verb, no phase field.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { openCoordDb } from '../../src/coord/db.js';
import { CoordStore } from '../../src/coord/store.js';
import { planStorePort, type PlanStorePort } from '../../src/coord/planStore.js';
import type { Runner } from '../../src/exec.js';
import { testDeps } from '../helpers.js';
import { mkTmp } from '../tmpHelpers.js';
import { landingStoreOver } from '../landingFixture.js';

export const CHAR_TOKEN = 'c'.repeat(64);
export const CHAR_COORD = 'coord-a';
const runner: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
const headers = { 'x-ccrc-mail-token': CHAR_TOKEN };

export interface CharWorld { app: FastifyInstance; coord: CoordStore; plan: PlanStorePort }

/** A server over a fresh coord.db, with a registry row for the coordinator (and for each of `others`) so attribution holds.
 *  `landing` (programme work map WM1) gives the store a landing journal in the fixture's own directory, boot-replayed, so the
 *  landing line can be read and written. */
export async function charWorld(others: readonly string[] = [], opts: { landing?: boolean } = {}): Promise<CharWorld> {
  const home = mkTmp('ccrc-plan-phases-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  for (const id of [CHAR_COORD, ...others]) {
    for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: `/w/${id}`, uuid: `u-${id}`,
      started: '1', workspace: id, branch: `ws/${id}`, base: 'origin/main' })) {
      writeFileSync(path.join(home, '.cc-sessions', `${id}.${k}`), v);
    }
  }
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = opts.landing === true ? landingStoreOver(openCoordDb(dbPath), dbPath) : new CoordStore(openCoordDb(dbPath));
  const plan = planStorePort(coord.db);
  const app = await buildServer({ ...testDeps(home, runner), mailToken: CHAR_TOKEN, coord, plan });
  return { app, coord, plan };
}

export const planVerb = (w: CharWorld, slug: string, sub: string, body: unknown) =>
  w.app.inject({ method: 'POST', url: `/api/programmes/${slug}/plan${sub}?byId=${CHAR_COORD}&byUuid=u-${CHAR_COORD}`, headers, payload: body as never });
export const openRun = (w: CharWorld, body: Record<string, unknown>) =>
  w.app.inject({ method: 'POST', url: '/api/runs', headers, payload: { claimedByUuid: `u-${CHAR_COORD}`, claimedBy: CHAR_COORD, ...body } });

const cp = (key: string) => ({ key: `${key}-done`, title: `${key} accepted`, kind: 'acceptance' });
const tickets = (epic: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `${epic}-t${i + 1}`, kind: 'work', title: `${epic} ticket ${i + 1}` }));

/** The six-epic plan: each epic one stage, one wave, its tickets 5, 5, 4, 4, 4 and 4 (26). */
export const SIX = {
  home: 'project-a',
  epics: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'].map((k, i) => ({
    key: k, title: `W${i} stage`, summary: `stage ${i}`, waves: [i + 1], checkpoints: [cp(k)], tickets: tickets(k, i < 2 ? 5 : 4),
  })),
};
/** The one-epic plan. */
export const ONE = {
  home: 'project-a',
  epics: [{ key: 'only', title: 'The one epic', summary: 'all of it', waves: [1, 2], checkpoints: [cp('only')], tickets: tickets('only', 3) }],
};

const ok = (r: { statusCode: number; body: string }, what: string): void => {
  if (r.statusCode !== 200) throw new Error(`${what}: ${r.statusCode} ${r.body}`);
};
const runId = (r: { json: () => unknown }): number => (r.json() as { id: number }).id;

/** Declare both plans and move them the way live plans move: a run done on a named ticket, one started, one with no ticket
 *  (its auto ticket), a dropped ticket, and on the one-epic plan a failed run. */
export async function buildCharacterizationPlans(w: CharWorld): Promise<void> {
  ok(await planVerb(w, 'prog-a', '', SIX), 'put six');
  ok(await planVerb(w, 'prog-b', '', ONE), 'put one');
  const base = { title: 'a wave', project: 'project-a', waveOf: 6, homeProject: 'project-a' };
  const a1 = await openRun(w, { ...base, program: 'prog-a', wave: 1, ticket: 'w0-t1' });
  ok(a1, 'open a1');
  for (const to of ['dispatched', 'closing', 'done'] as const) {
    if (!w.coord.advance(runId(a1), to, 'test').ok) throw new Error(`a1 ${to}`);
  }
  const a2 = await openRun(w, { ...base, program: 'prog-a', wave: 2, ticket: 'w1-t2' });
  ok(a2, 'open a2');
  if (!w.coord.advance(runId(a2), 'dispatched', 'test').ok) throw new Error('a2 dispatched');
  ok(await openRun(w, { ...base, program: 'prog-a', wave: 3 }), 'open a3');
  ok(await planVerb(w, 'prog-a', '/tickets/move', { ticket: 'w4-t4', drop: { why: 'not needed' } }), 'drop w4-t4');
  const b1 = await openRun(w, { ...base, program: 'prog-b', wave: 1, waveOf: 2, ticket: 'only-t1' });
  ok(b1, 'open b1');
  for (const to of ['dispatched', 'failed'] as const) {
    if (!w.coord.advance(runId(b1), to, 'test').ok) throw new Error(`b1 ${to}`);
  }
}

/** Both plans as `plan show` answers them, as JSON values. */
export async function readCharacterizationPlans(w: CharWorld): Promise<unknown> {
  // The plan read's answer less `work`, the field programme work map WM2 (D-8779) adds beside `plan`: the characterization
  // pins that `plan` reads as before WM0, and `work` is pinned by `work-map.test.ts` and `plan-routes.test.ts`.
  const read = async (slug: string) => {
    const { work: _work, ...rest } = (await w.app.inject({ method: 'GET', url: `/api/programmes/${slug}/plan`, headers })).json() as Record<string, unknown>;
    return rest;
  };
  return { 'prog-a': await read('prog-a'), 'prog-b': await read('prog-b') };
}
