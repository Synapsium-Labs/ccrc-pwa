// Doctor's `test-slice` check (D-TBD-test-containment): the slice `ccrc test` runs in, read live — its memory against
// its cap, its other limits — and the admission queue's depth, all from `ccrc test --status`, the queue's one reader.
// WARN, never FAIL; SKIP on macOS, which has no slice. Each row starts from `healthy()` and breaks one thing.
import { describe, expect } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { itLinux, platformContrast } from './platformFixtures.js';
import { installDoctorHooks, healthy, runDoctor, plantTestSlice } from './ccrc-doctorFixture.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const verdict = (home: string): { line: string; remedy: string } => {
  const lines = runDoctor(home).stdout.split('\n');
  const i = lines.findIndex((l) => / test-slice: /.test(l));
  expect(i, 'a test-slice line').toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, remedy: lines[i + 1] ?? '' };
};

describe('test-slice: the test slice, live, and the queue (D-TBD-test-containment)', () => {
  platformContrast('a healthy box', {
    darwin: ['SKIP on macOS: launchd has no slice', () => {
      const home = healthy('ccrc-doctor-tslice-darwin-');
      expect(verdict(home).line).toBe('SKIP test-slice: the test slice is a systemd mechanism, and this box runs launchd');
    }],
    linux: ['PASS: the slice is loaded under its cap; the line names live memory, cap, limits and queue depth', () => {
      const home = healthy('ccrc-doctor-tslice-pass-');
      expect(verdict(home).line).toBe('PASS test-slice: ccrctests.slice holds 1.0G of its 6.0G memory cap, swap cap 1.0G, CPU weight 20, CPU quota 4s per second, IO weight 20; heavy slots 0 of 2 held, 0 waiting');
    }],
  });

  itLinux('PASS reads the configured slot count', () => {
    const home = healthy('ccrc-doctor-tslice-slots-');
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_TEST_HEAVY_SLOTS=3\n', { flag: 'a' });
    expect(verdict(home).line).toMatch(/; heavy slots 0 of 3 held, 0 waiting$/);
  });

  itLinux('WARN: the slice unit file is missing, so every run is refused', () => {
    const home = healthy('ccrc-doctor-tslice-nofile-');
    rmSync(join(home, '.config', 'systemd', 'user', 'ccrctests.slice'));
    const v = verdict(home);
    expect(v.line).toBe('WARN test-slice: ~/.config/systemd/user/ccrctests.slice is missing, so ccrc test refuses every run');
    expect(v.remedy).toBe('  remedy: ccrc update (or ccrc install) places it; then systemctl --user daemon-reload');
  });

  itLinux('WARN: the slice is placed but not loaded', () => {
    const home = healthy('ccrc-doctor-tslice-notloaded-');
    plantTestSlice(home, 'LoadState=not-found\n');
    const v = verdict(home);
    expect(v.line).toMatch(/^WARN test-slice: ccrctests\.slice is not loaded \(LoadState=not-found\), so ccrc test refuses every run; heavy slots 0 of 2 held, 0 waiting$/);
    expect(v.remedy).toMatch(/^ {2}remedy: systemctl --user daemon-reload, then re-run/);
  });

  itLinux('WARN: the live slice holds no memory cap', () => {
    const home = healthy('ccrc-doctor-tslice-nocap-');
    plantTestSlice(home, 'LoadState=loaded\nMemoryCurrent=0\nMemoryMax=infinity\n');
    expect(verdict(home).line).toMatch(/^WARN test-slice: ccrctests\.slice holds 0B with no memory cap \(MemoryMax=infinity\)/);
  });
});
