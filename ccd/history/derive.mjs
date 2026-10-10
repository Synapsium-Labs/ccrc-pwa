// ccd/history/derive.mjs: node derivation inside the sweep's tick (spec 2026-10-05 §6.1 span rule and forks,
// §6.2 `nodes` and the producer, §6.3, §7.4; W1-B2 plan Tasks 8 and 9).
//
// L4 delivery. It reads the store and, for one field, the source line a summary row came from, and hands every
// decision to lib.mjs (L1): planSpans, summaryRowFor, pickHoldingCopy, leafReady, decideLeafId, pickReceipt, the
// block parser and the native gist, forkCounts. It imports ../compact-card.mjs for the card's heading rules and
// token miner and injects them into lib as a toolkit (§6.4), so lib.mjs stays node:crypto-only. sweep.mjs imports
// this module, and this module imports nothing of the sweep back: the sweep helpers it needs (admitFile,
// budgetLeft, isBusy) arrive on the ingest context. It reads no environment. An in-process test may set
// ictx.nodeKit to replace the toolkit (history-test-seams-not-env); the sweep never sets it.
//
// Nodes are DERIVED: a rebuild re-derives every leaf with the same id from entries, memberships and boundaries
// (§6.1, §9.14), so nothing here journals. Each leaf commits in its own NORMAL transaction.
import { closeSync, readSync } from 'node:fs';
import { HEADING_RE, fencedRanges, mineTokens } from '../compact-card.mjs';
import {
  LINE_MAX, NODE_PARSER_VERSION, blobOverDecodeCap, blockFields, blockStatus, capRefs, classifyRef, decideLeafId, directionOfSummaryRow,
  directiveFlag, eofAfterBoundary, forkCounts, ftsTextOf, gistSha, leafId, leafReady, nativeGist, nativeTopics, nodeIndexTexts,
  parseBlocks, pickHoldingCopy, pickReceipt, planSpans, producerOfCopy, redactField, selectBlock, summaryParts,
  summaryRowFor,
} from './lib.mjs';
import { bump, getStep, setStep, unbrotli, withTx } from './store.mjs';

/** derivation_state steps this module keeps (§6.2). None is the 'recover' step status reads. */
const LEAF_STEP = 'leaves';                   // version NODE_PARSER_VERSION; cursor: every boundary at or below it has its leaf or a LEAF_CRASHED_STEP marker
const UNSPANNED_STEP = 'rows-unspanned';      // version = transcript_pk; cursor: '<rows_unspanned folded>:<live bytes read then>'
const FORKED_STEP = 'transcript-forked';      // version = transcript_pk; present once transcript_forked is counted
const LEAF_CRASHED_STEP = 'leaf-crashed';     // version = boundary entry_id; cursor: the NODE_PARSER_VERSION it crashed under (RB5)
/** A summary's source line is read in pieces this size, never past LINE_MAX. */
const LINE_PIECE = 64 * 1024;

const DERIVE_STMTS = new WeakMap();
const NODES_FTS_STMTS = new WeakMap();

/** The prepared statements, one set per connection. Each names its columns. A row's copies are found through
 *  (file_id, entry_id), the memberships primary key: v1 has no index on entry_id alone, on purpose. `todo` and
 *  `firstTodo` take (low, LEAF_CRASHED_STEP, String(NODE_PARSER_VERSION)): a boundary with a crash marker at this parser
 *  version is not to do (RB5). */
function stmts(db) {
  let s = DERIVE_STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    todo: db.prepare(`SELECT b.entry_id AS entry_id, e.uuid AS uuid, e.ts_ms AS ts_ms, b.transcript_pk AS transcript_pk,
        t.cc_session_uuid AS cc_uuid
      FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id JOIN transcripts t ON t.transcript_pk = b.transcript_pk
      WHERE b.entry_id > ? AND t.agent_id = ''
        AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.boundary_entry_id = b.entry_id)
        AND NOT EXISTS (SELECT 1 FROM derivation_state d WHERE d.step = ? AND d.version = b.entry_id AND d.cursor = ?)
      ORDER BY b.entry_id`),
    firstTodo: db.prepare(`SELECT min(b.entry_id) AS e FROM boundaries b JOIN transcripts t ON t.transcript_pk = b.transcript_pk
      WHERE b.entry_id > ? AND t.agent_id = ''
        AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.boundary_entry_id = b.entry_id)
        AND NOT EXISTS (SELECT 1 FROM derivation_state d WHERE d.step = ? AND d.version = b.entry_id AND d.cursor = ?)`),
    lastBoundary: db.prepare(`SELECT max(b.entry_id) AS e FROM boundaries b JOIN transcripts t ON t.transcript_pk = b.transcript_pk
      WHERE t.agent_id = ''`),
    epochOf: db.prepare(`SELECT e.session_pk AS session_pk, e.seq AS seq, s.ccrc_id AS ccrc_id
      FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk
      WHERE e.cc_session_uuid = ? AND e.confirmed_ms IS NOT NULL AND s.merged_into IS NULL
      ORDER BY e.session_pk LIMIT 1`),
    files: db.prepare('SELECT file_id, eof_ms, source_key FROM ingest_files WHERE transcript_pk = ? ORDER BY file_id'),
    liveFiles: db.prepare("SELECT file_id FROM ingest_files WHERE transcript_pk = ? AND source_key = '' ORDER BY file_id"),
    member: db.prepare('SELECT 1 AS hit FROM memberships WHERE file_id = ? AND entry_id = ?'),
    copySize: db.prepare('SELECT count(*) AS n FROM memberships WHERE file_id = ?'),
    /** Distinct rows over a JSON list of file_ids: the union of some copies, counted in SQLite, never in a JS Set. */
    rowsIn: db.prepare('SELECT count(DISTINCT entry_id) AS n FROM memberships WHERE file_id IN (SELECT value FROM json_each(?))'),
    /** Main transcripts with two or more live copies, and the bytes read from them: the ones whose fork counts can
     *  change, and the cheap measure of whether they did. */
    forkCandidates: db.prepare(`SELECT f.transcript_pk AS transcript_pk, sum(f.offset) AS bytes
      FROM ingest_files f JOIN transcripts t ON t.transcript_pk = f.transcript_pk
      WHERE f.source_key = '' AND t.agent_id = ''
      GROUP BY f.transcript_pk HAVING count(*) > 1`),
    copyRows: db.prepare(`SELECT m.line AS line, e.entry_id AS entry_id, e.uuid AS uuid, e.type AS type,
        e.provenance AS provenance, e.is_compact_summary AS is_compact_summary, e.ts_ms AS ts_ms, e.model AS model,
        e.tool_name AS tool_name, e.blob_id AS blob_id, bl.raw_len AS raw_len,
        CASE WHEN b.entry_id IS NULL THEN 0 ELSE 1 END AS is_boundary, b.head_uuid AS head_uuid,
        b.anchor_uuid AS anchor_uuid, b.kept_blob_id AS kept_blob_id
      FROM memberships m JOIN entries e ON e.entry_id = m.entry_id JOIN blobs bl ON bl.blob_id = e.blob_id
      LEFT JOIN boundaries b ON b.entry_id = e.entry_id
      WHERE m.file_id = ? ORDER BY m.line`),
    memberLine: db.prepare(`SELECT m.line AS line, e.uuid AS uuid FROM memberships m JOIN entries e ON e.entry_id = m.entry_id
      WHERE m.file_id = ? AND m.entry_id = ?`),
    blobZ: db.prepare('SELECT z FROM blobs WHERE blob_id = ?'),
    blobLen: db.prepare('SELECT raw_len FROM blobs WHERE blob_id = ?'),
    paths: db.prepare('SELECT path FROM file_paths WHERE file_id = ? ORDER BY path'),
    receipts: db.prepare('SELECT leaf_id, ts_ms FROM steer_receipts WHERE cc_session_uuid = ? ORDER BY ts_ms, event_key'),
    nodeBound: db.prepare('SELECT boundary_entry_id FROM nodes WHERE node_id = ?'),
    priorGists: db.prepare('SELECT node_id, gist FROM nodes WHERE session_pk = ? AND depth = 0 AND gist IS NOT NULL'),
    leafBoundaries: db.prepare('SELECT boundary_entry_id FROM nodes WHERE transcript_pk = ? AND depth = 0 AND boundary_entry_id IS NOT NULL'),
    insNode: db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics,
        summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars,
        directive_flag, capped, parser_version, created_ms)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`),
    insSource: db.prepare('INSERT INTO node_sources (node_id, entry_id, ord) VALUES (?, ?, ?)'),
    insRef: db.prepare(`INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)
      ON CONFLICT (node_id, kind, value) DO NOTHING`),
    nodeRowid: db.prepare('SELECT rowid AS r FROM nodes WHERE node_id = ?'),
  };
  DERIVE_STMTS.set(db, s);
  return s;
}

/** The card's heading rules and token miner, as lib's native gist and refs take them (§6.4). lib never imports
 *  compact-card.mjs; it receives this. */
export function nodeToolkit() {
  return Object.freeze({ HEADING_RE, fencedRanges, mineTokens });
}

/** The two lookups node derivation and the read verbs make by a column no v1 index covers: a boundary's leaf,
 *  and a child's parent. Created by derivation, as the FTS tables are (§9.1), so no schema migration (which every
 *  real store would escalate to snapshot-needs-op, §6.11) is spent on them. D-4703 (history-node-indexes-by-derivation) */
export function ensureNodeIndexes(db) {
  db.exec('CREATE INDEX IF NOT EXISTS nodes_boundary ON nodes(boundary_entry_id)');
  db.exec('CREATE INDEX IF NOT EXISTS node_children_child ON node_children(child_id)');
}

/** One line from `offset`, without its '\n'; null when no '\n' falls within LINE_MAX bytes or before EOF. */
function readLineAt(fd, offset, size) {
  const parts = [];
  let got = 0;
  for (let pos = offset; pos < size && got < LINE_MAX;) {
    const want = Math.min(LINE_PIECE, size - pos, LINE_MAX - got);
    const buf = Buffer.allocUnsafe(want);
    const n = readSync(fd, buf, 0, want, pos);
    if (n === 0) break;
    const nl = buf.subarray(0, n).indexOf(0x0a);
    if (nl >= 0) {
      parts.push(buf.subarray(0, nl));
      return Buffer.concat(parts).toString('utf8');
    }
    parts.push(buf.subarray(0, n));
    got += n;
    pos += n;
  }
  return null;
}

/** A summary row's `summarizeMetadata.direction`, read back from its own line in the copy that holds it (§7.4
 *  item 8): the store keeps the row's message only. The file is opened through the sweep's own admission
 *  (O_NOFOLLOW, a regular file, realpath under a rostered projects/ root), the line read at its membership's byte
 *  offset, bounded at LINE_MAX, and believed only when its uuid is the row's. Anything else is null: the pair then
 *  follows the text. D-4704 (history-summary-direction-from-source-line) */
export function summaryDirectionOf(db, ictx, summaryEntryId, fileId) {
  const s = stmts(db);
  const m = s.memberLine.get(fileId, summaryEntryId);
  if (m === undefined) return null;
  for (const { path: p } of s.paths.all(fileId)) {
    const home = ictx.homes.find((h) => p.startsWith(`${h}/`));
    if (home === undefined) continue;
    const a = ictx.admitFile(p, home, ictx.homes, ictx.home);
    if (!a.ok) continue;
    try {
      let text;
      try { text = readLineAt(a.fd, Number(m.line), Number(a.st.size)); } catch { return null; }
      if (text === null) return null;
      let row;
      try { row = JSON.parse(text); } catch { return null; }
      return row !== null && typeof row === 'object' && row.uuid === m.uuid ? directionOfSummaryRow(row) : null;
    } finally {
      closeSync(a.fd);
    }
  }
  return null;
}

/** A stored body, parsed; null for a tombstone (z NULL), a raw-only blob that is not JSON, or a body over B1's
 *  decode cap (or with no measured raw_len), which is never decoded whole. B1's unbrotli needs the stored raw_len as
 *  its bound and throws without it, as B1's own storedBody passes it. The blob's raw_len is read by a statement of
 *  its own so that blobZ keeps the SQL Task 21's fault seam matches. Its compressed bytes count against the run's
 *  byte budget, as the FTS backfill's do. */
function bodyOf(s, blobId, budget) {
  const r = s.blobZ.get(blobId);
  if (r === undefined || r.z === null) return null;
  const rawLen = s.blobLen.get(blobId)?.raw_len;
  if (blobOverDecodeCap(rawLen)) return null;   // B1's history-permanent-failures-classified: an over-cap or unmeasured body is never decoded whole
  budget.bytes += r.z.length;
  try { return JSON.parse(unbrotli(r.z, rawLen).toString('utf8')); } catch { return null; }
}

function textOf(s, blobId, budget) {
  const body = bodyOf(s, blobId, budget);
  return body === null ? null : ftsTextOf(body, 'entry');
}

/** A boundary's kept list (preservedMessages.allUuids, stored as its own blob by B1's ingest), as a set. */
function keptOf(s, blobId, budget) {
  if (blobId === null) return new Set();
  const v = bodyOf(s, blobId, budget);
  return new Set(Array.isArray(v) ? v.filter((u) => typeof u === 'string') : []);
}

function epochFor(s, pass, ccUuid) {
  if (!pass.epochs.has(ccUuid)) pass.epochs.set(ccUuid, s.epochOf.get(ccUuid) ?? null);
  return pass.epochs.get(ccUuid);
}

/** The copy that holds boundary `b` (§6.1 "The copy"), decided by lib's pickHoldingCopy over what this measures:
 *  each of the transcript's files, whether it is live (source_key '') and whether it has the boundary row as a
 *  member. Answers that file's ingest_files row ({ file_id, eof_ms, source_key }), or null. Task 9's fan-in and
 *  Task 21's reparse call it too: `pass` needs only `{ files: Map }`, `b` only `{ entry_id, transcript_pk }`. */
function holdingCopy(s, pass, b) {
  let files = pass.files.get(b.transcript_pk);
  if (files === undefined) {
    files = s.files.all(b.transcript_pk);
    pass.files.set(b.transcript_pk, files);
  }
  const fileId = pickHoldingCopy(files.map((f) => ({
    fileId: Number(f.file_id), live: f.source_key === '', holds: s.member.get(f.file_id, b.entry_id) !== undefined,
  })));
  return fileId === null ? null : files.find((f) => Number(f.file_id) === fileId);
}

/** The newest stamped row's time at or before `uuid` in the copy's file order: the boundary's own time when it has
 *  one. lib's raw-leaf grace reads it (D-4690 (history-raw-leaf-grace)); null only when no row up to it has a time. */
function stampAtOrBefore(copy, uuid) {
  for (let i = copy.index.get(uuid); i >= 0; i -= 1) {
    const t = copy.rows[i].ts_ms;
    if (t !== null) return Number(t);
  }
  return null;
}

/** One copy's rows in file order, each of its boundaries' summary pick, and lib's spans over them. Kept for the
 *  next boundary of the same copy, the common case: boundaries come in entry order. */
function copyPlan(s, pass, fileId, budget) {
  if (pass.copy !== null && pass.copy.fileId === fileId) return pass.copy;
  const rows = s.copyRows.all(fileId);
  const index = new Map(rows.map((r, i) => [r.uuid, i]));
  const meta = rows.map((r) => ({ uuid: r.uuid, isCompactSummary: r.is_compact_summary === 1, isEcho: r.type === 'user' && r.provenance === 'harness' }));
  const picks = new Map();
  const boundaries = [];
  for (const r of rows) {
    if (r.is_boundary !== 1) continue;
    const pick = summaryRowFor({ boundaryUuid: r.uuid, anchorUuid: r.anchor_uuid, rows: meta });
    picks.set(r.uuid, pick);
    boundaries.push({ uuid: r.uuid, headUuid: r.head_uuid, kept: keptOf(s, r.kept_blob_id, budget), summaryUuid: pick.uuid });
  }
  const plan = planSpans({
    rows: rows.map((r) => ({ uuid: r.uuid, pos: Number(r.line), isBoundary: r.is_boundary === 1, isSummary: r.is_compact_summary === 1 })),
    boundaries,
  });
  const copy = { fileId, rows, index, picks, boundaries, leafOf: new Map(plan.leaves.map((l) => [l.boundaryUuid, l])) };
  pass.copy = copy;
  return copy;
}

function previousBoundary(copy, uuid) {
  const k = copy.boundaries.findIndex((x) => x.uuid === uuid);
  return k > 0 ? copy.boundaries[k - 1] : null;
}

/** The previous boundary's summary text in the same copy (nativeTopics compares against it), or null. */
function prevSummaryText(s, copy, uuid, budget) {
  const prev = previousBoundary(copy, uuid);
  if (prev === null || prev.summaryUuid === null) return null;
  const i = copy.index.get(prev.summaryUuid);
  return i === undefined ? null : textOf(s, copy.rows[i].blob_id, budget);
}

function receiptsOf(s, ccUuid) {
  return s.receipts.all(ccUuid).map((r) => ({ leafId: r.leaf_id, tsMs: r.ts_ms }));
}

/** The receipt window of boundary `b` (§7.4 item 2): after the previous boundary of the same copy, up to this one. */
function receiptWindow(copy, b, id) {
  const prev = previousBoundary(copy, b.uuid);
  return { id, afterMs: prev === null ? null : copy.rows[copy.index.get(prev.uuid)].ts_ms, uptoMs: b.ts_ms };
}

/** The refs mined from a span's tool_use rows (§7.4 item 7, origin `tool_use`): compact-card's miner over the
 *  rows' tool_use blocks, cut to the inputs it reads, each token redacted (a ref is stored and indexed) and
 *  classified. With no graph the miner reads Edit-shaped and Read paths only (§6.4). */
function minedRefs(s, kit, sources, pairIdx, budget) {
  const lines = [];
  for (const r of sources) {
    if (r.type !== 'assistant' || r.tool_name === null) continue;
    const body = bodyOf(s, r.blob_id, budget);
    const uses = (Array.isArray(body) ? body : []).filter((x) => x !== null && typeof x === 'object' && x.type === 'tool_use')
      .map((x) => ({ type: 'tool_use', name: x.name, input: { file_path: x.input?.file_path, notebook_path: x.input?.notebook_path, command: x.input?.command } }));
    if (uses.length > 0) lines.push(JSON.stringify({ type: 'assistant', message: { content: uses } }));
  }
  const out = [];
  for (const { token } of kit.mineTokens(lines.join('\n'), null)) {
    const value = redactField(token, pairIdx);
    const kind = classifyRef(value);
    if (kind !== null) out.push({ kind, value, origin: 'tool_use' });
  }
  return out;
}

/** A node's nodes_fts row, rowid = nodes.rowid (§6.2): its gist, topics and ref values through lib's nodeIndexTexts with
 *  `idx`, the pair index its fields were derived with (W1-B2 Task 7A: B1's escape readings and the belt, so nodes_fts
 *  holds no term blobs_fts masks). Deleted first, so a later backfill or re-derivation of the same node never
 *  duplicates it. */
function indexNode(db, s, id, gist, topics, refs, idx) {
  let f = NODES_FTS_STMTS.get(db);
  if (f === undefined) {
    f = {
      del: db.prepare('DELETE FROM nodes_fts WHERE rowid = ?'),
      ins: db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) VALUES (?, ?, ?, ?)'),
    };
    NODES_FTS_STMTS.set(db, f);
  }
  const rowid = s.nodeRowid.get(id).r;
  f.del.run(rowid);
  const t = nodeIndexTexts({ gist, topics, refs: refs.map((r) => r.value) }, idx);
  f.ins.run(rowid, t.gist, t.topics, t.refs);
}

/** One leaf's derived fields from its stored summary (§7.4): kind, status and its reason, gist, topics, refs, the
 *  capped and directive flags, the producer and the counters the derivation folds. deriveOne writes them for a new
 *  leaf; W1-B2 Task 21's refreshLeaf rewrites them for an existing one, never its id, span or sources.
 *  - No summary row, or one stored but unreadable (a tombstone, a body that is not JSON): a raw leaf (§6.1), its
 *    summary blob still recorded when the row exists.
 *  - With no steer receipt the status is not-requested, reason no-receipt (§7.4 item 2): `absent` comes only from
 *    blockStatus, on the receipt path. A raw leaf never looks a receipt up.
 *  - A carried copy is counted by blockStatus' own reason. The prior gists are hashed with gistSha, the hash the
 *    block's gist gets, over the stored form; a prior gist of the leaf itself never counts. */
function leafFields(db, ictx, kit, s, copy, b, pick, id, sessionPk, sources, budget) {
  const summaryAt = pick.uuid === null ? undefined : copy.index.get(pick.uuid);
  const summary = summaryAt === undefined ? null : copy.rows[summaryAt];
  const backend = producerOfCopy(copy.rows, summaryAt ?? copy.index.get(b.uuid));
  const counts = [];
  let kind = 'raw_leaf';
  let status = 'not-requested';
  let reason = 'no-receipt';
  let gist = null;
  let topics = null;
  let modelRefs = [];
  let capped = false;
  const text = summary === null ? null : textOf(s, summary.blob_id, budget);
  if (summary === null) {
    counts.push('summary_missing');
  } else if (text === null) {
    counts.push('summary_unreadable');
  } else {
    kind = 'native_leaf';
    topics = [];
    if (summaryParts(text).unclosed) counts.push(`summary_unclosed:${backend}`);
    const receipt = pickReceipt(receiptsOf(s, b.cc_uuid), receiptWindow(copy, b, id));
    let steered = null;
    if (receipt !== null) {
      const blocks = parseBlocks(redactField(text, ictx.pairIdx));
      const sel = selectBlock({ blocks, kind: 'leaf', computedId: id, generic: receipt.leafId === '' });
      const prior = new Set(s.priorGists.all(sessionPk).filter((r) => r.node_id !== id).map((r) => gistSha(r.gist)));
      const verdict = blockStatus({ receipt: true, block: sel.block, idMismatch: sel.idMismatch, priorGistShas: prior });
      status = verdict.status;
      reason = verdict.reason;
      if (sel.idMismatch) counts.push('id_mismatch');
      if (sel.block === null && blocks.some((x) => x.inAnalysis)) counts.push(`analysis_only:${backend}`);
      if (verdict.reason === 'carried-copy') counts.push('carried_copies');
      if (status === 'ok' || status === 'degraded') steered = blockFields(sel.block);
    }
    if (steered !== null) {
      kind = 'steered_leaf';
      gist = steered.gist;
      topics = steered.topics;
      modelRefs = steered.refs;
      capped = steered.capped;
    } else {
      const direction = summaryDirectionOf(db, ictx, summary.entry_id, copy.fileId);
      const g = nativeGist({ text, direction }, kit, ictx.pairIdx);
      const t = nativeTopics({ text, prevText: prevSummaryText(s, copy, b.uuid, budget) }, kit, ictx.pairIdx);
      gist = g.gist;
      topics = t.topics;
      capped = g.capped || t.capped;
    }
  }
  const refs = capRefs([...modelRefs, ...minedRefs(s, kit, sources, ictx.pairIdx, budget)]);
  const flag = gist !== null && directiveFlag([gist, ...(topics ?? [])].join('\n'));
  return { summary, backend, counts, kind, status, reason, gist, topics, refs, capped, flag, crashed: false };
}

/** A leaf whose parser threw (RB5): written under its own id with its span and sources, kind raw_leaf, status
 *  parse-failed, no gist, topics or refs, and its summary row's blob still recorded, so reparse (Task 21) re-derives
 *  it in place. Counted parser_crash once and no compliance outcome. D-4706 (history-parser-crash-recorded) */
function parseFailedFields(copy, pick) {
  const at = pick.uuid === null ? undefined : copy.index.get(pick.uuid);
  return {
    summary: at === undefined ? null : copy.rows[at], backend: null, counts: ['parser_crash'], kind: 'raw_leaf',
    status: 'parse-failed', reason: null, gist: null, topics: null, refs: { refs: [], capped: false }, capped: false,
    flag: false, crashed: true,
  };
}

/** One boundary's leaf (§6.1, §7.4), or why it waits: no confirmed epoch yet (out of every scope), no holding
 *  copy, or not ready (lib leafReady: a raw leaf is never written while it could still be native). The boundary's
 *  time for the raw-leaf grace is its own, or the newest stamped row before it in the holding copy. */
function deriveOne(db, ictx, kit, s, pass, b, budget) {
  const ep = epochFor(s, pass, b.cc_uuid);
  if (ep === null) return 'waiting';
  // This tick renamed, but did not drain, an event file that can name this session. A steer receipt there could affect
  // this leaf, so leave it mutable until the next tick; unrelated session leaves still finalize normally.
  if (ictx.pendingReceiptSessionUuids?.has(b.cc_uuid)) return 'waiting';
  const holding = holdingCopy(s, pass, b);
  if (holding === null) return 'waiting';
  const copy = copyPlan(s, pass, holding.file_id, budget);
  const leaf = copy.leafOf.get(b.uuid);
  if (leaf === undefined) return 'waiting';
  const pick = copy.picks.get(b.uuid);
  const ready = leafReady({
    summaryStored: pick.uuid !== null,
    fileAtEofAfterBoundary: eofAfterBoundary({ eofMs: holding.eof_ms, boundaryTsMs: stampAtOrBefore(copy, b.uuid) }),
  });
  if (!ready) return 'waiting';
  const plain = leafId(ep.ccrc_id, b.cc_uuid, leaf.spanStartUuid);
  const bound = s.nodeBound.get(plain);
  const plainBoundOther = bound !== undefined && bound.boundary_entry_id !== b.entry_id;
  const { id, forked } = decideLeafId({ ccrcId: ep.ccrc_id, ccUuid: b.cc_uuid, spanStartUuid: leaf.spanStartUuid, boundaryUuid: b.uuid, plainBoundOther });
  const sources = leaf.sources.map((u) => copy.rows[copy.index.get(u)]);
  let f;
  try {
    f = leafFields(db, ictx, kit, s, copy, b, pick, id, ep.session_pk, sources, budget);
  } catch (e) {
    if (ictx.isBusy(e)) throw e;
    // RB5: the parser threw (a bug). The leaf is written anyway, parse-failed, and only reparse re-derives it.
    f = parseFailedFields(copy, pick);
  }
  const { summary, counts, kind, status, reason, gist, topics, refs, capped, flag, backend, crashed } = f;
  let earliest = null;
  let latest = null;
  let srcChars = 0;
  for (const r of sources) {
    if (r.ts_ms !== null && (earliest === null || r.ts_ms < earliest)) earliest = r.ts_ms;
    if (r.ts_ms !== null && (latest === null || r.ts_ms > latest)) latest = r.ts_ms;
    srcChars += Number(r.raw_len);
  }
  withTx(db, 'NORMAL', () => {
    s.insNode.run(id, ep.session_pk, ep.seq, b.transcript_pk, kind, status, gist,
      topics === null ? null : JSON.stringify(topics), summary === null ? null : summary.blob_id,
      b.entry_id, leaf.spanStartUuid, earliest, latest, srcChars, flag ? 1 : 0, capped || refs.capped ? 1 : 0,
      NODE_PARSER_VERSION, ictx.nowMs);
    sources.forEach((r, ord) => { s.insSource.run(id, r.entry_id, ord); });
    for (const r of refs.refs) s.insRef.run(id, r.kind, r.value, r.origin);
    if (ictx.fts === true) indexNode(db, s, id, gist, topics, refs.refs, ictx.pairIdx);
    if (forked) bump(db, 'leaf_id_forked');
    if (leaf.headMissing) bump(db, 'head_missing');
    if (summary !== null && pick.anchorIsBoundary) bump(db, 'anchor_is_boundary');
    for (const c of counts) bump(db, c);
    // §7.4 item 10: compliance by status and by reason, each by producer. A parser crash is no outcome.
    if (!crashed) {
      bump(db, `leaf_status:${status}:${backend}`);
      if (reason !== null) bump(db, `leaf_reason:${reason}:${backend}`);
    }
  });
  return 'derived';
}

/** The rows-unspanned cursor: '<rows_unspanned already folded>:<live bytes read when folded>'. No row, or one this
 *  build cannot read, is "never folded". */
function foldedOf(step) {
  const m = step === null || step.cursor === null ? null : /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(step.cursor);
  return m === null ? { unspanned: 0, bytes: null } : { unspanned: Number(m[1]), bytes: Number(m[2]) };
}

/** A main transcript's fork counters (§6.1), from lib's forkCounts over what this measures on its LIVE copies:
 *  - rows_unspanned: rows no holding copy has (they join no leaf), folded as the increase over the count already
 *    recorded;
 *  - transcript_forked: once, when it has two or more live copies and none holds every row.
 *  The holding copy of each leaf's boundary is lib's pickHoldingCopy among the live copies. `bytes` is the live
 *  copies' bytes read now, kept beside the folded count so the next tick knows whether to recount. */
function recountTranscript(db, s, transcriptPk, nowMs, bytes) {
  const live = s.liveFiles.all(transcriptPk).map((f) => Number(f.file_id));
  const holding = new Set();
  for (const { boundary_entry_id: e } of s.leafBoundaries.all(transcriptPk)) {
    const f = pickHoldingCopy(live.map((id) => ({ fileId: id, live: true, holds: s.member.get(id, e) !== undefined })));
    if (f !== null) holding.add(f);
  }
  const { unspanned, forked } = forkCounts({
    liveSizes: live.map((f) => Number(s.copySize.get(f).n)),
    unionSize: Number(s.rowsIn.get(JSON.stringify(live)).n),
    coveredSize: Number(s.rowsIn.get(JSON.stringify([...holding])).n),
    holdingCopies: holding.size,
  });
  const prev = foldedOf(getStep(db, UNSPANNED_STEP, transcriptPk));
  const marked = getStep(db, FORKED_STEP, transcriptPk) !== null;
  withTx(db, 'NORMAL', () => {
    if (unspanned > prev.unspanned) bump(db, 'rows_unspanned', unspanned - prev.unspanned);
    setStep(db, UNSPANNED_STEP, transcriptPk, `${unspanned}:${bytes}`);
    if (forked && !marked) { bump(db, 'transcript_forked'); setStep(db, FORKED_STEP, transcriptPk, '1', nowMs); }
  });
}

/** Every boundary without its leaf, in entry order, within the run's budget (§9.2 step 6); then the fork counts
 *  of every main transcript with two or more live copies whose bytes read changed, or which gained a leaf.
 *  - A throw inside the parser is deriveOne's: the leaf is written parse-failed (RB5).
 *  - A throw before a leaf can be written (span planning, an insert refused) counts parser_crash once and leaves a
 *    ('leaf-crashed', entry_id) marker at this NODE_PARSER_VERSION, in one transaction: the todo queries skip the
 *    boundary, so the cursor moves past it and no tick parses it again. Reparse clears the markers (Task 21); a new
 *    NODE_PARSER_VERSION retries them. D-4706 (history-parser-crash-recorded)
 *  - A busy store ends the tick, as ingest's does.
 *  The cursor ('leaves', NODE_PARSER_VERSION) is the low-water mark: every boundary at or below it has its leaf or a
 *  crash marker, and a boundary that waits holds it. */
export function deriveLeaves(db, ictx, budget) {
  ensureNodeIndexes(db);
  const s = stmts(db);
  const kit = ictx.nodeKit ?? nodeToolkit();
  const crashedAt = String(NODE_PARSER_VERSION);
  const low = Number(getStep(db, LEAF_STEP, NODE_PARSER_VERSION)?.cursor ?? 0);
  const pass = { copy: null, epochs: new Map(), files: new Map() };
  const touched = new Set();
  let derived = 0;
  let waiting = 0;
  let failed = 0;
  for (const b of s.todo.all(low, LEAF_CRASHED_STEP, crashedAt)) {
    if (!ictx.budgetLeft(budget)) break;
    let r;
    try {
      r = deriveOne(db, ictx, kit, s, pass, b, budget);
    } catch (e) {
      if (ictx.isBusy(e)) throw e;
      withTx(db, 'NORMAL', () => {
        bump(db, 'parser_crash');
        setStep(db, LEAF_CRASHED_STEP, Number(b.entry_id), crashedAt, ictx.nowMs);
      });
      r = 'failed';
    }
    if (r === 'derived') {
      derived += 1;
      touched.add(Number(b.transcript_pk));
    } else if (r === 'failed') {
      failed += 1;
    } else {
      waiting += 1;
    }
  }
  for (const c of s.forkCandidates.all()) {
    if (!ictx.budgetLeft(budget)) break;
    const pk = Number(c.transcript_pk);
    const bytes = Number(c.bytes);
    if (touched.has(pk) || foldedOf(getStep(db, UNSPANNED_STEP, pk)).bytes !== bytes) recountTranscript(db, s, pk, ictx.nowMs, bytes);
  }
  const first = s.firstTodo.get(low, LEAF_CRASHED_STEP, crashedAt).e;
  const top = first === null ? Number(s.lastBoundary.get().e ?? low) : Number(first) - 1;
  if (top > low) withTx(db, 'NORMAL', () => { setStep(db, LEAF_STEP, NODE_PARSER_VERSION, String(top)); });
  return { derived, waiting, failed };
}

/** Derive, nodes (§9.2 step 6, §6.3). Task 9 adds the parents and the nodes_fts backfill after the leaves. */
export function deriveNodes(db, ictx, budget) {
  deriveLeaves(db, ictx, budget);
}
