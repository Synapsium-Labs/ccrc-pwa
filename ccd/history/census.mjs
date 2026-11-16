// ccd/history/census.mjs: the subagent parent-link census (W4 addendum P4, P11, P12, P16 to P19; plan 2026-11-09 Task 1H).
//
// L4 delivery, as derive.mjs is. It joins the walk's answer (sweep.mjs's walkTranscripts, handed in whole) with the store and reports
// how many subagent transcripts (units) there are, which of them resolve to the call that launched them, and what it cannot
// tell. It LISTS NO TREE and opens no file: the one file reads it makes are the metas and the run summaries, through the two
// functions it is handed (`deps.readMeta`, `deps.summaryState`), and the one probe it asks for an unread holding (`deps.canRead`).
// Every decision is lib.mjs's (L1): the parts and their precedence, the verdict tables, the sums, the ranges, the reasons a share is
// withheld (Task 1G), a parent search's cause order and outcome, and why a holding is unbound, by the one identity rule ingest's
// planFileRead asks too. This module measures the facts they take, by its reads and joins, and tallies what they answer. It writes nothing, not even
// a counter: a walk refusal is a figure of THIS census, recomputed each run, never a tick's counter (D-8154).
//
// It reads bodies through derive.mjs's `blobReadStmts` and `bodyOf` (lib cannot decompress, and each blob SELECT is spelled once, in
// derive: single-definition's late-census), and runs statements on the handle it is given, so `node:sqlite` stays store.mjs's
// alone (the ring case).
import {
  AGENT_LEVELS, CENSUS_COLUMNS, HOLDING_SHAPES, LINK_DECODE_MAX, LINK_WINDOW_MS, agentKey, blobOverDecodeCap, canonicalOf, censusPart, censusSums,
  censusWithheld, HOLDING_UNBOUND_CAUSES, holdingUnboundCause, metaPathOf, holdingShape, inColumn, isPreInstall, linkSearchCause, linkVerdict,
  metaEvidence, parentHoldingsCause, parentSearchOutcome, shareRange, toolUsesOf, unboundExtra, workflowCanonicalVerdict, workflowVerdict, workflowWindow,
} from './lib.mjs';
import { blobReadStmts, bodyOf } from './derive.mjs';

const SEP = '\0';
const STMTS = new WeakMap();

/** The prepared statements, one set per connection. */
function stmts(db) {
  let s = STMTS.get(db);
  if (s !== undefined) return s;
  s = {
    rows: db.prepare("SELECT transcript_pk, cc_session_uuid AS uuid, agent_id AS key, parent_tool_use_id AS link, workflow_run_id AS runId FROM transcripts WHERE agent_id <> ''"),
    mainPk: db.prepare("SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND agent_id = ''"),
    firstTs: db.prepare('SELECT min(ts_ms) AS t FROM entries WHERE transcript_pk = ? AND ts_ms IS NOT NULL'),
    runTs: db.prepare('SELECT min(e.ts_ms) AS lo, max(e.ts_ms) AS hi FROM entries e WHERE e.ts_ms IS NOT NULL AND e.transcript_pk IN '
      + '(SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ? AND workflow_run_id = ?)'),
    storedPaths: db.prepare('SELECT p.path AS path FROM file_paths p JOIN ingest_files f ON f.file_id = p.file_id WHERE f.transcript_pk = ?'),
    liveFiles: db.prepare("SELECT file_id FROM ingest_files WHERE transcript_pk = ? AND source_key = '' AND status = 'live' ORDER BY file_id"),
    memberUuids: db.prepare('SELECT e.uuid AS uuid FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? ORDER BY m.line'),
    hasMember: db.prepare('SELECT 1 AS x FROM memberships WHERE file_id = ? LIMIT 1'),
    // birth_ns as text, so lib's sameFileIdentity compares it as BigInt with no rounding (a nanosecond epoch is past 2^53)
    byInode: db.prepare("SELECT i.status AS status, i.offset AS offset, CAST(i.birth_ns AS TEXT) AS birth_ns, t.cc_session_uuid AS uuid, t.agent_id AS key "
      + "FROM ingest_files i JOIN transcripts t ON t.transcript_pk = i.transcript_pk WHERE i.dev = ? AND i.ino = ? AND i.source_key = ''"),
    pathRow: db.prepare('SELECT file_id FROM file_paths WHERE path = ?'),
    holdingByPath: db.prepare("SELECT f.file_id AS file_id, f.offset AS offset, f.size AS size FROM file_paths p JOIN ingest_files f ON f.file_id = p.file_id "
      + "WHERE p.path = ? AND f.transcript_pk = ? AND f.source_key = '' AND f.status = 'live'"),
    pastEnd: db.prepare('SELECT 1 AS x FROM memberships m JOIN entries e ON e.entry_id = m.entry_id WHERE m.file_id = ? AND e.ts_ms > ? LIMIT 1'),
    // the candidate selects: each at most LINK_DECODE_MAX + 1 rows, so a 65th says the bound stopped the search
    toolUseTimed: db.prepare("SELECT e.blob_id AS blob_id, b.raw_len AS raw_len FROM entries e JOIN blobs b ON b.blob_id = e.blob_id "
      + "WHERE e.transcript_pk = ? AND e.type = 'assistant' AND e.tool_name IS NOT NULL AND e.ts_ms BETWEEN ? AND ? ORDER BY e.ts_ms DESC, e.entry_id DESC LIMIT ?"),
    toolUseUntimed: db.prepare("SELECT e.blob_id AS blob_id, b.raw_len AS raw_len FROM entries e JOIN blobs b ON b.blob_id = e.blob_id "
      + "WHERE e.transcript_pk = ? AND e.type = 'assistant' AND e.tool_name IS NOT NULL AND e.ts_ms IS NULL ORDER BY e.entry_id DESC LIMIT ?"),
    userTimed: db.prepare("SELECT e.blob_id AS blob_id, b.raw_len AS raw_len FROM entries e JOIN blobs b ON b.blob_id = e.blob_id "
      + "WHERE e.transcript_pk = ? AND e.type = 'user' AND e.ts_ms BETWEEN ? AND ? ORDER BY abs(e.ts_ms - ?), e.entry_id DESC LIMIT ?"),
    userUntimed: db.prepare("SELECT e.blob_id AS blob_id, b.raw_len AS raw_len FROM entries e JOIN blobs b ON b.blob_id = e.blob_id "
      + "WHERE e.transcript_pk = ? AND e.type = 'user' AND e.ts_ms IS NULL ORDER BY e.entry_id DESC LIMIT ?"),
    blobs: blobReadStmts(db),   // derive's one spelling of the blob reads (late-census: each blob SELECT is spelled once)
  };
  STMTS.set(db, s);
  return s;
}

const unmeasured = (cause) => ({ outcome: 'unmeasured', cause });

// ── the parent's window (P4, P12 (b), P19) ────────────────────────────────────────────────────────────────────────────────

/** The candidate rows of one search: the timed ones through `entries_ts` first (LINK_DECODE_MAX + 1 at most), then, with room left,
 *  the untimed ones, so the list is never longer than one past the decode bound. */
function candidateRows(s, timed, untimed) {
  const cap = LINK_DECODE_MAX + 1;
  const first = timed(cap).map((r) => ({ ...r, timed: true }));
  const rest = first.length >= cap ? [] : untimed(cap - first.length).map((r) => ({ ...r, timed: false }));
  return [...first, ...rest];
}

/** One candidate's body, parsed: `{ body }`, or `{ err }` with `over-cap` (never decoded: decided from the stored raw_len before any
 *  read) or `undecodable` (derive's bodyOf answers null for a tombstone, a blob that does not decompress within its stored length,
 *  or one that is not JSON). `budget.bytes` takes the compressed bytes read, as bodyOf's other callers' budgets do. */
function bodyOfRow(s, row, budget) {
  if (blobOverDecodeCap(row.raw_len)) return { err: 'over-cap' };
  const body = bodyOf(s.blobs, row.blob_id, budget);
  return body === null ? { err: 'undecodable' } : { body };
}

/** Decode the candidates, newest or nearest first, at most LINK_DECODE_MAX of them (a body over the cap is passed over and still
 *  takes its place), and test each body. `{ match: true }` on the first hit; else `{ cause }`, lib's linkSearchCause of what the
 *  loop measured (the bound stopped a timed candidate, a body was over the cap, one could not be decoded); else `{ untimed }`,
 *  whether any candidate was an untimed row. */
function searchRows(s, rows, test, tally) {
  const limit = Math.min(rows.length, LINK_DECODE_MAX);
  let overCap = false;
  let undecodable = false;
  for (let i = 0; i < limit; i += 1) {
    const d = bodyOfRow(s, rows[i], tally);
    if (d.err === 'over-cap') { overCap = true; continue; }
    if (d.err !== undefined) { undecodable = true; continue; }
    tally.decodes += 1;
    if (test(d.body)) return { match: true };
  }
  const cause = linkSearchCause({ boundStopped: rows.slice(limit).some((r) => r.timed), overCap, undecodable });
  if (cause !== null) return { cause };
  return { untimed: rows.some((r) => !r.timed) };
}

/** The facts lib's parentHoldingsCause takes for a window ending at `end`, one per path the walk lists for the parent's main
 *  transcript: whether a live row of that transcript holds the path, whether its cursor reached its size at the last tick, and,
 *  only when it did not, whether a stored row of it is timed after `end`. */
function parentHoldings(s, pk, holdings, end) {
  return holdings.map((path) => {
    const f = s.holdingByPath.get(path, pk);
    if (f === undefined) return { bound: false };
    const readToEnd = f.size !== null && f.offset >= f.size;
    return { bound: true, readToEnd, pastEnd: readToEnd ? null : s.pastEnd.get(f.file_id, end) !== undefined };
  });
}

/** What the rest of a parent search answers once the candidates ran with no match and no unmeasured cause: lib's
 *  parentSearchOutcome of the holdings' cause and whether any candidate was untimed. */
function afterCandidates(s, pk, holdings, end, r) {
  return parentSearchOutcome({ holdingsCause: parentHoldingsCause(parentHoldings(s, pk, holdings, end)), untimed: r.untimed === true });
}

/** An Agent-tool link (P4): does the parent's main transcript hold an assistant row with a `tool_use` block whose id is `toolUseId`,
 *  among its timed rows in `[t0 - 15 min, t0]` (newest first) and then its untimed named-tool rows, at most LINK_DECODE_MAX decodes
 *  together? `holdings` are the paths the walk lists for the parent's main transcript (the window is complete only when every one is
 *  bound and read past `t0`). `t0` is the subagent's first timed row, null when it has none. `tally.decodes` counts the decodes. */
export function agentToolSearch(db, parentUuid, toolUseId, t0, holdings, tally = { decodes: 0, bytes: 0 }) {
  const s = stmts(db);
  const pk = s.mainPk.get(parentUuid)?.transcript_pk;
  if (pk === undefined) return unmeasured('parent-not-stored');
  if (!Number.isFinite(t0)) return unmeasured('no-timed-row');
  const rows = candidateRows(s, (n) => s.toolUseTimed.all(pk, t0 - LINK_WINDOW_MS, t0, n), (n) => s.toolUseUntimed.all(pk, n));
  const r = searchRows(s, rows, (body) => toolUsesOf(body).some((u) => u.id === toolUseId), tally);
  if (r.match === true) return { outcome: 'match' };
  if (r.cause !== undefined) return unmeasured(r.cause);
  return afterCandidates(s, pk, holdings, t0, r);
}

/** Whether `text` holds `runId` as a whole token: not preceded and not followed by a character of the run-id alphabet
 *  (`[A-Za-z0-9_-]`), so a longer id that begins with it, or a longer word that ends with it, is not a match. */
export function hasRunToken(text, runId) {
  const word = /[A-Za-z0-9_-]/;
  for (let at = text.indexOf(runId); at !== -1; at = text.indexOf(runId, at + 1)) {
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + runId.length] ?? '';
    if (!word.test(before) && !word.test(after)) return true;
  }
  return false;
}

/** The text of one `tool_result` block's content: the string, or each of its `text` items. */
function resultTexts(block) {
  const c = block.content;
  if (typeof c === 'string') return [c];
  if (!Array.isArray(c)) return [];
  return c.filter((i) => i !== null && typeof i === 'object' && typeof i.text === 'string').map((i) => i.text);
}

/** Does a user row's content hold a `tool_result` block naming the run id as a whole token? */
function namesRun(body, runId) {
  if (!Array.isArray(body)) return false;
  return body.some((b) => b !== null && typeof b === 'object' && b.type === 'tool_result' && resultTexts(b).some((t) => hasRunToken(t, runId)));
}

/** P12 (b)'s lookup: does a user row of the parent's main transcript in `window` hold a `tool_result` that names the run id as a
 *  whole token? Candidates are the timed user rows in the window nearest `anchor` first, then the untimed ones, at most
 *  LINK_DECODE_MAX decodes together; the outcomes are agentToolSearch's, and a null `window` (the run has no timed row) is
 *  `no-timed-row`. */
export function workflowLookup(db, parentUuid, runId, window, holdings, anchor, tally = { decodes: 0, bytes: 0 }) {
  const s = stmts(db);
  const pk = s.mainPk.get(parentUuid)?.transcript_pk;
  if (pk === undefined) return unmeasured('parent-not-stored');
  if (window === null) return unmeasured('no-timed-row');
  const rows = candidateRows(s, (n) => s.userTimed.all(pk, window[0], window[1], anchor, n), (n) => s.userUntimed.all(pk, n));
  const r = searchRows(s, rows, (body) => namesRun(body, runId), tally);
  if (r.match === true) return { outcome: 'match' };
  if (r.cause !== undefined) return unmeasured(r.cause);
  return afterCandidates(s, pk, holdings, window[1], r);
}

// ── the units ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const emptyUnits = () => ({ D: 0, R: 0, P: 0, Q: 0, Ad: 0, L: 0, U: 0, M: 0, X: 0, I: 0, G: { notFound: 0, unknown: 0 } });

/** Tally units into the report's Units shape. `verdictOf(u)` is a unit's verdict word (L, U, M or X) for the admitted ones. */
function tally(list, goneList, verdictOf) {
  const t = emptyUnits();
  for (const u of list) {
    t.D += 1;
    t[u.part] += 1;
    if (u.imported) t.I += 1;
    if (u.part === 'Ad') t[verdictOf(u)] += 1;
  }
  for (const g of goneList) t.G[g.unknown ? 'unknown' : 'notFound'] += 1;
  return t;
}

/** The directory a stored path lies below, among the unentered ones (K): its files are unknown, never absent. */
const belowAny = (path, dirs) => dirs.some((d) => path.startsWith(`${d}/`));

/** A key's bound holdings' entry uuids, one list per live file of its transcript (hardlinks are one file, so one list), for
 *  lib's holdingShape. A key with at most one live file need not read its rows: one that holds any is `single`, else `none`. */
function shapeOf(s, pk) {
  const files = s.liveFiles.all(pk);
  if (files.length === 0) return 'none';
  if (files.length === 1) return s.hasMember.get(files[0].file_id) === undefined ? 'none' : 'single';
  return holdingShape(files.map((f) => s.memberUuids.all(f.file_id).map((r) => r.uuid)));
}

/** Why an admissible holding of a stored key is not bound (HOLDING_UNBOUND_CAUSES), or null when it is: lib's holdingUnboundCause
 *  of the store's row for the holding's device and inode, the walk's facts of the holding (its birth time from the walk's own lstat),
 *  and, with no such row, whether the store knows the path and, only then, whether the file can be opened. */
function unboundCause(s, u, h, canRead) {
  const f = s.byInode.get(h.dev, h.ino);
  const row = f === undefined ? null : { transcriptUuid: f.uuid, agentKey: f.key, birthNs: f.birth_ns, live: f.status === 'live', offset: f.offset };
  const pathStored = row === null && s.pathRow.get(h.path) !== undefined;
  const readable = row === null && !pathStored ? canRead(h.path) : null;
  return holdingUnboundCause({ row, holding: { uuid: u.uuid, agentKey: u.key, birthNs: h.birthNs ?? null, size: h.size }, pathStored, readable });
}

/**
 * The census (3.3): `walk` is `{ main, agents }`, the whole answer of discovery's one walk (`walkTranscripts` with an agent sink and
 * no stop), `deps` the facts and reads it is handed:
 *   - `readMeta(path)`: a meta read bounded (sweep.mjs's readAgentMeta), answering MetaRead;
 *   - `predicate`: P12's settled predicate, 'b' (the launch result names the run) or 'c' (the run summary), null while unsettled;
 *   - `runWindow`: when the launch result arrives, 'immediate' or 'at-end' (workflowWindow), null while unsettled;
 *   - `sinceMs`: the install record (P6), null when there is none; `installRecord`: what it is, its milliseconds, `'absent'` or
 *     `'damaged'` (a damaged record reads as none, and the report says which);
 *   - `known`: the uuids a tick or an import would ingest (`knownUuids`), for `beside.qParentUnknown`;
 *   - `summaryState({ home, slug, uuid, runId })`: 'exists', 'absent' or 'unreadable' for the run's summary file (option (c)); absent
 *     dependency, option (c) is `unavailable`;
 *   - `canRead(path)`: whether an unread holding can be opened (absent: yes).
 * It reads the store and those, writes nothing, and never turns an unknown into a zero.
 */
export function runCensus(db, walk, deps) {
  const s = stmts(db);
  const sinceMs = deps.sinceMs ?? null;
  const known = deps.known ?? new Set();
  const canRead = deps.canRead ?? (() => true);
  const predicate = deps.predicate ?? null;
  const runWindow = deps.runWindow ?? null;
  const lookups = { agentTool: 0, workflow: 0, decodes: 0 };

  // what the walk found, by kind
  const unentered = [];
  const files = [];
  const metas = [];
  let journals = 0;
  for (const e of walk.agents) {
    if (e.type === 'unentered') unentered.push(e);
    else if (e.type === 'file') files.push(e);
    else if (e.role === 'meta') metas.push(e);
    else journals += 1;
  }
  const mainsOf = new Map();
  for (const m of walk.main) {
    const l = mainsOf.get(m.uuid);
    if (l === undefined) mainsOf.set(m.uuid, [m.path]); else l.push(m.path);
  }

  // K: the directories never entered, by level and reason
  const kCount = new Map();
  for (const e of unentered) kCount.set(`${e.level}${SEP}${e.reason}`, (kCount.get(`${e.level}${SEP}${e.reason}`) ?? 0) + 1);
  const K = [...kCount].map(([k, n]) => { const [level, reason] = k.split(SEP); return { level, reason, n }; })
    .sort((a, b) => AGENT_LEVELS.indexOf(a.level) - AGENT_LEVELS.indexOf(b.level) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  const kDirs = unentered.map((e) => e.path);

  // the stored subagent rows, and the listed units (one per key; a candidate whose name yields no key is a unit of its own)
  const rowOf = new Map(s.rows.all().map((r) => [`${r.uuid}${SEP}${r.key}`, r]));
  const byKey = new Map();
  for (const f of files) {
    const key = f.id === null ? null : agentKey(f.id, f.runId);
    const ukey = key === null ? `path${SEP}${f.path}` : `${f.uuid}${SEP}${key}`;
    let u = byKey.get(ukey);
    if (u === undefined) {
      u = { ukey, uuid: f.uuid, key, kind: f.runId === null ? 'agent' : 'workflow', runId: f.runId, holdings: [], row: key === null ? null : rowOf.get(ukey) ?? null };
      byKey.set(ukey, u);
    }
    u.holdings.push(f);
  }
  const listed = [...byKey.values()];

  const beside = {
    holdings: files.length,
    // a holding whose lstat failed has no identity: it is counted apart (`physicalUnmeasured`), never as one file with the others
    physical: new Set(files.filter((f) => f.ino !== null).map((f) => `${f.dev}:${f.ino}`)).size,
    physicalUnmeasured: files.filter((f) => f.ino === null).length,
    installRecord: deps.installRecord ?? (sinceMs === null ? 'absent' : sinceMs),
    holdingUnbound: Object.fromEntries(HOLDING_UNBOUND_CAUSES.map((c) => [c, 0])),
    refusedSinceStored: 0,
    shapes: Object.fromEntries(HOLDING_SHAPES.map((c) => [c, 0])),
    companions: { meta: metas.length, journal: journals },
    agentMetaOrphan: 0,
    agentFileRefused: {},
    identityCollision: 0,
    qParentUnknown: 0,
    lookups,
  };
  // a companion is an orphan when no listed candidate names it: lib's metaPathOf is the one rule for which meta a file has
  const metaPaths = new Set(files.filter((f) => f.id !== null).map((f) => metaPathOf(f.path, f.id)));
  for (const m of metas) if (!metaPaths.has(m.path)) beside.agentMetaOrphan += 1;
  for (const f of files) if (f.verdict === 'refuse') beside.agentFileRefused[f.reason] = (beside.agentFileRefused[f.reason] ?? 0) + 1;

  // each unit's part, and for an admitted one its holdings' state
  for (const u of listed) {
    u.part = censusPart({
      hasRow: u.row !== null, listed: u.holdings.length,
      admissibleMtimes: u.holdings.filter((h) => h.verdict === 'admit').map((h) => h.mtimeMs), sinceMs,
    });
    u.imported = u.part === 'Ad' && u.holdings.every((h) => isPreInstall(h.mtimeMs, sinceMs));   // no record reads every file as pre-install (lib), `beside.installRecord` says there is none
    u.bound = 0;
    u.unbound = 0;
    if (u.part === 'Q' && !known.has(u.uuid)) beside.qParentUnknown += 1;
    if (u.part !== 'Ad') continue;
    for (const h of u.holdings) {
      if (h.verdict === 'refuse') { beside.refusedSinceStored += 1; continue; }
      const cause = unboundCause(s, u, h, canRead);
      if (cause === null) u.bound += 1;
      else { u.unbound += 1; beside.holdingUnbound[cause] += 1; }
    }
    const shape = shapeOf(s, u.row.transcript_pk);
    beside.shapes[shape] += 1;
    if (shape === 'disjoint') beside.identityCollision += 1;
  }

  // the stored rows no listed holding names: G, `unknown` when one of their stored paths lies below an unentered directory
  const gone = [];
  for (const r of rowOf.values()) {
    if (byKey.has(`${r.uuid}${SEP}${r.key}`)) continue;
    gone.push({ kind: r.runId === null ? 'agent' : 'workflow', unknown: s.storedPaths.all(r.transcript_pk).some((p) => belowAny(p.path, kDirs)) });
  }

  // verdicts of the admitted units
  const timeCache = new Map();
  const firstTs = (pk) => { if (!timeCache.has(pk)) timeCache.set(pk, s.firstTs.get(pk)?.t ?? null); return timeCache.get(pk); };
  const runCache = new Map();
  const holdingsOf = (uuid) => mainsOf.get(uuid) ?? [];
  const lookupOf = (u) => {
    const ck = `${u.uuid}${SEP}${u.runId}`;
    if (runCache.has(ck)) return runCache.get(ck);
    if (runWindow === null) {   // no run window is measured: none is guessed
      runCache.set(ck, unmeasured('no-run-window'));
      return runCache.get(ck);
    }
    const t = s.runTs.get(u.uuid, u.runId);
    const window = workflowWindow(t?.lo ?? null, runWindow, t?.hi ?? null);
    const anchor = runWindow === 'at-end' ? t?.hi ?? 0 : t?.lo ?? 0;
    lookups.workflow += 1;
    const tl = { decodes: 0, bytes: 0 };
    const r = workflowLookup(db, u.uuid, u.runId, window, holdingsOf(u.uuid), anchor, tl);
    lookups.decodes += tl.decodes;
    runCache.set(ck, r);
    return r;
  };
  const summaryOf = (u) => {
    const h = u.holdings[0];
    return deps.summaryState === undefined ? null : deps.summaryState({ home: h.home, slug: h.slug, uuid: u.uuid, runId: u.runId });
  };
  for (const u of listed) {
    if (u.part !== 'Ad') continue;
    if (u.kind === 'agent') {
      const reads = u.holdings.filter((h) => h.id !== null).map((h) => deps.readMeta(metaPathOf(h.path, h.id)));
      const meta = metaEvidence({ stored: u.row.link, reads });
      let parent = null;
      if ('link' in meta) {
        lookups.agentTool += 1;
        const tl = { decodes: 0, bytes: 0 };
        parent = agentToolSearch(db, u.uuid, meta.link, firstTs(u.row.transcript_pk), holdingsOf(u.uuid), tl);
        lookups.decodes += tl.decodes;
      }
      u.verdict = linkVerdict({ meta, parent });
      continue;
    }
    u.options = {
      a: workflowVerdict('a', null),
      b: predicate === 'b' ? workflowVerdict('b', lookupOf(u)) : 'unavailable',
      c: workflowVerdict('c', summaryOf(u)),
    };
    u.verdict = workflowCanonicalVerdict(predicate, u.options);
  }

  // the report's figures
  const canonicalV = (u) => u.verdict.v;
  const agentList = listed.filter((u) => u.kind === 'agent');
  const wfList = listed.filter((u) => u.kind === 'workflow');
  // (b) is computed only under the settled predicate, (c) only when the run summary can be asked: otherwise `unavailable`, never a zero
  const optionUnits = (name, available) => (available
    ? tally(wfList, gone.filter((g) => g.kind === 'workflow'), (u) => u.options[name].v)
    : 'unavailable');
  const units = tally(listed, gone, canonicalV);
  const reasons = {};
  for (const u of listed) if (u.part === 'Ad' && u.verdict.v === 'M') reasons[u.verdict.reason] = (reasons[u.verdict.reason] ?? 0) + 1;
  const sums = censusSums(units);
  const kTotal = K.reduce((n, k) => n + k.n, 0);
  const withheld = censusWithheld({ K: kTotal, collisions: beside.identityCollision, sumsOk: sums.ok, installRecord: beside.installRecord });

  let shares = null;
  if (withheld.length === 0) {
    shares = {};
    for (const column of CENSUS_COLUMNS) {
      const members = listed.filter((u) => inColumn(column, u.part, u.imported));
      const adMembers = members.filter((u) => u.part === 'Ad');
      const L = adMembers.filter((u) => u.verdict.v === 'L').length;
      const M = adMembers.filter((u) => u.verdict.v === 'M').length;
      const extraLow = unboundExtra(adMembers.map((u) => ({ bound: u.bound, unbound: u.unbound })));
      const r = shareRange({ L, M, den: members.length, extraLow });
      if (r !== null) shares[column] = { ...r, den: members.length };
    }
  }
  const canon = canonicalOf({ shares, withheld, predicate });
  return {
    units,
    byKind: {
      agent: tally(agentList, gone.filter((g) => g.kind === 'agent'), canonicalV),
      workflow: { a: optionUnits('a', true), b: optionUnits('b', predicate === 'b'), c: optionUnits('c', deps.summaryState !== undefined) },
    },
    K,
    beside,
    reasons,
    sums,
    shares,
    withheld,
    predicate,
    canonical: canon === null ? null : { lo: canon.lo, hi: canon.hi },
  };
}

// ── the text ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const pairs = (o) => { const e = Object.entries(o); return e.length === 0 ? 'none' : e.map(([k, n]) => `${k} ${n}`).join(', '); };
const unitsLine = (label, u) => (u === 'unavailable' ? `census ${label}: unavailable`
  : `census ${label}: D ${u.D} = R ${u.R} + P ${u.P} + Q ${u.Q} + Ad ${u.Ad}; Ad = L ${u.L} + U ${u.U} + M ${u.M} + X ${u.X}; I ${u.I}; G ${u.G.notFound + u.G.unknown} (not found ${u.G.notFound}, unknown ${u.G.unknown})`);

/** The report as text lines, one group per line: counts and ranges only, never a path or a message's text. */
export function formatCensus(r) {
  const b = r.beside;
  const lines = [
    unitsLine('units', r.units),
    unitsLine('agent units', r.byKind.agent),
    unitsLine('workflow units, (a) placement', r.byKind.workflow.a),
    unitsLine('workflow units, (b) run named', r.byKind.workflow.b),
    unitsLine('workflow units, (c) run summary', r.byKind.workflow.c),
    `census M by reason: ${pairs(r.reasons)}`,
    `census unentered directories (K): ${r.K.length === 0 ? 'none' : r.K.map((k) => `${k.level}:${k.reason} ${k.n}`).join(', ')}`,
    `census beside: holdings ${b.holdings}, physical files ${b.physical} (unmeasured ${b.physicalUnmeasured}), install record ${b.installRecord}, refused since stored ${b.refusedSinceStored}, Q with an unknown parent ${b.qParentUnknown}, identity_collision ${b.identityCollision}`,
    `census holding_unbound: ${pairs(b.holdingUnbound)}`,
    `census shapes: ${pairs(b.shapes)}`,
    `census agent_file_refused: ${pairs(b.agentFileRefused)}`,
    `census companions: meta ${b.companions.meta}, journal ${b.companions.journal}; agent_meta_orphan ${b.agentMetaOrphan}`,
    `census lookups: agent-tool ${b.lookups.agentTool}, workflow ${b.lookups.workflow}, decodes ${b.lookups.decodes}`,
    `census sums: ${r.sums.ok ? 'ok' : `failed ${r.sums.failed.join(', ')}`}`,
  ];
  if (r.shares === null) lines.push(`census share withheld: ${r.withheld.join(', ')}`);
  else {
    for (const [column, x] of Object.entries(r.shares)) lines.push(`census share ${column}: ${pct(x.lo)} to ${pct(x.hi)} (den ${x.den})`);
    let why = 'no unit is in the D-T denominator';
    if (r.predicate === null) why = 'the workflow predicate is not settled';
    lines.push(r.canonical === null ? `census canonical: none (${why})` : `census canonical (D-T): ${pct(r.canonical.lo)} to ${pct(r.canonical.hi)}`);
  }
  return lines;
}
