// ccd/history/overlord-read.mjs — the Overlord's read of `ccrc history` over every project (Overlord W1, plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md, Task 3; spec 2026-11-09 §3.2, C47).
//
// The agent's `overlord-history` op runs this module in a worker thread (overlord-worker.mjs), never in the CLI: cli.mjs
// never imports it (overlord-read-scope.test.ts pins that), so no argv or environment can build the `overlord` scope.
// The residual is stated in the plan's Goal: any process of the same user can import this module with `node`.
//
// What it does, in the CLI read path's order (cli.mjs#readContextIn), with three differences:
//   1. it measures the store through read-context.mjs with the EMPTY role (ruled R1): it never reads a role, so it never
//      opens ~/.ccrc/ccrc.env;
//   2. its scope is `overlord`, built from the request's target, never decideScope's; the session's recall-off marker is
//      not consulted (question 7: this read is not that session's recall);
//   3. its belt is store-only (ruled F4): the pairs the sweep recorded in redact_hashes, never a secret file, so it
//      imports neither cli.mjs nor sweep.mjs and never reaches loadSecrets.
// It opens the store with openReader alone (read-only, query_only) and calls no writing form. Its answer is
// shared/overlordHistory.ts' OverlordHistoryAnswer: a `rows` answer carries exactly {exit, items, shown, total, scope}
// (ruled R3), every other outcome a closed word. Every answer passes redactFinalJson with the store-only belt. Every throw
// is caught: a store error is readFailure's word, anything else `internal`; a message reaches stderr only through
// errLine, which the agent drains and discards.
import {
  EXIT, SCHEMA_ADDED, historyPaths, decideCliStore, decideStatusRead, idOk, makePairIndex, redactFinalJson,
  parseReadArgs, parseGrepArgs, parseDescribeArgs, expandArgsOf,
} from './lib.mjs';
import { openReader, userVersion } from './store.mjs';
import { familiesOf, transcriptsOf, scopeJsonOf, runGrep, runDescribe, runExpand } from './recall.mjs';
import { measureReach, cliFactsOf, readFailure, recordedPairsOf, NO_PAIRS } from './read-context.mjs';

/** SQLite's busy timeout on the read handle, below the agent's deadline (20 s, agent/src/historyOp.ts), so a locked store
 *  refuses before the deadline rather than at lib.mjs#BUSY_TIMEOUT_MS (30 s) (ruled R5). It bounds lock waits only. */
export const OVERLORD_READ_BUSY_TIMEOUT_MS = 15_000;
/** The whole answer's bound, in UTF-8 bytes of its JSON: shared/overlordHistory.ts' OVERLORD_HISTORY_ANSWER_MAX_BYTES,
 *  which this plain module cannot import (overlord-read.test.ts checks the two are equal). */
export const OVERLORD_READ_ANSWER_MAX_BYTES = 65_536;

/** The CLI verb each request verb runs, with its argument parser and runner (each run* with json: true). */
const VERBS = Object.freeze({
  search: (rc, argv) => {
    const g = parseGrepArgs(argv, rc.nowMs);
    if (!g.ok) return null;
    // The request reader refuses --regex (ruled F3); a regex that still arrived never reaches the child process.
    return g.args.regex === null ? runGrep(rc, { ...g.args, json: true }) : { exit: EXIT.REFUSED, reason: 'regex-refused' };
  },
  describe: (rc, argv) => {
    const d = parseDescribeArgs(argv);
    return d.ok ? runDescribe(rc, { ...d.args, json: true }) : null;
  },
  expand: (rc, argv) => {
    const p = expandArgsOf(parseReadArgs('expand', argv));
    return p.ok ? runExpand(rc, { ...p.args, json: true }) : null;
  },
});
const CLI_VERB = Object.freeze({ search: 'grep', describe: 'describe', expand: 'expand' });

const refused = (outcome, word) => ({ outcome, word });
const FAILED = Object.freeze({ outcome: 'failed', word: 'internal' });

/** The canonical target string (shared/overlordHistory.ts#overlordTargetId, spelled again for this plain module). */
function targetId(t) {
  return t.kind === 'all' ? 'all' : t.kind === 'project' ? `project:${t.project}` : `session:${t.session}`;
}

/** The scope's selection for familiesOf, or null for a target off the grammar (a stated re-check of the agent's reader). */
function selectionOf(t) {
  if (t === null || typeof t !== 'object') return null;
  if (t.kind === 'all') return { kind: 'overlord', target: 'all', project: null, id: null };
  if (t.kind === 'project' && idOk(t.project)) return { kind: 'overlord', target: 'project', project: t.project, id: null };
  if (t.kind === 'session' && idOk(t.session)) return { kind: 'overlord', target: 'session', project: null, id: t.session };
  return null;
}

/** A refusal of the store, before the verb ran: history's word, or the op's word for an exit that carries none. */
function storeWord(exit, reason) {
  if (reason !== undefined) return reason;
  if (exit === EXIT.NO_STORE) return 'no-store';
  if (exit === EXIT.NOT_INDEXED) return 'store-absent';
  return null;
}

/** A verb's answer as the op's outcome. Exit 3 is `rows` with no items; exit 5 is the store's word; exits 6, 8 and 9
 *  carry the op's own word (D-4171 gives them none). */
function outcomeOf(rc, res) {
  if (res.exit === EXIT.OK || res.exit === EXIT.NOT_FOUND) {
    return {
      outcome: 'rows', exit: res.exit, items: (res.items ?? []).map((item) => ({ ...item, trust: 'untrusted' })),
      shown: res.shown ?? 0, total: res.total ?? 0, scope: scopeJsonOf(rc),
    };
  }
  if (res.exit === EXIT.NOT_INDEXED) return refused('verb-refused', 'not-indexed');
  if (res.exit === EXIT.RECALL_OFF) return refused('store-refused', 'recall-off');
  if (res.exit === EXIT.NO_STORE) return refused('store-refused', 'no-store');
  if (typeof res.reason !== 'string') return FAILED;
  return refused(res.exit === EXIT.DB ? 'store-refused' : 'verb-refused', res.reason);
}

/** The answer, masked and measured: redactFinalJson with the belt, then its bytes against the bound. */
function finished(answer, idx) {
  const masked = redactFinalJson(answer, idx);
  const bytes = Buffer.byteLength(JSON.stringify(masked), 'utf8');
  return bytes > OVERLORD_READ_ANSWER_MAX_BYTES ? { outcome: 'too-large', bytes } : masked;
}

/** One Overlord history read. `request` is the agent reader's typed request (shared/overlordHistory.ts); `home` the
 *  agent's configured home. Never throws: every path answers an OverlordHistoryAnswer. */
export async function overlordRead(home, request, nowMs) {
  try {
    return await readIn(home, request, nowMs);
  } catch {
    return FAILED;
  }
}

async function readIn(home, request, nowMs) {
  const sel = selectionOf(request?.target);
  const run = Object.hasOwn(VERBS, request?.verb) ? VERBS[request.verb] : null;
  // A stated re-check of the agent's reader (shared/overlordHistory.ts): its words, never a message.
  if (run === null) return refused('request-refused', 'bad-verb');
  if (sel === null) return refused('request-refused', 'bad-target');
  if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== 'string')) return refused('request-refused', 'bad-args');
  if (request.args.some((a) => a === '--regex' || a.startsWith('--regex='))) return refused('request-refused', 'regex');
  const argv = [...request.args, '--json'];
  if (!parseReadArgs(CLI_VERB[request.verb], argv).ok) return finished(refused('verb-refused', 'bad-args'), NO_PAIRS);
  const P = historyPaths(home);
  const reach = await measureReach(home, '');
  const d = decideCliStore(cliFactsOf(reach));
  if (!d.read) {
    const word = storeWord(d.exit, d.reason);
    return finished(word === null ? FAILED : refused('store-refused', word), NO_PAIRS);
  }
  let db;
  try {
    db = openReader(P.dbFile);
  } catch (e) {
    const f = readFailure(e, null, null, null);
    return finished(f === null ? FAILED : refused('store-refused', f.reason), NO_PAIRS);
  }
  let idx = NO_PAIRS;
  try {
    db.exec(`PRAGMA busy_timeout = ${OVERLORD_READ_BUSY_TIMEOUT_MS}`);
    const meta = db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get();
    const storeId = meta === undefined ? null : meta.v;
    const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
    const version = userVersion(db);
    const rd = decideStatusRead({ userVersion: version, journalMode: mode, recordedMigration: undefined });
    if (rd.reason !== undefined) return finished(refused('store-refused', rd.reason), idx);
    idx = makePairIndex(recordedPairsOf(db));
    const families = familiesOf(db, sel);
    const agents = request.agents === true;
    const transcriptPks = transcriptsOf(db, families.map((f) => f.sessionPk), agents);
    if (transcriptPks.length === 0) return finished(refused('verb-refused', 'not-indexed'), idx);
    const rc = {
      db, version, schema: SCHEMA_ADDED, storeId, nowMs, home, id: null, gen: null,
      scope: {
        kind: 'overlord', id: targetId(request.target), generation: null, project: sel.project, workdir: null,
        sessionPks: families.map((f) => f.sessionPk), transcriptPks, families, agents,
      },
      scopeArgs: [],
      pairIdx: idx,
    };
    const res = run(rc, argv);
    return finished(res === null ? refused('verb-refused', 'bad-args') : outcomeOf(rc, res), idx);
  } catch (e) {
    const f = readFailure(e, null, null, null, idx);
    return finished(f === null ? FAILED : refused('store-refused', f.reason), idx);
  } finally {
    db.close();
  }
}
