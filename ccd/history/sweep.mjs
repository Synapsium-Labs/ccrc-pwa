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
import fs, {
  closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync,
  realpathSync, statSync, unlinkSync, writeSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  CARRIER_KILL_S, EXIT, SCHEMA_ADDED, SCHEMA_VERSION, STATFS_DEADLINE_MS, capOf, decideStoreOpen, floorThreshold,
  UUID_RE, WRITER_RE, historyPaths, journalRecord, passOutcome, planMigration, planRun, readBoxEnvValue,
} from './lib.mjs';
import {
  StoreError, bump, closeWriter, createStore, dropPending, finishPending, getMeta, measureStoreFacts, openReader,
  openWriter, readAttempts, removeStaleTemps, syncWriterMirror, userVersion, withTx,
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

// ── The journal (spec §9.14) ──────────────────────────────────────────────────────────────────────────────
//
// The second copy of what only the store holds: drained spool lines, the verdicts taken from registry state or an
// operator's argument, learned redaction pairs and tick records (D-4227, slug history-spool-journal-retained). It follows
// coord.db's doctrine, "the markdown ledger stays the disaster-recovery ground truth" (server/src/coord/db.ts:110).
// - It is append-only and sits in the real root on the home filesystem, never under db/, so a volume lost with the
//   store leaves it.
// - There is one file per UTC month and writer token, journal/<store_id>/<YYYY-MM>.<writer>.jsonl (slug
//   history-journal-writer-token; D-4226), so two boxes that ran one store in turn never write the same name.
// - The caller reads the token into `ids` from ~/.ccrc/history/store.writer only (D-4220, slug history-store-writer-file),
//   never from meta. The journal half must be able to name its file exactly when the DB is missing or must not be
//   opened.
// - Only this sweep writes here, under the shim's flock.

/** A journal append, its fsync, or a month file's creation that did not complete. The caller keeps the draining
 *  file in `.draining/` and runs no drain transaction for it (§9.2 "Journal first"). A verdict stays in the outbox.
 *  `code` is a closed word ('bad-name' | 'short-write' | 'append-failed'), never an OS message. */
export class JournalError extends Error {
  constructor(code, cause) {
    super(`journal: ${code}`, cause === undefined ? undefined : { cause });
    this.name = 'JournalError';
    this.code = code;
  }
}

const MONTH_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** The UTC month an append at `ms` lands in, 'YYYY-MM'. UTC, so a box's timezone never splits one month in two. */
export function monthOf(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The one place a journal file's name is spelled. The guard matters: `storeId` and `writer` become path segments,
 *  and a value that is not a store id or a writer token must never name a file. A `..` would leave the store's own
 *  directory. */
export function journalFilePath(home, storeId, writer, month) {
  if (!UUID_RE.test(storeId) || !WRITER_RE.test(writer) || !MONTH_RE.test(month)) throw new JournalError('bad-name');
  return `${historyPaths(home).journalDir}/${storeId}/${month}.${writer}.jsonl`;
}

/** fsync a directory, so a link(), rename or unlink inside it survives a power loss. */
export function fsyncDir(dir) {
  const fd = openSync(dir, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** A month file is born holding its `head` (rev 3.2 review, DI14):
 *  - the head goes into a fsynced temp;
 *  - the temp is link()ed to the month's name;
 *  - the directory is fsynced.
 *  So wherever a kill lands, the month file either does not exist or opens with its head. A temp left by a killed
 *  pass is removed first. Its name starts with a dot and ends in `.tmp`, so nothing that lists `*.jsonl` ever reads
 *  it. */
function createMonthFile(dir, file, ids, month, nowMs) {
  for (const n of readdirSync(dir)) {
    if (n.startsWith(`.${month}.${ids.writer}.jsonl.`) && n.endsWith('.tmp')) unlinkSync(`${dir}/${n}`);
  }
  const tmp = `${dir}/.${month}.${ids.writer}.jsonl.${process.pid}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    const head = Buffer.from(`${journalRecord('head', nowMs, { store_id: ids.storeId, month, writer: ids.writer })}\n`, 'utf8');
    if (writeSync(fd, head) !== head.length) throw new JournalError('short-write');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  linkSync(tmp, file);
  unlinkSync(tmp);
  fsyncDir(dir);
}

/** Append `lines` (each one record, with no newline) to this month's file for this store and writer, in ONE write,
 *  then fsync.
 *  - A torn last line: if the file's last byte is not `\n` (a short write under a full filesystem), the same write
 *    adds `\n` first. That is an append, never a rewrite, so the torn line stays one malformed line that replay
 *    skips, and the next record starts clean (§9.14 "A torn last line", RC4).
 *  - Modes are explicit (0700 directories, 0600 files), so an inherited umask never decides them.
 *  - Any failure throws JournalError. It never retries by itself. */
export function appendJournal(home, ids, lines, nowMs) {
  const month = monthOf(nowMs);
  const file = journalFilePath(home, ids.storeId, ids.writer, month);
  if (lines.length === 0) return;
  const dir = `${historyPaths(home).journalDir}/${ids.storeId}`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!existsSync(file)) createMonthFile(dir, file, ids, month, nowMs);
    const fd = openSync(file, 'a+', 0o600);
    try {
      let lead = '';
      const size = fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) lead = '\n';
      }
      const buf = Buffer.from(`${lead}${lines.map((l) => `${l}\n`).join('')}`, 'utf8');
      if (writeSync(fd, buf) !== buf.length) throw new JournalError('short-write');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    if (e instanceof JournalError) throw e;
    throw new JournalError('append-failed', e);
  }
}

// ── The outbox (§9.14 "The order of writes"; D-4225, slug history-journal-outbox) ─────────────────────────────────
// A verdict is inserted into journal_outbox under synchronous=FULL, in the transaction that makes it. It reaches the
// journal through here: appended and fsynced as one block, and only then deleted. A crash between the two leaves the
// rows, and the next tick appends them again before anything else. That costs a duplicate record, which replay
// absorbs; it never loses one.

/** Append every outbox row, in seq order, as one journal block. Returns the highest seq appended (0 when none) and
 *  how many rows. The caller deletes them only after whatever must follow the append has happened (a drain's
 *  unlink, §9.14 steps 5 and 6). */
export function appendOutbox(db, home, ids, nowMs) {
  const rows = db.prepare('SELECT seq, rec FROM journal_outbox ORDER BY seq').all();
  if (rows.length === 0) return { upto: 0, count: 0 };
  appendJournal(home, ids, rows.map((r) => r.rec), nowMs);
  return { upto: rows[rows.length - 1].seq, count: rows.length };
}

/** Delete the outbox rows that a journal append already holds. */
export function deleteOutbox(db, uptoSeq) {
  if (uptoSeq <= 0) return;
  withTx(db, 'NORMAL', () => { db.prepare('DELETE FROM journal_outbox WHERE seq <= ?').run(uptoSeq); });
}

/** Append and fsync, then delete. Used for a later confirmation, for a mapping, and as the tick's own first act
 *  (§9.2 "First, the outbox"). Returns how many rows reached the journal. A failed append throws JournalError with
 *  every row still in the outbox. */
export function flushOutbox(db, home, ids, nowMs) {
  const out = appendOutbox(db, home, ids, nowMs);
  deleteOutbox(db, out.upto);
  return out.count;
}

/** A counter bumped outside any other transaction. A database too busy to take it now is no reason to fail the pass
 *  that noticed: the condition it counts recurs, and so does the count. */
export function countOutside(db, name) {
  try { withTx(db, 'NORMAL', () => bump(db, name)); } catch { /* recounted on the next tick that meets it */ }
}

/**
 * What one tick of a bound, open store carries. runPass builds it; tick and the steps below read it.
 * @typedef {object} TickCtx
 * @property {string} home  the HOME this pass serves
 * @property {object} paths  historyPaths(home) (Task 14; its tick reads `ctx.paths.spool`)
 * @property {object} parsed  parseSweepArgv's result (Task 14; its tick reads `ctx.parsed.rosterUnreadable`)
 * @property {{storeId: string, writer: string} | null} ids  store.id and store.writer as read from the home
 *   filesystem after the create/finish step (§9.14: never from meta); null when either is not a readable value of
 *   its grammar
 * @property {() => number} now  deps.now ?? Date.now
 * @property {string[]} homes  the rostered homes the shim passed after `--`
 * @property {boolean} rosterUnreadable  the shim passed --roster-unreadable
 * @property {(line: string) => void} out  the outcome-line printer (deps.out ?? one console.log line)
 * @property {string[]} [hints]  set by the drain: sids of this tick's fresh spool lines
 * @property {object[]} [planned]  set by Task 18's discovery step: the files bound this tick (Task 19's ingest
 *   discovers and binds per path instead, and leaves it unset)
 */
/** The bound store's tick (§9.2), handed an open writer connection. Steps are
 *  added here in §9.2's order by the tasks that ship them; what it runs now:
 *  - spool/ exists from a bound store's first tick on: the hook's gate is that
 *    directory, and the hook never makes it (§5.1), so a box with no bound
 *    store — Darwin, a server, a refused store — spools nothing;
 *  - an unreadable roster is counted, once per pass (FE4, O54). */
export async function tick(db, ctx) {
  // >>> history tick steps (spec §9.2; D-4224, slug history-tick-order) ──────────────────────────────────────────
  // First, the outbox. Verdict rows a crash left behind reach the journal before anything else, outside the run
  // budget. With no writer token the journal cannot be named, so the rows wait in the DB and nothing is lost.
  if (ctx.ids !== null) {
    try {
      flushOutbox(db, ctx.home, ctx.ids, ctx.now());
    } catch (e) {
      if (!(e instanceof JournalError)) throw e;
      countOutside(db, 'journal_write_failed');
    }
  }
  // <<< history tick steps
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
      // The journal's two names, read from the home filesystem AFTER the create/finish step, never from meta
      // (§9.14; D-4220, slug history-store-writer-file). `facts` cannot supply them: it was measured before
      // finishPending, when only store.id.pending held the id, so on the finish-pending arm it names no store.
      const token = (p, re) => {
        try { const v = readFileSync(p, 'utf8').trim(); return re.test(v) ? v : null; } catch { return null; }
      };
      const sid = token(P.storeId, UUID_RE);
      const writer = token(P.writer, WRITER_RE);
      const ids = sid !== null && writer !== null ? { storeId: sid, writer } : null;
      await tick(db, {
        home, paths: P, parsed, plan, free, now,
        ids, homes: parsed.homes, rosterUnreadable: parsed.rosterUnreadable, out,
      });
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
