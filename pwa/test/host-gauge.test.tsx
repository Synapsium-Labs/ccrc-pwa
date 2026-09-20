// The host gauge: what it draws and what it refuses to draw. (Where it sits is
// Task 7's file-level concern and is tested there.)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { HostStat, HostStatFailure } from '../../shared/hoststat';
import { HostGauge, failureWord, memBand } from '../src/fleet/HostGauge';
import { api } from '../src/lib/api';
import { declValue, ruleIn } from './cssRule';

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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('HostGauge readings', () => {
  it('draws the average, the two hottest threads and the memory split', async () => {
    stub(reading());
    render(<HostGauge />);
    expect(await screen.findByText('34%')).toBeTruthy();
    expect(screen.getByText('↑91·78')).toBeTruthy();
    expect(screen.getByText('57%')).toBeTruthy();       // 9.2G used of 16.0G
    expect(screen.getByText('sw 0.5G')).toBeTruthy();   // swap displaces the totals
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
    expect(screen.getByText('sw 1.8G')).toBeTruthy();
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
