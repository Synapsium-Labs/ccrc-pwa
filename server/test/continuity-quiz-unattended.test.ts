// Run 3212 (Overlord W1a; the operator's ruling of 2026-11-22: the weekly replay quiz runs, records and confirms itself): the
// unattended confirm door, `POST /api/continuity/quiz-runs/:id/confirm` (box token; `ccrc quiz-record --confirm` from the
// weekly timer), which applies the operator's matching rule through the one ruler (the record's single-use key and the sha,
// review 3232 F1) and mails the programme's coordinator once a baseline exists, keyed on its run (F4); the coordinator's Live
// door, `POST /api/continuity/quiz-baseline/live` (box token, attributed, owned), which takes a W1a lane live once a confirmed
// baseline exists; and the tick report, `POST /api/continuity/quiz-status`, with its stop and waiting-streak mails (F9).
// Fixture HOMEs only.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { decideLaneArmCoordLive, laneArmRowViewOf, type LaneArmRead } from '../src/coord/laneArm.js';
import {
  QUIZ_BASELINE_MAIL_SUBJECT, QUIZ_SETUP_ACCOUNT_GONE, QUIZ_UNATTENDED_BY_PREFIX, W1A_ARM_ROWS, quizBaselineMailOf, quizStatusMailOf, quizWaitingStreakOf,
} from '../src/continuity/quiz.js';
import type { LaneArmQuizTick } from '../../shared/lane-arm.js';
import { quizBaselineRead, quizRuns, quizStatusRead } from '../src/continuity/quizStore.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { singleReport } from './sim/quizSets.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const HOUR = 3_600_000;
const TRACE = 'quiz-unattended op fleet 2026-11-23T04:00:00Z';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; });

interface Rig {
  coord: CoordStore; now: number; notifyLog: NotifyLog;
  post: (url: string, payload: unknown, headers?: Record<string, string>) => Promise<LightMyRequestResponse>;
}

/** lane-a holds an open run of the quiz's programme (`overlord`), lane-b one of another programme, lane-w nothing. `coordinator`
 *  false: no open run of `overlord` at all. */
async function rig(o: { coordinator?: boolean } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-quiz-unattended-');
  for (const id of ['lane-a', 'lane-b', 'lane-w']) seedRow(home, id);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  const base = testDeps(home, recorder().run);
  app = await buildServer({ ...base, mailToken: ID_GATE_TOKEN, coord, notifyLog }, new Bus());
  const open = (program: string, claimedBy: string) =>
    coord.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: null, claimedBy });
  if (o.coordinator !== false) open('overlord', 'lane-a');
  open('prog-b', 'lane-b');
  const self = app;
  return {
    coord, now: base.time.clock.wall(), notifyLog,
    post: (url, payload, headers = TOKEN) => self.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(payload) }),
  };
}

const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
/** Records one report through the record door, as the verb does (`unattended: true` from the timer, or by hand), and answers
 *  its id, sha, report text and the confirm key the door answered, if any. */
async function recorded(r: Rig, over: Record<string, unknown> = {}, o: { hand?: boolean; text?: string } = {}):
  Promise<{ id: number; sha: string; key: string | undefined; report: string }> {
  const report = o.text ?? `${JSON.stringify(singleReport({ measured_ms: r.now - HOUR, ...over }))}\n`;
  const res = await r.post('/api/continuity/quiz-runs', { report, sha256: sha(report), recordedBy: TRACE, ...(o.hand === true ? {} : { unattended: true }) });
  expect(res.statusCode, res.body).toBe(200);
  return { id: json(res)['id'] as number, sha: sha(report), key: json(res)['confirmKey'] as string | undefined, report };
}
const confirm = (r: Rig, id: number | string, payload: unknown, headers?: Record<string, string>) =>
  r.post(`/api/continuity/quiz-runs/${id}/confirm`, payload, headers);
/** The confirm body the verb sends for a recorded run: its sha, the trace and its key. */
const good = (run: { sha: string; key: string | undefined }) => ({ sha256: run.sha, by: TRACE, confirmKey: run.key });
const BY = `${QUIZ_UNATTENDED_BY_PREFIX}${TRACE}`;
const wakes = (r: Rig) => mails(r).filter((m) => m.subject.startsWith(QUIZ_BASELINE_MAIL_SUBJECT));
/** Every mail row queued, as (recipient, subject, body). */
const mails = (r: Rig) => r.coord.db.prepare('SELECT d.toId AS toId, m.subject AS subject, m.body AS body FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ORDER BY m.id')
  .all() as { toId: string; subject: string; body: string }[];
const stateOf = (r: Rig, id: number) => {
  const runs = quizRuns(r.coord.db);
  if (!runs.ok) throw new Error(runs.detail);
  const row = runs.rows.find((x) => x.id === id)!;
  return { state: row.state, baseline: row.baseline, ruledBy: row.ruledBy };
};

describe('POST /api/continuity/quiz-runs/:id/confirm (the unattended confirmation, box token)', () => {
  it('no token, or a wrong one, answers 401 and rules nothing', async () => {
    const r = await rig();
    const run = await recorded(r);
    for (const headers of [{}, { 'x-ccrc-mail-token': 'e'.repeat(64) }] as Record<string, string>[]) {
      const res = await confirm(r, run.id, good(run), headers);
      expect(res.statusCode, res.body).toBe(401);
    }
    expect(stateOf(r, run.id)).toEqual({ state: 'pending', baseline: false, ruledBy: null });
  });

  it('a malformed id or body answers 400 and rules nothing', async () => {
    const r = await rig();
    const run = await recorded(r);
    for (const [id, body] of [
      ['0', { sha256: run.sha, by: TRACE }], ['x', { sha256: run.sha, by: TRACE }],
      [run.id, { by: TRACE }], [run.id, { sha256: run.sha.toUpperCase(), by: TRACE }], [run.id, { sha256: run.sha }],
      [run.id, { sha256: run.sha, by: 'a\nb' }], [run.id, { sha256: run.sha, by: 'x'.repeat(201) }], [run.id, []],
      [run.id, { ...good(run), confirmKey: 'x' }], [run.id, { ...good(run), confirmKey: run.key!.toUpperCase() }],
      [run.id, { ...good(run), confirmKey: 7 }],
    ] as [number | string, unknown][]) {
      const res = await confirm(r, id, body);
      expect(res.statusCode, `${String(id)} ${JSON.stringify(body)}: ${res.body}`).toBe(400);
    }
    expect(stateOf(r, run.id)).toEqual({ state: 'pending', baseline: false, ruledBy: null });
  });

  it('the record answers a confirm key only for an unattended record: 64 hex, once', async () => {
    const r = await rig();
    const run = await recorded(r);
    expect(run.key).toMatch(/^[0-9a-f]{64}$/);
    expect(r.coord.db.prepare('SELECT confirmKeyHash FROM continuity_quiz_runs WHERE id = ?').get(run.id)).toEqual({ confirmKeyHash: sha(run.key!) });
    const hand = await recorded(r, { measured_ms: r.now - 2 * HOUR }, { hand: true });
    expect(hand.key).toBeUndefined();
    const bad = await r.post('/api/continuity/quiz-runs', { report: hand.report, sha256: hand.sha, recordedBy: TRACE, unattended: 'yes' });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(json(bad)).toMatchObject({ field: 'unattended' });
  });

  it('a matching key and sha confirm the run as the baseline, and the coordinator is mailed once', async () => {
    const r = await rig();
    const run = await recorded(r);
    const res = await confirm(r, run.id, good(run));
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, id: run.id, state: 'confirmed', baseline: true, changed: true });
    expect(stateOf(r, run.id)).toEqual({ state: 'confirmed', baseline: true, ruledBy: BY });
    expect(quizBaselineRead(r.coord.db)).toMatchObject({ ok: true, exists: true });
    const sent = mails(r);
    expect(sent.map((m) => [m.toId, m.subject])).toEqual([['lane-a', `${QUIZ_BASELINE_MAIL_SUBJECT} run ${run.id}`]]);
    expect(sent[0]!.body).toContain(`run ${run.id}, report sha ${run.sha.slice(0, 12)}`);
    expect(sent[0]!.body).toContain('ccrc-api quiz live');
    expect(sent[0]!.body).toContain('never a W2 result, a PASS or a measured benefit of recall');
    // A resend (the timer's tick after a lost answer: the record answers the confirmed row and no key) answers the row as it
    // stands and writes and mails nothing more.
    const again = await recorded(r, {}, { text: run.report });
    expect(again).toMatchObject({ id: run.id, key: undefined });
    const res2 = await confirm(r, run.id, { sha256: run.sha, by: 'quiz-unattended op fleet 2026-11-23T10:00:00Z' });
    expect(json(res2)).toEqual({ ok: true, id: run.id, state: 'confirmed', baseline: true, changed: false });
    expect(stateOf(r, run.id).ruledBy).toBe(BY);
    expect(mails(r)).toHaveLength(1);
  });

  it('a key that is missing or wrong, or a hand-recorded run, refuses and leaves the run pending (F1a)', async () => {
    const r = await rig();
    const run = await recorded(r);
    for (const body of [{ sha256: run.sha, by: TRACE }, { ...good(run), confirmKey: 'f'.repeat(64) }]) {
      const res = await confirm(r, run.id, body);
      expect(res.statusCode, res.body).toBe(400);
      expect(json(res)).toMatchObject({ ok: false, error: 'bad-request' });
      expect(stateOf(r, run.id)).toEqual({ state: 'pending', baseline: false, ruledBy: null });
    }
    // A hand record holds no key, and an unattended resend of it gains none: only the card confirms it.
    const hand = await recorded(r, { measured_ms: r.now - 2 * HOUR }, { hand: true });
    const resent = await recorded(r, {}, { text: hand.report });
    expect(resent).toMatchObject({ id: hand.id, key: undefined });
    const res = await confirm(r, hand.id, { ...good(run), sha256: hand.sha });
    expect(res.statusCode, res.body).toBe(400);
    expect(json(res)['detail']).toContain('not recorded for the unattended confirmation');
    expect(stateOf(r, hand.id)).toEqual({ state: 'pending', baseline: false, ruledBy: null });
    expect(wakes(r)).toEqual([]);
  });

  it('an unattended resend of a pending run answers a new key, and the old one no longer confirms', async () => {
    const r = await rig();
    const run = await recorded(r);
    const again = await recorded(r, {}, { text: run.report });
    expect(again.id).toBe(run.id);
    expect(again.key).toMatch(/^[0-9a-f]{64}$/);
    expect(again.key).not.toBe(run.key);
    expect((await confirm(r, run.id, good(run))).statusCode).toBe(400);
    expect(json(await confirm(r, run.id, good(again)))).toMatchObject({ state: 'confirmed', baseline: true });
  });

  it('a sha that does not match refuses and leaves the run pending, never discarded (F1b)', async () => {
    const r = await rig();
    const run = await recorded(r);
    const res = await confirm(r, run.id, { ...good(run), sha256: 'a'.repeat(64) });
    expect(res.statusCode, res.body).toBe(400);
    expect(json(res)['detail']).toContain('stays pending');
    expect(stateOf(r, run.id)).toEqual({ state: 'pending', baseline: false, ruledBy: null });
    expect(quizBaselineRead(r.coord.db)).toEqual({ ok: true, exists: false, at: null });
    expect(mails(r)).toEqual([]);
    // The right sha still confirms it.
    expect(json(await confirm(r, run.id, good(run)))).toMatchObject({ state: 'confirmed', baseline: true });
  });

  it('an unknown run, and a run already ruled under another sha, answer 400', async () => {
    const r = await rig();
    expect((await confirm(r, 99, { sha256: 'a'.repeat(64), by: TRACE })).statusCode).toBe(400);
    const run = await recorded(r);
    expect(json(await confirm(r, run.id, good(run)))).toMatchObject({ state: 'confirmed' });
    const res = await confirm(r, run.id, { sha256: 'c'.repeat(64), by: TRACE });
    expect(res.statusCode, res.body).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: 'bad-request', detail: 'already confirmed' });
  });

  it('a second confirmed run is never a baseline, and wakes nobody', async () => {
    const r = await rig();
    const first = await recorded(r);
    await confirm(r, first.id, good(first));
    const second = await recorded(r, { measured_ms: r.now - 2 * HOUR });
    expect(json(await confirm(r, second.id, good(second)))).toEqual({ ok: true, id: second.id, state: 'confirmed', baseline: false, changed: true });
    expect(mails(r)).toHaveLength(1);
  });

  it('a baseline with nobody to tell confirms and mails nobody, and a later tick mails it once a coordinator exists (F4)', async () => {
    const r = await rig({ coordinator: false });
    const run = await recorded(r);
    expect(json(await confirm(r, run.id, good(run)))).toMatchObject({ state: 'confirmed', baseline: true });
    expect(mails(r)).toEqual([]);
    expect(json(await status(r, tick()))).toMatchObject({ ok: true });
    expect(wakes(r)).toEqual([]);
    r.coord.openRun({ program: 'overlord', title: 'OVERLORD', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' });
    await status(r, tick({ at: tick().at + 1 }));
    expect(wakes(r).map((m) => [m.toId, m.subject])).toEqual([['lane-a', `${QUIZ_BASELINE_MAIL_SUBJECT} run ${run.id}`]]);
    await status(r, tick({ at: tick().at + 2 }));
    expect(wakes(r)).toHaveLength(1);
  });

  it('with no overlord run open, the wake goes to the designated Overlord session, with no run (F4)', async () => {
    const r = await rig({ coordinator: false });
    r.coord.designationRead = () => ({ kind: 'designated', sessionId: 'lane-o', term: 1, row: null as never });
    const run = await recorded(r);
    await confirm(r, run.id, good(run));
    expect(wakes(r).map((m) => m.toId)).toEqual(['lane-o']);
  });

  it('a wake whose queueing throws is not marked, and the next tick sends it (F4)', async () => {
    const r = await rig();
    const insert = r.coord.insertMail.bind(r.coord);
    r.coord.insertMail = () => { throw new Error('disk full'); };
    const run = await recorded(r);
    expect(json(await confirm(r, run.id, good(run)))).toMatchObject({ state: 'confirmed', baseline: true });
    r.coord.insertMail = insert;
    expect(wakes(r)).toEqual([]);
    expect(r.coord.db.prepare('SELECT wokeAt FROM continuity_quiz_runs WHERE id = ?').get(run.id)).toEqual({ wokeAt: null });
    await status(r, tick());
    expect(wakes(r).map((m) => m.toId)).toEqual(['lane-a']);
  });
});

const live = (r: Rig, payload: unknown, headers?: Record<string, string>) => r.post('/api/continuity/quiz-baseline/live', payload, headers);
const LANE = W1A_ARM_ROWS[0];
const as = (id: string, lane: unknown = LANE) => ({ fromId: id, fromUuid: `u-${id}`, lane });
const stored = (r: Rig, lane: (typeof W1A_ARM_ROWS)[number] = LANE) => laneArmRowViewOf(lane, r.coord.laneArmSetting(lane)).stored;
async function withBaseline(r: Rig): Promise<void> {
  const run = await recorded(r);
  expect(json(await confirm(r, run.id, good(run)))).toMatchObject({ baseline: true });
}

describe('POST /api/continuity/quiz-baseline/live (the coordinator\'s Live, box token)', () => {
  it('no token answers 401 and writes nothing', async () => {
    const r = await rig();
    await withBaseline(r);
    expect((await live(r, as('lane-a'), {})).statusCode).toBe(401);
    expect(stored(r)).toBe('shadow');
  });

  it('a body that is not {fromId, fromUuid, lane} answers 400', async () => {
    const r = await rig();
    await withBaseline(r);
    for (const body of [[], {}, { ...as('lane-a'), extra: 1 }, as('lane-a', 'no-such-lane'), { fromId: 'lane-a', lane: LANE }]) {
      expect((await live(r, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(stored(r)).toBe('shadow');
  });

  it('a stale uuid, an unknown sender, a worker and another programme\'s coordinator are refused', async () => {
    const r = await rig();
    await withBaseline(r);
    expect((await live(r, { ...as('lane-a'), fromUuid: 'u-other' })).statusCode).toBe(403);
    expect((await live(r, as('lane-x'))).statusCode).toBe(403);
    for (const who of ['lane-w', 'lane-b']) {
      const res = await live(r, as(who));
      expect(res.statusCode, res.body).toBe(403);
      expect(json(res)).toMatchObject({ ok: false, error: 'not-your-programme' });
    }
    expect(stored(r)).toBe('shadow');
  });

  it('before a confirmed baseline exists it answers 409 baseline-missing, a pending run included', async () => {
    const r = await rig();
    await recorded(r);
    const res = await live(r, as('lane-a'));
    expect(res.statusCode, res.body).toBe(409);
    expect(json(res)).toMatchObject({ ok: false, error: 'baseline-missing' });
    expect(stored(r)).toBe('shadow');
  });

  it('a lane the baseline does not gate answers 400', async () => {
    const r = await rig();
    await withBaseline(r);
    const other = (await import('../../shared/lane-arm.js')).LANE_ARM_LANES.find((l) => !(W1A_ARM_ROWS as readonly string[]).includes(l));
    expect(other).toBeDefined();
    expect((await live(r, as('lane-a', other))).statusCode).toBe(400);
  });

  it('the programme\'s coordinator takes each W1a lane live on the baseline, with a feed row naming it', async () => {
    const r = await rig();
    await withBaseline(r);
    for (const lane of W1A_ARM_ROWS) {
      const res = await live(r, as('lane-a', lane));
      expect(res.statusCode, res.body).toBe(200);
      expect(json(res)).toEqual({ ok: true, lane, stored: 'live', live: true });
      expect(stored(r, lane)).toBe('live');
    }
    const feedOf = () => { const head = r.notifyLog.catchUp(null, 0); return JSON.stringify(r.notifyLog.catchUp(head.epoch, 0).events); };
    const feed = feedOf();
    expect(feed).toContain(`${LANE}: shadow -> live; by coordinator lane-a`);
    // Live again is no change, and no second row.
    expect(json(await live(r, as('lane-a')))).toMatchObject({ ok: true, stored: 'live' });
    expect(feedOf().split(`${LANE}: shadow -> live`).length - 1).toBe(1);
  });
});

describe('quizBaselineMailOf (L1: who is woken, and when)', () => {
  const SHA = 'd'.repeat(64);
  const base = { id: 4, reportSha: SHA, wokeAt: null };
  it('mails the coordinator, or else the designated session, while the baseline was never woken', () => {
    expect(quizBaselineMailOf({ baseline: base, coordinator: 'lane-a', designated: 'lane-o' })).toMatchObject({
      toId: 'lane-a', subject: `${QUIZ_BASELINE_MAIL_SUBJECT} run 4` });
    expect(quizBaselineMailOf({ baseline: base, coordinator: null, designated: 'lane-o' })).toMatchObject({ toId: 'lane-o' });
    expect(quizBaselineMailOf({ baseline: { ...base, wokeAt: 5 }, coordinator: 'lane-a', designated: null })).toBeNull();
    expect(quizBaselineMailOf({ baseline: null, coordinator: 'lane-a', designated: null })).toBeNull();
    expect(quizBaselineMailOf({ baseline: base, coordinator: null, designated: null })).toBeNull();
  });
  it('names the run, the sha prefix and every W1a lane', () => {
    const m = quizBaselineMailOf({ baseline: base, coordinator: 'lane-a', designated: null })!;
    expect(m.body).toContain(`run 4, report sha ${'d'.repeat(12)},`);
    for (const lane of W1A_ARM_ROWS) expect(m.body).toContain(lane);
  });
});

describe('decideLaneArmCoordLive (L1: the coordinator\'s Live)', () => {
  const row = (choice: unknown): LaneArmRead => ({ kind: 'row', choice, updatedAt: 0, importedAt: null, imported: null });
  const view = (read: LaneArmRead) => laneArmRowViewOf(LANE, read, null);
  const yes = { ok: true as const, exists: true };
  it('writes a W1a row once a baseline exists', () => {
    expect(decideLaneArmCoordLive({ lane: LANE, row: view(row('shadow')), baseline: yes, gate: null })).toEqual({ kind: 'write', lane: LANE });
  });
  it('refuses a gated row, an unreadable row, an unreadable baseline and a missing one, in that order', () => {
    expect(decideLaneArmCoordLive({ lane: LANE, row: view(row('shadow')), baseline: yes, gate: 'not yet' })).toEqual({ kind: 'gated', reason: 'not yet' });
    expect(decideLaneArmCoordLive({ lane: LANE, row: view({ kind: 'unreadable', detail: 'io' }), baseline: { ok: true, exists: false }, gate: null }))
      .toEqual({ kind: 'unreadable', detail: 'io' });
    expect(decideLaneArmCoordLive({ lane: LANE, row: view(row('shadow')), baseline: { ok: false, detail: 'locked' }, gate: null }))
      .toMatchObject({ kind: 'unreadable' });
    expect(decideLaneArmCoordLive({ lane: LANE, row: view(row('shadow')), baseline: { ok: true, exists: false }, gate: null })).toEqual({ kind: 'baseline-missing' });
  });
});

const tick = (over: Record<string, unknown> = {}) => ({
  week: '2026-W48', act: 'arms', outcome: 'ok', word: null, detail: null, account: 'acct-a', at: 1_795_300_000_000, by: TRACE, ...over,
});
const status = (r: Rig, payload: unknown, headers?: Record<string, string>) => r.post('/api/continuity/quiz-status', payload, headers);
const stopMails = (r: Rig) => mails(r).filter((m) => m.subject.startsWith('quiz-unattended-stopped'));

describe('POST /api/continuity/quiz-status (the unattended run\'s tick, box token)', () => {
  it('no token answers 401 and stores nothing', async () => {
    const r = await rig();
    expect((await status(r, tick(), {})).statusCode).toBe(401);
    expect(quizStatusRead(r.coord.db)).toEqual({ ok: true, row: null });
  });

  it('a body off its shape answers 400 naming the field', async () => {
    const r = await rig();
    for (const [body, field] of [
      [[], '(body)'], [{ ...tick(), extra: 1 }, 'extra'], [tick({ week: '2026-48' }), 'week'], [tick({ act: 'Arms' }), 'act'],
      [tick({ outcome: 'done' }), 'outcome'], [tick({ word: 'a b' }), 'word'], [tick({ detail: 'a\nb' }), 'detail'],
      [tick({ detail: 'x'.repeat(201) }), 'detail'], [tick({ account: 'a/b' }), 'account'], [tick({ at: 0 }), 'at'],
      [tick({ by: undefined }), 'by'], [tick({ by: '' }), 'by'], [tick({ by: 'a\nb' }), 'by'], [tick({ by: 'x'.repeat(201) }), 'by'],
    ] as [unknown, string][]) {
      const res = await status(r, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(json(res)).toMatchObject({ ok: false, error: 'bad-request', field });
    }
    expect(quizStatusRead(r.coord.db)).toEqual({ ok: true, row: null });
  });

  it('stores the last tick, which the Shadow lanes card shows', async () => {
    const r = await rig();
    expect(json(await status(r, tick()))).toEqual({ ok: true, mailed: false });
    expect(json(await status(r, tick({ act: 'judge', at: 1_795_300_100_000 })))).toEqual({ ok: true, mailed: false });
    const view = await app!.inject({ method: 'GET', url: '/api/coord/lane-arm' });
    expect(json(view)['quizBaseline']).toMatchObject({ unattended: { state: 'reported', week: '2026-W48', act: 'judge', outcome: 'ok', account: 'acct-a' } });
    expect(stopMails(r)).toEqual([]);
    expect(r.coord.db.prepare('SELECT reportedBy FROM continuity_quiz_status').get()).toEqual({ reportedBy: TRACE });
  });

  it('an empty detail is taken and stored as none, so the runner and the door agree', async () => {
    const r = await rig();
    expect((await status(r, tick({ detail: '' }))).statusCode).toBe(200);
    expect(quizStatusRead(r.coord.db)).toMatchObject({ ok: true, row: { detail: null } });
  });

  it('waiting across two ISO weeks mails setup-account-gone once; a tick that is not waiting ends the run (F9)', async () => {
    const r = await rig();
    const gone = () => mails(r).filter((m) => m.subject.endsWith(QUIZ_SETUP_ACCOUNT_GONE));
    const wait = (week: string, at: number) => status(r, tick({ week, outcome: 'waiting', word: 'limits-threshold', at }));
    await wait('2026-W48', 1);
    await wait('2026-W48', 2);
    expect(gone()).toEqual([]);
    expect(json(await wait('2026-W49', 3))).toEqual({ ok: true, mailed: true });
    await wait('2026-W49', 4);
    await wait('2026-W50', 5);
    expect(gone().map((m) => [m.toId, m.subject])).toEqual([['lane-a', `quiz-unattended-stopped 2026-W49 ${QUIZ_SETUP_ACCOUNT_GONE}`]]);
    expect(gone()[0]!.body).toContain('since 2026-W48');
    // Run 3538: the account is the week's, so the mail asks whether any candidate has room and never advises a new setup.
    expect(gone()[0]!.body).toContain('whether any candidate has room');
    expect(gone()[0]!.body).not.toMatch(/never re-picked|a new setup/);
    // An ok tick ends the run; a new run of waiting weeks mails once more.
    await status(r, tick({ week: '2026-W50', at: 6 }));
    await wait('2026-W51', 7);
    expect(gone()).toHaveLength(1);
    await wait('2026-W52', 8);
    expect(gone()).toHaveLength(2);
  });

  it('a setup-account-gone mail the queue declines keeps the stored key, so a later tick mails it (F9)', async () => {
    const r = await rig();
    const gone = () => mails(r).filter((m) => m.subject.endsWith(QUIZ_SETUP_ACCOUNT_GONE));
    const wait = (week: string, at: number) => status(r, tick({ week, outcome: 'waiting', word: 'limits-threshold', at }));
    await wait('2026-W48', 1);
    const outstanding = r.coord.hasOutstandingMail.bind(r.coord);
    r.coord.hasOutstandingMail = () => true;
    expect(json(await wait('2026-W49', 2))).toEqual({ ok: true, mailed: false });
    r.coord.hasOutstandingMail = outstanding;
    expect(quizStatusRead(r.coord.db)).toMatchObject({ ok: true, row: { waitingSince: '2026-W48', goneMailedKey: null } });
    expect(json(await wait('2026-W49', 3))).toEqual({ ok: true, mailed: true });
    expect(gone()).toHaveLength(1);
  });

  it('a stop word mails the coordinator once per week and word', async () => {
    const r = await rig();
    const stop = tick({ outcome: 'refused', word: 'pilot-failed', detail: 'step 0b: the skill is missing' });
    expect(json(await status(r, stop))).toEqual({ ok: true, mailed: true });
    expect(json(await status(r, { ...stop, at: stop.at + 1 }))).toEqual({ ok: true, mailed: false });
    expect(json(await status(r, tick({ act: 'done' })))).toEqual({ ok: true, mailed: false });
    expect(json(await status(r, { ...stop, week: '2026-W49' }))).toEqual({ ok: true, mailed: true });
    const sent = stopMails(r);
    expect(sent.map((m) => [m.toId, m.subject])).toEqual([
      ['lane-a', 'quiz-unattended-stopped 2026-W48 pilot-failed'], ['lane-a', 'quiz-unattended-stopped 2026-W49 pilot-failed']]);
    expect(sent[0]!.body).toContain('word pilot-failed: step 0b: the skill is missing');
  });

  it('no-room mails although it only waits; a limits stop does not', async () => {
    const r = await rig();
    expect(json(await status(r, tick({ outcome: 'waiting', word: 'limits-threshold' })))).toEqual({ ok: true, mailed: false });
    expect(json(await status(r, tick({ outcome: 'waiting', word: 'no-room' })))).toEqual({ ok: true, mailed: true });
  });

  it('with no open run of the programme it stores the tick and mails nobody, and mails once a coordinator exists', async () => {
    const r = await rig({ coordinator: false });
    const stop = tick({ outcome: 'failed', word: 'internal' });
    expect(json(await status(r, stop))).toEqual({ ok: true, mailed: false });
    expect(quizStatusRead(r.coord.db)).toMatchObject({ ok: true, row: { word: 'internal', mailedKey: null } });
    r.coord.openRun({ program: 'overlord', title: 'OVERLORD', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' });
    expect(json(await status(r, stop))).toEqual({ ok: true, mailed: true });
  });
});

describe('quizStatusMailOf (L1: when a tick wakes the coordinator)', () => {
  const t = (over: Partial<LaneArmQuizTick> = {}): LaneArmQuizTick => ({ ...(tick() as unknown as LaneArmQuizTick), ...over });
  it('mails a refused or failed word, and the ruled waiting word, under its week and word', () => {
    for (const s of [t({ outcome: 'refused', word: 'x' }), t({ outcome: 'failed', word: 'x' }), t({ outcome: 'waiting', word: 'no-room' })]) {
      const d = quizStatusMailOf({ status: s, mailedKey: null, coordinator: 'lane-a' });
      expect(d.key).toBe(`2026-W48 ${s.word!}`);
      expect(d.mail?.subject).toBe(`quiz-unattended-stopped 2026-W48 ${s.word!}`);
    }
  });
  it('keeps the stored key and mails nothing for an ok tick, a plain wait, a repeat or no coordinator', () => {
    expect(quizStatusMailOf({ status: t(), mailedKey: 'k', coordinator: 'lane-a' })).toEqual({ mail: null, key: 'k' });
    expect(quizStatusMailOf({ status: t({ outcome: 'waiting', word: 'limits-stale' }), mailedKey: 'k', coordinator: 'lane-a' })).toEqual({ mail: null, key: 'k' });
    expect(quizStatusMailOf({ status: t({ outcome: 'refused', word: 'x' }), mailedKey: '2026-W48 x', coordinator: 'lane-a' })).toEqual({ mail: null, key: '2026-W48 x' });
    expect(quizStatusMailOf({ status: t({ outcome: 'refused', word: 'x' }), mailedKey: null, coordinator: null })).toEqual({ mail: null, key: null });
    expect(quizStatusMailOf({ status: t({ outcome: 'refused', word: null }), mailedKey: null, coordinator: 'lane-a' })).toEqual({ mail: null, key: null });
  });
  it('names a setup-phase stop with no week as the setup of the week it happened in, so it mails once a week', () => {
    const s = t({ week: null, outcome: 'refused', word: 'no-account-admitted', at: Date.UTC(2026, 10, 25) });
    expect(quizStatusMailOf({ status: s, mailedKey: null, coordinator: 'lane-a' }).key).toBe('setup 2026-W48 no-account-admitted');
    expect(quizStatusMailOf({ status: { ...s, at: Date.UTC(2026, 11, 2) }, mailedKey: 'setup 2026-W48 no-account-admitted', coordinator: 'lane-a' }).key)
      .toBe('setup 2026-W49 no-account-admitted');
  });
});

describe('quizWaitingStreakOf (L1: the setup account\'s waiting streak, F9)', () => {
  const t = (over: Partial<LaneArmQuizTick> = {}): LaneArmQuizTick => ({ ...(tick({ outcome: 'waiting', word: 'no-room' }) as unknown as LaneArmQuizTick), ...over });
  it('starts on a waiting tick, keeps its first week, and ends on any other outcome', () => {
    expect(quizWaitingStreakOf({ status: t(), waitingSince: null, goneMailedKey: null, coordinator: 'lane-a' })).toEqual({ waitingSince: '2026-W48', goneKey: null, mail: null });
    expect(quizWaitingStreakOf({ status: t({ outcome: 'ok', word: null }), waitingSince: '2026-W47', goneMailedKey: null, coordinator: 'lane-a' }))
      .toEqual({ waitingSince: null, goneKey: null, mail: null });
    expect(quizWaitingStreakOf({ status: t({ week: null }), waitingSince: '2026-W47', goneMailedKey: 'k', coordinator: 'lane-a' }))
      .toEqual({ waitingSince: '2026-W47', goneKey: 'k', mail: null });
  });
  it('mails once the run spans two weeks, once per run, and keeps the key when nobody can be told', () => {
    const d = quizWaitingStreakOf({ status: t(), waitingSince: '2026-W47', goneMailedKey: null, coordinator: 'lane-a' });
    expect(d).toMatchObject({ waitingSince: '2026-W47', goneKey: '2026-W47', mail: { toId: 'lane-a', subject: `quiz-unattended-stopped 2026-W48 ${QUIZ_SETUP_ACCOUNT_GONE}` } });
    expect(quizWaitingStreakOf({ status: t(), waitingSince: '2026-W47', goneMailedKey: '2026-W47', coordinator: 'lane-a' }).mail).toBeNull();
    expect(quizWaitingStreakOf({ status: t(), waitingSince: '2026-W47', goneMailedKey: 'old', coordinator: null })).toEqual({ waitingSince: '2026-W47', goneKey: 'old', mail: null });
  });
});
