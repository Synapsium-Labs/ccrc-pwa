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
//
// Every owner is a child this file spawned, and only those pids are ever signalled. Socket bases live under a
// short `/tmp/ccrc-rt-XXXXXX` — a `mkTmp` path is too long for `sun_path` on macOS (104 bytes), the same reason
// `delegation-rig.test.ts` uses a short `/tmp` base — and each is removed after its test.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEAD_SUFFIX, RUN_OWNER, RUN_PREFIX, RUN_QUIET_S, RUN_SOCKET, RUN_TMP, condemn, openRun, probeRun, reapRuns,
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
