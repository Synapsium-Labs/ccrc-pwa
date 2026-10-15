// ccd/history/card.mjs: the card line's sweep half (spec 2026-10-05 §8.6, §5.1, §5.2, §9.2 step 6, §9.4; W1-B3 plan
// Tasks 5, 6 and 7).
//
// L4 delivery, as derive.mjs is. It measures the store, the registry and the history root's card/ and scope/
// entries, and hands every decision to lib.mjs (L1): planCardPrediction (B2's span, fork, fan-in and display-prefix
// rules, each called, never re-spelled), decideCardFile, and the delivery and purge decisions. The slot lists the
// parent prediction reads are derive.mjs's own (epochCopySlots), so the parent a card names and the parent derivation
// mints come from one list, and so is the epoch a leaf is hashed under (epochOfUuid; D-5052).
// sweep.mjs imports this module and hands it, on the ingest context, the sweep helpers it needs (budgetLeft,
// historyOff, readRegPresence): this module imports nothing of the sweep or the CLI, and reads no environment.
//
// What it writes: card/<id>/<uuid>.txt, the line and one LF, 0600, temp then rename (store.mjs writeFileAtomic),
// under 0700 directories it makes; beside it, FIRST, card/<id>/<uuid>.gen, the generation B2's CLI resolves for the
// id when neither the env nor the registry names one (its newest family's, '' for a legacy family or none) and one
// LF, which the hook compares recall-off/<id> with then, because the hook cannot read the store (coordinator ruling
// R-recalloff-parity; lib decideCardGenFile); and the scope/ directory the hook writes its markers into, because the
// hook never makes a directory (S4). What it removes: a consumed prediction, every prediction on a pass that runs no card
// step (withdrawCards; ruling RC2, fail closed), and a prediction whose record was due and could not be written or
// removed (coordinator ruling R-recalloff-keep), each an unlink that never goes through a link. What it only reads:
// scope/<id>, to count each consumption by its compaction's scope (ruling RC3). Nothing here journals: a prediction is
// derived again at the next end-of-file after any rebuild. A write that fails is counted and never ends the tick.
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, rmdirSync, unlinkSync,
} from 'node:fs';
import {
  CARD_ATTACHMENT_MAX_BYTES, CARD_DIR, CARD_LINE_MAX, CARD_MEASURE_ROWS, SCOPE_DIR, UUID_RE, cardDirOf, cardFileOf,
  cardGenFileOf, cardIdsIn, cardWindowComplete, consumedBoundaryTs, decideCardDelivery, decideCardFile, decideCardGenFile,
  decideCardWithdraw, decideConsumedScope, decidePurgedEntry, eofAfterBoundary, historyPaths, idOk, leafId, planCardPrediction,
  predictedSpanStart, producerOf, scopeMarkerOf,
} from './lib.mjs';
import { bump, getStep, parentOf, setStep, unbrotli, withTx, writeFileAtomic } from './store.mjs';
import { epochCopySlots, epochOfUuid, holdingCopyOf } from './derive.mjs';

/** A path's kind by lstat, never following a link: 'dir', 'file', 'link', 'other', 'absent' (ENOENT), or
 *  'unmeasured' (any other failure; never read as absent). */
function lstatKind(p) {
  let st;
  try { st = lstatSync(p); } catch (e) { return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured'; }
  if (st.isSymbolicLink()) return 'link';
  if (st.isDirectory()) return 'dir';
  return st.isFile() ? 'file' : 'other';
}

/** `scope/` and `card/` under the history root, made 0700 when absent (§5.1, §5.2): the hook writes its markers into
 *  `scope/`, reads `card/` and gates its render reserve on `card/` existing, and never makes a directory (S4). So a
 *  box with history is armed by its sweep's first tick, and a box without history (a server, a refused store, a
 *  `history-off` box: no tick runs) never is. A path there that is a link, a file or unmeasurable is refused, left as
 *  it is, and counted `history_dir_refused:<name>`. D-4741 (history-card-dirs-made-by-sweep) */
export function ensureHistoryDirs(db, home) {
  const root = historyPaths(home).root;
  const out = {};
  for (const name of [SCOPE_DIR, CARD_DIR]) {
    const dir = `${root}/${name}`;
    const kind = lstatKind(dir);
    let state = kind === 'dir' ? 'present' : 'refused';
    if (kind === 'absent') {
      try {
        mkdirSync(dir, { mode: 0o700 });
        state = 'made';
      } catch {
        state = lstatKind(dir) === 'dir' ? 'present' : 'refused';
      }
    }
    if (state === 'refused') bump(db, `history_dir_refused:${name}`);
    out[name] = state;
  }
  return out;
}

const CARD_STMTS = new WeakMap();

/** The statements the card writer reads by, one set per connection, each naming its columns.
 *  - the epoch is not read here: `predict` takes it from derive.mjs's `epochOfUuid` (a confirmed epoch of an unmerged
 *    family, the lowest session_pk), the one rule for the leaf both hash, so the leaf id hashes the ccrc id derivation
 *    will hash. D-5052 (history-card-epoch-rule-exported)
 *  - `copy` is the transcript's live copy written last (newest mtime_ns, then the larger file_id: §6.1's newest copy),
 *    the one Claude Code appends the next boundary to. D-4744 (history-card-newest-live-copy)
 *  - `firstRow` joins blobs as derive.mjs's copyRows does, so an epoch's first span starts at the row derivation reads
 *    as the copy's first.
 *  - `boundaries` is the copy's boundaries in line order with their times, which lib consumedBoundaryTs walks to find
 *    the one that consumed a prediction (ruling RC3).
 *  - `newestFamily` is the family B2's CLI reads under 'newest' (recall.mjs's ownFamily with no generation: the id's
 *    newest unmerged family by first_seen_ms, then session_pk), whose generation the record beside a prediction
 *    carries (coordinator ruling R-recalloff-parity). */
function cardStmts(db) {
  let s = CARD_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    transcript: db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''"),
    copy: db.prepare(`SELECT file_id, eof_ms FROM ingest_files
      WHERE transcript_pk = ? AND source_key = '' AND status = 'live' ORDER BY mtime_ns DESC, file_id DESC LIMIT 1`),
    firstRow: db.prepare(`SELECT e.uuid AS uuid FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      JOIN blobs bl ON bl.blob_id = e.blob_id WHERE m.file_id = ? ORDER BY m.line LIMIT 1`),
    lastBoundary: db.prepare(`SELECT e.uuid AS uuid, b.head_uuid AS head_uuid FROM memberships m
      JOIN boundaries b ON b.entry_id = m.entry_id JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? ORDER BY m.line DESC LIMIT 1`),
    boundaries: db.prepare(`SELECT e.uuid AS uuid, b.head_uuid AS head_uuid, e.ts_ms AS ts_ms FROM memberships m
      JOIN boundaries b ON b.entry_id = m.entry_id JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? ORDER BY m.line`),
    nodeBound: db.prepare('SELECT 1 AS x FROM nodes WHERE node_id = ?'),
    newestCondensed: db.prepare(`SELECT node_id FROM nodes WHERE session_pk = ? AND epoch_seq = ? AND kind = 'condensed'
      ORDER BY rowid DESC LIMIT 1`),
    familyIds: db.prepare('SELECT node_id FROM nodes WHERE session_pk = ?'),
    newestFamily: db.prepare(`SELECT generation FROM sessions WHERE ccrc_id = ? AND merged_into IS NULL
      ORDER BY first_seen_ms DESC, session_pk DESC LIMIT 1`),
  };
  CARD_STMTS.set(db, s);
  return s;
}

/** The generation B2's CLI compares recall-off/<id> with when neither CCRC_SESSION_GENERATION nor $REG/<id>.generation
 *  resolves one (readContext under 'newest'; spec §8.2, §8.8 Generation row, §9.7): the id's newest family's, '' for a
 *  legacy family or when the store holds none. The hook cannot read the store, so the sweep records this beside each
 *  prediction (coordinator ruling R-recalloff-parity). The case `the generation record …` measures it against
 *  recall.mjs's own familiesOf, so the CLI's rule is pinned, never assumed. */
function cliGenerationOf(s, id) {
  const r = s.newestFamily.get(id);
  return r === undefined ? '' : r.generation;
}

/** A card file as a Presence: absent (ENOENT); unreadable (any other failure, or not a regular file: a link, a FIFO
 *  or a directory is never read); or its first 4 × CARD_LINE_MAX bytes as text, more than any line of CARD_LINE_MAX
 *  characters takes. */
function readCard(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    return e && e.code === 'ENOENT' ? { state: 'absent' } : { state: 'unreadable' };
  }
  try {
    if (!fstatSync(fd).isFile()) return { state: 'unreadable' };
    const buf = Buffer.alloc(4 * CARD_LINE_MAX);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return { state: 'value', value: buf.subarray(0, n).toString('utf8') };
  } catch {
    return { state: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

/** The sessions the registry names now: `$REG/<id>.uuid` for each id that passes idOk, read through the sweep's own
 *  type-checked reader (a FIFO there is never opened). A prediction is written only for one of these: the hook serves
 *  the pane's own uuid, and the periodic scan reads every known transcript to its end, so end-of-file alone would
 *  write a file for every session the store ever saw. D-4743 (history-card-registry-names-the-session) */
function registeredPairs(ictx) {
  const reg = historyPaths(ictx.home).reg;
  const out = new Map();
  let names;
  try { names = readdirSync(reg); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.uuid')) continue;
    const id = n.slice(0, -'.uuid'.length);
    if (!idOk(id)) continue;
    const v = ictx.readRegPresence(`${reg}/${n}`);
    if (v.state === 'value' && UUID_RE.test(v.value)) out.set(id, v.value);
  }
  return out;
}

/** Every `card/<id>/<uuid>.txt` on disk under a real `card/<id>` directory, so a prediction the registry no longer
 *  names is still consumed when its boundary is ingested. Other names are not this writer's and are not read. */
function cardFilesUnder(root) {
  const out = [];
  let ids;
  try { ids = readdirSync(root); } catch { return out; }
  for (const id of ids) {
    if (!idOk(id) || lstatKind(`${root}/${id}`) !== 'dir') continue;
    let names;
    try { names = readdirSync(`${root}/${id}`); } catch { continue; }
    for (const n of names) {
      const uuid = n.endsWith('.txt') ? n.slice(0, -'.txt'.length) : '';
      if (UUID_RE.test(uuid)) out.push({ id, uuid });
    }
  }
  return out;
}

/** One session's prediction, measured over the copy its next boundary will be written to (lib planCardPrediction
 *  decides): the epoch derive.mjs would read, the copy's first row or last boundary, whether the plain id is bound
 *  already, this copy's level-0 slots in its epoch (derive.mjs epochCopySlots: the list fan-in reads) and whether each
 *  is parented, the epoch's newest condensed node, and the family's node ids. */
function predict(db, s, id, uuid) {
  const ep = epochOfUuid(db, uuid);
  const ccrcId = ep !== null && ep.ccrc_id === id ? id : null;
  const t = ccrcId === null ? undefined : s.transcript.get(uuid);
  const copy = t === undefined ? undefined : s.copy.get(t.transcript_pk);
  const last = copy === undefined ? undefined : s.lastBoundary.get(copy.file_id);
  const first = copy === undefined || last !== undefined ? undefined : s.firstRow.get(copy.file_id);
  const lastBoundary = last === undefined ? null : { uuid: last.uuid, headUuid: last.head_uuid ?? null };
  const firstRowUuid = first === undefined ? null : first.uuid;
  const start = copy === undefined ? null : predictedSpanStart({ firstRowUuid, lastBoundary });
  const plainBoundOther = start !== null && s.nodeBound.get(leafId(ccrcId, uuid, start)) !== undefined;
  const slots = copy === undefined ? [] : (epochCopySlots(db, ep.session_pk, ep.seq).get(copy.file_id) ?? [])
    .map((nodeId) => ({ nodeId, parented: nodeId !== null && parentOf(db, nodeId) !== null }));
  const newest = copy === undefined ? undefined : s.newestCondensed.get(ep.session_pk, ep.seq);
  const familyIds = copy === undefined ? [] : s.familyIds.all(ep.session_pk).map((r) => r.node_id);
  return {
    copy: copy ?? null,
    ccrcId,
    prediction: planCardPrediction({
      ccrcId, ccUuid: uuid, firstRowUuid, lastBoundary, plainBoundOther, slots,
      newestCondensed: newest === undefined ? null : newest.node_id, familyIds,
    }),
  };
}

/** One prediction per session id (D-4742 (history-card-one-file-per-id)): every other `<uuid>.txt` in card/<id>/ and its
 *  `<uuid>.gen` record, and any `<uuid>.txt.tmp.<pid>` or `<uuid>.gen.tmp.<pid>` a killed writer left, is unlinked (a
 *  link itself, never its target). Other names stay. */
function removeOtherCards(dir, uuid) {
  for (const name of readdirSync(dir)) {
    if (name === `${uuid}.txt` || name === `${uuid}.gen`) continue;
    const m = /^([0-9a-f-]{36})\.(?:txt|gen)(?:\.tmp\.[0-9]+)?$/.exec(name);
    if (m === null || !UUID_RE.test(m[1])) continue;
    unlinkSync(`${dir}/${name}`);
  }
}

/** The scope a consumption is counted under (W1-e's denominator; ruling RC3, D-4738 (history-card-consumed-counter)): the
 *  consumed boundary's time, found by lib consumedBoundaryTs over this copy's boundaries in order and its first row,
 *  and scope/<id> read read-only through readCard (an O_NOFOLLOW open and an fstat type check: the lstat type without
 *  its race, so a link is never followed and a FIFO never waited on), folded by lib decideConsumedScope. */
function consumedScopeOf(s, home, id, uuid, current, copy, ccrcId) {
  const fileId = copy === null ? null : copy.file_id;
  const boundaries = fileId === null ? [] : s.boundaries.all(fileId).map((r) => ({
    uuid: r.uuid, headUuid: r.head_uuid ?? null, tsMs: r.ts_ms === null ? null : Number(r.ts_ms),
  }));
  const first = fileId === null ? undefined : s.firstRow.get(fileId);
  const boundaryTsMs = consumedBoundaryTs({
    current, ccrcId, ccUuid: uuid, firstRowUuid: first === undefined ? null : first.uuid, boundaries,
  });
  return decideConsumedScope({ marker: readCard(scopeMarkerOf(home, id)), uuid, boundaryTsMs });
}

/** One (id, uuid): measure, let lib decide, act, count. A write is due only at end-of-file of the copy the registry's
 *  session appends to, this tick (its eof_ms is this tick's start: B1's recordExamined), and only while the run's
 *  budget is left: the budget bounds a WRITE, never the consume and delete decision, which decideCardFile then takes
 *  as it does off end-of-file (ruling RC2). A card/<id> that is a link or not a directory is never read or written
 *  through. Each prediction a boundary of the main transcript consumed is counted `card_consumed:<scope>`, the scope
 *  its compaction's marker gives it (ruling RC3). D-4738 (history-card-consumed-counter)
 *  The generation record beside a standing prediction is acted on FIRST, as lib decideCardGenFile says, so a
 *  prediction never lands beside a missing or stale record: a record that cannot be written holds the prediction's
 *  write too, counted card_write_failed (coordinator ruling R-recalloff-parity). A record that was due (written or
 *  removed) and could not be acted on, beside a prediction already on disk, takes that prediction with it, counted
 *  card_unrecorded_removed (coordinator ruling R-recalloff-keep): an unlink succeeds where a write meets ENOSPC or
 *  EDQUOT, so no prediction stands beside a stale record until its boundary consumes it. */
function oneCard(db, s, ictx, budget, id, uuid, registered, out) {
  const { copy, ccrcId, prediction } = predict(db, s, id, uuid);
  const atEof = registered && copy !== null && copy.eof_ms !== null && Number(copy.eof_ms) === ictx.nowMs;
  const mayWrite = atEof && ictx.budgetLeft(budget);
  const dir = cardDirOf(ictx.home, id);
  const dirKind = lstatKind(dir);
  if (dirKind !== 'dir' && dirKind !== 'absent') {
    if (atEof) bump(db, 'card_dir_refused');
    return;
  }
  const file = cardFileOf(ictx.home, id, uuid);
  const genFile = cardGenFileOf(ictx.home, id, uuid);   // the record's name is lib's alone. D-5049 (history-card-gen-path-helper)
  const current = dirKind === 'absent' ? { state: 'absent' } : readCard(file);
  if (atEof && prediction.act === 'skip') bump(db, `card_skipped:${prediction.reason}`);
  const d = decideCardFile({ current, prediction, atEof: mayWrite });
  const gen = cliGenerationOf(s, id);
  const g = decideCardGenFile({
    current: dirKind === 'absent' ? { state: 'absent' } : readCard(genFile), generation: gen, card: d.act, mayWrite,
  });
  let recorded = g !== 'write' && g !== 'delete';
  try {
    if (dirKind === 'absent' && d.act === 'write') mkdirSync(dir, { mode: 0o700 });
    if (g === 'write') writeFileAtomic(genFile, `${gen}\n`, 0o600);
    if (g === 'delete') unlinkSync(genFile);
    recorded = true;
    if (d.act === 'write') {
      writeFileAtomic(file, `${prediction.line}\n`, 0o600);
    } else if (d.act === 'delete') {
      unlinkSync(file);
    }
  } catch {
    // writeFileAtomic removes its own `<file>.tmp.<pid>` on any failure before the rename, so nothing is left here to
    // unlink; a temp a KILLED writer left is removeOtherCards' (its `.tmp.<pid>` arm) at the id's next write.
    bump(db, 'card_write_failed');
    // The record was due and is not acted on: the prediction on disk, if one stands (a kept one, or the one a write
    // was to replace), goes too, so the hook never compares recall-off with a stale record (R-recalloff-keep). An
    // absent prediction fails this unlink with ENOENT and is not counted.
    if (!recorded) {
      try {
        unlinkSync(file);
        bump(db, 'card_unrecorded_removed');
      } catch { /* none stands, or it cannot be removed either: the next tick decides both again */ }
    }
    return;
  }
  if (d.act === 'write') {
    // The id's other predictions go once this one is on disk. A cleanup that fails is counted on its own and never
    // costs the write's or the consumption's count.
    try { removeOtherCards(dir, uuid); } catch { bump(db, 'card_cleanup_failed'); }
    bump(db, 'card_written');
    out.written += 1;
  }
  if (d.act === 'delete') out.deleted += 1;
  if (d.consumed) {
    const scope = consumedScopeOf(s, ictx.home, id, uuid, current, copy, ccrcId);
    bump(db, `card_consumed:${scope}`);
    out.consumed += 1;
  }
}

/** The consumer and the writer (§8.6 Timing, §9.2 step 6), over every session the registry names and every card file
 *  on disk, in a stable order, stopping at history-off. The run's budget is read before each WRITE (oneCard), never
 *  before the consume and delete decision, so a spent budget still consumes (ruling RC2). */
export function consumeAndWriteCards(db, ictx, budget) {
  const out = { written: 0, consumed: 0, deleted: 0 };
  const root = `${historyPaths(ictx.home).root}/${CARD_DIR}`;
  if (lstatKind(root) !== 'dir') return out;
  const s = cardStmts(db);
  const live = registeredPairs(ictx);
  const cands = new Map();
  for (const [id, uuid] of live) cands.set(`${id}/${uuid}`, { id, uuid });
  for (const c of cardFilesUnder(root)) cands.set(`${c.id}/${c.uuid}`, c);
  for (const key of [...cands.keys()].sort()) {
    if (ictx.historyOff()) break;
    const { id, uuid } = cands.get(key);
    oneCard(db, s, ictx, budget, id, uuid, live.get(id) === uuid, out);
  }
  return out;
}

/** The card's part of the tick (§9.2 step 6: measure delivery, then write card/ files). tick calls it under the
 *  derivation's gate, so it never runs on the recover arm (recoverPass never calls tick), under a cap or floor pause, or
 *  past history-off; a pass that does not run it withdraws every prediction instead (withdrawCards, below). */
export function cardStep(db, ictx, budget) {
  if (ictx.historyOff()) return { measure: null, cards: null };
  const measure = measureCardDelivery(db, ictx, budget);
  const cards = consumeAndWriteCards(db, ictx, budget);
  return { measure, cards };
}

// ── The withdrawal (ruling RC2: fail closed; W1-B3 Task 5) ─────────────────────────────────────────────────────────
// A prediction is consumed only by a card step that sees the boundary that consumed it. A scheduled pass that runs
// none, or whose ingest may have stopped short of that boundary, would leave every prediction in place, and a second
// compaction in that state would be served a stale line. So such a pass withdraws them all. lib decideCardWithdraw
// says whether, and under which reason word; this only measures and unlinks. D-4740 (history-card-withdrawn-when-not-ticking)

/** Withdraws every `card/<id>/<uuid>.txt` when lib's decideCardWithdraw says the pass `pass` does. The path is
 *  lstat-checked where a link could be walked through: a `card/` (here) or a `card/<id>` (cardFilesUnder) that is a
 *  link or not a directory is never entered. Each name is then only unlinked, which removes a link itself, never its
 *  target, and refuses a directory; a name that cannot be unlinked is left for the next pass that withdraws. Counted
 *  `card_withdrawn:<reason>` on `db`; a pass with no DB open (a hold before the open, where nothing is counted: IV2)
 *  prints `history-sweep: card_withdrawn:<reason> <n>` through `out` instead, beside its own word. Answers the number
 *  withdrawn. */
export function withdrawCards(db, home, pass, out) {
  const d = decideCardWithdraw(pass);
  if (d.act !== 'withdraw') return 0;
  const root = `${historyPaths(home).root}/${CARD_DIR}`;
  if (lstatKind(root) !== 'dir') return 0;
  let n = 0;
  for (const { id, uuid } of cardFilesUnder(root)) {
    try {
      unlinkSync(cardFileOf(home, id, uuid));
      n += 1;
    } catch { /* a directory under a card name, or a name already gone: left for the next pass that withdraws */ }
  }
  if (n > 0 && db !== null) bump(db, `card_withdrawn:${d.reason}`, n);
  if (n > 0 && db === null) out(`history-sweep: card_withdrawn:${d.reason} ${n}`);
  return n;
}

// ── Card delivery, measured from the transcript (spec §8.6 "Delivery is measured, not receipted", RV17; §10.7 W1-e;
// W1-B3 Task 6) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The hook writes no receipt. After a compaction Claude Code records what the SessionStart(compact) hook printed as a
// `hook_additional_context` attachment a few rows after the boundary (M: 75 of 75 within 40 rows). For every new leaf of
// a main transcript this reads that window in the leaf's holding copy (derive.mjs holdingCopyOf) and folds lib's
// verdict, counted under the boundary's producer (the first real assistant row after it, B1's producerOf):
//   card_served:<backend>       a History line there names this leaf;
//   card_id_mismatch:<backend>  History lines there name only other leaves;
//   nothing                     the window closed with no History line.
// Cursor ('card-measure', 1): the highest nodes.rowid decided. The first pass sets it to the newest node there is, so a
// leaf derived before this build is never read as unserved. A window still open stops the walk: no leaf is decided past
// an undecided one, so each is counted once. A count and the cursor commit in one transaction.
// D-4737 (history-card-measured-from-transcript) D-4739 (history-card-measure-window) D-4196
const CARD_MEASURE_STEP = 'card-measure';
const CARD_MEASURE_VERSION = 1;
const MEASURE_STMTS = new WeakMap();

function measureStmts(db) {
  let s = MEASURE_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    top: db.prepare('SELECT max(rowid) AS r FROM nodes'),
    leaves: db.prepare(`SELECT n.rowid AS rid, n.node_id AS node_id, n.boundary_entry_id AS boundary_entry_id,
        n.transcript_pk AS transcript_pk, n.created_ms AS created_ms
      FROM nodes n JOIN transcripts t ON t.transcript_pk = n.transcript_pk
      WHERE n.rowid > ? AND n.depth = 0 AND n.boundary_entry_id IS NOT NULL AND t.agent_id = ''
      ORDER BY n.rowid`),
    status: db.prepare('SELECT status FROM ingest_files WHERE file_id = ?'),
    lineOf: db.prepare('SELECT line FROM memberships WHERE file_id = ? AND entry_id = ?'),
    stampAt: db.prepare(`SELECT e.ts_ms AS ts_ms FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.line <= ? AND e.ts_ms IS NOT NULL ORDER BY m.line DESC LIMIT 1`),
    window: db.prepare(`SELECT e.type AS type, e.blob_id AS blob_id,
        CASE WHEN b.entry_id IS NULL THEN 0 ELSE 1 END AS is_boundary
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id LEFT JOIN boundaries b ON b.entry_id = e.entry_id
      WHERE m.file_id = ? AND m.line > ? ORDER BY m.line LIMIT ?`),
    blobZ: db.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?'),
    modelsAfter: db.prepare(`SELECT e.model AS model FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.line > ? AND e.type = 'assistant' ORDER BY m.line`),
  };
  MEASURE_STMTS.set(db, s);
  return s;
}

/** An attachment row's stored body (its `attachment` object, B1's blobBodyOf), or null for a tombstone, a body that
 *  is not JSON, or a body whose raw_len is over CARD_ATTACHMENT_MAX_BYTES, which is skipped unread: a SessionStart
 *  attachment never comes near that bound, and a re-attached file of many MiB is not decompressed only to read its
 *  `type`. The compressed bytes of a body read count against the run's byte budget, as derivation's reads do. The
 *  decode is bounded by the blob's own stored raw_len, as B1's unbrotli requires (it throws a TypeError without a
 *  bound, and a RangeError for a body that decodes past it): either throw reads as no body here. */
function attachmentOf(s, blobId, budget) {
  const r = s.blobZ.get(blobId);
  if (r === undefined || r.z === null || Number(r.raw_len) > CARD_ATTACHMENT_MAX_BYTES) return null;
  budget.bytes += r.z.length;
  try { return JSON.parse(unbrotli(r.z, Number(r.raw_len)).toString('utf8')); } catch { return null; }
}

/** The boundary's producer: B1's producerOf over the assistant rows after it, read lazily, in its copy's order. */
function producerAfter(s, fileId, line) {
  function* models() {
    for (const r of s.modelsAfter.iterate(fileId, line)) yield r.model;
  }
  return producerOf(models());
}

/** One leaf's delivery verdict, and the backend it is counted under when it is counted. */
function deliveryOf(db, s, ictx, n, budget) {
  const holding = holdingCopyOf(db, { entry_id: n.boundary_entry_id, transcript_pk: n.transcript_pk });
  const at = holding === null ? undefined : s.lineOf.get(holding.file_id, n.boundary_entry_id);
  const ids = [];
  let live = false;
  let rowsSeen = 0;
  let nextBoundary = false;
  let eofAfter = false;
  let line = null;
  if (holding !== null && at !== undefined) {
    line = Number(at.line);
    live = holding.source_key === '' && s.status.get(holding.file_id)?.status === 'live';
    for (const r of s.window.all(holding.file_id, line, CARD_MEASURE_ROWS)) {
      if (r.is_boundary === 1) {
        nextBoundary = true;
        break;
      }
      rowsSeen += 1;
      if (r.type === 'attachment') ids.push(...cardIdsIn(attachmentOf(s, r.blob_id, budget)));
    }
    const stamp = s.stampAt.get(holding.file_id, line);
    eofAfter = eofAfterBoundary({
      eofMs: holding.eof_ms === null ? null : Number(holding.eof_ms), boundaryTsMs: stamp === undefined ? null : Number(stamp.ts_ms),
    });
  }
  const windowComplete = cardWindowComplete({ live, rowsSeen, nextBoundary, eofAfter, waitedMs: ictx.nowMs - Number(n.created_ms) });
  const verdict = decideCardDelivery({ ids, leafId: n.node_id, windowComplete });
  const backend = verdict === 'served' || verdict === 'mismatch' ? producerAfter(s, holding.file_id, line) : null;
  return { verdict, backend };
}

/** Every new leaf of a main transcript, in rowid order, within the run's budget (§9.2 step 6: before the card files
 *  are written). Returns what it decided this pass. */
export function measureCardDelivery(db, ictx, budget) {
  const s = measureStmts(db);
  const out = { measured: 0, served: 0, mismatch: 0, waiting: 0 };
  const step = getStep(db, CARD_MEASURE_STEP, CARD_MEASURE_VERSION);
  if (step === null || step.cursor === null) {
    const top = s.top.get().r;
    withTx(db, 'NORMAL', () => { setStep(db, CARD_MEASURE_STEP, CARD_MEASURE_VERSION, String(top === null ? 0 : Number(top)), null); });
    return out;
  }
  for (const n of s.leaves.all(Number(step.cursor))) {
    if (!ictx.budgetLeft(budget)) break;
    const w = deliveryOf(db, s, ictx, n, budget);
    if (w.verdict === 'wait') { out.waiting += 1; break; }
    withTx(db, 'NORMAL', () => {
      if (w.verdict === 'served') bump(db, `card_served:${w.backend}`);
      if (w.verdict === 'mismatch') bump(db, `card_id_mismatch:${w.backend}`);
      setStep(db, CARD_MEASURE_STEP, CARD_MEASURE_VERSION, String(Number(n.rid)), null);
    });
    out.measured += 1;
    if (w.verdict === 'served') out.served += 1;
    if (w.verdict === 'mismatch') out.mismatch += 1;
  }
  return out;
}
