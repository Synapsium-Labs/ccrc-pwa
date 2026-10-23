// D-6613 (spec docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md §2.5; plan Task DR-1). L1: pure and
// clock-free (the clock is an argument), `fs`-free; it imports L0 alone. The disk alarm's DECISION: what level a
// filesystem is at, when a level changes, and what the fleet's level is. The tick that measures and the funnel that
// notifies are `watch.ts`'s (L4); nothing here reads a disk.
//
// EVERY UNCERTAIN ANSWER IS "UNMEASURED", NEVER "OK": a read of nothing, or of a filesystem that reports neither size
// nor inodes, must not look like a healthy disk. A MISSING EXPECTED MOUNT IS CRITICAL AT ONCE: a silently absent
// volume pages as plainly as a full one.
import {
  DISK_CLEAR_MARGIN_PCT, DISK_CRITICAL_PCT, DISK_WARN_PCT,
  type DiskExpectedMount, type DiskFilesystem, type DiskFilesystemLevel, type DiskLevel,
} from '../../shared/disk.js';

/** What one measurement pass read: the filesystems and the expected-mount answers. */
export interface DiskMeasured {
  readonly filesystems: readonly DiskFilesystem[];
  readonly expectedMounts: readonly DiskExpectedMount[];
}

/** A filesystem's held level and the one differing level seen once, awaiting its second sighting. */
export interface DiskFilesystemVerdict extends DiskFilesystemLevel {
  readonly pending: DiskLevel | null;
}

/** The decider's memory and answer, in one: pass the last one back as `prev`. */
export interface DiskVerdict {
  readonly at: number;
  readonly level: DiskLevel;
  readonly filesystems: readonly DiskFilesystemVerdict[];
  readonly expectedMounts: readonly DiskExpectedMount[];
}

/** Whether `used` of `total` is at least `pct` percent, by integer cross-multiplication: 85.0% is exactly 85. */
const atLeast = (used: number, total: number, pct: number): boolean => total > 0 && used * 100 >= pct * total;

/** Whether either of bytes-used and inodes-used is at least `pct` percent. */
function usedAtLeast(fs: DiskFilesystem, pct: number): boolean {
  return atLeast(fs.sizeBytes - fs.availBytes, fs.sizeBytes, pct) || atLeast(fs.files - fs.filesFree, fs.files, pct);
}

/** A filesystem that reports neither a size nor inodes tells nothing. */
const measurable = (fs: DiskFilesystem): boolean => fs.sizeBytes > 0 || fs.files > 0;

/** The level a single reading gives a filesystem, with no memory: the larger of bytes-used and inodes-used. */
export function diskLevelOf(fs: DiskFilesystem): DiskLevel {
  if (!measurable(fs)) return 'unmeasured';
  if (usedAtLeast(fs, DISK_CRITICAL_PCT)) return 'critical';
  if (usedAtLeast(fs, DISK_WARN_PCT)) return 'warn';
  return 'ok';
}

/** The level a reading gives a filesystem that HOLDS `held`: a held level clears only `DISK_CLEAR_MARGIN_PCT` below
 *  its threshold. */
function targetLevel(fs: DiskFilesystem, held: DiskLevel): DiskLevel {
  if (!measurable(fs)) return 'unmeasured';
  if (usedAtLeast(fs, DISK_CRITICAL_PCT)) return 'critical';
  if (held === 'critical' && usedAtLeast(fs, DISK_CRITICAL_PCT - DISK_CLEAR_MARGIN_PCT)) return 'critical';
  if (usedAtLeast(fs, DISK_WARN_PCT)) return 'warn';
  if ((held === 'warn' || held === 'critical') && usedAtLeast(fs, DISK_WARN_PCT - DISK_CLEAR_MARGIN_PCT)) return 'warn';
  return 'ok';
}

const RANK: Record<DiskLevel, number> = { unmeasured: 0, ok: 1, warn: 2, critical: 3 };

/** One measurement folded into the memory. A filesystem seen for the first time is taken as it reads (there is no held
 *  level to protect); after that a level changes only when two consecutive measurements agree on the new one. */
export function diskVerdict(prev: DiskVerdict | null, measured: DiskMeasured, nowMs: number): DiskVerdict {
  const before = new Map((prev?.filesystems ?? []).map((f) => [f.dev, f]));
  const filesystems = measured.filesystems.map((fs): DiskFilesystemVerdict => {
    const last = before.get(fs.dev);
    if (last === undefined) return { ...fs, level: diskLevelOf(fs), pending: null };
    const target = targetLevel(fs, last.level);
    if (target === last.level) return { ...fs, level: last.level, pending: null };
    if (last.pending === target) return { ...fs, level: target, pending: null };
    return { ...fs, level: last.level, pending: target };
  });
  const missingMount = measured.expectedMounts.some((m) => !m.mounted);
  let level: DiskLevel = 'unmeasured';
  for (const f of filesystems) if (RANK[f.level] > RANK[level]) level = f.level;
  if (missingMount) level = 'critical';
  return { at: nowMs, level, filesystems, expectedMounts: measured.expectedMounts };
}
