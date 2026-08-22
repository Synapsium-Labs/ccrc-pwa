import path from 'node:path';
import {
  LC_DIR_NAME, LC_ERRORS_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, type LifecycleHealth,
} from '../../../shared/api.js';
import type { FleetIO } from '../io.js';
import { parseJournalLine, type JournalRow } from './journalparse.js';
import { frameRead, lifecycleState, planSweep, shouldSweep } from './mirrorplan.js';
import type { CoordStore } from './store.js';

/**
 * L3. It EXECUTES `mirrorplan`'s decisions over `FleetIO` and writes them
 * through `CoordStore`; it decides nothing itself, and it holds no database
 * handle (the coord-ring scan in `single-definition.test.ts` forbids one here
 * and forbids a `store.db` receiver too).
 *
 * POLL, DO NOT TAIL (spec D5). Three of the four architect drafts reached for
 * `tailOpen`/`tailClose` and every judge found a silent-loss bug in some
 * draft's tail seam — `resync()` jumping to EOF, `agent/src/tail.ts:53-58`
 * handing the reader a reset it must model, a carry buffer shared between a
 * backfill and a live stream. Lifecycle acts run ~100/day; paying a permanent
 * silent-loss risk for latency nobody will perceive is a bad trade. This rides
 * `FleetWatcher`'s EXISTING tick.
 *
 * THE MIRROR HOLDS NO SUBSCRIPTION. If the agent WS drops mid-sweep,
 * `readdir`/`readFileFrom` answer null, no cursor advances, and the next tick
 * resumes at the same offset — no loss, no duplicates, no reset dance.
 */
export interface MirrorDeps {
  readonly io: FleetIO;
  readonly registryDir: string;
  readonly store: CoordStore;
  /** Re-read every sweep, not captured: the agent can reconnect with a
   *  different ccd under it, and a mirror that latched the boot-time answer
   *  would stay silent through a deploy that fixed exactly this. */
  readonly ccdVerbs: () => readonly string[] | null;
  readonly now: () => number;
  /** Three sweep intervals — one missed sweep is not an alarm, three is. Same
   *  four-heartbeat reasoning `SUPERVISED_FRESH_MS` states for the supervisor
   *  stamp, one notch tighter because this lane has no jitter. An INPUT
   *  because `LC_SWEEP_MS` lives in `watch.ts` (L4) and this file is L3. */
  readonly staleAfterMs: number;
}

export class JournalMirror {
  private lastOkAt: number | null = null;
  /** `null` = the counter file has never been written by ccd. `0` is a
   *  MEASURED zero, and the two must not share a value (D7's mitigation is
   *  only a mitigation if the operator can tell "no errors recorded" from
   *  "never looked"). */
  private writeErrors: number | null = null;
  /** Names that look like generations and cannot be ordered, already recorded.
   *  ONE gap row per name per process: the condition is standing, and a row
   *  every five seconds is an alarm nobody reads. */
  private readonly unorderableSeen = new Set<string>();

  constructor(private deps: MirrorDeps) {}

  private dir(): string { return path.join(this.deps.registryDir, LC_DIR_NAME); }

  /**
   * NEVER THROWS and never rejects — `FleetWatcher` void-dispatches it, and
   * one bad sweep must not kill the poll. Every failure degrades to "no
   * progress this pass", which the next tick retries from the same cursor.
   */
  async sweep(): Promise<void> {
    try { await this.run(); } catch { /* one bad sweep must not kill the poll */ }
  }

  private async run(): Promise<void> {
    if (!shouldSweep(this.state())) return;
    const dir = this.dir();
    const names = await this.deps.io.readdir(dir);
    const known = this.deps.store.journalGenerations();
    const plan = planSweep(names, known);
    // FAIL SHUT. A directory we could not list is not evidence that a
    // generation was rotated away — the same direction `sweepDivergences`
    // takes on its own registry listing, and the reason `listed` is a field
    // rather than an empty array.
    if (!plan.listed) return;

    const at = this.deps.now();
    for (const g of plan.gaps) {
      this.deps.store.recordGap({ at, gen: g.gen, reason: g.reason, detail: g.detail,
                                  lostFrom: g.lostFrom, lostTo: g.lostTo });
    }
    for (const gen of plan.retire) this.deps.store.retireGeneration(gen, at);
    for (const name of plan.unorderable) {
      if (this.unorderableSeen.has(name)) continue;
      this.unorderableSeen.add(name);
      this.deps.store.recordGap({
        at, gen: name, reason: 'unknown',
        detail: `${name} is named like a generation (${LC_GEN_PREFIX}…${LC_GEN_SUFFIX}) but ` +
          'carries no orderable stamp, so the mirror cannot place it in the sequence and ' +
          'will not read it',
        lostFrom: null, lostTo: null,
      });
    }

    for (const r of plan.reads) await this.drain(dir, r.gen, r.from, r.lastSize, at);

    this.writeErrors = await this.readErrors(dir);
    this.lastOkAt = at;
  }

  /** One generation, one pass — and at most TWO reads: the second happens only
   *  when the first proved a truncation, which is the one condition under
   *  which the offset we asked from was wrong. */
  private async drain(
    dir: string, gen: string, from: number, lastSize: number, at: number,
  ): Promise<void> {
    const file = path.join(dir, `${LC_GEN_PREFIX}${gen}${LC_GEN_SUFFIX}`);
    const first = await this.deps.io.readFileFrom(file, from);
    if (first === null) return;                       // unreadable; retry next tick
    const framed = frameRead(from, first.data, first.size, lastSize);
    if (!framed.shrank) {
      this.commit(gen, framed.lines, framed.nextCursor, first.size, at);
      return;
    }
    // A TRUNCATION on an immutably-named generation. Record it, then re-read
    // from 0: `uid` dedupes what comes back, so only the genuinely-lost bytes
    // are lost — and the loss is a ROW, not a silence. `lostTo` is the LARGER
    // of the cursor and the last measured size, because a file cut to a length
    // still ahead of the cursor lost bytes above it.
    this.deps.store.recordGap({
      at, gen, reason: 'shrank',
      detail: `generation ${gen} shrank to ${first.size} bytes from ${Math.max(from, lastSize)} ` +
        '— truncated in place',
      lostFrom: first.size, lostTo: Math.max(from, lastSize),
    });
    const second = await this.deps.io.readFileFrom(file, 0);
    if (second === null) {
      // The cursor still has to leave the far side of the file, or every later
      // sweep re-records the same gap. Nothing was read, so nothing is ingested.
      this.commit(gen, [], 0, first.size, at);
      return;
    }
    const re = frameRead(0, second.data, second.size, 0);
    this.commit(gen, re.lines, re.nextCursor, second.size, at);
  }

  private commit(gen: string, lines: readonly string[], cursor: number, size: number, at: number): void {
    const rows: JournalRow[] = lines.map(parseJournalLine);
    this.deps.store.ingestJournal({ gen, rows, cursor, size, at });
  }

  /** `$REG/.lifecycle/errors` — ccd's own counted append failures (D7). Read,
   *  reported, and NEVER acted on: the journal is best-effort and never gates
   *  an act, and the errors file is the mitigation, not a kill switch. THREE
   *  CONDITIONS: absent (ccd has never written the counter — `null`),
   *  unreadable (keep the last measurement rather than manufacturing one), and
   *  a number. */
  private async readErrors(dir: string): Promise<number | null> {
    const r = await this.deps.io.readFileMeasured(path.join(dir, LC_ERRORS_NAME));
    if (!r.ok) return r.reason === 'absent' ? null : this.writeErrors;
    const n = Number(r.content.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  private state(): LifecycleHealth['state'] {
    return lifecycleState({
      ccdVerbs: this.deps.ccdVerbs(), lastOkAt: this.lastOkAt,
      nowMs: this.deps.now(), staleAfterMs: this.deps.staleAfterMs,
    });
  }

  health(): LifecycleHealth {
    const s = this.deps.store.lifecycleStats();
    return {
      state: this.state(),
      newestAt: s.newestAt, horizon: s.oldestAt, rows: s.rows,
      generations: s.generations, gaps: s.gaps,
      writeErrors: this.writeErrors, lastOk: this.lastOkAt,
    };
  }
}
