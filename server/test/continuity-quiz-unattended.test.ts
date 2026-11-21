// Run 3212 (Overlord W1a; the operator's ruling of 2026-11-22: the weekly replay quiz runs, records and confirms itself): the
// unattended confirm door, `POST /api/continuity/quiz-runs/:id/confirm` (box token; `ccrc quiz-record --confirm` from the
// weekly timer), which applies the operator's matching rule through the one ruler and mails the programme's coordinator
// when it makes the baseline; and the coordinator's Live door, `POST /api/continuity/quiz-baseline/live` (box token,
// attributed, owned), which takes a W1a lane live once a confirmed baseline exists. Fixture HOMEs only.
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
import { QUIZ_BASELINE_MAIL_SUBJECT, W1A_ARM_ROWS, quizBaselineMailOf, quizStatusMailOf } from '../src/continuity/quiz.js';
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
/** Records one report through the record door, as the verb does, and answers its id and sha. */
async function recorded(r: Rig, over: Record<string, unknown> = {}): Promise<{ id: number; sha: string }> {
  const report = `${JSON.stringify(singleReport({ measured_ms: r.now - HOUR, ...over }))}\n`;
  const res = await r.post('/api/continuity/quiz-runs', { report, sha256: sha(report), recordedBy: TRACE });
  expect(res.statusCode, res.body).toBe(200);
  return { id: json(res)['id'] as number, sha: sha(report) };
}
const confirm = (r: Rig, id: number | string, payload: unknown, headers?: Record<string, string>) =>
  r.post(`/api/continuity/quiz-runs/${id}/confirm`, payload, headers);
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
      const res = await confirm(r, run.id, { sha256: run.sha, by: TRACE }, headers);
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
    ] as [number | string, unknown][]) {
      const res = await confirm(r, id, body);
      expect(res.statusCode, `${String(id)} ${JSON.stringify(body)}: ${res.body}`).toBe(400);
    }
    expect(stateOf(r, run.id)).toEqual({ state: 'pending', baseline: false, ruledBy: null });
  });

  it('a matching sha confirms the run as the baseline, and the coordinator is mailed once', async () => {
    const r = await rig();
    const run = await recorded(r);
    const res = await confirm(r, run.id, { sha256: run.sha, by: TRACE });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res)).toEqual({ ok: true, id: run.id, state: 'confirmed', baseline: true, changed: true });
    expect(stateOf(r, run.id)).toEqual({ state: 'confirmed', baseline: true, ruledBy: TRACE });
    expect(quizBaselineRead(r.coord.db)).toMatchObject({ ok: true, exists: true });
    const sent = mails(r);
    expect(sent.map((m) => [m.toId, m.subject])).toEqual([['lane-a', QUIZ_BASELINE_MAIL_SUBJECT]]);
    expect(sent[0]!.body).toContain(`run ${run.id}, report sha ${run.sha.slice(0, 12)}`);
    expect(sent[0]!.body).toContain('ccrc-api quiz live');
    expect(sent[0]!.body).toContain('never a W2 result, a PASS or a measured benefit of recall');
    // A resend (the timer's tick after a lost answer) answers the row as it stands and writes and mails nothing more.
    const again = await confirm(r, run.id, { sha256: run.sha, by: 'quiz-unattended op fleet 2026-11-23T10:00:00Z' });
    expect(json(again)).toEqual({ ok: true, id: run.id, state: 'confirmed', baseline: true, changed: false });
    expect(stateOf(r, run.id).ruledBy).toBe(TRACE);
    expect(mails(r)).toHaveLength(1);
  });

  it('a sha that does not match discards the run: never a baseline, and no mail', async () => {
    const r = await rig();
    const run = await recorded(r);
    const res = await confirm(r, run.id, { sha256: 'a'.repeat(64), by: TRACE });
    expect(json(res)).toEqual({ ok: true, id: run.id, state: 'discarded', baseline: false, changed: true });
    expect(stateOf(r, run.id)).toEqual({ state: 'discarded', baseline: false, ruledBy: TRACE });
    expect(quizBaselineRead(r.coord.db)).toEqual({ ok: true, exists: false, at: null });
    expect(mails(r)).toEqual([]);
    // Ruled already, and still not matching: refused, never re-ruled.
    expect((await confirm(r, run.id, { sha256: 'b'.repeat(64), by: TRACE })).statusCode).toBe(400);
  });

  it('an unknown run, and a run the operator already ruled under another sha, answer 400', async () => {
    const r = await rig();
    expect((await confirm(r, 99, { sha256: 'a'.repeat(64), by: TRACE })).statusCode).toBe(400);
    const run = await recorded(r);
    expect(json(await confirm(r, run.id, { sha256: run.sha, by: TRACE }))).toMatchObject({ state: 'confirmed' });
    const res = await confirm(r, run.id, { sha256: 'c'.repeat(64), by: TRACE });
    expect(res.statusCode, res.body).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: 'bad-request', detail: 'already confirmed' });
  });

  it('a second confirmed run is never a baseline, and wakes nobody', async () => {
    const r = await rig();
    const first = await recorded(r);
    await confirm(r, first.id, { sha256: first.sha, by: TRACE });
    const second = await recorded(r, { measured_ms: r.now - 2 * HOUR });
    expect(json(await confirm(r, second.id, { sha256: second.sha, by: TRACE }))).toEqual({ ok: true, id: second.id, state: 'confirmed', baseline: false, changed: true });
    expect(mails(r)).toHaveLength(1);
  });

  it('a baseline with no open run of the programme confirms and mails nobody', async () => {
    const r = await rig({ coordinator: false });
    const run = await recorded(r);
    expect(json(await confirm(r, run.id, { sha256: run.sha, by: TRACE }))).toMatchObject({ state: 'confirmed', baseline: true });
    expect(mails(r)).toEqual([]);
  });
});

const live = (r: Rig, payload: unknown, headers?: Record<string, string>) => r.post('/api/continuity/quiz-baseline/live', payload, headers);
const LANE = W1A_ARM_ROWS[0];
const as = (id: string, lane: unknown = LANE) => ({ fromId: id, fromUuid: `u-${id}`, lane });
const stored = (r: Rig, lane: typeof LANE = LANE) => laneArmRowViewOf(lane, r.coord.laneArmSetting(lane)).stored;
async function withBaseline(r: Rig): Promise<void> {
  const run = await recorded(r);
  expect(json(await confirm(r, run.id, { sha256: run.sha, by: TRACE }))).toMatchObject({ baseline: true });
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
  it('mails the coordinator only on a change that made the baseline', () => {
    expect(quizBaselineMailOf({ ruled: { changed: true, baseline: true, id: 4 }, reportSha: SHA, coordinator: 'lane-a' })).toMatchObject({
      toId: 'lane-a', subject: QUIZ_BASELINE_MAIL_SUBJECT });
    expect(quizBaselineMailOf({ ruled: { changed: false, baseline: true, id: 4 }, reportSha: SHA, coordinator: 'lane-a' })).toBeNull();
    expect(quizBaselineMailOf({ ruled: { changed: true, baseline: false, id: 4 }, reportSha: SHA, coordinator: 'lane-a' })).toBeNull();
    expect(quizBaselineMailOf({ ruled: { changed: true, baseline: true, id: 4 }, reportSha: SHA, coordinator: null })).toBeNull();
  });
  it('names the run, the sha prefix and every W1a lane', () => {
    const m = quizBaselineMailOf({ ruled: { changed: true, baseline: true, id: 4 }, reportSha: SHA, coordinator: 'lane-a' })!;
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
  week: '2026-W48', act: 'arms', outcome: 'ok', word: null, detail: null, account: 'acct-a', at: 1_795_300_000_000, ...over,
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
  it('names a setup-phase stop with no week as the setup', () => {
    expect(quizStatusMailOf({ status: t({ week: null, outcome: 'refused', word: 'no-account-admitted' }), mailedKey: null, coordinator: 'lane-a' }).key)
      .toBe('setup no-account-admitted');
  });
});
