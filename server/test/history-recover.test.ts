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
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
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
  REDACTED_MARK, BELT_VERSION, parseBeltState,
} from '../../ccd/history/lib.mjs';
import { closeWriter, createStore, getMeta, openWriter, setMeta } from '../../ccd/history/store.mjs';

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
    { pairs: Array<{ len: number; sha256: string; t: number }>; skipped: string[] };
}
let SW: SweepRecover;
beforeAll(async () => { SW = (await import('../../ccd/history/sweep.mjs')) as unknown as SweepRecover; });

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
      const mid = new RegExp(`^apply:${M}\\.aaaaaaaa\\.jsonl:[1-5]$`);
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
      expect([...got.skipped].sort(), 'each skipped file is named, never skipped silently (a foreign head, and a file journalListing lists as unreadable)')
        .toEqual([`${M}.feedbee2.jsonl`, `${M}.feedbee3.jsonl`]);
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
    const shim = await shimOnPty(box, ['--op', 'adopt']);
    expect(lastRc(shim.out)).toEqual({ rc: 2, reason: 'adopt-refused' });
    expect(shim.out.replace(/\r/g, '')).toContain('adopt it with the build that wrote it');
    expect(ccrcSnapshot(box)).toEqual(before);
    expect(fs.existsSync(P.storeId)).toBe(false);
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
    const refused = async (args: string[], why: string, env: Record<string, string> = {}): Promise<void> => {
      const before = ccrcSnapshot(box);
      const r = await shimOnPty(box, ['--op', 'restore', ...args], env);
      expect(lastRc(r.out), `${why}\n${r.out}`).toEqual({ rc: 2, reason: 'restore-refused' });
      expect(ccrcSnapshot(box), `${why}: nothing written`).toEqual(before);
    };
    // The name: never a path, never a temp, never a link.
    await refused([`sub/${name}`], 'a name with /');
    fs.copyFileSync(path.join(P.backups, name), path.join(P.backups, `.${name}.tmp`));
    await refused([`.${name}.tmp`], 'a .tmp');
    fs.symlinkSync(path.join(P.backups, name), path.join(P.backups, '20200101T000000Z.db'));
    await refused(['20200101T000000Z.db'], 'a symlink');
    // An old store's WAL with no DB would be replayed into the restored file (RC1).
    fs.writeFileSync(P.wal, '');
    await refused([name], 'a leftover history.db-wal');
    fs.rmSync(P.wal);
    fs.writeFileSync(P.storeId, '0189abcd-1234-4678-9abc-0000000000ff\n', { mode: 0o600 });
    await refused([name], 'store.id names another store');
    fs.rmSync(P.storeId);
    fs.copyFileSync(path.join(P.backups, name), path.join(P.backups, '20200101T000001Z.db'));
    rrSetUserVersion(path.join(P.backups, '20200101T000001Z.db'), 2);
    await refused(['20200101T000001Z.db'], 'a newer user_version');
    fs.copyFileSync(path.join(P.backups, name), path.join(P.backups, '20200101T000002Z.db'));
    rrCorruptIndex(path.join(P.backups, '20200101T000002Z.db'));
    await refused(['20200101T000002Z.db'], 'a failed integrity_check');
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
    await refused([name], 'a DB present');
  }, 2.5 * HEAVY);
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
    const r = await shimOnPty(box, ['--op', 'rebuild', ...args]);
    expect(lastRc(r.out), `${why}\n${r.out}`).toEqual({ rc: 2, reason: 'rebuild-refused' });
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
    const r = await shimOnPty(box, ['--op', 'rebuild', '--store-id', T]);
    expect(lastRc(r.out), r.out).toEqual({ rc: 0 });
    rrExpectBound(box, T, 'rebuild', null);
  }, HEAVY);

  it('each refusal answers rebuild-refused and writes nothing: a DB present, a leftover history.db-wal, store.id and --store-id disagreeing, a --store-id naming no directory, a directory whose heads name another store, and neither source', async () => {
    const { box, storeId } = rrBuilt('ccrc-hist-c58d-');
    const P = rrRoot(box);
    await refused(box, [], 'a DB present');
    rrLose(box, { binding: false, journal: false });
    fs.writeFileSync(P.wal, '');
    await refused(box, [], 'a leftover history.db-wal');
    fs.rmSync(P.wal);
    const T = '0189abcd-1234-4678-9abc-0000000000d8';
    plantDir(box, T);
    await refused(box, ['--store-id', T], 'store.id and --store-id disagree');
    fs.rmSync(path.join(P.journalDir, T), { recursive: true });
    fs.rmSync(P.storeId);
    fs.rmSync(P.writer);
    await refused(box, ['--store-id', '0189abcd-1234-4678-9abc-0000000000d9'], 'a --store-id naming no directory');
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
