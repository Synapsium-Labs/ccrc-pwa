// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.3, §2.5). The capture
// desk against a FAKE runner: every standing refusal in its order, the one-at-a-time queue, an ended capture with a verdict
// and with none, the standing judged again when a waiting capture starts, and the test service's dispatch of
// `capture.submit` with and without a desk. Every frame the desk sends passes the frame family's one reader.
import { describe, expect, it } from 'vitest';
import { existsSync, linkSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { buildFileFacts, captureDeskFor, captureDeskWith, captureRunnerFor, captureStoreAtStart, pruneBuilds, sweepStaleCaptures } from '../src/testbox/main.js';
import { admit, EMPTY_QUEUE, enqueue } from '../src/testbox/queue.js';
import { realPathOf } from '../src/testbox/probeFs.js';
import { CAPTURE_REFUSALS, CAPTURE_REFUSAL_SENTENCE, type CaptureAnswer, type CaptureRefusal, type CaptureSubmit } from '../../shared/claudeBuildCapture.js';
import type { BuildCaptureResult } from '../../shared/claudeBuildTrust.js';
import { readTestboxFrame, type ProbeAnswer, type RunLog, type RunSummary } from '../../shared/testbox.js';
import { CAPTURE_CLOSED_DETAIL, capturePaths, type BuildFileFacts } from '../src/testbox/capture.js';
import { CaptureDesk, type CaptureDeskDeps, type CaptureRunnerLike } from '../src/testbox/captureDesk.js';
import type { CaptureRun } from '../src/testbox/captureRunner.js';
import { FRAME_HANDLERS, TestboxService, type Conn, type ServiceSettings } from '../src/testbox/service.js';
import type { MirrorOps } from '../src/testbox/mirror.js';
import type { SystemManager } from '../src/testbox/systemd.js';
import type { TestboxConfig } from '../src/testbox/config.js';

const ID = (n: number): string => n.toString(16).padStart(32, '0');
const BUILD = '2.1.100';
/** A build's file as the copy places it: a regular file of its own, no link, reached through no link. */
const HERE = (f: string): BuildFileFacts => ({ regular: true, link: false, links: 1, real: f });
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
    role: 'test-box', runner: new GatedRunner(), root: ROOT, fleetDirs: () => ['/home/svc/.claude'], realPath: (p) => p, tmuxBase: '/tmp', buildFacts: HERE, ...over,
  });
}

describe('the capture desk refuses, in order, what it will not take (spec §2.3)', () => {
  const refusal = (d: CaptureDesk, n = 1): { sink: Sink; r: CaptureRefusal | null } => {
    const sink = new Sink();
    d.submit(SUBMIT(n), sink);
    return { sink, r: sink.frames[0]?.refusal ?? null };
  };

  it('a node that is not the test box refuses first, whatever else is wrong', () => {
    const { r } = refusal(desk({ role: 'not-test-box', runner: null, buildFacts: () => null, fleetDirs: () => [ROOT] }));
    expect(r).toBe('not-test-box');
  });
  it('a build whose bytes are not placed refuses next, before the runner is looked at: a box with no runner still gets its build', () => {
    expect(refusal(desk({ runner: null, buildFacts: () => null, fleetDirs: () => [ROOT] })).r).toBe('build-absent');
  });
  it('no runner refuses once the build is there', () => {
    expect(refusal(desk({ runner: null, tmuxBase: '/tmp', buildFacts: HERE, fleetDirs: () => [ROOT] })).r).toBe('no-runner');
  });
  it('a build whose bytes are not placed is asked for by its own file', () => {
    const asked: string[] = [];
    const d = desk({ buildFacts: (f) => { asked.push(f); return null; }, fleetDirs: () => [ROOT] });
    expect(refusal(d).r).toBe('build-absent');
    expect(asked).toEqual([capturePaths(ROOT, ID(1), BUILD, '/tmp').buildFile]);
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
      [{ role: 'not-test-box' }, 'not-test-box'], [{ runner: null }, 'no-runner'], [{ buildFacts: () => null }, 'build-absent'], [{ fleetDirs: () => [ROOT] }, 'path-refused'],
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
    const d = desk({ runner, buildFacts: (f) => (present ? HERE(f) : null) });
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

describe('the sweep of stale capture directories at the service start (main.ts#sweepStaleCaptures)', () => {
  const fresh = (): string => realpathSync(mkTmp('ccrc-capsweep-'));
  it('removes each capture-id directory, keeps the builds store and any other entry', () => {
    const root = fresh();
    const caps = path.join(root, 'captures');
    for (const n of [ID(1), ID(2), 'builds']) mkdirSync(path.join(caps, n), { recursive: true });
    writeFileSync(path.join(caps, 'builds', '2.1.100'), 'x');
    writeFileSync(path.join(caps, 'notes.txt'), 'x');
    expect(sweepStaleCaptures(root).sort()).toEqual([ID(1), ID(2)]);
    expect(existsSync(path.join(caps, ID(1)))).toBe(false);
    expect(existsSync(path.join(caps, ID(2)))).toBe(false);
    expect(existsSync(path.join(caps, 'builds', '2.1.100'))).toBe(true);
    expect(existsSync(path.join(caps, 'notes.txt'))).toBe(true);
  });
  it('an absent captures directory is nothing to do', () => {
    expect(sweepStaleCaptures(fresh())).toEqual([]);
  });
  it('one removal that throws stops neither the others nor the start', () => {
    const root = fresh();
    for (const n of [ID(1), ID(2), ID(3)]) mkdirSync(path.join(root, 'captures', n), { recursive: true });
    const tried: string[] = [];
    const got = sweepStaleCaptures(root, (d) => { tried.push(path.basename(d)); if (path.basename(d) === ID(2)) throw new Error('EBUSY'); });
    expect(tried).toEqual([ID(1), ID(2), ID(3)]);
    expect(got).toEqual([ID(1), ID(3)]);
  });
});

// Review 3687 F5: what the service's start does to the capture store, in the one function its entry point calls.
describe('the capture store at the service start (main.ts#captureStoreAtStart)', () => {
  it('sweeps the stale capture directories and prunes the builds store with no build in use', () => {
    const root = realpathSync(mkTmp('ccrc-capstart-'));
    const caps = path.join(root, 'captures');
    mkdirSync(path.join(caps, ID(1)), { recursive: true });
    mkdirSync(path.join(caps, 'builds'));
    for (const n of ['2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.1.5']) writeFileSync(path.join(caps, 'builds', n), 'x');
    const got = captureStoreAtStart(root);
    expect({ captures: got.captures, builds: [...got.builds].sort() }).toEqual({ captures: [ID(1)], builds: ['2.1.1', '2.1.2'] });
    expect(readdirSync(caps).sort()).toEqual(['builds']);
    expect(readdirSync(path.join(caps, 'builds')).sort()).toEqual(['2.1.3', '2.1.4', '2.1.5']);
  });
  it('an empty box root is nothing to do', () => {
    expect(captureStoreAtStart(realpathSync(mkTmp('ccrc-capstart-')))).toEqual({ captures: [], builds: [] });
  });
});

// Review 3226 F9: the desk's WHOLE refusal order, pinned in one case. Every fault stands, then each is cured in turn, and
// the refusal moves to the next in the order: role, build, runner, write guard, capture id.
describe('the desk\'s whole refusal order (review 3226 F9)', () => {
  it('not-test-box, build-absent, no-runner, path-refused, capture-id-used: each cure moves the refusal to the next', async () => {
    const runner = new GatedRunner();
    const f = { role: 'test-box' as 'test-box' | 'not-test-box', present: true, runner: true, fleet: false };
    const d = new CaptureDesk({
      get role() { return f.role; }, get runner() { return f.runner ? runner : null; }, root: ROOT, tmuxBase: '/tmp', realPath: (p) => p,
      fleetDirs: () => (f.fleet ? [ROOT] : ['/home/svc/.claude']), buildFacts: (p) => (f.present ? HERE(p) : null),
    });
    // The id is used once, cleanly.
    const first = new Sink();
    d.submit(SUBMIT(1), first);
    await tick();
    runner.release();
    await d.settled();
    expect(first.last(ID(1))).toMatchObject({ state: 'ended', result: { pass: true } });
    // Every fault at once, then one cured at a time.
    Object.assign(f, { role: 'not-test-box', present: false, runner: false, fleet: true });
    const seen: (CaptureRefusal | null)[] = [];
    const ask = (): void => { const s = new Sink(); d.submit(SUBMIT(1), s); seen.push(s.frames[0]?.refusal ?? null); };
    ask(); f.role = 'test-box';
    ask(); f.present = true;
    ask(); f.runner = true;
    ask(); f.fleet = false;
    ask();
    expect(seen).toEqual(['not-test-box', 'build-absent', 'no-runner', 'path-refused', 'capture-id-used']);
  });
});

// Review 3623 (carried by PR 2's note): the desk runs only a build that is a file of its own, never one reached through a
// link or sharing its bytes with another name, so a build under capture cannot run, or write, another version's bytes.
describe('the desk reads a build reached through a link, or with a second hard link, as absent (review 3623)', () => {
  const fresh = (): string => realpathSync(mkTmp('ccrc-capbuild-'));
  const builds = (root: string): string => path.join(root, 'captures', 'builds');
  const real = (root: string): CaptureDesk => desk({ root, realPath: realPathOf, buildFacts: buildFileFacts, fleetDirs: () => [] });
  const first = (d: CaptureDesk): CaptureAnswer => { const s = new Sink(); d.submit(SUBMIT(1), s); return s.frames[0]!; };

  it('a regular file of its own is taken', () => {
    const root = fresh();
    mkdirSync(builds(root), { recursive: true });
    writeFileSync(path.join(builds(root), BUILD), 'bytes', { mode: 0o555 });
    expect(first(real(root)).state).toBe('queued');
  });
  it.each([
    ['a link to another version', (root: string) => { writeFileSync(path.join(builds(root), '2.1.99'), 'other'); symlinkSync(path.join(builds(root), '2.1.99'), path.join(builds(root), BUILD)); }],
    ['a second hard link of another version', (root: string) => { writeFileSync(path.join(builds(root), '2.1.99'), 'other'); linkSync(path.join(builds(root), '2.1.99'), path.join(builds(root), BUILD)); }],
    ['a dangling link', (root: string) => { symlinkSync(path.join(root, 'nowhere'), path.join(builds(root), BUILD)); }],
    ['a directory', (root: string) => { mkdirSync(path.join(builds(root), BUILD)); }],
  ])('%s at the build\'s place: build-absent', (_n, arrange) => {
    const root = fresh();
    mkdirSync(builds(root), { recursive: true });
    arrange(root);
    expect(first(real(root)).refusal).toBe('build-absent');
  });
  it.each(['captures', 'builds'])('a link at %s on the build\'s path: build-absent', (at) => {
    const root = fresh();
    const elsewhere = path.join(root, 'elsewhere');
    mkdirSync(elsewhere);
    if (at === 'captures') {
      mkdirSync(path.join(elsewhere, 'builds'));
      writeFileSync(path.join(elsewhere, 'builds', BUILD), 'bytes');
      symlinkSync(elsewhere, path.join(root, 'captures'));
    } else {
      mkdirSync(path.join(root, 'captures'));
      writeFileSync(path.join(elsewhere, BUILD), 'bytes');
      symlinkSync(elsewhere, builds(root));
    }
    expect(first(real(root)).refusal).toBe('build-absent');
  });
});

// Gate G2 (review 3316 A4): no capture starts while the box admits no work. A waiting capture is ended with no verdict and
// a word, so none is started only to be cut off by the takeover's exit, and none holds a drain open.
describe('the desk starts no capture while the box admits no work (gate G2)', () => {
  it('submitted while admissions are closed: queued, then ended with no verdict and the word, never run', async () => {
    const runner = new GatedRunner();
    const d = desk({ runner, admitting: () => false });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    await tick();
    expect(sink.states(ID(1))).toEqual(['queued', 'ended']);
    expect(sink.last(ID(1))).toMatchObject({ result: null, detail: CAPTURE_CLOSED_DETAIL });
    expect(runner.runs).toEqual([]);
    expect(d.idle()).toBe(true);
  });
  it('closed while one runs: the running one ends as it would, the waiting one is ended unrun', async () => {
    const runner = new GatedRunner();
    let open = true;
    const d = desk({ runner, admitting: () => open });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    await tick();
    open = false;
    d.submit(SUBMIT(2, '2.1.101'), sink);
    await tick();
    expect(sink.last(ID(2))).toMatchObject({ state: 'ended', result: null, detail: CAPTURE_CLOSED_DETAIL });
    runner.release();
    await d.settled();
    expect(sink.last(ID(1))).toMatchObject({ state: 'ended', result: { pass: true } });
    expect(runner.runs.map((r) => r.id)).toEqual([ID(1)]);
    expect(d.idle()).toBe(true);
  });
  it('the production desk reads the admissions it is given', async () => {
    const root = realpathSync(mkTmp('ccrc-capg2-'));
    mkdirSync(path.join(root, 'captures', 'builds'), { recursive: true });
    writeFileSync(path.join(root, 'captures', 'builds', BUILD), 'bytes');
    const cfg = { root, lines: new Map([['A_BOX_LINE', { key: 'A_BOX_LINE', def: '', value: root, from: 'file' }]]) } as unknown as TestboxConfig;
    const d = captureDeskFor(cfg, { admitting: () => false, home: root, tmuxBase: '/tmp', uid: 1000 });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    await d.settled();
    expect(sink.states(ID(1))).toEqual(['queued', 'ended']);
    expect(sink.last(ID(1)).detail).toBe(CAPTURE_CLOSED_DETAIL);
  });
});

// Review 3226 F8: the builds store keeps the newest builds and every build a capture still needs.
describe('the builds store\'s prune (main.ts#pruneBuilds, wired to the desk)', () => {
  it('the desk hands the prune the builds still queued, after each capture ends', async () => {
    const runner = new GatedRunner();
    const asked: string[][] = [];
    const d = desk({ runner, prune: (inUse) => { asked.push([...inUse]); } });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2, '2.1.101'), sink);
    await tick();
    runner.release();
    await tick();
    runner.release({ result: PASS('2.1.101'), detail: null });
    await d.settled();
    expect(asked).toEqual([['2.1.101'], []]);
  });
  it('a prune that throws stops neither the answer nor the queue', async () => {
    const runner = new GatedRunner();
    const d = desk({ runner, prune: () => { throw new Error('EACCES'); } });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2, '2.1.101'), sink);
    await tick();
    runner.release();
    await tick();
    runner.release({ result: PASS('2.1.101'), detail: null });
    await d.settled();
    expect(sink.last(ID(2))).toMatchObject({ state: 'ended', result: { pass: true } });
  });
  it('removes every build past the newest kept, never one in use or a name that is not a build', () => {
    const root = realpathSync(mkTmp('ccrc-capprune-'));
    const dir = path.join(root, 'captures', 'builds');
    mkdirSync(dir, { recursive: true });
    for (const n of ['2.1.1', '2.1.2', '2.1.10', '2.1.9', '2.1.3', '.copy.abc', 'notes']) writeFileSync(path.join(dir, n), 'x');
    expect(pruneBuilds(root, ['2.1.1']).sort()).toEqual(['2.1.2']);
    expect(readdirSync(dir).sort()).toEqual(['.copy.abc', '2.1.1', '2.1.10', '2.1.3', '2.1.9', 'notes']);
  });
  it('an absent store is nothing to do; one removal that throws stops neither the others nor the caller', () => {
    expect(pruneBuilds(realpathSync(mkTmp('ccrc-capprune-')), [])).toEqual([]);
    const root = realpathSync(mkTmp('ccrc-capprune-'));
    const dir = path.join(root, 'captures', 'builds');
    mkdirSync(dir, { recursive: true });
    for (const n of ['2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.1.5']) writeFileSync(path.join(dir, n), 'x');
    const tried: string[] = [];
    const got = pruneBuilds(root, [], (f) => { tried.push(path.basename(f)); if (path.basename(f) === '2.1.2') throw new Error('EBUSY'); });
    expect(tried.sort()).toEqual(['2.1.1', '2.1.2']);
    expect(got).toEqual(['2.1.1']);
  });
});

// Review 3226 F8: a service whose temporary directory is too long for the capture's tmux socket wires no runner.
describe('the production desk wires its runner only where the capture\'s socket fits', () => {
  const cfgAt = (root: string): TestboxConfig =>
    ({ root, lines: new Map([['A_BOX_LINE', { key: 'A_BOX_LINE', def: '', value: root, from: 'file' }]]) } as unknown as TestboxConfig);
  const placed = (): string => {
    const root = realpathSync(mkTmp('ccrc-capwire-'));
    mkdirSync(path.join(root, 'captures', 'builds'), { recursive: true });
    writeFileSync(path.join(root, 'captures', 'builds', BUILD), 'bytes');
    return root;
  };
  it('a base too long for the socket: every capture is refused no-runner', () => {
    const root = placed();
    const d = captureDeskFor(cfgAt(root), { home: root, tmuxBase: `/${'x'.repeat(80)}`, uid: 1000 });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    expect(sink.frames[0]!.refusal).toBe('no-runner');
  });
  it('a base that fits: the capture is taken, not refused no-runner (admissions closed, so nothing is run)', async () => {
    const root = placed();
    const d = captureDeskFor(cfgAt(root), { home: root, tmuxBase: '/tmp', uid: 1000, admitting: () => false });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    await d.settled();
    expect(sink.states(ID(1))).toEqual(['queued', 'ended']);
  });
  it('the runner it wires starts the build from the builds store, through the launcher it is given', async () => {
    const root = placed();
    const started: string[] = [];
    const r = await captureRunnerFor(root, root, () => null, undefined, {
      launcher: { start: async (spec) => { started.push(spec.binary); throw new Error('no build here'); } },
    }).run(ID(1), BUILD);
    expect(started).toEqual([path.join(root, 'captures', 'builds', BUILD)]);
    expect(r).toMatchObject({ result: null });
    expect(r.detail).toContain('could not start');
  });
});

describe('the composed desk prunes the builds store after a capture, and captures run one at a time in the box\'s queue', () => {
  it('captureDeskWith wires the prune: after a capture ends, only the newest builds and those still queued are kept', async () => {
    const root = realpathSync(mkTmp('ccrc-capwprune-'));
    const dir = path.join(root, 'captures', 'builds');
    mkdirSync(dir, { recursive: true });
    for (const n of ['2.1.1', '2.1.2', '2.1.3', '2.1.4', '2.1.100']) writeFileSync(path.join(dir, n), 'x');
    const cfg = { root, lines: new Map([['A_BOX_LINE', { key: 'A_BOX_LINE', def: '', value: root, from: 'file' }]]) } as unknown as TestboxConfig;
    const runner = new GatedRunner();
    const d = captureDeskWith(cfg, runner, '/tmp', { home: root });
    const sink = new Sink();
    d.submit(SUBMIT(1), sink);
    d.submit(SUBMIT(2, '2.1.1'), sink);
    await tick();
    runner.release();
    await tick();
    // The oldest is still queued, so it stays; the rest past the newest three go.
    expect(readdirSync(dir).sort()).toEqual(['2.1.1', '2.1.100', '2.1.3', '2.1.4']);
    runner.release({ result: PASS('2.1.1'), detail: null });
    await d.settled();
    expect(readdirSync(dir).sort()).toEqual(['2.1.100', '2.1.3', '2.1.4']);
  });

  it('the queue\'s capture kind starts one at a time, whatever the limits', () => {
    let q = enqueue(EMPTY_QUEUE, { id: 'a', session: 's', kind: 'capture' })!;
    q = enqueue(q, { id: 'b', session: 't', kind: 'capture' })!;
    expect(admit(q, { runs: 4, sessionRuns: 4 }).started.map((e) => e.id)).toEqual(['a']);
  });
});
