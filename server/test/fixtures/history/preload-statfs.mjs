// server/test/fixtures/history/preload-statfs.mjs — TEST-ONLY: the free-space
// probe a spawned history child sees (spec 2026-10-05 §10.1 "Seams", §9.3).
// Every sweep, shim and status spawn carries it (historyHelpers' runSweep and
// runShim add it by default), so the free space of the box running the suite
// never decides a test. NEVER shipped; nothing under ccd/ reads its variable.
//
// HISTORY_TEST_STATFS =
//   plenty            4 TiB free of 8 TiB (the default)
//   hang              a probe that never settles (a dead volume, O28)
//   throw             a probe that fails with EIO
//   <bavail>:<size>   that many bytes free of a filesystem that size (O19)
// The real `statfs` runs first in every answering mode, so a dangling db/
// link still answers ENOENT — the sweep tells dangling from absent by it.
//
// Later tasks append their own blocks below this one (Task 19's per-call
// answer, Task 26's /etc/claude-code containment, Task 27's stat hang).
// Task 19's block reuses this file's top-level `fs`, `real`, `answer` and
// `syncBuiltinESMExports`, so those four names stay as they are; a block that
// imports anew binds names of its own.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const mode = process.env.HISTORY_TEST_STATFS ?? 'plenty';
const fixed = /^([0-9]+):([0-9]+)$/.exec(mode);
if (!fixed && !['plenty', 'hang', 'throw'].includes(mode)) {
  throw new Error(`preload-statfs: HISTORY_TEST_STATFS=${mode} is not plenty, hang, throw or <bavail>:<size>`);
}
const real = fs.promises.statfs;
const answer = (bavail, size) => ({ type: 0, bsize: 1, blocks: size, bfree: bavail, bavail, files: 0, ffree: 0 });
fs.promises.statfs = async function statfs(p, opts) {
  if (mode === 'hang') return new Promise(() => {});
  if (mode === 'throw') throw Object.assign(new Error(`EIO: i/o error, statfs '${p}'`), { code: 'EIO' });
  await real(p, opts);
  return fixed ? answer(Number(fixed[1]), Number(fixed[2])) : answer(4 * 2 ** 40, 8 * 2 ** 40);
};
syncBuiltinESMExports();

// ── Task 19: an answer that changes during the pass (§9.3, BK17: the probe before each chunk) ─────────────────
// HISTORY_TEST_STATFS_AFTER=<n>:<bavail>:<size>: the first <n> statfs calls answer as HISTORY_TEST_STATFS says;
// every later call answers <bavail> bytes free of a <size>-byte filesystem. A scheduled pass probes once before it
// opens the DB, so n=1 lets the pass start and puts every per-chunk probe below the floor.
{
  const afterF19 = /^([0-9]+):([0-9]+):([0-9]+)$/.exec(process.env.HISTORY_TEST_STATFS_AFTER ?? '');
  if (afterF19) {
    const innerF19 = fs.promises.statfs;
    let callsF19 = 0;
    fs.promises.statfs = async function statfsAfterF19(p, opts) {
      callsF19 += 1;
      if (callsF19 <= Number(afterF19[1])) return innerF19(p, opts);
      await real(p, opts);
      return answer(Number(afterF19[2]), Number(afterF19[3]));
    };
    syncBuiltinESMExports();
  }
}

// ── Task 26: the host's managed settings, hidden (the census's /etc read, §9.15) ──────────────────────
// The periodic census reads Claude Code's managed-settings file and its drop-in directory under
// /etc/claude-code, and every store's first pass runs a census. So that the box running the suite never decides
// a retention (or, unreadable, a retention_unmeasured WARN), any read of /etc/claude-code or a path under it
// answers ENOENT, as on a box with no managed settings. The census's settings reads open through store.mjs's `readBounded`
// (openSync, D-4347), the drop-in directory through readdirSync and an older read through readFileSync, so all three are hidden. O38's cases inject fixture paths through the run-pass
// driver instead. HISTORY_TEST_MANAGED_REAL=1 lets the real files through; only the read-spy CONTROL in history-op.test.ts sets it, and historyHelpers'
// scrubbedEnv drops every inherited HISTORY_TEST_* variable.
import fsM26 from 'node:fs';
import { syncBuiltinESMExports as syncM26 } from 'node:module';
{
  if (process.env.HISTORY_TEST_MANAGED_REAL !== '1') {
    const managedM26 = (p) => typeof p === 'string' && (p === '/etc/claude-code' || p.startsWith('/etc/claude-code/'));
    const goneM26 = (p, syscall) => Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`),
      { code: 'ENOENT', errno: -2, syscall, path: p });
    const realReadFileM26 = fsM26.readFileSync;
    const realReaddirM26 = fsM26.readdirSync;
    const realOpenM26 = fsM26.openSync;
    fsM26.readFileSync = function readFileSyncM26(p, ...rest) {
      if (managedM26(p)) throw goneM26(p, 'open');
      return realReadFileM26.call(fsM26, p, ...rest);
    };
    fsM26.readdirSync = function readdirSyncM26(p, ...rest) {
      if (managedM26(p)) throw goneM26(p, 'scandir');
      return realReaddirM26.call(fsM26, p, ...rest);
    };
    fsM26.openSync = function openSyncM26(p, ...rest) {
      if (managedM26(p)) throw goneM26(p, 'open');
      return realOpenM26.call(fsM26, p, ...rest);
    };
    syncM26();
  }
}

// ── Task 27: a stat that never settles (the CLI's 2 s reachability bound, §8.1) ──────────────────────
// HISTORY_TEST_STAT_HANG=<substring>: fs.promises.stat of any path containing <substring> returns a promise
// that never settles — a dead volume as the CLI's asynchronous stat meets it. Everything else stats normally.
import fsS27 from 'node:fs';
import { syncBuiltinESMExports as syncS27 } from 'node:module';
{
  const hang = process.env.HISTORY_TEST_STAT_HANG ?? '';
  if (hang !== '') {
    const realStat = fsS27.promises.stat;
    fsS27.promises.stat = (p, ...rest) => (String(p).includes(hang) ? new Promise(() => {}) : realStat(p, ...rest));
    syncS27();
  }
}
