// server/test/fixtures/history/run-pass.mjs — TEST-ONLY. Runs ccd/history/sweep.mjs's runPass in this
// process with injected dependencies: spec 2026-10-05 §10.1 "Seams", "L3 and L4 faults in a spawned
// process are injected ... by in-process imports with injected dependencies". sweep.mjs itself reads no
// seam (D-4247, slug history-test-seams-not-env): this file is the ONLY reader of HISTORY_TEST_DEPS, and it is
// never shipped (server/test lies outside the release PATHSPEC, deploy/build-release.sh:103-106).
//
// HISTORY_TEST_DEPS is one JSON object:
//   offsetMs, stepMs   the pass clock: Date.now() + offsetMs + k * stepMs on its k-th read (k from 0)
//   sizeBytes          the store's measured size, whatever the file holds (the cap's seam, O10)
//   sizeBytesSeq       the k-th measureSize call answers sizeBytesSeq[k], and the last value stands after that (RF5a F15: a size
//                      that grows between an import's windows)
//   afterFirstStatfs   [{rel, text}]: after the pass's FIRST statfs call answers, each `text` is appended to `$HOME/<rel>` (its
//                      directory made 0700), as a hook landing a line mid-pass would (RF5a F19). For an --op pass the first call
//                      is the probe right after the lock-take journal half
//   hangAfterAppend    true: the first statfs call, after appending afterFirstStatfs's lines, never settles (a dead volume the
//                      line landed before, FU4 M27); the pass's own bounded probe then answers store-unreachable
//   throwTimesAfterFirstStatfs
//                      {fn, needle, code, times?}: once the first statfs call has answered, the first <times> (default 1) calls
//                      of node:fs's sync function <fn> on a path containing <needle> throw an error carrying <code> (FU4 M26:
//                      a non-JournalError out of the half at release; a second run of the half meets the fault again); every
//                      later call runs for real
//   throwTimesAtStart  {fn, needle, code, times?}: the same throw, armed before the pass starts (FU8: a 000 spool/.draining is
//                      refused now, never thrown, so FR2-c's throw out of the journal half at lock take is injected)
//   openStoreWord      the word an --op pass's store open answers instead of opening (FU4 M28: a word whose REASONS code is
//                      not exit 5), handed to sweep.mjs as deps.openStore
//   extraMigrations    SQL appended to MIGRATIONS as v2, v3, ... (the migration seam, DM42/DM43)
//   heavy              the versions among those that SCHEMA_ADDED marks heavy
//   managedSettings    the managed-settings list the census reads instead of /etc (Task 26)
// argv after the script is runPass's argv, exactly as the shim would pass it.
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { runPass } from '../../../../ccd/history/sweep.mjs';
import { MIGRATIONS } from '../../../../ccd/history/store.mjs';
import { SCHEMA_ADDED } from '../../../../ccd/history/lib.mjs';

const spec = JSON.parse(process.env.HISTORY_TEST_DEPS ?? '{}');
const deps = {};
if (spec.offsetMs !== undefined || spec.stepMs !== undefined) {
  let k = 0;
  deps.now = () => Date.now() + (spec.offsetMs ?? 0) + (k++) * (spec.stepMs ?? 0);
}
if (Array.isArray(spec.extraMigrations) && spec.extraMigrations.length > 0) {
  deps.migrations = [...MIGRATIONS, ...spec.extraMigrations];
  const added = { ...SCHEMA_ADDED };
  let prev = SCHEMA_ADDED[MIGRATIONS.length].tables;
  spec.extraMigrations.forEach((_, i) => {
    const v = MIGRATIONS.length + i + 1;
    const tables = { ...prev, [`seam_v${v}`]: ['x'] };   // additive, as every real migration must be
    added[v] = { heavy: (spec.heavy ?? []).includes(v), tables };
    prev = tables;
  });
  deps.schemaAdded = added;
}
if (typeof spec.sizeBytes === 'number') deps.measureSize = () => spec.sizeBytes;
if (Array.isArray(spec.sizeBytesSeq)) { let k = 0; deps.measureSize = () => spec.sizeBytesSeq[Math.min(k++, spec.sizeBytesSeq.length - 1)]; }
if (Array.isArray(spec.managedSettings)) deps.managedSettings = spec.managedSettings;
if (typeof spec.openStoreWord === 'string') deps.openStore = () => ({ word: spec.openStoreWord });
if (Array.isArray(spec.afterFirstStatfs) || spec.throwTimesAfterFirstStatfs !== undefined) {
  let fired = false;
  const armed = spec.throwTimesAfterFirstStatfs;
  deps.statfs = async (p) => {
    const r = await fs.promises.statfs(p);
    if (!fired) {
      fired = true;
      for (const w of spec.afterFirstStatfs ?? []) {
        const f = path.join(process.env.HOME, w.rel);
        fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
        fs.appendFileSync(f, w.text);
      }
      if (armed !== undefined) {
        const real = fs[armed.fn];
        let thrown = 0;
        fs[armed.fn] = function throwTimes(...args) {
          if (thrown < (armed.times ?? 1) && String(args[0]).includes(armed.needle)) {
            thrown += 1;
            throw Object.assign(new Error(`${armed.code}: injected, ${armed.fn} '${args[0]}'`), { code: armed.code });
          }
          return real.apply(this, args);
        };
        syncBuiltinESMExports();
      }
      if (spec.hangAfterAppend === true) return new Promise(() => {});
    }
    return r;
  };
}
if (spec.throwTimesAtStart !== undefined) {
  const at = spec.throwTimesAtStart;
  const real = fs[at.fn];
  let thrown = 0;
  fs[at.fn] = function throwTimesAtStart(...args) {
    if (thrown < (at.times ?? 1) && String(args[0]).includes(at.needle)) {
      thrown += 1;
      throw Object.assign(new Error(`${at.code}: injected, ${at.fn} '${args[0]}'`), { code: at.code });
    }
    return real.apply(this, args);
  };
  syncBuiltinESMExports();
}
const code = await runPass(process.argv.slice(2), deps);
// An explicit exit, never a drained loop: an unsettled statfs (the 'hang' seam) pins a libuv thread.
process.stdout.write('', () => process.exit(code));
