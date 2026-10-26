// The RSS preload reads the process's OWN peak (CP-38 Task 1; D-6964, D-6965). fixtures/history/preload-rss.mjs is a
// TEST-ONLY --import fixture that prints `history-test-maxrss-kib=<n>` on stderr at exit. `process.resourceUsage().maxRSS`
// is wrong on Linux for a spawned child: the figure is inherited from the spawning parent's resident size across
// fork+exec, so a sweep spawned by a fat test runner reports the runner's size. VmHWM in /proc/self/status is the
// process's own peak. rss-peak.mjs is the pure reader (an injected status reader and fallback), so the fallback is tested
// without an environment seam (spec §10.1).
//
// ISOLATION: the spawn guard runs `node --import <preload> -e 0` with an argv array, never through a shell, and touches no
// HOME, no registry and no fixture path. It holds one 400 MiB allocation for the length of the case.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PRELOAD = join(HERE, 'fixtures', 'history', 'preload-rss.mjs');
const HAS_PROC = existsSync('/proc/self/status');
const MIB_KIB = 1024;

const load = async (): Promise<{ ownPeakKiB: (readStatus: () => string, fallbackKiB: () => number) => { kib: number; source: 'vmhwm' | 'maxrss' } }> =>
  (await import('./fixtures/history/rss-peak.mjs')) as never;

const STATUS = ['Name:\tnode', 'VmPeak:\t  1234567 kB', 'VmSize:\t  1200000 kB', 'VmHWM:\t   45678 kB', 'VmRSS:\t   40000 kB', 'Threads:\t11', ''].join('\n');

describe('the RSS preload prints the process\'s own peak, never the spawning parent\'s (D-6964)', () => {
  it.skipIf(!HAS_PROC)('GUARD (needs /proc/self/status, skipped where it is absent): a child spawned by a parent holding 400 MiB reports far below it, from VmHWM', () => {
    const ballast = Buffer.alloc(400 * 1024 * 1024, 1);
    // CONTROL: the parent really holds the allocation at spawn, or the guard measures nothing.
    expect(process.memoryUsage().rss, 'the parent does not hold the ballast').toBeGreaterThan(380 * MIB_KIB * 1024);
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(PRELOAD).href, '-e', '0'], { encoding: 'utf8' });
    const m = /^history-test-maxrss-kib=(\d+)$/m.exec(r.stderr);
    expect(m, `no key line in stderr: ${r.stderr}`).not.toBeNull();
    const kib = Number(m![1]);
    console.log(`rss-preload guard: child=${kib} KiB, parent rss=${Math.round(process.memoryUsage().rss / 1024)} KiB`);
    expect(kib).toBeLessThan(200 * MIB_KIB);
    expect(/^history-test-rss-source=(\w+)$/m.exec(r.stderr)?.[1]).toBe('vmhwm');
    expect(ballast.length).toBe(400 * 1024 * 1024);
  }, 60_000);

  it('a real-looking status text answers vmhwm with its number', async () => {
    const { ownPeakKiB } = await load();
    expect(ownPeakKiB(() => STATUS, () => 7)).toEqual({ kib: 45678, source: 'vmhwm' });
  });

  it('a reader that throws answers the maxrss fallback', async () => {
    const { ownPeakKiB } = await load();
    expect(ownPeakKiB(() => { throw new Error('ENOENT: /home/u/proc/status'); }, () => 321)).toEqual({ kib: 321, source: 'maxrss' });
  });

  it('text with no VmHWM line answers maxrss', async () => {
    const { ownPeakKiB } = await load();
    expect(ownPeakKiB(() => 'Name:\tnode\nVmRSS:\t 100 kB\n', () => 55)).toEqual({ kib: 55, source: 'maxrss' });
  });

  it('a VmHWM line that is not a number answers maxrss', async () => {
    const { ownPeakKiB } = await load();
    expect(ownPeakKiB(() => 'VmHWM:  abc kB\n', () => 55)).toEqual({ kib: 55, source: 'maxrss' });
  });

  it('a VmHWM of zero answers maxrss, never vmhwm 0', async () => {
    const { ownPeakKiB } = await load();
    expect(ownPeakKiB(() => 'VmHWM: 0 kB\n', () => 55)).toEqual({ kib: 55, source: 'maxrss' });
  });

  it('the fallback is an integer of at least 1: 12.7 gives 12, 0 gives 1, NaN gives 1', async () => {
    const { ownPeakKiB } = await load();
    const boom = (): string => { throw new Error('no status'); };
    expect(ownPeakKiB(boom, () => 12.7)).toEqual({ kib: 12, source: 'maxrss' });
    expect(ownPeakKiB(boom, () => 0)).toEqual({ kib: 1, source: 'maxrss' });
    expect(ownPeakKiB(boom, () => Number.NaN)).toEqual({ kib: 1, source: 'maxrss' });
  });
});
