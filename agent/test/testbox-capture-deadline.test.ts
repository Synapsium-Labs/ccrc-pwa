// The build capture runner's deadline arithmetic (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §5
// Table 7, PR 3; review 3226 F8). The fleet agent waits `TESTBOX_CAPTURE_DEADLINE_MS` for a capture's verdict and then
// closes the connection, and a verdict sent after that is lost. So the capture's own timings must fit that deadline with a
// capture ahead of it in the queue, and a capture that has waited too long to finish in time is ended with no verdict and a
// word, never run for an answer nobody hears. And the tool sync's takeover, which replaces the release the capture's
// recorder runs from, waits for captures as it waits for runs (`service.ts#idle`).
//
// Gate G1 (review 3316 F1, capture runner PR 3b): the desk and the runner the entry point composes, through the very function
// that hands them the timing contract (`main.ts#captureDeskComposed`, review 3687 F2), with the real launcher, run on a
// virtual clock with every tmux call at its bound and every wait at its limit, and each capture ends within
// `captureWorstCaseMs`, the second of two within the fleet agent's deadline. The desk's late check is pinned from both sides
// and the runner's poll is pinned (review 3765 F2), so a contract other than `CAPTURE_TIMINGS` at any of the three
// hand-overs, stricter or looser, shows as a difference.
import { describe, expect, it } from 'vitest';
import { TESTBOX_CAPTURE_DEADLINE_MS, UPDATE_SPAWN_DRAIN_MS } from '../../shared/agent-protocol.js';
import type { CaptureAnswer, CaptureSubmit } from '../../shared/claudeBuildCapture.js';
import { readTestboxFrame } from '../../shared/testbox.js';
import {
  CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_LATE_DETAIL, CAPTURE_STEPS, CAPTURE_TIMINGS, captureStartsLate, captureWorstCaseMs, type BuildFileFacts, type CaptureTimings,
} from '../src/testbox/capture.js';
import { DELIVERY_PART_COUNT, deliveryParts } from '../../shared/deliveryResult.js';
import { DELIVERY_STEPS_BEFORE, deliveryPartCount, deliveryStartsLate, deliveryWorstCaseMs } from '../src/testbox/captureDelivery.js';
import { CaptureDesk, type CaptureDeskDeps, type CaptureRunnerLike } from '../src/testbox/captureDesk.js';
import type { CaptureRun } from '../src/testbox/captureRunner.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import { TestboxService, type ServiceSettings } from '../src/testbox/service.js';
import type { SystemManager } from '../src/testbox/systemd.js';
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestboxConfig } from '../src/testbox/config.js';
import { captureDeskComposed, deliveryOf, deliveryWiring } from '../src/testbox/main.js';
import { mkTmp } from './tmpHelpers.js';

const T: CaptureTimings = {
  stepMs: 1000, exitMs: 100, pollMs: 10, tmuxCallMs: 20, stopWaitMs: 50, standInCloseMs: 30, setupMs: 5, removeMs: 7,
  deliveryDriveMs: 300, deliveryKillGraceMs: 60, deliverySettleMs: 200, deliveryQuietMs: 40,
  framesDriveMs: 250, framesPersonDriveMs: 900, framesHoldMs: 600,
};
/** The delivery recipe's bounds in the contract (Desktop polish wave 178): build trust's worst case never reads them. */
const DELIVERY_KEYS: readonly (keyof CaptureTimings)[] = ['deliveryDriveMs', 'deliveryKillGraceMs', 'deliverySettleMs', 'deliveryQuietMs', 'framesDriveMs', 'framesPersonDriveMs', 'framesHoldMs'];

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
    for (const k of Object.keys(T) as (keyof CaptureTimings)[]) {
      if (!DELIVERY_KEYS.includes(k)) expect(captureWorstCaseMs({ ...T, [k]: T[k] + 1 }), k).toBeGreaterThan(base);
    }
  });
  it('the delivery recipe\'s bounds leave it unchanged, and they are the only ones that do', () => {
    const base = captureWorstCaseMs(T);
    for (const k of DELIVERY_KEYS) expect(captureWorstCaseMs({ ...T, [k]: T[k] + 1 }), k).toBe(base);
  });
});

describe('the timing contract fits the fleet agent\'s deadline (review 3226 F8; gate G1)', () => {
  it('under the contract, a capture with one capture ahead of it in the queue ends, with its margin, before the agent stops waiting, a delivery part either member', () => {
    const worst = captureWorstCaseMs(CAPTURE_TIMINGS);
    expect(2 * worst + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
    // The delivery recipe's largest part (Desktop polish wave 178; the capture owner's calls 1148 and 1159), ahead of or
    // behind a build-trust capture or another part.
    const part = deliveryWorstCaseMs(CAPTURE_TIMINGS);
    for (const [ahead, own] of [[worst, part], [part, worst], [part, part]] as const) {
      expect(ahead + own + CAPTURE_DEADLINE_MARGIN_MS, `${ahead} then ${own}`).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
    }
    // The shared part count is the one this contract derives: the smallest that fits, so a count one higher or lower than
    // the derivation is red here (shared/deliveryResult.ts#DELIVERY_PART_COUNT).
    expect(deliveryPartCount(CAPTURE_TIMINGS)).toBe(DELIVERY_PART_COUNT);
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
    reportMaxBytes: 1024, serviceUser: 'svc', runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000, registryKeepMs: 86_400_000,
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

  /** The latest a queued capture may have waited and still start: the desk's late check on the contract (review 3765 F2). */
  const lastStart = TESTBOX_CAPTURE_DEADLINE_MS - captureWorstCaseMs(t) - CAPTURE_DEADLINE_MARGIN_MS;

  /** The production desk and runner, the real launcher, a virtual clock. The build under drive raises each step's events
   *  only once the step has waited the contract's whole limit, and never those of steps from `stallAt` on; it never exits
   *  and it outlives the stop wait. Each tmux call takes its whole bound plus the drain; the stand-in's close never ends.
   *  `heldAfterFirst` moves the clock on as the first capture ends, before the desk looks at the next one. Every sleep the
   *  runner asks for is recorded. */
  async function drive(o: { builds: readonly string[]; stallAt?: number; heldAfterFirst?: number }) {
    const root = realpathSync(mkTmp('ccrc-capg1-'));
    mkdirSync(path.join(root, 'captures', 'builds'), { recursive: true });
    for (const b of o.builds) writeFileSync(path.join(root, 'captures', 'builds', b), 'bytes');
    const cfg = { root, lines: new Map([['A_BOX_LINE', { key: 'A_BOX_LINE', def: '', value: root, from: 'file' }]]) } as unknown as TestboxConfig;
    const clock = { now: 1_000_000 };
    let cur: { recording: string; step: number; began: number; written: number } | null = null;
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      clock.now += ms;
      if (cur !== null && cur.written < cur.step + 1 && cur.step < (o.stallAt ?? CAPTURE_STEPS.length) && clock.now >= cur.began + t.stepMs) {
        for (const event of CAPTURE_STEPS[cur.step]!.waitFor) appendFileSync(cur.recording, `${JSON.stringify({ kind: 'hook', event, payload: {}, status: null })}\n`);
        cur.written = cur.step + 1;
      }
    };
    const bounds: number[] = [];
    // Through the composer the entry point calls (review 3687 F2): the contract it hands the runner and the desk is the one
    // these exact times are measured against, so another contract there shows as a difference.
    const desk = captureDeskComposed(cfg, root, true, { home: root, seams: {
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
      standIn: async () => ({ port: 1, requests: [], routes: [], close: () => new Promise<void>(() => undefined) }),
    } });
    const at: number[] = [];
    const frames: CaptureAnswer[] = [];
    const t0 = clock.now;
    const sink = { send: (f: CaptureAnswer): void => {
      if (f.state === 'ended') {
        if (at.length === 0) clock.now += o.heldAfterFirst ?? 0;
        at.push(clock.now - t0);
      }
      frames.push(f);
    } };
    o.builds.forEach((b, n) => { desk.submit({ ...SUBMIT(n + 1), build: b }, sink); });
    await desk.settled();
    return { at, ended: frames.filter((f) => f.state === 'ended'), bounds, sleeps };
  }
  const words = (ended: readonly CaptureAnswer[]): (string | null)[] => ended.map((f) => (f.result === null ? f.detail : 'verdict'));

  it('three captures, one behind another, at every limit: the first two end exactly at their limits, inside their worst case, the second before the agent stops waiting, and the third, late by the contract, is ended with no verdict', async () => {
    const { at, ended, bounds, sleeps } = await drive({ builds: [BUILD, '2.1.101', '2.1.102'] });
    expect(words(ended)).toEqual(['verdict', 'verdict', CAPTURE_LATE_DETAIL]);
    expect(atLimits).toBeLessThanOrEqual(captureWorstCaseMs(t));
    expect(at).toEqual([atLimits, 2 * atLimits, 2 * atLimits]);
    expect(at[1]! + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
    // The second had waited one run at its limits, inside what the contract leaves; the third two, past it.
    expect([captureStartsLate(atLimits), captureStartsLate(2 * atLimits)]).toEqual([false, true]);
    // Every call the launcher makes is asked at the contract's bound, for the two captures that ran.
    expect(bounds).toEqual([t.tmuxCallMs, t.tmuxCallMs]);
    // The runner sleeps the contract's poll between reads, and otherwise only the stand-in's close bound (review 3765 F2).
    expect([...new Set(sleeps)].sort((a, b) => a - b)).toEqual([t.pollMs, t.standInCloseMs].sort((a, b) => a - b));
  });

  // The desk's late check is the contract's, exactly, from both sides (review 3765 F2): a capture that has waited the last
  // instant the contract leaves still runs, and one that has waited a millisecond more is ended with no verdict. A desk on a
  // stricter contract ends the first; one on a looser contract runs the second.
  it('a capture that waited exactly what the contract leaves runs, and one that waited a millisecond more is ended late', async () => {
    expect(lastStart).toBeGreaterThan(atLimits);
    const fits = await drive({ builds: [BUILD, '2.1.101'], heldAfterFirst: lastStart - atLimits });
    expect(words(fits.ended)).toEqual(['verdict', 'verdict']);
    expect(fits.at).toEqual([lastStart, lastStart + atLimits]);
    const late = await drive({ builds: [BUILD, '2.1.101'], heldAfterFirst: lastStart - atLimits + 1 });
    expect(words(late.ended)).toEqual(['verdict', CAPTURE_LATE_DETAIL]);
    expect(late.at).toEqual([lastStart + 1, lastStart + 1]);
  });

  it('a build that stalls at its last step: the runner waits that step\'s whole limit, not the exit wait, and still answers', async () => {
    const { at, ended } = await drive({ builds: [BUILD], stallAt: CAPTURE_STEPS.length - 1 });
    expect(words(ended)).toEqual(['verdict']);
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
  });  it('so does a delivery part\'s, on the same contract\'s delivery bounds (Desktop polish wave 178)', async () => {
    const runner = new GatedRunner();
    const clock = { now: 0 };
    const d = new CaptureDesk({
      role: 'test-box', runner, root: '/srv/testbox', tmuxBase: '/tmp', fleetDirs: () => [], realPath: (p) => p, buildFacts: HERE, now: () => clock.now, timings: T,
    });
    d.submit(SUBMIT(1), new Sink());
    d.submit({ ...SUBMIT(2), recipe: 'delivery', part: 0 }, new Sink());
    await new Promise((r) => { setTimeout(r, 5); });
    const waited = TESTBOX_CAPTURE_DEADLINE_MS - deliveryWorstCaseMs(T) - CAPTURE_DEADLINE_MARGIN_MS;
    expect([deliveryStartsLate(waited, T), deliveryStartsLate(waited, CAPTURE_TIMINGS)]).toEqual([false, true]);
    clock.now += waited;
    runner.release();
    await new Promise((r) => { setTimeout(r, 5); });
    expect(runner.runs).toEqual([ID(1), ID(2)]);
    runner.release();
    await d.settled();
  });
});

// The delivery recipe's settle and quiet bounds reach its runner from the contract the runner is built from, never from a
// seam or a copy (Desktop polish wave 178; the capture owner's condition 5).
describe('the runner\'s delivery bounds are the contract\'s', () => {
  const driver = { drive: async (): Promise<never> => { throw new Error('not run'); } };
  it('a seam\'s wiring takes the given contract\'s settle and quiet bounds, and no wiring is none', () => {
    expect(deliveryOf({ delivery: { driver, tmuxConf: null } }, T, null)).toEqual({ delivery: { driver, tmuxConf: null, release: null, settleMs: T.deliverySettleMs, quietMs: T.deliveryQuietMs } });
    expect(deliveryOf({ delivery: null }, T, null)).toEqual({});
  });
  it('the box\'s release tag is pinned into the delivery dependencies, and absent is null, never a made-up tag (review 3882 F5)', () => {
    expect(deliveryOf({ delivery: { driver, tmuxConf: null } }, T, 'v1.2.3')).toEqual({ delivery: { driver, tmuxConf: null, release: 'v1.2.3', settleMs: T.deliverySettleMs, quietMs: T.deliveryQuietMs } });
    expect(deliveryOf({ delivery: { driver, tmuxConf: null } }, T)).toEqual({ delivery: { driver, tmuxConf: null, release: null, settleMs: T.deliverySettleMs, quietMs: T.deliveryQuietMs } });
  });
  it('the production wiring\'s driver child is stopped at the given contract\'s bound and killed its kill grace later', async () => {
    const dir = mkTmp('ccrc-capwire-');
    const script = path.join(dir, 'stubborn.cjs');
    writeFileSync(script, `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
    const tc: CaptureTimings = { ...CAPTURE_TIMINGS, deliveryDriveMs: 200, deliveryKillGraceMs: 300 };
    const w = deliveryWiring(tc, script, path.join(dir, 'no-such.conf'));
    expect(w?.tmuxConf).toBeNull();
    const t0 = Date.now();
    const a = await w!.driver.drive({ capture: '/box/captures/x', tmux: '/tmp/ccrc-capture-x', case: 'c0' }, { path: '/usr/bin:/bin', tmpBase: dir });
    const took = Date.now() - t0;
    expect(a).toMatchObject({ kind: 'fault', detail: expect.stringMatching(/within 200 ms/) });
    // Its bound and its grace, the contract's; never the production grace, which would hold it a full second.
    expect(took).toBeGreaterThanOrEqual(tc.deliveryDriveMs + tc.deliveryKillGraceMs);
    expect(took).toBeLessThan(tc.deliveryDriveMs + CAPTURE_TIMINGS.deliveryKillGraceMs);
  }, 20_000);
});

// Gate G1 for the delivery recipe (the capture owner's call 1208): the composed desk and runner, the real launcher, a
// virtual clock, every bound taken, and the elapsed time held to the part's worst case, as build trust's composed run is.
describe('gate G1: a delivery part, composed, every bound taken, ends within its worst case', () => {
  const t = CAPTURE_TIMINGS;
  const cases = deliveryParts()[0]!.length;
  /** The worst case less its two allowances and the polls' overruns, which this clock never has: the start's, the two
   *  steps before's, each case's settle and quiet, the last case's trailing settle window, the /exit step's, the exit wait's
   *  and the stop wait's. Measured EXACTLY. */
  const atLimits = deliveryWorstCaseMs(t) - t.setupMs - t.removeMs - (DELIVERY_STEPS_BEFORE.length + 2 * cases + 4) * t.pollMs;

  it(`the steps before at their bound, each of the ${cases} cases' driver stopped at its bound with its kill grace and drain, the settle and the quiet in full, /exit at its bound, the exit wait and the stop`, async () => {
    const root = realpathSync(mkTmp('ccrc-capg1d-'));
    mkdirSync(path.join(root, 'captures', 'builds'), { recursive: true });
    writeFileSync(path.join(root, 'captures', 'builds', BUILD), 'bytes');
    const cfg = { root, lines: new Map([['A_BOX_LINE', { key: 'A_BOX_LINE', def: '', value: root, from: 'file' }]]) } as unknown as TestboxConfig;
    const clock = { now: 1_000_000 };
    const call = t.tmuxCallMs + UPDATE_SPAWN_DRAIN_MS;
    // The build raises a step's events once the step has waited its whole limit, for the steps before the cases only: no
    // turn ever ends (so each settle runs in full) and /exit never finishes (so its step runs its bound).
    let cur: { recording: string; step: number; began: number; written: number } | null = null;
    const sleep = async (ms: number): Promise<void> => {
      clock.now += ms;
      if (cur !== null && cur.written < cur.step + 1 && cur.step < DELIVERY_STEPS_BEFORE.length && clock.now >= cur.began + t.stepMs) {
        for (const event of DELIVERY_STEPS_BEFORE[cur.step]!.waitFor) appendFileSync(cur.recording, `${JSON.stringify({ kind: 'hook', event, payload: {}, status: null })}\n`);
        cur.written = cur.step + 1;
      }
    };
    // The driver child at its limit: its bound passes, the group is sent TERM, KILL a grace later, then one drain; its
    // answer is a send the build took, so the case waits its settle and quiet in full.
    const drives: number[] = [];
    const driver = { drive: async () => { drives.push(clock.now); clock.now += t.deliveryDriveMs + t.deliveryKillGraceMs + UPDATE_SPAWN_DRAIN_MS; return { kind: 'sent' as const, send: 'ok' }; } };
    const desk = captureDeskComposed(cfg, root, true, { home: root, seams: {
      now: () => clock.now, sleep,
      tmux: {
        spawner: (env) => async (_file, args) => {
          clock.now += call;
          if (args.includes('new-session')) {
            cur = { recording: env['CCRC_CAPTURE_RECORDING']!, step: 0, began: clock.now, written: 0 };
            return { status: 0, stdout: '4242\n', stderr: '', killed: false };
          }
          if (args.at(-1) === 'Enter' && cur !== null) { cur.step++; cur.began = clock.now; }
          return { status: 0, stdout: '', stderr: '', killed: false };
        },
        signal: () => undefined,
      },
      standIn: async () => ({ port: 1, requests: [], routes: [], close: () => new Promise<void>(() => undefined) }),
      delivery: { driver, tmuxConf: null },
    } });
    const t0 = clock.now;
    let at = -1;
    const frames: CaptureAnswer[] = [];
    desk.submit({ ...SUBMIT(1), recipe: 'delivery', part: 0 }, { send: (f: CaptureAnswer): void => { frames.push(f); if (f.state === 'ended') at = clock.now - t0; } });
    await desk.settled();
    expect(drives).toHaveLength(cases);
    expect(frames.at(-1)).toMatchObject({ state: 'ended', detail: null, delivery: { part: 0 } });
    expect(at).toBe(atLimits);
    expect(at).toBeLessThanOrEqual(deliveryWorstCaseMs(t));
  });

  it('the figures today: a four-case part 401 s (the trailing window, one settle and a poll, over 385.5 s), trust unchanged at 399.5 s, every pair with the margin inside the 900 s wait, and three parts', () => {
    const part = deliveryWorstCaseMs(t);
    const trust = captureWorstCaseMs(t);
    expect(part).toBe(401_000);
    expect(trust).toBe(399_500);
    expect([part + part, part + trust, trust + part].map((pair) => pair + CAPTURE_DEADLINE_MARGIN_MS)).toEqual([832_000, 830_500, 830_500]);
    for (const pair of [part + part, part + trust, trust + part]) expect(pair + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
    expect(deliveryPartCount(t)).toBe(3);
  });
});

