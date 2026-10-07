// server/test/fixtures/history/preload-faults.mjs — TEST-ONLY fault injection
// for spawned ccd/history children (spec 2026-10-05 §10.1 "Seams"). Loaded with
// `--import <this file>` or NODE_OPTIONS; NEVER shipped, and nothing under ccd/
// reads the variables below — shipped code arms no seam (single-definition's
// env allow-list pins that side).
//
// HISTORY_TEST_KILL=<fn>:<substring>:<nth>[:before|:after]
//   SIGKILL this process at the nth call of node:fs's sync function <fn> whose
//   first argument contains <substring> — just before the call runs (the
//   default) or just after it returns. A kill, not a throw: the point is a
//   process that stops dead between two writes, as a carrier's wall-clock kill
//   or a power cut stops it, with no `finally` and no exit handler run.
//
// `syncBuiltinESMExports()` is what makes the patch reach
// `import { renameSync } from 'node:fs'` in the module under test (M, 22.16.0
// and 24.14.1): without it a named import keeps the original function.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const kill = process.env.HISTORY_TEST_KILL;
if (kill) {
  const [fn, needle, nthText, when = 'before'] = kill.split(':');
  const nth = Number(nthText);
  if (typeof fs[fn] !== 'function' || !needle || !Number.isInteger(nth) || nth < 1
    || (when !== 'before' && when !== 'after')) {
    throw new Error(`preload-faults: HISTORY_TEST_KILL=${kill} is not <fn>:<substring>:<nth>[:before|:after]`);
  }
  const real = fs[fn];
  let seen = 0;
  const die = () => {
    process.kill(process.pid, 'SIGKILL');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
  };
  fs[fn] = function killAt(...args) {
    const hit = String(args[0]).includes(needle) && (seen += 1) === nth;
    if (hit && when === 'before') die();
    const out = real.apply(this, args);
    if (hit && when === 'after') die();
    return out;
  };
}
syncBuiltinESMExports();
// >>> history fault recorder (plan W1-B1, tasks 15-16) ──────────────────────────────────────────────────────
// Test-only and never shipped (nothing under server/test/ is on a release PATHSPEC). These env vars arm it:
//   HISTORY_TEST_RECORD=<file>     append one line per observed operation, in order, synchronously
//   HISTORY_TEST_KILL_AT=<ev>:<n>  SIGKILL this process right after the n-th <ev> is observed. A `commit` is
//                                  observed BEFORE it runs, so commit:<n> kills with that transaction still open.
//   HISTORY_TEST_ENOSPC=<substr>   the first Buffer write to a file whose path holds <substr> writes half of
//                                  itself, then throws ENOSPC
//   HISTORY_TEST_FAIL_COMMIT=<n>   the n-th COMMIT under synchronous=FULL throws instead of committing. The error
//                                  carries code ERR_SQLITE_ERROR, as node:sqlite's own errors do.
// Events:
//   journal-open <name>            an open under /journal/
//   journal-write <name>           a write of a journal *.jsonl
//   journal-fsync <name>           an fsync of a journal *.jsonl
//   sidecar <name>                 a rename onto *.obs
//   unlink <name>                  an unlink under /.draining/
//   commit sync=<0..3>             PRAGMA synchronous at that COMMIT
//   outbox-delete                  a DELETE FROM journal_outbox
// Every wrapper composes with whatever the code above installed: it calls the function it found there.
import hfFs from 'node:fs';
import { syncBuiltinESMExports as hfSyncBuiltins } from 'node:module';
import { DatabaseSync as HfDatabaseSync, StatementSync as HfStatementSync } from 'node:sqlite';

const hfPrev = {
  openSync: hfFs.openSync, closeSync: hfFs.closeSync, writeSync: hfFs.writeSync, fsyncSync: hfFs.fsyncSync,
  renameSync: hfFs.renameSync, unlinkSync: hfFs.unlinkSync, appendFileSync: hfFs.appendFileSync,
};
const hfRecordFile = process.env.HISTORY_TEST_RECORD ?? '';
const [hfKillEvent = '', hfKillNth = ''] = (process.env.HISTORY_TEST_KILL_AT ?? '').split(':');
const hfEnospcPath = process.env.HISTORY_TEST_ENOSPC ?? '';
const hfFailCommitNth = Number(process.env.HISTORY_TEST_FAIL_COMMIT ?? '0');
const hfSeen = new Map();
const hfFdPath = new Map();
let hfEnospcSpent = false;
let hfFullCommits = 0;
const hfBase = (p) => { const s = String(p); return s.slice(s.lastIndexOf('/') + 1); };
const hfIsJournal = (p) => String(p).includes('/journal/');

function hfNote(event, detail) {
  if (hfRecordFile !== '') hfPrev.appendFileSync(hfRecordFile, `${event}${detail === '' ? '' : ` ${detail}`}\n`);
  const n = (hfSeen.get(event) ?? 0) + 1;
  hfSeen.set(event, n);
  if (event === hfKillEvent && String(n) === hfKillNth) process.kill(process.pid, 'SIGKILL');
}

hfFs.openSync = function openSync(p, ...rest) {
  const fd = hfPrev.openSync.call(this, p, ...rest);
  hfFdPath.set(fd, String(p));
  if (hfIsJournal(p)) hfNote('journal-open', hfBase(p));
  return fd;
};
hfFs.closeSync = function closeSync(fd, ...rest) {
  hfFdPath.delete(fd);
  return hfPrev.closeSync.call(this, fd, ...rest);
};
hfFs.writeSync = function writeSync(fd, data, ...rest) {
  const p = hfFdPath.get(fd) ?? '';
  if (hfEnospcPath !== '' && !hfEnospcSpent && p.includes(hfEnospcPath) && ArrayBuffer.isView(data) && data.byteLength > 1) {
    hfEnospcSpent = true;
    hfPrev.writeSync.call(this, fd, data, 0, Math.floor(data.byteLength / 2));
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', errno: -28, syscall: 'write' });
  }
  const r = hfPrev.writeSync.call(this, fd, data, ...rest);
  if (hfIsJournal(p) && p.endsWith('.jsonl')) hfNote('journal-write', hfBase(p));
  return r;
};
hfFs.fsyncSync = function fsyncSync(fd) {
  const r = hfPrev.fsyncSync.call(this, fd);
  const p = hfFdPath.get(fd) ?? '';
  if (hfIsJournal(p) && p.endsWith('.jsonl')) hfNote('journal-fsync', hfBase(p));
  return r;
};
hfFs.renameSync = function renameSync(from, to) {
  const r = hfPrev.renameSync.call(this, from, to);
  if (String(to).endsWith('.obs')) hfNote('sidecar', hfBase(to));
  return r;
};
hfFs.unlinkSync = function unlinkSync(p) {
  const r = hfPrev.unlinkSync.call(this, p);
  if (String(p).includes('/.draining/')) hfNote('unlink', hfBase(p));
  return r;
};
const hfExec = HfDatabaseSync.prototype.exec;
HfDatabaseSync.prototype.exec = function exec(sql) {
  if (/^\s*COMMIT\b/i.test(String(sql))) {
    const sync = this.prepare('PRAGMA synchronous').get().synchronous;
    if (sync === 2) {
      hfFullCommits += 1;
      if (hfFullCommits === hfFailCommitNth) throw Object.assign(new Error('injected commit failure'), { code: 'ERR_SQLITE_ERROR' });
    }
    hfNote('commit', `sync=${sync}`);
  }
  return hfExec.call(this, sql);
};
const hfRun = HfStatementSync.prototype.run;
HfStatementSync.prototype.run = function run(...args) {
  if (/^\s*DELETE\s+FROM\s+journal_outbox\b/i.test(this.sourceSQL)) hfNote('outbox-delete', '');
  return hfRun.apply(this, args);
};
hfSyncBuiltins();
// <<< history fault recorder

// ── Task 23: the FTS5 probe's answer (O9) ─────────────────────────────────────────────────────────
// HISTORY_TEST_FTS_PROBE=absent: the read-only probe's statement (`… pragma_module_list WHERE name='fts5'`,
//   store.mjs probeFts5, Task 11) finds no row, as on a node:sqlite built without FTS5.
// HISTORY_TEST_FTS_PROBE=throw: preparing the probe's statement throws, the `probe-failed` arm.
// Only the probe's SQL is touched; every other statement, the FTS tables' own included, runs for real, so
// flipping the variable off lets the next pass create and backfill the tables (O9).
import { DatabaseSync as DatabaseSyncF23 } from 'node:sqlite';
{
  const modeF23 = process.env.HISTORY_TEST_FTS_PROBE ?? '';
  if (modeF23 === 'absent' || modeF23 === 'throw') {
    const protoF23 = DatabaseSyncF23.prototype;
    const realPrepareF23 = protoF23.prepare;
    protoF23.prepare = function prepareF23(sql) {
      if (!/pragma_module_list/i.test(String(sql))) return realPrepareF23.call(this, sql);
      if (modeF23 === 'throw') throw new Error('the fts5 probe failed (test preload)');
      return { get: () => undefined, all: () => [], iterate: function* iterateF23() {}, run: () => ({ changes: 0, lastInsertRowid: 0 }) };
    };
  }
}
