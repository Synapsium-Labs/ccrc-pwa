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
//   - `reapRuns`: what the NEXT run removes — only a run-named, real, own directory whose owner is dead (or
//     absent) and that has been quiet for the window, through any spelling of the base, never throwing.
//   - `armSignals`: the main process's own collector on SIGTERM, SIGINT, SIGHUP and `exit` — persistent, so a
//     second SIGTERM mid-removal cannot kill it, always exiting 128+n, and gone again once disarmed.
//   - The wiring (T1): THIS run is inside its own run directory, whose owner answers.
//   - End to end (T5): a real nested vitest under the `globalSetup` DERIVED from `vitest.config.ts`, killed every
//     way a run is killed, and refused under a TMPDIR too long for a socket.
//
// Every owner is a child this file spawned, and only those pids are ever signalled. Socket bases live under a
// short `/tmp/ccrc-rt-XXXXXX` — a `mkTmp` path is too long for `sun_path` on macOS (104 bytes), the same reason
// `delegation-rig.test.ts` uses a short `/tmp` base — and each is removed after its test.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmdirSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEAD_SUFFIX, RUN_DIR_ENV, RUN_OWNER, RUN_PREFIX, RUN_QUIET_ENV, RUN_QUIET_S, RUN_REFUSED_ENV, RUN_SOCKET,
  RUN_SUN_PATH_MAX, RUN_TMP, condemn, openRun, probeRun, reapRuns,
} from './run-tmp.globalsetup.mjs';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOD_URL = pathToFileURL(path.join(here, 'run-tmp.globalsetup.mjs')).href;
const isRoot = process.getuid?.() === 0;

/** Every pid this file started. `afterEach` SIGKILLs them; nothing else is ever signalled. */
const spawned: number[] = [];
/** Every process GROUP this file started — only ever a child spawned `detached: true`, so its pid is its group. */
const groups: number[] = [];
const bases: string[] = [];

/** Signal a group this file made, and its leader. Refuses anything that could be pid 0, 1 or a typo. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`killGroup refuses pid ${pid}`);
  try { process.kill(-pid, signal); } catch { /* already gone */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
}

afterEach(() => {
  for (const pid of groups.splice(0)) killGroup(pid, 'SIGKILL');
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

  it('T2k: the envelope — a socket path of exactly RUN_SUN_PATH_MAX bytes opens and answers; one byte more refuses', async () => {
    // Past `sun_path` Node 24+ fails EINVAL, but Node 22 silently TRUNCATES and binds at the shorter name
    // (measured on Linux, 22.23.3), so the module checks the length itself. This pins that check to the
    // platform's own limit: not one byte stricter, not one byte laxer.
    const root = socketBase();
    const sockBytes = (base: string): number => Buffer.byteLength(path.join(base, `${RUN_PREFIX}XXXXXX`, RUN_SOCKET));
    const padded = (n: number): string => { const b = path.join(root, 'p'.repeat(n)); mkdirSync(b); return b; };
    const exact = padded(RUN_SUN_PATH_MAX - sockBytes(root) - 1);
    expect(sockBytes(exact)).toBe(RUN_SUN_PATH_MAX);
    const r = await openRun(exact);
    expect(r, 'a socket path of exactly the limit was refused').not.toHaveProperty('refused');
    const { run, server } = r as { run: string; server: { close: () => void } };
    try {
      expect(await probeRun(run)).toBe('live');
    } finally {
      server.close();
      condemn(run);
    }
    const over = padded(RUN_SUN_PATH_MAX - sockBytes(root));
    expect(sockBytes(over)).toBe(RUN_SUN_PATH_MAX + 1);
    expect(await openRun(over)).toEqual({ refused: 'EINVAL' });
    expect(readdirSync(over)).toEqual([]);
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

describe('reapRuns — only dead, quiet, ours, by name', () => {
  /** A `now` past the default window, so every dead run made just now is quiet. */
  const later = (): number => Date.now() + (RUN_QUIET_S + 1) * 1000;
  /** A run directory nobody listens on: `mkdtemp` with the run's prefix, plus its `tmp/`. */
  const unowned = (base: string): string => {
    const d = mkdtempSync(path.join(base, RUN_PREFIX));
    mkdirSync(path.join(d, RUN_TMP));
    return d;
  };
  const deadOwner = async (base: string): Promise<string> => {
    const o = await startOwner(base);
    await killOwner(o);
    return o.run;
  };
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const name = (d: string): string => path.basename(d);
  const ctimeOf = (p: string): number => lstatSync(p).ctimeMs;

  it('T3a: a live run is left, as live', async () => {
    const base = socketBase();
    const o = await startOwner(base);
    const r = await reapRuns(base, { now: later() });
    expect(r.left).toContainEqual([name(o.run), 'live']);
    expect(r.removed).toEqual([]);
    expect(existsSync(o.run)).toBe(true);
  });

  it('T3b: a dead, quiet run is removed — the directory and any .dead twin', async () => {
    const base = socketBase();
    const run = await deadOwner(base);
    const r = await reapRuns(base, { now: later() });
    expect(r.removed).toEqual([[name(run), 'dead:removed']]);
    expect(existsSync(run) || existsSync(run + DEAD_SUFFIX)).toBe(false);
  });

  it('T3c: a dead run that is not yet quiet is left — orphan workers outlive their main process', async () => {
    const base = socketBase();
    const run = await deadOwner(base);
    const r = await reapRuns(base, { now: Date.now() });
    expect(r.left).toEqual([[name(run), 'dead:not-quiet']]);
    expect(existsSync(run)).toBe(true);
  });

  it('T3d: an unowned run is removed once quiet, and a fresh one — a run still being made — is left', async () => {
    const base = socketBase();
    const old = unowned(base);
    await sleep(1100);
    const fresh = unowned(base);
    const r = await reapRuns(base, { now: ctimeOf(path.join(fresh, RUN_TMP)) + 500, quietS: 1 });
    expect(r.removed).toEqual([[name(old), 'unowned:removed']]);
    expect(r.left).toEqual([[name(fresh), 'unowned:not-quiet']]);
    expect(existsSync(fresh)).toBe(true);
  });

  it('T3e: a .dead directory is an interrupted removal and is finished without probing', () => {
    // It carries an owner.json and no socket, which a probe would call `unmeasurable:ENOENT` and leave forever.
    const base = socketBase();
    const dead = path.join(base, `${RUN_PREFIX}abcdef${DEAD_SUFFIX}`);
    mkdirSync(path.join(dead, RUN_TMP), { recursive: true });
    writeFileSync(path.join(dead, RUN_OWNER), '{}\n');
    writeFileSync(path.join(dead, RUN_TMP, 'f'), 'x');
    return reapRuns(base, { now: later() }).then((r) => {
      expect(r.removed).toEqual([[name(dead), 'dead-suffix:removed']]);
      expect(existsSync(dead)).toBe(false);
    });
  });

  it('T3f: a symlink named like a run is left, and so is everything it points at', async () => {
    const base = socketBase();
    const victim = mkTmp('ccrc-runtmp-victim-');
    writeFileSync(path.join(victim, 'keep'), 'not the reaper\'s\n');
    const link = path.join(base, `${RUN_PREFIX}abcdef`);
    symlinkSync(victim, link);
    const r = await reapRuns(base, { now: later() });
    expect(r.left).toEqual([[name(link), 'not-a-directory']]);
    expect(lstatSync(link).isSymbolicLink(), 'the link itself was moved').toBe(true);
    expect(existsSync(path.join(victim, 'keep')), 'the reaper followed the link').toBe(true);
  });

  it('T3g: a directory another uid owns is left, whatever its verdict would be', async () => {
    const base = socketBase();
    const run = await deadOwner(base);
    const loose = unowned(base);
    const dead = path.join(base, `${RUN_PREFIX}abcdef${DEAD_SUFFIX}`);
    mkdirSync(dead);
    const r = await reapRuns(base, { now: later(), uid: process.getuid!() + 1 });
    expect(r.removed).toEqual([]);
    expect(r.left).toEqual([run, loose, dead].map((d) => [name(d), 'foreign-uid']).sort());
    for (const d of [run, loose, dead]) expect(existsSync(d), d).toBe(true);
  });

  it('T3h: a name that only STARTS like a run is not the reaper\'s — `mkTmp(\'ccrc-testrun-signals-\')` shapes', async () => {
    const base = socketBase();
    const near = path.join(base, `${RUN_PREFIX}signals-abcdef`);
    mkdirSync(near);
    const r = await reapRuns(base, { now: later() });
    expect(r).toEqual({ removed: [], left: [] });
    expect(existsSync(near)).toBe(true);
  });

  it('T3i: quiet is measured on tmp/ as well as the run dir — a worker still writing keeps its run', async () => {
    const base = socketBase();
    const run = await deadOwner(base);
    await sleep(1100);
    mkdirSync(path.join(run, RUN_TMP, 'x'));
    const tmpCtime = ctimeOf(path.join(run, RUN_TMP));
    expect(tmpCtime - ctimeOf(run), 'the run dir itself must be quiet for this case to mean anything').toBeGreaterThan(1000);
    const r = await reapRuns(base, { now: tmpCtime + 500, quietS: 1 });
    expect(r.left).toEqual([[name(run), 'dead:not-quiet']]);
    expect(existsSync(run)).toBe(true);
  });

  it.skipIf(isRoot)('T3j: a removal that fails is left:<errno>, and the walk goes on to the next entry', async () => {
    const base = socketBase();
    const stuck = path.join(base, `${RUN_PREFIX}lockdd${DEAD_SUFFIX}`);
    const locked = path.join(stuck, 'locked');
    mkdirSync(locked, { recursive: true });
    writeFileSync(path.join(locked, 'f'), 'x');
    chmodSync(locked, 0o500);
    try {
      const run = await deadOwner(base);
      const r = await reapRuns(base, { now: later() });
      expect(r.left).toEqual([[name(stuck), expect.stringMatching(/^left:E[A-Z]+$/)]]);
      expect(r.removed).toEqual([[name(run), 'dead:removed']]);
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  describe('T3k: through another spelling of the base, a dead run is removed and a live one left', () => {
    // The fleet reaches one directory by more than one path (a bind mount, a volume mounted whole). A reaper
    // that insisted the path it was given be the CANONICAL one would skip every run it reached another way.
    const reapThrough = async (spell: (base: string) => string): Promise<void> => {
      const base = socketBase();
      const live = await startOwner(base);
      const dead = await deadOwner(base);
      const r = await reapRuns(spell(base), { now: later() });
      expect(r.removed).toEqual([[name(dead), 'dead:removed']]);
      expect(r.left).toEqual([[name(live.run), 'live']]);
      expect(existsSync(dead)).toBe(false);
      expect(existsSync(live.run)).toBe(true);
    };

    it('a symlink to the base', async () => {
      const alias = path.join(socketBase(), 'b');
      await reapThrough((base) => { symlinkSync(base, alias); return alias; });
    });

    const DATA = '/System/Volumes/Data';
    it.skipIf(process.platform !== 'darwin' || !existsSync(path.join(DATA, 'private', 'tmp')))(
      'macOS: the /System/Volumes/Data firmlink (same dev and ino; realpath does not unify the two)', async () => {
        await reapThrough((base) => path.join(DATA, base));
      });

    const canUnshare = process.platform === 'linux' && spawnSync('unshare', ['-Urm', 'true']).status === 0;
    it.skipIf(!canUnshare)('Linux: a bind mount (unshare -Urm, mount --bind) — skipped where user namespaces are refused', async () => {
      const base = socketBase();
      const alt = socketBase();
      const live = await startOwner(base);
      const dead = await deadOwner(base);
      // Inside the namespace this uid is root and so is every file it owns, which is the reaper's own default.
      const src = [
        `import { reapRuns } from ${JSON.stringify(MOD_URL)};`,
        'console.log(JSON.stringify(await reapRuns(process.argv[1], { now: Number(process.argv[2]) })));',
      ].join('\n');
      const r = spawnSync('unshare', ['-Urm', 'sh', '-c',
        'mount --bind "$0" "$1" && exec "$2" --input-type=module -e "$3" "$1" "$4"',
        base, alt, process.execPath, src, String(later())], { encoding: 'utf8', timeout: 30_000 });
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout) as { removed: string[][]; left: string[][] };
      expect(out.removed).toEqual([[name(dead), 'dead:removed']]);
      expect(out.left).toEqual([[name(live.run), 'live']]);
      expect(existsSync(dead)).toBe(false);
      expect(existsSync(live.run)).toBe(true);
    });
  });

  it.skipIf(isRoot)('T3l: an entry that throws is recorded as error:<code>, each one, and the call still resolves', async () => {
    // `condemn` and `probeRun` never throw, so the throw an entry can raise is its own lstat: a base that can be
    // listed but not searched (0400) raises it for every entry. Two, so a single outer `try` is red too.
    const base = socketBase();
    const a = unowned(base);
    const b = unowned(base);
    chmodSync(base, 0o400);
    try {
      const r = await reapRuns(base, { now: later() });
      expect(r.removed).toEqual([]);
      expect(r.left).toEqual([a, b].map((d) => [name(d), 'error:EACCES']).sort());
    } finally {
      chmodSync(base, 0o700);
    }
  });
});

describe('armSignals — a persistent arm that collects the run and always exits', () => {
  // The harness child disarms BEFORE it prints the run, never after: a SIGTERM that arrives between the print
  // and the disarm is caught by libuv and then dropped once the last listener goes, and the child hangs
  // (measured). Every child also has a 15 s kill-after watchdog, so a mutant that never exits reads as SIGKILL.
  type Variant = 'wait' | 'throw' | 'disarm' | 'noarm';
  interface Armed { pid: number; run: string; exit: Promise<Exit> }

  async function armed(base: string, variant: Variant, plant = 0): Promise<Armed> {
    const src = [
      "import { writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      `import * as m from ${JSON.stringify(MOD_URL)};`,
      'const o = await m.openRun(process.argv[1]);',
      `for (let i = 0; i < ${plant}; i++) writeFileSync(path.join(o.run, ${JSON.stringify(RUN_TMP)}, 'f' + i), 'x');`,
      variant === 'noarm' ? '' : 'const disarm = m.armSignals(o.run);',
      variant === 'disarm' ? 'disarm();' : '',
      'console.log(JSON.stringify({ run: o.run }));',
      variant === 'throw' ? "setTimeout(() => { throw new Error('a crash of the main process'); }, 50);" : '',
      IDLE_SRC,
    ].join('\n');
    const c = spawn(process.execPath, ['--input-type=module', '-e', src, base], { stdio: ['ignore', 'pipe', 'pipe'] });
    spawned.push(c.pid!);
    let stderr = '';
    c.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    const watchdog = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 15_000);
    const exit = new Promise<Exit>((r) => c.once('exit', (code, signal) => { clearTimeout(watchdog); r({ code, signal }); }));
    const line = await firstJsonLine<{ run: string }>(c.stdout!, exit)
      .catch((e: Error) => { throw new Error(`${e.message}\n--- child stderr ---\n${stderr}`); });
    return { pid: c.pid!, run: line.run, exit };
  }

  const clean = (run: string): boolean => !existsSync(run) && !existsSync(run + DEAD_SUFFIX);

  it('T4a: SIGTERM collects the run and exits 143', async () => {
    const a = await armed(socketBase(), 'wait');
    process.kill(a.pid, 'SIGTERM');
    expect(await a.exit).toEqual({ code: 143, signal: null });
    expect(clean(a.run)).toBe(true);
  });

  it('T4b: SIGINT collects the run and exits 130', async () => {
    const a = await armed(socketBase(), 'wait');
    process.kill(a.pid, 'SIGINT');
    expect(await a.exit).toEqual({ code: 130, signal: null });
    expect(clean(a.run)).toBe(true);
  });

  it('T4c: SIGHUP — vitest installs no handler for it — collects the run and exits 129', async () => {
    const a = await armed(socketBase(), 'wait');
    process.kill(a.pid, 'SIGHUP');
    expect(await a.exit).toEqual({ code: 129, signal: null });
    expect(clean(a.run)).toBe(true);
  });

  it('T4d: a second SIGTERM while the removal is under way (GNU timeout\'s shape) does not kill it mid-rm', async () => {
    // Two SIGTERMs sent back to back merge into one pending signal, so a `once` arm passes that shape. The
    // second one is sent only once the rename has happened and the `rm` of 4,000 files is running.
    const a = await armed(socketBase(), 'wait', 4000);
    process.kill(a.pid, 'SIGTERM');
    const t0 = Date.now();
    while (!(existsSync(a.run + DEAD_SUFFIX) && !existsSync(a.run)) && Date.now() - t0 < 5000) {
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(existsSync(a.run + DEAD_SUFFIX), 'the removal was over before the second signal; plant more files').toBe(true);
    process.kill(a.pid, 'SIGTERM');
    expect(await a.exit).toEqual({ code: 143, signal: null });
    expect(clean(a.run)).toBe(true);
  });

  it('T4e: a crash of the main process collects the run through the exit listener', async () => {
    const a = await armed(socketBase(), 'throw');
    expect(await a.exit).toEqual({ code: 1, signal: null });
    expect(clean(a.run)).toBe(true);
  });

  it('T4f: once disarmed, a SIGTERM takes its default action and leaves the run alone', async () => {
    const a = await armed(socketBase(), 'disarm');
    process.kill(a.pid, 'SIGTERM');
    expect(await a.exit).toEqual({ code: null, signal: 'SIGTERM' });
    expect(existsSync(a.run)).toBe(true);
  });

  it('T4g: the positive control — a run that was never armed is left by a SIGTERM', async () => {
    // Without it, T4a's "clean" would also be the reading if the harness removed the run some other way.
    const a = await armed(socketBase(), 'noarm');
    process.kill(a.pid, 'SIGTERM');
    expect(await a.exit).toEqual({ code: null, signal: 'SIGTERM' });
    expect(existsSync(a.run)).toBe(true);
  });
});

describe('this run is wired (T1)', () => {
  it('runs inside its own run directory, and that directory\'s owner answers', async () => {
    const refused = process.env[RUN_REFUSED_ENV];
    expect(refused, `the per-run temp dir was refused (${refused}); EINVAL means this TMPDIR is too long for a unix `
      + 'socket (sun_path) — see the header of test/run-tmp.globalsetup.mjs').toBeUndefined();
    const run = process.env[RUN_DIR_ENV];
    expect(run, 'no run directory: test/run-tmp.globalsetup.mjs is not wired as globalSetup in vitest.config.ts')
      .toBeTruthy();
    expect(realpathSync(tmpdir())).toBe(path.join(run!, RUN_TMP));
    expect(mkTmp('ccrc-runtmp-wire-').startsWith(path.join(run!, RUN_TMP) + path.sep)).toBe(true);
    expect(await probeRun(run!)).toBe('live');
  });
});

describe('end to end: a nested real vitest under the real globalSetup (T5)', () => {
  // `agent/test/contain-path.test.ts`'s idiom: the child runs whatever `vitest.config.ts` ACTUALLY names, read
  // from its text, so unwiring the entry reds every case here instead of quietly narrowing what they cover.
  const serverRoot = path.resolve(here, '..');
  const VITEST = path.resolve(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

  const globalSetupEntries = (): string[] => {
    const cfg = readFileSync(path.join(serverRoot, 'vitest.config.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const m = /globalSetup:\s*\[([^\]]*)\]/.exec(cfg);
    expect(m, 'globalSetup is not wired in vitest.config.ts').toBeTruthy();
    const files = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => path.resolve(serverRoot, x[1]!));
    expect(files.length, 'globalSetup names no files').toBeGreaterThan(0);
    return files;
  };

  /** The fixture test: makes a fixture the raw way (`mkdtemp` under `tmpdir()`), records what the run handed
   *  its worker, then does what `FX_MODE` says. */
  const FX_TEST = [
    "import { appendFileSync, lstatSync, mkdtempSync, readdirSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import path from 'node:path';",
    'const env = process.env;',
    "it('records its run, then does what FX_MODE says', async () => {",
    "  mkdtempSync(path.join(tmpdir(), 'ccrc-fx-'));",
    '  appendFileSync(env.FX_RECORD, JSON.stringify({ pid: process.pid, tmpdir: tmpdir(),',
    `    runDir: env[${JSON.stringify(RUN_DIR_ENV)}], refused: env[${JSON.stringify(RUN_REFUSED_ENV)}],`,
    '    baseListing: readdirSync(env.FX_BASE) }) + "\\n");',
    '  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));',
    "  if (env.FX_MODE === 'sleep') await sleep(30000);",
    `  if (env.FX_MODE === 'untilquiet') await sleep(lstatSync(path.join(env.FX_DEAD, ${JSON.stringify(RUN_TMP)})).ctimeMs`,
    '    + Number(env.FX_Q) * 1000 + 500 - Date.now());',
    "  if (env.FX_MODE === 'die') process.kill(process.pid, 'SIGKILL');",
    '});',
    '',
  ].join('\n');

  interface Record { pid: number; tmpdir: string; runDir?: string; refused?: string; baseListing: string[] }
  interface Nested { pid: number; fx: string; exit: Promise<Exit>; output: () => string }

  /** A PLAIN-OBJECT config (it lives outside the package, so it may import nothing) naming the real
   *  `globalSetup` by absolute path, one fixture test, and a record file. */
  function fixture(): string {
    const fx = mkTmp('ccrc-runtmp-e2e-');
    const config = { test: { globals: true, include: ['*.fx.test.mjs'], testTimeout: 60_000, globalSetup: globalSetupEntries() } };
    writeFileSync(path.join(fx, 'vitest.config.mjs'), `export default ${JSON.stringify(config)};\n`);
    writeFileSync(path.join(fx, 'run.fx.test.mjs'), FX_TEST);
    return fx;
  }

  /** A nested `vitest run` under `base` as its TMPDIR, in a process group of its own. THIS process runs under the
   *  outer run, so the run's env names are deleted unless a case sets them — inherited, they would point the
   *  child's reading at the outer run. */
  function nested(base: string, mode: string, extra: { [k: string]: string } = {}): Nested {
    const fx = fixture();
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of [RUN_DIR_ENV, RUN_REFUSED_ENV, RUN_QUIET_ENV]) delete env[k];
    Object.assign(env, { TMPDIR: base, CI: '1', FX_BASE: base, FX_RECORD: path.join(fx, 'record.jsonl'), FX_MODE: mode }, extra);
    const c = spawn(process.execPath, [VITEST, 'run', '--root', fx], { cwd: fx, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    groups.push(c.pid!);
    let out = '';
    c.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; });
    c.stderr!.setEncoding('utf8').on('data', (d: string) => { out += d; });
    const watchdog = setTimeout(() => killGroup(c.pid!, 'SIGKILL'), 90_000);
    const exit = new Promise<Exit>((r) => c.once('exit', (code, signal) => { clearTimeout(watchdog); r({ code, signal }); }));
    return { pid: c.pid!, fx, exit, output: () => out };
  }

  const records = (n: Nested): Record[] => {
    const f = path.join(n.fx, 'record.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record) : [];
  };

  /** The fixture's first record — the moment its worker is inside the run — or a failure naming the output. */
  async function firstRecord(n: Nested): Promise<Record> {
    let done = false;
    void n.exit.then(() => { done = true; });
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const r = records(n);
      if (r.length > 0) return r[0]!;
      if (done) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error(`the nested run wrote no record\n--- nested output ---\n${n.output()}`);
  }

  const runsIn = (base: string): string[] => readdirSync(base).filter((f) => f.startsWith(RUN_PREFIX));

  /** A run killed the one way no arm can answer: SIGKILL to main, then its orphan workers. */
  async function killedRun(base: string): Promise<string> {
    const n = nested(base, 'sleep');
    const rec = await firstRecord(n);
    process.kill(n.pid, 'SIGKILL');
    await n.exit;
    killGroup(n.pid, 'SIGKILL');
    expect(rec.runDir, 'the killed run recorded no run directory').toBeTruthy();
    return rec.runDir!;
  }

  it('T5a: GNU timeout\'s double SIGTERM — main, then its group — exits 143 and leaves nothing', async () => {
    const base = socketBase();
    const n = nested(base, 'sleep');
    const rec = await firstRecord(n);
    process.kill(n.pid, 'SIGTERM');      // GNU timeout signals its child first...
    process.kill(-n.pid, 'SIGTERM');     // ...then its process group: main's second SIGTERM, after vitest's `once`
    expect(await n.exit, n.output()).toEqual({ code: 143, signal: null });
    expect(rec.tmpdir).toMatch(new RegExp(`^${base}/${RUN_PREFIX}[A-Za-z0-9]{6}/${RUN_TMP}$`));
    expect(runsIn(base)).toEqual([]);
  }, 120_000);

  it('T5b: a worker that dies outright — teardown still collects the fixture it left', async () => {
    const base = socketBase();
    const n = nested(base, 'die');
    const e = await n.exit;
    expect(e.code, n.output()).not.toBe(0);
    expect(e.code).not.toBeNull();
    expect(records(n)[0]?.runDir, 'the fixture never ran inside a run directory').toBeTruthy();
    expect(runsIn(base)).toEqual([]);
  }, 120_000);

  it('T5c: a run SIGKILLed outright is dead, left by the next run while fresh, and removed once quiet', async () => {
    const base = socketBase();
    const run = await killedRun(base);
    expect(existsSync(run)).toBe(true);
    expect(await probeRun(run)).toBe('dead');
    // The quiet gate's positive control: a run under the default window leaves it.
    const fresh = nested(base, 'pass');
    expect((await fresh.exit).code, fresh.output()).toBe(0);
    expect(records(fresh)[0]?.baseListing).toContain(path.basename(run));
    expect(existsSync(run), 'a dead run younger than the quiet window was reaped').toBe(true);
    // And a run whose window is zero collects it — at SETUP: its worker never sees it.
    const reaping = nested(base, 'pass', { [RUN_QUIET_ENV]: '0' });
    expect((await reaping.exit).code, reaping.output()).toBe(0);
    expect(records(reaping)[0]?.baseListing, 'setup did not reap the quiet dead run').not.toContain(path.basename(run));
    expect(runsIn(base)).toEqual([]);
  }, 120_000);

  it('T5d: SIGHUP to the group — a closed terminal or tmux pane — exits 129 and leaves nothing', async () => {
    const base = socketBase();
    const n = nested(base, 'sleep');
    await firstRecord(n);
    process.kill(-n.pid, 'SIGHUP');
    expect(await n.exit, n.output()).toEqual({ code: 129, signal: null });
    expect(runsIn(base)).toEqual([]);
  }, 120_000);

  it('T5e: a dead run that is not quiet at setup is reaped at TEARDOWN once it is', async () => {
    // Margin-based, not timing-based: the only requirement is a nested startup under the 8 s window.
    const base = socketBase();
    const dead = await killedRun(base);
    mkdirSync(path.join(dead, RUN_TMP, 'poke'));
    rmdirSync(path.join(dead, RUN_TMP, 'poke'));
    const n = nested(base, 'untilquiet', { [RUN_QUIET_ENV]: '8', FX_Q: '8', FX_DEAD: dead });
    const rec = await firstRecord(n);
    expect(rec.baseListing, 'setup reaped a run that was not yet quiet').toContain(path.basename(dead));
    expect((await n.exit).code, n.output()).toBe(0);
    expect(existsSync(dead), 'teardown did not reap the run once it was quiet').toBe(false);
    expect(runsIn(base)).toEqual([]);
  }, 120_000);

  it('T5f: a TMPDIR too long for a socket refuses loudly and keeps today\'s behaviour', async () => {
    const longBase = path.join(socketBase(), 'x'.repeat(90));
    mkdirSync(longBase);
    const n = nested(longBase, 'pass', { [RUN_DIR_ENV]: '/inherited/never' });
    expect((await n.exit).code, n.output()).toBe(0);
    const rec = records(n)[0];
    expect(rec, n.output()).toBeTruthy();
    expect(rec!.tmpdir).toBe(longBase);
    expect(rec!.runDir, 'an inherited run directory survived the refusal').toBeUndefined();
    expect(rec!.refused).toBe('EINVAL');
    expect(n.output()).toContain('ccrc-test: per-run temp dir refused (EINVAL)');
    expect(runsIn(longBase)).toEqual([]);
  }, 120_000);
});
