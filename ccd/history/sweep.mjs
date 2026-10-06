// ccd/history/sweep.mjs — the history store's writer (L4 delivery, spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §5.1,
// §9.2): one pass, run by the bash shim ccd/ccd-history-sweep under its flock,
// on the 2-minute timer or from the operator's shell with `--op <verb>`.
//
// IT DELIVERS, IT DOES NOT DECIDE. Every verdict comes from lib.mjs (L1) over
// facts this file and store.mjs measure: `decideStoreOpen` (create, open,
// finish a pending creation, or refuse), `planMigration` and `planRun` (run,
// hold or pause), `passOutcome` (the word and exit of a pass that does not
// tick). The shim is the ONLY lock taker (RV13): this file never takes a lock,
// and it is never run except under the shim's — a direct run is a test's.
//
// THE ORDER OF A PASS, up to the tick:
//   history-off → role (CCRC_ROLE in ~/.ccrc/ccrc.env, readBoxEnvValue) →
//   the free-space probe on db/ (async, STATFS_DEADLINE_MS: a dead volume is a
//   pause BEFORE any synchronous read under db/ can block, RR15) → the store
//   facts → decideStoreOpen → stale temps → the stored version and
//   planMigration → planRun → create / finish / open → `tick`.
// `tick` is the bound store's whole tick (§9.2's order;
// D-4224); each later step is added there, and nothing above it
// changes for that.
//
// Reads exactly one environment variable, HOME, in `runPass` below
// (`deps.home ?? process.env.HOME`, integration contract 4) — the frozen
// allow-list single-definition.test.ts pins; tests reach every fault through a
// test-only preload, never a variable this file reads (§10.1 "Seams").
import fs, { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  CARRIER_KILL_S, EXIT, SCHEMA_ADDED, SCHEMA_VERSION, STATFS_DEADLINE_MS, capOf, decideStoreOpen, floorThreshold,
  historyPaths, passOutcome, planMigration, planRun, readBoxEnvValue,
} from './lib.mjs';
import {
  StoreError, bump, closeWriter, createStore, dropPending, finishPending, getMeta, measureStoreFacts, openReader,
  openWriter, readAttempts, removeStaleTemps, syncWriterMirror, userVersion,
} from './store.mjs';

const USAGE = 'usage: sweep.mjs [--op <verb> <op-args...>] [--roster-unreadable] --secrets <file...> -- <home...>';

/** The shim's argv, exactly: `[--op <verb> <op-args…>] [--roster-unreadable]
 *  --secrets <file…> -- <home…>` (§5.1 step 5). An op's arguments run up to the
 *  first `--roster-unreadable` or `--secrets`. Anything else is `bad-args`. */
export function parseSweepArgv(argv) {
  let i = 0;
  let op = null;
  const opArgs = [];
  if (argv[0] === '--op') {
    op = argv[1] ?? '';
    if (!/^[a-z][a-z-]{0,31}$/.test(op)) return { error: 'bad-args' };
    i = 2;
    while (i < argv.length && argv[i] !== '--roster-unreadable' && argv[i] !== '--secrets') opArgs.push(argv[i++]);
  }
  let rosterUnreadable = false;
  if (argv[i] === '--roster-unreadable') { rosterUnreadable = true; i += 1; }
  if (argv[i] !== '--secrets') return { error: 'bad-args' };
  i += 1;
  const secrets = [];
  while (i < argv.length && argv[i] !== '--') secrets.push(argv[i++]);
  if (argv[i] !== '--') return { error: 'bad-args' };
  return { op, opArgs, rosterUnreadable, secrets, homes: argv.slice(i + 1) };
}

/** `fs.promises.statfs` raced against a deadline (§9.3; RR15;
 *  D-4187, D-4179). It FOLLOWS a
 *  db/ link, which is the point: the volume is what can be dead. `unsettled`
 *  means the probe never answered — its threadpool thread dies with the
 *  process, which the entry guard ends with `process.exit` rather than wait
 *  for it.
 *  `threw` (ENOENT on a dangling link, EIO) is reported apart: a dangling link
 *  is decided by the store facts, an erroring volume is a low-disk pause. */
export async function statfsWithDeadline(p, ms, statfs = (q) => fs.promises.statfs(q)) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'unsettled' }), ms); });
  const probe = Promise.resolve().then(() => statfs(p)).then(
    (s) => ({ state: 'ok', bytes: Number(s.bavail) * Number(s.bsize), fsSize: Number(s.blocks) * Number(s.bsize) }),
    () => ({ state: 'threw' }),
  );
  try {
    return await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The role this box records, read as doctor's `_check_skills` reads it: a
 *  regular readable file, one key, `_box_env_value`'s rules (readBoxEnvValue,
 *  pinned to it by O53). Absent or unreadable is "not server", as there. A
 *  server box never gets a store, even from a shim a re-role left behind
 *  (D-4222, D-4183). */
function recordedRole(ccrcEnv) {
  let text;
  try {
    if (!statSync(ccrcEnv).isFile()) return '';
    text = readFileSync(ccrcEnv, 'utf8');
  } catch {
    return '';
  }
  const r = readBoxEnvValue(text, 'CCRC_ROLE');
  return r.found ? r.value : '';
}

/** What the probe runs on: db/ itself when it exists (a link is followed by
 *  statfs), else the nearest existing ancestor — the filesystem a first
 *  creation will put db/ on. Every path here is on the home filesystem. */
function probeTarget(P, home) {
  for (const d of [P.dbDir, P.root, `${home}/.ccrc`, home]) {
    try { lstatSync(d); return d; } catch { /* the next one up */ }
  }
  return home;
}

/** The cap file's text, or null when absent. An unreadable file is the empty
 *  string — malformed, so the default applies and doctor WARNs (§9.3). */
function capText(capPath) {
  try { return readFileSync(capPath, 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? null : '';
  }
}

/** The bound store's tick (§9.2), handed an open writer connection. Steps are
 *  added here in §9.2's order by the tasks that ship them; what it runs now:
 *  - spool/ exists from a bound store's first tick on: the hook's gate is that
 *    directory, and the hook never makes it (§5.1), so a box with no bound
 *    store — Darwin, a server, a refused store — spools nothing;
 *  - an unreadable roster is counted, once per pass (FE4, O54). */
export async function tick(db, ctx) {
  mkdirSync(ctx.paths.spool, { recursive: true, mode: 0o700 });
  if (ctx.parsed.rosterUnreadable) bump(db, 'roster_unreadable');
}

/** One pass. Resolves to its exit code (§13's EXIT; a scheduled pass's 0/5 from
 *  `passOutcome`). The home is `deps.home` when a caller injects one (an
 *  in-process test passes its fixture HOME), else $HOME — this file's one read
 *  of the environment — and it must be an absolute path, or nothing is swept
 *  and the pass exits 1 (integration contract 4). */
export async function runPass(argv, deps = {}) {
  const home = deps.home ?? process.env.HOME;
  if (typeof home !== 'string' || !home.startsWith('/')) {
    process.stderr.write('history-sweep: HOME is not an absolute path; nothing was swept\n');
    return EXIT.INTERNAL;
  }
  const out = deps.out ?? ((line) => { process.stdout.write(`${line}\n`); });
  const now = deps.now ?? Date.now;
  const statfs = deps.statfs ?? ((p) => fs.promises.statfs(p));
  const prevUmask = process.umask(0o077);
  try {
    const parsed = parseSweepArgv(argv);
    if ('error' in parsed) {
      process.stderr.write(`history-sweep: ${USAGE}\n`);
      return 2;
    }
    if (parsed.op !== null) {
      // The --op verbs arrive with their gate (§8.4; D-4181,
      // D-4221); until a verb is wired, an op pass is
      // refused whole, before it reads or writes anything.
      out(JSON.stringify({ rc: 2, reason: 'bad-args' }));
      return 2;
    }
    const P = historyPaths(home);
    const say = (word) => { const o = passOutcome(word); out(`history-sweep: ${o.word}`); return o.exit; };

    // history-off first (§9.2): before the role, before any probe, before the DB.
    if (existsSync(P.off)) return say('off');
    const role = recordedRole(P.ccrcEnv);

    const free = await statfsWithDeadline(probeTarget(P, home), STATFS_DEADLINE_MS, statfs);
    // A probe that never settled leaves db/ unmeasurable without risking a
    // read that blocks for good on the dead volume: the pass ends here, with no
    // DB opened (§9.3, O28) — doctor reads the same condition from the CLI.
    // This is the pass's ONE statfs before its first ingest chunk; Task 19's
    // HISTORY_TEST_STATFS_AFTER=1:… case counts on exactly one.
    if (free.state === 'unsettled') return say('store-unreachable');

    const facts = measureStoreFacts(home, role);
    const store = decideStoreOpen(facts);
    if (store.act !== 'refuse') removeStaleTemps(home);

    let sizeBytes = 0;
    let migration = 'none';
    if (store.act === 'open' || store.act === 'finish-pending') {
      sizeBytes = statSync(P.dbFile).size + (existsSync(P.wal) ? statSync(P.wal).size : 0);
      let r;
      try {
        r = openReader(P.dbFile);
      } catch (e) {
        if (e instanceof StoreError) return say(e.word);
        throw e;
      }
      let stored;
      let copyBps = null;
      try {
        stored = userVersion(r);
        const bps = Number(getMeta(r, 'copy_bps'));
        if (Number.isFinite(bps) && bps > 0) copyBps = bps;
      } finally {
        r.close();
      }
      const fsSize = free.state === 'ok' ? free.fsSize : 0;
      migration = planMigration({
        stored, code: SCHEMA_VERSION, freeBytes: free.state === 'ok' ? free.bytes : 0,
        thresholdBytes: floorThreshold(fsSize), sizeBytes, boundS: CARRIER_KILL_S, copyBps,
        attempts: readAttempts(home, SCHEMA_VERSION), heavy: SCHEMA_ADDED[SCHEMA_VERSION]?.heavy ?? false,
      });
    }
    const plan = planRun({
      historyOff: false, store, free, sizeBytes, capGb: capOf(capText(P.cap)).gb, migration, recovering: false,
    });
    if (plan.arm === 'hold') return say(plan.holdWord);
    if (plan.arm !== 'run') return say('held');

    let finished = false;
    if (store.act === 'drop-pending-create') dropPending(home);
    if (store.act === 'create' || store.act === 'drop-pending-create') createStore(home);
    if (store.act === 'finish-pending') { finishPending(home); finished = true; }

    let db;
    try {
      db = openWriter(P.dbFile);
    } catch (e) {
      if (e instanceof StoreError) return say(e.word);
      throw e;
    }
    try {
      if (finished) bump(db, 'store_creation_completed');
      syncWriterMirror(db, home);
      await tick(db, { home, paths: P, parsed, plan, free, now });
    } finally {
      closeWriter(db);
    }
    return 0;
  } finally {
    process.umask(prevUmask);
  }
}

/** Run as a script (the shim's `exec node … sweep.mjs`), never on import.
 *  runPass resolves the home itself (from $HOME here); a throw is exit 1. */
async function main() {
  try {
    return await runPass(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`history-sweep: internal error: ${e && e.message ? e.message : String(e)}\n`);
    return EXIT.INTERNAL;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // The entry guard is ALWAYS the LAST statement of sweep.mjs, and nothing in
  // this file awaits at top level. main() runs while this module is still
  // evaluating (its synchronous part runs at the call), so a module-level
  // const declared below this guard would still be uninitialised when the
  // pass reads it: every block a later task adds to this file is inserted
  // ABOVE this guard, never appended after it.
  // The code is set as process.exitCode, and process.exit() then ends the
  // process with it, never a drained event loop: an unsettled statfs keeps a
  // threadpool request alive, and the pass must end at its deadline, not when
  // the volume answers (O28). main() turns a throw into exit 1 itself; the
  // .catch is the backstop for a rejection it could not report.
  main()
    .then((code) => { process.exitCode = code; process.exit(); })
    .catch(() => { process.exitCode = EXIT.INTERNAL; process.exit(); });
}
