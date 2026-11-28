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
// It opens the store through read-context.mjs#openAdmitted, the CLI read paths' own sequence (review 2126 F7), whose
// handle is openReader's (read-only, query_only), and calls no writing form (overlord-read-scope.test.ts pins its calls).
// Its answer is shared/overlordHistory.ts' OverlordHistoryAnswer: a `rows` answer carries exactly {exit, items, shown,
// total, scope} (ruled R3), every other outcome a closed word. Every answer built after the request's re-check passes
// redactFinalJson with the store-only belt; the constant answers (a request word, `internal`) carry no text to mask.
// Every throw is caught: a store error is readFailure's word, anything else `internal`; a message reaches stderr only
// through errLine, which the agent drains and discards.
import {
  EXIT, SCHEMA_ADDED, idOk, makePairIndex, redactFinalJson, parseReadArgs, parseGrepArgs, parseDescribeArgs, expandArgsOf,
  touchedQuery,
} from './lib.mjs';
import { familiesOf, transcriptsOf, scopeJsonOf, runGrep, runDescribe, runExpand, runTouched } from './recall.mjs';
import { openAdmitted, readFailure, recordedPairsOf, NO_PAIRS } from './read-context.mjs';

/** SQLite's busy timeout on the read handle, below the agent's deadline (20 s, agent/src/historyOp.ts), so the read's
 *  first wait on a locked store refuses before the deadline rather than at lib.mjs#BUSY_TIMEOUT_MS (30 s) (ruled R5). It
 *  bounds each lock wait, not the read: a read that waits more than once, or runs one long statement, is bounded by the
 *  agent's deadline alone, and its slot frees only on the worker's exit. */
export const OVERLORD_READ_BUSY_TIMEOUT_MS = 15_000;
/** The whole answer's bound, in UTF-8 bytes of its JSON: shared/overlordHistory.ts' OVERLORD_HISTORY_ANSWER_MAX_BYTES,
 *  which this plain module cannot import (overlord-read.test.ts checks the two are equal). */
export const OVERLORD_READ_ANSWER_MAX_BYTES = 65_536;

/** The `touched` runner's own budget (Overlord W2, request record B1, RQ5): it stops between paths once this much time has
 *  passed, and answers the paths it read, so its worker exits and frees the agent's one history slot well inside the agent's
 *  deadline. Below the server's wait for the read (`requestShortlist.ts#TOUCHED_OPEN_WAIT_MS`, 5 s), which
 *  request-shortlist-read.test.ts checks. One path's read is never interrupted: the budget is read between paths. */
export const TOUCHED_OPEN_BUDGET_MS = 4_000;
/** The most sessions one path's item names: shared/overlordHistory.ts' OVERLORD_HISTORY_TOUCHED_SESSIONS_MAX, which this
 *  plain module cannot import (overlord-read.test.ts checks the two are equal). */
export const TOUCHED_SESSIONS_MAX = 32;
/** The rows one path's read ranks (the CLI's `--limit`): the sessions are taken from these. */
const TOUCHED_ROWS_READ = 50;

/** A request path as the CLI's touched query reads it: `./<path>` parses as a path whose file is the path itself, or the
 *  path is off the CLI's grammar (null). */
function touchedPathOf(arg) {
  const q = touchedQuery(`./${arg}`);
  return q !== null && q.kind === 'path' && q.file === arg ? arg : null;
}

/** One path's item: the asked index and path, each session once (its newest time, newest first, at most
 *  TOUCHED_SESSIONS_MAX), and whether the item is whole: no candidate cap, every ranked row shown, every row's session named
 *  and no session cut. Only ids and times leave the read: no gist, no ref, no text. */
function touchedItem(asked, file, res) {
  const newest = new Map();
  let unnamed = false;
  for (const it of res.items ?? []) {
    const id = it.family?.ccrcId;
    if (typeof id !== 'string' || id === '') { unnamed = true; continue; }
    const t = typeof it.latestMs === 'number' ? it.latestMs : null;
    const was = newest.get(id);
    if (was === undefined || (t !== null && (was === null || t > was))) newest.set(id, t);
  }
  const sessions = [...newest].map(([ccrcId, latestMs]) => ({ ccrcId, latestMs }))
    .sort((a, b) => (b.latestMs ?? -1) - (a.latestMs ?? -1) || (a.ccrcId < b.ccrcId ? -1 : a.ccrcId > b.ccrcId ? 1 : 0));
  const whole = res.candidatesCapped !== true && (res.shown ?? 0) >= (res.total ?? 0) && !unnamed
    && sessions.length <= TOUCHED_SESSIONS_MAX;
  return { asked, file, whole, sessions: sessions.slice(0, TOUCHED_SESSIONS_MAX) };
}

/** `touched` over every requested path, one CLI read per path, in order, stopping between paths at the budget. A rows-shaped
 *  result: one item per path read, `shown` the paths read and `total` the paths asked. A path the CLI refuses answers that
 *  refusal for the whole read. */
function runTouchedPaths(rc, argv, mono) {
  const files = argv.map(touchedPathOf);
  if (files.some((f) => f === null)) return null;
  // The history library's header line (lib.mjs#headerLine) refuses the `overlord` read kind on purpose: it is the guard that
  // keeps that kind from ever reaching a printed scope line. runTouched builds that line only to size its reserve, and this
  // read returns no header, so it hands runTouched a copy of the context whose kind reads as `project`, for that line alone.
  // What the read selects (its sessions, transcripts and families) is the real context's; only ids and times leave
  // (slug `touched-header-reads-as-project`; overlord-read.test.ts pins all three).
  const trc = { ...rc, scope: { ...rc.scope, kind: 'project' } };
  const started = mono();
  const items = [];
  for (let i = 0; i < files.length; i += 1) {
    if (i > 0 && mono() - started >= TOUCHED_OPEN_BUDGET_MS) break;
    const res = runTouched(trc, { arg: `./${files[i]}`, limit: TOUCHED_ROWS_READ });
    if (res.exit !== EXIT.OK && res.exit !== EXIT.NOT_FOUND) return res;
    items.push(touchedItem(i, files[i], res));
  }
  const any = items.some((it) => it.sessions.length > 0);
  return { exit: any ? EXIT.OK : EXIT.NOT_FOUND, items, shown: items.length, total: files.length };
}

/** The CLI verb each request verb runs, with its argument parser and runner. Each run* takes `json: true`, so the op
 *  appends no `--json` to the request's arguments (review 2126 F3: a trailing value-taking option would take it as its
 *  value, and after a `--` it would be a search word). `touched` reads one path per argument (its own parse). */
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
  touched: (rc, argv, mono) => runTouchedPaths(rc, argv, mono),
});
const CLI_VERB = Object.freeze({ search: 'grep', describe: 'describe', expand: 'expand', touched: 'touched' });

/** Whether the request's arguments parse as the CLI verb's: every verb's whole list at once, but `touched`, whose list is
 *  one CLI read per path. */
function argsParse(verb, argv) {
  if (verb === 'touched') return argv.length > 0 && argv.every((a) => parseReadArgs(CLI_VERB.touched, [`./${a}`]).ok);
  return parseReadArgs(CLI_VERB[verb], argv).ok;
}

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
 *  agent's configured home; `mono` the monotonic clock the `touched` budget reads (a test passes its own). Never throws:
 *  every path answers an OverlordHistoryAnswer. */
export async function overlordRead(home, request, nowMs, mono = () => performance.now()) {
  try {
    return await readIn(home, request, nowMs, mono);
  } catch {
    return FAILED;
  }
}

async function readIn(home, request, nowMs, mono) {
  const sel = selectionOf(request?.target);
  const run = Object.hasOwn(VERBS, request?.verb) ? VERBS[request.verb] : null;
  // A stated re-check of the agent's reader (shared/overlordHistory.ts): its words, never a message.
  if (run === null) return refused('request-refused', 'bad-verb');
  if (sel === null) return refused('request-refused', 'bad-target');
  if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== 'string')) return refused('request-refused', 'bad-args');
  if (request.args.some((a) => a === '--regex' || a.startsWith('--regex='))) return refused('request-refused', 'regex');
  if (request.args.includes('--')) return refused('request-refused', 'separator');
  const argv = [...request.args];
  if (!argsParse(request.verb, argv)) return finished(refused('verb-refused', 'bad-args'), NO_PAIRS);
  // The admitted store, opened by the CLI's own sequence with the empty role, no store-id fallback and the busy timeout.
  const admitted = await openAdmitted(home, '', () => null, OVERLORD_READ_BUSY_TIMEOUT_MS);
  if (!admitted.ok) {
    const word = storeWord(admitted.exit, admitted.reason);
    return finished(word === null ? FAILED : refused('store-refused', word), NO_PAIRS);
  }
  const { db, storeId, version } = admitted;
  let idx = NO_PAIRS;
  try {
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
    const res = run(rc, argv, mono);
    return finished(res === null ? refused('verb-refused', 'bad-args') : outcomeOf(rc, res), idx);
  } catch (e) {
    const f = readFailure(e, null, null, null, idx);
    return finished(f === null ? FAILED : refused('store-refused', f.reason), idx);
  } finally {
    db.close();
  }
}
