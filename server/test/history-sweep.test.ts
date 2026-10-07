// server/test/history-sweep.test.ts — ccd/history/sweep.mjs and the bash shim
// ccd/ccd-history-sweep (spec 2026-10-05 §5.1, §5.3, §9.2, §9.3), run as the
// timer runs them: real children on this Node, in a fixture HOME, with the
// tmux/gh/ssh/curl/manager poisons first on PATH and the statfs preload
// answering for the box's real disk.
//
// Linux-only (O24): the sweep's timer never installs on the Darwin arm, and
// the shim needs util-linux `flock`.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  PRELOADS, REPO, counters, makeHistoryBox, openStoreRO, runShim, runSweep, skipOnDarwin, type HistoryBox,
} from './historyHelpers.js';
import { STATFS_DEADLINE_MS, historyPaths } from '../../ccd/history/lib.mjs';
import { createStore, getMeta, userVersion } from '../../ccd/history/store.mjs';
import { parseSweepArgv } from '../../ccd/history/sweep.mjs';

skipOnDarwin();

// A lock holder leads its own process group and is killed as a group (the
// tmp-sweep.test.ts precedent): `flock … sleep` forks, and killing only the
// parent would orphan the sleep holding the lock.
let procs: ChildProcess[] = [];
afterEach(() => {
  for (const p of procs) { try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ } }
  procs = [];
});
function pause(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function holdLock(box: HistoryBox): void {
  const lock = historyPaths(box.home).lock;
  const holder = spawn('flock', [lock, 'sleep', '60'], { stdio: 'ignore', detached: true });
  procs.push(holder);
  for (let i = 0; i < 200; i += 1) {
    if (spawnSync('flock', ['-n', lock, 'true']).status !== 0) return;
    pause(25);
  }
  throw new Error('the lock holder never took the lock');
}
const mtimeNs = (p: string): bigint => fs.statSync(p, { bigint: true }).mtimeNs;
const lines = (s: string): string[] => s.split('\n').filter(Boolean);
/** createStore in a child on this box, SIGKILLed by the fault preload at the named call (Task 12's
 *  HISTORY_TEST_KILL grammar). A child that hangs instead ends at the timeout with SIGTERM, which no
 *  assertion here reads as the planned kill. */
function createKilledAt(box: HistoryBox, kill: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [
    '--no-warnings', '--import', pathToFileURL(PRELOADS.faults).href, '--input-type=module', '-e',
    `import { createStore } from ${JSON.stringify(pathToFileURL(path.join(REPO, 'ccd', 'history', 'store.mjs')).href)}; createStore(process.argv[1]);`,
    box.home,
  ], { env: { ...box.env, HISTORY_TEST_KILL: kill }, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGTERM' });
}

describe('the sweep: skeleton, store open and refusals, and the shim', () => {
  it('a first scheduled pass on a fleet box creates and binds the store, silently; the next one opens it', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    const storeId = fs.readFileSync(P.storeId, 'utf8').trim();
    const db = openStoreRO(box);
    expect(getMeta(db, 'store_id')).toBe(storeId);
    expect(getMeta(db, 'writer')).toBe(fs.readFileSync(P.writer, 'utf8').trim());
    expect(userVersion(db)).toBe(1);
    db.close();
    // The hook's gate opens with the first bound tick, never before (§5.1, S4).
    expect(fs.statSync(P.spool).mode & 0o777).toBe(0o700);
    const again = runSweep(box);
    expect(again.code, again.stderr).toBe(0);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
  });

  it('the shim takes the lock, sources the roster and runs the same pass', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const r = runShim(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    expect(fs.existsSync(historyPaths(box.home).dbFile)).toBe(true);
    expect(fs.existsSync(historyPaths(box.home).lock)).toBe(true);
  });

  it('S6/O25: a scheduled pass that finds the lock held exits 0 with its one line and writes nothing; an --op pass exits 75', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    expect(runShim(box).code).toBe(0);
    const P = historyPaths(box.home);
    const before = { db: mtimeNs(P.dbFile), counters: counters(box), names: fs.readdirSync(P.dbDir).sort() };
    // The holder stands in for the first of two concurrent passes: the same
    // flock on the same file, held for as long as the case needs, so which
    // pass loses is decided by construction rather than by a race.
    holdLock(box);
    const scheduled = runShim(box);
    expect(scheduled.code, scheduled.stderr).toBe(0);
    expect(lines(scheduled.stdout)).toEqual(['history-sweep: another pass holds the lock']);
    const op = runShim(box, ['--op', 'prune']);
    expect(op.code).toBe(75);
    expect(op.stdout).toBe('');
    expect(mtimeNs(P.dbFile)).toBe(before.db);
    expect(counters(box)).toEqual(before.counters);
    expect(fs.readdirSync(P.dbDir).sort()).toEqual(before.names);
  });

  it('a broken box is loud: no flock, no node, or an unopenable lock exits 1 with its reason, never the healthy-overlap exit 0', () => {
    // A PATH holding only the named tools, as symlinks: `command -v` is a builtin, so the shim's two
    // presence checks need nothing else, bash itself is looked up on the child's PATH, and mkdir is
    // the one external the shim runs before the lock — without it a deleted check would still exit 1
    // for the wrong reason.
    const stub = (box: HistoryBox, name: string, tools: Record<string, string>): string => {
      const dir = path.join(box.home, name);
      fs.mkdirSync(dir, { recursive: true });
      for (const [link, target] of Object.entries(tools)) fs.symlinkSync(target, path.join(dir, link));
      return dir;
    };
    const which = (t: string): string => spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
    const bash = which('bash');
    const flock = which('flock');
    const mkdir = which('mkdir');
    expect(bash, 'no bash on this box').not.toBe('');
    expect(flock, 'no flock on this box').not.toBe('');

    const noFlock = makeHistoryBox('ccrc-history-sweep-');
    const a = runShim(noFlock, [], { env: { PATH: stub(noFlock, 'bin-noflock', { bash, mkdir, node: process.execPath }) } });
    expect(a.code, a.stderr).toBe(1);
    expect(a.stderr).toMatch(/flock is not on PATH/);
    expect(a.stdout).toBe('');
    expect(fs.existsSync(historyPaths(noFlock.home).dbDir)).toBe(false);

    const noNode = makeHistoryBox('ccrc-history-sweep-');
    const b = runShim(noNode, [], { env: { PATH: stub(noNode, 'bin-nonode', { bash, mkdir, flock }) } });
    expect(b.code, b.stderr).toBe(1);
    expect(b.stderr).toMatch(/node is not on PATH/);
    expect(b.stdout).toBe('');
    expect(fs.existsSync(historyPaths(noNode.home).dbDir)).toBe(false);

    // A directory at the lock path cannot be opened for writing, as root or not (EISDIR): a broken box
    // is exit 1 for a scheduled pass AND an --op pass, never 0 (a healthy overlap) or 75 (writer-busy).
    const badLock = makeHistoryBox('ccrc-history-sweep-');
    fs.mkdirSync(historyPaths(badLock.home).lock);
    for (const args of [[], ['--op', 'prune']]) {
      const c = runShim(badLock, args);
      expect(c.code, `${args.join(' ')}: ${c.stderr}`).toBe(1);
      expect(c.stderr).toMatch(/cannot open the lock/);
      expect(c.stdout).toBe('');
    }
    expect(fs.existsSync(historyPaths(badLock.home).dbDir)).toBe(false);

    // ~/.ccrc a file: the shim cannot make the directory its lock lives in, and says so.
    const noDir = makeHistoryBox('ccrc-history-sweep-');
    fs.rmSync(path.join(noDir.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(noDir.home, '.ccrc'), '');
    const d = runShim(noDir);
    expect(d.code, d.stderr).toBe(1);
    expect(d.stderr).toMatch(/cannot make \$HOME\/\.ccrc/);
    expect(d.stdout).toBe('');
  });

  it('O54 (shim half): no readable accounts.sh -> the shim passes --roster-unreadable, the pass counts it and exits 0', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    expect(runShim(box).code).toBe(0);
    expect(counters(box)['roster_unreadable']).toBeUndefined();
    fs.rmSync(historyPaths(box.home).accountsSh);
    const r = runShim(box);
    expect(r.code, r.stderr).toBe(0);
    expect(counters(box)['roster_unreadable']).toBe(1);
  });

  it('S7: a dangling db/ link is refused, and nothing is created through or beside it', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    fs.mkdirSync(P.root, { recursive: true, mode: 0o700 });
    const target = path.join(box.home, 'volume-unmounted');
    fs.symlinkSync(target, P.dbDir);
    const r = runSweep(box);
    expect(r.code).toBe(5);
    expect(lines(r.stdout)).toEqual(['history-sweep: store-root-dangling']);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(P.root)).toEqual(['db']);
  });

  it('S9: store.id present and the DB absent -> store-missing, and no DB is created', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    fs.mkdirSync(P.root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(P.storeId, '0189abcd-1234-4678-9abc-0123456789ab\n');
    const r = runSweep(box);
    expect(r.code).toBe(5);
    expect(lines(r.stdout)).toEqual(['history-sweep: store-missing']);
    expect(fs.existsSync(P.dbDir)).toBe(false);
  });

  it('S10: db/ an empty directory (an unmounted volume\'s mountpoint) with store.id present -> refused', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    fs.mkdirSync(P.dbDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(P.storeId, '0189abcd-1234-4678-9abc-0123456789ab\n');
    const r = runSweep(box);
    expect(r.code).toBe(5);
    expect(lines(r.stdout)).toEqual(['history-sweep: store-missing']);
    expect(fs.readdirSync(P.dbDir)).toEqual([]);
  });

  it('DM17 (store half): a store at user_version 2 -> schema-newer, exit 5, and no write', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    createStore(box.home);
    const P = historyPaths(box.home);
    const raw = new DatabaseSync(P.dbFile);
    raw.exec("PRAGMA user_version = 2; INSERT INTO counters (name, n) VALUES ('fixture', 1);");
    raw.close();
    const mtime = mtimeNs(P.dbFile);
    const r = runSweep(box, ['--roster-unreadable']);
    expect(r.code).toBe(5);
    expect(lines(r.stdout)).toEqual(['history-sweep: schema-newer']);
    expect(mtimeNs(P.dbFile)).toBe(mtime);
    expect(counters(box)).toEqual({ fixture: 1 });
  });

  it('O28: a statfs that never settles ends the pass at the deadline with store-unreachable, and no DB is opened', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    expect(runSweep(box).code).toBe(0);
    const P = historyPaths(box.home);
    const mtime = mtimeNs(P.dbFile);
    expect(fs.readdirSync(P.dbDir)).toEqual(['history.db']);
    const r = runSweep(box, ['--roster-unreadable'], { env: { HISTORY_TEST_STATFS: 'hang' } });
    expect(r.code, r.stderr).toBe(0);
    expect(lines(r.stdout)).toEqual(['history-sweep: store-unreachable']);
    expect(r.ms).toBeGreaterThanOrEqual(STATFS_DEADLINE_MS - 250);
    expect(r.ms).toBeLessThan(STATFS_DEADLINE_MS + 10_000);
    expect(mtimeNs(P.dbFile)).toBe(mtime);
    // Not even read: any open of a WAL store, a read-only one included, makes its -shm.
    expect(fs.readdirSync(P.dbDir)).toEqual(['history.db']);
    expect(counters(box)['roster_unreadable']).toBeUndefined();
  }, 30_000);

  it('a box recording CCRC_ROLE=server creates nothing at all: no db/, no DB, no store.id, no root', () => {
    const box = makeHistoryBox('ccrc-history-sweep-', { role: 'server' });
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(lines(r.stdout)).toEqual(['history-sweep: store-create-refused-role']);
    expect(fs.existsSync(historyPaths(box.home).root)).toBe(false);
  });

  it('DM33 (through the pass): a creation killed before its link() leaves a marker and no DB; the next pass drops it and creates the store anew', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    const child = createKilledAt(box, 'openSync:history.db.new.:1:after');
    expect(child.signal, String(child.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.dbFile)).toBe(false);
    const dropped = fs.readFileSync(P.pending, 'utf8').trim();
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    const db = openStoreRO(box);
    const storeId = getMeta(db, 'store_id');
    db.close();
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    expect(storeId, 'the dropped marker\'s id was minted for a store that never linked').not.toBe(dropped);
    expect(fs.existsSync(P.pending)).toBe(false);
    expect(fs.readdirSync(P.dbDir).filter((n) => n.startsWith('history.db.new.'))).toEqual([]);
  });

  it('DM33b (through the pass): a creation killed before its pending rename is finished, opened and counted', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    const child = createKilledAt(box, 'renameSync:store.id.pending:2');
    expect(child.signal, String(child.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.storeId)).toBe(false);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    const db = openStoreRO(box);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(getMeta(db, 'store_id'));
    db.close();
    expect(counters(box)['store_creation_completed']).toBe(1);
  });

  it('D-4301 (DM17 through the pass): a finish-pending store at a newer schema is refused before the pending rename: marker left, nothing written', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    const child = createKilledAt(box, 'renameSync:store.id.pending:2');
    expect(child.signal, String(child.stderr)).toBe('SIGKILL');
    expect(fs.existsSync(P.storeId)).toBe(false);
    const raw = new DatabaseSync(P.dbFile);
    raw.exec('PRAGMA user_version = 2');
    raw.close();
    const pending = fs.readFileSync(P.pending, 'utf8');
    const mtime = mtimeNs(P.dbFile);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(5);
    expect(lines(r.stdout)).toEqual(['history-sweep: schema-newer']);
    expect(fs.existsSync(P.storeId), 'finishPending waits for the peek').toBe(false);
    expect(fs.readFileSync(P.pending, 'utf8')).toBe(pending);
    expect(mtimeNs(P.dbFile)).toBe(mtime);
  });

  it('history-off: the shim ends a scheduled pass silently, and sweep.mjs itself says off — neither creates a store', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    fs.writeFileSync(historyPaths(box.home).off, '');
    const shim = runShim(box);
    expect(shim.code).toBe(0);
    expect(shim.stdout).toBe('');
    const direct = runSweep(box);
    expect(direct.code).toBe(0);
    expect(lines(direct.stdout)).toEqual(['history-sweep: off']);
    expect(fs.existsSync(historyPaths(box.home).root)).toBe(false);
  });

  it('argv: a malformed pass is a usage error, exit 2; an --op verb this build does not run answers bad-args as JSON', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const bad = runSweep(box, ['--bogus']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/usage: sweep\.mjs/);
    const op = runSweep(box, ['--op', 'prune']);
    expect(op.code).toBe(2);
    expect(JSON.parse(lines(op.stdout).at(-1)!)).toEqual({ rc: 2, reason: 'bad-args' });
  });

  it('contract 4: a HOME that is not an absolute path exits 1 and sweeps nothing', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    // sweep.mjs directly, never the shim: the shim makes $HOME/.ccrc before node runs, so an empty HOME
    // would have it create /.ccrc.
    for (const bad of ['', 'relative/home', '.']) {
      const r = runSweep(box, ['--roster-unreadable'], { env: { HOME: bad } });
      expect(r.code, JSON.stringify(bad)).toBe(1);
      expect(r.stderr).toMatch(/HOME is not an absolute path; nothing was swept/);
      expect(r.stderr).not.toMatch(/internal error/);
      expect(r.stdout).toBe('');
    }
    expect(fs.existsSync(path.join(box.home, 'relative'))).toBe(false);
    expect(fs.existsSync(box.root)).toBe(false);
    expect(fs.existsSync(path.join(box.home, '.ccrc', 'history'))).toBe(false);
  });

  it('parseSweepArgv: the shim\'s grammar, exactly', () => {
    expect(parseSweepArgv(['--secrets', '/s/a', '/s/b', '--', '/h/one', '/h/two'])).toEqual({
      op: null, opArgs: [], rosterUnreadable: false, secrets: ['/s/a', '/s/b'], homes: ['/h/one', '/h/two'],
    });
    expect(parseSweepArgv(['--op', 'import', '--apply', '--roster-unreadable', '--secrets', '--'])).toEqual({
      op: 'import', opArgs: ['--apply'], rosterUnreadable: true, secrets: [], homes: [],
    });
    for (const bad of [[], ['--', '/h'], ['--secrets', '/s'], ['--op', '--secrets', '--'], ['--op', 'Import', '--secrets', '--']]) {
      expect(parseSweepArgv(bad), JSON.stringify(bad)).toEqual({ error: 'bad-args' });
    }
  });

  it('O24: every history test file that spawns the sweep or the shim skips on darwin; the lib tests do not', () => {
    const dir = path.join(REPO, 'server', 'test');
    const files = fs.readdirSync(dir).filter((n) => /^history-.*\.test\.ts$/.test(n));
    // CODE lines only: a comment that names a skip is no skip, and this case's own comment below names two.
    const code = (n: string): string => fs.readFileSync(path.join(dir, n), 'utf8').split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const spawning = files.filter((n) => /\brun(Sweep|Shim)\(/.test(code(n)));
    expect(spawning, 'the census saw no spawning file').toContain('history-sweep.test.ts');
    for (const n of spawning) {
      // Three accepted spellings of the one skip: the helper, `.skipIf(`, and the global constraint's own
      // `beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); })` (Tasks 24, 25 and 27 use it).
      expect(code(n), `${n} spawns the sweep and never skips on darwin`)
        .toMatch(/^skipOnDarwin\(\);$|\.skipIf\(|if \(process\.platform === 'darwin'\) ctx\.skip\(\)/m);
    }
    if (files.includes('history-lib.test.ts')) {
      expect(code('history-lib.test.ts')).not.toMatch(/skipOnDarwin\(\)/);
    }
  });
});
