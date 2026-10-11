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

  it('tree depth one caps output honestly and gives an actionable next', () => {
    const box = makeHistoryBox('ccrc-hist-rcl-cap-');
    seedFamily(box, { id: ID, project: PROJECT, uuid: TA, generation: G1, rows: cycles(TA, 2_000) });
    expect(runSweep(box).code).toBe(0);
    const r = treeJson(box, ID, ['--depth', '1']);
    expect(r.code, r.stderr).toBe(0);
    expect(Number(r.json?.shown)).toBeLessThan(Number(r.json?.total));
    expect(Number(r.json?.shown)).toBeGreaterThan(0);
    expect(String(r.json?.next)).toContain('history tree --depth 2');
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