// The server suite's per-run temp parent (#316): one `ccrc-testrun-XXXXXX` directory per vitest run, every
// fixture inside it, removed at teardown, on a signal, or by the next run under the same TMPDIR.
//
// WHY THIS FILE EXISTS. Before it, only hooks inside the WORKER processes removed fixtures, and nothing that
// outlives a killed worker owned them. Measured on a Mac: `timeout 25 vitest run test/ccrc-doctor.test.ts` under
// a scratch TMPDIR left 11 entries and 15 MB behind (rc 124), and #316 counted 1,551 directories and 5.74 GiB
// from five timed-out shards in one morning. A killed run is the ordinary case on a box that runs this suite
// under `timeout`, Ctrl-C, a tmux hangup and the OOM killer.
//
// WHAT IS PINNED HERE, by group:
//   - `probeRun`: the six verdicts a later run reads off a run directory, never folded into one another. Each is
//     produced by a REAL owner (a bare `node` child that called `openRun`), killed or stopped as the case says.
//   - `condemn`: rename first, then remove; a second actor gets `gone`; a failure is reported, never thrown.
//
// Every owner is a child this file spawned, and only those pids are ever signalled. Socket bases live under a
// short `/tmp/ccrc-rt-XXXXXX` — a `mkTmp` path is too long for `sun_path` on macOS (104 bytes), the same reason
// `delegation-rig.test.ts` uses a short `/tmp` base — and each is removed after its test.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEAD_SUFFIX, RUN_OWNER, RUN_SOCKET, RUN_TMP, condemn, openRun, probeRun,
} from './run-tmp.globalsetup.mjs';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOD_URL = pathToFileURL(path.join(here, 'run-tmp.globalsetup.mjs')).href;
const isRoot = process.getuid?.() === 0;

/** Every pid this file started. `afterEach` SIGKILLs them; nothing else is ever signalled. */
const spawned: number[] = [];
const bases: string[] = [];

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* already gone */ }
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  for (const b of bases.splice(0)) rmSync(b, { recursive: true, force: true });
});

/** A short socket base, real-pathed (macOS's `/tmp` is a link to `/private/tmp`), removed after the test. */
function socketBase(): string {
  const b = realpathSync(mkdtempSync('/tmp/ccrc-rt-'));
  bases.push(b);
  return b;
}

type Exit = { code: number | null; signal: NodeJS.Signals | null };

/** The first line a child prints, as JSON — or a rejection naming its exit when it dies first. */
function firstJsonLine<T>(out: Readable, exit: Promise<Exit>): Promise<T> {
  return new Promise((resolve, reject) => {
    let buf = '';
    out.setEncoding('utf8');
    out.on('data', (d: string) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl >= 0) resolve(JSON.parse(buf.slice(0, nl)) as T);
    });
    void exit.then((e) => reject(new Error(`the child exited before it printed a line: ${JSON.stringify(e)}`)));
  });
}

/** A child that idles; its own clock ends it if every kill below were somehow missed. */
const IDLE_SRC = 'setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 120000);';

interface Owner { pid: number; run: string; childPid?: number; exit: Promise<Exit> }

/** A real run owner: a bare `node` child that calls `openRun(base)` and idles. With `forkChild` it also starts
 *  a child of its own over an `ipc` slot, the way vitest forks its workers, to show the listening socket is not
 *  inherited. */
async function startOwner(base: string, opts: { forkChild?: boolean } = {}): Promise<Owner> {
  const src = [
    "import { spawn } from 'node:child_process';",
    `import { openRun } from ${JSON.stringify(MOD_URL)};`,
    'const o = await openRun(process.argv[1]);',
    opts.forkChild
      ? `const childPid = spawn(process.execPath, ['-e', ${JSON.stringify(IDLE_SRC)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }).pid;`
      : 'const childPid = undefined;',
    'console.log(JSON.stringify({ run: o.run, refused: o.refused, childPid }));',
    IDLE_SRC,
  ].join('\n');
  const c = spawn(process.execPath, ['--input-type=module', '-e', src, base], { stdio: ['ignore', 'pipe', 'inherit'] });
  spawned.push(c.pid!);
  const exit = new Promise<Exit>((r) => c.once('exit', (code, signal) => r({ code, signal })));
  const line = await firstJsonLine<{ run?: string; refused?: string; childPid?: number }>(c.stdout!, exit);
  if (line.childPid) spawned.push(line.childPid);
  expect(line.refused, 'the owner\'s openRun refused').toBeUndefined();
  return { pid: c.pid!, run: line.run!, childPid: line.childPid, exit };
}

async function killOwner(o: Owner): Promise<void> {
  process.kill(o.pid, 'SIGKILL');
  await o.exit;
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe('probeRun — six verdicts, never folded', () => {
  it('T2a: a live owner answers live', async () => {
    const o = await startOwner(socketBase());
    expect(await probeRun(o.run)).toBe('live');
  });

  it('T2b: a SIGSTOPped owner still answers live — the kernel accepts, the process need not run', async () => {
    const o = await startOwner(socketBase());
    process.kill(o.pid, 'SIGSTOP');
    try {
      expect(await probeRun(o.run)).toBe('live');
    } finally {
      process.kill(o.pid, 'SIGCONT');
    }
  });

  it('T2c: a SIGKILLed owner is dead', async () => {
    const o = await startOwner(socketBase());
    await killOwner(o);
    expect(await probeRun(o.run)).toBe('dead');
  });

  it('T2d: dead while a child it forked over ipc is still alive — workers do not inherit the listening fd', async () => {
    const o = await startOwner(socketBase(), { forkChild: true });
    expect(o.childPid, 'the owner printed no child pid').toBeTruthy();
    await killOwner(o);
    expect(alive(o.childPid!), 'the forked child died with its parent, so this case proves nothing').toBe(true);
    expect(await probeRun(o.run)).toBe('dead');
  });

  it('T2e: a connecting socket is authoritative — live even with owner.json gone', async () => {
    const o = await startOwner(socketBase());
    unlinkSync(path.join(o.run, RUN_OWNER));
    expect(await probeRun(o.run)).toBe('live');
  });

  it('T2f: a refusing socket and no owner.json is unowned, not dead', async () => {
    const o = await startOwner(socketBase());
    await killOwner(o);
    unlinkSync(path.join(o.run, RUN_OWNER));
    expect(await probeRun(o.run)).toBe('unowned');
  });

  it('T2g: owner.json present and no socket is unmeasurable, not unowned', async () => {
    const o = await startOwner(socketBase());
    await killOwner(o);
    unlinkSync(path.join(o.run, RUN_SOCKET));
    expect(await probeRun(o.run)).toBe('unmeasurable:ENOENT');
  });

  it('T2h: a regular file where the socket was is exactly not-a-socket, on every platform', async () => {
    // Without the lstat check, macOS says ENOTSOCK and Linux says ECONNREFUSED — which would read as `dead`
    // and be condemned. The exact string is asserted so the case is red on both.
    const o = await startOwner(socketBase());
    await killOwner(o);
    unlinkSync(path.join(o.run, RUN_SOCKET));
    writeFileSync(path.join(o.run, RUN_SOCKET), 'not a socket\n');
    expect(await probeRun(o.run)).toBe('unmeasurable:not-a-socket');
  });

  it('T2i: a spelling too long for sun_path is unmeasurable:EINVAL, never dead; the short spelling still is', async () => {
    const base = socketBase();
    const o = await startOwner(base);
    await killOwner(o);
    const longLink = path.join(base, 'x'.repeat(90));
    symlinkSync(base, longLink);
    const longRun = path.join(longLink, path.basename(o.run));
    expect(Buffer.byteLength(path.join(longRun, RUN_SOCKET))).toBeGreaterThan(108);
    expect(await probeRun(longRun)).toBe('unmeasurable:EINVAL');
    expect(await probeRun(o.run)).toBe('dead');
  });

  it('T2j: openRun under a base too long for sun_path refuses with EINVAL and leaves nothing behind', async () => {
    const longBase = path.join(socketBase(), 'x'.repeat(90));
    mkdirSync(longBase);
    const r = await openRun(longBase);
    expect(r).toEqual({ refused: 'EINVAL' });
    expect(readdirSync(longBase), 'the refused run left its directory').toEqual([]);
  });
});

describe('condemn', () => {
  it('C1: renames, then removes a directory with content', () => {
    const dir = path.join(mkTmp('ccrc-runtmp-condemn-'), 'run');
    mkdirSync(path.join(dir, RUN_TMP), { recursive: true });
    writeFileSync(path.join(dir, RUN_TMP, 'f'), 'x');
    expect(condemn(dir)).toBe('removed');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(dir + DEAD_SUFFIX)).toBe(false);
  });

  it('C2: a second condemn of the same directory is gone, not an error — two reapers race on the rename', () => {
    const dir = path.join(mkTmp('ccrc-runtmp-condemn-'), 'run');
    mkdirSync(dir);
    expect(condemn(dir)).toBe('removed');
    expect(condemn(dir)).toBe('gone');
  });

  it.skipIf(isRoot)('C3: a removal that fails is reported as left:<code>, after the rename — never thrown', () => {
    const dir = path.join(mkTmp('ccrc-runtmp-condemn-'), 'run');
    const locked = path.join(dir, 'locked');
    mkdirSync(locked, { recursive: true });
    writeFileSync(path.join(locked, 'f'), 'x');
    chmodSync(locked, 0o500);
    try {
      // The code is the platform's: EACCES from Linux's unlink, ENOTEMPTY from Node 26's rm on macOS (measured).
      expect(condemn(dir)).toMatch(/^left:E[A-Z]+$/);
      expect(existsSync(dir), 'the rename did not come first').toBe(false);
      expect(existsSync(dir + DEAD_SUFFIX)).toBe(true);
    } finally {
      if (existsSync(dir + DEAD_SUFFIX)) chmodSync(path.join(dir + DEAD_SUFFIX, 'locked'), 0o700);
      if (existsSync(locked)) chmodSync(locked, 0o700);
    }
    // A `.dead` name is removed as it stands: any later actor finishes the job without probing.
    expect(condemn(dir + DEAD_SUFFIX)).toBe('removed');
    expect(existsSync(dir + DEAD_SUFFIX)).toBe(false);
  });
});
