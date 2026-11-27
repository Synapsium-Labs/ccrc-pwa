// The capture desk's delivery recipe (Desktop polish wave 178): the recipe and its part reach the runner; a delivery
// capture's every frame carries `delivery` and its result rides it, never `result`; a build-trust capture's frames are as
// before; the late check reads each recipe's own worst case from the one timing contract; and a box whose runner has no
// delivery driver refuses a delivery submission at the frame, recording nothing (the capture owner's call 1148, item 5).
import { describe, expect, it } from 'vitest';
import type { CaptureAnswer, CaptureRecipe, CaptureSubmit } from '../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../shared/claudeBuildTrust.js';
import { deliveryCaptureResult, deliveryCaseResult, deliveryExpected } from '../../shared/deliveryCapture.js';
import { deliveryParts, type DeliveryCaptureResult } from '../../shared/deliveryResult.js';
import { TESTBOX_CAPTURE_DEADLINE_MS } from '../../shared/agent-protocol.js';
import { readTestboxFrame } from '../../shared/testbox.js';
import { CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_TIMINGS, captureWorstCaseMs, type BuildFileFacts } from '../src/testbox/capture.js';
import { deliveryWorstCaseMs } from '../src/testbox/captureDelivery.js';
import { CaptureDesk, type CaptureDeskDeps, type CaptureRunnerLike } from '../src/testbox/captureDesk.js';
import type { CaptureRun } from '../src/testbox/captureRunner.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import { TestboxService, type Conn, type ServiceSettings } from '../src/testbox/service.js';
import type { SystemManager } from '../src/testbox/systemd.js';

const ID = (n: number): string => n.toString(16).padStart(32, '0');
const BUILD = '2.1.100';
const HERE = (f: string): BuildFileFacts => ({ regular: true, link: false, links: 1, real: f });
const PASS: BuildCaptureResult = { build: BUILD, pass: true, cwd: true, output: 'verdict: pass (12 records)' };
const RESULT: DeliveryCaptureResult = deliveryCaptureResult(BUILD, 1, deliveryParts()[1]!.map((id) =>
  deliveryCaseResult(id, { send: 'ok', turns: [deliveryExpected(id)], sideRequests: { messages: 0, count_tokens: 0 }, hookPrompts: [] })), 'v1.2.3', []);
const submit = (n: number, recipe?: 'delivery', part = 1): CaptureSubmit => ({ t: 'capture.submit', captureId: ID(n), build: BUILD, ...(recipe === undefined ? {} : { recipe, part }) });

class Sink {
  readonly frames: CaptureAnswer[] = [];
  send(f: CaptureAnswer): void {
    const r = readTestboxFrame(JSON.stringify(f));
    if (!r.ok) throw new Error(`the desk sent a frame the reader refuses: ${r.reason}`);
    this.frames.push(f);
  }
}

/** A runner that answers at once with what `answer` gives, and records the recipe and part it was asked. */
class Runner implements CaptureRunnerLike {
  readonly asked: (CaptureRecipe | undefined)[] = [];
  readonly parts: (number | undefined)[] = [];
  constructor(private readonly answer: (recipe: CaptureRecipe | undefined) => CaptureRun, readonly delivers = true) {}
  async run(_id: string, _build: string, recipe?: CaptureRecipe, part?: number): Promise<CaptureRun> { this.asked.push(recipe); this.parts.push(part); return this.answer(recipe); }
}

function desk(runner: CaptureRunnerLike, over: Partial<CaptureDeskDeps> = {}): CaptureDesk {
  return new CaptureDesk({ role: 'test-box', runner, root: '/srv/testbox', fleetDirs: () => [], realPath: (p) => p, tmuxBase: '/tmp', buildFacts: HERE, ...over });
}

describe('the desk with the delivery recipe', () => {
  it('asks the runner for the delivery recipe and the part submitted, and every frame carries delivery, its result on ended', async () => {
    const runner = new Runner(() => ({ result: null, delivery: RESULT, detail: null }));
    const d = desk(runner);
    const sink = new Sink();
    d.submit(submit(1, 'delivery'), sink);
    await d.settled();
    expect(runner.asked).toEqual(['delivery']);
    expect(runner.parts).toEqual([1]);
    expect(sink.frames.map((f) => f.state)).toEqual(['queued', 'running', 'ended']);
    expect(sink.frames.every((f) => 'delivery' in f && f.result === null)).toBe(true);
    expect(sink.frames.at(-1)).toMatchObject({ state: 'ended', delivery: RESULT, detail: null });
  });

  it('a delivery submission that reaches the desk with no part is handed on with no part, never part 0 (call 1208, condition 1)', async () => {
    const runner = new Runner(() => ({ result: null, delivery: null, detail: 'a delivery capture was asked with no part: not run, no verdict' }));
    const d = desk(runner);
    d.submit({ t: 'capture.submit', captureId: ID(6), build: BUILD, recipe: 'delivery' }, new Sink());
    await d.settled();
    expect(runner.asked).toEqual(['delivery']);
    expect(runner.parts).toEqual([undefined]);
  });

  it('a delivery capture with no verdict ends with delivery: null and the runner\'s detail', async () => {
    const d = desk(new Runner(() => ({ result: null, delivery: null, detail: 'the driver could not start' })));
    const sink = new Sink();
    d.submit(submit(2, 'delivery'), sink);
    await d.settled();
    expect(sink.frames.at(-1)).toMatchObject({ state: 'ended', delivery: null, detail: 'the driver could not start' });
  });

  it('a runner that throws on a delivery capture ends it with delivery: null', async () => {
    const d = desk({ run: async () => { throw new Error('boom'); } });
    const sink = new Sink();
    d.submit(submit(3, 'delivery'), sink);
    await d.settled();
    expect(sink.frames.at(-1)).toMatchObject({ state: 'ended', delivery: null, detail: 'the capture runner failed' });
  });

  it('a refused delivery capture carries delivery: null too', async () => {
    const sink = new Sink();
    desk(new Runner(() => ({ result: null, detail: null })), { role: 'fleet' as CaptureDeskDeps['role'] }).submit(submit(4, 'delivery'), sink);
    expect(sink.frames).toHaveLength(1);
    expect(sink.frames[0]).toMatchObject({ state: 'refused', refusal: 'not-test-box', delivery: null });
  });

  it('a build-trust capture is as before: the runner is asked with no recipe, and no frame names delivery', async () => {
    const runner = new Runner(() => ({ result: PASS, detail: null }));
    const d = desk(runner);
    const sink = new Sink();
    d.submit(submit(5), sink);
    await d.settled();
    expect(runner.asked).toEqual([undefined]);
    expect(runner.parts).toEqual([undefined]);
    expect(sink.frames.some((f) => 'delivery' in f)).toBe(false);
    expect(sink.frames.at(-1)).toMatchObject({ state: 'ended', result: PASS });
  });
});

describe('the late check reads each recipe\'s own worst case', () => {
  it('a delivery part that waited past its room is ended late where a build-trust capture, whose worst case is shorter today (399.5 s against 401 s for a part, the trailing window), still starts', async () => {
    let t = 0;
    const deliveryRoom = TESTBOX_CAPTURE_DEADLINE_MS - CAPTURE_DEADLINE_MARGIN_MS - deliveryWorstCaseMs(CAPTURE_TIMINGS);
    const trustRoom = TESTBOX_CAPTURE_DEADLINE_MS - CAPTURE_DEADLINE_MARGIN_MS - captureWorstCaseMs(CAPTURE_TIMINGS);
    expect(deliveryRoom).toBeLessThan(trustRoom);
    // A gate holds the first capture so the next ones wait; the clock then jumps past the delivery part's room only.
    let open: (() => void) | null = null;
    const asked: (CaptureRecipe | undefined)[] = [];
    const runner: CaptureRunnerLike = {
      delivers: true,
      run: (_id, _b, recipe) => {
        asked.push(recipe);
        return asked.length === 1 ? new Promise<CaptureRun>((r) => { open = () => r({ result: PASS, detail: null }); })
          : Promise.resolve(recipe === 'delivery' ? { result: null, delivery: RESULT, detail: null } : { result: PASS, detail: null });
      },
    };
    const d = desk(runner, { now: () => t });
    d.submit(submit(10), new Sink());
    const trust = new Sink();
    d.submit(submit(11), trust);
    const delivery = new Sink();
    d.submit(submit(12, 'delivery'), delivery);
    t = deliveryRoom + 1;
    open!();
    await d.settled();
    expect(trust.frames.at(-1)).toMatchObject({ state: 'ended', result: PASS });
    expect(delivery.frames.at(-1)).toMatchObject({ state: 'ended', delivery: null, detail: expect.stringMatching(/waited in the queue too long/) });
    expect(asked).toEqual([undefined, undefined]);
  });
  it('a delivery part that waited past its own room is ended late with delivery: null', async () => {
    let t = 0;
    const deliveryRoom = TESTBOX_CAPTURE_DEADLINE_MS - CAPTURE_DEADLINE_MARGIN_MS - deliveryWorstCaseMs(CAPTURE_TIMINGS);
    let open: (() => void) | null = null;
    let runs = 0;
    const runner: CaptureRunnerLike = {
      delivers: true,
      run: () => (runs++ === 0 ? new Promise<CaptureRun>((r) => { open = () => r({ result: PASS, detail: null }); }) : Promise.resolve({ result: null, delivery: RESULT, detail: null })),
    };
    const d = desk(runner, { now: () => t });
    d.submit(submit(20), new Sink());
    const delivery = new Sink();
    d.submit(submit(21, 'delivery'), delivery);
    t = deliveryRoom + 1;
    open!();
    await d.settled();
    expect(delivery.frames.at(-1)).toMatchObject({ state: 'ended', delivery: null, detail: expect.stringMatching(/waited in the queue too long/) });
    expect(runs).toBe(1);
  });
});

describe('a box whose runner has no delivery driver refuses the submission at the frame, and records nothing (call 1148, item 5)', () => {
  const SETTINGS: ServiceSettings = {
    root: '/srv/testbox', workers: 2, runTmpdir: '/tmp', toolsDir: '/srv/testbox/tools', envForward: [], runUserPrefix: 'ccrc-tb-',
    reportMaxBytes: 1024, serviceUser: 'svc', runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000, registryKeepMs: 86_400_000,
  };
  const service = (captures: CaptureDesk): TestboxService => new TestboxService({
    settings: SETTINGS, rows: [], sys: {} as SystemManager, probe: async () => ({ ok: true }), mirror: {} as MirrorOps,
    now: () => Date.parse('2026-11-22T12:00:00Z'), chrome: '/x/chrome', release: 'v1.2.3', serviceVersion: '1.2.3', captures,
  });
  class Wire implements Conn {
    readonly frames: unknown[] = [];
    readonly refusals: string[] = [];
    send(f: unknown): void { this.frames.push(f); }
    refuse(reason: string): void { this.refusals.push(reason); }
  }
  it.each<[string, CaptureRunnerLike | null]>([
    ['a runner without the driver', new Runner(() => ({ result: PASS, detail: null }), false)],
    ['no runner at all', null],
  ])('%s: the connection is closed with the policy refusal, nothing is queued, run or counted, and the box goes on', async (_why, runner) => {
    const d = desk(runner ?? { run: async () => ({ result: PASS, detail: null }) }, runner === null ? { runner: null } : {});
    const svc = service(d);
    const wire = new Wire();
    svc.capture(submit(30, 'delivery'), wire as unknown as Conn);
    expect(wire.refusals).toEqual(['delivery is not a recipe this box runs']);
    expect(wire.frames).toEqual([]);
    // Nothing waits or runs: the takeover's idle resolves at once, and the status answer counts nothing.
    await svc.idle();
    expect(svc.status()).toMatchObject({ queueDepth: 0, runs: { inProgress: 0 } });
    // A build-trust capture on the same box then runs as before, under the same id space: the refused id was never used.
    if (runner !== null) {
      const sink = new Sink();
      d.submit(submit(30), sink);
      await d.settled();
      expect(sink.frames.at(-1)).toMatchObject({ state: 'ended', result: PASS });
    }
  });
  it('a runner with the driver takes the submission to the desk', async () => {
    const runner = new Runner(() => ({ result: null, delivery: RESULT, detail: null }));
    const svc = service(desk(runner));
    const wire = new Wire();
    svc.capture(submit(31, 'delivery'), wire as unknown as Conn);
    expect(wire.refusals).toEqual([]);
    await svc.idle();
    expect(runner.asked).toEqual(['delivery']);
  });
});
