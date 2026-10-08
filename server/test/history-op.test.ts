// history-op.test.ts — W1-B1 Tasks 25 and 26: the sweep's --op pass and its periodic census
// (spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.4 "Operator verbs" and
// "Speed bumps", §9.2 "An --op pass runs the journal half too" and "Backfill", §6.11 "doctor --migrate",
// §9.15). Task 25's pins: C42, C64's direct-shim door for --op import and --op migrate, DM35, DM43, O27,
// O34, O49.
//
// The direct door is the published one (§5.1's diagram, W1-l): `~/.local/bin/ccd-history-sweep --op …` from
// a shell. These cases go through the REAL shim in the fixture HOME, which execs the REAL sweep.mjs through
// the fixture's ~/ccrc link. The TTY gate has NO seam (§10.1): its cases run under a real node-pty terminal,
// and their piped counterparts prove the refusal without one. Every spawn carries the statfs preload, so
// this box's disk never decides a case; tmux, gh, ssh, the managers and curl are poisoned by makeHistoryBox.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { syncBuiltinESMExports } from 'node:module';
import * as pty from 'node-pty';
import { WRITING_FORMS, CARRIER_KILL_S, journalRecord, floorThreshold, historyPaths } from '../../ccd/history/lib.mjs';
import { createStore, openWriter, closeWriter, getMeta } from '../../ccd/history/store.mjs';
import {
  makeHistoryBox, runSweep, runShim, runDriver, preloadOptions, plantSession, plantTranscript, spoolLine, openStoreRO,
  counters, journalRecords, PRELOADS, PASS_DRIVER, CLI, readTxlog, writes, type TxEv, type HistoryBox, type DriverDeps,
} from './historyHelpers.js';

beforeEach((ctx) => { if (process.platform === 'darwin') ctx.skip(); });

const ID = 'claude-a-demo';
const G1 = '0189abcd-1234-4678-9abc-0123456789ab';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U9 = '99999999-9999-4999-8999-999999999999';
const SLUG = '-home-u-tree-demo';
const V2 = 'CREATE TABLE seam_v2 (x INTEGER)';
const MIN = 60_000;
const DAY = 86_400_000;

interface Paths { root: string; db: string; backups: string; spool: string; draining: string; journal: string; storeId: string; off: string }
function paths(box: HistoryBox): Paths {
  const root = path.join(box.home, '.ccrc', 'history');
  return {
    root, db: path.join(root, 'db', 'history.db'), backups: path.join(root, 'db', 'backups'),
    spool: path.join(root, 'spool'), draining: path.join(root, 'spool', '.draining'),
    journal: path.join(root, 'journal'), storeId: path.join(root, 'store.id'),
    off: path.join(box.home, '.ccrc', 'history-off'),
  };
}
function names(dir: string): string[] { try { return fs.readdirSync(dir).sort(); } catch { return []; } }
function q<T>(box: HistoryBox, sql: string, ...args: (string | number)[]): T[] {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args) as T[]; } finally { db.close(); }
}
const metaOf = (box: HistoryBox, k: string): string | null => q<{ v: string }>(box, 'SELECT v FROM meta WHERE k = ?', k)[0]?.v ?? null;
const countOf = (box: HistoryBox, table: string): number => q<{ n: number }>(box, `SELECT count(*) AS n FROM ${table}`)[0]!.n;
const counter = (box: HistoryBox, name: string): number => counters(box)[name] ?? 0;
const versionOf = (file: string): number => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } finally { db.close(); }
};
const draining = (box: HistoryBox): string[] => names(paths(box).draining).filter((n) => n.endsWith('.jsonl'));
type Rec = { k: string; [x: string]: unknown };
const recs = (box: HistoryBox): Rec[] => journalRecords(box) as Rec[];
const verdicts = (box: HistoryBox, kind: string): Rec[] => recs(box).filter((r) => r.k === 'verdict' && r['kind'] === kind);
const epochsOf = (box: HistoryBox, id = ID): { cc_session_uuid: string; cause: string; declared_by: string; seq: number }[] =>
  q(box, 'SELECT e.cc_session_uuid, e.cause, e.declared_by, e.seq FROM epochs e JOIN sessions s ON s.session_pk = e.session_pk WHERE s.ccrc_id = ? ORDER BY e.seq', id);
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const userRow = (uuid: string, text: string, ts: string, sid = U1) => ({
  type: 'user', uuid, parentUuid: null, sessionId: sid, cwd: '/home/u/tree/demo', timestamp: ts,
  message: { role: 'user', content: text },
});
const startup = (sid: string, extra: Record<string, unknown> = {}) => ({ v: 1, ev: 'SessionStart', id: ID, sid, src: 'startup', gen: G1, ...extra });
const resumeLine = (sid: string, extra: Record<string, unknown> = {}) => ({ v: 1, ev: 'SessionStart', id: ID, sid, src: 'resume', gen: G1, ...extra });
const clearLine = (sid: string, extra: Record<string, unknown> = {}) => ({ v: 1, ev: 'SessionStart', id: ID, sid, src: 'clear', gen: G1, ...extra });

function boundBox(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
  const r = runSweep(box);
  expect(r.code, r.stderr).toBe(0);
  return box;
}

interface OpResult { rc: number; reason?: string }
/** The --op pass's one JSON result, its LAST stdout line (§8.4); a pty's \r stripped. */
function lastResult(stdout: string): OpResult {
  const lines = stdout.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{"rc"'));
  expect(lines.length, `no {"rc":…} line in:\n${stdout}`).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]!) as OpResult;
}

/** Every entry under ~/.ccrc with each file's size and mtime — "writes nothing", measured. The shim's lock
 *  (opened on every run) and SQLite's WAL sidecars (§8.1: a read-only open may create them) are excluded;
 *  directories are listed by name only, since a sidecar's create-and-remove moves a directory's mtime. */
function snapshot(box: HistoryBox): string[] {
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

/** The shim on a REAL terminal (node-pty): stdin IS a TTY here, so only the pane and the switches can refuse.
 *  Lazy, inside each test (ccrc-install.test.ts:5914 lesson); the guard timer is a safety net, never the
 *  assertion. A pty merges stdout and stderr. */
function shimPty(box: HistoryBox, args: string[], env: Record<string, string> = {}, cwd: string = box.home): Promise<{ code: number; out: string }> {
  const full: Record<string, string> = {};
  const merged: NodeJS.ProcessEnv = { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), ...env };
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) full[k] = v;
  return new Promise((resolve) => {
    const p = pty.spawn('bash', [path.join(box.home, '.local', 'bin', 'ccd-history-sweep'), ...args], {
      name: 'xterm-color', cols: 200, rows: 40, cwd, env: full,
    });
    let out = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out });
    };
    const timer = setTimeout(() => { p.kill(); finish(-1); }, 19_000);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

/** The pass driver on a pty, for the operator form's gate (`--session --file --apply` refuses without a TTY, needs-tty). */
function driverPty(box: HistoryBox, deps: DriverDeps, args: string[]): Promise<{ code: number; out: string }> {
  const full: Record<string, string> = {};
  const merged: NodeJS.ProcessEnv = { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), HISTORY_TEST_DEPS: JSON.stringify(deps) };
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) full[k] = v;
  return new Promise((resolve) => {
    const p = pty.spawn(process.execPath, ['--no-warnings', PASS_DRIVER, ...args, '--secrets', '--', ...box.homes], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: box.home, env: full,
    });
    let out = '';
    let done = false;
    const finish = (code: number): void => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out }); };
    const timer = setTimeout(() => { p.kill(); finish(-1); }, 19_000);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

/** §9.2 "Every verdict commits first" (CT10): the transaction that chains an epoch with its outbox row
 *  commits FULL (2) on its own — no entries in it — its verdict reaches the journal (a J event) before the
 *  first NORMAL (1) chunk that writes entries, and that chunk exists when `chunkExpected`. */
function assertVerdictBeforeChunk(evs: TxEv[], chunkExpected: boolean): void {
  const iV = evs.findIndex((e) => writes(e, /\bINTO epochs\b/) && writes(e, /\bINTO journal_outbox\b/));
  expect(iV, 'no transaction chained an epoch with its outbox row').toBeGreaterThan(-1);
  const v = evs[iV] as { kind: 'tx'; sync: number; writes: string[] };
  expect(v.sync, 'the verdict commits under synchronous=FULL').toBe(2);
  expect(v.writes.some((w) => /\bINTO entries\b/.test(w)), 'never inside a NORMAL chunk').toBe(false);
  const iJ = evs.findIndex((e, i) => i > iV && e.kind === 'journal');
  expect(iJ, 'the verdict reached the journal').toBeGreaterThan(iV);
  const iC = evs.findIndex((e) => writes(e, /\bINTO entries\b/));
  if (chunkExpected) expect(iC, 'the file was ingested in the same pass').toBeGreaterThan(-1);
  if (iC !== -1) {
    expect(iC, 'the verdict is journaled before the first chunk').toBeGreaterThan(iJ);
    expect((evs[iC] as { sync: number }).sync, 'ingest chunks stay NORMAL').toBe(1);
  }
}

describe('C64: every writing form, the direct-shim door (B1: --op import and --op migrate)', () => {
  const FORMS = [
    { form: 'import-apply', args: (_f: string): string[] => ['--op', 'import', '--apply'] },
    { form: 'import-session-apply', args: (f: string): string[] => ['--op', 'import', '--session', ID, '--file', f, '--apply'] },
    { form: 'migrate', args: (_f: string): string[] => ['--op', 'migrate'] },
  ] as const;
  function fixture(prefix: string): { box: HistoryBox; file: string } {
    const box = boundBox(prefix);
    plantSession(box, ID, { generation: G1, project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000c1', 'gate words', iso(0))]);
    // A spool file left un-renamed is the visible proof that a refusal never reached the lock-take journal half.
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    return { box, file };
  }

  it('CONTROL: the forms this table drives are WRITING_FORMS members, and only import-session-apply is irreversible', () => {
    for (const { form } of FORMS) expect(Object.keys(WRITING_FORMS)).toContain(form);
    expect(FORMS.filter((f) => WRITING_FORMS[f.form]!.irreversible).map((f) => f.form)).toEqual(['import-session-apply']);
  });

  it('CLAUDECODE set: every form answers apply-in-session and writes nothing', () => {
    const { box, file } = fixture('ccrc-hist-c64a-');
    for (const f of FORMS) {
      const before = snapshot(box);
      const r = runShim(box, f.args(file), { env: { CLAUDECODE: '1' } });
      expect(r.code, `${f.form}: ${r.stderr}`).toBe(2);
      expect(lastResult(r.stdout), f.form).toEqual({ rc: 2, reason: 'apply-in-session' });
      expect(snapshot(box), f.form).toEqual(before);
    }
  });

  it('no TTY: the irreversible form answers needs-tty and writes nothing; the other two run', () => {
    const { box, file } = fixture('ccrc-hist-c64b-');
    const before = snapshot(box);
    const refused = runShim(box, FORMS[1].args(file));
    expect(refused.code).toBe(2);
    expect(lastResult(refused.stdout)).toEqual({ rc: 2, reason: 'needs-tty' });
    expect(snapshot(box)).toEqual(before);
    for (const f of [FORMS[0], FORMS[2]]) {
      const r = runShim(box, f.args(file));
      expect(r.code, `${f.form}: ${r.stderr}`).toBe(0);
      expect(lastResult(r.stdout), f.form).toEqual({ rc: 0 });
    }
  });

  it('a cc- pane: under a real terminal the irreversible form answers irreversible-in-pane, asking tmux once with -t; the other two run', async () => {
    const { box, file } = fixture('ccrc-hist-c64c-');
    // A functional tmux in the fixture bin, over the poison: it records its argv and answers a cc- session.
    fs.writeFileSync(path.join(box.home, '.local', 'bin', 'tmux'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/tmux-calls"\necho cc-x\n', { mode: 0o755 });
    const before = snapshot(box);
    const refused = await shimPty(box, FORMS[1].args(file), { TMUX_PANE: '%1' });
    expect(refused.code, refused.out).toBe(2);
    expect(lastResult(refused.out)).toEqual({ rc: 2, reason: 'irreversible-in-pane' });
    expect(snapshot(box)).toEqual(before);
    for (const f of [FORMS[0], FORMS[2]]) {
      const r = await shimPty(box, f.args(file), { TMUX_PANE: '%1' });
      expect(r.code, `${f.form}: ${r.out}`).toBe(0);
    }
    expect(fs.readFileSync(path.join(box.home, 'tmux-calls'), 'utf8').trim().split('\n'),
      'only the irreversible form asks tmux, always with -t').toEqual(['display-message -p -t %1 #S']);
  }, 60_000);

  it('history-off: every form answers history-off under a real terminal and writes nothing', async () => {
    const { box, file } = fixture('ccrc-hist-c64d-');
    fs.writeFileSync(paths(box).off, '');
    for (const f of FORMS) {
      const before = snapshot(box);
      const r = await shimPty(box, f.args(file));
      expect(r.code, `${f.form}: ${r.out}`).toBe(2);
      expect(lastResult(r.out), f.form).toEqual({ rc: 2, reason: 'history-off' });
      expect(snapshot(box), f.form).toEqual(before);
    }
  }, 60_000);

  it('under a real terminal outside any cc- pane the irreversible form maps the file as the operator and ingests it; a re-run journals no second verdict', async () => {
    const { box, file } = fixture('ccrc-hist-c64e-');
    const r = await shimPty(box, FORMS[1].args(file));
    expect(r.code, r.out).toBe(0);
    expect(lastResult(r.out)).toEqual({ rc: 0 });
    expect(epochsOf(box)).toEqual([{ cc_session_uuid: U1, cause: 'import', declared_by: 'operator', seq: 1 }]);
    expect(verdicts(box, 'mapping').some((v) => v['cc_session_uuid'] === U1 && v['declared_by'] === 'operator')).toBe(true);
    expect(countOf(box, 'entries')).toBe(1);
    expect(fs.existsSync(path.join(paths(box).root, 'op')), 'the op marker is removed on exit').toBe(false);
    // The --session --file form maps with no evidence lookup, so a re-run reaches commitMapping for a uuid this
    // family already holds confirmed: no new epoch, so no new verdict.
    const again = await shimPty(box, FORMS[1].args(file));
    expect(again.code, again.out).toBe(0);
    expect(verdicts(box, 'mapping').filter((v) => v['cc_session_uuid'] === U1), 'a re-run chains nothing, so it journals nothing').toHaveLength(1);
  }, 45_000);
});

describe('C42: import maps from evidence only', () => {
  it('a dry run lists mapped and unmapped files and writes nothing; --apply ingests the mapped and only lists the unmapped', () => {
    const box = boundBox('ccrc-hist-c42-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    // Registry evidence naming a uuid with no transcript on this box: nothing for import to map.
    plantSession(box, 'claude-a-nofile', { uuid: U9, generation: G1, project: 'demo' });
    const mapped = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000a1', 'mapped words', iso(0))]);
    const unmapped = plantTranscript(box, 'claude-a', SLUG, U3, [userRow('a0000000-0000-4000-8000-0000000000a2', 'no evidence names me', iso(0), U3)]);
    const before = snapshot(box);
    const dry = runShim(box, ['--op', 'import']);
    expect(dry.code, dry.stderr).toBe(0);
    expect(lastResult(dry.stdout)).toEqual({ rc: 0 });
    expect(dry.stdout).toContain(`mapped ${ID} ${G1} ${mapped}`);
    expect(dry.stdout).toContain(`unmapped ${unmapped}`);
    expect(snapshot(box), 'a dry run writes nothing').toEqual(before);
    const apply = runShim(box, ['--op', 'import', '--apply']);
    expect(apply.code, apply.stderr).toBe(0);
    expect(lastResult(apply.stdout)).toEqual({ rc: 0 });
    expect(apply.stdout).toContain(`unmapped ${unmapped}`);
    const uuids = q<{ cc_session_uuid: string }>(box, 'SELECT cc_session_uuid FROM transcripts').map((r) => r.cc_session_uuid);
    expect(uuids).toContain(U1);
    expect(uuids, 'an unmapped file is never ingested').not.toContain(U3);
    expect(verdicts(box, 'mapping').some((v) => v['cc_session_uuid'] === U1 && v['declared_by'] === 'registry')).toBe(true);
    expect(epochsOf(box, 'claude-a-nofile'), 'evidence that names no file on this box maps nothing, as the dry run listed').toEqual([]);
  });

  it('planted registry entries never block or balloon the evidence read (review 316 F18)', () => {
    const box = boundBox('ccrc-hist-c42f-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const mapped = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000a1', 'mapped words', iso(0))]);
    const u3 = plantTranscript(box, 'claude-a', SLUG, U3, [userRow('a0000000-0000-4000-8000-0000000000a2', 'no evidence names me', iso(0), U3)]);
    // FIFOs block without allocating, so a regression is killed at the timeout; no /dev/zero here, which would allocate
    // gigabytes first (readBounded's unit test pins the device row).
    expect(spawnSync('mkfifo', [path.join(box.reg, 'claude-a-fifo.uuid')]).status).toBe(0);
    expect(spawnSync('mkfifo', [path.join(box.reg, 'claude-a-fifo2.compactions')]).status).toBe(0);
    fs.writeFileSync(path.join(box.reg, 'claude-a-big.generation'), G1);
    const big = path.join(box.reg, 'claude-a-big.compactions');
    const first = `${JSON.stringify({ transcript: u3 })}\n`;
    fs.writeFileSync(big, first);
    fs.truncateSync(big, 4 * 1024 * 1024 + 1);
    const r = runShim(box, ['--op', 'import'], { timeoutMs: 30_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`mapped ${ID} ${G1} ${mapped}`);
    expect(r.stdout, 'a log over the cap gives no evidence').toContain(`unmapped ${u3}`);
    fs.truncateSync(big, Buffer.byteLength(first));
    const again = runShim(box, ['--op', 'import'], { timeoutMs: 30_000 });
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout, 'CONTROL: the same log at its true size maps').toContain(`mapped claude-a-big ${G1} ${u3}`);
  });

  it('an imported blob is searchable after the next scheduled tick: the import re-opens a completed FTS backfill', (ctx) => {
    const box = boundBox('ccrc-hist-c42c-');
    if (metaOf(box, 'fts') === 'fts5-absent') ctx.skip();        // a Node built without FTS5 has no index to search
    const ftsDone = (): number | null => q<{ c: number | null }>(box, "SELECT completed_ms AS c FROM derivation_state WHERE step = 'fts' AND version = 1")[0]?.c ?? null;
    expect(ftsDone(), 'CONTROL: the creating tick completed the (empty) backfill, so only a re-open can index the import').not.toBeNull();
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000a4', 'zebrafish backfill words', iso(0))]);
    const apply = runShim(box, ['--op', 'import', '--apply']);
    expect(apply.code, apply.stderr).toBe(0);
    expect(countOf(box, 'entries')).toBe(1);
    expect(runSweep(box).code).toBe(0);
    expect(q<{ n: number }>(box, "SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH 'zebrafish'")[0]!.n).toBe(1);
  });

  it('below the free-space floor an import maps from evidence but ingests nothing, counts capture_paused_low_disk and says so', () => {
    const box = boundBox('ccrc-hist-c42d-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000a5', 'floor words', iso(0))]);
    const before = counter(box, 'capture_paused_low_disk');
    // 4 KiB free of a 10 GiB filesystem: far below floorThreshold, but a probe that settles.
    const r = runShim(box, ['--op', 'import', '--apply'], { env: { HISTORY_TEST_STATFS: `4096:${10 * 1024 ** 3}` } });
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(r.stdout).toMatch(/^history-sweep: capture-paused-low-disk: /m);
    expect(epochsOf(box).map((e) => e.cc_session_uuid), 'the mapping is the operator\'s act: committed and journaled').toEqual([U1]);
    expect(countOf(box, 'entries'), 'no cursor moved below the floor (§9.3)').toBe(0);
    expect(counter(box, 'capture_paused_low_disk') - before).toBeGreaterThanOrEqual(1);
  });

  it('a floor met between chunks stops the import there: said once, counted once, no cursor moved', () => {
    const box = boundBox('ccrc-hist-c42e-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000a6', 'chunk floor words', iso(0))]);
    const before = counter(box, 'capture_paused_low_disk');
    // The writing form's own probe and importRoom's (the pass's first two statfs calls) see plenty; the third,
    // the per-chunk probe inside ingestFile (§9.3, BK17), sees 1 byte free of a 1 TiB filesystem (Task 19's
    // HISTORY_TEST_STATFS_AFTER block in the statfs preload).
    const r = runShim(box, ['--op', 'import', '--apply'], { env: { HISTORY_TEST_STATFS_AFTER: `2:1:${2 ** 40}` } });
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(r.stdout.split('\n').filter((l) => l.startsWith('history-sweep: capture-paused-low-disk: ')), 'said once').toHaveLength(1);
    expect(epochsOf(box).map((e) => e.cc_session_uuid), 'the mapping stands').toEqual([U1]);
    expect(countOf(box, 'entries'), 'the per-chunk probe held the cursor').toBe(0);
    expect(counter(box, 'capture_paused_low_disk') - before, 'counted where it stopped, never twice').toBe(1);
  });

  it('at the cap an import maps from evidence but ingests nothing, counts capture_paused_at_cap and says so', () => {
    const box = boundBox('ccrc-hist-c42f-');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-max-gb'), '1\n');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000a7', 'cap words', iso(0))]);
    const before = counter(box, 'capture_paused_at_cap');
    // The store's measured size is the driver's seam: 2 GiB is over a 1 GB cap, whatever the unit. Only importRoom
    // checks the cap (the per-chunk probe checks the floor alone), so this case is its arm's pin.
    const r = runDriver(box, { sizeBytes: 2 * 1024 ** 3 }, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(r.stdout).toMatch(/^history-sweep: at-cap: /m);
    expect(epochsOf(box).map((e) => e.cc_session_uuid), 'the mapping stands').toEqual([U1]);
    expect(countOf(box, 'entries'), 'no cursor moved at the cap (§9.3)').toBe(0);
    expect(counter(box, 'capture_paused_at_cap') - before).toBe(1);
  });

  it('a .compactions transcript path maps its file with declared_by journal', () => {
    const box = boundBox('ccrc-hist-c42b-');
    const other = 'claude-a-other';
    plantSession(box, other, { generation: G1, project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U2, [userRow('a0000000-0000-4000-8000-0000000000a3', 'journal words', iso(0), U2)]);
    fs.writeFileSync(path.join(box.reg, `${other}.compactions`), `${JSON.stringify({ at: 1, trigger: 'auto', transcript: file })}\n`);
    const r = runShim(box, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(epochsOf(box, other)).toEqual([{ cc_session_uuid: U2, cause: 'import', declared_by: 'journal', seq: 1 }]);
  });
});

describe('RF5a F15: --op import --apply takes the mapped transcripts\' sidecars (§9.2 "with their sidecars")', () => {
  const E1 = 'a0000000-0000-4000-8000-0000000000e1';
  const SIDE = 'b7k2q9z1x.txt';
  const toolRow = {
    type: 'user', uuid: E1, parentUuid: null, sessionId: U1, cwd: '/home/u/tree/demo', timestamp: iso(0),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01AAA', content: 'Output too large. Full output saved to: /home/u/x/tool-results/b7k2q9z1x.txt' }] },
  };
  /** A mapped transcript with its sidecar, and an UNMAPPED one (U3) laid out the same way. */
  function fixture(prefix: string): { box: HistoryBox; file: string; sidecar: string; strayCar: string } {
    const box = boundBox(prefix);
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [toolRow]);
    const sidecar = path.join(path.dirname(file), U1, 'tool-results', SIDE);
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(sidecar, 'the big output body\n');
    const stray = plantTranscript(box, 'claude-a', SLUG, U3, [userRow('a0000000-0000-4000-8000-0000000000e2', 'no evidence names me', iso(0), U3)]);
    const strayCar = path.join(path.dirname(stray), U3, 'tool-results', 'unmapped01.txt');
    fs.mkdirSync(path.dirname(strayCar), { recursive: true });
    fs.writeFileSync(strayCar, 'never read\n');
    return { box, file, sidecar, strayCar };
  }
  const linked = (box: HistoryBox) => q<{ name: string; uuid: string }>(box, 'SELECT s.name AS name, e.uuid AS uuid FROM sidecars s LEFT JOIN entries e ON e.entry_id = s.entry_id');

  it('evidence form: the sidecar is captured, linked to its tool_result row, and marked seen; an unmapped transcript\'s sidecar is never read', () => {
    const { box, sidecar, strayCar } = fixture('ccrc-hist-rf5a-a-');
    const r = runShim(box, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(linked(box)).toEqual([{ name: SIDE, uuid: E1 }]);
    expect(q(box, 'SELECT path FROM sidecar_seen')).toEqual([{ path: sidecar }]);
    expect(q<{ path: string }>(box, 'SELECT path FROM sidecar_seen').map((x) => x.path)).not.toContain(strayCar);
  });

  it('operator form: --session --file takes that transcript\'s sidecar too', async () => {
    const { box, file, sidecar } = fixture('ccrc-hist-rf5a-b-');
    const out = await shimPty(box, ['--op', 'import', '--session', ID, '--file', file, '--apply']);
    expect(lastResult(out.out)).toEqual({ rc: 0 });
    expect(linked(box)).toEqual([{ name: SIDE, uuid: E1 }]);
    expect(q(box, 'SELECT path FROM sidecar_seen')).toEqual([{ path: sidecar }]);
  });

  it('a floor met inside the sidecar window stops it there: the transcript stands, the sidecar waits, said once, counted once', () => {
    const { box } = fixture('ccrc-hist-rf5a-c-');
    const before = counter(box, 'capture_paused_low_disk');
    // statfs calls, in order: the pass's probe (1), importRoom before the transcript (2), the transcript's one per-chunk
    // probe (3), importRoom before the sidecar window (4); the 5th is the sidecar's own floor probe inside ingestSidecar.
    const r = runShim(box, ['--op', 'import', '--apply'], { env: { HISTORY_TEST_STATFS_AFTER: `4:1:${2 ** 40}` } });
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(countOf(box, 'entries'), 'the transcript stands').toBe(1);
    expect(countOf(box, 'sidecars'), 'the sidecar waits').toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('history-sweep: capture-paused-low-disk: sidecar ingest stopped')), 'said once').toHaveLength(1);
    expect(counter(box, 'capture_paused_low_disk') - before, 'counted where it stopped, never twice').toBe(1);
  });

  it('the cap re-measured before the sidecar window stops it: at-cap said once, counted once', () => {
    const { box } = fixture('ccrc-hist-rf5a-d-');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-max-gb'), '1\n');
    const before = counter(box, 'capture_paused_at_cap');
    // importFile's importRoom measures 1 KiB; the sidecar window's measures 2 GiB.
    const r = runDriver(box, { sizeBytesSeq: [1024, 2 * 1024 ** 3] }, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(countOf(box, 'entries')).toBe(1);
    expect(countOf(box, 'sidecars')).toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('history-sweep: at-cap: sidecar ingest stopped')), 'said once').toHaveLength(1);
    expect(counter(box, 'capture_paused_at_cap') - before).toBe(1);
  });
});

describe('DM35: only regular files under a rostered projects/ root', () => {
  it('a symlinked sidecar name is never ingested and counts non_regular', () => {
    const box = boundBox('ccrc-hist-dm35a-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const t = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000d1', 'sidecar host', iso(0))]);
    const toolDir = path.join(path.dirname(t), U1, 'tool-results');
    fs.mkdirSync(toolDir, { recursive: true });
    const target = path.join(box.home, 'not-a-sidecar.txt');
    fs.writeFileSync(target, 'bytes no session wrote here\n');
    fs.symlinkSync(target, path.join(toolDir, 'toolu_01link.txt'));
    const before = counter(box, 'non_regular');
    expect(runDriver(box, { offsetMs: 31 * MIN }).code).toBe(0);
    expect(counter(box, 'non_regular') - before).toBeGreaterThanOrEqual(1);
    expect(q(box, "SELECT name FROM sidecars WHERE name = 'toolu_01link.txt'")).toEqual([]);
  });

  it('--op import --session --file outside every rostered projects/ root, or a symlink inside one, is refused, maps nothing and counts non_regular', async () => {
    const box = boundBox('ccrc-hist-dm35b-');
    plantSession(box, ID, { generation: G1, project: 'demo' });
    const outside = path.join(box.home, 'elsewhere', `${U2}.jsonl`);
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, `${JSON.stringify(userRow('a0000000-0000-4000-8000-0000000000d2', 'outside words', iso(0), U2))}\n`);
    const inside = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000d3', 'a real one', iso(0))]);
    const link = path.join(path.dirname(inside), `${U3}.jsonl`);
    fs.symlinkSync(outside, link);
    for (const [file, uuid] of [[outside, U2], [link, U3]] as const) {
      const before = counter(box, 'non_regular');
      const r = await shimPty(box, ['--op', 'import', '--session', ID, '--file', file, '--apply']);
      expect(lastResult(r.out), file).toEqual({ rc: 2, reason: 'bad-args' });
      expect(counter(box, 'non_regular') - before, file).toBe(1);
      expect(q(box, 'SELECT cc_session_uuid FROM epochs WHERE cc_session_uuid = ?', uuid), file).toEqual([]);
    }
    expect(countOf(box, 'entries')).toBe(0);
  }, 60_000);
});

describe('DM43: no copy a scheduled pass cannot finish', () => {
  it('an over-bound store: the scheduled pass writes no .tmp and no snapshot and counts migration_needs_op; --op migrate snapshots, migrates and records copy_bps', () => {
    const box = boundBox('ccrc-hist-dm43-');
    const p = paths(box);
    const db = new DatabaseSync(p.db);
    try {
      db.prepare("INSERT INTO meta (k, v) VALUES ('copy_bps', '100') ON CONFLICT (k) DO UPDATE SET v = excluded.v").run();
    } finally { db.close(); }
    expect(fs.statSync(p.db).size / 100, 'the fixture store is over the bound at 100 B/s').toBeGreaterThan(CARRIER_KILL_S / 2);
    const s = runDriver(box, { extraMigrations: [V2] });
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toMatch(/^history-sweep: migration-needs-op$/m);
    expect(names(p.backups).filter((n) => n.includes('pre-v'))).toEqual([]);
    expect(versionOf(p.db)).toBe(1);
    expect(counter(box, 'migration_needs_op')).toBe(1);
    expect(metaOf(box, 'migration')).toBe('snapshot-needs-op');
    const op = runDriver(box, { extraMigrations: [V2] }, ['--op', 'migrate']);
    expect(op.code, op.stderr).toBe(0);
    expect(lastResult(op.stdout)).toEqual({ rc: 0 });
    expect(names(p.backups)).toEqual(['pre-v2.db']);
    expect(versionOf(p.db)).toBe(2);
    expect(Number(metaOf(box, 'copy_bps'))).toBeGreaterThan(0);
    expect(metaOf(box, 'copy_bps'), 'the copy\'s measured rate replaces the seeded one').not.toBe('100');
    expect(metaOf(box, 'migration')).toBe('none');
  });

  it('--op migrate (FR2-b, D-4339): a stale partial .tmp is removed before the room check and its bytes count as room; the same room with no temp is refused', () => {
    const box = boundBox('ccrc-hist-fr2b-op-');
    const p = paths(box);
    const SIZE = 1000;
    const fsBytes = 10 * 1024 ** 3;
    const atTheLine = { env: { HISTORY_TEST_STATFS: `${floorThreshold(fsBytes) + SIZE}:${fsBytes}` } };   // free == threshold + size: planCopy refuses
    const refused = runDriver(box, { extraMigrations: [V2], sizeBytes: SIZE }, ['--op', 'migrate'], atTheLine);
    expect(lastResult(refused.stdout)).toEqual({ rc: 2, reason: 'migrate-refused' });
    expect(versionOf(p.db)).toBe(1);
    fs.mkdirSync(p.backups, { recursive: true, mode: 0o700 });
    const tmp = path.join(p.backups, '.pre-v2.db.tmp');
    fs.writeFileSync(tmp, Buffer.alloc(4096, 0x61), { mode: 0o600 });
    const op = runDriver(box, { extraMigrations: [V2], sizeBytes: SIZE }, ['--op', 'migrate'], atTheLine);
    expect(op.code, op.stderr).toBe(0);
    expect(lastResult(op.stdout)).toEqual({ rc: 0 });
    expect(fs.existsSync(tmp)).toBe(false);
    expect(versionOf(p.db)).toBe(2);
  });

  it('--op migrate with nothing due exits 0 and writes no snapshot; on a store newer than this build it answers migrate-refused', () => {
    const box = boundBox('ccrc-hist-dm43b-');
    const p = paths(box);
    const none = runShim(box, ['--op', 'migrate']);
    expect(none.code, none.stderr).toBe(0);
    expect(lastResult(none.stdout)).toEqual({ rc: 0 });
    expect(names(p.backups)).toEqual([]);
    expect(runDriver(box, { extraMigrations: [V2] }, ['--op', 'migrate']).code).toBe(0);
    const newer = runShim(box, ['--op', 'migrate']);
    expect(newer.code).toBe(2);
    expect(lastResult(newer.stdout)).toEqual({ rc: 2, reason: 'migrate-refused' });
  });
});

describe('O27: no store on a server box', () => {
  it('CCRC_ROLE=server with the shim present and no store: a scheduled pass and --op import --apply create nothing and print store-create-refused-role', () => {
    const box = makeHistoryBox('ccrc-hist-o27-', { role: 'server', shim: true });
    const root = path.join(box.home, '.ccrc', 'history');
    const s = runShim(box);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toMatch(/^history-sweep: store-create-refused-role$/m);
    const o = runShim(box, ['--op', 'import', '--apply']);
    expect(o.code, o.stderr).toBe(9);
    expect(o.stdout).toMatch(/^history-sweep: store-create-refused-role$/m);
    expect(lastResult(o.stdout)).toEqual({ rc: 9 });
    for (const f of ['db', path.join('db', 'history.db'), 'store.id', 'op']) expect(fs.existsSync(path.join(root, f)), f).toBe(false);
  });
});

describe('O34: verdicts through the outbox', () => {
  it('a kill after a drain commit that confirmed an epoch and before its verdict append: the file stays; the next tick appends the verdict first and the outbox empties', () => {
    const box = boundBox('ccrc-hist-o34a-');
    plantSession(box, ID, { generation: G1, project: 'demo' });
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    expect(runSweep(box).code).toBe(0);                                   // tick N: renamed
    const killed = runSweep(box, [], { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_KILL_AFTER_COMMIT: '2:1' } });
    expect(killed.code, 'killed right after the drain\'s FULL commit').toBeNull();
    expect(draining(box)).toHaveLength(1);
    expect(countOf(box, 'journal_outbox')).toBeGreaterThan(0);
    expect(verdicts(box, 'epoch-confirmed')).toEqual([]);
    const txlog = path.join(box.home, 'txlog');
    const next = runSweep(box, [], { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_TXLOG: txlog } });
    expect(next.code, next.stderr).toBe(0);
    expect(readTxlog(txlog)[0], 'the outbox is the tick\'s first act').toEqual(expect.objectContaining({ kind: 'journal' }));
    expect(countOf(box, 'journal_outbox')).toBe(0);
    expect(verdicts(box, 'epoch-confirmed').some((v) => v['cc_session_uuid'] === U1)).toBe(true);
    expect(draining(box)).toEqual([]);
    expect(countOf(box, 'spool_receipts')).toBe(1);
  });

  it('a later-tick confirmation commits FULL on its own and reaches the journal before the first NORMAL chunk', () => {
    const box = boundBox('ccrc-hist-o34b-');
    plantSession(box, ID, { uuid: U9, generation: G1, project: 'demo' });     // the registry names another uuid
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000b1', 'later words', iso(0))]);
    spoolLine(box, ID, startup(U1));
    expect(runSweep(box).code).toBe(0);                                   // renamed; observed .uuid = U9
    expect(runSweep(box).code).toBe(0);                                   // drained: a candidate only
    expect(epochsOf(box).map((e) => e.cc_session_uuid)).not.toContain(U1);
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });     // _sync_uuid catches up
    const txlog = path.join(box.home, 'txlog');
    const r = runSweep(box, [], { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_TXLOG: txlog } });
    expect(r.code, r.stderr).toBe(0);
    assertVerdictBeforeChunk(readTxlog(txlog), false);
    expect(verdicts(box, 'epoch-confirmed').some((v) => v['cc_session_uuid'] === U1 && v['by'] === 'later-tick')).toBe(true);
  });

  it('an --op import --session --file mapping commits FULL on its own and reaches the journal before the first NORMAL chunk, and before exit 0', async () => {
    const box = boundBox('ccrc-hist-o34c-');
    plantSession(box, ID, { generation: G1, project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000b2', 'operator words', iso(0))]);
    const txlog = path.join(box.home, 'txlog');
    const r = await shimPty(box, ['--op', 'import', '--session', ID, '--file', file, '--apply'],
      { NODE_OPTIONS: preloadOptions([PRELOADS.statfs, PRELOADS.faults]), HISTORY_TEST_TXLOG: txlog });
    expect(r.code, r.out).toBe(0);
    assertVerdictBeforeChunk(readTxlog(txlog), true);
    expect(verdicts(box, 'mapping').some((v) => v['cc_session_uuid'] === U1 && v['declared_by'] === 'operator')).toBe(true);
  }, 30_000);

  it('a periodic-scan registry mapping commits FULL on its own and reaches the journal before the first NORMAL chunk', () => {
    const box = boundBox('ccrc-hist-o34d-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000b3', 'registry words', iso(0))]);
    const txlog = path.join(box.home, 'txlog');
    const r = runDriver(box, { offsetMs: 31 * MIN }, [], { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_TXLOG: txlog } });
    expect(r.code, r.stderr).toBe(0);
    assertVerdictBeforeChunk(readTxlog(txlog), true);
    expect(verdicts(box, 'mapping').some((v) => v['cc_session_uuid'] === U1 && v['declared_by'] === 'registry')).toBe(true);
  });

  it('a pair learned on a first tick whose budget ends early is already a redact record in the journal', () => {
    const box = makeHistoryBox('ccrc-hist-o34e-', { role: 'fleet', shim: true });
    const token = createHash('sha256').update('ccrc fixture secret, synthetic').digest('hex');   // 64 hex
    fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true });
    fs.writeFileSync(path.join(box.home, '.cc-secrets', 'claude-a-oauth.env'), `CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, { mode: 0o600 });
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, Array.from({ length: 50 }, (_, i) => userRow(`a0000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, `row ${i}`, iso(0))));
    // Every read of the pass clock advances 31 s, so the 90 s run budget is gone after three reads.
    const r = runDriver(box, { stepMs: 31_000 });
    expect(r.code, r.stderr).toBe(0);
    const sha = createHash('sha256').update(token).digest('hex');
    expect(recs(box).some((x) => x.k === 'redact' && x['len'] === 64 && x['sha256'] === sha)).toBe(true);
  });
});

describe('O49: confirmation timing', () => {
  it('a ccd-spawned startup line (reg = sid) then /clear before tick N+1: both epochs chain, in line order', () => {
    const box = boundBox('ccrc-hist-o49a-');
    plantSession(box, ID, { generation: G1, project: 'demo' });
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    spoolLine(box, ID, clearLine(U2));
    plantSession(box, ID, { uuid: U2, generation: G1, project: 'demo' });     // .uuid has moved on before the rename
    expect(runSweep(box).code).toBe(0);
    expect(runSweep(box).code).toBe(0);
    expect(epochsOf(box).map((e) => [e.cc_session_uuid, e.cause, e.seq])).toEqual([[U1, 'startup', 1], [U2, 'clear', 2]]);
  });

  it('the same with no sweep for an hour: lines an hour old still chain both', () => {
    const box = boundBox('ccrc-hist-o49b-');
    plantSession(box, ID, { generation: G1, project: 'demo' });
    const hourAgo = Date.now() - 60 * MIN;
    spoolLine(box, ID, startup(U1, { reg: U1, ts: hourAgo }));
    spoolLine(box, ID, clearLine(U2, { ts: hourAgo + 1000 }));
    plantSession(box, ID, { uuid: U2, generation: G1, project: 'demo' });
    expect(runSweep(box).code).toBe(0);
    expect(runSweep(box).code).toBe(0);
    expect(epochsOf(box).map((e) => [e.cc_session_uuid, e.cause, e.seq])).toEqual([[U1, 'startup', 1], [U2, 'clear', 2]]);
  });

  it('a nested claude -p line (reg ≠ sid) is never chained and counts epoch_unconfirmed after the window', () => {
    const box = boundBox('ccrc-hist-o49c-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    spoolLine(box, ID, startup(U3, { reg: U1 }));
    expect(runSweep(box).code).toBe(0);
    expect(runSweep(box).code).toBe(0);
    expect(runDriver(box, { offsetMs: 8 * DAY }).code).toBe(0);
    expect(epochsOf(box).map((e) => e.cc_session_uuid)).not.toContain(U3);
    expect(counter(box, 'epoch_unconfirmed')).toBe(1);
  });

  it('an in-pane /resume superseded by a clear before any observation counts epoch_unconfirmed_superseded', () => {
    const box = boundBox('ccrc-hist-o49d-');
    plantSession(box, ID, { generation: G1, project: 'demo' });
    spoolLine(box, ID, resumeLine(U1));
    spoolLine(box, ID, clearLine(U2));
    plantSession(box, ID, { uuid: U2, generation: G1, project: 'demo' });
    expect(runSweep(box).code).toBe(0);
    expect(runSweep(box).code).toBe(0);
    expect(runDriver(box, { offsetMs: 8 * DAY }).code).toBe(0);
    expect(epochsOf(box).map((e) => e.cc_session_uuid)).toEqual([U2]);
    expect(counter(box, 'epoch_unconfirmed_superseded')).toBe(1);
  });

  it('an --op pass observes at lock take, so a /clear during a long --op keeps the startup epoch', () => {
    const box = boundBox('ccrc-hist-o49e-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    spoolLine(box, ID, startup(U1));                                      // no reg: the observation must name it
    // An --op pass that never ticks: the driver's v2 makes `import --apply` answer migration-pending right after the
    // store opens, so only the journal halves (at lock take and, since RF5a, at release) rename and observe the file
    // (U1). The store stays at v1, so the scheduled passes below run as before.
    const op = runDriver(box, { extraMigrations: [V2] }, ['--op', 'import', '--apply']);
    expect(op.code, op.stderr).toBe(5);
    expect(lastResult(op.stdout)).toEqual({ rc: 5, reason: 'migration-pending' });
    expect(draining(box), 'renamed and observed at lock take').toHaveLength(1);
    plantSession(box, ID, { uuid: U2, generation: G1, project: 'demo' });     // the pane /clears meanwhile
    spoolLine(box, ID, clearLine(U2));
    expect(runSweep(box).code).toBe(0);
    expect(runSweep(box).code).toBe(0);
    expect(epochsOf(box).map((e) => [e.cc_session_uuid, e.cause, e.seq])).toEqual([[U1, 'startup', 1], [U2, 'clear', 2]]);
  });
});

describe('RF5a F19: the half at release runs on every --op outcome (§9.2, D-4232)', () => {
  /** A hook's line landing in spool/ once the pass has taken its lock-take half and made its first probe. */
  const mid = [{ rel: '.ccrc/history/spool/claude-a-demo.jsonl', text: '\n' + JSON.stringify(startup(U1, { reg: U1 })) + '\n' }];
  const spooled = (box: HistoryBox): string[] => names(paths(box).spool).filter((n) => n.endsWith('.jsonl'));

  it('a refusal (migration-pending) still renames, observes and journals a line spooled during the pass', () => {
    const box = boundBox('ccrc-hist-rf5a-19a-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const op = runDriver(box, { extraMigrations: [V2], afterFirstStatfs: mid }, ['--op', 'import', '--apply']);
    expect(op.code, op.stderr).toBe(5);
    expect(lastResult(op.stdout)).toEqual({ rc: 5, reason: 'migration-pending' });
    expect(spooled(box), 'the release half renamed it').toEqual([]);
    const held = draining(box);
    expect(held).toHaveLength(1);
    expect(names(paths(box).draining), 'observed: its .obs beside it').toContain(held[0]!.replace(/\.jsonl$/, '.obs'));
    expect(recs(box).filter((r) => r.k === 'file' && r['name'] === held[0]), 'journaled: a file record').toHaveLength(1);
    expect(recs(box).filter((r) => r.k === 'spool'), 'and its spool record').toHaveLength(1);
  });

  it('a release half that fails keeps the refusal\'s word, says journal-unwritable and counts it', () => {
    const box = boundBox('ccrc-hist-rf5a-19b-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const before = counter(box, 'journal_write_failed');
    // The one-shot ENOSPC meets the first journal append of the pass: the lock-take half has nothing to journal and
    // flushFirst writes nothing for an empty outbox, so it is the release half's.
    const op = runDriver(box, { extraMigrations: [V2], afterFirstStatfs: mid }, ['--op', 'import', '--apply'],
      { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: '/journal/' } });
    expect(op.code, op.stderr).toBe(5);
    const last = op.stdout.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '').pop();
    expect(last).toBe('{"rc":5,"reason":"migration-pending"}');
    expect(op.stdout).toMatch(/^history-sweep: journal-unwritable$/m);
    expect(counter(box, 'journal_write_failed') - before).toBe(1);
    const held = draining(box);
    expect(held, 'held in .draining/').toHaveLength(1);
    expect(names(paths(box).draining)).toContain(held[0]!.replace(/\.jsonl$/, '.obs'));
  });

  // FU4 M26: the half at release runs EXACTLY once per pass, whatever throws. A non-JournalError out of it (a non-ENOENT
  // readdir error here) used to land in opPass's catch, which ran the half a second time and said `internal error` twice.
  it('a non-JournalError thrown by the release half itself says internal error once and answers rc 1 (M26)', () => {
    const box = boundBox('ccrc-hist-fu4-26-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    // The first TWO readdirs of spool/ after the probe fail. The first is the half at release (a refusal does nothing between);
    // a second run of the half, from the catch the throw used to land in, meets the second fault and escapes to the wrapper:
    // two `internal error` lines. Run once, the half's throw escapes to the wrapper alone: one line, and the line count is
    // also what proves the first fault was the half's (a body throw would reach the half, and the second fault, too).
    const op = runDriver(box, { extraMigrations: [V2], afterFirstStatfs: mid, throwTimesAfterFirstStatfs: { fn: 'readdirSync', needle: '/history/spool', code: 'EIO', times: 2 } },
      ['--op', 'import', '--apply']);
    expect(op.code, op.stderr).toBe(1);
    expect(op.stderr.match(/history-sweep: internal error/g) ?? [], op.stderr).toHaveLength(1);
    expect(lastResult(op.stdout)).toEqual({ rc: 1 });
  });

  // Review 316 round 1 F1: opPass answers through `released` at about a dozen return sites, each its own guard. One case per
  // outcome a test can reach; reverting any site to a bare `result(` leaves the mid-pass line in spool/ and reds its case.
  // Not reached here: the openStore throw, and the `ids === null` guard after a successful open (idsFromFiles read the same files
  // openStore's own facts just measured; an unreadable writer is the openStore word case below). store-unreachable is reached by
  // the driver's hangAfterAppend (the line lands, then the probe never settles: FU4 M27), and the openStore word that is not an
  // exit-5 word by its openStoreWord (no real store reaches one past the role gate: FU4 M28).
  // The mutation of each reached site to a bare `result(` was measured red on its own case (task notes, fix round 1; FU4).
  const OUTCOMES: Array<{
    name: string; rc: number; reason?: string; journaled: boolean;
    arrange: (box: HistoryBox) => { tty?: boolean; args: string[]; deps?: Partial<DriverDeps>; opts?: { preloads?: string[]; env?: Record<string, string> } };
  }> = [
    { name: 'roster-unreadable', rc: 2, reason: 'roster-unreadable', journaled: true,
      arrange: () => ({ args: ['--op', 'import', '--apply', '--roster-unreadable'] }) },
    { name: 'bad-args (the operator form, a file outside every root)', rc: 2, reason: 'bad-args', journaled: true,
      arrange: (box) => {
        plantSession(box, ID, { generation: G1, project: 'demo' });
        const outside = path.join(box.home, 'elsewhere', `${U2}.jsonl`);
        fs.mkdirSync(path.dirname(outside), { recursive: true });
        fs.writeFileSync(outside, `${JSON.stringify(userRow('a0000000-0000-4000-8000-0000000000d2', 'outside words', iso(0), U2))}\n`);
        return { tty: true, args: ['--op', 'import', '--session', ID, '--file', outside, '--apply'] };
      } },
    { name: 'uuid-claimed (the operator form)', rc: 2, reason: 'uuid-claimed', journaled: true,
      arrange: (box) => {
        const OTHER = 'claude-b-demo';
        plantSession(box, OTHER, { uuid: U1, generation: G1, project: 'demo' });
        expect(runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] }).code).toBe(0);   // the registry scan maps U1 to OTHER
        plantSession(box, ID, { generation: G1, project: 'demo' });
        const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f8', 'claimed elsewhere', iso(0))]);
        return { tty: true, args: ['--op', 'import', '--session', ID, '--file', file, '--apply'] };
      } },
    { name: 'store-unmeasured (an unreadable store.writer)', rc: 5, reason: 'store-unmeasured', journaled: false,
      arrange: (box) => {
        fs.writeFileSync(path.join(paths(box).root, 'store.writer'), 'not a writer token\n');   // off WRITER_RE: measured unreadable, so no journal to write into
        return { args: ['--op', 'import', '--apply'] };
      } },
    { name: 'store-unreachable (the line lands, then the probe never settles: a dead volume)', rc: 5, reason: 'store-unreachable', journaled: true,
      arrange: () => ({ args: ['--op', 'import', '--apply'], deps: { hangAfterAppend: true } }) },
    { name: 'an openStore word that is not an exit-5 word (the INTERNAL arm)', rc: 1, journaled: true,
      arrange: () => ({ args: ['--op', 'import', '--apply'], deps: { openStoreWord: 'store-create-refused-role' } }) },
    { name: 'migrate-refused (a store at a newer schema)', rc: 2, reason: 'migrate-refused', journaled: true,
      arrange: (box) => {
        const db = new DatabaseSync(paths(box).db);
        try { db.exec('PRAGMA user_version = 2'); } finally { db.close(); }
        return { args: ['--op', 'migrate'] };
      } },
    { name: 'flushFirst cannot append a waiting verdict (a one-shot ENOSPC at the journal)', rc: 1, journaled: true,
      arrange: (box) => {
        const db = new DatabaseSync(paths(box).db);
        try {
          db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)').run(journalRecord('verdict', Date.now(), { event_key: 'none', kind: 'drained', file: 'x.1.1.jsonl' }));
        } finally { db.close(); }
        return { args: ['--op', 'import', '--apply'], opts: { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: '/journal/' } } };
      } },
    { name: 'the verb\'s own journal append fails (the JournalError arm)', rc: 1, journaled: true,
      arrange: (box) => {
        plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
        plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f9', 'append fails', iso(0))]);
        return { args: ['--op', 'import', '--apply'], opts: { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: '/journal/' } } };
      } },
    { name: 'an internal throw out of the verb (an injected commit failure)', rc: 1, journaled: true,
      arrange: (box) => {
        plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
        plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f9', 'commit fails', iso(0))]);
        return { args: ['--op', 'import', '--apply'], opts: { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_FAIL_COMMIT: '1' } } };
      } },
  ];
  OUTCOMES.forEach((c, i) => {
    it(`${c.name}: the release half still renames the mid-pass line out of spool/${c.journaled ? ' and journals it' : ''}`, async () => {
      const box = boundBox(`ccrc-hist-rf5a-19t${i}-`);
      const a = c.arrange(box);
      const deps = { afterFirstStatfs: mid, ...a.deps };
      const op = a.tty === true ? await driverPty(box, deps, a.args) : runDriver(box, deps, a.args, a.opts);
      const stdout = 'out' in op ? op.out : op.stdout;
      expect(lastResult(stdout), stdout).toEqual(c.reason === undefined ? { rc: c.rc } : { rc: c.rc, reason: c.reason });
      expect(spooled(box), 'the release half renamed it').toEqual([]);
      expect(draining(box), 'and holds it in .draining/').toHaveLength(1);
      if (c.journaled) expect(recs(box).filter((r) => r.k === 'spool'), 'and journaled its spool record').toHaveLength(1);
    }, 60_000);   // the uuid-claimed row runs a full driver pass, then driverPty's own 19 s kill: under vitest's 20 s default a slow pty showed as a bare timeout (FU4 M29)
  });

  it('CONTROL: --op migrate with nothing to migrate journals the same mid-pass line', () => {
    const box = boundBox('ccrc-hist-rf5a-19c-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const op = runDriver(box, { afterFirstStatfs: mid }, ['--op', 'migrate']);
    expect(op.code, op.stderr).toBe(0);
    expect(lastResult(op.stdout)).toEqual({ rc: 0 });
    expect(spooled(box)).toEqual([]);
    expect(recs(box).filter((r) => r.k === 'spool'), 'the line is journaled').toHaveLength(1);
  });
});

// §9.6 op-running (Task 25 review round 1, F1): the marker `<verb> <pid> <start_ms>` that an --op pass writes under
// the lock and that every pass's store open sweeps when it is stale. The pass that died holds the only live
// evidence of the written marker (a clean exit removes it), so the kill preload leaves one behind.
describe('the op marker (§9.6)', () => {
  const opFile = (box: HistoryBox): string => path.join(paths(box).root, 'op');
  const dead = (pid: number): boolean => { try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; } };

  it('an --op pass writes `<verb> <pid> <start_ms>` once it holds the lock; a scheduled pass then removes it, the pass being dead', () => {
    const box = boundBox('ccrc-hist-opm-a-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000c1', 'marker words', iso(0))]);
    expect(fs.existsSync(opFile(box)), 'CONTROL: no marker before the pass').toBe(false);
    const t0 = Date.now();
    // SIGKILL right after the first FULL commit (the mapping verdict): the pass wrote its marker, never reached its exit.
    const killed = runShim(box, ['--op', 'import', '--apply'],
      { preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_KILL_AFTER_COMMIT: '2:1' } });
    expect(killed.code, 'killed mid-pass').toBeNull();
    expect(fs.existsSync(opFile(box)), 'the marker stands while the pass runs').toBe(true);
    const text = fs.readFileSync(opFile(box), 'utf8');
    const m = /^import ([1-9][0-9]*) ([0-9]+)\n$/.exec(text);
    expect(m, JSON.stringify(text)).not.toBeNull();
    expect(Number(m![2]), 'the start time is the pass clock').toBeGreaterThanOrEqual(t0 - 1000);
    expect(Number(m![2])).toBeLessThanOrEqual(Date.now() + 1000);
    expect(dead(Number(m![1])), 'the pid names the killed pass').toBe(true);
    expect(fs.statSync(opFile(box)).mode & 0o777, 'a 0600 file').toBe(0o600);
    const next = runSweep(box);
    expect(next.code, next.stderr).toBe(0);
    expect(fs.existsSync(opFile(box)), 'a scheduled pass removes a dead pid\'s marker').toBe(false);
  });

  it('a FIFO at the op marker is stale: a scheduled pass removes it and exits 0 promptly', () => {
    const box = boundBox('ccrc-hist-opm-c-');
    expect(spawnSync('mkfifo', [opFile(box)]).status).toBe(0);
    const r = runSweep(box, [], { timeoutMs: 30_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(fs.existsSync(opFile(box))).toBe(false);
  });

  it('a scheduled pass removes a malformed marker and keeps one naming a live pid', () => {
    const box = boundBox('ccrc-hist-opm-b-');
    for (const junk of ['garbage', '', 'import 4242', 'import 0 1700000000000\n']) {
      fs.writeFileSync(opFile(box), junk);
      const r = runSweep(box);
      expect(r.code, r.stderr).toBe(0);
      expect(fs.existsSync(opFile(box)), `a marker of ${JSON.stringify(junk)} names no live pid`).toBe(false);
    }
    // A pid that exited: spawn a child, let it finish, plant its pid.
    const gone = spawnSync(process.execPath, ['-e', '0']);
    expect(dead(gone.pid!), 'CONTROL: the child is gone').toBe(true);
    fs.writeFileSync(opFile(box), `import ${gone.pid} 1700000000000\n`);
    expect(runSweep(box).code).toBe(0);
    expect(fs.existsSync(opFile(box)), 'a dead pid\'s marker is stale').toBe(false);
    const live = `migrate ${process.pid} 1700000000000\n`;               // this test process is alive
    fs.writeFileSync(opFile(box), live);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(fs.readFileSync(opFile(box), 'utf8'), 'a live pid\'s marker is another pass\'s, and stands').toBe(live);
  });
});

describe('DI13: a migration\'s done attempt marker is cleared at both call sites (review 316 F27)', () => {
  /** N at or below the store's version is done; N above it is pending. */
  const plantMarkers = (box: HistoryBox): { done: string; pending: string } => {
    const v = versionOf(paths(box).db);
    const done = `.pre-v${v}.attempt`;
    const pending = `.pre-v${v + 1}.attempt`;
    fs.mkdirSync(paths(box).backups, { recursive: true, mode: 0o700 });
    for (const n of [done, pending]) fs.writeFileSync(path.join(paths(box).backups, n), '1\n', { mode: 0o600 });
    return { done, pending };
  };

  it('a scheduled pass clears a marker at or below the store\'s version and keeps a later one', () => {
    const box = boundBox('ccrc-hist-di13a-');
    const m = plantMarkers(box);
    const r = runSweep(box);
    expect(r.code, r.stderr).toBe(0);
    expect(names(paths(box).backups).filter((n) => n.endsWith('.attempt'))).toEqual([m.pending]);
  });

  it('an --op pass clears it too', () => {
    const box = boundBox('ccrc-hist-di13b-');
    const m = plantMarkers(box);
    const r = runShim(box, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(names(paths(box).backups).filter((n) => n.endsWith('.attempt'))).toEqual([m.pending]);
  });
});

// ── Task 26: the periodic census (§9.2 step 2, §9.15, W1-j, W1-k) ─────────────────────────────────

describe('O38: the export\'s due rule (B1 half)', () => {
  const OLD = 'a0000000-0000-4000-8000-0000000006a1';
  /** A box whose every rostered home keeps 180 days, holding six distinct blobs whose ages are chosen
   *  around the horizons this pin walks: 150 (180), 60 (90), 30 (60) and 0 (30). The NULL-ts row lives in
   *  a second transcript whose file is 170 days old. The managed-settings list is the fixture's own. */
  function censusBox(prefix: string): { box: HistoryBox; MS: string[]; settings: (h: string, body: string) => void; nullFile: string; mainFile: string } {
    const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
    const settings = (h: string, body: string): void => { fs.writeFileSync(path.join(h, 'settings.json'), body); };
    for (const h of box.homes) settings(h, JSON.stringify({ cleanupPeriodDays: 180 }));
    const etc = path.join(box.home, 'etc-claude-code');
    fs.mkdirSync(path.join(etc, 'managed-settings.d'), { recursive: true });
    const MS = [path.join(etc, 'managed-settings.json'), path.join(etc, 'managed-settings.d')];
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantSession(box, 'claude-noclock', { uuid: U2, generation: G1, project: 'demo' });
    const mainFile = plantTranscript(box, 'claude', SLUG, U1, [
      userRow(OLD, 'old only', iso(160 * DAY)),
      userRow('a0000000-0000-4000-8000-0000000006a2', 'mid only', iso(100 * DAY)),
      userRow('a0000000-0000-4000-8000-0000000006a3', 'near only', iso(45 * DAY)),
      userRow('a0000000-0000-4000-8000-0000000006a4', 'young only', iso(10 * DAY)),
      userRow('a0000000-0000-4000-8000-0000000006a5', 'shared words', iso(160 * DAY)),
      userRow('a0000000-0000-4000-8000-0000000006a6', 'shared words', iso(10 * DAY)),
    ]);
    // A row with no `timestamp` at all: its ts_ms is NULL, so its age is its newest holding file's mtime.
    const noClock = { type: 'user', uuid: 'a0000000-0000-4000-8000-0000000006a7', parentUuid: null, sessionId: U2, cwd: '/home/u/tree/demo', message: { role: 'user', content: 'no clock' } };
    const nullFile = plantTranscript(box, 'claude', SLUG, U2, [noClock]);
    const past = new Date(Date.now() - 170 * DAY);
    fs.utimesSync(nullFile, past, past);
    const r = runDriver(box, { managedSettings: MS });
    expect(r.code, r.stderr).toBe(0);
    expect(countOf(box, 'entries'), 'every row ingested by the first pass').toBe(7);
    return { box, MS, settings, nullFile, mainFile };
  }
  /** One census, k periodic intervals on, so SCAN_INTERVAL_MS has passed since the last. */
  function census(box: HistoryBox, MS: string[], k: number): void {
    const r = runDriver(box, { offsetMs: k * 31 * MIN, managedSettings: MS });
    expect(r.code, r.stderr).toBe(0);
  }
  const due = (box: HistoryBox): number => Number(metaOf(box, 'export_due'));

  it('180 everywhere: horizon 150, so the old blob and the NULL-ts blob aged by its 170-day file are due, and nothing younger', () => {
    const { box } = censusBox('ccrc-hist-o38a-');
    expect(metaOf(box, 'retention_min')).toBe('180');
    expect(due(box)).toBe(2);
    expect(metaOf(box, 'export_overdue')).toBe('0');
  });

  it('a home without the key: 30, horizon 0, everything due, and retention-lowered names that home', () => {
    const { box, MS, settings } = censusBox('ccrc-hist-o38b-');
    const lowered = box.homes.find((h) => h.endsWith('.claude-a'))!;
    settings(lowered, '{}');
    census(box, MS, 1);
    expect(metaOf(box, 'retention_min')).toBe('30');
    expect(due(box)).toBe(6);
    expect(JSON.parse(metaOf(box, 'retention_lowered')!)).toEqual({ home: lowered, days: 30, othersMin: 180 });
    settings(lowered, JSON.stringify({ cleanupPeriodDays: 180 }));
    census(box, MS, 2);
    expect(due(box)).toBe(2);
    expect(metaOf(box, 'retention_lowered')).toBe('');
  });

  it('0, "x" or unparseable on a home last measured 180: retention_unmeasured counts, the home stays 180, no blob becomes due', () => {
    const { box, MS, settings } = censusBox('ccrc-hist-o38c-');
    const h = box.homes.find((x) => x.endsWith('.claude-a'))!;
    const before = counter(box, 'retention_unmeasured');
    let k = 1;
    for (const body of [JSON.stringify({ cleanupPeriodDays: 0 }), JSON.stringify({ cleanupPeriodDays: 'x' }), '{']) {
      settings(h, body);
      census(box, MS, k);
      k += 1;
      expect(metaOf(box, `retention:${h}`), body).toBe('180');
      expect(metaOf(box, `retention_state:${h}`), body).toBe('unmeasured');
      expect(due(box), body).toBe(2);
    }
    expect(counter(box, 'retention_unmeasured') - before).toBe(3);
  });

  it('the same on a home never measured: it counts as 30', () => {
    const box = makeHistoryBox('ccrc-hist-o38d-', { role: 'fleet', shim: true });
    const etc = path.join(box.home, 'etc-claude-code');
    const MS = [path.join(etc, 'managed-settings.json'), path.join(etc, 'managed-settings.d')];
    for (const h of box.homes) fs.writeFileSync(path.join(h, 'settings.json'), h.endsWith('.claude-a') ? '{' : JSON.stringify({ cleanupPeriodDays: 180 }));
    expect(runDriver(box, { managedSettings: MS }).code).toBe(0);
    const h = box.homes.find((x) => x.endsWith('.claude-a'))!;
    expect(metaOf(box, `retention:${h}`), 'a home never measured records no value').toBeNull();
    expect(metaOf(box, `retention_state:${h}`)).toBe('unmeasured');
    expect(metaOf(box, 'retention_min')).toBe('30');
  });

  it('RF5b F13: a home that leaves the roster stops being retention-unmeasured at the next pass; an unreadable roster removes nothing; an empty readable roster removes every one', () => {
    const { box, MS, settings } = censusBox('ccrc-hist-rf5b13-');
    const A = box.homes.find((x) => x.endsWith('.claude-a'))!;
    settings(A, '{');
    census(box, MS, 1);
    expect(metaOf(box, 'retention_state:' + A)).toBe('unmeasured');
    expect(metaOf(box, 'retention:' + A)).toBe('180');
    // CONTROL for the guard: an unreadable roster knows no home, so it skips the census and removes nothing.
    const control = runDriver({ ...box, homes: [] }, { offsetMs: 32 * MIN, managedSettings: MS }, ['--roster-unreadable']);
    expect(control.code, control.stderr).toBe(0);
    expect(metaOf(box, 'retention_state:' + A), 'an unreadable roster is not an empty one').toBe('unmeasured');
    // A readable roster without A: A's verdict goes, its last measured days stay, and status stops naming it.
    const gone = runDriver({ ...box, homes: box.homes.filter((h) => h !== A) }, { offsetMs: 33 * MIN, managedSettings: MS });
    expect(gone.code, gone.stderr).toBe(0);
    expect(metaOf(box, 'retention_state:' + A)).toBeNull();
    expect(metaOf(box, 'retention:' + A), 'the last measured days are kept for a home that rejoins').toBe('180');
    const st = spawnSync(process.execPath, ['--no-warnings', CLI, 'status', '--json'], {
      cwd: box.home, encoding: 'utf8',
      env: { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]) },
    });
    const env = JSON.parse(st.stdout.trim().split('\n').at(-1)!) as { retention: { unmeasured: string[] } };
    expect(env.retention.unmeasured).toEqual([]);
    // A readable, EMPTY roster is not an unreadable one: it removes every verdict.
    const empty = runDriver({ ...box, homes: [] }, { offsetMs: 34 * MIN, managedSettings: MS });
    expect(empty.code, empty.stderr).toBe(0);
    expect(q(box, "SELECT k FROM meta WHERE k LIKE 'retention\\_state:%' ESCAPE '\\'")).toEqual([]);
  });

  it('a managed-settings file with 90 under homes of 180 gives 90, and a managed-settings.d/ drop-in with 60 gives 60', () => {
    const { box, MS } = censusBox('ccrc-hist-o38e-');
    fs.writeFileSync(MS[0]!, JSON.stringify({ cleanupPeriodDays: 90 }));
    census(box, MS, 1);
    expect(metaOf(box, 'retention_min')).toBe('90');
    expect(due(box), 'horizon 60: old, mid and the NULL-ts blob').toBe(3);
    fs.writeFileSync(path.join(MS[1]!, '50-short.json'), JSON.stringify({ cleanupPeriodDays: 60 }));
    census(box, MS, 2);
    expect(metaOf(box, 'retention_min')).toBe('60');
    expect(due(box), 'horizon 30: and near too').toBe(4);
  });

  it('a blob with an old and a younger referrer is not due; a NULL-ts row ages by its newest holding file', () => {
    const { box, MS, nullFile } = censusBox('ccrc-hist-o38f-');
    expect(due(box), 'the shared blob is not among the two').toBe(2);
    const now = new Date();
    fs.utimesSync(nullFile, now, now);
    census(box, MS, 1);
    expect(due(box), 'with a fresh file the NULL-ts row is young').toBe(1);
  });

  it('a FIFO at a rostered home\'s settings.json never blocks the census: retention_unmeasured counts, the home keeps 180 (review 316 F10)', () => {
    const { box, MS } = censusBox('ccrc-hist-o38f-');
    const h = box.homes.find((x) => x.endsWith('.claude-a'))!;
    const before = counter(box, 'retention_unmeasured');
    fs.rmSync(path.join(h, 'settings.json'));
    expect(spawnSync('mkfifo', [path.join(h, 'settings.json')]).status).toBe(0);
    const r = runDriver(box, { offsetMs: 31 * MIN, managedSettings: MS }, [], { timeoutMs: 30_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(counter(box, 'retention_unmeasured') - before).toBe(1);
    expect(metaOf(box, `retention:${h}`)).toBe('180');
  });

  it('overdue by the file clock: a due blob whose holding file is gone, or past its mtime plus its home\'s retention, FAILs; fresh files never', () => {
    const { box, MS, nullFile, mainFile } = censusBox('ccrc-hist-o38g-');
    expect(metaOf(box, 'export_overdue'), 'due by the row clock, its files fresh').toBe('0');
    fs.rmSync(mainFile);
    census(box, MS, 1);
    expect(metaOf(box, 'export_overdue'), 'the old blob\'s only file is gone').toBe('1');
    const past = new Date(Date.now() - 200 * DAY);
    fs.utimesSync(nullFile, past, past);
    census(box, MS, 2);
    expect(metaOf(box, 'export_overdue'), 'and the NULL-ts blob\'s file is past 200 > 180 days').toBe('2');
  });

  it('W1-k: the census records the oldest row, its row-clock due date and the file clock\'s first deletion date', () => {
    const { box } = censusBox('ccrc-hist-o38h-');
    const oldest = Number(metaOf(box, 'oldest_row_ms'));
    expect(Math.abs(oldest - (Date.now() - 160 * DAY))).toBeLessThan(10 * MIN);
    expect(Number(metaOf(box, 'first_due_ms')) - oldest).toBe(150 * DAY);
    const firstDeletion = Number(metaOf(box, 'first_deletion_ms'));
    expect(Math.abs(firstDeletion - (Date.now() + 10 * DAY)), 'the 170-day file plus 180 days').toBeLessThan(10 * MIN);
  });
});

describe('W1-j and O34: the journal audit', () => {
  function auditBox(prefix: string, withSecret: boolean): HistoryBox {
    const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
    if (withSecret) {
      const token = createHash('sha256').update('ccrc fixture audit secret, synthetic').digest('hex');
      fs.mkdirSync(path.join(box.home, '.cc-secrets'), { recursive: true });
      fs.writeFileSync(path.join(box.home, '.cc-secrets', 'claude-a-oauth.env'), `CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, { mode: 0o600 });
    }
    expect(runDriver(box, { managedSettings: [] }).code).toBe(0);           // creates the store; first census
    plantSession(box, ID, { generation: G1, project: 'demo' });
    spoolLine(box, ID, startup(U1, { reg: U1 }));
    expect(runDriver(box, { offsetMs: MIN, managedSettings: [] }).code).toBe(0);       // renamed
    expect(runDriver(box, { offsetMs: 2 * MIN, managedSettings: [] }).code).toBe(0);   // drained: a family, an epoch, a receipt
    expect(countOf(box, 'spool_receipts')).toBe(1);
    return box;
  }
  const monthFiles = (box: HistoryBox): string[] => {
    const dir = path.join(paths(box).journal, fs.readFileSync(paths(box).storeId, 'utf8').trim());
    return names(dir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(dir, n));
  };

  it('a complete journal: every receipt, family, epoch and redaction pair has its record — all three missing counters 0', () => {
    const box = auditBox('ccrc-hist-audit-a-', true);
    expect(countOf(box, 'redact_hashes'), 'a pair to audit').toBeGreaterThan(0);
    expect(runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] }).code).toBe(0);
    expect(metaOf(box, 'journal_audit_ms')).toMatch(/^[0-9]+$/);
    expect(counter(box, 'journal_missing_spool')).toBe(0);
    expect(counter(box, 'journal_missing_verdict')).toBe(0);
    expect(counter(box, 'journal_missing_redact')).toBe(0);
    expect(metaOf(box, 'journal_skipped')).toBe('0');
    expect(Number(metaOf(box, 'journal_growth_30d'))).toBeGreaterThan(0);
  });

  it('a receipt whose spool record is gone counts journal_missing_spool, once', () => {
    const box = auditBox('ccrc-hist-audit-b-', false);
    for (const f of monthFiles(box)) {
      const kept = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.includes('"k":"spool"')).join('\n');
      fs.writeFileSync(f, kept);
    }
    expect(runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] }).code).toBe(0);
    expect(counter(box, 'journal_missing_spool')).toBe(1);
    expect(counter(box, 'journal_missing_verdict')).toBe(0);
    expect(runDriver(box, { offsetMs: 62 * MIN, managedSettings: [] }).code).toBe(0);
    expect(counter(box, 'journal_missing_spool'), 'an audited row is never recounted').toBe(1);
  });

  it('a malformed journal line is skipped and named in journal_skipped', () => {
    const box = auditBox('ccrc-hist-audit-c-', false);
    fs.appendFileSync(monthFiles(box)[0]!, '{"v":1,"k":\n');
    expect(runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] }).code).toBe(0);
    expect(metaOf(box, 'journal_skipped')).toBe('1');
  });

  it('no census inside SCAN_INTERVAL_MS: a pass 10 minutes on audits nothing new', () => {
    const box = auditBox('ccrc-hist-audit-d-', false);
    expect(metaOf(box, 'journal_audit_ms'), 'the creating pass audited an empty store').toMatch(/^[0-9]+$/);
    const at = metaOf(box, 'journal_audit_ms');
    expect(runDriver(box, { offsetMs: 10 * MIN, managedSettings: [] }).code).toBe(0);
    expect(metaOf(box, 'journal_audit_ms')).toBe(at);
  });

  it('verdicts still in the outbox are not missing: an audit pass whose journal cannot be appended skips, and runs once the outbox empties', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();   // root writes into a 0500 directory regardless of its mode (Task 15's rule)
    const box = auditBox('ccrc-hist-audit-e-', false);
    for (const f of monthFiles(box)) {
      const kept = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.includes('"k":"verdict"')).join('\n');
      fs.writeFileSync(f, kept);
    }
    const before = metaOf(box, 'journal_audit_ms');
    expect(before, 'the creating pass audited an empty store').toMatch(/^[0-9]+$/);
    const db = new DatabaseSync(paths(box).db);
    try {
      db.prepare('INSERT INTO journal_outbox (rec) VALUES (?)').run(journalRecord('verdict', Date.now(), { event_key: 'none', kind: 'drained', file: 'x.1.1.jsonl' }));
    } finally { db.close(); }
    // The pass clock is read into NEXT month, so its flush must create a new month file; a 0500 store directory
    // refuses that (fixModes never chmods a directory, so the refusal stands), while the old month files stay
    // readable for the audit. A chmod of the month file itself would be undone by the pass's fixModes.
    const dir = path.dirname(monthFiles(box)[0]!);
    const nowD = new Date();
    const nextMonth = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + 1, 1);
    const offset = nextMonth - Date.now() + 31 * MIN;
    fs.chmodSync(dir, 0o500);
    try {
      const skipped = runDriver(box, { offsetMs: offset, managedSettings: [] });
      expect(skipped.code, skipped.stderr).toBe(0);
      expect(countOf(box, 'journal_outbox'), 'the flush could not append, so the row waits').toBe(1);
      expect(counter(box, 'journal_write_failed'), 'the refusal was counted').toBeGreaterThan(0);
      expect(counter(box, 'journal_missing_verdict'), 'an in-flight verdict is not a missing one').toBe(0);
      expect(metaOf(box, 'journal_audit_ms'), 'the audit skipped').toBe(before);
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    expect(runDriver(box, { offsetMs: offset + 31 * MIN, managedSettings: [] }).code).toBe(0);
    expect(countOf(box, 'journal_outbox'), 'CONTROL: the next flush empties it').toBe(0);
    expect(Number(metaOf(box, 'journal_audit_ms')), 'and the audit runs').toBeGreaterThan(Number(before));
  });

  // RF5a F17 (review 316): the audit reads a month file in pieces and asks its budget inside the file. In-process, the
  // sweep's journalAudit called directly on a fixture store, so the clock and the reads are the test's to count.
  type AuditSweep = {
    journalAudit(db: DatabaseSync, ctx: unknown, nowMs: number): boolean;
    newBudget(now: () => number, limits?: { maxMs?: number }): unknown;
    AUDIT_READ_BYTES: number;
  };
  function auditFixture(prefix: string, body: (SWA: AuditSweep, db: DatabaseSync, ctx: (budget: unknown) => unknown, month: string, dir: string) => Promise<void>): Promise<void> {
    const box = makeHistoryBox(prefix, { role: 'fleet' });
    const ids = createStore(box.home) as { storeId: string; writer: string };
    const hp = historyPaths(box.home);
    const db = openWriter(hp.dbFile) as DatabaseSync;
    const dir = path.join(hp.journalDir, ids.storeId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const month = path.join(dir, `${new Date().toISOString().slice(0, 7)}.${ids.writer}.jsonl`);
    const ctx = (budget: unknown): unknown => ({ ids, paths: hp, budget });
    return (async () => {
      const SWA = (await import('../../ccd/history/sweep.mjs')) as unknown as AuditSweep;
      try { await body(SWA, db, ctx, month, dir); } finally { closeWriter(db); }
    })();
  }
  const tickLine = journalRecord('tick', Date.now(), { lag_ms: null }) + '\n';

  it('RF5a F17: a month larger than what is left of the budget stops the audit INSIDE the file, unfinished', async () => {
    await auditFixture('ccrc-hist-rf5a-17a-', async (SWA, db, ctx, month) => {
      fs.writeFileSync(month, tickLine.repeat(Math.ceil((8 * 1024 * 1024) / tickLine.length)), { mode: 0o600 });
      let t = 0;
      const now = (): number => (t += 1000);
      const budget = SWA.newBudget(now, { maxMs: 5000 });
      expect(SWA.journalAudit(db, ctx(budget), Date.now())).toBe(false);
      expect(getMeta(db, 'journal_audit_ms'), 'an unfinished audit leaves its clock where it was').toBeNull();
      expect(t / 1000, 'the budget was asked between reads, not once per file').toBeGreaterThan(2);
    });
  });

  it('RF5a F17: a month is read in pieces of at most AUDIT_READ_BYTES, never whole, and an over-long line is skipped once', async () => {
    await auditFixture('ccrc-hist-rf5a-17b-', async (SWA, db, ctx, month, dir) => {
      fs.writeFileSync(month, 'x'.repeat(3 * SWA.AUDIT_READ_BYTES + 17) + '\n' + '{"v":1,"k":\n' + tickLine, { mode: 0o600 });
      const under = (p: unknown): boolean => typeof p === 'string' && (p === dir || p.startsWith(dir + path.sep));
      const realRead = fs.readSync;
      const realReadFile = fs.readFileSync;
      let maxRead = 0;
      let wholeReads = 0;
      (fs as { readSync: unknown }).readSync = function readSync(fd: number, ...rest: unknown[]): number {
        let target = '';
        try { target = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { /* not a file descriptor of ours */ }
        if (under(target)) maxRead = Math.max(maxRead, Number(rest[2]));
        return (realRead as (...a: unknown[]) => number)(fd, ...rest);
      };
      (fs as { readFileSync: unknown }).readFileSync = function readFileSync(p: unknown, ...rest: unknown[]): unknown {
        if (under(p)) wholeReads += 1;
        return (realReadFile as (...a: unknown[]) => unknown)(p, ...rest);
      };
      syncBuiltinESMExports();
      let done: boolean;
      try {
        done = SWA.journalAudit(db, ctx(SWA.newBudget(Date.now)), Date.now());
      } finally {
        (fs as { readSync: unknown }).readSync = realRead;
        (fs as { readFileSync: unknown }).readFileSync = realReadFile;
        syncBuiltinESMExports();
      }
      expect(done).toBe(true);
      expect(getMeta(db, 'journal_skipped'), 'the over-long line once, the torn line once: reading went on past the over-long line').toBe('2');
      expect(wholeReads, 'no whole-file read of a journal month').toBe(0);
      expect(maxRead, 'CONTROL: the month file was read through readSync').toBeGreaterThan(0);
      expect(maxRead, 'no read asks for more than AUDIT_READ_BYTES').toBeLessThanOrEqual(SWA.AUDIT_READ_BYTES);
    });
  });
});

describe('W1-j / §9.2 step 2: an unreadable roster skips the census', () => {
  it('a pass with --roster-unreadable and no homes records no retention, no census and no export count; a readable pass then does', () => {
    const box = makeHistoryBox('ccrc-hist-o38-roster-', { role: 'fleet', shim: true });
    const r = runSweep(box, ['--roster-unreadable'], { homes: [] });
    expect(r.code, r.stderr).toBe(0);
    expect(fs.existsSync(paths(box).db), 'the store is still created under an unreadable roster').toBe(true);
    expect(metaOf(box, 'census_ms')).toBeNull();
    expect(metaOf(box, 'retention_min')).toBeNull();
    expect(metaOf(box, 'export_census_ms')).toBeNull();
    expect(q<{ n: number }>(box, 'SELECT count(*) AS n FROM derivation_state WHERE step = ?', 'export-census')[0]!.n).toBe(0);
    const ok = runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] });
    expect(ok.code, ok.stderr).toBe(0);
    expect(metaOf(box, 'census_ms'), 'CONTROL: a readable roster runs it').toMatch(/^[0-9]+$/);
    expect(metaOf(box, 'retention_min')).toBe('30');
  });
});

describe('the statfs preload hides the host\'s managed settings from the census (Task 26 seam; review 316 F30)', () => {
  /** The 31-minute offset makes the census due again; the spy is loaded before the statfs preload, so the seam wraps it. */
  const census = (prefix: string, real: boolean): string[] => {
    const box = boundBox(prefix);
    const rec = path.join(box.home, 'reads.txt');
    const r = runDriver(box, { offsetMs: 31 * MIN }, [], { preloads: [PRELOADS.readspy, PRELOADS.statfs], env: { HISTORY_TEST_READSPY: rec, ...(real ? { HISTORY_TEST_MANAGED_REAL: '1' } : {}) } });
    expect(r.code, r.stderr).toBe(0);
    const lines = fs.readFileSync(rec, 'utf8').split('\n');
    expect(lines, 'CONTROL: the census ran through the spied API').toContain(`openSync ${path.join(box.homes[0]!, 'settings.json')}`);
    return lines.filter((l) => l.includes('/etc/claude-code'));
  };

  it('CONTROL: with the seam lifted, the spy sees both managed reads', () => {
    expect(census('ccrc-hist-f30a-', true)).toEqual(expect.arrayContaining(['openSync /etc/claude-code/managed-settings.json', 'readdirSync /etc/claude-code/managed-settings.d']));
  });

  it('the census never reaches /etc/claude-code', () => {
    expect(census('ccrc-hist-f30b-', false)).toEqual([]);
  });
});

// ── Task 26F: the controller's rulings on Task 25 and 26's review findings ─────────────────────────────
describe('Task 26F item 1: --op import maps through registryBackfill\'s core (D-4297, IV5)', () => {
  const confirmedOf = (box: HistoryBox, uuid: string): (number | null)[] =>
    q<{ confirmed_ms: number | null }>(box, 'SELECT confirmed_ms FROM epochs WHERE cc_session_uuid = ?', uuid).map((r) => r.confirmed_ms);

  it('a registry-evidence import never confirms a clear epoch this id holds unconfirmed past its 7 days, and journals no mapping for it', () => {
    const box = boundBox('ccrc-hist-26f1a-');
    plantSession(box, ID, { uuid: U2, generation: G1, project: 'demo' });
    spoolLine(box, ID, clearLine(U1));
    expect(runDriver(box, { offsetMs: MIN, managedSettings: [] }).code).toBe(0);       // renamed
    expect(runDriver(box, { offsetMs: 2 * MIN, managedSettings: [] }).code).toBe(0);   // drained: U1 chained, unconfirmed
    expect(confirmedOf(box, U1), 'CONTROL: the clear epoch is chained and awaiting confirmation').toEqual([null]);
    plantSession(box, ID, { uuid: U1 });                       // .uuid names it only after the window: too late
    expect(runDriver(box, { offsetMs: 8 * DAY, managedSettings: [] }).code).toBe(0);   // the window drops the candidate
    expect(counter(box, 'epoch_unconfirmed')).toBe(1);
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f1', 'past the window', iso(0))]);
    const r = runSweep(box, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(confirmedOf(box, U1), 'the import must not graft what the window dropped').toEqual([null]);
    expect(verdicts(box, 'mapping').filter((v) => v['cc_session_uuid'] === U1)).toEqual([]);
  }, 60_000);

  it('an unreadable .generation counts family_gen_unreadable and an absent one family_gen_absent, each once, never folded into the other', () => {
    const box = boundBox('ccrc-hist-26f1b-');
    plantSession(box, ID, { uuid: U1, generation: 'unreadable', project: 'demo' });
    plantSession(box, 'claude-b-demo', { uuid: U2, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f2', 'unreadable gen', iso(0))]);
    plantTranscript(box, 'claude-b', SLUG, U2, [userRow('a0000000-0000-4000-8000-0000000000f3', 'absent gen', iso(0), U2)]);
    const before = { unreadable: counter(box, 'family_gen_unreadable'), absent: counter(box, 'family_gen_absent') };
    const r = runSweep(box, ['--op', 'import', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(counter(box, 'family_gen_unreadable') - before.unreadable).toBe(1);
    expect(counter(box, 'family_gen_absent') - before.absent).toBe(1);
    expect(q(box, 'SELECT ccrc_id, generation FROM sessions ORDER BY ccrc_id')).toEqual([
      { ccrc_id: ID, generation: '' }, { ccrc_id: 'claude-b-demo', generation: '' },
    ]);
  }, 60_000);

  it('the operator form reads the family through the same core: an unreadable .generation is counted, and the mapping is still the operator\'s own', async () => {
    const box = boundBox('ccrc-hist-26f1c-');
    plantSession(box, ID, { generation: 'unreadable', project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f4', 'operator unreadable', iso(0))]);
    const before = counter(box, 'family_gen_unreadable');
    const r = await shimPty(box, ['--op', 'import', '--session', ID, '--file', file, '--apply']);
    expect(lastResult(r.out), r.out).toEqual({ rc: 0 });
    expect(counter(box, 'family_gen_unreadable') - before).toBe(1);
    expect(epochsOf(box)).toEqual([{ cc_session_uuid: U1, cause: 'import', declared_by: 'operator', seq: 1 }]);
  }, 45_000);

  it('the operator\'s own mapping IS the confirmation: it confirms a clear epoch the evidence path leaves alone (Q19)', async () => {
    const box = boundBox('ccrc-hist-26f1d-');
    plantSession(box, ID, { uuid: U2, generation: G1, project: 'demo' });
    spoolLine(box, ID, clearLine(U1));
    expect(runDriver(box, { offsetMs: MIN, managedSettings: [] }).code).toBe(0);
    expect(runDriver(box, { offsetMs: 2 * MIN, managedSettings: [] }).code).toBe(0);
    expect(confirmedOf(box, U1), 'CONTROL: unconfirmed').toEqual([null]);
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f5', 'operator confirms', iso(0))]);
    const r = await shimPty(box, ['--op', 'import', '--session', ID, '--file', file, '--apply']);
    expect(lastResult(r.out), r.out).toEqual({ rc: 0 });
    expect(confirmedOf(box, U1)[0]).not.toBeNull();
    expect(verdicts(box, 'mapping').filter((v) => v['cc_session_uuid'] === U1).map((v) => v['declared_by'])).toEqual(['operator']);
  }, 60_000);
});

describe('Task 26F item 2: a relative --file is resolved once, before admission, binding and journaling', () => {
  it('stores and journals the absolute path, and a later scheduled tick adds no second path row', async () => {
    const box = boundBox('ccrc-hist-26f2-');
    plantSession(box, ID, { generation: G1, project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f6', 'relative path', iso(0))]);
    const r = await shimPty(box, ['--op', 'import', '--session', ID, '--file', `${U1}.jsonl`, '--apply'], {}, path.dirname(file));
    expect(lastResult(r.out), r.out).toEqual({ rc: 0 });
    expect(q<{ path: string }>(box, 'SELECT path FROM file_paths ORDER BY path'), 'one path row, the absolute one').toEqual([{ path: file }]);
    const mapping = verdicts(box, 'mapping').filter((v) => v['cc_session_uuid'] === U1);
    expect(mapping.map((v) => v['path'])).toEqual([file]);
    expect(runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] }).code).toBe(0);
    expect(q<{ path: string }>(box, 'SELECT path FROM file_paths ORDER BY path'), 'the scheduled tick adds no alias').toEqual([{ path: file }]);
  }, 60_000);
});

describe('Task 26F items 3 and 4: the two refusals an --op import used to answer rc 0 (D-4313)', () => {
  it('--roster-unreadable: every import form answers roster-unreadable before any listing or admission; the dry run writes nothing, --apply counts it once; --op migrate is unaffected', async () => {
    const box = boundBox('ccrc-hist-26f3-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f7', 'no roster', iso(0))]);
    const before = snapshot(box);
    const dry = runSweep(box, ['--op', 'import', '--roster-unreadable'], { homes: [] });
    expect(lastResult(dry.stdout)).toEqual({ rc: 2, reason: 'roster-unreadable' });
    expect(dry.code).toBe(2);
    expect(dry.stdout, 'nothing is listed').not.toMatch(/\b(un)?mapped\b/);
    expect(snapshot(box), 'the dry run writes nothing at all').toEqual(before);
    const recsBefore = recs(box).length;
    const nr = counter(box, 'non_regular');
    const apply = runSweep(box, ['--op', 'import', '--apply', '--roster-unreadable'], { homes: [] });
    expect(lastResult(apply.stdout)).toEqual({ rc: 2, reason: 'roster-unreadable' });
    expect(apply.code).toBe(2);
    expect(counter(box, 'roster_unreadable')).toBe(1);
    expect([countOf(box, 'epochs'), countOf(box, 'entries'), recs(box).length]).toEqual([0, 0, recsBefore]);
    expect(fs.existsSync(path.join(paths(box).root, 'op')), 'no op marker is left').toBe(false);
    // the operator form: through the real shim with an unreadable accounts.sh, so the shim itself passes the flag and no home
    fs.rmSync(path.join(box.home, '.ccrc', 'accounts.sh'));
    const op = await shimPty(box, ['--op', 'import', '--session', ID, '--file', file, '--apply']);
    expect(lastResult(op.out), op.out).toEqual({ rc: 2, reason: 'roster-unreadable' });
    expect(counter(box, 'roster_unreadable'), 'counted once per pass').toBe(2);
    expect(counter(box, 'non_regular'), 'never read as an inadmissible file').toBe(nr);
    expect(countOf(box, 'epochs')).toBe(0);
    // CONTROL: --op migrate needs no roster
    const mig = runSweep(box, ['--op', 'migrate', '--roster-unreadable'], { homes: [] });
    expect(lastResult(mig.stdout)).toEqual({ rc: 0 });
  }, 60_000);

  it('the operator\'s --session --file mapping of a uuid another family holds confirmed answers uuid-claimed, ingests nothing and journals no mapping; a re-run of an own mapping stays rc 0', async () => {
    const box = boundBox('ccrc-hist-26f4-');
    const OTHER = 'claude-b-demo';
    plantSession(box, OTHER, { uuid: U1, generation: G1, project: 'demo' });
    expect(runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] }).code).toBe(0);   // the registry scan maps U1 to OTHER
    expect(epochsOf(box, OTHER).map((e) => e.cc_session_uuid)).toEqual([U1]);
    plantSession(box, ID, { generation: G1, project: 'demo' });
    const file = plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f8', 'claimed elsewhere', iso(0))]);
    const twoBefore = counter(box, 'uuid_two_sessions');
    const r = await shimPty(box, ['--op', 'import', '--session', ID, '--file', file, '--apply']);
    expect(lastResult(r.out), r.out).toEqual({ rc: 2, reason: 'uuid-claimed' });
    expect(r.out, 'the operator is told which family holds it').toContain(OTHER);
    expect(counter(box, 'uuid_two_sessions') - twoBefore).toBe(1);
    expect(epochsOf(box, ID)).toEqual([]);
    expect([countOf(box, 'entries'), countOf(box, 'ingest_files'), countOf(box, 'file_paths')]).toEqual([0, 0, 0]);
    expect(verdicts(box, 'mapping').filter((v) => v['declared_by'] === 'operator')).toEqual([]);
    expect(fs.existsSync(path.join(paths(box).root, 'op')), 'no op marker is left').toBe(false);
    // CONTROL: the family that holds it re-maps it: already mapped is idempotent success
    const own = await shimPty(box, ['--op', 'import', '--session', OTHER, '--file', file, '--apply']);
    expect(lastResult(own.out), own.out).toEqual({ rc: 0 });
    expect(verdicts(box, 'mapping').filter((v) => v['cc_session_uuid'] === U1)).toHaveLength(1);
    expect(countOf(box, 'entries')).toBe(1);
  }, 90_000);
});

describe('Task 26F item 5: a throw inside runOpPass still ends stdout with one {"rc":…} line', () => {
  const rcLines = (stdout: string): string[] => stdout.split('\n').filter((l) => l.startsWith('{"rc"'));

  it('a StoreError out of the verb (a migration that drops a table) answers exit 1 with its result line, and leaves the store as it was', () => {
    const box = boundBox('ccrc-hist-26f5a-');
    const r = runDriver(box, { extraMigrations: ['DROP TABLE counters'] }, ['--op', 'migrate']);
    expect(r.code, r.stderr).toBe(1);
    expect(rcLines(r.stdout), r.stdout).toEqual(['{"rc":1}']);
    expect(r.stdout.trimEnd().split('\n').pop()).toBe('{"rc":1}');
    expect(versionOf(paths(box).db), 'the failed migration rolled back').toBe(1);
    expect(fs.existsSync(path.join(paths(box).root, 'op')), 'no op marker is left').toBe(false);
  });

  it('a SQLite error out of the verb (an injected commit failure) is logged to stderr and answers exit 1 with its result line', () => {
    const box = boundBox('ccrc-hist-26f5b-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'demo' });
    plantTranscript(box, 'claude-a', SLUG, U1, [userRow('a0000000-0000-4000-8000-0000000000f9', 'commit fails', iso(0))]);
    const r = runSweep(box, ['--op', 'import', '--apply'], { preloads: [PRELOADS.faults], env: { HISTORY_TEST_FAIL_COMMIT: '1' } });
    expect(r.code, r.stderr).toBe(1);
    expect(rcLines(r.stdout), r.stdout).toEqual(['{"rc":1}']);
    expect(r.stdout.trimEnd().split('\n').pop()).toBe('{"rc":1}');
    expect(r.stderr).toContain('injected commit failure');
    expect(fs.existsSync(path.join(paths(box).root, 'op')), 'no op marker is left').toBe(false);
  });
});

describe('FR2-c: the {"rc":…} line is printed last on EVERY path, including a throw before the pass\'s try', () => {
  const rcLines = (stdout: string): string[] => stdout.split('\n').filter((l) => l.startsWith('{"rc"'));
  const lastLine = (stdout: string): string => stdout.trimEnd().split('\n').pop()!;

  // Root bypasses a directory's mode, so these cannot make a directory unlistable as uid 0.
  it.skipIf(process.getuid?.() === 0)('a throw from the journal half at lock take (.draining/ unlistable) ends stdout with one {"rc":1}', () => {
    const box = boundBox('ccrc-hist-fr2c1-');
    const dir = paths(box).draining;
    fs.chmodSync(dir, 0o000);
    try {
      const r = runSweep(box, ['--op', 'import', '--apply']);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/internal error/);
      expect(rcLines(r.stdout), r.stdout).toEqual(['{"rc":1}']);
      expect(lastLine(r.stdout)).toBe('{"rc":1}');
    } finally { fs.chmodSync(dir, 0o700); }
    expect(fs.existsSync(path.join(paths(box).root, 'op')), 'no op marker is left').toBe(false);
  });

  // FU3 (M24), D-4347 (history-planted-entries-never-wedge)'s named residual: a non-empty directory at `op` is kept (removeEntry never recurses), so every
  // applying --op pass fails loudly at its marker write until the operator removes it; a dry --op import writes no
  // marker, and scheduled passes are unaffected.
  it('a non-empty directory at op: every applying --op pass (migrate, import --apply) fails loudly at the marker write (rc 1, EISDIR naming op); a dry --op import and a scheduled pass still exit 0', () => {
    const box = boundBox('ccrc-hist-fu3op-');
    const op = path.join(paths(box).root, 'op');
    fs.mkdirSync(op);
    fs.writeFileSync(path.join(op, 'keep'), '');
    const s = runSweep(box);
    expect(s.code, s.stderr).toBe(0);
    const dry = runSweep(box, ['--op', 'import']);
    expect(dry.code, dry.stderr).toBe(0);
    for (const args of [['--op', 'migrate'], ['--op', 'import', '--apply']]) {
      const r = runSweep(box, args);
      expect(r.code, `${args.join(' ')}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(/internal error: EISDIR: .*rename '.*\/history\/op\.tmp\.[0-9]+' -> '.*\/history\/op'/);
      expect(rcLines(r.stdout), r.stdout).toEqual(['{"rc":1}']);
      expect(lastLine(r.stdout)).toBe('{"rc":1}');
    }
    expect(fs.readdirSync(paths(box).root).filter((n) => n.startsWith('op.tmp.')), 'no marker temp is left').toEqual([]);
    expect(fs.existsSync(path.join(op, 'keep'))).toBe(true);
    fs.rmSync(op, { recursive: true });
    const ok = runSweep(box, ['--op', 'migrate']);
    expect(ok.code, ok.stderr).toBe(0);
  });

  it('a throw from the dry run (an evidence query failing on a malformed store) ends stdout with one {"rc":1}', () => {
    const box = boundBox('ccrc-hist-fr2c2-');
    const db = new DatabaseSync(paths(box).db);
    try { db.exec('DROP TABLE sessions'); } finally { db.close(); }   // the evidence query names a table this store lacks
    const r = runShim(box, ['--op', 'import']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/internal error/);
    expect(rcLines(r.stdout), r.stdout).toEqual(['{"rc":1}']);
    expect(lastLine(r.stdout)).toBe('{"rc":1}');
  });

  it('a journal failure at lock take keeps its word and its rc line (control: the existing path)', () => {
    const box = boundBox('ccrc-hist-fr2c3-');
    spoolLine(box, ID, { v: 1, ev: 'SessionStart', id: ID, sid: U1, src: 'startup', gen: G1, reg: U1 });
    expect(runSweep(box).code).toBe(0);                              // renamed and observed
    const r = runSweep(box, ['--op', 'import', '--apply'], { preloads: [PRELOADS.faults], env: { HISTORY_TEST_ENOSPC: '/.draining/' } });
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^history-sweep: journal-unwritable$/m);
    expect(lastLine(r.stdout)).toBe('{"rc":1}');
  });
});

describe('Task 26F item 6: the journal audit says when it cannot read a month file', () => {
  it('an unreadable month file counts journal_audit_unreadable, the pass still exits 0, and journal_audit_ms stays at its last good value', () => {
    const box = boundBox('ccrc-hist-26f6-');
    const dir = path.join(paths(box).journal, fs.readFileSync(paths(box).storeId, 'utf8').trim());
    // A DIRECTORY with a month file's name: unreadable as root or not, and (unlike a chmod of the file, which every pass's
    // fixModes undoes) nothing a pass repairs.
    fs.mkdirSync(path.join(dir, '2020-01.00000000.jsonl'), { recursive: true });
    const before = metaOf(box, 'journal_audit_ms');
    expect(before, 'CONTROL: the creating pass audited an empty store').toMatch(/^[0-9]+$/);
    expect(counter(box, 'journal_audit_unreadable')).toBe(0);
    const r = runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] });
    expect(r.code, r.stderr).toBe(0);
    expect(counter(box, 'journal_audit_unreadable')).toBe(1);
    expect(metaOf(box, 'journal_audit_ms'), 'the audit did not complete, so its clock is not advanced').toBe(before);
  });

  it('a FIFO with a month file\'s name never blocks the audit: journal_audit_unreadable counts, exit 0 (review 316 F10, F17)', () => {
    const box = boundBox('ccrc-hist-26f6b-');
    const dir = path.join(paths(box).journal, fs.readFileSync(paths(box).storeId, 'utf8').trim());
    fs.mkdirSync(dir, { recursive: true });
    const mk = spawnSync('mkfifo', [path.join(dir, '2020-01.00000000.jsonl')]);
    expect(mk.status, 'CONTROL: the FIFO was made').toBe(0);
    const r = runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] }, [], { timeoutMs: 30_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(counter(box, 'journal_audit_unreadable')).toBe(1);
  });

  // FU4 M25 (D-4347 (history-planted-entries-never-wedge)'s third clause): a symlink with a month file's name is never followed, even to a regular file holding valid
  // journal records (another store's month, here a copy of this store's own placed outside the journal).
  it('a symlink with a month file\'s name, pointing at a regular file of valid records, is never followed: journal_audit_unreadable counts (M25)', () => {
    const box = boundBox('ccrc-hist-26f6c-');
    const dir = path.join(paths(box).journal, fs.readFileSync(paths(box).storeId, 'utf8').trim());
    const own = fs.readdirSync(dir).filter((n) => /^[0-9]{4}-[0-9]{2}\.[0-9a-f]{8}\.jsonl$/.test(n));
    expect(own.length, 'CONTROL: the store has a month file of its own to copy').toBeGreaterThan(0);
    const target = path.join(box.home, 'elsewhere', 'month-copy.jsonl');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(dir, own[0]!), target);
    expect(fs.readFileSync(target, 'utf8'), 'CONTROL: the target holds valid records').toMatch(/^\{"v":1,"k":"head"/m);
    fs.symlinkSync(target, path.join(dir, '2020-01.00000000.jsonl'));   // sorts before the store's own month file
    const before = metaOf(box, 'journal_audit_ms');
    expect(before, 'CONTROL: the creating pass audited').toMatch(/^[0-9]+$/);
    const r = runDriver(box, { offsetMs: 31 * MIN, managedSettings: [] });
    expect(r.code, r.stderr).toBe(0);
    expect(counter(box, 'journal_audit_unreadable'), 'the link was refused, not read').toBe(1);
    expect(metaOf(box, 'journal_audit_ms'), 'a followed link would have let the audit finish and advance its clock').toBe(before);
  });
});
