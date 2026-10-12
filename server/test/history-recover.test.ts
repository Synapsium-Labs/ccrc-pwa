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
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as pty from 'node-pty';
import {
  makeHistoryBox, runSweep, runShim, runDriver, skipOnDarwin, openStoreRO, counters, journalRecords, plantSession,
  plantTranscript, spoolLine, preloadOptions, PRELOADS, CLI, recoverRow, boundEmptyStore,
  runCli, withPane, seedFamily, journalDirOf, type HistoryBox,
} from './historyHelpers.js';
import { userRow } from './historyFixtures.js';
import { removeTmpFixturesEachTest, mkTmp } from './tmpHelpers.js';
import {
  HEALTH_META, RECOVER_PHASES, RECOVERY_STALL_TICKS, SCHEMA_VERSION, WRITING_FORMS, floorThreshold, historyPaths, journalRecord, mergeJournalByTime,
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
