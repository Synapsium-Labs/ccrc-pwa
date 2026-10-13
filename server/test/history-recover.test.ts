// server/test/history-recover.test.ts — the history store's recovery step, and the binding verbs that register it
// (spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §9.14 "Recovery", §9.2, §8.4). W1-B2.
// Three ways in:
//   - as history-drain.test.ts, the REAL sweep as the box runs it: runSweep, and the run-pass driver (runDriver) where a case needs a run budget
//     smaller than one pass's journal;
//   - sweep.mjs's own recoveryStep, imported in-process against a real store, where a case needs a switch set between
//     two chunks, a budget of a few records, or an executor of its own;
//   - the operator verbs on a REAL terminal (node-pty), through both doors, where a case needs a TTY.
// Every store lives in a mkTmp fixture HOME (historyHelpers' makeHistoryBox); nothing reads or writes the live ~/.ccrc.
// Each test's fixture HOMEs are removed when it ends (removeTmpFixturesEachTest), not at the file's end.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { brotliDecompressSync as rrUnbrotli } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import * as pty from 'node-pty';
import {
  makeHistoryBox, runSweep, runShim, runDriver, skipOnDarwin, openStoreRO, counters, journalRecords, plantSession,
  plantTranscript, spoolLine, preloadOptions, PRELOADS, CLI, recoverRow, boundEmptyStore,
  runCli, withPane, seedFamily, journalDirOf, type HistoryBox, type SpawnOpts,
} from './historyHelpers.js';
import { userRow, assistantRow, boundaryRow, summaryRow } from './historyFixtures.js';
import { removeTmpFixturesEachTest, mkTmp } from './tmpHelpers.js';
import {
  HEALTH_META, RECOVER_PHASES, RECOVERY_STALL_TICKS, SCHEMA_VERSION, WRITING_FORMS, floorThreshold, historyPaths, journalRecord, mergeJournalByTime,
  REDACTED_MARK, BELT_VERSION, parseBeltState, beltWidth, type BeltState, planReplay,
  NODE_PARSER_VERSION, makePairIndex, secretPairs, parentRollup, nodeIndexTexts,
} from '../../ccd/history/lib.mjs';
import { StoreError, abortRestore, closeWriter, createFtsTables, createStore, getMeta, getStep, openWriter, setMeta, setStep, stageRestore } from '../../ccd/history/store.mjs';

skipOnDarwin();
removeTmpFixturesEachTest();

// Each spawning case gets this budget (the sweep, the CLI and a terminal spawn on a heavily loaded box); longer is 1.5 * HEAVY or 2.5 * HEAVY, never a new literal.
const HEAVY = 120_000;
const ID = 'claude-a-demo';
const ID2 = 'claude-b-demo';
const SLUG = '-home-u-tree-demo';
const WORK = '/home/u/tree/demo';
const MIN = 60_000;
const GIB = 1024 ** 3;
/** A lowercase uuid from a small number: the UUID_RE grammar, readable in a failure. */
const u = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

interface SweepRecover {
  RECOVER_EXECUTORS: Readonly<Record<string, unknown>>;
  recoveryStep(db: DatabaseSync, ctx: Record<string, unknown>, executors?: Readonly<Record<string, unknown>>):
    Promise<{ moved: boolean; done: boolean; held: boolean }>;
  newBudget(now?: () => number, limits?: { maxMs?: number; maxBytes?: number; chunkBytes?: number }): Record<string, unknown>;
  recoverPass(db: DatabaseSync, ctx: Record<string, unknown>, failedAtStart: number): Promise<number>;
  journalRedactPairs(P: ReturnType<typeof historyPaths>, storeId: string):
    { pairs: Array<{ len: number; sha256: string; t: number }>; foreign: string[]; unreadable: string[] };
  makeIngestCtx(home: string, homes: readonly string[], nowMs: number, ids: unknown): Record<string, unknown>;
  journalStoreDirs(home: string): Array<{ storeId: string; heads: string }>;
  runOpPass(parsed: { op: string; opArgs: string[] }, deps: Record<string, unknown>, out: (line: string) => void): Promise<number>;
  recoverReindex(db: DatabaseSync, ctx: Record<string, unknown>, cur: { pairsAdded: boolean }, budget: Record<string, unknown>):
    Promise<{ done: boolean; moved: boolean }>;
}
/** What batch HE calls of derive.mjs in-process. */
interface DeriveNodes {
  rederiveGistsFor(db: DatabaseSync, ictx: Record<string, unknown>, values: readonly string[], budget: Record<string, unknown>,
    slice: Record<string, unknown>): number;
  beltNodesStep(db: DatabaseSync, ictx: Record<string, unknown>, slice: Record<string, unknown>): boolean;
  redactNodeFields(db: DatabaseSync, ictx: Record<string, unknown>, nodeIds: readonly string[]): number;
  rerollParents(db: DatabaseSync, ictx: Record<string, unknown>, nodeIds: readonly string[], onlyIfChanged?: boolean): number;
  deriveParents(db: DatabaseSync, ictx: Record<string, unknown>, budget: Record<string, unknown>): number;
  refreshLeaf(db: DatabaseSync, ictx: Record<string, unknown>, nodeId: string): string;
}
let SW: SweepRecover;
let DV: DeriveNodes;
beforeAll(async () => {
  SW = (await import('../../ccd/history/sweep.mjs')) as unknown as SweepRecover;
  DV = (await import('../../ccd/history/derive.mjs')) as unknown as DeriveNodes;
});

/** What recoveryStep reads of a TickCtx, in-process: a statfs stub with room to spare (so no case reads the free
 *  space of the box running it) and a run budget, lib's unless `limits` makes it smaller. */
const stepCtx = (box: HistoryBox, ids: { storeId: string; writer: string },
  limits: { maxMs?: number; maxBytes?: number; chunkBytes?: number } = {}): Record<string, unknown> => ({
  home: box.home, paths: historyPaths(box.home), ids, now: () => Date.now(), homes: box.homes, out: () => {},
  deps: { statfs: async () => ({ bsize: 1, bavail: 4 * 2 ** 40, blocks: 8 * 2 ** 40 }) },
  budget: SW.newBudget(() => Date.now(), limits), parsed: { secrets: [] },
});
/** The registered recovery step's cursor, read on the caller's own handle. */
const cursorOn = (db: DatabaseSync): string | null => {
  const r = db.prepare("SELECT cursor FROM derivation_state WHERE step = 'recover'").get() as { cursor: string | null } | undefined;
  return r === undefined || r.cursor === null ? null : String(r.cursor);
};
/** Named counters, read on the caller's own handle (0 when never bumped). */
const countersOn = (db: DatabaseSync, ...names: string[]): Record<string, number> =>
  Object.fromEntries(names.map((n) => {
    const r = db.prepare('SELECT n FROM counters WHERE name = ?').get(n) as { n: number } | undefined;
    return [n, r === undefined ? 0 : Number(r.n)];
  }));

/** One scheduled pass that must exit 0. */
const pass = (box: HistoryBox, env: Record<string, string> = {}, preloads: string[] = []): void => {
  const r = runSweep(box, [], { env, preloads });
  expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
};
/** One query on the box's store, as plain objects. */
const rows = (box: HistoryBox, sql: string, ...args: (string | number)[]): Array<Record<string, unknown>> => {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args).map((r) => ({ ...r })); } finally { db.close(); }
};
const countOf = (box: HistoryBox, table: string): number => Number(rows(box, `SELECT count(*) AS n FROM ${table}`)[0]!['n']);
const metaOf = (box: HistoryBox, k: string): string | null => {
  const db = openStoreRO(box);
  try { return getMeta(db, k); } finally { db.close(); }
};
const offsetsOf = (box: HistoryBox): Array<Record<string, unknown>> =>
  rows(box, 'SELECT file_id, "offset" AS at FROM ingest_files ORDER BY file_id');
/** A recovery step registered on the box's store, as a restore's commit leaves one (§8.4). */
const registerRecovery = (box: HistoryBox, version: number): void => {
  const db = openWriter(historyPaths(box.home).dbFile);
  try {
    db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(version);
  } finally {
    closeWriter(db);
  }
};
/** A journal file under journal/<storeId>/, written by hand: a head, then `lines` as given (journalRecord output, or
 *  a line broken on purpose). The head names `headStore`, which is `storeId` unless a case plants a foreign one. */
const plantJournalFile = (box: HistoryBox, storeId: string, month: string, writer: string, headT: number, lines: string[],
  headStore: string = storeId): void => {
  const dir = path.join(box.root, 'journal', storeId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const head = journalRecord('head', headT, { store_id: headStore, month, writer });
  fs.writeFileSync(path.join(dir, `${month}.${writer}.jsonl`), `${[head, ...lines].join('\n')}\n`, { mode: 0o600 });
};
interface StatusView {
  recovering: { step: string; cursor: string } | null;
  health: { pass: string | null; warn: Array<{ word: string }>; fail: Array<{ word: string }> };
}
/** `ccrc history status --json`, as doctor reads it. */
const status = (box: HistoryBox): StatusView => { const r = runCli(box, ['status', '--json']); expect(r.json, `${r.stdout}${r.stderr}`).not.toBeNull(); return r.json as unknown as StatusView; };
/** The families, epochs, receipts, recall rows and candidates of `id`, compared by name (§8.4 "what comes back
 *  equal"): no surrogate key, no cwd_real. */
const familyState = (box: HistoryBox, id: string): Record<string, Array<Record<string, unknown>>> => ({
  sessions: rows(box, 'SELECT ccrc_id, generation, project, first_seen_ms, merged_into IS NOT NULL AS merged FROM sessions WHERE ccrc_id = ? ORDER BY generation', id),
  epochs: rows(box, 'SELECT e.seq, e.cc_session_uuid, e.cause, e.declared_by, e.confirmed_ms FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE s.ccrc_id = ? ORDER BY e.seq', id),
  receipts: rows(box, 'SELECT event_key, lower(hex(payload_sha)) AS sha, received_ms, ts_ms, ts_source FROM spool_receipts ORDER BY event_key'),
  recall: rows(box, 'SELECT event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm FROM recall_calls ORDER BY event_key'),
  candidates: rows(box, 'SELECT cc_session_uuid, ccrc_id, generation, cause, ts_ms, first_seen_ms FROM epoch_candidates ORDER BY cc_session_uuid'),
});
/** The journal's records counted by kind, a verdict by its kind: what a pass appended, measured. */
const journalKinds = (box: HistoryBox): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of journalRecords(box)) {
    const k = r['k'] === 'verdict' ? `verdict:${String(r['kind'])}` : String(r['k']);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

/** Every entry under ~/.ccrc, files with their size and mtime: "writes nothing", measured. The shim's lock (opened on
 *  every run) and SQLite's -wal and -shm (a read-only open may make them) are left out. Directories are listed by
 *  name only, since a sidecar's create-and-remove moves a directory's mtime. */
function ccrcSnapshot(box: HistoryBox): string[] {
  const root = path.join(box.home, '.ccrc');
  const out: string[] = [];
  const visit = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'history-sweep.lock' || /-(wal|shm)$/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out.push(`${path.relative(root, p)}/`); visit(p); continue; }
      const st = fs.lstatSync(p);
      out.push(`${path.relative(root, p)} ${st.size} ${Math.trunc(st.mtimeMs)}`);
    }
  };
  visit(root);
  return out.sort();
}

/** A command on a REAL terminal (node-pty), so stdin IS a TTY: the irreversible forms refuse without one (§8.4). A
 *  pty merges stdout and stderr. The timer is a safety net, never the assertion. A pty child leads its own process
 *  group, so the timer kills the whole group: the shim and the sweep under it die too, and none outlives its case
 *  holding the history lock. */
function onPty(box: HistoryBox, argv: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const full: Record<string, string> = {};
  const merged: NodeJS.ProcessEnv = {
    ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), ...env,
  };
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) full[k] = v;
  return new Promise((resolve) => {
    const p = pty.spawn(argv[0]!, argv.slice(1), { name: 'xterm-color', cols: 200, rows: 40, cwd: box.home, env: full });
    let out = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out });
    };
    const timer = setTimeout(() => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill(); }
      finish(-1);
    }, HEAVY / 3);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}
/** `ccrc history <args>` (the CLI door) and the shim's `--op` (the direct door), each on a terminal. */
const cliOnPty = (box: HistoryBox, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> =>
  onPty(box, [process.execPath, '--no-warnings', CLI, ...args], env);
const shimOnPty = (box: HistoryBox, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> =>
  onPty(box, ['bash', path.join(box.home, '.local', 'bin', 'ccd-history-sweep'), ...args], env);
/** The --op pass's one JSON result, its LAST `{"rc"` line (§8.4), with a pty's \r stripped. */
function lastRc(out: string): { rc: number; reason?: string } {
  const lines = out.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{"rc"'));
  expect(lines.length, `no {"rc":…} line in:\n${out}`).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]!) as { rc: number; reason?: string };
}
/** The CLI door's --json envelope, read as `{exit, reason?}`: the last line that parses as an object with a numeric
 *  `exit`. On a terminal the sweep's relayed lines (stderr under --json) come before it. */
function lastEnvelope(out: string): { exit: number; reason?: string } {
  const lines = out.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let o: { exit?: unknown; reason?: unknown };
    try { o = JSON.parse(lines[i]!) as { exit?: unknown; reason?: unknown }; } catch { continue; }
    if (typeof o.exit === 'number') return typeof o.reason === 'string' ? { exit: o.exit, reason: o.reason } : { exit: o.exit };
  }
  throw new Error(`no --json envelope in:\n${out}`);
}

describe('the recovery step (W1-B2 Task 25; spec §9.14)', () => {
  it('RECOVER_EXECUTORS runs every RECOVER_PHASES phase, and only those (W1-B4 adds its export phases to both)', () => {
    expect(Object.keys(SW.RECOVER_EXECUTORS)).toEqual([...RECOVER_PHASES]);
  });

  it('O48, the replay order: a startup and two clears drained from one file, a gen-less recall, a later-tick confirmation and a held file replay into the same families, epochs, receipts and candidates with $REG gone', () => {
    const box = makeHistoryBox('ccrc-history-recover-order-');
    const P = historyPaths(box.home);
    const [S, C1, C2, S9] = [u(0x51), u(0x52), u(0x53), u(0x59)];
    const [G, G9] = [u(0xa1), u(0xa9)];
    pass(box);   // first install: the store, spool/, and scan_ms, so no registry backfill runs below
    const storeId = fs.readFileSync(P.storeId, 'utf8').trim();
    plantSession(box, ID, { uuid: S, generation: G, project: 'demo', workdir: WORK });
    const t0 = Date.now() - MIN;
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: S, src: 'startup', reg: S, gen: G, ts: t0 });
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: C1, src: 'clear', gen: G, ts: t0 + 1 });
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: C2, src: 'clear', gen: G, ts: t0 + 2 });
    spoolLine(box, ID, { v: 1, ev: 'recall', id: ID, cmd: 'grep', rc: 0, ms: 12, ts: t0 + 3 });
    pass(box);   // the rename, observed: .uuid = S, .generation = G, .project = demo
    pass(box);   // the drain: S confirmed by its own reg, C1 and C2 chained unconfirmed, the recall joined to G
    plantSession(box, ID, { uuid: C1 });
    pass(box);   // a later tick confirms C1: a verdict with no event_key, at its own position
    const A = familyState(box, ID);
    expect(A.epochs!.map((e) => [e['seq'], e['cc_session_uuid'], e['cause'], e['confirmed_ms'] === null]))
      .toEqual([[1, S, 'startup', false], [2, C1, 'clear', false], [3, C2, 'clear', true]]);
    expect(A.candidates!.map((c) => c['cc_session_uuid'])).toEqual([C2]);
    expect(A.recall!.map((r) => r['generation'])).toEqual([G]);
    expect(A.receipts).toHaveLength(4);

    // The DB is lost, and the registry rows of ID with it.
    for (const f of [P.dbFile, P.wal, P.shm]) fs.rmSync(f, { force: true });
    for (const f of ['uuid', 'generation', 'project', 'workdir']) fs.rmSync(path.join(box.reg, `${ID}.${f}`), { force: true });
    // A spool file journaled and HELD under store-missing: its records have no `drained` record.
    plantSession(box, ID2, { uuid: S9, generation: G9, project: 'demo2', workdir: WORK });
    spoolLine(box, ID2, { v: 1, ev: 'SessionStart', id: ID2, sid: S9, src: 'startup', gen: G9, ts: t0 + 10 });
    const held = runSweep(box);
    expect(held.code, held.stderr).toBe(5);
    expect(held.stdout).toContain('history-sweep: store-missing');
    for (const f of ['uuid', 'generation', 'project', 'workdir']) fs.rmSync(path.join(box.reg, `${ID2}.${f}`), { force: true });
    // Today's recall-off/<ID> names another generation. The drain never saw it, so replay must not count it stale:
    // a replayed line re-decides nothing from present state (§9.14; sweep.mjs's run.ectx.replay).
    fs.mkdirSync(path.join(box.root, 'recall-off'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(box.root, 'recall-off', ID), u(0xee));

    const before = journalKinds(box);
    const bound = boundEmptyStore(box, storeId);
    pass(box);   // the recovery step, whole (the default budget), then the journal half
    expect(recoverRow(box)).toMatchObject({ version: bound.version, completed_ms: expect.any(Number) });
    expect(counters(box)['recall_off_stale'] ?? 0, 'the replayed recall line read no recall-off switch').toBe(0);
    const B = familyState(box, ID);
    expect(B.sessions).toEqual(A.sessions);
    expect(B.epochs).toEqual(A.epochs);
    expect(B.recall).toEqual(A.recall);
    expect(B.candidates, 'the clear still waiting re-enters epoch_candidates, aged by its journal time').toEqual(A.candidates);
    expect(B.receipts, 'the held file is not replayed: no receipt until the live drain decides it').toEqual(A.receipts);
    expect(rows(box, 'SELECT ccrc_id FROM sessions WHERE ccrc_id = ?', ID2)).toEqual([]);
    // Replay writes no journal record: the pass added its bind (flushed), a head for the new writer's file and its
    // own tick record, nothing else.
    expect(journalKinds(box)).toEqual({
      ...before,
      head: (before['head'] ?? 0) + 1,
      tick: (before['tick'] ?? 0) + 1,
      'verdict:bind': (before['verdict:bind'] ?? 0) + 1,
    });

    pass(box);   // the live drain takes the held file, deciding from its observation sidecar
    expect(rows(box,
      'SELECT s.generation, s.project, e.cc_session_uuid, e.cause, e.confirmed_ms IS NOT NULL AS confirmed FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE s.ccrc_id = ?',
      ID2)).toEqual([{ generation: G9, project: 'demo2', cc_session_uuid: S9, cause: 'startup', confirmed: 1 }]);
  }, HEAVY);

  it('O44: a recovery step larger than one pass holds the drain and the ingest over several passes, journals arriving spool files once, reports recovering, counts each skipped record, then both resume', () => {
    const box = makeHistoryBox('ccrc-history-recover-hold-');
    const P = historyPaths(box.home);
    const U1 = u(0x61);
    const G1 = u(0xb1);
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo', workdir: WORK });
    const transcript = plantTranscript(box, 'claude-a', SLUG, U1, [
      userRow({ uuid: u(0x1001), ts: new Date(Date.now() - 5 * MIN).toISOString(), text: 'the first row' }),
    ]);
    pass(box);   // first install, the registry mapping, and the transcript read to its end
    const storeId = fs.readFileSync(P.storeId, 'utf8').trim();
    const offsets0 = offsetsOf(box);
    expect(offsets0, 'the transcript has a cursor').toHaveLength(1);
    // A journal file of an older month: padding that makes the journal larger than the passes' budget, plus a torn
    // line, an unknown kind and a newer v, each to be skipped and counted once.
    const T20 = Date.UTC(2020, 0, 1);
    plantJournalFile(box, storeId, '2020-01', '0badf00d', T20, [
      ...Array.from({ length: 30 }, (_, i) => journalRecord('tick', T20 + (i + 1) * 1000, { lag_ms: null })),
      '{"v":1,"k":"tick","t":17',
      '{"v":1,"k":"zzz","t":1}',
      '{"v":2,"k":"tick","t":1,"lag_ms":null}',
      journalRecord('tick', T20 + 60_000, { lag_ms: 5 }),
    ]);
    const version = Date.now();
    registerRecovery(box, version);
    fs.appendFileSync(transcript, `${JSON.stringify(userRow({ uuid: u(0x1002), ts: new Date().toISOString(), text: 'written while recovering' }))}\n`);
    const receipts0 = countOf(box, 'spool_receipts');
    let passes = 0;
    let sawStatus = false;
    for (;;) {
      spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID, sid: U1, ts: Date.now() });
      const r = runDriver(box, { budgetBytes: 1200, chunkBytes: 400 });
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      passes += 1;
      expect(offsetsOf(box), `pass ${passes}: no ingest cursor moves while a recovery step is registered`).toEqual(offsets0);
      expect(countOf(box, 'spool_receipts'), `pass ${passes}: nothing is drained while recovering`).toBe(receipts0);
      const row = recoverRow(box)!;
      if (row.completed_ms !== null) break;
      expect(metaOf(box, HEALTH_META.recoverUnmovedTicks), 'a pass that moved the cursor').toBe('0');
      if (!sawStatus) {
        sawStatus = true;
        const s = status(box);
        expect(s.recovering).toEqual({ step: `recover/${version}`, cursor: row.cursor });
        expect(s.health.warn.map((w) => w.word)).toContain('recovering');
      }
      expect(passes, 'the step never completed').toBeLessThan(40);
    }
    expect(passes, 'the step spans several passes').toBeGreaterThanOrEqual(3);
    expect(sawStatus).toBe(true);
    // Each pass's Stop file was journaled exactly once, though it was held over the passes after it.
    const files = journalRecords(box).filter((x) => x['k'] === 'file').map((x) => String(x['name'])).filter((n) => n.startsWith(`${ID}.`));
    expect(files).toHaveLength(passes);
    expect(new Set(files).size).toBe(files.length);
    // The torn line and the newer v are malformed, the unknown kind unknown: each counted once.
    expect(counters(box)).toMatchObject({ journal_line_malformed: 2, journal_record_unknown: 1 });
    // A recovery pass's own tick record, journaled after the bind, is never inserted a second time.
    expect(rows(box, 'SELECT ts_ms, count(*) AS c FROM ticks GROUP BY ts_ms HAVING c > 1')).toEqual([]);
    expect(rows(box, "SELECT name FROM sqlite_master WHERE name IN ('recover_verdicts', 'recover_drained')")).toEqual([]);
    expect(metaOf(box, HEALTH_META.recoverUnmovedTicks)).toBe('0');
    // Then both resume: the next pass drains every held file. A hint is a name in .draining/ after the drain, and the
    // held files are drained (and unlinked) before the ingest looks, so it is a Stop line arriving now, renamed by this
    // pass and drained by the next, that hints the transcript: it is then read to its new end.
    spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID, sid: U1, ts: Date.now() });
    pass(box);
    expect(countOf(box, 'spool_receipts')).toBe(receipts0 + passes);
    expect(offsetsOf(box)[0]!['at']).toBe(fs.statSync(transcript).size);
  }, 1.5 * HEAVY);

  it('O44, the floor: below it a recovery pass does not start the step and counts capture_paused_low_disk; a per-chunk probe below it pauses the step too', () => {
    const box = makeHistoryBox('ccrc-history-recover-floor-');
    pass(box);
    registerRecovery(box, Date.now());
    const FS_BYTES = 100 * GIB;
    const low = `${floorThreshold(FS_BYTES) - 4096}:${FS_BYTES}`;
    pass(box, { HISTORY_TEST_STATFS: low });
    expect(counters(box)['capture_paused_low_disk']).toBe(1);
    expect(recoverRow(box)).toMatchObject({ cursor: null, completed_ms: null });
    expect(metaOf(box, HEALTH_META.recoverUnmovedTicks), 'held by the floor: the count does not rise').toBe('0');
    // The pass's own probe (the first statfs call) has room; the step's probe before its first chunk does not.
    pass(box, { HISTORY_TEST_STATFS_AFTER: `1:${low}` });
    expect(counters(box)['capture_paused_low_disk']).toBe(2);
    expect(recoverRow(box)).toMatchObject({ cursor: null, completed_ms: null });
    pass(box);
    expect(recoverRow(box)!.completed_ms).not.toBeNull();
  }, HEAVY);

  it('in-process: history-off set between two passes holds the step with its cursor; removed, the step replays a family and an operator mapping at their positions, completes and drops its scratch tables', async () => {
    const box = makeHistoryBox('ccrc-history-recover-inproc-');
    const P = historyPaths(box.home);
    const { storeId, writer } = createStore(box.home);
    const U = u(0x71);
    const G = u(0xc1);
    const t0 = Date.now() - 10 * MIN;
    plantJournalFile(box, storeId, new Date(t0).toISOString().slice(0, 7), 'feedbeef', t0, [
      journalRecord('verdict', t0 + 1, { event_key: 'none', kind: 'family', ccrc_id: ID, generation: G, project: 'demo', first_seen_ms: t0 + 1 }),
      journalRecord('verdict', t0 + 2, {
        event_key: 'none', kind: 'mapping', ccrc_id: ID, generation: G, cc_session_uuid: U, declared_by: 'operator',
        path: path.join(box.accountHome['claude-a']!, 'projects', SLUG, `${U}.jsonl`),
      }),
    ]);
    const version = Date.now();
    const db = openWriter(P.dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(version);
      const ctx = stepCtx(box, { storeId, writer });
      fs.writeFileSync(P.off, '');
      expect(await SW.recoveryStep(db, ctx)).toEqual({ moved: false, done: false, held: true });
      expect({ ...db.prepare("SELECT cursor FROM derivation_state WHERE step = 'recover'").get() }).toEqual({ cursor: null });
      fs.rmSync(P.off);
      expect(await SW.recoveryStep(db, ctx)).toEqual({ moved: true, done: true, held: false });
      expect(db.prepare('SELECT ccrc_id, generation, project, first_seen_ms FROM sessions').all().map((r) => ({ ...r })))
        .toEqual([{ ccrc_id: ID, generation: G, project: 'demo', first_seen_ms: t0 + 1 }]);
      expect(db.prepare('SELECT seq, cc_session_uuid, cause, declared_by, confirmed_ms FROM epochs').all().map((r) => ({ ...r })))
        .toEqual([{ seq: 1, cc_session_uuid: U, cause: 'import', declared_by: 'operator', confirmed_ms: t0 + 2 }]);
      expect({ ...db.prepare("SELECT completed_ms IS NOT NULL AS done FROM derivation_state WHERE step = 'recover'").get() }).toEqual({ done: 1 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('recover_verdicts', 'recover_drained')").all()).toEqual([]);
      expect(getMeta(db, HEALTH_META.recoverUnmovedTicks)).toBe('0');
    } finally {
      closeWriter(db);
    }
  });

  it('in-process: two writers\' overlapping files of one month replay as ONE time-merged group (each file\'s order kept, a tie to the earlier file), and the ordinal cursor resumes that group across passes', async () => {
    const box = makeHistoryBox('ccrc-history-recover-merge-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const t0 = Date.now() - 10 * MIN;
    const M = new Date(t0).toISOString().slice(0, 7);
    const [GA, GB, UA, UB] = [u(0xf1), u(0xf2), u(0xf3), u(0xf4)];
    const family = (id: string, g: string, project: string, firstSeen: number, t: number): string =>
      journalRecord('verdict', t, { event_key: 'none', kind: 'family', ccrc_id: id, generation: g, project, first_seen_ms: firstSeen });
    const mapping = (id: string, g: string, uuid: string, t: number): string =>
      journalRecord('verdict', t, { event_key: 'none', kind: 'mapping', ccrc_id: id, generation: g, cc_session_uuid: uuid, declared_by: 'operator' });
    // A (head t0, last record t0 + 30) and B (head t0 + 1) overlap, so lib's orderJournalFiles makes them ONE group,
    // A first. The first record to name a family makes its row (ensureFamily never rewrites one), so the order shows:
    //   - ID: A's family and B's mapping share t0 + 10. The tie goes to A: project demo, first seen t0 + 5. B first
    //     (a pick by <=) would make the row from the mapping: project '', first seen t0 + 10.
    //   - ID2: B's family (t0 + 20) comes before A's mapping (t0 + 30) by time. A's records first (the group
    //     concatenated, not merged) would make the row from the mapping: project '', first seen t0 + 30.
    // The order is the one Task 7's planReplay gives over the same two files (O56).
    plantJournalFile(box, ids.storeId, M, 'aaaaaaaa', t0, [family(ID, GA, 'demo', t0 + 5, t0 + 10), mapping(ID2, GB, UB, t0 + 30)]);
    plantJournalFile(box, ids.storeId, M, 'bbbbbbbb', t0 + 1, [mapping(ID, GA, UA, t0 + 10), family(ID2, GB, 'demo2', t0 + 20, t0 + 20)]);
    const db = openWriter(P.dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
      // Every record is longer than chunkBytes, so each chunk is one record, and each call (a fresh budget, and a
      // fresh run with an empty merge cache, as a new pass has) takes two or three: the six-record group spans
      // calls in both journal phases.
      const cursors: string[] = [];
      let r = { moved: false, done: false, held: false };
      for (let i = 0; i < 20 && !r.done; i += 1) {
        r = await SW.recoveryStep(db, stepCtx(box, ids, { maxBytes: 300, chunkBytes: 100 }));
        cursors.push(String(cursorOn(db)));
      }
      expect(r.done, cursors.join(' | ')).toBe(true);
      const mid = new RegExp(`^apply:${M}\\.aaaaaaaa\\.jsonl:[1-5]/2$`);
      expect(cursors.some((c) => mid.test(c)), `an apply call stopped inside the group, at an ordinal: ${cursors.join(' | ')}`).toBe(true);
      expect(db.prepare('SELECT ccrc_id, generation, project, first_seen_ms FROM sessions ORDER BY ccrc_id').all().map((x) => ({ ...x })))
        .toEqual([
          { ccrc_id: ID, generation: GA, project: 'demo', first_seen_ms: t0 + 5 },
          { ccrc_id: ID2, generation: GB, project: 'demo2', first_seen_ms: t0 + 20 },
        ]);
      // UA sorts before UB (u() pads the number).
      expect(db.prepare('SELECT cc_session_uuid, cause FROM epochs ORDER BY cc_session_uuid').all().map((x) => ({ ...x })))
        .toEqual([{ cc_session_uuid: UA, cause: 'import' }, { cc_session_uuid: UB, cause: 'import' }]);
    } finally {
      closeWriter(db);
    }
  });

  it('in-process: a file whose head names another store is dropped and counted once; a file with no head is kept, as planReplay keeps it; an undrained spool record counts journal_spool_undrained_gone only when its file is gone from .draining/, .draining/rejected/ and every .draining/planted/<area>/', async () => {
    const box = makeHistoryBox('ccrc-history-recover-files-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const ID3 = 'claude-c-demo';
    const t0 = Date.now() - 10 * MIN;
    const M = new Date(t0).toISOString().slice(0, 7);
    const [GA, GB, GC, S] = [u(0xe1), u(0xe2), u(0xe3), u(0xe9)];
    const family = (id: string, g: string, t: number): string =>
      journalRecord('verdict', t, { event_key: 'none', kind: 'family', ccrc_id: id, generation: g, project: 'demo', first_seen_ms: t });
    // Four journaled spool files with no `drained` record: GONE has left .draining/, HELD is still there (the live
    // drain decides it after the step), and B1 set REJECTED aside into .draining/rejected/ (the store refused its rows,
    // D-4346) and DISPLACED into .draining/planted/<area>/ (a directory stood at its
    // sidecar name, D-4347). Only GONE is gone.
    const GONE = `${ID}.${t0 + 5}.4242.jsonl`;
    const HELD = `${ID}.${t0 + 6}.4242.jsonl`;
    const REJECTED = `${ID}.${t0 + 7}.4242.jsonl`;
    const DISPLACED = `${ID}.${t0 + 8}.4242.jsonl`;
    const stop = (t: number): Record<string, unknown> => ({ v: 1, ev: 'Stop', id: ID, sid: S, ts: t });
    plantJournalFile(box, ids.storeId, M, 'feedbeef', t0, [
      family(ID, GA, t0 + 1),
      journalRecord('file', t0 + 5, { name: GONE }), journalRecord('spool', t0 + 5, { ord: 1, rec: stop(t0 + 5) }),
      journalRecord('file', t0 + 6, { name: HELD }), journalRecord('spool', t0 + 6, { ord: 1, rec: stop(t0 + 6) }),
      journalRecord('file', t0 + 7, { name: REJECTED }), journalRecord('spool', t0 + 7, { ord: 1, rec: stop(t0 + 7) }),
      journalRecord('file', t0 + 8, { name: DISPLACED }), journalRecord('spool', t0 + 8, { ord: 1, rec: stop(t0 + 8) }),
    ]);
    // In this store's directory, a head naming ANOTHER store: never replayed.
    plantJournalFile(box, ids.storeId, M, '77777777', t0 + 2, [family(ID2, GB, t0 + 3)], u(0x77));
    // A file whose first line is no head at all: kept, and sorted last in its month (lib orderJournalFiles).
    fs.writeFileSync(path.join(box.root, 'journal', ids.storeId, `${M}.cccccccc.jsonl`), `${family(ID3, GC, t0 + 4)}\n`, { mode: 0o600 });
    fs.mkdirSync(P.draining, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(P.draining, HELD), `\n${JSON.stringify(stop(t0 + 6))}\n`, { mode: 0o600 });
    fs.mkdirSync(path.join(P.draining, 'rejected'), { mode: 0o700 });
    fs.writeFileSync(path.join(P.draining, 'rejected', REJECTED), `\n${JSON.stringify(stop(t0 + 7))}\n`, { mode: 0o600 });
    // An empty area first, as a drain killed before its end-of-drain cleanup leaves one (B1 removes an area it left empty
    // at the end of every drain): undrainedFileKept must look past it.
    fs.mkdirSync(path.join(P.draining, 'planted', `${t0 + 1}.4241`), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(P.draining, 'planted', `${t0 + 2}.4242`), { mode: 0o700 });
    fs.writeFileSync(path.join(P.draining, 'planted', `${t0 + 2}.4242`, DISPLACED), `\n${JSON.stringify(stop(t0 + 8))}\n`, { mode: 0o600 });
    const db = openWriter(P.dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: true, done: true, held: false });
      expect(db.prepare('SELECT ccrc_id FROM sessions ORDER BY ccrc_id').all().map((x) => x['ccrc_id']),
        'the foreign head\'s family is not replayed; the head-less file\'s is').toEqual([ID, ID3]);
      expect(countersOn(db, 'journal_head_mismatch', 'journal_spool_undrained_gone', 'journal_line_malformed'))
        .toEqual({ journal_head_mismatch: 1, journal_spool_undrained_gone: 1, journal_line_malformed: 0 });
      expect({ ...db.prepare('SELECT count(*) AS n FROM spool_receipts').get() }, 'an undrained spool record is never a receipt').toEqual({ n: 0 });
    } finally {
      closeWriter(db);
    }
  });

  it('in-process: a stored cursor that does not parse fails the chunk instead of restarting the step; an executor that neither moves nor finishes ends the step for the pass after ONE call', async () => {
    const box = makeHistoryBox('ccrc-history-recover-stuck-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const db = openWriter(P.dbFile);
    try {
      // Month 13 is outside lib's cursor grammar: never a guess at where to resume.
      const bad = 'apply:2026-13.aaaaaaaa.jsonl:7';
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, ?, NULL)").run(Date.now(), bad);
      expect(await SW.recoveryStep(db, stepCtx(box, ids))).toEqual({ moved: false, done: false, held: false });
      expect(cursorOn(db), 'the cursor is kept as it was').toBe(bad);
      expect(countersOn(db, 'recover_chunk_failed')).toEqual({ recover_chunk_failed: 1 });

      db.prepare("UPDATE derivation_state SET cursor = NULL WHERE step = 'recover'").run();
      let calls = 0;
      const stuck = (_db: unknown, _run: unknown, cursor: unknown): { cursor: unknown; moved: boolean; phaseDone: boolean } => {
        calls += 1;
        return { cursor, moved: false, phaseDone: false };
      };
      // A 5 s budget bounds the red: without the rule the stuck executor is called again until the budget is spent.
      const r = await SW.recoveryStep(db, stepCtx(box, ids, { maxMs: 5_000 }), { index: stuck, apply: stuck, reindex: stuck });
      expect(r).toEqual({ moved: false, done: false, held: false });
      expect(calls, 'one call, then the step ends for this pass').toBe(1);
      expect(cursorOn(db)).toBeNull();
    } finally {
      closeWriter(db);
    }
  });

  it('in-process: the executors see the pass\'s substring belt as run.ectx.belt, and recoverPass keeps its secrets step\'s belt on ctx (§8.3 layer 4)', async () => {
    const box = makeHistoryBox('ccrc-history-recover-belt-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const sec = path.join(box.home, '.cc-secrets');
    fs.mkdirSync(sec, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(sec, 'rb.env'), `ZQ_RB=QPrecoverbelt${'4kT9'.repeat(5)}7\n`, { mode: 0o600 });
    const db = openWriter(P.dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
      const seen: unknown[] = [];
      const capture = (_db: unknown, run: { ectx: { belt?: unknown } }, cursor: unknown): { cursor: unknown; moved: boolean; phaseDone: boolean } => {
        seen.push(run.ectx.belt);
        return { cursor, moved: false, phaseDone: false };
      };
      const BELT = Object.freeze({ sentinel: 'this pass\'s belt' });
      expect(await SW.recoveryStep(db, { ...stepCtx(box, ids), belt: BELT }, { index: capture, apply: capture, reindex: capture }))
        .toEqual({ moved: false, done: false, held: false });
      expect(seen.length, 'CONTROL: the executor ran once').toBe(1);
      expect(seen[0], 'recoveryStep hands ctx.belt to its executors as run.ectx.belt').toBe(BELT);
      // The recover arm's own pass: its secrets step loaded rb.env, so the pass's belt holds a unit, and the default
      // executors run (the step completes over an empty journal).
      const ctx: Record<string, unknown> = { ...stepCtx(box, ids), pause: null };
      expect(await SW.recoverPass(db, ctx, 0)).toBe(0);
      expect((ctx['belt'] as { texts?: readonly string[] } | null | undefined)?.texts?.length ?? 0, 'recoverPass keeps its secrets step\'s belt, which holds rb.env\'s unit, on ctx for the executors').toBeGreaterThan(0);
    } finally {
      closeWriter(db);
    }
  });

  it('in-process: recoverPass registers the node merge step, so a value held only by a node leaves no index byte once the next tick merges (D-4609, H-158)', async () => {
    const box = makeHistoryBox('ccrc-history-recover-nodemerge-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const V = `QPhg1nodemerge${randomBytes(12).toString('hex')}7`;
    const sec = path.join(box.home, '.cc-secrets');
    fs.mkdirSync(sec, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(sec, 'x.env'), `ZQ_NM=${V}\n`, { mode: 0o600 });
    const db = openWriter(P.dbFile);
    try {
      db.exec('BEGIN');
      createFtsTables(db);
      db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, '', 'demo', 1)").run(ID);
      db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(RR_U1);
      db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(RR_U1);
      db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (2, ?, 'br5', NULL, 1)").run(Buffer.alloc(32, 8));
      const gist = `Rotated the credential ${V} today.`;
      db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics, summary_blob_id,
        earliest_ms, latest_ms, src_chars, desc_count, desc_chars, parser_version, created_ms)
        VALUES ('nm-leaf', 1, 1, 1, 'native_leaf', 0, 'not-requested', ?, '[]', 2, 1, 2, 0, 0, 0, 1, 1)`).run(gist);
      const t = nodeIndexTexts({ gist, topics: [], refs: [] }, makePairIndex([]));
      db.prepare("INSERT INTO nodes_fts (rowid, gist, topics, refs) SELECT rowid, ?, ?, ? FROM nodes WHERE node_id = 'nm-leaf'").run(t.gist, t.topics, t.refs);
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
      db.exec('COMMIT');
      expect(await SW.recoverPass(db, { ...stepCtx(box, ids), pause: null }, 0)).toBe(0);
      expect((db.prepare("SELECT gist FROM nodes WHERE node_id = 'nm-leaf'").get() as { gist: string }).gist.includes(V), 'CONTROL: the pass rewrote the leaf\'s gist').toBe(false);
      expect((db.prepare("SELECT count(*) AS n FROM derivation_state WHERE step = 'fts-merge' AND version = 1 AND completed_ms IS NULL").get() as { n: number }).n,
        'the rewrite registered the merge step pending, for the next tick to run').toBe(1);
    } finally {
      closeWriter(db);
    }
  }, HEAVY);

  it('in-process: journalRedactPairs reads every redact record the index phase would read, and names each journal file it skips, a foreign head or one it cannot open (spec §8.4 and §9.14)', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    const box = makeHistoryBox('ccrc-history-recover-jpairs-');
    const P = historyPaths(box.home);
    const { storeId } = createStore(box.home);
    const t0 = Date.now() - 10 * MIN;
    const M = new Date(t0).toISOString().slice(0, 7);
    const sha = (n: number): string => n.toString(16).padStart(64, '0');
    plantJournalFile(box, storeId, M, 'feedbee1', t0, [
      journalRecord('redact', t0 + 1, { len: 32, sha256: sha(1) }),
      journalRecord('verdict', t0 + 2, { event_key: 'none', kind: 'family', ccrc_id: ID, generation: u(0xd1), project: 'demo', first_seen_ms: t0 + 2 }),
      'this line is broken on purpose',
      journalRecord('redact', t0 + 3, { len: 40, sha256: sha(2) }),
    ]);
    plantJournalFile(box, storeId, M, 'feedbee2', t0 + 5, [journalRecord('redact', t0 + 6, { len: 33, sha256: sha(3) })], u(0xd2));
    plantJournalFile(box, storeId, M, 'feedbee3', t0 + 7, [journalRecord('redact', t0 + 8, { len: 34, sha256: sha(4) })]);
    const locked = path.join(box.root, 'journal', storeId, `${M}.feedbee3.jsonl`);
    fs.chmodSync(locked, 0o000);
    try {
      const got = SW.journalRedactPairs(P, storeId);
      expect(got.pairs, 'both of this store\'s pairs, in journal order; the foreign head\'s pair is never read')
        .toEqual([{ len: 32, sha256: sha(1), t: t0 + 1 }, { len: 40, sha256: sha(2), t: t0 + 3 }]);
      expect(got.foreign, 'a foreign head is named, never skipped silently, and apart from what could not be read (H-103)').toEqual([`${M}.feedbee2.jsonl`]);
      expect(got.unreadable, 'a file journalListing lists as unreadable is named in its own list').toEqual([`${M}.feedbee3.jsonl`]);
    } finally { fs.chmodSync(locked, 0o600); }
    expect(SW.journalRedactPairs(P, storeId).pairs.length, 'readable again: its pair is read too').toBe(3);
  });

  it('mergeJournalByTime: two writers\' items merge by t, each file\'s own order kept, a tie to the earlier file; one file, and none, pass through (R-T25-1; planReplay and the executor share it)', () => {
    const item = (tag: string, t: number): { tag: string; t: number } => ({ tag, t });
    const tags = (xs: Array<{ tag: string }>): string[] => xs.map((x) => x.tag);
    // A's third item is older than its second: a file's own order is kept, never re-sorted.
    const A = [item('a1', 1), item('a2', 5), item('a3', 4)];
    const B = [item('b1', 5), item('b2', 2)];
    // a1 (1) first; a2 and b1 tie at 5, the earlier file (A) takes it; then a3 (4) against b1 (5); b2 follows b1.
    expect(tags(mergeJournalByTime([A, B]))).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    // The same files the other way round: a1 (1) first, then the tie at 5 goes to B (now the earlier file), whose b2 (2) follows.
    expect(tags(mergeJournalByTime([B, A])), 'the file order given is the tie order').toEqual(['a1', 'b1', 'b2', 'a2', 'a3']);
    expect(tags(mergeJournalByTime([A])), 'one file passes through').toEqual(['a1', 'a2', 'a3']);
    expect(mergeJournalByTime([]), 'no file, no item').toEqual([]);
    expect(tags(mergeJournalByTime([[], A])), 'an empty file takes no turn').toEqual(['a1', 'a2', 'a3']);
  });

  it('in-process: D-4592 (a), a journal month file the step cannot read fails the index chunk (recover_chunk_failed, cursor unmoved, step open) and is never counted journal_head_mismatch; readable again, the next call replays it', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    // In-process, because a real pass runs fixModes, which chmods a journal file back to 0600 before the step reads it.
    const box = makeHistoryBox('ccrc-history-recover-unreadable-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const t0 = Date.now() - 10 * MIN;
    const M = new Date(t0).toISOString().slice(0, 7);
    const [GA, GB] = [u(0xd5), u(0xd6)];
    const family = (id: string, g: string, t: number): string =>
      journalRecord('verdict', t, { event_key: 'none', kind: 'family', ccrc_id: id, generation: g, project: 'demo', first_seen_ms: t });
    plantJournalFile(box, ids.storeId, M, 'feedbea1', t0, [family(ID, GA, t0 + 1)]);
    plantJournalFile(box, ids.storeId, M, 'feedbea2', t0 + 5, [family(ID2, GB, t0 + 6)]);
    const locked = path.join(box.root, 'journal', ids.storeId, `${M}.feedbea1.jsonl`);
    const db = openWriter(P.dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
      fs.chmodSync(locked, 0o000);
      try {
        // Two calls: the unreadable file fails the chunk every time, so the step is never completed past it.
        for (let i = 0; i < 2; i += 1) {
          expect(await SW.recoveryStep(db, stepCtx(box, ids)), `call ${i + 1}`).toEqual({ moved: false, done: false, held: false });
        }
        const c = countersOn(db, 'recover_chunk_failed', 'journal_head_mismatch');
        expect(c['recover_chunk_failed'], 'each call counts the failed chunk').toBeGreaterThanOrEqual(1);
        expect(c['journal_head_mismatch'], 'an unreadable file is not another store\'s file').toBe(0);
        const cur = cursorOn(db);
        expect(cur === null || cur.startsWith('index'), `the cursor stays in the index phase: ${String(cur)}`).toBe(true);
        expect({ ...db.prepare("SELECT completed_ms IS NULL AS open FROM derivation_state WHERE step = 'recover'").get() }).toEqual({ open: 1 });
        expect(db.prepare('SELECT ccrc_id FROM sessions').all(), 'the readable file is not replayed past the unreadable one either').toEqual([]);
      } finally {
        fs.chmodSync(locked, 0o600);
      }
      let r = { moved: false, done: false, held: false };
      for (let i = 0; i < 5 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids));
      expect(r.done).toBe(true);
      expect(db.prepare('SELECT ccrc_id FROM sessions ORDER BY ccrc_id').all().map((x) => x['ccrc_id']),
        'the file that was unreadable is replayed once it reads').toEqual([ID, ID2]);
      expect(countersOn(db, 'journal_head_mismatch')).toEqual({ journal_head_mismatch: 0 });
    } finally {
      closeWriter(db);
      try { fs.chmodSync(locked, 0o600); } catch { /* removed with the fixture */ }
    }
  });

  it('in-process: H-93 (D-4607), a group that grows from one file to two under the same leader between two calls restarts at its start: the cursor\'s byte offset is never read as an ordinal', async () => {
    const box = makeHistoryBox('ccrc-history-recover-regroup-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const t0 = Date.now() - 10 * MIN;
    const M = new Date(t0).toISOString().slice(0, 7);
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const family = (id: string, g: string, t: number): string =>
      journalRecord('verdict', t, { event_key: 'none', kind: 'family', ccrc_id: id, generation: g, project: 'demo', first_seen_ms: t });
    // A alone is a group of one, read by byte offset: eight family records (one session row each), the last at t0 + 50.
    const A = letters.map((l, i) => family(`claude-${l}-demo`, u(0x93a0 + i), t0 + (i === letters.length - 1 ? 50 : i + 1)));
    plantJournalFile(box, ids.storeId, M, 'aaaaaaaa', t0, A);
    const db = openWriter(P.dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
      // Each record is longer than chunkBytes, so a chunk is one record and a call takes two or three: the cursor stops
      // inside A with a byte offset far past A's ten lines.
      let offset = 0;
      for (let i = 0; i < 20 && offset <= 40; i += 1) {
        await SW.recoveryStep(db, stepCtx(box, ids, { maxBytes: 300, chunkBytes: 100 }));
        const m = /^apply:[^:]+:([0-9]+)/.exec(String(cursorOn(db)));
        offset = m === null ? 0 : Number(m[1]);
      }
      expect(offset, `the apply cursor stopped inside A at a byte offset past its line count: ${String(cursorOn(db))}`).toBeGreaterThan(40);
      expect(db.prepare('SELECT count(*) AS n FROM sessions').get()!['n'], 'A is only part-applied').toBeLessThan(letters.length);
      // A second writer's file of the same month overlaps A's range (a store run on two boxes at once, spec 6.9): the
      // listing now leads ONE group of two with A, and the cursor's number would be read as an ordinal into it.
      plantJournalFile(box, ids.storeId, M, 'bbbbbbbb', t0 + 2, [family('claude-z-demo', u(0x93b0), t0 + 3)]);
      let r = { moved: false, done: false, held: false };
      for (let i = 0; i < 40 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids, { maxBytes: 300, chunkBytes: 100 }));
      expect(r.done).toBe(true);
      expect(db.prepare('SELECT ccrc_id FROM sessions ORDER BY ccrc_id').all().map((x) => x['ccrc_id']),
        'every record of A was applied, and B\'s').toEqual([...letters.map((l) => `claude-${l}-demo`), 'claude-z-demo']);
    } finally {
      closeWriter(db);
    }
  });

  it('in-process: H-96, a file whose first line is blank and whose first non-empty line is a foreign head is dropped and counted once, as planReplay drops it: no record after the head is replayed', async () => {
    const box = makeHistoryBox('ccrc-history-recover-blank-head-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const t0 = Date.now() - 10 * MIN;
    const M = new Date(t0).toISOString().slice(0, 7);
    const name = `${ID}.${t0 + 5}.4242.jsonl`;
    const lines = [
      journalRecord('head', t0, { store_id: u(0xd2), month: M, writer: 'feedbea7' }),
      journalRecord('file', t0 + 5, { name }),
      journalRecord('spool', t0 + 5, { ord: 1, rec: { v: 1, ev: 'Stop', id: ID, sid: u(0xd3), ts: t0 + 5 } }),
      journalRecord('verdict', t0 + 6, { event_key: 'none', kind: 'drained', file: name }),
    ];
    const dir = path.join(box.root, 'journal', ids.storeId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // A blank fence first (what a torn tail's next append leaves), then the head: planReplay skips empty lines and reads this head.
    fs.writeFileSync(path.join(dir, `${M}.feedbea7.jsonl`), `\n${lines.join('\n')}\n`, { mode: 0o600 });
    const planned = planReplay({ storeId: ids.storeId, files: [{ name: `${M}.feedbea7.jsonl`, month: M, writer: 'feedbea7', lines: ['', ...lines] }], ticksAfter: 0 });
    expect(planned.map((a) => a.do), 'planReplay drops the file whole').toEqual(['skip']);
    const db = openWriter(P.dbFile);
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
      let r = { moved: false, done: false, held: false };
      for (let i = 0; i < 5 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids));
      expect(r.done).toBe(true);
      expect(countersOn(db, 'journal_head_mismatch', 'journal_spool_undrained_gone'), 'the executor counts the file once, as planReplay does').toEqual({ journal_head_mismatch: 1, journal_spool_undrained_gone: 0 });
      expect({ ...db.prepare('SELECT count(*) AS n FROM spool_receipts').get() }, 'and inserts no receipt').toEqual({ n: 0 });
    } finally {
      closeWriter(db);
    }
  });

  it('in-process: H-92, a month name that is a socket, a link to a this-store file or a directory is foreign (counted journal_head_mismatch once, never replayed, never a failed chunk), like any name that is no regular file', async () => {
    // The listed name's kind decides, not the open's errno: a socket fails open with ENXIO, a link with ELOOP (O_NOFOLLOW),
    // and a directory opens and meets the regular-file check. None is journal data an unreadable file might hold, so none
    // wedges the step.
    for (const kind of ['socket', 'link', 'directory'] as const) {
      const box = makeHistoryBox(`ccrc-history-recover-nonregular-${kind}-`);
      const P = historyPaths(box.home);
      const ids = createStore(box.home);
      const t0 = Date.now() - 10 * MIN;
      const M = new Date(t0).toISOString().slice(0, 7);
      const [GA, GB] = [u(0xd7), u(0xd8)];
      const family = (id: string, g: string, t: number): string =>
        journalRecord('verdict', t, { event_key: 'none', kind: 'family', ccrc_id: id, generation: g, project: 'demo', first_seen_ms: t });
      plantJournalFile(box, ids.storeId, M, 'feedbea5', t0, [family(ID, GA, t0 + 1)]);
      const dir = path.join(box.root, 'journal', ids.storeId);
      const name = `${M}.abcdef01.jsonl`;
      if (kind === 'socket') {
        // A relative name from the directory itself: an absolute fixture path can pass sun_path's 108 bytes.
        const made = spawnSync('python3', ['-I', '-c', 'import socket, sys\ns = socket.socket(socket.AF_UNIX)\ns.bind(sys.argv[1])', name], { cwd: dir, encoding: 'utf8' });
        expect(made.status, `${made.stdout}${made.stderr}`).toBe(0);
        expect(fs.lstatSync(path.join(dir, name)).isSocket()).toBe(true);
      } else if (kind === 'link') {
        // The target is a this-store file the listing does not name (no month-file grammar), holding a family only replay would write.
        const target = path.join(dir, 'target-not-a-month-file.jsonl');
        const head = journalRecord('head', t0 + 2, { store_id: ids.storeId, month: M, writer: 'abcdef01' });
        fs.writeFileSync(target, `${[head, family(ID2, GB, t0 + 3)].join('\n')}\n`, { mode: 0o600 });
        fs.symlinkSync(target, path.join(dir, name));
      } else {
        fs.mkdirSync(path.join(dir, name), { mode: 0o700 });
      }
      const db = openWriter(P.dbFile);
      try {
        db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
        let r = { moved: false, done: false, held: false };
        for (let i = 0; i < 5 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids));
        expect(r.done, `${kind}: the step completed`).toBe(true);
        expect(countersOn(db, 'journal_head_mismatch', 'recover_chunk_failed'), `${kind}: counted foreign once, no chunk failed`)
          .toEqual({ journal_head_mismatch: 1, recover_chunk_failed: 0 });
        expect(db.prepare('SELECT ccrc_id FROM sessions ORDER BY ccrc_id').all().map((x) => x['ccrc_id']), `${kind}: only the real file is replayed`).toEqual([ID]);
      } finally {
        closeWriter(db);
      }
    }
  });

  it('in-process: H-95, a month file that becomes unreadable once the cursor is in the apply phase fails the apply chunk (recover_chunk_failed 1, cursor unmoved, step open), and a journal directory that cannot be listed fails the chunk instead of reading as an empty journal', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file and lists a 0000 directory
    const box = makeHistoryBox('ccrc-history-recover-apply-unreadable-');
    const P = historyPaths(box.home);
    const ids = createStore(box.home);
    const t0 = Date.now() - 10 * MIN;
    const M = new Date(t0).toISOString().slice(0, 7);
    const family = (id: string, g: string, t: number): string =>
      journalRecord('verdict', t, { event_key: 'none', kind: 'family', ccrc_id: id, generation: g, project: 'demo', first_seen_ms: t });
    plantJournalFile(box, ids.storeId, M, 'feedbea6', t0, [family(ID, u(0xd9), t0 + 1)]);
    const dir = path.join(box.root, 'journal', ids.storeId);
    const file = path.join(dir, `${M}.feedbea6.jsonl`);
    const db = openWriter(P.dbFile);
    const open = (): unknown => ({ ...db.prepare("SELECT completed_ms IS NULL AS open FROM derivation_state WHERE step = 'recover'").get() });
    try {
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, 'apply', NULL)").run(Date.now());
      // (1) the apply phase: the file was readable at index (the cursor got here), and is not now.
      fs.chmodSync(file, 0o000);
      try {
        expect(await SW.recoveryStep(db, stepCtx(box, ids)), 'apply, a file unreadable').toEqual({ moved: false, done: false, held: false });
        expect(countersOn(db, 'recover_chunk_failed', 'journal_head_mismatch'), 'apply, a file unreadable').toEqual({ recover_chunk_failed: 1, journal_head_mismatch: 0 });
        expect(cursorOn(db)).toBe('apply');
        expect(open()).toEqual({ open: 1 });
      } finally {
        fs.chmodSync(file, 0o600);
      }
      // (2) the index phase over a directory that cannot be listed: an empty listing would complete the phase unread.
      db.prepare("UPDATE derivation_state SET cursor = NULL WHERE step = 'recover'").run();
      fs.chmodSync(dir, 0o000);
      try {
        expect(await SW.recoveryStep(db, stepCtx(box, ids)), 'index, a directory unlistable').toEqual({ moved: false, done: false, held: false });
        expect(countersOn(db, 'recover_chunk_failed'), 'index, a directory unlistable').toEqual({ recover_chunk_failed: 2 });
        expect(cursorOn(db)).toBeNull();
        expect(open()).toEqual({ open: 1 });
      } finally {
        fs.chmodSync(dir, 0o700);
      }
      let r = { moved: false, done: false, held: false };
      for (let i = 0; i < 5 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids));
      expect(r.done, 'readable again, the step completes').toBe(true);
    } finally {
      closeWriter(db);
      try { fs.chmodSync(dir, 0o700); fs.chmodSync(file, 0o600); } catch { /* removed with the fixture */ }
    }
  });

  it('in-process: D-4592 (b), a spool answer the step cannot measure (an lstat of .draining/ or of rejected/, or the listing of planted/) fails the apply chunk (recover_chunk_failed, cursor unmoved) and is never counted journal_spool_undrained_gone; measured again, the file is gone and counted once', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root measures through a 0000 directory
    // In-process, because a real pass runs fixModes and the journal half around the step; this one holds the mode.
    // Three ways to be unmeasurable, each with the rest of the spool readable where it can be:
    //   - draining: .draining/ at 0000 (the lstat of .draining/<name> fails EACCES);
    //   - rejected: .draining/rejected/ at 0000 (the lstat of rejected/<name> fails EACCES, the other lstat answers ENOENT);
    //   - planted: .draining/planted/ at 0000 (every lstat answers ENOENT, then the listing of planted/ fails).
    for (const locked of ['draining', 'rejected', 'planted'] as const) {
      const box = makeHistoryBox(`ccrc-history-recover-unmeasured-${locked}-`);
      const P = historyPaths(box.home);
      const ids = createStore(box.home);
      const t0 = Date.now() - 10 * MIN;
      const M = new Date(t0).toISOString().slice(0, 7);
      const S = u(0xe8);
      const GONE = `${ID}.${t0 + 5}.4242.jsonl`;
      plantJournalFile(box, ids.storeId, M, 'feedbea3', t0, [
        journalRecord('file', t0 + 5, { name: GONE }),
        journalRecord('spool', t0 + 5, { ord: 1, rec: { v: 1, ev: 'Stop', id: ID, sid: S, ts: t0 + 5 } }),
      ]);
      const area = { rejected: path.join(P.draining, 'rejected'), planted: path.join(P.draining, 'planted') };
      for (const d of Object.values(area)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      const lock = locked === 'draining' ? P.draining : area[locked];
      const db = openWriter(P.dbFile);
      try {
        db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
        fs.chmodSync(lock, 0o000);
        try {
          // The index phase reads the journal alone and moves; the apply chunk meets the spool it cannot measure.
          expect(await SW.recoveryStep(db, stepCtx(box, ids)), locked).toEqual({ moved: true, done: false, held: false });
          expect(await SW.recoveryStep(db, stepCtx(box, ids)), `${locked}: a second call meets the same spool`).toEqual({ moved: false, done: false, held: false });
          const c = countersOn(db, 'recover_chunk_failed', 'journal_spool_undrained_gone');
          expect(c['recover_chunk_failed'], `${locked}: the apply chunk failed`).toBeGreaterThanOrEqual(1);
          expect(c['journal_spool_undrained_gone'], `${locked}: an unmeasured spool is never a gone file`).toBe(0);
          expect(cursorOn(db), `${locked}: the cursor stays at the start of the apply phase`).toBe('apply');
        } finally {
          fs.chmodSync(lock, 0o700);
        }
        let r = { moved: false, done: false, held: false };
        for (let i = 0; i < 5 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids));
        expect(r.done, locked).toBe(true);
        expect(countersOn(db, 'journal_spool_undrained_gone'), `${locked}: measured, the file is gone`).toEqual({ journal_spool_undrained_gone: 1 });
      } finally {
        closeWriter(db);
        try { fs.chmodSync(lock, 0o700); } catch { /* removed with the fixture */ }
      }
    }
  });

  it('H-91, D-4592 refined: a stray regular file at .draining/, .draining/rejected, .draining/planted or .draining/planted/<area> is a measured absence (nothing can stand under a non-directory), so the apply chunk does not fail and the gone file is counted once', async () => {
    // ENOTDIR is not EACCES: D-4592 (b) fails the chunk on a spool it cannot measure, but no entry can exist under a file,
    // so the answer "not there" is measured. Failing on it would wedge the step for good, since the drain and tidyDraining
    // that cure a planted non-directory never run while the step is open.
    for (const stray of ['draining', 'rejected', 'planted', 'area'] as const) {
      const box = makeHistoryBox(`ccrc-history-recover-stray-${stray}-`);
      const P = historyPaths(box.home);
      const ids = createStore(box.home);
      const t0 = Date.now() - 10 * MIN;
      const M = new Date(t0).toISOString().slice(0, 7);
      const GONE = `${ID}.${t0 + 5}.4242.jsonl`;
      plantJournalFile(box, ids.storeId, M, 'feedbea4', t0, [
        journalRecord('file', t0 + 5, { name: GONE }),
        journalRecord('spool', t0 + 5, { ord: 1, rec: { v: 1, ev: 'Stop', id: ID, sid: u(0xe7), ts: t0 + 5 } }),
      ]);
      if (stray === 'draining') {
        fs.mkdirSync(path.dirname(P.draining), { recursive: true, mode: 0o700 });
        fs.writeFileSync(P.draining, 'a stray file', { mode: 0o600 });
      } else {
        fs.mkdirSync(P.draining, { recursive: true, mode: 0o700 });
        const at = stray === 'rejected' ? path.join(P.draining, 'rejected') : path.join(P.draining, 'planted');
        if (stray === 'area') {
          fs.mkdirSync(at, { mode: 0o700 });
          fs.writeFileSync(path.join(at, `${t0 + 1}.4241`), 'a stray file', { mode: 0o600 });
        } else {
          fs.writeFileSync(at, 'a stray file', { mode: 0o600 });
        }
      }
      const db = openWriter(P.dbFile);
      try {
        db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
        let r = { moved: false, done: false, held: false };
        for (let i = 0; i < 5 && !r.done; i += 1) r = await SW.recoveryStep(db, stepCtx(box, ids));
        expect(r.done, `${stray}: the step completed`).toBe(true);
        expect(countersOn(db, 'recover_chunk_failed', 'journal_spool_undrained_gone'), `${stray}: no chunk failed, the file is gone once`)
          .toEqual({ recover_chunk_failed: 0, journal_spool_undrained_gone: 1 });
      } finally {
        closeWriter(db);
      }
    }
  });

  it('a chunk that throws rolls back with its cursor, counts recover_chunk_failed and recover_unmoved_ticks, and status FAILs recovery-stalled at RECOVERY_STALL_TICKS', () => {
    const box = makeHistoryBox('ccrc-history-recover-stall-');
    pass(box);
    registerRecovery(box, Date.now());
    const seam = { HISTORY_TEST_THROW_SQL: "SET cursor = ? WHERE step = 'recover'" };
    pass(box, seam, [PRELOADS.faults]);
    pass(box, seam, [PRELOADS.faults]);
    expect(counters(box)['recover_chunk_failed']).toBe(2);
    expect(recoverRow(box)).toMatchObject({ cursor: null, completed_ms: null });
    expect(metaOf(box, HEALTH_META.recoverUnmovedTicks)).toBe('2');
    expect(status(box).health.fail.map((f) => f.word)).not.toContain('recovery-stalled');
    // The count as RECOVERY_STALL_TICKS - 3 more stalled passes would leave it; the next one reaches the threshold.
    const db = openWriter(historyPaths(box.home).dbFile);
    try { setMeta(db, HEALTH_META.recoverUnmovedTicks, String(RECOVERY_STALL_TICKS - 1)); } finally { closeWriter(db); }
    pass(box, seam, [PRELOADS.faults]);
    expect(metaOf(box, HEALTH_META.recoverUnmovedTicks)).toBe(String(RECOVERY_STALL_TICKS));
    expect(status(box).health.fail.map((f) => f.word)).toContain('recovery-stalled');
    pass(box);   // the seam lifted: the step completes
    expect(recoverRow(box)!.completed_ms).not.toBeNull();
    expect(metaOf(box, HEALTH_META.recoverUnmovedTicks)).toBe('0');
  }, HEAVY);
});

describe('RB6: while a recovery step is registered, every writing --op form but restore and rebuild is refused (W1-B2 Task 25)', () => {
  // D-4698 (history-ops-refused-while-recovering): Task 6's decideOpGate row, measured by Task 19 in both halves (the
  // sweep's is authoritative). The store is bound and at the code's version, so neither conditional exemption
  // applies: migrate is refused as RB13 rules (its exempt arm is Task 19's), and adopt's two RB14 arms are Task 26's
  // C55 cases. restore and rebuild are never refused (Tasks 27, 28).
  it('each form this tree runs answers exit 2 recovering at both doors and writes nothing; the dry runs answer 0; tree and grep read lag=unmeasured; once the step completes a writing form runs again', async () => {
    const box = makeHistoryBox('ccrc-history-recover-ops-');
    const { transcript } = seedFamily(box, {
      id: ID, project: 'demo', uuid: u(0x31), generation: u(0xa3), workdir: WORK,
      rows: [userRow({ uuid: u(0x3001), ts: new Date(Date.now() - 5 * MIN).toISOString(), text: 'zqrecover words' })],
    });
    registerRecovery(box, Date.now());
    const forms: ReadonlyArray<{ form: string; cli: string[]; op: string[] }> = [
      { form: 'import-apply', cli: ['import', '--apply'], op: ['--op', 'import', '--apply'] },
      {
        form: 'import-session-apply',
        cli: ['import', '--session', ID, '--file', transcript, '--apply'],
        op: ['--op', 'import', '--session', ID, '--file', transcript, '--apply'],
      },
      { form: 'prune-apply', cli: ['prune', '--older-than', '90d', '--apply'], op: ['--op', 'prune', '--older-than', '90d', '--apply'] },
      { form: 'reparse-apply', cli: ['reparse', '--apply'], op: ['--op', 'reparse', '--apply'] },
      { form: 'repair', cli: ['doctor', '--repair'], op: ['--op', 'repair'] },
      { form: 'backup', cli: ['doctor', '--backup'], op: ['--op', 'backup'] },
      { form: 'migrate', cli: ['doctor', '--migrate'], op: ['--op', 'migrate'] },
    ];
    // CONTROL: every WRITING_FORMS form but the three binding verbs and W2's recall-off pair.
    expect(forms.map((f) => f.form).sort())
      .toEqual(Object.keys(WRITING_FORMS).filter((k) => !WRITING_FORMS[k]!.binding && !k.startsWith('recall-off')).sort());
    // No spool line is pending, so a sweep half that refuses after its lock-take journal half writes nothing either.
    const before = ccrcSnapshot(box);
    for (const f of forms) {
      // Every form runs on a terminal, so no irreversible one stops at needs-tty first: recovering is the bump left.
      const cli = await cliOnPty(box, [...f.cli, '--json']);
      expect(lastEnvelope(cli.out), `${f.form}, the CLI door:\n${cli.out}`).toEqual({ exit: 2, reason: 'recovering' });
      expect(cli.code).toBe(2);
      const direct = await shimOnPty(box, f.op);
      expect(lastRc(direct.out), `${f.form}, the direct door`).toEqual({ rc: 2, reason: 'recovering' });
    }
    for (const dry of [['import'], ['prune', '--older-than', '90d'], ['reparse']]) {
      const c = runCli(box, [...dry, '--json']);
      expect(c.code, `${dry.join(' ')} (a dry run), the CLI door: ${c.stdout}${c.stderr}`).toBe(0);
      expect(lastRc(runShim(box, ['--op', ...dry]).stdout), `${dry.join(' ')} (a dry run), the direct door`).toEqual({ rc: 0 });
    }
    expect(ccrcSnapshot(box), 'a refusal and a dry run write nothing').toEqual(before);
    expect(recoverRow(box)).toMatchObject({ cursor: null, completed_ms: null });
    // The read verbs still answer (a read writes its recall line, so they run after the snapshot).
    const tree = runCli(box, ['tree'], { env: withPane(box, ID) });
    expect(tree.code, `${tree.stdout}${tree.stderr}`).toBe(0);
    expect(tree.stdout.split('\n')[0]).toMatch(/^scope=family\(.* lag=unmeasured$/);
    const grep = runCli(box, ['grep', 'zqrecover'], { env: withPane(box, ID) });
    expect(grep.stdout.split('\n')[0], `${grep.stdout}${grep.stderr}`).toMatch(/^scope=family\(.* lag=unmeasured$/);
    pass(box);   // the step completes
    expect(recoverRow(box)!.completed_ms).not.toBeNull();
    expect(lastRc(runShim(box, ['--op', 'import', '--apply']).stdout), 'the refusal lifts with the step').toEqual({ rc: 0 });
  }, 2.5 * HEAVY);
});

describe('H-36: the RB6 sweep half answers through the release journal half', () => {
  it('a spool line that lands after the lock-take half and before the recovering refusal is journaled before the refusal answers, so a half that skipped the release would leave it pending', async () => {
    const box = makeHistoryBox('ccrc-history-recover-rb6-release-');
    pass(box);                                    // binds the store: store.id and store.writer, so the journal half has ids
    registerRecovery(box, Date.now());
    const t = Date.now() - MIN;
    const spool = path.join(box.root, 'spool', `${ID}.jsonl`);
    // The stub runs after the lock-take half and before RB6's measure (opPass probes the volume between them).
    let planted = 0;
    const statfs = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => {
      if (planted === 0) spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID, sid: u(0x36), ts: t });
      planted += 1;
      return { bsize: 1, bavail: 4 * 2 ** 40, blocks: 8 * 2 ** 40 };
    };
    const out: string[] = [];
    const claudecode = process.env['CLAUDECODE'];
    delete process.env['CLAUDECODE'];             // the gate's in-session refusal would answer before RB6 is reached
    try {
      expect(await SW.runOpPass({ op: 'import', opArgs: ['--apply'] }, { home: box.home, statfs }, (l) => { out.push(l); })).toBe(2);
    } finally {
      if (claudecode !== undefined) process.env['CLAUDECODE'] = claudecode;
    }
    expect(out.at(-1), out.join('\n')).toBe('{"rc":2,"reason":"recovering"}');
    expect(planted, 'the stub ran, so the line was planted between the two halves').toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(spool), 'the planted line left spool/ (the release half moved it)').toBe(false);
    expect(journalRecords(box).filter((r) => r['k'] === 'spool' && (r['rec'] as Record<string, unknown>)['sid'] === u(0x36)),
      'and the journal holds its record').toHaveLength(1);
  }, HEAVY);
});

describe('the recovery step\'s close re-measures the spool counters (W1-B2 Tasks 23, 25; D-4723 (history-counter-resets-after-cure))', () => {
  it('a store-refused file kept in .draining/rejected/ is counted on the recovered store, which never held its count', () => {
    const box = makeHistoryBox('ccrc-history-recover-counters-');
    pass(box);
    const dr = historyPaths(box.home).draining;
    fs.mkdirSync(path.join(dr, 'rejected'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dr, 'rejected', `${ID}.1700000000001.4242.jsonl`), '\n', { mode: 0o600 });
    expect(counters(box)['drain_rejected'], 'CONTROL: this store never counted it').toBeUndefined();
    registerRecovery(box, Date.now());
    pass(box);
    expect(recoverRow(box)!.completed_ms, 'CONTROL: the step completed').not.toBeNull();
    expect(counters(box)['drain_rejected']).toBe(1);
  }, HEAVY);
});

// ── W1-B2 Task 26: doctor --adopt (C55) ──────────────────────────────────────────────────────────────────────
/** A store made unbound as a moved volume or a rebuilt home leaves it (§6.9): created by a pass, then store.id and
 *  store.writer gone. */
function unboundBox(prefix: string): { box: HistoryBox; storeId: string; oldWriter: string } {
  const box = makeHistoryBox(prefix);
  pass(box);
  const P = historyPaths(box.home);
  const storeId = fs.readFileSync(P.storeId, 'utf8').trim();
  const oldWriter = fs.readFileSync(P.writer, 'utf8').trim();
  fs.rmSync(P.storeId);
  fs.rmSync(P.writer);
  return { box, storeId, oldWriter };
}
/** A session and its transcript, for "the next tick ingests" after the adopt. */
const plantWork = (box: HistoryBox, uuid: string, rowUuid: string): void => {
  plantSession(box, ID, { uuid, generation: u(0xd1), project: 'demo', workdir: WORK });
  plantTranscript(box, 'claude-a', SLUG, uuid, [userRow({ uuid: rowUuid, ts: new Date(Date.now() - MIN).toISOString(), text: 'adopted' })]);
};

describe('C55: doctor --adopt (W1-B2 Task 26; spec §8.4)', () => {
  it('DB present, store.id absent → doctor --adopt on a terminal binds it under a new writer, journals the bind before answering 0, and the next tick ingests', async () => {
    const { box, storeId, oldWriter } = unboundBox('ccrc-history-adopt-');
    const P = historyPaths(box.home);
    plantWork(box, u(0x81), u(0x2001));
    const unbound = runSweep(box);
    expect(unbound.code, unbound.stderr).toBe(5);
    expect(unbound.stdout).toContain('history-sweep: store-unbound');
    expect(countOf(box, 'entries'), 'an unbound store captures nothing').toBe(0);

    const r = await cliOnPty(box, ['doctor', '--adopt']);
    expect(r.code, r.out).toBe(0);
    // RB11: adopt prints the carry remedy itself, naming where each directory goes on this box.
    expect(r.out.replace(/\r/g, '')).toContain(
      `copy each to the same path here (~/.ccrc/history/journal/${storeId}/, ~/.ccrc/history/export/${storeId}/)`);
    // H-100 (R-T26-7): the line is the operator's act, said from the start of the sentence, never an instruction to a session.
    expect(r.out.replace(/\r/g, '')).toContain(
      `the operator, from a terminal outside any session: if the box this store left still has ~/.ccrc/history/journal/${storeId}/`);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    const writer = fs.readFileSync(P.writer, 'utf8').trim();
    expect(writer).toMatch(/^[0-9a-f]{8}$/);
    expect(writer, 'a fresh token at every binding').not.toBe(oldWriter);
    expect(metaOf(box, 'writer')).toBe(writer);
    expect(rows(box, "SELECT k, v FROM meta WHERE k LIKE 'bound:%'")).toEqual([{ k: expect.stringMatching(/^bound:[0-9]+$/), v: 'adopt' }]);
    expect(countOf(box, "derivation_state WHERE step = 'recover'"), 'adopt registers no recovery step').toBe(0);
    // §8.4: the bind is in the fsynced journal before the verb answers 0, under the NEW token's file.
    expect(countOf(box, 'journal_outbox')).toBe(0);
    expect(journalRecords(box).filter((x) => x['k'] === 'verdict' && x['kind'] === 'bind'))
      .toEqual([expect.objectContaining({ bind: 'adopt', writer, event_key: 'none' })]);
    expect(fs.readdirSync(journalDirOf(box)).filter((n) => n.endsWith(`.${writer}.jsonl`))).toHaveLength(1);
    expect(fs.existsSync(P.op), 'the op marker goes with the pass').toBe(false);

    // The next tick ingests; a driver clock 31 minutes ahead makes the registry scan due.
    const next = runDriver(box, { offsetMs: 31 * MIN });
    expect(next.code, `${next.stdout}\n${next.stderr}`).toBe(0);
    expect(countOf(box, 'entries')).toBeGreaterThan(0);
  }, HEAVY);

  it('a container rebuilt with its volume (the DB kept on db/\'s volume, the home new) adopts the same way, and the next tick ingests', async () => {
    const vol = mkTmp('ccrc-history-volume-');
    const a = makeHistoryBox('ccrc-history-adopt-old-');
    fs.mkdirSync(a.root, { recursive: true, mode: 0o700 });
    fs.symlinkSync(vol, historyPaths(a.home).dbDir);
    pass(a);
    const storeId = fs.readFileSync(path.join(a.root, 'store.id'), 'utf8').trim();

    const b = makeHistoryBox('ccrc-history-adopt-new-');
    fs.mkdirSync(b.root, { recursive: true, mode: 0o700 });
    fs.symlinkSync(vol, historyPaths(b.home).dbDir);
    plantWork(b, u(0x82), u(0x2101));
    const unbound = runSweep(b);
    expect(unbound.code, unbound.stderr).toBe(5);
    expect(unbound.stdout).toContain('history-sweep: store-unbound');

    const r = await cliOnPty(b, ['doctor', '--adopt']);
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(path.join(b.root, 'store.id'), 'utf8').trim(), 'identity follows the store').toBe(storeId);
    expect(rows(b, "SELECT v FROM meta WHERE k LIKE 'bound:%'")).toEqual([{ v: 'adopt' }]);
    const next = runDriver(b, { offsetMs: 31 * MIN });
    expect(next.code, `${next.stdout}\n${next.stderr}`).toBe(0);
    expect(countOf(b, `entries WHERE uuid = '${u(0x2101)}'`)).toBe(1);
  }, HEAVY);

  it('store.id present and naming another store → exit 2 adopt-refused at both doors, nothing written', async () => {
    const { box } = unboundBox('ccrc-history-adopt-other-');
    const P = historyPaths(box.home);
    fs.writeFileSync(P.storeId, `${u(0x99)}\n`, { mode: 0o600 });
    const before = ccrcSnapshot(box);
    const cli = await cliOnPty(box, ['doctor', '--adopt']);
    expect(cli.code, cli.out).toBe(2);
    expect(cli.out.replace(/\r/g, ''), 'H-102: the CLI door says the reason, not just an exit 2').toContain('adopt-refused');
    const shim = await shimOnPty(box, ['--op', 'adopt']);
    expect(shim.code, shim.out).toBe(2);
    expect(lastRc(shim.out)).toEqual({ rc: 2, reason: 'adopt-refused' });
    expect(ccrcSnapshot(box)).toEqual(before);
  }, HEAVY);

  it('under CLAUDECODE → exit 2 apply-in-session at both doors, nothing written', async () => {
    const { box } = unboundBox('ccrc-history-adopt-session-');
    const before = ccrcSnapshot(box);
    const cli = await cliOnPty(box, ['doctor', '--adopt'], { CLAUDECODE: '1' });
    expect(cli.code, cli.out).toBe(2);
    expect(cli.out.replace(/\r/g, ''), 'H-102: the CLI door says the reason, not just an exit 2').toContain('apply-in-session');
    const shim = await shimOnPty(box, ['--op', 'adopt'], { CLAUDECODE: '1' });
    expect(lastRc(shim.out)).toEqual({ rc: 2, reason: 'apply-in-session' });
    expect(ccrcSnapshot(box)).toEqual(before);
    expect(fs.existsSync(historyPaths(box.home).storeId)).toBe(false);
  }, HEAVY);

  it('a store whose user_version is newer than this build → exit 2 adopt-refused at both doors, before anything is written (G9)', async () => {
    const { box } = unboundBox('ccrc-history-adopt-newer-');
    const P = historyPaths(box.home);
    // As a rollback past a migration leaves it: this build's openStore refuses such a store before its writer's open
    // (schema-newer), and adopt must not write meta, the outbox or the binding files into it either. The refusal is
    // decideBind's (RB17; its pure case is Task 6's): this case pins that adoptArm measures and relays it.
    const db = new DatabaseSync(P.dbFile);
    try { db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`); } finally { db.close(); }
    const before = ccrcSnapshot(box);
    const cli = await cliOnPty(box, ['doctor', '--adopt']);
    expect(cli.code, cli.out).toBe(2);
    expect(cli.out.replace(/\r/g, ''), 'H-102: the CLI door says the reason, not just an exit 2').toContain('adopt-refused');
    const shim = await shimOnPty(box, ['--op', 'adopt']);
    expect(lastRc(shim.out)).toEqual({ rc: 2, reason: 'adopt-refused' });
    // H-99: under --json, or at the direct door, no CLI note names the operator, so the sweep's own line does (the detail itself is lib's).
    expect(shim.out.replace(/\r/g, '')).toContain('adopt it with the build that wrote it; the operator acts on it, from a terminal outside any session');
    expect(ccrcSnapshot(box)).toEqual(before);
    expect(fs.existsSync(P.storeId)).toBe(false);
  }, HEAVY);

  it('H-101: a directory planted at op on an unbound store does not wedge adopt: the marker is cleared before it is written', async () => {
    const { box, storeId } = unboundBox('ccrc-history-adopt-op-dir-');
    const P = historyPaths(box.home);
    fs.mkdirSync(P.op);
    const unbound = runSweep(box);
    expect(unbound.code, unbound.stderr).toBe(5);
    expect(unbound.stdout).toContain('history-sweep: store-unbound');
    const r = await cliOnPty(box, ['doctor', '--adopt']);
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    expect(fs.existsSync(P.op), 'the op marker goes with the pass').toBe(false);
  }, HEAVY);

  it('RB14: a registered recovery step refuses adopt on a bound store at both doors, and lets it bind an unbound one, whose step then runs', async () => {
    // Refused arm: store.id present. The gate answers first, so the word is recovering, never adopt-refused, and
    // nothing is written.
    const bound = makeHistoryBox('ccrc-history-adopt-rec-bound-');
    pass(bound);
    registerRecovery(bound, Date.now());
    const before = ccrcSnapshot(bound);
    const refusedCli = await cliOnPty(bound, ['doctor', '--adopt', '--json']);
    expect(lastEnvelope(refusedCli.out), refusedCli.out).toEqual({ exit: 2, reason: 'recovering' });
    const refusedShim = await shimOnPty(bound, ['--op', 'adopt']);
    expect(lastRc(refusedShim.out)).toEqual({ rc: 2, reason: 'recovering' });
    expect(ccrcSnapshot(bound)).toEqual(before);

    // Exempt arm: store.id absent (a store moved mid-recovery). No pass opens it, so its step cannot run until adopt
    // binds it. The CLI door is the whole proof here: the CLI's pre-check passes it, and the sweep's authoritative
    // half re-measures store.id before bindingPass, so a success means both halves let it through.
    const { box, storeId } = unboundBox('ccrc-history-adopt-recovering-');
    registerRecovery(box, Date.now());
    const held = runSweep(box);
    expect(held.code, held.stderr).toBe(5);
    expect(held.stdout, 'CONTROL: unbound, the step cannot run').toContain('history-sweep: store-unbound');
    const r = await cliOnPty(box, ['doctor', '--adopt']);
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(historyPaths(box.home).storeId, 'utf8').trim()).toBe(storeId);
    expect(countOf(box, "derivation_state WHERE step = 'recover' AND completed_ms IS NULL"), 'adopt leaves the step registered').toBe(1);
    pass(box);   // bound now: the store opens, and the scheduled pass takes its recover arm instead of store-unbound
    const after = recoverRow(box)!; expect(after.cursor !== null || after.completed_ms !== null, 'the step ran once bound').toBe(true);
  }, 1.5 * HEAVY);
});

// ── W1-B2 Tasks 27–29: doctor --restore, doctor --rebuild, and redaction through recovery ──────────────────────
// Spec 2026-10-05 §8.4 ("doctor --restore <file>", "doctor --rebuild [--store-id <uuid>]"), §9.14 (recovery,
// journal replay, redaction first), §6.2 (a pair learned late). Pins: C57 (Task 27); C58, O35, O36's replay
// half, C67 (Task 28); O47 (Task 29). The helpers new to Task 27 are prefixed rr/Rr (the file's own ID, SLUG, WORK,
// countOf, metaOf, recoverRow, ccrcSnapshot, lastRc, shimOnPty and cliOnPty serve them too). The binding verbs are
// irreversible, so their runs go through a REAL terminal (node-pty). The TTY gate has no seam (§10.1). Every spawn
// carries the statfs preload (historyHelpers), and every HOME is a fixture.
type RrRow = Record<string, unknown>;

const RR_G1 = '0189abcd-1234-4678-9abc-0000000000a1';
const RR_U1 = 'a1a1a1a1-0000-4000-8000-000000000001';
/** The migration seam history-op.test.ts uses (B1 Task 25): an additive v2 through the run-pass driver. */
const RR_V2 = 'CREATE TABLE seam_v2 (x INTEGER)';

const rrU = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rrIso = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const rrRoot = (box: HistoryBox): ReturnType<typeof historyPaths> => historyPaths(box.home);
const rrNames = (dir: string): string[] => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };

/** A read of the box's store through a read-only handle, closed after. */
function rrQ<T>(box: HistoryBox, sql: string, ...args: (string | number)[]): T[] {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args) as T[]; } finally { db.close(); }
}
/** Any SQLite file (a backup, the store), read-only. */
function rrFileDb<T>(file: string, f: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return f(db); } finally { db.close(); }
}
const rrDbMeta = (file: string, k: string): string | null =>
  rrFileDb(file, (db) => (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v ?? null);
const rrJournalMode = (file: string): string =>
  rrFileDb(file, (db) => String((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode));
const rrUserVersion = (file: string): number =>
  rrFileDb(file, (db) => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version));

const rrRecovered = (box: HistoryBox): boolean => {
  const r = recoverRow(box);
  return r !== undefined && r.completed_ms !== null;
};
const rrStepDone = (box: HistoryBox, step: string, version: number): boolean =>
  rrQ<{ c: number | null }>(box, 'SELECT completed_ms AS c FROM derivation_state WHERE step = ? AND version = ?', step, version)[0]?.c != null;

/** The env of a run that B1's faults preload SIGKILLs at one fs call (HISTORY_TEST_KILL). */
const rrKill = (spec: string): Record<string, string> => ({
  NODE_OPTIONS: preloadOptions([PRELOADS.statfs, PRELOADS.faults]), HISTORY_TEST_KILL: spec,
});

/** Scheduled passes through the shim until `done()` holds, at most `max`. Every one must exit 0. No pass may answer
 *  store-unbound, which is what a restored or rebuilt store must never become (DI3). */
function rrTickUntil(box: HistoryBox, done: () => boolean, max = 8, opts: SpawnOpts = {}): void {
  for (let i = 0; i < max; i += 1) {
    const r = runShim(box, [], opts);
    expect(r.code, `pass ${i + 1}:\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout, 'a restored or rebuilt store is never refused unbound').not.toMatch(/store-unbound/);
    if (done()) return;
  }
  throw new Error(`rrTickUntil: not done after ${max} passes`);
}

const rrStart = (id: string, sid: string, src: 'startup' | 'resume' | 'clear', extra: RrRow = {}): RrRow =>
  ({ v: 1, ev: 'SessionStart', id, sid, src, ...extra });

/** `n` alternating user and assistant rows of transcript `sid`, uuids rrU(base)… */
function rrTalk(sid: string, base: number, n: number): object[] {
  const rows: object[] = [];
  for (let i = 0; i < n; i += 1) {
    const at = { uuid: rrU(base + i), ts: rrIso(n - i), parentUuid: i === 0 ? null : rrU(base + i - 1), sessionId: sid, cwd: WORK };
    rows.push(i % 2 === 0 ? userRow({ ...at, text: `zqrecover ask ${i}` }) : assistantRow({ ...at, text: `zqrecover answer ${i}` }));
  }
  return rows;
}

/** A transcript with one manual compaction (§7.4). It has a user and an assistant row, then the boundary, then the
 *  summary right after it (the manual +1 position, which the boundary's anchor names), then one more row. The
 *  first row and the summary's Current Work section both carry `work`. Row uuids are rrU(base)…rrU(base + 4).
 *  One native leaf derives from it. */
function rrCompacted(sid: string, base: number, work: string): object[] {
  const at = (k: number) => ({
    uuid: rrU(base + k), ts: rrIso(10 - k), parentUuid: k === 0 ? null : rrU(base + k - 1), sessionId: sid, cwd: WORK,
  });
  const anchor = rrU(base + 3);
  const summary = [
    '<summary>',
    '1. Primary Request and Intent:',
    '   Keep the fixture repository healthy.',
    '8. Current Work:',
    `   ${work}`,
    '9. Optional Next Step:',
    '   Run the suite again.',
    '</summary>',
  ].join('\n');
  return [
    userRow({ ...at(0), text: `zqrecover ask about ${work}` }),
    assistantRow({ ...at(1), text: 'zqrecover answer' }),
    boundaryRow({ ...at(2), trigger: 'manual', headUuid: anchor, anchorUuid: anchor, tailUuid: anchor, allUuids: [] }),
    summaryRow({ ...at(3), text: summary }),
    userRow({ ...at(4), text: 'zqrecover after the compaction' }),
  ];
}

interface RrBuilt { box: HistoryBox; storeId: string; transcript: string }
/** A bound box whose store holds one confirmed family (ID, RR_G1) and its three-row transcript, ingested. Its
 *  journal holds the file, spool, verdict (`drained` included) and tick records of that work. */
function rrBuilt(prefix: string): RrBuilt {
  const box = makeHistoryBox(prefix, { role: 'fleet' });
  plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
  const transcript = plantTranscript(box, 'claude-a', SLUG, RR_U1, rrTalk(RR_U1, 1, 3));
  spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
  rrTickUntil(box, () => countOf(box, 'entries') === 3);
  return { box, storeId: fs.readFileSync(rrRoot(box).storeId, 'utf8').trim(), transcript };
}

/** `doctor --backup` through the direct door (Task 22; not irreversible, so no terminal). Returns the new name. */
function rrBackup(box: HistoryBox): string {
  const dir = rrRoot(box).backups;
  const before = new Set(rrNames(dir));
  const r = runShim(box, ['--op', 'backup']);
  expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
  const made = rrNames(dir).filter((n) => /^[0-9]{8}T[0-9]{6}Z\.db$/.test(n) && !before.has(n));
  expect(made, 'one new <ts>.db').toHaveLength(1);
  return made[0]!;
}

/** The loss. The DB always goes, with its -wal and -shm (§8.4's remedy moves the three together). With
 *  `binding`, store.id, store.writer and any pending marker go too. With `journal`, so does journal/. A box that
 *  loses all three holds only what a fresh box with a planted backup holds (C57). */
function rrLose(box: HistoryBox, o: { binding: boolean; journal: boolean }): void {
  const P = rrRoot(box);
  for (const f of [P.dbFile, P.wal, P.shm]) fs.rmSync(f, { force: true });
  if (o.binding) for (const f of [P.storeId, P.writer, P.pending]) fs.rmSync(f, { force: true });
  if (o.journal) fs.rmSync(P.journalDir, { recursive: true, force: true });
}

/** Every `bind` verdict in every journal directory. */
const rrBinds = (box: HistoryBox): { bind: unknown; writer: unknown }[] =>
  journalRecords(box).filter((r) => r['k'] === 'verdict' && r['kind'] === 'bind').map((r) => ({ bind: r['bind'], writer: r['writer'] }));

/** What a restore or a rebuild must leave (§8.4):
 *  - store.id and meta.store_id name `storeId`;
 *  - a new writer token is in store.writer and mirrored in meta.writer;
 *  - one `bound:<ms>` row names the verb;
 *  - the store is in WAL mode;
 *  - its `bind` record sits in journal/<storeId>/ under the new token. */
function rrExpectBound(box: HistoryBox, storeId: string, kind: 'restore' | 'rebuild', oldWriter: string | null): void {
  const P = rrRoot(box);
  expect(fs.readFileSync(P.storeId, 'utf8').trim(), 'store.id').toBe(storeId);
  expect(metaOf(box, 'store_id'), 'meta.store_id').toBe(storeId);
  const writer = fs.readFileSync(P.writer, 'utf8').trim();
  expect(writer).toMatch(/^[0-9a-f]{8}$/);
  expect(metaOf(box, 'writer'), 'meta.writer mirrors store.writer').toBe(writer);
  if (oldWriter !== null) expect(writer, 'a binding mints a new writer token').not.toBe(oldWriter);
  expect(rrQ<{ v: string }>(box, "SELECT v FROM meta WHERE k LIKE 'bound:%'").map((x) => x.v)).toEqual([kind]);
  expect(rrJournalMode(P.dbFile), 'journal_mode').toBe('wal');
  expect(rrBinds(box).filter((b) => b.writer === writer)).toEqual([{ bind: kind, writer }]);
  expect(rrNames(path.join(P.journalDir, storeId)).some((n) => n.endsWith(`.${writer}.jsonl`)),
    'the bind record went to journal/<store_id>/ under the new writer').toBe(true);
}

const rrFamilies = (box: HistoryBox, id: string): { generation: string; merged_into: number | null }[] =>
  rrQ(box, 'SELECT generation, merged_into FROM sessions WHERE ccrc_id = ? ORDER BY generation', id);
const rrEpochs = (box: HistoryBox, id: string): { generation: string; seq: number; cc_session_uuid: string; cause: string }[] =>
  rrQ(box, `SELECT s.generation, e.seq, e.cc_session_uuid, e.cause FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk
    WHERE s.ccrc_id = ? ORDER BY s.generation, e.seq`, id);

/** A copy of a backup that claims a newer schema than this build knows. */
function rrSetUserVersion(file: string, v: number): void {
  const db = new DatabaseSync(file);
  try { db.exec(`PRAGMA user_version = ${v}`); } finally { db.close(); }
}
/** A copy of a backup whose integrity_check fails while every table still reads. The entries_ts index's
 *  definition is rewritten so its stored keys no longer match its table (integrity_check then answers "row N
 *  missing from index entries_ts" rows rather than throwing, and meta still reads). The handle is opened with
 *  `defensive: false`: node:sqlite's defensive flag defaults to true on Node 24, where even writable_schema ON
 *  refuses the sqlite_master UPDATE ("table sqlite_master may not be modified", measured on 24.14.1, the workers'
 *  Node); 22.16.0 has no such option and is not defensive, so the flag changes nothing there. */
function rrCorruptIndex(file: string): void {
  const db = new DatabaseSync(file, { defensive: false });
  try {
    db.exec('PRAGMA writable_schema = ON');
    db.prepare("UPDATE sqlite_master SET sql = ? WHERE name = 'entries_ts'").run('CREATE INDEX entries_ts ON entries(ts_ms, transcript_pk)');
    db.exec('PRAGMA writable_schema = OFF');
  } finally { db.close(); }
  const rows = rrFileDb(file, (d) => (d.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check));
  expect(rows, 'CONTROL: the fixture really fails integrity_check').not.toEqual(['ok']);
}

describe('C57: doctor --restore, the drill (W1-B2 Task 27)', () => {

  it('a fresh box holding only a backup: the tick refuses store-recoverable and creates nothing; --restore (the CLI, on a terminal) binds the backup, and the next passes recover, then resume the backup\'s cursors', async () => {
    const { box, storeId, transcript } = rrBuilt('ccrc-hist-c57a-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    const backupWriter = rrDbMeta(path.join(P.backups, name), 'writer');
    const live = rrQ<{ file_id: number }>(box, "SELECT file_id FROM ingest_files WHERE status = 'live'");
    expect(live).toHaveLength(1);
    // A row written after the backup: the restored cursor must take it from where the backup left off.
    fs.appendFileSync(transcript, `${JSON.stringify(userRow({
      uuid: rrU(4), ts: rrIso(0), parentUuid: rrU(3), sessionId: RR_U1, cwd: WORK, text: 'zqrecover written after the backup',
    }))}\n`);
    rrLose(box, { binding: true, journal: true });
    const hold = runShim(box);
    expect(hold.stdout).toMatch(/^history-sweep: store-recoverable$/m);
    expect([fs.existsSync(P.dbFile), fs.existsSync(P.storeId), fs.existsSync(P.pending)], 'the tick created nothing')
      .toEqual([false, false, false]);
    const r = await cliOnPty(box, ['doctor', '--restore', name]);
    expect(r.code, r.out).toBe(0);
    rrExpectBound(box, storeId, 'restore', backupWriter);
    expect(recoverRow(box), 'the recovery step is registered inside the restored file').toMatchObject({ completed_ms: null });
    rrTickUntil(box, () => rrRecovered(box));
    // The drain and ingest resume after the step; a Stop line is the discovery hint for the appended row.
    spoolLine(box, ID, { v: 1, ev: 'Stop', id: ID });
    rrTickUntil(box, () => countOf(box, 'entries') === 4);
    expect(rrQ<{ file_id: number }>(box, "SELECT file_id FROM ingest_files WHERE status = 'live'"),
      'the backup\'s cursor row resumed; nothing was retired and re-read').toEqual(live);
  }, 1.5 * HEAVY);

  it('a pre-v<N>.db restores into WAL like a <ts>.db, and under history-off the restore binds while the recovery step waits for the switch', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c57b-');
    const P = rrRoot(box);
    const ts = rrBackup(box);
    // A VACUUM INTO output under the snapshot's name: like every pre-v<N>.db, a rollback-journal database.
    fs.copyFileSync(path.join(P.backups, ts), path.join(P.backups, 'pre-v2.db'));
    expect(rrJournalMode(path.join(P.backups, 'pre-v2.db')), 'CONTROL: the backup is not WAL').toBe('delete');
    rrLose(box, { binding: true, journal: true });
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    fs.writeFileSync(P.off, '');
    const r = await cliOnPty(box, ['doctor', '--restore', 'pre-v2.db']);
    expect(r.code, r.out).toBe(0);
    rrExpectBound(box, storeId, 'restore', null);
    expect(runShim(box).code, 'a scheduled pass under history-off').toBe(0);
    expect(rrRecovered(box), 'the step waits while history-off is set').toBe(false);
    fs.rmSync(P.off);
    rrTickUntil(box, () => rrRecovered(box));
  }, 1.5 * HEAVY);

  it('a kill right after the link, with store.id absent: the next pass finishes the pending marker and runs the recovery step', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c57c-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    rrLose(box, { binding: true, journal: true });
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    await shimOnPty(box, ['--op', 'restore', name], rrKill('linkSync:.history.db.restore.:1:after'));
    expect([fs.existsSync(P.dbFile), fs.existsSync(P.storeId), fs.existsSync(P.pending)],
      'the kill landed between the link and the pending rename').toEqual([true, false, true]);
    rrTickUntil(box, () => rrRecovered(box));
    expect(fs.readFileSync(P.storeId, 'utf8').trim()).toBe(storeId);
    expect(rrBinds(box).map((b) => b.bind), 'the bind row was inside the file; the next pass flushed it').toEqual(['restore']);
  }, 1.5 * HEAVY);

  it('a kill right after the link, with store.id present: the next pass opens the store and runs the recovery step over the kept journal', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c57d-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    rrLose(box, { binding: false, journal: false });
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-missing$/m);
    const k = await shimOnPty(box, ['--op', 'restore', name], rrKill('linkSync:.history.db.restore.:1:after'));
    // With store.id present, a restore that was NOT killed leaves the same three facts, so the kill is measured
    // on what only a kill leaves: no result line, the linked temp (unlinked right after the link), the op marker
    // (removed in restoreArm's finally), and no restore bind in the journal yet (it is in the file's outbox).
    expect(k.out, 'the pass was killed before its result').not.toMatch(/\{"rc"/);
    expect([fs.existsSync(P.dbFile), fs.readFileSync(P.storeId, 'utf8').trim(), fs.existsSync(P.pending)])
      .toEqual([true, storeId, false]);
    expect(rrNames(P.dbDir).some((n) => n.startsWith('.history.db.restore.')), 'the kill left the linked temp').toBe(true);
    expect(fs.existsSync(P.op), 'the killed pass left its op marker').toBe(true);
    expect(rrBinds(box).filter((b) => b.bind === 'restore'), 'the bind row is still inside the file').toEqual([]);
    rrTickUntil(box, () => rrRecovered(box));
    expect(rrBinds(box).filter((b) => b.bind === 'restore')).toHaveLength(1);
    expect(counters(box)['recover_chunk_failed'] ?? 0).toBe(0);
  }, 1.5 * HEAVY);

  it('a v1 backup under a v2 migration seam: the next pass snapshots and migrates, and only the passes after it replay', async () => {
    const { box } = rrBuilt('ccrc-hist-c57e-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    rrLose(box, { binding: false, journal: false });
    expect(lastRc((await shimOnPty(box, ['--op', 'restore', name])).out)).toEqual({ rc: 0 });
    const mig = runDriver(box, { extraMigrations: [RR_V2] });
    expect(mig.code, `${mig.stdout}\n${mig.stderr}`).toBe(0);
    expect(mig.stdout).toMatch(/^history-sweep: migrated$/m);
    expect(rrUserVersion(P.dbFile)).toBe(2);
    expect(fs.existsSync(path.join(P.backups, 'pre-v2.db')), 'the migration snapshot').toBe(true);
    expect(rrRecovered(box), 'the replay waits for the code\'s version (§9.2, DI6)').toBe(false);
    for (let i = 0; i < 6 && !rrRecovered(box); i += 1) {
      const t = runDriver(box, { extraMigrations: [RR_V2] });
      expect(t.code, `${t.stdout}\n${t.stderr}`).toBe(0);
    }
    expect(rrRecovered(box)).toBe(true);
  }, 1.5 * HEAVY);

  it('a backup taken after a re-key: the recovery completes with one (id, G) family (DI4)', async () => {
    const box = makeHistoryBox('ccrc-hist-c57f-', { role: 'fleet' });
    const ID = 'claude-a-rekey';
    const U5 = 'a5a5a5a5-0000-4000-8000-000000000005';
    const G3 = '0189abcd-1234-4678-9abc-0000000000c3';
    plantSession(box, ID, { uuid: U5, project: 'demo' });                 // no .generation yet: a '' family
    spoolLine(box, ID, rrStart(ID, U5, 'startup', { reg: U5 }));
    rrTickUntil(box, () => rrFamilies(box, ID).length === 1);
    plantSession(box, ID, { generation: G3 });
    spoolLine(box, ID, rrStart(ID, U5, 'resume', { reg: U5, gen: G3 }));
    rrTickUntil(box, () => rrFamilies(box, ID).some((f) => f.generation === '' && f.merged_into !== null));
    const name = rrBackup(box);
    rrLose(box, { binding: false, journal: false });
    expect(lastRc((await shimOnPty(box, ['--op', 'restore', name])).out)).toEqual({ rc: 0 });
    rrTickUntil(box, () => rrRecovered(box));
    expect(rrFamilies(box, ID).filter((f) => f.merged_into === null).map((f) => f.generation)).toEqual([G3]);
    expect(rrEpochs(box, ID).map((e) => [e.generation, e.seq, e.cc_session_uuid])).toEqual([[G3, 1, U5]]);
    expect(counters(box)['recover_chunk_failed'] ?? 0).toBe(0);
  }, 1.5 * HEAVY);

  it('a recovery cursor held still for 15 passes by a throwing seam: status (and so doctor) FAILs recovery-stalled', async () => {
    const { box } = rrBuilt('ccrc-hist-c57g-');
    const name = rrBackup(box);
    rrLose(box, { binding: false, journal: false });
    expect(lastRc((await shimOnPty(box, ['--op', 'restore', name])).out)).toEqual({ rc: 0 });
    // Task 25's knob and its substring (the stall case above): every statement that moves the step's cursor throws, so
    // each pass's first chunk rolls back with its cursor.
    const stall: SpawnOpts = { preloads: [PRELOADS.faults], env: { HISTORY_TEST_THROW_SQL: "SET cursor = ? WHERE step = 'recover'" } };
    for (let i = 0; i < 15; i += 1) {
      const t = runShim(box, [], stall);
      expect(t.code, `pass ${i + 1}:\n${t.stdout}\n${t.stderr}`).toBe(0);
    }
    expect(rrRecovered(box)).toBe(false);
    expect(Number(metaOf(box, HEALTH_META.recoverUnmovedTicks))).toBeGreaterThanOrEqual(15);
    const st = runCli(box, ['status', '--json']);
    const health = st.json?.['health'] as { fail?: { word: string }[] } | undefined;
    expect((health?.fail ?? []).map((f) => f.word), st.stdout).toContain('recovery-stalled');
  }, 1.5 * HEAVY);

  it('each refusal answers restore-refused and writes nothing; CLAUDECODE and a piped stdin refuse at both doors; free space one byte short refuses and one byte over proceeds', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c57h-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    const size = fs.statSync(path.join(P.backups, name)).size;
    rrLose(box, { binding: true, journal: true });
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    const refused = async (args: string[], why: string, env: Record<string, string> = {}): Promise<string> => {
      const before = ccrcSnapshot(box);
      const r = await shimOnPty(box, ['--op', 'restore', ...args], env);
      expect(lastRc(r.out), `${why}\n${r.out}`).toEqual({ rc: 2, reason: 'restore-refused' });
      expect(ccrcSnapshot(box), `${why}: nothing written`).toEqual(before);
      return r.out.replace(/\r/g, '');
    };
    // H-99: a refusal relayed from decideBind (before or after the staged copy is read) names the operator at the direct door too.
    const OPERATOR = 'the operator acts on it, from a terminal outside any session';
    // The name: never a path, never a temp, never a link.
    await refused([`sub/${name}`], 'a name with /');
    fs.copyFileSync(path.join(P.backups, name), path.join(P.backups, `.${name}.tmp`));
    await refused([`.${name}.tmp`], 'a .tmp');
    fs.symlinkSync(path.join(P.backups, name), path.join(P.backups, '20200101T000000Z.db'));
    await refused(['20200101T000000Z.db'], 'a symlink');
    // H-106: the three rows below are decided by restorePre, before any copy; a pass that opens its staged copy is killed.
    const noCopy = rrKill('openSync:.history.db.restore.:1');
    // An old store's WAL with no DB would be replayed into the restored file (RC1).
    fs.writeFileSync(P.wal, '');
    await refused([name], 'a leftover history.db-wal', noCopy);
    fs.rmSync(P.wal);
    fs.writeFileSync(P.storeId, '0189abcd-1234-4678-9abc-0000000000ff\n', { mode: 0o600 });
    expect(await refused([name], 'store.id names another store', noCopy), 'a refusal decideBind makes before the copy is staged').toContain(OPERATOR);
    fs.rmSync(P.storeId);
    fs.copyFileSync(path.join(P.backups, name), path.join(P.backups, '20200101T000001Z.db'));
    rrSetUserVersion(path.join(P.backups, '20200101T000001Z.db'), 2);
    expect(await refused(['20200101T000001Z.db'], 'a newer user_version'), 'a refusal decideBind makes over the staged copy').toContain(OPERATOR);
    fs.copyFileSync(path.join(P.backups, name), path.join(P.backups, '20200101T000002Z.db'));
    rrCorruptIndex(path.join(P.backups, '20200101T000002Z.db'));
    expect(await refused(['20200101T000002Z.db'], 'a failed integrity_check'), 'a refusal decideBind makes over the staged copy').toContain(OPERATOR);
    // planCopy: free must exceed the threshold plus the backup's size (§6.11).
    const fsSize = 100 * 2 ** 30;
    const threshold = floorThreshold(fsSize);
    await refused([name], 'free = threshold + size - 1', { HISTORY_TEST_STATFS: `${threshold + size - 1}:${fsSize}` });
    await refused([name], 'a statfs that throws reads as low-disk (R3)', { HISTORY_TEST_STATFS: 'throw' });
    // The bumps, at both doors (§8.4): CLAUDECODE, then a stdin that is no TTY.
    const before = ccrcSnapshot(box);
    const cc = runCli(box, ['doctor', '--restore', name, '--json'], { env: { CLAUDECODE: '1' } });
    expect(cc.code, cc.stdout + cc.stderr).toBe(2);
    expect(cc.stdout + cc.stderr).toContain('apply-in-session');
    expect(lastRc(runShim(box, ['--op', 'restore', name], { env: { CLAUDECODE: '1' } }).stdout))
      .toEqual({ rc: 2, reason: 'apply-in-session' });
    const piped = runCli(box, ['doctor', '--restore', name, '--json']);
    expect(piped.code, piped.stdout + piped.stderr).toBe(2);
    expect(piped.stdout + piped.stderr).toContain('needs-tty');
    expect(lastRc(runShim(box, ['--op', 'restore', name]).stdout)).toEqual({ rc: 2, reason: 'needs-tty' });
    expect(ccrcSnapshot(box), 'the bumps wrote nothing').toEqual(before);
    // A killed restore's copy is removed first, even by a pass that then refuses: under the lock every temp is
    // stale (§9.4), and free space is measured without it. The one write a refusal makes, and only of a dead temp.
    const dead = path.join(P.dbDir, '.history.db.restore.999999');
    fs.writeFileSync(dead, 'a killed restore\'s copy', { mode: 0o600 });
    const low = await shimOnPty(box, ['--op', 'restore', name], { HISTORY_TEST_STATFS: `${threshold + size - 1}:${fsSize}` });
    expect(lastRc(low.out), low.out).toEqual({ rc: 2, reason: 'restore-refused' });
    expect(fs.existsSync(dead), 'the stale temp went before the refusal').toBe(false);
    // One byte more than the boundary, and it proceeds.
    const ok = await shimOnPty(box, ['--op', 'restore', name], { HISTORY_TEST_STATFS: `${threshold + size + 1}:${fsSize}` });
    expect(lastRc(ok.out), ok.out).toEqual({ rc: 0 });
    expect(metaOf(box, 'store_id')).toBe(storeId);
    // A live store is never overwritten.
    await refused([name], 'a DB present', noCopy);
  }, 2.5 * HEAVY);

  it('H-101: a directory planted at op does not wedge restore: the marker is cleared before it is written', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c57op-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    rrLose(box, { binding: true, journal: true });
    fs.mkdirSync(P.op);
    const r = await shimOnPty(box, ['--op', 'restore', name]);
    expect(lastRc(r.out), r.out).toEqual({ rc: 0 });
    expect(metaOf(box, 'store_id')).toBe(storeId);
    expect(fs.existsSync(P.op), 'the op marker goes with the pass').toBe(false);
  }, 1.5 * HEAVY);

  it('H-105: an I/O failure is exit 1 and never narrowed into restore-refused: an unsearchable db/backups, an integrity_check that throws; only an absent name is a refusal', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root searches and reads whatever the mode says
    const { box, storeId } = rrBuilt('ccrc-hist-c57io-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    rrLose(box, { binding: true, journal: true });
    const notRefused = (r: { out: string }, why: string): void => {
      expect(lastRc(r.out), `${why}\n${r.out}`).toEqual({ rc: 1 });
      expect(r.out, `${why}: no refusal word`).not.toContain('restore-refused');
      expect(fs.existsSync(P.dbFile), `${why}: nothing was linked`).toBe(false);
      expect(rrNames(P.dbDir).filter((n) => n.startsWith('.history.db.restore.')), `${why}: no staged copy is left`).toEqual([]);
      expect(fs.existsSync(P.op), `${why}: the op marker goes with the pass`).toBe(false);
    };
    // The name is absent: the argument itself is refused.
    const gone = await shimOnPty(box, ['--op', 'restore', '20200101T000009Z.db']);
    expect(lastRc(gone.out), gone.out).toEqual({ rc: 2, reason: 'restore-refused' });
    // db/backups listable but not searchable: lstat answers EACCES, which names nothing about the argument.
    fs.chmodSync(P.backups, 0o600);
    try { notRefused(await shimOnPty(box, ['--op', 'restore', name]), 'EACCES on lstat'); } finally { fs.chmodSync(P.backups, 0o700); }
    // SQLite failing inside integrity_check (an I/O or memory error, not a verdict on the file): the good backup is not reported corrupt.
    notRefused(await shimOnPty(box, ['--op', 'restore', name], {
      NODE_OPTIONS: preloadOptions([PRELOADS.statfs, PRELOADS.faults]), HISTORY_TEST_THROW_SQL: 'PRAGMA integrity_check',
    }), 'a throwing integrity_check');
    // CONTROL: none of it was the backup's fault.
    const ok = await shimOnPty(box, ['--op', 'restore', name]);
    expect(lastRc(ok.out), ok.out).toEqual({ rc: 0 });
    expect(metaOf(box, 'store_id')).toBe(storeId);
  }, 2.5 * HEAVY);

  it('H-105: stageRestore refuses an absent name and a link as restore-refused, and lets EACCES on the open through as the I/O failure it is', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root opens whatever the mode says
    const box = makeHistoryBox('ccrc-hist-c57sr-');
    const P = rrRoot(box);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    const refusal = (name: string): unknown => {
      try { stageRestore(box.home, name); } catch (e) { return e; }
      return null;
    };
    const absent = refusal('20200101T000000Z.db');
    expect(absent, 'an absent name').toBeInstanceOf(StoreError);
    expect((absent as StoreError).word).toBe('restore-refused');
    fs.writeFileSync(path.join(P.backups, '20200101T000001Z.db'), 'x');
    fs.symlinkSync(path.join(P.backups, '20200101T000001Z.db'), path.join(P.backups, '20200101T000002Z.db'));
    const link = refusal('20200101T000002Z.db');
    expect(link, 'a link').toBeInstanceOf(StoreError);
    expect((link as StoreError).word).toBe('restore-refused');
    const shut = path.join(P.backups, '20200101T000003Z.db');
    fs.writeFileSync(shut, 'x', { mode: 0o000 });
    const shutErr = refusal('20200101T000003Z.db');
    expect(shutErr, 'EACCES is thrown').not.toBeNull();
    expect(shutErr, 'and is no refusal of the argument').not.toBeInstanceOf(StoreError);
    expect((shutErr as NodeJS.ErrnoException).code).toBe('EACCES');
  });

  it('H-105: stageRestore reads a SQLite verdict on the copy (corrupt, not a database) as a failed check, and any other SQLite failure inside integrity_check (I/O, memory) as the throw it is', () => {
    const box = makeHistoryBox('ccrc-hist-c57mi-');
    const P = rrRoot(box);
    createStore(box.home);
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    const name = '20200101T000000Z.db';
    const src = new DatabaseSync(P.dbFile);
    try { src.exec(`VACUUM INTO '${path.join(P.backups, name)}'`); } finally { src.close(); }
    const proto = DatabaseSync.prototype;
    const realPrepare = proto.prepare;
    /** Every integrity_check on any handle throws an error of this shape (what node:sqlite throws carries code and, since it does, errcode). */
    const failIntegrityWith = (e: { message: string; errcode?: number }): void => {
      proto.prepare = function prepareFailing(this: DatabaseSync, sql: string) {
        if (String(sql).includes('PRAGMA integrity_check')) throw Object.assign(new Error(e.message), { code: 'ERR_SQLITE_ERROR', ...(e.errcode === undefined ? {} : { errcode: e.errcode }) });
        return realPrepare.call(this, sql);
      } as typeof proto.prepare;
    };
    const stage = (): ReturnType<typeof stageRestore> | Error => {
      try { return stageRestore(box.home, name); } catch (e) { return e as Error; } finally { proto.prepare = realPrepare; }
    };
    const clean = (): void => { for (const n of rrNames(P.dbDir).filter((f) => f.startsWith('.history.db.restore.'))) fs.rmSync(path.join(P.dbDir, n), { force: true }); };
    try {
      for (const verdict of [
        { message: 'database disk image is malformed', errcode: 11 },
        { message: 'file is not a database', errcode: 26 },
        { message: 'database disk image is malformed (extended code)', errcode: 11 | (1 << 8) },
        { message: 'no such table: meta', errcode: 1 },                  // a database with no meta table
        { message: 'database disk image is malformed' },                 // a build whose error carries no errcode is read by its message
      ]) {
        failIntegrityWith(verdict);
        const got = stage();
        expect(got, `a verdict on the content: ${JSON.stringify(verdict)}`).not.toBeInstanceOf(Error);
        expect((got as ReturnType<typeof stageRestore>).integrityOk, JSON.stringify(verdict)).toBe(false);
        abortRestore(got as ReturnType<typeof stageRestore>);
      }
      for (const failure of [
        { message: 'disk I/O error', errcode: 10 },
        { message: 'disk I/O error', errcode: 10 | (1 << 8) },           // SQLITE_IOERR_READ
        { message: 'out of memory', errcode: 7 },
        { message: 'SQL logic error', errcode: 1 },                      // SQLITE_ERROR is a verdict only for the missing table
        { message: 'disk I/O error' },
      ]) {
        failIntegrityWith(failure);
        const got = stage();
        expect(got, `not a verdict on the file: ${JSON.stringify(failure)}`).toBeInstanceOf(Error);
        expect((got as Error).message).toBe(failure.message);
        expect(got, 'and no refusal of the argument').not.toBeInstanceOf(StoreError);
        clean();
      }
    } finally { proto.prepare = realPrepare; clean(); }
  });

  it('H-103: a readable journal file whose head names another store does not refuse the restore: it is skipped with a notice naming it, and the store is linked', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c57fo-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    rrLose(box, { binding: true, journal: false });
    const month = new Date().toISOString().slice(0, 7);
    plantJournalFile(box, storeId, month, 'feedbee2', Date.now(), [], u(0xd2));
    const foreign = `${month}.feedbee2.jsonl`;
    const r = await shimOnPty(box, ['--op', 'restore', name]);
    expect(lastRc(r.out), r.out).toEqual({ rc: 0 });
    const out = r.out.replace(/\r/g, '');
    expect(out, 'the notice names the foreign file').toContain(foreign);
    expect(out, 'and says recovery skips it').toContain('journal_head_mismatch');
    expect(metaOf(box, 'store_id')).toBe(storeId);
    expect(fs.existsSync(P.dbFile), 'the store is linked').toBe(true);
  }, 1.5 * HEAVY);
});

describe('Redaction first at the link: a restore applies the journal\'s redact records before history.db exists (W1-B2 Task 27)', () => {

  it('a backup that lacks a pair only the journal holds: read verbs run right after the commit, before any pass, print no stretch of the value', async () => {
    const box = makeHistoryBox('ccrc-hist-c57r-', { role: 'fleet' });
    const P = rrRoot(box);
    const value = randomBytes(32).toString('hex');
    const sha = createHash('sha256').update(value).digest('hex').toUpperCase();
    const tokenFile = path.join(box.home, '.ccrc', 'fixture.token');
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, [
      userRow({ uuid: rrU(1), ts: rrIso(3), parentUuid: null, sessionId: RR_U1, cwd: WORK, text: `zqatlink the key ${value} here` }),
      assistantRow({ uuid: rrU(2), ts: rrIso(2), parentUuid: rrU(1), sessionId: RR_U1, cwd: WORK, text: 'zqatlink noted' }),
    ]);
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => countOf(box, 'entries') === 2);
    const name = rrBackup(box);                                // taken before the pair is known
    fs.writeFileSync(tokenFile, `${value}\n`, { mode: 0o600 });
    expect(runShim(box).code).toBe(0);                     // learned now, and journaled as a redact record
    fs.rmSync(tokenFile);                                    // then rotated out of every file: only the journal knows it
    const pairSql = 'SELECT count(*) AS n FROM redact_hashes WHERE len = ? AND hex(sha256) = ?';
    expect(rrFileDb(path.join(P.backups, name), (db) => Number((db.prepare(pairSql).get(value.length, sha) as { n: number }).n)),
      'CONTROL: the backup lacks the pair').toBe(0);
    expect(journalRecords(box).some((r) => r['k'] === 'redact' && String(r['sha256']).toUpperCase() === sha),
      'CONTROL: the journal holds it').toBe(true);
    rrLose(box, { binding: false, journal: false });
    expect(lastRc((await shimOnPty(box, ['--op', 'restore', name])).out)).toEqual({ rc: 0 });
    expect(recoverRow(box), 'CONTROL: no pass has run the recovery step yet').toMatchObject({ completed_ms: null });
    expect(rrQ<{ n: number }>(box, pairSql, value.length, sha)[0]!.n, 'the linked store already holds the journal\'s pair').toBe(1);
    const pane = withPane(box, ID);
    for (const args of [['grep', 'zqatlink'], ['grep', 'zqatlink', '--json'], ['expand', rrU(1)], ['expand', rrU(1), '--json']]) {
      const o = runCli(box, args, { env: pane });
      expect(o.code, `${args.join(' ')}: rc`).toBe(0);
      const said = o.stdout + o.stderr;
      for (let i = 0; i + 14 <= value.length; i += 10) {
        expect(said.includes(value.slice(i, i + 14)), `${args.join(' ')}: a stretch of the value at ${i}`).toBe(false);
      }
      expect(o.stdout.includes(REDACTED_MARK), `${args.join(' ')}: masked`).toBe(true);
    }
    expect(recoverRow(box), 'the read verbs ran before any pass: the step is still open').toMatchObject({ completed_ms: null });
  }, 1.5 * HEAVY);

  it('a journal file the pair read cannot open refuses the restore: named, nothing linked, the staged copy removed; readable again, the restore runs', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    const { box, storeId } = rrBuilt('ccrc-hist-c57s-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    rrLose(box, { binding: false, journal: false });
    const files = rrNames(path.join(P.journalDir, storeId)).filter((n) => n.endsWith('.jsonl'));
    expect(files.length > 0, 'CONTROL: the journal holds a file').toBe(true);
    const shut = path.join(P.journalDir, storeId, files[0]!);
    const idBefore = fs.readFileSync(P.storeId, 'utf8');
    fs.chmodSync(shut, 0o000);
    try {
      // D-4593 (history-restore-refuses-unread-journal-pairs): a pair only the shut file holds would be missing from
      // the copy at link time, and read verbs answer while the recovery step is registered.
      const r = await shimOnPty(box, ['--op', 'restore', name]);
      expect(lastRc(r.out), r.out).toEqual({ rc: 2, reason: 'restore-refused' });
      const line = r.out.replace(/\r/g, '').split('\n').find((l) => l.includes('journal file(s) could not be read for redact pairs:'));
      expect(line !== undefined && line.includes(files[0]!), 'the unread file is named, never skipped silently').toBe(true);
      expect(line, 'H-100: and whose act it is to make it readable').toContain('the operator makes them readable, from a terminal outside any session');
      expect(fs.existsSync(P.dbFile), 'nothing was linked').toBe(false);
      expect(rrNames(P.dbDir).filter((n) => n.startsWith('.history.db.restore.')), 'the staged copy was removed').toEqual([]);
      expect(fs.readFileSync(P.storeId, 'utf8'), 'store.id is unchanged').toBe(idBefore);
    } finally { fs.chmodSync(shut, 0o600); }
    expect(lastRc((await shimOnPty(box, ['--op', 'restore', name])).out), 'readable again, the same restore runs').toEqual({ rc: 0 });
  }, 1.5 * HEAVY);

  it('the restore checks the belt witness before its pair insert and stamps it after: a backup stale against its own content records the belt due, a stamped one keeps its state (ruling R-witness-restore)', async () => {
    const belt = (box: HistoryBox): ReturnType<typeof parseBeltState> => parseBeltState(metaOf(box, 'fts_belt'));
    /** A completed belt generation, stamped by the tick that wrote it (Task 7B's recordTick). */
    const stamped = (box: HistoryBox): boolean => {
      const s = belt(box);
      return s !== null && s.v === BELT_VERSION && s.gen === null && s.w !== undefined;
    };
    const vrg = (s: ReturnType<typeof parseBeltState>): unknown => (s === null ? null : { v: s.v, rids: s.rids, gen: s.gen });

    // A: after the last stamped tick, a B1-shaped write (a pair recorded straight into redact_hashes: the top rowid, a
    // witnessed value, rises and fts_belt is not touched, as a build without the belt records one), then the backup.
    // Its fts_belt witness is stale against its own content, so the restore must record the belt due, never stamp the
    // stale state clean.
    const a = rrBuilt('ccrc-hist-c57w-');
    rrTickUntil(a.box, () => stamped(a.box), 12);
    const before = metaOf(a.box, 'fts_belt');
    const db = new DatabaseSync(rrRoot(a.box).dbFile);
    try {
      db.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?)').run(40, randomBytes(32), Date.now());
    } finally { db.close(); }
    const nameA = rrBackup(a.box);
    expect(metaOf(a.box, 'fts_belt'), 'CONTROL: neither the B1-shaped write nor the backup pass wrote the belt state').toBe(before);
    rrLose(a.box, { binding: false, journal: false });
    expect(lastRc((await shimOnPty(a.box, ['--op', 'restore', nameA])).out)).toEqual({ rc: 0 });
    expect(recoverRow(a.box), 'CONTROL: no pass has run since the restore').toMatchObject({ cursor: null, completed_ms: null });
    expect(vrg(belt(a.box)), 'the restore recorded the belt due: the copy\'s witness had moved').toEqual({ v: 0, rids: [], gen: null });

    // B: a backup right after a stamped tick, then a pair only the journal holds. The check finds the witness unmoved
    // and keeps the backup's state; the stamp records the pair insert, so `w` moves with the top rowid and the first
    // recovery pass does not read the restore's own write as another build's.
    const b = rrBuilt('ccrc-hist-c57x-');
    rrTickUntil(b.box, () => stamped(b.box), 12);
    const atBackup = belt(b.box)!;
    const nameB = rrBackup(b.box);
    const value = randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(b.box.home, '.ccrc', 'fixture.token'), `${value}\n`, { mode: 0o600 });
    expect(runShim(b.box).code).toBe(0);                       // learned and journaled after the backup
    rrLose(b.box, { binding: false, journal: false });
    expect(lastRc((await shimOnPty(b.box, ['--op', 'restore', nameB])).out)).toEqual({ rc: 0 });
    expect(recoverRow(b.box), 'CONTROL: the journal-only pair went in, so the step starts +pairs').toMatchObject({ cursor: 'index+pairs', completed_ms: null });
    const kept = belt(b.box);
    expect(vrg(kept), 'the restore kept the backup\'s belt state: its witness had not moved').toEqual(vrg(atBackup));
    expect(kept?.w !== undefined && kept.w !== atBackup.w, 'the restore stamped its own pair insert: w moved with the top redact_hashes rowid').toBe(true);
  }, 2 * HEAVY);
});

// ── Task 28's helpers ───────────────────────────────────────────────────────────────────────────────────────
const rrLeafIds = (box: HistoryBox): string[] =>
  rrQ<{ node_id: string }>(box, "SELECT node_id FROM nodes WHERE kind <> 'condensed' ORDER BY node_id").map((r) => r.node_id);

/** What O35 compares, each by its natural key and journaled times (§8.4 "What comes back equal"). Surrogate keys,
 *  cwd_real, leaf_id_forked and uuid_two_sessions are not compared. */
interface RrState {
  storeId: string | null; sessions: unknown[]; epochs: unknown[]; receipts: unknown[]; redact: unknown[];
  recall: unknown[]; leaves: string[];
}
function rrState(box: HistoryBox): RrState {
  return {
    storeId: metaOf(box, 'store_id'),
    sessions: rrQ(box, 'SELECT ccrc_id, generation, project, first_seen_ms FROM sessions ORDER BY ccrc_id, generation'),
    epochs: rrQ(box, `SELECT s.ccrc_id, s.generation, e.seq, e.cc_session_uuid, e.cause, e.declared_by
      FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk ORDER BY s.ccrc_id, s.generation, e.seq`),
    receipts: rrQ(box, 'SELECT event_key, hex(payload_sha) AS sha, received_ms FROM spool_receipts ORDER BY event_key'),
    redact: rrQ(box, 'SELECT len, hex(sha256) AS sha FROM redact_hashes ORDER BY len, sha'),
    recall: rrQ(box, 'SELECT event_key, ccrc_id, generation, ts_ms, verb, rc, ms, arm FROM recall_calls ORDER BY event_key'),
    leaves: rrLeafIds(box),
  };
}
/** The journal's records by kind, every store directory. `head` and `tick` are left out: a pass and a new writer
 *  file write those whatever a recovery does. */
function rrJournalKinds(box: HistoryBox): Record<'file' | 'spool' | 'redact' | 'verdict', number> {
  const out = { file: 0, spool: 0, redact: 0, verdict: 0 };
  for (const r of journalRecords(box)) {
    const k = r['k'];
    if (k === 'file' || k === 'spool' || k === 'redact' || k === 'verdict') out[k] += 1;
  }
  return out;
}

describe('C58: doctor --rebuild, its store_id and its refusals (W1-B2 Task 28)', () => {
  /** What a refusing rebuild must leave alone: every file of the store and its binding. The lock-take journal half
   *  runs before the verb (it appends observation and verdict records to journal/ and moves spool/ lines, as C67's
   *  note says), so those two trees are left out of the comparison. */
  const bindingSnapshot = (box: HistoryBox): string[] =>
    ccrcSnapshot(box).filter((l) => !l.startsWith('history/journal/') && !l.startsWith('history/spool/'));
  /** A rebuild through the direct door on a terminal, which must refuse rebuild-refused and write nothing. */
  const refused = async (box: HistoryBox, args: string[], why: string): Promise<string> => {
    const before = bindingSnapshot(box);
    // H-110: the snapshot leaves journal/ out, so the records are compared by kind: a refusal appends no bind verdict, nor any verdict or redact
    // record. The lock-take half does append `file` and `spool` records (measured: it journals the spool lines it moves), so those two are not compared.
    const recordsOf = (): Pick<ReturnType<typeof rrJournalKinds>, 'redact' | 'verdict'> => {
      const { redact, verdict } = rrJournalKinds(box);
      return { redact, verdict };
    };
    const kindsBefore = recordsOf();
    const bindsBefore = rrBinds(box);
    const r = await shimOnPty(box, ['--op', 'rebuild', ...args]);
    expect(lastRc(r.out), `${why}\n${r.out}`).toEqual({ rc: 2, reason: 'rebuild-refused' });
    expect(rrBinds(box), `${why}: no bind verdict was journaled`).toEqual(bindsBefore);
    expect(recordsOf(), `${why}: no verdict or redact record was journaled`).toEqual(kindsBefore);
    expect(r.out, `${why}: H-99, the relayed refusal names the operator at the direct door`).toContain('the operator acts on it, from a terminal outside any session');
    expect(bindingSnapshot(box), `${why}: nothing written`).toEqual(before);
    return r.out;
  };
  /** A journal directory journal/<dir>/ whose one month file holds only a head record naming `dir`. */
  const plantDir = (box: HistoryBox, dir: string): void =>
    plantJournalFile(box, dir, new Date().toISOString().slice(0, 7), randomBytes(4).toString('hex'), Date.now(), []);

  it('store.id present and the DB lost: the pass holds store-missing; --rebuild (the CLI, on a terminal) makes a DB with that store_id, bound rebuild, its recovery step registered', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c58a-');
    const P = rrRoot(box);
    const oldWriter = fs.readFileSync(P.writer, 'utf8').trim();
    rrLose(box, { binding: false, journal: false });
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-missing$/m);
    const r = await cliOnPty(box, ['doctor', '--rebuild']);
    expect(r.code, r.out).toBe(0);
    rrExpectBound(box, storeId, 'rebuild', oldWriter);
    expect(recoverRow(box)).toMatchObject({ completed_ms: null });
    rrTickUntil(box, () => rrRecovered(box));
  }, HEAVY);

  it('no store.id and one journal directory whose heads name S: the pass refuses store-recoverable; --rebuild writes store_id S and store.id', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c58b-');
    const P = rrRoot(box);
    rrLose(box, { binding: true, journal: false });
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    expect(fs.existsSync(P.dbFile), 'the pass created nothing').toBe(false);
    const r = await shimOnPty(box, ['--op', 'rebuild']);
    expect(lastRc(r.out), r.out).toEqual({ rc: 0 });
    rrExpectBound(box, storeId, 'rebuild', null);
    rrTickUntil(box, () => rrRecovered(box));
  }, HEAVY);

  it('two journal directories S and T: rebuild-refused naming both, writing nothing; --store-id T rebuilds T', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c58c-');
    const T = '0189abcd-1234-4678-9abc-0000000000d7';
    rrLose(box, { binding: true, journal: false });
    plantDir(box, T);
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    const out = await refused(box, [], 'two journal directories and no --store-id');
    expect(out).toContain(storeId);
    expect(out).toContain(T);
    expect(out, 'H-107: --store-id cures this refusal, so the remedy line says so').toMatch(/the operator names one with --store-id <uuid>, from a terminal outside any session/);
    const r = await shimOnPty(box, ['--op', 'rebuild', '--store-id', T]);
    expect(lastRc(r.out), r.out).toEqual({ rc: 0 });
    rrExpectBound(box, T, 'rebuild', null);
  }, HEAVY);

  it('each refusal answers rebuild-refused and writes nothing: a DB present, a leftover history.db-wal, store.id and --store-id disagreeing, a --store-id naming no directory, a directory whose heads name another store, and neither source', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c58d-');
    const P = rrRoot(box);
    // H-107: --store-id cures neither a DB present nor a leftover -wal, so the refusal still names the directories (the journal is kept) and points at no flag.
    const dbPresent = await refused(box, [], 'a DB present');
    expect(dbPresent, 'the candidate directories are still named').toContain(`journal store directories: ${storeId}`);
    expect(dbPresent, 'but --store-id is not offered for a DB present').not.toMatch(/--store-id <uuid>/);
    rrLose(box, { binding: false, journal: false });
    fs.writeFileSync(P.wal, '');
    expect(await refused(box, [], 'a leftover history.db-wal'), 'nor for a leftover -wal').not.toMatch(/--store-id <uuid>/);
    fs.rmSync(P.wal);
    const T = '0189abcd-1234-4678-9abc-0000000000d8';
    plantDir(box, T);
    await refused(box, ['--store-id', T], 'store.id and --store-id disagree');
    fs.rmSync(path.join(P.journalDir, T), { recursive: true });
    fs.rmSync(P.storeId);
    fs.rmSync(P.writer);
    expect(await refused(box, ['--store-id', '0189abcd-1234-4678-9abc-0000000000d9'], 'a --store-id naming no directory'),
      'H-107: a --store-id naming no directory is cured by naming one that exists').toMatch(/the operator names one with --store-id <uuid>, from a terminal outside any session/);
    // journal/X/ whose month files' heads name S: no directory names itself, so none names a store.
    fs.renameSync(path.join(P.journalDir, storeId), path.join(P.journalDir, '0189abcd-1234-4678-9abc-0000000000da'));
    await refused(box, [], 'a directory whose heads name another store');
    // A killed pass's temp is removed first, even by a rebuild that then refuses: under the lock every temp is stale
    // (§9.4). The one write a refusal makes, and only of a dead temp.
    const dead = path.join(P.dbDir, 'history.db.new.888888');
    fs.writeFileSync(dead, 'a killed creation\'s temp', { mode: 0o600 });
    expect(lastRc((await shimOnPty(box, ['--op', 'rebuild'])).out)).toEqual({ rc: 2, reason: 'rebuild-refused' });
    expect(fs.existsSync(dead), 'the stale temp went before the refusal').toBe(false);
    // Neither source: a box that never had a journal. Its first pass is held by a planted backup, not minted over it.
    const fresh = makeHistoryBox('ccrc-hist-c58e-', { role: 'fleet' });
    const FP = rrRoot(fresh);
    fs.mkdirSync(FP.backups, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(FP.backups, '20200101T000000Z.db'), 'not a store');
    expect(runShim(fresh).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    await refused(fresh, [], 'neither store.id nor a journal directory');
    const empty = makeHistoryBox('ccrc-hist-c58g-', { role: 'fleet' });
    fs.mkdirSync(path.join(rrRoot(empty).journalDir, '0189abcd-1234-4678-9abc-0000000000db'), { recursive: true, mode: 0o700 });
    expect(runShim(empty).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    await refused(empty, [], 'an empty journal directory names no store');
  }, 2 * HEAVY);

  it('H-18 (D-4605): a journal directory or month file rebuild cannot read answers exit 5 store-unmeasured and writes no store, where an empty directory and a foreign head are still rebuild-refused (exit 2)', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file and lists a 0000 directory
    const { box, storeId } = rrBuilt('ccrc-hist-c58h-');
    const P = rrRoot(box);
    rrLose(box, { binding: true, journal: false });
    const dir = path.join(P.journalDir, storeId);
    const month = path.join(dir, fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()[0]!);
    const wordsOf = (): string => SW.journalStoreDirs(box.home).map((d) => `${d.storeId}=${d.heads}`).join(',');
    expect(wordsOf(), 'readable, its head naming the directory').toBe(`${storeId}=agree`);
    const noStore = (why: string): void => {
      expect(fs.existsSync(P.dbFile), `${why}: no DB was minted`).toBe(false);
      expect(fs.existsSync(P.storeId), `${why}: no store.id was written`).toBe(false);
    };
    for (const lock of [month, dir]) {
      fs.chmodSync(lock, 0o000);
      try {
        expect(wordsOf(), `${lock === dir ? 'an unlistable directory' : 'an unreadable month file'} reads unreadable`).toBe(`${storeId}=unreadable`);
        for (const args of [[], ['--store-id', storeId]]) {
          const r = await shimOnPty(box, ['--op', 'rebuild', ...args]);
          expect(lastRc(r.out), `${args.join(' ')}\n${r.out}`).toEqual({ rc: 5, reason: 'store-unmeasured' });
          expect(r.out, `${args.join(' ')}: H-107, an unmeasured directory is named by the verdict's own detail, and no remedy line is printed`).not.toContain('journal store directories');
          noStore(args.join(' '));
        }
      } finally {
        fs.chmodSync(lock, lock === dir ? 0o700 : 0o600);
      }
    }
    expect(wordsOf(), 'readable again').toBe(`${storeId}=agree`);
    // Measured and refused stays a refusal: a directory with no month file, and a month file whose head names another store.
    const E = '0189abcd-1234-4678-9abc-0000000000dc';
    const F = '0189abcd-1234-4678-9abc-0000000000dd';
    fs.mkdirSync(path.join(P.journalDir, E), { mode: 0o700 });
    plantJournalFile(box, F, new Date().toISOString().slice(0, 7), 'abcdef01', Date.now(), [], storeId);
    expect(SW.journalStoreDirs(box.home).map((d) => `${d.storeId}=${d.heads}`).sort())
      .toEqual([`${storeId}=agree`, `${E}=disagree`, `${F}=disagree`].sort());
    for (const id of [E, F]) {
      const r = await shimOnPty(box, ['--op', 'rebuild', '--store-id', id]);
      expect(lastRc(r.out), r.out).toEqual({ rc: 2, reason: 'rebuild-refused' });
      noStore(id);
    }
  }, 2 * HEAVY);

  it('H-101: a directory planted at op does not wedge rebuild: the marker is cleared before it is written', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c58op-');
    const P = rrRoot(box);
    rrLose(box, { binding: true, journal: false });
    fs.mkdirSync(P.op);
    const r = await shimOnPty(box, ['--op', 'rebuild']);
    expect(lastRc(r.out), r.out).toEqual({ rc: 0 });
    rrExpectBound(box, storeId, 'rebuild', null);
    expect(fs.existsSync(P.op), 'the op marker goes with the pass').toBe(false);
  }, HEAVY);

  it('H-108: a journal/ that lists but cannot be searched reads its directories unreadable (exit 5), never absent', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root searches whatever the mode says
    const { box, storeId } = rrBuilt('ccrc-hist-c58ls-');
    const P = rrRoot(box);
    rrLose(box, { binding: true, journal: false });
    expect(SW.journalStoreDirs(box.home).map((d) => `${d.storeId}=${d.heads}`).join(','), 'CONTROL: readable').toBe(`${storeId}=agree`);
    fs.chmodSync(P.journalDir, 0o600);                               // readdir lists journal/<S>, lstat of it answers EACCES
    try {
      expect(SW.journalStoreDirs(box.home).map((d) => `${d.storeId}=${d.heads}`).join(','), 'listed but unsearchable reads unreadable').toBe(`${storeId}=unreadable`);
      const r = await shimOnPty(box, ['--op', 'rebuild']);
      expect(lastRc(r.out), r.out).toEqual({ rc: 5, reason: 'store-unmeasured' });
      expect(r.out, 'not "nothing names a store_id"').not.toContain('nothing names a store_id');
      expect(r.out).toContain(`journal/${storeId}/ could not be read`);
      expect(fs.existsSync(P.dbFile), 'no DB was minted').toBe(false);
    } finally { fs.chmodSync(P.journalDir, 0o700); }
  }, HEAVY);

  it('a kill right after the pending marker becomes store.id: the next pass runs the recovery step (DI3)', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c58f-');
    const P = rrRoot(box);
    rrLose(box, { binding: true, journal: false });
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-recoverable$/m);
    // The first rename naming store.id.pending writes the marker (temp then rename); the second makes it store.id.
    const k = await shimOnPty(box, ['--op', 'rebuild'], rrKill('renameSync:store.id.pending:2:after'));
    // A rebuild that was NOT killed leaves the same three facts, so the kill is measured on what only a kill leaves:
    // no result line, the op marker (removed in rebuildArm's finally), and no bind in the journal (it is still in the
    // new file's outbox; finishBind never ran).
    expect(k.out, 'the pass was killed before its result').not.toMatch(/\{"rc"/);
    expect([fs.existsSync(P.dbFile), fs.existsSync(P.pending), fs.readFileSync(P.storeId, 'utf8').trim()],
      'the kill landed right after the pending rename').toEqual([true, false, storeId]);
    expect(fs.existsSync(P.op), 'the killed pass left its op marker').toBe(true);
    expect(rrBinds(box), 'the bind row is still inside the file').toEqual([]);
    expect(recoverRow(box)).toMatchObject({ completed_ms: null });
    rrTickUntil(box, () => rrRecovered(box));
    expect(rrBinds(box).map((b) => b.bind)).toEqual(['rebuild']);
  }, HEAVY);
});

describe('O35 and O36: the rebuild drill (W1-B2 Task 28)', () => {
  const A_ID = 'claude-a-demo';
  const B_ID = 'claude-a-genless';
  const C_ID = 'claude-a-rekey';
  const D_ID = 'claude-a-ops';
  const U = (n: number): string => `b${n}b${n}b${n}b${n}-0000-4000-8000-00000000003${n}`;
  const G = (n: number): string => `0189abcd-1234-4678-9abc-00000000035${n}`;

  it('O35: rebuilt from its journal alone, with the registry purged and a token rotated out, the store equals the lost one by name; O36: the step writes no record and the rebuild writes its own bind', async () => {
    const box = makeHistoryBox('ccrc-hist-o35-', { role: 'fleet' });
    const P = rrRoot(box);
    const token = randomBytes(32).toString('hex');
    const tokenFile = path.join(box.home, '.ccrc', 'fixture.token');
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });            // a learned redaction pair
    // The store exists before any registry row does: a first pass over planted rows would import each registry uuid as
    // an 'import' epoch and hint no transcript, which is not the work this drill journals.
    pass(box);
    expect(fs.existsSync(P.dbFile), 'CONTROL: the first pass made the store').toBe(true);
    // Phase 1, in the first passes:
    //  - A: a confirmed startup and a /clear in ONE draining file, and a recall line;
    //  - B: a gen-less resume and a gen-less recall, both joining the registry's G(2);
    //  - C: a gen-less startup with no .generation, so a '' family.
    plantSession(box, A_ID, { uuid: U(2), generation: G(1), project: 'demo' });
    spoolLine(box, A_ID, rrStart(A_ID, U(1), 'startup', { reg: U(1), gen: G(1) }));
    spoolLine(box, A_ID, rrStart(A_ID, U(2), 'clear', { gen: G(1) }));
    spoolLine(box, A_ID, { v: 1, ev: 'recall', id: A_ID, cmd: 'grep', rc: 0, ms: 12, gen: G(1) });
    plantSession(box, B_ID, { uuid: U(3), generation: G(2), project: 'demo' });
    spoolLine(box, B_ID, rrStart(B_ID, U(3), 'resume', { reg: U(3) }));
    spoolLine(box, B_ID, { v: 1, ev: 'recall', id: B_ID, cmd: 'describe', rc: 3, ms: 7 });
    plantSession(box, C_ID, { uuid: U(5), project: 'demo' });
    spoolLine(box, C_ID, rrStart(C_ID, U(5), 'startup', { reg: U(5) }));
    rrTickUntil(box, () => countOf(box, 'epochs') === 4, 10);
    // Phase 2: B's gen-less SessionStart(clear), and C re-keyed once its row gains a generation.
    plantSession(box, B_ID, { uuid: U(4) });
    spoolLine(box, B_ID, rrStart(B_ID, U(4), 'clear'));
    plantSession(box, C_ID, { generation: G(3) });
    spoolLine(box, C_ID, rrStart(C_ID, U(5), 'resume', { reg: U(5), gen: G(3) }));
    rrTickUntil(box, () => countOf(box, 'epochs') === 5 && rrFamilies(box, C_ID).some((f) => f.generation === '' && f.merged_into !== null));
    // Phase 3: an operator mapping, `import --session --file --apply`, on a terminal (an irreversible form), of a
    // compacted transcript (a leaf). Discovery would find a transcript planted in phase 1 only at the 30-minute scan.
    plantSession(box, D_ID, { generation: G(4), project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U(6), rrCompacted(U(6), 200, 'Polishing the fixture docs.'));
    expect(lastRc((await shimOnPty(box, ['--op', 'import', '--session', D_ID, '--file', file, '--apply'])).out)).toEqual({ rc: 0 });
    rrTickUntil(box, () => countOf(box, 'epochs') === 6 && rrLeafIds(box).length === 1, 10);
    const a = rrState(box);
    expect(a.leaves, 'CONTROL: A derived the leaf B must re-derive').toHaveLength(1);
    expect(a.redact.length, 'CONTROL: A learned the token\'s pair').toBeGreaterThan(0);
    expect(a.recall, 'CONTROL: both recall lines folded').toHaveLength(2);
    const kindsA = rrJournalKinds(box);
    // The loss: the token rotated out (only the journal remembers its pair), every registry row purged, the DB gone.
    fs.rmSync(tokenFile);
    fs.rmSync(box.reg, { recursive: true, force: true });
    fs.mkdirSync(box.reg);
    rrLose(box, { binding: false, journal: false });
    const r = await cliOnPty(box, ['doctor', '--rebuild']);
    expect(r.code, r.out).toBe(0);
    rrTickUntil(box, () => rrRecovered(box) && rrLeafIds(box).length === 1, 12);
    const b = rrState(box);
    for (const k of Object.keys(a) as (keyof RrState)[]) expect(b[k], `B's ${k} equals A's`).toEqual(a[k]);
    // O36, the replay half: recovery and the passes after it appended no file, spool, redact or verdict record;
    // the one new verdict is the rebuild's own bind, under the new writer token.
    // H-109, measured: this line goes red (verdict 26, expected 24) when sweep.mjs applyReplayAction's `case 'verdict':` re-journals what it
    // replays, i.e. after `replayVerdict(db, a.rec, false);` it adds `db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)').run(JSON.stringify(a.rec));`.
    expect(rrJournalKinds(box)).toEqual({ ...kindsA, verdict: kindsA.verdict + 1 });
    expect(rrBinds(box)).toEqual([{ bind: 'rebuild', writer: fs.readFileSync(P.writer, 'utf8').trim() }]);
  }, 2.5 * HEAVY);

  it('O35, the held file: a startup and a gen-less clear journaled and held under store-missing are decided after the step from their sidecar, and the recall counter of the drained file folds exactly once', async () => {
    const box = makeHistoryBox('ccrc-hist-o35h-', { role: 'fleet' });
    const P = rrRoot(box);
    const H_ID = 'claude-a-drained';
    const K_ID = 'claude-a-held';
    plantSession(box, H_ID, { uuid: U(7), generation: G(5), project: 'demo' });
    spoolLine(box, H_ID, { v: 1, ev: 'recall', id: H_ID, cmd: 'tree', rc: 0, ms: 3, gen: G(5) });
    spoolLine(box, H_ID, rrStart(H_ID, U(7), 'startup', { reg: U(7), gen: G(5) }));
    rrTickUntil(box, () => countOf(box, 'recall_calls') === 1 && countOf(box, 'epochs') === 1);
    const recallBefore = rrState(box).recall;
    rrLose(box, { binding: false, journal: false });
    plantSession(box, K_ID, { uuid: U(9), generation: G(6), project: 'demo' });
    spoolLine(box, K_ID, rrStart(K_ID, U(8), 'startup', { reg: U(8) }));    // gen-less: the sidecar names G(6)
    spoolLine(box, K_ID, rrStart(K_ID, U(9), 'clear'));                     // gen-less; the sidecar's .uuid names U(9)
    expect(runShim(box).stdout).toMatch(/^history-sweep: store-missing$/m);
    expect(rrNames(P.draining).filter((n) => n.endsWith('.jsonl')), 'journaled and held').toHaveLength(1);
    fs.rmSync(box.reg, { recursive: true, force: true });                      // decided from the sidecar alone
    fs.mkdirSync(box.reg);
    expect((await cliOnPty(box, ['doctor', '--rebuild'])).code).toBe(0);
    rrTickUntil(box, () => rrRecovered(box) && rrNames(P.draining).filter((n) => n.endsWith('.jsonl')).length === 0, 10);
    expect(rrFamilies(box, K_ID)).toEqual([{ generation: G(6), merged_into: null }]);
    expect(rrEpochs(box, K_ID).map((e) => [e.seq, e.cc_session_uuid, e.cause])).toEqual([[1, U(8), 'startup'], [2, U(9), 'clear']]);
    expect(rrState(box).recall, 'the drained file\'s recall line, once').toEqual(recallBefore);
    expect(counters(box)['journal_spool_undrained_gone'] ?? 0, 'the held file was still there').toBe(0);
  }, 2 * HEAVY);
});

describe('C67: unreadable is not absent (W1-B2 Task 28)', () => {
  it('.generation for recall-off, store.id for status and the three binding verbs, .harness for every read verb', async () => {
    const { box } = rrBuilt('ccrc-hist-c67-');
    const P = rrRoot(box);
    const name = rrBackup(box);
    // .generation present but unreadable (a directory at the path, which no read opens, as root or not).
    fs.rmSync(path.join(box.reg, `${ID}.generation`));
    plantSession(box, ID, { generation: 'unreadable' });
    let before = ccrcSnapshot(box);
    const off = runCli(box, ['recall-off', ID, '--json']);
    expect(off.code, off.stdout + off.stderr).toBe(2);
    expect(off.stdout + off.stderr).toContain('generation-unreadable');
    expect(ccrcSnapshot(box), 'recall-off wrote nothing').toEqual(before);
    // store.id present but unreadable: exit 5 store-unmeasured, and no binding verb proceeds. This block runs BEFORE
    // the read verbs below: a read verb that resolved an identity appends its ev:"recall" counter line to spool/
    // (Task 11), and a binding verb's lock-take journal half would move that line into .draining/, a write the
    // snapshot would see that is no binding verb's.
    fs.rmSync(P.storeId);
    fs.mkdirSync(P.storeId);
    const st = runCli(box, ['status', '--json']);
    expect(st.code, st.stdout).toBe(5);
    expect(st.json?.['reason']).toBe('store-unmeasured');
    before = ccrcSnapshot(box);
    for (const args of [['--op', 'adopt'], ['--op', 'restore', name], ['--op', 'rebuild']]) {
      const r = await shimOnPty(box, args);
      expect(lastRc(r.out), `${args[1]}: ${r.out}`).toEqual({ rc: 5, reason: 'store-unmeasured' });
    }
    expect(ccrcSnapshot(box), 'the binding verbs wrote nothing').toEqual(before);
    // .harness present but unreadable: every read verb refuses before any open. store.id is still a directory, which
    // changes nothing here: readContext refuses harness-unreadable right after the identity, before it measures the
    // store (Task 11).
    fs.mkdirSync(path.join(box.reg, `${ID}.harness`));
    const pane = withPane(box, ID);
    for (const verb of [['grep', 'zqrecover'], ['describe', 'L0123456789abcdef0123'], ['expand', 'L0123456789abcdef0123'], ['tree']]) {
      const r = runCli(box, [...verb, '--json'], { env: pane });
      expect(r.code, `${verb[0]}: ${r.stdout}${r.stderr}`).toBe(2);
      expect(r.stdout + r.stderr, verb[0]).toContain('harness-unreadable');
    }
  }, 1.5 * HEAVY);
});

// ── Task 29's helpers ───────────────────────────────────────────────────────────────────────────────────────
/** The index's own bytes: every blobs_fts data block, as latin1 (B1 Task 23's measure). */
const rrFtsBytes = (box: HistoryBox): string =>
  rrQ<{ block: Uint8Array }>(box, 'SELECT block FROM blobs_fts_data').map((r) => Buffer.from(r.block).toString('latin1')).join('');
/** The node index's own bytes: every nodes_fts data block, as latin1 (H-112: the node index is merged like the blob one). */
const rrNodeIndexBytes = (box: HistoryBox): string =>
  rrQ<{ block: Uint8Array }>(box, 'SELECT block FROM nodes_fts_data').map((r) => Buffer.from(r.block).toString('latin1')).join('');
/** Whether any stored blob still holds `needle`: the store stays lossless while the index and the output redact. */
const rrBlobsHold = (box: HistoryBox, needle: string): boolean =>
  rrQ<{ z: Uint8Array }>(box, 'SELECT z FROM blobs WHERE z IS NOT NULL').some((b) => rrUnbrotli(b.z).toString('utf8').includes(needle));
const rrMatches = (box: HistoryBox, table: 'blobs_fts' | 'nodes_fts', q: string): number =>
  rrQ<{ n: number }>(box, `SELECT count(*) AS n FROM ${table} WHERE ${table} MATCH ?`, q)[0]!.n;
const rrGists = (box: HistoryBox): string[] =>
  rrQ<{ gist: string | null }>(box, "SELECT gist FROM nodes WHERE kind <> 'condensed' ORDER BY node_id").map((r) => r.gist ?? '');

describe('O47: redaction survives recovery, and a pair learned late (W1-B2 Task 29)', () => {
  it('a token rotated out of its file, then the store rebuilt: the old value is redacted in grep, expand and --json, and is no term and no index byte', async () => {
    const box = makeHistoryBox('ccrc-hist-o47a-', { role: 'fleet' });
    const token = randomBytes(32).toString('hex');
    const tokenFile = path.join(box.home, '.ccrc', 'fixture.token');
    fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, [
      userRow({ uuid: rrU(1), ts: rrIso(3), parentUuid: null, sessionId: RR_U1, cwd: WORK, text: `zqrotated the old key is ${token} here` }),
      assistantRow({ uuid: rrU(2), ts: rrIso(2), parentUuid: rrU(1), sessionId: RR_U1, cwd: WORK, text: 'zqrotated noted' }),
    ]);
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => countOf(box, 'entries') === 2);
    fs.rmSync(tokenFile);                                   // rotated out: from here on only the journal knows the pair
    expect(runShim(box).code).toBe(0);
    rrLose(box, { binding: false, journal: false });
    expect((await cliOnPty(box, ['doctor', '--rebuild'])).code).toBe(0);
    rrTickUntil(box, () => rrRecovered(box) && countOf(box, 'entries') === 2, 12);
    const pane = withPane(box, ID);
    for (const args of [['grep', 'zqrotated'], ['grep', 'zqrotated', '--json'], ['expand', rrU(1)], ['expand', rrU(1), '--json']]) {
      const o = runCli(box, args, { env: pane });
      expect(o.code, `${args.join(' ')}: ${o.stdout}${o.stderr}`).toBe(0);
      expect(o.stdout + o.stderr, args.join(' ')).not.toContain(token);
      expect(o.stdout, args.join(' ')).toContain(REDACTED_MARK);
    }
    expect(runCli(box, ['grep', `"${token.slice(0, 6)}"*`], { env: pane }).code, 'the old value is no term').toBe(3);
    expect(rrFtsBytes(box).includes(token.slice(16, 32)), 'nor an index byte').toBe(false);
    expect(rrBlobsHold(box, token), 'the store keeps the text: lossless').toBe(true);
  }, 2 * HEAVY);

  it('a backup taken before a pair was learned, restored after the pair was rotated out: the step re-indexes every blob and runs the merge steps, so the value is no term and no index byte', async () => {
    const box = makeHistoryBox('ccrc-hist-o47b-', { role: 'fleet' });
    const value = randomBytes(32).toString('hex');
    const tokenFile = path.join(box.home, '.ccrc', 'fixture.token');
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, [
      userRow({ uuid: rrU(1), ts: rrIso(3), parentUuid: null, sessionId: RR_U1, cwd: WORK, text: `zqlate the key ${value} here` }),
      assistantRow({ uuid: rrU(2), ts: rrIso(2), parentUuid: rrU(1), sessionId: RR_U1, cwd: WORK, text: 'zqlate noted' }),
    ]);
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => countOf(box, 'entries') === 2);
    const name = rrBackup(box);                                // its index holds the value as a term
    fs.writeFileSync(tokenFile, `${value}\n`, { mode: 0o600 });
    expect(runShim(box).code).toBe(0);                     // learned now, and journaled as a redact record
    fs.rmSync(tokenFile);                                    // then rotated out of every file
    rrLose(box, { binding: false, journal: false });
    expect((await cliOnPty(box, ['doctor', '--restore', name])).code).toBe(0);
    expect(rrMatches(box, 'blobs_fts', `"${value.slice(0, 6)}"*`), 'CONTROL: the restored index holds the value').toBe(1);
    rrTickUntil(box, () => rrRecovered(box));
    expect(rrMatches(box, 'blobs_fts', `"${value.slice(0, 6)}"*`), 'no term after the step').toBe(0);
    expect(rrMatches(box, 'blobs_fts', 'zqlate'), 'the rows are still indexed, redacted').toBe(2);
    expect(rrStepDone(box, 'fts-merge', 1), 'the merge steps ran to completion').toBe(true);
    expect(rrFtsBytes(box).includes(value.slice(16, 32)), 'no index byte').toBe(false);
    expect(rrBlobsHold(box, value)).toBe(true);
    const out = runCli(box, ['grep', 'zqlate'], { env: withPane(box, ID) });
    expect(out.stdout + out.stderr).not.toContain(value);
    expect(out.stdout).toContain(REDACTED_MARK);
  }, 2 * HEAVY);

  it('a value holding - and _ indexed in clear, then added to a secret file: the next pass re-indexes it by quoted phrase and re-derives the leaf gist that held it; after the merge steps it is no index byte', () => {
    const box = makeHistoryBox('ccrc-hist-o47c-', { role: 'fleet' });
    const value = `zqv-${randomBytes(10).toString('hex')}_${randomBytes(10).toString('hex')}`;
    const tail = value.slice(value.indexOf('_') + 1);
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, `Rotating the fixture credential ${value} before the release.`));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => rrLeafIds(box).length === 1);
    expect(rrGists(box)[0], 'CONTROL: the native leaf gist holds the value').toContain(value);
    expect(rrMatches(box, 'blobs_fts', `"${tail.slice(0, 6)}"*`), 'CONTROL: a term in the row index').toBeGreaterThan(0);
    expect(rrMatches(box, 'nodes_fts', `"${tail.slice(0, 6)}"*`), 'CONTROL: a term in the node index').toBeGreaterThan(0);
    expect(rrNodeIndexBytes(box).includes(tail.slice(4, 16)), 'CONTROL: a byte in the node index').toBe(true);
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'late.env'), `ZQ_LATE_VALUE=${value}\n`, { mode: 0o600 });
    rrTickUntil(box, () => rrStepDone(box, 'fts-merge', 1), 6);
    expect(rrMatches(box, 'blobs_fts', `"${tail.slice(0, 6)}"*`)).toBe(0);
    expect(rrMatches(box, 'nodes_fts', `"${tail.slice(0, 6)}"*`)).toBe(0);
    expect(rrGists(box)[0], 'the leaf gist was re-derived').not.toContain(value);
    expect(rrGists(box)[0]).toContain(REDACTED_MARK);
    // The rewrite indexes the topics one per line, as Tasks 8 and 9 do, never the column's JSON text.
    const t = rrQ<{ topics: string; fts: string }>(box, `SELECT n.topics AS topics, f.topics AS fts
      FROM nodes n JOIN nodes_fts f ON f.rowid = n.rowid WHERE n.kind <> 'condensed'`)[0]!;
    expect(t.fts, 'nodes_fts topics, one per line').toBe((JSON.parse(t.topics) as string[]).join('\n'));
    expect(rrFtsBytes(box).includes(tail.slice(4, 16)), 'no index byte after the merge steps').toBe(false);
    expect(rrNodeIndexBytes(box).includes(tail.slice(4, 16)), 'no node index byte after the merge steps').toBe(false);
    expect(runCli(box, ['grep', `"${tail.slice(0, 6)}"*`], { env: withPane(box, ID) }).code).toBe(3);
  }, 1.5 * HEAVY);

  it('a backup that carries an open index rebuild (a repair killed before it was taken): the step supersedes that job and re-indexes every blob, so a resumed cursor cannot skip the blobs it had passed', async () => {
    const box = makeHistoryBox('ccrc-hist-o47d-', { role: 'fleet' });
    const P = rrRoot(box);
    const value = randomBytes(32).toString('hex');
    const tokenFile = path.join(box.home, '.ccrc', 'fixture.token');
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, [
      userRow({ uuid: rrU(1), ts: rrIso(3), parentUuid: null, sessionId: RR_U1, cwd: WORK, text: `zqcarried the key ${value} here` }),
      assistantRow({ uuid: rrU(2), ts: rrIso(2), parentUuid: rrU(1), sessionId: RR_U1, cwd: WORK, text: 'zqcarried noted' }),
    ]);
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => countOf(box, 'entries') === 2);
    const name = rrBackup(box);                                // its index holds the value as a term
    // The backup also carries a repair's open job, its cursor past every blob and with a foreign-key baseline, as a
    // repair always has: resumed as it stands, the job would index no blob and only merge.
    const bdb = new DatabaseSync(path.join(P.backups, name));
    try {
      bdb.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('fts-rebuild', 1, ?, NULL)")
        .run(JSON.stringify({ phase: 'blobs', blobId: 2 ** 31, baseline: [], undecodable: 0 }));
    } finally { bdb.close(); }
    fs.writeFileSync(tokenFile, `${value}\n`, { mode: 0o600 });
    expect(runShim(box).code).toBe(0);                     // learned now, and journaled as a redact record
    fs.rmSync(tokenFile);                                    // then rotated out of every file
    rrLose(box, { binding: false, journal: false });
    expect((await cliOnPty(box, ['doctor', '--restore', name])).code).toBe(0);
    expect(rrMatches(box, 'blobs_fts', `"${value.slice(0, 6)}"*`), 'CONTROL: the restored index holds the value').toBe(1);
    expect(rrQ(box, "SELECT version FROM derivation_state WHERE step = 'fts-rebuild' AND completed_ms IS NULL"),
      'CONTROL: the restored file carries the open job').toEqual([{ version: 1 }]);
    rrTickUntil(box, () => rrRecovered(box));
    expect(rrMatches(box, 'blobs_fts', `"${value.slice(0, 6)}"*`), 'no term after the step').toBe(0);
    expect(rrMatches(box, 'blobs_fts', 'zqcarried'), 'every row re-indexed, redacted').toBe(2);
    expect(rrQ(box, "SELECT version FROM derivation_state WHERE step = 'fts-rebuild' AND (version = 1 OR completed_ms IS NULL)"),
      'the carried job is gone, and no rebuild is left open').toEqual([]);
    expect(rrFtsBytes(box).includes(value.slice(16, 32)), 'no index byte').toBe(false);
    expect(counters(box)['recover_chunk_failed'] ?? 0).toBe(0);
  }, 2 * HEAVY);

  it('a late pair whose leaf re-derivation throws: the leaf is rewritten fail-closed, parser_crash counts it once, and the next pass does not retry it', () => {
    const box = makeHistoryBox('ccrc-hist-o47e-', { role: 'fleet' });
    const value = `zqc-${randomBytes(10).toString('hex')}_${randomBytes(10).toString('hex')}`;
    const tail = value.slice(value.indexOf('_') + 1);
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, `Rotating the fixture credential ${value} before the release.`));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => rrLeafIds(box).length === 1);
    expect(rrGists(box)[0], 'CONTROL: the native leaf gist holds the value').toContain(value);
    const crashes = (): number => counters(box)['parser_crash'] ?? 0;
    const before = crashes();
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'late.env'), `ZQ_LATE_VALUE=${value}\n`, { mode: 0o600 });
    // Task 25's knob: refreshLeaf's own read throws, as a parser crash would. Only that statement holds the substring.
    const crash: SpawnOpts = { preloads: [PRELOADS.faults], env: { HISTORY_TEST_THROW_SQL: 'directive_flag, capped, boundary_entry_id' } };
    rrTickUntil(box, () => rrStepDone(box, 'fts-merge', 1), 6, crash);
    expect(crashes() - before, 'the throw is counted once').toBe(1);
    expect(rrGists(box)[0], 'rewritten fail-closed').not.toContain(value);
    expect(rrGists(box)[0]).toContain(REDACTED_MARK);
    expect(rrMatches(box, 'nodes_fts', `"${tail.slice(0, 6)}"*`)).toBe(0);
    const again = runShim(box, [], crash);
    expect(again.code, `${again.stdout}\n${again.stderr}`).toBe(0);
    expect(crashes() - before, 'the next pass does not retry it').toBe(1);
  }, 1.5 * HEAVY);
});

describe('§6.2 "The belt": a generation that opens re-redacts every node\'s stored fields (W1-B2 Task 29)', () => {
  it('a native leaf whose gist and nodes_fts row hold a letter-glued value from before the belt is rewritten by the node step', () => {
    const box = makeHistoryBox('ccrc-hist-beltnodes-', { role: 'fleet' });
    const AN = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const v = `${Array.from(randomBytes(29), (b) => AN[b % AN.length]!).join('')}7`;
    const work = `Rotating the fixture credential zq${v}x before the release.`;
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'belt.env'), `ZQ_BELT=${v}\n`, { mode: 0o600 });
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, work));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => rrLeafIds(box).length === 1);
    expect(rrGists(box)[0], 'CONTROL: the belt masked the glued value when the leaf was derived').not.toContain(v.slice(0, 14));
    // The leaf as a store with no belt state left it: the glued value in its gist and in its nodes_fts row.
    const db = new DatabaseSync(rrRoot(box).dbFile);
    try {
      const n = db.prepare("SELECT rowid AS rid, node_id FROM nodes WHERE kind <> 'condensed'").get() as { rid: number; node_id: string };
      db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run(work, n.node_id);
      db.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(n.rid);
      db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) VALUES (?, ?, ?, ?)').run(n.rid, work, '', '');
      db.prepare("DELETE FROM meta WHERE k = 'fts_belt'").run();
    } finally { db.close(); }
    expect(rrMatches(box, 'nodes_fts', `"zq${v}x"`), 'CONTROL: the planted row is a term').toBe(1);
    expect(rrNodeIndexBytes(box).includes(v.slice(4, 20)), 'CONTROL: and a byte in the node index').toBe(true);
    rrTickUntil(box, () => rrStepDone(box, 'nodes-belt', 1) && !rrGists(box)[0]!.includes(v.slice(0, 14)));
    expect(rrGists(box)[0]).toContain(REDACTED_MARK);
    expect(rrMatches(box, 'nodes_fts', `"zq${v}x"`), 'and its nodes_fts row').toBe(0);
    // H-112: the node step's rewrite registered the merge step, and the tick that ran it merged nodes_fts too.
    expect(rrNodeIndexBytes(box).includes(v.slice(4, 20)), 'no node index byte once the node step ran').toBe(false);
  }, 1.5 * HEAVY);

  it('a nodes_fts row holding a pair-only value glued to a literal escape is re-derived through nodeIndexTexts by the node step (spec §6.2 nodes_fts)', () => {
    const box = makeHistoryBox('ccrc-hist-beltesc-', { role: 'fleet' });
    const v = randomBytes(16).toString('hex');
    const file = path.join(box.home, '.cc-secrets', 'esc.env');
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `ZQ_ESC=${v}\n`, { mode: 0o600 });
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, 'Rotating the fixture credential before the release.'));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => rrLeafIds(box).length === 1);
    expect(rrQ<{ n: number }>(box, 'SELECT count(*) AS n FROM redact_hashes WHERE len = ?', v.length)[0]!.n,
      'CONTROL: a tick recorded the value\'s pair').toBeGreaterThan(0);
    // The value leaves its file: its pair stays (redact_hashes only grows), but no belt holds it any longer, so only the
    // index's escape readings separate it from the literal `\n` glued onto it. redactField's one reading sees the run
    // `n<value>`, which no pair matches, so the stored gist below is one redactField leaves as it is.
    fs.writeFileSync(file, `ZQ_ESC_OTHER=${randomBytes(16).toString('hex')}\n`, { mode: 0o600 });
    const gist = `Printed {"t":"a\\n${v}"} before the release.`;
    const db = new DatabaseSync(rrRoot(box).dbFile);
    try {
      const n = db.prepare("SELECT rowid AS rid, node_id FROM nodes WHERE kind <> 'condensed'").get() as { rid: number; node_id: string };
      db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run(gist, n.node_id);
      db.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(n.rid);
      db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) VALUES (?, ?, ?, ?)').run(n.rid, gist, '', '');
      db.prepare("DELETE FROM meta WHERE k = 'fts_belt'").run();
    } finally { db.close(); }
    expect(rrMatches(box, 'nodes_fts', `"n${v}"`), 'CONTROL: the planted row holds the glued term').toBe(1);
    rrTickUntil(box, () => rrStepDone(box, 'nodes-belt', 1) && rrMatches(box, 'nodes_fts', `"n${v}"`) === 0);
    expect(rrMatches(box, 'nodes_fts', '"printed"'), 'the row was re-derived, not dropped').toBe(1);
  }, 1.5 * HEAVY);

  it('a recovery re-derives node fields through the pass\'s belt, and a unit missing from the recovery passes\' belt leaves the belt due (ruling R-oppass-belt; review R47)', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    const box = makeHistoryBox('ccrc-hist-beltrec-', { role: 'fleet' });
    const AN = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const unit = (): string => `${Array.from(randomBytes(29), (b) => AN[b % AN.length]!).join('')}7`;
    const u = unit();                                          // loaded before the backup; unreadable on every recovery pass
    const v = unit();                                          // learned after the backup; loaded on every recovery pass
    const dir = path.join(box.home, '.cc-secrets');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const uFile = path.join(dir, 'u.env');
    fs.writeFileSync(uFile, `ZQ_U=${u}\n`, { mode: 0o600 });
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, `Rotating zq${u}x and zq${v}x before the release.`));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    const ridOf = (s: string): number => rrQ<{ rid: number }>(box, 'SELECT rowid AS rid FROM redact_hashes WHERE len = ? AND hex(sha256) = ?',
      s.length, createHash('sha256').update(s).digest('hex').toUpperCase())[0]?.rid ?? 0;
    const belt = (): BeltState | null => parseBeltState(metaOf(box, 'fts_belt'));
    rrTickUntil(box, () => rrLeafIds(box).length === 1 && ridOf(u) > 0 && (belt()?.rids.includes(ridOf(u)) ?? false), 12);
    const uRid = ridOf(u);                                     // a restore copies redact_hashes, rowids included
    expect(belt()?.v, 'CONTROL: a completed belt generation recorded u covered').toBe(BELT_VERSION);
    expect(rrGists(box)[0]!.includes(u.slice(0, 14)), 'CONTROL: the belt masked u when the leaf was derived').toBe(false);
    expect(rrGists(box)[0]!.includes(`zq${v}x`), 'CONTROL: v is in no file yet, so the gist holds it glued').toBe(true);
    const atBackup = belt()!;                                  // the backup pass writes no belt state (Task 22)
    const name = rrBackup(box);
    fs.writeFileSync(path.join(dir, 'v.env'), `ZQ_V=${v}\n`, { mode: 0o600 });
    expect(runShim(box).code).toBe(0);                     // v learned and journaled: the backup lacks its pair
    rrLose(box, { binding: false, journal: false });
    expect(lastRc((await shimOnPty(box, ['--op', 'restore', name])).out)).toEqual({ rc: 0 });
    // Ruling R-witness-restore: the restore put v's journal pair into the copy between its witness check and its stamp,
    // so the first recovery pass's secretsStep finds the witness unmoved and records nothing due. What leaves the belt
    // due below is then the recovery's own belt-state rule, which M12 removes (Step 7).
    const restored = belt();
    const vrg = (s: BeltState): string => JSON.stringify([s.v, s.rids, s.gen]);
    expect(restored !== null && vrg(restored) === vrg(atBackup) && restored.rids.includes(uRid)
      && restored.w !== undefined && restored.w !== atBackup.w,
    'CONTROL: the restore left the backup\'s covered state and stamped its pair insert').toBe(true);
    fs.chmodSync(uFile, 0o000);                              // u's file unreadable on every recovery pass
    const unreadable = (): number => counters(box)['redact_source_unreadable'] ?? 0;
    const before = unreadable();
    try {
      rrTickUntil(box, () => rrRecovered(box), 12);
      expect(unreadable() > before, 'CONTROL: the recovery passes could not read u\'s file (a root runner reads it anyway)').toBe(true);
      // Review R47: the step re-derived the nodes with the pass's belt (run.ectx.belt), so v, loaded on these passes
      // and glued by letters, leaves no stretch in a gist, nodes_fts or blobs_fts at the step's completion, before any
      // tick runs the node step.
      expect(rrGists(box)[0]!.includes(v.slice(0, 14)), 'no stretch of v in the gist at the step\'s completion').toBe(false);
      expect(rrMatches(box, 'nodes_fts', `"zq${v}x"`), 'nor a nodes_fts term').toBe(0);
      expect(rrFtsBytes(box).includes(v.slice(8, 22)), 'nor a blobs_fts byte').toBe(false);
      // Ruling R-oppass-belt: u was missing from every recovery pass's belt, and the leaf the step re-derived holds it
      // glued, so the step must leave the belt due for u.
      expect(rrGists(box)[0]!.includes(`zq${u}x`), 'CONTROL: the re-derived gist holds u, whose file no recovery pass read').toBe(true);
      const st = belt();
      expect(st === null || st.v !== BELT_VERSION || !st.rids.includes(uRid), 'u is not recorded covered: the belt is due').toBe(true);
    } finally { fs.chmodSync(uFile, 0o600); }
    rrTickUntil(box, () => rrStepDone(box, 'nodes-belt', 1) && !rrGists(box)[0]!.includes(u.slice(0, 14)));
    expect(rrMatches(box, 'nodes_fts', `"zq${u}x"`), 'and its nodes_fts term is gone').toBe(0);
  }, 2 * HEAVY);

  it('a reparse whose belt lacked a unit: once its file is readable again, the belt generation and its node step re-redact the reparsed leaf (ruling R-oppass-belt; review R46)', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    const box = makeHistoryBox('ccrc-hist-beltrp-', { role: 'fleet' });
    const AN = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const v = `${Array.from(randomBytes(29), (b) => AN[b % AN.length]!).join('')}7`;
    const dir = path.join(box.home, '.cc-secrets');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const vFile = path.join(dir, 'rp.env');
    fs.writeFileSync(vFile, `ZQ_RP=${v}\n`, { mode: 0o600 });
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, `Rotating the fixture credential ab${v}cd before the release.`));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    const belt = (): BeltState | null => parseBeltState(metaOf(box, 'fts_belt'));
    rrTickUntil(box, () => rrLeafIds(box).length === 1 && belt()?.v === BELT_VERSION && (belt()?.rids.length ?? 0) > 0
      && rrStepDone(box, 'nodes-belt', 1), 12);
    const K = beltWidth(v);
    /** Whether `s` holds any K-wide stretch of v (K its belt width): what the belt guarantees no field or term keeps. */
    const stretch = (s: string): boolean => Array.from({ length: v.length - K + 1 }, (_, i) => v.slice(i, i + K)).some((w) => s.includes(w));
    const nodeText = (): string => [
      ...rrQ<{ gist: string | null; topics: string | null }>(box, 'SELECT gist, topics FROM nodes').flatMap((r) => [r.gist ?? '', r.topics ?? '']),
      ...rrQ<{ value: string }>(box, 'SELECT value FROM node_refs').map((r) => r.value),
      ...rrQ<{ gist: string; topics: string; refs: string }>(box, 'SELECT gist, topics, refs FROM nodes_fts').flatMap((r) => [r.gist, r.topics, r.refs]),
    ].join('\n');
    expect(stretch(nodeText()), 'CONTROL: the belt masked v when the leaf was derived').toBe(false);
    fs.chmodSync(vFile, 0o000);                              // v's file unreadable during the reparse only
    try {
      const r = runShim(box, ['--op', 'reparse', '--apply']);
      expect(r.code, r.stderr).toBe(0);
    } finally { fs.chmodSync(vFile, 0o600); }
    expect(rrGists(box)[0]!.includes(`ab${v}cd`), 'CONTROL: the reparse ran without v\'s belt, so the gist holds it glued').toBe(true);
    // The reparse recorded the belt due (Task 21); with v readable again, the next generation reopens ('nodes-belt', 1),
    // whose node step re-redacts every stored node field and nodes_fts row.
    rrTickUntil(box, () => belt()?.v === BELT_VERSION && rrStepDone(box, 'nodes-belt', 1), 12);
    expect(stretch(nodeText()), 'no belt-width stretch of v in nodes.gist, topics, node_refs or nodes_fts').toBe(false);
    expect(rrMatches(box, 'nodes_fts', `"ab${v}cd"`), 'nor a nodes_fts term').toBe(0);
  }, 2 * HEAVY);
});

// ── Hardening batch HE: the Task 29 node redaction (H-112 to H-118) ────────────────────────────────────────────
/** A 40-hex value that classifies as a `sha` ref (it holds a letter a-f). */
const heValue = (): string => `c${randomBytes(19).toString('hex')}f`;
/** Whether `text` holds any 8-character window of `v`: an unmatched prefix counts, as in the spec's SE1. */
const heHolds = (text: string, v: string): boolean =>
  Array.from({ length: v.length - 7 }, (_, i) => v.slice(i, i + 8)).some((w) => text.includes(w));
/** `n` characters of words that end in a space, so a value placed right after is a run of its own. */
const hePad = (n: number): string => `${'ab '.repeat(Math.ceil(n / 3)).slice(0, n - 1)} `;
interface HeNode {
  id: string; kind: 'native_leaf' | 'condensed'; gist: string | null; topics?: string[]; refs?: string[];
  kids?: string[]; readable?: boolean;
  /** A native leaf whose summary blob is tombstoned (z NULL): the real shape of a leaf that carries text and cannot be re-read. */
  pruned?: boolean;
}
/** A store of hand-planted nodes, as one built before any pair was learned holds them: a condensed node's fields are
 *  parentRollup of its children as planted (unredacted), its nodes_fts row is nodeIndexTexts of its fields with no pair.
 *  Rows go in the given order, so a child's rowid is below its parent's. */
function heStore(prefix: string, specs: readonly HeNode[], fts: boolean): { db: DatabaseSync; home: string } {
  const home = mkTmp(prefix);
  createStore(home);
  const db = openWriter(historyPaths(home).dbFile);
  db.exec('BEGIN');
  if (fts) createFtsTables(db);
  db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, '', 'demo', 1)").run(ID);
  db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(RR_U1);
  db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(RR_U1);
  db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 9), Buffer.from([0]));
  db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (2, ?, 'br5', NULL, 1)").run(Buffer.alloc(32, 8));
  const rolled = new Map<string, { gist: string | null; topics: string[]; refs: { kind: string; value: string; origin: string }[] }>();
  for (const n of specs) {
    const own = { gist: n.gist, topics: n.topics ?? [], refs: (n.refs ?? []).map((value) => ({ kind: 'sha', value, origin: 'tool_use' })) };
    const kids = (n.kids ?? []).map((k) => rolled.get(k)!);
    const r = n.kind === 'condensed'
      ? parentRollup(kids.map((k) => ({ ...k, earliestMs: 1, latestMs: 2, srcChars: 0, descCount: 0, descChars: 0 })))
      : { ...own };
    rolled.set(n.id, { gist: r.gist, topics: r.topics, refs: r.refs });
    db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics, summary_blob_id,
      earliest_ms, latest_ms, src_chars, desc_count, desc_chars, parser_version, created_ms)
      VALUES (?, 1, 1, 1, ?, ?, 'not-requested', ?, ?, ?, 1, 2, 0, 0, 0, 1, 1)`)
      .run(n.id, n.kind, n.kind === 'condensed' ? 1 : 0, r.gist, JSON.stringify(r.topics), n.readable === true ? 1 : n.pruned === true ? 2 : null);
    (n.kids ?? []).forEach((k, ord) => db.prepare('INSERT INTO node_children (node_id, child_id, ord) VALUES (?, ?, ?)').run(n.id, k, ord));
    for (const ref of r.refs) db.prepare('INSERT OR IGNORE INTO node_refs (node_id, kind, value, origin) VALUES (?, ?, ?, ?)').run(n.id, ref.kind, ref.value, ref.origin);
    if (fts) {
      const t = nodeIndexTexts({ gist: r.gist, topics: r.topics, refs: r.refs.map((x) => x.value) }, makePairIndex([]));
      db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) SELECT rowid, ?, ?, ? FROM nodes WHERE node_id = ?').run(t.gist, t.topics, t.refs, n.id);
    }
  }
  db.exec('COMMIT');
  return { db, home };
}
/** Where `v`, or a prefix of 8 or more of its characters, is still stored: nodes.gist, nodes.topics, node_refs.value
 *  and every nodes_fts column, by node id. Empty means nothing leaks. */
function heLeaks(db: DatabaseSync, v: string): string[] {
  const out: string[] = [];
  for (const r of db.prepare('SELECT node_id, gist, topics FROM nodes ORDER BY rowid').all() as Array<{ node_id: string; gist: string | null; topics: string | null }>) {
    if (heHolds(r.gist ?? '', v)) out.push(`${r.node_id}.gist`);
    if (heHolds(r.topics ?? '', v)) out.push(`${r.node_id}.topics`);
  }
  for (const r of db.prepare('SELECT node_id, value FROM node_refs ORDER BY node_id').all() as Array<{ node_id: string; value: string }>) {
    if (heHolds(r.value, v)) out.push(`${r.node_id}.ref`);
  }
  if (db.prepare("SELECT 1 AS t FROM sqlite_master WHERE name = 'nodes_fts'").get() !== undefined) {
    for (const r of db.prepare('SELECT n.node_id AS node_id, f.gist AS gist, f.topics AS topics, f.refs AS refs FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid')
      .all() as Array<{ node_id: string; gist: string; topics: string; refs: string }>) {
      for (const col of ['gist', 'topics', 'refs'] as const) if (heHolds(r[col], v)) out.push(`${r.node_id}.fts.${col}`);
    }
  }
  return out;
}
/** The ingest context a tick builds, in-process: nodes_fts on or off, and the pair index of `v` alone. */
const heCtx = (home: string, v: string, fts: boolean): Record<string, unknown> =>
  ({ ...SW.makeIngestCtx(home, [], 1_000, null), fts, pairIdx: makePairIndex(secretPairs([v]).pairs) });
/** Two native leaves (summary blobs pruned, as production keeps text only on a native leaf) under one condensed node, the second holding `v` in its gist (placed so the condensed node's GIST_MAX cut
 *  lands 13 characters inside it), in a topic (placed so TOPIC_CHARS cuts inside it) and in a `sha` ref: the store as it stood before `v` was a known secret. */
const heUnderParent = (v: string, extra: readonly HeNode[] = []): HeNode[] => [
  ...extra,
  { id: 'he-b1', kind: 'native_leaf', pruned: true, gist: 'Raw one.' },
  { id: 'he-b2', kind: 'native_leaf', pruned: true, gist: `${hePad(1186 - 'Raw one.'.length)}${v} and then more.`, topics: [`${hePad(60)}${v}`], refs: [v] },
  { id: 'he-p', kind: 'condensed', gist: null, kids: ['he-b1', 'he-b2'] },
];

describe('hardening HE: the Task 29 node redaction (H-112 to H-118)', () => {
  it('H-113 and H-114: a late pair on the fast path rewrites every node fail-closed, and a re-rolled parent is cut from redacted children (value in a topic, a ref and under a condensed parent)', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-he113-', [
      { id: 'he-a', kind: 'native_leaf', gist: 'Alpha did the work.', topics: [`cred ${v}`], readable: true },
      { id: 'he-b', kind: 'native_leaf', pruned: true, gist: `${hePad(1186 - 'Alpha did the work.'.length)}${v} and then more.`, topics: [`${hePad(60)}${v}`], refs: [v] },
      { id: 'he-p', kind: 'condensed', gist: null, kids: ['he-a', 'he-b'] },
    ], true);
    try {
      const p = db.prepare("SELECT gist FROM nodes WHERE node_id = 'he-p'").get() as { gist: string };
      expect(p.gist.includes(v), 'CONTROL: the planted parent was cut inside the value, not after it').toBe(false);
      expect(p.gist.includes(v.slice(0, 13)), 'CONTROL: and holds its first 13 characters').toBe(true);
      expect(heLeaks(db, v), 'CONTROL: the store leaks the value').not.toEqual([]);
      const budget = SW.newBudget();
      expect(DV.rederiveGistsFor(db, heCtx(home, v, true), [v], budget, SW.newBudget()), 'the three nodes were touched').toBe(3);
      expect(heLeaks(db, v), 'no 8-character window of the value in any node field or nodes_fts column').toEqual([]);
      expect(db.prepare("SELECT value FROM node_refs WHERE node_id = 'he-p'").all(), 'a ref that no longer classifies is not stored on the parent').toEqual([]);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('H-113 and H-114: a recovery rewrites every node, then re-rolls each condensed node from its clean children, so a prefix the old cut left is healed', async () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-he113r-', heUnderParent(v), false);
    try {
      const pair = secretPairs([v]).pairs[0]!;
      db.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, 1)').run(pair.len, Buffer.from(pair.sha256, 'hex'));
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', 5, NULL, NULL)").run();
      expect(heLeaks(db, v), 'CONTROL: the restored store leaks the value').toEqual(expect.arrayContaining(['he-b2.gist', 'he-p.gist']));
      const ctx = { home, homes: [], ids: null, now: () => Date.now(), budget: SW.newBudget(), belt: null };
      let done = false;
      for (let i = 0; i < 20 && !done; i += 1) done = (await SW.recoverReindex(db, ctx, { pairsAdded: true }, SW.newBudget())).done;
      expect(done, 'the reindex phase completed').toBe(true);
      expect(getStep(db, 'recover-nodes', 5)?.completedMs ?? null, 'the node sub-step completed').not.toBeNull();
      expect(heLeaks(db, v), 'no 8-character window of the value in any node field').toEqual([]);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('H-114: the belt\'s node step rewrites a node whose only exposure is a topic or a ref', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-he114-', [
      { id: 'he-t', kind: 'native_leaf', pruned: true, gist: 'Plain.', topics: [`cred ${v}`] },
      { id: 'he-r', kind: 'native_leaf', pruned: true, gist: 'Plain two.', refs: [v] },
    ], false);
    try {
      setStep(db, 'nodes-belt', 1, '0', null);
      expect(DV.beltNodesStep(db, heCtx(home, v, false), SW.newBudget()), 'the step completed').toBe(true);
      expect(heLeaks(db, v)).toEqual([]);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('H-112: each writer that deletes a nodes_fts row tells the tick\'s context, inside its transaction', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-he112-', heUnderParent(v), true);
    try {
      // A BEGIN that throws proves the call came from inside the rewrite's own transaction.
      const told = { n: 0, outside: 0 };
      const ctx = {
        ...heCtx(home, v, true),
        onNodesFtsDeleted: () => { told.n += 1; try { db.exec('BEGIN'); db.exec('ROLLBACK'); told.outside += 1; } catch { /* inside, as required */ } },
      };
      expect(DV.redactNodeFields(db, ctx, ['he-b2']), 'redactNodeFields rewrote the node').toBe(1);
      expect(told.n, 'redactNodeFields told the context').toBe(1);
      expect(DV.rerollParents(db, ctx, ['he-b2']), 'rerollParents rewrote the parent').toBe(1);
      expect(told.n, 'rerollParents told the context').toBe(2);
      expect(DV.redactNodeFields(db, { ...ctx, fts: false }, ['he-b2']), 'with no nodes_fts, nothing to tell').toBe(1);
      expect(told.n, 'and the context was not told').toBe(2);
      expect(told.outside, 'every call came from inside a transaction').toBe(0);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('H-112: a node rewrite alone, with no blob to re-index, registers the merge step, and the tick merges nodes_fts', () => {
    const box = makeHistoryBox('ccrc-hist-he112t-', { role: 'fleet' });
    const value = `zqn-${randomBytes(10).toString('hex')}_${randomBytes(10).toString('hex')}`;
    const tail = value.slice(value.indexOf('_') + 1);
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, 'Rotating the fixture credential before the release.'));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => rrLeafIds(box).length === 1, 8);
    // The value reaches the node alone: no blob holds it, so the blob paths register nothing and only the node rewrite can.
    const gist = `Rotating the fixture credential ${value} before the release.`;
    const db = new DatabaseSync(rrRoot(box).dbFile);
    try {
      const n = db.prepare("SELECT rowid AS rid, node_id FROM nodes WHERE kind <> 'condensed'").get() as { rid: number; node_id: string };
      db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run(gist, n.node_id);
      db.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(n.rid);
      db.prepare('INSERT INTO nodes_fts (rowid, gist, topics, refs) VALUES (?, ?, ?, ?)').run(n.rid, gist, '', '');
    } finally { db.close(); }
    expect(rrMatches(box, 'nodes_fts', `"${tail.slice(0, 6)}"*`), 'CONTROL: a term in the node index').toBeGreaterThan(0);
    expect(rrMatches(box, 'blobs_fts', `"${tail.slice(0, 6)}"*`), 'CONTROL: and in no blob').toBe(0);
    expect(rrNodeIndexBytes(box).includes(tail.slice(4, 16)), 'CONTROL: a byte in the node index').toBe(true);
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'node.env'), `ZQ_NODE_VALUE=${value}\n`, { mode: 0o600 });
    rrTickUntil(box, () => !rrGists(box)[0]!.includes(value), 6);
    expect(rrMatches(box, 'nodes_fts', `"${tail.slice(0, 6)}"*`), 'no term').toBe(0);
    expect(rrStepDone(box, 'fts-merge', 1), 'the merge steps completed in the tick that rewrote the node').toBe(true);
    expect(rrNodeIndexBytes(box).includes(tail.slice(4, 16)), 'no node index byte once the tick merged').toBe(false);
  }, 1.5 * HEAVY);

  it('H-112: refreshLeaf tells the tick\'s context when it rewrites a leaf\'s nodes_fts row', () => {
    const box = makeHistoryBox('ccrc-hist-he112l-', { role: 'fleet' });
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, 'Polishing the fixture docs.'));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    rrTickUntil(box, () => rrLeafIds(box).length === 1, 8);
    const db = openWriter(rrRoot(box).dbFile);
    try {
      let told = 0;
      const ctx = { ...heCtx(box.home, heValue(), true), onNodesFtsDeleted: () => { told += 1; } };
      expect(DV.refreshLeaf(db, ctx, rrLeafIds(box)[0]!), 'the leaf was re-derived in place').toBe('unchanged');
      expect(told, 'refreshLeaf told the context').toBe(1);
    } finally { closeWriter(db); }
  }, 1.5 * HEAVY);

  it('H-115: the late-pair fast path re-derives at most the leaf cap per call and rewrites the rest fail-closed', () => {
    const box = makeHistoryBox('ccrc-hist-he115-', { role: 'fleet' });
    const v = heValue();
    const ids = [['claude-a', ID, RR_U1, RR_G1, 1], ['claude-b', ID2, 'b2b2b2b2-0000-4000-8000-000000000002', '0189abcd-1234-4678-9abc-0000000000a2', 11]] as const;
    for (const [wrapper, id, uuid, gen, base] of ids) {
      plantSession(box, id, { uuid, generation: gen, project: 'demo' });
      plantTranscript(box, wrapper, SLUG, uuid, rrCompacted(uuid, base, `Rotating the fixture credential ${v} before the release.`));
      spoolLine(box, id, rrStart(id, uuid, 'startup', { reg: uuid, gen }));
    }
    rrTickUntil(box, () => rrLeafIds(box).length === 2, 8);
    const db = openWriter(rrRoot(box).dbFile);
    try {
      db.prepare("UPDATE nodes SET parser_version = 0 WHERE kind <> 'condensed'").run();
      expect(rrGists(box).filter((g) => g.includes(v)), 'CONTROL: both native leaf gists hold the value').toHaveLength(2);
      const ctx = { ...heCtx(box.home, v, true), rederiveLeafMax: 1 };
      expect(DV.rederiveGistsFor(db, ctx, [v], SW.newBudget(), SW.newBudget()), 'both leaves were touched').toBe(2);
      const derived = (db.prepare("SELECT count(*) AS n FROM nodes WHERE parser_version = ? AND kind <> 'condensed'").get(NODE_PARSER_VERSION) as { n: number }).n;
      expect(derived, 'one leaf re-derived (the cap), the other only rewritten').toBe(1);
      expect(heLeaks(db, v), 'both leaves are redacted').toEqual([]);
    } finally { closeWriter(db); }
  }, 1.5 * HEAVY);

  it('H-116: a belt cursor that is not a plain number starts the step at the first node, never ends it unread', () => {
    for (const cursor of ['garbage', 'Infinity', '1.5', '0x1', '9'.repeat(30)]) {
      const v = heValue();
      const { db, home } = heStore('ccrc-hist-he116-', [
        { id: 'he-n1', kind: 'native_leaf', pruned: true, gist: `Printed ${v} once.` },
        { id: 'he-n2', kind: 'native_leaf', pruned: true, gist: 'Plain.' },
      ], false);
      try {
        setStep(db, 'nodes-belt', 1, cursor, null);
        expect(DV.beltNodesStep(db, heCtx(home, v, false), SW.newBudget()), `cursor ${cursor}: the step completed`).toBe(true);
        expect(heLeaks(db, v), `cursor ${cursor}: the first node was read`).toEqual([]);
        expect(getStep(db, 'nodes-belt', 1)?.cursor, `cursor ${cursor}: the stamp is a node rowid`).toBe('2');
      } finally { closeWriter(db); }
    }
  }, HEAVY);

  it('H-117: the recovery sub-steps write their cursors in a transaction of their own, so a reindex run inside one throws', async () => {
    for (const cursor of [null, 'condensed:0']) {
      const { db, home } = heStore('ccrc-hist-he117-', [], false);
      try {
        db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', 5, NULL, NULL)").run();
        if (cursor !== null) setStep(db, 'recover-nodes', 5, cursor, null);
        const ctx = { home, homes: [], ids: null, now: () => Date.now(), budget: SW.newBudget(), belt: null };
        db.exec('BEGIN');
        try {
          await expect(SW.recoverReindex(db, ctx, { pairsAdded: true }, SW.newBudget()), `cursor ${String(cursor)}`).rejects.toThrow();
        } finally { db.exec('ROLLBACK'); }
      } finally { closeWriter(db); }
    }
  }, HEAVY);

  // ── HE fix round 1: a parent cut through a value is rebuilt on the tick path, the belt and new parents ──────────────
  /** `n` parents, each over a clean readable native leaf and a readable native leaf whose gist and topic put `v` where the
   *  parent's GIST_MAX and TOPIC_CHARS cuts land inside it. Leaf ids sort in parent order. */
  const heManyParents = (v: string, n: number): HeNode[] => Array.from({ length: n }, (_, i): HeNode[] => [
    { id: `he-c${i}`, kind: 'native_leaf', readable: true, gist: 'Raw one.' },
    { id: `he-v${i}`, kind: 'native_leaf', readable: true, gist: `${hePad(1186 - 'Raw one.'.length)}${v} and then more.`, topics: [`${hePad(60)}${v}`] },
    { id: `he-p${i}`, kind: 'condensed', gist: null, kids: [`he-c${i}`, `he-v${i}`] },
  ]).flat();

  it('F1: the leaves past the re-derivation cap are rewritten AND their parents re-rolled, so no parent keeps a prefix of the value', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-hefr1a-', heManyParents(v, 4), true);
    try {
      for (let i = 0; i < 4; i += 1) {
        const p = db.prepare('SELECT gist FROM nodes WHERE node_id = ?').get(`he-p${i}`) as { gist: string };
        expect(p.gist.includes(v), `CONTROL: parent ${i} was cut inside the value`).toBe(false);
        expect(p.gist.includes(v.slice(0, 13)), `CONTROL: and holds its first 13 characters`).toBe(true);
      }
      const ctx = { ...heCtx(home, v, true), rederiveLeafMax: 1 };
      DV.rederiveGistsFor(db, ctx, [v], SW.newBudget(), SW.newBudget());
      expect(heLeaks(db, v), 'no 8-character window of the value in any node field or nodes_fts column, over the cap too').toEqual([]);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('F2: a matched leaf whose summary is pruned has its parent re-rolled, though no readable sibling holds the value', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-hefr1b-', [
      { id: 'he-a', kind: 'native_leaf', readable: true, gist: 'Raw one.' },
      { id: 'he-u', kind: 'native_leaf', pruned: true, gist: `${hePad(1186 - 'Raw one.'.length)}${v} and then more.`, topics: [`${hePad(60)}${v}`], refs: [v] },
      { id: 'he-p', kind: 'condensed', gist: null, kids: ['he-a', 'he-u'] },
    ], true);
    try {
      const p = db.prepare("SELECT gist FROM nodes WHERE node_id = 'he-p'").get() as { gist: string };
      expect(p.gist.includes(v), 'CONTROL: the parent was cut inside the value').toBe(false);
      expect(p.gist.includes(v.slice(0, 13)), 'CONTROL: and holds its first 13 characters').toBe(true);
      expect(heLeaks(db, v), 'CONTROL: the store leaks').toEqual(expect.arrayContaining(['he-p.gist', 'he-u.gist']));
      DV.rederiveGistsFor(db, heCtx(home, v, true), [v], SW.newBudget(), SW.newBudget());
      expect(heLeaks(db, v), 'no 8-character window of the value in any node field or nodes_fts column').toEqual([]);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('F2: the belt rebuilds a condensed node that holds a prefix of the value over clean children, and rewrites no parent whose re-roll is unchanged', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-hefr1c-', [
      ...heUnderParent(v),
      { id: 'he-c1', kind: 'native_leaf', pruned: true, gist: 'Clean one.' },
      { id: 'he-c2', kind: 'native_leaf', pruned: true, gist: 'Clean two.', topics: ['plain topic'] },
      { id: 'he-q', kind: 'condensed', gist: null, kids: ['he-c1', 'he-c2'] },
    ], true);
    try {
      // The children are clean already (a past build rewrote them), the parent still holds the prefix the old cut left.
      expect(DV.redactNodeFields(db, heCtx(home, v, true), ['he-b1', 'he-b2']), 'the two children were rewritten').toBe(2);
      expect(heLeaks(db, v), 'CONTROL: only the parent keeps the prefix (and its whole ref)').toEqual(expect.arrayContaining(['he-p.gist']));
      expect(heLeaks(db, v).filter((x) => !x.startsWith('he-p.')), 'CONTROL: no child leaks').toEqual([]);
      const ftsOf = (id: string): unknown => db.prepare('SELECT f.gist, f.topics, f.refs FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid WHERE n.node_id = ?').get(id);
      const qBefore = JSON.stringify(ftsOf('he-q'));
      const told = { n: 0 };
      const ctx = { ...heCtx(home, v, true), onNodesFtsDeleted: () => { told.n += 1; } };
      setStep(db, 'nodes-belt', 1, '0', null);
      expect(DV.beltNodesStep(db, ctx, SW.newBudget()), 'the step completed').toBe(true);
      expect(heLeaks(db, v), 'no 8-character window of the value in any node field or nodes_fts column').toEqual([]);
      expect(told.n, 'exactly one node row was rewritten: the parent that differed (the clean one was left alone)').toBe(1);
      expect(JSON.stringify(ftsOf('he-q')), 'the clean parent\'s index row is as it was').toBe(qBefore);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('H-154: the belt re-rolls the ancestors of a node it rewrote only when they change, so a stale index row alone rewrites no ancestor', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-he154-', [
      { id: 'he-c1', kind: 'native_leaf', pruned: true, gist: 'Clean one.' },
      { id: 'he-c2', kind: 'native_leaf', pruned: true, gist: 'Clean two.' },
      { id: 'he-q', kind: 'condensed', gist: null, kids: ['he-c1', 'he-c2'] },
    ], true);
    try {
      const ftsGist = (id: string): string => (db.prepare('SELECT f.gist AS g FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid WHERE n.node_id = ?').get(id) as { g: string }).g;
      const want = ftsGist('he-c1');
      db.prepare("UPDATE nodes_fts SET gist = 'stale' WHERE rowid = (SELECT rowid FROM nodes WHERE node_id = 'he-c1')").run();
      expect(ftsGist('he-c1'), 'CONTROL: the leaf\'s index row is stale and its fields are clean').toBe('stale');
      const told = { n: 0 };
      const ctx = { ...heCtx(home, v, true), onNodesFtsDeleted: () => { told.n += 1; } };
      setStep(db, 'nodes-belt', 1, '0', null);
      expect(DV.beltNodesStep(db, ctx, SW.newBudget()), 'the step completed').toBe(true);
      expect(ftsGist('he-c1'), 'CONTROL: the stale row was rewritten').toBe(want);
      expect(told.n, 'only the leaf\'s own rewrite touched an index row: its unchanged ancestor was left alone').toBe(1);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('H-155: a node_children row whose child is gone is skipped, so the belt completes and the parent is rebuilt from the children that remain', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-he155-', [
      { id: 'he-c1', kind: 'native_leaf', pruned: true, gist: 'Clean one.' },
      { id: 'he-c2', kind: 'native_leaf', pruned: true, gist: 'Clean two.' },
      { id: 'he-q', kind: 'condensed', gist: null, kids: ['he-c1', 'he-c2'] },
    ], true);
    try {
      const rid = (db.prepare("SELECT rowid AS r FROM nodes WHERE node_id = 'he-c2'").get() as { r: number }).r;
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(rid);
      db.prepare("DELETE FROM nodes WHERE node_id = 'he-c2'").run();
      db.exec('PRAGMA foreign_keys = ON');
      expect(db.prepare('PRAGMA foreign_key_check').all().length, 'CONTROL: the store carries one dangling child').toBe(1);
      const ctx = heCtx(home, v, true);
      setStep(db, 'nodes-belt', 1, '0', null);
      expect(DV.beltNodesStep(db, ctx, SW.newBudget()), 'the step completes over a dangling child').toBe(true);
      expect((db.prepare("SELECT gist FROM nodes WHERE node_id = 'he-q'").get() as { gist: string }).gist, 'the parent is rebuilt from the child that remains').toBe('Clean one.');
      expect(() => DV.rerollParents(db, ctx, ['he-c1']), 'a re-roll over the same parent does not throw either').not.toThrow();
    } finally { closeWriter(db); }
  }, HEAVY);

  it('M2: rerollParents asks for ancestors in chunks of ictx.rerollChunk ids, never one IN list over every seed', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-hefr1d-', heManyParents(v, 5), false);
    try {
      const sqls: string[] = [];
      const spy = new Proxy(db, {
        get(target, prop) {
          const val = Reflect.get(target, prop, target) as unknown;
          if (prop === 'prepare') return (sql: string) => { if (sql.includes('ancestors')) sqls.push(sql); return target.prepare(sql); };
          return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val;
        },
      }) as DatabaseSync;
      const seeds = Array.from({ length: 5 }, (_, i) => `he-v${i}`);
      expect(DV.rerollParents(spy, { ...heCtx(home, v, false), rerollChunk: 2 }, seeds), 'all five parents were re-rolled, once each').toBe(5);
      expect(sqls.map((q) => (q.match(/\?/g) ?? []).length), 'three ancestor queries of 2, 2 and 1 placeholders').toEqual([2, 2, 1]);
      expect(heLeaks(db, v).filter((x) => x.startsWith('he-p')), 'every parent was rebuilt from redacted children').toEqual([]);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('H-156: an ancestor shared by two chunks is re-rolled once, and after the parents below it, whatever chunk reached it first', () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-he156-', [
      ...heManyParents(v, 4),
      { id: 'he-g', kind: 'condensed', gist: null, kids: ['he-p0', 'he-p3'] },
    ], false);
    try {
      db.prepare("UPDATE nodes SET depth = 2 WHERE node_id = 'he-g'").run();
      expect(heLeaks(db, v), 'CONTROL: the grandparent holds a prefix of the value in its topics').toContain('he-g.topics');
      const seeds = Array.from({ length: 4 }, (_, i) => `he-v${i}`);
      expect(DV.rerollParents(db, { ...heCtx(home, v, false), rerollChunk: 2 }, seeds), 'four parents and the shared grandparent, each re-rolled once').toBe(5);
      expect(heLeaks(db, v).filter((x) => x.startsWith('he-p') || x.startsWith('he-g')), 'the grandparent was rolled from re-rolled parents, so nothing leaks').toEqual([]);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('F-a: a parent minted by deriveParents over a child that holds the value is built from redacted children', () => {
    const v = heValue();
    const home = mkTmp('ccrc-hist-hefr1e-');
    createStore(home);
    const db = openWriter(historyPaths(home).dbFile);
    try {
      const lead = Array.from({ length: 7 }, (_, i) => `Leaf ${i + 1}.`).join(' ');
      const gists = [...Array.from({ length: 7 }, (_, i) => `Leaf ${i + 1}.`), `${hePad(1187 - lead.length - 1)}${v} and then more.`];
      db.exec('BEGIN');
      db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, '', 'demo', 1)").run(ID);
      db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (1, 1, ?, 'startup', 'hook', 1)").run(RR_U1);
      db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(RR_U1);
      db.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (1, 1, 9001, 1, 'live', 1)").run();
      db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 9), Buffer.from([0]));
      gists.forEach((gist, i) => {
        const k = i + 1;
        db.prepare("INSERT INTO entries (entry_id, uuid, transcript_pk, type, subtype, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 1, 'system', 'compact_boundary', 'harness', 1, 0, 0, 1, ?)")
          .run(k, `d9e00000-0000-4000-8000-${k.toString(16).padStart(12, '0')}`, 1000 * k);
        db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord) VALUES (?, 1, ?)').run(k, k);
        db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (1, ?, ?)').run(k, k);
        db.prepare("INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics, boundary_entry_id, earliest_ms, latest_ms, src_chars, desc_count, desc_chars, parser_version, created_ms) VALUES (?, 1, 1, 1, 'native_leaf', 0, 'not-requested', ?, '[]', ?, ?, ?, 100, 0, 0, 1, 1)")
          .run(`he-l${k}`, gist, k, 1000 * k, 1000 * k + 500);
      });
      db.exec('COMMIT');
      const raw = parentRollup(gists.map((g) => ({ gist: g, topics: [], refs: [], earliestMs: 1, latestMs: 2, srcChars: 0, descCount: 0, descChars: 0 })));
      expect(raw.gist?.includes(v), 'CONTROL: the unredacted rollup is cut inside the value').toBe(false);
      expect(raw.gist?.includes(v.slice(0, 13)), 'CONTROL: and holds its first 13 characters').toBe(true);
      expect(DV.deriveParents(db, heCtx(home, v, false), SW.newBudget()), 'one parent was minted').toBe(1);
      expect(db.prepare("SELECT count(*) AS n FROM nodes WHERE kind = 'condensed'").get(), 'the parent exists').toEqual({ n: 1 });
      const p = db.prepare("SELECT gist FROM nodes WHERE kind = 'condensed'").get() as { gist: string };
      expect(heHolds(p.gist, v), 'the minted parent holds no 8-character window of the value').toBe(false);
    } finally { closeWriter(db); }
  }, HEAVY);

  it('F-b: reparse --apply registers the merge step, so a rewritten nodes_fts row is merged by the next tick', () => {
    const box = makeHistoryBox('ccrc-hist-hefr1f-', { role: 'fleet' });
    plantSession(box, ID, { uuid: RR_U1, generation: RR_G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, RR_U1, rrCompacted(RR_U1, 1, 'Rotating the fixture credential before the release.'));
    spoolLine(box, ID, rrStart(ID, RR_U1, 'startup', { reg: RR_U1, gen: RR_G1 }));
    const pending = (): number => rrQ<{ n: number }>(box, "SELECT count(*) AS n FROM derivation_state WHERE step = 'fts-merge' AND version = 1 AND completed_ms IS NULL")[0]!.n;
    rrTickUntil(box, () => rrLeafIds(box).length === 1 && pending() === 0, 12);
    const r = runShim(box, ['--op', 'reparse', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(pending(), 'the reparse rewrote the leaf\'s nodes_fts row and registered the merge step pending').toBe(1);
    rrTickUntil(box, () => rrStepDone(box, 'fts-merge', 1), 6);
  }, 2 * HEAVY);

  it('F-c: a recovery rebuilds a parent without a ref that is already stored as the mark, whatever the order of the passes', async () => {
    const v = heValue();
    const { db, home } = heStore('ccrc-hist-hefr1g-', [
      { id: 'he-k1', kind: 'native_leaf', pruned: true, gist: 'Plain one.', refs: ['[redacted]'] },
      { id: 'he-k2', kind: 'native_leaf', pruned: true, gist: 'Plain two.' },
      { id: 'he-p', kind: 'condensed', gist: null, kids: ['he-k1', 'he-k2'] },
    ], false);
    try {
      const pair = secretPairs([v]).pairs[0]!;
      db.prepare('INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, 1)').run(pair.len, Buffer.from(pair.sha256, 'hex'));
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', 5, NULL, NULL)").run();
      const markRefs = (): unknown[] => db.prepare("SELECT node_id FROM node_refs WHERE value = '[redacted]' ORDER BY node_id").all();
      expect(markRefs(), 'CONTROL: the child and the parent both store the mark as a ref').toEqual([{ node_id: 'he-k1' }, { node_id: 'he-p' }]);
      const ctx = { home, homes: [], ids: null, now: () => Date.now(), budget: SW.newBudget(), belt: null };
      let done = false;
      for (let i = 0; i < 20 && !done; i += 1) done = (await SW.recoverReindex(db, ctx, { pairsAdded: true }, SW.newBudget())).done;
      expect(done, 'the reindex phase completed').toBe(true);
      expect(markRefs().map((x) => (x as { node_id: string }).node_id), 'the parent stores no ref with the mark as its value').not.toContain('he-p');
    } finally { closeWriter(db); }
  }, HEAVY);
});

// ── W1-B2 Task 34: DM48's rebuild clause, with Tasks 27 and 28's rr helpers (spec §6.1, §9.14; ruled Q16) ──────
describe('DM48: a fork epoch comes back from the journal (W1-B2 Task 34)', () => {
  it('a startup, an in-pane /branch fork confirmed by the observation, and a same-id fork are rebuilt equal by O35\'s columns, with the registry purged', async () => {
    const box = makeHistoryBox('ccrc-hist-dm48r-', { role: 'fleet' });
    expect(runShim(box).code).toBe(0);                  // binds the store; its scan finds an empty registry, so none runs below
    const FID = 'claude-a-fork';
    const P = 'a8a8a8a8-0000-4000-8000-000000000481';       // the parent
    const F = 'a8a8a8a8-0000-4000-8000-000000000482';       // the fork
    const G = '0189abcd-1234-4678-9abc-000000000480';
    plantSession(box, FID, { uuid: P, generation: G, project: 'demo' });
    spoolLine(box, FID, { v: 1, ev: 'SessionStart', id: FID, sid: P, src: 'startup', reg: P, gen: G });
    rrTickUntil(box, () => rrEpochs(box, FID).length === 1);
    spoolLine(box, FID, { v: 1, ev: 'SessionStart', id: FID, sid: F, src: 'fork', reg: P, gen: G });
    plantSession(box, FID, { uuid: F });                // _sync_uuid moves .uuid before the rename
    rrTickUntil(box, () => rrEpochs(box, FID).length === 2);
    spoolLine(box, FID, { v: 1, ev: 'SessionStart', id: FID, sid: F, src: 'fork', reg: F, gen: G });
    rrTickUntil(box, () => countOf(box, 'spool_receipts') === 3);
    expect(rrEpochs(box, FID).map((e) => [e.seq, e.cc_session_uuid, e.cause])).toEqual([[1, P, 'startup'], [2, F, 'fork']]);
    const a = rrState(box);
    fs.rmSync(box.reg, { recursive: true, force: true });
    fs.mkdirSync(box.reg);
    rrLose(box, { binding: false, journal: false });
    const r = await cliOnPty(box, ['doctor', '--rebuild']);
    expect(r.code, r.out).toBe(0);
    rrTickUntil(box, () => rrRecovered(box), 10);
    const b = rrState(box);
    expect(b.sessions).toEqual(a.sessions);
    expect(b.epochs, 'the fork epoch, back by O35\'s columns').toEqual(a.epochs);
    expect(b.receipts).toEqual(a.receipts);
  }, 2 * HEAVY);
});
