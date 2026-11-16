// BackupBanner (D-7860): the fleet box's backup alarm as one line, "Backup failed at 03:34 (exit 2)" or "No successful
// backup for 40 h". It renders the server's `backup` block (health poll, `FleetChrome`'s one) and nothing else: no poll
// of its own, no status the server did not decide. Renders nothing exactly when `backupBannerShows` says so: only a
// failed or stale backup shows, and a box without backups never does.
//
// Stale wears the dead tone, a failed run the attention amber, both on @ccrc/ui's `Banner`, the disk banner's shape: a
// status line with no action and no width of its own (`browser/backup-banner.browser.test.ts` measures it).
import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { readBackupHealth } from '../../../shared/backup';
import { Banner } from '@ccrc/ui';
import { backupBannerLine, backupBannerShows, backupBannerTone } from './backupWords';

export function BackupBanner({ health }: { health: FleetHealth | null | undefined }): ReactNode {
  const b = readBackupHealth(health ?? null);
  if (b === null || !backupBannerShows(health)) return null;
  return <Banner tone={backupBannerTone(b) === 'critical' ? 'dead' : 'attention'}>{backupBannerLine(b, Date.now())}</Banner>;
}
