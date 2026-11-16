// D-6617 (spec 2026-10-23 fleet-disk-retention §2.5; plan Task DR-5): the disk banner. It reads the server's `disk` block
// through `readDiskHealth` alone, shows at warn and critical, hides at ok and unmeasured, and says the worst
// filesystem's percent and free space in one line. Geometry is held in a real Chrome by
// `browser/disk-banner.browser.test.ts`; jsdom lays nothing out, so this file holds what produces it: one banner, one
// line of text, the same markup in every skin, theme and width, and the stack's rank.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REFINED, INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import type { FleetHealth } from '../../shared/api';
import type { DiskFilesystemLevel, DiskHealth, DiskLevel } from '../../shared/disk';
import { BANNER_ORDER, BannerStack } from '../src/fleet/BannerStack';
import { DiskBanner } from '../src/fleet/DiskBanner';
import { diskBannerShows, diskLine } from '../src/fleet/diskWords';

afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-skin'); document.documentElement.removeAttribute('data-theme'); });

const GIB = 2 ** 30;
const fsys = (level: DiskLevel, usedPct: number, availGib: number, label = 'projects'): DiskFilesystemLevel => {
  // Sized so that used / (used + avail) is exactly `usedPct`, with no reserved blocks: free equals avail.
  const avail = availGib * GIB;
  const size = Math.round((avail * 100) / (100 - usedPct));
  const used = size - avail;
  return {
    dev: 'dev-a', mount: 'mount-a', fsType: 'ext4', roots: [label], sizeBytes: size, availBytes: avail, freeBytes: size - used,
    files: 1000, filesFree: 900, readOnly: false, level,
  };
};
const block = (level: DiskLevel, over: Partial<DiskHealth> = {}): DiskHealth => ({
  at: 1, level, filesystems: [fsys(level, level === 'critical' ? 93 : 86, 41)], expectedMounts: [], pressure: level === 'critical',
  holders: [], ...over,
});
const health = (disk?: DiskHealth): FleetHealth => ({ mode: 'remote', connected: true, downSince: null, ...(disk === undefined ? {} : { disk }) });

describe('whether the disk banner shows', () => {
  it('is hidden at ok and at unmeasured, and when the block is absent or malformed', () => {
    expect(diskBannerShows(health(block('ok')))).toBe(false);
    expect(diskBannerShows(health(block('unmeasured')))).toBe(false);
    expect(diskBannerShows(health())).toBe(false);
    expect(diskBannerShows(null)).toBe(false);
    expect(diskBannerShows({ mode: 'remote', connected: true, downSince: null, disk: { level: 'critical' } } as unknown as FleetHealth)).toBe(false);
  });

  it('is shown at warn and at critical', () => {
    expect(diskBannerShows(health(block('warn')))).toBe(true);
    expect(diskBannerShows(health(block('critical')))).toBe(true);
  });
});

describe('the one line', () => {
  it('names the percent and the free space, and says nothing of pressure below critical', () => {
    expect(diskLine(block('warn'))).toBe('Fleet disk 86% full · 41 GiB free');
  });

  it("adds 'sweeps in pressure mode' only when the block says pressure", () => {
    expect(diskLine(block('critical'))).toBe('Fleet disk 93% full · 41 GiB free · sweeps in pressure mode');
    expect(diskLine(block('critical', { pressure: false }))).toBe('Fleet disk 93% full · 41 GiB free');
    expect(diskLine(block('warn', { pressure: true }))).toContain('sweeps in pressure mode');
  });

  it('names the worst filesystem, by used percent, among those at warn or worse', () => {
    const d = block('critical', { filesystems: [fsys('warn', 88, 100, 'a'), fsys('critical', 95, 7.5, 'b'), fsys('ok', 10, 900, 'c')] });
    expect(diskLine(d)).toBe('Fleet disk 95% full · 7.5 GiB free · sweeps in pressure mode');
  });

  it('says a work mount is missing when the level is raised by a mount and no filesystem is over a threshold', () => {
    const d = block('critical', { filesystems: [fsys('ok', 10, 900)], expectedMounts: [{ path: 'mount-a', mounted: false }], pressure: false });
    expect(diskLine(d)).toBe('Fleet disk: a work mount is not mounted');
  });
});

describe('rank', () => {
  it('ranks after fleet-host and as a status line the stack may fold', () => {
    expect(BANNER_ORDER['disk'].rank).toBeGreaterThan(BANNER_ORDER['fleet-host'].rank);
    expect(BANNER_ORDER['disk'].role).toBe('status');
    expect(BANNER_ORDER['disk'].module).toBe('DiskBanner');
  });
});

describe('every width, skin and theme', () => {
  // The skin and theme are stamped on the root as the shell stamps them; the banner reads neither, so the same markup
  // must come out of every combination. The widths are the fleet's four; the geometry is the browser leg's.
  const WIDTHS = [360, 390, 1280, 1920] as const;
  const SKINS = [REFINED, INSTRUMENT] as const;
  const THEMES = [PHOSPHOR, 'light'] as const;

  it('draws one status line of one sentence, with no control and no inline width, in all sixteen views', () => {
    for (const skin of SKINS) for (const theme of THEMES) for (const width of WIDTHS) {
      document.documentElement.setAttribute('data-skin', skin);
      document.documentElement.setAttribute('data-theme', theme);
      const view = `${skin}, ${theme}, ${width}px`;
      const { container } = render(<DiskBanner health={health(block('critical'))} />);
      const status = screen.getAllByRole('status');
      expect(status, view).toHaveLength(1);
      expect(status[0]!.textContent, view).toBe('Fleet disk 93% full · 41 GiB free · sweeps in pressure mode');
      expect(container.querySelectorAll('button, a, [style]'), view).toHaveLength(0);
      cleanup();
    }
  });

  it('draws nothing at ok, so an absent banner leaves no empty box', () => {
    const { container } = render(<DiskBanner health={health(block('ok'))} />);
    expect(container.innerHTML).toBe('');
  });

  it('is critical in the dead tone and warn in the attention tone, both on the shared Banner', () => {
    const crit = render(<DiskBanner health={health(block('critical'))} />).container;
    expect(crit.firstElementChild!.className).toContain('border-status-dead');
    cleanup();
    const warn = render(<DiskBanner health={health(block('warn'))} />).container;
    expect(warn.firstElementChild!.className).toContain('border-status-attention');
  });
});

describe('the stack and the screen', () => {
  it('folds behind fleet-host and halt like any status line', () => {
    const line = (id: 'fleet-host' | 'halt' | 'disk', text: string) => ({ id, shows: true, node: <div role="status">{text}</div> });
    render(<BannerStack items={[line('disk', 'disk'), line('halt', 'halt'), line('fleet-host', 'host')]} />);
    expect(screen.getAllByRole('status').map((e) => e.textContent)).toEqual(['host', 'halt']);
    expect(screen.getByText('disk')).not.toBeVisible();
  });

  it('FleetScreen builds the item from the chrome health poll, once', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'FleetScreen.tsx'), 'utf8');
    expect(src.match(/<DiskBanner[\s/>]/g)).toHaveLength(1);
    expect(src).toContain("id: 'disk'");
    expect(src).toContain('shows: diskBannerShows(fleetHealth)');
  });
});
