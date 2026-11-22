// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.3, §2.5). L4: the test
// service's capture desk, the entry point of the `capture.submit` job kind, mirroring `probeDesk.ts#ProbeDesk`. It decides
// nothing itself: the role and the write guard are `probes.ts`'s, the paths are `capture.ts`'s, the one-at-a-time rule is
// `queue.ts`'s. It acts through one seam, the runner (absent, every capture is refused `no-runner`).
//
// A submission is answered with `capture.state` frames: `refused` with its typed reason and sentence (nothing queued), or
// `queued` with its position, then `running`, then `ended` with the runner's verdict, or with none and why when the
// runner could not judge (it answered no verdict, or threw). Every answer echoes the submission's build. The standing
// refusals are judged again when a waiting capture starts (a symlink may have moved while it waited), and a capture that
// waited too long to answer before the fleet agent stops waiting, by the target timings (`capture.ts#captureStartsLate`,
// not yet the runner's own), is ended with no verdict and a word, never run (F8).
import { CAPTURE_REFUSAL_SENTENCE, type CaptureAnswer, type CaptureRefusal, type CaptureStateWord, type CaptureSubmit } from '../../../shared/claudeBuildCapture.js';
import { CAPTURE_LATE_DETAIL, captureStartsLate, captureWrites, capturePaths } from './capture.js';
import type { CaptureRun } from './captureRunner.js';
import { writeRefusal, type ProbeRole } from './probes.js';
import { admit, EMPTY_QUEUE, enqueue, finish, positions, type QueueState } from './queue.js';

/** The runner as the desk sees it. */
export interface CaptureRunnerLike { run(captureId: string, build: string): Promise<CaptureRun> }

/** Where a capture's frames go. */
export interface CaptureSink { send(frame: CaptureAnswer): void }

export interface CaptureDeskDeps {
  readonly role: ProbeRole;
  /** `null` until the runner is wired to the desk (the spec's third pull request). */
  readonly runner: CaptureRunnerLike | null;
  /** `CCRC_TESTBOX_ROOT`. */
  readonly root: string;
  /** The fleet accounts' config directories, read on each submission. */
  readonly fleetDirs: () => readonly string[];
  /** A path with its symlinks followed. */
  readonly realPath: (p: string) => string;
  /** Whether the build's file is placed (a regular file). */
  readonly buildPresent: (file: string) => boolean;
  /** The clock a capture's wait in the queue is measured on (default `Date.now`). */
  readonly now?: () => number;
}

/** The capture's own queue holds one at a time, the probe rule's. */
const CAPTURE_SLOTS = 1;
const SESSION = 'capture';
const RUNNER_FAILED = 'the capture runner failed';

/** A capture the desk holds, and when it was submitted (its wait in the queue is measured from then). */
interface Held { readonly f: CaptureSubmit; readonly sink: CaptureSink; readonly at: number }

export class CaptureDesk {
  private queue: QueueState = EMPTY_QUEUE;
  private readonly held = new Map<string, Held>();
  private readonly used = new Set<string>();
  private readonly driving = new Set<Promise<void>>();

  constructor(private readonly d: CaptureDeskDeps) {}

  private now(): number { return (this.d.now ?? Date.now)(); }

  /** Why the desk takes no capture of `f` now, in order: the role, the runner, the build's bytes, the write guard. */
  private standing(f: CaptureSubmit): CaptureRefusal | null {
    if (this.d.role !== 'test-box') return 'not-test-box';
    if (this.d.runner === null) return 'no-runner';
    const paths = capturePaths(this.d.root, f.captureId, f.build);
    if (!this.d.buildPresent(paths.buildFile)) return 'build-absent';
    const fleet = this.d.fleetDirs().map((x) => this.d.realPath(x));
    // Every path the capture writes passes the probe desk's write guard, judged as it leads.
    return captureWrites(paths).map((p) => writeRefusal(this.d.realPath(p), fleet)).some((r) => r !== null) ? 'path-refused' : null;
  }

  private answer(f: CaptureSubmit, sink: CaptureSink, state: CaptureStateWord, rest: Partial<Pick<CaptureAnswer, 'refusal' | 'detail' | 'position' | 'result'>> = {}): void {
    sink.send({ t: 'capture.state', captureId: f.captureId, build: f.build, state, refusal: null, detail: null, position: null, result: null, ...rest });
  }

  private refuse(f: CaptureSubmit, sink: CaptureSink, refusal: CaptureRefusal): void {
    this.answer(f, sink, 'refused', { refusal, detail: CAPTURE_REFUSAL_SENTENCE[refusal] });
  }

  /** A submission: refused with its typed reason, or queued. */
  submit(f: CaptureSubmit, sink: CaptureSink): void {
    const standing = this.standing(f);
    if (standing !== null) { this.refuse(f, sink, standing); return; }
    const q = this.used.has(f.captureId) ? null : enqueue(this.queue, { id: f.captureId, session: SESSION, kind: 'probe' });
    if (q === null) { this.refuse(f, sink, 'capture-id-used'); return; }
    this.queue = q;
    this.used.add(f.captureId);
    this.held.set(f.captureId, { f, sink, at: this.now() });
    this.answer(f, sink, 'queued', { position: positions(this.queue).get(f.captureId) ?? null });
    this.pump();
  }

  /** Start the capture the queue admits (one at a time). */
  private pump(): void {
    const { state, started } = admit(this.queue, { runs: CAPTURE_SLOTS, sessionRuns: CAPTURE_SLOTS });
    this.queue = state;
    for (const e of started) {
      const p = this.drive(e.id).finally(() => { this.driving.delete(p); });
      this.driving.add(p);
    }
  }

  private async drive(captureId: string): Promise<void> {
    const h = this.held.get(captureId)!;
    const standing = this.standing(h.f);
    const runner = this.d.runner;
    if (standing === null && runner !== null && captureStartsLate(this.now() - h.at)) {
      // Its verdict would come after the fleet agent stopped waiting: ended with no verdict and the word, never run
      // (review 3226 F8). The decision is `capture.ts#captureStartsLate`'s.
      this.answer(h.f, h.sink, 'ended', { detail: CAPTURE_LATE_DETAIL });
    } else if (standing === null && runner !== null) {
      this.answer(h.f, h.sink, 'running');
      let run: CaptureRun;
      try { run = await runner.run(captureId, h.f.build); } catch { run = { result: null, detail: RUNNER_FAILED }; }
      this.answer(h.f, h.sink, 'ended', run.result !== null ? { result: run.result } : { detail: run.detail ?? RUNNER_FAILED });
    } else {
      this.refuse(h.f, h.sink, standing ?? 'no-runner');
    }
    this.held.delete(captureId);
    this.queue = finish(this.queue, captureId);
    this.pump();
  }

  /** No capture waiting or running. */
  idle(): boolean { return this.queue.waiting.length === 0 && this.queue.running.length === 0; }

  /** Every capture started so far has ended (tests and the service's stop wait on it). */
  async settled(): Promise<void> {
    while (this.driving.size > 0) await Promise.all([...this.driving]);
  }
}
