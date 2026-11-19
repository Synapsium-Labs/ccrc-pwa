// Programme work map WM1 (D-8727; spec 2026-11-16 §4.1 and §7, D11): a ticket's done time and evidence. The done arm of
// `onRunAdvancedInTx` stores `{ runId }` and the time, WM1's migration back-fills the tickets done before it, and
// `plan ticket-done` (POST /api/programmes/:slug/plan/tickets/done) records a ticket finished another way, held to evidence
// that verifies (review 2375 F2). The pure deciders' cases (`planTicketDoneCases.ts`) run here against the real
// `planPolicy.ts`; the rest drives the real server over a real coord.db (fixture HOME only).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as policy from '../src/coord/planPolicy.js';
import { MIGRATIONS, COORD_SCHEMA_VERSION } from '../src/coord/schema.js';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import type { CoordStore } from '../src/coord/store.js';
import type { LandingOutcome } from '../src/coord/landingEntry.js';
import type { PlanView } from '../../shared/plan.js';
import { DONE_CASES } from './planTicketDoneCases.js';
import { charWorld, CHAR_COORD, CHAR_TOKEN, openRun, planVerb, SIX, type CharWorld } from './helpers/planPhasesFixture.js';
import { mkTmp } from './tmpHelpers.js';
import { actorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { bindPendingGeneration, designatePending, type AuthorityAppender } from '../src/coord/overlordDesignationStore.js';

let w: CharWorld | undefined;
afterEach(async () => { if (w) await w.app.close(); w = undefined; });
const world = async (others: readonly string[] = [], landing = false): Promise<CharWorld> => (w = await charWorld(others, { landing }));

const refusal = (r: { statusCode: number; json: () => unknown }) => {
  const b = r.json() as { error?: string; refused?: string };
  return [r.statusCode, b.error ?? b.refused];
};
const idOf = (r: { json: () => unknown }): number => (r.json() as { id: number }).id;
const step = (c: CoordStore, id: number, ...to: Parameters<CoordStore['advance']>[1][]): void => {
  for (const s of to) if (!c.advance(id, s, 'test').ok) throw new Error(`fixture advance to ${s} refused`);
};
const BASE = { title: 'a wave', project: 'project-a', waveOf: 6, homeProject: 'project-a', program: 'prog-a' };
const done = (x: CharWorld, body: unknown, who?: string) => who === undefined
  ? planVerb(x, 'prog-a', '/tickets/done', body)
  : x.app.inject({
    method: 'POST', url: `/api/programmes/prog-a/plan/tickets/done?byId=${who}&byUuid=u-${who}`,
    headers: { 'x-ccrc-mail-token': CHAR_TOKEN }, payload: body as never,
  });
const ticketIn = (v: PlanView, key: string) => v.epics.flatMap((e) => e.tickets).find((t) => t.key === key)!;
const show = async (x: CharWorld): Promise<PlanView> =>
  ((await x.app.inject({ method: 'GET', url: '/api/programmes/prog-a/plan', headers: { 'x-ccrc-mail-token': CHAR_TOKEN } })).json() as { plan: PlanView }).plan;
const factsOf = (x: CharWorld, key: string) => x.plan.doneFactsOf('prog-a').find((f) => f.key === key);
/** A done work run of prog-a in `wave` with no ticket named: its own ticket is the auto ticket `run-<id>`. */
const doneBareRun = async (x: CharWorld, wave = 1): Promise<number> => {
  const r = await openRun(x, { ...BASE, wave });
  expect(r.statusCode, r.body).toBe(200);
  step(x.coord, idOf(r), 'dispatched', 'closing', 'done');
  return idOf(r);
};

const HEAD = 'a'.repeat(40);
const HC = 'c'.repeat(40);
const MERGED: LandingOutcome = { word: 'merged', head: HEAD, base: 'd'.repeat(40), mergedAt: '2026-11-11T10:00:00Z', mergeCommit: 'e'.repeat(40), train: null };
/** A pull request the landing line marks `landed` for `project`: another programme's run pinned at merging, then landed. */
const landPr = (c: CoordStore, pr: number, project = 'project-a'): void => {
  const o = c.openRun({ program: `prog-z-${pr}`, title: 't', project, wave: 1, waveOf: 9, claimedBy: 'coord-z' });
  if (!('id' in o)) throw new Error('fixture openRun refused');
  c.setSession(o.id, `${project}-ws${pr}`);
  step(c, o.id, 'dispatched', 'working', 'awaiting-review');
  const pin = c.advanceLanding({ runId: o.id, to: 'merging', causedBy: 'coordinator', landing: { kind: 'pin', head: HEAD, pr, mode: 'off', handoffCommit: HC } });
  if (!pin.ok) throw new Error('fixture pin refused');
  const land = c.advanceLanding({ kind: 'land', project, pr, by: 'reader', at: 5000, outcome: MERGED, expect: null });
  if (!land.ok) throw new Error('fixture land refused');
};

/** A work run of prog-a in `wave` (no ticket named, so its own ticket is the auto ticket `run-<id>`) that carried pull
 *  request `pr`: pinned at merging, landed on project-a's line, then closed done. The landing entry names this run. */
const landedRun = async (x: CharWorld, pr: number, wave = 1): Promise<number> => {
  const r = await openRun(x, { ...BASE, wave });
  expect(r.statusCode, r.body).toBe(200);
  const id = idOf(r);
  x.coord.setSession(id, `project-a-ws${pr}`);
  step(x.coord, id, 'dispatched', 'working', 'awaiting-review');
  const pin = x.coord.advanceLanding({ runId: id, to: 'merging', causedBy: 'coordinator', landing: { kind: 'pin', head: HEAD, pr, mode: 'off', handoffCommit: HC } });
  if (!pin.ok) throw new Error('fixture pin refused');
  const land = x.coord.advanceLanding({ kind: 'land', project: 'project-a', pr, by: 'reader', at: 5000, outcome: MERGED, expect: null });
  if (!land.ok) throw new Error('fixture land refused');
  step(x.coord, id, 'closing', 'done');
  return id;
};

describe('the ticket-done deciders (planPolicy.ts): every case of planTicketDoneCases.ts', () => {
  it.each(DONE_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => { c.run(policy); });
});

describe('done carries its time and evidence (D11)', () => {
  it('a run closing done stores doneAt and its runId', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const r = await openRun(x, { ...BASE, wave: 1, ticket: 'w0-t1' });
    expect(factsOf(x, 'w0-t1')).toMatchObject({ doneAt: null, evidence: null });
    step(x.coord, idOf(r), 'dispatched', 'closing');
    expect(factsOf(x, 'w0-t1')).toMatchObject({ doneAt: null, evidence: null });
    step(x.coord, idOf(r), 'done');
    const f = factsOf(x, 'w0-t1')!;
    expect(f.evidence).toEqual({ runId: idOf(r) });
    expect(typeof f.doneAt).toBe('number');
    expect(f.doneAt).toBeGreaterThan(0);
  });

  it('a run that fails stores no evidence', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const r = await openRun(x, { ...BASE, wave: 1, ticket: 'w0-t1' });
    step(x.coord, idOf(r), 'dispatched', 'failed');
    expect(factsOf(x, 'w0-t1')).toMatchObject({ doneAt: null, evidence: null });
  });
});

describe('the migration back-fills a done ticket\'s evidence and time from its run (F1)', () => {
  const SLOT = MIGRATIONS.findIndex((m) => m.includes('doneEvidence')) + 1;
  it('the migration back-fills a done ticket\'s evidence and time from its run', () => {
    expect(SLOT, 'no MIGRATIONS entry adds doneEvidence').toBeGreaterThanOrEqual(94);
    const p = path.join(mkTmp('ccrc-ticket-done-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'A', 1, 'active')");
      raw.exec("INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt, closedAt) VALUES (7, 'prog-a', 1, 2, 'project-a', 'done', 'c', 1, 4242)");
      raw.exec("INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt, closedAt) VALUES (8, 'prog-a', 2, 2, 'project-a', 'done', 'c', 1, NULL)");
      raw.exec("INSERT INTO plan_epics (id, program, project, waves, key, ordinal, title, summary, state) VALUES (1, 'prog-a', 'project-a', '[1,2]', 'e1', 0, 'E', 's', 'active')");
      const t = "INSERT INTO plan_tickets (id, program, project, epicId, key, kind, title, body, source, state, runId) VALUES (?, 'prog-a', 'project-a', 1, ?, 'work', 'T', '', 'plan', ?, ?)";
      raw.prepare(t).run(1, 'k-done', 'done', 7);
      raw.prepare(t).run(2, 'k-done-no-close', 'done', 8);
      raw.prepare(t).run(3, 'k-open', 'open', null);
      raw.prepare(t).run(4, 'k-done-no-run', 'done', null);
      // Review 2429 F4: tickets that name a run but are not done get no evidence: held open, started, dropped.
      raw.prepare(t).run(5, 'k-open-held', 'open', 7);
      raw.prepare(t).run(6, 'k-started', 'started', 8);
      raw.prepare(t).run(7, 'k-dropped', 'dropped', 7);
    });
    raw.close();
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    const rows = db.prepare('SELECT key, doneAt, doneEvidence FROM plan_tickets ORDER BY id').all();
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { key: 'k-done', doneAt: 4242, doneEvidence: '{"runId":7}' },
      { key: 'k-done-no-close', doneAt: null, doneEvidence: '{"runId":8}' },
      { key: 'k-open', doneAt: null, doneEvidence: null },
      { key: 'k-done-no-run', doneAt: null, doneEvidence: null },
      { key: 'k-open-held', doneAt: null, doneEvidence: null },
      { key: 'k-started', doneAt: null, doneEvidence: null },
      { key: 'k-dropped', doneAt: null, doneEvidence: null },
    ]);
    db.close();
  });

  it('adds two nullable columns to plan_tickets and nothing else', () => {
    const cols = MIGRATIONS[SLOT - 1]!.replace(/--[^\n]*/g, '').match(/ALTER TABLE \w+ ADD COLUMN \w+/g);
    expect(cols).toEqual(['ALTER TABLE plan_tickets ADD COLUMN doneAt', 'ALTER TABLE plan_tickets ADD COLUMN doneEvidence']);
    expect(MIGRATIONS[SLOT - 1]).not.toMatch(/CREATE TABLE|DROP|DELETE/);
  });
});

describe('plan ticket-done (POST /api/programmes/:slug/plan/tickets/done)', () => {
  it('ticket-done marks an open declared ticket done with a done run', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    const res = await done(x, { ticket: 'w0-t2', evidence: { runId: run } });
    expect(res.statusCode, res.body).toBe(200);
    expect(ticketIn((res.json() as { plan: PlanView }).plan, 'w0-t2').state).toBe('done');
    const f = factsOf(x, 'w0-t2')!;
    expect(f.evidence).toEqual({ runId: run });
    expect(typeof f.doneAt).toBe('number');
  });

  it('with a landed pull request of the ticket\'s project', async () => {
    const x = await world([], true);
    await planVerb(x, 'prog-a', '', SIX);
    landPr(x.coord, 7);
    const res = await done(x, { ticket: 'w0-t2', evidence: { pr: 7 } });
    expect(res.statusCode, res.body).toBe(200);
    expect(factsOf(x, 'w0-t2')!.evidence).toEqual({ pr: 7 });
  });

  it('refuses a pull request landed for another project than the ticket\'s', async () => {
    const x = await world([], true);
    await planVerb(x, 'prog-a', '', SIX);
    landPr(x.coord, 7, 'project-b');
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { pr: 7 } }))).toEqual([409, 'evidence-unverified']);
  });

  it('refuses a run that is not done or not this programme\'s', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    await planVerb(x, 'prog-b', '', SIX);
    const working = await openRun(x, { ...BASE, wave: 1 });
    step(x.coord, idOf(working), 'dispatched');
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: idOf(working) } }))).toEqual([409, 'evidence-unverified']);
    const other = await openRun(x, { ...BASE, program: 'prog-b', wave: 2 });
    step(x.coord, idOf(other), 'dispatched', 'closing', 'done');
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: idOf(other) } }))).toEqual([409, 'evidence-unverified']);
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: 999 } }))).toEqual([409, 'evidence-unverified']);
    expect(factsOf(x, 'w0-t2')).toMatchObject({ doneAt: null, evidence: null });
  });

  it('refuses a run whose own ticket is another declared one', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const r = await openRun(x, { ...BASE, wave: 1, ticket: 'w0-t1' });
    step(x.coord, idOf(r), 'dispatched', 'closing', 'done');
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: idOf(r) } }))).toEqual([409, 'evidence-unverified']);
  });

  it('accepts the run whose own ticket is this one, or whose auto ticket holds its evidence', async () => {
    // The run's own ticket being this one is the decider's case (the done arm has already closed such a ticket, so the route
    // sees it not open); here, the auto ticket `run-<id>` holds the run's evidence and still lets it close the declared one.
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    expect(factsOf(x, `run-${run}`)!.evidence).toEqual({ runId: run });
    expect((await done(x, { ticket: 'w0-t3', evidence: { runId: run } })).statusCode).toBe(200);
  });

  it('refuses evidence already stored on another ticket of the programme, except on the run\'s own auto ticket', async () => {
    const x = await world([], true);
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    expect((await done(x, { ticket: 'w0-t2', evidence: { runId: run } })).statusCode).toBe(200);
    expect(refusal(await done(x, { ticket: 'w0-t3', evidence: { runId: run } }))).toEqual([409, 'evidence-unverified']);
    landPr(x.coord, 8);
    expect((await done(x, { ticket: 'w0-t4', evidence: { pr: 8 } })).statusCode).toBe(200);
    expect(refusal(await done(x, { ticket: 'w0-t5', evidence: { pr: 8 } }))).toEqual([409, 'evidence-unverified']);
  });

  it('a run and the pull request it carried close one ticket, whichever is named first (review 2429 F2)', async () => {
    const x = await world([], true);
    await planVerb(x, 'prog-a', '', SIX);
    // The run first, then its pull request.
    const first = await landedRun(x, 9);
    expect((await done(x, { ticket: 'w0-t2', evidence: { runId: first } })).statusCode).toBe(200);
    const byPr = await done(x, { ticket: 'w0-t3', evidence: { pr: 9 } });
    expect(refusal(byPr)).toEqual([409, 'evidence-unverified']);
    expect((byPr.json() as { detail: string }).detail).toContain('w0-t2');
    // The pull request first (the run's own auto ticket, done with it, does not refuse it), then its run.
    const second = await landedRun(x, 10, 2);
    expect((await done(x, { ticket: 'w0-t4', evidence: { pr: 10 } })).statusCode).toBe(200);
    const byRun = await done(x, { ticket: 'w0-t5', evidence: { runId: second } });
    expect(refusal(byRun)).toEqual([409, 'evidence-unverified']);
    expect((byRun.json() as { detail: string }).detail).toContain('w0-t4');
    expect(factsOf(x, 'w0-t3')!.evidence).toBeNull();
    expect(factsOf(x, 'w0-t5')!.evidence).toBeNull();
  });

  it('refuses a run that cannot be read (review 2429 F3)', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    const real = x.coord.run.bind(x.coord);
    x.coord.run = (id: number) => (id === run ? { ok: false, kind: 'run-unreadable', detail: 'disk' } : real(id));
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: run } }))).toEqual([409, 'evidence-unverified']);
    expect(factsOf(x, 'w0-t2')!.evidence).toBeNull();
  });

  it('refuses a pull request, and a run tied to a stored one, when the landing line cannot be read (review 2429 F3)', async () => {
    const x = await world([], true);
    await planVerb(x, 'prog-a', '', SIX);
    landPr(x.coord, 7);
    landPr(x.coord, 8);
    expect((await done(x, { ticket: 'w0-t4', evidence: { pr: 8 } })).statusCode).toBe(200);
    const real = x.coord.readLanding.bind(x.coord);
    const fenced = () => ({ ok: false as const, error: 'landing-journal-unavailable' as const, recovery: 'replay' as const });
    // No ticket stores a { runId } yet, so no link is read: the { pr } is refused by its own landing read.
    x.coord.readLanding = fenced;
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { pr: 7 } }))).toEqual([409, 'evidence-unverified']);
    x.coord.readLanding = real;
    const run = await doneBareRun(x);
    // A { runId } reads the link through the line of the project whose ticket stores a { pr }.
    x.coord.readLanding = fenced;
    expect(refusal(await done(x, { ticket: 'w0-t3', evidence: { runId: run } }))).toEqual([409, 'evidence-unverified']);
    expect(factsOf(x, 'w0-t2')!.evidence).toBeNull();
    expect(factsOf(x, 'w0-t3')!.evidence).toBeNull();
  });

  it('markTicketDone leaves a ticket a run holds (started) and a done ticket unchanged (review 2429 F7)', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const finished = await openRun(x, { ...BASE, wave: 1, ticket: 'w0-t3' });
    step(x.coord, idOf(finished), 'dispatched', 'closing', 'done');
    const held = await openRun(x, { ...BASE, title: 'another', wave: 1, ticket: 'w0-t1' });
    expect(held.statusCode, held.body).toBe(200);
    step(x.coord, idOf(held), 'dispatched', 'working');
    const KEYS = ['w0-t1', 'w0-t3'];
    const rows = () => x.plan.planOf('prog-a').epics.flatMap((e) => e.tickets).filter((t) => KEYS.includes(t.key)).map((t) => ({ ...t }));
    const before = rows();
    const facts = KEYS.map((k) => factsOf(x, k));
    expect(before.map((t) => [t.key, t.state, t.runId])).toEqual([['w0-t1', 'started', idOf(held)], ['w0-t3', 'done', idOf(finished)]]);
    for (const t of before) x.plan.markTicketDone(t.id, { pr: 99 }, 123);
    expect(rows()).toEqual(before);
    expect(KEYS.map((k) => factsOf(x, k))).toEqual(facts);
  });

  it('refuses a pull request with no landing entry', async () => {
    const x = await world([], true);
    await planVerb(x, 'prog-a', '', SIX);
    const res = await done(x, { ticket: 'w0-t2', evidence: { pr: 7 } });
    expect(refusal(res)).toEqual([409, 'evidence-unverified']);
    expect((res.json() as { detail: string }).detail).toContain('name the run');
  });

  it('refuses a ticket a run holds with plan-runs-open', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x, 2);
    expect((await openRun(x, { ...BASE, wave: 1, ticket: 'w0-t1' })).statusCode).toBe(200);
    expect(refusal(await done(x, { ticket: 'w0-t1', evidence: { runId: run } }))).toEqual([409, 'plan-runs-open']);
  });

  it('refuses a ticket not open with plan-bad-body', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const r = await openRun(x, { ...BASE, wave: 1, ticket: 'w0-t1' });
    step(x.coord, idOf(r), 'dispatched', 'closing', 'done');
    const run = await doneBareRun(x, 2);
    expect(refusal(await done(x, { ticket: 'w0-t1', evidence: { runId: run } }))).toEqual([400, 'plan-bad-body']);
    await planVerb(x, 'prog-a', '/tickets/move', { ticket: 'w0-t2', drop: { why: 'not needed' } });
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: run } }))).toEqual([400, 'plan-bad-body']);
  });

  it('refuses an unknown ticket with unknown-ticket', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    expect(refusal(await done(x, { ticket: 'nope', evidence: { runId: run } }))).toEqual([404, 'unknown-ticket']);
  });

  it('settles the epic', async () => {
    const x = await world();
    const solo = { home: 'project-a', epics: [{ key: 'solo', title: 'Solo', summary: 's', waves: [1], checkpoints: [],
      tickets: [{ key: 's1', kind: 'work', title: 'the one ticket' }] }] };
    expect((await planVerb(x, 'prog-a', '', solo)).statusCode).toBe(200);
    const run = await doneBareRun(x);
    expect((await show(x)).epics[0]!.state).not.toBe('done');
    x.plan.clearSyncDue('prog-a');
    const res = await done(x, { ticket: 's1', evidence: { runId: run } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { plan: PlanView }).plan.epics[0]!.state).toBe('done');
    expect(x.plan.dueSyncs(Number.MAX_SAFE_INTEGER)).toContain('prog-a');
  });

  it('refuses a caller that is not the coordinator', async () => {
    const x = await world(['stranger']);
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: run } }, 'stranger'))).toEqual([403, 'not-plan-owner']);
  });

  it('refuses the Overlord\'s body with overlord-uses-its-doors, even as the programme\'s coordinator (#2996\'s rule)', async () => {
    // Since #2996 every plan write door is a row of OTHER_LANES (`planTicketsDone` here), checked before the plan is read.
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    const journal = { appendInTx: () => ({ ok: true, kind: 'appended', record: {} }) } as unknown as AuthorityAppender;
    const operator = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
      .operator(actorOf('operator-a', '0123456789abcdef'));
    expect(designatePending(x.coord.db, journal, { sessionId: CHAR_COORD, deadlineAt: Date.now() + 60_000, model: 'opus',
      accountPools: { pools: ['pool-a'], untagged: false }, actor: operator, at: Date.now(), opKey: 'op-wm1' }).ok).toBe(true);
    expect(bindPendingGeneration(x.coord.db, CHAR_COORD, '11111111-2222-3333-4444-555555555555', Date.now())).toEqual({ ok: true, changed: true });
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: run } }))).toEqual([403, 'overlord-uses-its-doors']);
    expect(factsOf(x, 'w0-t2')!.evidence).toBeNull();
  });

  it('refuses two evidence keys', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: run, pr: 7 } }))).toEqual([400, 'plan-bad-body']);
  });

  it('refuses a body naming byId', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: run }, byId: 'coord-a' }))).toEqual([400, 'plan-bad-body']);
  });

  it('refuses plan-closed once the plan has ended', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    const run = await doneBareRun(x);
    expect((await planVerb(x, 'prog-a', '/close', { outcome: 'done' })).statusCode).toBe(200);
    expect(refusal(await done(x, { ticket: 'w0-t2', evidence: { runId: run } }))).toEqual([409, 'plan-closed']);
  });

  it('a refused call stores nothing', async () => {
    const x = await world();
    await planVerb(x, 'prog-a', '', SIX);
    await done(x, { ticket: 'w0-t2', evidence: { runId: 999 } });
    expect(ticketIn(await show(x), 'w0-t2').state).toBe('open');
    expect(factsOf(x, 'w0-t2')).toMatchObject({ doneAt: null, evidence: null });
  });
});
