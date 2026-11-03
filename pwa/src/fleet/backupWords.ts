// D-7860. L1: the backup banner's words and predicate, and Settings › Automation › Backups' quiet line. They read the
// server's `backup` block through `readBackupHealth` alone and decide nothing the server did not: the status is the
// server's (`shared/backup.ts#backupVerdict`). Only `failed` and `stale` raise the banner; absent, malformed, `ok`,
// `warning`, `unreadable` and `not-configured` never do, because a box without backups must never alarm and a banner
// that fires on nothing stops being read. The quiet line says every status.
import type { FleetHealth } from '../../../shared/api';
import { readBackupHealth, type BackupHealth } from '../../../shared/backup';
import { resetClock } from '../lib/clock';

const HOUR_MS = 3_600_000;

/** Does the banner show? The server's status is `failed` or `stale`. The banner stack asks it (BannerStack.tsx). */
export function backupBannerShows(health: FleetHealth | null | undefined): boolean {
  const b = readBackupHealth(health ?? null);
  return b !== null && (b.status === 'failed' || b.status === 'stale');
}

/** Local "HH:MM", with the day when it is not today (`resetClock`'s spelling). */
const when = (ms: number, now: number): string => resetClock(ms / 1000, new Date(now)) ?? '—';

/** "N h", whole hours floored, never below zero. */
const hours = (ms: number): string => `${Math.max(0, Math.floor(ms / HOUR_MS))} h`;

/** The banner's one line, for a block the predicate shows. */
export function backupBannerLine(b: BackupHealth, now: number): string {
  if (b.status === 'stale') {
    const age = b.stale?.ageH ?? null;
    return age === null ? 'No successful backup recorded' : `No successful backup for ${age} h`;
  }
  const f = b.lastFailure;
  if (f === null) return 'Backup failed';
  return `Backup failed at ${when(f.at, now)}${f.exit === null ? '' : ` (exit ${f.exit})`}`;
}

/** The banner's tone: stale is the dead tone (nothing is being kept), a failed run the attention amber. */
export function backupBannerTone(b: BackupHealth): 'critical' | 'warn' {
  return b.status === 'stale' ? 'critical' : 'warn';
}

/** Settings' quiet line for the block, or the unknown line when there is none (an older server, or no read yet). */
export function backupSettingsLine(health: FleetHealth | null | undefined, now: number): string {
  const b = readBackupHealth(health ?? null);
  if (b === null) return 'Backup status not known yet';
  switch (b.status) {
    case 'not-configured': return 'Backups not configured';
    case 'unreadable': return 'Backup status unreadable';
    case 'stale':
    case 'failed': return backupBannerLine(b, now);
    case 'warning': return `Last backup ${hours(now - (b.lastSuccessAt ?? now))} ago, with a warning`;
    case 'ok': return `Last backup ${hours(now - (b.lastSuccessAt ?? now))} ago`;
  }
}
