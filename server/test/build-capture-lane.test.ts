// D-8289 (plan docs/superpowers/plans/2026-11-11-new-build-capture.md): the capture queue. Each pass records a row for every
// build a session runs that has none (a new build and the backfill alike), sends at most one job, newest build first,
// through the test box transport, and lands its verdict. A failure stays untrusted and raises one notice. The transport here
// is a FAKE: nothing reaches a test box, and no Claude Code runs.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  BUILD_CAPTURE_SWEEP_MS, BuildCaptureLane, testboxCaptureTransport, type BuildCaptureAnswer, type BuildCaptureTransport,
} from '../src/buildCaptureLane.js';
import type { TestboxBlock } from '../src/testbox.js';
import { BUILD_CAPTURE_RETRY_MS, buildTrustOf, type BuildCaptureJob } from '../../shared/claudeBuildTrust.js';
import type { NotifyEvent } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

/** A fake transport: answers what the row hands it, and records every job. */
function fake(answer: (job: BuildCaptureJob) => BuildCaptureAnswer | Promise<BuildCaptureAnswer>): BuildCaptureTransport & { jobs: string[] } {
  const jobs: string[] = [];
  return { jobs, capture: async (job) => { jobs.push(job.build); return answer(job); } };
}
const pass = (job: BuildCaptureJob): BuildCaptureAnswer => ({ kind: 'answered', result: { build: job.build, pass: true, cwd: true, output: 'replay: 40 passed' } });
const fail = (job: BuildCaptureJob): BuildCaptureAnswer => ({ kind: 'answered', result: { build: job.build, pass: false, cwd: true, output: 'replay: 1 failed\nStop: missing field' } });

async function setup(transport: BuildCaptureTransport | undefined) {
  const home = mkTmp('ccrc-capture-lane-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const notices: NotifyEvent[] = [];
  const record = notifyLog.record.bind(notifyLog);
  notifyLog.record = (e) => { const ev = record(e); if (ev.kind === 'coord') notices.push(ev); return ev; };
  let clock = 1_000_000_000_000;
  const lane = new BuildCaptureLane(() => ({ coord, notifyLog, ...(transport === undefined ? {} : { buildCapture: transport }) }), () => clock);
  return { coord, notices, lane, tick: (ms: number) => { clock += ms; }, now: () => clock };
}
const row = (coord: CoordStore, build: string) => coord.claudeBuilds().find((r) => r.build === build);

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

  it('a failure stays untrusted and raises one push notice that opens Settings; a later pass raises none', async () => {
    const t = fake(fail);
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', cwd: false, output: 'replay: 1 failed\nStop: missing field' });
    expect(buildTrustOf(s.coord.claudeBuilds(), '2.1.321')).toEqual({ kind: 'untrusted', reason: 'capture-failed' });
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toMatchObject({ title: 'Claude Code 2.1.321 failed its capture' });
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs).toEqual(['2.1.321']);
    expect(s.notices).toHaveLength(1);
  });

  it('the operator\'s re-capture sends the build again, and a second failure raises a second notice', async () => {
    const t = fake(fail);
    const s = await setup(t);
    await s.lane.sweep(['2.1.321']);
    expect(s.coord.requeueClaudeBuild('2.1.321')).toBe('queued');
    s.tick(BUILD_CAPTURE_SWEEP_MS);
    await s.lane.sweep(['2.1.321']);
    expect(t.jobs).toEqual(['2.1.321', '2.1.321']);
    expect(row(s.coord, '2.1.321')).toMatchObject({ capture: 'fail', attempts: 2 });
    expect(s.notices).toHaveLength(2);
  });

  it('no verdict (the box unavailable, a throw, an answer off its shape) keeps the build queued and waits the retry spacing', async () => {
    const answers: (BuildCaptureAnswer | 'throw')[] = [{ kind: 'unavailable', why: 'no-runner' }, 'throw', { kind: 'answered', result: { build: '2.1.320', pass: 'yes' } }];
    const t = fake(() => { const a = answers.shift(); if (a === 'throw' || a === undefined) throw new Error('link down'); return a; });
    const s = await setup(t);
    for (let i = 0; i < 3; i++) {
      await s.lane.sweep(['2.1.320']);
      expect(row(s.coord, '2.1.320')).toMatchObject({ capture: 'queued', attempts: i + 1 });
      s.tick(BUILD_CAPTURE_SWEEP_MS);
      await s.lane.sweep(['2.1.320']);
      expect(t.jobs, 'inside the retry spacing').toHaveLength(i + 1);
      s.tick(BUILD_CAPTURE_RETRY_MS);
    }
    expect(buildTrustOf(s.coord.claudeBuilds(), '2.1.320')).toEqual({ kind: 'untrusted', reason: 'capture-queued' });
    expect(s.notices, 'no verdict is not a failure').toHaveLength(0);
  });
});

describe('testboxCaptureTransport: the job over the test box connection (D-8289)', () => {
  const block = (state: TestboxBlock['state']): TestboxBlock => ({
    state, reasons: [], summary: state, switch: 'off', at: 1, host: null, box: null, cells: [], counts: null,
  });
  it('answers no-test-box while no box answers, and no-runner otherwise: nothing is sent and nothing is judged', async () => {
    for (const s of ['off', 'down', 'unreachable'] as const) {
      expect(await testboxCaptureTransport(() => block(s)).capture({ build: '2.1.320' })).toEqual({ kind: 'unavailable', why: 'no-test-box' });
    }
    expect(await testboxCaptureTransport(() => null).capture({ build: '2.1.320' })).toEqual({ kind: 'unavailable', why: 'no-test-box' });
    for (const s of ['ok', 'degraded'] as const) {
      expect(await testboxCaptureTransport(() => block(s)).capture({ build: '2.1.320' })).toEqual({ kind: 'unavailable', why: 'no-runner' });
    }
  });
});
