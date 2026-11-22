// The build capture runner's deadline arithmetic (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §5
// Table 7, PR 3; review 3226 F8). The fleet agent waits `TESTBOX_CAPTURE_DEADLINE_MS` for a capture's verdict and then
// closes the connection, and a verdict sent after that is lost. So the capture's own timings must fit that deadline with a
// capture ahead of it in the queue, and a capture that has waited too long to finish in time is ended with no verdict and a
// word, never run for an answer nobody hears. And the tool sync's takeover, which replaces the release the capture's
// recorder runs from, waits for captures as it waits for runs (`service.ts#idle`).
import { describe, expect, it } from 'vitest';
import { TESTBOX_CAPTURE_DEADLINE_MS } from '../../shared/agent-protocol.js';
import type { CaptureAnswer, CaptureSubmit } from '../../shared/claudeBuildCapture.js';
import { readTestboxFrame } from '../../shared/testbox.js';
import {
  CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_LATE_DETAIL, CAPTURE_STEPS, CAPTURE_TIMINGS, captureStartsLate, captureWorstCaseMs, type CaptureTimings,
} from '../src/testbox/capture.js';
import { CaptureDesk, type CaptureDeskDeps, type CaptureRunnerLike } from '../src/testbox/captureDesk.js';
import type { CaptureRun } from '../src/testbox/captureRunner.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import { TestboxService, type ServiceSettings } from '../src/testbox/service.js';
import type { SystemManager } from '../src/testbox/systemd.js';

const T: CaptureTimings = { stepMs: 1000, exitMs: 100, pollMs: 10, tmuxCallMs: 20, stopWaitMs: 50, setupMs: 5 };

describe('the worst case one capture can take (capture.ts#captureWorstCaseMs)', () => {
  it('adds the setup, the start, each step (typing and its wait), the drive\'s last liveness check, the exit wait and the cleanup', () => {
    const typed = CAPTURE_STEPS.filter((s) => s.type !== null).length;
    const drive = typed * 3 * T.tmuxCallMs + CAPTURE_STEPS.length * (T.stepMs + T.pollMs) + T.tmuxCallMs;
    const exit = T.exitMs + T.tmuxCallMs + T.pollMs;
    const stop = T.tmuxCallMs + T.stopWaitMs + T.tmuxCallMs + T.pollMs;
    expect(captureWorstCaseMs(T)).toBe(T.setupMs + T.tmuxCallMs + drive + exit + stop);
  });
  it('grows with each timing it is made of', () => {
    const base = captureWorstCaseMs(T);
    for (const k of Object.keys(T) as (keyof CaptureTimings)[]) expect(captureWorstCaseMs({ ...T, [k]: T[k] + 1 }), k).toBeGreaterThan(base);
  });
});

describe('the production timings fit the fleet agent\'s deadline (review 3226 F8)', () => {
  it('a capture with one capture ahead of it in the queue still ends, with its margin, before the agent stops waiting', () => {
    const worst = captureWorstCaseMs(CAPTURE_TIMINGS);
    expect(2 * worst + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
  });
  it('the pin still holds with one more typed step than the drive has (room for the model-switch step, door B2)', () => {
    const more = [...CAPTURE_STEPS, { type: '/model haiku', waitFor: [] }];
    expect(2 * captureWorstCaseMs(CAPTURE_TIMINGS, more) + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
  });
  it('every step has a real wait: no timing is zero', () => {
    for (const [k, v] of Object.entries(CAPTURE_TIMINGS)) expect(v, k).toBeGreaterThan(0);
  });
  it('a capture that has waited one worst case still starts; one that has waited past what is left does not', () => {
    const worst = captureWorstCaseMs(CAPTURE_TIMINGS);
    expect(captureStartsLate(0)).toBe(false);
    expect(captureStartsLate(worst)).toBe(false);
    const last = TESTBOX_CAPTURE_DEADLINE_MS - worst - CAPTURE_DEADLINE_MARGIN_MS;
    expect(captureStartsLate(last)).toBe(false);
    expect(captureStartsLate(last + 1)).toBe(true);
  });
});

const ID = (n: number): string => n.toString(16).padStart(32, '0');
const BUILD = '2.1.100';
const SUBMIT = (n: number): CaptureSubmit => ({ t: 'capture.submit', captureId: ID(n), build: BUILD });

class Sink {
  readonly frames: CaptureAnswer[] = [];
  send(f: CaptureAnswer): void {
    const r = readTestboxFrame(JSON.stringify(f));
    if (!r.ok) throw new Error(`the desk sent a frame the reader refuses: ${r.reason}`);
    this.frames.push(f);
  }
  states(id: string): string[] { return this.frames.filter((f) => f.captureId === id).map((f) => f.state); }
  last(id: string): CaptureAnswer { return this.frames.filter((f) => f.captureId === id).at(-1)!; }
}

/** A runner that holds each capture until the test lets it end, the clock moved meanwhile. */
class GatedRunner implements CaptureRunnerLike {
  readonly runs: string[] = [];
  private readonly gates: (() => void)[] = [];
  run(captureId: string, build: string): Promise<CaptureRun> {
    this.runs.push(captureId);
    return new Promise<CaptureRun>((resolve) => {
      this.gates.push(() => resolve({ result: { build, pass: true, cwd: true, output: 'verdict: pass (12 records)' }, detail: null }));
    });
  }
  release(): void { this.gates.shift()!(); }
}

describe('the desk ends a capture that waited too long with no verdict and a word (review 3226 F8)', () => {
  const setup = (over: Partial<CaptureDeskDeps> = {}): { d: CaptureDesk; runner: GatedRunner; clock: { now: number }; sink: Sink } => {
    const runner = new GatedRunner();
    const clock = { now: 1_000_000 };
    const d = new CaptureDesk({
      role: 'test-box', runner, root: '/srv/testbox', fleetDirs: () => ['/home/svc/.claude'], realPath: (p) => p, buildPresent: () => true,
      now: () => clock.now, ...over,
    });
    return { d, runner, clock, sink: new Sink() };
  };
  const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 5); });

  it('a capture behind one that ran past its start time is ended with no verdict, never run', async () => {
    const { d, runner, clock, sink } = setup();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2), sink);
    await tick();
    expect(runner.runs).toEqual([ID(1)]);
    clock.now += TESTBOX_CAPTURE_DEADLINE_MS;
    runner.release();
    await d.settled();
    expect(runner.runs).toEqual([ID(1)]);
    expect(sink.states(ID(2))).toEqual(['queued', 'ended']);
    expect(sink.last(ID(2))).toMatchObject({ state: 'ended', result: null, detail: CAPTURE_LATE_DETAIL });
    expect(d.idle()).toBe(true);
  });

  it('a capture behind one that ended in time runs', async () => {
    const { d, runner, clock, sink } = setup();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2), sink);
    await tick();
    clock.now += captureWorstCaseMs(CAPTURE_TIMINGS);
    runner.release();
    await tick();
    expect(runner.runs).toEqual([ID(1), ID(2)]);
    runner.release();
    await d.settled();
    expect(sink.last(ID(2))).toMatchObject({ state: 'ended', result: { pass: true } });
  });

  it('the wait is measured from the capture\'s own submission, not the one ahead of it', async () => {
    const { d, runner, clock, sink } = setup();
    d.submit(SUBMIT(1), sink);
    await tick();
    clock.now += TESTBOX_CAPTURE_DEADLINE_MS;
    d.submit(SUBMIT(2), sink);
    runner.release();
    await tick();
    expect(runner.runs).toEqual([ID(1), ID(2)]);
    runner.release();
    await d.settled();
  });
});

describe('the takeover waits for captures as for runs (review 3226 F8: service.ts#idle)', () => {
  const SETTINGS: ServiceSettings = {
    root: '/srv/testbox', workers: 2, runTmpdir: '/tmp', toolsDir: '/srv/testbox/tools', envForward: [], runUserPrefix: 'ccrc-tb-',
    reportMaxBytes: 1024, serviceUser: 'svc', runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000,
  };
  const service = (captures: CaptureDesk): TestboxService => new TestboxService({
    settings: SETTINGS, rows: [], sys: {} as SystemManager, probe: async () => ({ ok: true }), mirror: {} as MirrorOps,
    now: () => Date.parse('2026-11-22T12:00:00Z'), chrome: '/x/chrome', release: 'v1.2.3', serviceVersion: '1.2.3', captures,
  });
  const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 5); });

  it('idle() does not resolve while a capture runs or waits, and resolves once every one has ended', async () => {
    const runner = new GatedRunner();
    const d = new CaptureDesk({ role: 'test-box', runner, root: '/srv/testbox', fleetDirs: () => [], realPath: (p) => p, buildPresent: () => true });
    const svc = service(d);
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2), sink);
    let idle = false;
    void svc.idle().then(() => { idle = true; });
    await tick();
    expect(idle).toBe(false);
    runner.release();
    await tick();
    expect(runner.runs).toEqual([ID(1), ID(2)]);
    expect(idle).toBe(false);
    runner.release();
    await tick();
    expect(idle).toBe(true);
  });
});
