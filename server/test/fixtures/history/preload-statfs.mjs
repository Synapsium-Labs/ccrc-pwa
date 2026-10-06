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
