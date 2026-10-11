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
} from './lib.mjs';
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

/** The first page of hits, flat. Task 13 replaces this with the grouped, capped and cursored rendering. */
function renderHits(rc, pool, termsOf, a, total) {
  const page = pool.slice(0, a.limit);
  const snippets = page.map((h) => hitSnippet(rc, h, termsOf(h)));
  return {
    exit: EXIT.OK, header: null, blocks: page.map((h, i) => hitLine(h, snippets[i])),
    items: page.map((h, i) => hitItem(h, snippets[i], null)), shown: page.length, total, next: null,
  };
}

/** `grep <words>` (§8.4). In order:
 *  1. regex syntax in plain search refuses BEFORE any statement is prepared (C7);
 *  2. the index gate;
 *  3. `--node`, resolved in scope;
 *  4. the ranked pool and the true count;
 *  5. the hits. */
export function runGrep(rc, a, deps = {}) {
  if (a.regex !== null) return refusal('bad-args', '--regex is not served by this build');   // Task 14 replaces this line
  const raw = a.words.join(' ');
  const syntax = regexSyntaxIn(raw);
  if (syntax !== null) {
    return refusal('regex-syntax', hintLine(regexSyntaxHint(escapeXmlText(redactField(raw, rc.pairIdx)), syntax)));
  }
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
  if (found.total === 0) return grepNotFound();
  // The snippet's needles keep a terminal prefix `*` that queryTerms strips (fix round 1, F1).
  return renderHits(rc, found.pool, () => snippetTerms(raw), a, found.total);   // deps: Task 13 reads deps.cap
}

/** cli.mjs's READ_RUNNERS.grep (W1-B2 Task 12). Task 10's whitelist has already refused an unknown or repeated
 *  option; grep's own value grammar (lib parseGrepArgs) re-reads the verb's argv for the values: the time bounds,
 *  --role, --tool and the regex-or-words rule. A refused value is exit 2 bad-args. */
export function grepVerb(rc, argv) {
  const g = parseGrepArgs(argv, rc.nowMs);
  return g.ok ? runGrep(rc, g.args) : refusal('bad-args');
}
