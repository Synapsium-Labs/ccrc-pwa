// #1170: the host-pressure banner. It reads the server's `psi` block through `readHostPressure` alone, shows at warn
// and critical and when the server read a stalled link as host pressure, hides at ok and unmeasured, and says the
// stalled shares in one line. jsdom lays nothing out, so this file holds what produces the geometry: one banner, one
// line of text, the same markup in every skin, theme and width, and the stack's rank.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REFINED, INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import type { FleetHealth } from '../../shared/api';
import type { HostPressureHealth, PressureLevel, PressureLink } from '../../shared/pressure';
import { BANNER_ORDER } from '../src/fleet/BannerStack';
import { PressureBanner } from '../src/fleet/PressureBanner';
import { pressureBannerShows, pressureLine } from '../src/fleet/pressureWords';

afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-skin'); document.documentElement.removeAttribute('data-theme'); });

const res = (full: number) => ({ some: { avg10: full + 5, avg60: full }, full: { avg10: full + 0.7, avg60: full } });
const block = (level: PressureLevel, link: PressureLink = 'answering', mem = 64, io = 8): HostPressureHealth => ({
  at: 1, level, link, memory: res(mem), io: res(io),
});
const health = (psi?: HostPressureHealth): FleetHealth => ({ mode: 'remote', connected: true, downSince: null, ...(psi === undefined ? {} : { psi }) });

describe('whether the pressure banner shows', () => {
  it('is hidden at ok and unmeasured with an answering or plainly down link, and when the block is absent or malformed', () => {
    expect(pressureBannerShows(health(block('ok')))).toBe(false);
    expect(pressureBannerShows(health(block('unmeasured')))).toBe(false);
    expect(pressureBannerShows(health(block('ok', 'link-down')))).toBe(false);
    expect(pressureBannerShows(health())).toBe(false);
    expect(pressureBannerShows(null)).toBe(false);
    expect(pressureBannerShows({ mode: 'remote', connected: true, downSince: null, psi: { level: 'critical' } } as unknown as FleetHealth)).toBe(false);
  });

  it('is shown at warn, at critical, and on a stall the server read as host pressure', () => {
    expect(pressureBannerShows(health(block('warn', 'answering', 12)))).toBe(true);
    expect(pressureBannerShows(health(block('critical')))).toBe(true);
    expect(pressureBannerShows(health(block('unmeasured', 'host-pressure')))).toBe(true);
  });
});

describe('the one line', () => {
  it('warn names the pressure and the larger full share of each resource, floored', () => {
    expect(pressureLine(block('warn', 'answering', 12, 3))).toBe('Fleet host under memory or io pressure · memory stalled 12% · io 3%');
  });

  it('critical says thrashing', () => {
    expect(pressureLine(block('critical'))).toBe('Fleet host thrashing · memory stalled 64% · io 8%');
  });

  it('host pressure says the agent is stalled, not offline', () => {
    expect(pressureLine(block('critical', 'host-pressure'))).toBe('Fleet host thrashing: the agent is stalled by host pressure, not offline · memory stalled 64% · io 8%');
    expect(pressureLine({ at: null, level: 'unmeasured', link: 'host-pressure', memory: null, io: null }))
      .toBe('Fleet host thrashing: the agent is stalled by host pressure, not offline');
  });
});

describe('rank', () => {
  it('ranks right after fleet-host and ahead of halt and disk, as a status line the stack may fold', () => {
    expect(BANNER_ORDER['pressure'].rank).toBeGreaterThan(BANNER_ORDER['fleet-host'].rank);
    expect(BANNER_ORDER['pressure'].rank).toBeLessThan(BANNER_ORDER['halt'].rank);
    expect(BANNER_ORDER['pressure'].rank).toBeLessThan(BANNER_ORDER['disk'].rank);
    expect(BANNER_ORDER['pressure'].role).toBe('status');
    expect(BANNER_ORDER['pressure'].module).toBe('PressureBanner');
  });
});

describe('every width, skin and theme', () => {
  const WIDTHS = [360, 390, 1280, 1920] as const;
  const SKINS = [REFINED, INSTRUMENT] as const;
  const THEMES = [PHOSPHOR, 'light'] as const;

  it('draws one status line of one sentence, with no control and no inline width, in all sixteen views', () => {
    for (const skin of SKINS) for (const theme of THEMES) for (const width of WIDTHS) {
      document.documentElement.setAttribute('data-skin', skin);
      document.documentElement.setAttribute('data-theme', theme);
      const view = `${skin}, ${theme}, ${width}px`;
      const { container } = render(<PressureBanner health={health(block('critical'))} />);
      const status = screen.getAllByRole('status');
      expect(status, view).toHaveLength(1);
      expect(status[0]!.textContent, view).toBe('Fleet host thrashing · memory stalled 64% · io 8%');
      expect(container.querySelectorAll('button, a, [style]'), view).toHaveLength(0);
      cleanup();
    }
  });

  it('draws nothing at ok, so an absent banner leaves no empty box', () => {
    expect(render(<PressureBanner health={health(block('ok'))} />).container.innerHTML).toBe('');
  });

  it('critical and host pressure wear the dead tone, warn the attention tone, on the shared Banner', () => {
    expect(render(<PressureBanner health={health(block('critical'))} />).container.firstElementChild!.className).toContain('border-status-dead');
    cleanup();
    expect(render(<PressureBanner health={health(block('unmeasured', 'host-pressure'))} />).container.firstElementChild!.className).toContain('border-status-dead');
    cleanup();
    expect(render(<PressureBanner health={health(block('warn', 'answering', 12))} />).container.firstElementChild!.className).toContain('border-status-attention');
  });
});

describe('the screen', () => {
  it('FleetScreen builds the item from the chrome health poll, once', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'FleetScreen.tsx'), 'utf8');
    expect(src.match(/<PressureBanner[\s/>]/g)).toHaveLength(1);
    expect(src).toContain("id: 'pressure'");
    expect(src).toContain('shows: pressureBannerShows(fleetHealth)');
  });
});
