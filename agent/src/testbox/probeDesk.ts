// D-8290 (plan docs/superpowers/plans/2026-11-11-live-probe-budget.md). L4: the test service's probe desk, the entry
// point of the `probe.submit` job kind. It decides nothing itself: the role, the settings, the guard, the budget and
// the status block are `probes.ts`'s, and the one-at-a-time rule is `queue.ts`'s `probe` kind. It acts through three
// seams: the runner (the probe's own unit, the harness programme's; absent, every probe is refused `no-runner`), the
// budget store and the path resolver (`probeFs.ts`).
//
// A submission is answered with `probe.state` frames: `refused` with its typed reason (nothing queued, nothing
// counted), or `queued` with its position, then `running`, then `ended` with the runner's exit status. A probe is
// counted against the day's budget when it is accepted, so a waiting probe holds its unit. The guard is judged again
// when a waiting probe starts (a symlink may have moved while it waited); one refused then is answered `refused` and
// stays counted. A probe keeps running when its connection drops; its frames then go nowhere.
import {
  PROBE_REFUSAL_SENTENCE, type ProbeAnswer, type ProbeRefusal, type ProbeSubmit, type TestboxProbes,
} from '../../../shared/testbox.js';
import type { BudgetStore } from './probeFs.js';
import {
  budgetOn, budgetRefusal, configDirRefusal, PROBE_SLOTS, probeHome, probesView, probeSpec, probeTmuxDir, socketRefusal, spend,
  writeRefusal, type ProbeRole, type ProbeSettingsRead, type ProbeSpec,
} from './probes.js';
import { admit, EMPTY_QUEUE, enqueue, finish, positions, type QueueState } from './queue.js';

/** How a probe ended, as its runner says. */
export interface ProbeEnd { readonly exit: number }

/** The probe's own unit. A throw is an end at `FAILED_EXIT`. */
export interface ProbeRunner { run(spec: ProbeSpec): Promise<ProbeEnd> }

/** Where a probe's frames go. */
export interface ProbeSink { send(frame: ProbeAnswer): void }

export interface ProbeDeskDeps {
  readonly role: ProbeRole;
  readonly settings: ProbeSettingsRead;
  /** `null` until the harness programme installs one. */
  readonly runner: ProbeRunner | null;
  /** The fleet accounts' config directories, resolved, read on each submission. */
  readonly fleetDirs: () => readonly string[];
  /** A path with its symlinks followed. */
  readonly realPath: (p: string) => string;
  readonly store: BudgetStore;
  readonly now: () => number;
}

/** A runner that threw, or an exit status off the wire's range, ends at this. */
const FAILED_EXIT = 255;

interface Held { readonly f: ProbeSubmit; readonly sink: ProbeSink }

export class ProbeDesk {
  private queue: QueueState = EMPTY_QUEUE;
  private readonly held = new Map<string, Held>();
  private readonly used = new Set<string>();
  private readonly driving = new Set<Promise<void>>();

  constructor(private readonly d: ProbeDeskDeps) {}

  /** Whether the status answer carries the probe block: the box names a probe config directory (see `TestboxProbes`). */
  configured(): boolean { return this.d.settings.ok; }

  /** Why the desk takes no probe now, before any budget: the role, the settings, the runner, then the guard. */
  private standing(): ProbeRefusal | null {
    if (this.d.role !== 'test-box') return 'not-test-box';
    if (!this.d.settings.ok) return this.d.settings.refusal;
    if (this.d.runner === null) return 'no-runner';
    const s = this.d.settings.settings;
    const fleet = this.d.fleetDirs().map((f) => this.d.realPath(f));
    return configDirRefusal(s.configDir, fleet)
      ?? configDirRefusal(this.d.realPath(s.configDir), fleet)
      ?? socketRefusal(s.socket)
      // Every path the desk writes or the probe is handed as its own passes the write guard.
      ?? [this.d.store.file, probeHome(s), probeTmuxDir(s)].map((p) => writeRefusal(this.d.realPath(p), fleet)).find((r) => r !== null)
      ?? null;
  }

  private refuse(f: ProbeSubmit, sink: ProbeSink, refusal: ProbeRefusal): void {
    sink.send({ t: 'probe.state', probeId: f.probeId, state: 'refused', refusal, detail: PROBE_REFUSAL_SENTENCE[refusal], position: null, exit: null });
  }

  /** A submission: refused with its typed reason, or counted and queued. */
  submit(f: ProbeSubmit, sink: ProbeSink): void {
    const standing = this.standing();
    if (standing !== null) { this.refuse(f, sink, standing); return; }
    if (this.used.has(f.probeId)) { this.refuse(f, sink, 'probe-id-used'); return; }
    const perDay = this.d.settings.ok ? this.d.settings.settings.perDay : 0;
    const today = budgetOn(this.d.store.read(), this.d.now());
    const spent = budgetRefusal(today, perDay);
    if (spent !== null) { this.refuse(f, sink, spent); return; }
    const q = enqueue(this.queue, { id: f.probeId, session: f.session, kind: 'probe' });
    if (q === null) { this.refuse(f, sink, 'probe-id-used'); return; }
    this.d.store.write(spend(today));
    this.queue = q;
    this.used.add(f.probeId);
    this.held.set(f.probeId, { f, sink });
    sink.send({ t: 'probe.state', probeId: f.probeId, state: 'queued', refusal: null, detail: null, position: positions(this.queue).get(f.probeId) ?? null, exit: null });
    this.pump();
  }

  /** Start the probe the queue admits (one at a time). */
  private pump(): void {
    const { state, started } = admit(this.queue, { runs: PROBE_SLOTS, sessionRuns: PROBE_SLOTS });
    this.queue = state;
    for (const e of started) {
      const p = this.drive(e.id).finally(() => { this.driving.delete(p); });
      this.driving.add(p);
    }
  }

  private async drive(probeId: string): Promise<void> {
    const h = this.held.get(probeId)!;
    let exit = FAILED_EXIT;
    // The guard again at the start: a symlink changed while the probe waited is judged as it now leads.
    const standing = this.standing();
    if (standing === null && this.d.settings.ok && this.d.runner !== null) {
      h.sink.send({ t: 'probe.state', probeId, state: 'running', refusal: null, detail: null, position: null, exit: null });
      try {
        const end = await this.d.runner.run(probeSpec(this.d.settings.settings, probeId, h.f.name));
        exit = Number.isInteger(end.exit) && end.exit >= 0 && end.exit <= FAILED_EXIT ? end.exit : FAILED_EXIT;
      } catch {
        exit = FAILED_EXIT;
      }
      h.sink.send({ t: 'probe.state', probeId, state: 'ended', refusal: null, detail: null, position: null, exit });
    } else {
      this.refuse(h.f, h.sink, standing ?? 'no-runner');
    }
    this.held.delete(probeId);
    this.queue = finish(this.queue, probeId);
    this.pump();
  }

  /** No probe waiting or running. */
  idle(): boolean { return this.queue.waiting.length === 0 && this.queue.running.length === 0; }

  /** Every probe started so far has ended (tests and the service's stop wait on it). */
  async settled(): Promise<void> {
    while (this.driving.size > 0) await Promise.all([...this.driving]);
  }

  /** The status answer's probe block. */
  view(): TestboxProbes {
    const names = new Map([...this.held].map(([id, h]) => [id, h.f.name]));
    const perDay = this.d.settings.ok ? this.d.settings.settings.perDay : 1;
    return probesView({ refusal: this.standing(), queue: this.queue, names, budget: budgetOn(this.d.store.read(), this.d.now()), perDay });
  }
}
