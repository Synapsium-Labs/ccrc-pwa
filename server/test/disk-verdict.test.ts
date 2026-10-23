// D-6613 (plan docs/superpowers/plans/2026-10-23-fleet-disk-retention.md, Task DR-1; spec 2026-10-23 §2.5): the disk
// alarm's vocabulary (L0 `shared/disk.ts`) and its pure decider (L1 `server/src/disk.ts`). The thresholds sit at their
// edges, because an off-by-one at 85.0 or 92.0 is the whole bug a threshold can have.
import { describe, expect, it } from 'vitest';
import {
  DISK_CLEAR_MARGIN_PCT, DISK_CRITICAL_PCT, DISK_PRESSURE_AGES, DISK_WARN_PCT, DISK_WORK_ROOTS, readDiskHealth,
  type DiskFilesystem,
} from '../../shared/disk.js';
import { diskLevelOf, diskVerdict, type DiskMeasured, type DiskVerdict } from '../src/disk.js';

const SIZE = 1000;
/** A filesystem `usedPct` full by bytes (tenths of a point resolve: 849 of 1000 is 84.9) and `inodePct` by inodes. */
const fsAt = (usedPct: number, inodePct = 0, dev = '8:1'): DiskFilesystem => ({
  dev, mount: '/data', fsType: 'ext4', roots: ['home'],
  sizeBytes: SIZE, availBytes: Math.round(SIZE - (usedPct * SIZE) / 100),
  files: SIZE, filesFree: Math.round(SIZE - (inodePct * SIZE) / 100), readOnly: false,
});
const measured = (fss: DiskFilesystem[], mounts: { path: string; mounted: boolean }[] = []): DiskMeasured =>
  ({ filesystems: fss, expectedMounts: mounts });
const T0 = 1_000_000;

describe('diskLevelOf: the larger of bytes-used and inodes-used', () => {
  it('84.9% is ok, 85.0% warn, 92.0% critical', () => {
    expect(diskLevelOf(fsAt(84.9))).toBe('ok');
    expect(diskLevelOf(fsAt(85))).toBe('warn');
    expect(diskLevelOf(fsAt(91.9))).toBe('warn');
    expect(diskLevelOf(fsAt(92))).toBe('critical');
  });
  it('inodes at 93% with bytes at 40% is critical', () => {
    expect(diskLevelOf(fsAt(40, 93))).toBe('critical');
  });
  it('the constants are the spec numbers', () => {
    expect([DISK_WARN_PCT, DISK_CRITICAL_PCT, DISK_CLEAR_MARGIN_PCT]).toEqual([85, 92, 2]);
  });
});

describe('diskVerdict: hysteresis, debounce, mounts', () => {
  /** Feed measurements in turn, each verdict the next one's `prev`. */
  const run = (steps: DiskMeasured[], prev: DiskVerdict | null = null): DiskVerdict[] => {
    const out: DiskVerdict[] = [];
    steps.forEach((m, i) => { prev = diskVerdict(prev, m, T0 + i * 60_000); out.push(prev); });
    return out;
  };
  const held = (level: 'ok' | 'warn' | 'critical') => run([measured([fsAt(level === 'ok' ? 10 : level === 'warn' ? 88 : 95)])])[0]!;

  it('critical at 91% stays critical, at 89.9% falls to warn (two measurements each)', () => {
    const [a, b] = run([measured([fsAt(91)]), measured([fsAt(91)])], held('critical'));
    expect([a!.level, b!.level]).toEqual(['critical', 'critical']);
    const [c, d] = run([measured([fsAt(89.9)]), measured([fsAt(89.9)])], held('critical'));
    expect([c!.level, d!.level]).toEqual(['critical', 'warn']);
  });
  it('warn at 84% stays warn, at 82.9% falls to ok', () => {
    expect(run([measured([fsAt(84)]), measured([fsAt(84)])], held('warn')).map((v) => v.level)).toEqual(['warn', 'warn']);
    expect(run([measured([fsAt(82.9)]), measured([fsAt(82.9)])], held('warn')).map((v) => v.level)).toEqual(['warn', 'ok']);
  });
  it('one measurement at critical after ok does not change the level; two do', () => {
    const [a, b] = run([measured([fsAt(95)]), measured([fsAt(95)])], held('ok'));
    expect(a!.level).toBe('ok');
    expect(b!.level).toBe('critical');
  });
  it('a bad read between two good ones never changes the level', () => {
    expect(run([measured([fsAt(95)]), measured([fsAt(10)]), measured([fsAt(95)])], held('ok')).map((v) => v.level))
      .toEqual(['ok', 'ok', 'ok']);
  });
  it('the first measurement of a filesystem is taken as it stands', () => {
    expect(run([measured([fsAt(95)])])[0]!.level).toBe('critical');
  });
  it('the fleet level is the worst filesystem, each held on its own', () => {
    const v = run([measured([fsAt(10, 0, '8:1'), fsAt(95, 0, '8:2')])])[0]!;
    expect(v.level).toBe('critical');
    expect(v.filesystems.map((f) => f.level)).toEqual(['ok', 'critical']);
  });
  it('a missing expected mount is critical, at once, with every filesystem fine', () => {
    const v = run([measured([fsAt(10)], [{ path: '/data', mounted: false }])], held('ok'))[0]!;
    expect(v.level).toBe('critical');
    expect(v.expectedMounts).toEqual([{ path: '/data', mounted: false }]);
  });
  it('a missing expected mount is critical even when no filesystem was measured', () => {
    expect(run([measured([], [{ path: '/data', mounted: false }])])[0]!.level).toBe('critical');
  });
  it('no filesystems is unmeasured, never ok', () => {
    expect(run([measured([])])[0]!.level).toBe('unmeasured');
    expect(run([measured([], [{ path: '/data', mounted: true }])])[0]!.level).toBe('unmeasured');
    expect(run([measured([])], held('ok'))[0]!.level).toBe('unmeasured');
  });
  it('a filesystem that reports no size and no inodes is unmeasured, never ok', () => {
    const none: DiskFilesystem = { ...fsAt(10), sizeBytes: 0, availBytes: 0, files: 0, filesFree: 0 };
    expect(diskLevelOf(none)).toBe('unmeasured');
    expect(run([measured([none])])[0]!.level).toBe('unmeasured');
  });
  it('a verdict is stamped with the clock it was given', () => {
    expect(run([measured([fsAt(10)])])[0]!.at).toBe(T0);
  });
});

describe('readDiskHealth: the one reader', () => {
  const good = (): Record<string, unknown> => ({
    at: 5, level: 'warn', pressure: false,
    filesystems: [{ ...fsAt(88), level: 'warn' }],
    expectedMounts: [{ path: '/data', mounted: true }],
    holders: [{ label: 'sessions', bytes: 12 }],
  });
  it('reads a whole block', () => {
    const r = readDiskHealth({ disk: good() });
    expect(r?.level).toBe('warn');
    expect(r?.filesystems[0]?.mount).toBe('/data');
    expect(r?.holders).toEqual([{ label: 'sessions', bytes: 12 }]);
  });
  it('answers null for absent, a string, a block missing level, and a filesystem with a negative size', () => {
    expect(readDiskHealth({})).toBeNull();
    expect(readDiskHealth(undefined)).toBeNull();
    expect(readDiskHealth('disk')).toBeNull();
    expect(readDiskHealth({ disk: 'x' })).toBeNull();
    const { level: _l, ...noLevel } = good();
    expect(readDiskHealth({ disk: noLevel })).toBeNull();
    expect(readDiskHealth({ disk: { ...good(), level: 'fine' } })).toBeNull();
    const neg = good();
    neg['filesystems'] = [{ ...fsAt(88), level: 'warn', sizeBytes: -1 }];
    expect(readDiskHealth({ disk: neg })).toBeNull();
  });
  it('an older block without holders reads with none', () => {
    const g = good();
    delete g['holders'];
    expect(readDiskHealth({ disk: g })?.holders).toEqual([]);
  });
});

describe('the tables', () => {
  it('every DISK_PRESSURE_AGES row has pressureS <= normalS, and the loose floor never drops below a day', () => {
    for (const r of DISK_PRESSURE_AGES) expect(r.pressureS, r.sweep).toBeLessThanOrEqual(r.normalS);
    const loose = DISK_PRESSURE_AGES.find((r) => r.sweep === 'ws-collect-loose-floor');
    expect(loose?.pressureS).toBeGreaterThanOrEqual(86400);
  });
  it('the floors the spec calls never-lowered are not lowered', () => {
    for (const s of ['tmp-sweep-budget-untouched-floor', 'ws-collect-witnessed-floor']) {
      const r = DISK_PRESSURE_AGES.find((x) => x.sweep === s);
      expect(r?.pressureS, s).toBe(r?.normalS);
    }
  });
  it('the work roots carry the eight labels, each with a template', () => {
    expect(DISK_WORK_ROOTS.map((r) => r.label)).toEqual(
      ['home', 'projects', 'worktrees', 'cc-tmp', 'claude-tmp', 'config-dirs', 'ccrc', 'registry']);
    for (const r of DISK_WORK_ROOTS) expect(r.templates.length, r.label).toBeGreaterThan(0);
  });
});
