// FLEET DISK RETENTION DR-19 (D-6631; spec 2026-10-23 section 2.3). L4: the orphan-worktree lane's pass. It holds the
// lane's memory and runs the beat; every decision is `orphanTreeLane.ts`'s and every ccd call is
// `coord/collectOrphanTree.ts`'s. `watch.ts` owns one of these and calls `pass()` from its tick.
//
// One pass: read the switches (a pause clears every first sighting and ends the pass); take the census when it is due
// (every 6 hours, hourly under pressure; a truncated one audits nothing new); then at most one act job for the ripest
// tree and at most 2 learning audits (4 under pressure) for due trees, each on the lane's one `KeyedQueue` key so no two
// calls of the lane overlap. A pass awaits only its own calls and is never overtaken (`sweeping`).
import type { FleetIO } from './io.js';
import type { FleetState } from './fleetstate.js';
import type { RunCcd } from './coord/ports.js';
import {
  auditOrphan, censusOrphans, collectOrphanTree, orphanSwitches, type CollectOrphanDeps,
} from './coord/collectOrphanTree.js';
import {
  ORPHAN_AUDITS_PER_PASS, ORPHAN_AUDITS_PER_PASS_PRESSURE, ORPHAN_CENSUS_MS, ORPHAN_CENSUS_PRESSURE_MS, ORPHAN_QUEUE_KEY,
  ORPHAN_RETRY_MS, isAuditedClass, orphanPathOfHex, orphanCensusDue, orphanGoesWithRow, orphanHeldBack, orphanInsideVerdict, orphanFeedRow, orphanFoldAudit, orphanFoldJob, orphanOffers, orphanPopulate,
  orphanRemember, orphanRescueArmed, orphanTreesHealth,
  type OrphanFold, type OrphanMemory, type OrphanRow, type OrphanTreeMemory,
} from './orphanTreeLane.js';
import type { DiskOrphanTrees } from '../../shared/disk.js';

export interface OrphanSweepDeps {
  readonly io: Pick<FleetIO, 'readdirMeasured'>;
  readonly registryDir: string;
  readonly runCcd: RunCcd;
  readonly fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  readonly queue: { run<T>(key: string, fn: () => Promise<T>): Promise<T> };
  /** The monotonic clock, in ms. */
  readonly mono: () => number;
  readonly epochNow: () => number;
  /** Whether the fleet is in pressure mode (a filesystem is critical). */
  readonly pressure: () => boolean;
  /** One feed row, `kind:'coord'`, record-only. Never throws. */
  readonly record: (title: string, body: string) => void;
  /** Every id any run was ever claimed by, in any state or generation (orphanCoordinatorSet). Throws when the store cannot be read, which keeps every nested tree. */
  readonly coordinators: () => ReadonlySet<string>;
  /** Whether the registry row `id` is a workspace (`workspace !== null`): false for a plain session or main checkout, null when the row cannot be read. */
  readonly isWorkspace: (id: string) => Promise<boolean | null>;
}

export class OrphanTreeSweep {
  private memory: OrphanMemory = new Map();
  private rows: readonly OrphanRow[] = [];
  private lastCensus: number | null = null;
  private sweeping = false;
  private removed = 0;
  private measured = false;
  private reported = new Set<string>();
  private rowUnreadableSaid = new Set<string>();
  private wsKinds = new Map<string, boolean | null>();
  private unreadableSaid = false;

  constructor(private readonly deps: OrphanSweepDeps) {}

  /** The `disk` block's `orphanTrees`: null until a census has been read. */
  health(): DiskOrphanTrees | null {
    return this.measured ? orphanTreesHealth(this.rows, this.memory, this.removed) : null;
  }

  /** The coordinators now, or null when the store cannot be read. */
  private coordinators(): ReadonlySet<string> | null {
    try { return this.deps.coordinators(); } catch { return null; }
  }

  private readonly isWs = (id: string): boolean | null => this.wsKinds.get(id) ?? null;

  /** Read each distinct containing row once per census; a throw is null (unmeasured). */
  private async readWsKinds(rows: readonly OrphanRow[]): Promise<void> {
    const next = new Map<string, boolean | null>();
    for (const r of rows) {
      if (r.inside === null || !isAuditedClass(r.cls) || next.has(r.inside)) continue;
      let k: boolean | null = null;
      try { k = await this.deps.isWorkspace(r.inside); } catch { k = null; }
      next.set(r.inside, k);
    }
    this.wsKinds = next;
  }

  private ccd(): CollectOrphanDeps {
    const d = this.deps;
    return { io: d.io, registryDir: d.registryDir, runCcd: d.runCcd, fleetState: d.fleetState, epochNow: d.epochNow };
  }

  private put(hex: string, f: OrphanFold): void {
    const cls = this.memory.get(hex)?.cls ?? 'other';
    const next = new Map(this.memory);
    const mem = orphanRemember(f);
    if (mem === null) next.delete(hex); else next.set(hex, mem);
    this.memory = next;
    if (f.say !== null) {
      const row = orphanFeedRow(hex, cls, f.say);
      this.deps.record(row.title, row.body);
      if (f.say.kind === 'removed') this.removed += 1;
    }
  }

  private retryLater(hex: string, m: OrphanTreeMemory, now: number): void {
    this.memory = new Map(this.memory).set(hex, { ...m, obs: null, nextMono: now + ORPHAN_RETRY_MS });
  }

  async pass(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try { await this.run(); } finally { this.sweeping = false; }
  }

  private async run(): Promise<void> {
    const d = this.deps;
    const pressure = d.pressure();
    const censusMs = pressure ? ORPHAN_CENSUS_PRESSURE_MS : ORPHAN_CENSUS_MS;
    const sw = await orphanSwitches(d.io, d.registryDir);
    if (sw.paused) {
      // A pause breaks every first sighting: the two audits of one token must both stand under an unpaused lane.
      this.memory = new Map([...this.memory].map(([h, m]) => [h, { ...m, obs: null }]));
      return;
    }
    const rescueArmed = orphanRescueArmed(sw);
    if (orphanCensusDue(this.lastCensus, d.mono(), pressure)) {
      const c = await d.queue.run(ORPHAN_QUEUE_KEY, () => censusOrphans(this.ccd()));
      if (c.kind === 'not-asked') return;
      const now = d.mono();
      if (c.kind === 'unreadable') { this.lastCensus = now - censusMs + ORPHAN_RETRY_MS; return; }
      this.lastCensus = now;
      if (c.truncated) return;
      this.rows = c.rows;
      const coords = this.coordinators();
      await this.readWsKinds(c.rows);
      this.memory = orphanPopulate(this.memory, c, now, coords, this.isWs);
      // An unmeasured answer keeps the candidate and names why: one row per episode, not one per pass.
      if (coords === null) {
        if (!this.unreadableSaid && c.rows.some((r) => isAuditedClass(r.cls) && r.inside !== null)) {
          this.unreadableSaid = true;
          d.record('orphan worktree left', 'a nested worktree was left: the coordinator list could not be read');
        }
      } else this.unreadableSaid = false;
      // Forget the reports of trees the whole census no longer lists.
      const listed = new Set(c.rows.map((r) => r.hex));
      this.reported = new Set([...this.reported].filter((h) => listed.has(h)));
      this.rowUnreadableSaid = new Set([...this.rowUnreadableSaid].filter((h) => listed.has(h)));
      // A containing row that cannot be read keeps its trees silently otherwise: one row per tree per episode.
      for (const r of c.rows) {
        if (r.inside === null || !isAuditedClass(r.cls) || this.isWs(r.inside) !== null) { this.rowUnreadableSaid.delete(r.hex); continue; }
        if (this.rowUnreadableSaid.has(r.hex)) continue;
        this.rowUnreadableSaid.add(r.hex);
        d.record('orphan worktree left', `${orphanPathOfHex(r.hex)} (${r.cls}): a nested worktree was left: its containing row could not be read`);
      }
      for (const r of c.rows) {
        if (!isAuditedClass(r.cls) || orphanInsideVerdict(r.inside, coords, this.isWs) !== 'goes-with-workspace' || this.reported.has(r.hex)) continue;
        this.reported.add(r.hex);
        const row = orphanGoesWithRow(r.hex, r.cls);
        d.record(row.title, row.body);
      }
      this.measured = true;
    }
    const held = orphanHeldBack(this.memory, this.coordinators(), this.isWs);
    const offers = orphanOffers(this.memory, d.mono(), pressure ? ORPHAN_AUDITS_PER_PASS_PRESSURE : ORPHAN_AUDITS_PER_PASS, held);
    if (offers.act !== null) await this.actOn(offers.act, rescueArmed, censusMs);
    for (const hex of offers.learn) if (!(await this.learnOn(hex, rescueArmed, censusMs))) return;
  }

  /** The pass's one act job, on the lane's queue key. A throw is read as "may have acted": the tree waits to be asked again. */
  private async actOn(hex: string, rescueArmed: boolean, censusMs: number): Promise<void> {
    const d = this.deps;
    const epoch = d.epochNow();
    const obs = this.memory.get(hex)?.obs ?? null;
    try {
      const out = await d.queue.run(ORPHAN_QUEUE_KEY, () => collectOrphanTree(this.ccd(), hex, obs, d.mono, epoch));
      const cur = this.memory.get(hex);
      if (cur !== undefined) this.put(hex, orphanFoldJob(cur, out, d.mono(), rescueArmed, censusMs));
    } catch {
      const cur = this.memory.get(hex);
      if (cur !== undefined) this.retryLater(hex, cur, d.mono());
    }
  }

  /** One learning audit. False when the box cannot be asked at all (no capability), which ends the pass. */
  private async learnOn(hex: string, rescueArmed: boolean, censusMs: number): Promise<boolean> {
    const d = this.deps;
    try {
      const a = await d.queue.run(ORPHAN_QUEUE_KEY, () => auditOrphan(this.ccd(), hex));
      if (a.kind === 'not-asked') return false;
      const cur = this.memory.get(hex);
      if (cur !== undefined) this.put(hex, orphanFoldAudit(cur, a, d.mono(), rescueArmed, censusMs));
    } catch {
      const cur = this.memory.get(hex);
      if (cur !== undefined) this.retryLater(hex, cur, d.mono());
    }
    return true;
  }
}
