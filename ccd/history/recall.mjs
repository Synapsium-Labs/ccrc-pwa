// ccd/history/recall.mjs — the read verbs' executors (W1-B2; spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.2–§8.4).
//
// L4 delivery (§6.4). cli.mjs measures; lib's decisions settle the identity, the store and the scope; this module
// executes a read over the ReadContext cli.mjs hands it. It runs on the read-only handle and returns a
// VerbResult for cli.mjs to render. Every cap, envelope, display prefix and lag below is a lib function.
//
// Every select names its columns, never a wildcard projection (C43). A column a later schema version added is named through
// selectColumns(rc.version, …), so a store older than this code answers with that field null (§6.11).
// Merged families and unconfirmed epochs are never read (§6.1, DM46).
// Every recalled field is redacted on its raw text BEFORE any cut or escape, then wrapped in a <ccrc-recall>
// envelope (§8.3). cli.mjs runs redactFinal over the whole output as the second belt.
//
// It reads no environment variable and has no entry guard: cli.mjs imports it.
import {
  EXIT, OUTPUT_CAP, TREE_DEPTH_MAX, SCOPE_FAMILIES_JSON_MAX, selectColumns, displayPrefixes, headerLine, scopeLag, recallEnvelope, capOutput, redactForDisplay, redactFinal, readEnvelope, nextLine,
  REASONS, INDEXED_PROVENANCE, SEARCHABLE_PROVENANCE, FTS_STEP, RANK_POOL, decideGrepIndex, sanitizeFtsQuery, snippetTerms, regexSyntaxIn, regexSyntaxHint, ftsOrderBy, displaySnippet, snippetLine, escapeXmlText, redactField, extractNodeId, resolveScopedId, SEARCH_REACH, parseGrepArgs,
  GREP_LIMIT_DEFAULT, encodeCursor, decodeCursor, canonicalJson, sha256Hex,
  guardRegex, regexPrefilter, REGEX_BUDGET_MS, REGEX_MAX_LEN, historyPaths,
  DESCRIBE_EXCERPT, costRow, producerOf, pickHoldingCopy, redactDisplayWindow, parseDescribeArgs,
} from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childrenOf, parentOf, probeFts5, blobPlainText, lineageEntries } from './store.mjs';

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
  const recovering = rc.db.prepare("SELECT 1 AS x FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL LIMIT 1").get() !== undefined;
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
  const gist = typeof n.gist === 'string' && n.gist !== '' ? redactForDisplay(n.gist, rc.pairIdx).replace(/\s+/g, ' ').trim() : '';
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
  return redactFinal(`${JSON.stringify(readEnvelope({
    exit: EXIT.OK, storeId: rc.storeId, scope: jsonScope(rc),
    header: { indexedThroughMs: head.indexedThroughMs, lagS: head.lagS }, items, shown, total,
    next: next === null ? null : nextLine(next),
  }))}\n`, rc.pairIdx);
}

/** The greatest complete item prefix that fits the final JSON envelope. Each check measures the exact string
 * cli.mjs writes after redactFinal; monotonic binary search avoids rendering every candidate prefix of a large scope. */
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
      r.provenance AS provenance, r.blob_id AS blob_id, r.name AS name
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

/** `--node`'s entries: the node resolved in scope, then its lineage (Task 9's range CTE, toward sources). */
function nodeEntries(rc, raw) {
  const ex = extractNodeId(raw);
  if (!ex.ok) return { ok: false, result: refusal('bad-args', hintLine(redactField(ex.error, rc.pairIdx))) };
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

/** grep's index gate on the reader (§9.1): the read-only probe, blobs_fts, and the backfill's row. */
function indexGate(rc) {
  let probe;
  try { probe = probeFts5(rc.db); } catch { probe = 'threw'; }
  const table = probe === 'present'
    && rc.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blobs_fts'").get() !== undefined;
  // derivation ('fts', 1), the one version the sweep creates (B1 Task 23).
  const row = table
    ? rc.db.prepare(`SELECT ${selectColumns(rc.version, 'derivation_state', ['completed_ms'], rc.schema)} FROM derivation_state
        WHERE step = ? AND version = 1`).get(FTS_STEP)
    : undefined;
  return decideGrepIndex({ probe, table, completed: row !== undefined && row.completed_ms !== null });
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
  return snippetLine(displaySnippet(plain, terms, rc.pairIdx).replace(/\s+/g, ' '));
}

/** A hit's human line: its snippet inside the untrusted-content envelope, which escapes it (§8.3, P30). */
function hitLine(hit, snippet) {
  return `  ${recallEnvelope({ src: hit.provenance, id: hit.uuid ?? `sidecar:${hit.name}`, ts: hit.ts_ms, role: hit.role, text: snippet })}`;
}

/** A hit's --json item: JSON escaping only, so exact copies come from here (§8.3). */
function hitItem(hit, snippet, nodeId) {
  return {
    entry_uuid: hit.uuid, node_id: nodeId, ts_ms: hit.ts_ms, role: hit.role, provenance: hit.provenance, snippet,
    sidecar: hit.name, trust: 'untrusted',
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
        const gist = redactForDisplay(n.gist, rc.pairIdx).replace(/\s+/g, ' ').trim();
        const cut = snippetLine(gist);
        text += `\n  ${recallEnvelope({ src: 'node', id: shown, ts: n.latest_ms, role: null, text: cut })}`;
      }
    }
    headers.set(g, text);
    return text;
  };
  const lines = hits.map((h, i) => hitLine(h, snippets[i]));
  const items = hits.map((h, i) => hitItem(h, snippets[i], groupOf[i] === LIVE_TAIL ? null : groupOf[i]));
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
  if (a.regex !== null) return runRegex(rc, a, deps);
  const raw = a.words.join(' ');
  const syntax = regexSyntaxIn(raw);
  if (syntax !== null) {
    return refusal('regex-syntax', hintLine(regexSyntaxHint(escapeXmlText(redactField(raw, rc.pairIdx)), syntax)));
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
  return { exit: EXIT.INTERNAL, header: null, blocks: [], items: [], shown: 0, total: 0, next: null, hint: `the --regex child failed: ${detail}` };
}

/** `grep --regex <pattern>`. `deps.budgetMs` and `deps.spawn` are in-process test seams (history-test-seams-not-env). */
export function runRegex(rc, a, deps = {}) {
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
    return childFailed(r.error ? r.error.message : `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}: ${String(r.stderr ?? '').trim().slice(0, 300)}`);
  }
  let lines;
  try {
    lines = String(r.stdout).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
  } catch {
    return childFailed('its output is not JSON lines');   // fixed words: V8's message would quote the line
  }
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
/** The hint a refused describe cursor carries. */
const DESCRIBE_STALE_CURSOR = 'that --cursor pages another node, or ran past its summary; describe the node again with --full';

function nodeRow(rc, id) {
  return rc.db.prepare(`SELECT ${selectColumns(rc.version, 'nodes', DESCRIBE_NODE_COLS, rc.schema)} FROM nodes WHERE node_id = ?`).get(id);
}

/** nodes.topics as a list: the JSON array derivation writes, or, for a value that is not one, its lines. */
function topicsOf(text) {
  if (text === null || text === undefined || text === '') return [];
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v.filter((t) => typeof t === 'string');
  } catch { /* not JSON: one topic per line */ }
  return String(text).split('\n').map((t) => t.trim()).filter((t) => t !== '');
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

/** A node's native summary as RAW plain text, or null for a node with none (a raw leaf, a condensed node). It is
 *  never shown as it is: the excerpt and each --full page are redactDisplayWindow's windows of it, so describe's
 *  cost is a window's, whatever the summary's length (spec §8.3 and §8.4). */
function summaryOf(rc, n) {
  if (n.summary_blob_id === null) return null;
  // An absent or tombstoned summary blob is store corruption (the spec says summaries are never pruned), which the
  // doctor reports; describe shows it as no summary.
  const b = rc.db.prepare(`SELECT ${selectColumns(rc.version, 'blobs', ['z', 'raw_len'], rc.schema)} FROM blobs WHERE blob_id = ?`).get(n.summary_blob_id);
  if (b === undefined || b.z === null) return null;
  return blobPlainText(b.z, false, rc.pairIdx, Number(b.raw_len));
}

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
 *  text by its own cost rule. */
function describePageEnd(text, off, room, json, show) {
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

/** `describe <id | prefix | pasted line>` (§8.4). */
export function runDescribe(rc, a, deps = {}) {
  const budget = (deps.cap ?? OUTPUT_CAP) - FRAME_RESERVE;
  const ex = extractNodeId(a.target);
  if (!ex.ok) return refusal('bad-args', hintLine(redactField(`${ex.error}${ex.hint ? ` ${ex.hint}` : ''}`, rc.pairIdx)));
  const found = resolveNodeInScope(rc, ex.id);
  if (!found.ok) return found.result;
  const id = found.id;
  const n = nodeRow(rc, id);
  if (n === undefined) return notFound();
  const pre = scopePrefixes(rc);
  const disp = (x) => pre.get(x) ?? x;
  const parent = parentOf(rc.db, id);
  const producer = producerOfNode(rc, n);
  const summary = summaryOf(rc, n);
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
    if (summary === null) return refusal('bad-args', `${disp(id)} has no summary to page; describe it without --full`);
    let off = 0;
    if (a.cursor !== null) {
      const c = decodeCursor(a.cursor, 'describe');
      if (c === null || c.node !== id || !Number.isSafeInteger(c.off) || c.off < 0 || c.off >= summary.length) {
        return refusal('bad-args', DESCRIBE_STALE_CURSOR);
      }
      off = c.off;
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

  const gist = n.gist === null ? null : redactForDisplay(n.gist, rc.pairIdx);
  const topics = topicsOf(n.topics).map((t) => redactForDisplay(t, rc.pairIdx));
  const refs = refsOf(rc, id).map((r) => ({ kind: r.kind, value: redactForDisplay(r.value, rc.pairIdx), origin: r.origin }));
  const files = refs.filter((r) => r.kind === 'path').map((r) => r.value);
  const excerptEnd = summary === null ? 0 : Math.min(summary.length, pairSafeEnd(summary, 0, DESCRIBE_EXCERPT));
  const excerpt = summary === null ? null : shownSummary(0, excerptEnd);
  const head = [
    nodeLine,
    ...(parent === null ? [] : [`parent ${disp(parent)}`]),
    ...(gist === null ? [] : [`gist ${env('node', gist)}`]),
    ...(topics.length === 0 ? [] : [`topics ${env('node', topics.join(' · '))}`]),
    ...(refs.length === 0 ? [] : [`refs ${env('node', refs.map((r) => `${r.kind} ${r.value}`).join(' · '))}`]),
    ...(files.length === 0 ? [] : [`files ${env('node', files.join(' · '))}`]),
  ];
  const tail = excerpt === null ? [] : [`summary, the first ${excerptEnd} of ${summary.length} characters:`, env('summary', excerpt)];
  const label = n.depth > 0 ? 'children' : 'sources';
  const listed = n.depth > 0
    ? childRowsOf(rc, id).map((k) => {
      const c = costRow(Number((k.depth === 0 ? k.src_chars : k.desc_chars) ?? 0));
      return { line: `  ${disp(k.node_id)} ${k.kind} chars=${c.chars} fits=${c.fits}`, item: { id: k.node_id, kind: k.kind, chars: c.chars, fits: c.fits } };
    })
    : sourcesOf(rc, id).map((s) => {
      const c = costRow(Number(s.raw_len ?? 0));
      return { line: `  ${s.uuid} ${s.type} ${s.role ?? '-'} chars=${c.chars} fits=${c.fits}`, item: { uuid: s.uuid, type: s.type, role: s.role, chars: c.chars, fits: c.fits } };
    });
  const itemOf = (k) => ({
    ...base, gist, topics, refs, files, directive_flag: n.directive_flag, capped: n.capped,
    [label]: listed.slice(0, k).map((x) => x.item), [`${label}_total`]: listed.length,
    ...(excerpt === null ? {} : { summary_excerpt: excerpt, summary_chars: summary.length }),
    trust: 'untrusted',
  });
  const blocksOf = (k) => [...head, `${label} (${k} of ${listed.length} listed):`, ...listed.slice(0, k).map((x) => x.line), ...tail];
  // The fixed parts first, then as many child or source lines as still fit: a running total, so a leaf of thousands
  // of rows costs one pass.
  const each = listed.map((x) => (a.json ? JSON.stringify(x.item).length + 1 : x.line.length + 1));
  let used = a.json ? JSON.stringify(itemOf(0)).length : blocksOf(0).join('\n').length;
  let k = 0;
  while (k < listed.length && used + each[k] <= budget) { used += each[k]; k += 1; }
  return {
    exit: EXIT.OK, header: null, blocks: blocksOf(k), items: [itemOf(k)], shown: 1, total: 1,
    next: excerpt !== null && excerptEnd < summary.length ? ['describe', id, '--full', ...tailArgs] : null,
  };
}

/** cli.mjs's READ_RUNNERS.describe (W1-B2 Task 15): describe's own grammar (lib parseDescribeArgs) re-reads the
 *  verb's argv after Task 10's whitelist; a refused value is exit 2 bad-args. */
export function describeVerb(rc, argv) {
  const d = parseDescribeArgs(argv);
  return d.ok ? runDescribe(rc, d.args) : refusal('bad-args');
}
