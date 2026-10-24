// D-5841 (D3, #755): after a run is dispatched, the server confirms its wave
// brief was taken. At 5 minutes an unlanded brief is retried ONCE through D1's
// parked path (never re-typed, never typed over a foreign draft); at 10 minutes
// the run's claimant is mailed `brief not taken by <worker>, run N: <reason>`
// and the operator gets one push, tagged per run. Every timer reads back from
// `coord.db`, so a restart repeats nothing. The harness is `mail-sweep.test.ts`'s
// D-5838 block's own (a pane that behaves like a terminal), copied rather than
// imported because that file exports nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { renderMailNudge } from '../src/coord/envelope.js';
import { queueSystemMail } from '../src/coord/rundefsTx.js';
import type { PushPayload } from '../src/push.js';
import { MAIL_SUBJECT_MAX_BYTES } from '../../shared/api.js';
import { briefNotTakenSubject } from '../src/coord/briefwatch.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const WORKER = 'project-a-quiet-basin';
const COORD = 'project-a-calm-mesa';
const UUID = 'a'.repeat(36);
const PID = 4242;
const NOW = 1_800_000_000_000; // arbitrary fixed epoch ms, no relation to real time
const MAIL_SWEEP_MS = 10_000;
const MAIL_QUIET_MS = 60_000;
const BRIEF_RETRY_MS = 5 * 60_000;
const BRIEF_NOTICE_MS = 10 * 60_000;
const NUDGE = renderMailNudge(WORKER);

interface Box { box: string; enterWorks: boolean }
interface Harness { home: string; calls: string[][]; run: Runner }

/** A pane that behaves like a terminal: typed text lands in the box, and Enter
 *  takes it only while `enterWorks` is true (`mail-sweep.test.ts`, D-5838). */
const liveHarness = (st: Box): Harness => {
  const home = mkTmp('ccrc-brief-landed-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: `❯ ${st.box}\n`, stderr: '' };
    if (args[0] === 'send-keys') {
      if (args[3] === '-l') st.box += args[5]!;
      else if (args[3] === 'Enter' && st.enterWorks) st.box = '';
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { home, calls, run };
};

const seedWorker = (home: string, hook: Record<string, unknown> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${WORKER}.${k}`), v);
  writeFileSync(path.join(reg, `${WORKER}.hookstate.json`), JSON.stringify({
    v: 1, state: 'done', sessionId: UUID, pid: PID, event: null,
    updatedAt: NOW - 61_000, ask: null, subagents: [], ...hook,
  }));
  const live = path.join(home, '.claude', 'sessions');
  mkdirSync(live, { recursive: true });
  writeFileSync(path.join(live, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: '/w/project-a', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: NOW - MAIL_QUIET_MS - 1_000, version: '2.1.220',
  }));
};

const store = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

/** A dispatched run, claimed by `COORD`, and its brief queued the way
 *  `dispatchRun` queues it. */
const dispatched = (coord: CoordStore): { runId: number; deliveryId: number } => {
  const opened = coord.openRun({ program: 'prog-a', title: 'prog-a', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, WORKER, `${WORKER}-ws`, `ws/${WORKER}`, false, Date.now());
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  const q = queueSystemMail(coord, { program: 'prog-a', wave: 1, waveOf: 2 }, { fromId: 'coordinator', toId: WORKER,
    runId: opened.id, kind: 'status', subject: 'wave-brief', body: 'the wave brief' });
  if (!q.queued) throw new Error('brief not queued');
  return { runId: opened.id, deliveryId: q.deliveryId };
};

const primed = async (h: Harness, coord: CoordStore, push: unknown): Promise<FleetWatcher> => {
  const deps: Deps = { ...testDeps(h.home, h.run), coord, push: push as never };
  const w = new FleetWatcher(withFakeClock(deps), new Bus(), 2000);
  await w.tick();
  return w;
};

const pushSpy = (): { sent: PushPayload[]; push: { notify: (p: PushPayload) => Promise<void> } } => {
  const sent: PushPayload[] = [];
  return { sent, push: { notify: async (p: PushPayload) => { sent.push(p); } } };
};

const literalSends = (calls: string[][]): string[] =>
  calls.filter((a) => a[0] === 'send-keys' && a[3] === '-l').map((a) => a[5]!);
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };
const deliveryState = (coord: CoordStore, id: number): string =>
  (coord.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?').get(id) as { state: string }).state;
const briefRows = (coord: CoordStore, runId: number, detail: string): number =>
  (coord.db.prepare('SELECT COUNT(*) AS n FROM run_events WHERE runId = ? AND detail = ?').get(runId, detail) as { n: number }).n;
const notices = (coord: CoordStore): { toId: string; fromId: string; subject: string; runId: number | null }[] =>
  coord.db.prepare("SELECT toId, fromId, subject, runId FROM mail WHERE subject LIKE 'brief not taken%' ORDER BY id")
    .all() as unknown as { toId: string; fromId: string; subject: string; runId: number | null }[];
const runRow = (coord: CoordStore, id: number): unknown =>
  coord.db.prepare('SELECT state, sessionId, claimedBy, workspace, branch FROM runs WHERE id = ?').get(id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('the wave brief is confirmed taken (D-5841)', () => {
  it('a brief taken within 5 minutes gets no retry row, no notice and no push', async () => {
    const st = { box: '', enterWorks: true };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId, deliveryId } = dispatched(coord);
    await w.sweepMail();
    expect(deliveryState(coord, deliveryId)).toBe('delivered');
    advance(MAIL_SWEEP_MS + 1_000);
    seedWorker(h.home, { event: 'UserPromptSubmit', updatedAt: Date.now() });
    await w.sweepMail();
    for (let i = 0; i < 3; i++) { advance(BRIEF_RETRY_MS); await w.sweepMail(); }
    expect(briefRows(coord, runId, 'brief-retry')).toBe(0);
    expect(briefRows(coord, runId, 'brief-not-taken')).toBe(0);
    expect(notices(coord)).toEqual([]);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toEqual([]);
  }, 20_000);

  it('an enter-ignored brief on a fresh worker is retried at 5 minutes through the park and lands, our nudge never re-typed', async () => {
    const st = { box: '', enterWorks: false };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId, deliveryId } = dispatched(coord);
    await w.sweepMail();
    expect(st.box).toBe(NUDGE);   // parked: our own nudge, unsubmitted
    expect(deliveryState(coord, deliveryId)).toBe('queued');

    // Short of 5 minutes: nothing.
    advance(BRIEF_RETRY_MS - 30_000);
    st.enterWorks = true;
    await w.sweepMail();
    expect(deliveryState(coord, deliveryId)).toBe('queued');
    expect(briefRows(coord, runId, 'brief-retry')).toBe(0);

    // At 5 minutes (D1's own retry is at 10): one retry, a verified Enter on our own text.
    advance(31_000);
    await w.sweepMail();
    expect(briefRows(coord, runId, 'brief-retry')).toBe(1);
    expect(deliveryState(coord, deliveryId)).toBe('delivered');
    expect(literalSends(h.calls)).toEqual([NUDGE]);

    // Taken: no notice at 10 minutes, and the retry stays one row.
    advance(MAIL_SWEEP_MS + 1_000);
    seedWorker(h.home, { event: 'UserPromptSubmit', updatedAt: Date.now() });
    await w.sweepMail();
    for (let i = 0; i < 3; i++) { advance(BRIEF_RETRY_MS); await w.sweepMail(); }
    expect(briefRows(coord, runId, 'brief-retry')).toBe(1);
    expect(notices(coord)).toEqual([]);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toEqual([]);
  }, 20_000);

  it('a FOREIGN draft is never typed over; at 10 minutes the claimant is mailed and the operator pushed, once', async () => {
    const st = { box: 'a human line', enterWorks: false };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId, deliveryId } = dispatched(coord);
    const before = runRow(coord, runId);
    for (let t = 0; t < BRIEF_NOTICE_MS - 60_000; t += 60_000) { await w.sweepMail(); advance(60_000); }
    expect(notices(coord)).toEqual([]);
    expect(briefRows(coord, runId, 'brief-retry')).toBe(1);

    advance(60_000);
    await w.sweepMail();
    const n = notices(coord);
    expect(n).toHaveLength(1);
    expect(n[0]!.toId).toBe(COORD);
    expect(n[0]!.fromId).toBe('operator');
    expect(n[0]!.runId).toBe(runId);
    expect(n[0]!.subject).toMatch(new RegExp(`^brief not taken by ${WORKER}, run ${runId}: .+`));
    // D-5912: the lane stashes a draft rather than waiting on it; this pane never empties after `C-s`, so the send
    // refuses `stash-failed` and nothing is typed over the human's line.
    expect(n[0]!.subject).toContain('stash-failed');
    const pushed = sent.filter((p) => p.tag === `brief-not-taken-${runId}`);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.body).toContain(`brief not taken by ${WORKER}, run ${runId}`);

    for (let i = 0; i < 4; i++) { advance(BRIEF_RETRY_MS); await w.sweepMail(); }
    expect(notices(coord)).toHaveLength(1);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toHaveLength(1);
    expect(literalSends(h.calls)).toEqual([]);
    expect(st.box).toBe('a human line');
    expect(deliveryState(coord, deliveryId)).toBe('queued');
    // Dispatches nothing, holds nothing: the run row is as it was.
    expect(runRow(coord, runId)).toEqual(before);
  }, 30_000);

  it('a restart over the same coord.db repeats neither the retry nor the notice', async () => {
    const st = { box: 'a human line', enterWorks: false };
    const h = liveHarness(st);
    const coord = store(h.home);
    const first = pushSpy();
    const w = await primed(h, coord, first.push);
    seedWorker(h.home);
    const { runId } = dispatched(coord);
    await w.sweepMail();
    advance(BRIEF_RETRY_MS + 1_000);
    await w.sweepMail();
    advance(BRIEF_NOTICE_MS);
    await w.sweepMail();
    expect(notices(coord)).toHaveLength(1);

    const second = pushSpy();
    const w2 = await primed(h, store(h.home), second.push);
    for (let i = 0; i < 3; i++) { advance(BRIEF_RETRY_MS); await w2.sweepMail(); }
    expect(notices(coord)).toHaveLength(1);
    expect(briefRows(coord, runId, 'brief-retry')).toBe(1);
    expect(briefRows(coord, runId, 'brief-not-taken')).toBe(1);
    expect(second.sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toEqual([]);
  }, 20_000);

  it('a closed run is never noticed', async () => {
    const st = { box: 'a human line', enterWorks: false };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId } = dispatched(coord);
    coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(runId);
    for (let i = 0; i < 3; i++) { await w.sweepMail(); advance(BRIEF_RETRY_MS); }
    await w.sweepMail();
    expect(notices(coord)).toEqual([]);
    expect(briefRows(coord, runId, 'brief-retry')).toBe(0);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toEqual([]);
  }, 20_000);

  it('a rejected brief of an active run is noticed, even with nothing else outstanding', async () => {
    const st = { box: '', enterWorks: true };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId, deliveryId } = dispatched(coord);
    coord.rejectDelivery(deliveryId, 'undeliverable', 'recipient gone');
    advance(BRIEF_NOTICE_MS + 1_000);
    await w.sweepMail();
    const n = notices(coord);
    expect(n).toHaveLength(1);
    expect(n[0]!.subject).toBe(`brief not taken by ${WORKER}, run ${runId}: rejected (recipient gone)`);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toHaveLength(1);
  }, 20_000);
  it('an ingest edge sampled in the same sweep that crosses 10 minutes is not noticed (the pass reads after the edges)', async () => {
    const st = { box: '', enterWorks: true };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId, deliveryId } = dispatched(coord);
    await w.sweepMail();
    expect(deliveryState(coord, deliveryId)).toBe('delivered');
    advance(BRIEF_RETRY_MS + 1_000);
    await w.sweepMail();
    advance(BRIEF_NOTICE_MS - BRIEF_RETRY_MS);
    seedWorker(h.home, { event: 'UserPromptSubmit', updatedAt: Date.now() - 500 });
    await w.sweepMail();
    const ing = coord.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(deliveryId) as { ingestedAt: number | null };
    expect(ing.ingestedAt).not.toBeNull();
    expect(briefRows(coord, runId, 'brief-not-taken')).toBe(0);
    expect(notices(coord)).toEqual([]);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toEqual([]);
  }, 20_000);

  it('a run claimed by its own worker gets the row and one push, and no mail to the worker', async () => {
    const st = { box: 'a human line', enterWorks: false };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId } = dispatched(coord);
    coord.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run(WORKER, runId);
    for (let t = 0; t <= BRIEF_NOTICE_MS; t += 60_000) { await w.sweepMail(); advance(60_000); }
    expect(briefRows(coord, runId, 'brief-not-taken')).toBe(1);
    expect(notices(coord)).toEqual([]);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toHaveLength(1);
    expect(literalSends(h.calls)).toEqual([]);
  }, 30_000);

  it('a parked brief noticed at 10 minutes absorbs the lane\'s own park escalation: one brief push over 30 minutes, no park push', async () => {
    const st = { box: 'a human line', enterWorks: false };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { sent, push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { runId, deliveryId } = dispatched(coord);
    for (let t = 0; t <= 30 * 60_000; t += 60_000) { await w.sweepMail(); advance(60_000); }
    expect(notices(coord)).toHaveLength(1);
    expect(sent.filter((p) => p.tag === `brief-not-taken-${runId}`)).toHaveLength(1);
    expect(sent.filter((p) => p.tag === `mail-parked-${deliveryId}`)).toEqual([]);
    const esc = coord.db.prepare('SELECT parkEscalatedAt FROM mail_deliveries WHERE id = ?').get(deliveryId) as { parkEscalatedAt: number | null };
    expect(esc.parkEscalatedAt).not.toBeNull();
    expect(literalSends(h.calls)).toEqual([]);
  }, 60_000);

  it('a rejected brief\'s notice never promises a retry', async () => {
    const st = { box: '', enterWorks: true };
    const h = liveHarness(st);
    const coord = store(h.home);
    const { push } = pushSpy();
    const w = await primed(h, coord, push);
    seedWorker(h.home);
    const { deliveryId } = dispatched(coord);
    coord.rejectDelivery(deliveryId, 'undeliverable', 'recipient gone');
    advance(BRIEF_NOTICE_MS + 1_000);
    await w.sweepMail();
    const bodies = coord.db.prepare("SELECT body FROM mail WHERE subject LIKE 'brief not taken%'").all() as unknown as { body: string }[];
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.body).not.toContain('retries it');
    expect(bodies[0]!.body).toContain('given up');
  }, 20_000);

  it('the notice subject never exceeds the mail subject cap', () => {
    for (const reason of ['x'.repeat(120), 'é'.repeat(119) + '…']) {
      const s = briefNotTakenSubject('w'.repeat(150), 123_456, reason);
      expect(Buffer.byteLength(s, 'utf8')).toBeLessThanOrEqual(MAIL_SUBJECT_MAX_BYTES);
      expect(s.startsWith('brief not taken by ')).toBe(true);
    }
    expect(briefNotTakenSubject(WORKER, 7, 'short')).toBe(`brief not taken by ${WORKER}, run 7: short`);
  });
});
