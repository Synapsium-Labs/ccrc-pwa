// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): the capture queue. Each pass records a row for every
// build a session runs that has none (a new build and the backfill alike), sends at most one job, newest build first,
// through the test box transport, and lands its verdict. A failure is captured again by itself, and only the one that gives
// up raises a notice (slug capture-retry-ceiling). The transport here
// is a FAKE: nothing reaches a test box, and no Claude Code runs.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  BUILD_CAPTURE_SWEEP_MS, BuildCaptureLane, type BuildCaptureAnswer, type BuildCaptureTransport, type BuildCopyAnswer, type BuildCopyTransport,
} from '../src/buildCaptureLane.js';
import { testboxCaptureTransport } from '../src/testboxCapture.js';
import type { CaptureAsked } from '../src/io.js';
import {
  BUILD_CAPTURE_FAIL_CEILING, BUILD_CAPTURE_RETRY_MS, buildTrustOf, captureBlockedBy, captureRetryAfterMs, type BuildCaptureJob,
} from '../../shared/claudeBuildTrust.js';
import type { NotifyEvent } from '../../shared/api.js';
import { UNTRUSTED_BUILD_ITEM_PROGRAMME } from '../src/coord/untrustedBuildItem.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

/** A fake transport: answers what the row hands it, and records every job. */
function fake(answer: (job: BuildCaptureJob) => BuildCaptureAnswer | Promise<BuildCaptureAnswer>): BuildCaptureTransport & { jobs: string[] } {
  const jobs: string[] = [];
  return { jobs, capture: async (job) => { jobs.push(job.build); return answer(job); } };
}
const pass = (job: BuildCaptureJob): BuildCaptureAnswer => ({ kind: 'answered', result: { build: job.build, pass: true, cwd: true, output: 'replay: 40 passed' } });
const fail = (job: BuildCaptureJob): BuildCaptureAnswer => ({ kind: 'answered', result: { build: job.build, pass: false, cwd: true, output: 'replay: 1 failed\nStop: missing field' } });

async function setup(transport: BuildCaptureTransport | undefined, copier?: BuildCopyTransport) {
  const home = mkTmp('ccrc-capture-lane-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const notices: NotifyEvent[] = [];
  const record = notifyLog.record.bind(notifyLog);
  notifyLog.record = (e) => { const ev = record(e); if (ev.kind === 'coord') notices.push(ev); return ev; };
  let clock = 1_000_000_000_000;
  const lane = new BuildCaptureLane(() => ({
    coord, notifyLog, ...(transport === undefined ? {} : { buildCapture: transport }), ...(copier === undefined ? {} : { buildCopy: copier }),
  }), () => clock);
  return { coord, notices, lane, tick: (ms: number) => { clock += ms; }, now: () => clock };
}
const row = (coord: CoordStore, build: string) => coord.claudeBuilds().find((r) => r.build === build);
const buildItems = (coord: CoordStore, now: number) =>
  coord.itemsFor(UNTRUSTED_BUILD_ITEM_PROGRAMME, now).open.filter((i) => i.action?.verb === 'untrusted-build');

describe('the capture queue (D-8289)', () => {
  it('backfill: every live build without a row gets one; the rig builds are left as they are', async () => {
    const s = await setup(undefined);
    await s.lane.sweep(['2.1.302', '2.1.318', null, '2.1.320', '2.1.318', 'junk']);
    expect(s.coord.claudeBuilds().map((r) => `${r.build}:${r.source}:${r.capture}`)).toEqual([
      '2.1.320:fleet:queued', '2.1.318:fleet:queued', '2.1.302:rig:pass', '2.1.301:rig:pass', '2.1.300:rig:pass', '2.1.296:rig:pass',
    ]);
  });

  it('a new build is recorded and sent on the first pass, newest first, one job at a time', async () => {
    const t = fake(pass);
    const s = await setup(t);
    await s.lane.sweep(['2.1.318', '2.1.320']);
    expect(t.jobs).toEqual(['2.1.320']);
    expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'pass', cwd: true, attempts: 1, output: 'replay: 40 passed' });
    expect(buildTrustOf(s.coord.claudeBuilds(), '2.1.320')).toEqual({ kind: 'trusted', cwd: true });
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.318', '2.1.320']);
    expect(t.jobs).toEqual(['2.1.320', '2.1.318']);
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.318', '2.1.320']);
    expect(t.jobs, 'nothing left to capture').toHaveLength(2);
  });

  it('its own clock: a second pass inside the minute sends nothing, and two passes never overlap', async () => {
    let release: () => void = () => undefined;
    const t = fake((job) => new Promise((r) => { release = () => r(pass(job)); }));
    const s = await setup(t);
    const first = s.lane.sweep(['2.1.320', '2.1.321']);
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.320', '2.1.321']);
    expect(t.jobs).toEqual(['2.1.321']);
    release();
    await first;
    const third = s.lane.sweep(['2.1.320', '2.1.321']);
    expect(t.jobs, 'the skipped pass took no slot').toEqual(['2.1.321', '2.1.320']);
    release();
    await third;
    await s.lane.sweep(['2.1.320', '2.1.321']);
    expect(t.jobs, 'inside the minute of the last pass').toHaveLength(2);
  });

  it('a failure is captured again by itself, an hour and then two later; only the third raises one push notice that opens Settings (slug capture-retry-ceiling)', async () => {
    const t = fake(fail);
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', cwd: false, output: 'replay: 1 failed\nStop: missing field', fails: 1 });
    expect(buildTrustOf(s.coord.claudeBuilds(), '2.1.321')).toEqual({ kind: 'untrusted', reason: 'capture-failed' });
    expect(s.notices, 'a failure ccrc will retry tells nobody').toHaveLength(0);
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs, 'inside the spacing').toHaveLength(1);
    s.tick(captureRetryAfterMs(1) - BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs).toEqual(['2.1.321', '2.1.321']);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', fails: 2, attempts: 2 });
    expect(s.notices).toHaveLength(0);
    s.tick(captureRetryAfterMs(2) - BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs, 'the second spacing is two hours').toHaveLength(2);
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs).toHaveLength(BUILD_CAPTURE_FAIL_CEILING);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', fails: 3, attempts: 3 });
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toMatchObject({ title: 'Claude Code 2.1.321 failed its capture 3 times' });
    s.tick(100 * BUILD_CAPTURE_RETRY_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs, 'given up: nothing more by itself').toHaveLength(BUILD_CAPTURE_FAIL_CEILING);
    expect(s.notices).toHaveLength(1);
  });

  it('a failure the retry turns into a pass is trusted, and nobody was told', async () => {
    const answers = [fail, pass];
    const t = fake((job) => answers.shift()!(job));
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    s.tick(captureRetryAfterMs(1));
    await s.lane.sweep(['2.1.321']);
    expect(buildTrustOf(s.coord.claudeBuilds(), '2.1.321')).toEqual({ kind: 'trusted', cwd: true });
    expect(row(s.coord, '2.1.321')).toMatchObject({ fails: 1, attempts: 2 });
    expect(s.notices).toHaveLength(0);
  });

  it('the operator\'s Capture again past the ceiling restarts the ladder: its next failure is retried by itself, and nobody is told again (review 3234 F6)', async () => {
    const t = fake(fail);
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    for (let k = 1; k < BUILD_CAPTURE_FAIL_CEILING; k++) { s.tick(captureRetryAfterMs(k)); await s.lane.sweep(['2.1.321']); }
    expect(s.notices).toHaveLength(1);
    expect(s.coord.requeueClaudeBuild('2.1.321')).toBe('queued');
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs).toHaveLength(BUILD_CAPTURE_FAIL_CEILING + 1);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', fails: 1, attempts: 4 });
    expect(s.notices).toHaveLength(1);
    s.tick(captureRetryAfterMs(1));
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs, 'back on the ladder: retried by itself').toHaveLength(BUILD_CAPTURE_FAIL_CEILING + 2);
  });

  it('the operator\'s Capture again on a build still being retried that fails again tells nobody (review 3234 F17)', async () => {
    const t = fake(fail);
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', fails: 1 });
    expect(s.coord.requeueClaudeBuild('2.1.321')).toBe('queued');
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs).toHaveLength(2);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', fails: 1 });
    expect(s.notices).toHaveLength(0);
  });

  it('a retry that gets no verdict keeps the count and the last output, and falls back to the queued hour (review 3234 F12, F17)', async () => {
    const answers: ((job: BuildCaptureJob) => BuildCaptureAnswer)[] = [fail, () => ({ kind: 'unavailable', why: 'no-test-box' }), fail];
    const t = fake((job) => answers.shift()!(job));
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    s.tick(captureRetryAfterMs(1));
    await s.lane.sweep(['2.1.321']);
    expect(row(s.coord, '2.1.321')).toMatchObject({
      capture: 'queued', fails: 1, notSent: 'no-test-box', lastAttemptAt: s.now(), output: 'replay: 1 failed\nStop: missing field',
    });
    s.tick(BUILD_CAPTURE_RETRY_MS - BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs, 'inside the queued hour').toHaveLength(2);
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs).toHaveLength(3);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', fails: 2 });
    expect(s.notices).toHaveLength(0);
  });

  it('a build no session runs any more is not retried, and gives up quietly: no push and no item (review 3234 F5)', async () => {
    const t = fake(fail);
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    s.tick(100 * BUILD_CAPTURE_RETRY_MS);
    await s.lane.sweep(['2.1.322']);
    expect(t.jobs.filter((b) => b === '2.1.321'), 'rolled past: not captured again').toHaveLength(1);
    // A build that reaches the ceiling with no session on it says nothing either.
    s.coord.noteClaudeBuildsSeen(['2.1.330'], s.now());
    for (let k = 0; k < BUILD_CAPTURE_FAIL_CEILING; k++) {
      if (k > 0) s.coord.requeueClaudeBuild('2.1.330', { keepLadder: true });
      s.coord.recordClaudeBuildVerdict({ build: '2.1.330', pass: false, cwd: false, output: 'red' }, s.now());
    }
    expect(row(s.coord, '2.1.330')).toMatchObject({ capture: 'fail', fails: BUILD_CAPTURE_FAIL_CEILING });
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.322']);
    expect(s.notices).toHaveLength(0);
    expect(buildItems(s.coord, s.now())).toEqual([]);
  });

  it('each pass raises the item a given-up build a session runs is missing, once (review 3234 F11)', async () => {
    const s = await setup(fake(pass));
    s.coord.noteClaudeBuildsSeen(['2.1.330'], s.now());
    for (let k = 0; k < BUILD_CAPTURE_FAIL_CEILING; k++) {
      if (k > 0) s.coord.requeueClaudeBuild('2.1.330', { keepLadder: true });
      s.coord.recordClaudeBuildVerdict({ build: '2.1.330', pass: false, cwd: false, output: 'red' }, s.now());
    }
    expect(buildItems(s.coord, s.now()), 'the verdict was written past the lane (a lost raise)').toEqual([]);
    await s.lane.sweep(['2.1.330']);
    expect(buildItems(s.coord, s.now()).map((i) => i.action)).toEqual([{ verb: 'untrusted-build', build: '2.1.330' }]);
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.330']);
    expect(buildItems(s.coord, s.now())).toHaveLength(1);
    expect(s.notices, 'the push belongs to the verdict that gives up').toHaveLength(0);
  });

  it('no verdict (a throw, an answer off its shape) keeps the build queued, counts the job sent, and waits the retry spacing', async () => {
    const answers: (BuildCaptureAnswer | 'throw')[] = ['throw', { kind: 'answered', result: { build: '2.1.320', pass: 'yes' } }, { kind: 'unavailable', why: 'unanswered' }];
    const t = fake(() => { const a = answers.shift(); if (a === 'throw' || a === undefined) throw new Error('link down'); return a; });
    const s = await setup(t);
    for (let i = 0; i < 3; i++) {
      await s.lane.sweep(['2.1.320']);
      expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'queued', attempts: i + 1, notSent: null, lastAttemptAt: s.now() });
      s.tick(BUILD_CAPTURE_SWEEP_MS);
      await s.lane.sweep(['2.1.320']);
      expect(t.jobs, 'inside the retry spacing').toHaveLength(i + 1);
      s.tick(BUILD_CAPTURE_RETRY_MS);
    }
    expect(buildTrustOf(s.coord.claudeBuilds(), '2.1.320')).toEqual({ kind: 'untrusted', reason: 'capture-queued' });
    expect(s.notices, 'no verdict is not a failure').toHaveLength(0);
  });

  it('a transport that sends nothing (no test box, no runner) counts no attempt: it stamps the retry clock and says why', async () => {
    const t = fake(() => ({ kind: 'unavailable', why: 'no-runner' }));
    const s = await setup(t);
    await s.lane.sweep(['2.1.320']);
    expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'queued', attempts: 0, lastAttemptAt: s.now(), notSent: 'no-runner' });
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.320']);
    expect(t.jobs, 'the retry clock still spaces the tries').toHaveLength(1);
    s.tick(BUILD_CAPTURE_RETRY_MS);
    t.capture = async (job) => { t.jobs.push(job.build); return pass(job); };
    await s.lane.sweep(['2.1.320']);
    expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'pass', attempts: 1, notSent: null });
  });

  it('a day on the production transport with no runner: every build says it was not sent, and none counts a job', async () => {
    let asked: CaptureAsked = { ok: false, reason: 'no-op' };
    const s = await setup(testboxCaptureTransport(() => ({ testboxCapture: async () => asked })));
    for (let m = 0; m < 24 * 60; m++) { await s.lane.sweep(['2.1.318', '2.1.320']); s.tick(BUILD_CAPTURE_SWEEP_MS); }
    for (const b of ['2.1.318', '2.1.320']) expect(row(s.coord, b)).toMatchObject({ capture: 'queued', attempts: 0, notSent: 'no-runner' });
    expect(captureBlockedBy(s.coord.claudeBuilds())).toBe('no-runner');
    asked = { ok: true, reply: { outcome: 'unconfigured', refusal: null, result: null, detail: null } };
    s.tick(BUILD_CAPTURE_RETRY_MS);
    await s.lane.sweep(['2.1.318', '2.1.320']);
    expect(captureBlockedBy(s.coord.claudeBuilds())).toBe('no-test-box');
  });
});

// Capture runner spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.2, D7: a box that holds no checked
// copy of the build refuses it `build-absent`; the pass then copies the fleet's own copy and sends the capture again. The
// rule is `captureNextAct`'s; the lane only carries it out. The copier here is a FAKE: nothing reaches a box.
describe('the copy after a build-absent refusal (spec §2.2, D7)', () => {
  function copier(answer: () => BuildCopyAnswer | Promise<BuildCopyAnswer>): BuildCopyTransport & { copies: string[] } {
    const copies: string[] = [];
    return { copies, copy: async (job) => { copies.push(job.build); return answer(); } };
  }
  /** A box that answers `build-absent` until the copy placed the build, then `then`. */
  function boxOf(c: { copies: string[] }, then: (job: BuildCaptureJob) => BuildCaptureAnswer = pass) {
    return fake((job) => (c.copies.length === 0 ? { kind: 'unavailable', why: 'build-absent' } : then(job)));
  }

  it('build-absent, then the copy, then the capture again in the same pass: its verdict lands, and one job counts', async () => {
    const c = copier(() => 'copied');
    const t = boxOf(c);
    const s = await setup(t, c);
    await s.lane.sweep(['2.1.320']);
    expect(t.jobs).toEqual(['2.1.320', '2.1.320']);
    expect(c.copies).toEqual(['2.1.320']);
    expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'pass', attempts: 1, notSent: null });
  });

  it('a box that holds the build is never copied', async () => {
    const c = copier(() => 'copied');
    const t = fake(pass);
    const s = await setup(t, c);
    await s.lane.sweep(['2.1.320']);
    expect(c.copies).toEqual([]);
    expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'pass' });
  });

  it('after the copy the box still has no runner (PR 2 on the box): recorded no-runner, no attempt counted', async () => {
    const c = copier(() => 'copied');
    const s = await setup(boxOf(c, () => ({ kind: 'unavailable', why: 'no-runner' })), c);
    await s.lane.sweep(['2.1.320']);
    expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'queued', attempts: 0, notSent: 'no-runner', lastAttemptAt: s.now() });
  });

  it.each(['copy-refused', 'copy-failed', 'no-admin-lane'] as const)(
    'a copy that answers %s sends nothing more; the row records that word, counts no attempt, and keeps no verdict', async (w) => {
      const c = copier(() => w);
      const t = boxOf(c);
      const s = await setup(t, c);
      await s.lane.sweep(['2.1.320']);
      expect(t.jobs).toEqual(['2.1.320']);
      expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'queued', attempts: 0, notSent: w, verdictAt: null });
    });

  it('a copier that throws reads as copy-failed', async () => {
    const c = copier(() => { throw new Error('boom'); });
    const s = await setup(boxOf(c), c);
    await s.lane.sweep(['2.1.320']);
    expect(row(s.coord, '2.1.320')).toMatchObject({ attempts: 0, notSent: 'copy-failed' });
  });

  it('with no copier the refusal is answered no-admin-lane, and nothing is sent again', async () => {
    const t = fake(() => ({ kind: 'unavailable', why: 'build-absent' }));
    const s = await setup(t);
    await s.lane.sweep(['2.1.320']);
    expect(t.jobs).toEqual(['2.1.320']);
    expect(row(s.coord, '2.1.320')).toMatchObject({ attempts: 0, notSent: 'no-admin-lane' });
  });

  it('a box still answering build-absent after the copy: one copy a pass, two sends, recorded build-absent; the next pass waits the spacing', async () => {
    const c = copier(() => 'copied');
    const t = fake(() => ({ kind: 'unavailable', why: 'build-absent' }));
    const s = await setup(t, c);
    await s.lane.sweep(['2.1.320']);
    expect([t.jobs.length, c.copies.length]).toEqual([2, 1]);
    expect(row(s.coord, '2.1.320')).toMatchObject({ attempts: 0, notSent: 'build-absent' });
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.320']);
    expect([t.jobs.length, c.copies.length], 'the retry clock spaces the next pass').toEqual([2, 1]);
  });

  it.each(['path-refused', 'not-started', 'busy', 'no-test-box'] as const)('a box that refuses %s is not copied to, and the row says that word', async (w) => {
    const c = copier(() => 'copied');
    const s = await setup(fake(() => ({ kind: 'unavailable', why: w })), c);
    await s.lane.sweep(['2.1.320']);
    expect(c.copies).toEqual([]);
    expect(row(s.coord, '2.1.320')).toMatchObject({ attempts: 0, notSent: w });
  });
});
