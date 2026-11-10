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
//
// W3 Task 1B: the steer file, steer/<id>/<uuid>.txt (spec §7.1, §9.4), is a SECOND ARTIFACT of the same per-session step: a
// prediction of the same next leaf, valid until the boundary that consumes it is ingested. It is decided by the same lib
// deciders (decideCardFile with artifact 'steer', decideCardWithdraw, the generation record's `recorded`), acted on in oneCard
// from the card's own prediction, atEof and mayWrite, withdrawn wherever the card is, and collected with its purged session.
// Its IO (read, previous-leaf read, write) is steer.mjs's; its text is lib's composeSteerFile. The hook never consumes,
// deletes or writes it (PX13): every removal here is the sweep's.
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, rmdirSync, unlinkSync,
} from 'node:fs';
import {
  CARD_ATTACHMENT_MAX_BYTES, CARD_DIR, CARD_LINE_MAX, CARD_MEASURE_ROWS, SCOPE_DIR, STEER_DIR, UUID_RE, cardDirOf, cardFileOf,
  cardGenFileOf, cardIdsIn, cardWindowComplete, composeSteerFile, consumedBoundaryTs, decideCardDelivery, decideCardFile,
  decideCardGenFile, decideCardWithdraw, decideConsumedScope, decidePurgedEntry, eofAfterBoundary, historyPaths, idOk, leafId,
  planCardPrediction, predictedSpanStart, producerOf, scopeMarkerOf, steerDirOf, steerFileOf, steerIdOk,
} from './lib.mjs';
import { bump, getStep, parentOf, setStep, unbrotli, withTx, writeFileAtomic } from './store.mjs';
import { epochCopySlots, epochOfUuid, holdingCopyOf } from './derive.mjs';
import { childrenOf, prevLeafOf, readSteerFile, writeSteerFile } from './steer.mjs';

/** A path's kind by lstat, never following a link: 'dir', 'file', 'link', 'other', 'absent' (ENOENT), or
 *  'unmeasured' (any other failure; never read as absent). */
export function lstatKind(p) {
  let st;
  try { st = lstatSync(p); } catch (e) { return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured'; }
  if (st.isSymbolicLink()) return 'link';
  if (st.isDirectory()) return 'dir';
  return st.isFile() ? 'file' : 'other';
}

/** `scope/`, `card/` and `steer/` under the history root, made 0700 when absent (§5.1, §5.2, §9.4): the hook writes its markers into
 *  `scope/`, reads `card/` and gates its render reserve on `card/` existing, and never makes a directory (S4). So a
 *  box with history is armed by its sweep's first tick, and a box without history (a server, a refused store, a
 *  `history-off` box: no tick runs) never is. A path there that is a link, a file or unmeasurable is refused, left as
 *  it is, and counted `history_dir_refused:<name>`. D-4741 (history-card-dirs-made-by-sweep) */
export function ensureHistoryDirs(db, home) {
  const root = historyPaths(home).root;
  const out = {};
  for (const name of [SCOPE_DIR, CARD_DIR, STEER_DIR]) {
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
  return filesUnder(root, idOk);
}

/** `steer/<id>/<uuid>.txt` likewise, by the steer directory's own id rule (steerIdOk: `steer/.lanes/` is never entered). */
function steerFilesUnder(root) {
  return filesUnder(root, steerIdOk);
}

function filesUnder(root, idGate) {
  const out = [];
  let ids;
  try { ids = readdirSync(root); } catch { return out; }
  for (const id of ids) {
    if (!idGate(id) || lstatKind(`${root}/${id}`) !== 'dir') continue;
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
    epoch: ep,
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
 *  EDQUOT, so no prediction stands beside a stale record until its boundary consumes it. A CONSUMED prediction whose
 *  replacement cannot be written goes too, recorded or not (an unlink succeeds there as well), so the hook never serves
 *  the previous compaction's leaf as this one; it is counted card_consumed once it is gone, and not while it stands (the
 *  next tick decides it again). D-5059 (history-card-consumed-write-fails-closed) */
function cardArtifact(db, s, ictx, id, uuid, p, atEof, mayWrite, out) {
  const { copy, ccrcId, prediction } = p;
  const dir = cardDirOf(ictx.home, id);
  const dirKind = lstatKind(dir);
  if (dirKind !== 'dir' && dirKind !== 'absent') {
    if (atEof) bump(db, 'card_dir_refused');
    return true;   // no record was due: the steer file is not held by a card directory that cannot be entered
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
  const countConsumed = () => {   // once the consumed line is gone: the write path and the failure path both end here
    const scope = consumedScopeOf(s, ictx.home, id, uuid, current, copy, ccrcId);
    bump(db, `card_consumed:${scope}`);
    out.consumed += 1;
  };
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
    // A consumed prediction goes whatever the record did: its boundary is ingested, so the line names the previous
    // compaction's leaf and must not be served as this one (§8.6 Timing). D-5059 (history-card-consumed-write-fails-closed)
    if (!recorded || d.consumed) {
      let gone = false;
      try {
        unlinkSync(file);
        gone = true;
      } catch { /* none stands, or it cannot be removed either: the next tick decides both again, counting nothing now */ }
      if (gone && !recorded) bump(db, 'card_unrecorded_removed');
      if (gone && d.consumed) countConsumed();
    }
    return recorded;
  }
  if (d.act === 'write') {
    // The id's other predictions go once this one is on disk. A cleanup that fails is counted on its own and never
    // costs the write's or the consumption's count.
    try { removeOtherCards(dir, uuid); } catch { bump(db, 'card_cleanup_failed'); }
    bump(db, 'card_written');
    out.written += 1;
  }
  if (d.act === 'delete') out.deleted += 1;
  if (d.consumed) countConsumed();
  return true;
}

/** One (id, uuid): the card's prediction, then the steer file, both from ONE measurement of the same prediction, atEof and
 *  mayWrite. The card's step answers whether the generation record it was due to act on was acted on (`recorded`), which
 *  the steer file reads: a record due and not acted on takes the steer file with the card's prediction (R-recalloff-keep, as
 *  the hook's recall-off copy reads that record: O9 (a), ruled). A write is due only at end-of-file of the copy the registry's
 *  session appends to, this tick (its eof_ms is this tick's start: B1's recordExamined), and only while the run's budget is
 *  left: the budget bounds a WRITE, never the consume and delete decision (ruling RC2). */
function oneCard(db, s, ictx, budget, id, uuid, registered, roots, out) {
  const p = predict(db, s, id, uuid);
  const atEof = registered && p.copy !== null && p.copy.eof_ms !== null && Number(p.copy.eof_ms) === ictx.nowMs;
  const mayWrite = atEof && ictx.budgetLeft(budget);
  const recorded = roots.card ? cardArtifact(db, s, ictx, id, uuid, p, atEof, mayWrite, out) : true;
  if (roots.steer && steerIdOk(id)) steerArtifact(db, ictx, id, uuid, p, atEof, mayWrite, recorded);
}

/** The steer file's prediction: the card's own prediction with the steer text as its `line` (decideCardFile compares a file's
 *  text with it, as it compares a card line), composed by lib from the leaf id, the previous leaf's stored row and, when the
 *  card predicts a parent (`parentKind` predicted: this leaf completes a group), the parent's id and the stored rows of the
 *  group's other seven children (W3 Task 4: the add-on). A skip stays a skip. The text is composed, and the rows read, only
 *  when a write is possible (`mayWrite`): decideCardFile reads
 *  `prediction.line` for nothing but a write or the keep of an identical file, and off end-of-file the verdict of every arm
 *  (absent: none; this leaf, as written or re-rendered: keep; another leaf, junk or unreadable: delete) is the same without
 *  it, because a steer file this writer composed names its own leaf whole. The line is then `undefined`, which no file's text
 *  equals (an empty file's is `''`, an unreadable one's `null`), so a junk file is still deleted.
 *  A composer that throws (the add-on does not fit its bounds: a defect, D4) makes the steer prediction a skip named
 *  `compose-failed`, with the leaf as its plain id so a file that named another leaf still reads consumed: decideCardFile
 *  deletes any standing file, as for every skip, and the caller counts `steer_compose_failed`. The card's own prediction is
 *  untouched. Answers `{ prediction, composeFailed }`. */
function steerPredictionOf(db, ictx, p, mayWrite) {
  const prediction = p.prediction;
  if (prediction.act !== 'write') return { prediction, composeFailed: false };
  if (!mayWrite) return { prediction: { ...prediction, line: undefined }, composeFailed: false };
  const prev = p.copy === null || p.epoch === null ? null : prevLeafOf(db, p.copy.file_id, p.epoch);
  const parent = prediction.parentKind === 'predicted';
  try {
    const { text } = composeSteerFile({
      leafId: prediction.leafId, prev, pairIdx: ictx.pairIdx,
      children: parent ? childrenOf(db, prediction.children.slice(0, -1)) : [],
      parentId: parent ? prediction.parentId : undefined,
    });
    return { prediction: { ...prediction, line: text }, composeFailed: false };
  } catch {
    return { prediction: { act: 'skip', reason: 'compose-failed', plainLeafId: prediction.leafId }, composeFailed: true };
  }
}

/** The steer file for one (id, uuid), on the card's lifecycle (W3 Task 1B). A `steer/<id>` that is a link or not a directory is
 *  never read or written through (counted `steer_dir_refused` at end-of-file). The act is lib's decideCardFile with artifact
 *  'steer'; the arms are the card's, counted apart:
 *    steer_written            a file written;
 *    steer_consumed           a file whose boundary was ingested, once it is gone (written over, deleted, or unlinked after a
 *                             failed write: not while it stands, so the next tick decides it again);
 *    steer_write_failed       the write (or its directory) failed;
 *    steer_unrecorded_removed the card's generation record was due and not acted on, and this file went with the prediction;
 *    steer_cleanup_failed     the id's other files could not all be removed after a write that landed;
 *    steer_compose_failed     the composer threw (the parent add-on missed a bound at its floor, a defect): the steer
 *                             prediction is a skip, any standing file goes, once per end-of-file evaluation; never a
 *                             `card_skipped:*`, and the card is untouched.
 *  A CONSUMED file whose replacement cannot be written is unlinked too, so the hook never serves the last compaction's id as
 *  this one's (D-5059's arm). */
function steerArtifact(db, ictx, id, uuid, p, atEof, mayWrite, recorded) {
  const dir = steerDirOf(ictx.home, id);
  const dirKind = lstatKind(dir);
  if (dirKind !== 'dir' && dirKind !== 'absent') {
    if (atEof) bump(db, 'steer_dir_refused');
    return;
  }
  const file = steerFileOf(ictx.home, id, uuid);
  const current = dirKind === 'absent' ? { state: 'absent' } : readSteerFile(file);
  const { prediction, composeFailed } = steerPredictionOf(db, ictx, p, mayWrite);
  if (composeFailed) bump(db, 'steer_compose_failed');
  const d = decideCardFile({ current, prediction, atEof: mayWrite, artifact: 'steer' });
  const countConsumed = () => { bump(db, 'steer_consumed'); };
  // The file goes: a record that was due and is not acted on, or a consumed file whose replacement cannot be written (an unlink
  // succeeds where a write meets ENOSPC). An absent file fails the unlink with ENOENT and is not counted.
  const failClosed = () => {
    let gone = false;
    try {
      unlinkSync(file);
      gone = true;
    } catch { /* none stands, or it cannot be removed either: the next tick decides it again, counting nothing now */ }
    if (gone && !recorded) bump(db, 'steer_unrecorded_removed');
    if (gone && d.consumed) countConsumed();
  };
  if (!recorded) {
    failClosed();
    return;
  }
  try {
    if (dirKind === 'absent' && d.act === 'write') mkdirSync(dir, { mode: 0o700 });
    if (d.act === 'write') {
      writeSteerFile(file, prediction.line);
    } else if (d.act === 'delete') {
      unlinkSync(file);
    }
  } catch {
    bump(db, 'steer_write_failed');
    if (d.consumed) failClosed();
    return;
  }
  if (d.act === 'write') {
    try { removeOtherCards(dir, uuid); } catch { bump(db, 'steer_cleanup_failed'); }
    bump(db, 'steer_written');
  }
  if (d.consumed) countConsumed();
}

/** The consumer and the writer (§8.6 Timing, §9.2 step 6), over every session the registry names and every card file and
 *  steer file on disk, in a stable order, stopping at history-off. The run's budget is read before each WRITE (oneCard), never
 *  before the consume and delete decision, so a spent budget still consumes (ruling RC2). A history root's `card/` or `steer/`
 *  that is no real directory (absent before the tick's last step has made it, or a refused link) is not entered, and the other
 *  artifact is still acted on. */
export function consumeAndWriteCards(db, ictx, budget) {
  const out = { written: 0, consumed: 0, deleted: 0 };
  const base = historyPaths(ictx.home).root;
  const roots = { card: lstatKind(`${base}/${CARD_DIR}`) === 'dir', steer: lstatKind(`${base}/${STEER_DIR}`) === 'dir' };
  if (!roots.card && !roots.steer) return out;
  const s = cardStmts(db);
  const live = registeredPairs(ictx);
  const cands = new Map();
  for (const [id, uuid] of live) cands.set(`${id}/${uuid}`, { id, uuid });
  if (roots.card) for (const c of cardFilesUnder(`${base}/${CARD_DIR}`)) cands.set(`${c.id}/${c.uuid}`, c);
  if (roots.steer) for (const c of steerFilesUnder(`${base}/${STEER_DIR}`)) cands.set(`${c.id}/${c.uuid}`, c);
  for (const key of [...cands.keys()].sort()) {
    if (ictx.historyOff()) break;
    const { id, uuid } = cands.get(key);
    oneCard(db, s, ictx, budget, id, uuid, live.get(id) === uuid, roots, out);
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

/** Withdraws every `card/<id>/<uuid>.txt`, and every `steer/<id>/<uuid>.txt` with it (W3 Task 1B), when lib's decideCardWithdraw
 *  says the pass `pass` does. The path is lstat-checked where a link could be walked through: a `card/` or `steer/` (here) or a
 *  `card/<id>` or `steer/<id>` (filesUnder) that is a link or not a directory is never entered. Each name is then only unlinked, which removes a link itself, never its
 *  target, and refuses a directory; a name that cannot be unlinked is left for the next pass that withdraws. Counted
 *  `card_withdrawn:<reason>` on `db` (the steer files, `steer_withdrawn:<reason>`); a pass with no DB open (a hold before the
 *  open, where nothing is counted: IV2) prints `history-sweep: card_withdrawn:<reason> <n>` through `out` instead (and
 *  `history-sweep: steer_withdrawn:<reason> <n>`), beside its own word. A run pass that kept the rest passes `skipped`
 *  (ingestTick's uuids) and then also withdraws those sessions' predictions (withdrawSkippedCards, below; D-5061). Answers the
 *  number of card predictions withdrawn. */
export function withdrawCards(db, home, pass, out, skipped) {
  const n = withdrawAllCards(db, home, pass, out);
  return n + (skipped === undefined || db === null ? 0 : withdrawSkippedCards(db, home, skipped));
}

function withdrawAllCards(db, home, pass, out) {
  const d = decideCardWithdraw(pass);
  if (d.act !== 'withdraw') return 0;
  // The steer file goes with the card's prediction under the same verdict (W3 Task 1B), counted apart: `steer_withdrawn:<reason>`,
  // or a line beside the card's on a hold with no DB.
  let cards = 0;
  for (const [counter, dirName, filesOf, fileOf] of ARTIFACTS) {
    const root = `${historyPaths(home).root}/${dirName}`;
    if (lstatKind(root) !== 'dir') continue;
    let n = 0;
    for (const { id, uuid } of filesOf(root)) {
      try {
        unlinkSync(fileOf(home, id, uuid));
        n += 1;
      } catch { /* a directory under a card name, or a name already gone: left for the next pass that withdraws */ }
    }
    if (n > 0 && db !== null) bump(db, `${counter}_withdrawn:${d.reason}`, n);
    if (n > 0 && db === null) out(`history-sweep: ${counter}_withdrawn:${d.reason} ${n}`);
    if (counter === 'card') cards = n;
  }
  return cards;
}

/** The artifacts of the per-session step, in the order they are acted on: the counter family, the directory under the history
 *  root, the files on disk and a file's path. */
const ARTIFACTS = [
  ['card', CARD_DIR, cardFilesUnder, cardFileOf],
  ['steer', STEER_DIR, steerFilesUnder, steerFileOf],
];

/** Withdraws the predictions (and steer files) of the sessions whose transcript copy this pass could not read (the read error of D-4340), admission
 *  refused or whose parse crashed, `skipped` being ingestTick's uuids: such a copy was not read to its end, so it may hold the boundary
 *  that consumes the standing line, and the pass keeps the rest. lib's decideCardWithdraw (arm 'copy') decides per
 *  prediction; the record beside a prediction is left as it is. Answers the number withdrawn. The lost-hint shape stays: a boundary whose hint was lost
 *  and whose copy no pass has read waits for the 30-minute scan. D-5061 (history-card-withdraw-on-a-skipped-copy) */
export function withdrawSkippedCards(db, home, skipped) {
  if (skipped.size === 0) return 0;
  const uuids = [...skipped];
  let cards = 0;
  for (const [counter, dirName, filesOf, fileOf] of ARTIFACTS) {
    const root = `${historyPaths(home).root}/${dirName}`;
    if (lstatKind(root) !== 'dir') continue;
    let n = 0;
    let reason = null;   // lib's word for the last prediction withdrawn: the arm answers one word, which is counted as lib spells it
    for (const { id, uuid } of filesOf(root)) {
      const d = decideCardWithdraw({ arm: 'copy', uuid, skipped: uuids });
      if (d.act !== 'withdraw') continue;
      try {
        unlinkSync(fileOf(home, id, uuid));
        n += 1;
        reason = d.reason;
      } catch { /* a directory under a card name, or a name already gone: left for the next pass that skips the copy */ }
    }
    if (n > 0) bump(db, `${counter}_withdrawn:${reason}`, n);
    if (counter === 'card') cards = n;
  }
  return cards;
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

// ── Purged sessions' files (spec §9.4: history-scope-markers and history-card-files, "the files of purged sessions
// after 7 days"; W1-B3 Task 7) ──────────────────────────────────────────────────────────────────────────────────────
// At the periodic scan, every scope/<id> and card/<id> whose session the registry no longer names (`$REG/<id>.uuid`
// absent; ccd's _reg_purge removes every field of the id) and whose newest write is more than PURGED_FILES_GRACE_MS
// old is removed (lib decidePurgedEntry decides). ccd's purge leaves no time to read, so the age is the entry's own
// newest write. D-4745 (history-purged-files-aged-by-mtime)
// Removal never follows a link and never recurses: a link or a file is unlinked; a card directory has its links and
// files unlinked and is removed, unless it holds a directory, which this writer never makes. Only scope/ and card/ are
// walked, and only names that pass idOk. A failure leaves the rest for the next scan.

/** `$REG/<id>.uuid` by lstat: present, absent (ENOENT), or unmeasured (any other failure). */
function registryKind(reg, id) {
  try {
    lstatSync(`${reg}/${id}.uuid`);
  } catch (e) {
    return e && e.code === 'ENOENT' ? 'absent' : 'unmeasured';
  }
  return 'present';
}

/** An entry's newest write, by lstat (a link's own time): itself, and each entry of a real directory; null when any of
 *  them cannot be measured. */
function newestMtimeMs(p) {
  let st;
  try { st = lstatSync(p); } catch { return null; }
  let newest = st.mtimeMs;
  if (!st.isDirectory()) return newest;
  let names;
  try { names = readdirSync(p); } catch { return null; }
  for (const n of names) {
    try { newest = Math.max(newest, lstatSync(`${p}/${n}`).mtimeMs); } catch { return null; }
  }
  return newest;
}

/** Removes one scope marker or card directory without following a link. Answers whether it is gone. */
function removePurgedEntry(p) {
  try {
    const st = lstatSync(p);
    if (!st.isDirectory()) {
      unlinkSync(p);
      return true;
    }
    const names = readdirSync(p).sort();
    if (names.some((n) => lstatSync(`${p}/${n}`).isDirectory())) return false;
    for (const n of names) unlinkSync(`${p}/${n}`);
    rmdirSync(p);
    return true;
  } catch {
    return false;
  }
}

/** The scan's collection of purged sessions' scope markers, card directories and steer directories (§9.4), counted
 *  `scope_files_purged`, `card_files_purged` and `steer_files_purged`. `steer/.lanes/` is never entered. A registry directory that cannot be listed measures no session absent,
 *  so then nothing is removed. */
export function collectPurgedHistoryFiles(db, home, nowMs) {
  const P = historyPaths(home);
  const out = { scope: 0, card: 0, steer: 0 };
  if (lstatKind(P.reg) !== 'dir') return out;
  for (const [kind, name, idGate] of [['scope', SCOPE_DIR, idOk], ['card', CARD_DIR, idOk], ['steer', STEER_DIR, steerIdOk]]) {
    const dir = `${P.root}/${name}`;
    if (lstatKind(dir) !== 'dir') continue;
    let ids;
    try { ids = readdirSync(dir).sort(); } catch { continue; }
    for (const id of ids) {
      if (!idGate(id)) continue;   // steer/.lanes/ is never entered: it is the lane map's, not a session's
      const verdict = decidePurgedEntry({ reg: registryKind(P.reg, id), newestMtimeMs: newestMtimeMs(`${dir}/${id}`), nowMs });
      if (verdict === 'remove' && removePurgedEntry(`${dir}/${id}`)) out[kind] += 1;
    }
  }
  if (out.scope > 0) bump(db, 'scope_files_purged', out.scope);
  if (out.card > 0) bump(db, 'card_files_purged', out.card);
  if (out.steer > 0) bump(db, 'steer_files_purged', out.steer);
  return out;
}
