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
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  RunCancel, RunLog, RunSubmit, RunSummary, StatusAnswer, TestboxFrame, TestboxFrameType, TestboxRepoRow, TestboxSync,
  TestboxToolVersions,
} from '../../../shared/testbox.js';
import type { MirrorOps } from './mirror.js';
import { admit, cancel as queueCancel, enqueue, EMPTY_QUEUE, finish, positions, queueCounts, type QueueState } from './queue.js';
import { lastLine, logTail, OUTPUT_DRAIN_MS, OutputTail, PREPARE_STDERR, readReport, RUN_LOG, SLOT_OUTPUT_FILES } from './results.js';
import {
  cleaned, heldUsers, installStep, liveRunIds, makePool, queuedRun, retentionPlan, retrySweep, startupSweep, step, takeUser,
  type InstallStep, type KeptRun, type Pool, type RunAct, type RunEvent, type RunState,
} from './runs.js';
import {
  adopt, buildEnded, buildQueued, copyEnded, due, emptyStore, expire, nodeChanged, pristineLists, seen, undoom,
  type InstallInput, type PristineSettings, type PristineStore,
} from './pristine.js';
import { buildInstallSpec, buildRunSpec, runPaths, writeInstallSpec, writeSpec, type RunSpec, type SpecSettings } from './spec.js';
import { statusAnswer, type ProbeResult, type StatusFacts } from './status.js';
import { units, type SystemManager, type UnitEnd } from './systemd.js';

/** The settings the run manager reads, all from `config.ts`. */
export interface ServiceSettings extends SpecSettings {
  readonly runs: number;
  readonly sessionRuns: number;
  readonly logTail: number;
  readonly retentionMs: number;
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
  /** The box's measured tool versions; the tool sync (TB6) measures them, and until then there are none. */
  readonly tools?: () => TestboxToolVersions | null;
  /** The pristine installs (TB5, D-7543); absent, every run installs nothing beyond its prepare. */
  readonly pristine?: PristineDeps;
}

/** What the pristine store needs from outside (D-7543). */
export interface PristineDeps {
  readonly settings: PristineSettings;
  /** A run's install inputs at its tree in the mirror, in the given order; `null` when one cannot be read. */
  readonly inputs: (mirror: string, runId: string, paths: readonly string[]) => Promise<InstallInput[] | null>;
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

/** A connection, as the dispatch table sees it. */
export interface Conn extends RunSink {
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

/** UTC ISO 8601 to the second, as the status frame carries a time. */
const utcSecond = (ms: number): string => new Date(ms).toISOString().replace(/\.[0-9]{3}Z$/, 'Z');

export class TestboxService {
  private queue: QueueState = EMPTY_QUEUE;
  private pool: Pool;
  private readonly runs = new Map<string, Run>();
  private reflink: ProbeResult = { ok: false, detail: 'not probed yet' };
  private readonly firstSeen = new Map<string, number>();
  private readonly sync: TestboxSync = { state: 'idle', detail: null, at: null };
  private readonly fleetTools: TestboxToolVersions | null = null;
  private readonly driving = new Set<Promise<void>>();
  private store: PristineStore | null;

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
    });
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

  private runIdUsed(id: string): boolean {
    return this.runs.has(id) || existsSync(path.join(this.s.root, 'results', id)) || existsSync(path.join(this.s.root, 'logs', id));
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
    this.queue = q;
    this.runs.set(f.runId, { state: queuedRun(f.runId), submit: f, row, sink: conn, spec: null, prepareExit: null, prepareMs: 0, wallMs: 0 });
    mkdirSync(path.join(this.s.root, 'logs', f.runId), { recursive: true });
    this.pump();
  }

  /** A cancel (the session's Ctrl-C, or a lost run): a waiting run leaves the queue, a running one is stopped and then
   *  cleaned up as any run is. */
  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) return;
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
    const limits = { runs: Math.max(0, this.s.runs - this.held()), sessionRuns: this.s.sessionRuns };
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

  /** Every run started so far has ended (tests and the takeover wait on it). */
  async idle(): Promise<void> {
    while (this.driving.size > 0) await Promise.all([...this.driving]);
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

  /** Results, logs and refs past `CCRC_TESTBOX_RETENTION` deleted; refs only once their run's directory is gone. */
  async retention(): Promise<void> {
    const now = this.d.now();
    const kept = new Map<string, { at: number; results: boolean; logs: boolean; refs: boolean }>();
    const entry = (id: string) => {
      let e = kept.get(id);
      if (e === undefined) { e = { at: Number.POSITIVE_INFINITY, results: false, logs: false, refs: false }; kept.set(id, e); }
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
    for (const r of this.d.rows) {
      if (!existsSync(path.join(r.mirrorPath, 'HEAD'))) continue;
      for (const id of await this.d.mirror.runIds(r.mirrorPath)) {
        if (!this.firstSeen.has(id)) this.firstSeen.set(id, now);
        const e = entry(id);
        e.refs = true;
        refsIn.set(id, [...(refsIn.get(id) ?? []), r.mirrorPath]);
      }
    }
    const list: KeptRun[] = [...kept].map(([runId, e]) => ({
      runId, results: e.results, logs: e.logs, refs: e.refs,
      at: Number.isFinite(e.at) ? e.at : (this.firstSeen.get(runId) ?? now),
    }));
    const live = new Set([...liveRunIds(this.pool), ...this.runs.keys()]);
    const plan = retentionPlan(list, live, now, this.s.retentionMs);
    for (const id of plan.results) rmSync(path.join(this.s.root, 'results', id), { recursive: true, force: true });
    for (const id of plan.logs) rmSync(path.join(this.s.root, 'logs', id), { recursive: true, force: true });
    const touched = new Set<string>();
    for (const id of plan.refs) {
      for (const m of refsIn.get(id) ?? []) { await this.d.mirror.deleteRefs(m, id); touched.add(m); }
      this.firstSeen.delete(id);
    }
    for (const m of touched) await this.d.mirror.gc(m);
  }

  /** The timer's work: fetch, sweep, retention, and the pristine store's (a new node version, unused keys, builds
   *  whose next attempt has come). */
  async tick(): Promise<void> {
    await this.fetchMirrors().catch(() => undefined);
    await this.sweep();
    await this.retention().catch(() => undefined);
    this.pristineTick();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Pristine installs (TB5, D-7407, D-7543; spec §2.2 "Pristine installs").
  // -------------------------------------------------------------------------------------------------------------

  /** Each package's install step for a run, in the row's install order; every key named is used now. */
  private async installSteps(run: Run, runDir: string): Promise<InstallStep[]> {
    const pd = this.d.pristine!;
    const steps: InstallStep[] = [];
    for (const pkg of run.row.packages) {
      const inputs = await pd.inputs(run.row.mirrorPath, run.submit.runId, pkg.installInputs).catch(() => null);
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
};
