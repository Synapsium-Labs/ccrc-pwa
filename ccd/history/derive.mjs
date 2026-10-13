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
  directiveFlag, eofAfterBoundary, FAN_IN, forkCounts, ftsPhrase, ftsTextOf, gistSha, leafId, leafReady, nativeGist, nativeTopics, nodeIndexTexts,
  parentId, parentRollup, parseBlocks, pickHoldingCopy, pickReceipt, planFanIn, planSpans, producerOfCopy, redactField, selectBlock,
  secretUnits, summaryParts, summaryRowFor, withinBudget, BELT_NODES_STEP, REPARSE_MAX_TARGETS, topicsOfColumn,
} from './lib.mjs';
import { bump, getStep, parentOf, setStep, unbrotli, withTx } from './store.mjs';

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
  const redactInput = (value) => typeof value === 'string' ? redactField(value, pairIdx) : value;
  for (const r of sources) {
    if (r.type !== 'assistant' || r.tool_name === null) continue;
    const body = bodyOf(s, r.blob_id, budget);
    const uses = (Array.isArray(body) ? body : []).filter((x) => x !== null && typeof x === 'object' && x.type === 'tool_use')
      .map((x) => ({ type: 'tool_use', name: x.name, input: {
        file_path: redactInput(x.input?.file_path), notebook_path: redactInput(x.input?.notebook_path), command: redactInput(x.input?.command),
      } }));
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
  // A spool census that did not complete cannot prove any receipt absent, so it holds every leaf. Once measured,
  // only candidate sessions wait for the next tick to drain their receipt; unrelated leaves still finalize normally.
  if (ictx.pendingReceiptState.kind === 'unmeasured' || ictx.pendingReceiptState.sessionUuids.has(b.cc_uuid)) return 'waiting';
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
  deriveParents(db, ictx, budget);
  indexNodesFts(db, ictx, budget);
}

// ── Parents: fan-in per epoch, deterministic rollups (spec §6.3; W1-B2 Task 9) ───────────────────────────
//
// Which leaves group:
//   - 8 leaves make a depth-1 parent, and 4 nodes per level above (FAN_IN; lib's planFanIn decides each group);
//   - never across a /clear epoch: an epoch's slots are its own main transcript's boundaries, in `ord`;
//   - never across two forks: those slots are split per HOLDING COPY, the transcript file Task 8's holdingCopy
//     picks for each boundary, and fan-in runs per copy, so a parent's children share one copy (the
//     coordinator's ruling RB4; slug history-span-per-boundary-copy, extended to fan-in);
//   - only over FINAL leaves: a boundary whose leaf is not derived yet is a null slot, and a null slot stops the
//     group of its own copy, so a parent never skips a span to fill itself.
// What a parent is:
//   - its id is parentId(child ids, in order), so a retry, a reparse or a rebuild re-derives the same id (§6.1);
//   - its gist, topics, refs, time range and counts come from lib's parentRollup over the children's stored
//     fields. No model summarises anything (§6.3: "always deterministic and rebuildable").
// Writes: each parent, its node_children and node_refs rows, and (when the FTS tables exist) its nodes_fts row
// commit in ONE NORMAL transaction. A node is derived and rebuildable, never journaled (§9.14).
// Cursor (slug history-parents-cursor-by-rowid, NEW): ('parents', NODE_PARSER_VERSION) holds the highest
// nodes.rowid already considered. Only an epoch that gained a node since then is walked again; a budget that
// ends mid-walk leaves the cursor where it was, so the next tick walks those epochs again.

const PARENTS_STEP = 'parents';
/** The nodes_fts backfill's derivation step. Exported: doctor --repair (W1-B2 Task 23) resets its cursor when it
 *  recreates nodes_fts. */
export const NODES_FTS_STEP = 'nodes-fts';
const NODES_FTS_STEP_VERSION = 1;
/** The nodes_fts backfill's page: one NORMAL transaction each. */
const NODES_FTS_BATCH = 256;
/** A walk never climbs past this depth. 4^31 leaves is no store this code will meet; the bound only keeps a
 *  hand-damaged node_children table from looping. */
const MAX_FAN_DEPTH = 32;

function parentsBudgetLeft(budget) {
  return withinBudget({ elapsedMs: budget.now() - budget.startMs, bytes: budget.bytes, maxMs: budget.maxMs, maxBytes: budget.maxBytes });
}

/** Tells the tick that nodes_fts rows were deleted (or replaced), so their term bytes wait in nodes_fts_data until FTS5
 *  merges them. Called INSIDE the transaction that deleted the rows, once ictx.fts holds, and a no-op for a context that
 *  carries no hook (a test, or an --op pass other than reparse and the recover arm's pass): the tick's context, a reparse's and
 *  the recover arm's register the merge step ('fts-merge', 1), which now merges nodes_fts beside blobs_fts, so a redacted node value is no index byte once the steps complete (spec §6.2).
 *  D-4609 (history-nodes-fts-merged-after-rewrite) */
function nodesFtsDeleted(ictx) {
  if (ictx.fts === true && typeof ictx.onNodesFtsDeleted === 'function') ictx.onNodesFtsDeleted();
}

const PARENT_STMTS = new WeakMap();
function parentStmts(db) {
  let s = PARENT_STMTS.get(db);
  if (s === undefined) {
    s = {
      maxRow: db.prepare('SELECT max(rowid) AS r FROM nodes'),
      touched: db.prepare('SELECT session_pk, epoch_seq, max(rowid) AS leaf_top FROM nodes WHERE depth = 0 AND rowid > ? AND rowid <= ? GROUP BY session_pk, epoch_seq ORDER BY leaf_top, session_pk, epoch_seq'),
      epochTranscripts: db.prepare('SELECT t.transcript_pk AS transcript_pk FROM epochs e JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid '
        + "WHERE e.session_pk = ? AND e.seq = ? AND t.agent_id = '' ORDER BY t.transcript_pk"),
      bounds: db.prepare('SELECT entry_id, transcript_pk FROM boundaries WHERE transcript_pk = ? ORDER BY ord'),
      leafAt: db.prepare('SELECT node_id FROM nodes WHERE boundary_entry_id = ? AND depth = 0 AND rowid <= ?'),
      exists: db.prepare('SELECT 1 AS x FROM nodes WHERE node_id = ?'),
      node: db.prepare('SELECT node_id, session_pk, epoch_seq, transcript_pk, gist, topics, earliest_ms, latest_ms, src_chars, desc_count, desc_chars FROM nodes WHERE node_id = ?'),
      refs: db.prepare('SELECT kind, value, origin FROM node_refs WHERE node_id = ? ORDER BY rowid'),
      rowidOf: db.prepare('SELECT rowid AS r FROM nodes WHERE node_id = ?'),
      insNode: db.prepare('INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics, '
        + 'summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars, '
        + 'directive_flag, capped, parser_version, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      insChild: db.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, ?)'),
      insRef: db.prepare('INSERT INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?) ON CONFLICT (node_id, kind, value) DO NOTHING'),
    };
    PARENT_STMTS.set(db, s);
  }
  return s;
}

/** A node's stored fields, as parentRollup and the nodes_fts row read them. */
function storedNode(db, id) {
  const s = parentStmts(db);
  const r = s.node.get(id);
  return {
    row: r,
    rollup: {
      gist: typeof r.gist === 'string' ? r.gist : null,
      topics: topicsOfColumn(r.topics),
      refs: s.refs.all(id).map((x) => ({ kind: x.kind, value: x.value, origin: x.origin })),
      earliestMs: r.earliest_ms === null ? null : Number(r.earliest_ms),
      latestMs: r.latest_ms === null ? null : Number(r.latest_ms),
      srcChars: Number(r.src_chars ?? 0),
      descCount: Number(r.desc_count ?? 0),
      descChars: Number(r.desc_chars ?? 0),
    },
  };
}

/** One nodes_fts row: the gist, the topics one per line and the ref values one per line, through lib's nodeIndexTexts
 *  with this tick's pairs (W1-B2 Task 7A: B1's entryIndexText on each column, so redactForIndex's escape readings and
 *  the belt, §8.3 layer 4; spec §6.2 `nodes_fts`, rev 3.5). It is the one index-text rule B1 applies to
 *  blobs_fts, and Task 8's indexNode writes through it too. The parts are taken from redacted text already (§6.2);
 *  this pass also catches a pair learned since. */
function insertNodeFts(db, ictx, rowid, gist, topics, refs) {
  const t = nodeIndexTexts({ gist, topics, refs: refs.map((r) => r.value) }, ictx.pairIdx);
  db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) VALUES (?, ?, ?, ?)').run(rowid, t.gist, t.topics, t.refs);
}

/** The parent of `childIds` at `depth`, unless it exists. Returns its id, or null when it was there. */
function createParent(db, ictx, childIds, depth) {
  const s = parentStmts(db);
  const id = parentId(childIds);
  if (s.exists.get(id) !== undefined) return null;
  const kids = childIds.map((c) => storedNode(db, c));
  const first = kids[0].row;
  // Each child is read through redactedRollup, as a re-roll reads it: a child still stored unredacted (a pruned leaf, a
  // sibling a later batch rewrites) must not have the parent's GIST_MAX or TOPIC_CHARS cut land inside a value (spec §6.3
  // caps rule 6, SE1; D-4610 (history-reroll-from-redacted-children)).
  const r = parentRollup(kids.map((k) => redactedRollup(ictx, k.rollup)));
  withTx(db, 'NORMAL', () => {
    s.insNode.run(id, first.session_pk, first.epoch_seq, first.transcript_pk, 'condensed', depth, 'ok', r.gist, JSON.stringify(r.topics),
      r.earliestMs, r.latestMs, r.srcChars, r.descCount, r.descChars, directiveFlag(r.gist ?? '') ? 1 : 0, r.capped ? 1 : 0,
      NODE_PARSER_VERSION, ictx.nowMs);
    childIds.forEach((c, i) => { s.insChild.run(id, c, i); });
    for (const ref of r.refs) s.insRef.run(id, ref.kind, ref.value, ref.origin);
    if (ictx.fts === true) insertNodeFts(db, ictx, s.rowidOf.get(id).r, r.gist, r.topics, r.refs);
  });
  return id;
}

/** Fan-in over ONE holding copy's level-0 slots, level by level (§6.3). Each slot holds its leaf or null; each
 *  level above holds the parents of the level below, in their children's order. The budget is checked before every
 *  group because one large epoch must remain resumable; a retry finds prior parents through parentOf and mints only
 *  the groups still absent. */
function fanInLevels(db, ictx, level0, budget) {
  let made = 0;
  let level = level0;
  for (let depth = 0; depth < MAX_FAN_DEPTH && level.length > 0; depth += 1) {
    const width = depth === 0 ? FAN_IN.leaf : FAN_IN.condensed;
    const slots = level.map((id) => ({ nodeId: id, final: id !== null, parented: id !== null && parentOf(db, id) !== null }));
    for (const group of planFanIn({ slots, width })) {
      if (!parentsBudgetLeft(budget)) return { made, complete: false };
      if (createParent(db, ictx, group, depth + 1) !== null) made += 1;
    }
    const next = [];
    for (const id of level) {
      if (id === null) continue;
      const p = parentOf(db, id);
      if (p !== null && !next.includes(p)) next.push(p);
    }
    level = next;
  }
  return { made, complete: true };
}

/** Every parent one epoch can have now (§6.3; the coordinator's ruling RB4). Level 0 is split PER HOLDING COPY:
 *  each boundary of the epoch's main transcript, in `ord`, joins the slot list of the file Task 8's holdingCopy
 *  picks for it (a live file first, then the smallest file_id, among the files that have it as a member).
 *  - Why: `boundaries.ord` is numbered per transcript in arrival order, so two forks of one transcript
 *    interleave in it. One list for the whole transcript would let a parent take leaves of both forks, and a
 *    leaf not derived yet in one fork would stop the other's grouping. Per copy, a null slot stops only its own
 *    copy, and a parent's children share one copy.
 *  - A shared head falls to the copy that holds it (the smaller file_id when both are live), so the other fork's
 *    list starts after the fork.
 *  - A boundary no file holds has no leaf (Task 8 waits on it) and joins no list.
 *  - The split is read when a parent is minted. A parent minted earlier keeps its children: they read parented
 *    (parentOf), and planFanIn never regroups a parented slot.
 *  The lists run in ascending file_id. Returns the parents made and whether the complete epoch fit its budget. */
function deriveEpochParents(db, ictx, sessionPk, epochSeq, top, budget) {
  const s = parentStmts(db);
  const ds = stmts(db);
  const pass = { files: new Map() };
  const copies = new Map();   // holding file_id → its level-0 slots, in ord
  for (const t of s.epochTranscripts.all(sessionPk, epochSeq)) {
    for (const b of s.bounds.all(t.transcript_pk)) {
      if (!parentsBudgetLeft(budget)) return { made: 0, complete: false };
      const holding = holdingCopy(ds, pass, b);
      if (holding === null) continue;
      const copyKey = holding.file_id;
      if (!copies.has(copyKey)) copies.set(copyKey, []);
      const leaf = s.leafAt.get(b.entry_id, top);
      copies.get(copyKey).push(leaf === undefined ? null : leaf.node_id);
    }
  }
  let made = 0;
  for (const key of [...copies.keys()].sort((x, y) => Number(x) - Number(y))) {
    const r = fanInLevels(db, ictx, copies.get(key), budget);
    made += r.made;
    if (!r.complete) return { made, complete: false };
  }
  return { made, complete: true };
}

/** Fan-in for every epoch with a new leaf trigger (§6.3). Each completed epoch moves the decimal cursor to its
 * highest triggering leaf row, so equal budgets resume at later epochs rather than rewalking completed ones. */
export function deriveParents(db, ictx, budget) {
  const s = parentStmts(db);
  const step = getStep(db, PARENTS_STEP, NODE_PARSER_VERSION);
  const from = step === null || step.cursor === null ? 0 : Number(step.cursor);
  const top = s.maxRow.get().r;
  if (top === null || Number(top) <= from) return 0;
  let made = 0;
  for (const e of s.touched.all(from, top)) {
    if (!parentsBudgetLeft(budget)) return made;
    const r = deriveEpochParents(db, ictx, e.session_pk, e.epoch_seq, top, budget);
    made += r.made;
    if (!r.complete) return made;
    setStep(db, PARENTS_STEP, NODE_PARSER_VERSION, String(e.leaf_top), null);
  }
  setStep(db, PARENTS_STEP, NODE_PARSER_VERSION, String(top), null);
  return made;
}

/** The nodes_fts backfill (§6.2): every node past the ('nodes-fts', 1) cursor with no nodes_fts row gets one.
 *  This covers a node derived while the FTS tables did not exist, or after doctor --repair recreated them.
 *  A node indexed at derivation is skipped, never inserted twice: a second insert of one rowid throws.
 *  Returns the rows added. */
export function indexNodesFts(db, ictx, budget) {
  if (ictx.fts !== true) return 0;
  const step = getStep(db, NODES_FTS_STEP, NODES_FTS_STEP_VERSION);
  let cursor = step === null || step.cursor === null ? 0 : Number(step.cursor);
  const page = db.prepare('SELECT rowid AS rid, node_id FROM nodes WHERE rowid > ? ORDER BY rowid LIMIT ?');
  const has = db.prepare('SELECT 1 AS x FROM nodes_fts WHERE rowid = ?');
  let added = 0;
  while (parentsBudgetLeft(budget)) {
    const rows = page.all(cursor, NODES_FTS_BATCH);
    if (rows.length === 0) break;
    let examined = cursor;
    let pageAdded = 0;
    withTx(db, 'NORMAL', () => {
      for (const r of rows) {
        if (!parentsBudgetLeft(budget)) break;
        if (has.get(r.rid) === undefined) {
          const n = storedNode(db, r.node_id).rollup;
          insertNodeFts(db, ictx, r.rid, n.gist, n.topics, n.refs);
          pageAdded += 1;
        }
        examined = Number(r.rid);
      }
      if (examined > cursor) setStep(db, NODES_FTS_STEP, NODES_FTS_STEP_VERSION, String(examined), null);
    });
    added += pageAdded;
    if (examined === cursor) break;
    cursor = examined;
    if (examined !== Number(rows[rows.length - 1].rid)) break;
  }
  return added;
}

/** A child's rollup with every field redacted WHOLE, as parentRollup must read it (spec §6.3 caps rule 6, SE1: every gist,
 *  topic and ref is taken from redacted text and capped after it). A child still stored unredacted (a raw or pruned
 *  leaf, a sibling a later batch rewrites) would otherwise be cut by the parent's GIST_MAX at a point that can land
 *  inside a value, and redactField, which matches a whole run, can never mask the prefix that cut leaves. A ref whose
 *  redacted form no longer classifies (it holds the mark) is not stored, as a leaf's mined refs are not: changed by this
 *  call or already stored as the mark by an earlier rewrite, so the drop never depends on the order of the passes.
 *  D-4610 (history-reroll-from-redacted-children) */
function redactedRollup(ictx, c) {
  const refs = [];
  for (const ref of c.refs) {
    const value = redactField(ref.value, ictx.pairIdx);
    if (classifyRef(value) === null) continue;
    refs.push({ kind: ref.kind, value, origin: ref.origin });
  }
  return {
    ...c,
    gist: c.gist === null ? null : redactField(c.gist, ictx.pairIdx),
    topics: c.topics.map((t) => redactField(t, ictx.pairIdx)),
    refs,
  };
}

/** Whether a stored node's gist, topics and refs (as a set) are the ones a re-roll would write: the belt's test for a
 *  parent it leaves alone. */
function sameParentFields(stored, rolled) {
  const refSet = (refs) => refs.map((x) => `${x.kind}\u0000${x.value}\u0000${x.origin}`).sort().join('\n');
  return stored.gist === rolled.gist && JSON.stringify(stored.topics) === JSON.stringify(rolled.topics)
    && refSet(stored.refs) === refSet(rolled.refs);
}

/** The writer of one condensed node's re-roll: the node from its children as they are stored now, each child's fields
 *  redacted whole first (redactedRollup), in one transaction with its node_refs and its nodes_fts row. Answers whether
 *  the node has any child to roll up, and, with `onlyIfChanged`, whether it wrote: a node whose gist, topics and refs the
 *  re-roll would leave as they are is not touched. */
function parentReroller(db, ictx, onlyIfChanged = false) {
  const s = parentStmts(db);
  // A child row that is gone (a damaged store: node_children.child_id is RESTRICT, and doctor --repair keeps an existing FK
  // violation as its baseline) is skipped, so the parent is rebuilt fail-closed from the children that remain and storedNode
  // is never asked for a row that is not there. D-4610 (history-reroll-from-redacted-children), H-155.
  // Residual (H-217): a parent whose EVERY node_children row is dangling has no kid left, is not rebuilt (this answers false)
  // and keeps any cut prefix it stored; only a reparse of its subtree or a recovery heals it.
  const kidsOf = db.prepare('SELECT nc.child_id AS child_id FROM node_children nc JOIN nodes n ON n.node_id = nc.child_id WHERE nc.node_id = ? ORDER BY nc.ord');
  const setParent = db.prepare('UPDATE nodes SET gist = ?, topics = ?, earliest_ms = ?, latest_ms = ?, src_chars = ?, '
    + 'desc_count = ?, desc_chars = ?, directive_flag = ?, capped = ?, parser_version = ? WHERE node_id = ?');
  const dropRefs = db.prepare('DELETE FROM node_refs WHERE node_id = ?');
  return (id) => {
    const kids = kidsOf.all(id).map((r) => redactedRollup(ictx, storedNode(db, r.child_id).rollup));
    if (kids.length === 0) return false;
    const r = parentRollup(kids);
    if (onlyIfChanged && sameParentFields(storedNode(db, id).rollup, r)) return false;
    withTx(db, 'NORMAL', () => {
      setParent.run(r.gist, JSON.stringify(r.topics), r.earliestMs, r.latestMs, r.srcChars, r.descCount, r.descChars,
        directiveFlag(r.gist ?? '') ? 1 : 0, r.capped ? 1 : 0, NODE_PARSER_VERSION, id);
      dropRefs.run(id);
      for (const ref of r.refs) s.insRef.run(id, ref.kind, ref.value, ref.origin);
      if (ictx.fts === true) {
        const rowid = s.rowidOf.get(id).r;
        db.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(rowid);
        insertNodeFts(db, ictx, rowid, r.gist, r.topics, r.refs);
        nodesFtsDeleted(ictx);
      }
    });
    return true;
  };
}

/** The most seeds one ancestor query of rerollParents takes: far under SQLite's 32,766 variables. */
const REROLL_CHUNK = 500;

/** Every condensed node above `nodeIds`, re-rolled from its children as they are stored now (§6.3), for a reparse
 *  (W1-B2 Task 21) or a pair learned late (Task 29). Ids and node_children never change; a parent's rollup fields,
 *  node_refs and nodes_fts row do. Lower levels go first, so each level reads children already re-rolled. Each child
 *  is read through redactedRollup, so no cut is made on unredacted text (D-4610 (history-reroll-from-redacted-children)).
 *  Every caller that rewrites nodes in place passes the ids it rewrote, so a parent cut through a value is rebuilt on
 *  every path that can leave one; the cost is bounded by the ancestors of the set, as the rewrite is by the set.
 *  Returns how many parents it rewrote; with `onlyIfChanged`, a parent whose re-roll is what it stores is left untouched
 *  and not counted (the belt's call, D-4610, H-154). */
export function rerollParents(db, ictx, nodeIds, onlyIfChanged = false) {
  const reroll = parentReroller(db, ictx, onlyIfChanged);
  // A derived DAG may share a child between valid parents. Walk every reverse edge, not parentOf's deterministic
  // convenience answer; UNION makes this terminate even if a damaged table contains a cycle.
  // The seeds go to the query in chunks of REROLL_CHUNK ids (a test lowers it with ictx.rerollChunk): one IN list over
  // every seed throws "too many SQL variables" above 32,766 of them. The ancestors of a union are the union of the
  // ancestors, so the chunks are collected and each parent is re-rolled once, lower levels first.
  const size = Number.isSafeInteger(ictx.rerollChunk) && ictx.rerollChunk > 0 ? ictx.rerollChunk : REROLL_CHUNK;
  const above = new Map();
  for (let at = 0; at < nodeIds.length; at += size) {
    const chunk = nodeIds.slice(at, at + size);
    const aboveRows = db.prepare(`WITH RECURSIVE ancestors(node_id) AS (
      SELECT node_id FROM node_children WHERE child_id IN (${chunk.map(() => '?').join(', ')})
      UNION
      SELECT nc.node_id FROM node_children nc JOIN ancestors a ON a.node_id = nc.child_id
    )
    SELECT a.node_id, n.depth FROM ancestors a JOIN nodes n ON n.node_id = a.node_id WHERE n.depth > 0`).all(...chunk);
    for (const r of aboveRows) above.set(r.node_id, Number(r.depth));
  }
  const order = [...above.entries()].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([id]) => id);
  let n = 0;
  for (const id of order) if (reroll(id)) n += 1;
  return n;
}

/** Exactly these condensed nodes re-rolled, in the order given (a child before its parent, which nodes.rowid order
 *  guarantees: a parent is inserted after its children), each from its children as stored then. The recovery step's
 *  condensed pass uses it, so a parent whose stored gist a past cut left a value's prefix in is rebuilt from clean
 *  children, which a field rewrite alone can never heal. Returns how many it rewrote.
 *  D-4610 (history-reroll-from-redacted-children) */
export function rerollNodes(db, ictx, nodeIds) {
  const reroll = parentReroller(db, ictx);
  let n = 0;
  for (const id of nodeIds) if (reroll(id)) n += 1;
  return n;
}

// ── reparse (W1-B2 Task 21) ────────────────────────────────────────────────────────────────────────
// §8.4 "reparse", §6.6, §11 L8. A reparse re-runs the parser over stored summaries; it never re-spans a
// leaf, so a leaf's id and its node_sources never change (§6.1). Its targets are refused whole: above
// REPARSE_MAX_TARGETS, or when any target's span holds pruned text (history-reparse-targets). It is also RB5's one
// retry (history-parser-crash-recorded): a parse-failed leaf is an ordinary target, and an all-leaves or --session
// run clears the leaf-crashed markers so the next tick derives those boundaries.

/** The leaves a reparse names: `--node <id>` — that leaf, or every leaf under a condensed node (walking
 *  node_children down, UNION so a cycle ends); `--session <id>` — every leaf of that ccrc id's families,
 *  every generation; neither — every leaf. `pruned` lists the targets whose span holds a tombstoned source
 *  blob, or whose summary blob is tombstoned; above REPARSE_MAX_TARGETS it is not measured, because the
 *  refusal is reparse-too-many whatever the spans hold. `found` is false only for a --node this store has no
 *  row for. Read-only: a dry run calls it on a reader. */
export function reparseTargets(db, sel) {
  let nodeIds;
  if (sel.node !== null) {
    const n = db.prepare('SELECT node_id, kind FROM nodes WHERE node_id = ?').get(sel.node);
    if (n === undefined) return { nodeIds: [], pruned: [], found: false };
    nodeIds = n.kind !== 'condensed' ? [String(n.node_id)] : db.prepare(`WITH RECURSIVE sub(node_id) AS (
          SELECT ? UNION SELECT nc.child_id FROM node_children nc JOIN sub ON sub.node_id = nc.node_id)
        SELECT n.node_id AS node_id FROM sub JOIN nodes n ON n.node_id = sub.node_id
        WHERE n.kind <> 'condensed' ORDER BY n.node_id`).all(sel.node).map((r) => String(r.node_id));
  } else if (sel.session !== null) {
    nodeIds = db.prepare(`SELECT n.node_id AS node_id FROM nodes n JOIN sessions s ON s.session_pk = n.session_pk
        WHERE s.ccrc_id = ? AND n.kind <> 'condensed' ORDER BY n.node_id`).all(sel.session).map((r) => String(r.node_id));
  } else {
    nodeIds = db.prepare("SELECT node_id FROM nodes WHERE kind <> 'condensed' ORDER BY node_id").all().map((r) => String(r.node_id));
  }
  if (nodeIds.length > REPARSE_MAX_TARGETS) return { nodeIds, pruned: [], found: true };
  const prunedQ = db.prepare(`SELECT 1 AS x FROM nodes n WHERE n.node_id = ? AND (
      EXISTS (SELECT 1 FROM node_sources ns JOIN entries e ON e.entry_id = ns.entry_id JOIN blobs b ON b.blob_id = e.blob_id
              WHERE ns.node_id = n.node_id AND b.z IS NULL)
      OR EXISTS (SELECT 1 FROM blobs b WHERE b.blob_id = n.summary_blob_id AND b.z IS NULL))`);
  return { nodeIds, pruned: nodeIds.filter((id) => prunedQ.get(id) !== undefined), found: true };
}

/** RB5's record for an EXISTING leaf whose re-derivation threw (history-parser-crash-recorded): rewritten as Task 8
 *  writes a crashed leaf — raw_leaf, parse-failed, no gist, topics or refs, an empty nodes_fts row when ictx.fts —
 *  and parser_crash bumped once, in one transaction. The id, node_sources, span and summary_blob_id stay, so the
 *  next reparse can retry it. */
function markReparseCrash(db, ictx, s, nodeId) {
  withTx(db, 'NORMAL', () => {
    db.prepare(`UPDATE nodes SET kind = 'raw_leaf', status = 'parse-failed', gist = NULL, topics = NULL, directive_flag = 0,
      capped = 0, parser_version = ? WHERE node_id = ?`).run(NODE_PARSER_VERSION, nodeId);
    db.prepare('DELETE FROM node_refs WHERE node_id = ?').run(nodeId);
    if (ictx.fts === true) { indexNode(db, s, nodeId, null, null, [], ictx.pairIdx); nodesFtsDeleted(ictx); }
    bump(db, 'parser_crash');
  });
}

/** One existing leaf re-derived in place from its stored summary (§8.4 "reparse"; §6.1 ids never change), with
 *  the current parser and ictx.pairIdx, through Task 8's leafFields: the field computation deriveOne uses. It keeps
 *  node_id, node_sources, the span and the time range; rewrites kind, status, gist, topics, directive_flag, capped
 *  and parser_version; replaces node_refs and, when ictx.fts, the nodes_fts row; all in one transaction. Counters
 *  are not folded again. A leaf whose boundary, holding copy or summary cannot be read answers 'skipped' and writes
 *  nothing (a parse-failed leaf is never skipped for its summary: leafFields reads that as a raw leaf; D-4602, H-55). A derivation that
 *  throws for any reason but a store fault (a parser bug, RB5) is recorded by markReparseCrash and answers 'failed'; a busy store
 *  and any other SQLite error propagate (D-4602, H-59). deriveLeaves does not: it files a non-busy SQLite fault inside leafFields
 *  as a parse-failed leaf (deriveOne) and any other non-busy throw as a recorded crash (parser_crash and a leaf-crashed marker),
 *  where this function rethrows it. `pass` is deriveLeaves' cache
 *  ({ copy, epochs, files }); reparseLeaves shares one across its targets, so a copy is planned once per run. */
export function refreshLeaf(db, ictx, nodeId, pass = { copy: null, epochs: new Map(), files: new Map() }) {
  const s = stmts(db);
  const n = db.prepare(`SELECT node_id, session_pk, kind, status, gist, topics, directive_flag, capped, boundary_entry_id
    FROM nodes WHERE node_id = ? AND depth = 0`).get(nodeId);
  if (n === undefined || n.boundary_entry_id === null) return 'skipped';
  const b = db.prepare(`SELECT b.entry_id AS entry_id, e.uuid AS uuid, e.ts_ms AS ts_ms, b.transcript_pk AS transcript_pk,
      t.cc_session_uuid AS cc_uuid
    FROM boundaries b JOIN entries e ON e.entry_id = b.entry_id JOIN transcripts t ON t.transcript_pk = b.transcript_pk
    WHERE b.entry_id = ?`).get(n.boundary_entry_id);
  if (b === undefined) return 'skipped';
  const budget = { bytes: 0 };
  let f;
  try {
    const holding = holdingCopy(s, pass, b);
    if (holding === null) return 'skipped';
    const copy = copyPlan(s, pass, holding.file_id, budget);
    const pick = copy.picks.get(b.uuid);
    if (pick === undefined) return 'skipped';
    // D-4602 (history-reparse-counts-skips-and-rethrows-store-faults), HB1 H-55: a parse-failed leaf is an ordinary target
    // whatever its summary now reads as: deriveOne records one when leafFields threw on a missing or unreadable summary, and
    // leafFields already turns that summary into a raw leaf. Only a leaf that was NOT parse-failed is left alone for it.
    if (n.status !== 'parse-failed') {
      if (pick.uuid === null) return 'skipped';
      const summaryAt = copy.index.get(pick.uuid);
      if (summaryAt === undefined || textOf(s, copy.rows[summaryAt].blob_id, budget) === null) return 'skipped';
    }
    const byEntry = new Map(copy.rows.map((r) => [Number(r.entry_id), r]));
    const sources = db.prepare('SELECT entry_id FROM node_sources WHERE node_id = ? ORDER BY ord').all(nodeId)
      .map((r) => byEntry.get(Number(r.entry_id))).filter((r) => r !== undefined);
    f = leafFields(db, ictx, nodeToolkit(), s, copy, b, pick, nodeId, Number(n.session_pk), sources, budget);
  } catch (e) {
    // A busy store ends the reparse, and so does any other SQLite fault (CORRUPT, IOERR, NOMEM: the code every node:sqlite error
    // carries): it is the store failing, not a parser bug, and recording it would wipe a good leaf's gist, topics, refs and
    // nodes_fts row. Anything else is RB5's recorded crash. D-4602 (history-reparse-counts-skips-and-rethrows-store-faults), HB1 H-59.
    if (ictx.isBusy(e) || e?.code === 'ERR_SQLITE_ERROR') throw e;
    markReparseCrash(db, ictx, s, nodeId);
    return 'failed';
  }
  const after = [f.kind, f.status, f.gist, f.topics === null ? null : JSON.stringify(f.topics), f.flag ? 1 : 0, f.capped || f.refs.capped ? 1 : 0];
  const before = [n.kind, n.status, n.gist, n.topics, Number(n.directive_flag), Number(n.capped)];
  const refKey = (rs) => rs.map((r) => `${r.kind}\0${r.value}\0${r.origin}`).sort().join('\n');
  const oldRefs = refKey(db.prepare('SELECT kind, value, origin FROM node_refs WHERE node_id = ?').all(nodeId));
  const same = JSON.stringify(before) === JSON.stringify(after) && oldRefs === refKey(f.refs.refs);
  withTx(db, 'NORMAL', () => {
    db.prepare(`UPDATE nodes SET kind = ?, status = ?, gist = ?, topics = ?, directive_flag = ?, capped = ?, parser_version = ?
      WHERE node_id = ?`).run(...after, NODE_PARSER_VERSION, nodeId);
    db.prepare('DELETE FROM node_refs WHERE node_id = ?').run(nodeId);
    for (const r of f.refs.refs) s.insRef.run(nodeId, r.kind, r.value, r.origin);
    if (ictx.fts === true) { indexNode(db, s, nodeId, f.gist, f.topics, f.refs.refs, ictx.pairIdx); nodesFtsDeleted(ictx); }
  });
  return same ? 'unchanged' : 'updated';
}

/** Re-derive each target leaf in place (§8.4 "reparse"): refreshLeaf (above) keeps the node id and its
 *  node_sources and rewrites only what the parser derives, all targets sharing one pass cache; then Task 9's
 *  rerollParents re-rolls every parent above EVERY target, ids kept. The re-roll runs whatever changed, and also
 *  when the loop throws (a busy store), because each leaf commits alone: a run that stopped after some leaves
 *  committed, or between the last commit and the re-roll, leaves parents a rerun must heal even when every leaf
 *  then reads 'unchanged'. rerollParents is idempotent. Answers how many leaves changed, how many failed and how many
 *  were skipped (read as nothing by refreshLeaf, so neither unchanged nor re-derived; D-4602
 *  (history-reparse-counts-skips-and-rethrows-store-faults), HB1 H-54). */
export function reparseLeaves(db, ictx, nodeIds) {
  const pass = { copy: null, epochs: new Map(), files: new Map() };
  let changed = 0;
  let failed = 0;
  let skipped = 0;
  try {
    for (const id of nodeIds) {
      const r = refreshLeaf(db, ictx, id, pass);
      if (r === 'updated') changed += 1;
      else if (r === 'failed') failed += 1;
      else if (r === 'skipped') skipped += 1;
    }
  } catch (e) {
    try { rerollParents(db, ictx, nodeIds); } catch { /* the loop's own error is the one that ends the pass */ }
    throw e;
  }
  rerollParents(db, ictx, nodeIds);
  return { changed, failed, skipped };
}

/** RB5's other retry (history-parser-crash-recorded): a boundary whose derivation threw before its leaf id was
 *  known has no node, only Task 8's (LEAF_CRASHED_STEP, <boundary entry_id>) marker, which the ticks skip. This
 *  deletes the markers of `sel.session`'s boundaries (that ccrc id's families, every generation, through their
 *  epochs), or every marker when `sel.session` is null, and lowers the ('leaves', NODE_PARSER_VERSION) low-water
 *  cursor below the lowest one, in one transaction, so the next tick derives them. Answers how many it cleared. */
export function clearLeafCrashes(db, sel) {
  const rows = sel.session === null
    ? db.prepare('SELECT version FROM derivation_state WHERE step = ?').all(LEAF_CRASHED_STEP)
    : db.prepare(`SELECT DISTINCT d.version AS version FROM derivation_state d
        JOIN boundaries b ON b.entry_id = d.version JOIN transcripts t ON t.transcript_pk = b.transcript_pk
        JOIN epochs ep ON ep.cc_session_uuid = t.cc_session_uuid JOIN sessions s ON s.session_pk = ep.session_pk
        WHERE d.step = ? AND s.ccrc_id = ?`).all(LEAF_CRASHED_STEP, sel.session);
  if (rows.length === 0) return 0;
  let low = Infinity;
  for (const r of rows) low = Math.min(low, Number(r.version));
  withTx(db, 'NORMAL', () => {
    const del = db.prepare('DELETE FROM derivation_state WHERE step = ? AND version = ?');
    for (const r of rows) del.run(LEAF_CRASHED_STEP, r.version);
    const cursor = Number(getStep(db, LEAF_STEP, NODE_PARSER_VERSION)?.cursor ?? 0);
    if (low - 1 < cursor) setStep(db, LEAF_STEP, NODE_PARSER_VERSION, String(low - 1));
  });
  return rows.length;
}

// ── W1-B2 Task 29: node fields after a pair is learned late or replayed (§6.2 "A pair learned after its text was
// indexed", §9.14 "Redaction first"; slugs history-redaction-reindex-merge, history-redaction-journaled) ─────

/** Rewrite each node's stored gist, topics and refs through redactField with ictx.pairIdx, and its nodes_fts row when
 *  ictx.fts. This is the fail-closed path for a node whose summary cannot be read again: a pruned span, a raw leaf,
 *  a condensed node, or a leaf whose re-derivation threw. Redaction needs only the pair, never the source text.
 *  Topics are redacted ONE BY ONE and only then serialised (R2: redactField on each raw field before any
 *  serialisation; in the column's JSON text a control character inside a value would be escaped and no longer match
 *  its pair). The column is read through topicsOfColumn (Task 9), so JSON and one-per-line columns both read; the
 *  nodes_fts row is lib's nodeIndexTexts of the rewritten fields (Task 7A: each column through entryIndexText, so the
 *  index's escape readings; topics and refs one per line), as every other writer of it does (Tasks 8 and 9).
 *  redactField is layer 4 over layers 1-3 whenever ictx.pairIdx carries a belt (Task 7A, spec rev 3.5 §8.3), so a
 *  value glued to letters is masked here too; this is also the writer the belt's node step (beltNodesStep) uses.
 *  D-4729 (history-redaction-fail-closed-node-rewrite) */
export function redactNodeFields(db, ictx, nodeIds) {
  if (nodeIds.length === 0) return 0;
  const read = db.prepare('SELECT rowid AS rid, gist, topics FROM nodes WHERE node_id = ?');
  const refsOf = db.prepare('SELECT kind, value, origin FROM node_refs WHERE node_id = ?');
  const setNode = db.prepare('UPDATE nodes SET gist = ?, topics = ? WHERE node_id = ?');
  const dropRefs = db.prepare('DELETE FROM node_refs WHERE node_id = ?');
  const putRef = db.prepare('INSERT OR IGNORE INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)');
  const fts = ictx.fts === true;
  const ftsDel = fts ? db.prepare('DELETE FROM nodes_fts WHERE rowid = ?') : null;
  const ftsIns = fts ? db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) VALUES (?, ?, ?, ?)') : null;
  let n = 0;
  withTx(db, 'NORMAL', () => {
    for (const id of nodeIds) {
      const row = read.get(id);
      if (row === undefined) continue;
      const gist = row.gist === null ? null : redactField(row.gist, ictx.pairIdx);
      const list = row.topics === null ? null : topicsOfColumn(row.topics).map((t) => redactField(t, ictx.pairIdx));
      const topics = list === null ? null : JSON.stringify(list);
      const refs = refsOf.all(id).map((r) => ({ kind: r.kind, value: redactField(r.value, ictx.pairIdx), origin: r.origin }));
      setNode.run(gist, topics, id);
      dropRefs.run(id);
      for (const r of refs) putRef.run(id, r.kind, r.value, r.origin);
      if (fts) {
        ftsDel.run(row.rid);
        const t = nodeIndexTexts({ gist, topics: list ?? [], refs: refs.map((r) => r.value) }, ictx.pairIdx);
        ftsIns.run(row.rid, t.gist, t.topics, t.refs);
      }
      n += 1;
    }
    if (fts && n > 0) nodesFtsDeleted(ictx);
  });
  return n;
}

/** Task 21's refreshLeaf over each of `nodeIds`, then Task 9's rerollParents once for the whole set: what
 *  reparseLeaves does, with each leaf apart. The re-roll runs whenever the set was attempted, not only when a leaf
 *  changed: each leaf commits alone, so a run that died after some leaves committed (a busy store inside the re-roll)
 *  leaves parents a rerun must heal even when every leaf then reads 'unchanged' or 'skipped'; rerollParents is
 *  idempotent and reads each child through redactedRollup (D-4610 (history-reroll-from-redacted-children)).
 *  A parser throw inside leafFields is refreshLeaf's own record (it writes
 *  the leaf parse-failed, counts parser_crash once and answers 'failed', which counts as a change here). A throw that
 *  escapes refreshLeaf (its reads before leafFields; busy rethrows) is counted parser_crash, as deriveLeaves counts a
 *  derive throw, and skipped; the caller's redactNodeFields then
 *  rewrites its stored fields fail-closed. That includes a non-busy SQLite fault raised anywhere in refreshLeaf's try
 *  (leafFields included), which refreshLeaf rethrows (D-4602, H-59): here it is caught, counted as parser_crash and the
 *  leaf rewritten fail-closed, so the store-fault-is-not-a-parser-bug distinction holds only for `reparse --apply`
 *  (D-4602, H-194). Nothing retries it on a later pass (the coordinator's ruling RB5): the
 *  recovery reindex moves its cursor past it, and the late-pair fast path (rederiveGistsFor, from B1's
 *  reindexForValues, which never moves the mark) stops searching the value once B1's rederiveFts has opened a
 *  generation (lib's phraseValues then hands it only the values its tick recorded) or completed one (the mark is then
 *  at the pair). So one bad summary holds neither, and only `reparse` re-derives it again. Re-deriving twice is
 *  idempotent. Answers how many leaves changed. */
export function reparseFailClosed(db, ictx, nodeIds) {
  let changed = 0;
  for (const id of nodeIds) {
    let r;
    try {
      r = refreshLeaf(db, ictx, id);
    } catch (crash) {
      if (ictx.isBusy(crash)) throw crash;
      withTx(db, 'NORMAL', () => { bump(db, 'parser_crash'); });
      continue;
    }
    // 'failed': refreshLeaf caught a parser throw itself and wrote the leaf parse-failed (Task 21, RB5), counted once.
    if (r === 'updated' || r === 'failed') changed += 1;
  }
  if (nodeIds.length > 0) rerollParents(db, ictx, nodeIds);
  return changed;
}

/** The most leaves one call of the late-pair fast path (rederiveGistsFor) re-derives, one refreshLeaf each and one
 *  re-roll over all of them: the size of a recovery batch. A test lowers it with ictx.rederiveLeafMax. The overflow gets a
 *  field rewrite and an ancestor re-roll, and only `reparse` or a recovery's reindex re-derives it. A residual (H-152, bound
 *  stated in full by H-216): an overflow leaf whose own gist was cut at NATIVE_GIST_MAX, or one of whose topics was cut at
 *  TOPIC_CHARS (capTopics), inside a value before the pair was known keeps that prefix in nodes.gist or nodes.topics, in
 *  nodes_fts and in its ancestors' re-rolled fields, because redactField matches whole runs. Under layer 4 the belt masks
 *  such a prefix only when it is at least the unit's belt width K AND the value seeds belt windows; a value made only of
 *  one-case letters (or a digit-free one-case window), or a unit past BELT_GRAMS_MAX, seeds none, so for it a prefix of ANY
 *  length up to len-1 survives. It stays until that re-derivation, as a pruned leaf's does.
 *  D-4611 (history-late-pair-fast-path-bounded) */
const REDERIVE_LEAF_MAX = 64;

/** The nodes whose gist, topics or refs hold one of `values`, re-derived with ictx.pairIdx (§6.2).
 *  - They are found by a QUOTED-PHRASE match on nodes_fts (ftsPhrase), which FTS5 tokenises as the index did. A bare
 *    MATCH of a value holding '-' is a syntax error ("no such column", measured on 22.16.0).
 *  - Each value is searched by UNIT (lib's secretUnits: the value when it is one run, else each of its 12+-char
 *    runs), as B1's reindexForValues searches blobs_fts (B1's D-4311): redaction matches by unit, so a node holding
 *    only one segment of a multi-run value is found too.
 *  - A leaf whose summary is still stored is re-derived (reparseFailClosed: same id, parents re-rolled, a throw
 *    counted and skipped), up to REDERIVE_LEAF_MAX leaves per call. Every node found, re-derived or not, is then
 *    rewritten through redactNodeFields, and the ancestors of every node that was only rewritten (a pruned or
 *    over-the-cap leaf, a condensed node) are re-rolled from redacted children (D-4610); the cost is bounded by the
 *    matched set, as the rewrite is.
 *  - It is the same-tick fast path over nodes, as B1's phrase search is over blobs (B1's
 *    D-4344): it moves no mark, and it runs only while `slice` and `budget` last
 *    (B1's review 344 F2 rule: a fast path never runs unbudgeted ahead of the step that ends the generation). It
 *    runs on every tick where a value is owed, until B1's rederiveFts opens a generation (then only the values its
 *    tick recorded are searched) or completes one (the mark then covers the pair). What it misses or leaves (a value
 *    glued to letters inside one term, a hash-only pair, a spent budget) the belt's node step finishes, fail-closed:
 *    every generation that opens restarts it (beltNodesStep, Task 7B). Re-deriving twice is idempotent.
 *  Returns how many nodes it touched. */
export function rederiveGistsFor(db, ictx, values, budget, slice) {
  if (ictx.fts !== true || values.length === 0) return 0;
  // B1's review 344 F2 rule for a fast path: never unbudgeted. What a spent budget leaves, the belt's node step finishes.
  if (!parentsBudgetLeft(slice) || !parentsBudgetLeft(budget)) return 0;
  const match = db.prepare('SELECT rowid AS rid FROM nodes_fts WHERE nodes_fts MATCH ?');
  const nodeAt = db.prepare(`SELECT n.node_id, n.kind, (n.summary_blob_id IS NOT NULL AND b.z IS NOT NULL) AS readable
    FROM nodes n LEFT JOIN blobs b ON b.blob_id = n.summary_blob_id WHERE n.rowid = ?`);
  const reparse = new Set();
  const rewrite = new Set();
  for (const v of values) {
    for (const unit of secretUnits(v)) {
      for (const r of match.all(ftsPhrase(unit))) {
        const n = nodeAt.get(r.rid);
        if (n === undefined) continue;
        if (n.kind !== 'condensed' && n.readable === 1) reparse.add(n.node_id);
        else rewrite.add(n.node_id);
      }
    }
  }
  // D-4611 (history-late-pair-fast-path-bounded): at most REDERIVE_LEAF_MAX leaves are re-derived per call, in node-id order.
  // The overflow is rewritten in place, fail-closed, with no summary read, and its ancestors are re-rolled below like every
  // other rewritten node's. Once rewritten it no longer phrase-matches, so no later call reaches it: only `reparse` or a
  // recovery's reindex re-derives it from its summary, and the belt's node step finishes whatever the search could not find.
  // Residual (H-152, H-216): an overflow leaf whose own gist was cut at NATIVE_GIST_MAX, or one of whose topics was cut at
  // TOPIC_CHARS, inside the value before the pair was known keeps that prefix in nodes, nodes_fts and its ancestors' re-rolled
  // fields until that re-derivation. The belt masks it only when it is at least the belt width K AND the value seeds belt
  // windows; a value of one-case letters only (or a digit-free one-case window), or a unit past BELT_GRAMS_MAX, seeds none, so
  // a prefix of any length up to len-1 survives for it.
  const all = [...reparse].sort();
  const max = Number.isSafeInteger(ictx.rederiveLeafMax) && ictx.rederiveLeafMax > 0 ? ictx.rederiveLeafMax : REDERIVE_LEAF_MAX;
  const leaves = all.slice(0, max);
  for (const id of all.slice(max)) rewrite.add(id);
  if (leaves.length > 0) reparseFailClosed(db, ictx, leaves);
  // A parent the re-derivation re-rolled takes its children's gists as they are now. A node the match found that no
  // re-derivation reaches is rewritten in place, and so is every leaf it tried: a leaf refreshLeaf had to skip (its
  // holding copy unreadable) or that threw is still rewritten fail-closed, and rewriting a redacted field again
  // changes nothing.
  const rest = [...rewrite].sort();
  redactNodeFields(db, ictx, [...leaves, ...rest]);
  // Every node rewritten in place has its ancestors re-rolled from redacted children (D-4610): a parent cut through the
  // value keeps an unmatched prefix after a field rewrite, and a matched leaf that cannot be read (its summary pruned) or
  // that is over the cap reaches no re-derivation, which re-rolls the ancestors of the leaves it handles. The cost is
  // bounded by the matched set, as the rewrite is.
  if (rest.length > 0) rerollParents(db, ictx, rest);
  return leaves.length + rest.length;
}

// ── W1-B2 Task 29: the belt's node step (§6.2 "The belt", §8.3 layer 4) ──────────────────────────────────────────

/** How many nodes one batch of the belt's node step reads. */
const BELT_NODE_BATCH = 64;

/** §6.2 "The belt": while ('nodes-belt', 1) is open (Task 7B's rederiveFts restarts it whenever a re-derivation
 *  generation opens: a pair learned, a unit back, a belt version changed), every node is read in rowid order and each
 *  whose stored gist, topics or refs the current redaction (the belt included) would change is rewritten through
 *  redactNodeFields, its nodes_fts row with it. So is each node whose nodes_fts row differs from lib's nodeIndexTexts
 *  of its stored fields (Task 7A; spec §6.2 `nodes_fts`): a pair-only value glued to a literal escape is masked by the
 *  index's escape readings and not by redactField, so its stored field stays and only its row is stale. A node with
 *  no row yet is Task 9's backfill's, and refs are compared as sets (node_refs has no stored order). This is the one
 *  mechanism that re-derives nodes_fts. rederiveGistsFor's phrase search cannot find a letter-glued or escape-glued
 *  value; this step needs no search. Before that check each condensed node of the batch is rebuilt from its redacted
 *  children when the rebuild differs from its stored gist, topics or refs (a prefix an old cut left in a parent, which no
 *  field rewrite can mask), and the ancestors of every node the step rewrote are re-rolled (D-4610
 *  (history-reroll-from-redacted-children)). The cursor is the last nodes.rowid read, committed after each batch
 *  (D-4730 (history-reindex-subcursor-idempotent)). Answers whether the step is complete (or was never opened). */
export function beltNodesStep(db, ictx, slice) {
  const step = getStep(db, BELT_NODES_STEP, 1);
  if (step === null || step.completedMs !== null) return true;
  const sel = db.prepare('SELECT rowid AS rid, node_id, kind, gist, topics FROM nodes WHERE rowid > ? ORDER BY rowid LIMIT ?');
  const fieldsOf = db.prepare('SELECT gist, topics FROM nodes WHERE node_id = ?');
  const rerollIfChanged = parentReroller(db, ictx, true);
  const refsOf = db.prepare('SELECT value FROM node_refs WHERE node_id = ?');
  const ftsRow = ictx.fts === true ? db.prepare('SELECT gist, topics, refs FROM nodes_fts WHERE rowid = ?') : null;
  const changes = (s) => s !== null && s !== undefined && redactField(s, ictx.pairIdx) !== s;
  const asSet = (s) => String(s ?? '').split('\n').sort().join('\n');
  const stale = (n, refs) => {
    if (ftsRow === null) return false;
    const row = ftsRow.get(n.rid);
    if (row === undefined) return false;
    const t = nodeIndexTexts({ gist: n.gist, topics: topicsOfColumn(n.topics), refs }, ictx.pairIdx);
    return row.gist !== t.gist || row.topics !== t.topics || asSet(row.refs) !== asSet(t.refs);
  };
  // Fail-closed cursor parsing: a cursor that is not a plain number (a damaged store, a restored backup) restarts the step at the
  // first node, as recoverNodesBatch restarts on a cursor off its grammar. Number() of it would be NaN, Infinity or a fraction,
  // `rowid > ?` would then skip nodes, and the step would stamp itself complete having rewritten none of them.
  const raw = /^[0-9]+$/.test(step.cursor ?? '') ? Number(step.cursor) : 0;
  let after = Number.isSafeInteger(raw) ? raw : 0;
  while (ictx.budgetLeft(slice)) {
    const batch = sel.all(after, BELT_NODE_BATCH);
    if (batch.length === 0) {
      withTx(db, 'NORMAL', () => { setStep(db, BELT_NODES_STEP, 1, String(after), ictx.nowMs); });
      return true;
    }
    // Each condensed node of the batch is rebuilt from its redacted children when that differs from what it stores, in rowid
    // order (a child before its parent; nodes are never deleted and every rewrite is an UPDATE), before the dirty check below
    // so that check reads the re-rolled fields. A generation that opens therefore heals a prefix a past cut left in a
    // parent, which a field rewrite can never mask, and rewrites no parent whose re-roll is what it stores (D-4610).
    // Residual (H-217): the test compares gist, topics and refs only, so a parent whose rollup text is unchanged keeps
    // desc_chars counted from the child's raw gist (recall's cost estimate is off by |V| minus the mark until a reparse) and
    // keeps its parser_version stamp.
    for (const n of batch) {
      if (n.kind !== 'condensed' || !rerollIfChanged(n.node_id)) continue;
      const now = fieldsOf.get(n.node_id);
      n.gist = now.gist;
      n.topics = now.topics;
    }
    const dirty = batch.filter((n) => {
      const refs = refsOf.all(n.node_id).map((r) => r.value);
      return changes(n.gist) || topicsOfColumn(n.topics).some(changes) || refs.some(changes) || stale(n, refs);
    }).map((n) => n.node_id);
    if (dirty.length > 0) {
      redactNodeFields(db, ictx, dirty);
      // The ancestors of every node it rewrote are rebuilt from redacted children, as the fast path does, and an ancestor whose
      // re-roll is what it stores is left alone (a node dirty for its index row alone changes none; D-4610, H-154).
      rerollParents(db, ictx, dirty, true);
    }
    after = Number(batch[batch.length - 1].rid);
    withTx(db, 'NORMAL', () => { setStep(db, BELT_NODES_STEP, 1, String(after), null); });
  }
  return false;
}
