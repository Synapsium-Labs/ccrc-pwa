// The run parent's Windows arm (run-tmp.globalsetup.mjs): a named pipe in place of the unix socket, uid 0 in place
// of `getuid`, and TEMP/TMP beside TMPDIR. Without them every run on Windows was refused and its fixtures went loose
// in %TEMP%, thousands of `ccrc-*` directories nobody removed. run-tmp.test.ts is POSIX by construction (signals,
// process groups, uids); this file is what holds the Windows arm.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRun, orphanHarnessPids, probeRun, reapOrphanHarness, reapRuns, RUN_DIR_ENV, RUN_SOCKET, runSocket } from './run-tmp.globalsetup.mjs';
import { mkTmp } from './tmpHelpers.js';

const win = process.platform === 'win32';

describe('run-tmp on Windows', () => {
  it('the liveness endpoint is a named pipe named after the run on win32, the socket file elsewhere', () => {
    const dir = path.join('base', 'ccrc-testrun-Ab12Cd');
    expect(runSocket(dir, 'win32')).toBe('\\\\.\\pipe\\ccrc-testrun-Ab12Cd');
    expect(runSocket(dir, 'linux')).toBe(path.join(dir, RUN_SOCKET));
  });

  it.skipIf(!win)('a run opens, answers live, reads dead once its pipe closes, and is reaped', async () => {
    const base = mkTmp('ccrc-runwin-');
    const opened = await openRun(base);
    if ('refused' in opened) throw new Error(`refused: ${opened.refused}`);
    expect(await probeRun(opened.run)).toBe('live');
    await new Promise<void>((r) => { opened.server.close(() => r()); });
    expect(await probeRun(opened.run)).toBe('dead');
    const r = await reapRuns(base, { now: Date.now() + 1000, quietS: 0 });
    expect(r.removed.map(([n]) => n)).toEqual([path.basename(opened.run)]);
    expect(existsSync(opened.run)).toBe(false);
  });

  it.skipIf(!win)('a worker\'s os.tmpdir() is inside the run directory: TEMP is redirected, not only TMPDIR', () => {
    const run = process.env[RUN_DIR_ENV];
    expect(run, 'the run parent was refused').toBeTruthy();
    expect(path.resolve(os.tmpdir()).startsWith(path.resolve(run!))).toBe(true);
  });

  it.skipIf(!win)('a bare tmux reaches no live server: TMUX_TMPDIR is inside the run directory too', () => {
    const run = process.env[RUN_DIR_ENV];
    expect(run, 'the run parent was refused').toBeTruthy();
    expect(path.resolve(process.env.TMUX_TMPDIR ?? '').startsWith(path.resolve(run!))).toBe(true);
  });
});

describe('a killed run\'s orphaned ccd harness shells (Windows ends a process without its children)', () => {
  const harness = 'C:\\msys64\\usr\\bin\\bash.exe -c "ccd_h_src=$CCD_HARNESS_SRC ccd_h_snippet=$CCD_HARNESS_SNIPPET; source x"';
  it('picks a harness shell whose parent is gone, and none whose parent lives or that is not a harness shell', () => {
    const rows = [
      { pid: 10, ppid: 1, name: 'node.exe', cmd: 'node vitest' },
      { pid: 11, ppid: 10, name: 'bash.exe', cmd: harness },          // a live run's shell
      { pid: 12, ppid: 999, name: 'bash.exe', cmd: harness },         // its run was killed: orphaned
      { pid: 13, ppid: 998, name: 'bash.exe', cmd: 'bash -c "ccd supervise x"' },   // an orphan, but not a harness shell
      { pid: 14, ppid: 997, name: 'cmd.exe', cmd: 'cmd /c CCD_HARNESS_SRC' },       // not bash
    ];
    expect(orphanHarnessPids(rows)).toEqual([12]);
  });

  it('stops nothing and asks nothing off Windows', () => {
    expect(reapOrphanHarness('linux')).toBe(0);
  });

  it.skipIf(!win)('the listing runs and answers a count on Windows (no harness orphans here: 0)', () => {
    expect(reapOrphanHarness()).toBe(0);
  }, 60_000);
});
