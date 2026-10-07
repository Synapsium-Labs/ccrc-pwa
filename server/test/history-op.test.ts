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
import * as pty from 'node-pty';
import { WRITING_FORMS, CARRIER_KILL_S } from '../../ccd/history/lib.mjs';
import {
  makeHistoryBox, runSweep, runShim, runDriver, preloadOptions, plantSession, plantTranscript, spoolLine, openStoreRO,
  counters, journalRecords, PRELOADS, type HistoryBox,
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
function shimPty(box: HistoryBox, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const full: Record<string, string> = {};
  const merged: NodeJS.ProcessEnv = { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions([PRELOADS.statfs]), ...env };
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) full[k] = v;
  return new Promise((resolve) => {
    const p = pty.spawn('bash', [path.join(box.home, '.local', 'bin', 'ccd-history-sweep'), ...args], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: box.home, env: full,
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

/** The transaction log the faults preload writes (HISTORY_TEST_TXLOG), read as events in order. */
type TxEv = { kind: 'tx'; sync: number; writes: string[] } | { kind: 'journal'; bytes: number };
function readTxlog(file: string): TxEv[] {
  const evs: TxEv[] = [];
  let cur: string[] | null = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === 'BEGIN') cur = [];
    else if (line.startsWith('COMMIT ')) { evs.push({ kind: 'tx', sync: Number(line.slice(7)), writes: cur ?? [] }); cur = null; } else if (line.startsWith('W ')) { if (cur !== null) cur.push(line.slice(2)); } else if (line.startsWith('J ')) evs.push({ kind: 'journal', bytes: Number(line.slice(2)) });
  }
  return evs;
}
const writes = (e: TxEv, re: RegExp): boolean => e.kind === 'tx' && e.writes.some((w) => re.test(w));
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
    // An --op pass that ends BEFORE its release half: the driver's v2 makes `import --apply` answer
    // migration-pending right after the store opens, so only the lock-take journal half can have renamed and
    // observed the file (U1). The store stays at v1, so the scheduled passes below run as before.
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
