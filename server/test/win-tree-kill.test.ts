// The Windows port, A10: a negative pid is no process group on Windows, so `process.kill(-pid)` throws ESRCH whatever
// the child's state. The bounded spawners read ESRCH as "the group is already gone" and skipped the child, so a hung
// child (and everything it started) outlived its bound. `shared/spawn.mjs#winKillTree` ends the tree with
// `taskkill /T /F`; `server/src/localcaps.ts` calls it too. Each row records a GRANDCHILD's real Windows pid and
// proves it is dead after the answer, so "the answer came" alone never passes for "the tree is gone".
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { startable, winKillTree } from '../../shared/startable.mjs';
import { boundedSpawn, boundedStdinSpawn } from '../../shared/spawn.mjs';
import { readLocalCcdCaps } from '../src/localcaps.js';
import { mkTmp } from './tmpHelpers.js';

const pids: number[] = [];
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
afterEach(() => { for (const p of pids.splice(0)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } });

/** A sh script that starts a node grandchild recording its own Windows pid, then hangs. */
function hangingScript(dir: string): { file: string; pidFile: string } {
  const pidFile = path.join(dir, 'grandchild.pid').replace(/\\/g, '/');
  const node = process.execPath.replace(/\\/g, '/');
  const file = path.join(dir, 'hang.sh');
  writeFileSync(file,
    `#!/bin/sh\n"${node}" -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)" "${pidFile}" &\nsleep 600\n`);
  chmodSync(file, 0o755);
  return { file, pidFile };
}

async function grandchildPid(pidFile: string): Promise<number> {
  for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  pids.push(pid);
  return pid;
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 1500));
const host = { spawn, signals: os.constants.signals, startable, winKillTree } as never;

describe.skipIf(process.platform !== 'win32')('Windows tree kill at the bound (A10)', () => {
  it('boundedSpawn: at the bound the hung child\'s whole tree is gone, not left running', async () => {
    const { file, pidFile } = hangingScript(mkTmp('win-tree-kill-'));
    const r = await boundedSpawn(host, file, [], { env: { ...process.env }, timeoutMs: 3000, drainMs: 1000 });
    expect(r.killed).toBe(true);
    const pid = await grandchildPid(pidFile);
    await settle();
    expect(alive(pid), 'a grandchild outlived the bound').toBe(false);
  }, 20_000);

  it('boundedStdinSpawn: at the bound the hung child\'s whole tree is gone, not left running', async () => {
    const { file, pidFile } = hangingScript(mkTmp('win-tree-kill-'));
    const r = await boundedStdinSpawn(host, file, [], null, {
      env: { ...process.env }, timeoutMs: 3000, killGraceMs: 300, maxOutputBytes: 1024, drainMs: 500,
    });
    expect(r).toEqual({ kind: 'timeout' });
    const pid = await grandchildPid(pidFile);
    await settle();
    expect(alive(pid), 'a grandchild outlived the bound').toBe(false);
  }, 20_000);

  it('readLocalCcdCaps: a hung ccd\'s whole tree is gone after the bound', async () => {
    const { file, pidFile } = hangingScript(mkTmp('win-tree-kill-'));
    expect(await readLocalCcdCaps(file, 3000)).toBeNull();
    const pid = await grandchildPid(pidFile);
    await settle();
    expect(alive(pid), 'a grandchild outlived the bound').toBe(false);
  }, 20_000);
});
