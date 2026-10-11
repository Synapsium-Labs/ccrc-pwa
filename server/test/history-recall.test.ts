// server/test/history-recall.test.ts — the read verbs of `ccrc history` (W1-B2), run as a session runs them
// (spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.1–§8.4, §8.8, §8.9).
//
// Task 10 creates this file and pins:
//   - C1, C2, C3, C4 (its no-pane half), C36's read-verb rows, C41, C48, C54, C56, C65;
//   - C66's B2 half and DM18b's CLI half.
// Later tasks append their own describes below.
//
// How a case runs the CLI: a child on process.execPath with --no-warnings, with HOME a makeHistoryBox fixture.
//   - The fixture poisons tmux, gh, ssh, curl and the managers, and scrubs CLAUDECODE, TMUX, TMUX_PANE,
//     CCRC_SESSION_GENERATION and CCRC_RECALL_*.
//   - The statfs preload decides free space.
//   - Where a case needs an identity, withPane's working tmux answers `cc-<id>` for TMUX_PANE=%1.
// Spawning describes skip on darwin (O24), except §8.3's Darwin row. The pure describe runs everywhere.
// DatabaseSync, plantTranscript and SEED_SLUG are imported here for Task 11's describe, which writes a store row
// and plants a second copy of a transcript.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  makeHistoryBox, runSweep, runCli, withPane, sleepyTmux, seedFamily, plantSession, plantTranscript, spoolLine, counters,
  openStoreRO, preloadOptions, PRELOADS, CLI, REPO, SEED_SLUG, type HistoryBox,
} from './historyHelpers.js';
import { userRow, assistantRow, boundaryRow, summaryRow, type Row } from './historyFixtures.js';
import * as libRead from '../../ccd/history/lib.mjs';
import * as rH from './historyHelpers.js';
import * as rFx from './historyFixtures.js';
import { DatabaseSync as RDatabaseSync } from 'node:sqlite';
import type { GrepArgs as RGrepArgs } from '../../ccd/history/lib.mjs';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const ID = 'claude-a-demo';
const ID_B = 'claude-b-demo';
const PROJECT = 'demo';
const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
const G2 = '0189abcd-1234-4678-9abc-0123456789ac';
const TA = 'a1a1a1a1-1111-4111-8111-111111111111';
const TB = 'b2b2b2b2-2222-4222-8222-222222222222';
const U9 = '99999999-9999-4999-8999-999999999999';
const LIB = path.join(REPO, 'ccd', 'history', 'lib.mjs');
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
/** A case that seeds stores and spawns the CLI several times runs past vitest's 20 s default. */
const HEAVY = 120_000;

/** A row uuid: the transcript's first eight hex digits and a counter. Two transcripts never share one, because
 *  entries.uuid is store-wide (§6.1). */
const rid = (transcript: string, n: number): string => `${transcript.slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const iso = (k: number): string => new Date(T0 + k * 1000).toISOString();

/** `n` plain turns, each a question and its answer: no compaction, so no node. */
function turns(transcript: string, n: number, cwd = '/home/u/worktrees/p/quiet-basin'): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= n; i += 1) {
    rows.push(userRow({ uuid: rid(transcript, 2 * i - 1), ts: iso(2 * i - 1), sessionId: transcript, cwd, text: `fixture question ${i}` }));
    rows.push(assistantRow({ uuid: rid(transcript, 2 * i), ts: iso(2 * i), sessionId: transcript, cwd, text: `Fixture answer ${i}.`,
      requestId: `req_${transcript.slice(0, 8)}_${i}`, msgId: `msg_${transcript.slice(0, 8)}_${i}` }));
  }
  return rows;
}

/** `n` manual compactions, each cycle being a turn, its answer, a kept follow-up, the boundary and its summary
 *  row. The summary names Current Work and Optional Next Step, so each native leaf has a gist. */
function cycles(transcript: string, n: number): Row[] {
  const rows: Row[] = [];
  const cwd = '/home/u/worktrees/p/quiet-basin';
  let k = 0;
  for (let c = 1; c <= n; c += 1) {
    const u = rid(transcript, ++k); const a = rid(transcript, ++k); const x = rid(transcript, ++k);
    const b = rid(transcript, ++k); const s = rid(transcript, ++k);
    const base = { sessionId: transcript, cwd };
    rows.push(userRow({ ...base, uuid: u, ts: iso(5 * c), text: `fixture request ${c}` }));
    rows.push(assistantRow({ ...base, uuid: a, ts: iso(5 * c + 1), text: `Fixture answer ${c}.`, requestId: `req_c_${c}`, msgId: `msg_c_${c}` }));
    rows.push(userRow({ ...base, uuid: x, ts: iso(5 * c + 2), text: `fixture follow-up ${c}` }));
    rows.push(boundaryRow({ ...base, uuid: b, ts: iso(5 * c + 3), trigger: 'manual', headUuid: x, anchorUuid: s, tailUuid: x, allUuids: [x] }));
    rows.push(summaryRow({ ...base, uuid: s, ts: iso(5 * c + 4), text: [
      'This session is being continued from a previous conversation. The summary below covers the earlier portion.',
      '<summary>', '1. Primary Request and Intent:', `   Fixture request ${c}.`,
      '8. Current Work:', `   Wrote part ${c} of the fixture.`,
      '9. Optional Next Step:', `   Continue with part ${c + 1}.`, '</summary>',
    ].join('\n') }));
  }
  return rows;
}

const hist = (box: HistoryBox, ...p: string[]): string => path.join(box.root, ...p);
const storeIdOf = (box: HistoryBox): string => fs.readFileSync(hist(box, 'store.id'), 'utf8').trim();
function boundBox(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix);
  const r = runSweep(box);
  expect(r.code, r.stderr).toBe(0);
  return box;
}
type CliRun = ReturnType<typeof runCli>;
/** `ccrc history tree [args] --json` from the pane of `id`. */
const treeJson = (box: HistoryBox, id = ID, args: string[] = [], env: Record<string, string> = {}): CliRun =>
  runCli(box, ['tree', ...args, '--json'], { env: { ...withPane(box, id), ...env } });
const answer = (r: CliRun): unknown[] => [r.code, r.json?.['reason']];
interface ScopeJson { kind: string; families: { ccrc_id: string; generation: string; first_seen_ms: number }[]; transcripts: number }
const scopeOf = (r: CliRun): ScopeJson => r.json?.['scope'] as ScopeJson;

/** Adds confirmed, node-free epochs after the seeded family epoch. The headings, rather than node text,
 * supply cap pressure for the empty-tree continuation cases. */
function seedEmptyEpochs(box: HistoryBox, count: number): void {
  const db = new DatabaseSync(hist(box, 'db', 'history.db'));
  try {
    const family = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID, G1) as { session_pk: number };
    const start = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM epochs WHERE session_pk = ?').get(family.session_pk) as { seq: number };
    const insert = db.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let n = 1; n <= count; n += 1) {
      const hex = n.toString(16).padStart(7, '0');
      insert.run(family.session_pk, start.seq + n, `f${hex}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`, `fixture-empty-${n}`, 'fixture', T0 + n, T0 + n);
    }
  } finally { db.close(); }
}

/** A direct, confirmed root node for output-cap tests. It keeps the test focused on rendering: derivation is
 * separately covered above, while this test controls both root cardinality and gist representation precisely. */
function seedRoots(box: HistoryBox, count: number, gist: (n: number) => string): string[] {
  seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
  const db = new DatabaseSync(hist(box, 'db', 'history.db'));
  try {
    const family = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID, G1) as { session_pk: number };
    const epoch = db.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL ORDER BY seq LIMIT 1').get(family.session_pk) as { seq: number };
    const transcript = db.prepare('SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ?').get(TA) as { transcript_pk: number };
    const insert = db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics,
      summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars,
      directive_flag, capped, parser_version, created_ms)
      VALUES (?, ?, ?, ?, 'native_leaf', 0, 'fixture', ?, NULL, NULL, NULL, NULL, ?, ?, 0, 0, 0, 0, 0, 1, ?)`);
    const ids: string[] = [];
    for (let n = 1; n <= count; n += 1) {
      const id = `L${n.toString(16).padStart(20, '0')}`;
      ids.push(id);
      insert.run(id, family.session_pk, epoch.seq, transcript.transcript_pk, gist(n), T0 + n, T0 + n, Date.now());
    }
    return ids;
  } finally { db.close(); }
}

describe('C36, the Darwin row: a read verb answers 9 natively on macOS', () => {
  it.runIf(process.platform === 'darwin')('tree on macOS answers 9 before any identity', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-darwin-');
    const r = runCli(box, ['tree', '--json']);
    expect(r.code).toBe(9);
    expect(r.json?.['coverage']).toBe('this-box');
  });
});

describe('the read verbs\' pure halves: parseReadArgs, selectColumns, decideRecallOffPreflight (W1-B2 Task 10)', () => {
  const parse = libRead.parseReadArgs;
  const bad = { ok: false, reason: 'bad-args' };

  it('C41: --limit is capped at GREP_LIMIT_MAX; an unknown, repeated or value-less option is bad-args', () => {
    expect(parse('grep', ['x', '--limit', String(libRead.GREP_LIMIT_MAX)]).ok).toBe(true);
    expect(parse('grep', ['x', '--limit', '500'])).toEqual(bad);
    expect(parse('grep', ['x', '--limit', '0'])).toEqual(bad);
    expect(parse('grep', ['x', '--limit'])).toEqual(bad);
    expect(parse('grep', ['x', '--limit', '1e2'])).toEqual(bad);
    expect(parse('grep', ['x', '--sort', 'newest'])).toEqual(bad);
    expect(parse('grep', ['x', '--bogus'])).toEqual(bad);
    expect(parse('grep', ['x', '--role', 'user', '--role', 'assistant'])).toEqual(bad);
  });

  it('defaults, positional rules, and `--` ending the options', () => {
    const g = parse('grep', ['x']);
    expect(g.ok && g.opts).toMatchObject({ json: false, session: null, sort: libRead.GREP_SORTS[0], limit: libRead.GREP_LIMIT_DEFAULT, includeRecall: false, regex: null });
    expect(parse('grep', [])).toEqual(bad);
    expect(parse('grep', ['--regex', 'a.*b']).ok).toBe(true);
    const dashed = parse('grep', ['--', '--force']);
    expect(dashed.ok && dashed.positional).toEqual(['--force']);
    const t = parse('tree', []);
    expect(t.ok && t.opts['depth']).toBe(libRead.TREE_DEPTH_DEFAULT);
    expect(parse('tree', ['--depth', String(libRead.TREE_DEPTH_MAX + 1)])).toEqual(bad);
    expect(parse('tree', ['x'])).toEqual(bad);
    expect(parse('describe', [])).toEqual(bad);
    const d = parse('describe', ['History:', 'node', 'L03a9c1']);
    expect(d.ok && d.positional).toEqual(['History:', 'node', 'L03a9c1']);
    expect(parse('expand', [])).toEqual(bad);
    expect(parse('expand', ['--around', rid(TA, 1)]).ok).toBe(true);
    expect(parse('expand', ['x', '--before', String(libRead.AROUND_MAX + 1)])).toEqual(bad);
    expect(parse('tree', ['--session', '..']).ok, 'the id grammar is decideScope\'s, after the parse').toBe(true);
    expect(parse('touched', [])).toEqual(bad);
    expect([...libRead.READ_VERBS]).toEqual(['grep', 'describe', 'expand', 'tree']);
  });

  it('selectColumns names what the store\'s version has and NULLs what it lacks; an unknown table or column throws', () => {
    expect(libRead.selectColumns(1, 'nodes', ['node_id', 'gist'])).toBe('node_id, gist');
    expect(libRead.selectColumns(1, 'nodes', ['node_id'], libRead.SCHEMA_ADDED, 'n')).toBe('n.node_id');
    const seam = { ...libRead.SCHEMA_ADDED, 2: { heavy: false, tables: { nodes: ['seam_col'] } } };
    expect(libRead.selectColumns(1, 'nodes', ['node_id', 'seam_col'], seam)).toBe('node_id, NULL AS seam_col');
    expect(libRead.selectColumns(2, 'nodes', ['node_id', 'seam_col'], seam)).toBe('node_id, seam_col');
    expect(() => libRead.selectColumns(1, 'no_such_table', ['x'])).toThrow(TypeError);
    expect(() => libRead.selectColumns(1, 'nodes', ['no_such_col'])).toThrow(TypeError);
  });

  it('decideRecallOffPreflight: the id grammar first, then the generation read, then W2\'s word', () => {
    const pre = libRead.decideRecallOffPreflight;
    expect(pre({ args: ['../x', '--clear'], generation: null })).toEqual({ done: true, exit: 2, reason: 'bad-id' });
    expect(pre({ args: [ID], generation: null })).toEqual({ done: false, id: ID });
    expect(pre({ args: [ID], generation: { state: 'unreadable' } })).toEqual({ done: true, exit: 2, reason: 'generation-unreadable' });
    expect(pre({ args: [ID, '--clear'], generation: { state: 'value', value: G1 } })).toEqual({ done: true, exit: 2, reason: 'bad-args' });
    expect(pre({ args: [ID], generation: { state: 'absent' } })).toEqual({ done: true, exit: 2, reason: 'bad-args' });
    expect(pre({ args: ['--clear-all'], generation: null })).toEqual({ done: true, exit: 2, reason: 'bad-args' });
    expect(pre({ args: [], generation: null })).toEqual({ done: true, exit: 2, reason: 'bad-args' });
    expect(pre({ args: [ID, '--bogus'], generation: null })).toEqual({ done: true, exit: 2, reason: 'bad-args' });
  });
});

describe('the read verbs: identity, §8.3\'s table, the read-only handle, the family (W1-B2 Task 10)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('C4 (no-pane half): with no TMUX_PANE a read verb answers 2 no-identity and never asks tmux', () => {
    const box = boundBox('ccrc-hist-rcl-c4-');
    withPane(box, ID);   // a working tmux IS on PATH: the refusal is the missing pane
    const r = runCli(box, ['tree', '--json']);
    expect(answer(r)).toEqual([2, 'no-identity']);
    expect(fs.existsSync(path.join(box.home, 'tmux-calls'))).toBe(false);
    const malformed = runCli(box, ['tree', '--json'], { env: { ...withPane(box, ID), TMUX_PANE: '-x' } });
    expect(answer(malformed)).toEqual([2, 'no-identity']);
    expect(fs.existsSync(path.join(box.home, 'tmux-calls'))).toBe(false);
  });

  it('C3: the identity is `tmux display-message -p -t "$TMUX_PANE" \'#S\'`, and only a cc- name is one', () => {
    const box = boundBox('ccrc-hist-rcl-c3-');
    const ok = treeJson(box);
    expect(ok.code, `${ok.stderr}${ok.stdout}`).toBe(6);   // an identity, a bound store, no family yet
    expect(fs.readFileSync(path.join(box.home, 'tmux-calls'), 'utf8').trim().split('\n')).toEqual(['display-message -p -t %1 #S']);
    const bad = runCli(box, ['tree', '--json'], { env: withPane(box, ID, { name: ID }) });
    expect(answer(bad)).toEqual([2, 'no-identity']);
  });

  it('C65: a tmux that never answers is killed at the bound: 2 no-identity, well inside the spawn cap', () => {
    const box = boundBox('ccrc-hist-rcl-c65-');
    const r = runCli(box, ['tree', '--json'], { env: sleepyTmux(box, 30) });
    expect(answer(r)).toEqual([2, 'no-identity']);
    // TMUX_DEADLINE_MS is 2000. The other 4 s allow for node's start and the stub's on a loaded box: an allowance,
    // not a measurement. A deadline raised to 8 s reds here, and so does no deadline at all (Step 9, review R28).
    expect(r.ms, 'TMUX_DEADLINE_MS is 2000').toBeLessThan(6_000);
  }, HEAVY);

  it('C36: §8.3\'s table, row by row, through tree in a pane', () => {
    const ask = (b: HistoryBox): unknown[] => answer(treeJson(b));
    const server = boundBox('ccrc-hist-rcl-c36a-');
    fs.writeFileSync(path.join(server.home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    expect(ask(server), 'a recorded server role, with a stale shim, store.id and DB').toEqual([9, undefined]);
    expect(ask(makeHistoryBox('ccrc-hist-rcl-c36b-', { shim: false })), 'never installed').toEqual([9, undefined]);
    const shimOnly = makeHistoryBox('ccrc-hist-rcl-c36c-');
    expect(ask(shimOnly), 'the first tick has not created the store').toEqual([6, undefined]);
    fs.mkdirSync(hist(shimOnly, 'journal', U9), { recursive: true });
    expect(ask(shimOnly)).toEqual([5, 'store-recoverable']);
    const wal = makeHistoryBox('ccrc-hist-rcl-c36d-');
    fs.mkdirSync(hist(wal, 'db'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(hist(wal, 'db', 'history.db-wal'), '');
    expect(ask(wal)).toEqual([5, 'store-wal-orphaned']);
    const missing = boundBox('ccrc-hist-rcl-c36e-');
    for (const f of ['history.db', 'history.db-wal', 'history.db-shm']) fs.rmSync(hist(missing, 'db', f), { force: true });
    expect(ask(missing)).toEqual([5, 'store-missing']);
    expect(ask(boundBox('ccrc-hist-rcl-c36f-')), 'a bound store holding no row of this family').toEqual([6, undefined]);
    const zero = boundBox('ccrc-hist-rcl-c36g-');
    for (const f of ['history.db-wal', 'history.db-shm']) fs.rmSync(hist(zero, 'db', f), { force: true });
    fs.truncateSync(hist(zero, 'db', 'history.db'), 0);
    expect(ask(zero)).toEqual([5, 'store-zero-byte']);
    expect(fs.statSync(hist(zero, 'db', 'history.db')).size, 'never opened, never written').toBe(0);
  }, HEAVY);

  it('C1: the handle is read-only: a write through it throws; a shim-only box answers 6 and creates no file', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c1-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    const probe = [
      `const lib = await import(${JSON.stringify(pathToFileURL(LIB).href)});`,
      `const cli = await import(${JSON.stringify(pathToFileURL(CLI).href)});`,
      "const rc = await cli.readContext(process.env.HOME, 'tree', lib.parseReadArgs('tree', []));",
      "if (!('db' in rc)) { process.stdout.write(JSON.stringify({ out: 'refused', rc })); process.exit(0); }",
      "let out = 'wrote';",
      "try { rc.db.exec(\"INSERT INTO meta (k, v) VALUES ('c1-probe', 'x')\"); } catch (e) { out = 'threw: ' + e.message; }",
      'rc.db.close();',
      'process.stdout.write(JSON.stringify({ out }));',
      'process.exit(0);',
    ].join('\n');
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', probe], {
      cwd: box.home, encoding: 'utf8',
      env: { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), ...withPane(box, ID) },
    });
    expect(r.status, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { out: string }).out).toMatch(/^threw: .*readonly/);
    const db = openStoreRO(box);
    try {
      expect(db.prepare("SELECT v FROM meta WHERE k = 'c1-probe'").get()).toBeUndefined();
    } finally {
      db.close();
    }
    const fresh = makeHistoryBox('ccrc-hist-rcl-c1b-');
    expect(treeJson(fresh).code).toBe(6);
    expect(fs.existsSync(hist(fresh, 'db')), 'no DB and no db/ directory is created').toBe(false);
  }, HEAVY);

  it('C2: the read-only open works with the WAL sidecars absent, and any sidecar it makes is 0600 under umask 0002', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c2-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    // seedFamily ends with atEndOfFile's read-only open, which creates -wal and -shm and cannot remove them (B1
    // Task 12, measured). The sole writer closes last: one more tick checkpoints and unlinks both.
    expect(runSweep(box).code).toBe(0);
    for (const f of ['history.db-wal', 'history.db-shm']) expect(fs.existsSync(hist(box, 'db', f)), `${f}: the sweep closed cleanly`).toBe(false);
    const r = spawnSync('bash', ['-c', 'umask 0002; exec "$0" "$@"', process.execPath, '--no-warnings', CLI, 'tree', '--json'], {
      cwd: box.home, encoding: 'utf8',
      env: { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), ...withPane(box, ID) },
    });
    expect(r.status, r.stderr).toBe(0);
    for (const f of ['history.db', 'history.db-wal', 'history.db-shm']) {
      if (fs.existsSync(hist(box, 'db', f))) expect((fs.statSync(hist(box, 'db', f)).mode & 0o777).toString(8), f).toBe('600');
    }
  }, HEAVY);

  it('C54 + C67 (harness half): a harness with no table row is 2 harness-unsupported, never 6; unreadable is harness-unreadable; absent reads as claude-code', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c54-');   // shim only: §8.3's table alone would answer 6
    const harness = path.join(box.reg, `${ID}.harness`);
    fs.writeFileSync(harness, 'codex');
    expect(answer(treeJson(box))).toEqual([2, 'harness-unsupported']);
    fs.rmSync(harness);
    fs.mkdirSync(harness);   // present, and no read of it succeeds
    expect(answer(treeJson(box))).toEqual([2, 'harness-unreadable']);
    fs.rmdirSync(harness);
    expect(answer(treeJson(box)), 'absent: claude-code, and the table answers').toEqual([6, undefined]);
    const seeded = makeHistoryBox('ccrc-hist-rcl-c54b-');
    seedFamily(seeded, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    fs.writeFileSync(path.join(seeded.reg, `${ID}.harness`), 'claude-code');
    expect(treeJson(seeded).code).toBe(0);
  }, HEAVY);

  it('C56: a stat of db/history.db that never settles answers 5 store-unreachable inside the 2 s bound, naming the store, and no DB open is attempted', async () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c56-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    // §8.9's C56 also says "no DB open is attempted". The stat seam hangs fs.promises.stat only, so a SQLite open
    // would go unseen. The DB path is therefore made a directory: B1's openReader refuses that at once, before any
    // SQLite handle, with store-unmeasured. An open anywhere before the stat would answer that word, never
    // store-unreachable (review R28).
    const dbFile = hist(box, 'db', 'history.db');
    fs.renameSync(dbFile, `${dbFile}.aside`);
    fs.mkdirSync(dbFile);
    const store = (await import('../../ccd/history/store.mjs')) as unknown as { openReader(p: string): { close(): void } };
    expect(() => store.openReader(dbFile), 'CONTROL: an open of the planted path refuses').toThrow(/not a regular file/);
    const r = treeJson(box, ID, [], { HISTORY_TEST_STAT_HANG: 'history.db' });
    expect(answer(r)).toEqual([5, 'store-unreachable']);
    expect(r.json?.['store_id']).toBe(storeIdOf(box));
    // CLI_STAT_DEADLINE_MS is 2000. The other 4 s allow for node's start, the preload and the tmux stub on a loaded
    // box: an allowance, not a measurement. A deadline raised to 8 s reds here (Step 9).
    expect(r.ms, 'CLI_STAT_DEADLINE_MS is 2000').toBeLessThan(6_000);
  }, HEAVY);

  it('F11 (read verbs): a failed read of an admitted store is ONE exit-5 answer, store-read-failed with its store_id, as status gives; a TypeError stays exit 1', () => {
    // B1's rule for status (review 316 F11, history-cli.test.ts's RF5b F11 and M30 cases), for tree. The tables are
    // dropped with foreign keys off, so a derived row never blocks the drop.
    const drop = (b: HistoryBox, table: string): void => {
      const db = new DatabaseSync(hist(b, 'db', 'history.db'), { enableForeignKeyConstraints: false });
      try { db.exec(`DROP TABLE ${table}`); } finally { db.close(); }
    };
    // readContext's own read: the pair index's table is gone.
    const box = makeHistoryBox('ccrc-hist-rcl-f11a-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    drop(box, 'redact_hashes');
    const r = treeJson(box);
    expect(answer(r), r.stderr).toEqual([5, 'store-read-failed']);
    expect(r.stdout.trim().split('\n'), 'one answer').toHaveLength(1);
    expect(r.json?.['store_id']).toBe(storeIdOf(box));
    expect(r.json?.['coverage']).toBe('this-box');
    expect(r.stderr).toContain('no such table: redact_hashes');
    const human = runCli(box, ['tree'], { env: withPane(box, ID) });
    expect(human.code, human.stderr).toBe(5);
    expect(human.stdout).toContain('exit 5 store-read-failed');
    // A plain TypeError out of the same read is a defect: exit 1, no answer, never store-read-failed.
    const defect = runCli(box, ['tree', '--json'], {
      preloads: [PRELOADS.faults], env: { ...withPane(box, ID), HISTORY_TEST_THROW_PREPARE: 'TypeError@FROM redact_hashes' },
    });
    expect(defect.code, defect.stderr).toBe(1);
    expect(defect.stdout.trim(), 'no answer for a defect').toBe('');
    expect(defect.stderr).toContain('ccrc history: internal error: fixture-planted');
    expect(defect.stderr).not.toContain('store-read-failed');
    // The verb's own read (runTree's nodes select), past readContext: the same ONE answer.
    const verb = makeHistoryBox('ccrc-hist-rcl-f11b-');
    seedFamily(verb, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    drop(verb, 'nodes');
    const v = treeJson(verb);
    expect(answer(v), v.stderr).toEqual([5, 'store-read-failed']);
    expect(v.stdout.trim().split('\n'), 'one answer').toHaveLength(1);
    expect(v.json?.['store_id']).toBe(storeIdOf(verb));
    expect(v.stderr).toContain('no such table: nodes');
  }, HEAVY);

  it('C66 (B2 half): an id off ccd\'s grammar is bad-id before any path is formed from it', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c66-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    expect(answer(treeJson(box, ID, ['--session', '..']))).toEqual([2, 'bad-id']);
    const victim = hist(box, 'x');   // where recall-off/../x would land
    fs.writeFileSync(victim, 'keep');
    const ro = runCli(box, ['recall-off', '../x', '--clear', '--json']);
    expect(answer(ro)).toEqual([2, 'bad-id']);
    expect(fs.readFileSync(victim, 'utf8'), 'nothing unlinked, nothing written').toBe('keep');
    fs.mkdirSync(path.join(box.reg, `${ID_B}.generation`));
    expect(answer(runCli(box, ['recall-off', ID_B, '--json'])), 'C67\'s recall-off clause').toEqual([2, 'generation-unreadable']);
    expect(answer(runCli(box, ['recall-off', ID, '--json'])), 'the writing verb ships with W2').toEqual([2, 'bad-args']);
  }, HEAVY);

  it('C48: with no CCRC_SESSION_GENERATION and $REG/<id>.generation = G, the scope is (id, G), not the newest family', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c48-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    seedFamily(box, { id: ID, project: PROJECT, uuid: TB, generation: G2, rows: turns(TB, 2) });
    plantSession(box, ID, { generation: G1 });
    const older = treeJson(box);
    expect(older.code, `${older.stderr}${older.stdout}`).toBe(0);
    expect(scopeOf(older).families.map((f) => f.generation)).toEqual([G1]);
    plantSession(box, ID, { generation: G2 });
    expect(scopeOf(treeJson(box)).families.map((f) => f.generation)).toEqual([G2]);
    const viaEnv = treeJson(box, ID, [], { CCRC_SESSION_GENERATION: G1 });
    expect(scopeOf(viaEnv).families.map((f) => f.generation), 'the env generation comes first').toEqual([G1]);
  }, HEAVY);

  it('DM18b (CLI half): after a re-key merged the gen-less family into (id, G), default recall answers 0 on (id, G), never 6, and reads the nodes derived before the merge', () => {
    // Review focus 4: the '' family's leaves and parent are derived BEFORE the re-key, then merged into (id, G).
    const box = makeHistoryBox('ccrc-hist-rcl-dm18b-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: null, rows: cycles(TA, 8) });   // the '' family
    expect(runSweep(box).code).toBe(0);   // one more tick: derivation shares the run budget
    const idsOf = (r: CliRun): string[] => ((r.json?.['items'] ?? []) as { node_id: string }[]).map((i) => i.node_id).sort();
    const before = treeJson(box);
    expect(before.code, `${before.stderr}${before.stdout}`).toBe(0);
    const nodeIds = idsOf(before);
    expect(nodeIds, 'one parent and its eight leaves, derived before the re-key').toHaveLength(9);
    plantSession(box, ID, { generation: G1 });
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: TA, src: 'resume', reg: TA });
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);   // tick N renames the resume line, tick N+1 drains it and re-keys
    expect(counters(box)['family_rekeyed']).toBe(1);
    const r = treeJson(box);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    const scope = scopeOf(r);
    expect(scope.families.map((f) => [f.ccrc_id, f.generation])).toEqual([[ID, G1]]);
    expect(scope.transcripts).toBe(1);
    expect(idsOf(r), 'the same nine ids after the merge: node ids never change (§6.1)').toEqual(nodeIds);
    const db = openStoreRO(box);
    try {
      const split = db.prepare('SELECT count(*) AS n FROM node_children c JOIN nodes p ON p.node_id = c.node_id '
        + 'JOIN nodes k ON k.node_id = c.child_id WHERE p.session_pk <> k.session_pk OR p.epoch_seq <> k.epoch_seq').get() as { n: number };
      expect(Number(split.n), 'no parent spans two families or two epochs after the merge').toBe(0);
      const gens = db.prepare('SELECT DISTINCT s.generation AS g FROM nodes n JOIN sessions s ON s.session_pk = n.session_pk').all() as { g: string }[];
      expect(gens.map((x) => x.g), 'every node now sits in (id, G)').toEqual([G1]);
    } finally {
      db.close();
    }
    expect(counters(box)['nodes_unrepointed'] ?? 0).toBe(0);
  }, HEAVY);

  it('tree excludes unconfirmed epoch nodes in human and JSON output and counts', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-confirmed-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 2) });
    expect(runSweep(box).code).toBe(0);
    const db = openStoreRO(box);
    let unconfirmed = '';
    try {
      const n = db.prepare('SELECT node_id FROM nodes LIMIT 1').get() as { node_id: string };
      const e = db.prepare('SELECT session_pk, max(seq) + 1 AS seq, max(started_ms) + 1 AS started_ms, cc_session_uuid FROM epochs LIMIT 1')
        .get() as { session_pk: number; seq: number; started_ms: number; cc_session_uuid: string };
      unconfirmed = n.node_id;
      db.close();
      const rw = new DatabaseSync(hist(box, 'db', 'history.db'));
      try {
        rw.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, confirmed_ms) VALUES (?, ?, ?, ?, ?, ?, NULL)')
          .run(e.session_pk, e.seq, `${e.cc_session_uuid.slice(0, -1)}c`, 'clear', 'fixture', e.started_ms);
        rw.prepare('UPDATE nodes SET epoch_seq = ? WHERE node_id = ?').run(e.seq, n.node_id);
      } finally { rw.close(); }
    } finally {
      try { db.close(); } catch { /* closed before the writer opens */ }
    }
    const human = runCli(box, ['tree'], { env: withPane(box, ID) });
    expect(human.code, human.stderr).toBe(0);
    expect(human.stdout).not.toContain(unconfirmed.slice(0, 7));
    const json = treeJson(box).json!;
    expect((json.items as { node_id: string }[]).map((n) => n.node_id)).not.toContain(unconfirmed);
    expect(json.total).toBe(1);
    expect(json.shown).toBe(1);
  }, HEAVY);

  it('tree depth one truncates descendants and points to a deeper tree', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-depth-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 2_000) });
    expect(runSweep(box).code).toBe(0);
    const r = treeJson(box, ID, ['--depth', '1']);
    expect(r.code, r.stderr).toBe(0);
    expect(Number(r.json?.shown)).toBeLessThan(Number(r.json?.total));
    expect(Number(r.json?.shown)).toBeGreaterThan(0);
    expect(String(r.json?.next)).toContain('history tree --depth 2');
  }, HEAVY);

  it('tree caps a heading-only confirmed scope without inventing a node continuation', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-heading-cap-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    seedEmptyEpochs(box, 1_000);
    const human = runCli(box, ['tree', '--depth', '1'], { env: withPane(box, ID) });
    const json = treeJson(box, ID, ['--depth', '1']);
    expect(human.code, human.stderr).toBe(0);
    expect(json.code, json.stderr).toBe(0);
    expect(human.stdout.length).toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    expect(human.stdout).not.toContain('fixture-empty-1000');
    expect(human.stdout).toContain('shown 0 of 0');
    expect(human.stdout).not.toContain('next:');
    expect(() => JSON.parse(json.stdout)).not.toThrow();
    expect(json.json?.items).toEqual([]);
    expect(json.json?.shown).toBe(0);
    expect(json.json?.total).toBe(0);
    expect(json.json?.next).toBeNull();
  }, HEAVY);

  it('tree describes its retained root when trailing empty epoch headings exhaust the human cap', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-trailing-heading-cap-');
    const [root] = seedRoots(box, 1, () => 'Current Work: only visible root');
    seedEmptyEpochs(box, 1_000);
    const human = runCli(box, ['tree', '--depth', '1'], { env: withPane(box, ID) });
    const json = treeJson(box, ID, ['--depth', '1']);
    expect(human.code, human.stderr).toBe(0);
    expect(json.code, json.stderr).toBe(0);
    expect(human.stdout.length).toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    expect(human.stdout).toContain('shown 1 of 1');
    expect(human.stdout).not.toContain('fixture-empty-1000');
    expect(human.stdout).toContain(`history describe ${root.slice(0, 7)}`);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
    const items = json.json?.items as { node_id: string }[];
    expect(items.map((item) => item.node_id)).toEqual([root]);
    expect(json.json?.shown).toBe(1);
    expect(json.json?.total).toBe(1);
    expect(String(json.json?.next)).toContain(`history describe ${root.slice(0, 7)}`);
  }, HEAVY);

  it('tree depth one caps independent roots with truthful counts and describes the first omitted root', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-root-cap-');
    const ids = seedRoots(box, 1_000, (n) => `Current Work: independent root ${n}; ${'x'.repeat(90)}`);
    const human = runCli(box, ['tree', '--depth', '1'], { env: withPane(box, ID) });
    const json = treeJson(box, ID, ['--depth', '1']);
    expect(human.code, human.stderr).toBe(0);
    expect(json.code, json.stderr).toBe(0);
    expect(human.stdout.length).toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    expect(json.stdout.length).toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    const items = json.json?.['items'] as { node_id: string }[];
    const shown = Number(json.json?.['shown']);
    const total = Number(json.json?.['total']);
    expect(shown).toBe(items.length);
    expect(shown).toBeLessThan(total);
    expect(total).toBe(ids.length);
    expect(items.map((x) => x.node_id)).toEqual(ids.slice(0, shown));
    expect(human.stdout).toContain(`shown ${shown} of ${total}`);
    const omitted = ids[shown]!;
    expect(String(json.json?.['next'])).toContain(`history describe ${omitted}`);
    expect(String(json.json?.['next'])).not.toContain(`history describe ${ids[0]}`);
  }, HEAVY);

  it('tree caps parseable JSON after its escaped gist and envelope overhead, retaining a deterministic root prefix', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-json-cap-');
    const ids = seedRoots(box, 2_000, (n) => `Current Work: root ${n}${'\n'.repeat(40)}${'\\\\"<&>'.repeat(4)}`);
    const human = runCli(box, ['tree', '--depth', '1'], { env: withPane(box, ID) });
    const json = treeJson(box, ID, ['--depth', '1']);
    expect(human.code, human.stderr).toBe(0);
    expect(json.code, json.stderr).toBe(0);
    expect(human.stdout.length).toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    expect(json.stdout.length).toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    expect(() => JSON.parse(json.stdout)).not.toThrow();
    const items = json.json?.['items'] as { node_id: string }[];
    const shown = Number(json.json?.['shown']);
    const total = Number(json.json?.['total']);
    expect(items.length).toBe(shown);
    expect(shown).toBeLessThan(total);
    expect(total).toBe(ids.length);
    expect(items.map((x) => x.node_id)).toEqual(ids.slice(0, shown));
    expect(String(json.json?.['next'])).toContain(`history describe ${ids[shown]}`);
  }, HEAVY);

  it('tree applies display redaction before escaping in human and JSON gists', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-display-redact-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 2) });
    expect(runSweep(box).code).toBe(0);
    // `\\u` splits the raw run. Only the display reader decodes it before comparing the stored pair; ordinary
    // pair redaction alone cannot find the literal-escaped form.
    const db = new DatabaseSync(hist(box, 'db', 'history.db'));
    try {
      const row = db.prepare('SELECT node_id FROM nodes WHERE gist IS NOT NULL LIMIT 1').get() as { node_id: string };
      db.prepare('UPDATE nodes SET gist = ? WHERE node_id = ?').run('Current Work: Abcd\\u0065fghiJklmnoPqrs123456789', row.node_id);
      db.prepare("INSERT INTO redact_hashes (len, sha256, first_seen_ms) VALUES (?, ?, ?)")
        .run(28, new Uint8Array(Buffer.from('e37bafc5261a49733f7f93c0a57d9062f3b7493a3a80f93a4facf3e07216807e', 'hex')), Date.now());
    } finally { db.close(); }
    const human = runCli(box, ['tree'], { env: withPane(box, ID) });
    const json = treeJson(box).json!;
    expect(human.stdout).toContain('[redacted]');
    expect(human.stdout).not.toContain('AbcdefghiJklmnoPqrs123456789');
    expect(JSON.stringify(json)).toContain('[redacted]');
    expect(JSON.stringify(json)).not.toContain('AbcdefghiJklmnoPqrs123456789');
  }, HEAVY);

  it('tree renders the family, its epochs and its nodes in envelopes, with true counts and a next line', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-tree-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 8) });
    expect(runSweep(box).code).toBe(0);   // one more tick: derivation shares the run budget
    const human = runCli(box, ['tree'], { env: withPane(box, ID) });
    expect(human.code, human.stderr).toBe(0);
    const lines = human.stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(new RegExp(`^scope=family\\(${ID}, 1 transcripts\\) coverage=this-box indexed-through=\\S+ lag=\\S+$`));
    expect(lines[1]).toMatch(new RegExp(`^family ${ID} generation=${G1} first-seen=\\S+$`));
    expect(lines[2]).toMatch(/^ {2}epoch 1 startup started=\S+ session=a1a1a1a1$/);
    // Display prefixes are at least 6 hex after L/N (NODE_ID_DISPLAY_MIN; ruled).
    const nodeLines = lines.filter((l) => /^ {4,}[LN][0-9a-f]{6,20} (native_leaf|steered_leaf|raw_leaf|condensed) depth=\d/.test(l));
    expect(nodeLines, 'one parent and its eight leaves').toHaveLength(9);
    for (const l of nodeLines) expect(l).toMatch(/<ccrc-recall src="node" .*trust="untrusted">.*<\/ccrc-recall>$/);
    expect(lines).toContain('shown 9 of 9');
    expect(lines.at(-1)).toMatch(/^next: "\$HOME\/\.local\/bin\/ccrc" history describe N[0-9a-f]{6,20}$/);
    const json = runCli(box, ['tree', '--json'], { env: withPane(box, ID) }).json!;
    const items = json['items'] as { node_id: string; trust: string }[];
    expect(items).toHaveLength(9);
    for (const i of items) {
      expect(i.node_id, '--json ids are always the full 20 hex').toMatch(/^[LN][0-9a-f]{20}$/);
      expect(i.trust).toBe('untrusted');
    }
    expect([json['shown'], json['total'], json['store_id'], json['coverage']]).toEqual([9, 9, storeIdOf(box), 'this-box']);
    const shallow = runCli(box, ['tree', '--depth', '1', '--json'], { env: withPane(box, ID) }).json!;
    expect([shallow['shown'], shallow['total']]).toEqual([1, 9]);
    expect(String(shallow['next'])).toContain('history tree --depth 2');
  }, HEAVY);
});

// ── W1-B2 Task 11: widened scopes, the header's lag, the counter line, recall-off honoured ──────────────────
// Pins C5, C24, C39, C40, C44, C46, C47b, C53 and C68's CLI half (spec 2026-10-05 §8.1, §8.2, §8.3, §8.8, §9.7).
// Also: recall_off_stale is counted at the drain and never by a replay, and a widened scope's --json stays
// inside §8.3's cap.
const ID_C11 = 'claude-c-other';
const ID_D11 = 'claude-d-demo';
const G3_11 = '0189abcd-1234-4678-9abc-0123456789ad';
const G4_11 = '0189abcd-1234-4678-9abc-0123456789ae';
const TC11 = 'c3c3c3c3-3333-4333-8333-333333333333';
const TD11 = 'd4d4d4d4-4444-4444-8444-444444444444';
const spoolOf11 = (box: HistoryBox, id = ID): string => hist(box, 'spool', `${id}.jsonl`);
interface RecallRow11 { ccrc_id: string; generation: string; verb: string; rc: number; arm: string | null }
function recallRows11(box: HistoryBox): RecallRow11[] {
  const db = openStoreRO(box);
  try {
    return (db.prepare('SELECT ccrc_id, generation, verb, rc, arm FROM recall_calls ORDER BY ts_ms, event_key').all() as unknown as RecallRow11[]).map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}

describe('the read verbs: --session, --project, --workspace, lag, the counter line, recall-off (W1-B2 Task 11)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('C5: --session of another project is 2 cross-project; of this project, it reads that id\'s family', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c5-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    seedFamily(box, { id: ID_B, project: PROJECT, uuid: TB, generation: G2, rows: turns(TB, 2) });
    seedFamily(box, { id: ID_C11, project: 'other', uuid: TC11, generation: G3_11, rows: turns(TC11, 2) });
    expect(answer(treeJson(box, ID, ['--session', ID_C11]))).toEqual([2, 'cross-project']);
    const same = treeJson(box, ID, ['--session', ID_B]);
    expect(same.code, `${same.stderr}${same.stdout}`).toBe(0);
    expect(scopeOf(same).families.map((f) => [f.ccrc_id, f.generation])).toEqual([[ID_B, G2]]);
  }, HEAVY);

  it('C39: --project widens to the project\'s families; unreadable $REG/<id>.project is 2 project-unreadable; with --workspace, bad-args', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c39-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    seedFamily(box, { id: ID_B, project: PROJECT, uuid: TB, generation: G2, rows: turns(TB, 2) });
    seedFamily(box, { id: ID_C11, project: 'other', uuid: TC11, generation: G3_11, rows: turns(TC11, 2) });
    const wide = treeJson(box, ID, ['--project']);
    expect(wide.code, `${wide.stderr}${wide.stdout}`).toBe(0);
    expect(scopeOf(wide).kind).toBe('project');
    expect(scopeOf(wide).families.map((f) => f.ccrc_id).sort()).toEqual([ID, ID_B]);
    const human = runCli(box, ['tree', '--project'], { env: withPane(box, ID) });
    expect(human.stdout.split('\n')[0]).toMatch(/^scope=project\(demo, 2 families\) coverage=this-box /);
    expect(answer(treeJson(box, ID, ['--project', '--workspace']))).toEqual([2, 'bad-args']);
    const project = path.join(box.reg, `${ID}.project`);
    fs.rmSync(project);
    fs.mkdirSync(project);   // present, and no read of it succeeds
    const r = treeJson(box, ID, ['--project']);
    expect(answer(r)).toEqual([2, 'project-unreadable']);
    expect(r.json?.['items'], 'no hits from any fallback scope').toEqual([]);
  }, HEAVY);

  it('C46: two ids, one project, one workdir — the default scope sees its own family; --workspace sees both and prints each', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c46-');
    const w = path.join(box.home, 'work', 'w');
    fs.mkdirSync(w, { recursive: true });
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, workdir: w, rows: turns(TA, 2, w) });
    seedFamily(box, { id: ID_B, project: PROJECT, uuid: TB, generation: G2, workdir: w, rows: turns(TB, 2, w) });
    const own = treeJson(box);
    expect(own.code, `${own.stderr}${own.stdout}`).toBe(0);
    expect(scopeOf(own).kind).toBe('family');
    expect(scopeOf(own).families.map((f) => f.ccrc_id)).toEqual([ID]);
    const human = runCli(box, ['tree', '--workspace'], { env: withPane(box, ID) });
    expect(human.code, human.stderr).toBe(0);
    const lines = human.stdout.split('\n');
    expect(lines[0]).toMatch(/^scope=workspace\(demo, 2 families\) coverage=this-box /);
    expect(lines.filter((l) => l.startsWith('family ')).map((l) => l.split(' ')[1]).sort()).toEqual([ID, ID_B]);
  }, HEAVY);

  it('C47b: --workspace matches cwd_real through a symlinked workdir, and the verbatim cwd of a path that no longer resolved', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c47b-');
    const real = path.join(box.home, 'work', 'real-w');
    const link = path.join(box.home, 'work', 'link-w');
    const gone = path.join(box.home, 'work', 'gone');   // never created: realpath fails at ingest
    fs.mkdirSync(real, { recursive: true });
    fs.symlinkSync(real, link);
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, workdir: link, rows: turns(TA, 2, link) });
    seedFamily(box, { id: ID_B, project: PROJECT, uuid: TB, generation: G2, workdir: real, rows: turns(TB, 2, real) });
    seedFamily(box, { id: ID_C11, project: PROJECT, uuid: TC11, generation: G3_11, workdir: gone, rows: turns(TC11, 2, gone) });
    expect(counters(box)['cwd_unresolved'] ?? 0, 'the gone path was measured unresolved at ingest').toBeGreaterThanOrEqual(1);
    const viaLink = treeJson(box, ID, ['--workspace']);
    expect(viaLink.code, `${viaLink.stderr}${viaLink.stdout}`).toBe(0);
    expect(scopeOf(viaLink).families.map((f) => f.ccrc_id).sort(), 'the link\'s target is the other epoch\'s cwd_real').toEqual([ID, ID_B]);
    plantSession(box, ID_D11, { project: PROJECT, workdir: gone });   // a pane whose own family has no row yet
    const verbatim = treeJson(box, ID_D11, ['--workspace']);
    expect(verbatim.code, `${verbatim.stderr}${verbatim.stdout}`).toBe(0);
    expect(scopeOf(verbatim).families.map((f) => f.ccrc_id), 'cwd_real NULL: matched by its verbatim cwd').toEqual([ID_C11]);
  }, HEAVY);

  it('workspace selection excludes an unconfirmed epoch, an already-merged family, and a non-NULL cwd_real with only a verbatim cwd match', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c47b-negative-');
    const w = path.join(box.home, 'work', 'w');
    const other = path.join(box.home, 'work', 'other');
    fs.mkdirSync(w, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, workdir: w, rows: turns(TA, 2, w) });
    seedFamily(box, { id: ID_B, project: PROJECT, uuid: TB, generation: G2, workdir: w, rows: turns(TB, 2, w) });
    seedFamily(box, { id: ID_C11, project: PROJECT, uuid: TC11, generation: G3_11, workdir: w, rows: turns(TC11, 2, w) });
    seedFamily(box, { id: ID_D11, project: PROJECT, uuid: TD11, generation: G4_11, workdir: w, rows: turns(TD11, 2, w) });
    const db = new DatabaseSync(hist(box, 'db', 'history.db'));
    try {
      const unconfirmed = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID_B, G2) as { session_pk: number };
      db.prepare('UPDATE epochs SET confirmed_ms = NULL WHERE session_pk = ?').run(unconfirmed.session_pk);
      const merged = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID_C11, G3_11) as { session_pk: number };
      const own = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID, G1) as { session_pk: number };
      db.prepare('UPDATE sessions SET merged_into = ? WHERE session_pk = ?').run(own.session_pk, merged.session_pk);
      const mismatched = db.prepare('SELECT session_pk FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID_D11, G4_11) as { session_pk: number };
      db.prepare('UPDATE epochs SET cwd_real = ? WHERE session_pk = ?').run(other, mismatched.session_pk);
    } finally {
      db.close();
    }
    const r = treeJson(box, ID, ['--workspace']);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(scopeOf(r).families.map((f) => f.ccrc_id), 'only the confirmed, unmerged realpath match remains').toEqual([ID]);
  }, HEAVY);

  it('C53: an unreadable $REG/<id>.workdir refuses --workspace: 2 workspace-unreadable, no hits, never a wider or narrower scope', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c53-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    fs.mkdirSync(path.join(box.reg, `${ID}.workdir`));   // present, and no read of it succeeds
    const r = treeJson(box, ID, ['--workspace']);
    expect(answer(r)).toEqual([2, 'workspace-unreadable']);
    expect(r.json?.['items']).toEqual([]);
    expect(runCli(box, ['tree', '--workspace'], { env: withPane(box, ID) }).stdout).not.toMatch(/^family /m);
  }, HEAVY);

  it('C44: lag reads `unmeasured` while any file in scope has no end-of-file tick, and while a recovery step is registered', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c44-');
    const accounts = Object.keys(box.accountHome);
    plantTranscript(box, accounts[1]!, SEED_SLUG, TA, turns(TA, 2));   // a second copy of the transcript, in a second home
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    expect(runSweep(box).code, 'one more tick, so both copies have reached end-of-file').toBe(0);
    const dbPath = hist(box, 'db', 'history.db');
    const header = (): string => runCli(box, ['tree'], { env: withPane(box, ID) }).stdout.split('\n')[0] ?? '';
    const live = new DatabaseSync(dbPath, { readOnly: true });
    const files = (live.prepare("SELECT file_id, eof_ms FROM ingest_files WHERE source_key = '' ORDER BY file_id").all() as { file_id: number; eof_ms: number | null }[]).map((r) => ({ ...r }));
    live.close();
    expect(files.length, 'both copies are cursored files of one transcript').toBe(2);
    expect(files.every((f) => f.eof_ms !== null)).toBe(true);
    expect(header()).toMatch(/ lag=(?!unmeasured)\S+$/);
    const w = new DatabaseSync(dbPath);
    w.prepare('UPDATE ingest_files SET eof_ms = NULL WHERE file_id = ?').run(files[0]!.file_id);
    w.close();
    expect(header(), 'one copy never reached end-of-file').toMatch(/ lag=unmeasured$/);
    const w2 = new DatabaseSync(dbPath);
    w2.prepare('UPDATE ingest_files SET eof_ms = ? WHERE file_id = ?').run(files[0]!.eof_ms, files[0]!.file_id);
    w2.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', 1, NULL, NULL)").run();
    w2.close();
    expect(header(), 'a recovery step is registered').toMatch(/ lag=unmeasured$/);
  }, HEAVY);

  it('C24: consecutive undrained reads append one fenced recall line each (cmd, rc, ms; no argv or query text), then drain to rows; none under history-off or from status', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c24-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    expect(fs.existsSync(spoolOf11(box)), 'the seed\'s own line was drained').toBe(false);
    const r = runCli(box, ['tree', '--depth', '3'], { env: withPane(box, ID) });
    expect(r.code, r.stderr).toBe(0);
    const second = runCli(box, ['tree', '--depth', '4'], { env: withPane(box, ID) });
    expect(second.code, second.stderr).toBe(0);
    const text = fs.readFileSync(spoolOf11(box), 'utf8');
    expect(text.startsWith('\n') && text.endsWith('\n'), 'fenced as the hook fences (§5.1)').toBe(true);
    const lines = text.split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    const calls = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(calls[0]).toMatchObject({ v: 1, ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 0 });
    expect(calls[1]).toMatchObject({ v: 1, ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 0 });
    expect(Object.keys(calls[0]!).sort()).toEqual(['cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v']);
    expect(text).not.toContain('depth');
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);   // tick N renames the counter lines, tick N+1 drains them
    expect(recallRows11(box)).toHaveLength(2);
    expect(recallRows11(box).every((row) => row.ccrc_id === ID && row.generation === G1 && row.verb === 'tree' && row.rc === 0 && row.arm === null)).toBe(true);
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    expect(runCli(box, ['tree'], { env: withPane(box, ID) }).code, 'the CLI still reads under the switch').toBe(0);
    expect(fs.existsSync(spoolOf11(box)), 'and writes no line').toBe(false);
    fs.rmSync(path.join(box.home, '.ccrc', 'history-off'));
    expect(runCli(box, ['status', '--json']).code).toBe(0);
    expect(fs.existsSync(spoolOf11(box)), 'a box verb writes no line').toBe(false);
    expect(answer(treeJson(box, ID, ['--session', '..'])), 'a refusal after the identity is counted too').toEqual([2, 'bad-id']);
    const refused = fs.readFileSync(spoolOf11(box), 'utf8').split('\n').filter((l) => l !== '');
    expect(refused.map((l) => (JSON.parse(l) as { rc: number }).rc)).toEqual([2]);
  }, HEAVY);

  it('C40: directory, missing spool, and a pre-existing symlink are ignored; accounting failure never changes the read answer', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c40-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    fs.mkdirSync(spoolOf11(box));   // a directory where the spool file would be: not a regular file, so never opened
    const r = treeJson(box);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(r.json?.['exit']).toBe(0);
    expect(fs.statSync(spoolOf11(box)).isDirectory()).toBe(true);
    fs.rmSync(spoolOf11(box), { recursive: true });
    const target = path.join(box.home, 'outside-counter');
    fs.writeFileSync(target, 'outside');
    fs.symlinkSync(target, spoolOf11(box));
    const linked = treeJson(box);
    expect(linked.code, `${linked.stderr}${linked.stdout}`).toBe(0);
    expect(fs.readFileSync(target, 'utf8'), 'the no-follow writer never changes the link target').toBe('outside');
    fs.rmSync(spoolOf11(box));
    fs.rmSync(hist(box, 'spool'), { recursive: true });   // no spool/ at all: the write's first measure throws
    const gone = treeJson(box);
    expect(gone.code, `${gone.stderr}${gone.stdout}`).toBe(0);
    expect(gone.json?.['exit']).toBe(0);
    expect(fs.existsSync(hist(box, 'spool')), 'the CLI never makes spool/').toBe(false);
  }, HEAVY);

  it('a FIFO at the spool path is never opened: the pre-open regular-file rule leaves it alone and the verb answers promptly', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c40f-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    const mk = spawnSync('mkfifo', [spoolOf11(box)], { encoding: 'utf8' });
    expect(mk.status, mk.stderr).toBe(0);
    const r = runCli(box, ['tree', '--json'], { env: withPane(box, ID), timeoutMs: 30_000 });
    expect(r.code, `${r.stderr}${r.signal ?? ''}`).toBe(0);
    expect(r.json?.['exit']).toBe(0);
    expect(r.ms, 'the pre-open check avoids FIFO open(2)').toBeLessThan(15_000);
    expect(fs.lstatSync(spoolOf11(box)).isFIFO(), 'the FIFO is left as it was').toBe(true);
  }, HEAVY);

  it('counter writer belts: no-follow rejects a swapped link, the pre-open file check stops before its hook, and post-open fstat rejects a swapped FIFO descriptor', async () => {
    const cli11 = await import('../../ccd/history/cli.mjs') as unknown as {
      recallLine(i: object): string | null;
      writeRecallLine(home: string, id: string, line: string, afterPrecheck?: ((p: string) => void) | null, afterOpen?: ((fd: number, flags: number) => void) | null): void;
    };
    const line = cli11.recallLine({ id: ID, gen: G1, cmd: 'tree', rc: 0, ms: 1, ts: T0 });
    expect(line).not.toBeNull();

    const linkBox = makeHistoryBox('ccrc-hist-rcl-c40-link-race-');
    const linkPath = spoolOf11(linkBox);
    const target = path.join(linkBox.home, 'outside-counter');
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.writeFileSync(linkPath, 'leaf');
    fs.writeFileSync(target, 'outside');
    cli11.writeRecallLine(linkBox.home, ID, line!, (p) => {
      fs.rmSync(p);
      fs.symlinkSync(target, p);
    });
    expect(fs.readFileSync(target, 'utf8'), 'O_NOFOLLOW rejects a leaf swapped to a link after lstat').toBe('outside');

    const precheckBox = makeHistoryBox('ccrc-hist-rcl-c40-precheck-');
    fs.mkdirSync(path.dirname(spoolOf11(precheckBox)), { recursive: true });
    fs.mkdirSync(spoolOf11(precheckBox));
    let hookRan = false;
    cli11.writeRecallLine(precheckBox.home, ID, line!, () => { hookRan = true; });
    expect(hookRan, 'the pre-open regular-file return stops before any post-precheck action').toBe(false);

    const fifoBox = makeHistoryBox('ccrc-hist-rcl-c40-fstat-race-');
    const fifoPath = spoolOf11(fifoBox);
    fs.mkdirSync(path.dirname(fifoPath), { recursive: true });
    fs.writeFileSync(fifoPath, 'leaf');
    let reader = -1;
    try {
      cli11.writeRecallLine(fifoBox.home, ID, line!, (p) => {
        fs.rmSync(p);
        expect(spawnSync('mkfifo', [p], { encoding: 'utf8' }).status).toBe(0);
        reader = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      });
      const b = Buffer.alloc(1);
      expect(fs.readSync(reader, b, 0, 1, null), 'post-open fstat rejects the FIFO descriptor before writeSync').toBe(0);
    } finally {
      if (reader >= 0) fs.closeSync(reader);
    }
  });

  it('counter writer opens a regular leaf with O_NONBLOCK, observed by a post-open fixture seam without a timeout', async () => {
    const cli11 = await import('../../ccd/history/cli.mjs') as unknown as {
      recallLine(i: object): string | null;
      writeRecallLine(home: string, id: string, line: string, afterPrecheck?: ((p: string) => void) | null, afterOpen?: ((fd: number, flags: number) => void) | null): void;
    };
    const box = makeHistoryBox('ccrc-hist-rcl-c40-nonblock-');
    const leaf = spoolOf11(box);
    fs.mkdirSync(path.dirname(leaf), { recursive: true });
    fs.writeFileSync(leaf, 'leaf');
    const line = cli11.recallLine({ id: ID, gen: G1, cmd: 'tree', rc: 0, ms: 1, ts: T0 });
    expect(line).not.toBeNull();
    let openedFlags: number | null = null;
    cli11.writeRecallLine(box.home, ID, line!, null, (fd, flags) => {
      expect(fs.fstatSync(fd).isFile(), 'the seam runs after opening the fixture regular leaf').toBe(true);
      openedFlags = flags;
    });
    expect(openedFlags, 'the fixture observes the flags used for its opened descriptor').not.toBeNull();
    expect(openedFlags! & fs.constants.O_NONBLOCK, 'the recall writer opens that descriptor nonblocking').toBe(fs.constants.O_NONBLOCK);
  });

  it('C68 (CLI half): recall-off/<id> naming this generation answers 8, counted; one naming another generation reads, and the drain counts recall_off_stale', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c68-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true });
    fs.writeFileSync(hist(box, 'recall-off', ID), G1);
    const off = treeJson(box);
    expect(answer(off)).toEqual([8, undefined]);
    expect(off.json?.['coverage']).toBe('this-box');
    // Two ticks per CLI line (tick N renames it, tick N+1 drains it), so each line is drained while recall-off/<id>
    // still holds the content this step set: the drain-time stale check reads that file.
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    expect(recallRows11(box).map((x) => [x.verb, x.rc])).toEqual([['tree', 8]]);
    expect(counters(box)['recall_off_stale'] ?? 0).toBe(0);
    fs.writeFileSync(hist(box, 'recall-off', ID), G4_11);   // the id's generation changed: the file is stale
    expect(treeJson(box).code).toBe(0);
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);
    expect(recallRows11(box).map((x) => x.rc)).toEqual([8, 0]);
    expect(counters(box)['recall_off_stale']).toBe(1);
  }, HEAVY);

  it('C68 (newest family): an invalid env generation and an unreadable $REG/<id>.generation resolve to the newest family (id, G); recall-off/<id> holding G answers 8', () => {
    // Spec §8.8's Generation row: the scope is the id's newest family; §8.2 and §9.7: recall-off/<id> is honoured
    // only when it equals the RESOLVED generation, which here only the store knows (review R26).
    const box = makeHistoryBox('ccrc-hist-rcl-c68n-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    fs.rmSync(path.join(box.reg, `${ID}.generation`));
    plantSession(box, ID, { generation: 'unreadable' });   // present, and no read of it succeeds
    const badEnv = { CCRC_SESSION_GENERATION: 'not-a-generation' };
    const control = treeJson(box, ID, [], badEnv);
    expect(control.code, `CONTROL: no recall-off file, the newest family reads. ${control.stderr}${control.stdout}`).toBe(0);
    expect(scopeOf(control).families.map((f) => [f.ccrc_id, f.generation]), 'CONTROL: the scope is (id, G)').toEqual([[ID, G1]]);
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true });
    fs.writeFileSync(hist(box, 'recall-off', ID), G1);
    expect(answer(treeJson(box, ID, [], badEnv)), 'recall-off names the resolved generation').toEqual([8, undefined]);
    fs.writeFileSync(hist(box, 'recall-off', ID), '');
    const legacy = treeJson(box, ID, [], badEnv);
    expect(legacy.code, `a file holding '' is stale for a family whose generation is G. ${legacy.stderr}`).toBe(0);
  }, HEAVY);

  it('C68 (replay half): recall_off_stale is a drain-time observation; a replayed recall line never reads recall-off/<id>', async () => {
    const sweep11 = (await import('../../ccd/history/sweep.mjs')) as unknown as { applyEventLine(db: DatabaseSync, c: object, ev: object): unknown };
    const box = boundBox('ccrc-hist-rcl-c68r-');
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true });
    fs.writeFileSync(hist(box, 'recall-off', ID), G4_11);   // names another generation than the line's G1: stale
    const db = new DatabaseSync(hist(box, 'db', 'history.db'));
    try {
      const ev = (key: string): object => ({
        key, rec: { v: 1, ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 0, ms: 1, ts: T0 }, recvMs: T0, tsMs: T0,
        obs: { generation: { state: 'absent' } },
      });
      const stale = (): number => Number((db.prepare("SELECT n FROM counters WHERE name = 'recall_off_stale'").get() as { n: number } | undefined)?.n ?? 0);
      sweep11.applyEventLine(db, { home: box.home, now: () => T0, replay: true }, ev('replayed.1.1:1'));
      expect(stale(), 'a replayed line reads no live recall-off file').toBe(0);
      sweep11.applyEventLine(db, { home: box.home, now: () => T0 }, ev('drained.1.1:1'));
      expect(stale(), 'the drain counts it').toBe(1);
    } finally {
      db.close();
    }
  });

  it('C68 (joined generation): a gen-less recall compares recall-off with the observed G1 after joinGeneration, not the absent line generation', async () => {
    const sweep11 = (await import('../../ccd/history/sweep.mjs')) as unknown as { applyEventLine(db: DatabaseSync, c: object, ev: object): unknown };
    const box = boundBox('ccrc-hist-rcl-c68j-');
    fs.mkdirSync(hist(box, 'recall-off'), { recursive: true });
    fs.writeFileSync(hist(box, 'recall-off', ID), G1);
    const db = new DatabaseSync(hist(box, 'db', 'history.db'));
    try {
      const applied = sweep11.applyEventLine(db, { home: box.home, now: () => T0 }, {
        key: 'a'.repeat(64), rec: { v: 1, ev: 'recall', id: ID, cmd: 'tree', rc: 0, ms: 1, ts: T0 }, recvMs: T0, tsMs: T0 + 1,
        obs: { generation: { state: 'value', value: G1 } },
      });
      expect(applied).toHaveLength(1);
      const stale = Number((db.prepare("SELECT n FROM counters WHERE name = 'recall_off_stale'").get() as { n: number } | undefined)?.n ?? 0);
      expect(stale, 'the joined observed generation equals recall-off, so it is not stale').toBe(0);
      expect(recallRows11(box)).toEqual([{ ccrc_id: ID, generation: G1, verb: 'tree', rc: 0, arm: null }]);
    } finally {
      db.close();
    }
  });

  it('wide node-bearing scope: bounded metadata leaves a useful deterministic common retained prefix, truthful shown/total, continuation, and a final JSON envelope inside OUTPUT_CAP', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-wide-');
    const rootIds = seedRoots(box, 100, (n) => `root ${n}: ${'payload '.repeat(35)}`);
    const wideNodeIds: string[] = [];
    const w = new DatabaseSync(hist(box, 'db', 'history.db'));
    try {
      const family = w.prepare('SELECT session_pk, generation FROM sessions WHERE ccrc_id = ? AND generation = ?').get(ID, G1) as { session_pk: number; generation: string };
      const epoch = w.prepare('SELECT seq FROM epochs WHERE session_pk = ? AND confirmed_ms IS NOT NULL ORDER BY seq LIMIT 1').get(family.session_pk) as { seq: number };
      const transcript = w.prepare('SELECT transcript_pk FROM transcripts WHERE cc_session_uuid = ?').get(TA) as { transcript_pk: number };
      const sessions = w.prepare('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES (?, ?, ?, ?)');
      const epochs = w.prepare('INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, started_ms, cwd, cwd_real, confirmed_ms) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)');
      const nodes = w.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, gist, topics,
        summary_blob_id, boundary_entry_id, span_start_uuid, earliest_ms, latest_ms, src_chars, desc_count, desc_chars,
        directive_flag, capped, parser_version, created_ms)
        VALUES (?, ?, 1, ?, 'native_leaf', 0, 'fixture', ?, NULL, NULL, NULL, NULL, ?, ?, 0, 0, 0, 0, 0, 1, ?)`);
      w.exec('BEGIN');
      for (let k = 1; k <= 300; k += 1) {
        const id = `claude-w${k}-demo`;
        const gen = `0189abcd-1234-4678-9abc-${k.toString(16).padStart(12, '0')}`;
        const row = sessions.run(id, gen, PROJECT, 1_000 + k);
        const sessionPk = Number(row.lastInsertRowid);
        const uuid = `c${k.toString(16).padStart(7, '0')}-0000-4000-8000-${k.toString(16).padStart(12, '0')}`;
        epochs.run(sessionPk, uuid, 'fixture-wide', 'fixture', T0 + k, '/fixture/wide', '/fixture/wide', T0 + k);
        const nodeId = `N${k.toString(16).padStart(6, '0')}${'0'.repeat(14)}`;
        wideNodeIds.push(nodeId);
        nodes.run(nodeId, sessionPk, transcript.transcript_pk, `wide ${k}: ${'payload '.repeat(35)}`, T0 + k, T0 + k, Date.now());
      }
      w.exec('COMMIT');
      void family; void epoch;
    } finally {
      w.close();
    }
    const r = treeJson(box, ID, ['--project']);
    const human = runCli(box, ['tree', '--project'], { env: withPane(box, ID) });
    expect(r.code, `${r.stderr}${r.stdout.slice(0, 400)}`).toBe(0);
    expect(human.code, human.stderr).toBe(0);
    expect(r.stdout.length, 'the final JSON envelope stays inside OUTPUT_CAP').toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    const scope = scopeOf(r) as ScopeJson & { families_total: number };
    const items = r.json?.['items'] as { node_id: string }[];
    expect(scope.families_total).toBe(301);
    expect(scope.families).toHaveLength(libRead.SCOPE_FAMILIES_JSON_MAX);
    expect(items.length, 'the metadata bound leaves useful retained node results').toBeGreaterThan(0);
    expect(r.json?.['shown']).toBe(items.length);
    expect(r.json?.['total']).toBe(400);
    expect(r.json?.['next']).toMatch(/ history describe /);
    const humanShown = Number(/shown (\d+) of 400/.exec(human.stdout)?.[1] ?? '-1');
    expect(humanShown, 'human and JSON retain the same shown count').toBe(items.length);
    expect(human.stdout).toContain(`shown ${items.length} of 400`);
    const display = libRead.displayPrefixes([...rootIds, ...wideNodeIds]);
    const fullIdByDisplay = new Map([...display.entries()].map(([id, shown]) => [shown, id]));
    const humanNodeIds = [...human.stdout.matchAll(/^    ([LN][0-9a-f]+) native_leaf\b/gm)].map((match) => {
      const id = fullIdByDisplay.get(match[1]!);
      expect(id, `human node prefix ${match[1]} resolves inside the widened fixture scope`).toBeDefined();
      return id!;
    });
    expect(humanNodeIds.slice(0, items.length), 'human and JSON retain the same node ids in the same order').toEqual(
      items.map((item) => item.node_id),
    );
    const repeat = treeJson(box, ID, ['--project']);
    expect((repeat.json?.['items'] as { node_id: string }[]).map((item) => item.node_id), 'repeated reads retain the same prefix').toEqual(
      items.map((item) => item.node_id),
    );
  }, HEAVY);
});

// ── W1-B2 Task 12: grep's FTS path ─────────────────────────────────────────────────────────────────

type GrepRc = {
  db: RDatabaseSync; version: number; schema: unknown; storeId: string | null; nowMs: number; home: string; id: string;
  scope: {
    kind: 'family' | 'project' | 'workspace'; id: string; generation: string | null; project: string | null; workdir: string | null;
    sessionPks: number[]; transcriptPks: number[];
    families: Array<{ sessionPk: number; ccrcId: string; generation: string; firstSeenMs: number }>;
  };
  pairIdx: unknown;
};
type GrepVerbResult = {
  exit: number; reason?: string; header: string | null; blocks: string[]; items: Array<Record<string, unknown>>;
  shown: number; total: number; next: string[] | null; hint?: string;
};
type GrepMod = { runGrep(rc: GrepRc, a: RGrepArgs): GrepVerbResult };

const GRX = {
  idA: 'claude-a-demo', idB: 'claude-b-demo', idO: 'claude-b-other', W: '/home/u/worktrees/p/quiet-basin',
  t0: Date.UTC(2026, 9, 5, 10, 0, 0),
  ts(s: number): string { return new Date(GRX.t0 + s * 1000).toISOString(); },
  uuid(tag: number, i: number): string { return `0189abcd-${tag.toString(16).padStart(4, '0')}-4000-8000-${i.toString(16).padStart(12, '0')}`; },
  file(tag: number): string { return `0189abcd-${tag.toString(16).padStart(4, '0')}-4fff-8fff-ffffffffffff`; },
  user(tag: number, i: number, text: string, extra: Record<string, unknown> = {}): rFx.Row {
    return { ...rFx.userRow({ uuid: GRX.uuid(tag, i), ts: GRX.ts(i), sessionId: GRX.file(tag), text }), ...extra };
  },
  assistant(tag: number, i: number, text: string): rFx.Row {
    return rFx.assistantRow({ uuid: GRX.uuid(tag, i), ts: GRX.ts(i), sessionId: GRX.file(tag), text, requestId: `req_g${tag}_${i}`, msgId: `msg_g${tag}_${i}` });
  },
  toolUse(tag: number, i: number, toolUseId: string, command: string): rFx.Row {
    return rFx.toolUseRow({ uuid: GRX.uuid(tag, i), ts: GRX.ts(i), sessionId: GRX.file(tag), toolUseId, name: 'Bash', input: { command }, requestId: `req_g${tag}_${i}`, msgId: `msg_g${tag}_${i}` });
  },
  toolResult(tag: number, i: number, toolUseId: string, content: string): rFx.Row {
    return rFx.toolResultRow({ uuid: GRX.uuid(tag, i), ts: GRX.ts(i), sessionId: GRX.file(tag), toolUseId, content });
  },
  seed(box: rH.HistoryBox, tag: number, id: string, project: string, rows: rFx.Row[], accountId = 'claude-a'): string {
    return rH.seedFamily(box, { id, project, workdir: GRX.W, uuid: GRX.file(tag), rows, accountId }).transcript;
  },
  cli(box: rH.HistoryBox, id: string, args: string[], opts: rH.SpawnOpts = {}): CliRun {
    return rH.runCli(box, args, { ...opts, env: { ...rH.withPane(box, id), ...(opts.env ?? {}) } });
  },
  items(r: CliRun): Array<Record<string, unknown>> { return (r.json?.items ?? []) as Array<Record<string, unknown>>; },
  uuids(r: CliRun): unknown[] { return GRX.items(r).map((x) => x.entry_uuid); },
  async grepArgs(argv: string[]): Promise<RGrepArgs> {
    const p = libRead.parseGrepArgs(argv, Date.now());
    if (!p.ok) throw new Error(`fixture argv refused: ${argv.join(' ')}`);
    return p.args;
  },
  async recall(): Promise<GrepMod> { return (await import('../../ccd/history/recall.mjs')) as unknown as GrepMod; },
  async rc(box: rH.HistoryBox, id: string): Promise<GrepRc> {
    const store = await import('../../ccd/history/store.mjs');
    const db: RDatabaseSync = store.openReader(libRead.historyPaths(box.home).dbFile);
    const fam = db.prepare(`SELECT session_pk, ccrc_id, generation, project, first_seen_ms FROM sessions
      WHERE ccrc_id = ? AND merged_into IS NULL ORDER BY first_seen_ms DESC LIMIT 1`).all(id) as unknown as
      Array<{ session_pk: number; ccrc_id: string; generation: string; project: string; first_seen_ms: number }>;
    const sessionPks = fam.map((f) => f.session_pk);
    const transcriptPks = (db.prepare(`SELECT DISTINCT t.transcript_pk AS pk FROM epochs e JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid
      WHERE e.confirmed_ms IS NOT NULL AND e.session_pk IN (SELECT value FROM json_each(?))`).all(JSON.stringify(sessionPks)) as unknown as Array<{ pk: number }>).map((r) => r.pk);
    const storeId = (db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string } | undefined)?.v ?? null;
    return {
      db, version: store.userVersion(db), schema: libRead.SCHEMA_ADDED, storeId, nowMs: Date.now(), home: box.home, id,
      scope: { kind: 'family', id, generation: fam[0]?.generation ?? null, project: fam[0]?.project ?? null, workdir: GRX.W, sessionPks, transcriptPks,
        families: fam.map((f) => ({ sessionPk: f.session_pk, ccrcId: f.ccrc_id, generation: f.generation, firstSeenMs: f.first_seen_ms })) },
      pairIdx: libRead.makePairIndex([]),
    };
  },
  spyDb(db: RDatabaseSync, calls: string[]): RDatabaseSync {
    return new Proxy(db, { get(t, k) { if (k === 'prepare') return (sql: string) => { calls.push(sql); return t.prepare(sql); }; const v = Reflect.get(t, k, t) as unknown; return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v; } }) as RDatabaseSync;
  },
};

describe("grep's FTS path (W1-B2 task 12)", () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const T = 0x21;
  let box: rH.HistoryBox;
  beforeAll(() => {
    if (process.platform === 'darwin') return;
    box = rH.makeHistoryBox('ccrc-hist-grep-');
    GRX.seed(box, T, GRX.idA, 'demo', [
      GRX.user(T, 1, 'zqoperatorword plain operator words'),
      GRX.assistant(T, 2, 'zqmodelword the answer'),
      rFx.systemRow({ uuid: GRX.uuid(T, 3), ts: GRX.ts(3), sessionId: GRX.file(T), subtype: 'informational', content: 'zqharnessword' }),
      GRX.user(T, 4, 'zqmetaword injected', { isMeta: true }),
      rFx.summaryRow({ uuid: GRX.uuid(T, 5), ts: GRX.ts(5), sessionId: GRX.file(T), text: 'zqsummaryword summary' }),
      GRX.toolUse(T, 6, 'toolu_g21echo', 'ccrc history grep zqasked'),
      GRX.toolResult(T, 7, 'toolu_g21echo', 'zqechoword earlier recall output'),
      GRX.toolUse(T, 8, 'toolu_g21cat', 'cat notes.md'),
      GRX.toolResult(T, 9, 'toolu_g21cat', 'zqcatword <ccrc-recall id="L0123456789abcdef0123"> page body'),
      GRX.user(T, 10, 'zqfirstline\nzqsecondword'),
      GRX.user(T, 11, 'edit server/src/coord/store.ts now'),
      GRX.user(T, 12, 'run it with --force please'),
      GRX.user(T, 13, 'history-off next'),
      GRX.user(T, 14, 'fixes #123 finally'),
      GRX.user(T, 15, 'look at arr[0] closely'),
      GRX.user(T, 16, 'commit a0860d1f2e3b4c5d6e7f8091a2b3c4d5e6f70819 landed'),
      GRX.user(T, 17, 'a naïve café visit'),
    ]);
  }, HEAVY);
  const grep = (args: string[], opts: rH.SpawnOpts = {}): CliRun => GRX.cli(box, GRX.idA, ['grep', ...args], opts);

  it('C26: a ready FTS store answers hits and not-found, never pending', () => {
    const hit = grep(['zqoperatorword', '--json']);
    expect(hit.code, hit.stderr).toBe(0);
    expect(GRX.uuids(hit)).toEqual([GRX.uuid(T, 1)]);
    const none = grep(['zqnowhereword', '--json']);
    expect(none.code, none.stderr).toBe(3);
    expect(none.json?.coverage).toBe('this-box');
    const humanNone = grep(['zqnowhereword']);
    expect(humanNone.code, humanNone.stderr).toBe(3);
    expect(humanNone.stdout).toContain(`hint: ${libRead.SEARCH_REACH}`);
  }, HEAVY);

  it('C7: plain regex syntax refuses before statements are prepared', async () => {
    const r = grep(['a|b', '--json']);
    expect([r.code, r.json?.reason]).toEqual([2, 'regex-syntax']);
    const recall = await GRX.recall();
    const rc = await GRX.rc(box, GRX.idA);
    try {
      const calls: string[] = [];
      const refused = recall.runGrep({ ...rc, db: GRX.spyDb(rc.db, calls) }, await GRX.grepArgs(['a|b']));
      expect([refused.exit, refused.reason]).toEqual([2, 'regex-syntax']);
      expect(calls).toEqual([]);
    } finally { rc.db.close(); }
  }, HEAVY);

  it('DM28 and C9: recall echoes reach FTS but default grep excludes them', () => {
    for (const w of ['zqharnessword', 'zqmetaword', 'zqsummaryword', 'zqechoword']) expect(grep([w]).code, w).toBe(3);
    const r = grep(['zqechoword', '--include-recall', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(GRX.uuids(r)).toEqual([GRX.uuid(T, 7)]);
    expect(GRX.items(r)[0]?.provenance).toBe('recall-echo');
    expect(grep(['zqcatword']).code).toBe(0);
  }, HEAVY);

  it('filters and everyday words are handled as quoted FTS terms', () => {
    expect(grep(['zqmodelword', '--role', 'assistant']).code).toBe(0);
    expect(grep(['zqmodelword', '--role', 'user']).code).toBe(3);
    expect(grep(['zqasked', '--tool', 'Bash']).code).toBe(0);
    expect(grep(['zqoperatorword', '--since', '2099-01-01T00:00:00Z']).code).toBe(3);
    for (const words of [['server/src/coord/store.ts'], ['--', '--force'], ['history-off'], ['#123'], ['"arr[0]"'], ['"a0860d1f"*'], ['café'], ['cafe']]) {
      expect(grep(['--json', ...words]).code, words.join(' ')).toBe(0);
    }
    for (const words of [['arr[0]'], ['a|b']]) expect(grep(words).code, words.join(' ')).toBe(2);
  }, HEAVY);

  it('the probe distinguishes throw and absent', () => {
    const seam = (mode: string): CliRun => grep(['zqoperatorword', '--json'], { preloads: [rH.PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: mode } });
    expect([seam('throw').code, seam('throw').json?.reason]).toEqual([5, 'probe-failed']);
    expect([seam('absent').code, seam('absent').json?.reason]).toEqual([7, 'fts5-absent']);
  }, HEAVY);
});

describe("grep's FTS pending gate (W1-B2 task 12)", () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

  it('returns fts-pending when a prior sweep captured a row without FTS tables', () => {
    const T = 0x22;
    const box = rH.makeHistoryBox('ccrc-hist-grep-pending-');
    rH.plantSession(box, GRX.idA, { uuid: GRX.file(T), project: 'demo', workdir: GRX.W });
    rH.plantTranscript(box, 'claude-a', '-home-u-worktrees-p-quiet-basin', GRX.file(T), [GRX.user(T, 1, 'zqpendingword here')]);
    rH.spoolLine(box, GRX.idA, { v: 1, ev: 'SessionStart', id: GRX.idA, sid: GRX.file(T), src: 'startup', reg: GRX.file(T) });
    const absent = { preloads: [rH.PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: 'absent' } };
    for (let i = 0; i < 2; i += 1) expect(rH.runSweep(box, [], absent).code).toBe(0);
    const db = rH.openStoreRO(box);
    try {
      expect((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'blobs_fts'").get() as { n: number }).n).toBe(0);
      expect((db.prepare('SELECT count(*) AS n FROM entries WHERE uuid = ?').get(GRX.uuid(T, 1)) as { n: number }).n).toBe(1);
    } finally { db.close(); }
    const pending = GRX.cli(box, GRX.idA, ['grep', 'zqpendingword', '--json']);
    expect([pending.code, pending.json?.reason]).toEqual([7, 'fts-pending']);
    for (let i = 0; i < 2; i += 1) expect(rH.runSweep(box).code).toBe(0);
    expect(GRX.cli(box, GRX.idA, ['grep', 'zqpendingword']).code).toBe(0);
  }, HEAVY);

  it('returns fts-pending while a completed backfill was reopened after a failed index tick', () => {
    const T = 0x23;
    const box = rH.makeHistoryBox('ccrc-hist-grep-reopened-');
    const file = GRX.seed(box, T, GRX.idA, 'demo', [GRX.user(T, 1, 'zqfirstword indexed')]);
    expect(GRX.cli(box, GRX.idA, ['grep', 'zqfirstword']).code).toBe(0);
    fs.appendFileSync(file, rFx.jsonl([GRX.user(T, 2, 'zqlateword while FTS fails')]));
    rH.spoolLine(box, GRX.idA, { v: 1, ev: 'Stop', id: GRX.idA });
    expect(rH.runSweep(box, [], { preloads: [rH.PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: 'throw' } }).code).toBe(0);
    const db = rH.openStoreRO(box);
    try {
      expect((db.prepare('SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?').get('zqfirstword') as { n: number }).n).toBe(1);
      expect((db.prepare("SELECT completed_ms AS c FROM derivation_state WHERE step = 'fts' AND version = 1").get() as { c: number | null }).c).toBeNull();
    } finally { db.close(); }
    const pending = GRX.cli(box, GRX.idA, ['grep', 'zqfirstword', '--json']);
    expect([pending.code, pending.json?.reason]).toEqual([7, 'fts-pending']);
    expect(rH.runSweep(box).code).toBe(0);
    expect(GRX.cli(box, GRX.idA, ['grep', 'zqlateword']).code).toBe(0);
  }, HEAVY);
});

describe('recall echoes are indexed by both paths (W1-B2 task 12)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const echoPair = (tag: number, i: number): rFx.Row[] => [
    GRX.toolUse(tag, i, `toolu_g${tag.toString(16)}late`, 'ccrc history grep zq'),
    GRX.toolResult(tag, i + 1, `toolu_g${tag.toString(16)}late`, 'zqlateecho earlier recall output'),
  ];
  const ftsDone = (box: rH.HistoryBox): number | null => {
    const db = rH.openStoreRO(box);
    try {
      return (db.prepare("SELECT completed_ms AS c FROM derivation_state WHERE step = 'fts' AND version = 1").get() as { c: number | null }).c;
    } finally { db.close(); }
  };
  const echoRow = (box: rH.HistoryBox, uuid: string): { provenance: string; fts_indexed: number } | undefined => {
    const db = rH.openStoreRO(box);
    try {
      return db.prepare(`SELECT e.provenance AS provenance, b.fts_indexed AS fts_indexed FROM entries e
        JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?`).get(uuid) as { provenance: string; fts_indexed: number } | undefined;
    } finally { db.close(); }
  };

  it('indexes an echo appended after the backfill completed through the inline ingest path', () => {
    const T = 0x24;
    const box = rH.makeHistoryBox('ccrc-hist-grep-echo-inline-');
    const file = GRX.seed(box, T, GRX.idA, 'demo', [GRX.user(T, 1, 'zqplainword before echo')]);
    expect(ftsDone(box)).not.toBeNull();
    fs.appendFileSync(file, rFx.jsonl(echoPair(T, 2)));
    rH.spoolLine(box, GRX.idA, { v: 1, ev: 'Stop', id: GRX.idA });
    expect(rH.runSweep(box).code).toBe(0);
    expect(echoRow(box, GRX.uuid(T, 3))?.provenance).toBe('recall-echo');
    expect(ftsDone(box)).not.toBeNull();
    expect(GRX.cli(box, GRX.idA, ['grep', 'zqlateecho']).code).toBe(3);
    const r = GRX.cli(box, GRX.idA, ['grep', 'zqlateecho', '--include-recall', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(GRX.uuids(r)).toEqual([GRX.uuid(T, 3)]);
  }, HEAVY);

  it('indexes an echo captured while FTS fails through the next backfill, not a second inline chance', () => {
    const T = 0x25;
    const box = rH.makeHistoryBox('ccrc-hist-grep-echo-backfill-');
    const file = GRX.seed(box, T, GRX.idA, 'demo', [GRX.user(T, 1, 'zqplainword before echo')]);
    fs.appendFileSync(file, rFx.jsonl(echoPair(T, 2)));
    rH.spoolLine(box, GRX.idA, { v: 1, ev: 'Stop', id: GRX.idA });
    expect(rH.runSweep(box, [], { preloads: [rH.PRELOADS.faults], env: { HISTORY_TEST_FTS_PROBE: 'throw' } }).code).toBe(0);
    expect(echoRow(box, GRX.uuid(T, 3))).toEqual({ provenance: 'recall-echo', fts_indexed: 0 });
    expect(ftsDone(box)).toBeNull();
    expect(rH.runSweep(box).code).toBe(0);
    expect(ftsDone(box)).not.toBeNull();
    expect(GRX.cli(box, GRX.idA, ['grep', 'zqlateecho']).code).toBe(3);
    const r = GRX.cli(box, GRX.idA, ['grep', 'zqlateecho', '--include-recall', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(GRX.uuids(r)).toEqual([GRX.uuid(T, 3)]);
  }, HEAVY);
});

describe('C27: scope joins before grep ranking (W1-B2 task 12)', () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const TA = 0x27; const TB = 0x28; const TO = 0x29;
  let box: rH.HistoryBox;
  beforeAll(() => {
    if (process.platform === 'darwin') return;
    box = rH.makeHistoryBox('ccrc-hist-grep-scope-');
    GRX.seed(box, TA, GRX.idA, 'demo', [GRX.user(TA, 1, 'an older note with a single zqneedle among many words')]);
    GRX.seed(box, TB, GRX.idB, 'demo', Array.from({ length: 2100 }, (_, i) => GRX.user(TB, 100 + i, `zqneedle zqneedle zqneedle n${i}`)), 'claude-b');
    GRX.seed(box, TO, GRX.idO, 'other', [GRX.user(TO, 1, 'zqforeignword lives elsewhere', { cwd: '/home/u/worktrees/other/x' })], 'claude-b');
  }, 240_000);
  it('the in-scope low-ranked hit survives a global top-ranked pool', () => {
    for (const sort of ['relevance', 'recency', 'hybrid']) {
      const r = GRX.cli(box, GRX.idA, ['grep', 'zqneedle', '--sort', sort, '--json']);
      expect(r.code, `${sort}: ${r.stderr}`).toBe(0);
      expect(GRX.uuids(r)).toEqual([GRX.uuid(TA, 1)]);
      expect(r.json?.total).toBe(1);
    }
  }, HEAVY);
  it('another project stays out of the family scope', () => {
    expect(GRX.cli(box, GRX.idA, ['grep', 'zqforeignword']).code).toBe(3);
    expect(GRX.cli(box, GRX.idO, ['grep', 'zqforeignword']).code).toBe(0);
  }, HEAVY);

  it('returns fts-pending rather than an internal error if the table drops after the index gate', async () => {
    const recall = await GRX.recall();
    const rc = await GRX.rc(box, GRX.idA);
    try {
      const racing = new Proxy(rc.db, {
        get(t, k) {
          if (k === 'prepare') return (sql: string) => {
            if (/blobs_fts MATCH/.test(sql)) throw new Error('no such table: blobs_fts');
            return t.prepare(sql);
          };
          const v = Reflect.get(t, k, t) as unknown;
          return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
        },
      }) as RDatabaseSync;
      const r = recall.runGrep({ ...rc, db: racing }, await GRX.grepArgs(['zqneedle']));
      expect([r.exit, r.reason]).toEqual([7, 'fts-pending']);
    } finally { rc.db.close(); }
  }, HEAVY);
});

describe("grep's snippet localization and Task 12 helper seam (W1-B2 task 12 fix round 1, phase A)", () => {
  beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });
  const T = 0x23;
  const FILLER = 'filler '.repeat(60);
  let box: rH.HistoryBox;
  beforeAll(() => {
    if (process.platform === 'darwin') return;
    box = rH.makeHistoryBox('ccrc-hist-grep-snip-');
    GRX.seed(box, T, GRX.idA, 'demo', [
      GRX.user(T, 1, `${FILLER}zqpfxfound closes the prefix hit`),
      GRX.user(T, 2, `${FILLER}café closes the accent hit`),
      GRX.user(T, 3, `${FILLER}studies are archived`),
      GRX.user(T, 4, `${FILLER}relational data follows`),
    ]);
  }, HEAVY);

  /** The one snippet runGrep returns for `words`, through the in-process runner (the CLI's own path). */
  const snippetOf = async (words: string[]): Promise<string> => {
    const recall = await GRX.recall();
    const rc = await GRX.rc(box, GRX.idA);
    try {
      const r = recall.runGrep(rc, await GRX.grepArgs(words));
      expect(r.exit, words.join(' ')).toBe(0);
      expect(r.items, words.join(' ')).toHaveLength(1);
      return String(r.items[0]?.snippet);
    } finally { rc.db.close(); }
  };

  it('F1: a prefix hit far beyond the initial window is shown at its matched span, not at the body beginning', async () => {
    const s = await snippetOf(['zqpfx*']);
    expect(s).toContain('zqpfxfound');
    expect(s.startsWith('filler filler filler')).toBe(false);
  }, HEAVY);

  it('F2: a plain `cafe` locates the accented source token far beyond the initial window', async () => {
    const s = await snippetOf(['cafe']);
    expect(s).toContain('café');
    expect(s.startsWith('filler filler filler')).toBe(false);
  }, HEAVY);

  it('the accepted Porter localizations survive: studying/studies, relate/relational', async () => {
    expect(await snippetOf(['studying'])).toContain('studies are archived');
    expect(await snippetOf(['relate'])).toContain('relational data');
  }, HEAVY);

  it('F7: Task 12\'s module-private helpers keep their exact names, each declared once, and renderHits takes termsOf per hit', () => {
    const src = fs.readFileSync(path.join(REPO, 'ccd', 'history', 'recall.mjs'), 'utf8');
    const decl = (name: string): number => (src.match(new RegExp(`^(?:export )?(?:function ${name}\\(|const ${name} =)`, 'gm')) ?? []).length;
    for (const n of ['FRAME_RESERVE', 'versioned', 'bindFor', 'referrerSql', 'rankedSql', 'countSql', 'GREP_FILTER', 'FTS_MATCH', 'indexGate',
      'refusal', 'notFound', 'grepNotFound', 'hintLine', 'scopeArgs', 'iso', 'nodeEntries', 'grepParams', 'rankedAndCounted', 'blobOf',
      'hitSnippet', 'hitLine', 'hitItem', 'renderHits']) expect(decl(n), n).toBe(1);
    for (const n of ['grepVersioned', 'grepRefusal', 'grepHint']) expect(decl(n), `${n} is an alias the seam does not name`).toBe(0);
    expect(src).toContain('function renderHits(rc, pool, termsOf, a, total) {');
    const body = /function renderHits\([^)]*\) \{[\s\S]*?\n\}\n/.exec(src)?.[0] ?? '';
    expect(body).toContain('hitSnippet(rc, h, termsOf(h))');
    expect(src).toContain('() => snippetTerms(raw)');
    expect((src.match(/\bblobOf\(/g) ?? []).length, 'blobOf is declared once and called by hitSnippet only').toBe(2);
  });
});
