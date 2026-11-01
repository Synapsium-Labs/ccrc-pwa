// The claimant client's skew suite (D-7322, D-7324, D-7328; K5 tail, Tasks Q3j and Q3l; plan
// 2026-10-29-consolidation-k5-claimant-doors.md; spec 2026-10-19 §5.1 rule 1c). A rollout moves the fleet box first and
// the server second, and a server update whose health gate fails restores the previous build, so a moved client meets
// a server without the question door family, and an unmoved client meets the moved tree's server. Each pairing runs
// the claimant pin's rows (`claimantClientFixture.ts`, the same rows and the same tables, never a copy). Since Q3l the
// server has no old claimant door and the client sends the family only:
//
//   (a) THE NEW CLIENT AGAINST A SERVER WITHOUT THE FAMILY: the fixture server with the family's two claimant routes
//       unregistered and `SERVER_CAPS` without `questions-v1` (the shape every release before the family has, as far
//       as the client can see), so the cap file the client HOME is given from that server's own `/health` is current
//       and omits the word. Every row is refused by the client, `no-questions-door`, and nothing is sent; the same for
//       a server older than the caps answer, recorded as a current file listing no words (D-7328).
//   (b) Q3J'S CLIENT AGAINST THE TIP'S SERVER: `ccd/ccrc-api` as it stood before this task (`git show` into the fixture
//       HOME), which sends the family only while a current cap file lists `questions-v1` and the old door otherwise.
//       With that file, every outcome cell of the pin's real-server table, through the family (`THROUGH_FAMILY`). With
//       no cap file it sends the old door, which this server no longer registers: fastify's 404, nothing changed. That
//       is THE ROLLBACK FLOOR (the plan's §Rollback): a fleet box rolled back to Q3j's client answers 404 whenever its
//       cap file is not current, until the server is rolled back below Q3l too.
//   (c) THE NEW CLIENT WITH A CAP FILE THAT LIES, against a server without the family (a file written by the newer
//       build a rollback replaced, inside its 180 s lease): THE COST, stated rather than hidden. Each verb is answered
//       fastify's 404 for an unregistered route, nothing pressed, signed or released; once the lease runs out the file
//       reads as stale, and the client sends the family again, the only door it has (D-7328's inverted fail
//       direction), so it is answered 404 again and nothing changes. A 404 is never retried elsewhere: `unknown-ask` and
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
  ANSWER, bodyOf, DIFFERENCE, HELD_APPROVAL, HELD_ASK, installRealServerHooks, LADDER, lastRunDoors, NOTHING,
  type Outcome, realServer, REL, RULE, type Row, runRow, statusOf, THROUGH_FAMILY, type Verb, VERBS,
} from './claimantClientFixture.js';

/** The two family routes a server without the family does not register, and whether the next server built has them. */
const SKEW = vi.hoisted(() => ({
  familyless: false,
  FAMILY: new Set(['/api/questions/:id/rule', '/api/questions/:id/release']),
  caps: null as string[] | null,
  all: [] as string[],
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
  SKEW.all = [...mod.SERVER_CAPS];
  return { ...mod, SERVER_CAPS: SKEW.caps };
});

/** Builds every server after this call without the family, until `withFamily()`. */
const withoutFamily = (): void => {
  SKEW.familyless = true;
  const i = SKEW.caps!.indexOf('questions-v1');
  if (i >= 0) SKEW.caps!.splice(i, 1);
};
/** ... and advertising no word at all, as a server older than the caps answer is recorded (`ccd-update-sync` writes
 *  an absent `caps` as an empty list). */
const withoutCaps = (): void => {
  withoutFamily();
  SKEW.caps!.splice(0);
};
const withFamily = (): void => {
  SKEW.familyless = false;
  SKEW.caps!.splice(0, SKEW.caps!.length, ...SKEW.all);
};

installRealServerHooks();
afterEach(withFamily);

/** The old doors, which Q3j's client sends whenever its cap file is not current and listing `questions-v1`. */
const OLD_DOOR: Record<Verb, (id: string) => string> = {
  'asks answer': (id) => `/api/asks/${id}/answer`,
  'asks release': (id) => `/api/asks/${id}/release`,
  'approvals rule': (id) => `/api/approvals/${id}/rule`,
  'approvals release': (id) => `/api/approvals/${id}/release`,
};
const FAMILY_DOOR: Record<Verb, (id: string) => string> = {
  'asks answer': (id) => `/api/questions/ask-${id}/rule`,
  'asks release': (id) => `/api/questions/ask-${id}/release`,
  'approvals rule': (id) => `/api/questions/approval-${id}/rule`,
  'approvals release': (id) => `/api/questions/approval-${id}/release`,
};
/** Every row's fixture mints ask 1 and approval 1; a body the client refuses reaches no door. */
const familyDoor = ([, verb, call]: Row): string[] => (call.body === '[]' ? [] : [`POST ${FAMILY_DOOR[verb](call.id ?? '1')}`]);
const unconfiguredRow = (verb: Verb): Row => [`difference | ${verb} | the box token unconfigured`, verb,
  { body: verb === 'asks answer' ? ANSWER(0) : verb === 'approvals rule' ? RULE('allow') : REL }];
const ROWS: Row[] = [...LADDER, ...DIFFERENCE];

/** The new client's local refusal (D-7328): exit 2 and no response (status -1), the row as minted, nothing done. */
const NO_DOOR = '{"ok":false,"error":"no-questions-door","detail":"the server this box talks to does not answer the question door family; update it before answering"}';
const refused = (verb: Verb): Outcome => ({ status: -1, body: NO_DOOR, effects: { row: verb.startsWith('asks') ? HELD_ASK : HELD_APPROVAL, ...NOTHING } });

describe('(a) the new client against a server without the family: every row is refused locally, nothing sent', () => {
  it('the server built without the family has no family route and does not advertise questions-v1', async () => {
    withoutFamily();
    const r = await realServer();
    const health = (await r.f.app.inject({ method: 'GET', url: '/health' })).json() as { caps: string[] };
    expect(health.caps).not.toContain('questions-v1');
    expect(health.caps.length, 'it still lists the other words').toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(r.home, '.ccrc', SERVER_CAPS_FILE), 'utf8')).not.toMatch(/questions-v1/);
    const family = await r.f.app.inject({ method: 'POST', url: '/api/questions/ask-1/rule', payload: {} });
    expect(family.statusCode).toBe(404);
  });
  it.each(ROWS.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    withoutFamily();
    expect(await runRow(row)).toEqual(refused(row[1]));
    expect(lastRunDoors(), 'nothing sent').toEqual([]);
  });
  it.each(VERBS.map((v) => [`difference | ${v} | the box token unconfigured`, v] as const))('%s', async (_name, verb) => {
    withoutFamily();
    expect(await runRow(unconfiguredRow(verb), { mailToken: 'unconfigured' })).toEqual(refused(verb));
    expect(lastRunDoors(), 'nothing sent').toEqual([]);
  });
  it.each(VERBS)('%s against a server older than the caps answer (a current file listing no words) is refused too', async (verb) => {
    withoutCaps();
    const r = await realServer();
    expect(fs.readFileSync(path.join(r.home, '.ccrc', SERVER_CAPS_FILE), 'utf8').split('\n')[1]).toBe('caps');
    const row = LADDER.find(([n, v]) => v === verb && n.includes('| success:'))!;
    const doors0 = r.doors().length;
    const got = await r.client(verb, [String(verb.startsWith('asks') ? r.ask : r.approval)], row[2].body);
    expect([statusOf(got), bodyOf(got.stdout)]).toEqual([-1, NO_DOOR]);
    expect(r.doors().slice(doors0), 'nothing sent').toEqual([]);
  });
});

/** Q3j's client: the tree this task was built on, a fixed commit of `main`'s history, so a rebase of this branch does
 *  not move it. Its claimant rows carry the family as a fifth field, sent only behind a current `questions-v1`. */
const BASE = 'c49e0e5839b3c767816bb23bbc0293b0a1fc970f';

/** Fastify's own answer for a route it never registered. */
const notFound = (url: string): string => JSON.stringify({ message: `Route POST:${url} not found`, error: 'Not Found', statusCode: 404 });

describe('(b) Q3j\'s client against the tip\'s server: every outcome cell through the family; with no cap file, fastify\'s 404 (the rollback floor)', () => {
  let dir = '';
  let client = '';
  beforeAll(() => {
    dir = mkTmp('claimant-skew-base-client-');
    client = path.join(dir, 'ccrc-api');
    fs.writeFileSync(client, execFileSync('git', ['-C', REPO, 'show', `${BASE}:ccd/ccrc-api`], { env: inheritedEnv() }), { mode: 0o755 });
  });
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('Q3j\'s client names the family as a fifth field and reads the cap file behind its $family test', () => {
    const src = fs.readFileSync(client, 'utf8');
    expect(src).toMatch(/\[asks\.answer\]='POST\|\/api\/asks\/\{id\}\/answer\|yes\|-\|\/api\/questions\/ask-\{id\}\/rule'/);
    expect(src).toMatch(/if \[\[ -n "\$family" \]\] && _api_server_cap questions-v1; then/);
  });
  it.each(ROWS.map((row) => [row[0], row] as const))('%s', async (_n, row) => {
    expect(await runRow(row, { client })).toEqual(THROUGH_FAMILY[row[0]]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(familyDoor(row));
  });
  it.each(VERBS.map((v) => [`difference | ${v} | the box token unconfigured`, v] as const))('%s', async (name, verb) => {
    expect(await runRow(unconfiguredRow(verb), { mailToken: 'unconfigured', client })).toEqual(THROUGH_FAMILY[name]);
    expect(lastRunDoors(), 'the door the call reached').toEqual(familyDoor(unconfiguredRow(verb)));
  });
  it.each(VERBS)('%s with no cap file: the old door, answered fastify\'s 404, nothing changed', async (verb) => {
    const r = await realServer({ client });
    fs.rmSync(path.join(r.home, '.ccrc', SERVER_CAPS_FILE));
    const row = LADDER.find(([n, v]) => v === verb && n.includes('| success:'))!;
    const id = verb.startsWith('asks') ? r.ask : r.approval;
    const before = verb.startsWith('asks') ? r.f.coord.askById(id) : r.f.coord.approvalById(id);
    const doors0 = r.doors().length;
    const got = await r.client(verb, [String(id)], row[2].body);
    expect([statusOf(got), bodyOf(got.stdout)]).toEqual([404, notFound(OLD_DOOR[verb](String(id)))]);
    expect(r.doors().slice(doors0)).toEqual([`POST ${OLD_DOOR[verb](String(id))}`]);
    expect(verb.startsWith('asks') ? r.f.coord.askById(id) : r.f.coord.approvalById(id), 'nothing changed').toEqual(before);
    expect(r.doorIns(), 'no door-in').toEqual([]);
  });
});

const realNowS = (): number => Math.floor((performance.timeOrigin + performance.now()) / 1000);

describe('(c) the cost: the new client with a cap file listing questions-v1 against a server without the family', () => {
  const SUCCESS: Record<Verb, Row> = {
    'asks answer': LADDER.find(([n]) => n === 'asks answer | success: pressed, recorded')!,
    'asks release': LADDER.find(([n]) => n === 'asks release | success: declined, the door-in fires')!,
    'approvals rule': LADDER.find(([n]) => n === 'approvals rule | success: allowed, signed, recorded')!,
    'approvals release': LADDER.find(([n]) => n === 'approvals release | success: declined, the door-in fires')!,
  };
  it.each(VERBS)('%s: answered 404 by fastify inside the lease, nothing changed; the family again once the file is stale, 404 again', async (verb) => {
    withoutFamily();
    const r = await realServer();
    const caps = path.join(r.home, '.ccrc', SERVER_CAPS_FILE);
    const [, , call] = SUCCESS[verb];
    const id = verb.startsWith('asks') ? r.ask : r.approval;
    const before = verb.startsWith('asks') ? r.f.coord.askById(id) : r.f.coord.approvalById(id);
    const doors0 = r.doors().length;
    fs.writeFileSync(caps, renderServerCaps([...SERVER_CAPS, 'questions-v1'], realNowS()));
    const lied = await r.client(verb, [String(id)], call.body);
    expect([statusOf(lied), bodyOf(lied.stdout)]).toEqual([404, notFound(FAMILY_DOOR[verb](String(id)))]);
    expect(verb.startsWith('asks') ? r.f.coord.askById(id) : r.f.coord.approvalById(id), 'nothing changed').toEqual(before);
    expect(r.doorIns(), 'no door-in').toEqual([]);
    // The lease runs out: the same file, 181 s old, reads as unknown, and the client sends the family again (D-7328).
    fs.writeFileSync(caps, renderServerCaps([...SERVER_CAPS, 'questions-v1'], realNowS() - 181));
    const after = await r.client(verb, [String(id)], call.body);
    expect([statusOf(after), bodyOf(after.stdout)]).toEqual([404, notFound(FAMILY_DOOR[verb](String(id)))]);
    expect(r.doors().slice(doors0)).toEqual([`POST ${FAMILY_DOOR[verb](String(id))}`, `POST ${FAMILY_DOOR[verb](String(id))}`]);
    expect(verb.startsWith('asks') ? r.f.coord.askById(id) : r.f.coord.approvalById(id), 'nothing changed').toEqual(before);
  });
});
