// Settings › Automation › Backups (D-7860): one quiet line about the fleet box's backup, "Last backup 5 h ago",
// "Backups not configured" or "Backup status unreadable", and the failed or stale line the banner says. It reads the
// server's `backup` block from the shell's one health poll (`FleetChrome`), never an endpoint of its own, and offers no
// control: the backup is a job outside ccrc, and its directory and staleness are deployment settings.
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import { readBackupHealth } from '../../../shared/backup';
import { useChromeHealthIfMounted } from './FleetChrome';
import { backupSettingsLine } from './backupWords';
import { SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_NOW_CLASS } from './settingsText';

export function BackupSection(): ReactNode {
  const health = useChromeHealthIfMounted();
  const card = SETTINGS_CARDS.automation.backup;
  const b = readBackupHealth(health ?? null);
  const alarm = b !== null && (b.status === 'failed' || b.status === 'stale' || b.status === 'unreadable');
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      <p className={alarm ? SETTINGS_AMBER_NOTE : SETTINGS_NOW_CLASS.note} data-backup-line="">
        {backupSettingsLine(health, Date.now())}
      </p>
    </Section>
  );
}
