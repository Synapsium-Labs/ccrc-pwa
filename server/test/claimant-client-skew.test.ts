// The claimant client's skew suite (D-7322; K5 tail, Task Q3j; plan 2026-10-29-consolidation-k5-claimant-doors.md;
// spec 2026-10-19 §5.1 rule 1c). A rollout moves the fleet box first and the server second, and a server update whose
// health gate fails restores the previous build, so a moved client meets a server without the question door family,
// and an unmoved client meets the moved tree's server. Each pairing runs the claimant pin's rows
// (`claimantClientFixture.ts`, the same rows and the same table, never a copy):
//
//   (a) THE NEW CLIENT AGAINST A SERVER WITHOUT THE FAMILY: the fixture server with the family's two claimant routes
//       unregistered and `SERVER_CAPS` without `questions-v1` (the shape of every release before the family landed),
//       so the cap file the client HOME is given from that server's own `/health` omits the word. Every row answers as
//       the base did (`EXPECTED`, unedited), through the old door.
//   (b) THE BASE COMMIT'S CLIENT AGAINST THE TIP'S SERVER: `ccd/ccrc-api` as it stood before this task (`git show`
//       into the fixture HOME), with a current cap file listing `questions-v1` it never reads. Every outcome cell of
//       the pin's real-server table, as the base answers it, through the old door.
//   (c) THE NEW CLIENT WITH A CAP FILE THAT LIES, against a server without the family (a file written by the newer
//       build a rollback replaced, inside its 180 s lease): THE COST, stated rather than hidden. Each verb is answered
//       fastify's 404 for an unregistered route, nothing pressed, signed or released, until the lease runs out; then
//       the file reads as stale, the client sends the old door, and the call succeeds. The fail direction is the
//       safe one: a 404 changes nothing, and the client never retries the old door on a 404 because `unknown-ask` and
//       `unknown-approval` are 404s too (D-7326).
//
// Neutral ids only (`approvalsHarness.ts`'s). Nothing here touches the live HOME or a live server.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { renderServerCaps, SERVER_CAPS, SERVER_CAPS_FILE } from '../../shared/api.js';
import { REPO } from './consolidationCensus.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { mkTmp } from './tmpHelpers.js';
import {
  ANSWER, bodyOf, DIFFERENCE, EXPECTED, installRealServerHooks, LADDER, lastRunDoors, realServer, REL, RULE, type Row, runRow,
  statusOf, type Verb, VERBS,
} from './claimantClientFixture.js';

/** The two family routes a server without the family does not register, and whether the next server built has them. */
const SKEW = vi.hoisted(() => ({
  familyless: false,
  FAMILY: new Set(['/api/questions/:id/rule', '/api/questions/:id/release']),
  caps: null as string[] | null,
}));

// Every fastify instance this file builds is the real one; while `familyless` is set, its `post` skips the family's
// two claimant routes, so the server answers them as fastify answers any route it never registered.
vi.mock('fastify', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fastify')>();
  const real = mod.default as unknown as (...a: unknown[]) => { post: (...a: unknown[]) => unknown };
  const wrapped = (...a: unknown[]) => {
    const app = real(...a);
    if (SKEW.familyless) {
      const post = app.post.bind(app);
      app.post = (p: unknown, ...rest: unknown[]) => (typeof p === 'string' && SKEW.FAMILY.has(p) ? app : post(p, ...rest));
    }
    return app;
  };
  return { ...mod, default: wrapped };
});

// `SERVER_CAPS` as a mutable copy, so a server without the family advertises the words of one: `/health` and the
// server's own cap writer read this one array.
vi.mock('../../shared/api.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../shared/api.js')>();
  SKEW.caps = [...mod.SERVER_CAPS];
  return { ...mod, SERVER_CAPS: SKEW.caps };
});

/** Builds every server after this call without the family, until `withFamily()`. */
const withoutFamily = (): void => {
  SKEW.familyless = true;
  const i = SKEW.caps!.indexOf('questions-v1');
  if (i >= 0) SKEW.caps!.splice(i, 1);
};
const withFamily = (): void => {
  SKEW.familyless = false;
  if (!SKEW.caps!.includes('questions-v1')) SKEW.caps!.push('questions-v1');
};

installRealServerHooks();
afterEach(withFamily);

const OLD_DOOR: Record<Verb, (id: string) => string> = {
  'asks answer': (id) => `/api/asks/${id}/answer`,
  'asks release': (id) => `/api/asks/${id}/release`,
  'approvals rule': (id) => `/api/approvals/${id}/rule`,
  'approvals release': (id) => `/api/approvals/${id}/release`,
};
/** Every row's fixture mints ask 1 and approval 1. */
const oldDoor = ([, verb, call]: Row): string[] => [`POST ${OLD_DOOR[verb](call.id ?? '1')}`];
const unconfiguredRow = (verb: Verb): Row => [`difference | ${verb} | the box token unconfigured`, verb,
  { body: verb === 'asks answer' ? ANSWER(0) : verb === 'approvals rule' ? RULE('allow') : REL }];
const ROWS: Row[] = [...LADDER, ...DIFFERENCE];

describe('(a) the new client against a server without the family: every row answers as the base did, through the old door', () => {
  it('the server built without the family has no family route and does not advertise questions-v1', async () => {
    withoutFamily();
    const r = await realServer();
    const health = (await r.f.app.inject({ method: 'GET', url: '/health' })).json() as { caps: string[] };
    expect(health.caps).not.toContain('questions-v1');
    expect(fs.readFileSync(path.join(r.home, '.ccrc', SERVER_CAPS_FILE), 'utf8')).not.toMatch(/questions-v1/);
    const family = await r.f.app.inject({ method: 'POST', url: '/api/questions/ask-1/rule', payload: {} });
    expect(family.statusCode).toBe(404);
  });
  it.each(ROWS.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    withoutFamily();
    expect(await runRow(row)).toEqual(EXPECTED[row[0]]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(oldDoor(row));
  });
  it.each(VERBS.map((v) => [`difference | ${v} | the box token unconfigured`, v] as const))('%s', async (name, verb) => {
    withoutFamily();
    expect(await runRow(unconfiguredRow(verb), { mailToken: 'unconfigured' })).toEqual(EXPECTED[name]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(oldDoor(unconfiguredRow(verb)));
  });
});

/** The client as it stood before this task: the last tree whose claimant rows name only the old doors. A fixed commit
 *  of `main`'s history, so a rebase of this branch does not move it. */
const BASE = 'd1e0187b157a307f2325567b5d797905c406d839';

describe('(b) the base commit\'s client against the tip\'s server: every outcome cell of the pin\'s real-server table', () => {
  let dir = '';
  let client = '';
  beforeAll(() => {
    dir = mkTmp('claimant-skew-base-client-');
    client = path.join(dir, 'ccrc-api');
    fs.writeFileSync(client, execFileSync('git', ['-C', REPO, 'show', `${BASE}:ccd/ccrc-api`], { env: inheritedEnv() }), { mode: 0o755 });
  });
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('the base client names no family template and reads no cap file', () => {
    const src = fs.readFileSync(client, 'utf8');
    expect(src).not.toMatch(/\/api\/questions\//);
    expect(src).not.toMatch(/_api_server_cap questions-v1/);
  });
  it.each(ROWS.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    expect(await runRow(row, { client })).toEqual(EXPECTED[row[0]]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(oldDoor(row));
  });
  it.each(VERBS.map((v) => [`difference | ${v} | the box token unconfigured`, v] as const))('%s', async (name, verb) => {
    expect(await runRow(unconfiguredRow(verb), { mailToken: 'unconfigured', client })).toEqual(EXPECTED[name]);
  });
});

/** Fastify's own answer for a route it never registered. */
const notFound = (url: string): string => JSON.stringify({ message: `Route POST:${url} not found`, error: 'Not Found', statusCode: 404 });
const realNowS = (): number => Math.floor((performance.timeOrigin + performance.now()) / 1000);

describe('(c) the cost: the new client with a cap file listing questions-v1 against a server without the family', () => {
  const FAMILY_DOOR: Record<Verb, string> = {
    'asks answer': '/api/questions/ask-1/rule', 'asks release': '/api/questions/ask-1/release',
    'approvals rule': '/api/questions/approval-1/rule', 'approvals release': '/api/questions/approval-1/release',
  };
  const SUCCESS: Record<Verb, Row> = {
    'asks answer': LADDER.find(([n]) => n === 'asks answer | success: pressed, recorded')!,
    'asks release': LADDER.find(([n]) => n === 'asks release | success: declined, the door-in fires')!,
    'approvals rule': LADDER.find(([n]) => n === 'approvals rule | success: allowed, signed, recorded')!,
    'approvals release': LADDER.find(([n]) => n === 'approvals release | success: declined, the door-in fires')!,
  };
  it.each(VERBS)('%s: answered 404 by fastify inside the lease, nothing changed; the old door once the file is stale', async (verb) => {
    withoutFamily();
    const r = await realServer();
    const caps = path.join(r.home, '.ccrc', SERVER_CAPS_FILE);
    const [, , call] = SUCCESS[verb];
    const id = verb.startsWith('asks') ? r.ask : r.approval;
    const before = verb.startsWith('asks') ? r.f.coord.askById(id) : r.f.coord.approvalById(id);
    const doors0 = r.doors().length;
    fs.writeFileSync(caps, renderServerCaps([...SERVER_CAPS, 'questions-v1'], realNowS()));
    const lied = await r.client(verb, [String(id)], call.body);
    expect([statusOf(lied), bodyOf(lied.stdout)]).toEqual([404, notFound(FAMILY_DOOR[verb])]);
    expect(verb.startsWith('asks') ? r.f.coord.askById(id) : r.f.coord.approvalById(id), 'nothing changed').toEqual(before);
    expect(r.doorIns(), 'no door-in').toEqual([]);
    // The lease runs out: the same file, 181 s old, reads as not advertised, and the call goes to the old door.
    fs.writeFileSync(caps, renderServerCaps([...SERVER_CAPS, 'questions-v1'], realNowS() - 181));
    const after = await r.client(verb, [String(id)], call.body);
    expect([statusOf(after), bodyOf(after.stdout)]).toEqual([EXPECTED[SUCCESS[verb][0]]!.status, EXPECTED[SUCCESS[verb][0]]!.body]);
    expect(r.doors().slice(doors0)).toEqual([`POST ${FAMILY_DOOR[verb]}`, `POST ${OLD_DOOR[verb](String(id))}`]);
  });
});
