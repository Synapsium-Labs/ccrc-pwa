// server/test/fixtures/history/preload-readspy.mjs
// TEST-ONLY, never shipped. A read spy: it records every string path handed to fs.readFileSync, fs.readdirSync or
// fs.openSync as one `<fn> <path>` line appended to the file named by $HISTORY_TEST_READSPY, and is inert when that
// variable is unset or empty. It is loaded BEFORE preload-statfs.mjs, so that preload's `/etc/claude-code` seam (Task 26)
// wraps this spy: a path the seam hides never reaches it, on any host, and the spy's record is how a case SEES the seam
// working (review 316 F30). The spy never records, and never re-enters on, its own appends.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const out = process.env.HISTORY_TEST_READSPY ?? '';
if (out !== '') {
  const realRead = fs.readFileSync; const realDir = fs.readdirSync; const realOpen = fs.openSync; const append = fs.appendFileSync;
  let busy = false;   // the spy's own append never re-enters it
  const note = (fn, p) => { if (busy || typeof p !== 'string' || p === out) return; busy = true; try { append(out, `${fn} ${p}` + String.fromCharCode(10)); } finally { busy = false; } };
  fs.readFileSync = function readFileSyncSpy(p, ...rest) { note('readFileSync', p); return realRead.call(fs, p, ...rest); };
  fs.readdirSync = function readdirSyncSpy(p, ...rest) { note('readdirSync', p); return realDir.call(fs, p, ...rest); };
  fs.openSync = function openSyncSpy(p, ...rest) { note('openSync', p); return realOpen.call(fs, p, ...rest); };
  syncBuiltinESMExports();
}
