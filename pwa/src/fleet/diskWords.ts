// D-6617 (spec docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md §2.5; plan Task DR-5). L1: the disk
// banner's words and its predicate. It reads the server's `disk` block through `readDiskHealth` alone and works out
// nothing the server did not decide: the level is the server's, and the line names the worst filesystem the block
// carries. Absent, malformed, `ok` and `unmeasured` all read as "no banner": the first two are unknown, and a banner
// that fires on nothing stops being read.
import type { FleetHealth } from '../../../shared/api';
import { readDiskHealth, type DiskFilesystemLevel, type DiskHealth } from '../../../shared/disk';

/** Does the banner show? The server's level is `warn` or `critical`. The banner stack asks it (BannerStack.tsx). */
export function diskBannerShows(health: FleetHealth | null | undefined): boolean {
  const disk = readDiskHealth(health ?? null);
  return disk !== null && (disk.level === 'warn' || disk.level === 'critical');
}

/** Percent used the way `df` reads it (used / (used + avail), reserved blocks neither), floored so a figure never
 *  reads higher than the threshold it crossed. Inodes count too: the server's level is the larger of the two. */
function usedPct(fs: DiskFilesystemLevel): number {
  const used = Math.max(0, fs.sizeBytes - fs.freeBytes);
  const bytes = used + fs.availBytes > 0 ? (used * 100) / (used + fs.availBytes) : 0;
  const inodes = fs.files > 0 ? ((fs.files - fs.filesFree) * 100) / fs.files : 0;
  return Math.floor(Math.max(bytes, inodes));
}

const GIB = 2 ** 30;
const TIB = 2 ** 40;

/** "41 GiB", "7.5 GiB", "1.2 TiB": a whole number from ten up, one decimal below. */
function bytesWords(bytes: number): string {
  const [n, unit] = bytes >= TIB ? [bytes / TIB, 'TiB'] : [bytes / GIB, 'GiB'];
  return `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} ${unit}`;
}

/** The one line: the worst raised filesystem's percent and free space, and the pressure clause only when the block
 *  says `pressure`. A level raised by a work mount that is not mounted, with no filesystem over a threshold, names
 *  the mount instead (the numbers would all read healthy). */
export function diskLine(disk: DiskHealth): string {
  const raised = disk.filesystems.filter((f) => f.level === 'warn' || f.level === 'critical');
  const worst = raised.reduce<DiskFilesystemLevel | null>((w, f) => (w === null || usedPct(f) > usedPct(w) ? f : w), null);
  if (worst === null) return 'Fleet disk: a work mount is not mounted';
  const tail = disk.pressure ? ' · sweeps in pressure mode' : '';
  return `Fleet disk ${usedPct(worst)}% full · ${bytesWords(worst.availBytes)} free${tail}`;
}
