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
import { describe, it, expect, beforeEach } from 'vitest';
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

  it('C24: a read verb writes ONE fenced recall line (cmd, rc, ms; no argv, no query text), drained to one recall_calls row; none under history-off; none from status', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c24-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    expect(fs.existsSync(spoolOf11(box)), 'the seed\'s own line was drained').toBe(false);
    const r = runCli(box, ['tree', '--depth', '3'], { env: withPane(box, ID) });
    expect(r.code, r.stderr).toBe(0);
    const text = fs.readFileSync(spoolOf11(box), 'utf8');
    expect(text.startsWith('\n') && text.endsWith('\n'), 'fenced as the hook fences (§5.1)').toBe(true);
    const lines = text.split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(rec).sort()).toEqual(['cmd', 'ev', 'gen', 'id', 'ms', 'rc', 'ts', 'v']);
    expect(rec).toMatchObject({ v: 1, ev: 'recall', id: ID, gen: G1, cmd: 'tree', rc: 0 });
    expect(text).not.toContain('depth');
    for (let i = 0; i < 2; i += 1) expect(runSweep(box).code).toBe(0);   // tick N renames the counter line, tick N+1 drains it
    expect(recallRows11(box)).toEqual([{ ccrc_id: ID, generation: G1, verb: 'tree', rc: 0, arm: null }]);
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

  it('C40: a counter line that cannot be written changes nothing: the verb\'s exit code stands', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-c40-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    fs.mkdirSync(spoolOf11(box));   // a directory where the spool file would be: not a regular file, so never appended to
    const r = treeJson(box);
    expect(r.code, `${r.stderr}${r.stdout}`).toBe(0);
    expect(r.json?.['exit']).toBe(0);
    expect(fs.statSync(spoolOf11(box)).isDirectory()).toBe(true);
    fs.rmSync(hist(box, 'spool'), { recursive: true });   // no spool/ at all: the write's first measure throws
    const gone = treeJson(box);
    expect(gone.code, `${gone.stderr}${gone.stdout}`).toBe(0);
    expect(gone.json?.['exit']).toBe(0);
    expect(fs.existsSync(hist(box, 'spool')), 'the CLI never makes spool/').toBe(false);
  }, HEAVY);

  it('a FIFO at the spool path: the append opens nothing it would block on (the hook\'s regular-file rule); the verb answers at once and writes nothing', () => {
    // B1's slug history-spool-append-regular-file-only: whatever appends to spool/<id>.jsonl appends to a regular
    // file or to nothing. history-cli.test.ts plants the same FIFO for status's spool/.draining read.
    const box = makeHistoryBox('ccrc-hist-rcl-c40f-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    const mk = spawnSync('mkfifo', [spoolOf11(box)], { encoding: 'utf8' });
    expect(mk.status, mk.stderr).toBe(0);
    const r = runCli(box, ['tree', '--json'], { env: withPane(box, ID), timeoutMs: 30_000 });
    expect(r.code, `${r.stderr}${r.signal ?? ''}`).toBe(0);
    expect(r.json?.['exit']).toBe(0);
    expect(r.ms, 'no open(2) blocked on the FIFO').toBeLessThan(15_000);
    expect(fs.lstatSync(spoolOf11(box)).isFIFO(), 'the FIFO is left as it was').toBe(true);
  }, HEAVY);

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

  it('wide scope: the --json scope names at most SCOPE_FAMILIES_JSON_MAX families and counts them all, so the envelope stays inside OUTPUT_CAP', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-wide-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: turns(TA, 2) });
    // 300 more families of the project, written straight into the store (no process holds it between ticks).
    // Listed whole, they would add about 31,000 chars to every --json envelope of a --project read.
    const w = new DatabaseSync(hist(box, 'db', 'history.db'));
    try {
      const ins = w.prepare('INSERT INTO sessions (ccrc_id, generation, project, first_seen_ms) VALUES (?, ?, ?, ?)');
      w.exec('BEGIN');
      for (let k = 1; k <= 300; k += 1) ins.run(`claude-w${k}-demo`, `0189abcd-1234-4678-9abc-${k.toString(16).padStart(12, '0')}`, PROJECT, k);
      w.exec('COMMIT');
    } finally {
      w.close();
    }
    const r = treeJson(box, ID, ['--project']);
    expect(r.code, `${r.stderr}${r.stdout.slice(0, 400)}`).toBe(0);
    expect(r.stdout.length, 'the envelope stays inside OUTPUT_CAP').toBeLessThanOrEqual(libRead.OUTPUT_CAP);
    const scope = scopeOf(r) as ScopeJson & { families_total: number };
    expect(scope.families_total).toBe(301);
    expect(scope.families).toHaveLength(libRead.SCOPE_FAMILIES_JSON_MAX);
  }, HEAVY);
});
