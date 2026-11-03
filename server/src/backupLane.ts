// D-7858. L4: the backup-health beat. It asks the fleet io for the backup state files on its own clock and keeps the
// last read that came back; the status is `shared/backup.ts#backupVerdict`'s, judged at the moment the block is read,
// so a backup that goes stale between two reads is stale on the next poll. `watch.ts` owns one of these and calls
// `sweep()` from its tick, beside the disk and pressure beats: it reads no registry.
import { backupVerdict, type BackupHealth, type BackupRead } from '../../shared/backup.js';
import type { Deps } from './deps.js';
import type { MeasuredBackup } from './io.js';

/** The lane's clock: one read a minute, the disk alarm's cadence, so a failed or stale backup shows within one
 *  fleet-health cycle of the box writing it. */
export const BACKUP_SWEEP_MS = 60_000;

export class BackupLane {
  /** The wall clock the pass last started on (0: never). */
  private lastSweep = 0;
  private inflight = false;
  private last: { at: number; read: BackupRead } | null = null;

  constructor(private readonly deps: () => Pick<Deps, 'io' | 'cfg'>, private readonly now: () => number = Date.now) {}

  /** The block for `GET /api/fleet/health`, or `null` before the first read landed (an agent without the op included):
   *  absence on the wire reads as UNKNOWN, never as healthy and never as an alarm. */
  block(): BackupHealth | null {
    return this.last === null ? null : backupVerdict(this.last.read, this.last.at, this.now(), this.deps().cfg.backupStaleHours);
  }

  /** One pass, throttled on its own clock, never two asks out at once. An ask that fails keeps the last read (its `at`
   *  says how old it is). Never rejects; PUBLIC through the watcher because `tick()` dispatches it with `void`. */
  async sweep(): Promise<void> {
    const at = this.now();
    if (this.inflight) return;
    if (this.lastSweep !== 0 && at - this.lastSweep < BACKUP_SWEEP_MS) return;
    this.lastSweep = at;
    this.inflight = true;
    let read: MeasuredBackup;
    try { read = await this.deps().io.backupMeasured(); } catch { read = { ok: false, reason: 'unanswered' }; }
    this.inflight = false;
    if (read.ok) this.last = { at: this.now(), read: read.read };
  }
}
