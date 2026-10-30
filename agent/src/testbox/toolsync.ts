// D-7408, D-7426, D-7553, D-7559 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB6; spec §2.10). L4: the tool sync's
// driver. It decides nothing itself (`tools.ts`, L1, does); it writes `specs/tools`, starts the static root unit
// `ccrc-testbox-tools.service` through the system manager and reads the unit's report, `<tools>/sync-report`, and the
// current set's `versions`. The service's frame table reaches it by one line (`service.ts#FRAME_HANDLERS`), through
// the driver attached to that service here (`attachToolSync`, by the entry point).
//
// The takeover (D-7426, D-7559): a sync that replaced the release closes the service's admissions (`admitting()`, which
// the entry point hands the service; submissions still queue, and the status answer keeps the configured run limit),
// waits for the runs in progress to end, hands every queued run, as the service queued it, to the next service
// (`<root>/handover/`, which that service queues at its start, in the same order) and exits 0, so the service manager
// restarts the service on the new tree and queued runs wait for it. A new node version queues every
// pristine key's rebuild at once, by one tick of the service's timer work (the pristine store reads the box's node
// from this driver); that tick and the timer's own run one after the other, never at once (`serviceTick`).
import { mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  readTestboxFrame,
  type RunLog, type RunSubmit, type RunSummary, type StatusAnswer, type TestboxFrame, type TestboxSync, type TestboxToolVersions, type ToolsSync,
} from '../../../shared/testbox.js';
import { units, type SystemManager } from './systemd.js';
import {
  ended, IDLE_TOOLS, encodeToolsSpec, INSTALL_SETS_KEY, keptSets, parseReport, parseVersions, requested, retryDue, retryStarted, seenRuns,
  specSet, syncNow, withSync, type BoxTools, type ToolsSettings, type ToolsState,
} from './tools.js';

/** What the driver needs of the service it serves (the service itself, in the entry point). */
export interface ServedService {
  status(): StatusAnswer;
  /** Every run started so far has ended. */
  idle(): Promise<void>;
  /** The service's timer work, which queues the pristine rebuilds a node change makes due. */
  tick(): Promise<void>;
  /** The run ids that hold a run user now. */
  liveRuns(): Iterable<string>;
  /** The submissions waiting in the queue, in queue order, each as the service queued it. */
  waiting(): Iterable<RunSubmit>;
  /** A submission, as a connection's `run.submit` reaches the service. */
  submit(f: RunSubmit, conn: { send(frame: RunLog | RunSummary): void; refuse(reason: string): void }): void;
}

/** Under `CCRC_TESTBOX_ROOT`: the queued runs a takeover hands to the next service (D-7426). */
export const HANDOVER_DIR = 'handover';

export interface ToolSyncDeps {
  readonly sys: SystemManager;
  /** `CCRC_TESTBOX_ROOT`: `specs/tools` is written there. */
  readonly root: string;
  /** `CCRC_TESTBOX_TOOLS_DIR`. */
  readonly toolsDir: string;
  readonly settings: ToolsSettings;
  readonly now: () => number;
  /** The takeover's end: the process exits so the service manager starts the new tree. */
  readonly exit: (code: number) => void;
}

/** UTC ISO 8601 to the second, as the status frame carries a time. */
const utcSecond = (ms: number): string => new Date(ms).toISOString().replace(/\.[0-9]{3}Z$/, 'Z');

const readText = (f: string): string | null => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const listDir = (d: string): string[] => { try { return readdirSync(d); } catch { return []; } };
const linkName = (f: string): string | null => { try { return path.basename(readlinkSync(f)); } catch { return null; } };

export class ToolSync {
  private state: ToolsState = IDLE_TOOLS;
  private svc: ServedService | null = null;
  private running: Promise<void> | null = null;
  /** The service's timer work in progress or last run: each `serviceTick` runs after it. */
  private ticked: Promise<void> = Promise.resolve();
  /** `<tools>/current` as resolved in this turn of the event loop (`undefined`: not yet): a prepare reads its Chrome
   *  and its PATH in one synchronous turn, so both come from one reading, whichever it reads first. */
  private turnSet: string | null | undefined = undefined;

  constructor(private readonly d: ToolSyncDeps) {}

  /** The service this driver serves; set once, by the entry point. */
  serve(svc: ServedService): void { this.svc = svc; }

  private get reportFile(): string { return path.join(this.d.toolsDir, 'sync-report'); }

  /** What the box has, read from `<tools>` now. */
  box(): BoxTools {
    return {
      release: linkName(path.join(this.d.toolsDir, 'release', 'installed')),
      versions: parseVersions(readText(path.join(this.d.toolsDir, 'current', 'versions'))),
      set: linkName(path.join(this.d.toolsDir, 'current')),
    };
  }

  /** The box's measured tool versions, for the status answer; `null` before a set is in place. */
  versions(): TestboxToolVersions | null { return this.box().versions; }

  /** The current set's node version, for the pristine store's install keys; `null` before a set is in place. */
  node(): string | null { return this.versions()?.node ?? null; }

  /** `<tools>/current` resolved to its set directory, once per turn (`turnSet`); `null` before a set is in place. */
  private currentSetDir(): string | null {
    if (this.turnSet === undefined) {
      try { this.turnSet = realpathSync(path.join(this.d.toolsDir, 'current')); } catch { this.turnSet = null; }
      queueMicrotask(() => { this.turnSet = undefined; });
    }
    return this.turnSet;
  }

  /** The current set's Chrome resolved now, for the prepare that starts now (spec §2.10: the next prepare picks the
   *  new set; a sync prunes the Chrome a set no run uses, so a path resolved once at the service's start goes stale).
   *  Before a set is in place, or a set with no Chrome, the link path. */
  chrome(): string {
    const set = this.currentSetDir();
    const link = path.join(this.d.toolsDir, 'current', 'chrome');
    if (set === null) return link;
    try { return realpathSync(path.join(set, 'chrome')); } catch { return link; }
  }

  /** The current set's `bin/` (node, npm, npx): the first `PATH` entry of the spec built now (spec §2.10: a run
   *  resolves `current` once, when its prepare starts, and keeps those versioned paths for its whole life). Before a
   *  set is in place, the link path. */
  bin(): string {
    const set = this.currentSetDir();
    return set === null ? path.join(this.d.toolsDir, 'current', 'bin') : path.join(set, 'bin');
  }

  /** The service's timer work, after any in progress: the timer's tick and a node change's never run at once. */
  serviceTick(): Promise<void> {
    const svc = this.svc;
    if (svc === null) return Promise.resolve();
    const p = this.ticked.catch(() => undefined).then(() => svc.tick());
    this.ticked = p.catch(() => undefined);
    return p;
  }

  /** The submissions waiting in the service's queue, in its order, each the frame the service queued: the service's
   *  own record, so a refused submission (a duplicate run id) is never one. */
  queuedFrames(): RunSubmit[] { return this.svc === null ? [] : [...this.svc.waiting()]; }

  /** At the service's start, after its own: the runs a takeover handed over are queued, in their order, each with no
   *  connection (its summary is the service's `results/<id>`, as for any run whose link dropped); returns how many. */
  resume(): number {
    const svc = this.svc;
    if (svc === null) throw new Error('the tool sync serves no service');
    const dir = path.join(this.d.root, HANDOVER_DIR);
    let n = 0;
    for (const name of listDir(dir).filter((x) => x.endsWith('.json')).sort()) {
      const file = path.join(dir, name);
      const text = readText(file);
      try { unlinkSync(file); } catch { /* gone */ }
      const r = text === null ? null : readTestboxFrame(text.trim());
      if (r === null || !r.ok || r.value.t !== 'run.submit') { console.error(`ccrc-testbox: a handed-over run (${name}) does not read as a run.submit; dropped`); continue; }
      const id = r.value.runId;
      // Queued as the WebSocket door queues a submission, so a later takeover hands it over again while it waits.
      svc.submit(r.value, { send: () => undefined, refuse: (why) => console.error(`ccrc-testbox: the handed-over run ${id} was refused: ${why}`) });
      n++;
    }
    return n;
  }

  /** D-7426: each queued run written for the next service, in queue order; its log directory, which is empty while it
   *  has not started, is removed so the next service takes the id afresh. */
  private handOver(): void {
    const frames = this.queuedFrames();
    if (frames.length === 0) return;
    const dir = path.join(this.d.root, HANDOVER_DIR);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const at = String(this.d.now()).padStart(15, '0');
    frames.forEach((f, i) => {
      const file = path.join(dir, `${at}-${String(i + 1).padStart(6, '0')}-${f.runId}.json`);
      writeFileSync(`${file}.tmp`, `${JSON.stringify(f)}\n`, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      try { rmdirSync(path.join(this.d.root, 'logs', f.runId)); } catch { /* none, or not empty */ }
    });
  }

  /** Whether the service may start a waiting run: not once a takeover has begun (D-7426). Submissions still queue, and
   *  the run limit the status answer reports is the configured one. */
  admitting(): boolean { return !this.state.takeover; }

  sync(): TestboxSync { return syncNow(this.state, parseReport(this.state.running ? readText(this.reportFile) : null)); }

  /** The service's status answer with this sync's state in it. */
  status(): StatusAnswer {
    if (this.svc === null) throw new Error('the tool sync serves no service');
    return withSync(this.svc.status(), this.sync());
  }

  /** The sets the specs in `specs/` name: each run's by its run id, and the pristine install's. */
  private specSets(): { named: Map<string, string>; install: string | null } {
    const dir = path.join(this.d.root, 'specs');
    let real = this.d.toolsDir;
    try { real = realpathSync(this.d.toolsDir); } catch { /* not there yet */ }
    const roots = [this.d.toolsDir, real];
    const named = new Map<string, string>();
    let install: string | null = null;
    for (const name of listDir(dir)) {
      if (name !== 'install' && !/^[0-9]+$/.test(name)) continue;
      const text = readText(path.join(dir, name));
      if (text === null) continue;
      const r = specSet(text, roots);
      if (r.set === null) continue;
      if (name === 'install') install = r.set;
      else if (r.runId !== null) named.set(r.runId, r.set);
    }
    return { named, install };
  }

  /** The live runs, each with the set its spec names, and the pristine install's (spec §2.10: a run resolves `current`
   *  once, at its prepare; the previous version of each tool is kept until no run uses it). The install's spec stays
   *  until the next build replaces it, so its set is kept until then. */
  private noteRuns(): void {
    if (this.svc === null) return;
    const { named, install } = this.specSets();
    const runSets = seenRuns(this.state.runSets, this.svc.liveRuns(), this.box().set, named);
    if (install !== null) runSets.set(INSTALL_SETS_KEY, install);
    this.state = { ...this.state, runSets };
  }

  /** A `tools.sync` frame. */
  async request(f: ToolsSync): Promise<void> {
    this.noteRuns();
    const r = requested(this.state, f, this.box(), utcSecond(this.d.now()));
    this.state = r.state;
    if (r.start !== null) await this.drive(r.start);
  }

  /** The timer's work: a failed sync whose next attempt has come is run again. The timer does not wait for it
   *  (`main.ts#timerWork`): a sync runs a unit for minutes, and a takeover waits for every run. */
  async tick(): Promise<void> {
    this.noteRuns();
    const f = retryDue(this.state, this.d.now());
    if (f === null) return;
    this.state = retryStarted(this.state, utcSecond(this.d.now()));
    await this.drive(f);
  }

  /** The sync in progress has ended (tests wait on it). */
  async settled(): Promise<void> { while (this.running !== null) await this.running; }

  private async drive(first: ToolsSync): Promise<void> {
    const p = (async () => {
      let f: ToolsSync | null = first;
      while (f !== null) {
        const exit = await this.runUnit(f);
        const e = ended(this.state, exit, parseReport(readText(this.reportFile)), this.d.now(), this.d.settings.retryMs, utcSecond(this.d.now()));
        this.state = e.state;
        if (e.takeover) { await this.takeover(); return; }
        if (e.nodeChanged) await this.serviceTick().catch(() => undefined);
        f = null;
        if (e.next !== null) {
          const r = requested(this.state, e.next, this.box(), utcSecond(this.d.now()));
          this.state = r.state;
          f = r.start;
        }
      }
    })();
    this.running = p;
    try { await p; } finally { if (this.running === p) this.running = null; }
  }

  private async runUnit(f: ToolsSync): Promise<number> {
    try {
      // The sets in use now, for this unit's `K` records: a frame that waited for a sync runs after runs started.
      this.noteRuns();
      const dir = path.join(this.d.root, 'specs');
      mkdirSync(dir, { recursive: true, mode: 0o755 });
      const file = path.join(dir, 'tools');
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, encodeToolsSpec({ toolsDir: this.d.toolsDir, frame: f, settings: this.d.settings, keep: keptSets(this.state.runSets) }), { mode: 0o644 });
      renameSync(tmp, file);
      return (await this.d.sys.run(units.tools())).exit;
    } catch {
      return 255;
    }
  }

  /** D-7426: no new run starts, the runs in progress end, the queued ones are handed over, and the process exits 0
   *  for the new tree to take over. */
  private async takeover(): Promise<void> {
    if (this.svc !== null) await this.svc.idle();
    try { this.handOver(); } catch (e) { console.error(`ccrc-testbox: the queued runs could not be handed over: ${e instanceof Error ? e.message : String(e)}`); }
    this.d.exit(0);
  }

  /** For the tests: the decider's state as it stands. */
  stateNow(): ToolsState { return this.state; }
}

const attached = new WeakMap<object, ToolSync>();

/** The driver that serves `svc`'s `tools.sync` frames (the entry point attaches one per service). */
export function attachToolSync(svc: object, t: ToolSync): void { attached.set(svc, t); }

/** `service.ts#FRAME_HANDLERS`' `tools.sync` line: the frame to the service's driver, or refused when it has none. */
export async function onToolsSync(svc: object, f: TestboxFrame, conn: { refuse(reason: string): void }): Promise<void> {
  const t = attached.get(svc);
  if (t === undefined) { conn.refuse('this service does not sync tools'); return; }
  if (f.t !== 'tools.sync') { conn.refuse(`${f.t} is not a tools.sync frame`); return; }
  await t.request(f);
}

/** The driver attached to `svc`, or `undefined`. */
export function toolSyncOf(svc: object): ToolSync | undefined { return attached.get(svc); }

/** The status answer a connection is sent: the attached driver's, which carries the sync's state, else the service's. */
export function statusOf(svc: { status(): StatusAnswer }): StatusAnswer {
  return attached.get(svc)?.status() ?? svc.status();
}
