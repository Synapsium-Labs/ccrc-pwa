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
  PRELOADS, REPO, SWEEP, counters, makeHistoryBox, openStoreRO, runShim, runSweep, skipOnDarwin, type HistoryBox,
} from './historyHelpers.js';
import { SCHEMA_VERSION, STATFS_DEADLINE_MS, historyPaths } from '../../ccd/history/lib.mjs';
import { closeWriter, createStore, getMeta, openWriter, userVersion } from '../../ccd/history/store.mjs';
import { parseSweepArgv, recordRecallOff } from '../../ccd/history/sweep.mjs';
import { readFileSync as readUnitText } from 'node:fs';
import { join as joinUnitPath, resolve as resolveUnitPath } from 'node:path';

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
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
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

  it('a FIFO at history-max-gb never blocks a pass: the default cap applies (review 316 F10)', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    expect(runSweep(box).code).toBe(0);
    expect(spawnSync('mkfifo', [P.cap]).status).toBe(0);
    const r = runSweep(box, [], { timeoutMs: 30_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(r.ms).toBeLessThan(25_000);
  });

  it.each(['storeId', 'writer', 'pending'] as const)('a FIFO at the binding file %s is store-unmeasured, exit 5, promptly (review 316 F10)', (k) => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    expect(runSweep(box).code).toBe(0);
    fs.rmSync(P[k], { force: true });
    expect(spawnSync('mkfifo', [P[k]]).status).toBe(0);
    const r = runSweep(box, [], { timeoutMs: 30_000 });
    expect(r.code, r.stderr).toBe(5);
    expect(r.stdout).toMatch(/^history-sweep: store-unmeasured$/m);
    expect(r.ms).toBeLessThan(25_000);
  });

  it('a store.id that is a symlink is store-unmeasured: only db/ may be a link (§9.3)', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    expect(runSweep(box).code).toBe(0);
    fs.renameSync(P.storeId, path.join(box.home, 'id-real'));
    fs.symlinkSync(path.join(box.home, 'id-real'), P.storeId);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(5);
    expect(r.stdout).toMatch(/^history-sweep: store-unmeasured$/m);
  });

  it('a FIFO at accounts.sh never blocks the shim: --roster-unreadable, counted, exit 0 promptly (review 316 F10)', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    expect(runShim(box).code).toBe(0);
    fs.rmSync(historyPaths(box.home).accountsSh);
    expect(spawnSync('mkfifo', [historyPaths(box.home).accountsSh]).status).toBe(0);
    const r = runShim(box, [], { timeoutMs: 30_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(r.ms).toBeLessThan(25_000);
    expect(counters(box)['roster_unreadable']).toBe(1);
  });

  it('a pass removes a stale binding temp left by a killed write (review 316 F21)', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    expect(runSweep(box).code).toBe(0);
    fs.writeFileSync(path.join(P.root, 'store.writer.tmp.4242'), 'abcd');
    fs.writeFileSync(path.join(P.root, 'op.tmp.4242'), 'import');
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(P.root, 'store.writer.tmp.4242'))).toBe(false);
    expect(fs.existsSync(path.join(P.root, 'op.tmp.4242'))).toBe(false);
  });

  it('a directory at a writer temp or marker name never fails a pass (review 316 F22)', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    const P = historyPaths(box.home);
    expect(runSweep(box).code).toBe(0);
    const tempDir = path.join(P.dbDir, 'history.db.new.77');
    const markerDir = path.join(P.backups, '.pre-v1.attempt');
    fs.mkdirSync(tempDir);
    fs.mkdirSync(markerDir, { recursive: true });
    for (let i = 0; i < 2; i += 1) {
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
    }
    expect(fs.existsSync(tempDir)).toBe(false);
    expect(fs.existsSync(markerDir)).toBe(false);
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

  it('DM17 (store half): a store at user_version SCHEMA_VERSION + 1 -> schema-newer, exit 5, and no write', () => {
    const box = makeHistoryBox('ccrc-history-sweep-');
    createStore(box.home);
    const P = historyPaths(box.home);
    const raw = new DatabaseSync(P.dbFile);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}; INSERT INTO counters (name, n) VALUES ('fixture', 1);`);
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
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
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
    const op = runSweep(box, ['--op', 'frobnicate']);   // B2 runs prune; this case needs a verb no build runs
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

// ── task 30: ccd-history-sweep ships the way ccd-tmp-sweep does (history spec §9.5) ──
// SOURCE SCANS of the units and of deploy.sh: the artifact is read by a box
// this suite cannot touch. Comments are dropped first, so prose about a key is
// never taken for the key.
describe('ccd-history-sweep ships the way ccd-tmp-sweep does', () => {
  const UNIT_REPO = resolveUnitPath(__dirname, '..', '..');
  const SYSTEMD = joinUnitPath(UNIT_REPO, 'deploy', 'systemd');
  const directives = (name: string): string[] => readUnitText(joinUnitPath(SYSTEMD, name), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const deploySh = readUnitText(joinUnitPath(UNIT_REPO, 'deploy', 'deploy.sh'), 'utf8');
  const code = deploySh.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  /** A systemd time span, in seconds — the spellings this tree's units use. */
  const spanSeconds = (v: string): number => {
    const m = /^(\d+)(ms|s|sec|min|m|h)?$/.exec(v);
    if (m === null) throw new Error(`not a time span this reader knows: ${v}`);
    const n = Number(m[1]);
    if (m[2] === 'ms') return n / 1000;
    if (m[2] === 'min' || m[2] === 'm') return n * 60;
    if (m[2] === 'h') return n * 3600;
    return n;
  };

  it('the service is an idle-priority oneshot running the installed shim, memory-capped, with no SuccessExitStatus', () => {
    const d = directives('ccd-history-sweep.service');
    expect(d).toContain('Type=oneshot');
    expect(d).toContain('ExecStart=%h/.local/bin/ccd-history-sweep');
    expect(d.filter((l) => l.startsWith('MemoryMax=')), 'the carrier\'s memory bound is exactly 1G: O20 asserts RSS at half of it (D-4244)').toEqual(['MemoryMax=1G']);
    expect(d).toContain('Nice=19');
    expect(d).toContain('IOSchedulingClass=idle');
    // a scheduled pass that finds the lock held exits 0 (§5.1): nothing to whitelist
    expect(d.filter((l) => l.startsWith('SuccessExitStatus='))).toEqual([]);
  });

  it('TimeoutStartSec is the carrier\'s wall-clock kill, equal to lib.mjs CARRIER_KILL_S (DM43)', async () => {
    const { CARRIER_KILL_S } = await import('../../ccd/history/lib.mjs');
    const t = directives('ccd-history-sweep.service').filter((l) => l.startsWith('TimeoutStartSec='));
    expect(t).toHaveLength(1);
    expect(spanSeconds(t[0]!.slice('TimeoutStartSec='.length))).toBe(CARRIER_KILL_S);
  });

  it('the unit inherits the user manager\'s PATH: no Environment=PATH= line D-4255', () => {
    expect(directives('ccd-history-sweep.service').filter((l) => l.startsWith('Environment=PATH='))).toEqual([]);
  });

  it('the timer fires every two minutes, anchored to its own activation, never to boot', () => {
    const d = directives('ccd-history-sweep.timer');
    expect(d).toContain('OnActiveSec=2min');
    expect(d).toContain('OnUnitActiveSec=2min');
    expect(d).toContain('AccuracySec=30s');
    expect(d).toContain('WantedBy=timers.target');
    expect(d.filter((l) => l.startsWith('OnBootSec='))).toEqual([]);
  });

  it('deploy.sh installs the shim once, and the pair and the enable, inside the agent branch before the agent restart', () => {
    expect(code.filter((l) => l === 'install_atomic ccd/ccd-history-sweep .local/bin/ccd-history-sweep 755')).toHaveLength(1);
    const agentStart = deploySh.indexOf('if [ "$TARGET" = "agent" ]');
    const branch = deploySh.slice(agentStart, deploySh.indexOf('\nelse', agentStart));
    const restartAt = branch.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"');
    for (const needle of [
      'install_atomic ccd/ccd-history-sweep .local/bin/ccd-history-sweep 755',
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-history-sweep.service ~/.config/systemd/user/ccd-history-sweep.service',
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-history-sweep.timer ~/.config/systemd/user/ccd-history-sweep.timer',
      'systemctl --user enable --now ccd-history-sweep.timer',
    ]) {
      const at = branch.indexOf(needle);
      expect(at, `${needle} is not in the agent branch`).toBeGreaterThan(-1);
      expect(at, `${needle} must land before the agent restart`).toBeLessThan(restartAt);
    }
  });

  it('ccd-history-sweep is never a reserved account id: neither GPT_TOOLCHAIN_ACCOUNT_IDS mirror names it', () => {
    for (const rel of ['shared/roster.ts', 'shared/roster-json.mjs']) {
      const src = readUnitText(joinUnitPath(UNIT_REPO, rel), 'utf8');
      const m = /\bconst GPT_TOOLCHAIN_ACCOUNT_IDS\b[^=\n]*= new Set\(\[([^\]]*)\]\);/.exec(src);
      expect(m, `${rel} no longer declares GPT_TOOLCHAIN_ACCOUNT_IDS as a Set literal`).not.toBeNull();
      expect(m![1]!, rel).not.toContain('ccd-history-sweep');
    }
  });

  it('the timer\'s header names the rollback remedy, and the re-enable it cites is real (review 316 F36)', () => {
    const text = readUnitText(joinUnitPath(SYSTEMD, 'ccd-history-sweep.timer'), 'utf8');
    const header = text.slice(0, text.indexOf('[Unit]'));
    expect(header).toMatch(/^#\s+systemctl --user disable --now ccd-history-sweep\.timer$/m);
    expect(header).toContain('_inst_enable_timer history ccd-history-sweep.timer');
    expect(readUnitText(joinUnitPath(UNIT_REPO, 'ccd', 'ccrc'), 'utf8')).toContain('_inst_enable_timer history ccd-history-sweep.timer');
  });
});

describe('tick()\'s docstring names its steps in the order the body runs them (review 316 F39)', () => {
  const src = fs.readFileSync(SWEEP, 'utf8');
  const head = 'export async function tick(db, ctx) {';
  const at = src.indexOf(head);
  const doc = src.slice(src.lastIndexOf('/**', at), at);
  const body = src.slice(at + head.length, src.indexOf('\n}\n', at)).replace(/(^|\s)\/\/.*$/gm, '$1');
  const listed = [...doc.matchAll(/^\s*\*\s+\d+\.\s+`([A-Za-z]\w*)`/gm)].map((m) => m[1]!);
  // A step's call site: `<name>(` not preceded by a word character, so `deriveFts(` never matches inside `rederiveFts(`.
  const callAt = (n: string): number => {
    let i = body.indexOf(`${n}(`);
    while (i > 0 && /\w/.test(body[i - 1]!)) i = body.indexOf(`${n}(`, i + 1);
    return i;
  };
  it('the docstring is a numbered list of at least ten steps', () => {
    expect(at).toBeGreaterThan(-1);
    expect(listed.length).toBeGreaterThanOrEqual(10);
  });
  it('every listed step is called in the body, in the listed order', () => {
    const idx = listed.map(callAt);
    expect(listed.filter((_, i) => idx[i]! < 0)).toEqual([]);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
  it('every step the body calls with db is listed', () => {
    const NOT_STEPS = new Set(['bump', 'countOutside', 'scanDue']);
    const called = [...new Set([...body.matchAll(/\b([a-z]\w*)\(db\b/g)].map((m) => m[1]!))].filter((n) => !NOT_STEPS.has(n));
    expect(called.filter((n) => !listed.includes(n))).toEqual([]);
  });
});

// ── W2-1 Task 4: the per-tick presence record (W2-D30) ───────────────────────────────────────────────────────────
// The real sweep, as the box runs it. recall-off/ is planted the way the W2 verb leaves it (`<generation>\n`, 0600, in a
// 0700 directory); this file never runs the verb. The step's place in tick is pinned by the docstring describe above.
import * as roLib from '../../ccd/history/lib.mjs';
import { journalRecords as roJournal } from './historyHelpers.js';

describe('the recall-off presence record, one tick step (W2-D30; W2-1 Task 4)', () => {
  const K = roLib.RECALL_OFF_KEYS;
  const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
  const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
  const X = 'claude-a-demo';
  const UNREADABLE = { s: 'unreadable', v: null };
  const dirOf = (box: HistoryBox): string => path.join(box.root, 'recall-off');
  const plant = (box: HistoryBox, id: string, text: string): void => {
    fs.mkdirSync(dirOf(box), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dirOf(box), id), text, { mode: 0o600 });
  };
  const tickOk = (box: HistoryBox): void => {
    const r = runSweep(box);
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
  };
  /** Every presence row, by key: the meta keys from RECALL_OFF_META up to the same prefix with ':' replaced by ';'. */
  const presence = (box: HistoryBox): Record<string, string> => {
    const db = openStoreRO(box);
    try {
      const out: Record<string, string> = {};
      const all = db.prepare('SELECT k, v FROM meta WHERE k >= ? AND k < ? ORDER BY k')
        .all(roLib.RECALL_OFF_META, `${roLib.RECALL_OFF_META.slice(0, -1)};`) as Array<{ k: string; v: string }>;
      for (const r of all) out[r.k] = r.v;
      return out;
    } finally {
      db.close();
    }
  };
  const changesOf = (p: Record<string, string>, id: string): Array<Record<string, unknown>> => Object.entries(p)
    .filter(([k]) => k.startsWith(K.change) && k.endsWith(`:${id}`))
    .map(([k, v]) => ({ ts: Number(k.slice(K.change.length, k.lastIndexOf(':'))), ...(JSON.parse(v) as object) }));
  const body = (c: Record<string, unknown>): Record<string, unknown> => ({ from: c['from'], to: c['to'], prev_seen_ms: c['prev_seen_ms'] });
  const stateOf = (p: Record<string, string>, id: string): unknown => {
    const v = p[`${K.state}${id}`];
    return v === undefined ? undefined : JSON.parse(v);
  };
  const gapsOf = (p: Record<string, string>): Array<{ from: number | null; to: number }> => Object.entries(p)
    .filter(([k]) => k.startsWith(K.gap)).map(([, v]) => JSON.parse(v) as { from: number | null; to: number });
  const setSeen = (box: HistoryBox, ms: number): void => {
    const db = new DatabaseSync(historyPaths(box.home).dbFile);
    try {
      expect(Number(db.prepare('UPDATE meta SET v = ? WHERE k = ?').run(String(ms), K.seen).changes)).toBe(1);
    } finally {
      db.close();
    }
  };
  const outboxRows = (box: HistoryBox): number => {
    const db = openStoreRO(box);
    try { return Number((db.prepare('SELECT count(*) AS n FROM journal_outbox').get() as { n: number }).n); } finally { db.close(); }
  };

  it('one change row per transition and none for an unchanged file; each row journaled as a recall-off record through the outbox', () => {
    const box = makeHistoryBox('ccrc-history-roff-trans-');
    tickOk(box);   // first install: the first observation ever, of no directory, is complete
    const p0 = presence(box);
    expect(gapsOf(p0).map((g) => g.from), 'the first observation ever is a gap from null').toEqual([null]);
    expect(p0[K.seen], 'an absent directory is an empty, complete observation: seen_ms advances').toMatch(/^[0-9]+$/);
    plant(box, X, `${G1}\n`);
    tickOk(box);
    const p1 = presence(box);
    expect(changesOf(p1, X).map(body)).toEqual([{ from: 'unobserved', to: { s: 'value', v: G1 }, prev_seen_ms: null }]);
    expect(stateOf(p1, X)).toEqual({ s: 'value', v: G1 });
    tickOk(box);   // nothing changed
    const p2 = presence(box);
    expect(changesOf(p2, X), 'an unchanged file is not flagged').toHaveLength(1);
    expect(Number(p2[K.seen]), 'CONTROL: that tick observed, and seen_ms moved').toBeGreaterThan(Number(p1[K.seen]));
    plant(box, X, `${G2}\n`);
    tickOk(box);
    const p3 = presence(box);
    fs.rmSync(path.join(dirOf(box), X));
    tickOk(box);
    const p4 = presence(box);
    expect(changesOf(p4, X).map(body)).toEqual([
      { from: 'unobserved', to: { s: 'value', v: G1 }, prev_seen_ms: null },
      { from: { s: 'value', v: G1 }, to: { s: 'value', v: G2 }, prev_seen_ms: Number(p2[K.seen]) },
      { from: { s: 'value', v: G2 }, to: 'absent', prev_seen_ms: Number(p3[K.seen]) },
    ]);
    expect(stateOf(p4, X), 'a file gone has no state row').toBeUndefined();
    // Journaled: one recall-off record per row, its t the row's key ms, and nothing left in the outbox.
    const firstGap = Number(Object.keys(p0).find((k) => k.startsWith(K.gap))!.slice(K.gap.length));
    expect(roJournal(box).filter((r) => r['k'] === 'recall-off').map((r) => [r['rk'], r['id'] ?? null, r['t']])).toEqual([
      ['gap', null, firstGap],
      ...changesOf(p4, X).map((c) => ['change', X, c['ts']]),
    ]);
    expect(outboxRows(box)).toBe(0);
  }, 120_000);

  it('unreadable is never absent: a link, a directory and an over-cap file at an id each read unreadable, with a state row', () => {
    const box = makeHistoryBox('ccrc-history-roff-unread-');
    tickOk(box);
    plant(box, X, `${G1}\n`);
    tickOk(box);
    const p1 = presence(box);
    const target = path.join(box.home, 'g1');
    fs.writeFileSync(target, `${G1}\n`);
    fs.rmSync(path.join(dirOf(box), X));
    fs.symlinkSync(target, path.join(dirOf(box), X));   // a link to the same generation: never followed
    fs.mkdirSync(path.join(dirOf(box), 'claude-b-demo'));
    plant(box, 'claude-c-demo', 'a'.repeat(roLib.CONTROL_FILE_MAX + 1));
    plant(box, 'claude-d-demo', '');                   // CONTROL: an empty file is a value, ''
    tickOk(box);
    const p2 = presence(box);
    expect(changesOf(p2, X).map(body).at(-1)).toEqual({ from: { s: 'value', v: G1 }, to: UNREADABLE, prev_seen_ms: Number(p1[K.seen]) });
    expect([stateOf(p2, X), stateOf(p2, 'claude-b-demo'), stateOf(p2, 'claude-c-demo'), stateOf(p2, 'claude-d-demo')])
      .toEqual([UNREADABLE, UNREADABLE, UNREADABLE, { s: 'value', v: '' }]);
    expect(Object.values(p2).some((v) => v.includes('"absent"')), 'no transition to absent').toBe(false);
  }, 120_000);

  it('a gap row after an interval longer than RECALL_OFF_GAP_MS with no observation, and none after a shorter one', () => {
    const box = makeHistoryBox('ccrc-history-roff-gap-');
    tickOk(box);
    const long = Date.now() - roLib.RECALL_OFF_GAP_MS - 60_000;
    setSeen(box, long);
    tickOk(box);
    const after = gapsOf(presence(box));
    expect(after).toHaveLength(2);
    expect(after[1]!.from).toBe(long);
    expect(after[1]!.to - long).toBeGreaterThan(roLib.RECALL_OFF_GAP_MS);
    setSeen(box, Date.now());   // the next tick starts after this, inside the case's 120 s timeout, which is below the gap
    tickOk(box);
    expect(gapsOf(presence(box)), 'CONTROL: an interval shorter than the gap writes none').toHaveLength(2);
  }, 120_000);

  it('a capped or unreadable directory writes nothing, leaves seen_ms and is counted; names outside the id grammar are counted, never read', () => {
    const box = makeHistoryBox('ccrc-history-roff-cap-');
    tickOk(box);
    fs.mkdirSync(dirOf(box), { mode: 0o700 });
    // RECALL_OFF_SCAN_MAX + 1 entries, none of them an id (`~` is outside ID_RE, like the writer's `~tmp.<pid>`).
    for (let i = 0; i <= roLib.RECALL_OFF_SCAN_MAX; i += 1) fs.writeFileSync(path.join(dirOf(box), `~tmp.${i}`), '');
    const seen0 = presence(box)[K.seen];
    tickOk(box);
    expect(presence(box)[K.seen], 'a capped directory leaves seen_ms').toBe(seen0);
    expect(counters(box)['recall_off_scan_capped']).toBe(1);
    expect(counters(box)['recall_off_name_skipped'], 'a capped scan counts no name').toBeUndefined();
    fs.rmSync(path.join(dirOf(box), '~tmp.0'));   // CONTROL: exactly RECALL_OFF_SCAN_MAX entries is a complete observation
    tickOk(box);
    expect(Number(presence(box)[K.seen])).toBeGreaterThan(Number(seen0));
    expect(counters(box)).toMatchObject({ recall_off_scan_capped: 1, recall_off_name_skipped: roLib.RECALL_OFF_SCAN_MAX });
    expect(Object.keys(presence(box)).filter((k) => k.startsWith(K.state)), 'a name outside the grammar is never a state row').toEqual([]);
    // An unreadable directory: a link standing at recall-off/, to a directory that holds an id's file. Never followed.
    fs.rmSync(dirOf(box), { recursive: true });
    const real = path.join(box.home, 'elsewhere');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, X), `${G1}\n`);
    fs.symlinkSync(real, dirOf(box));
    const seen1 = presence(box)[K.seen];
    tickOk(box);
    expect(presence(box)[K.seen], 'an unreadable directory leaves seen_ms').toBe(seen1);
    expect(stateOf(presence(box), X), 'and the link is never followed').toBeUndefined();
    expect(counters(box)['recall_off_dir_unreadable']).toBe(1);
  }, 240_000);

  it('a state row off its grammar is counted recall_off_state_malformed, once per tick that reads it', () => {
    const box = makeHistoryBox('ccrc-history-roff-malformed-');
    tickOk(box);
    expect(counters(box)['recall_off_state_malformed'], 'CONTROL: a clean store counts none').toBeUndefined();
    plant(box, X, `${G1}\n`);
    const db = new DatabaseSync(historyPaths(box.home).dbFile);
    try {
      db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(`${K.state}${X}`, '{"s":"maybe"}');
    } finally {
      db.close();
    }
    tickOk(box);
    expect(counters(box)['recall_off_state_malformed']).toBe(1);
    expect(stateOf(presence(box), X), 'the pass rewrote the row from the file it read').toEqual({ s: 'value', v: G1 });
  }, 120_000);

  /** Every journal_outbox record, in seq order: its seq and the parsed line (the step is run with no ids, so nothing flushes). */
  const outboxRecs = (box: HistoryBox): Array<{ seq: number; rec: Record<string, unknown> }> => {
    const db = openStoreRO(box);
    try {
      return (db.prepare('SELECT seq, rec FROM journal_outbox ORDER BY seq').all() as Array<{ seq: number; rec: string }>)
        .map((r) => ({ seq: r.seq, rec: JSON.parse(r.rec) as Record<string, unknown> }));
    } finally {
      db.close();
    }
  };

  it('in process, a stepping clock: change and gap rows and their records are keyed by the observation\'s end and seen_ms by its start; a clock that steps back is clamped to the start (r761 F2)', () => {
    const box = makeHistoryBox('ccrc-history-roff-clock-');
    tickOk(box);   // the schema and a seen_ms exist; its records were flushed
    expect(outboxRows(box), 'CONTROL: the real tick left the outbox empty').toBe(0);
    const S0 = 1_700_000_000_000;
    const S1 = S0 + roLib.RECALL_OFF_GAP_MS + 60_000;
    const E1 = S1 + 7_000;
    const S2 = E1 + 60_000;   // 67 s after S1: inside the gap, so no gap row
    const clock = (queue: number[]): (() => number) => () => {
      const v = queue.shift();
      if (v === undefined) throw new Error('the step read the clock more than twice');
      return v;
    };
    const step = (queue: number[]): void => {
      const now = clock(queue);
      const db = openWriter(historyPaths(box.home).dbFile);
      try {
        recordRecallOff(db, { home: box.home, paths: historyPaths(box.home), now, ids: null });
      } finally {
        closeWriter(db);
      }
      expect(queue, 'CONTROL: the step read the clock exactly twice').toEqual([]);
    };
    // Observation 1: the clock steps forward. seen_ms was left far back, so a gap row is written too.
    setSeen(box, S0);
    plant(box, X, `${G1}\n`);
    step([S1, E1]);
    const p1 = presence(box);
    expect(p1[`${K.change}${E1}:${X}`], 'X\'s change row is keyed by the observation\'s end').toBeDefined();
    expect(Object.keys(p1).filter((k) => k.startsWith(K.change)), 'and by nothing else').toEqual([`${K.change}${E1}:${X}`]);
    expect(p1[`${K.gap}${E1}`], 'the gap row is keyed by the end').toBe(roLib.canonicalJson({ from: S0, to: S1 }));
    expect(Object.keys(p1).filter((k) => k.startsWith(K.gap) && k !== `${K.gap}${E1}`), 'the first tick\'s gap row is the only other')
      .toHaveLength(1);
    expect(p1[K.seen], 'seen_ms is the start').toBe(String(S1));
    const o1 = outboxRecs(box);
    expect(o1.map((r) => [r.rec['k'], r.rec['rk']]), 'CONTROL: the gap and the change were journaled')
      .toEqual([['recall-off', 'gap'], ['recall-off', 'change']]);
    expect(o1.map((r) => r.rec['t']), 'every record carries the end').toEqual([E1, E1]);
    // Observation 2: the clock steps back between the two reads; the end is clamped to the start.
    plant(box, X, `${G2}\n`);
    step([S2, S2 - 5_000]);
    const p2 = presence(box);
    const newChange = Object.keys(p2).filter((k) => k.startsWith(K.change) && !(k in p1));
    expect(newChange, 'the clamp keys the change row by the start').toEqual([`${K.change}${S2}:${X}`]);
    expect(Object.keys(p2).filter((k) => k.startsWith(K.gap)), 'inside the gap: no gap row')
      .toEqual(Object.keys(p1).filter((k) => k.startsWith(K.gap)));
    expect(p2[K.seen]).toBe(String(S2));
    const o2 = outboxRecs(box).filter((r) => r.seq > o1[o1.length - 1]!.seq);
    expect(o2.map((r) => [r.rec['rk'], r.rec['t']]), 'its record carries the clamped end').toEqual([['change', S2]]);
  }, 120_000);
});
