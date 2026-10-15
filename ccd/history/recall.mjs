// ccd/history/recall.mjs — the read verbs' executors (W1-B2; spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.2–§8.4).
//
// L4 delivery (§6.4). cli.mjs measures; lib's decisions settle the identity, the store and the scope; this module
// executes a read over the ReadContext cli.mjs hands it. It runs on the read-only handle and returns a
// VerbResult for cli.mjs to render. The cap value (OUTPUT_CAP), the envelopes, the display prefixes and the lag are lib
// functions; the frame reserves (FRAME_RESERVE, TREE_RESERVE, PAGE_FRAME) and describe's page and head sizing
// (describeCharCost, describePageEnd, DESCRIBE_LIST_RESERVE) are this module's, and so are the caps the hardening
// batches added (HA1, HA1 fix round 1): ECHO_MAX (a hint's echo of the caller's input), NAME_MAX (a sidecar name),
// EXPAND_LIST_MAX and EXPAND_LIST_ROOM with listPrefix (how many variant causes and sidecar names an expanded entry
// lists), and cutMarked (describe's gist cut). The fitting stays here, in L4, on purpose: each is a choice about how
// one verb lays out its own page, measured against what THAT verb renders (its human lines and its --json item), and
// no other module reads them. What is a pure rule of the display, with no verb's layout in it, is lib's already: the
// display string for a stored id (displayToken), the envelope and its escapes (recallEnvelope, escapeXmlAttr), the cut
// (cutText, textCost, pageEnd) and the cut item's budget (CUT_TEXT_BUDGET, PAGE_TEXT_BUDGET).
//
// Every select names its columns, never a wildcard projection (C43). A column a later schema version added is named through
// selectColumns(rc.version, …), so a store older than this code answers with that field null (§6.11).
// Merged families and unconfirmed epochs are never read (§6.1, DM46).
// Every recalled field is redacted on its raw text BEFORE any cut or escape, then wrapped in a <ccrc-recall>
// envelope (§8.3). cli.mjs runs the structure-aware final belt (redactFinalJson over the envelope value, redactFinalText over human text) as the second belt.
//
// It reads no environment variable and has no entry guard: cli.mjs imports it.
import {
  EXIT, OUTPUT_CAP, TREE_DEPTH_MAX, SCOPE_FAMILIES_JSON_MAX, selectColumns, displayPrefixes, headerLine, scopeLag, recallEnvelope, capOutput, redactForDisplay, redactFinalJson, readEnvelope, nextLine,
  REASONS, INDEXED_PROVENANCE, SEARCHABLE_PROVENANCE, RANK_POOL, decideGrepIndex, sanitizeFtsQuery, snippetTerms, regexSyntaxIn, regexSyntaxHint, ftsOrderBy, displaySnippet, snippetLine, escapeXmlText, redactField, extractNodeId, resolveScopedId, SEARCH_REACH, parseGrepArgs,
  GREP_LIMIT_DEFAULT, encodeCursor, decodeCursor, canonicalJson, sha256Hex,
  guardRegex, regexPrefilter, REGEX_BUDGET_MS, REGEX_MAX_LEN, historyPaths,
  DESCRIBE_EXCERPT, GIST_MAX, costRow, producerOf, pickHoldingCopy, redactDisplayWindow, parseDescribeArgs, displayToken, foldOneLine, topicsOfColumn,
} from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childrenOf, parentOf, ftsGateFactsOn, blobPlainText, blobPlainTextMeasured, lineageEntries, recoverOpenOn } from './store.mjs';
import * as xlib from './lib.mjs';
import * as xstore from './store.mjs';
import { basename as xbasename } from 'node:path';

/**
 * @typedef {object} ScopeFamily
 * @property {number} sessionPk
 * @property {string} ccrcId
 * @property {string} generation
 * @property {number} firstSeenMs
 */
/**
 * @typedef {object} ReadContext
 * @property {import('node:sqlite').DatabaseSync} db   the read-only handle (openReader); cli.mjs closes it
 * @property {number} version                          the store's user_version
 * @property {object} schema                           SCHEMA_ADDED (an in-process test injects a seam)
 * @property {Readonly<Record<string, readonly string[]>>} [verbTables]  VERB_TABLES; only an in-process test injects a seam (DM44)
 * @property {string | null} storeId
 * @property {number} nowMs
 * @property {string} home
 * @property {string} id                               this session's ccrc id, from tmux
 * @property {string | null} gen                       the generation the counter line names: a UUID, or null
 * @property {{ kind: 'family' | 'project' | 'workspace', id: string, generation: string | null,
 *   project: string | null, workdir: string | null, sessionPks: number[], transcriptPks: number[],
 *   families: ScopeFamily[] }} scope
 * @property {string[]} scopeArgs                      the argv that reproduces this scope on a next: line
 * @property {import('./lib.mjs').PairIndex} pairIdx
 */
/**
 * @typedef {object} VerbResult
 * @property {number} exit
 * @property {string} [reason]
 * @property {string | null} header                    the §8.3 header line
 * @property {string[]} blocks                         the body, already within the cap
 * @property {Record<string, unknown>[]} items         the --json items, full ids (readEnvelope adds trust)
 * @property {number} shown                            K of `shown K of N`
 * @property {number} total                            N: the true in-scope count
 * @property {string[] | null} next                    the argv after `history` on the next: line
 * @property {string} [hint]
 */

/** SQLite binds at most 32766 variables; an IN list is split well below that. */
const IN_PART = 500;
/** `xs` in parts an IN (…) list can bind. */
export function inParts(xs) {
  const out = [];
  for (let i = 0; i < xs.length; i += IN_PART) out.push(xs.slice(i, i + IN_PART));
  return out;
}
const marks = (xs) => xs.map(() => '?').join(', ');
/** A time at minute precision, locale-free. */
const isoOf = (ms) => (ms === null || ms === undefined ? 'unknown' : `${new Date(Number(ms)).toISOString().slice(0, 16)}Z`);

const FAMILY_BY_KEY_SQL = 'SELECT session_pk, ccrc_id, generation, first_seen_ms, merged_into FROM sessions WHERE ccrc_id = ? AND generation = ?';
const FAMILY_BY_PK_SQL = 'SELECT session_pk, ccrc_id, generation, first_seen_ms, merged_into FROM sessions WHERE session_pk = ?';
const NEWEST_FAMILY_SQL = 'SELECT session_pk, ccrc_id, generation, first_seen_ms, merged_into FROM sessions '
  + 'WHERE ccrc_id = ? AND merged_into IS NULL ORDER BY first_seen_ms DESC, session_pk DESC LIMIT 1';

const familyOf = (r) => ({ sessionPk: Number(r.session_pk), ccrcId: r.ccrc_id, generation: r.generation, firstSeenMs: Number(r.first_seen_ms) });

/** This session's family: (id, generation), or the id's newest family when the generation is unknown (§8.2,
 *  §8.8). A row a re-key merged answers with the family it was merged into (§6.1), so no scope reads a merged
 *  row. */
function ownFamily(db, id, generation) {
  const row = generation === null ? db.prepare(NEWEST_FAMILY_SQL).get(id) : db.prepare(FAMILY_BY_KEY_SQL).get(id, generation);
  if (row === undefined) return [];
  const live = row.merged_into === null ? row : db.prepare(FAMILY_BY_PK_SQL).get(row.merged_into);
  return live === undefined ? [] : [familyOf(live)];
}

const PROJECT_FAMILIES_SQL = 'SELECT session_pk, ccrc_id, generation, first_seen_ms, merged_into FROM sessions '
  + 'WHERE project = ? AND merged_into IS NULL ORDER BY first_seen_ms, session_pk';
/** The workspace match (§8.2; slug history-epoch-cwd-real). An epoch matches when either:
 *   - its cwd_real equals realpath(workdir); or
 *   - its cwd_real is NULL (the path no longer resolved at ingest) and its verbatim cwd equals the workdir.
 *  In both cases the family's project must equal this one's. A NULL realpath binds NULL, and NULL = NULL is not
 *  true, so the first arm never matches an unresolved workdir. Only confirmed epochs count. */
const WORKSPACE_FAMILIES_SQL = 'SELECT DISTINCT s.session_pk AS session_pk, s.ccrc_id AS ccrc_id, s.generation AS generation, '
  + 's.first_seen_ms AS first_seen_ms, s.merged_into AS merged_into '
  + 'FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk '
  + 'WHERE e.confirmed_ms IS NOT NULL AND s.merged_into IS NULL AND s.project = ? '
  + 'AND (e.cwd_real = ? OR (e.cwd_real IS NULL AND e.cwd = ?)) '
  + 'ORDER BY s.first_seen_ms, s.session_pk';

/** The scope's families (§8.2). `sel` is decideScope's verdict plus what the read needs: { kind, id, generation,
 *  project, workdir, workdirReal }.
 *   - family: this id's row-life (ownFamily).
 *   - project: every unmerged family of the project.
 *   - workspace: every unmerged family of the project with a confirmed epoch launched in this workdir.
 *  It is strictly narrower than project, and never reached by default (ruled Q12). */
export function familiesOf(db, sel) {
  if (sel.kind === 'project') return sel.project === null ? [] : db.prepare(PROJECT_FAMILIES_SQL).all(sel.project).map(familyOf);
  if (sel.kind === 'workspace') {
    if (sel.project === null || sel.workdir === null) return [];
    return db.prepare(WORKSPACE_FAMILIES_SQL).all(sel.project, sel.workdirReal, sel.workdir).map(familyOf);
  }
  return ownFamily(db, sel.id, sel.generation);
}

/** The transcripts of these families that hold rows: those of CONFIRMED epochs only (an unconfirmed clear epoch
 *  is in no scope, DM46). */
export function transcriptsOf(db, sessionPks) {
  const out = new Set();
  for (const part of inParts(sessionPks)) {
    const rows = db.prepare('SELECT DISTINCT t.transcript_pk AS transcript_pk FROM epochs e '
      + 'JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid '
      + `WHERE e.session_pk IN (${marks(part)}) AND e.confirmed_ms IS NOT NULL `
      + 'AND EXISTS (SELECT 1 FROM entries x WHERE x.transcript_pk = t.transcript_pk)').all(...part);
    for (const r of rows) out.add(Number(r.transcript_pk));
  }
  return [...out].sort((a, b) => a - b);
}

/** Every live file's end-of-file mark for these transcripts: null where no tick has reached its end yet. */
function eofOf(db, transcriptPks) {
  const out = [];
  for (const part of inParts(transcriptPks)) {
    const rows = db.prepare(`SELECT eof_ms FROM ingest_files WHERE source_key = '' AND status = 'live' AND transcript_pk IN (${marks(part)})`).all(...part);
    for (const r of rows) out.push(r.eof_ms === null ? null : Number(r.eof_ms));
  }
  return out;
}

const HEADERS = new WeakMap();
/** §8.3's header for this read: the scope, coverage, indexed-through and lag. lag is now minus the oldest
 *  end-of-file mark in scope; it reads `unmeasured` while any file in scope has none, and while a recovery step
 *  is registered (§8.8: no tick has reached end-of-file). Computed once per context. */
export function scopeHeader(rc) {
  const known = HEADERS.get(rc);
  if (known !== undefined) return known;
  const recovering = recoverOpenOn(rc.db);
  const lag = scopeLag({ eofMs: eofOf(rc.db, rc.scope.transcriptPks), nowMs: rc.nowMs, recovering });
  const line = headerLine({
    kind: rc.scope.kind, id: rc.scope.id, project: rc.scope.project, families: rc.scope.families.length,
    transcripts: rc.scope.transcriptPks.length, indexedThroughMs: lag.indexedThroughMs, lagS: lag.lagS,
  });
  const h = Object.freeze({ line, indexedThroughMs: lag.indexedThroughMs, lagS: lag.lagS });
  HEADERS.set(rc, h);
  return h;
}

/** What tree holds back from the cap besides the header: the shown and next lines. */
const TREE_RESERVE = 400;
const NODE_COLS = ['node_id', 'session_pk', 'epoch_seq', 'kind', 'depth', 'status', 'gist', 'earliest_ms', 'latest_ms'];

function nodeLine(rc, n, level, show) {
  const id = show(n.node_id);
  const gist = typeof n.gist === 'string' && n.gist !== '' ? foldOneLine(redactForDisplay(n.gist, rc.pairIdx)).trim() : '';
  const body = gist === '' ? '(no gist)' : recallEnvelope({ src: 'node', id, ts: n.earliest_ms ?? null, role: n.kind, text: gist });
  return `${'  '.repeat(level + 1)}${id} ${n.kind} depth=${n.depth} ${isoOf(n.earliest_ms)}..${isoOf(n.latest_ms)} ${body}`;
}

/** A complete JSON item for one retained node. Display redaction happens before JSON serialisation, then the
 * delivery layer applies the final belt to the completed envelope. */
function nodeItem(n, parentById, family, rc) {
  const f = family.get(Number(n.session_pk));
  return {
    node_id: n.node_id, parent_id: parentById.get(n.node_id) ?? null, kind: n.kind, depth: Number(n.depth), status: n.status,
    ccrc_id: f === undefined ? null : f.ccrcId, generation: f === undefined ? null : f.generation, epoch_seq: Number(n.epoch_seq),
    earliest_ms: n.earliest_ms ?? null, latest_ms: n.latest_ms ?? null,
    gist: typeof n.gist === 'string' ? redactForDisplay(n.gist, rc.pairIdx) : null,
  };
}

/** The JSON scope mirrors cli.mjs's scopeJson exactly, including its cap-fitting family prefix. */
function jsonScope(rc) {
  return {
    kind: rc.scope.kind, id: rc.scope.id, project: rc.scope.project,
    families: rc.scope.families.slice(0, SCOPE_FAMILIES_JSON_MAX)
      .map((f) => ({ ccrc_id: f.ccrcId, generation: f.generation, first_seen_ms: f.firstSeenMs })),
    families_total: rc.scope.families.length,
    transcripts: rc.scope.transcriptPks.length,
  };
}

/** Render the actual final JSON representation whose length the cap promises. */
function renderJson(rc, head, items, shown, total, next) {
  return `${JSON.stringify(redactFinalJson(readEnvelope({
    exit: EXIT.OK, storeId: rc.storeId, scope: jsonScope(rc),
    header: { indexedThroughMs: head.indexedThroughMs, lagS: head.lagS }, items, shown, total,
    next: next === null ? null : nextLine(next),
  }), rc.pairIdx))}\n`;
}

/** The greatest complete item prefix that fits the final JSON envelope. Each check measures the exact string
 * cli.mjs writes (the same redactFinalJson then JSON.stringify); monotonic binary search avoids rendering every candidate prefix of a large scope. */
function jsonPrefixCount(rc, head, items, total, nextFor) {
  const fits = (n) => renderJson(rc, head, items.slice(0, n), n, total, nextFor(n)).length <= OUTPUT_CAP;
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** `tree [--depth N]` (§8.4): per family, its confirmed epochs; per epoch, its top nodes (those no node
 *  condenses), each followed by its children down to `depth` levels. Each node shows a display prefix unique in
 *  the scope (minimum 6), its kind, its time range and its gist in an envelope. N counts every node in scope,
 *  so `shown K of N` is honest when the depth or the cap hides some. */
export function runTree(rc, a) {
  const pending = pendingFor(rc, 'tree');
  if (pending !== null) return pending;
  const db = rc.db;
  const head = scopeHeader(rc);
  const cols = selectColumns(rc.version, 'nodes', NODE_COLS, rc.schema);
  const nodes = [];
  for (const part of inParts(rc.scope.sessionPks)) {
    nodes.push(...db.prepare(`SELECT ${cols} FROM nodes n WHERE n.session_pk IN (${marks(part)}) AND EXISTS (SELECT 1 FROM epochs e WHERE e.session_pk = n.session_pk AND e.seq = n.epoch_seq AND e.confirmed_ms IS NOT NULL)`).all(...part));
  }
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const prefixes = displayPrefixes([...byId.keys()]);
  const show = (id) => prefixes.get(id) ?? id;
  const parentById = new Map(nodes.map((n) => [n.node_id, parentOf(db, n.node_id)]));
  const rootsByEpoch = new Map();
  for (const n of nodes) {
    if (parentById.get(n.node_id) !== null) continue;
    const k = `${n.session_pk}:${n.epoch_seq}`;
    if (!rootsByEpoch.has(k)) rootsByEpoch.set(k, []);
    rootsByEpoch.get(k).push(n);
  }
  const family = new Map(rc.scope.families.map((f) => [f.sessionPk, f]));
  const epochs = db.prepare('SELECT seq, cc_session_uuid, cause, started_ms FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL ORDER BY seq');
  const out = [];   // { text, node }: node is the row a line shows, or null for a family or epoch line
  const walk = (n, level) => {
    out.push({ text: nodeLine(rc, n, level, show), node: n });
    if (level >= a.depth) return;
    for (const c of childrenOf(db, n.node_id)) {
      const child = byId.get(c.childId);
      if (child !== undefined) walk(child, level + 1);
    }
  };
  for (const f of rc.scope.families) {
    out.push({ text: `family ${f.ccrcId} generation=${f.generation === '' ? '(none)' : f.generation} first-seen=${isoOf(f.firstSeenMs)}`, node: null });
    for (const e of epochs.all(f.sessionPk)) {
      out.push({ text: `  epoch ${e.seq} ${e.cause} started=${isoOf(e.started_ms)} session=${String(e.cc_session_uuid).slice(0, 8)}`, node: null });
      const roots = (rootsByEpoch.get(`${f.sessionPk}:${e.seq}`) ?? [])
        .sort((x, y) => (Number(x.earliest_ms ?? 0) - Number(y.earliest_ms ?? 0)) || (x.node_id < y.node_id ? -1 : 1));
      if (roots.length === 0) out.push({ text: '    (no nodes yet: this epoch is all live tail, which grep searches)', node: null });
      for (const r of roots) walk(r, 1);
    }
  }
  const capped = capOutput(out.map((o) => o.text), head.line.length + TREE_RESERVE);
  let retained = out.slice(0, capped.kept.length);
  let keptNodes = retained.filter((o) => o.node !== null).map((o) => o.node);
  const visibleNodes = out.filter((o) => o.node !== null).map((o) => o.node);
  const candidateItems = keptNodes.map((n) => nodeItem(n, parentById, family, rc));
  const humanCapped = capped.kept.length < out.length;
  const depthOmitted = keptNodes.length < nodes.length && !humanCapped && a.depth < TREE_DEPTH_MAX;
  // A cap can omit headings after every node (or a node-free epoch tree), so an omitted visible node is optional.
  const firstOmittedVisible = humanCapped ? visibleNodes[keptNodes.length] : undefined;
  const defaultNext = firstOmittedVisible !== undefined
    ? ['describe', show(firstOmittedVisible.node_id), ...rc.scopeArgs]
    : depthOmitted
      ? ['tree', '--depth', String(a.depth + 1), ...rc.scopeArgs]
      : keptNodes.length > 0
        ? ['describe', show(keptNodes[0].node_id), ...rc.scopeArgs]
        : null;
  const nextFor = (count) => count < candidateItems.length
    ? ['describe', show(visibleNodes[count].node_id), ...rc.scopeArgs]
    : defaultNext;
  // JSON carries full ids, structural fields and unflattened escaped gists. Its final redacted envelope can be
  // larger than the human blocks, so retain the common prefix that satisfies both representations.
  const jsonCount = jsonPrefixCount(rc, head, candidateItems, nodes.length, nextFor);
  // The mutation pin changes this comparison to false, restoring human-block-only retention.
  if (jsonCount < keptNodes.length) {
    const last = keptNodes[jsonCount - 1];
    retained = last === undefined ? [] : retained.slice(0, retained.findIndex((o) => o.node === last) + 1);
    keptNodes = keptNodes.slice(0, jsonCount);
  }
  const items = keptNodes.map((n) => nodeItem(n, parentById, family, rc));
  const next = nextFor(keptNodes.length);
  return { exit: EXIT.OK, header: head.line, blocks: retained.map((o) => o.text), items, shown: keptNodes.length, total: nodes.length, next };
}

// ---------------------------------------------------------------------------------------------
// grep, the FTS path (spec §8.4, §8.3, §9.1; W1-B2 Task 12).
//  - A hit is one in-scope REFERRER of a matching blob: an entry (its first body), an entry variant (a
//    later body of the same uuid), or a sidecar. Blobs are shared across families, so a blob's match says
//    nothing about scope until it is joined to a referrer.
//  - The scope join and the provenance filter run INSIDE the ranking statement, before its LIMIT
//    (RANK_POOL), so exit 3 means zero in-scope matches, never zero in a global top-N (C27).
//  - total is a separate count of every in-scope matching referrer: the N of "shown K of N" (§8.3).
//  - Every select names its columns through selectColumns, so a store older than this code answers NULL
//    for a column it lacks (§6.11, DM44); none is a wildcard projection (C43).
// ---------------------------------------------------------------------------------------------

/** Room kept for what the CLI prints around a verb's blocks: Task 11's header, `shown K of N`, `next:` and a hint
 *  line; with --json, the envelope's fixed fields and its scope, which names at most a handful of families plus
 *  `families_total` (Task 11's scopeJson and lib's SCOPE_FAMILIES_JSON_MAX), so it is bounded whatever the project holds. A verb's own blocks fill
 *  OUTPUT_CAP minus this (Tasks 13 and 15). */
const FRAME_RESERVE = 1200;

/** The entries columns a referrer carries. */
const REFERRER_ENTRY_COLS = Object.freeze(['entry_id', 'uuid', 'transcript_pk', 'ts_ms', 'role', 'provenance', 'tool_name', 'blob_id']);

/** The FTS match: each blob whose redacted plain text holds the sanitised query, with its BM25 rank. */
const FTS_MATCH = 'SELECT rowid, rank FROM blobs_fts WHERE blobs_fts MATCH :q';

/** The scope join, the provenance filter and grep's filters, over `refs r`. Named parameters: :tpks and :provs
 *  are JSON arrays (json_each), :nodes a JSON array or NULL, the rest a value or NULL. */
const GREP_FILTER = `r.transcript_pk IN (SELECT value FROM json_each(:tpks))
      AND r.provenance IN (SELECT value FROM json_each(:provs))
      AND (:role IS NULL OR r.role = :role)
      AND (:tool IS NULL OR r.tool_name = :tool)
      AND (:since IS NULL OR r.ts_ms >= :since)
      AND (:before IS NULL OR r.ts_ms < :before)
      AND (:nodes IS NULL OR r.entry_id IN (SELECT value FROM json_each(:nodes)))`;

/** One table as a derived table holding the columns the store's version has (NULL AS <col> for one a later
 *  version adds). SQLite flattens it into the enclosing join, so the table's own indexes still serve it. */
function versioned(rc, table, alias, cols) {
  return `(SELECT ${selectColumns(rc.version, table, cols, rc.schema)} FROM ${table}) AS ${alias}`;
}

/** The named parameters `sql` uses, taken from `all`. node:sqlite refuses a named parameter the statement does
 *  not hold ("Unknown named parameter", M, 22.16.0), and the ranked and count statements use different sets. */
function bindFor(sql, all) {
  const out = {};
  for (const [k, v] of Object.entries(all)) if (new RegExp(`:${k}(?![A-Za-z0-9_])`).test(sql)) out[k] = v;
  return out;
}

/** `refs`: every referrer of a blob `matchSql` selects as (blob_id, rank). That is the FTS MATCH here, and the
 *  regex child's blob list in Task 14. `ref_key` is the referrer's own immutable identity, unique across the three
 *  routes (an entry by its id, a variant by its entry and blob, a sidecar by its primary key: transcript, name,
 *  blob), so the ranked order can be total. A variant whose blob is the entry's first body is that entry's own row
 *  (§6.2: the first body also gets a variant row once a second appears), so it is not counted twice. */
function referrerSql(rc, matchSql) {
  const e = (alias) => versioned(rc, 'entries', alias, REFERRER_ENTRY_COLS);
  return `WITH m(blob_id, rank) AS (${matchSql}),
  refs(via, entry_id, uuid, transcript_pk, ts_ms, role, provenance, tool_name, blob_id, name, rank, ref_key) AS (
    SELECT 'entry', e.entry_id, e.uuid, e.transcript_pk, e.ts_ms, e.role, e.provenance, e.tool_name, m.blob_id, NULL, m.rank,
        'entry:' || e.entry_id
      FROM m JOIN ${e('e')} ON e.blob_id = m.blob_id
    UNION ALL
    SELECT 'variant', e.entry_id, e.uuid, e.transcript_pk, e.ts_ms, e.role, e.provenance, e.tool_name, m.blob_id, NULL, m.rank,
        'variant:' || e.entry_id || ':' || v.blob_id
      FROM m JOIN ${versioned(rc, 'entry_variants', 'v', ['entry_id', 'blob_id'])} ON v.blob_id = m.blob_id
        JOIN ${e('e')} ON e.entry_id = v.entry_id
      WHERE v.blob_id <> e.blob_id
    UNION ALL
    SELECT 'sidecar', s.entry_id, se.uuid, s.transcript_pk, COALESCE(se.ts_ms, s.first_seen_ms), NULL, 'tool', NULL,
        m.blob_id, s.name, m.rank, 'sidecar:' || s.transcript_pk || ':' || s.name || ':' || s.blob_id
      FROM m JOIN ${versioned(rc, 'sidecars', 's', ['transcript_pk', 'name', 'blob_id', 'entry_id', 'first_seen_ms'])} ON s.blob_id = m.blob_id
        LEFT JOIN ${versioned(rc, 'entries', 'se', ['entry_id', 'uuid', 'ts_ms'])} ON se.entry_id = s.entry_id
  )`;
}

/** The top RANK_POOL in-scope referrers in `sort` order. The scope sits in this statement's WHERE, before its
 *  LIMIT (C27). The tie-break makes the order total (the last term, `ref_key`, is unique per referrer), so a
 *  cursor's position means one hit even among sidecars that share rank, time, blob and a NULL entry. */
function rankedSql(rc, matchSql, sort) {
  return `${referrerSql(rc, matchSql)}
  SELECT r.via AS via, r.entry_id AS entry_id, r.uuid AS uuid, r.ts_ms AS ts_ms, r.role AS role,
      r.provenance AS provenance, r.blob_id AS blob_id, r.name AS name, r.transcript_pk AS transcript_pk
    FROM refs r WHERE ${GREP_FILTER}
    ORDER BY ${ftsOrderBy(sort, 'r.ts_ms')}, r.blob_id, r.entry_id, r.ref_key LIMIT :pool`;
}

/** The true in-scope count, the same filter with no LIMIT. */
function countSql(rc, matchSql) {
  return `${referrerSql(rc, matchSql)}
  SELECT count(*) AS n FROM refs r WHERE ${GREP_FILTER}`;
}

/** A refusing VerbResult. Its exit is the one REASONS maps the word to (2, 4, 5 or 7). `hint` is the hint's text;
 *  the CLI prints it after `hint: ` (Task 10's emitResult). */
function refusal(reason, hint = null) {
  return { exit: REASONS[reason], reason, header: null, blocks: [], items: [], shown: 0, total: 0, next: null, ...(hint === null ? {} : { hint }) };
}

/** Exit 3: nothing in this scope, on this box (§8.3; coverage=this-box). It carries no reason. */
function notFound() {
  return { exit: EXIT.NOT_FOUND, header: null, blocks: [], items: [], shown: 0, total: 0, next: null };
}

/** grep's exit 3, both forms (§8.3): notFound plus the one line that says how far grep reaches, lib's SEARCH_REACH
 *  (B1's history-entry-index-text-windowed and history-sidecar-redact-before-cut; spec §8.4, rev 3.5).
 *  Only grep prints it: describe, expand and tree search nothing, and their exit 3 means an id is not in scope. */
function grepNotFound() {
  return { ...notFound(), hint: SEARCH_REACH };
}

/** A hint's text as VerbResult.hint carries it. The CLI prints the `hint: ` prefix itself (Task 10's emitResult),
 *  so one that arrives prefixed is stripped, never doubled. */
function hintLine(text) {
  return text.startsWith('hint: ') ? text.slice('hint: '.length) : text;
}

/** The flags that reproduce this call's scope in a `next:` line. */
function scopeArgs(rc) {
  if (rc.scope.kind === 'project') return ['--project'];
  if (rc.scope.kind === 'workspace') return ['--workspace'];
  return rc.scope.id === rc.id ? [] : ['--session', rc.scope.id];
}

/** An ISO time, or `?` for none. */
function iso(ms) {
  return ms === null || ms === undefined ? '?' : new Date(ms).toISOString();
}

/** A node id, prefix or pasted line resolved INSIDE the scope (§8.2 "Every verb resolves ids inside the scope";
 *  RV19). A node outside it is exit 2 out-of-scope, never 3; prefix uniqueness is computed among the scope's
 *  nodes. Node ids are hex after the kind letter, so `wanted + 'g'` bounds the prefix range on the primary key. */
export function resolveNodeInScope(rc, wanted) {
  const rows = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id', 'session_pk'], rc.schema)} FROM nodes
    WHERE node_id >= ? AND node_id < ?`).all(wanted, `${wanted}g`);
  const mine = new Set(rc.scope.sessionPks);
  const verdict = resolveScopedId({
    wanted,
    inScope: rows.filter((x) => mine.has(x.session_pk)).map((x) => x.node_id),
    outOfScope: rows.filter((x) => !mine.has(x.session_pk)).map((x) => x.node_id),
  });
  switch (verdict.kind) {
    case 'ok': return { ok: true, id: verdict.id };
    case 'out-of-scope': return { ok: false, result: refusal('out-of-scope') };
    case 'not-found': return { ok: false, result: notFound() };
    case 'ambiguous':
      return { ok: false, result: refusal('bad-args',
        `${wanted} names ${verdict.candidates.length} nodes in this scope (${verdict.candidates.slice(0, 5).join(', ')}); give more of the id`) };
    default: return { ok: false, result: refusal('bad-args') };
  }
}

/** The most a hint echoes of the caller's own input. */
const ECHO_MAX = 400;

/** A caller's own input echoed inside a hint (extractNodeId's error holds the raw target; D-4597
 *  (history-read-names-and-echoes-display-redacted)): redacted on its raw text, THEN folded to one line and cut at
 *  ECHO_MAX (§8.3's order), so a target holding a line break forges no line and a 100 KB argv cannot fill the cap. The
 *  raw sits at the end of the error, so the cut drops only the echo's tail. */
function echoLine(rc, text) {
  return snippetLine(foldOneLine(redactField(text, rc.pairIdx)), ECHO_MAX);
}

/** `--node`'s entries: the node resolved in scope, then its lineage (Task 9's range CTE, toward sources). */
function nodeEntries(rc, raw) {
  const ex = extractNodeId(raw);
  if (!ex.ok) return { ok: false, result: refusal('bad-args', hintLine(echoLine(rc, ex.error))) };
  const found = resolveNodeInScope(rc, ex.id);
  if (!found.ok) return found;
  return { ok: true, entries: lineageEntries(rc.db, found.id).map((x) => x.entryId) };
}

/** Every named parameter grep's statements may use; bindFor keeps each statement's own. */
function grepParams(rc, a, nodes, extra) {
  return {
    ...extra,
    tpks: JSON.stringify(rc.scope.transcriptPks),
    provs: JSON.stringify(a.includeRecall ? INDEXED_PROVENANCE : SEARCHABLE_PROVENANCE),
    role: a.role, tool: a.tool, since: a.sinceMs, before: a.beforeMs,
    nodes: nodes === null ? null : JSON.stringify(nodes),
    pool: RANK_POOL, now_ms: rc.nowMs,
  };
}

/** The ranked pool and the true count. When blobs_fts vanished between the gate and the statement (a
 *  `doctor --repair` drop and recreate), the answer is 7 fts-pending, never exit 1 (review focus 5). */
function rankedAndCounted(rc, matchSql, sort, all) {
  try {
    const rs = rankedSql(rc, matchSql, sort);
    const cs = countSql(rc, matchSql);
    const pool = rc.db.prepare(rs).all(bindFor(rs, all));
    const total = Number(rc.db.prepare(cs).get(bindFor(cs, all)).n);
    return { pool, total };
  } catch (e) {
    if (/no such table: (?:main\.)?blobs_fts\b/.test(String(e && e.message))) return { result: refusal('fts-pending') };
    throw e;
  }
}

/** grep's index gate on the reader (§9.1): store.mjs's four measurements (the read-only probe, blobs_fts, the backfill's row
 *  and an open doctor --repair rebuild row), the one reader status's fts word shares (HI2 H-163), decided by lib's decideGrepIndex. */
function indexGate(rc) {
  return decideGrepIndex(ftsGateFactsOn(rc.db));
}

/** A blob's z, its recorded size (blobPlainText's decode bound, and its sidecar and body caps) and pruned time. */
function blobOf(rc, blobId) {
  return rc.db.prepare(`SELECT ${selectColumns(rc.version, 'blobs', ['z', 'raw_len', 'pruned_ms'], rc.schema)} FROM blobs WHERE blob_id = ?`).get(blobId);
}

/** One hit's snippet (§8.3, P9, P12). lib's displaySnippet finds the earliest term in the blob's RAW plain text,
 *  reads only the window around it plus ENTRY_REDACT_MARGIN on each side through redactForDisplay's reading (the
 *  index's escape readings too) and cuts the window from that reading, or shows it inexact under
 *  DISPLAY_INEXACT_NOTE when the cut cannot be shown exact (Task 12's displayWindow); the line is then made one line and cut to SNIPPET_MAX
 *  by Task 3's snippetLine (surrogate-safe). Redaction comes before every cut, so no window edge can leave a piece of
 *  a secret (B1's D-4202 (`history-redaction-before-cut`)), and one hit costs its window, never its whole body: a
 *  body can be BLOB_DECODE_MAX (16 MiB) long, and `renderHits` builds a snippet for every hit on a page
 *  (spec §8.3 and §8.4; review finding R37). A sidecar's text is already redacted inside
 *  blobPlainText, before its own 512 KB cut, and the window re-checks it. */
function hitSnippet(rc, hit, terms) {
  const b = blobOf(rc, hit.blob_id);
  if (b === undefined) return '';
  if (b.z === null) return `content pruned on ${b.pruned_ms === null ? '?' : new Date(b.pruned_ms).toISOString().slice(0, 10)}`;
  const plain = blobPlainText(b.z, hit.via === 'sidecar', rc.pairIdx, Number(b.raw_len));
  return snippetLine(foldOneLine(displaySnippet(plain, terms, rc.pairIdx)));
}

/** The longest sidecar name any read verb prints. */
const NAME_MAX = 256;

/** A stored sidecar name as every read verb shows it: redacted on its raw text (redactForDisplay, so the escape-glued
 *  reading a --json newline makes is covered), then folded to one line (foldOneLine: a VT, an FF, an FS, a GS, an RS and a NEL
 *  split a line for some readers, and --json leaves U+0085 raw) and cut at NAME_MAX (D-4597
 *  (history-read-names-and-echoes-display-redacted); D-4596 (history-read-fixed-fields-fit-the-cap)). A name that is
 *  absent stays null: a sidecar-less hit carries none. */
function nameShown(rc, name) {
  if (name === null || name === undefined) return name;
  const shown = foldOneLine(redactForDisplay(String(name), rc.pairIdx));
  return shown.length <= NAME_MAX ? shown : xlib.cutText(shown, NAME_MAX, 6 * NAME_MAX);
}

/** A stored uuid, role or provenance as the ONE bounded, redacted display string every read verb prints (lib's
 *  displayToken; D-4597 (history-read-names-and-echoes-display-redacted)): a real token as it is, any other quoted. It is
 *  not XML-escaped; each sink escapes it once (an envelope attribute, a text line, JSON). An absent or empty value stays
 *  as it is, so the seam keeps its two conditions apart. */
function idShown(rc, v) {
  return v === null || v === undefined || v === '' ? v : displayToken(v, rc.pairIdx);
}

/** The family each hit belongs to, under a widened scope only (`--workspace`, `--project`; spec §8.2: "Each hit prints
 *  its family (id, generation, first seen)", the attribution a session needs to tell its own family's hits from an
 *  unrelated earlier task that reused the workdir; W1-B2 whole-branch fix round 1, item B). One bounded query maps the
 *  page's transcripts to their confirmed epochs' sessions (the join `transcriptsOf` made when it built the scope), kept to
 *  the scope's own families. A transcript two of the scope's families share (a fork) answers the family seen first
 *  (`first_seen_ms`, then `session_pk`), as coveringLeaves groups under the lower node id. Under the family scope the
 *  scope IS the family and the map is empty, so nothing new prints. A hit whose transcript maps to no family of the
 *  scope cannot occur (the scope's transcripts come from this same join) and prints none, never a null family.
 *  The ids are display strings (displayToken), as every stored id is. */
function hitFamilies(rc, hits) {
  const out = new Map();
  if (rc.scope.kind === 'family' || hits.length === 0) return out;
  const tpks = [...new Set(hits.map((h) => h.transcript_pk).filter((x) => x !== null && x !== undefined))];
  if (tpks.length === 0) return out;
  const mine = new Map(rc.scope.families.map((f) => [f.sessionPk, f]));
  const rows = rc.db.prepare(`SELECT DISTINCT t.transcript_pk AS transcript_pk, e.session_pk AS session_pk FROM transcripts t
      JOIN epochs e ON e.cc_session_uuid = t.cc_session_uuid
      WHERE t.transcript_pk IN (SELECT value FROM json_each(?)) AND e.confirmed_ms IS NOT NULL
        AND e.session_pk IN (SELECT value FROM json_each(?))`).all(JSON.stringify(tpks), JSON.stringify(rc.scope.sessionPks));
  const first = new Map();
  for (const r of rows) {
    const f = mine.get(Number(r.session_pk));
    if (f === undefined) continue;
    const had = first.get(Number(r.transcript_pk));
    if (had === undefined || f.firstSeenMs < had.firstSeenMs || (f.firstSeenMs === had.firstSeenMs && f.sessionPk < had.sessionPk)) first.set(Number(r.transcript_pk), f);
  }
  for (const [tpk, f] of first) out.set(tpk, { id: idShown(rc, f.ccrcId), generation: idShown(rc, f.generation), firstSeenMs: f.firstSeenMs });
  return out;
}

/** A hit's human line: its snippet inside the untrusted-content envelope, which escapes it (§8.3, P30). The id and the
 *  role go in as display strings, so a 300,000-character uuid cannot pass the cap and the envelope escapes each once.
 *  `family` (hitFamilies; widened scopes only) is an attribute of the envelope. */
function hitLine(rc, hit, snippet, family) {
  const id = hit.uuid === null || hit.uuid === undefined ? `sidecar:${nameShown(rc, hit.name)}` : idShown(rc, hit.uuid);
  return `  ${recallEnvelope({ src: hit.provenance, id, ts: hit.ts_ms, role: idShown(rc, hit.role), text: snippet, ...(family === undefined ? {} : { family }) })}`;
}

/** A hit's --json item: JSON escaping only (§8.3). A uuid, role or provenance of the shape of every real one is an exact
 *  copy; any other is the bounded, redacted display form, as describe and expand carry it (D-4597). */
function hitItem(rc, hit, snippet, nodeId, family) {
  return {
    entry_uuid: idShown(rc, hit.uuid), node_id: nodeId, ts_ms: hit.ts_ms, role: idShown(rc, hit.role), provenance: idShown(rc, hit.provenance), snippet,
    sidecar: nameShown(rc, hit.name), ...(family === undefined ? {} : { family: { ccrc_id: family.id, generation: family.generation, first_seen_ms: family.firstSeenMs } }),
    trust: 'untrusted',
  };
}

/** The group key of rows no leaf covers yet: grep's live tail (§8.4). */
const LIVE_TAIL = '';

/** The hint a refused cursor carries. */
const STALE_CURSOR = 'that --cursor belongs to another query, scope or filter; run the query again without it';

/** What a grep cursor is bound to: the query, the scope and every filter. A cursor from another query or scope
 *  is refused, never applied to the wrong list. */
function grepKey(rc, a) {
  return sha256Hex(canonicalJson({
    words: a.regex === null ? sanitizeFtsQuery(a.words.join(' ')) : null, regex: a.regex,
    scope: [rc.scope.kind, rc.scope.id, rc.scope.generation],
    role: a.role, tool: a.tool, since: a.sinceMs, before: a.beforeMs, node: a.node, sort: a.sort, recall: a.includeRecall,
  })).slice(0, 20);
}

/** The ranked-pool offset a --cursor names, 0 with none, or null for a cursor that does not decode or belongs to
 *  another key. An offset is a position in a total order (rankedSql's tie-break). Text indexed between two pages
 *  can shift it by the number of new hits; that is accepted. */
function cursorPos(cursor, key) {
  if (cursor === null) return 0;
  const c = decodeCursor(cursor, 'grep');
  if (c === null || c.q !== key || !Number.isSafeInteger(c.pos) || c.pos < 0) return null;
  return c.pos;
}

/** The next page's argv: this call's query, scope and filters, then the cursor. Each argument is redacted as a raw
 *  field before nextLine serialises it (history-redaction-before-cut). Times are absolute, so a relative --since
 *  does not drift between pages. */
function grepArgv(rc, a, cursor) {
  const out = ['grep'];
  if (a.regex !== null) out.push('--regex', a.regex);
  out.push(...scopeArgs(rc));
  if (a.role !== null) out.push('--role', a.role);
  if (a.tool !== null) out.push('--tool', a.tool);
  if (a.sinceMs !== null) out.push('--since', new Date(a.sinceMs).toISOString());
  if (a.beforeMs !== null) out.push('--before', new Date(a.beforeMs).toISOString());
  if (a.node !== null) out.push('--node', a.node);
  if (a.sort !== 'recency') out.push('--sort', a.sort);
  if (a.limit !== GREP_LIMIT_DEFAULT) out.push('--limit', String(a.limit));
  if (a.includeRecall) out.push('--include-recall');
  if (a.json) out.push('--json');
  out.push('--cursor', cursor);
  if (a.regex === null) out.push('--', ...a.words);
  return out.map((x) => redactField(x, rc.pairIdx));
}

/** Display prefixes for every node of the scope (§6.1): unique within the scope, never shorter than
 *  NODE_ID_DISPLAY_MIN. */
function scopePrefixes(rc) {
  const ids = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id'], rc.schema)} FROM nodes
    WHERE session_pk IN (SELECT value FROM json_each(?))`).all(JSON.stringify(rc.scope.sessionPks)).map((r) => r.node_id);
  return displayPrefixes(ids);
}

/** Each entry's covering leaf, through node_sources_entry (§8.4). node_sources holds leaf edges only (§6.3). Two
 *  fork leaves can hold one shared row (DM36, DM37); it groups under the lower node_id, deterministically. Only a
 *  leaf of the scope's own families counts: an entry is store-global, so another family's leaf can hold the same
 *  row, and that leaf is not this scope's to show. */
function coveringLeaves(rc, entryIds) {
  if (entryIds.length === 0) return new Map();
  const rows = rc.db.prepare(`SELECT ns.entry_id AS entry_id, min(ns.node_id) AS node_id
      FROM ${versioned(rc, 'node_sources', 'ns', ['node_id', 'entry_id'])}
      JOIN ${versioned(rc, 'nodes', 'n', ['node_id', 'session_pk'])} ON n.node_id = ns.node_id
      WHERE ns.entry_id IN (SELECT value FROM json_each(?)) AND n.session_pk IN (SELECT value FROM json_each(?))
      GROUP BY ns.entry_id`).all(JSON.stringify(entryIds), JSON.stringify(rc.scope.sessionPks));
  return new Map(rows.map((r) => [r.entry_id, r.node_id]));
}

/** The time range and gist of each group's leaf. */
function leafHeads(rc, ids) {
  if (ids.length === 0) return new Map();
  const rows = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', ['node_id', 'earliest_ms', 'latest_ms', 'gist'], rc.schema)}
    FROM nodes WHERE node_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids));
  return new Map(rows.map((r) => [r.node_id, r]));
}

/** One page of hits (§8.3, §8.4), grouped under their covering leaves plus a live tail.
 *  - The page is pool[pos, pos + limit).
 *  - The cap is fitted in RANK order: K is the most leading hits whose grouped rendering (or, with --json, whose
 *    items) fits OUTPUT_CAP minus FRAME_RESERVE. At least one hit is always shown. Those K are then grouped; groups
 *    are ordered by their best hit, and hits keep rank order inside a group.
 *  - The next cursor is pos + K, so the cap never skips a hit.
 *  - A leaf group shows the leaf's display prefix, its time range and its gist, redacted as every read verb
 *    redacts (redactForDisplay, so the index's escape readings too), then cut (one line,
 *    SNIPPET_MAX). Every recalled field sits in an escaped envelope.
 *  - `total` is the true in-scope count; past RANK_POOL there is no next page, and a hint says so. */
function renderHits(rc, pool, termsOf, a, page, deps = {}) {
  const budget = (deps.cap ?? OUTPUT_CAP) - FRAME_RESERVE;
  const hits = pool.slice(page.pos, page.pos + a.limit);
  if (hits.length === 0) return grepNotFound();
  const snippets = hits.map((h) => hitSnippet(rc, h, termsOf(h)));
  const leafOf = coveringLeaves(rc, [...new Set(hits.map((h) => h.entry_id).filter((x) => x !== null))]);
  const groupOf = hits.map((h) => (h.entry_id === null ? LIVE_TAIL : leafOf.get(h.entry_id) ?? LIVE_TAIL));
  const heads = leafHeads(rc, [...new Set(groupOf.filter((g) => g !== LIVE_TAIL))]);
  const pre = scopePrefixes(rc);
  const headers = new Map();
  const headerOf = (g) => {
    if (headers.has(g)) return headers.get(g);
    let text;
    if (g === LIVE_TAIL) {
      text = '── live tail (rows no leaf covers yet)';
    } else {
      const n = heads.get(g);
      const shown = pre.get(g) ?? g;
      text = `── leaf ${shown} ${iso(n?.earliest_ms ?? null)} → ${iso(n?.latest_ms ?? null)}`;
      if (n !== undefined && n.gist !== null) {
        const gist = foldOneLine(redactForDisplay(n.gist, rc.pairIdx)).trim();
        const cut = snippetLine(gist);
        text += `\n  ${recallEnvelope({ src: 'node', id: shown, ts: n.latest_ms, role: null, text: cut })}`;
      }
    }
    headers.set(g, text);
    return text;
  };
  const families = hitFamilies(rc, hits);
  const familyOfHit = (h) => families.get(Number(h.transcript_pk));
  const lines = hits.map((h, i) => hitLine(rc, h, snippets[i], familyOfHit(h)));
  const items = hits.map((h, i) => hitItem(rc, h, snippets[i], groupOf[i] === LIVE_TAIL ? null : groupOf[i], familyOfHit(h)));
  const grouped = (k) => {
    const order = [];
    const members = new Map();
    for (let i = 0; i < k; i += 1) {
      if (!members.has(groupOf[i])) { members.set(groupOf[i], []); order.push(groupOf[i]); }
      members.get(groupOf[i]).push(lines[i]);
    }
    return order.map((g) => [headerOf(g), ...members.get(g)].join('\n'));
  };
  const size = (k) => (a.json ? JSON.stringify(items.slice(0, k)).length : grouped(k).join('\n').length);
  let k = 1;
  while (k < hits.length && size(k + 1) <= budget) k += 1;
  const end = page.pos + k;
  const next = end < pool.length ? grepArgv(rc, a, encodeCursor({ v: 1, resource: 'grep', q: page.key, pos: end })) : null;
  const beyondPool = next === null && page.total > pool.length;
  return {
    exit: EXIT.OK, header: null, blocks: grouped(k), items: items.slice(0, k), shown: Math.min(k, items.length), total: page.total, next,
    ...(beyondPool ? { hint: `ranking covers the top ${RANK_POOL} in-scope matches; narrow the words, or add --since or --before` } : {}),
  };
}

/** `grep <words>` (§8.4). In order:
 *  1. regex syntax in plain search refuses BEFORE any statement is prepared (C7);
 *  2. a --cursor that does not belong to this query refuses;
 *  3. the index gate;
 *  4. `--node`, resolved in scope;
 *  5. the ranked pool and the true count;
 *  6. one grouped, capped page. */
export function runGrep(rc, a, deps = {}) {
  const pending = pendingFor(rc, 'grep');
  if (pending !== null) return pending;
  if (a.regex !== null) return runRegex(rc, a, deps);
  const raw = a.words.join(' ');
  const syntax = regexSyntaxIn(raw);
  if (syntax !== null) {
    return refusal('regex-syntax', hintLine(regexSyntaxHint(escapeXmlText(echoLine(rc, raw)), syntax)));
  }
  const key = grepKey(rc, a);
  const pos = cursorPos(a.cursor, key);
  if (pos === null) return refusal('bad-args', STALE_CURSOR);
  const gate = indexGate(rc);
  if (!gate.ok) return refusal(gate.reason);
  let nodes = null;
  if (a.node !== null) {
    const ne = nodeEntries(rc, a.node);
    if (!ne.ok) return ne.result;
    nodes = ne.entries;
  }
  const found = rankedAndCounted(rc, FTS_MATCH, a.sort, grepParams(rc, a, nodes, { q: sanitizeFtsQuery(raw) }));
  if ('result' in found) return found.result;
  if (found.total === 0) return grepNotFound();   // Task 12's reach line, kept
  // The snippet's needles keep a terminal prefix `*` that queryTerms strips (fix round 1, F1; R-T13-1).
  return renderHits(rc, found.pool, () => snippetTerms(raw), a, { pos, total: found.total, key }, deps);
}

/** cli.mjs's READ_RUNNERS.grep (W1-B2 Task 12). Task 10's whitelist has already refused an unknown or repeated
 *  option; grep's own value grammar (lib parseGrepArgs) re-reads the verb's argv for the values: the time bounds,
 *  --role, --tool and the regex-or-words rule. A refused value is exit 2 bad-args. */
export function grepVerb(rc, argv) {
  const g = parseGrepArgs(argv, rc.nowMs);
  return g.ok ? runGrep(rc, g.args) : refusal('bad-args');
}

// ---------------------------------------------------------------------------------------------
// grep --regex (spec §8.4, §9.1; W1-B2 Task 14). A separate path:
//  1. the guard (lib's guardRegex): too long, nested or invalid is a discriminated refusal, and no child is spawned
//     (C8a);
//  2. the same cursor check and index gate as plain grep;
//  3. regex-worker.mjs, over redacted text, killed at a wall-clock budget. A kill is exit 2 regex-timeout, never
//     "no match" (C8b);
//  4. the matching blobs go through grep's own referrer join: scope, provenance and filters, a true count, and Task
//     13's grouped and capped page. Hits are newest first: a regex hit has no rank.
// ---------------------------------------------------------------------------------------------

/** The regex child, beside this file. */
export const WORKER_PATH = fileURLToPath(new URL('./regex-worker.mjs', import.meta.url));
/** The child's stdout bound: one short JSON line per matching blob. */
const WORKER_MAX_BUFFER = 64 * 1024 * 1024;
/** The child's matches as the (blob_id, rank) rows referrerSql reads. */
const REGEX_MATCH = 'SELECT value, 0 FROM json_each(:blobs)';

/** The parent's pair index as the pairs the child rebuilds it from: (len, sha256) only, never a value. It iterates
 *  each length's set, so `idx` must be a makePairIndex result (rc.pairIdx always is): lib.d.mts types the values as
 *  bare `{ has }` objects, and a makeProbeIndex result's values are exactly that, with nothing to iterate. */
function pairsOf(idx) {
  const out = [];
  for (const [len, shas] of idx.byLen) for (const sha256 of shas) out.push({ len, sha256 });
  return out;
}

/** exit 1: the child failed for a reason other than its budget. */
function childFailed(detail) {
  return { exit: EXIT.INTERNAL, header: null, blocks: [], items: [], shown: 0, total: 0, next: null, hint: `the --regex child failed: ${foldOneLine(detail)}` };
}

/** `grep --regex <pattern>`. `deps.budgetMs` and `deps.spawn` are in-process test seams (history-test-seams-not-env). */
export function runRegex(rc, a, deps = {}) {
  const pending = pendingFor(rc, 'grep');
  if (pending !== null) return pending;
  const guard = guardRegex(a.regex);
  if (!guard.ok) {
    return refusal('regex-refused', `--regex refused (${guard.why}): keep the pattern to at most ${REGEX_MAX_LEN} characters, valid, and with no repeated group over a variable quantifier or an alternation`);
  }
  const key = grepKey(rc, a);
  const pos = cursorPos(a.cursor, key);
  if (pos === null) return refusal('bad-args', STALE_CURSOR);
  const gate = indexGate(rc);
  if (!gate.ok) return refusal(gate.reason);
  let nodes = null;
  if (a.node !== null) {
    const ne = nodeEntries(rc, a.node);
    if (!ne.ok) return ne.result;
    nodes = ne.entries;
  }
  const job = {
    dbPath: historyPaths(rc.home).dbFile,
    transcriptPks: rc.scope.transcriptPks,
    provenance: [...(a.includeRecall ? INDEXED_PROVENANCE : SEARCHABLE_PROVENANCE)],
    prefilter: regexPrefilter(a.regex),
    pattern: guard.source,
    pairs: pairsOf(rc.pairIdx),
    // §8.3 layer 4: the parent's units, so the child masks what this process's output would. stdin only.
    belt: rc.pairIdx.belt == null ? [] : [...rc.pairIdx.belt.texts],
  };
  const budgetMs = deps.budgetMs ?? REGEX_BUDGET_MS;
  const spawn = deps.spawn ?? spawnSync;
  // No `env` option: the child inherits this process's environment, as every child of the CLI does; it reads no
  //  variable, and the job's values (pairs, belt units) travel on stdin only (D-4702).
  const r = spawn(process.execPath, ['--no-warnings', WORKER_PATH], {
    input: JSON.stringify(job), encoding: 'utf8', timeout: budgetMs, killSignal: 'SIGKILL', maxBuffer: WORKER_MAX_BUFFER,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    return refusal('regex-timeout', `--regex ran past ${budgetMs} ms and was stopped; add a literal word to the pattern, or narrow the scope`);
  }
  if (r.error || r.status !== 0) {
    // The child's stderr is redacted on its raw text BEFORE the cut (§8.3: field by field, before any cut): a value
    // straddling character 300 would otherwise leave a prefix no pair matches.
    return childFailed(r.error ? r.error.message : `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}: ${redactField(String(r.stderr ?? '').trim(), rc.pairIdx).slice(0, 300)}`);
  }
  let lines;
  try {
    lines = String(r.stdout).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
  } catch {
    return childFailed('its output is not JSON lines');   // fixed words: V8's message would quote the line
  }
  // JSON.parse accepts any value: a `null`, a number or an array line would throw below, past childFailed.
  if (!lines.every((l) => l !== null && typeof l === 'object' && !Array.isArray(l))) return childFailed('its output is not JSON objects');
  const done = lines.at(-1);
  if (done === undefined || done.done !== true) return childFailed('it ended without its done line');
  const matched = new Map(lines.slice(0, -1).map((m) => [m.blob_id, m.match]));
  if (matched.size === 0) return grepNotFound();
  const found = rankedAndCounted(rc, REGEX_MATCH, 'recency', grepParams(rc, a, nodes, { blobs: JSON.stringify([...matched.keys()]) }));
  if ('result' in found) return found.result;
  if (found.total === 0) return grepNotFound();
  return renderHits(rc, found.pool, (h) => [matched.get(h.blob_id) ?? ''], a, { pos, total: found.total, key }, deps);
}

// ---------------------------------------------------------------------------------------------
// describe (spec §8.4, §8.2, §8.3; W1-B2 Task 15). One node, resolved INSIDE the scope from a full id, a display
// prefix or a pasted card line (§11 P28, lib's extractNodeId). It prints:
//  - the node's kind, depth, status, time range, producing model family (§6.2) and parent;
//  - its gist, topics, refs and files;
//  - each child (a condensed node) or source (a leaf) as one line with chars= and fits=in|over (§11 P13: costs
//    in characters, against the output cap);
//  - for a leaf with a summary, the summary's first DESCRIBE_EXCERPT characters, with --full paging the rest by a
//    cursor bound to the node.
// Every recalled field is redacted first, then cut, then enveloped (history-redaction-before-cut). The summary is
// read RAW, and the excerpt and each --full page are redacted as windows with ENTRY_REDACT_MARGIN each side (lib's
// redactDisplayWindow; spec §8.3 and §8.4), never the whole summary. A flagged gist is printed
// unchanged: the flag only marks it (§7.4 item 9).
// ---------------------------------------------------------------------------------------------

/** The nodes columns describe reads, named through selectColumns. */
const DESCRIBE_NODE_COLS = Object.freeze(['node_id', 'session_pk', 'transcript_pk', 'kind', 'depth', 'status', 'gist', 'topics',
  'summary_blob_id', 'boundary_entry_id', 'earliest_ms', 'latest_ms', 'src_chars', 'desc_count', 'desc_chars',
  'directive_flag', 'capped']);
/** Room a --full page keeps for its own label line and the envelope's tag. */
const PAGE_FRAME = 300;
/** What describe's head (gist, topics, refs, files, excerpt) leaves free for the child or source list when the head
 *  has to be cut to fit: about ninety rows (D-4596 (history-read-fixed-fields-fit-the-cap)). A list shorter than this
 *  keeps only its own cost free. */
const DESCRIBE_LIST_RESERVE = 4000;
/** The hint a refused describe cursor carries. */
const DESCRIBE_STALE_CURSOR = 'that --cursor pages another node, or ran past its summary; describe the node again with --full';

function nodeRow(rc, id) {
  return rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', DESCRIBE_NODE_COLS, rc.schema)} FROM nodes WHERE node_id = ?`).get(id);
}

function refsOf(rc, id) {
  return rc.db.prepare(`SELECT ${selectColumns(rc.version, 'node_refs', ['kind', 'value', 'origin'], rc.schema)} FROM node_refs
    WHERE node_id = ? ORDER BY kind, value`).all(id);
}

/** A leaf's sources in order, each with its blob's raw length. */
function sourcesOf(rc, id) {
  return rc.db.prepare(`SELECT e.uuid AS uuid, e.type AS type, e.role AS role, b.raw_len AS raw_len
      FROM ${versioned(rc, 'node_sources', 'ns', ['node_id', 'entry_id', 'ord'])}
        JOIN ${versioned(rc, 'entries', 'e', ['entry_id', 'uuid', 'type', 'role', 'blob_id'])} ON e.entry_id = ns.entry_id
        JOIN ${versioned(rc, 'blobs', 'b', ['blob_id', 'raw_len'])} ON b.blob_id = e.blob_id
      WHERE ns.node_id = ? ORDER BY ns.ord`).all(id);
}

/** A condensed node's children in order (Task 9's node_children, parent → children). */
function childRowsOf(rc, id) {
  const st = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', DESCRIBE_NODE_COLS, rc.schema)} FROM nodes WHERE node_id = ?`);
  return childrenOf(rc.db, id).slice().sort((x, y) => x.ord - y.ord).map((c) => st.get(c.childId)).filter((r) => r !== undefined);
}

/** The line of a leaf's summary row in its holding copy `at` ({ file_id, line: the boundary's }), picked as lib's
 *  summaryRowFor picks it for derivation (Task 8): the row the boundary's anchor_uuid names; when the anchor is the
 *  boundary itself, the first compact summary after the boundary. A `<local-command-stdout>` echo (a harness user row,
 *  summaryRowFor's isEcho) is never the pick. null for no pick: the producer is then counted after the boundary, as
 *  derivation counts it. Spelled in SQL so a describe never loads the whole copy. */
function summaryLine(rc, boundaryEntryId, at) {
  const bd = rc.db.prepare(`SELECT b.anchor_uuid AS anchor_uuid, e.uuid AS uuid
      FROM ${versioned(rc, 'boundaries', 'b', ['entry_id', 'anchor_uuid'])}
        JOIN ${versioned(rc, 'entries', 'e', ['entry_id', 'uuid'])} ON e.entry_id = b.entry_id
      WHERE b.entry_id = ?`).get(boundaryEntryId);
  if (bd === undefined || typeof bd.anchor_uuid !== 'string' || bd.anchor_uuid === '') return null;
  const inCopy = `FROM ${versioned(rc, 'memberships', 'mb', ['file_id', 'entry_id', 'line'])}
        JOIN ${versioned(rc, 'entries', 'e', ['entry_id', 'uuid', 'type', 'provenance', 'is_compact_summary'])} ON e.entry_id = mb.entry_id
      WHERE mb.file_id = ? AND NOT (e.type = 'user' AND e.provenance = 'harness')`;
  const hit = bd.anchor_uuid === bd.uuid
    ? rc.db.prepare(`SELECT mb.line AS line ${inCopy} AND mb.line > ? AND e.is_compact_summary = 1 ORDER BY mb.line LIMIT 1`)
      .get(at.file_id, at.line)
    : rc.db.prepare(`SELECT mb.line AS line ${inCopy} AND e.uuid = ?`).get(at.file_id, bd.anchor_uuid);
  return hit === undefined ? null : hit.line;
}

/** The producing model family of a leaf's span (§6.2, §8.3), derived as Task 8's leafFields derives it:
 *  - the copy: lib's pickHoldingCopy over the files of the node's transcript, the rule Task 8's holdingCopy decides
 *    by (among the files that hold the boundary, a live copy, source_key '', first, then the lowest file_id);
 *  - the witnesses: every assistant row after the summary pick (summaryLine), else after the boundary, to the end of
 *    the copy, in file order. B1's producerOf answers at the first whose backend is not `unknown`, so the lazy
 *    iterate() behind `models` reads only as far as that row. No row cap: a first real reply far past the summary
 *    still counts, as it does for derivation.
 *  memberships is reached by its primary key (file_id, entry_id) and its memberships_order (file_id, line) index; it
 *  has no entry_id index, deliberately. */
function producerOfLeaf(rc, n) {
  if (n.boundary_entry_id === null || n.transcript_pk === null) return 'unknown';
  const copies = rc.db.prepare(`SELECT f.file_id AS file_id, f.source_key AS source_key, mb.line AS line
      FROM ${versioned(rc, 'ingest_files', 'f', ['file_id', 'transcript_pk', 'source_key'])}
        LEFT JOIN ${versioned(rc, 'memberships', 'mb', ['file_id', 'entry_id', 'line'])} ON mb.file_id = f.file_id AND mb.entry_id = ?
      WHERE f.transcript_pk = ? ORDER BY f.file_id`)
    .all(n.boundary_entry_id, n.transcript_pk);
  const held = pickHoldingCopy(copies.map((c) => ({ fileId: Number(c.file_id), live: c.source_key === '', holds: c.line !== null })));
  if (held === null) return 'unknown';
  const at = copies.find((c) => Number(c.file_id) === held);
  const from = summaryLine(rc, n.boundary_entry_id, at) ?? at.line;
  const after = rc.db.prepare(`SELECT e.model AS model
      FROM ${versioned(rc, 'memberships', 'mb', ['file_id', 'entry_id', 'line'])}
        JOIN ${versioned(rc, 'entries', 'e', ['entry_id', 'type', 'model'])} ON e.entry_id = mb.entry_id
      WHERE mb.file_id = ? AND mb.line > ? AND e.type = 'assistant' ORDER BY mb.line`);
  function* models() {
    for (const r of after.iterate(at.file_id, from)) yield r.model;
  }
  return producerOf(models());
}

/** A condensed node's producer is its newest leaf's: down each level's last child. */
function producerOfNode(rc, n) {
  let cur = n;
  for (let hops = 0; cur !== undefined && cur.depth > 0 && hops < 16; hops += 1) {
    const kids = childrenOf(rc.db, cur.node_id);
    if (kids.length === 0) return 'unknown';
    cur = nodeRow(rc, kids.reduce((x, y) => (y.ord > x.ord ? y : x)).childId);
  }
  return cur === undefined || cur.depth > 0 ? 'unknown' : producerOfLeaf(rc, cur);
}

/** A node's native summary, in five states that are never one value (D-4598
 *  (history-describe-names-an-undecodable-summary); no overloaded value at a seam). The decode itself is store.mjs's
 *  blobPlainTextMeasured, the one definition of those steps:
 *  - `none`: the node has no summary blob (a raw leaf, a condensed node);
 *  - `absent`: the blob row is gone or tombstoned. That is store corruption (the spec says summaries are never pruned),
 *    which the doctor reports; describe shows it as no summary;
 *  - `oversize`: the blob is recorded past the decode bound; nothing was decompressed. `rawLen` is the recorded size;
 *  - `undecodable`: the blob is there and does not decode (past the structure bound, damaged bytes). `rawLen` is the
 *    size recorded for it;
 *  - `text`: the summary as RAW plain text (possibly empty: describe says so in a fixed line), never shown as it is: the
 *    excerpt and each --full page are redactDisplayWindow's windows of it, so describe's cost is a window's, whatever the
 *    summary's length (spec §8.3 and §8.4). */
function summaryOf(rc, n) {
  if (n.summary_blob_id === null) return { state: 'none' };
  const b = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'blobs', ['z', 'raw_len'], rc.schema)} FROM blobs WHERE blob_id = ?`).get(n.summary_blob_id);
  if (b === undefined || b.z === null) return { state: 'absent' };
  const rawLen = Number(b.raw_len);
  const m = blobPlainTextMeasured(b.z, false, rc.pairIdx, rawLen);
  if (m.state === 'text') return { state: 'text', text: m.text };
  return m.state === 'absent' ? { state: 'absent' } : { state: m.state, rawLen };
}

/** What describe says of a summary that decoded to nothing (HA1 fix round 1 (h)). */
const SUMMARY_EMPTY_LINE = 'the summary is empty';

/** The words for a summary recorded past the decode bound: the bound, then the recorded size. */
const DECODE_CAP_WORDS = (rawLen) => `${xlib.BLOB_DECODE_MAX} bytes; recorded ${rawLen}`;

/** `end`, moved off the middle of a surrogate pair: when the character at `end` is a pair's low half, back one, or,
 *  when that would leave nothing after `start`, forward one. So a page or an excerpt never ends with half an astral
 *  character, which human output would print as U+FFFD. */
function pairSafeEnd(text, start, end) {
  if (end <= start || end >= text.length) return end;
  const c = text.charCodeAt(end);
  if (c < 0xdc00 || c > 0xdfff) return end;
  return end - 1 > start ? end - 1 : end + 1;
}

/** What `text[k]` prints at most, escaped for the envelope (escapeXmlText: `&` 5 characters, `<` and `>` 4) or
 *  JSON-encoded (JSON.stringify: `"` and `\` 2, a control character 2 or 6, a surrogate half without its pair 6). A
 *  redaction, a decode and a removed sequence never print longer than the raw characters they came from, except a
 *  mark longer than what it replaced. */
function describeCharCost(text, k, json) {
  const c = text.charCodeAt(k);
  if (!json) return c === 0x26 ? 5 : c === 0x3c || c === 0x3e ? 4 : 1;
  if (c === 0x22 || c === 0x5c) return 2;
  if (c < 0x20) return c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d ? 2 : 6;
  if (c >= 0xd800 && c <= 0xdbff) {
    const n = text.charCodeAt(k + 1);
    return n >= 0xdc00 && n <= 0xdfff ? 1 : 6;
  }
  if (c >= 0xdc00 && c <= 0xdfff) {
    const p = text.charCodeAt(k - 1);
    return p >= 0xd800 && p <= 0xdbff ? 1 : 6;
  }
  return 1;
}

/** The --full page that starts at `off`, and its shown window: as much of the RAW `text` as fits `room` once shown
 *  (`show(off, end)`, redactDisplayWindow's) and printed, either escaped for the envelope or JSON-encoded. The raw end
 *  is sized in one pass by what each raw character prints (describeCharCost), so ONE window is redacted per page
 *  (finding V19: a shrink step that redacted the window again each time cost a page 18 windows). Only a mark longer
 *  than what it replaced, a cut that keeps an edge's mark or slack, or an inexact window's note line prints past the
 *  room; the page then halves and is redacted again, as expand's page does. The end never splits a surrogate pair, and
 *  at least one character (or one pair) is always paged. Named apart from Task 16's lib pageEnd, which pages expand's
 *  text by its own cost rule. Exported as a test seam: a case counts `show` calls (HA2 H-16), where a wall clock would flake. */
export function describePageEnd(text, off, room, json, show) {
  const printed = (s) => (json ? JSON.stringify(s).length : escapeXmlText(s).length);
  const limit = Math.max(1, room - (json ? 2 : 0));
  let end = off;
  for (let used = 0; end < text.length; end += 1) {
    const c = describeCharCost(text, end, json);
    if (used + c > limit) break;
    used += c;
  }
  end = pairSafeEnd(text, off, Math.max(end, off + 1));
  let page = show(off, end);
  while (end > off + 1 && printed(page) > room) {
    const shorter = pairSafeEnd(text, off, off + Math.max(1, (end - off) >> 1));
    if (shorter >= end) break;
    end = shorter;
    page = show(off, end);
  }
  return { end, page };
}

/** `text` cut to `n` characters, marked with `...` when it was cut. */
const cutMarked = (text, n) => (text.length <= n ? text : `${xlib.cutText(text, n, 6 * n)}...`);

/** `describe <id | prefix | pasted line>` (§8.4). */
export function runDescribe(rc, a, deps = {}) {
  const pending = pendingFor(rc, 'describe');
  if (pending !== null) return pending;
  const budget = (deps.cap ?? OUTPUT_CAP) - FRAME_RESERVE;
  const ex = extractNodeId(a.target);
  if (!ex.ok) return refusal('bad-args', hintLine(`${echoLine(rc, ex.error)}${ex.hint ? ` ${redactField(ex.hint, rc.pairIdx)}` : ''}`));
  const found = resolveNodeInScope(rc, ex.id);
  if (!found.ok) return found.result;
  const id = found.id;
  const n = nodeRow(rc, id);
  if (n === undefined) return notFound();
  const pre = scopePrefixes(rc);
  const disp = (x) => pre.get(x) ?? x;
  const parent = parentOf(rc.db, id);
  const producer = producerOfNode(rc, n);
  const sm = summaryOf(rc, n);
  const summary = sm.state === 'text' ? sm.text : null;
  const damaged = sm.state === 'undecodable';
  const oversize = sm.state === 'oversize';
  /** A window of the raw summary as shown: redacted with its margins, never the whole summary first. */
  const shownSummary = (from, to) => redactDisplayWindow(summary, from, to, rc.pairIdx);
  const env = (src, text) => recallEnvelope({ src, id: disp(id), ts: n.latest_ms, role: null, text });
  const nodeLine = `node ${disp(id)} ${n.kind} depth ${n.depth} status ${n.status} ${iso(n.earliest_ms)} → ${iso(n.latest_ms)} producer ${producer}`
    + `${n.directive_flag === 1 ? ' directive-flag' : ''}${n.capped === 1 ? ' capped' : ''}`;
  const base = {
    node_id: id, kind: n.kind, depth: n.depth, status: n.status, parent_id: parent,
    earliest_ms: n.earliest_ms, latest_ms: n.latest_ms, producer,
  };
  const tailArgs = [...scopeArgs(rc), ...(a.json ? ['--json'] : [])];

  if (a.full) {
    if (damaged) {
      return refusal('bad-args', `${disp(id)} has a summary that does not decode: the stored blob is damaged (recorded ${sm.rawLen} bytes); describe it without --full`);
    }
    if (oversize) {
      return refusal('bad-args', `${disp(id)} has a summary larger than the decode cap (${DECODE_CAP_WORDS(sm.rawLen)}); describe it without --full`);
    }
    if (summary === null) return refusal('bad-args', `${disp(id)} has no summary to page; describe it without --full`);
    let off = 0;
    if (a.cursor !== null) {
      const c = decodeCursor(a.cursor, 'describe');
      if (c === null || c.node !== id || !Number.isSafeInteger(c.off) || c.off < 0 || c.off >= summary.length) {
        return refusal('bad-args', DESCRIBE_STALE_CURSOR);
      }
      off = c.off;
    }
    if (summary === '') {
      // A summary that decoded to nothing: one fixed line, not an empty page labelled `characters 1 to 1 of 0` (HA1 fix round 1 (h)).
      return {
        exit: EXIT.OK, header: null, blocks: [nodeLine, SUMMARY_EMPTY_LINE],
        items: [{ ...base, summary_chars: 0, summary_page: { offset: 0, text: '' }, trust: 'untrusted' }],
        shown: 1, total: 1, next: null,
      };
    }
    const { end, page } = describePageEnd(summary, off, budget - nodeLine.length - PAGE_FRAME, a.json, shownSummary);
    return {
      exit: EXIT.OK, header: null,
      blocks: [nodeLine, `summary, characters ${off + 1} to ${end} of ${summary.length}:`, env('summary', page)],
      items: [{ ...base, summary_chars: summary.length, summary_page: { offset: off, text: page }, trust: 'untrusted' }],
      shown: 1, total: 1,
      next: end < summary.length
        ? ['describe', id, '--full', ...tailArgs, '--cursor', encodeCursor({ v: 1, resource: 'describe', node: id, off: end })]
        : null,
    };
  }

  const gistAll = n.gist === null ? null : redactForDisplay(n.gist, rc.pairIdx);
  const topicsAll = topicsOfColumn(n.topics).map((t) => redactForDisplay(t, rc.pairIdx));
  const refsAll = refsOf(rc, id).map((r) => ({ kind: r.kind, value: redactForDisplay(r.value, rc.pairIdx), origin: r.origin }));
  const filesAll = refsAll.filter((r) => r.kind === 'path').map((r) => r.value);
  const excerptMax = summary === null ? 0 : Math.min(summary.length, pairSafeEnd(summary, 0, DESCRIBE_EXCERPT));
  const label = n.depth > 0 ? 'children' : 'sources';
  // A stored uuid, type and role are ONE display string (lib's displayToken; D-4597), carried as it is in --json and escaped
  // once by its sink: as text in a line, by JSON.stringify in --json. A crafted one forges no line or tag, and the two
  // forms agree with expand's.
  const tok = (v) => (v === '' || v === null ? v : displayToken(v, rc.pairIdx));
  const tx = (v) => escapeXmlText(tok(v));
  const listed = n.depth > 0
    ? childRowsOf(rc, id).map((k) => {
      const c = costRow(Number((k.depth === 0 ? k.src_chars : k.desc_chars) ?? 0));
      return { line: `  ${disp(k.node_id)} ${k.kind} chars=${c.chars} fits=${c.fits}`, item: { id: k.node_id, kind: k.kind, chars: c.chars, fits: c.fits } };
    })
    : sourcesOf(rc, id).map((s) => {
      const c = costRow(Number(s.raw_len ?? 0));
      return {
        line: `  ${tx(s.uuid)} ${tx(s.type)} ${s.role === null ? '-' : tx(s.role)} chars=${c.chars} fits=${c.fits}`,
        item: { uuid: tok(s.uuid), type: tok(s.type), role: tok(s.role), chars: c.chars, fits: c.fits },
      };
    });
  const each = listed.map((x) => (a.json ? JSON.stringify(x.item).length + 1 : x.line.length + 1));

  // The head is what the node says of itself: gist, topics, refs, files and the summary's excerpt. Its pieces are
  // fitted to the room (D-4596 (history-read-fixed-fields-fit-the-cap)), because their stored size is unbounded and
  // every escape inflates it (`&` prints as 5 characters). `f` holds what is shown: the gist cut at `gist`, the first
  // `topics`, `refs` and `files` values, and the first `excerptEnd` characters of the summary as `excerpt`.
  const countNote = (k, total) => (k < total ? ` (${k} of ${total})` : '');
  const headOf = (f) => [
    nodeLine,
    ...(parent === null ? [] : [`parent ${disp(parent)}`]),
    ...(f.gist === null ? [] : [`gist ${env('node', f.gist)}`]),
    ...(topicsAll.length === 0 ? [] : [`topics${countNote(f.topics, topicsAll.length)}${f.topics === 0 ? '' : ` ${env('node', topicsAll.slice(0, f.topics).join(' · '))}`}`]),
    ...(refsAll.length === 0 ? [] : [`refs${countNote(f.refs, refsAll.length)}${f.refs === 0 ? '' : ` ${env('node', refsAll.slice(0, f.refs).map((r) => `${r.kind} ${r.value}`).join(' · '))}`}`]),
    ...(filesAll.length === 0 ? [] : [`files${countNote(f.files, filesAll.length)}${f.files === 0 ? '' : ` ${env('node', filesAll.slice(0, f.files).join(' · '))}`}`]),
  ];
  const tailOf = (f) => {
    if (damaged) return [`summary does not decode: the stored blob is damaged (recorded ${sm.rawLen} bytes)`];
    if (oversize) return [`summary is larger than the decode cap (${DECODE_CAP_WORDS(sm.rawLen)})`];
    if (summary === '') return [SUMMARY_EMPTY_LINE];
    return summary === null ? [] : [`summary, the first ${f.excerptEnd} of ${summary.length} characters:`, env('summary', f.excerpt)];
  };
  const itemOf = (f, k) => ({
    ...base, gist: f.gist, topics: topicsAll.slice(0, f.topics), topics_total: topicsAll.length,
    refs: refsAll.slice(0, f.refs), refs_total: refsAll.length, files: filesAll.slice(0, f.files), files_total: filesAll.length,
    directive_flag: n.directive_flag, capped: n.capped,
    [label]: listed.slice(0, k).map((x) => x.item), [`${label}_total`]: listed.length,
    ...(summary === null ? {} : { summary_excerpt: f.excerpt, summary_chars: summary.length }),
    ...(damaged ? { summary_undecodable: true } : {}),
    ...(oversize ? { summary_oversize: true } : {}),
    trust: 'untrusted',
  });
  const blocksOf = (f, k) => [...headOf(f), `${label} (${k} of ${listed.length} listed):`, ...listed.slice(0, k).map((x) => x.line), ...tailOf(f)];
  const measure = (f) => (a.json ? JSON.stringify(itemOf(f, 0)).length : blocksOf(f, 0).join('\n').length);

  // The head keeps the list's room (at most DESCRIBE_LIST_RESERVE), and is cut only when it is over what is left.
  const headBudget = budget - Math.min(each.reduce((x, y) => x + y, 0), DESCRIBE_LIST_RESERVE);
  let f = {
    gist: gistAll === null ? null : cutMarked(gistAll, GIST_MAX), topics: topicsAll.length, refs: refsAll.length, files: filesAll.length,
    excerptEnd: excerptMax, excerpt: summary === null ? '' : shownSummary(0, excerptMax),
  };
  if (measure(f) > headBudget) {
    // Priority, kept first to dropped first: the gist, the excerpt, the topics, the files, the refs. Each is fitted to
    // what the ones above it left, by the largest count or length whose real rendering fits.
    const maxFit = (hi, withN) => {
      let lo = 0;
      let top = hi;
      while (lo < top) {
        const mid = Math.ceil((lo + top) / 2);
        if (measure(withN(mid)) <= headBudget) lo = mid;
        else top = mid - 1;
      }
      return lo;
    };
    f = { ...f, topics: 0, refs: 0, files: 0, excerptEnd: 0, excerpt: '' };
    if (gistAll !== null) {
      const g = maxFit(Math.min(gistAll.length, GIST_MAX), (m) => ({ ...f, gist: cutMarked(gistAll, m) }));
      f = { ...f, gist: cutMarked(gistAll, g) };
    }
    if (summary !== null) {
      // Room for the excerpt's own text, less slack for the digits of its label.
      const room = headBudget - measure(f) - 4;
      if (room > 0) {
        const paged = describePageEnd(summary.slice(0, excerptMax), 0, room, a.json, shownSummary);
        let end = paged.end;
        let page = paged.page;
        while (end > 1 && measure({ ...f, excerptEnd: end, excerpt: page }) > headBudget) {
          end = pairSafeEnd(summary, 0, Math.max(1, end >> 1));
          page = shownSummary(0, end);
        }
        if (measure({ ...f, excerptEnd: end, excerpt: page }) <= headBudget) f = { ...f, excerptEnd: end, excerpt: page };
      }
    }
    f = { ...f, topics: maxFit(topicsAll.length, (m) => ({ ...f, topics: m })) };
    f = { ...f, files: maxFit(filesAll.length, (m) => ({ ...f, files: m })) };
    f = { ...f, refs: maxFit(refsAll.length, (m) => ({ ...f, refs: m })) };
  }

  // Then as many child or source lines as still fit: a running total, so a leaf of thousands of rows costs one pass.
  let used = measure(f);
  let k = 0;
  while (k < listed.length && used + each[k] <= budget) { used += each[k]; k += 1; }
  return {
    exit: EXIT.OK, header: null, blocks: blocksOf(f, k), items: [itemOf(f, k)], shown: 1, total: 1,
    next: summary !== null && f.excerptEnd < summary.length ? ['describe', id, '--full', ...tailArgs] : null,
  };
}

/** cli.mjs's READ_RUNNERS.describe (W1-B2 Task 15): describe's own grammar (lib parseDescribeArgs) re-reads the
 *  verb's argv after Task 10's whitelist; a refused value is exit 2 bad-args. */
export function describeVerb(rc, argv) {
  const d = parseDescribeArgs(argv);
  return d.ok ? runDescribe(rc, d.args) : refusal('bad-args');
}

// ── expand (W1-B2 Task 16) ─────────────────────────────────────────────────────────────────────────────
// `ccrc history expand` (spec §8.4 "expand", §6.1 variants, §6.6 pruned text, §8.2 "Every verb resolves ids
// inside the scope", §8.3 "Redaction" and "Cap", §11 P17). Three targets, from Task 10's parseReadArgs through lib's expandArgsOf:
//   - a node id or prefix: the node's real text in order. A leaf's sources come by node_sources.ord. A condensed
//     node's leaves come in child order, their sources through P7's range CTE (store.mjs's lineageEntries, which
//     walks DOWN). Each source is followed by the sidecars linked to it. A tool output or sidecar over
//     EXPLORE_CUT is cut, with a deterministic outline (P17) and a `next:` line naming `expand <uuid>`;
//   - a message uuid: that one row WHOLE, with its sidecars, paged by cursor (slug
//     history-expand-message-id, NEW: a cut tool output needs a way to read the rest);
//   - --around <uuid> [--before N --after N]: the rows around one row in its holding copy's file order, cut as a
//     node's are.
// Every id resolves inside the scope: outside it is exit 2 out-of-scope, never 3.
// THE ORDER EVERY FIELD TAKES (slug history-redaction-before-cut; spec §8.3 and §8.4): its FULL
// raw text leaves the blob (lib's renderEntryText for a row, the decoded bytes for a sidecar); the window to show is
// picked on that raw text (the cut's first EXPLORE_CUT characters, or a page); lib's redactDisplayWindow redacts that
// window with ENTRY_REDACT_MARGIN each side and cuts it back (the outline's input likewise, through exploreOutline);
// then recallEnvelope's escape, then cli.mjs's final belt (redactFinalJson before the serialisation, redactFinalText on the human page). Nothing redacts a whole item: one page
// costs its window (coordinator ruling R-display-window). One blob is decompressed at a time, and only one lib's
// expandBlobFits admits (at most SIDECAR_WHOLE_MAX bytes); nothing holds a whole node in memory.
// A PAGE is measured in lib's textCost on what it prints, so it fits the cap in the human form and in --json alike.
// A cursor's offsets count characters of the item's raw text, the same in both forms.

/** How far a tool_result's paired tool_use is looked for up its parentUuid chain (B1's sweep walks 16). */
const EXPAND_PAIR_WALK = 16;
const EXPAND_ENTRY_COLS = Object.freeze(['entry_id', 'uuid', 'transcript_pk', 'type', 'role', 'ts_ms', 'provenance', 'parent_uuid', 'blob_id']);
/** cli.mjs prints a VerbResult's hint after `hint: `. */
const EXPAND_TARGET_HINT = 'expand <node id | message uuid> [--cursor <c>], or expand --around <uuid> [--before N] [--after N]';
/** Prepared once per read handle. Every select names its columns through selectColumns at the STORE's version
 *  (§6.11, DM44), so a column an older store lacks reads as NULL, never "no such column". */
const EXPAND_STMTS = new WeakMap();

function expandStmts(rc) {
  const hit = EXPAND_STMTS.get(rc.db);
  if (hit !== undefined) return hit;
  const cols = (table, list) => xlib.selectColumns(rc.version, table, list, rc.schema);
  const q = (sql) => rc.db.prepare(sql);
  const s = {
    node: q(`SELECT ${cols('nodes', ['node_id', 'kind', 'session_pk'])} FROM nodes WHERE node_id = ?`),
    entryById: q(`SELECT ${cols('entries', EXPAND_ENTRY_COLS)} FROM entries WHERE entry_id = ?`),
    entryByUuid: q(`SELECT ${cols('entries', EXPAND_ENTRY_COLS)} FROM entries WHERE uuid = ?`),
    hop: q(`SELECT ${cols('entries', ['parent_uuid', 'blob_id'])} FROM entries WHERE uuid = ?`),
    // A blob's size and tombstone, read WITHOUT its z: the delegate estimate and the decompression bound need no body.
    blobLen: q(`SELECT ${cols('blobs', ['raw_len', 'pruned_ms'])} FROM blobs WHERE blob_id = ?`),
    blob: q(`SELECT ${cols('blobs', ['z'])} FROM blobs WHERE blob_id = ?`),
    variants: q(`SELECT ${cols('entry_variants', ['blob_id', 'cause'])} FROM entry_variants WHERE entry_id = ? ORDER BY first_seen_ms, blob_id`),
    sidecars: q(`SELECT ${cols('sidecars', ['entry_id', 'name', 'blob_id'])} FROM sidecars WHERE transcript_pk = ? ORDER BY name, blob_id`),
    // ingest_files has no transcript_pk index: every in-scope transcript's rows in ONE statement, one scan per call.
    files: q(`SELECT ${cols('ingest_files', ['file_id', 'status', 'source_key'])} FROM ingest_files WHERE transcript_pk IN (SELECT value FROM json_each(?)) ORDER BY file_id`),
    member: q(`SELECT ${cols('memberships', ['line'])} FROM memberships WHERE file_id = ? AND entry_id = ?`),
    before: q(`SELECT ${cols('memberships', ['entry_id', 'line'])} FROM memberships WHERE file_id = ? AND line < ? ORDER BY line DESC LIMIT ?`),
    after: q(`SELECT ${cols('memberships', ['entry_id', 'line'])} FROM memberships WHERE file_id = ? AND line > ? ORDER BY line LIMIT ?`),
  };
  EXPAND_STMTS.set(rc.db, s);
  return s;
}

/** The in-scope transcripts' file rows, the live copy first: where a row's holding copy is looked for. The live copy is
 *  the row whose `source_key` is '' WHATEVER its status: B1 marks a deleted-from-disk live copy `gone` and keeps its
 *  `source_key` '' (sweep's markGone), and only a `retired` copy carries a non-empty key. That is lib's
 *  pickHoldingCopy rule (Task 8; §6.1 "The copy": a live copy, then the smallest file_id), which describe and the
 *  derivation use, so expand picks the same copy's memberships for --around and orders the lineage the same way. */
function expandScopedFiles(s, rc) {
  const out = s.files.all(JSON.stringify(rc.scope.transcriptPks));
  return out.sort((a, b) => (a.source_key === '' ? 0 : 1) - (b.source_key === '' ? 0 : 1) || a.file_id - b.file_id);
}

/** The first in-scope file holding an entry, by primary-key probes: memberships has no entry_id index. */
function expandHolding(s, files, entryId) {
  for (const f of files) {
    const m = s.member.get(f.file_id, entryId);
    if (m !== undefined) return { fileId: f.file_id, line: m.line };
  }
  return null;
}

/** A condensed node's source entries in leaf order (its children's ord, depth first), then node_sources.ord. */
function expandLineage(rc, s, nodeId, kind) {
  const leaves = [];
  if (kind !== 'condensed') leaves.push(nodeId);
  else {
    const stack = [nodeId];
    const seen = new Set();
    while (stack.length > 0) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const n = s.node.get(id);
      if (n === undefined) continue;
      if (n.kind !== 'condensed') { leaves.push(id); continue; }
      const kids = [...xstore.childrenOf(rc.db, id)].sort((a, b) => a.ord - b.ord);
      for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i].childId);
    }
  }
  const rank = new Map(leaves.map((id, i) => [id, i]));
  const rows = xstore.lineageEntries(rc.db, nodeId).filter((r) => rank.has(r.nodeId));
  rows.sort((a, b) => rank.get(a.nodeId) - rank.get(b.nodeId) || a.ord - b.ord);
  const out = [];
  const seenEntry = new Set();
  for (const r of rows) if (!seenEntry.has(r.entryId)) { seenEntry.add(r.entryId); out.push(r.entryId); }
  return out;
}

/** What the arguments name, resolved inside the scope: {refuse} or {key, args, entryIds, whole}. */
function expandResolve(rc, s, a) {
  const files = expandScopedFiles(s, rc);
  const scopeTranscripts = new Set(rc.scope.transcriptPks);
  const entryNamed = (uuid) => {
    const e = s.entryByUuid.get(uuid);
    const hold = e === undefined ? null : expandHolding(s, files, e.entry_id);
    const verdict = xlib.entryScopeVerdict({ found: e !== undefined, inScope: e !== undefined && (scopeTranscripts.has(e.transcript_pk) || hold !== null) });
    return { verdict, e, hold };
  };
  const refuseEntry = (verdict) => (verdict === 'not-found' ? notFound() : refusal('out-of-scope'));
  if (a.around !== null) {
    if (xlib.expandTargetOf(a.around) !== 'entry') return { refuse: refusal('bad-args', EXPAND_TARGET_HINT) };
    const { verdict, e, hold } = entryNamed(a.around);
    if (verdict !== 'ok') return { refuse: refuseEntry(verdict) };
    const ids = [];
    if (hold !== null) {
      for (const r of s.before.all(hold.fileId, hold.line, a.before).reverse()) ids.push(r.entry_id);
      ids.push(e.entry_id);
      for (const r of s.after.all(hold.fileId, hold.line, a.after)) ids.push(r.entry_id);
    } else ids.push(e.entry_id);
    return {
      key: `around:${e.uuid}:${a.before}:${a.after}`, entryIds: ids, whole: false,
      args: ['--around', e.uuid, '--before', String(a.before), '--after', String(a.after)],
    };
  }
  const kind = xlib.expandTargetOf(a.target);
  if (kind === 'bad') return { refuse: refusal('bad-args', EXPAND_TARGET_HINT) };
  if (kind === 'entry') {
    const { verdict, e } = entryNamed(a.target);
    if (verdict !== 'ok') return { refuse: refuseEntry(verdict) };
    return { key: e.uuid, args: [e.uuid], entryIds: [e.entry_id], whole: true };
  }
  // A node id or prefix: Task 12's resolveNodeInScope is the ONE spelling of §8.2's rule (out-of-scope is 2, never 3;
  // prefix uniqueness among the scope's nodes), shared with grep --node and describe.
  const found = resolveNodeInScope(rc, a.target);
  if (!found.ok) return { refuse: found.result };
  const node = s.node.get(found.id);
  return { key: found.id, args: [found.id], entryIds: expandLineage(rc, s, found.id, node.kind), whole: false };
}

/** The expansion's items: each entry, then the sidecars linked to it. Sidecars are read by their transcript (the
 *  primary key's prefix) once per transcript; sidecars has no entry_id index. */
function expandItems(s, entryIds) {
  const byTranscript = new Map();
  const sidecarsOf = (e) => {
    let m = byTranscript.get(e.transcript_pk);
    if (m === undefined) {
      m = new Map();
      for (const r of s.sidecars.all(e.transcript_pk)) {
        if (r.entry_id === null) continue;
        const list = m.get(r.entry_id) ?? [];
        list.push(r);
        m.set(r.entry_id, list);
      }
      byTranscript.set(e.transcript_pk, m);
    }
    return m.get(e.entry_id) ?? [];
  };
  const items = [];
  for (const id of entryIds) {
    const e = s.entryById.get(id);
    if (e === undefined) continue;
    const sidecars = sidecarsOf(e);
    items.push({ kind: 'entry', e, sidecars });
    for (const sc of sidecars) items.push({ kind: 'sidecar', e, name: sc.name, blobId: sc.blob_id });
  }
  return items;
}

/** The delegate hint's measure: stored sizes, read without any z, a cut item counted as at most twice EXPLORE_CUT. */
function expandEstimate(s, items, whole) {
  let chars = 0;
  for (const it of items) {
    const m = s.blobLen.get(it.kind === 'entry' ? it.e.blob_id : it.blobId);
    const len = m === undefined ? 0 : Number(m.raw_len);
    chars += xlib.expandCuts({ whole, kind: it.kind, provenance: it.e.provenance }) ? Math.min(len, 2 * xlib.EXPLORE_CUT) : len;
  }
  return chars;
}

/** One blob, decompressed only when lib's expandBlobFits lets one call hold it whole: a tombstone answers `pruned`
 *  (with its date, when recorded), a blob past SIDECAR_WHOLE_MAX answers `too-large` with its byte size, and
 *  neither is decompressed. A message body (`isSidecar` false) also holds B1's body cap: past BLOB_DECODE_MAX
 *  (blobOverDecodeCap, B1's history-permanent-failures-classified; only a raw-only line-too-long blob gets there) it
 *  is `too-large` too, against that bound. Its size is read before its z is. The decode is bounded by the stored
 *  raw_len (B1's unbrotli(z, maxLen), FPM10), and a blob that does not decode answers `undecodable`, never a throw
 *  and never `pruned`: a damaged blob is not a pruned one (no overloaded value at a seam). A NULL `z` with no
 *  `pruned_ms` is a damaged store and answers `undecodable`; only `pruned_ms` makes a tombstone (spec §6.2). */
function expandBlob(s, blobId, isSidecar) {
  const m = s.blobLen.get(blobId);
  // A missing row is impossible under `blob_id … REFERENCES blobs ON DELETE RESTRICT`; it is the doctor's to report.
  if (m === undefined) return { state: 'pruned', prunedMs: null };
  if (m.pruned_ms !== null) return { state: 'pruned', prunedMs: Number(m.pruned_ms) };
  const rawLen = Number(m.raw_len);
  if (!xlib.expandBlobFits(rawLen)) return { state: 'too-large', rawLen };
  if (!isSidecar && xlib.blobOverDecodeCap(rawLen)) return { state: 'too-large', rawLen, bound: xlib.BLOB_DECODE_MAX };
  const b = s.blob.get(blobId);
  if (b === undefined || b.z === null) return { state: 'undecodable', rawLen };
  let bytes;
  try { bytes = xstore.unbrotli(b.z, rawLen); } catch { return { state: 'undecodable', rawLen }; }
  return { state: 'bytes', bytes };
}

/** A stored body: JSON for a parsed row, the line's text for a raw-only one. A body past B1's structure bound
 *  (jsonWithinStructureBound, B1's history-json-structure-bound: a raw-only blob can nest millions of levels) is
 *  never parsed: its text is shown as stored. */
function expandParse(bytes) {
  const text = bytes.toString('utf8');
  if (!xlib.jsonWithinStructureBound(bytes)) return text;
  try { return JSON.parse(text); } catch { return text; }
}

/** An entry's RAW text (lib's renderEntryText; every shown window of it is redacted by expandRenderItem): the
 *  unsanitised variant when the pair is ccd's own (DM2b), a tombstone as `pruned`. */
function expandEntryText(rc, s, e) {
  const p = expandBlob(s, e.blob_id, false);
  if (p.state !== 'bytes') return p;
  const primary = expandParse(p.bytes);
  const rows = s.variants.all(e.entry_id).filter((v) => v.blob_id !== e.blob_id);
  const others = [];
  for (const v of rows.filter((x) => x.cause === 'ccd-sanitize')) {
    const vb = expandBlob(s, v.blob_id, false);
    if (vb.state === 'bytes') others.push({ body: expandParse(vb.bytes), cause: v.cause });
  }
  const body = others.length === 0 ? primary : xlib.pickExpandBody({ primary, variants: others });
  let text;
  try {
    text = xlib.renderEntryText(body);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    // A body nested past V8's JSON.stringify stack (about 4,500 levels, far inside B1's JSON_DEPTH_MAX) cannot be
    // rendered. Its primary blob's stored text is shown instead, through the same windows, so the page and the
    // cursor still move.
    text = p.bytes.toString('utf8');
  }
  return { state: 'text', text, causes: rows.map((v) => v.cause), primary };
}

/** A sidecar's bytes as RAW text. It is never redacted whole: a 64 MiB sidecar redacted whole peaked at 1,954 MiB
 *  for one page (review finding R36), so expandRenderItem redacts only the window it shows. */
function expandSidecarText(rc, s, blobId) {
  const p = expandBlob(s, blobId, true);
  if (p.state !== 'bytes') return p;
  return { state: 'text', text: p.bytes.toString('utf8'), causes: [], primary: null };
}

/** The file a tool_result's tool_use named (P17 dispatches the outline on its extension), redacted. The walk stops
 *  at the first ancestor holding the paired tool_use, whether or not it names a file. */
function expandPairedPath(rc, s, e, body) {
  const ids = xlib.toolResultIdsOf(body);
  if (ids.length === 0) return null;
  let uuid = e.parent_uuid;
  for (let hop = 0; hop < EXPAND_PAIR_WALK && typeof uuid === 'string'; hop += 1) {
    const r = s.hop.get(uuid);
    if (r === undefined) return null;
    const b = expandBlob(s, r.blob_id, false);
    if (b.state === 'bytes') {
      const p = xlib.toolUseInputPath(expandParse(b.bytes), ids[0]);
      if (p.found) return p.path === null ? null : xlib.redactForDisplay(p.path, rc.pairIdx);
    }
    uuid = r.parent_uuid;
  }
  return null;
}

/** The primary body of an entry, for a sidecar's pairing (small: a tool_result row). */
function expandPrimaryBody(s, e) {
  const b = expandBlob(s, e.blob_id, false);
  return b.state === 'bytes' ? expandParse(b.bytes) : null;
}

/** The most variant causes, and the most sidecar names, one expanded entry lists, and the room each list may take, in
 *  characters, in either form. Both are stored without bound (an entry can hold hundreds of variant rows, a transcript
 *  many sidecars), and a page's first item is emitted whatever its fixed cost, so the lists are cut here, and
 *  `variants_total` and `sidecars_total` name the true counts (D-4596 (history-read-fixed-fields-fit-the-cap)). */
const EXPAND_LIST_MAX = 8;
const EXPAND_LIST_ROOM = 2000;

/** How many of `n` rows a list shows: at most EXPAND_LIST_MAX, and while their cost (`costOf(i)`, the greater of the
 *  human and --json forms) stays within EXPAND_LIST_ROOM. */
function listPrefix(n, costOf) {
  let used = 0;
  let k = 0;
  while (k < n && k < EXPAND_LIST_MAX && used + costOf(k) <= EXPAND_LIST_ROOM) { used += costOf(k); k += 1; }
  return k;
}

/** One item rendered for this page: {block, json, cost, partial, to}, or null when it may not start here. A cut or
 *  pruned item that does not fit waits for the next page unless it is the page's first. A whole item that does not
 *  fit starts as a partial when it is the first, or while EXPAND_MIN_PARTIAL of the budget is left.
 *  o = {whole, from, budget, first, scope}. */
function expandRenderItem(rc, s, it, pos, total, o) {
  const isEntry = it.kind === 'entry';
  const e = it.e;
  // Every stored identifier is ONE display string (lib's displayToken; D-4597 (history-read-names-and-echoes-display-redacted)),
  // so a crafted uuid, type, role or name forges no line or tag and a megabyte of it cannot pass the cap (D-4596). It is
  // not XML-escaped: `tok` is the plain string, which --json carries and an envelope attribute escapes (recallEnvelope),
  // and `tx` is the same string escaped as text, for a line outside an envelope. A sidecar name is first redacted as a
  // display field (nameShown) in every place it is shown.
  const tok = (v) => (v === '' || v === null ? v : xlib.displayToken(v, rc.pairIdx));
  const asText = (v) => (typeof v === 'string' ? xlib.escapeXmlText(v) : v);
  const tx = (v) => asText(tok(v));
  const src = isEntry ? (e.provenance ?? 'harness') : 'sidecar';
  const uuidShown = tok(e.uuid);
  const nameShownHere = isEntry ? null : nameShown(rc, it.name);
  const nameTok = isEntry ? null : tok(nameShownHere);
  const id = isEntry ? uuidShown : `${uuidShown}/${nameTok}`;
  const t = isEntry ? expandEntryText(rc, s, e) : expandSidecarText(rc, s, it.blobId);
  const ts = e.ts_ms === null ? '-' : new Date(Number(e.ts_ms)).toISOString();
  const lead = isEntry
    ? `── ${pos}/${total} ${e.type === '' ? 'raw' : tx(e.type)}${e.role ? `/${tx(e.role)}` : ''} ${tx(src)} ${asText(uuidShown)} ${ts}`
    : `── ${pos}/${total} sidecar ${asText(nameTok)} of ${asText(uuidShown)}`;
  const causes = t.state === 'text' ? t.causes : [];
  const shownCauses = causes.slice(0, listPrefix(causes.length, (i) => Math.max(`variant cause=${tx(causes[i])}`.length, JSON.stringify({ cause: tok(causes[i]) }).length) + 1)).map(tok);
  const tail = [
    ...shownCauses.map((c) => `variant cause=${asText(c)}`),
    ...(causes.length > shownCauses.length ? [`variant causes: +${causes.length - shownCauses.length} more`] : []),
  ];
  const base = {
    kind: it.kind, uuid: uuidShown, ...(isEntry ? {} : { name: nameShownHere }), type: tok(e.type), role: tok(e.role),
    ts_ms: e.ts_ms === null ? null : Number(e.ts_ms), provenance: tok(src), trust: 'untrusted',
  };
  // The sidecar names are shown one at a time and only as far as the list reaches: an entry can have thousands.
  const sidecarName = (i) => nameShown(rc, it.sidecars[i].name);
  const extra = {
    variants: shownCauses.map((cause) => ({ cause })), variants_total: causes.length,
    ...(isEntry
      ? {
        sidecars: Array.from({ length: listPrefix(it.sidecars.length, (i) => JSON.stringify({ name: sidecarName(i) }).length + 1) }, (_, i) => ({ name: sidecarName(i) })),
        sidecars_total: it.sidecars.length,
      }
      : {}),
  };
  const env = (text, suffix = '') => xlib.recallEnvelope({
    src, id: `${id}${suffix}`, ts: e.ts_ms === null ? null : Number(e.ts_ms), role: isEntry ? tok(e.role) : null, text,
  });
  const measure = (block, json) => Math.max(block.length, JSON.stringify(json).length);

  if (t.state === 'pruned') {
    const when = t.prunedMs === null ? 'on an unrecorded date' : `on ${new Date(t.prunedMs).toISOString().slice(0, 10)}`;
    const block = [lead, `content pruned ${when}`].join('\n');
    const json = { ...base, text: '', from: 0, to: 0, of: 0, cut: false, outline: null, outline_kind: null, pruned_ms: t.prunedMs, ...extra };
    const cost = measure(block, json);
    return cost <= o.budget || o.first ? { block, json, cost, partial: false, to: 0 } : null;
  }

  if (t.state === 'too-large') {
    // lib's expandBlobFits said no (or, for a message body, B1's blobOverDecodeCap: `bound` names BLOB_DECODE_MAX):
    // one fixed line, nothing decompressed. `of` is the recorded size, in bytes.
    const block = [lead, `content too large to expand here: ${t.rawLen} bytes, over the ${t.bound ?? xlib.SIDECAR_WHOLE_MAX}-byte bound one call decompresses`].join('\n');
    const json = { ...base, text: '', from: 0, to: 0, of: t.rawLen, cut: true, outline: null, outline_kind: null, pruned_ms: null, ...extra };
    const cost = measure(block, json);
    return cost <= o.budget || o.first ? { block, json, cost, partial: false, to: 0 } : null;
  }

  if (t.state === 'undecodable') {
    // The stored bytes do not decode within their recorded raw_len (B1's blob-undecodable; doctor counts it). Not a
    // pruned blob, and never a throw: one fixed line, with `undecodable: true` on the --json item.
    const block = [lead, `content does not decode: the stored blob is damaged (recorded ${t.rawLen} bytes)`].join('\n');
    const json = { ...base, text: '', from: 0, to: 0, of: 0, cut: false, outline: null, outline_kind: null, pruned_ms: null, undecodable: true, ...extra };
    const cost = measure(block, json);
    return cost <= o.budget || o.first ? { block, json, cost, partial: false, to: 0 } : null;
  }

  // R is the item's RAW text. Every window shown of it goes through shownOf, which redacts the window plus
  // ENTRY_REDACT_MARGIN each side and cuts it back (Task 12's redactDisplayWindow): never the whole item first.
  const R = t.text;
  const shownOf = (from, to) => xlib.redactDisplayWindow(R, from, to, rc.pairIdx);
  if (xlib.expandCuts({ whole: o.whole, kind: it.kind, provenance: e.provenance }) && R.length > xlib.EXPLORE_CUT) {
    const path = expandPairedPath(rc, s, e, isEntry ? t.primary : expandPrimaryBody(s, e));
    const kind = xlib.exploreKindOf(path) ?? (isEntry ? null : xlib.exploreKindOf(it.name)) ?? 'code';
    // The item is cut to what an EMPTY page has left after its own frame (the lead and both envelopes, whose ids and role are
    // display strings of up to 6 * SNIPPET_MAX + 2 characters, escaped again by each attribute): each half to at most
    // CUT_TEXT_BUDGET and to half of that room. The room is the empty page's, never the page's remaining budget, so
    // the same item cuts the same way wherever it falls on a page (HA1 fix round 1, T1).
    // A uuid that is no address `expand` takes (expandTargetOf) is not one the next: line may name, whatever its shape.
    const nextLines = xlib.expandTargetOf(e.uuid) === 'entry' ? [xlib.nextLine(['expand', e.uuid, ...o.scope])] : [];
    const cutLead = (n) => `${lead} [cut ${n} of ${R.length} chars; outline: ${kind}]`;
    const frameCost = measure([cutLead(R.length), env(''), env('', '#outline'), ...nextLines, ...tail].join('\n'),
      { ...base, text: '', from: 0, to: R.length, of: R.length, cut: true, outline: '', outline_kind: kind, pruned_ms: null, ...extra });
    const half = Math.min(xlib.CUT_TEXT_BUDGET, Math.max(0, xlib.PAGE_TEXT_BUDGET - frameCost) >> 1);
    const cutEnd = xlib.cutText(R, xlib.EXPLORE_CUT, half).length;
    const shown = xlib.cutText(shownOf(0, cutEnd), xlib.EXPLORE_CUT, half);
    const outline = xlib.cutText(xlib.exploreOutline(R, kind, path === null ? undefined : xbasename(path), rc.pairIdx), xlib.EXPLORE_CUT, half);
    const block = [cutLead(cutEnd), env(shown), env(outline, '#outline'), ...nextLines, ...tail].join('\n');
    const json = { ...base, text: shown, from: 0, to: cutEnd, of: R.length, cut: true, outline, outline_kind: kind, pruned_ms: null, ...extra };
    const cost = measure(block, json);
    return cost <= o.budget || o.first ? { block, json, cost, partial: false, to: 0 } : null;
  }

  const from = Math.min(o.from, R.length);
  const frame = [`${lead} [chars ${from}-${R.length} of ${R.length}; continues]`, env(''), ...tail].join('\n');
  const frameJson = { ...base, text: '', from, to: R.length, of: R.length, cut: false, outline: null, outline_kind: null, pruned_ms: null, ...extra };
  const fixed = measure(frame, frameJson);
  let to = R.length;
  if (fixed + xlib.textCost(R, from) > o.budget) {
    if (!o.first && o.budget - fixed < xlib.EXPAND_MIN_PARTIAL) return null;
    to = xlib.pageEnd(R, from, Math.max(1, o.budget - fixed));
  }
  let text = shownOf(from, to);
  // A mark can print longer than what it replaced: the page shrinks until what it prints fits, keeping one
  // character (or one pair) at least, as pageEnd does.
  while (fixed + xlib.textCost(text) > o.budget) {
    const shorter = xlib.pageEnd(R, from, Math.max(1, xlib.textCost(R, from, to) >> 1));
    if (shorter >= to) break;
    to = shorter;
    text = shownOf(from, to);
  }
  const partial = to < R.length;
  const note = from === 0 && !partial ? '' : ` [chars ${from}-${to} of ${R.length}${partial ? '; continues' : ''}]`;
  const block = [`${lead}${note}`, env(text), ...tail].join('\n');
  const json = { ...base, text, from, to, of: R.length, cut: false, outline: null, outline_kind: null, pruned_ms: null, ...extra };
  return { block, json, cost: fixed + xlib.textCost(text), partial, to };
}

/** `expand` over a ReadContext. Returns a VerbResult whose `shown` is the position of the last item reached. */
export function runExpand(rc, a) {
  const pending = pendingFor(rc, 'expand');
  if (pending !== null) return pending;
  const s = expandStmts(rc);
  const decoded = a.cursor === null ? null : xlib.decodeCursor(a.cursor, 'expand');
  if (a.cursor !== null && decoded === null) return refusal('bad-args', 'that --cursor is not one expand printed');
  // A bare `expand --cursor <c>` resumes the expansion its cursor names.
  let want = a;
  if (a.target === null && a.around === null) {
    const resume = xlib.expandResumeOf(decoded);
    if (resume === null) return refusal('bad-args', EXPAND_TARGET_HINT);
    want = { ...a, ...resume };
  }
  const r = expandResolve(rc, s, want);
  if (r.refuse !== undefined) return r.refuse;
  const items = expandItems(s, r.entryIds);
  const at = xlib.decideExpandCursor({ cursor: decoded, key: r.key, total: items.length });
  if (!at.ok) return refusal('bad-args', 'that --cursor belongs to another expansion');
  const scope = rc.scopeArgs ?? [];
  const blocks = [];
  const out = [];
  let budget = xlib.PAGE_TEXT_BUDGET;
  let next = null;
  let shown = at.i;
  for (let i = at.i; i < items.length; i += 1) {
    const item = expandRenderItem(rc, s, items[i], i + 1, items.length, { whole: r.whole, from: i === at.i ? at.o : 0, budget, first: blocks.length === 0, scope });
    if (item === null) { next = { i, o: 0 }; break; }
    blocks.push(item.block);
    out.push(item.json);
    budget -= item.cost;
    shown = i + 1;
    if (item.partial) { next = { i, o: item.to }; break; }
  }
  const nextArgs = next === null ? null
    : ['expand', ...r.args, ...scope, ...(a.json ? ['--json'] : []), '--cursor', xlib.encodeCursor({ v: 1, resource: 'expand', t: r.key, i: next.i, o: next.o })];
  const hint = a.cursor === null ? xlib.delegateHint(expandEstimate(s, items, r.whole)) : null;
  return { exit: xlib.EXIT.OK, header: null, blocks, items: out, total: items.length, shown, next: nextArgs, ...(hint === null ? {} : { hint }) };
}

/** cli.mjs's READ_RUNNERS.expand: Task 10's parseReadArgs answer, through lib's expandArgsOf. */
export function expandVerb(rc, parsed) {
  const p = xlib.expandArgsOf(parsed);
  if (!p.ok) return refusal('bad-args', EXPAND_TARGET_HINT);
  return runExpand(rc, { ...p.args, json: parsed.opts.json === true });
}

// ── version-aware reads (W1-B2 Task 17) ─────────────────────────────────────────────────────────────────
// Spec §6.11 "The CLI keeps answering" (slug history-cli-reads-store-version): every select above names its
// columns through selectColumns, or reads a versioned() derived table for a join, or names v1-only columns every
// version keeps, at the STORE's version, so a column an older store lacks reads as NULL. A verb that needs a TABLE
// the store lacks answers exit 5 migration-pending here, before the executor prepares any statement of its own
// (readContext's reads come first; see VERB_TABLES) — never exit 1, never "no such table".

/** null when `verb` can answer a store at rc.version; otherwise the migration-pending VerbResult. rc.schema and
 *  rc.verbTables default to the build's own; only a test sets them (the DM44 seam). */
export function pendingFor(rc, verb) {
  const missing = xlib.missingTablesAt(rc.version, verb, rc.schema ?? xlib.SCHEMA_ADDED, rc.verbTables ?? xlib.VERB_TABLES);
  if (missing.length === 0) return null;
  return refusal('migration-pending', `this store is at schema v${rc.version} and has no ${missing.join(', ')}: a scheduled tick migrates it once its disk and snapshot checks pass, or the operator runs ${xlib.HISTORY_CMD} doctor --migrate`);
}
