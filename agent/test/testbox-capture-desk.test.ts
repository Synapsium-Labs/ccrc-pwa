// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.3, §2.5). The capture
// desk against a FAKE runner: every standing refusal in its order, the one-at-a-time queue, an ended capture with a verdict
// and with none, the standing judged again when a waiting capture starts, and the test service's dispatch of
// `capture.submit` with and without a desk. Every frame the desk sends passes the frame family's one reader.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { CAPTURE_REFUSALS, CAPTURE_REFUSAL_SENTENCE, type CaptureAnswer, type CaptureRefusal, type CaptureSubmit } from '../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../shared/claudeBuildTrust.js';
import { readTestboxFrame, type ProbeAnswer, type RunLog, type RunSummary } from '../../shared/testbox.js';
import { capturePaths } from '../src/testbox/capture.js';
import { CaptureDesk, type CaptureDeskDeps, type CaptureRunnerLike } from '../src/testbox/captureDesk.js';
import type { CaptureRun } from '../src/testbox/captureRunner.js';
import { FRAME_HANDLERS, TestboxService, type Conn, type ServiceSettings } from '../src/testbox/service.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import type { SystemManager } from '../src/testbox/systemd.js';

const ID = (n: number): string => n.toString(16).padStart(32, '0');
const BUILD = '2.1.100';
const SUBMIT = (n: number, build = BUILD): CaptureSubmit => ({ t: 'capture.submit', captureId: ID(n), build });
const ROOT = '/srv/testbox';
const PASS = (build = BUILD): BuildCaptureResult => ({ build, pass: true, cwd: true, output: 'verdict: pass (12 records)' });

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

/** A runner that holds each capture until the test lets it end. */
class GatedRunner implements CaptureRunnerLike {
  readonly runs: { id: string; build: string }[] = [];
  live = 0;
  maxLive = 0;
  private readonly gates: ((r: CaptureRun | Error) => void)[] = [];
  run(captureId: string, build: string): Promise<CaptureRun> {
    this.runs.push({ id: captureId, build });
    this.live++; this.maxLive = Math.max(this.maxLive, this.live);
    return new Promise<CaptureRun>((resolve, reject) => {
      this.gates.push((r) => { this.live--; if (r instanceof Error) reject(r); else resolve(r); });
    });
  }
  release(r: CaptureRun | Error = { result: PASS(), detail: null }): void { this.gates.shift()!(r); }
}

const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 5); });

function desk(over: Partial<CaptureDeskDeps> = {}): CaptureDesk {
  return new CaptureDesk({
    role: 'test-box', runner: new GatedRunner(), root: ROOT, fleetDirs: () => ['/home/svc/.claude'], realPath: (p) => p, buildPresent: () => true, ...over,
  });
}

describe('the capture desk refuses, in order, what it will not take (spec §2.3)', () => {
  const refusal = (d: CaptureDesk, n = 1): { sink: Sink; r: CaptureRefusal | null } => {
    const sink = new Sink();
    d.submit(SUBMIT(n), sink);
    return { sink, r: sink.frames[0]?.refusal ?? null };
  };

  it('a node that is not the test box refuses first, whatever else is wrong', () => {
    const { r } = refusal(desk({ role: 'not-test-box', runner: null, buildPresent: () => false, fleetDirs: () => [ROOT] }));
    expect(r).toBe('not-test-box');
  });
  it('no runner refuses next', () => {
    expect(refusal(desk({ runner: null, buildPresent: () => false, fleetDirs: () => [ROOT] })).r).toBe('no-runner');
  });
  it('a build whose bytes are not placed refuses next, asking for the build\'s own file', () => {
    const asked: string[] = [];
    const d = desk({ buildPresent: (f) => { asked.push(f); return false; }, fleetDirs: () => [ROOT] });
    expect(refusal(d).r).toBe('build-absent');
    expect(asked).toEqual([capturePaths(ROOT, ID(1), BUILD).buildFile]);
  });
  it('a path the capture would write inside a fleet account\'s config directory refuses next', () => {
    expect(refusal(desk({ fleetDirs: () => [ROOT] })).r).toBe('path-refused');
    expect(refusal(desk({ root: '/srv/.claude-lane-a/testbox' })).r).toBe('path-refused');
  });
  it('a link into a fleet directory is judged as where it leads', () => {
    const real = (p: string): string => (p.startsWith(`${ROOT}/captures/`) ? p.replace(ROOT, '/home/svc/.claude/inside') : p);
    expect(refusal(desk({ realPath: real })).r).toBe('path-refused');
  });
  it('a capture id already used refuses last, even after it ended', async () => {
    const runner = new GatedRunner();
    const d = desk({ runner });
    const first = new Sink();
    d.submit(SUBMIT(1), first);
    await tick();
    runner.release();
    await d.settled();
    expect(first.states(ID(1))).toEqual(['queued', 'running', 'ended']);
    const again = refusal(d, 1);
    expect(again.r).toBe('capture-id-used');
  });
  it('each refused frame carries its refusal\'s sentence, nothing queued, and the build', () => {
    const cases: [Partial<CaptureDeskDeps>, CaptureRefusal][] = [
      [{ role: 'not-test-box' }, 'not-test-box'], [{ runner: null }, 'no-runner'], [{ buildPresent: () => false }, 'build-absent'], [{ fleetDirs: () => [ROOT] }, 'path-refused'],
    ];
    for (const [over, want] of cases) {
      const d = desk(over);
      const { sink } = refusal(d);
      expect(sink.frames).toEqual([{ t: 'capture.state', captureId: ID(1), build: BUILD, state: 'refused', refusal: want, detail: CAPTURE_REFUSAL_SENTENCE[want], position: null, result: null }]);
      expect(d.idle()).toBe(true);
    }
    expect(CAPTURE_REFUSALS.length).toBe(5);
  });
});

describe('the capture desk runs one capture at a time (spec §2.5)', () => {
  it('two at once: the first runs, the second waits at position 1 and runs after, never together', async () => {
    const runner = new GatedRunner();
    const d = desk({ runner });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2, '2.1.101'), sink);
    await tick();
    expect(sink.states(ID(1))).toEqual(['queued', 'running']);
    expect(sink.states(ID(2))).toEqual(['queued']);
    expect(sink.frames.find((f) => f.captureId === ID(2))!.position).toBe(1);
    expect(runner.runs).toEqual([{ id: ID(1), build: BUILD }]);
    expect(d.idle()).toBe(false);
    runner.release();
    await tick();
    expect(sink.states(ID(1))).toEqual(['queued', 'running', 'ended']);
    expect(sink.states(ID(2))).toEqual(['queued', 'running']);
    expect(runner.runs.at(-1)).toEqual({ id: ID(2), build: '2.1.101' });
    runner.release({ result: PASS('2.1.101'), detail: null });
    await d.settled();
    expect(runner.maxLive).toBe(1);
    expect(d.idle()).toBe(true);
  });

  it('an ended capture carries the verdict, and the build it was submitted for', async () => {
    const runner = new GatedRunner();
    const d = desk({ runner });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    await tick();
    runner.release({ result: { build: BUILD, pass: false, cwd: false, output: 'verdict: fail' }, detail: null });
    await d.settled();
    expect(sink.last(ID(1))).toEqual({ t: 'capture.state', captureId: ID(1), build: BUILD, state: 'ended', refusal: null, detail: null, position: null, result: { build: BUILD, pass: false, cwd: false, output: 'verdict: fail' } });
  });

  it('a runner that answers no verdict ends the capture with none and its detail', async () => {
    const runner = new GatedRunner();
    const d = desk({ runner });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    await tick();
    runner.release({ result: null, detail: 'the capture could not start: no tmux' });
    await d.settled();
    expect(sink.last(ID(1))).toMatchObject({ state: 'ended', result: null, detail: 'the capture could not start: no tmux' });
  });

  it('a runner that throws ends the capture with none, "the capture runner failed", and the next capture still runs', async () => {
    const runner = new GatedRunner();
    const d = desk({ runner });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2), sink);
    await tick();
    runner.release(new Error('boom'));
    await tick();
    expect(sink.last(ID(1))).toMatchObject({ state: 'ended', result: null, detail: 'the capture runner failed' });
    expect(sink.states(ID(2))).toEqual(['queued', 'running']);
    runner.release();
    await d.settled();
  });

  it('the standing is judged again when a waiting capture starts: a build removed while it waited is refused then', async () => {
    const runner = new GatedRunner();
    let present = true;
    const d = desk({ runner, buildPresent: () => present });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2), sink);
    await tick();
    present = false;
    runner.release();
    await d.settled();
    expect(sink.states(ID(2))).toEqual(['queued', 'refused']);
    expect(sink.last(ID(2)).refusal).toBe('build-absent');
    expect(runner.runs).toHaveLength(1);
    expect(d.idle()).toBe(true);
  });
});

describe('the test service takes capture.submit through the desk (spec §2.5)', () => {
  const SETTINGS = (root: string): ServiceSettings => ({
    root, workers: 2, runTmpdir: '/tmp', toolsDir: path.join(root, 'tools'), envForward: [], runUserPrefix: 'ccrc-tb-',
    reportMaxBytes: 1024, serviceUser: 'svc', runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000,
  });
  const service = (captures?: CaptureDesk): TestboxService => new TestboxService({
    settings: SETTINGS(ROOT), rows: [], sys: {} as SystemManager, probe: async () => ({ ok: true }), mirror: {} as MirrorOps,
    now: () => Date.parse('2026-11-22T12:00:00Z'), chrome: '/x/chrome', release: 'v1.2.3', serviceVersion: '1.2.3', ...(captures === undefined ? {} : { captures }),
  });
  class ConnSink extends Sink implements Conn {
    readonly refused: string[] = [];
    override send(f: ProbeAnswer | RunLog | RunSummary | CaptureAnswer): void { if (f.t === 'capture.state') super.send(f); }
    refuse(reason: string): void { this.refused.push(reason); }
  }

  it('the handler routes the frame to the desk, which answers over the connection', async () => {
    const runner = new GatedRunner();
    const svc = service(desk({ runner }));
    const conn = new ConnSink();
    await FRAME_HANDLERS['capture.submit']!(svc, SUBMIT(1), conn);
    await tick();
    expect(conn.states(ID(1))).toEqual(['queued', 'running']);
    expect(conn.refused).toEqual([]);
    runner.release();
  });

  it('a service without a desk refuses the frame, as the probe arm does', async () => {
    const conn = new ConnSink();
    await FRAME_HANDLERS['capture.submit']!(service(), SUBMIT(1), conn);
    expect(conn.refused).toEqual(['capture.submit is not a frame this service takes']);
    expect(conn.frames).toEqual([]);
  });
});
