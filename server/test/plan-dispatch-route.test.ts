// D-8182 (§5.6): the dispatch route asks the plan sync for a ticket slug and, when one is answered, dispatches under it.
// A ROUTE-LEVEL pin: the real `POST /api/runs/:id/dispatch` over a real coord.db, a stand-in `planSync` and a fake ccd
// runner, asserting the `ws-add` argv. Neutral names only.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import type { Runner } from '../src/exec.js';
import type { PlanSync } from '../src/linear/planSync.js';
import { testDeps } from './helpers.js';
import { legacyOpens } from './helpers/plan.js';
import { landingStoreOver } from './landingFixture.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'coord-a';
const TOKEN = 'f'.repeat(64);
const H = { 'x-ccrc-mail-token': TOKEN };
const TICKET_SLUG = 'key-123-fix-the-thing';

const seed = (home: string, id: string, child: boolean): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...(child ? { child: '999' } : {}) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

/** Boots the real server with a stand-in plan sync, opens one run and dispatches it with `body`; returns the ws-add argv. */
async function dispatchWith(dispatchSlug: PlanSync['dispatchSlug'], body: Record<string, unknown>, created: string): Promise<string[][]> {
  const home = mkTmp('ccrc-plan-droute-');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'ws-add') seed(home, created, true);
    if (args[0] === 'pr-state') {
      const id = args[2] ?? '';
      return { ran: true, code: 0, stdout: `${JSON.stringify({ id, rows: [], baseShort: 'main', branch: `ws/${id}`, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 })}\n`, stderr: '' };
    }
    if (args[0] === 'ensure') return { ran: true, code: 0, stdout: `alive: ${args[1] ?? ''}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  seed(home, CLAIMED_BY, false);
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = landingStoreOver(openCoordDb(dbPath), dbPath);
  const base = testDeps(home, run);
  const planSync = { dispatchSlug } as unknown as PlanSync;
  app = legacyOpens(await buildServer({ ...base, mailToken: TOKEN, coord, planSync }), coord.db);
  const opened = await app.inject({ method: 'POST', url: '/api/runs', headers: H,
    payload: { program: 'build4', title: 'Surface', project: PROJECT, wave: 1, waveOf: 3, claimedBy: CLAIMED_BY, claimedByUuid: `u-${CLAIMED_BY}`, homeProject: PROJECT } });
  const id = (opened.json() as { id: number }).id;
  await app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: H, payload: body });
  return calls.filter((c) => c[0] === 'ws-add');
}

describe('POST /api/runs/:id/dispatch and the plan sync slug (D-8182)', () => {
  it('dispatches under the slug the plan sync answers, over the caller\'s own', async () => {
    const asked: unknown[] = [];
    const adds = await dispatchWith(async (_id, given) => { asked.push(given); return TICKET_SLUG; }, { brief: 'do it', slug: 'mine' }, `${PROJECT}-${TICKET_SLUG}`);
    expect(asked).toEqual(['mine']);
    expect(adds).toEqual([['ws-add', '--no-rc', PROJECT, TICKET_SLUG]]);
  });

  it('dispatches under the caller\'s own slug when the plan sync answers undefined', async () => {
    const adds = await dispatchWith(async () => undefined, { brief: 'do it', slug: 'mine' }, `${PROJECT}-mine`);
    expect(adds).toEqual([['ws-add', '--no-rc', PROJECT, 'mine']]);
  });
});
