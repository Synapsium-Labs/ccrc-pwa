// D-7411, D-7444, D-7445 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB9; spec 2026-10-28 test box
// §2.7). L4: the test box's poll. It asks the fleet io for the `testbox` op's answer, lists the registry for the switch
// marker and reads the two runs log day files, then hands the three to the pure decider (`testbox.ts`) and holds the
// block it answers; every decision is the decider's. It polls every `CCRC_TESTBOX_POLL`, the value the op's answer
// carries (the agent read and validated it), and, before an answer has carried one, at that setting's default.
// `watch.ts` owns one of these and calls `sweep()` from its tick, never awaited. The server never reaches the test box
// itself: the fleet agent does, so it sees what the wrapper sees (spec §2.7).
import type { Deps } from './deps.js';
import type { MeasuredRead, TestboxSyncAsked } from './io.js';
import { runsLogDates, testboxBlock, type RunsLogRead, type TestboxAnswer, type TestboxBlock } from './testbox.js';

/** `CCRC_TESTBOX_POLL`'s default (`ccd/testbox-knobs`), the lane's interval only until an answer carries the setting. */
export const TESTBOX_POLL_DEFAULT_MS = 30_000;
/** The runs log's directory under the registry (D-7445; the wrapper is its one writer). */
export const TESTBOX_RUNS_DIR = 'testbox-runs';

const logRead = (r: MeasuredRead): RunsLogRead => (r.ok ? r.content : r.reason === 'absent' ? '' : null);

export class TestboxLane {
  /** The wall clock the pass last started on (0: never). */
  private lastSweep = 0;
  private inflight = false;
  private pollMs = TESTBOX_POLL_DEFAULT_MS;
  private held: TestboxBlock | null = null;

  constructor(private readonly deps: () => Pick<Deps, 'io' | 'cfg'>, private readonly now: () => number = Date.now) {}

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
      const [answer, listed, ...logs] = await Promise.all([
        d.io.testboxMeasured().catch((): TestboxAnswer => ({ ok: false, reason: 'unanswered' })),
        d.io.readdirMeasured(reg).catch(() => null),
        ...runsLogDates(at).map((day) => d.io.readFileMeasured(`${reg}/${TESTBOX_RUNS_DIR}/${day}.log`).then(logRead, () => null)),
      ]);
      if (answer.ok && answer.reply.pollMs !== null) this.pollMs = answer.reply.pollMs;
      const listing = listed !== null && listed.ok ? listed.entries : null;
      this.held = testboxBlock({ answer, listing, logs: logs as RunsLogRead[], now: this.now() });
    } finally {
      this.inflight = false;
    }
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
