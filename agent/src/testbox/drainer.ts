// D-8907 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.5 "The drain"). L4: the drain's
// driver. The drain's rules are `drain.ts`'s (L1): whether a lease stands and when it ends (`leaseStep`), and what the
// answer says (`drainAnswer`: `idle` only with nothing in progress and the queue on disk). This driver reads the
// request file, hands the reading to the decider, and carries out the lease it answers. What it keeps for itself is
// the order of its own acts and its file housekeeping, none of them a rule of the drain: it asks for the hand-over
// only once the service says nothing is in progress (the hand-over takes the runs out of the queue, so it comes
// last), it removes an answer a service before this one left, and it does not rewrite an answer that already says
// the same. The request's and the answer's text are `boxFiles.ts`'s, the files are opened by `boxFs.ts`, and the
// queue's hand-over to disk is the tool sync driver's (`toolsync.ts`, the hand-over directory's one writer and
// reader), reached through the entry point's wiring.
//
// One pass (`poll`, on the entry point's timer and once before the service starts):
// - no lease: the service is as it always was. A lease that just ended (withdrawn, or out of time) removes the answer
//   and reopens admission: the handed-over runs are queued again, in their order.
// - a lease: admission is closed (`closed`, which the tool sync's `admitting` reads). While anything is in progress
//   the answer says `draining` and how many runs; once nothing is, the queue is written to disk and the answer says
//   `idle` and how many runs are there. A hand-over that cannot be written leaves the answer at `draining`: the
//   updater goes on only when the queue is on disk.
// A run submitted while a lease stands still queues (`queued`, called by the service in the same turn): when nothing
// is in progress it goes to disk at once and the answer counts it, so the updater's stop loses no run.
//
// Every pass is synchronous: nothing of the service's runs between its reading and its acts. No act here throws: a
// request that cannot be read and an answer that cannot be written are said once per lease, on stderr.
import path from 'node:path';
import { DRAIN_ANSWER_FILE, encodeDrainAnswer } from './boxFiles.js';
import type { BoxFs } from './boxFs.js';
import { drainAnswer, drainOpen, leaseStep, OPEN_DRAIN, requestRead, type DrainState } from './drain.js';

export interface DrainerDeps {
  /** The request file, which root writes and the service only reads. */
  readonly requestFile: string;
  /** The service's own runtime directory: the answer is written here. */
  readonly runtimeDir: string;
  readonly now: () => number;
  readonly fs: BoxFs;
  /** One line for the journal; stderr unless a test passes its own. */
  readonly log?: (line: string) => void;
}

/** What the driver needs of the service it drains (the entry point's wiring to the service and its tool sync). */
export interface DrainedService {
  /** No run, pristine build or capture is in progress, and the tool sync is not moving the box. */
  quiet(): boolean;
  /** The runs in progress, for the answer. */
  running(): number;
  /** The queue to disk and out of the service; returns how many handed-over runs are on disk. Throws when it cannot. */
  handOver(): number;
  /** Admission is open again: the handed-over runs are queued, in their order, and the queue is pumped. */
  reopen(): void;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class Drainer {
  private state: DrainState = OPEN_DRAIN;
  private svc: DrainedService | null = null;
  /** A leftover answer of a service before this one may still be in the runtime directory. */
  private fresh = true;
  /** What was already said about the lease held now (each once). */
  private readonly said = new Set<string>();

  constructor(private readonly d: DrainerDeps) {}

  /** The service this driver drains; set once, by the entry point. */
  serve(svc: DrainedService): void { this.svc = svc; }

  private get answerFile(): string { return path.join(this.d.runtimeDir, DRAIN_ANSWER_FILE); }

  private log(line: string): void { (this.d.log ?? console.error)(`ccrc-testbox: ${line}`); }

  private once(key: string, line: string): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.log(line);
  }

  /** A drain request stands: no waiting run starts, and no handed-over run is queued. */
  closed(): boolean { return !drainOpen(this.state); }

  /** One pass: the request read, the lease decided, its acts done. */
  poll(): void {
    try {
      const read = requestRead(this.d.fs.read(this.d.requestFile));
      const before = this.state.lease;
      const step = leaseStep(this.state, read, this.d.now());
      this.state = step.state;
      if (read.t === 'unreadable' || read.t === 'malformed') this.once(`request:${read.t}:${read.why}`, `the drain request is ${read.t} (${read.why}); it starts no drain and ends none early`);
      if (step.ended !== null) {
        this.log(`the drain for act ${before?.actId ?? '?'} is over (${step.ended}); the box takes runs again`);
        this.said.clear();
        this.clearAnswer();
        try { this.svc?.reopen(); } catch (e) { this.log(`the handed-over runs could not be queued again (${message(e)}); the timer tries again`); }
      }
      const lease = this.state.lease;
      if (lease === null) {
        if (this.fresh) this.clearAnswer();
      } else {
        if (before === null || before.actId !== lease.actId) this.log(`draining for act ${lease.actId}: no waiting run starts until the request is withdrawn or its deadline passes`);
        this.reconcile();
      }
      this.fresh = false;
    } catch (e) {
      this.log(`the drain pass failed (${message(e)})`);
    }
  }

  /** The service queued a submission: while a lease stands and nothing is in progress, it goes to disk now. */
  queued(): void {
    try { this.reconcile(); } catch (e) { this.log(`the drain pass failed (${message(e)})`); }
  }

  /** The service is stopping: its answer goes with it. */
  retire(): void { this.clearAnswer(); }

  private clearAnswer(): void { this.d.fs.remove(this.answerFile); }

  /** While a lease stands: the queue on disk once nothing is in progress, and the answer as it now reads. With no
   *  lease it does nothing: the service is as it always was. */
  private reconcile(): void {
    const lease = this.state.lease;
    const svc = this.svc;
    if (lease === null || svc === null) return;
    const quiet = svc.quiet();
    let onDisk: number | null = null;
    if (quiet) {
      try { onDisk = svc.handOver(); } catch (e) { this.once('handover', `the queued runs could not be handed over (${message(e)}); the drain stays at draining and tries again`); }
    }
    const text = encodeDrainAnswer(drainAnswer(lease, quiet, svc.running(), onDisk));
    // Written only when the file does not already say it: an answer something removed is written again.
    const now = this.d.fs.read(this.answerFile);
    if (now.t === 'text' && now.text === text) return;
    try {
      this.d.fs.write(this.d.runtimeDir, DRAIN_ANSWER_FILE, text);
    } catch (e) {
      this.once('answer', `the drain answer could not be written to ${this.answerFile} (${message(e)}); the updater sees no answer`);
    }
  }
}

const attached = new WeakMap<object, Drainer>();

/** The driver that drains `svc` (the entry point attaches one per service). */
export function attachDrainer(svc: object, d: Drainer): void { attached.set(svc, d); }

/** The driver attached to `svc`, or `undefined`. */
export function drainerOf(svc: object): Drainer | undefined { return attached.get(svc); }
