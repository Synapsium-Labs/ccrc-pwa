// D-6615, D-6616 (fleet disk retention spec §2.5); moved out of `watch.ts` by the consolidation (GitHub #1279). L4: the disk
// alarm's beat. It asks the fleet io what the work filesystems read, folds the answer through the pure decider
// (`disk.ts`: `diskVerdict`, `diskMarkFate`, `diskNotice`, and the two block builders), keeps the open episode's durable mark
// (`diskepisode.ts`) and sends the notice through the funnel; every decision is `disk.ts`'s. `watch.ts` owns one of these and
// calls `sweep()` from its tick, ABOVE the registry read's fail-shut return: a full disk is exactly when that read fails.
import type { DiskHealth } from '../../shared/disk.js';
import type { Deps } from './deps.js';
import { diskBlockOf, diskMarkFate, diskNotice, diskVerdict, unmeasuredDiskBlock, type DiskVerdict } from './disk.js';
import { clearDiskEpisode, readDiskEpisode, writeDiskEpisode } from './diskepisode.js';
import type { MeasuredDisk } from './io.js';
import { notify } from './notice.js';

/** The disk alarm's clock (D-6615, spec §2.5): one `statfs` pass a minute. */
export const DISK_SWEEP_MS = 60_000;

export class DiskAlarmLane {
  /** The wall clock the pass last started on (0: never). A pass spends its minute before it awaits anything. */
  private lastSweep = 0;
  private state: DiskVerdict | null = null;
  private held: DiskHealth | null = null;

  constructor(private readonly deps: () => Pick<Deps, 'io' | 'cfg' | 'coord' | 'notifyLog' | 'push' | 'viewers'>) {}

  /** The block as the last pass held it, or `null` before the first: absence on the wire reads as UNKNOWN, never as a
   *  healthy disk. `holders` is empty here; the tmp census's are overlaid by the watcher. */
  block(): DiskHealth | null { return this.held; }

  /**
   * One pass, throttled on its own clock. A read that could not be taken leaves the decider's memory alone and holds an
   * `unmeasured` (or standing `warn`/`critical`) block. Never rejects on a failed read; PUBLIC through the watcher for the
   * reason `sweepReadiness` is: `tick()` dispatches it with `void`.
   */
  async sweep(): Promise<void> {
    const now = Date.now();
    if (this.lastSweep !== 0 && now - this.lastSweep < DISK_SWEEP_MS) return;
    this.lastSweep = now;
    const d = this.deps();
    let read: MeasuredDisk;
    try { read = await d.io.statfsMeasured(); } catch { read = { ok: false, reason: 'unreadable' }; }
    if (!read.ok) { this.held = unmeasuredDiskBlock(this.held, now); return; }
    const before = this.state;
    let verdict = diskVerdict(before, read.measured, now);
    // The open episode is durable (the `pushRelease` rule: a latch that forgets on restart repeats the push). A process
    // that saw its own held episode close forgets the mark. One with no episode of its own judges the mark by the
    // filesystem(s) that pushed it: standing now, it resumes that episode (its key is already archived); every one clear
    // or gone, it forgets (a later rise is new); otherwise it keeps. A mark with no filesystem is stale.
    const dir = d.cfg.ccrcDir;
    if (before?.episode !== undefined) {
      if (verdict.level === 'ok') clearDiskEpisode(dir);
    } else {
      const mark = readDiskEpisode(dir);
      const fate = mark === null ? 'keep' : diskMarkFate(mark.devs, verdict, read.measured);
      if (mark !== null && fate === 'resume') verdict = { ...verdict, episode: mark.episode };
      else if (fate === 'forget') clearDiskEpisode(dir);
    }
    this.state = verdict;
    this.raiseNotice(before, verdict);
    this.held = diskBlockOf(verdict);
  }

  /**
   * The disk notice (D-6616, spec §2.5): `diskNotice` decides, this sends it through the notice funnel as a sessionless
   * `coord` notice. The once-only key is READ before the write (`hasNotice`), so a watcher restarted inside the same
   * episode raises nothing twice; the archive row `notify` writes carries the key for the next read. A store that
   * cannot answer costs the dedupe only, never the notice.
   */
  private raiseNotice(before: DiskVerdict | null, after: DiskVerdict): void {
    const n = diskNotice(before, after);
    if (n === null) return;
    const d = this.deps();
    // Mark the episode BEFORE the push, so a restart between the two finds it.
    if (n.mode === 'push' && after.episode !== undefined) writeDiskEpisode(d.cfg.ccrcDir, after.episode, n.dev);
    try { if (d.coord?.hasNotice('coord', '', n.dedupeKey) === true) return; } catch { /* send it: a repeat beats silence */ }
    notify(d, { kind: 'coord', sessionId: '', runId: null, title: n.title, body: n.body }, n.mode,
      { tag: 'disk', dedupeKey: n.dedupeKey, degraded: 'feed archive degraded, ring/push unaffected' });
  }
}
