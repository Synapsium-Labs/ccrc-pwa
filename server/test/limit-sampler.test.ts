// The limit sampler (Overlord W1 serviceability PR B, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-serviceability.md`
// Task 6): one row per measured Anthropic account a beat, at the lane's cadence, over the tick's own reading.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { LIMIT_SAMPLE_MS, LIMIT_SAMPLES_KEEP_S } from '../../shared/loadLines.js';
import { parseRoster } from '../../shared/roster.js';
import { laneRow } from '../src/laneSchedule.js';
import { limitSamplePass, limitSampleRows, type LimitSampleStore } from '../src/limitSampler.js';
import type { AccountLimits } from '../src/limits.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { nameWrites } from './scan/parse.js';
import { parsedFile } from './scan/symbols.js';
import { seedRoster, testDeps } from './helpers.js';
import { fakeTime } from './fakeTime.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 2_000_000_000;
const roster = parseRoster({ version: 1, accounts: [
  { id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
  { id: 'lane-b', label: 'lane-b', configDirSuffix: '.lane-b', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
  { id: 'lane-c', label: 'lane-c', configDirSuffix: '.lane-c', exec: { kind: 'generated' }, homeAble: false, hue: 'blue', telemetry: 'codex' },
  { id: 'lane-d', label: 'lane-d', configDirSuffix: '.lane-d', exec: { kind: 'generated' }, homeAble: true, hue: 'green', telemetry: 'anthropic' },
] });
const lim = (five: number | null, seven: number | null, ts: number | null, over: Partial<AccountLimits> = {}): AccountLimits => ({
  five, seven, ts, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: false, ...over,
});

const fakeStore = (): LimitSampleStore & { inserts: unknown[][]; prunes: number[] } => {
  const s = {
    inserts: [] as unknown[][], prunes: [] as number[],
    insertLimitSamples: (rows: readonly unknown[]) => { s.inserts.push([...rows]); return rows.length; },
    pruneLimitSamples: (b: number) => { s.prunes.push(b); return 0; },
  };
  return s;
};

describe('limitSamplePass (F14)', () => {
  it('writes one row per measured Anthropic account and prunes past the bound', () => {
    const store = fakeStore();
    const limits = { 'lane-a': lim(40, 20, NOW - 30), 'lane-b': lim(10, 5, NOW - 90, { fiveWindowMinutes: 0, fiveRolledOver: true }) };
    expect(limitSamplePass(store, limits, roster, NOW)).toEqual({ inserted: 2, pruned: 0 });
    expect(store.inserts[0]).toEqual([
      { account: 'lane-a', ts: NOW - 30, five: 40, seven: 20, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000, fiveRolled: false, sevenRolled: false, fiveWindowMinutes: null },
      { account: 'lane-b', ts: NOW - 90, five: 10, seven: 5, fiveResetAt: NOW + 9_000, sevenResetAt: NOW + 300_000, fiveRolled: true, sevenRolled: false, fiveWindowMinutes: 0 },
    ]);
    expect(store.prunes).toEqual([NOW - LIMIT_SAMPLES_KEEP_S]);
  });
  it('a codex lane\'s file and an exclusion row write nothing; a reading with no time writes nothing', () => {
    const limits = {
      'lane-c': lim(30, 30, NOW - 60),
      'lane-x': { five: 100, seven: 0, ts: NOW - 60, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false },
      'lane-d': lim(null, null, null),
    };
    expect(limitSampleRows(limits, roster)).toEqual([]);
  });
});

describe('the lane (index question 8)', () => {
  it('its row: every LIMIT_SAMPLE_MS on the monotonic clock, one pass at a time, caught with its own sentence', () => {
    expect(laneRow('limitSamples')).toEqual({ name: 'limitSamples', cadenceMs: LIMIT_SAMPLE_MS, derivedFrom: null, clock: 'mono', flight: 'skip',
      warnKey: 'ccrc-server: the limit sampler failed' });
  });

  const watcher = (deps: Record<string, unknown>, mono: { ms: number }): FleetWatcher =>
    quietAtTestEnd(new FleetWatcher({ ...testDeps(mkTmp('ccrc-limit-sampler-w-')), ...deps, monotonicMs: () => mono.ms,
      time: fakeTime({ wallMs: NOW * 1000 }).ports } as never, new Bus(), 2000));

  it('runs the pass at the lane\'s cadence and not between; with no store it does nothing', async () => {
    const store = fakeStore();
    const mono = { ms: 1_000_000 };
    const w = watcher({ limitSamples: store }, mono);
    const limits = { claude: lim(40, 20, NOW - 30) };
    await w.sweepLimitSamples(limits);
    mono.ms += LIMIT_SAMPLE_MS - 1;
    await w.sweepLimitSamples(limits);
    expect(store.inserts).toHaveLength(1);
    mono.ms += 1;
    await w.sweepLimitSamples(limits);
    expect(store.inserts).toHaveLength(2);
    await watcher({}, mono).sweepLimitSamples(limits);
  });

  it('a throwing store warns once with the row\'s sentence, and the next beat tries again', async () => {
    const mono = { ms: 1_000_000 };
    const store: LimitSampleStore = { insertLimitSamples: () => { throw new Error('disk gone'); }, pruneLimitSamples: () => 0 };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const w = watcher({ limitSamples: store }, mono);
      await w.sweepLimitSamples({ claude: lim(40, 20, NOW - 30) });
      expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('ccrc-server: the limit sampler failed'))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('tick() hands the pass its own reading after a listed tick', async () => {
    const home = mkTmp('ccrc-limit-sampler-tick-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const w = quietAtTestEnd(new FleetWatcher({ ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg,
      limitSamples: fakeStore() } as never, new Bus(), 10_000));
    const spy = vi.spyOn(w, 'sweepLimitSamples').mockResolvedValue(undefined);
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual(w.currentLimits()!.limits);
  });

  it('the composition root hands the lane the coord store (read through the parser: ARCH-06)', () => {
    const writes = nameWrites(parsedFile('server/src/index.ts')).filter((x) => x.name === 'deps' && x.member === 'limitSamples');
    expect(writes.map((x) => x.value)).toEqual(['coord']);
  });
});
