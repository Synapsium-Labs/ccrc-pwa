// ccd/history/recall.mjs — the read verbs' executors (W1-B2; spec
// docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.2–§8.4).
//
// L4 delivery (§6.4). cli.mjs measures; lib's decisions settle the identity, the store and the scope; this module
// executes a read over the ReadContext cli.mjs hands it. It runs on the read-only handle and returns a
// VerbResult for cli.mjs to render. Every cap, envelope, display prefix and lag below is a lib function.
//
// Every select names its columns, never SELECT * (C43). A column a later schema version added is named through
// selectColumns(rc.version, …), so a store older than this code answers with that field null (§6.11).
// Merged families and unconfirmed epochs are never read (§6.1, DM46).
// Every recalled field is redacted on its raw text BEFORE any cut or escape, then wrapped in a <ccrc-recall>
// envelope (§8.3). cli.mjs runs redactFinal over the whole output as the second belt.
//
// It reads no environment variable and has no entry guard: cli.mjs imports it.
import {
  EXIT, OUTPUT_CAP, TREE_DEPTH_MAX, selectColumns, displayPrefixes, headerLine, scopeLag, recallEnvelope, capOutput, redactForDisplay, redactFinal, readEnvelope, nextLine,
} from './lib.mjs';
import { childrenOf, parentOf } from './store.mjs';

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

/** The scope's families (§8.2). `sel` is decideScope's verdict with the generation to read: { kind, id,
 *  generation, project, workdir, workdirReal }. */
export function familiesOf(db, sel) {
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

/** The JSON scope mirrors cli.mjs's scopeJson exactly. */
function jsonScope(rc) {
  return {
    kind: rc.scope.kind, id: rc.scope.id, project: rc.scope.project,
    families: rc.scope.families.map((f) => ({ ccrc_id: f.ccrcId, generation: f.generation, first_seen_ms: f.firstSeenMs })),
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
  const defaultNext = humanCapped
    // Headings can consume the whole human budget, so the first visible root is the useful continuation.
    ? ['describe', show(visibleNodes[keptNodes.length].node_id), ...rc.scopeArgs]
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
