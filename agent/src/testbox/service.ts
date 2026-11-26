// D-7406, D-7420, D-7428, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.2, §2.5,
// §2.8, §2.9). L4: the test service's run manager and its frame dispatch table. It decides nothing itself: the queue
// (`queue.ts`), the run user pool, the lifecycle and retention (`runs.ts`) and the status answer (`status.ts`) are
// L1 deciders; it acts through the system manager (`systemd.ts`), the mirror (`mirror.ts`), the spec file
// (`spec.ts`) and the output and report readers (`results.ts`). TB5 and TB6 each add one line to `FRAME_HANDLERS`.
//
// D-7407, D-7543 (TB5): no frame carries pristine-install work, so TB5 adds no `FRAME_HANDLERS` line; it wires the
// pristine store (`pristine.ts`) into the run manager through the optional `pristine` dependency instead. With it, a
// prepare's spec names each package's install step (`runs.ts#installStep`: a clone of the key's pristine install, or
// `npm ci --prefer-offline` in the run's copy and the key queued), a queued key is built in the install unit as a
// `pristine` queue entry (one at a time, counting as one run), the status answer lists the present and failed keys,
// and the timer queues due builds and expires unused keys. Without it every run is as TB4 built it.
//
// What a client sees (D-7501): the hello is answered with the status answer (the frame family has no status request);
// a `run.submit` is queued and then streamed as `run.log` frames and one `run.summary`; a submission the box will not
// run is refused, and the connection closes with the reason. A run keeps going when its connection drops; positions
// are decided (`queue.ts#positions`) and reach a client when a later task adds the frame that carries them.
//
// D-8290 (plan docs/superpowers/plans/2026-11-11-live-probe-budget.md): a `probe.submit` goes to the probe desk
// (`probeDesk.ts`, the optional `probes` dependency), which answers it with `probe.state` frames; the status answer
// carries the desk's block when the box names a probe config directory. A service without a desk refuses the frame.
//
// D-8907 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.5 "The drain"): the service stays
// up through a drain, so it gives the drain's driver (`drainer.ts`) what a takeover never needed: whether anything is
// in progress (`quiet`), the waiting runs taken out of the queue once they are on disk (`forgetWaiting`), and a pump
// when admission reopens (`admitNow`). It tells the driver of each submission it queues (`queued`), and hands it a
// cancel for a run it no longer holds (`cancelHandedOver`). A run that waits on disk keeps its id (`handedOver`,
// asked by `runIdUsed`, the one owner of "two runs never share one id"). No frame carries any of it.
//
// D-9004 to D-9007 (plan docs/superpowers/plans/2026-11-24-testbox-retention.md): retention is one owner of what the
// box keeps. A run id that has refs and no results or logs (a push the box then refused) is timed from its first
// sight, a stamp under `<root>/refs-seen/` that a restart keeps; a run handed over to disk keeps its refs; the
// registry proxy's cache loses each file not served for `CCRC_TESTBOX_REGISTRY_KEEP`; and the tick says when an arm
// fails instead of dropping it.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CaptureAnswer, CaptureSubmit } from '../../../shared/claudeBuildCapture.js';
import type {
  ProbeAnswer, ProbeSubmit, RunCancel, RunLog, RunSubmit, RunSummary, StatusAnswer, TestboxFrame, TestboxFrameType, TestboxRepoPackage,
  TestboxRepoRow, TestboxSync, TestboxToolVersions,
} from '../../../shared/testbox.js';
import type { MirrorOps } from './mirror.js';
import type { CaptureDesk } from './captureDesk.js';
import type { ProbeDesk } from './probeDesk.js';
import { admit, cancel as queueCancel, enqueue, EMPTY_QUEUE, finish, positions, queueCounts, type QueueState } from './queue.js';
import { cachedFiles, dropCached, registryCacheDir } from './registry.js';
import { lastLine, logTail, OUTPUT_DRAIN_MS, OutputTail, PREPARE_STDERR, readReport, RUN_LOG, SLOT_OUTPUT_FILES } from './results.js';
import {
  cleaned, heldUsers, installStep, liveRunIds, makePool, queuedRun, registryPlan, retentionPlan, retrySweep, startupSweep, step, takeUser,
  type InstallStep, type KeptRun, type Pool, type RunAct, type RunEvent, type RunState,
} from './runs.js';
import {
  adopt, buildEnded, buildQueued, copyEnded, due, emptyStore, expire, lifecycleInputPaths, nodeChanged, pristineLists, seen, undoom,
  type InstallInput, type PristineSettings, type PristineStore,
} from './pristine.js';
import { buildInstallSpec, buildRunSpec, runPaths, writeInstallSpec, writeSpec, type RunSpec, type SpecSettings } from './spec.js';
import { statusAnswer, type MeasuredTools, type ProbeResult, type StatusFacts } from './status.js';
import { units, type SystemManager, type UnitEnd } from './systemd.js';

/** The settings the run manager reads, all from `config.ts`. */
export interface ServiceSettings extends SpecSettings {
  readonly runs: number;
  readonly sessionRuns: number;
  readonly logTail: number;
  readonly retentionMs: number;
  /** D-9007: a registry proxy cache file not served this long is deleted (`CCRC_TESTBOX_REGISTRY_KEEP`). */
  readonly registryKeepMs: number;
  /** How often a run's output tail drains besides its watchers; `results.ts#OUTPUT_DRAIN_MS` when unset. */
  readonly outputDrainMs?: number;
}

export interface ServiceDeps {
  readonly settings: ServiceSettings;
  readonly rows: readonly TestboxRepoRow[];
  readonly sys: SystemManager;
  readonly probe: () => Promise<ProbeResult>;
  readonly mirror: MirrorOps;
  readonly now: () => number;
  /** `<tools>/current/chrome`, read when each prepare starts (TB6: the entry point resolves it on each read). */
  readonly chrome: string;
  readonly release: string | null;
  readonly serviceVersion: string;
  /** The box's measured tool versions; the tool sync (TB6) measures them, and until then there are none. On a managed
   *  box they are its updater's, a tool it could not measure `null` alone (spec 2026-11-22 §2.6). */
  readonly tools?: () => MeasuredTools | null;
  /** The pristine installs (TB5, D-7543); absent, every run installs nothing beyond its prepare. */
  readonly pristine?: PristineDeps;
  /** Whether a waiting run may start now (TB6, D-7426: a tool-sync takeover closes admissions while submissions still
   *  queue); absent, always. The run limit the status answer reports stays the configured one. */
  readonly admitting?: () => boolean;
  /** A run's spec is built, in the same turn and before its prepare awaits anything (TB6, spec §2.10: the tool sync
   *  pins the set the spec's `PATH` names, so no sync prunes it before the spec is written); absent, nothing. */
  readonly specBuilt?: (spec: RunSpec) => void;
  /** The live probe desk (D-8290); absent, a `probe.submit` is refused and the status answer has no probe block. */
  readonly probes?: ProbeDesk;
  /** The build capture desk (spec 2026-11-22); absent, a `capture.submit` is refused. */
  readonly captures?: CaptureDesk;
  /** Where the service's notes go (D-8966: a lifecycle script it could not read for a package's install inputs; D-9005:
   *  a retention arm that failed); absent, stderr, as the drain's driver writes its own. */
  readonly log?: (line: string) => void;
  /** A submission was queued (D-8907: while a drain has the queue on disk, its driver writes this one there at once,
   *  so the updater's stop loses no run); absent, nothing. */
  readonly queued?: () => void;
  /** A cancel for a run this service does not hold (D-8907: a drain handed it over to disk, and its driver removes it
   *  there so it is not queued again); absent, nothing. */
  readonly cancelHandedOver?: (runId: string) => void;
  /** A run with this id waits on disk to be queued again (D-8907: a drain handed it over, or a takeover did and it
   *  waits for the timer), so the id is used; absent, never. */
  readonly handedOver?: (runId: string) => boolean;
}

/** What the pristine store needs from outside (D-7543). */
export interface PristineDeps {
  readonly settings: PristineSettings;
  /** A run's install inputs at its tree in the mirror, in the given order; `null` when one cannot be read. Each
   *  `optional` path follows them when the tree holds it as a regular file, and is skipped otherwise (D-8966). */
  readonly inputs: (mirror: string, runId: string, paths: readonly string[], optional?: readonly string[]) => Promise<InstallInput[] | null>;
  /** The node version the box's installs run under. */
  readonly node: () => string;
  readonly platform: string;
}

/** The queue's word for the service's own pristine builds. */
const PRISTINE_SESSION = 'pristine';

/** Where a run's frames go: the connection that submitted it, while it is open. */
export interface RunSink {
  send(frame: RunLog | RunSummary): void;
}

/** A connection, as the dispatch table sees it: a run's frames, or a probe's (D-8290). */
export interface Conn {
  send(frame: RunLog | RunSummary | ProbeAnswer | CaptureAnswer): void;
  /** Close the connection: the box will not take what it sent. */
  refuse(reason: string): void;
}

interface Run {
  state: RunState;
  readonly submit: RunSubmit;
  readonly row: TestboxRepoRow;
  sink: RunSink;
  spec: RunSpec | null;
  prepareExit: number | null;
  prepareMs: number;
  wallMs: number;
}

/** A unit end that could not be read is a failure, never a pass. */
const FAILED_END: UnitEnd = { exit: 255, result: 'unknown' };

/** D-9004: `<root>/refs-seen/<run-id>`, an empty file whose mtime is when retention first saw the run's refs. */
const REFS_SEEN = 'refs-seen';

/** UTC ISO 8601 to the second, as the status frame carries a time. */
const utcSecond = (ms: number): string => new Date(ms).toISOString().replace(/\.[0-9]{3}Z$/, 'Z');

export class TestboxService {
  private queue: QueueState = EMPTY_QUEUE;
  private pool: Pool;
  private readonly runs = new Map<string, Run>();
  private reflink: ProbeResult = { ok: false, detail: 'not probed yet' };
  private readonly sync: TestboxSync = { state: 'idle', detail: null, at: null };
  private readonly fleetTools: TestboxToolVersions | null = null;
  private readonly driving = new Set<Promise<void>>();
  private store: PristineStore | null;
  /** The notes already written (D-8966). */
  private readonly noted = new Set<string>();

  constructor(private readonly d: ServiceDeps) {
    this.pool = makePool(d.settings.runs);
    this.store = d.pristine === undefined ? null : emptyStore(d.pristine.node(), d.pristine.platform);
  }

  private get pristineRoot(): string { return path.join(this.s.root, 'pristine'); }

  private get s(): ServiceSettings { return this.d.settings; }

  /** Start: the service's own directories, the reflink probe and the start-up sweep (spec §2.2). */
  async start(): Promise<void> {
    for (const dir of ['specs', 'results', 'logs']) mkdirSync(path.join(this.s.root, dir), { recursive: true });
    for (let k = 1; k <= this.s.runs; k++) mkdirSync(path.join(this.s.root, 'out', String(k)), { recursive: true });
    this.reflink = await this.d.probe();
    const seen = [];
    for (let k = 1; k <= this.s.runs; k++) {
      seen.push({ k, runDir: existsSync(runPaths(this.s.root, k, '-').runDir), active: await this.anyActive(k) });
    }
    const swept = startupSweep(this.pool, seen);
    this.pool = swept.pool;
    for (const k of swept.clean) await this.cleanSlot(k);
    if (this.store !== null && existsSync(this.pristineRoot)) this.store = adopt(this.store, readdirSync(this.pristineRoot), this.d.now());
  }

  private async anyActive(k: number): Promise<boolean> {
    for (const u of [units.prepare(k), units.run(k), units.clean(k)]) {
      try { if (await this.d.sys.active(u)) return true; } catch { return true; }
    }
    return false;
  }

  private async unitRun(unit: string): Promise<UnitEnd> {
    try { return await this.d.sys.run(unit); } catch { return FAILED_END; }
  }

  /** One clean of slot `k`, and the pool told how it went. */
  private async cleanSlot(k: number): Promise<void> {
    const end = await this.unitRun(units.clean(k));
    const gone = !existsSync(runPaths(this.s.root, k, '-').runDir);
    this.pool = cleaned(this.pool, k, end.exit === 0, gone);
  }

  status(): StatusAnswer {
    const counts = queueCounts(this.queue);
    return statusAnswer({
      reflink: this.reflink,
      mirrors: this.d.rows.map((r) => ({ name: r.name, mirrorPath: r.mirrorPath, present: existsSync(path.join(r.mirrorPath, 'HEAD')) })),
      release: this.d.release, serviceVersion: this.d.serviceVersion, tools: this.d.tools?.() ?? null, fleetTools: this.fleetTools,
      sync: this.sync, inProgress: counts.inProgress, limit: this.s.runs, queueDepth: counts.queueDepth,
      ...this.pristineFacts(), heldRunUsers: heldUsers(this.pool, this.s.runUserPrefix),
      probes: this.d.probes?.configured() === true ? this.d.probes.view() : null,
    });
  }

  /** A capture submission: the desk's, or refused when this service has none. */
  capture(f: CaptureSubmit, conn: Conn): void {
    if (this.d.captures === undefined) { conn.refuse('capture.submit is not a frame this service takes'); return; }
    // A delivery submission to a box whose runner has no delivery driver is refused at the frame, before the desk: the
    // same close a box that predates the recipe gives, so the fleet agent answers not-taken for both, and nothing is
    // queued, run or counted here (the capture owner's call 1148).
    if (f.recipe === 'delivery' && !this.d.captures.delivers()) { conn.refuse('delivery is not a recipe this box runs'); return; }
    this.d.captures.submit(f, conn);
  }

  /** A probe submission (D-8290): the desk's, or refused when this service has none. */
  probe(f: ProbeSubmit, conn: Conn): void {
    if (this.d.probes === undefined) { conn.refuse('probe.submit is not a frame this service takes'); return; }
    this.d.probes.submit(f, conn);
  }

  private pristineFacts(): Pick<StatusFacts, 'pristine' | 'failedKeys'> {
    if (this.store === null) return { pristine: [], failedKeys: [] };
    const l = pristineLists(this.store);
    return {
      pristine: l.pristine,
      failedKeys: l.failed.map((f) => ({ repository: f.repository, package: f.package, key: f.key, exit: Math.min(FAILED_END.exit, f.exit), attempts: f.attempts, nextAttempt: utcSecond(f.nextAttemptAt) })),
    };
  }

  /** Each waiting run's position (spec §2.8). */
  positions(): ReadonlyMap<string, number> { return positions(this.queue); }

  /** The submissions waiting in the queue, in queue order, each the frame the service queued (TB6, D-7426: what a
   *  takeover hands to the next service); a refused submission is never one. */
  waitingSubmits(): RunSubmit[] {
    return this.queue.waiting.flatMap((e) => {
      const run = e.kind === 'run' ? this.runs.get(e.id) : undefined;
      return run === undefined ? [] : [run.submit];
    });
  }

  private runIdUsed(id: string): boolean {
    return this.runs.has(id) || existsSync(path.join(this.s.root, 'results', id)) || existsSync(path.join(this.s.root, 'logs', id))
      || (this.d.handedOver?.(id) ?? false);
  }

  /** A submission: refused with its reason, or queued. */
  submit(f: RunSubmit, conn: Conn): void {
    const row = this.d.rows.find((r) => r.name === f.repository);
    if (row === undefined) { conn.refuse(`this repository is not set up there (${f.repository})`); return; }
    if (this.runIdUsed(f.runId)) { conn.refuse(`run id ${f.runId} already used`); return; }
    const dry = buildRunSpec(f, row, 1, this.s, this.d.chrome);
    if (!dry.ok) { conn.refuse(dry.reason); return; }
    const q = enqueue(this.queue, { id: f.runId, session: f.session, kind: 'run' });
    if (q === null) { conn.refuse(`run id ${f.runId} already used`); return; }
    // D-7560: its log directory first, so a submission that throws was never queued (a hand-over file stays for it).
    mkdirSync(path.join(this.s.root, 'logs', f.runId), { recursive: true });
    this.queue = q;
    this.runs.set(f.runId, { state: queuedRun(f.runId), submit: f, row, sink: conn, spec: null, prepareExit: null, prepareMs: 0, wallMs: 0 });
    this.pump();
    this.d.queued?.();
  }

  /** No run, pristine build or capture is in progress (D-8907: what a drain waits for before it answers). */
  quiet(): boolean { return this.driving.size === 0 && (this.d.captures?.idle() ?? true); }

  /** How many runs and builds are in progress, as the status answer counts them (D-8907: the drain's answer). */
  inProgress(): number { return queueCounts(this.queue).inProgress; }

  /** D-8907: every waiting run leaves this service's queue, each with the connection its frames go to. The drain's
   *  driver calls it once those runs are on disk (`toolsync.ts#ToolSync.handOverWaiting`), so the queue has one home;
   *  the service takes each id afresh when the run is queued again. A waiting pristine build is the service's own and
   *  stays. */
  forgetWaiting(): Map<string, RunSink> {
    const out = new Map<string, RunSink>();
    for (const e of this.queue.waiting) {
      if (e.kind !== 'run') continue;
      const run = this.runs.get(e.id);
      if (run !== undefined) out.set(e.id, run.sink);
      this.runs.delete(e.id);
      this.queue = queueCancel(this.queue, e.id).state;
    }
    return out;
  }

  /** Admission reopened (D-8907: a drain's request was withdrawn or ran out): start what the queue admits. */
  admitNow(): void { this.pump(); }

  /** A cancel (the session's Ctrl-C, or a lost run): a waiting run leaves the queue, a running one is stopped and then
   *  cleaned up as any run is. */
  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) { this.d.cancelHandedOver?.(runId); return; }
    const { run: next, act } = step(run.state, { t: 'cancel' });
    run.state = next;
    if (act.t === 'drop') {
      this.queue = queueCancel(this.queue, runId).state;
      this.runs.delete(runId);
      rmSync(path.join(this.s.root, 'logs', runId), { recursive: true, force: true });
      return;
    }
    if (act.t === 'stop') await this.d.sys.stop(act.unit === 'prepare' ? units.prepare(act.k) : units.run(act.k)).catch(() => undefined);
  }

  private held(): number { return this.pool.filter((s) => s.state === 'held').length; }

  /** Start every run the queue admits. */
  private pump(): void {
    const open = this.d.admitting?.() ?? true;
    const limits = { runs: open ? Math.max(0, this.s.runs - this.held()) : 0, sessionRuns: this.s.sessionRuns };
    const { state, started } = admit(this.queue, limits);
    this.queue = state;
    for (const e of started) {
      const p = (e.kind === 'run' ? this.drive(e.id) : this.build(e.id)).finally(() => { this.driving.delete(p); });
      this.driving.add(p);
    }
  }

  /** One run, start to summary. */
  private async drive(runId: string): Promise<void> {
    const run = this.runs.get(runId)!;
    const taken = takeUser(this.pool, runId);
    if (taken === null) {
      // The queue admitted past the pool (it cannot, while `pump` counts held users out): put the run back first.
      this.queue = { waiting: [{ id: runId, session: run.submit.session, kind: 'run' }, ...this.queue.waiting], running: finish(this.queue, runId).running };
      return;
    }
    this.pool = taken.pool;
    let { run: state, act } = step(run.state, { t: 'admitted', k: taken.k });
    run.state = state;
    while (act.t !== 'summarise' && act.t !== 'none' && act.t !== 'drop' && act.t !== 'stop') {
      const ev = await this.act(run, act);
      ({ run: state, act } = step(run.state, ev));
      run.state = state;
    }
    this.summarise(run);
    this.queue = finish(this.queue, runId);
    this.pump();
  }

  private async act(run: Run, act: RunAct): Promise<RunEvent> {
    const k = 'k' in act ? act.k : 0;
    const p = runPaths(this.s.root, k, run.submit.runId);
    switch (act.t) {
      case 'start-prepare': {
        const built = buildRunSpec(run.submit, run.row, k, this.s, this.d.chrome);
        if (!built.ok) return { t: 'prepared', exit: FAILED_END.exit, lastStderr: null };
        this.d.specBuilt?.(built.spec);
        run.spec = { ...built.spec, ...(this.store === null ? {} : { installs: await this.installSteps(run, p.runDir) }) };
        writeSpec(this.s.root, run.spec);
        mkdirSync(p.out, { recursive: true });
        // The slot's output files are the last run's until a unit writes them again: a prepare that never ran its main
        // (an `ExecStartPre=` that refused) must not be given that run's reason, nor a run its output.
        for (const f of SLOT_OUTPUT_FILES) rmSync(path.join(p.out, f), { force: true });
        const t0 = this.d.now();
        const end = run.state.cancelled ? FAILED_END : await this.unitRun(units.prepare(k));
        run.prepareMs = Math.max(0, this.d.now() - t0);
        run.prepareExit = end.exit;
        for (const st of run.spec.installs ?? []) if (st.mode === 'clone' && st.key !== null && this.store !== null) this.store = copyEnded(this.store, st.key);
        this.queueBuilds();
        return { t: 'prepared', exit: end.exit, lastStderr: lastLine(path.join(p.out, PREPARE_STDERR)) };
      }
      case 'start-run': {
        const tail = new OutputTail(p.out, path.join(p.logs, RUN_LOG), (c) => {
          run.sink.send({ t: 'run.log', runId: run.submit.runId, offset: c.offset, stream: c.stream, bytes: c.bytes.toString('base64') });
        }, this.s.outputDrainMs ?? OUTPUT_DRAIN_MS);
        tail.watch();
        const t0 = this.d.now();
        const end = run.state.cancelled ? FAILED_END : await this.unitRun(units.run(k));
        tail.stop();
        run.wallMs = Math.max(0, this.d.now() - t0);
        return { t: 'ran', exit: end.exit };
      }
      case 'start-clean': {
        await this.cleanSlot(k);
        return { t: 'cleaned' };
      }
      default:
        return { t: 'cleaned' };
    }
  }

  private summarise(run: Run): void {
    const id = run.submit.runId;
    const p = runPaths(this.s.root, run.state.k ?? 0, id);
    const report = readReport(p.results, path.join(p.runDir, 'checkout'));
    const spec = run.spec;
    const failed = run.state.prepareFailed;
    const summary: RunSummary = {
      t: 'run.summary', runId: id,
      exit: Math.min(FAILED_END.exit, Math.max(0, run.state.exit ?? run.prepareExit ?? FAILED_END.exit)),
      failed: { files: report.files, tests: report.tests }, wallMs: run.wallMs, prepareMs: run.prepareMs,
      logTail: logTail(path.join(p.logs, RUN_LOG), this.s.logTail), ranOn: 'test-box',
      workers: spec?.workers ?? this.s.workers, localDefault: spec?.localDefault ?? null,
      builtOnBox: failed === null && run.state.exit !== null ? run.submit.outputs : [], report: report.report, prepareFailed: failed,
    };
    mkdirSync(p.results, { recursive: true });
    writeFileSync(path.join(p.results, 'summary.json'), `${JSON.stringify(summary)}\n`);
    this.runs.delete(id);
    run.sink.send(summary);
  }

  /** Every run and every capture started so far has ended (tests and the takeover wait on it). A tool sync's takeover
   *  replaces the release the capture's recorder runs from, so it waits for captures too (review 3226 F8). */
  async idle(): Promise<void> {
    do {
      while (this.driving.size > 0) await Promise.all([...this.driving]);
      await this.d.captures?.settled();
    } while (this.driving.size > 0);
  }

  /** The service's sweep: every held run user whose units are inactive is cleaned again (spec §2.2), then the queue is
   *  pumped, since a freed user may admit a waiting run. */
  async sweep(): Promise<void> {
    const active = new Set<number>();
    for (const s of this.pool) if (s.state === 'held' && await this.anyActive(s.k)) active.add(s.k);
    for (const k of retrySweep(this.pool, active)) await this.cleanSlot(k);
    this.pump();
  }

  /** The mirror fetch of every repository row, on `CCRC_TESTBOX_FETCH_EVERY`. */
  async fetchMirrors(): Promise<void> {
    for (const r of this.d.rows) if (existsSync(path.join(r.mirrorPath, 'HEAD'))) await this.d.mirror.fetch(r.mirrorPath);
  }

  /** Results, logs and refs past `CCRC_TESTBOX_RETENTION` deleted; refs only once their run's directory is gone and
   *  no run waiting on disk needs them (D-9006). A run in progress is never listed, so its log directory stays. */
  async retention(): Promise<void> {
    const now = this.d.now();
    const kept = new Map<string, { at: number; seen: number; results: boolean; logs: boolean; refs: boolean }>();
    const entry = (id: string) => {
      let e = kept.get(id);
      if (e === undefined) { e = { at: Number.POSITIVE_INFINITY, seen: now, results: false, logs: false, refs: false }; kept.set(id, e); }
      return e;
    };
    for (const kind of ['results', 'logs'] as const) {
      const dir = path.join(this.s.root, kind);
      if (!existsSync(dir)) continue;
      for (const id of readdirSync(dir)) {
        if (this.runs.has(id)) continue;
        const e = entry(id);
        e[kind] = true;
        e.at = Math.min(e.at, statSync(path.join(dir, id)).mtimeMs);
      }
    }
    const refsIn = new Map<string, string[]>();
    let everyMirror = true;
    // A stamp that cannot be read, written or removed is unmeasured: its run is timed from now for this pass only (its
    // refs kept), said once at the end, and the pass goes on, so a full root still loses its old results and logs.
    const unmeasured: string[] = [];
    const stampAct = (act: () => void): void => {
      try { act(); } catch (e) { unmeasured.push(e instanceof Error ? e.message : String(e)); }
    };
    for (const r of this.d.rows) {
      if (!existsSync(path.join(r.mirrorPath, 'HEAD'))) { everyMirror = false; continue; }
      for (const id of await this.d.mirror.runIds(r.mirrorPath)) {
        const e = entry(id);
        if (!e.refs) {
          const seen = this.refsFirstSeen(id, now);
          if (seen.kind === 'unmeasured') unmeasured.push(seen.reason);
          e.seen = seen.kind === 'unmeasured' ? now : seen.at;
        }
        e.refs = true;
        refsIn.set(id, [...(refsIn.get(id) ?? []), r.mirrorPath]);
      }
    }
    const list: KeptRun[] = [...kept].map(([runId, e]) => ({
      runId, results: e.results, logs: e.logs, refs: e.refs,
      at: Number.isFinite(e.at) ? e.at : e.seen,
    }));
    const live = new Set([...liveRunIds(this.pool), ...this.runs.keys()]);
    // D-9006: a run handed over to disk is queued again later and checks out its refs then; asked only of a run whose
    // refs are otherwise due, since each answer lists the hand-over directory.
    for (const r of list) if (r.refs && now - r.at >= this.s.retentionMs && this.d.handedOver?.(r.runId) === true) live.add(r.runId);
    const plan = retentionPlan(list, live, now, this.s.retentionMs);
    for (const id of plan.results) rmSync(path.join(this.s.root, 'results', id), { recursive: true, force: true });
    for (const id of plan.logs) rmSync(path.join(this.s.root, 'logs', id), { recursive: true, force: true });
    const touched = new Set<string>();
    const seenDir = path.join(this.s.root, REFS_SEEN);
    for (const id of plan.refs) {
      for (const m of refsIn.get(id) ?? []) { await this.d.mirror.deleteRefs(m, id); touched.add(m); }
      stampAct(() => rmSync(path.join(seenDir, id), { force: true }));
    }
    // A stamp whose refs are gone some other way goes too, but only on the word of every mirror. A mirror with no HEAD
    // yet (a row added before its clone) holds this sweep back for as long as it lasts; stamps are empty files.
    if (everyMirror && existsSync(seenDir)) {
      stampAct(() => { for (const id of readdirSync(seenDir)) if (!refsIn.has(id)) rmSync(path.join(seenDir, id), { force: true }); });
    }
    for (const m of touched) await this.d.mirror.gc(m);
    if (unmeasured.length > 0) {
      const n = unmeasured.length;
      this.failed('retention', `${n} refs-seen stamp${n === 1 ? '' : 's'} unmeasured, timed from now this pass (first: ${unmeasured[0]})`);
    }
  }

  /** D-9004: when retention first saw this run's refs, from its stamp; the first sight (a stamp proven absent) writes the
   *  stamp at `now`. A stamp that cannot be read is never re-stamped, and one that cannot be written is unmeasured, not
   *  a first sight: the caller times it from now for this pass only. A run whose results or logs are gone while its
   *  directory held its refs is timed from it then, as before. */
  private refsFirstSeen(runId: string, now: number): { kind: 'stamped'; at: number } | { kind: 'unmeasured'; reason: string } {
    const f = path.join(this.s.root, REFS_SEEN, runId);
    try {
      return { kind: 'stamped', at: statSync(f).mtimeMs };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { kind: 'unmeasured', reason: e instanceof Error ? e.message : String(e) };
    }
    try {
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, '');
      const t = new Date(now);
      utimesSync(f, t, t);
      return { kind: 'stamped', at: now };
    } catch (e) {
      return { kind: 'unmeasured', reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** D-9007: every registry proxy cache file not served for `CCRC_TESTBOX_REGISTRY_KEEP` deleted. Synchronous, as the
   *  proxy's own reads and writes are, so it never falls between one of theirs. */
  registryRetention(): void {
    const dir = registryCacheDir(this.s.root);
    dropCached(dir, registryPlan(cachedFiles(dir), this.d.now(), this.s.registryKeepMs));
  }

  /** D-9005: a failed arm of the tick, said once per tick, the tool sync's way. */
  private failed(arm: string, e: unknown): void {
    (this.d.log ?? console.error)(`ccrc-testbox: ${arm}: ${e instanceof Error ? e.message : String(e)}`);
  }

  /** The timer's work: fetch, sweep, retention, the registry cache's, and the pristine store's (a new node version, unused keys, builds
   *  whose next attempt has come). */
  async tick(): Promise<void> {
    await this.fetchMirrors().catch(() => undefined);
    await this.sweep();
    await this.retention().catch((e: unknown) => this.failed('retention', e));
    try { this.registryRetention(); } catch (e) { this.failed('registry retention', e); }
    this.pristineTick();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Pristine installs (TB5, D-7407, D-7543; spec §2.2 "Pristine installs").
  // -------------------------------------------------------------------------------------------------------------

  /** Each package's install step for a run, in the row's install order; every key named is used now. */
  private async installSteps(run: Run, runDir: string): Promise<InstallStep[]> {
    const steps: InstallStep[] = [];
    for (const pkg of run.row.packages) {
      const inputs = await this.installInputs(run, pkg).catch(() => null);
      let key: string | null = null;
      let present = false;
      if (inputs !== null && this.store !== null) {
        const r = seen(this.store, run.row.name, pkg.name, inputs, this.d.now());
        this.store = r.store;
        key = r.key;
        present = r.present;
      }
      steps.push(installStep(pkg.name, key, present, this.pristineRoot, path.join(runDir, 'checkout')));
    }
    return steps;
  }

  /** D-8966: a package's install inputs at the run's tree: the row's, in its order, then the files its lifecycle
   *  scripts run (`pristine.ts#lifecycleInputPaths` decides which to look for; the mirror read keeps the regular
   *  files). `null` when one cannot be read, so the run installs in its own copy and no key is queued. */
  private async installInputs(run: Run, pkg: TestboxRepoPackage): Promise<InstallInput[] | null> {
    const pd = this.d.pristine!;
    const declared = await pd.inputs(run.row.mirrorPath, run.submit.runId, pkg.installInputs);
    if (declared === null) return null;
    const manifest = declared.find((i) => i.path === `${pkg.name}/package.json`)?.bytes ?? null;
    const derived = lifecycleInputPaths(pkg.name, manifest, pkg.installInputs);
    for (const n of derived.notes) this.note(`${run.row.name}: ${n}`);
    if (derived.paths.length === 0) return declared;
    const found = await pd.inputs(run.row.mirrorPath, run.submit.runId, [], derived.paths);
    return found === null ? null : [...declared, ...found];
  }

  /** A note, once per service for each distinct line, so a row's unreadable script is not said on every run. */
  private note(line: string): void {
    if (this.noted.has(line)) return;
    this.noted.add(line);
    (this.d.log ?? console.error)(`ccrc-testbox: ${line}`);
  }

  /** Every due key queued as a `pristine` entry, then the queue pumped. */
  private queueBuilds(): void {
    if (this.store === null) return;
    for (const key of due(this.store, this.d.now())) {
      const q = enqueue(this.queue, { id: key, session: PRISTINE_SESSION, kind: 'pristine' });
      if (q === null) continue;
      this.queue = q;
      this.store = buildQueued(this.store, key);
    }
    this.pump();
  }

  private pristineTick(): void {
    const pd = this.d.pristine;
    if (pd === undefined || this.store === null) return;
    const now = this.d.now();
    this.store = expire(nodeChanged(this.store, pd.node(), now), now, pd.settings.keepMs);
    this.queueBuilds();
  }

  /** One key's build: the install unit (its first step lays the inputs out fresh and removes the doomed keys; on
   *  success its last step moves `node_modules` to `pristine/<key>`), then, whatever the end, `clean@install`. */
  private async build(key: string): Promise<void> {
    const entry = this.store?.entries.find((e) => e.key === key);
    let exit: number = FAILED_END.exit;
    if (entry !== undefined && entry.package !== null && this.store !== null) {
      const doomed = [...this.store.doomed];
      writeInstallSpec(this.s.root, buildInstallSpec(key, entry.package, entry.inputs, doomed, this.s));
      const p = runPaths(this.s.root, 'install', '-');
      mkdirSync(p.out, { recursive: true });
      // A build the service lost (a restart mid-build) left `install/run`; the first step refuses to reuse it.
      if (existsSync(p.runDir)) await this.unitRun(units.clean('install'));
      exit = (await this.unitRun(units.install())).exit;
      await this.unitRun(units.clean('install'));
      this.store = undoom(this.store, doomed);
    }
    if (this.store !== null) this.store = buildEnded(this.store, key, exit, this.d.now(), this.d.pristine!.settings.retryMs);
    this.queue = finish(this.queue, key);
    this.pump();
  }

  /** For the tests and the status rows: the pool as it stands. */
  poolNow(): Pool { return this.pool; }
}

// ---------------------------------------------------------------------------------------------------------------
// The frame dispatch table (spec §2.9): the frames a client may send after its hello. TB5 and TB6 add one line each.
// ---------------------------------------------------------------------------------------------------------------

export type FrameHandler = (svc: TestboxService, frame: TestboxFrame, conn: Conn) => void | Promise<void>;

export const FRAME_HANDLERS: Readonly<Partial<Record<TestboxFrameType, FrameHandler>>> = {
  'run.submit': (svc, f, conn) => svc.submit(f as RunSubmit, conn),
  'run.cancel': (svc, f) => svc.cancel((f as RunCancel).runId),
  'tools.sync': async (svc, f, conn) => (await import('./toolsync.js')).onToolsSync(svc, f, conn),
  'probe.submit': (svc, f, conn) => svc.probe(f as ProbeSubmit, conn),
  'capture.submit': (svc, f, conn) => svc.capture(f as CaptureSubmit, conn),
};
