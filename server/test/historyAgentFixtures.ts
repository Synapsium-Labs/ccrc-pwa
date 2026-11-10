// server/test/historyAgentFixtures.ts — the rig every W4 subagent case builds on (plan 2026-11-09, Task 1C, Step 1).
// A helper module with no `describe`, as historyFixtures.ts is: history-agents-ingest.test.ts, history-census.test.ts and
// history-derive.test.ts import it, and no case defines a tick of its own.
//
// Everything here runs in THIS process against a fixture HOME (makeHistoryBox) and a store created in it: no ccd, no shim, no
// live path. Fixture accounts are lane-a and lane-b; fixture sessions are generated UUIDs; the marker is only ever planted
// under the fixture HOME.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { makeHistoryBox, type HistoryBox } from './historyHelpers.js';
import { userRow } from './historyFixtures.js';
import { capBytes, historyPaths } from '../../ccd/history/lib.mjs';
import { closeWriter, createStore, openWriter } from '../../ccd/history/store.mjs';
import { censusReport, ingestTick, makeIngestCtx, newBudget, recordAgentsInstall } from '../../ccd/history/sweep.mjs';

export type Arm = 'none' | 'file';
export const noMarker: Arm = 'none';   // tick() removes ~/.ccrc/history/agents-on first
export const armed: Arm = 'file';      // tick() plants it as a regular file first

/** The marker as a regular file, a link to a regular file, or a directory; 'none' removes it. */
export function plantMarker(box: HistoryBox, kind: 'file' | 'link' | 'dir' | 'none'): void {
  const p = historyPaths(box.home).agentsOn;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.rmSync(p, { recursive: true, force: true });
  if (kind === 'file') fs.writeFileSync(p, '');
  else if (kind === 'dir') fs.mkdirSync(p);
  else if (kind === 'link') {
    const target = path.join(box.home, '.ccrc', 'marker-target');
    fs.writeFileSync(target, '');
    fs.symlinkSync(target, p);
  }
}

/** A fixed epoch in ms, on a whole second. */
export const T0 = 1_760_000_000_000;

export interface TickOpts {
  /** ctx.nowMs. Default: the previous tick's + 60_000; the first tick's is T0 + 60_000. */
  nowMs?: number;
  /** true: meta scan_discover_ms deleted first, so ingestScanDue answers true (a scan tick); false: set to nowMs first, so the tick
   *  is not a scan; omitted: the store's own clock. */
  scan?: boolean;
  /** true: meta scan_sidecars_ms deleted first, so sidecarScanDue answers true (the sidecar half's own clock, apart from
   *  scan_discover_ms); omitted: the store's own clock (review 1737 F6). */
  sideScan?: boolean;
  /** ctx.agentStop, the walk's test seam. */
  agentStop?: (taken: number) => boolean;
  /** The store's size as a share of a 1 GB cap: the ingest context's sizeBytes is ceil(storeAt * capBytes(1)), its capBytes
   *  capBytes(1) and its pause null, as tick() hands them from the pass (Task 1E). Default 0. */
  storeAt?: number;
  /** The tick's run budget limits (newBudget's second argument): `{ chunkBytes: 1, maxBytes: 1 }` reads one line of the first file and stops
   *  (Task 1H: a parent read only to part of its file). */
  budget?: { maxMs?: number; maxBytes?: number; chunkBytes?: number };
  /** A registry id: an empty file is planted in spool/.draining/ under a name drainingNameParts parses as that id, so hintedUuids
   *  hints the id's uuid this tick. */
  hint?: string;
}

export interface AgentRig {
  box: HistoryBox;
  /** Replaceable: `reopenWriter` hands the rig a fresh handle after a case ran an op beside it. */
  db: DatabaseSync;
  /** recordAgentsInstall(db, nowMs), then one ingestTick(db, { ...makeIngestCtx(...), agentStop, pause: null, sizeBytes, capBytes },
   *  newBudget()): the pass's own order. `arm` null leaves the marker as it stands. Answers what ingestTick answers. A case about
   *  the pass itself (its pause, its record) runs the pass through runDriver. */
  tick(arm?: Arm | null, o?: TickOpts): Promise<unknown>;
}

/** Two accounts, lane-a and lane-b: DEFAULT_TEST_ROSTER's shape, its `claude` and `claude-b` entries with id, label and
 *  configDirSuffix renamed (review 1735 A5). */
export const LANE_ROSTER = {
  version: 1,
  accounts: [
    { id: 'lane-a', label: 'lane-a', configDirSuffix: '.claude-lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'lane-b', configDirSuffix: '.claude-lane-b', exec: { kind: 'generated' }, homeAble: true, hue: 'blue', telemetry: 'anthropic' },
  ],
};

const seqOf = new WeakMap<AgentRig, { n: number; last: number }>();

/** makeHistoryBox(prefix, { roster: LANE_ROSTER }), then a store created and opened in this process, as history-ingest.test.ts'
 *  openFixtureStore does it (store.createStore(home), store.openWriter(dbFile)). */
export async function agentRig(prefix: string): Promise<AgentRig> {
  const box = makeHistoryBox(prefix, { roster: LANE_ROSTER });
  const ids = createStore(box.home);
  const db = openWriter(historyPaths(box.home).dbFile);
  const rig: AgentRig = {
    box,
    db,
    async tick(arm = null, o = {}) {
      const st = seqOf.get(rig)!;
      const db = rig.db;   // the handle as it stands: a case that closed and reopened the writer (an op run) hands the tick the new one
      if (arm === 'none') plantMarker(box, 'none');
      else if (arm === 'file') plantMarker(box, 'file');
      const nowMs = o.nowMs ?? (st.last === 0 ? T0 : st.last) + 60_000;
      st.last = nowMs;
      if (o.scan === true) db.prepare('DELETE FROM meta WHERE k = ?').run('scan_discover_ms');
      else if (o.scan === false) db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run('scan_discover_ms', String(nowMs));
      if (o.sideScan === true) db.prepare('DELETE FROM meta WHERE k = ?').run('scan_sidecars_ms');
      if (o.hint !== undefined) {
        const dir = historyPaths(box.home).draining;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${o.hint}.1.1.jsonl`), '');
      }
      recordAgentsInstall(db, nowMs);
      const ctx = {
        ...makeIngestCtx(box.home, box.homes, nowMs, ids),
        agentStop: o.agentStop,
        pause: null,
        sizeBytes: Math.ceil((o.storeAt ?? 0) * capBytes(1)),
        capBytes: capBytes(1),
      };
      return ingestTick(db, ctx, newBudget(undefined, o.budget));
    },
  };
  seqOf.set(rig, { n: 0, last: 0 });
  return rig;
}

/** historyHelpers' recordOpenFlags, for an async fn: fs.openSync is wrapped until the promise settles, since recordOpenFlags
 *  restores it when fn returns, which for a tick is before its first await resumes. */
export async function recordOpenFlagsAsync<T>(fn: () => Promise<T>): Promise<{ out: T; opens: Array<{ path: string; flags: number }> }> {
  const realOpen = fs.openSync;
  const opens: Array<{ path: string; flags: number }> = [];
  fs.openSync = ((p: fs.PathLike, flags?: fs.OpenMode, ...rest: unknown[]) => {
    opens.push({ path: String(p), flags: typeof flags === 'number' ? flags : -1 });
    return (realOpen as (...a: unknown[]) => number)(p, flags, ...rest);
  }) as typeof fs.openSync;
  syncBuiltinESMExports();
  try {
    return { out: await fn(), opens };
  } finally {
    fs.openSync = realOpen;
    syncBuiltinESMExports();
  }
}

/** `meta` omitted means no meta file (as 'absent'): Task 1D then counts agent_meta_unreadable:absent at its first bind. */
export interface AgentSpec { id: string; rows: object[]; meta?: object | 'absent' | 'oversized' | 'malformed'; atMs?: number }
export interface TreeSpec {
  slug: string; uuid: string; agents: AgentSpec[];
  runs?: Array<{ id: string; agents: AgentSpec[]; journal?: 'file' | 'fifo' }>;
  /** How the parent's uuid is known. Default 'registered': $REG/<id>.uuid names it, with a fixture id such as lane-a-s1.
   *  'epoch': a confirmed epoch in the store instead. 'compactions': only a $REG/<id>.compactions line names its transcript,
   *  importEvidence's wider evidence (Task 1F). 'unknown': neither. */
  parent?: 'registered' | 'epoch' | 'compactions' | 'unknown';
  /** false: the parent's main transcript is not planted (only its session directory). Default true. */
  main?: boolean;
  /** The parent's main transcript rows, in place of the default two user rows (Task 1H: tool_use and tool_result rows at chosen times). */
  mainRows?: object[];
}

/** `n` user rows under one message-uuid family, so two agents never share an entry uuid: rows `tag`.`i`. */
export function fixtureRows(tag: number, n: number, sessionId = '0189abcd-1234-4678-9abc-000000000001'): object[] {
  return Array.from({ length: n }, (_, i) => userRow({
    uuid: `00000000-${tag.toString(16).padStart(4, '0')}-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`,
    ts: new Date(Date.UTC(2026, 10, 1, 10, 0, i)).toISOString(), sessionId, text: `fixture ${tag}.${i}`,
  }));
}

const jsonlOf = (rows: object[]): string => rows.map((r) => `${JSON.stringify(r)}\n`).join('');

/** The parent's main transcript <uuid>.jsonl under the slug, and its session directory <uuid>/subagents/…, under `home`
 *  (default the rig's first account home). Answers each agent file's path by key, and the parent's registry id (null when
 *  the parent is 'epoch' or 'unknown').
 *
 *  With `sinceMs` given, agents_since_ms = sinceMs is seeded in the store's meta before the first tick, so the tick keeps it
 *  (decideInstallRecord writes only when none exists), and each agent file's mtime is stamped with utimesSync at
 *  sinceMs + atMs (default +60_000: post-install; atMs < 0 is pre-install). A case that pins the record itself seeds nothing. */
export function plantAgentTree(rig: AgentRig, spec: TreeSpec, o: { sinceMs?: number; home?: string } = {}): { paths: Record<string, string>; parentId: string | null } {
  const home = o.home ?? rig.box.homes[0]!;
  const st = seqOf.get(rig)!;
  st.n += 1;
  const proj = path.join(home, 'projects', spec.slug);
  fs.mkdirSync(proj, { recursive: true });
  const mainPath = path.join(proj, `${spec.uuid}.jsonl`);
  if (spec.main !== false) fs.writeFileSync(mainPath, jsonlOf(spec.mainRows ?? fixtureRows(0x7000 + st.n, 2, spec.uuid)));
  const sub = path.join(proj, spec.uuid, 'subagents');
  const paths: Record<string, string> = {};
  const put = (dir: string, runId: string | null, a: AgentSpec): void => {
    fs.mkdirSync(dir, { recursive: true });
    const key = runId === null ? a.id : `${runId}/${a.id}`;
    const p = path.join(dir, `agent-${a.id}.jsonl`);
    fs.writeFileSync(p, jsonlOf(a.rows));
    paths[key] = p;
    if (o.sinceMs !== undefined) {
      const t = new Date(o.sinceMs + (a.atMs ?? 60_000));
      fs.utimesSync(p, t, t);
    }
    const mp = path.join(dir, `agent-${a.id}.meta.json`);
    if (a.meta === undefined || a.meta === 'absent') return;
    if (a.meta === 'oversized') fs.writeFileSync(mp, `{"toolUseId":"x","pad":"${'x'.repeat(70_000)}"}`);
    else if (a.meta === 'malformed') fs.writeFileSync(mp, '{not json');
    else fs.writeFileSync(mp, JSON.stringify(a.meta));
  };
  for (const a of spec.agents) put(sub, null, a);
  for (const run of spec.runs ?? []) {
    const dir = path.join(sub, 'workflows', run.id);
    for (const a of run.agents) put(dir, run.id, a);
    if (run.journal === 'file') fs.writeFileSync(path.join(dir, 'journal.jsonl'), jsonlOf(fixtureRows(0x7f00 + st.n, 2, spec.uuid)));
    else if (run.journal === 'fifo') { fs.mkdirSync(dir, { recursive: true }); spawnSync('mkfifo', [path.join(dir, 'journal.jsonl')]); }
  }
  if (o.sinceMs !== undefined) {
    rig.db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run('agents_since_ms', String(o.sinceMs));
  }
  const kind = spec.parent ?? 'registered';
  let parentId: string | null = null;
  if (kind === 'registered' || kind === 'compactions') {
    parentId = `lane-a-s${st.n}`;
    fs.mkdirSync(rig.box.reg, { recursive: true });
    if (kind === 'registered') fs.writeFileSync(path.join(rig.box.reg, `${parentId}.uuid`), spec.uuid);
    else fs.writeFileSync(path.join(rig.box.reg, `${parentId}.compactions`), `${JSON.stringify({ at: 1, trigger: 'auto', transcript: mainPath })}\n`);
  } else if (kind === 'epoch') {
    const pk = Number(rig.db.prepare("INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES (?, '', 'p', 1)").run(`lane-a-e${st.n}`).lastInsertRowid);
    rig.db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, 1, ?, 'startup', 'spool', 1)").run(pk, spec.uuid);
  }
  return { paths, parentId };
}

// Read-only probes over the rig's store, one statement each:
const n = (db: DatabaseSync, sql: string, ...a: Array<string | number>): number => (db.prepare(sql).get(...a) as { n: number }).n;
/** transcripts with agent_id <> ''. */
export function agentRows(db: DatabaseSync): number { return n(db, "SELECT count(*) AS n FROM transcripts WHERE agent_id <> ''"); }
/** Their agent_id, sorted. */
export function agentKeys(db: DatabaseSync): string[] {
  return (db.prepare("SELECT agent_id AS k FROM transcripts WHERE agent_id <> '' ORDER BY agent_id").all() as Array<{ k: string }>).map((r) => r.k);
}
/** Their workflow_run_id, non-null, sorted. */
export function runIdsOf(db: DatabaseSync): string[] {
  return (db.prepare("SELECT workflow_run_id AS r FROM transcripts WHERE agent_id <> '' AND workflow_run_id IS NOT NULL ORDER BY workflow_run_id").all() as Array<{ r: string }>).map((r) => r.r);
}
/** transcripts with agent_id = '', with their entry counts. */
export function mainRows(db: DatabaseSync): unknown[] {
  return db.prepare("SELECT t.cc_session_uuid AS uuid, count(e.entry_id) AS entries FROM transcripts t LEFT JOIN entries e ON e.transcript_pk = t.transcript_pk WHERE t.agent_id = '' GROUP BY t.transcript_pk ORDER BY t.cc_session_uuid").all();
}
/** ingest_files.offset of the row file_paths names. */
export function offsetOf(db: DatabaseSync, p: string): number {
  return n(db, 'SELECT f.offset AS n FROM ingest_files f JOIN file_paths fp ON fp.file_id = f.file_id WHERE fp.path = ?', p);
}
/** Every counter name the store holds. */
export function counterNames(db: DatabaseSync): string[] {
  return (db.prepare('SELECT name FROM counters ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name);
}
/** sidecars rows of the uuid's main transcript. */
export function sidecarsOf(db: DatabaseSync, uuid: string): number {
  return n(db, "SELECT count(*) AS n FROM sidecars s JOIN transcripts t ON t.transcript_pk = s.transcript_pk WHERE t.cc_session_uuid = ? AND t.agent_id = ''", uuid);
}
/** The census's own figure names (build question history-w4-refusals-counted-by-census): a tick counts none of them. */
export const CENSUS_WALK_FIGURES = ['agent_file_refused', 'agent_dir_refused', 'agent_meta_orphan'];

// Task 1D (P17): probes over one agent key's row, its holdings and its memberships. `key` is the agent key, `<ID>` or `<RUN>/<ID>`.
/** The key's parent_tool_use_id, or null. */
export function linkOf(db: DatabaseSync, key: string): string | null {
  return (db.prepare('SELECT parent_tool_use_id AS v FROM transcripts WHERE agent_id = ?').get(key) as { v: string | null }).v;
}
/** The key's agent_type, or null. */
export function agentTypeOf(db: DatabaseSync, key: string): string | null {
  return (db.prepare('SELECT agent_type AS v FROM transcripts WHERE agent_id = ?').get(key) as { v: string | null }).v;
}
/** transcripts rows of the key. */
export function transcriptRows(db: DatabaseSync, key: string): number { return n(db, 'SELECT count(*) AS n FROM transcripts WHERE agent_id = ?', key); }
/** Live ingest_files rows bound to the key's transcript. */
export function fileRowsOf(db: DatabaseSync, key: string): number {
  return n(db, "SELECT count(*) AS n FROM ingest_files i JOIN transcripts t ON t.transcript_pk = i.transcript_pk WHERE t.agent_id = ? AND i.source_key = ''", key);
}
/** file_paths aliases of those rows. */
export function aliasesOf(db: DatabaseSync, key: string): number {
  return n(db, "SELECT count(*) AS n FROM file_paths fp JOIN ingest_files i ON i.file_id = fp.file_id JOIN transcripts t ON t.transcript_pk = i.transcript_pk WHERE t.agent_id = ? AND i.source_key = ''", key);
}
/** For each entry of the key's transcript, in line order of its first membership, how many memberships it has. */
export function membershipsPerEntry(db: DatabaseSync, key: string): number[] {
  return (db.prepare(`SELECT count(m.file_id) AS c FROM entries e JOIN transcripts t ON t.transcript_pk = e.transcript_pk
    LEFT JOIN memberships m ON m.entry_id = e.entry_id WHERE t.agent_id = ? GROUP BY e.entry_id ORDER BY min(m.line), e.entry_id`).all(key) as Array<{ c: number }>).map((r) => r.c);
}
/** entry_variants rows under the key's transcript. */
export function variantsOf(db: DatabaseSync, key: string): number {
  return n(db, 'SELECT count(*) AS n FROM entry_variants v JOIN entries e ON e.entry_id = v.entry_id JOIN transcripts t ON t.transcript_pk = e.transcript_pk WHERE t.agent_id = ?', key);
}
/** A counter's value, 0 when it holds none. */
export function counterOf(db: DatabaseSync, name: string): number {
  return n(db, 'SELECT coalesce(sum(n), 0) AS n FROM counters WHERE name = ?', name);
}
/** The same agent file, and its meta beside it, held a second time under `toHome`, at the same project, session and run
 *  directories: a hardlink tree when `how` is 'link', a copy when 'copy'. `meta` replaces the copy's meta (an object is written,
 *  'absent' leaves none); omitted, the meta is copied as it stands. Answers the new agent file's path. */
export function holdAgainIn(fromPath: string, fromHome: string, toHome: string, how: 'link' | 'copy', meta?: object | 'absent'): string {
  const rel = path.relative(fromHome, fromPath);
  const to = path.join(toHome, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (how === 'link') fs.linkSync(fromPath, to); else fs.copyFileSync(fromPath, to);
  const fromMeta = fromPath.replace(/\.jsonl$/, '.meta.json');
  const toMeta = to.replace(/\.jsonl$/, '.meta.json');
  if (meta === 'absent') return to;
  if (meta !== undefined) fs.writeFileSync(toMeta, JSON.stringify(meta));
  else if (fs.existsSync(fromMeta)) { if (how === 'link') fs.linkSync(fromMeta, toMeta); else fs.copyFileSync(fromMeta, toMeta); }
  return to;
}

// ── Task 1H: the census rig ─────────────────────────────────────────────────────────────────────────────────────────────
/** The first row's time of every `fixtureRows` agent (a whole second): an agent's `t0`. */
export const AGENT_T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
export const iso = (ms: number): string => new Date(ms).toISOString();
const rowUuid = (tag: number, i: number): string => `00000000-${tag.toString(16).padStart(4, '0')}-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`;

/** Assistant rows each holding one `tool_use` block per id (the first named Read, the others Agent, so a row's `tool_name` names the
 *  FIRST block and a later id is found only by testing every block). `ms` null writes the row with no timestamp. Message uuids are
 *  `tag`.`i`, so no two fixtures share one (entries.uuid is unique store-wide). */
export function callRows(tag: number, calls: Array<{ ms: number | null; ids: string[] }>, sessionId = '0189abcd-1234-4678-9abc-000000000001'): object[] {
  return calls.map((c, i) => ({
    parentUuid: null, isSidechain: false, userType: 'external', cwd: '/home/u/worktrees/p/quiet-basin', sessionId, version: '2.1.289',
    gitBranch: 'ws/quiet-basin', uuid: rowUuid(tag, i), type: 'assistant', requestId: `req_${tag}_${i}`,
    ...(c.ms === null ? {} : { timestamp: iso(c.ms) }),
    message: {
      id: `msg_${tag}_${i}`, type: 'message', role: 'assistant', model: 'claude-fixture-4',
      content: c.ids.map((id, k) => ({ type: 'tool_use', id, name: k === 0 ? 'Read' : 'Agent', input: { file_path: '/x' } })),
    },
  }));
}

/** User rows each holding one `tool_result` block whose text is `text` (a string, or `items` as text items when `items` is true). */
export function resultRows(tag: number, results: Array<{ ms: number | null; text: string; items?: boolean }>, offset = 0, sessionId = '0189abcd-1234-4678-9abc-000000000001'): object[] {
  return results.map((r, i) => ({
    parentUuid: null, isSidechain: false, userType: 'external', cwd: '/home/u/worktrees/p/quiet-basin', sessionId, version: '2.1.289',
    gitBranch: 'ws/quiet-basin', uuid: rowUuid(tag, offset + i), type: 'user',
    ...(r.ms === null ? {} : { timestamp: iso(r.ms) }),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_res_${tag}_${i}`, content: r.items === true ? [{ type: 'text', text: r.text }] : r.text }] },
  }));
}

/** Plain user rows with no timestamp at all (`n` of them, tag.i): a subagent with no timed row. */
export function untimedRows(tag: number, n: number, sessionId = '0189abcd-1234-4678-9abc-000000000001'): object[] {
  return Array.from({ length: n }, (_, i) => {
    const r = userRow({ uuid: rowUuid(tag, i), ts: iso(AGENT_T0), sessionId, text: `untimed ${tag}.${i}` }) as Record<string, unknown>;
    delete r['timestamp'];
    return r;
  });
}

export interface CensusUnits {
  D: number; R: number; P: number; Q: number; Ad: number; L: number; U: number; M: number; X: number; I: number;
  G: { notFound: number; unknown: number };
}
export interface CensusShare { lo: number; hi: number; den: number }
export interface CensusReport {
  units: CensusUnits;
  byKind: { agent: CensusUnits; workflow: { a: CensusUnits | 'unavailable'; b: CensusUnits | 'unavailable'; c: CensusUnits | 'unavailable' } };
  K: Array<{ level: string; reason: string; n: number }>;
  beside: {
    holdings: number; physical: number; holdingUnbound: Record<string, number>; refusedSinceStored: number; shapes: Record<string, number>;
    companions: { meta: number; journal: number }; agentMetaOrphan: number; agentFileRefused: Record<string, number>;
    identityCollision: number; qParentUnknown: number; lookups: { agentTool: number; workflow: number; decodes: number };
  };
  reasons: Record<string, number>;
  sums: { ok: boolean; failed: string[] };
  shares: Record<string, CensusShare> | null;
  withheld: string[];
  canonical: { lo: number; hi: number } | null;
}
/** The census over the rig's store and homes, as the verb computes it (`over` replaces a dependency: predicate, runWindow, summaryState). */
export function censusOf(rig: AgentRig, over: Record<string, unknown> = {}): CensusReport {
  return censusReport(rig.db, rig.box.homes, rig.box.home, over) as unknown as CensusReport;
}

/** Close the rig's writer, run `fn` (an op beside the store, such as the shim's `import --agents --apply`), and open a fresh writer. */
export async function whileClosed<T>(rig: AgentRig, fn: () => T): Promise<T> {
  closeWriter(rig.db);
  try { return fn(); } finally { rig.db = openWriter(historyPaths(rig.box.home).dbFile); }
}
