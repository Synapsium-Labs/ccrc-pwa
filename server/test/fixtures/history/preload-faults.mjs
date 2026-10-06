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
