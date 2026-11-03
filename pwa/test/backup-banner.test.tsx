// D-7860: the backup banner and Settings' quiet Backups line. They read the server's `backup` block through
// `readBackupHealth` alone: the banner shows for failed or stale and for nothing else (a healthy backup shows none, and a
// box without backups never alarms), and the quiet line says every status. jsdom lays nothing out, so this file holds
// the words, the predicate, the markup and the rank; `browser/backup-banner.browser.test.ts` holds the geometry.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetHealth } from '../../shared/api';
import { backupVerdict, type BackupHealth, type BackupRead } from '../../shared/backup';
import { BANNER_ORDER } from '../src/fleet/BannerStack';
import { BackupBanner } from '../src/fleet/BackupBanner';
import { BackupSection } from '../src/fleet/BackupSection';
import { backupBannerLine, backupBannerShows, backupSettingsLine } from '../src/fleet/backupWords';

afterEach(cleanup);

const H = 3_600_000;
const NOW = Date.now();
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const judged = (r: BackupRead): BackupHealth => backupVerdict(r, NOW, NOW, 36);
const files = (f: Partial<Record<string, string>>): BackupRead => ({ state: 'read', files: f });
const BLOCKS = {
  'not-configured': judged({ state: 'not-configured' }),
  unreadable: judged({ state: 'unreadable', why: 'denied' }),
  ok: judged(files({ 'last-success': iso(NOW - 5 * H) })),
  warning: judged(files({ 'last-success': iso(NOW - 5 * H), 'last-warning': iso(NOW - 4 * H) })),
  failed: judged(files({ 'last-success': iso(NOW - 25 * H), 'last-failure': `${iso(NOW - H)} mode=backup exit=2 step-a` })),
  stale: judged(files({ 'last-success': iso(NOW - 40 * H) })),
} as const;
const health = (backup?: BackupHealth): FleetHealth => ({ mode: 'remote', connected: true, downSince: null, ...(backup === undefined ? {} : { backup }) });

describe('whether the backup banner shows (failed or stale only)', () => {
  it('shows for failed and for stale', () => {
    expect(backupBannerShows(health(BLOCKS.failed))).toBe(true);
    expect(backupBannerShows(health(BLOCKS.stale))).toBe(true);
  });

  it('a healthy backup shows no banner, and neither does a warning', () => {
    expect(backupBannerShows(health(BLOCKS.ok))).toBe(false);
    expect(backupBannerShows(health(BLOCKS.warning))).toBe(false);
  });

  it('not-configured shows no alarm, and neither does unreadable, an absent block or a malformed one', () => {
    expect(backupBannerShows(health(BLOCKS['not-configured']))).toBe(false);
    expect(backupBannerShows(health(BLOCKS.unreadable))).toBe(false);
    expect(backupBannerShows(health())).toBe(false);
    expect(backupBannerShows(null)).toBe(false);
    expect(backupBannerShows({ ...health(), backup: { status: 'failed' } } as unknown as FleetHealth)).toBe(false);
  });
});

describe('the words', () => {
  it('failed names the time and the exit; stale the hours since the last success', () => {
    expect(backupBannerLine(BLOCKS.failed, NOW)).toMatch(/^Backup failed at \d{2}:\d{2}( · \d+ \w+)? \(exit 2\)$/);
    expect(backupBannerLine(BLOCKS.stale, NOW)).toBe('No successful backup for 40 h');
    expect(backupBannerLine(judged(files({})), NOW)).toBe('No successful backup recorded');
  });

  it('the quiet line says every status', () => {
    expect(backupSettingsLine(health(BLOCKS.ok), NOW)).toBe('Last backup 5 h ago');
    expect(backupSettingsLine(health(BLOCKS.warning), NOW)).toBe('Last backup 5 h ago, with a warning');
    expect(backupSettingsLine(health(BLOCKS['not-configured']), NOW)).toBe('Backups not configured');
    expect(backupSettingsLine(health(BLOCKS.unreadable), NOW)).toBe('Backup status unreadable');
    expect(backupSettingsLine(health(BLOCKS.stale), NOW)).toBe('No successful backup for 40 h');
    expect(backupSettingsLine(health(BLOCKS.failed), NOW)).toMatch(/^Backup failed at /);
    expect(backupSettingsLine(health(), NOW)).toBe('Backup status not known yet');
  });
});

describe('the banner', () => {
  it('draws one status line with no control and no inline width; stale wears the dead tone, failed the attention tone', () => {
    const { container } = render(<BackupBanner health={health(BLOCKS.stale)} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('No successful backup for 40 h');
    expect(container.querySelectorAll('button, a, [style]')).toHaveLength(0);
    expect(container.firstElementChild!.className).toContain('border-status-dead');
    cleanup();
    expect(render(<BackupBanner health={health(BLOCKS.failed)} />).container.firstElementChild!.className).toContain('border-status-attention');
  });

  it('draws nothing for ok, warning, not-configured, unreadable and absent', () => {
    for (const b of [BLOCKS.ok, BLOCKS.warning, BLOCKS['not-configured'], BLOCKS.unreadable, undefined])
      expect(render(<BackupBanner health={health(b)} />).container.innerHTML).toBe('');
  });

  it('ranks after the disk alarm and ahead of the substrate line, as a status line the stack may fold', () => {
    expect(BANNER_ORDER['backup'].rank).toBeGreaterThan(BANNER_ORDER['disk'].rank);
    expect(BANNER_ORDER['backup'].rank).toBeLessThan(BANNER_ORDER['substrate'].rank);
    expect(BANNER_ORDER['backup']).toMatchObject({ role: 'status', module: 'BackupBanner' });
  });

  it('FleetScreen builds the item from the chrome health poll, once', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'FleetScreen.tsx'), 'utf8');
    expect(src.match(/<BackupBanner[\s/>]/g)).toHaveLength(1);
    expect(src).toContain("id: 'backup'");
    expect(src).toContain('shows: backupBannerShows(fleetHealth)');
  });
});

describe('Settings › Automation › Backups', () => {
  it('outside the shell\'s provider the card says not known, never an alarm', () => {
    render(<BackupSection />);
    expect(screen.getByRole('heading', { level: 3, name: 'Backups' })).toBeInTheDocument();
    expect(screen.getByText('Backup status not known yet')).toBeInTheDocument();
  });
});
