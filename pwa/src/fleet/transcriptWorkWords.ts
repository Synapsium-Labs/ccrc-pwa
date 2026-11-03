// D-7898. L1: Settings › Automation › Work in transcript folders' words. They read the server's `disk.transcriptWork`
// block through `readDiskHealth` alone and decide nothing the server did not: the level is the server's
// (`server/src/disk.ts#transcriptWorkBlock`, the same two bounds doctor's `transcript_work` line judges). Absent is
// "not measured yet", never zero, and an unmeasured walk says so.
import type { FleetHealth } from '../../../shared/api';
import { readDiskHealth, type DiskTranscriptWork } from '../../../shared/disk';

const KIB = 1024;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** "512 B", "3 KiB", "41 MiB", "1.4 GiB": whole units below a GiB, one decimal from there. */
export function sizeWords(bytes: number): string {
  if (bytes >= GIB) return `${Math.floor((bytes / GIB) * 10) / 10} GiB`;
  if (bytes >= MIB) return `${Math.floor(bytes / MIB)} MiB`;
  if (bytes >= KIB) return `${Math.floor(bytes / KIB)} KiB`;
  return `${bytes} B`;
}

/** The block, or null before the server has one (an older server, or no walk reached it yet). */
export function transcriptWorkOf(health: FleetHealth | null | undefined): DiskTranscriptWork | null {
  return readDiskHealth(health ?? null)?.transcriptWork ?? null;
}

/** Whether the line wears the amber ink: over a bound, or a walk that did not finish. */
export function transcriptWorkAlarm(tw: DiskTranscriptWork | null): boolean {
  return tw !== null && tw.level !== 'ok';
}

/** The card's one line. */
export function transcriptWorkLine(tw: DiskTranscriptWork | null): string {
  if (tw === null) return 'Transcript folders not measured yet';
  if (tw.level === 'unmeasured') return 'Transcript folders unmeasured: the last count did not finish';
  if (tw.entries === 0) return 'No work kept in transcript folders';
  const n = `${tw.entries} ${tw.entries === 1 ? 'entry' : 'entries'} kept in transcript folders · ${sizeWords(tw.bytes)}`;
  return tw.level === 'warn' ? `${n}, over the warn bound` : n;
}

/** The largest entries, as the block names them (`<account>/<slug>/<entry>`), with their sizes. */
export function transcriptWorkTop(tw: DiskTranscriptWork | null): string[] {
  if (tw === null || tw.level === 'unmeasured') return [];
  return tw.top.map((e) => `${e.name} · ${sizeWords(e.bytes)}`);
}
