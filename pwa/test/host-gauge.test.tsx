// The host gauge: what it draws and what it refuses to draw. (Where it sits is
// Task 7's file-level concern and is tested there.)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { HostStat, HostStatFailure } from '../../shared/hoststat';
import { HostGauge, failureWord, memBand } from '../src/fleet/HostGauge';
import { api } from '../src/lib/api';
import { declValue, declaredValues, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

const reading = (over: Partial<HostStat> = {}): HostStat => ({
  at: Date.now(),
  cpu: { ok: true, total: 34, perCpu: [{ id: 0, pct: 12 }, { id: 3, pct: 91 }, { id: 7, pct: 78 }], windowMs: 6000 },
  mem: {
    ok: true, totalKb: 16000000, usedKb: 9200000, cacheKb: 4800000,
    availableKb: 6000000, swapTotalKb: 2000000, swapUsedKb: 500000,
  },
  ...over,
});

const stub = (stat: HostStat): void => { vi.spyOn(api, 'host').mockResolvedValue(stat); };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); navigate('/'); });

describe('HostGauge readings', () => {
  it('draws the average, the two hottest threads and the memory split', async () => {
    stub(reading());
    render(<HostGauge />);
    expect(await screen.findByText('34%')).toBeTruthy();
    expect(screen.getByText('↑91·78')).toBeTruthy();
    expect(screen.getByText('57%')).toBeTruthy();       // 9.2G used of 16.0G
    // The USED figure is present while swapping. It used to be displaced by the
    // swap readout, and on a box that always has some swap in use — this fleet —
    // that meant the gigabytes never showed at all (operator, 2026-09-28).
    expect(screen.getByText('8.8/15.3G')).toBeTruthy();
    expect(screen.queryByText(/^sw /)).toBeNull();
    const ticks = document.querySelectorAll('.host-tick');
    expect(ticks).toHaveLength(2);
    expect(ticks[0]?.getAttribute('data-hot')).toBe('true');   // 91% is pegged
    expect(ticks[1]?.getAttribute('data-hot')).toBeNull();     // 78% is not
    // A tick can only ever sit on the empty part of the track: no average
    // outruns its own maximum.
    expect((ticks[0] as HTMLElement).style.left).toContain('91%');
  });

  it('shows the totals instead when nothing is swapping, and draws no swap track at all', async () => {
    stub(reading({ mem: { ok: true, totalKb: 16000000, usedKb: 4000000, cacheKb: 2000000, availableKb: 12000000, swapTotalKb: 2000000, swapUsedKb: 0 } }));
    render(<HostGauge />);
    expect(await screen.findByText('3.8/15.3G')).toBeTruthy();
    // Configured swap that nobody is using draws nothing: one bar, not one bar
    // and an empty promise of another. The row keeps its height either way.
    expect(document.querySelector('.host-swap')).toBeNull();
    expect(declValue(ruleIn(fleetCss, '.host-mem'), 'grid-template-rows')).toBe('5px 3px');
  });

  it('puts swap on its OWN track, on its OWN scale — it can never overlap the RAM segments', async () => {
    // The box closest to an OOM is the one this has to get right: 93% used and
    // nearly all of swap gone. Pinned into the RAM track, the violet would be
    // drawn on top of the red exactly here.
    stub(reading({
      mem: { ok: true, totalKb: 16000000, usedKb: 14900000, cacheKb: 400000, availableKb: 700000, swapTotalKb: 2000000, swapUsedKb: 1900000 },
    }));
    render(<HostGauge />);
    await screen.findByText('93%');
    const swap = document.querySelector('.host-swap');
    expect(swap).not.toBeNull();
    // A SIBLING of the RAM track, never a child of it — the structural half of
    // "cannot overlap"; the visual half is the two grid rows.
    expect(swap?.closest('.host-meter')).toBeNull();
    expect(swap?.parentElement?.className).toBe('host-mem');
    // 1.9G of 2.0G swap = 95%, NOT 1.9G of 16G RAM = 12%.
    expect((document.querySelector('.host-swap-fill') as HTMLElement).style.width).toBe('95%');
    expect(screen.getByText('14.2/15.3G')).toBeTruthy();
    // Swap's own number lives on the hairline it belongs to, not in a cell that
    // would cost the reading the bar is for.
    expect(document.querySelector('.host-swap')?.getAttribute('title')).toContain('1.8G');
  });

  it('draws memory as one pill in two tones — the cap belongs to the last segment', async () => {
    // The join between used and cache must not carry a rounded cap: at 5px high
    // that is a notch with the dark track showing through it.
    stub(reading());
    render(<HostGauge />);
    await screen.findByText('57%');
    expect(document.querySelector('.host-fill--mem')?.getAttribute('data-tail')).toBeNull();
    expect(declValue(ruleIn(fleetCss, '.host-fill--mem'), 'border-radius')).toBe('0');
    cleanup();
    // …and with no cache worth drawing, the used fill takes the cap back, so
    // the bar never ends in a square edge.
    stub(reading({ mem: { ok: true, totalKb: 16000000, usedKb: 9200000, cacheKb: 0, availableKb: 6800000, swapTotalKb: 0, swapUsedKb: 0 } }));
    render(<HostGauge />);
    await screen.findByText('57%');
    expect(document.querySelector('.host-fill--mem')?.getAttribute('data-tail')).toBe('true');
    expect(document.querySelector('.host-seg-cache')).toBeNull();
  });

  it('draws no ticks on a single-thread box — the hottest thread IS the average there', async () => {
    stub(reading({ cpu: { ok: true, total: 61, perCpu: [{ id: 0, pct: 61 }], windowMs: 6000 } }));
    render(<HostGauge />);
    expect(await screen.findByText('61%')).toBeTruthy();
    expect(document.querySelectorAll('.host-tick')).toHaveLength(0);
  });

  // REVIEW FOCUS 4: a 128-thread box still gets exactly two ticks, and they are
  // the right two.
  it('draws two ticks and only two on a 128-thread box', async () => {
    const perCpu = Array.from({ length: 128 }, (_, id) => ({ id, pct: id === 97 ? 99 : id === 12 ? 96 : 3 }));
    stub(reading({ cpu: { ok: true, total: 9, perCpu, windowMs: 6000 } }));
    render(<HostGauge />);
    expect(await screen.findByText('↑99·96')).toBeTruthy();
    expect(document.querySelectorAll('.host-tick')).toHaveLength(2);
  });

  it('bands memory at 75/90, not the account ladder\'s 50/75', async () => {
    expect(memBand(60)).toBe('ok');
    expect(memBand(75)).toBe('warn');
    expect(memBand(91)).toBe('crit');
    stub(reading({ mem: { ok: true, totalKb: 1000, usedKb: 950, cacheKb: 20, availableKb: 30, swapTotalKb: 0, swapUsedKb: 0 } }));
    render(<HostGauge />);
    await screen.findByText('95%');
    expect(document.querySelector('.host-fill--mem')?.getAttribute('data-band')).toBe('crit');
  });

  it('never bands the cpu row — a busy fleet box is doing its job', async () => {
    stub(reading({ cpu: { ok: true, total: 97, perCpu: [{ id: 0, pct: 99 }, { id: 1, pct: 95 }], windowMs: 6000 } }));
    render(<HostGauge />);
    await screen.findByText('97%');
    expect(document.querySelector('.host-fill--cpu')?.getAttribute('data-band')).toBeNull();
  });
});

describe('HostGauge when there is no reading', () => {
  const WHYS: readonly HostStatFailure[] = ['offline', 'timeout', 'unsupported', 'absent', 'unreadable', 'unparsable'];

  it('gives each of the six conditions its own word — they are six different fixes', () => {
    expect(new Set(WHYS.map(failureWord)).size).toBe(WHYS.length);
  });

  // REVIEW FOCUS 1: the union is closed at compile time and OPEN on the wire.
  it('renders a word for a condition this build has never heard of', () => {
    // A newer server naming a seventh condition must not print `undefined` in
    // the cell. Absence-permits cuts both ways.
    expect(failureWord('brand-new' as HostStatFailure)).toBe('no reading');
  });

  it('renders a dash and the condition, never a zero', async () => {
    stub(reading({ cpu: { ok: false, why: 'unsupported' }, mem: { ok: false, why: 'unsupported' } }));
    render(<HostGauge />);
    // BOTH rows say it: the two halves fail separately and each says so.
    expect(await screen.findAllByText('agent old')).toHaveLength(2);
    expect(screen.queryByText('0%')).toBeNull();
    expect(document.querySelectorAll('.host-fill')).toHaveLength(0);
  });

  it('fails the two rows independently — an unreadable /proc/meminfo leaves the cpu row measured', async () => {
    stub(reading({ mem: { ok: false, why: 'unreadable' } }));
    render(<HostGauge />);
    expect(await screen.findByText('34%')).toBeTruthy();
    expect(screen.getByText('no access')).toBeTruthy();
  });

  it('keeps the last reading when the body is one it cannot read', async () => {
    // A type is not a guard: several fixtures in this suite answer an unmatched
    // route with a bare `{}`, and `cpu.ok` on that throws inside render.
    vi.spyOn(api, 'host').mockResolvedValue({} as unknown as HostStat);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<HostGauge />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);   // still the placeholder, not a crash
  });

  it('survives a measured cpu half carrying no per-thread list', async () => {
    // The tile's own second line of defence behind the server's shape check:
    // `isReading` accepts a half that says `ok: true`, and `CpuRow` reads
    // `perCpu.length` immediately. There is no error boundary anywhere in this
    // app, so a throw here unmounts the ROOT — the whole console goes blank,
    // which is worse than the one row this tile was asked to draw.
    stub({ at: Date.now(), cpu: { ok: true, total: 34, windowMs: 6000 }, mem: { ok: false, why: 'absent' } } as unknown as HostStat);
    render(<HostGauge />);
    expect(await screen.findByText('34%')).toBeTruthy();
    expect(document.querySelectorAll('.host-tick')).toHaveLength(0);
  });

  it('greys a reading that has stopped arriving instead of letting it read as live', async () => {
    stub(reading({ at: Date.now() - 5 * 60_000 }));
    render(<HostGauge />);
    await screen.findByText('34%');
    expect(document.querySelector('.host-gauge')?.getAttribute('data-stale')).toBe('true');
    expect(screen.getByText(/old$/)).toBeTruthy();
    // The greying is CSS, and jsdom applies none — so the rule itself is read
    // as text. Deleting it would leave a frozen bar looking like live pressure.
    expect(ruleIn(fleetCss, ".host-gauge[data-stale='true'] .host-fill")).toContain('var(--edge-subtle)');
  });

  it('does not poll a tab nobody is looking at, and snaps current when it comes back', async () => {
    const spy = vi.spyOn(api, 'host').mockResolvedValue(reading());
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<HostGauge />);
    expect(spy).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

import { App } from '../src/app';
import { navigate } from '../src/lib/router';

const shellCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles', 'shell.css'), 'utf8');

const desktop = (): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width'),
    media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
};

/** The tile carries no role and no aria-label by design (HostGauge.tsx says
 *  why), so it is found the way the stylesheet finds it. */
const findGauge = async (): Promise<HTMLElement> => {
  await screen.findByText('host');
  const el = document.querySelector('.host-gauge');
  expect(el).not.toBeNull();
  return el as HTMLElement;
};

describe('where the gauge sits', () => {
  it('is NOT inside the accounts strip — that whole grid is one link to /accounts', async () => {
    stub(reading());
    render(<App />);
    const gauge = await findGauge();
    expect(gauge.closest('[role="link"]')).toBeNull();
    expect(gauge.closest('.accounts-strip')).toBeNull();
  });

  it('rides the desktop top bar in its OWN column, beside the strip rather than inside it', async () => {
    desktop();
    stub(reading());
    render(<App />);
    const gauge = await findGauge();
    expect(gauge.closest('.host-col')).not.toBeNull();
    expect(gauge.closest('.accounts-bar')).not.toBeNull();
    expect(gauge.closest('.accounts-strip')).toBeNull();
    // Exactly one — the mobile mount and the top bar are alternatives, never
    // both, or the box would be polled twice and drawn twice.
    expect(document.querySelectorAll('.host-gauge')).toHaveLength(1);
  });

  it('keeps a fixed column at the right edge, so its place does not depend on how many accounts there are', () => {
    // The requirement in one line of CSS: the bar is `1fr auto`, the accounts
    // take the elastic column and the gauge's own column is a fixed width. A
    // mutant that drops the width, or folds the gauge back into the accounts
    // grid, moves the tile every time a lane is added or disabled.
    expect(declValue(ruleIn(shellCss, '.shell-accounts .accounts-bar'), 'grid-template-columns'))
      .toBe('minmax(0,1fr)auto');   // declValue normalises whitespace
    expect(declValue(ruleIn(shellCss, '.shell-accounts .host-gauge'), 'width')).toBe('264px');
    // The accounts grid keeps its own auto-fit reflow — the two columns are
    // independent, which is what makes the gauge's position stable while the
    // strip's contents move.
    expect(declValue(ruleIn(shellCss, '.shell-accounts .accounts-strip'), 'grid-template-columns'))
      .toContain('auto-fit');
  });
});

describe('what the meters are painted on', () => {
  // The meter WELL is dark in BOTH themes (`--bg-well`, "deliberately dark in
  // light theme"), while the ink tokens flip with the theme. So anything
  // painted on the well must be chosen against the WELL, not against the page
  // — the defect this pins: the hottest-thread tick took `--ink-primary`, which
  // in the light theme is near-black on a near-black well, 1.09:1. The tick the
  // whole cpu row exists for was invisible on the operator's own screen.
  //
  // The contrast GATE audits `color`, never a painted segment, so this is the
  // mechanism for these four.
  const tokens = readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8');
  const themeOf = (name: string): Record<string, string> => {
    // The dark values sit in the first `:root` block; the light ones in the
    // block that redefines them. Take the LAST definition for light, the first
    // for dark, which is how the cascade reads them.
    const all = [...tokens.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)];
    const out: Record<string, string> = {};
    for (const m of all) {
      const k = m[1]!, v = m[2]!;
      if (name === 'dark') { if (!(k in out)) out[k] = v; } else out[k] = v;
    }
    return out;
  };
  const lum = (hex: string): number => {
    const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * n[0]! + 0.7152 * n[1]! + 0.0722 * n[2]!;
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: the hottest tick reads on the well it sits on`, () => {
      const t = themeOf(theme);
      expect(ratio(t['ink-on-well']!, t['bg-well']!)).toBeGreaterThanOrEqual(7);
    });

    it(`${theme}: the cache tone is a step away from every band it sits beside`, () => {
      const t = themeOf(theme);
      // One pill in two tones only works if the two tones separate. At
      // --ink-tertiary this was 1.31:1 against the ok band and the bar read as
      // one continuous fill to the end of cache.
      for (const band of ['limit-ok', 'limit-warn', 'limit-critical']) {
        expect(ratio(t['mem-cache']!, t[band]!), `${theme} mem-cache vs ${band}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme}: a used fill reads against the empty track`, () => {
      const t = themeOf(theme);
      expect(ratio(t['limit-ok']!, t['bg-well']!)).toBeGreaterThanOrEqual(3);
    });
  }

  it('paints the ticks and the cache from well-anchored tokens, never from page ink', () => {
    // The mutation this catches: someone reaches for --ink-primary again because
    // it is the obvious "strongest" colour. It is the strongest on the PAGE.
    expect(ruleIn(fleetCss, '.host-tick')).toContain('var(--ink-on-well)');
    expect(ruleIn(fleetCss, '.host-tick')).not.toContain('var(--ink-primary)');
    // Two paints, in this order: its own tone, then the grey a STALE reading
    // takes (further down the file). The page ink it used to carry is gone.
    const cache = declaredValues(fleetCss, '.host-seg-cache', 'background');
    expect(cache[0]).toBe('var(--mem-cache)');
    expect(cache).not.toContain('var(--ink-tertiary)');
  });
});

describe('the rows line up, and the tile matches its neighbours', () => {
  it('gives both rows the same meter width by fixing the trailing column', () => {
    // `.acct-row` is `auto 1fr auto auto` per row, so a shorter trailing readout
    // hands its slack to the meter and the cpu track outruns the mem track —
    // visible on the operator's screen as two bars of different length.
    expect(declValue(ruleIn(fleetCss, '.host-gauge .host-trail'), 'min-width')).toBeTruthy();
  });

  it('lets the tile take the same height as the account gauges beside it', () => {
    // The account gauges STRETCH to the accounts-strip row; `align-items: start`
    // held the host tile at its natural height, 37px against their 44px.
    expect(declValue(ruleIn(shellCss, '.shell-accounts .accounts-bar'), 'align-items')).toBe('stretch');
  });
});
