// The host reading, from /proc text to the wire.
//
// Every guard in `shared/hoststat.ts` is here with a case that goes RED when the
// guard is deleted — the parsers' `null`s especially, because each one stands
// between the widget and a fabricated zero. The distinction these tests exist to
// protect: NOT MEASURED is not 0%.
import { describe, it, expect } from 'vitest';
import {
  cpuBetween,
  hostStatFailed,
  hottestCpus,
  parseMeminfo,
  parseProcStat,
} from '../../shared/hoststat.js';

// Two readings of a two-CPU box 100 jiffies apart: the box is 50% busy over the
// window, cpu0 spent all of it working and cpu1 spent all of it idle. Numbers
// chosen so every assertion is exact.
export const STAT_A = [
  'cpu  1000 0 500 8000 100 0 0 0 0 0',
  'cpu0 500 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4000 50 0 0 0 0 0',
  'intr 98765 1 2 3',
  'ctxt 4242',
].join('\n');

export const STAT_B = [
  'cpu  1100 0 500 8100 100 0 0 0 0 0',
  'cpu0 600 0 250 4000 50 0 0 0 0 0',
  'cpu1 500 0 250 4100 50 0 0 0 0 0',
  'intr 98999 1 2 3',
  'ctxt 4343',
].join('\n');

export const MEMINFO = [
  'MemTotal:       16000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          500000 kB',
  'Cached:          4000000 kB',
  'SwapCached:            0 kB',
  'SwapTotal:       2000000 kB',
  'SwapFree:        1500000 kB',
  'SReclaimable:     500000 kB',
  'Shmem:            200000 kB',
  '',
].join('\n');

describe('parseProcStat', () => {
  it('reads ids from the NAMES, so an offline CPU cannot shift the others', () => {
    // cpu1 is offline: the kernel omits its line entirely. Positionally, cpu2 is
    // "the second one"; by id it is cpu2, and a widget that says "#2 is pegged"
    // has to mean the CPU the operator can go and look at.
    const s = parseProcStat(['cpu  10 0 10 80 0', 'cpu0 5 0 5 40 0', 'cpu2 5 0 5 40 0'].join('\n'));
    expect(s?.cpus.map((c) => c.id)).toEqual([0, 2]);
  });

  it('counts iowait as IDLE — a disk-bound box is waiting, not working', () => {
    const busyOnly = parseProcStat('cpu  100 0 0 0 0');
    const allIowait = parseProcStat('cpu  0 0 0 0 100');
    expect(busyOnly?.all.busy).toBe(100);
    expect(allIowait?.all.busy).toBe(0);
    expect(allIowait?.all.total).toBe(100);
  });

  it('answers null — never an empty reading — for a shape it does not understand', () => {
    expect(parseProcStat('')).toBeNull();
    expect(parseProcStat('intr 1 2 3\nctxt 9')).toBeNull();       // no cpu line at all
    expect(parseProcStat('cpu0 1 2 3 4\nintr 1')).toBeNull();     // no aggregate line
    expect(parseProcStat('cpu  1 2 3')).toBeNull();               // too few columns
    expect(parseProcStat('cpu  1 2 three 4')).toBeNull();         // not a number
    expect(parseProcStat('cpu  1 2 3 -4')).toBeNull();            // counters do not go negative
  });
});

describe('parseMeminfo', () => {
  it('splits memory the way htop does — used, reclaimable cache, swap', () => {
    const m = parseMeminfo(MEMINFO);
    expect(m).not.toBeNull();
    expect(m?.cacheKb).toBe(500000 + 4000000 + 500000 - 200000);
    expect(m?.usedKb).toBe(16000000 - 2000000 - 4800000);
    expect((m?.usedKb ?? 0) + (m?.cacheKb ?? 0) + 2000000).toBe(m?.totalKb);
    expect(m?.swapUsedKb).toBe(500000);
    expect(m?.availableKb).toBe(6000000);
  });

  it('derives MemAvailable when the kernel does not report it, and reads no swap as zero', () => {
    const m = parseMeminfo([
      'MemTotal:        1000 kB', 'MemFree:          400 kB', 'Buffers:          100 kB', 'Cached:           100 kB',
    ].join('\n'));
    expect(m?.availableKb).toBe(600);
    expect(m?.swapTotalKb).toBe(0);
    expect(m?.swapUsedKb).toBe(0);
  });

  // REVIEW FOCUS 3: a box where Shmem outweighs the reclaimable pools. Cache
  // must clamp to zero AND the three segments must still sum to the total, or
  // the bar overflows its own track.
  it('clamps a negative cache to zero and keeps the three segments summing to the total', () => {
    const m = parseMeminfo([
      'MemTotal:        1000 kB', 'MemFree:          400 kB', 'Buffers:            0 kB',
      'Cached:           100 kB', 'SReclaimable:       0 kB', 'Shmem:            900 kB',
    ].join('\n'));
    expect(m?.cacheKb).toBe(0);
    expect(m?.usedKb).toBe(600);
    expect((m?.usedKb ?? 0) + (m?.cacheKb ?? 0) + 400).toBe(1000);
  });

  it('answers null when a field the split needs is missing', () => {
    expect(parseMeminfo('MemFree: 400 kB\nBuffers: 1 kB\nCached: 1 kB')).toBeNull();
    expect(parseMeminfo('MemTotal: 0 kB\nMemFree: 0 kB\nBuffers: 0 kB\nCached: 0 kB')).toBeNull();
    expect(parseMeminfo('')).toBeNull();
  });
});

describe('cpuBetween', () => {
  const a = { ...parseProcStat(STAT_A)!, at: 1000 };
  const b = { ...parseProcStat(STAT_B)!, at: 6000 };

  it('measures the window, per CPU, by id', () => {
    const r = cpuBetween(a, b);
    expect(r?.total).toBe(50);
    expect(r?.windowMs).toBe(5000);
    expect(r?.perCpu).toEqual([{ id: 0, pct: 100 }, { id: 1, pct: 0 }]);
  });

  it('drops a CPU that appears in only one sample rather than reading its whole counter as one window', () => {
    const grown = { ...parseProcStat([STAT_B, 'cpu2 900 0 100 10 0'].join('\n'))!, at: 6000 };
    expect(cpuBetween(a, grown)?.perCpu.map((c) => c.id)).toEqual([0, 1]);
  });

  // REVIEW FOCUS 2: a reboot or a counter wrap between two samples.
  it('answers null when the pair says nothing — a still counter is not a zero, and a rewound one is not a reading', () => {
    expect(cpuBetween(a, { ...a, at: 6000 })).toBeNull();   // counters did not move
    expect(cpuBetween(b, { ...a, at: 6000 })).toBeNull();   // went backwards
    expect(cpuBetween(a, { ...b, at: 1000 })).toBeNull();   // no window
  });
});

describe('hottestCpus', () => {
  it('is hottest-first and breaks ties by id, so two equal threads do not swap places between polls', () => {
    const load = [{ id: 0, pct: 40 }, { id: 3, pct: 91 }, { id: 7, pct: 91 }, { id: 5, pct: 78 }];
    expect(hottestCpus(load, 2)).toEqual([{ id: 3, pct: 91 }, { id: 7, pct: 91 }]);
  });

  // REVIEW FOCUS 4: a 128-thread box. The reduction must look at the whole list.
  it('finds the two hottest in a 128-thread list wherever they sit', () => {
    const many = Array.from({ length: 128 }, (_, id) => ({ id, pct: id === 97 ? 99 : id === 12 ? 96 : 3 }));
    expect(hottestCpus(many, 2)).toEqual([{ id: 97, pct: 99 }, { id: 12, pct: 96 }]);
  });
});

describe('hostStatFailed', () => {
  it('fails both halves with one reason, from one writer', () => {
    const stat = hostStatFailed('offline', 42);
    expect(stat).toEqual({ at: 42, cpu: { ok: false, why: 'offline' }, mem: { ok: false, why: 'offline' } });
  });
});
