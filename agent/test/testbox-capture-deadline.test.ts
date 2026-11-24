// The build capture runner's deadline arithmetic (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §5
// Table 7, PR 3; review 3226 F8). The fleet agent waits `TESTBOX_CAPTURE_DEADLINE_MS` for a capture's verdict and then
// closes the connection, and a verdict sent after that is lost. So the capture's own timings must fit that deadline with a
// capture ahead of it in the queue, and a capture that has waited too long to finish in time is ended with no verdict and a
// word, never run for an answer nobody hears. And the tool sync's takeover, which replaces the release the capture's
// recorder runs from, waits for captures as it waits for runs (`service.ts#idle`).
//
// Gate G1 (review 3316 F1, capture runner PR 3b): the desk and the runner the entry point composes (`main.ts#captureDeskWith`,
// `#captureRunnerFor`), with the real launcher, run on a virtual clock with every tmux call at its bound and every wait at
// its limit, and each capture ends within `captureWorstCaseMs`, the second of two within the fleet agent's deadline.
import { describe, expect, it } from 'vitest';
import { TESTBOX_CAPTURE_DEADLINE_MS, UPDATE_SPAWN_DRAIN_MS } from '../../shared/agent-protocol.js';
import type { CaptureAnswer, CaptureSubmit } from '../../shared/claudeBuildCapture.js';
import { readTestboxFrame } from '../../shared/testbox.js';
import {
  CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_LATE_DETAIL, CAPTURE_STEPS, CAPTURE_TIMINGS, captureStartsLate, captureWorstCaseMs, type BuildFileFacts, type CaptureTimings,
} from '../src/testbox/capture.js';
import { CaptureDesk, type CaptureDeskDeps, type CaptureRunnerLike } from '../src/testbox/captureDesk.js';
import type { CaptureRun } from '../src/testbox/captureRunner.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import { TestboxService, type ServiceSettings } from '../src/testbox/service.js';
import type { SystemManager } from '../src/testbox/systemd.js';
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestboxConfig } from '../src/testbox/config.js';
import { captureDeskWith, captureRunnerFor } from '../src/testbox/main.js';
import { mkTmp } from './tmpHelpers.js';

const T: CaptureTimings = { stepMs: 1000, exitMs: 100, pollMs: 10, tmuxCallMs: 20, stopWaitMs: 50, standInCloseMs: 30, setupMs: 5, removeMs: 7 };

describe('the worst case of one capture by the wired runner (capture.ts#captureWorstCaseMs)', () => {
  it('adds the setup allowance, the start, each typed step\'s two calls, each step\'s wait and a poll, the exit wait and a poll, the stop, the stop wait and a poll, the stand-in\'s close and the removal allowance', () => {
    const call = T.tmuxCallMs + UPDATE_SPAWN_DRAIN_MS;
    const typed = CAPTURE_STEPS.filter((s) => s.type !== null).length;
    const drive = typed * 2 * call + CAPTURE_STEPS.length * (T.stepMs + T.pollMs);
    const exit = T.exitMs + T.pollMs;
    const teardown = call + T.stopWaitMs + T.pollMs + T.standInCloseMs + T.removeMs;
    expect(captureWorstCaseMs(T)).toBe(T.setupMs + call + drive + exit + teardown);
  });
  it('grows with each timing it is made of', () => {
    const base = captureWorstCaseMs(T);
    for (const k of Object.keys(T) as (keyof CaptureTimings)[]) expect(captureWorstCaseMs({ ...T, [k]: T[k] + 1 }), k).toBeGreaterThan(base);
  });
});

describe('the timing contract fits the fleet agent\'s deadline (review 3226 F8; gate G1)', () => {
  it('under the contract, a capture with one capture ahead of it in the queue ends, with its margin, before the agent stops waiting', () => {
    const worst = captureWorstCaseMs(CAPTURE_TIMINGS);
    expect(2 * worst + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
  });
  it('the drive carries door B2\'s typed step and still fits', () => {
    const typed = CAPTURE_STEPS.filter((s) => s.type === '/model haiku');
    expect(typed).toHaveLength(1);
    expect(2 * captureWorstCaseMs(CAPTURE_TIMINGS, CAPTURE_STEPS) + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
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
/** A build's file as the copy places it: a regular file of its own, no link, reached through no link. */
const HERE = (f: string): BuildFileFacts => ({ regular: true, link: false, links: 1, real: f });
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
      role: 'test-box', runner, root: '/srv/testbox', fleetDirs: () => ['/home/svc/.claude'], realPath: (p) => p, tmuxBase: '/tmp', buildFacts: HERE,
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
    const d = new CaptureDesk({ role: 'test-box', runner, root: '/srv/testbox', fleetDirs: () => [], realPath: (p) => p, tmuxBase: '/tmp', buildFacts: HERE });
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

describe('gate G1: the composed desk and runner, the real launcher, on a virtual clock (review 3316 F1)', () => {
  const t = CAPTURE_TIMINGS;
  const call = t.tmuxCallMs + UPDATE_SPAWN_DRAIN_MS;
  const typed = CAPTURE_STEPS.filter((x) => x.type !== null).length;
  /** Everything a run at its limits takes on this clock, which never overruns a poll: the worst case less its two
   *  allowances and the polls' overruns. Measured EXACTLY, so a bound the composition hands the runner other than the
   *  contract's shows up as a difference. */
  const atLimits = captureWorstCaseMs(t) - t.setupMs - t.removeMs - (CAPTURE_STEPS.length + 2) * t.pollMs;

  /** The production desk and runner, the real launcher, a virtual clock. The build under drive raises each step's events
   *  only once the step has waited the contract's whole limit, and never those of steps from `stallAt` on; it never exits
   *  and it outlives the stop wait. Each tmux call takes its whole bound plus the drain; the stand-in's close never ends. */
  async function drive(o: { builds: readonly string[]; stallAt?: number }) {
    const root = realpathSync(mkTmp('ccrc-capg1-'));
    mkdirSync(path.join(root, 'captures', 'builds'), { recursive: true });
    for (const b of o.builds) writeFileSync(path.join(root, 'captures', 'builds', b), 'bytes');
    const cfg = { root, lines: new Map([['CCRC_TESTBOX_ROOT', { key: 'CCRC_TESTBOX_ROOT', def: '', value: root, from: 'file' }]]) } as unknown as TestboxConfig;
    const clock = { now: 1_000_000 };
    let cur: { recording: string; step: number; began: number; written: number } | null = null;
    const sleep = async (ms: number): Promise<void> => {
      clock.now += ms;
      if (cur !== null && cur.written < cur.step + 1 && cur.step < (o.stallAt ?? CAPTURE_STEPS.length) && clock.now >= cur.began + t.stepMs) {
        for (const event of CAPTURE_STEPS[cur.step]!.waitFor) appendFileSync(cur.recording, `${JSON.stringify({ kind: 'hook', event, payload: {}, status: null })}\n`);
        cur.written = cur.step + 1;
      }
    };
    const bounds: number[] = [];
    const runner = captureRunnerFor(root, root, () => null, t, {
      now: () => clock.now, sleep,
      tmux: {
        spawner: (env, boundMs) => {
          bounds.push(boundMs);
          return async (_file, args) => {
            clock.now += call;
            if (args.includes('new-session')) {
              cur = { recording: env['CCRC_CAPTURE_RECORDING']!, step: 0, began: clock.now, written: 0 };
              return { status: 0, stdout: '4242\n', stderr: '', killed: false };
            }
            if (args.at(-1) === 'Enter' && cur !== null) { cur.step++; cur.began = clock.now; }
            return { status: 0, stdout: '', stderr: '', killed: false };
          };
        },
        signal: () => undefined,
      },
      standIn: async () => ({ port: 1, requests: [], close: () => new Promise<void>(() => undefined) }),
    });
    const desk = captureDeskWith(cfg, runner, root, { home: root, seams: { now: () => clock.now } });
    const at: number[] = [];
    const frames: CaptureAnswer[] = [];
    const t0 = clock.now;
    const sink = { send: (f: CaptureAnswer): void => { if (f.state === 'ended') at.push(clock.now - t0); frames.push(f); } };
    o.builds.forEach((b, n) => { desk.submit({ ...SUBMIT(n + 1), build: b }, sink); });
    await desk.settled();
    return { at, ended: frames.filter((f) => f.state === 'ended'), bounds };
  }

  it('two captures, one behind the other, at every limit: each ends exactly at its limits, inside its worst case, the second before the agent stops waiting', async () => {
    const { at, ended, bounds } = await drive({ builds: [BUILD, '2.1.101'] });
    expect(ended.map((f) => (f.result === null ? f.detail : 'verdict'))).toEqual(['verdict', 'verdict']);
    expect(atLimits).toBeLessThanOrEqual(captureWorstCaseMs(t));
    expect(at).toEqual([atLimits, 2 * atLimits]);
    expect(at[1]! + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
    // Every call the launcher makes is asked at the contract's bound.
    expect(bounds).toEqual([t.tmuxCallMs, t.tmuxCallMs]);
  });

  it('a build that stalls at its last step: the runner waits that step\'s whole limit, not the exit wait, and still answers', async () => {
    const { at, ended } = await drive({ builds: [BUILD], stallAt: CAPTURE_STEPS.length - 1 });
    expect(ended.map((f) => (f.result === null ? f.detail : 'verdict'))).toEqual(['verdict']);
    expect(at).toEqual([atLimits - t.exitMs]);
  });

  it(`the setup and the removal are allowances, and a call is its bound plus the drain (${typed} typed steps, two calls each)`, () => {
    expect(atLimits).toBe(call + typed * 2 * call + CAPTURE_STEPS.length * t.stepMs + t.exitMs + call + t.stopWaitMs + t.standInCloseMs);
  });
});

// The desk's late check reads the timing contract it was composed with, never a copy of its own.
describe('the desk\'s late check reads the contract it is given', () => {
  it('a wait the given contract still fits starts, where the default contract would end it late', async () => {
    const runner = new GatedRunner();
    const clock = { now: 0 };
    const d = new CaptureDesk({
      role: 'test-box', runner, root: '/srv/testbox', tmuxBase: '/tmp', fleetDirs: () => [], realPath: (p) => p, buildFacts: HERE, now: () => clock.now, timings: T,
    });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2), sink);
    await new Promise((r) => { setTimeout(r, 5); });
    const waited = TESTBOX_CAPTURE_DEADLINE_MS - captureWorstCaseMs(T) - CAPTURE_DEADLINE_MARGIN_MS;
    expect([captureStartsLate(waited, T), captureStartsLate(waited)]).toEqual([false, true]);
    clock.now += waited;
    runner.release();
    await new Promise((r) => { setTimeout(r, 5); });
    expect(runner.runs).toEqual([ID(1), ID(2)]);
    runner.release();
    await d.settled();
  });
});
