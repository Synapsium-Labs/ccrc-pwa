// D-7408, D-7426, D-7553 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB6; spec §2.10). L4: the tool sync's
// driver. It decides nothing itself (`tools.ts`, L1, does); it writes `specs/tools`, starts the static root unit
// `ccrc-testbox-tools.service` through the system manager and reads the unit's report, `<tools>/sync-report`, and the
// current set's `versions`. The service's frame table reaches it by one line (`service.ts#FRAME_HANDLERS`), through
// the driver attached to that service here (`attachToolSync`, by the entry point).
//
// The takeover (D-7426): a sync that replaced the release closes the service's admissions (the entry point hands the
// service a run limit this driver sets to 0), waits for the runs in progress to end, and exits 0, so the service
// manager restarts the service on the new tree. A new node version queues every pristine key's rebuild at once, by
// one tick of the service's timer work (the pristine store reads the box's node from this driver).
import { mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StatusAnswer, TestboxFrame, TestboxSync, TestboxToolVersions, ToolsSync } from '../../../shared/testbox.js';
import { units, type SystemManager } from './systemd.js';
import {
  ended, IDLE_TOOLS, encodeToolsSpec, keptSets, parseReport, parseVersions, requested, retryDue, retryStarted, seenRuns, syncNow,
  withSync, type BoxTools, type ToolsSettings, type ToolsState,
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
}

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
const linkName = (f: string): string | null => { try { return path.basename(readlinkSync(f)); } catch { return null; } };

export class ToolSync {
  private state: ToolsState = IDLE_TOOLS;
  private svc: ServedService | null = null;
  private running: Promise<void> | null = null;

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

  /** The run limit the service admits under: its own, or 0 once a takeover has begun. */
  runLimit(own: number): number { return this.state.takeover ? 0 : own; }

  sync(): TestboxSync { return syncNow(this.state, parseReport(this.state.running ? readText(this.reportFile) : null)); }

  /** The service's status answer with this sync's state in it. */
  status(): StatusAnswer {
    if (this.svc === null) throw new Error('the tool sync serves no service');
    return withSync(this.svc.status(), this.sync());
  }

  /** The live runs, each with the set it started under (spec §2.10: a run resolves `current` once). */
  private noteRuns(): void {
    if (this.svc === null) return;
    this.state = { ...this.state, runSets: seenRuns(this.state.runSets, this.svc.liveRuns(), this.box().set) };
  }

  /** A `tools.sync` frame. */
  async request(f: ToolsSync): Promise<void> {
    this.noteRuns();
    const r = requested(this.state, f, this.box(), utcSecond(this.d.now()));
    this.state = r.state;
    if (r.start !== null) await this.drive(r.start);
  }

  /** The timer's work: a failed sync whose next attempt has come is run again. */
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
        if (e.nodeChanged && this.svc !== null) await this.svc.tick().catch(() => undefined);
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

  /** D-7426: no new run starts, the runs in progress end, and the process exits 0 for the new tree to take over. */
  private async takeover(): Promise<void> {
    if (this.svc !== null) await this.svc.idle();
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
