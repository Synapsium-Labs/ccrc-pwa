// The delivery recipe's capture lane (Desktop polish wave 178): after the trust part, and only when the pass sent no trust job,
// at most ONE delivery job goes out through the same transport; its result lands in `claude_build_deliveries` when the one
// reader accepts it and the recipe calls it current, and it NEVER touches a trust row. Also the transport's delivery rows, the
// remote arm's frame, and the build list's `deliveries` read. The transport is a FAKE: nothing reaches a test box.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { BUILD_CAPTURE_SWEEP_MS, BuildCaptureLane, type BuildCaptureAnswer, type BuildCaptureTransport } from '../src/buildCaptureLane.js';
import { testboxCaptureTransport } from '../src/testboxCapture.js';
import type { CaptureAsked } from '../src/io.js';
import { DELIVERY_BAD_REQUEST_DETAIL, createIo } from '../src/remote/io.js';
import { AgentOpError } from '../src/remote/errors.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { Bus } from '../src/bus.js';
import type { Deps } from '../src/server.js';
import type { GateDecision } from '../src/auth/gate.js';
import { BUILD_CAPTURE_RETRY_MS, buildTrustOf, readClaudeBuildRecords, type BuildCaptureJob } from '../../shared/claudeBuildTrust.js';
import { DELIVERY_PART_COUNT, readDeliveryStandingAnswer, readDeliveryViews, type DeliveryCaptureResult } from '../../shared/deliveryResult.js';
import { nextDeliveryJob } from '../../shared/deliveryLane.js';
import { TESTBOX_CAPTURE_OP, TESTBOX_CAPTURE_REQUEST_MS, type TestboxCaptureReply } from '../../shared/agent-protocol.js';
import { testDeps } from './helpers.js';
import { deliveryResultFor } from './deliveryLaneHelpers.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

// ONE migrated coord.db for the file (review 3882 A7): opening a store runs every migration, which took 6 to 13 s a case on
// the loaded box (36 cases, 152 s together), so each case copies a template migrated once. A fresh warn spy per case, restored
// after it, and every pass a case started is settled before the case ends, so a case that fails or times out can never leave
// its warning to the next ("warn called 2 times").
let template = '';
const opened: CoordStore[] = [];
const started: Promise<unknown>[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-delivery-lane-template-'), 'coord.db');
  openCoordDb(template).close();
});
removeTmpFixturesEachTest(); // the template, made in beforeAll, is older than any case's mark and stays until the file ends
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(async () => {
  await Promise.allSettled(started.splice(0));
  for (const o of opened.splice(0)) { try { o.db.close(); } catch { /* already closed */ } }
  vi.restoreAllMocks();
});
/** A store over a copy of the migrated template, closed after the case. */
function freshStore(home: string): CoordStore {
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  copyFileSync(template, path.join(home, '.ccrc', 'coord.db'));
  const c = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  opened.push(c);
  return c;
}

type Answer = BuildCaptureAnswer | Promise<BuildCaptureAnswer>;
/** A fake transport: records every full job, answers what the row hands it. */
function fake(answer: (job: BuildCaptureJob) => Answer): BuildCaptureTransport & { jobs: BuildCaptureJob[] } {
  const jobs: BuildCaptureJob[] = [];
  return { jobs, capture: async (job) => { jobs.push(job); return answer(job); } };
}
const trustPass = (job: BuildCaptureJob): BuildCaptureAnswer => ({ kind: 'answered', result: { build: job.build, pass: true, cwd: true, output: 'replay: 40 passed' } });
const intact = (job: BuildCaptureJob): BuildCaptureAnswer =>
  job.recipe === 'delivery' ? { kind: 'answered', result: deliveryResultFor(job.build, job.part!) } : trustPass(job);

async function setup(transport: BuildCaptureTransport) {
  const home = mkTmp('ccrc-delivery-lane-');
  const coord = freshStore(home);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  let clock = 1_000_000_000_000;
  const lane = new BuildCaptureLane(() => ({ coord, notifyLog, buildCapture: transport }), () => clock);
  const pass = (versions: (string | null)[] = []): Promise<void> => {
    clock += BUILD_CAPTURE_SWEEP_MS;
    const run = lane.sweep(versions);
    started.push(run);
    return run;
  };
  return { coord, lane, pass, tick: (ms: number) => { clock += ms; }, now: () => clock };
}
const warned = (): string[] => (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
// The rig's newest passed build; a fresh store trusts it, so a pass with no live build sends a delivery job for it.
const RIG = '2.1.302';

describe('the lane sends one delivery job after the trust part', () => {
  it('trust first: a queued build takes the pass, and the delivery job waits for the pass after its verdict', async () => {
    const t = fake(intact);
    const s = await setup(t);
    await s.pass(['2.1.320']);
    expect(t.jobs).toEqual([{ build: '2.1.320' }]);
    expect(s.coord.claudeBuildDeliveries()).toEqual([]);
    await s.pass(['2.1.320']);
    expect(t.jobs[1]).toEqual({ build: '2.1.320', recipe: 'delivery', part: 0 });
  });

  it('a queued build that is not due does not hold delivery back: the pass sends the newest passed build\'s part (call 1145 point 2b)', async () => {
    // The trust job for 2.1.320 goes out and comes back unanswered: one counted attempt, so the build stays queued, not due for
    // the hour. The next pass sends no trust job, and the delivery job for the passed build goes out.
    const t = fake((job) => (job.recipe === 'delivery' ? intact(job) : { kind: 'unavailable', why: 'unanswered' }));
    const s = await setup(t);
    await s.pass(['2.1.320']);
    expect(t.jobs).toEqual([{ build: '2.1.320' }]);
    expect(s.coord.claudeBuilds().find((r) => r.build === '2.1.320')).toMatchObject({ capture: 'queued', attempts: 1 });
    await s.pass(['2.1.320']);
    expect(t.jobs).toEqual([{ build: '2.1.320' }, { build: RIG, recipe: 'delivery', part: 0 }]);
  });

  it('a queued build that is due takes the pass: the trust job goes out and no delivery job with it', async () => {
    const t = fake((job) => (job.recipe === 'delivery' ? intact(job) : { kind: 'unavailable', why: 'unanswered' }));
    const s = await setup(t);
    await s.pass(['2.1.320']);
    await s.pass(['2.1.320']);
    expect(t.jobs).toHaveLength(2);
    s.tick(BUILD_CAPTURE_RETRY_MS);
    await s.pass(['2.1.320']);
    expect(t.jobs).toHaveLength(3);
    expect(t.jobs[2]).toEqual({ build: '2.1.320' });
  });

  it('at most one capture a pass, the parts in order, then nothing once the newest passed build is complete', async () => {
    const t = fake(intact);
    const s = await setup(t);
    for (let i = 0; i < DELIVERY_PART_COUNT + 2; i++) await s.pass();
    expect(t.jobs).toEqual(Array.from({ length: DELIVERY_PART_COUNT }, (_, part) => ({ build: RIG, recipe: 'delivery', part })));
    expect(s.coord.claudeBuildDeliveries().map((r) => `${r.part}:${r.word}:${r.attempts}`)).toEqual(
      Array.from({ length: DELIVERY_PART_COUNT }, (_, p) => `${p}:intact:1`));
  });

  it('at most one delivery capture in flight for a box: a sweep while one is out sends nothing', async () => {
    let release: () => void = () => undefined;
    const t = fake((job) => new Promise((r) => { release = () => r(intact(job)); }));
    const s = await setup(t);
    const first = s.pass();
    try {
      await s.pass();
      await s.pass();
      expect(t.jobs).toHaveLength(1);
    } finally {
      release(); // cancels the held job whatever the assertions say, so the pass can end before the case does
    }
    await first;
    expect(s.coord.claudeBuildDeliveries()).toHaveLength(1);
  });

  it('a delivery result never touches a trust row, whatever its word', async () => {
    const t = fake((job) => ({ kind: 'answered', result: deliveryResultFor(job.build, job.part!, 'altered') }));
    const s = await setup(t);
    const before = JSON.stringify(s.coord.claudeBuilds());
    const items = s.coord.claudeBuilds().length;
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ build: RIG, part: 0, word: 'fault' });
    expect(JSON.stringify(s.coord.claudeBuilds())).toBe(before);
    expect(s.coord.claudeBuilds()).toHaveLength(items);
    expect(buildTrustOf(s.coord.claudeBuilds(), RIG)).toEqual({ kind: 'trusted', cwd: true });
  });
});

describe('what each answer comes to', () => {
  it('a current result is stored', async () => {
    const s = await setup(fake(intact));
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ part: 0, word: 'intact', attempts: 1, notSent: null });
  });

  it('a refused attempt stamp ends the pass before anything is recorded (call 1253, condition 1)', async () => {
    const s = await setup(fake(intact));
    vi.spyOn(s.coord, 'markDeliveryAttempt').mockReturnValue(false);
    const record = vi.spyOn(s.coord, 'recordDelivery');
    await s.pass();
    expect(record).not.toHaveBeenCalled();
    expect(s.coord.claudeBuildDeliveries()).toEqual([]);
  });

  it('a refused record is one log line', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = await setup(fake(intact));
    vi.spyOn(s.coord, 'recordDelivery').mockReturnValue(false);
    await s.pass();
    expect(warned()).toEqual([expect.stringMatching(/^ccrc-server: delivery capture: the result for \S+ part 0 could not be stored/)]);
  });

  it('another recipe\'s version: the attempt is stamped, no row, asked again after the spacing', async () => {
    const t = fake((job) => ({ kind: 'answered', result: deliveryResultFor(job.build, job.part!, 'intact', '0123456789abcdef') }));
    const s = await setup(t);
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ part: 0, attempts: 1, word: null, result: null });
    await s.pass();
    expect(t.jobs, 'within the spacing').toHaveLength(1);
    s.tick(BUILD_CAPTURE_RETRY_MS);
    await s.pass();
    expect(t.jobs).toHaveLength(2);
    expect(t.jobs[1]).toMatchObject({ part: 0 });
  });

  it('a contradiction: the attempt is stamped, no row, one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = fake((job) => {
      const r = deliveryResultFor(job.build, job.part!);
      const cut: DeliveryCaptureResult = { ...r, cases: r.cases.slice(1) };
      return { kind: 'answered', result: cut };
    });
    const s = await setup(t);
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, result: null });
    expect(warned().filter((l) => l.startsWith('ccrc-server: delivery capture:'))).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an answer off the result\'s shape: one line, the attempt counted, no row', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = await setup(fake(() => ({ kind: 'answered', result: { recipe: 'delivery' } })));
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, result: null });
    expect(warned()).toEqual([expect.stringMatching(/^ccrc-server: delivery capture: the answer for \S+ part 0 is not a delivery result/)]);
  });

  it('a build-trust shaped answer to a delivery job is no result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = await setup(fake(trustPass));
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, result: null });
  });

  it('unanswered, and a throw: one counted attempt, spaced by the hour', async () => {
    for (const answer of [(): Answer => ({ kind: 'unavailable', why: 'unanswered' }), (): Answer => Promise.reject(new Error('boom'))]) {
      const t = fake(answer);
      const s = await setup(t);
      await s.pass();
      expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 1, notSent: null, result: null });
      await s.pass();
      expect(t.jobs).toHaveLength(1);
      s.tick(BUILD_CAPTURE_RETRY_MS);
      await s.pass();
      expect(t.jobs).toHaveLength(2);
    }
  });

  it('a not-sent word stamps the try only: no attempt counted, the why recorded', async () => {
    const s = await setup(fake(() => ({ kind: 'unavailable', why: 'busy' })));
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 0, notSent: 'busy' });
  });

  it('a box that is not taking the frame (not-taken) folds to not-sent with one log line naming the cause, and counts no attempt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const io = { testboxCapture: async (): Promise<CaptureAsked> => ({ ok: true, reply: { outcome: 'not-taken', refusal: null, result: null, detail: null, delivery: null } }) };
    const s = await setup(testboxCaptureTransport(() => io));
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 0, notSent: 'recipe-not-run', result: null });
    expect(warned().filter((l) => l.includes('closed the connection on the delivery frame'))).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  // ONE LINE, WITH WHAT WAS MEASURED (review 3898 F6): the test box's own refusal of the frame carries its detail; the
  // transport logs nothing for it, and the lane's one line says it.
  it('a box that refused the frame, with its detail: exactly one line, the lane\'s, saying what the box said', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const io = { testboxCapture: async (): Promise<CaptureAsked> => ({ ok: true, reply: { outcome: 'not-taken', refusal: null, result: null, detail: 'the box refused the frame: not a recipe this box runs', delivery: null } }) };
    const s = await setup(testboxCaptureTransport(() => io));
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 0, notSent: 'recipe-not-run', result: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warned()[0]).toMatch(/^ccrc-server: delivery capture: .* part 0: not sent: the box refused the frame: not a recipe this box runs; /);
  });

  it('a box that was not reached stays no-test-box, with no recipe line: a reader can tell the two apart', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const io = { testboxCapture: async (): Promise<CaptureAsked> => ({ ok: true, reply: { outcome: 'unreachable', refusal: null, result: null, detail: null, delivery: null } }) };
    const s = await setup(testboxCaptureTransport(() => io));
    await s.pass();
    expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ attempts: 0, notSent: 'no-test-box' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the transport carries a delivery job', () => {
  const BUILD = '2.1.320';
  const R = deliveryResultFor(BUILD, 1);
  const reply = (over: Partial<TestboxCaptureReply>): CaptureAsked => ({ ok: true, reply: { outcome: 'answered', refusal: null, result: null, detail: null, delivery: null, ...over } });
  const run = (asked: CaptureAsked) => {
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => asked);
    return { testboxCapture, answer: testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD, recipe: 'delivery', part: 1 }) };
  };
  it('asks with the recipe and the part, and hands the delivery result on unread', async () => {
    const r = run(reply({ delivery: R }));
    expect(await r.answer).toEqual({ kind: 'answered', result: R });
    expect(r.testboxCapture).toHaveBeenCalledExactlyOnceWith(BUILD, 'delivery', 1);
  });
  it('an answer with no delivery result is unanswered, and its detail is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run(reply({ delivery: null, detail: 'no verdict' })).answer).toEqual({ kind: 'unavailable', why: 'unanswered' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('a delivery result is not logged as dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await run(reply({ delivery: R, detail: 'kept' })).answer;
    expect(warn).not.toHaveBeenCalled();
  });
  it('the other rows read as they do for a trust job', async () => {
    expect(await run(reply({ outcome: 'unreachable' })).answer).toEqual({ kind: 'unavailable', why: 'no-test-box' });
    expect(await run(reply({ outcome: 'refused', refusal: 'no-runner' })).answer).toEqual({ kind: 'unavailable', why: 'no-runner' });
    expect(await run(reply({ outcome: 'refused', refusal: 'build-absent' })).answer).toEqual({ kind: 'unavailable', why: 'build-absent' });
    expect(await run({ ok: false, reason: 'busy' }).answer).toEqual({ kind: 'unavailable', why: 'busy' });
  });
  it('not-taken is the delivery lane\'s own word for a delivery job, and no-runner for a trust job, byte for byte', async () => {
    expect(await run(reply({ outcome: 'not-taken' })).answer).toEqual({ kind: 'unavailable', why: 'recipe-not-run' });
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => reply({ outcome: 'not-taken' }));
    expect(await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD })).toEqual({ kind: 'unavailable', why: 'no-runner' });
  });
  it('a trust job still asks for the build alone', async () => {
    const testboxCapture = vi.fn(async (): Promise<CaptureAsked> => ({ ok: false, reason: 'no-op' }));
    await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD });
    expect(testboxCapture).toHaveBeenCalledExactlyOnceWith(BUILD);
  });
});

describe('the remote arm sends the recipe and the part for a delivery ask only', () => {
  const BUILD = '2.1.320';
  const R = deliveryResultFor(BUILD, 2);
  const GOOD = { outcome: 'answered', refusal: null, result: null, detail: null, delivery: R };
  it('the frame names recipe and part, and the reply is read as a delivery reply', async () => {
    const request = vi.fn(async () => GOOD);
    const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request } as never);
    expect(await io.testboxCapture(BUILD, 'delivery', 2)).toEqual({ ok: true, reply: GOOD });
    expect(request).toHaveBeenCalledExactlyOnceWith({ t: 'req', op: TESTBOX_CAPTURE_OP, build: BUILD, recipe: 'delivery', part: 2 }, TESTBOX_CAPTURE_REQUEST_MS);
  });
  it('a reply for another part is unanswered', async () => {
    const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request: async () => GOOD } as never);
    expect(await io.testboxCapture(BUILD, 'delivery', 1)).toEqual({ ok: false, reason: 'unanswered' });
  });
  it('a delivery ask with no part is never sent: not-started, no job went out (the member\'s arguments leave it only an untyped caller)', async () => {
    const request = vi.fn();
    const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request } as never);
    const untyped = io.testboxCapture as (build: string, recipe?: 'delivery', part?: number) => Promise<CaptureAsked>;
    expect(await untyped(BUILD, 'delivery')).toEqual({ ok: false, reason: 'not-started' });
    expect(request).not.toHaveBeenCalled();
    const testboxCapture = vi.fn();
    expect(await testboxCaptureTransport(() => ({ testboxCapture })).capture({ build: BUILD, recipe: 'delivery' })).toEqual({ kind: 'unavailable', why: 'not-started' });
    expect(testboxCapture).not.toHaveBeenCalled();
  });
  describe('an older fleet agent that lists the op but predates the recipe fields (review 3882 A1)', () => {
    const old = () => new AgentOpError('bad-request', null);
    it('a delivery job answered bad-request is not-taken, with one log line saying what was measured and the likely cause', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const request = vi.fn(async () => { throw old(); });
      const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request } as never);
      expect(await io.testboxCapture(BUILD, 'delivery', 0)).toEqual({
        ok: true, reply: { outcome: 'not-taken', refusal: null, result: null, detail: DELIVERY_BAD_REQUEST_DETAIL, delivery: null },
      });
      expect(request).toHaveBeenCalledTimes(1);
      // The arm logs nothing: it hands what it measured to the lane, which writes the one line (review 3898 F6).
      expect(warn).not.toHaveBeenCalled();
      expect(DELIVERY_BAD_REQUEST_DETAIL).toMatch(/^the fleet agent answered bad-request to a delivery job \(likely an agent older/);
    });
    it('a trust job answered bad-request is still unanswered, with no line', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request: async () => { throw old(); } } as never);
      expect(await io.testboxCapture(BUILD)).toEqual({ ok: false, reason: 'unanswered' });
      expect(warn).not.toHaveBeenCalled();
    });
    it('any other agent error on a delivery job is still unanswered', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request: async () => { throw new AgentOpError('forbidden', null); } } as never);
      expect(await io.testboxCapture(BUILD, 'delivery', 0)).toEqual({ ok: false, reason: 'unanswered' });
    });
    it('through the lane: the part is recipe-not-run, no attempt is counted, and exactly one line names the fleet agent, not the test box', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request: async () => { throw old(); } } as never);
      const s = await setup(testboxCaptureTransport(() => io));
      await s.pass();
      expect(s.coord.claudeBuildDeliveries()[0]).toMatchObject({ part: 0, attempts: 0, notSent: 'recipe-not-run', result: null });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warned()[0]).toContain(`not sent: ${DELIVERY_BAD_REQUEST_DETAIL}; `);
      expect(warned()[0]).not.toMatch(/test box/);
    });
  });
  it('a trust ask sends no recipe or part', async () => {
    const request = vi.fn(async () => ({ outcome: 'unreachable', refusal: null, result: null, detail: null }));
    const io = createIo({ state: { agentOps: [TESTBOX_CAPTURE_OP] }, request } as never);
    await io.testboxCapture(BUILD);
    expect(request).toHaveBeenCalledExactlyOnceWith({ t: 'req', op: TESTBOX_CAPTURE_OP, build: BUILD }, TESTBOX_CAPTURE_REQUEST_MS);
  });
});

describe('GET /api/testbox/builds carries the deliveries', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });
  async function route() {
    const home = mkTmp('ccrc-deliveries-route-');
    const coord = freshStore(home);
    const deps: Deps = { ...testDeps(home), coord };
    const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
    const app = Fastify();
    registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, undefined);
    apps.push(app);
    return { app, coord };
  }
  it('the answer carries each build\'s word and parts, and the readers the console uses accept it', async () => {
    const { app, coord } = await route();
    coord.recordDelivery(deliveryResultFor(RIG, 0, 'refused'), 7);
    const body = (await app.inject({ method: 'GET', url: '/api/testbox/builds' })).json() as { ok: boolean; claudeBuilds: unknown; deliveries: unknown };
    expect(readClaudeBuildRecords(body.claudeBuilds)).not.toBeNull();
    const views = readDeliveryViews(body.deliveries);
    expect(views).toHaveLength(1);
    expect(views![0]).toMatchObject({ build: RIG, word: 'incomplete' });
    expect(views![0]!.parts[0]).toMatchObject({ part: 0, word: 'refused', at: 7 });
  });
  it('the answer tells the parts not yet measured and each one\'s last not-sent word', async () => {
    const { app, coord } = await route();
    coord.markDeliveryAttempt(RIG, 0, 5, 'recipe-not-run');
    coord.markDeliveryAttempt(RIG, 1, 5, 'no-test-box');
    coord.recordDelivery(deliveryResultFor(RIG, 2), 7);
    const body = (await app.inject({ method: 'GET', url: '/api/testbox/builds' })).json() as { deliveries: unknown };
    const v = readDeliveryViews(body.deliveries)![0]!;
    expect(v.unmeasured).toEqual([{ part: 0, notSent: 'recipe-not-run', attempts: 0 }, { part: 1, notSent: 'no-test-box', attempts: 0 }]);
    expect(v.parts.map((p) => p.part)).toEqual([2]);
  });
  it('a part three jobs went out for, each unanswered, reads 3 attempts through the route (wave 184 proposal 1)', async () => {
    const { app, coord } = await route();
    for (const t of [5, 6, 7]) coord.markDeliveryAttempt(RIG, 0, t, 'sent');
    const body = (await app.inject({ method: 'GET', url: '/api/testbox/builds' })).json() as { deliveries: unknown };
    expect(readDeliveryViews(body.deliveries)![0]!.unmeasured[0]).toEqual({ part: 0, notSent: null, attempts: 3 });
  });
  it('an answer with no deliveries key, an older server\'s, is still read; one with none recorded carries an empty list', async () => {
    const { app } = await route();
    const body = (await app.inject({ method: 'GET', url: '/api/testbox/builds' })).json() as { claudeBuilds: unknown; deliveries: unknown };
    expect(body.deliveries).toEqual([]);
    expect(readDeliveryViews(undefined)).toEqual([]);
    const { deliveries: _d, ...older } = body;
    expect(readClaudeBuildRecords(older.claudeBuilds)).not.toBeNull();
  });
  it('a deliveries read that throws makes the whole build list unavailable, the trust list with it: one answer, never half of one', async () => {
    const { app, coord } = await route();
    vi.spyOn(coord, 'claudeBuildDeliveries').mockImplementation(() => { throw new Error('no such table'); });
    const res = await app.inject({ method: 'GET', url: '/api/testbox/builds' });
    expect(res.statusCode).not.toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['ok']).toBe(false);
    expect(body).not.toHaveProperty('claudeBuilds');
    expect(body).not.toHaveProperty('deliveries');
  });
  it('the console\'s own reader of the answer accepts it with the new key (it reads claudeBuilds by name and ignores the rest)', async () => {
    const { app, coord } = await route();
    coord.recordDelivery(deliveryResultFor(RIG, 0), 7);
    const raw = (await app.inject({ method: 'GET', url: '/api/testbox/builds' })).json() as Record<string, unknown>;
    // `pwa/src/fleet/TestBoxBuilds.tsx`: `isRecord(raw) ? readClaudeBuildRecords(raw.claudeBuilds) : null`.
    expect(Object.keys(raw).sort()).toEqual(['claudeBuilds', 'deliveries', 'ok']);
    expect(readClaudeBuildRecords(raw['claudeBuilds'])?.map((b) => b.build)).toContain(RIG);
  });
});

// Wave 184 (option A, the capture owner's calls 1446 and 37541): the status read carries the newest trusted build's standing.
describe('GET /api/testbox carries the delivery standing (wave 184)', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { for (const a of apps.splice(0)) await a.close(); vi.restoreAllMocks(); });
  async function route(wrap: (c: CoordStore) => CoordStore = (c) => c) {
    const home = mkTmp('ccrc-standing-route-');
    const coord = freshStore(home);
    const deps: Deps = { ...testDeps(home), coord: wrap(coord) };
    const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
    const app = Fastify();
    registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, undefined);
    apps.push(app);
    const get = async () => app.inject({ method: 'GET', url: '/api/testbox' });
    return { coord, get };
  }
  /** The store, with one read replaced. */
  const over = (c: CoordStore, o: Partial<CoordStore>): CoordStore => Object.assign(Object.create(c) as CoordStore, o);

  it('the standing names the build the lane sends for, and carries no text of a case', async () => {
    const { coord, get } = await route();
    const r = deliveryResultFor(RIG, 0, 'altered');
    const marker = 'BUILD-TEXT-MARKER';
    coord.recordDelivery({ ...r, cases: r.cases.map((c, i) => (i === 0 ? { ...c, divergence: { ...c.divergence!, received: marker } } : c)) }, 7);
    coord.markDeliveryAttempt(RIG, 1, 8, 'sent');
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(marker);
    const body = res.json() as { ok: boolean; testbox: unknown; delivery: unknown };
    expect(body.testbox).toBeNull();
    const read = readDeliveryStandingAnswer(body.delivery);
    expect(read).toMatchObject({ kind: 'standing', standing: { build: RIG, word: 'fault' } });
    const job = nextDeliveryJob(coord.claudeBuilds(), [], 0);
    expect(read!.kind === 'standing' && read!.standing.build).toBe(job!.build);
    expect(read!.kind === 'standing' && read!.standing.unmeasured[0]).toEqual({ part: 1, notSent: null, attempts: 1 });
  });
  it('no build passed its trust capture: its own word, not a standing and not unreadable', async () => {
    const { get } = await route((c) => over(c, { claudeBuilds: () => [] }));
    const body = (await get()).json() as { delivery: unknown };
    expect(body.delivery).toEqual({ kind: 'no-trusted-build' });
  });
  it('a store read that throws answers unreadable, keeps the test box block answered, and logs one line the wire does not carry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { get } = await route((c) => over(c, { claudeBuildDeliveries: () => { throw new Error('disk I/O error'); } }));
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, testbox: null, delivery: { kind: 'unreadable' } });
    expect(res.body).not.toContain('disk I/O');
    // The server's own lines only: the fixture's roster notice at setup is not the route's.
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server:'))).toEqual(['ccrc-server: GET /api/testbox: the delivery standing could not be read (disk I/O error)']);
  });
});
