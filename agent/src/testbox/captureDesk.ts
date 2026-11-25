// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.3, §2.5). L4: the test
// service's capture desk, the entry point of the `capture.submit` job kind, mirroring `probeDesk.ts#ProbeDesk`. It decides
// nothing itself: the role and the write guard are `probes.ts`'s, the paths are `capture.ts`'s, the one-at-a-time rule is
// `queue.ts`'s. It acts through one seam, the runner (absent, every capture is refused `no-runner`).
//
// A submission is answered with `capture.state` frames: `refused` with its typed reason and sentence (nothing queued), or
// `queued` with its position, then `running`, then `ended` with the runner's verdict, or with none and why when the
// runner could not judge (it answered no verdict, or threw). Every answer echoes the submission's build.
//
// THE REFUSAL ORDER, pinned whole by `testbox-capture-desk.test.ts` (review 3226 F9): the role; the build (absent, or not a
// file the capture may run, `capture.ts#capturedBuildUsable`), before the runner, so a box with no runner still gets its
// build copied; the runner; the write guard; and last, at queueing, a capture id already used. The standing refusals are
// judged again when a waiting capture starts (a link may have moved while it waited). A capture that waited too long to
// answer before the fleet agent stops waiting, by the timing contract the runner itself was built from
// (`capture.ts#captureStartsLate`), is ended with no verdict and a word, never run (F8). While the box admits no work (a
// tool sync's takeover, or a drain: gate G2) no capture starts: every waiting one is ended with no verdict and a word,
// so none is started only to be cut off, and none holds a drain open.
//
// After each capture ends, the desk hands the builds still queued to the builds store's prune (`capture.ts#buildsToPrune`
// decides; the entry point acts), so a build a capture still needs is never removed.
import path from 'node:path';
import { CAPTURE_REFUSAL_SENTENCE, captureRecipeOf, type CaptureAnswer, type CaptureRecipe, type CaptureRefusal, type CaptureStateWord, type CaptureSubmit } from '../../../shared/claudeBuildCapture.js';
import {
  CAPTURE_CLOSED_DETAIL, CAPTURE_LATE_DETAIL, CAPTURE_TIMINGS, captureBuildsDir, capturedBuildUsable, captureStartsLate, captureWrites, capturePaths,
  type BuildFileFacts, type CaptureTimings,
} from './capture.js';
import { deliveryStartsLate } from './captureDelivery.js';
import type { CaptureRun } from './captureRunner.js';
import { writeRefusal, type ProbeRole } from './probes.js';
import { admit, cancel, EMPTY_QUEUE, enqueue, finish, positions, type QueueState } from './queue.js';

/** The runner as the desk sees it. `recipe` and `part` are the submission's (absent: build trust, as every caller before
 *  the delivery recipe calls it). `delivers`: whether it runs the delivery recipe (absent: it does not). */
export interface CaptureRunnerLike {
  run(captureId: string, build: string, recipe?: CaptureRecipe, part?: number): Promise<CaptureRun>;
  readonly delivers?: boolean;
}

/** Where a capture's frames go. */
export interface CaptureSink { send(frame: CaptureAnswer): void }

export interface CaptureDeskDeps {
  readonly role: ProbeRole;
  /** `null` until the runner is wired to the desk (the spec's third pull request). */
  readonly runner: CaptureRunnerLike | null;
  /** `CCRC_TESTBOX_ROOT`. */
  readonly root: string;
  /** The service's temporary directory, where each capture's tmux directory goes (`capture.ts#captureTmuxDir`). */
  readonly tmuxBase: string;
  /** The fleet accounts' config directories, read on each submission. */
  readonly fleetDirs: () => readonly string[];
  /** A path with its symlinks followed. */
  readonly realPath: (p: string) => string;
  /** What the build's file is, read without following a link at it (`capture.ts#BuildFileFacts`); `null` when unread. */
  readonly buildFacts: (file: string) => BuildFileFacts | null;
  /** The clock a capture's wait in the queue is measured on (default `Date.now`). */
  readonly now?: () => number;
  /** The timing contract the runner was built from (default `CAPTURE_TIMINGS`). */
  readonly timings?: CaptureTimings;
  /** Whether the box admits work now (the tool sync's `admitting`, gate G2); absent, always. */
  readonly admitting?: () => boolean;
  /** The builds store's prune, given the builds a capture still needs; absent, nothing. */
  readonly prune?: (inUse: readonly string[]) => void;
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

  /** Check role, build, runner and write guard. A missing build comes first even without a runner, so the server can copy it. */
  private standing(f: CaptureSubmit): CaptureRefusal | null {
    if (this.d.role !== 'test-box') return 'not-test-box';
    const paths = capturePaths(this.d.root, f.captureId, f.build, this.d.tmuxBase);
    // Only the box root's own path is resolved: a link at `captures`, at `builds` or at the build reads as absent.
    const realBuild = path.join(captureBuildsDir(this.d.realPath(this.d.root)), f.build);
    if (!capturedBuildUsable(this.d.buildFacts(paths.buildFile), realBuild)) return 'build-absent';
    if (this.d.runner === null) return 'no-runner';
    const fleet = this.d.fleetDirs().map((x) => this.d.realPath(x));
    // Every path the capture writes passes the probe desk's write guard, judged as it leads.
    return captureWrites(paths).map((p) => writeRefusal(this.d.realPath(p), fleet)).some((r) => r !== null) ? 'path-refused' : null;
  }

  private answer(f: CaptureSubmit, sink: CaptureSink, state: CaptureStateWord, rest: Partial<Pick<CaptureAnswer, 'refusal' | 'detail' | 'position' | 'result' | 'delivery'>> = {}): void {
    // A delivery capture's every frame carries `delivery` (null until its result); a build-trust frame carries none.
    const delivery = captureRecipeOf(f) === 'delivery' ? { delivery: null } : {};
    sink.send({ t: 'capture.state', captureId: f.captureId, build: f.build, state, refusal: null, detail: null, position: null, result: null, ...delivery, ...rest });
  }

  /** Whether a capture that waited `waited` would answer after the fleet agent stops waiting, on its recipe's worst case. */
  private late(f: CaptureSubmit, waited: number): boolean {
    const t = this.d.timings ?? CAPTURE_TIMINGS;
    return captureRecipeOf(f) === 'delivery' ? deliveryStartsLate(waited, t) : captureStartsLate(waited, t);
  }

  private refuse(f: CaptureSubmit, sink: CaptureSink, refusal: CaptureRefusal): void {
    this.answer(f, sink, 'refused', { refusal, detail: CAPTURE_REFUSAL_SENTENCE[refusal] });
  }

  /** A submission: refused with its typed reason, or queued. */
  /** Whether this desk runs the delivery recipe: its runner is wired, with the delivery driver (call 1148). */
  delivers(): boolean { return this.d.runner?.delivers === true; }

  submit(f: CaptureSubmit, sink: CaptureSink): void {
    const standing = this.standing(f);
    if (standing !== null) { this.refuse(f, sink, standing); return; }
    const q = this.used.has(f.captureId) ? null : enqueue(this.queue, { id: f.captureId, session: SESSION, kind: 'capture' });
    if (q === null) { this.refuse(f, sink, 'capture-id-used'); return; }
    this.queue = q;
    this.used.add(f.captureId);
    this.held.set(f.captureId, { f, sink, at: this.now() });
    this.answer(f, sink, 'queued', { position: positions(this.queue).get(f.captureId) ?? null });
    this.pump();
  }

  /** Start the capture the queue admits (one at a time); while the box admits no work, end every waiting one instead. */
  private pump(): void {
    if (!(this.d.admitting?.() ?? true)) {
      for (const e of this.queue.waiting) {
        const h = this.held.get(e.id)!;
        this.answer(h.f, h.sink, 'ended', { detail: CAPTURE_CLOSED_DETAIL });
        this.held.delete(e.id);
        this.queue = cancel(this.queue, e.id).state;
      }
      return;
    }
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
    if (standing === null && runner !== null && this.late(h.f, this.now() - h.at)) {
      // Its verdict would come after the fleet agent stopped waiting: ended with no verdict and the word, never run
      // (review 3226 F8). The decision is `capture.ts#captureStartsLate`'s.
      this.answer(h.f, h.sink, 'ended', { detail: CAPTURE_LATE_DETAIL });
    } else if (standing === null && runner !== null) {
      this.answer(h.f, h.sink, 'running');
      let run: CaptureRun;
      if (captureRecipeOf(h.f) === 'delivery') {
        // The delivery recipe (Desktop polish wave 178): its result rides `delivery`, never `result`.
        try { run = await runner.run(captureId, h.f.build, 'delivery', h.f.part ?? 0); } catch { run = { result: null, delivery: null, detail: RUNNER_FAILED }; }
        const d = run.delivery ?? null;
        this.answer(h.f, h.sink, 'ended', d !== null ? { delivery: d } : { detail: run.detail ?? RUNNER_FAILED });
      } else {
        try { run = await runner.run(captureId, h.f.build); } catch { run = { result: null, detail: RUNNER_FAILED }; }
        this.answer(h.f, h.sink, 'ended', run.result !== null ? { result: run.result } : { detail: run.detail ?? RUNNER_FAILED });
      }
    } else {
      this.refuse(h.f, h.sink, standing ?? 'no-runner');
    }
    this.held.delete(captureId);
    this.queue = finish(this.queue, captureId);
    try { this.d.prune?.([...this.held.values()].map((x) => x.f.build)); } catch (e) {
      console.warn(`ccrc-testbox: the builds store was not pruned: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.pump();
  }

  /** No capture waiting or running. */
  idle(): boolean { return this.queue.waiting.length === 0 && this.queue.running.length === 0; }

  /** Every capture started so far has ended (tests and the service's stop wait on it). */
  async settled(): Promise<void> {
    while (this.driving.size > 0) await Promise.all([...this.driving]);
  }
}
