// D-7411, D-7444, D-7445 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB9; spec 2026-10-28 test box
// §2.7). L4: the test box's poll. It asks the fleet io for the `testbox` op's answer, lists the registry for the switch
// marker and reads the two runs log day files, then hands the three to the pure decider (`testbox.ts`) and holds the
// block it answers; every decision is the decider's. It polls every `CCRC_TESTBOX_POLL`, the value the op's answer
// carries (the agent read and validated it), and, before an answer has carried one, at that setting's default.
// `watch.ts` owns one of these and calls `sweep()` from its tick, never awaited. The server never reaches the test box
// itself: the fleet agent does, so it sees what the wrapper sees (spec §2.7).
import { TESTBOX_ADMIN_SUBS, type TestboxActState, type TestboxAdminStatus } from '../../shared/testbox-admin.js';
import { actorOf, knownFleetIdentity } from './accounts/audit.js';
import type { Deps } from './deps.js';
import type { MeasuredRead, TestboxSyncAsked } from './io.js';
import { runsLogDates, testboxBlock, type RunsLogRead, type TestboxAnswer, type TestboxBlock } from './testbox.js';
import { readAdminStatus } from './testboxAdmin.js';

/** `CCRC_TESTBOX_POLL`'s default (`ccd/testbox-knobs`), the lane's interval only until an answer carries the setting. */
export const TESTBOX_POLL_DEFAULT_MS = 30_000;
/** The runs log's directory under the registry (D-7445; the wrapper is its one writer). */
export const TESTBOX_RUNS_DIR = 'testbox-runs';
/** How often the lane asks the box's settings `read` while a box is connected (spec §2.7, D-8166): six hours. */
export const TESTBOX_SETTINGS_READ_MS = 6 * 3_600_000;
/** How many settled act ids the lane remembers (the status carries the current act and at most six before it). */
const SETTLED_ACTS_KEPT = 32;

/** What the lane takes from the composition: the fleet io and config it always had, and (D-8166) the connect surface's ops
 *  port, its ledger and the fleet's identity, each absent in a test or script that wants none. */
export type TestboxLaneDeps = Pick<Deps, 'io' | 'cfg'> & Partial<Pick<Deps, 'testboxAdmin' | 'testboxAudit' | 'fleetIdentity'>>;

const SERVER_ACTOR = actorOf('ccrc server', '');

const logRead = (r: MeasuredRead): RunsLogRead => (r.ok ? r.content : r.reason === 'absent' ? '' : null);

export class TestboxLane {
  /** The wall clock the pass last started on (0: never). */
  private lastSweep = 0;
  private inflight = false;
  private pollMs = TESTBOX_POLL_DEFAULT_MS;
  private held: TestboxBlock | null = null;
  /** The wall clock `read` was last asked at (0: never). */
  private lastRead = 0;
  /** The long acts whose end rows this lane wrote or found written, so a pass does not ask the ledger again. Bounded: the status
   *  names at most seven acts a pass (the current one and the six that ended before it), and the oldest ids are forgotten first. */
  private readonly settledActs = new Set<string>();

  constructor(private readonly deps: () => TestboxLaneDeps, private readonly now: () => number = Date.now) {}

  /** The block the last pass decided, or `null` before the first: absence on the wire reads as UNKNOWN. */
  block(): TestboxBlock | null { return this.held; }

  /** One pass, on its own clock unless `force` (after the switch route or a sync ran), never two at once. Never
   *  rejects: PUBLIC because `tick()` dispatches it with `void`. */
  async sweep(force = false): Promise<void> {
    const at = this.now();
    if (this.inflight) return;
    if (!force && this.lastSweep !== 0 && at - this.lastSweep < this.pollMs) return;
    this.lastSweep = at;
    this.inflight = true;
    try {
      const d = this.deps();
      const reg = d.cfg.registryDir;
      const [answer, listed, admin, ...logs] = await Promise.all([
        d.io.testboxMeasured().catch((): TestboxAnswer => ({ ok: false, reason: 'unanswered' })),
        d.io.readdirMeasured(reg).catch(() => null),
        this.adminStatus(d),
        ...runsLogDates(at).map((day) => d.io.readFileMeasured(`${reg}/${TESTBOX_RUNS_DIR}/${day}.log`).then(logRead, () => null)),
      ]);
      if (answer.ok && answer.reply.pollMs !== null) this.pollMs = answer.reply.pollMs;
      const listing = listed !== null && listed.ok ? listed.entries : null;
      this.held = testboxBlock({ answer, listing, logs: logs as RunsLogRead[], now: this.now(), admin });
    } finally {
      this.inflight = false;
    }
  }

  /** The connect surface's `status`, or `null` when the lane has no ops port or the fleet did not answer it (the block then
   *  carries no `admin`). While a box is connected, asks `read` at most every {@link TESTBOX_SETTINGS_READ_MS}, not awaited: it
   *  reaches the box over the network, and the pass must not wait on it. A long act that has ended writes its end rows. */
  private async adminStatus(d: TestboxLaneDeps): Promise<TestboxAdminStatus | null> {
    const ops = d.testboxAdmin;
    if (ops === undefined) return null;
    const s = await readAdminStatus(ops);
    if (!s.ok) return null;
    const at = this.now();
    if (s.status.connected && (this.lastRead === 0 || at - this.lastRead >= TESTBOX_SETTINGS_READ_MS)) {
      this.lastRead = at;
      void ops.run('read', {}).catch(() => undefined);
    }
    // The acts that ended before the current one began come first (oldest first), so a second act started before this pass cannot
    // cost the first its row (spec §2.10).
    for (const ended of s.status.endedActs ?? []) this.writeEndRows(d, ended);
    if (s.status.act !== null) this.writeEndRows(d, s.status.act);
    return s.status;
  }

  /** A long act's end row(s) (spec §2.10): written once, keyed by `actId`, so a restart never writes them twice. `connect`
   *  ends as `install` (keyed) then `pair`: an act that failed before the pair step writes the install row alone; one that
   *  failed at the pair or the check writes install `ok` and pair `failed`. */
  private writeEndRows(d: TestboxLaneDeps, a: TestboxActState): void {
    const audit = d.testboxAudit;
    if (audit === undefined || a.endedAt === null || a.outcome === 'running' || this.settledActs.has(a.id)) return;
    if (audit.hasAct(a.id)) { this.settle(a.id); return; }
    const outcome = a.outcome === 'ok' ? 'ok' : 'failed';
    const code = a.outcome === 'ok' || a.code === null ? {} : { code: a.code };
    const fleetIdentity = knownFleetIdentity(d.fleetIdentity);
    const row = { fleetIdentity, actor: SERVER_ACTOR };
    if (a.sub === 'connect') {
      const atPair = outcome === 'failed' && (a.phase === 'pair' || a.phase === 'check');
      const installed = audit.write({ ...row, act: 'install', actId: a.id, outcome: outcome === 'ok' || atPair ? 'ok' : 'failed', ...(outcome === 'failed' && !atPair ? code : {}) });
      if (installed.ok && (outcome === 'ok' || atPair)) audit.write({ ...row, act: 'pair', outcome, ...code });
    } else {
      const act = TESTBOX_ADMIN_SUBS[a.sub].act;
      // D-8399: a box settings edit that ended ok records the changes its route staged by the act's id; the row drops them either way.
      const changes = act === 'settings-box' && outcome === 'ok' ? audit.staged(a.id) : undefined;
      if (act !== null) audit.write({ ...row, act, actId: a.id, outcome, ...code, ...(changes === undefined ? {} : { changes }) });
    }
    this.settle(a.id);
  }

  private settle(id: string): void {
    this.settledActs.add(id);
    while (this.settledActs.size > SETTLED_ACTS_KEPT) this.settledActs.delete(this.settledActs.values().next().value as string);
  }

  /** The card's **Bring tools up to date** and the update lane's signal (spec §2.7, §2.10): the op's one write, then
   *  a fresh pass so the block shows the sync. */
  async toolsSync(): Promise<TestboxSyncAsked> {
    let r: TestboxSyncAsked;
    try { r = await this.deps().io.testboxToolsSync(); } catch { r = { ok: false, reason: 'unanswered' }; }
    void this.sweep(true);
    return r;
  }
}
