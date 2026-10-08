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
//   HISTORY_TEST_FAIL_COMMIT=<n>[:<errcode>]   the n-th COMMIT under synchronous=FULL throws instead of committing.
//                                  The error carries code ERR_SQLITE_ERROR, as node:sqlite's own errors do; `:<errcode>`
//                                  adds node:sqlite's extended `errcode` (D-4346), none given leaves it off.
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
const [hfFailCommitText = '0', hfFailCommitCode] = (process.env.HISTORY_TEST_FAIL_COMMIT ?? '0').split(':');
const hfFailCommitNth = Number(hfFailCommitText);
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
      if (hfFullCommits === hfFailCommitNth) {
        throw hfFailCommitCode === undefined
          ? Object.assign(new Error('injected commit failure'), { code: 'ERR_SQLITE_ERROR' })
          : Object.assign(new Error('injected commit failure'), { code: 'ERR_SQLITE_ERROR', errcode: Number(hfFailCommitCode), errstr: 'injected' });
      }
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

// ── Task 24: statement-level kills (DM42, O34) ──────────────────────────────────────────────────
// HISTORY_TEST_KILL_SQL=<substring>: when a prepared statement whose SQL contains <substring> runs
//   (run, get or all), first write the 7 bytes `partial` to its first string argument that names a path
//   under HOME — the file an interrupted VACUUM INTO had begun — then SIGKILL this process.
// HISTORY_TEST_KILL_AFTER_COMMIT=<synchronous>:<nth>: SIGKILL right AFTER the nth COMMIT that ran under
//   PRAGMA synchronous = <synchronous> (2 = FULL): a crash between a durable commit and its next step.
// Both patch DatabaseSync.prototype, so every connection the target opens is covered; withTx issues
// BEGIN IMMEDIATE and COMMIT through exec, as server/src/coord/db.ts:245-257's tx does.
import fsK24 from 'node:fs';
import { DatabaseSync as DatabaseSyncK24 } from 'node:sqlite';
{
  const killSql = process.env.HISTORY_TEST_KILL_SQL ?? '';
  const [afterSync, afterNth] = (process.env.HISTORY_TEST_KILL_AFTER_COMMIT ?? '').split(':');
  const proto = DatabaseSyncK24.prototype;
  const realPrepare = proto.prepare;
  const realExec = proto.exec;
  const home = process.env.HOME ?? '\0';
  if (killSql !== '') {
    proto.prepare = function prepareK24(sql) {
      const st = realPrepare.call(this, sql);
      if (!String(sql).includes(killSql)) return st;
      for (const m of ['run', 'get', 'all']) {
        st[m] = (...args) => {
          const target = args.find((a) => typeof a === 'string' && a.startsWith(`${home}/`));
          if (target !== undefined) fsK24.writeFileSync(target, 'partial');
          process.kill(process.pid, 'SIGKILL');
        };
      }
      return st;
    };
  }
  if (afterSync) {
    let seen = 0;
    proto.exec = function execK24(sql) {
      const commit = /^\s*COMMIT\b/i.test(String(sql));
      const sync = commit ? realPrepare.call(this, 'PRAGMA synchronous').get().synchronous : null;
      const r = realExec.call(this, sql);
      if (commit && String(sync) === afterSync) {
        seen += 1;
        if (seen === Number(afterNth)) process.kill(process.pid, 'SIGKILL');
      }
      return r;
    };
  }
}
// ── Task 25: the transaction log (O34) ───────────────────────────────────────────────────────────
// HISTORY_TEST_TXLOG=<file>: append, in order, `BEGIN`; `W <sql>` for every INSERT/UPDATE/DELETE/REPLACE
//   run inside or outside a transaction; `COMMIT <synchronous>`, read just before the COMMIT runs
//   (2 = FULL, 1 = NORMAL); and `J <bytes>` for every writeSync to a file under history/journal/. O34
//   reads it to prove that a verdict commits FULL in a transaction of its own and reaches the journal
//   before the first NORMAL ingest chunk (§9.2 "Every verdict commits first", CT10).
import fsT25 from 'node:fs';
import { syncBuiltinESMExports as syncT25 } from 'node:module';
import { DatabaseSync as DatabaseSyncT25 } from 'node:sqlite';
{
  const txlog = process.env.HISTORY_TEST_TXLOG ?? '';
  if (txlog !== '') {
    const log = (line) => fsT25.appendFileSync(txlog, `${line}\n`);
    const flat = (sql) => String(sql).replace(/\s+/g, ' ').trim();
    const isWrite = (sql) => /^(INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(flat(sql));
    const proto = DatabaseSyncT25.prototype;
    const realPrepare = proto.prepare;
    const realExec = proto.exec;
    proto.exec = function execT25(sql) {
      const s = flat(sql);
      if (/^BEGIN\b/i.test(s)) log('BEGIN');
      if (/^COMMIT\b/i.test(s)) log(`COMMIT ${realPrepare.call(this, 'PRAGMA synchronous').get().synchronous}`);
      if (isWrite(s)) log(`W ${s.slice(0, 160)}`);
      return realExec.call(this, sql);
    };
    proto.prepare = function prepareT25(sql) {
      const st = realPrepare.call(this, sql);
      if (!isWrite(sql)) return st;
      const s = flat(sql).slice(0, 160);
      for (const m of ['run', 'get', 'all']) {
        const real = st[m].bind(st);
        st[m] = (...args) => { log(`W ${s}`); return real(...args); };
      }
      return st;
    };
    const fdPath = new Map();
    const realOpen = fsT25.openSync;
    fsT25.openSync = function openSyncT25(p, ...rest) {
      const fd = realOpen.call(fsT25, p, ...rest);
      fdPath.set(fd, String(p));
      return fd;
    };
    const realWrite = fsT25.writeSync;
    fsT25.writeSync = function writeSyncT25(fd, ...rest) {
      const n = realWrite.call(fsT25, fd, ...rest);
      if ((fdPath.get(fd) ?? '').includes('/history/journal/')) log(`J ${n}`);
      return n;
    };
    syncT25();
  }
}

// ── Task 28F: a second read-only open that fails (status's extras read) ─────────────────────────
// HISTORY_TEST_FAIL_QUERY_ONLY=<n>: the n-th `PRAGMA query_only = ON` exec throws. store.mjs's openReader issues
//   that statement right after it opens the handle, so this fails the n-th reader open and no other statement.
//   `ccrc history status` opens three readers, in order: measureStoreFacts' (n=1), the envelope's readStore
//   (n=2) and the health extras' readStoreExtras (n=3). n=3 makes the status read succeed and only the extras'
//   open fail (readStoreExtras' `store` arm).
import { syncBuiltinESMExports as syncF28 } from 'node:module';
import { DatabaseSync as DatabaseSyncF28 } from 'node:sqlite';
{
  const nthF28 = Number(process.env.HISTORY_TEST_FAIL_QUERY_ONLY ?? '0');
  if (Number.isInteger(nthF28) && nthF28 > 0) {
    const protoF28 = DatabaseSyncF28.prototype;
    const realExecF28 = protoF28.exec;
    let seenF28 = 0;
    protoF28.exec = function execF28(sql) {
      if (/^\s*PRAGMA\s+query_only\s*=\s*ON\b/i.test(String(sql)) && (seenF28 += 1) === nthF28) {
        throw Object.assign(new Error('injected reader-open failure (test preload)'), { code: 'ERR_SQLITE_ERROR' });
      }
      return realExecF28.call(this, sql);
    };
    syncF28();
  }
}

// ── FU4 M30: a status read that throws something other than SQLite's own error ──────────────────────
// HISTORY_TEST_THROW_PREPARE=<kind>@<substring>: preparing a statement whose SQL contains <substring> throws. <kind> is
//   `TypeError`  a plain TypeError, with no `code` — a programming defect in the reader, which `readStoreAnswered`
//                (cli.mjs) must let escape as exit 1 rather than answer as a store word, or
//   `StoreError:<word>`  a store.mjs StoreError carrying <word> (the reader's open refused), which it answers as that word.
//   Every other statement runs for real. The substring is chosen past the binding read, so only readStore meets it.
import { syncBuiltinESMExports as syncM30 } from 'node:module';
import { DatabaseSync as DatabaseSyncM30 } from 'node:sqlite';
{
  const specM30 = process.env.HISTORY_TEST_THROW_PREPARE ?? '';
  const atM30 = specM30.indexOf('@');
  if (atM30 > 0) {
    const kindM30 = specM30.slice(0, atM30);
    const needleM30 = specM30.slice(atM30 + 1);
    // Imported here, never at the top: a preload that merely loads must not evaluate store.mjs before the patches above.
    const { StoreError: StoreErrorM30 } = await import('../../../../ccd/history/store.mjs');
    const protoM30 = DatabaseSyncM30.prototype;
    const realPrepareM30 = protoM30.prepare;
    protoM30.prepare = function prepareM30(sql) {
      if (needleM30 !== '' && String(sql).includes(needleM30)) {
        if (kindM30 === 'TypeError') throw new TypeError('fixture-planted');
        if (kindM30.startsWith('StoreError:')) throw new StoreErrorM30(kindM30.slice('StoreError:'.length), 'injected store refusal (test preload)');
        throw new Error(`preload-faults: HISTORY_TEST_THROW_PREPARE kind ${kindM30} is not TypeError or StoreError:<word>`);
      }
      return realPrepareM30.call(this, sql);
    };
    syncM30();
  }
}
