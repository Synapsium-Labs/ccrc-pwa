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
//   snapshotAtFirstStatfs
//                      [{rel, to}]: when the pass's FIRST statfs call answers, `$HOME/<rel>` is copied to `$HOME/<to>`, or `to` holds
//                      the word `absent` when there is no such file (D-5016: the scheduled pass's marker, seen from INSIDE the pass,
//                      which has written it before its first probe and removes it at its end); `<to>.mode` holds its octal mode)
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
//   extraMigrations    SQL run as v2, v3, ... over the v1 DDL alone (the migration seam, DM42/DM43): a build whose v2 is the seam,
//                      standing in for the real v2 (D-5015: the owed-row index and the rest of V2_INDEXES). A store the real code just
//                      made carries those indexes and reads user_version = SCHEMA_VERSION, so the driver first REWINDS such a store to
//                      v1 (drops every V2_INDEXES index, stamps 1): the store the seam migrates is then the v1 store these cases were
//                      written for. A store the seam already migrated carries none of them and is left alone.
//                      THE TRAP, and why the driver refuses it: a pass on a HOME with NO store creates one, and createStore stamps the
//                      REAL SCHEMA_VERSION with the real indexes, so a seam of one migration (code version 2) would find the store
//                      already at its version and never run, and the case would pass having tested nothing. So a seamed pass on a HOME
//                      with no store THROWS here, loudly. Make the store first (createStore, a pass without the seam, or a helper).
//   heavy              the versions among those that SCHEMA_ADDED marks heavy
//   managedSettings    the managed-settings list the census reads instead of /etc (Task 26)
//   budgetMs, budgetBytes, chunkBytes  the run budget's limits, handed to sweep.mjs as deps.budget (W1-B2 Task 25)
//   eioOnRead          a path suffix: every fs.readSync on a descriptor whose /proc/self/fd target ends with it throws EIO (D-4340's
//                      read error on one admitted copy, the FR2-d injection of history-ingest.test.ts, here in a spawned pass: the
//                      faults preload has no read event). Armed before the pass starts; nothing else reads through that file.
//   parserCrashOn      a text: a sha256 hash fed bytes that hold it throws, so the transcript parser (prepareLines hashes each
//                      row's canonical body) crashes on the chunk that holds the text, and ingestFile counts parser_crash and
//                      holds the cursor (D-5061's crash arm). Armed before the pass starts; the first line of a file is hashed
//                      for its head sha, so the text must not sit in it.
// argv after the script is runPass's argv, exactly as the shim would pass it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { runPass } from '../../../../ccd/history/sweep.mjs';
import { MIGRATIONS, V2_INDEXES, closeWriter, openWriter, userVersion } from '../../../../ccd/history/store.mjs';
import { SCHEMA_ADDED, SCHEMA_VERSION, historyPaths } from '../../../../ccd/history/lib.mjs';

const spec = JSON.parse(process.env.HISTORY_TEST_DEPS ?? '{}');
const deps = {};
if (spec.offsetMs !== undefined || spec.stepMs !== undefined) {
  let k = 0;
  deps.now = () => Date.now() + (spec.offsetMs ?? 0) + (k++) * (spec.stepMs ?? 0);
}
if (Array.isArray(spec.extraMigrations) && spec.extraMigrations.length > 0) {
  const dbFile = historyPaths(process.env.HOME).dbFile;
  if (!fs.existsSync(dbFile)) {
    throw new Error(`run-pass: extraMigrations needs a store already on disk at ${dbFile}; a pass that creates one stamps it with the real schema, so the seam's migration would never run and the case would pass vacuously`);
  }
  // Through store.mjs's own open (this fixture's ring forbids node:sqlite); a store that open refuses is left for the pass to refuse.
  let db = null;
  try { db = openWriter(dbFile); } catch { /* not ours to rewind */ }
  if (db !== null) {
    try {
      const present = (name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) !== undefined;
      if (userVersion(db) === SCHEMA_VERSION && V2_INDEXES.every(present)) {
        for (const name of V2_INDEXES) db.exec(`DROP INDEX ${name}`);
        db.exec('PRAGMA user_version = 1');
      }
    } finally { closeWriter(db); }
  }
  deps.migrations = [MIGRATIONS[0], ...spec.extraMigrations];
  const added = { 1: SCHEMA_ADDED[1] };
  let prev = SCHEMA_ADDED[1].tables;
  spec.extraMigrations.forEach((_, i) => {
    const v = 1 + i + 1;
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
if (Array.isArray(spec.afterFirstStatfs) || spec.throwTimesAfterFirstStatfs !== undefined || Array.isArray(spec.snapshotAtFirstStatfs)) {
  let fired = false;
  const armed = spec.throwTimesAfterFirstStatfs;
  deps.statfs = async (p) => {
    const r = await fs.promises.statfs(p);
    if (!fired) {
      fired = true;
      for (const w of spec.snapshotAtFirstStatfs ?? []) {
        const from = path.join(process.env.HOME, w.rel);
        fs.writeFileSync(path.join(process.env.HOME, w.to), fs.existsSync(from) ? fs.readFileSync(from) : 'absent');
        fs.writeFileSync(path.join(process.env.HOME, `${w.to}.mode`), fs.existsSync(from) ? (fs.statSync(from).mode & 0o777).toString(8) : 'absent');
      }
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
// W1-B2 Task 25: budgetMs, budgetBytes, chunkBytes — the run budget's limits (B1's newBudget maxMs, maxBytes
// and chunkBytes), so a test can build a recovery larger than one pass. sweep.mjs's passCtx reads them as
// deps.budget, an injected dependency (slug history-test-seams-not-env); an absent field keeps lib's default.
if (spec.budgetMs !== undefined || spec.budgetBytes !== undefined || spec.chunkBytes !== undefined) {
  deps.budget = { maxMs: spec.budgetMs, maxBytes: spec.budgetBytes, chunkBytes: spec.chunkBytes };
}
if (typeof spec.eioOnRead === 'string') {
  const realReadSync = fs.readSync;
  const err = Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO', errno: -5, syscall: 'read' });
  fs.readSync = function readSync(fd, ...rest) {
    let target = '';
    try { target = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { /* a closed descriptor or no /proc: not ours */ }
    if (target.endsWith(spec.eioOnRead)) throw err;
    return realReadSync.call(this, fd, ...rest);
  };
  syncBuiltinESMExports();
}
if (typeof spec.parserCrashOn === 'string') {
  const needle = Buffer.from(spec.parserCrashOn, 'utf8');
  const realCreateHash = crypto.createHash;
  crypto.createHash = function createHash(...args) {
    const h = realCreateHash.apply(this, args);
    const realUpdate = h.update;
    h.update = function update(data, ...rest) {
      if (Buffer.from(data).includes(needle)) throw new Error('injected parser bug');
      return realUpdate.call(this, data, ...rest);
    };
    return h;
  };
  syncBuiltinESMExports();
}
const code = await runPass(process.argv.slice(2), deps);
// An explicit exit, never a drained loop: an unsettled statfs (the 'hang' seam) pins a libuv thread.
process.stdout.write('', () => process.exit(code));
