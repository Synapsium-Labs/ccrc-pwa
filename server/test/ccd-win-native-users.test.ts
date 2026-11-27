// The Windows port: who uses a path, when the user is a NATIVE Win32 process MSYS's /proc cannot see into.
// Claude Code itself, and the node, git and test runners it starts, are native; a tree one of them sits in must answer
// `held`, never `nobody`, or the temp sweep, ws-reclaim, ws-expire and ws-collect remove it from under them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { shq } from './ccrc-doctorFixture.js';

const posix = (p: string): string => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);

describe.skipIf(process.platform !== 'win32')('ccd path-users / _ws_cwd_users see a native process (Windows)', () => {
  const root = mkTmp('ccrc-native-users-');
  const held = path.join(root, 'held');
  const free = path.join(root, 'free');
  let holder: ChildProcess | undefined;
  // ccd runs in the contained harness (a fixture HOME, the poisoned tools), never with the parent's env; its `sh`
  // bounds each call, as the timed spawn here did.
  let harness: CcdHarness;

  beforeAll(async () => {
    harness = makeCcdHarness('ccrc-native-users-h-');
    mkdirSync(path.join(held, 'sub'), { recursive: true });
    mkdirSync(free, { recursive: true });
    // A native GRANDCHILD: cmd starts ping inside the tree, then moves itself out. /proc never lists ping.
    // Verbatim: node's own quoting of an argument is not cmd's, and `cd /d "<dir>"` must reach cmd as written.
    holder = spawn('cmd.exe', ['/d', '/s', '/c', `"cd /d "${path.join(held, 'sub')}" && start /b ping -n 120 127.0.0.1 >nul && cd /d "${path.dirname(root)}" && ping -n 120 127.0.0.1 >nul"`],
      { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
    await new Promise((r) => setTimeout(r, 3000));
  });
  afterAll(() => {
    try { execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='PING.EXE'" | Where-Object { $_.CommandLine -match '-n 120 127.0.0.1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]); } catch { /* gone */ }
    holder?.kill();
    harness?.cleanup();
  });

  it('a tree a native grandchild works in is held; a free one is nobody', () => {
    const out = harness.sh(`cmd_path_users --json ${shq(posix(held))} ${shq(posix(free))}`);
    const [h, f] = out.trim().split('\n').map((l) => JSON.parse(l) as { verdict: string; why: string });
    expect(h!.verdict, h!.why).toBe('held');
    expect(h!.why).toMatch(/Windows process \d+ \(PING\) has its working directory at /);
    expect(f!.verdict).toBe('nobody');
  }, 150_000);

  it('the working-directory probe agrees', () => {
    const run = (d: string): string => harness.sh(`_ws_cwd_users ${shq(posix(d))}; echo "rc=$?"`).split('\n').pop()!;
    expect(run(held)).toBe('rc=1');
    expect(run(free)).toBe('rc=0');
  }, 300_000);
});
