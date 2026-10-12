// history-maint.test.ts — W1-B2: the operator door and the --op pass's dispatch tables (Task 19). prune (Task 20),
// reparse (21), doctor --backup (22), doctor --repair (23) and every writing form's two doors (30) append here.
// Spec docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md §8.4 "Operator verbs" and "Speed
// bumps", §8.3's no-store table, §5.1. Pins O54 (relay half), C42 (CLI half), C63, and RB6's measurement in both
// halves for the forms this task runs (Task 25 pins every form).
//
// Operator verbs are BOX verbs: no pane, no identity. The CLI runs as an operator runs it, a child on
// process.execPath with the statfs preload. The shim it spawns is the fixture HOME's own copy, which execs the REAL
// sweep.mjs through the ~/ccrc link, or a stand-in (stubShim) that records its argv: a case that must spawn nothing
// reads that record as absent. No case here has a TTY; the TTY rows are Task 30's.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as pty from 'node-pty';
import { beltWidth, historyPaths, floorThreshold, REPARSE_MAX_TARGETS, BELT_VERSION } from '../../ccd/history/lib.mjs';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { userRow, compactionSequence, toolResultRow } from './historyFixtures.js';
import {
  makeHistoryBox, runSweep, runShim, runCli, runDriver, plantSession, plantTranscript, openStoreRO, stubShim, holdLock,
  PASS_DRIVER, SHIM, withPane, seedFamily, preloadOptions, PRELOADS, CLI, skipOnDarwin, type HistoryBox,
} from './historyHelpers.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();   // each case's boxes (stores, transcripts, backup copies) go when the case ends

// Each spawning case gets this budget (the sweep and the CLI spawn on a heavily loaded box); longer is 1.5 * HEAVY or 2.5 * HEAVY, never a new literal.
const HEAVY = 120_000;

const ID = 'claude-a-maint';
const G1 = '0189abcd-1234-4678-9abc-00000000a019';
const U1 = '19000001-0000-4000-8000-000000000001';
const SLUG = '-home-u-tree-maint';
const V2 = 'CREATE TABLE seam_v2 (x INTEGER)';
const TS = new Date(Date.UTC(2026, 9, 4, 10, 0, 0)).toISOString();

interface Run { code: number | null; stdout: string; stderr: string; json: Record<string, unknown> | null }
const op = (box: HistoryBox, args: string[], env: Record<string, string> = {}): Run => runCli(box, args, { env });
function boundBox(prefix: string): HistoryBox {
  const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
  const r = runSweep(box);
  expect(r.code, r.stderr).toBe(0);
  return box;
}
/** What the stand-in shim was asked, one argv per run; null when it never ran. */
const stubArgv = (box: HistoryBox): string[] | null => {
  const p = path.join(box.home, 'stub-shim-argv');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n') : null;
};
const dbFile = (box: HistoryBox): string => path.join(box.root, 'db', 'history.db');
const storeIdOf = (box: HistoryBox): string => fs.readFileSync(path.join(box.root, 'store.id'), 'utf8').trim();
const sha = (p: string): string => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const versionOf = (p: string): number => {
  const db = new DatabaseSync(p, { readOnly: true });
  try { return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } finally { db.close(); }
};
const snapshotsIn = (box: HistoryBox): string[] => {
  try { return fs.readdirSync(path.join(box.root, 'db', 'backups')).filter((n) => n.startsWith('pre-v')); } catch { return []; }
};
/** The --op pass's one JSON result, its LAST stdout line. */
const lastResult = (stdout: string): Record<string, unknown> => {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{"rc"'));
  expect(lines.length, `no {"rc":…} line in:\n${stdout}`).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
};
/** Every entry under ~/.ccrc with each file's size and mtime: "writes nothing", measured. The lock and SQLite's
 *  WAL sidecars are excluded (a read-only open may create the sidecars, §8.1). */
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
/** The real shim, exec'ing B1's run-pass driver in place of sweep.mjs: the driver's HISTORY_TEST_DEPS (its only
 *  seam) can then stage a v2 migration behind the CLI's own door, lock and roster included. */
function driverShim(box: HistoryBox): void {
  const text = fs.readFileSync(SHIM, 'utf8');
  const from = '"$HOME/ccrc/ccd/history/sweep.mjs"';
  expect(text, 'CONTROL: the shim execs sweep.mjs through the ~/ccrc link').toContain(from);
  const p = path.join(box.home, '.local', 'bin', 'ccd-history-sweep');
  fs.writeFileSync(p, text.replace(from, JSON.stringify(PASS_DRIVER)));
  fs.chmodSync(p, 0o755);
}
const PENDING = { HISTORY_TEST_DEPS: JSON.stringify({ extraMigrations: [V2] }) };

describe.skipIf(process.platform === 'darwin')('O54 (relay half): the CLI and the shim agree (Task 19)', () => {
  it('a refusal decided under the lock reaches the operator: {"rc":2,"reason":"adopt-refused"} is exit 2 with that reason', () => {
    const box = boundBox('ccrc-hist-o54a-');
    stubShim(box, { stdout: '{"rc":2,"reason":"adopt-refused"}\n', exit: 2 });
    const r = op(box, ['doctor', '--backup', '--json']);
    expect(r.code).toBe(2);
    expect(r.json).toMatchObject({ exit: 2, reason: 'adopt-refused', coverage: 'this-box' });
    expect(r.json?.['store_id']).toBe(storeIdOf(box));
    expect(stubArgv(box), 'the CLI ran the shim with the --op form, and nothing else').toEqual(['--op backup']);
  }, HEAVY);

  it('75 from the shim (its lock held) is exit 4 writer-busy, in both forms', () => {
    const box = boundBox('ccrc-hist-o54b-');
    stubShim(box, { stdout: '', exit: 75 });
    const j = op(box, ['doctor', '--backup', '--json']);
    expect([j.code, j.json?.['reason']]).toEqual([4, 'writer-busy']);
    const h = op(box, ['doctor', '--backup']);
    expect(h.code).toBe(4);
    expect(h.stderr).toMatch(/^ccrc history doctor: writer-busy: /m);
  }, HEAVY);

  it('the real shim with its lock held: exit 4, and nothing written', () => {
    const box = boundBox('ccrc-hist-o54c-');
    const before = snapshot(box);
    const release = holdLock(box);
    try {
      const r = op(box, ['import', '--apply', '--json']);
      expect([r.code, r.json?.['reason']]).toEqual([4, 'writer-busy']);
    } finally { release(); }
    expect(snapshot(box)).toEqual(before);
  }, HEAVY);

  it('a result the relay cannot trust is exit 1: a reason off its exit, no result, a result the exit contradicts, no JSON', () => {
    const box = boundBox('ccrc-hist-o54d-');
    for (const [stdout, exit] of [['{"rc":2,"reason":"store-missing"}\n', 2], ['', 0], ['{"rc":5,"reason":"store-missing"}\n', 0], ['not json\n', 0]] as const) {
      stubShim(box, { stdout, exit });
      const r = op(box, ['doctor', '--backup', '--json']);
      expect([r.code, r.json?.['exit']], JSON.stringify(stdout)).toEqual([1, 1]);
    }
  }, HEAVY);

  it('the sweep\'s lines before its result are relayed in order and the result line is not; under --json they go to stderr', () => {
    const box = boundBox('ccrc-hist-o54e-');
    stubShim(box, { stdout: 'line one\nline two\n{"rc":0}\n', exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout).toBe('line one\nline two\n');
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(j.code).toBe(0);
    expect(j.stdout.trim().split('\n'), 'stdout is the envelope alone').toHaveLength(1);
    expect(j.json).toMatchObject({ exit: 0, coverage: 'this-box' });
    expect(j.stderr).toContain('line one\nline two\n');
  }, HEAVY);

  it('every non-zero line an operator verb prints names the operator, whatever stopped it (R-X-OPERATOR)', () => {
    const box = boundBox('ccrc-hist-o54op-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const runs: Array<[string, Run]> = [
      ['apply-in-session', op(box, ['import', '--apply'], { CLAUDECODE: '1' })],
      ['needs-tty', op(box, ['doctor', '--adopt'])],
      ['bad-args', op(box, ['import', '--bogus'])],
    ];
    const box2 = boundBox('ccrc-hist-o54op2-');
    stubShim(box2, { stdout: '', exit: 75 });
    runs.push(['writer-busy', op(box2, ['doctor', '--backup'])]);
    stubShim(box2, { stdout: 'not json\n', exit: 0 });
    runs.push(['internal', op(box2, ['doctor', '--backup'])]);
    stubShim(box2, { stdout: '{"rc":5,"reason":"store-unreachable"}\n', exit: 5 });
    runs.push(['store error', op(box2, ['doctor', '--backup'])]);
    const srv = makeHistoryBox('ccrc-hist-o54op-srv-', { role: 'server', shim: true });
    runs.push(['no-store', op(srv, ['doctor', '--backup'])]);
    const lineOf = (r: Run): string[] => r.stderr.split('\n').filter((l) => /^ccrc history \S+: /.test(l));
    expect(lineOf(runs[0]![1])[0], 'CONTROL: the case reads the refusal line itself').toContain('refused: apply-in-session');
    for (const [name, run] of runs) {
      expect(run.code, name).not.toBe(0);
      const lines = lineOf(run);
      expect(lines, `${name}: one line`).toHaveLength(1);
      expect(lines[0], `${name} names the operator`).toMatch(/; .*\bthe operator\b/);
    }
  }, HEAVY);

  it('a result line with no trailing newline is still the result: exit 0, and the line before it is relayed', () => {
    const box = boundBox('ccrc-hist-o54nn-');
    stubShim(box, { stdout: 'progress\n{"rc":0}', exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout).toBe('progress\n');
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(j.json?.['exit']).toBe(0);
  }, HEAVY);

  it('--json before the doctor flag is the same form: the shim is asked --op migrate', () => {
    const box = boundBox('ccrc-hist-o54jf-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const r = op(box, ['doctor', '--json', '--migrate']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json?.['exit']).toBe(0);
    expect(stubArgv(box)).toEqual(['--op migrate']);
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('the relay redaction: every line the relay passes on goes through redactFinal with the read verbs\' index, belt included (Task 19; spec §8.3 layers 1 and 4)', () => {
  it('a declared secretsFile value and a stray-CSI split of a frozen value come out redacted, human and --json', () => {
    const AL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const alnum = (n: number): string => Array.from(randomBytes(n), (b) => AL[b % AL.length]!).join('');
    const ESC = String.fromCharCode(27);
    /** A frozen-list value of review 351's shape (C69's V): `Q`, a CSI final byte (`P`), 29 letters and digits, a digit. */
    const V = `QP${alnum(29)}7`;
    /** A declared secretsFile's key (C69's G): only the shim names its file, so the CLI reads it through meta redact_sources
     *  and finds its pair in redact_hashes. No shape matches it (C49's shape), so only those layers mask it. */
    const G = `${alnum(39)}7`;
    /** Each beltWidth(s) stretch of the value `s` found in `text`, case folded (C69's measure: §8.3 layer 4's promise). */
    const leaks = (text: string, s: string): string[] => {
      const w = beltWidth(s);
      const low = text.toLowerCase();
      const out: string[] = [];
      for (let k = 0; k + w <= s.length; k += 1) if (low.includes(s.slice(k, k + w).toLowerCase())) out.push(s.slice(k, k + w));
      return out;
    };
    const roster = structuredClone(DEFAULT_TEST_ROSTER) as { version: number; accounts: Record<string, unknown>[] };
    roster.accounts.find((a) => a['id'] === 'gpt')!['exec'] = { kind: 'external', secretsFile: '.config/x19-gw/gw.env' };
    const box = makeHistoryBox('ccrc-hist-relay-red-', { role: 'fleet', shim: true, roster });
    const secret = (rel: string, body: string): void => {
      const p = path.join(box.home, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
      fs.writeFileSync(p, body, { mode: 0o600 });
    };
    secret('.cc-secrets/x19relay.env', `ZQ_X19_V=${V}\n`);
    secret('.config/x19-gw/gw.env', `GW_X19_KEY=${G}\n`);
    // The real shim's pass creates the store, records both values' pairs and the declared file's path (meta
    // redact_sources, Task 7B): the shim reads the roster's secretsFile from accounts.sh and passes it to the sweep.
    const bound = runShim(box);
    expect(bound.code, bound.stderr).toBe(0);
    // The stand-in then prints both shapes on lines the relay passes on: G whole, and V behind a stray CSI that took its
    // second character, so the 31 characters after it are one run that no pair matches and only the belt masks.
    stubShim(box, { stdout: `zqx19 gateway ${G} end\nzqx19 csi w ${V[0]}${ESC}[0m${ESC}[${V.slice(1)} y\n{"rc":0}\n`, exit: 0 });
    const h = op(box, ['doctor', '--backup']);
    expect(h.code, h.stderr).toBe(0);
    const j = op(box, ['doctor', '--backup', '--json']);
    expect(j.code, j.stderr).toBe(0);
    expect(stubArgv(box), 'CONTROL: both runs reached the stand-in').toEqual(['--op backup', '--op backup']);
    expect(h.stdout, 'CONTROL: the lines are relayed to stdout').toContain('zqx19 gateway');
    expect(h.stdout, 'CONTROL: both of them').toContain('zqx19 csi w');
    expect(j.stderr, 'CONTROL: under --json, to stderr').toContain('zqx19 gateway');
    // One assertion per stream over both values, so a red names every leak at once: G (the declared secretsFile's value)
    // and V (the stray-CSI split of a frozen value).
    for (const [where, text] of [['human stdout', h.stdout], ['--json stderr', j.stderr]] as const) {
      expect({ G: leaks(text, G), V: leaks(text, V) }, `${where}: no belt-width stretch of either value`).toEqual({ G: [], V: [] });
    }
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('the no-store table and the speed bumps: decided by the CLI before any spawn (Task 19)', () => {
  it('a server role, and a box that never installed, answer 9; a store with no shim answers 2 writer-absent', () => {
    const server = makeHistoryBox('ccrc-hist-door-srv-', { role: 'server', shim: true });
    stubShim(server, { stdout: '{"rc":0}\n', exit: 0 });
    expect(op(server, ['doctor', '--backup', '--json']).code).toBe(9);
    expect(stubArgv(server), 'never spawned').toBeNull();
    const never = makeHistoryBox('ccrc-hist-door-none-', { role: 'fleet', shim: false });
    const n = op(never, ['import', '--json']);
    expect([n.code, n.json?.['reason']]).toEqual([9, undefined]);
    const absent = boundBox('ccrc-hist-door-abs-');
    fs.rmSync(path.join(absent.home, '.local', 'bin', 'ccd-history-sweep'));
    const a = op(absent, ['import', '--apply', '--json']);
    expect([a.code, a.json?.['reason']]).toEqual([2, 'writer-absent']);
  }, HEAVY);

  it('arguments are refused by lib\'s one grammar before any spawn, each with its word', () => {
    const box = boundBox('ccrc-hist-door-args-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const cases: Array<[string[], string]> = [
      [['prune', '--older-than', '7d'], 'older-than-floor'],
      [['doctor', '--restore', 'a/b.db'], 'restore-refused'],
      [['doctor', '--repair', '--backup'], 'bad-args'],
      [['doctor', '--bogus'], 'bad-args'],
      [['import', '--session', '../x', '--file', `/home/u/x/${U1}.jsonl`], 'bad-id'],
      [['import', '--bogus'], 'bad-args'],
    ];
    for (const [args, reason] of cases) {
      const r = op(box, [...args, '--json']);
      expect([r.code, r.json?.['reason']], args.join(' ')).toEqual([2, reason]);
    }
    expect(stubArgv(box), 'no refused form reached the shim').toBeNull();
  }, HEAVY);

  it('the speed bumps: CLAUDECODE refuses a writing form, history-off refuses a non-binding one, an irreversible one needs a TTY; a dry run passes', () => {
    const box = boundBox('ccrc-hist-door-gate-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const cc = op(box, ['doctor', '--backup', '--json'], { CLAUDECODE: '1' });
    expect([cc.code, cc.json?.['reason']]).toEqual([2, 'apply-in-session']);
    expect(op(box, ['doctor', '--adopt', '--json']).json?.['reason'], 'adopt is irreversible: no TTY here').toBe('needs-tty');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    try {
      const off = op(box, ['doctor', '--migrate', '--json']);
      expect([off.code, off.json?.['reason']]).toEqual([2, 'history-off']);
    } finally { fs.rmSync(path.join(box.home, '.ccrc', 'history-off')); }
    expect(stubArgv(box), 'no refused form reached the shim').toBeNull();
    const dry = op(box, ['import'], { CLAUDECODE: '1' });
    expect(dry.code, 'a dry run is no writing form: it passes CLAUDECODE').toBe(0);
    expect(stubArgv(box)).toEqual(['--op import']);
  }, HEAVY);

  it('bare doctor prints the status health lines and spawns nothing; with --json it is the status envelope', () => {
    const box = boundBox('ccrc-hist-door-doc-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    const h = op(box, ['doctor']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout).toMatch(/^health: (PASS|WARN|FAIL) /m);
    const j = op(box, ['doctor', '--json']);
    expect(j.json?.['health']).toBeDefined();
    expect(j.json?.['store_id']).toBe(storeIdOf(box));
    expect(stubArgv(box)).toBeNull();
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('C42 (CLI half): import maps from evidence only (Task 19)', () => {
  it('the dry run lists every mapped and unmapped file and writes nothing; --apply ingests the mapped only', () => {
    const box = boundBox('ccrc-hist-c42cli-');
    plantSession(box, ID, { uuid: U1, generation: G1, project: 'maint' });
    const mapped = plantTranscript(box, 'claude-a', SLUG, U1, [userRow({ uuid: '19000001-0000-4000-8000-0000000000a1', ts: TS, sessionId: U1, text: 'mapped words' })]);
    const unmapped: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      const u = `19000003-0000-4000-8000-${String(i).padStart(12, '0')}`;
      unmapped.push(plantTranscript(box, 'claude-b', SLUG, u, [userRow({ uuid: `19000004-0000-4000-8000-${String(i).padStart(12, '0')}`, ts: TS, sessionId: u, text: 'no evidence names me' })]));
    }
    const before = snapshot(box);
    const dry = op(box, ['import']);
    expect(dry.code, dry.stderr).toBe(0);
    const lines = dry.stdout.split('\n').filter(Boolean);
    expect(lines).toContain(`mapped ${ID} ${G1} ${mapped}`);
    expect(lines.filter((l) => l.startsWith('unmapped ')).sort()).toEqual(unmapped.map((p) => `unmapped ${p}`).sort());
    expect(lines.some((l) => l.startsWith('{"rc"')), 'the result line is the relay\'s, never printed').toBe(false);
    expect(snapshot(box), 'a dry run writes nothing').toEqual(before);
    const apply = op(box, ['import', '--apply', '--json']);
    expect(apply.code, apply.stderr).toBe(0);
    expect(apply.json).toMatchObject({ exit: 0, coverage: 'this-box' });
    expect(apply.stderr, 'under --json the sweep\'s listing goes to stderr').toContain('unmapped ');
    const db = openStoreRO(box);
    try {
      const uuids = (db.prepare('SELECT cc_session_uuid FROM transcripts').all() as { cc_session_uuid: string }[]).map((r) => r.cc_session_uuid);
      expect(uuids).toContain(U1);
      expect(uuids.filter((u) => u.startsWith('19000003')), 'an unmapped file is never ingested').toEqual([]);
    } finally { db.close(); }
  }, 1.5 * HEAVY);
});

describe.skipIf(process.platform === 'darwin')('C63: doctor --migrate through the door (Task 19)', () => {
  it('none: exit 0 and no snapshot, with no TTY', () => {
    const box = boundBox('ccrc-hist-c63a-');
    const r = op(box, ['doctor', '--migrate', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(snapshotsIn(box)).toEqual([]);
  }, HEAVY);

  it('refuse-newer: exit 2 migrate-refused, and the store is untouched', () => {
    const box = boundBox('ccrc-hist-c63b-');
    const w = new DatabaseSync(dbFile(box));
    try { w.exec('PRAGMA user_version = 2'); w.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { w.close(); }
    const before = sha(dbFile(box));
    const r = op(box, ['doctor', '--migrate', '--json']);
    expect([r.code, r.json?.['reason']]).toEqual([2, 'migrate-refused']);
    expect(sha(dbFile(box))).toBe(before);
    expect(versionOf(dbFile(box))).toBe(2);
    expect(snapshotsIn(box)).toEqual([]);
  }, HEAVY);

  it('refuse-low-disk: a pending migration with no room is exit 2 migrate-refused and writes no snapshot; with room it snapshots and migrates', () => {
    const box = boundBox('ccrc-hist-c63c-');
    driverShim(box);
    const r = op(box, ['doctor', '--migrate', '--json'], { ...PENDING, HISTORY_TEST_STATFS: `4096:${10 * 1024 ** 3}` });
    expect([r.code, r.json?.['reason']]).toEqual([2, 'migrate-refused']);
    expect(versionOf(dbFile(box))).toBe(1);
    expect(snapshotsIn(box)).toEqual([]);
    const ok = op(box, ['doctor', '--migrate', '--json'], PENDING);
    expect(ok.code, ok.stderr).toBe(0);
    expect(snapshotsIn(box)).toEqual(['pre-v2.db']);
    expect(versionOf(dbFile(box))).toBe(2);
  }, 1.5 * HEAVY);

  it('under CLAUDECODE: apply-in-session; under history-off: history-off; neither spawns the shim', () => {
    const box = boundBox('ccrc-hist-c63d-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    expect(op(box, ['doctor', '--migrate', '--json'], { CLAUDECODE: '1' }).json?.['reason']).toBe('apply-in-session');
    fs.writeFileSync(path.join(box.home, '.ccrc', 'history-off'), '');
    expect(op(box, ['doctor', '--migrate', '--json']).json?.['reason']).toBe('history-off');
    expect(stubArgv(box)).toBeNull();
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('the --op pass\'s tables, through the direct door (Task 19)', () => {
  it('a verb\'s arguments are lib\'s one grammar; a verb this build does not run is bad-args', () => {
    const box = boundBox('ccrc-hist-optab-');
    expect(lastResult(runSweep(box, ['--op', 'migrate', 'extra']).stdout)).toEqual({ rc: 2, reason: 'bad-args' });
    expect(lastResult(runSweep(box, ['--op', 'import', '--session', '../x', '--file', `/home/u/x/${U1}.jsonl`, '--apply']).stdout))
      .toEqual({ rc: 2, reason: 'bad-id' });
    expect(lastResult(runSweep(box, ['--op', 'adopt']).stdout)).toEqual({ rc: 2, reason: 'bad-args' });
  }, HEAVY);

  it('migration-pending refuses a verb whose rows the code\'s version shapes, never migrate itself', () => {
    const box = boundBox('ccrc-hist-oppend-');
    driverShim(box);
    expect(lastResult(runShim(box, ['--op', 'import', '--apply'], { env: PENDING }).stdout)).toEqual({ rc: 5, reason: 'migration-pending' });
    const m = runShim(box, ['--op', 'migrate'], { env: PENDING });
    expect(lastResult(m.stdout)).toEqual({ rc: 0 });
    expect(versionOf(dbFile(box))).toBe(2);
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('RB6: while a recovery step is registered, a writing form is refused recovering at both doors (Task 19)', () => {
  /** A bound store holding an open ('recover', <ms>) step, as restore and rebuild leave one (Tasks 27, 28), planted
   *  by SQL. Only import and migrate are --op verbs at this task, and no case here has a TTY: Task 25's RB6 case
   *  runs every writing form on a terminal, and Tasks 27 and 28 show restore and rebuild are never refused. */
  function recoveringBox(prefix: string): HistoryBox {
    const box = boundBox(prefix);
    const w = new DatabaseSync(dbFile(box));
    try {
      w.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.UTC(2026, 9, 4));
      w.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { w.close(); }
    return box;
  }

  it('the direct door: import --apply and migrate answer {rc:2, reason:"recovering"} and write nothing; the import dry run answers 0', () => {
    const box = recoveringBox('ccrc-hist-rb6a-');
    const before = snapshot(box);
    expect(lastResult(runShim(box, ['--op', 'import', '--apply']).stdout)).toEqual({ rc: 2, reason: 'recovering' });
    expect(lastResult(runShim(box, ['--op', 'migrate']).stdout)).toEqual({ rc: 2, reason: 'recovering' });
    // No op marker, no outbox flush, no writer open. No spool line is pending here, so the lock-take journal half,
    // which runs before the measure, and the half at release, which B1's `released` runs on the refusal, write nothing
    // either.
    expect(snapshot(box), 'a refused form writes nothing').toEqual(before);
    expect(lastResult(runShim(box, ['--op', 'import']).stdout), 'a dry run is no writing form').toEqual({ rc: 0 });
  }, HEAVY);

  it('the CLI door: import --apply, doctor --backup and doctor --migrate answer 2 recovering before any spawn; the import dry run reaches the shim', () => {
    const box = recoveringBox('ccrc-hist-rb6b-');
    stubShim(box, { stdout: '{"rc":0}\n', exit: 0 });
    for (const args of [['import', '--apply'], ['doctor', '--backup'], ['doctor', '--migrate']]) {
      const r = op(box, [...args, '--json']);
      expect([r.code, r.json?.['reason']], args.join(' ')).toEqual([2, 'recovering']);
    }
    expect(stubArgv(box), 'the CLI refused each before it spawned').toBeNull();
    expect(op(box, ['import']).code, 'a dry run passes').toBe(0);
    expect(stubArgv(box)).toEqual(['--op import']);
  }, HEAVY);

  it('RB13, the direct door: migrate is refused while the stored user_version equals the code\'s; a store older than the code migrates, and its step stays for a later pass', () => {
    const box = recoveringBox('ccrc-hist-rb13a-');
    driverShim(box);
    const openStep = (): number => {
      const db = new DatabaseSync(dbFile(box), { readOnly: true });
      try {
        return (db.prepare("SELECT count(*) AS n FROM derivation_state WHERE step = 'recover' AND completed_ms IS NULL").get() as { n: number }).n;
      } finally { db.close(); }
    };
    // Stored 1, code 1: the refusal stands.
    expect(lastResult(runShim(box, ['--op', 'migrate']).stdout), 'stored = code').toEqual({ rc: 2, reason: 'recovering' });
    expect(versionOf(dbFile(box))).toBe(1);
    // Stored 1, code 2 (a v2 migration staged): a restored older backup migrates rather than wait on its own step.
    const m = runShim(box, ['--op', 'migrate'], { env: PENDING });
    expect(lastResult(m.stdout), `${m.stdout}\n${m.stderr}`).toEqual({ rc: 0 });
    expect(versionOf(dbFile(box))).toBe(2);
    expect(snapshotsIn(box)).toEqual(['pre-v2.db']);
    expect(openStep(), 'the migration leaves the step registered; it runs at the code\'s version').toBe(1);
    // Stored 2, code 2: equal again, so the refusal is back.
    expect(lastResult(runShim(box, ['--op', 'migrate'], { env: PENDING }).stdout), 'stored = code again').toEqual({ rc: 2, reason: 'recovering' });
  }, 1.5 * HEAVY);

  it('RB13, the CLI door: a store whose user_version is not the code\'s passes the recovering row in both halves and meets migrate\'s own word', () => {
    const box = recoveringBox('ccrc-hist-rb13b-');
    // Newer than the code, as a rollback past a migration leaves it. Neither half refuses it `recovering`; the sweep's
    // openStore answers schema-newer, which --migrate relays as migrate-refused (C63's refuse-newer).
    const w = new DatabaseSync(dbFile(box));
    try { w.exec('PRAGMA user_version = 2'); w.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { w.close(); }
    const before = sha(dbFile(box));
    const r = op(box, ['doctor', '--migrate', '--json']);
    expect([r.code, r.json?.['reason']], `${r.stdout}${r.stderr}`).toEqual([2, 'migrate-refused']);
    expect(sha(dbFile(box)), 'the store is untouched').toBe(before);
  }, HEAVY);
});

// ── W1-B2 Tasks 20-23: prune, reparse, backup and repair (spec 2026-10-05 §6.6, §8.4) ──────────────
// Shared by those four tasks' describes; only what Task 19's block above does not already hold (ID, boundBox,
// snapshot, lastResult), each name carrying a `maint`/`MAINT_` prefix. The TTY gate has no seam (§10.1): an
// irreversible form runs under a real node-pty terminal, through either door — the CLI (`node cli.mjs …`, which
// spawns the shim) or the shim itself.
const MAINT_U1 = '11111111-1111-4111-8111-1111111111a1';
const MAINT_QUOKKA = 'c0000000-0000-4000-8000-0000000000a1';
const MAINT_DAY = 86_400_000;
function maintIso(msAgo: number): string { return new Date(Date.now() - msAgo).toISOString(); }
/** The CLI's --json envelope read off a pty: the last line that parses as a JSON object. */
function maintJson(out: string): Record<string, unknown> | null {
  const lines = out.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]!) as Record<string, unknown>; } catch { /* a partial line */ }
  }
  return null;
}
function maintQ<T>(box: HistoryBox, sql: string, ...args: Array<string | number>): T[] {
  const db = openStoreRO(box);
  try { return db.prepare(sql).all(...args) as T[]; } finally { db.close(); }
}
function maintMatch(box: HistoryBox, word: string): number {
  return maintQ<{ n: number }>(box, 'SELECT count(*) AS n FROM blobs_fts WHERE blobs_fts MATCH ?', word)[0]!.n;
}
function maintMeta(box: HistoryBox, k: string): string | null {
  return maintQ<{ v: string }>(box, 'SELECT v FROM meta WHERE k = ?', k)[0]?.v ?? null;
}
function maintNames(dir: string): string[] { try { return fs.readdirSync(dir).sort(); } catch { return []; } }
function maintTombstones(box: HistoryBox): number {
  return maintQ<{ n: number }>(box, 'SELECT count(*) AS n FROM blobs WHERE z IS NULL')[0]!.n;
}
/** RB6's state: a `('recover', <ms>)` step registered as restore and rebuild register it (§9.14), planted by SQL
 *  with no sweep running. No scheduled pass may run on the box afterwards: it would start replaying. */
function maintRecovering(box: HistoryBox): void {
  const db = new DatabaseSync(historyPaths(box.home).dbFile);
  try {
    db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('recover', ?, NULL, NULL)").run(Date.now());
  } finally { db.close(); }
}
/** A door on a REAL terminal (node-pty), so stdin is a TTY and only the pane, the switches or the lock can
 *  refuse. `cli` is `node --no-warnings cli.mjs <args>` (which spawns the shim with stdin inherited); `shim` is
 *  the placed `~/.local/bin/ccd-history-sweep <args>`. Every spawn carries the statfs preload. A pty merges
 *  stdout and stderr; `signal` is set when the child died of one. The guard timer is a safety net, never the
 *  assertion. */
function maintPty(box: HistoryBox, door: 'cli' | 'shim', args: string[],
  o: { env?: Record<string, string>; preloads?: string[] } = {}): Promise<{ code: number; signal: number | undefined; out: string }> {
  const file = door === 'cli' ? process.execPath : 'bash';
  const argv = door === 'cli' ? ['--no-warnings', CLI, ...args] : [path.join(box.home, '.local', 'bin', 'ccd-history-sweep'), ...args];
  const merged: NodeJS.ProcessEnv = {
    ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions(o.preloads ?? [PRELOADS.statfs]), ...(o.env ?? {}),
  };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== undefined) env[k] = v;
  return new Promise((resolve) => {
    const p = pty.spawn(file, argv, { name: 'xterm-color', cols: 200, rows: 40, cwd: box.home, env });
    let out = '';
    let done = false;
    const finish = (code: number, signal: number | undefined): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, signal, out });
    };
    const timer = setTimeout(() => { p.kill(); finish(-1, undefined); }, 80_000);
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode, signal }) => finish(exitCode, signal));
  });
}

describe('prune: dry run by default, tombstones by referrer age, the floor, the bumps and the lock (W1-B2 Task 20)', () => {
  skipOnDarwin();
  /** A family whose first span is old enough to prune: one distinctive operator row, then one manual compaction
   *  (Task 5's builder), every row stamped `ageMs` ago, so a leaf over them is derived. */
  function prunable(prefix: string, ageMs = 200 * MAINT_DAY): HistoryBox {
    const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
    const seq = compactionSequence({ n: 1, trigger: 'manual' });
    const rows = [
      userRow({ uuid: MAINT_QUOKKA, ts: maintIso(ageMs), sessionId: MAINT_U1, text: 'quokkaprune words of the old span' }),
      ...seq.rows.map((r) => ({ ...r, timestamp: maintIso(ageMs), sessionId: MAINT_U1 })),
    ];
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows });
    expect(runSweep(box).code).toBe(0);
    return box;
  }

  it('O12: prune without --apply, through both doors, says what it would tombstone and writes nothing', () => {
    const box = prunable('ccrc-hist-o12-');
    const before = snapshot(box);
    const direct = runShim(box, ['--op', 'prune', '--older-than', '90d']);
    expect(direct.code, direct.stderr).toBe(0);
    expect(lastResult(direct.stdout)).toEqual({ rc: 0 });
    expect(direct.stdout).toMatch(/^history-sweep: prune --older-than 90d would tombstone [1-9][0-9]* blob\(s\), [0-9]+ bytes compressed; the export holds 0 of them$/m);
    expect(direct.stdout, 'the hint names the operator and the terminal (R-X-OPERATOR)')
      .toContain('the operator adds --apply, from a terminal outside any session, to tombstone');
    const cli = runCli(box, ['prune', '--older-than', '90d', '--json']);
    expect(cli.code, cli.stderr).toBe(0);
    expect(cli.json?.['exit']).toBe(0);
    expect(snapshot(box), 'a dry run writes nothing').toEqual(before);
    expect(maintTombstones(box)).toBe(0);
  }, HEAVY);

  it('DM22: a duration under 30 days is older-than-floor through both doors, decided before the gate; 30d is allowed', () => {
    const box = boundBox('ccrc-hist-dm22-');
    const cli = runCli(box, ['prune', '--older-than', '7d', '--apply', '--json']);
    expect(cli.code, cli.stderr).toBe(2);
    expect(cli.json?.['reason']).toBe('older-than-floor');
    const direct = runShim(box, ['--op', 'prune', '--older-than', '29d', '--apply']);
    expect(direct.code).toBe(2);
    expect(lastResult(direct.stdout)).toEqual({ rc: 2, reason: 'older-than-floor' });
    const floor = runShim(box, ['--op', 'prune', '--older-than', '30d']);
    expect(floor.code, floor.stderr).toBe(0);
    expect(lastResult(floor.stdout)).toEqual({ rc: 0 });
  }, HEAVY);

  it('DM14: --apply under a terminal tombstones the old span — z NULL, pruned_ms set, its FTS row gone — while every entry and node stays, and expand says "content pruned on <date>"', async (ctx) => {
    const box = prunable('ccrc-hist-dm14-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();          // a Node without FTS5 has no index to prune from
    const leaf = maintQ<{ node_id: string }>(box, 'SELECT node_id FROM nodes WHERE depth = 0 ORDER BY node_id')[0]?.node_id;
    expect(leaf, 'CONTROL: the fixture derived a leaf over the old span').toMatch(/^L[0-9a-f]{20}$/);
    const counts = (): number[] => ['entries', 'nodes', 'node_sources', 'blobs']
      .map((t) => maintQ<{ n: number }>(box, `SELECT count(*) AS n FROM ${t}`)[0]!.n);
    const before = counts();
    expect(maintMatch(box, 'quokkaprune'), 'CONTROL: indexed before the prune').toBe(1);
    expect(maintQ<{ step: string }>(box, "SELECT step FROM derivation_state WHERE step = 'fts-merge' AND completed_ms IS NULL"),
      'CONTROL: no merge step is pending before the prune').toHaveLength(0);
    const r = await maintPty(box, 'cli', ['prune', '--older-than', '90d', '--apply']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/history-sweep: pruned [1-9][0-9]* blob\(s\)/);
    const blob = maintQ<{ z: Uint8Array | null; pruned_ms: number | null }>(box,
      'SELECT b.z, b.pruned_ms FROM blobs b JOIN entries e ON e.blob_id = b.blob_id WHERE e.uuid = ?', MAINT_QUOKKA)[0]!;
    expect(blob.z).toBeNull();
    expect(blob.pruned_ms).toBeGreaterThan(0);
    expect(maintMatch(box, 'quokkaprune'), 'the pruned blob left the index').toBe(0);
    expect(counts(), 'tombstones content, never rows').toEqual(before);
    expect(maintQ<{ step: string }>(box, "SELECT step FROM derivation_state WHERE step = 'fts-merge' AND completed_ms IS NULL"),
      'the deleted index bytes are left to the ticks\' merge steps').toHaveLength(1);
    const ex = runCli(box, ['expand', leaf!], { env: withPane(box, ID) });
    expect(ex.code, ex.stderr).toBe(0);
    expect(ex.stdout).toContain(`content pruned on ${new Date(blob.pruned_ms!).toISOString().slice(0, 10)}`);
  }, HEAVY);

  it('D-4589: content captured again after a prune is stored again — the tombstone is revived, searchable and expandable, never linked as pruned', async (ctx) => {
    // The pinned path is the whole-file SIDECAR arm (ingestSidecar): two sessions, each with a tool result naming a
    // sidecar file of byte-identical content, so the second capture meets the first's tombstone through its sha.
    const box = makeHistoryBox('ccrc-hist-d4589-', { role: 'fleet', shim: true });
    const ID2 = 'claude-a-maint2';
    const U2 = '11111111-1111-4111-8111-1111111111a2';
    const OLD_TR = 'c0000000-0000-4000-8000-0000000000b1';
    const NEW_TR = 'c0000000-0000-4000-8000-0000000000b2';
    const BODY = 'zqrevive20 the distinctive bytes of one large tool result\n';
    const account = Object.keys(box.accountHome)[0]!;
    const sidecar = (uuid: string): void => {
      const dir = path.join(box.accountHome[account]!, 'projects', '-home-u-tree-demo', uuid, 'tool-results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'zzrevive20.txt'), BODY);
    };
    const sidecarBlob = (uuid: string): { blob_id: number; z: Uint8Array | null; pruned_ms: number | null } | undefined =>
      maintQ<{ blob_id: number; z: Uint8Array | null; pruned_ms: number | null }>(box,
        `SELECT b.blob_id, b.z, b.pruned_ms FROM sidecars s JOIN blobs b ON b.blob_id = s.blob_id
         JOIN transcripts t ON t.transcript_pk = s.transcript_pk WHERE t.cc_session_uuid = ?`, uuid)[0];
    // 1. An old capture, 200 days back: a tool result naming the file, and the file.
    sidecar(MAINT_U1);
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows: [
      toolResultRow({ uuid: OLD_TR, ts: maintIso(200 * MAINT_DAY), sessionId: MAINT_U1, toolUseId: 'toolu_01REVIVEOLD',
        content: 'Output too large. Full output saved to: /home/u/x/tool-results/zzrevive20.txt' }),
    ] });
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const old = sidecarBlob(MAINT_U1);
    expect(old, 'CONTROL: the old sidecar is captured').toBeDefined();
    expect(old!.z, 'CONTROL: the old sidecar holds its bytes').not.toBeNull();
    expect(maintMatch(box, 'zqrevive20'), 'CONTROL: indexed before the prune').toBe(1);
    // 2. Prune it.
    const r = await maintPty(box, 'cli', ['prune', '--older-than', '90d', '--apply']);
    expect(r.code, r.out).toBe(0);
    const pruned = sidecarBlob(MAINT_U1)!;
    expect(pruned.z, 'CONTROL: the sidecar blob is a tombstone').toBeNull();
    expect(pruned.pruned_ms, 'CONTROL: the tombstone is stamped').toBeGreaterThan(0);
    expect(maintMatch(box, 'zqrevive20'), 'CONTROL: the tombstone left the index').toBe(0);
    // 3. A young capture of the SAME bytes.
    sidecar(U2);
    seedFamily(box, { id: ID2, project: 'demo', uuid: U2, rows: [
      toolResultRow({ uuid: NEW_TR, ts: maintIso(MAINT_DAY), sessionId: U2, toolUseId: 'toolu_01REVIVENEW',
        content: 'Output too large. Full output saved to: /home/u/x/tool-results/zzrevive20.txt' }),
    ] });
    const young = sidecarBlob(U2);
    expect(young, 'the young sidecar is captured').toBeDefined();
    expect(young!.blob_id, 'content-addressed: the young sidecar names the same blob row').toBe(pruned.blob_id);
    expect(young!.z, 'the tombstone is revived: the bytes are stored again').not.toBeNull();
    expect(young!.pruned_ms, 'a revived blob is no longer pruned').toBeNull();
    expect(maintMatch(box, 'zqrevive20'), 'the revived text is searchable again').toBe(1);
    const ex = runCli(box, ['expand', NEW_TR], { env: withPane(box, ID2) });
    expect(ex.code, ex.stderr).toBe(0);
    expect(ex.stdout).toContain('zqrevive20');
    expect(ex.stdout).not.toContain('content pruned');
  }, HEAVY);

  it('D-4589, the row path: a row captured again after a prune (a copied transcript, or the same raw line in another file) is stored again through compressMissing', async (ctx) => {
    // The pinned path is the transcript-ROW arm: an entry row's blob goes through compressMissing's `need` (sweep.mjs),
    // whose "already stored" test is blobLive (a body present), never blobId (a row, a tombstone included). The second
    // capture is a copy of the first transcript's row, byte for byte (the same timestamp string), under another session.
    const box = makeHistoryBox('ccrc-hist-d4589r-', { role: 'fleet', shim: true });
    const ID2 = 'claude-a-maint2';
    const U2 = '11111111-1111-4111-8111-1111111111a2';
    const ts = maintIso(200 * MAINT_DAY);
    const row = userRow({ uuid: MAINT_QUOKKA, ts, sessionId: MAINT_U1, text: 'zqrowrevive20 words of the old captured row' });
    const rowBlob = (): { blob_id: number; z: Uint8Array | null; pruned_ms: number | null } | undefined =>
      maintQ<{ blob_id: number; z: Uint8Array | null; pruned_ms: number | null }>(box,
        'SELECT b.blob_id, b.z, b.pruned_ms FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?', MAINT_QUOKKA)[0];
    // 1. An old capture, 200 days back.
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows: [row] });
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const old = rowBlob();
    expect(old, 'CONTROL: the old row is captured').toBeDefined();
    expect(old!.z, 'CONTROL: the old row holds its bytes').not.toBeNull();
    expect(maintMatch(box, 'zqrowrevive20'), 'CONTROL: indexed before the prune').toBe(1);
    // 2. Prune it.
    const r = await maintPty(box, 'cli', ['prune', '--older-than', '90d', '--apply']);
    expect(r.code, r.out).toBe(0);
    const pruned = rowBlob()!;
    expect(pruned.blob_id, 'CONTROL: the same blob row').toBe(old!.blob_id);
    expect(pruned.z, 'CONTROL: the row blob is a tombstone').toBeNull();
    expect(pruned.pruned_ms, 'CONTROL: the tombstone is stamped').toBeGreaterThan(0);
    expect(maintMatch(box, 'zqrowrevive20'), 'CONTROL: the tombstone left the index').toBe(0);
    // 3. The same bytes again, from another file: a second session's transcript holding the identical row.
    seedFamily(box, { id: ID2, project: 'demo', uuid: U2, rows: [row] });
    const again = rowBlob()!;
    expect(again.blob_id, 'content-addressed: the copied row names the same blob row').toBe(pruned.blob_id);
    expect(again.z, 'the tombstone is revived: the row bytes are stored again').not.toBeNull();
    expect(again.pruned_ms, 'a revived blob is no longer pruned').toBeNull();
    expect(maintMatch(box, 'zqrowrevive20'), 'the revived text is searchable again').toBe(1);
  }, HEAVY);

  it('DM27: deleting a transcript prunes nothing its age does not', async () => {
    const box = makeHistoryBox('ccrc-hist-dm27-', { role: 'fleet', shim: true });
    const { transcript } = seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows: [
      userRow({ uuid: MAINT_QUOKKA, ts: maintIso(MAINT_DAY), sessionId: MAINT_U1, text: 'young words whose file is about to go' }),
    ] });
    expect(maintQ<{ n: number }>(box, 'SELECT count(*) AS n FROM entries')[0]!.n, 'CONTROL: ingested').toBe(1);
    fs.rmSync(transcript);
    expect(runSweep(box).code).toBe(0);                            // the tick finds the file gone and counts it
    const r = await maintPty(box, 'shim', ['--op', 'prune', '--older-than', '30d', '--apply']);
    expect(r.code, r.out).toBe(0);
    expect(lastResult(r.out)).toEqual({ rc: 0 });
    expect(maintTombstones(box), 'a source file\'s absence decides nothing (lossless-claw #610)').toBe(0);
  }, HEAVY);

  it('C25: in a session (CLAUDECODE) prune --apply answers apply-in-session; with no terminal prune --apply and import --session --file --apply answer needs-tty; nothing is written', () => {
    const box = boundBox('ccrc-hist-c25-');
    const file = plantTranscript(box, 'claude-a', '-home-u-tree-demo', MAINT_U1,
      [userRow({ uuid: MAINT_QUOKKA, ts: maintIso(0), sessionId: MAINT_U1, text: 'an import candidate' })]);
    const before = snapshot(box);
    const cases: Array<{ args: string[]; env: Record<string, string>; reason: string }> = [
      { args: ['prune', '--older-than', '90d', '--apply', '--json'], env: { CLAUDECODE: '1' }, reason: 'apply-in-session' },
      { args: ['prune', '--older-than', '90d', '--apply', '--json'], env: {}, reason: 'needs-tty' },
      { args: ['import', '--session', ID, '--file', file, '--apply', '--json'], env: {}, reason: 'needs-tty' },
    ];
    for (const c of cases) {
      const r = runCli(box, c.args, { env: c.env });
      expect(r.code, `${c.args.join(' ')}: ${r.stderr}`).toBe(2);
      expect(r.json?.['reason'], c.args.join(' ')).toBe(c.reason);
      expect(snapshot(box), c.args.join(' ')).toEqual(before);
    }
  }, HEAVY);

  it('C34: with the shim\'s lock held, prune --apply under a terminal answers exit 4 writer-busy and writes nothing', async () => {
    const box = prunable('ccrc-hist-c34-');
    const before = snapshot(box);
    const release = holdLock(box);
    try {
      const r = await maintPty(box, 'cli', ['prune', '--older-than', '90d', '--apply', '--json']);
      expect(r.code, r.out).toBe(4);
      expect(maintJson(r.out)?.['reason']).toBe('writer-busy');
    } finally {
      release();
    }
    expect(snapshot(box)).toEqual(before);
    expect(maintTombstones(box)).toBe(0);
  }, HEAVY);

  it('RB3: below the free-space floor prune --apply still runs (it is how the store gets room back); a probe that never settles answers 5 store-unreachable and tombstones nothing', async () => {
    const box = prunable('ccrc-hist-pfloor-');
    const fsSize = 10 * 1024 ** 3;
    const hung = await maintPty(box, 'shim', ['--op', 'prune', '--older-than', '90d', '--apply'], { env: { HISTORY_TEST_STATFS: 'hang' } });
    expect(hung.code, hung.out).toBe(5);
    expect(lastResult(hung.out)).toEqual({ rc: 5, reason: 'store-unreachable' });
    expect(maintTombstones(box), 'an unreachable store is never written').toBe(0);
    // 4 KiB under the floor's threshold, on a probe that settles (§9.3's floor would refuse an ingest here).
    const low = await maintPty(box, 'shim', ['--op', 'prune', '--older-than', '90d', '--apply'],
      { env: { HISTORY_TEST_STATFS: `${floorThreshold(fsSize) - 4096}:${fsSize}` } });
    expect(low.code, low.out).toBe(0);
    expect(lastResult(low.out)).toEqual({ rc: 0 });
    expect(maintTombstones(box), 'below the floor is exactly where prune must run').toBeGreaterThan(0);
  }, HEAVY);

  it('RB6: while a recovery step is registered, prune --apply answers recovering and tombstones nothing; the dry run still answers', async () => {
    const box = prunable('ccrc-hist-rb6p-');
    maintRecovering(box);
    const r = await maintPty(box, 'shim', ['--op', 'prune', '--older-than', '90d', '--apply']);
    expect(r.code, r.out).toBe(2);
    expect(lastResult(r.out)).toEqual({ rc: 2, reason: 'recovering' });
    expect(maintTombstones(box), 'nothing is pruned under a replay').toBe(0);
    const dry = runShim(box, ['--op', 'prune', '--older-than', '90d']);
    expect(dry.code, dry.stderr).toBe(0);
    expect(lastResult(dry.stdout)).toEqual({ rc: 0 });
  }, HEAVY);
});

describe('reparse: targets, the 500-leaf limit, pruned spans refused, ids kept, crashes retried (W1-B2 Task 21)', () => {
  skipOnDarwin();
  /** A family with two manual compactions (Task 5's builder), so two leaves are derived. */
  function twoLeaves(prefix: string): HistoryBox {
    const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows: compactionSequence({ n: 2, trigger: 'manual' }).rows });
    expect(runSweep(box).code).toBe(0);
    return box;
  }
  const leafIds = (box: HistoryBox): string[] =>
    maintQ<{ node_id: string }>(box, "SELECT node_id FROM nodes WHERE kind <> 'condensed' ORDER BY node_id").map((r) => r.node_id);
  const allIds = (box: HistoryBox): string[] =>
    maintQ<{ node_id: string }>(box, 'SELECT node_id FROM nodes ORDER BY node_id').map((r) => r.node_id);
  const sourcesOf = (box: HistoryBox): Array<{ node_id: string; entry_id: number; ord: number }> =>
    maintQ(box, 'SELECT node_id, entry_id, ord FROM node_sources ORDER BY node_id, ord');
  interface LeafRow { node_id: string; kind: string; status: string; gist: string | null; topics: string | null; directive_flag: number; capped: number }
  /** Every derived field reparse may rewrite, per leaf. */
  const leafRows = (box: HistoryBox): LeafRow[] =>
    maintQ<LeafRow>(box, 'SELECT node_id, kind, status, gist, topics, directive_flag, capped FROM nodes WHERE depth = 0 ORDER BY node_id');
  const refsOf = (box: HistoryBox): unknown[] => maintQ(box, 'SELECT node_id, kind, value, origin FROM node_refs ORDER BY node_id, kind, value');
  const crashes = (box: HistoryBox): number =>
    maintQ<{ n: number }>(box, "SELECT n FROM counters WHERE name = 'parser_crash'")[0]?.n ?? 0;

  it('DM7: two fresh boxes over the same fixtures derive the same L/N + 20-hex ids, and reparse --apply keeps them and their sources', () => {
    const a = twoLeaves('ccrc-hist-dm7a-');
    const b = twoLeaves('ccrc-hist-dm7b-');
    const ids = allIds(a);
    expect(leafIds(a).length, 'CONTROL: the fixture derived its two leaves').toBe(2);
    for (const id of ids) expect(id).toMatch(/^[LN][0-9a-f]{20}$/);
    expect(allIds(b), 're-ingest on a fresh box derives the same ids').toEqual(ids);
    const sources = sourcesOf(a);
    const r = runShim(a, ['--op', 'reparse', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(r.stdout).toMatch(/^history-sweep: reparsed 2 leaves \([0-9]+ changed, 0 failed\); node ids and sources unchanged$/m);
    expect(allIds(a), 'a reparse never mints an id').toEqual(ids);
    expect(sourcesOf(a), 'nor moves a source').toEqual(sources);
  }, HEAVY);

  it('DM21: a span with a tombstoned source is refused span-pruned through both doors and by the dry run, and node_sources stay byte-identical', () => {
    const box = twoLeaves('ccrc-hist-dm21-');
    const leaf = leafIds(box)[0]!;
    const db = new DatabaseSync(dbFile(box));
    try {
      db.prepare(`UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = (SELECT e.blob_id FROM node_sources ns
          JOIN entries e ON e.entry_id = ns.entry_id WHERE ns.node_id = ? ORDER BY ns.ord LIMIT 1)`).run(Date.now(), leaf);
    } finally { db.close(); }
    const sources = sourcesOf(box);
    const direct = runShim(box, ['--op', 'reparse', '--node', leaf, '--apply']);
    expect(direct.code).toBe(2);
    expect(lastResult(direct.stdout)).toEqual({ rc: 2, reason: 'span-pruned' });
    const cli = runCli(box, ['reparse', '--node', leaf, '--apply', '--json']);
    expect(cli.code, cli.stderr).toBe(2);
    expect(cli.json?.['reason']).toBe('span-pruned');
    const dry = runShim(box, ['--op', 'reparse']);
    expect(lastResult(dry.stdout), 'a dry run says what --apply would answer').toEqual({ rc: 2, reason: 'span-pruned' });
    expect(sourcesOf(box)).toEqual(sources);
    const other = leafIds(box)[1]!;
    const untouched = runShim(box, ['--op', 'reparse', '--node', other, '--apply']);
    expect(lastResult(untouched.stdout), 'a leaf with no pruned source still reparses').toEqual({ rc: 0 });
    // A tombstoned SUMMARY is a pruned span too (prune never makes one; a restored or hand-edited store can).
    const summary = maintQ<{ id: number | null }>(box, 'SELECT summary_blob_id AS id FROM nodes WHERE node_id = ?', other)[0]?.id ?? null;
    expect(summary, 'CONTROL: a native leaf names its summary blob (Task 8)').not.toBeNull();
    const db2 = new DatabaseSync(dbFile(box));
    try { db2.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(Date.now(), summary!); } finally { db2.close(); }
    const sumRefused = runShim(box, ['--op', 'reparse', '--node', other, '--apply']);
    expect(lastResult(sumRefused.stdout)).toEqual({ rc: 2, reason: 'span-pruned' });
    expect(sourcesOf(box)).toEqual(sources);
  }, HEAVY);

  it('an unknown --node is not found (exit 3, no reason word) in both forms', () => {
    const box = boundBox('ccrc-hist-rp3-');
    const missing = `L${'0'.repeat(19)}9`;
    expect(lastResult(runShim(box, ['--op', 'reparse', '--node', missing, '--apply']).stdout)).toEqual({ rc: 3 });
    expect(lastResult(runShim(box, ['--op', 'reparse', '--node', missing]).stdout)).toEqual({ rc: 3 });
  }, HEAVY);

  it('C62: exactly REPARSE_MAX_TARGETS leaves run; one more answers reparse-too-many and writes nothing', () => {
    const box = boundBox('ccrc-hist-c62-');
    /** Leaves planted by SQL on the store's own WAL: no boundary, so refreshLeaf skips each, and the run's
     *  answer is decided by the count alone. */
    const plant = (from: number, to: number): void => {
      const db = new DatabaseSync(dbFile(box));
      try {
        db.exec('BEGIN IMMEDIATE');
        db.prepare("INSERT OR IGNORE INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, ?, '', 'demo', 1)").run(ID);
        db.prepare('INSERT OR IGNORE INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(MAINT_U1);
        const ins = db.prepare(`INSERT INTO nodes (node_id, session_pk, epoch_seq, transcript_pk, kind, depth, status, parser_version,
            created_ms) VALUES (?, 1, 1, 1, 'native_leaf', 0, 'not-requested', 1, 1)`);
        for (let i = from; i < to; i += 1) ins.run(`L${i.toString(16).padStart(20, '0')}`);
        db.exec('COMMIT');
      } finally { db.close(); }
    };
    const nodes = (): unknown[] => maintQ(box, 'SELECT node_id, kind, status, gist, topics, parser_version, created_ms FROM nodes ORDER BY node_id');
    plant(0, REPARSE_MAX_TARGETS);
    const ran = runShim(box, ['--op', 'reparse', '--apply']);
    expect(ran.code, ran.stderr).toBe(0);
    expect(ran.stdout).toMatch(new RegExp(`^history-sweep: reparsed ${REPARSE_MAX_TARGETS} leaves`, 'm'));
    plant(REPARSE_MAX_TARGETS, REPARSE_MAX_TARGETS + 1);
    const before = nodes();
    const refused = runShim(box, ['--op', 'reparse', '--apply']);
    expect(refused.code).toBe(2);
    expect(lastResult(refused.stdout)).toEqual({ rc: 2, reason: 'reparse-too-many' });
    expect(refused.stdout).toMatch(/^history-sweep: reparse-too-many: 501 leaves named, above the limit of 500/m);
    expect(nodes(), 'nothing written').toEqual(before);
  }, HEAVY);

  it('RB5: a parse-failed leaf is left alone by the tick and re-derived by reparse --apply, under the same id and sources', () => {
    const box = twoLeaves('ccrc-hist-rb5a-');
    const before = leafRows(box);
    const refs = refsOf(box);
    const sources = sourcesOf(box);
    const target = leafIds(box)[0]!;
    expect(before.find((x) => x.node_id === target)?.kind, 'CONTROL: derived native from its summary').toBe('native_leaf');
    // The leaf as Task 8 records a crashed derivation (RB5), planted by SQL with no sweep running.
    const db = new DatabaseSync(dbFile(box));
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare(`UPDATE nodes SET kind = 'raw_leaf', status = 'parse-failed', gist = NULL, topics = NULL, directive_flag = 0, capped = 0
        WHERE node_id = ?`).run(target);
      db.prepare('DELETE FROM node_refs WHERE node_id = ?').run(target);
      db.exec('COMMIT');
    } finally { db.close(); }
    expect(runSweep(box).code).toBe(0);
    expect(leafRows(box).find((x) => x.node_id === target)?.status, 'no tick retries a recorded crash').toBe('parse-failed');
    const r = runShim(box, ['--op', 'reparse', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(r.stdout).toMatch(/^history-sweep: reparsed 2 leaves \(1 changed, 0 failed\); node ids and sources unchanged$/m);
    expect(leafRows(box), 'the leaf reads as it was first derived, under the same id').toEqual(before);
    expect(refsOf(box)).toEqual(refs);
    expect(sourcesOf(box)).toEqual(sources);
  }, HEAVY);

  it('RB5: a leaf whose derivation still throws is recorded parse-failed and counted once, the other is re-derived, and the next reparse retries it', () => {
    const box = twoLeaves('ccrc-hist-rb5b-');
    const before = leafRows(box);
    // The LATER leaf's summary blob: the earlier leaf's derivation never reads it (topics read the previous summary).
    const last = maintQ<{ node_id: string; s: number }>(box,
      'SELECT node_id, summary_blob_id AS s FROM nodes WHERE depth = 0 ORDER BY boundary_entry_id DESC LIMIT 1')[0]!;
    expect(last.s, 'CONTROL: a native leaf names its summary blob (Task 8)').toBeGreaterThan(0);
    const crash0 = crashes(box);
    const r = runShim(box, ['--op', 'reparse', '--apply'], { preloads: [PRELOADS.faults], env: { HISTORY_TEST_THROW_BLOB: String(last.s) } });
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(r.stdout).toMatch(/^history-sweep: reparsed 2 leaves \([0-9]+ changed, 1 failed\); node ids and sources unchanged$/m);
    const mid = leafRows(box);
    expect(mid.find((x) => x.node_id === last.node_id)).toMatchObject({ kind: 'raw_leaf', status: 'parse-failed', gist: null, topics: null });
    expect(mid.filter((x) => x.node_id !== last.node_id), 'the other leaf is re-derived as it was')
      .toEqual(before.filter((x) => x.node_id !== last.node_id));
    expect(maintQ(box, 'SELECT kind FROM node_refs WHERE node_id = ?', last.node_id), 'a crashed leaf holds no refs').toEqual([]);
    expect(crashes(box) - crash0, 'counted once').toBe(1);
    const again = runShim(box, ['--op', 'reparse', '--apply']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/^history-sweep: reparsed 2 leaves \(1 changed, 0 failed\)/m);
    expect(leafRows(box), 'the next reparse retries it').toEqual(before);
  }, HEAVY);

  it('RB5: an all-leaves reparse clears the leaf-crashed markers and lowers the leaves cursor, so the next tick derives the boundary under its old id', () => {
    const box = twoLeaves('ccrc-hist-rb5c-');
    const ids = allIds(box);
    const gone = maintQ<{ node_id: string; b: number; rowid: number }>(box,
      'SELECT node_id, boundary_entry_id AS b, rowid FROM nodes WHERE depth = 0 ORDER BY boundary_entry_id DESC LIMIT 1')[0]!;
    // A boundary whose derivation threw before its leaf id was known: no leaf, and Task 8's marker. Planted by SQL.
    const db = new DatabaseSync(dbFile(box));
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('DELETE FROM node_refs WHERE node_id = ?').run(gone.node_id);
      db.prepare('DELETE FROM node_sources WHERE node_id = ?').run(gone.node_id);
      db.prepare('DELETE FROM node_children WHERE node_id = ? OR child_id = ?').run(gone.node_id, gone.node_id);
      if (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'nodes_fts'").get() !== undefined) {
        db.prepare('DELETE FROM nodes_fts WHERE rowid = ?').run(gone.rowid);
      }
      db.prepare('DELETE FROM nodes WHERE node_id = ?').run(gone.node_id);
      // Task 8's marker shape: cursor = the NODE_PARSER_VERSION it crashed under (1 in B2), so a tick's todo skips it.
      db.prepare("INSERT INTO derivation_state (step, version, cursor, completed_ms) VALUES ('leaf-crashed', ?, '1', ?)").run(gone.b, Date.now());
      db.exec('COMMIT');
    } finally { db.close(); }
    expect(runSweep(box).code).toBe(0);
    expect(allIds(box), 'CONTROL: the marked boundary waits for a reparse').not.toContain(gone.node_id);
    const r = runShim(box, ['--op', 'reparse', '--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^history-sweep: reparse: 1 crashed boundary marker\(s\) cleared; the next tick derives their leaves$/m);
    expect(maintQ(box, "SELECT version FROM derivation_state WHERE step = 'leaf-crashed'")).toEqual([]);
    expect(runSweep(box).code).toBe(0);
    expect(allIds(box), 'the next tick derives it again, under the id it had').toEqual(ids);
  }, HEAVY);

  it('RB6: while a recovery step is registered, reparse --apply answers recovering and rewrites nothing; the dry run still answers', () => {
    const box = twoLeaves('ccrc-hist-rb6rp-');
    const before = leafRows(box);
    maintRecovering(box);
    const r = runShim(box, ['--op', 'reparse', '--apply']);
    expect(r.code, r.stderr).toBe(2);
    expect(lastResult(r.stdout)).toEqual({ rc: 2, reason: 'recovering' });
    expect(leafRows(box)).toEqual(before);
    const dry = runShim(box, ['--op', 'reparse']);
    expect(dry.code, dry.stderr).toBe(0);
    expect(lastResult(dry.stdout)).toEqual({ rc: 0 });
  }, HEAVY);

  it('O59: a reparse whose belt lacks a unit the belt state records as covered records the belt due; one with every unit loaded leaves the state as it was', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                       // root reads a 0000 file regardless of its mode
    const AN = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const v = `${Array.from({ length: 29 }, () => AN[Math.floor(Math.random() * AN.length)]!).join('')}7`;
    const box = makeHistoryBox('ccrc-hist-rpbelt-', { role: 'fleet', shim: true });
    const secret = path.join(box.home, '.cc-secrets', 'rp-belt.env');
    fs.mkdirSync(path.dirname(secret), { recursive: true, mode: 0o700 });
    fs.writeFileSync(secret, `ZQ_RP_BELT=${v}\n`, { mode: 0o600 });
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows: compactionSequence({ n: 2, trigger: 'manual' }).rows });
    const belt = (): { v: number; rids: number[]; gen: number[] | null; w?: string } | null => {
      const raw = maintMeta(box, 'fts_belt');
      return raw === null ? null : JSON.parse(raw) as { v: number; rids: number[]; gen: number[] | null; w?: string };
    };
    for (let k = 0; k < 4 && belt()?.v !== BELT_VERSION; k += 1) expect(runSweep(box).code).toBe(0);
    const covered = maintMeta(box, 'fts_belt');
    expect(belt()?.v, 'CONTROL: the ticks completed a belt generation').toBe(BELT_VERSION);
    expect(belt()?.rids.length, 'CONTROL: recording the one unit covered').toBe(1);
    expect(leafIds(box).length, 'CONTROL: the fixture derived its two leaves').toBe(2);
    const same = runShim(box, ['--op', 'reparse', '--apply']);
    expect(same.code, same.stderr).toBe(0);
    expect(lastResult(same.stdout)).toEqual({ rc: 0 });
    expect(maintMeta(box, 'fts_belt'), 'every recorded unit loaded: the state stays as the tick left it').toBe(covered);
    fs.chmodSync(secret, 0o000);
    try {
      const r = runShim(box, ['--op', 'reparse', '--apply']);
      expect(r.code, r.stderr).toBe(0);
      expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    } finally { fs.chmodSync(secret, 0o600); }
    const due = belt();
    // The pass ends with stampBeltWitness (ruling R-rollback), so the due record carries the pass's witness `w`
    // beside v, rids and gen: read the three apart from it.
    expect({ v: due?.v, rids: due?.rids, gen: due?.gen }, 'the unit was unreadable during the pass: its rewritten leaves lack its belt, so the belt is due')
      .toEqual({ v: 0, rids: [], gen: null });
    expect(typeof due?.w, 'the pass ends stamped with its own witness, so the next tick reads no other build').toBe('string');
    // An open generation recorded under another BELT_VERSION covers nothing this version can stamp (spec §6.2 "The
    // belt"; ruling R-version): planted with every unit loaded and the rids exact, a reparse still records the belt due.
    const rids = (JSON.parse(covered!) as { rids: number[] }).rids;
    const pw = new DatabaseSync(dbFile(box));
    try {
      pw.prepare('UPDATE meta SET v = ? WHERE k = ?')
        .run(JSON.stringify({ v: BELT_VERSION, rids, gen: rids, gv: BELT_VERSION + 1 }), 'fts_belt');
    } finally { pw.close(); }
    const other = runShim(box, ['--op', 'reparse', '--apply']);
    expect(other.code, other.stderr).toBe(0);
    const due2 = belt();
    expect({ v: due2?.v, rids: due2?.rids, gen: due2?.gen }, 'an open generation at another version: the belt is due')
      .toEqual({ v: 0, rids: [], gen: null });
  }, HEAVY);
});

/** The placed shim run from a parent whose umask is `umask` (C35's "an inherited umask 0002"), with the statfs
 *  preload and any others. */
function maintShimUmask(box: HistoryBox, umask: string, args: string[], env: Record<string, string> = {},
  preloads: string[] = [PRELOADS.statfs]): { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string } {
  const r = spawnSync('bash', ['-c', `umask ${umask}; exec bash "$0" "$@"`, path.join(box.home, '.local', 'bin', 'ccd-history-sweep'), ...args], {
    cwd: box.home, encoding: 'utf8', timeout: 240_000, killSignal: 'SIGTERM',
    env: { ...box.env, HISTORY_TEST_STATFS: 'plenty', NODE_OPTIONS: preloadOptions(preloads), ...env },
  });
  return { status: r.status, signal: r.signal, stdout: String(r.stdout), stderr: String(r.stderr) };
}

describe('doctor --backup: 0600 from the first byte, temp then publish, the copy preflight (W1-B2 Task 22)', () => {
  skipOnDarwin();
  const BACKUP_NAME = /^[0-9]{8}T[0-9]{6}Z\.db$/;
  const BACKUP_TMP = /^\.[0-9]{8}T[0-9]{6}Z\.db\.tmp$/;

  it('C35: under an inherited umask 0002 the backup is 0600 from its first byte and lies under db/backups/', () => {
    const box = boundBox('ccrc-hist-c35-');
    const P = historyPaths(box.home);
    // Killed right after VACUUM INTO returns and before writeBackup's own fchmod: the temp is as SQLite made it.
    const killed = maintShimUmask(box, '0002', ['--op', 'backup'], { HISTORY_TEST_KILL: 'openSync:.db.tmp:1:before' },
      [PRELOADS.statfs, PRELOADS.faults]);
    expect(killed.signal, killed.stderr).toBe('SIGKILL');
    const tmp = maintNames(P.backups).filter((n) => BACKUP_TMP.test(n));
    expect(tmp, 'CONTROL: the kill landed between the copy and the fchmod').toHaveLength(1);
    expect(fs.statSync(path.join(P.backups, tmp[0]!)).mode & 0o777, 'the copy\'s mode at its first stat').toBe(0o600);
    const r = maintShimUmask(box, '0002', ['--op', 'backup']);
    expect(r.status, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    const done = maintNames(P.backups).filter((n) => BACKUP_NAME.test(n));
    expect(done).toHaveLength(1);
    expect(fs.statSync(path.join(P.backups, done[0]!)).mode & 0o777).toBe(0o600);
    expect(fs.statSync(P.backups).mode & 0o777).toBe(0o700);
    expect(maintNames(P.backups).filter((n) => BACKUP_TMP.test(n)), 'the stale temp was removed first').toEqual([]);
    expect(r.stdout).toContain(`history-sweep: backup written: ~/.ccrc/history/db/backups/${done[0]}`);
  }, HEAVY);

  it('C51: a VACUUM INTO killed mid-copy leaves only backups/.<ts>.db.tmp, never a backup name; the next --backup removes it first and writes a copy of the store', () => {
    const box = boundBox('ccrc-hist-c51-');
    const P = historyPaths(box.home);
    const killed = runShim(box, ['--op', 'backup'], { preloads: [PRELOADS.faults], env: { HISTORY_TEST_KILL_SQL: 'VACUUM INTO' } });
    expect(killed.signal).toBe('SIGKILL');
    const left = maintNames(P.backups);
    expect(left, 'only the temp: a partial copy never carries a backup name').toHaveLength(1);
    expect(left[0]).toMatch(BACKUP_TMP);
    expect(fs.readFileSync(path.join(P.backups, left[0]!), 'utf8'), 'the seam\'s partial copy').toBe('partial');
    const r = runShim(box, ['--op', 'backup']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    const after = maintNames(P.backups);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatch(BACKUP_NAME);
    const copy = new DatabaseSync(path.join(P.backups, after[0]!), { readOnly: true });
    try {
      expect((copy.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string }).v)
        .toBe(fs.readFileSync(P.storeId, 'utf8').trim());
      expect((copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
    } finally { copy.close(); }
  }, HEAVY);

  it('C52: free space = threshold + store size - 1 is refused backup-refused and writes nothing (a stale temp a killed copy left is removed first, D-4588); + 1 proceeds and records copy_bps', () => {
    const box = boundBox('ccrc-hist-c52-');
    const P = historyPaths(box.home);
    const fsSize = 10 * 1024 ** 3;
    const size = 1_000_000;                                       // the driver's measured-size seam
    const need = floorThreshold(fsSize) + size;
    // D-4588: the stale temp a killed copy left is removed BEFORE the room probe, so a refusal does not keep it.
    fs.mkdirSync(P.backups, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(P.backups, '.20260101T000000Z.db.tmp'), 'partial');
    const refused = runDriver(box, { sizeBytes: size }, ['--op', 'backup'], { env: { HISTORY_TEST_STATFS: `${need - 1}:${fsSize}` } });
    expect(refused.code, refused.stderr).toBe(2);
    expect(lastResult(refused.stdout)).toEqual({ rc: 2, reason: 'backup-refused' });
    expect(refused.stdout).toMatch(/^history-sweep: backup-refused: a copy needs more than [0-9]+ bytes free/m);
    expect(maintNames(P.backups), 'nothing written, and the stale temp is gone').toEqual([]);
    const ok = runDriver(box, { sizeBytes: size }, ['--op', 'backup'], { env: { HISTORY_TEST_STATFS: `${need + 1}:${fsSize}` } });
    expect(ok.code, ok.stderr).toBe(0);
    expect(maintNames(P.backups).filter((n) => BACKUP_NAME.test(n))).toHaveLength(1);
    expect(Number(maintMeta(box, 'copy_bps'))).toBeGreaterThan(0);
  }, HEAVY);

  it('doctor --backup through the CLI writes one backup and relays exit 0', () => {
    const box = boundBox('ccrc-hist-bk-cli-');
    const r = runCli(box, ['doctor', '--backup', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json?.['exit']).toBe(0);
    expect(maintNames(historyPaths(box.home).backups).filter((n) => BACKUP_NAME.test(n))).toHaveLength(1);
  }, HEAVY);

  it('a backup of a store a migration is still due on runs at its stored version and records copy_bps, the rate planMigration reads', () => {
    const box = boundBox('ccrc-hist-bk-pend-');
    const r = runDriver(box, { extraMigrations: [V2] }, ['--op', 'backup']);
    expect(r.code, r.stderr).toBe(0);
    expect(lastResult(r.stdout)).toEqual({ rc: 0 });
    expect(versionOf(historyPaths(box.home).dbFile), 'a backup never migrates').toBe(1);
    expect(maintNames(historyPaths(box.home).backups).filter((n) => BACKUP_NAME.test(n))).toHaveLength(1);
    const rate = /\([0-9]+ bytes, ([0-9]+) B\/s\)/.exec(r.stdout)?.[1];
    expect(rate, `the backup line names its rate:\n${r.stdout}`).toBeDefined();
    expect(Number(maintMeta(box, 'copy_bps')), 'this copy\'s rate, recorded at the stored version').toBe(Number(rate));
  }, HEAVY);

  it('RB6: while a recovery step is registered, doctor --backup answers recovering and writes no copy', () => {
    const box = boundBox('ccrc-hist-rb6bk-');
    maintRecovering(box);
    const r = runShim(box, ['--op', 'backup']);
    expect(r.code, r.stderr).toBe(2);
    expect(lastResult(r.stdout)).toEqual({ rc: 2, reason: 'recovering' });
    expect(maintNames(historyPaths(box.home).backups), 'nothing written').toEqual([]);
  }, HEAVY);
});

describe('doctor --repair: integrity, the foreign-key baseline, the resumable FTS rebuild (W1-B2 Task 23)', () => {
  skipOnDarwin();
  /** A bound store whose family's one operator row ('zebrafish') is indexed: FTS ready. */
  function healable(prefix: string): HistoryBox {
    const box = makeHistoryBox(prefix, { role: 'fleet', shim: true });
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows: [
      userRow({ uuid: MAINT_QUOKKA, ts: maintIso(MAINT_DAY), sessionId: MAINT_U1, text: 'zebrafish words for the index' }),
    ] });
    expect(runSweep(box).code).toBe(0);
    return box;
  }
  /** The store opened read-write by the test, with no sweep running: the seam for a planted state. */
  function writable(box: HistoryBox, fn: (db: DatabaseSync) => void): void {
    const db = new DatabaseSync(historyPaths(box.home).dbFile);
    try { fn(db); } finally { db.close(); }
  }
  /** A term in the index that no stored blob holds: what an early-indexed value leaves behind. */
  const plantStale = (box: HistoryBox): void => writable(box, (db) => {
    db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(987_654_321, 'staleword planted before its pair was known');
  });
  const rebuilds = (box: HistoryBox): Array<{ completed_ms: number | null }> =>
    maintQ(box, "SELECT completed_ms FROM derivation_state WHERE step = 'fts-rebuild' ORDER BY version");

  it('§8.3 layer 4: the rebuild re-indexes through the pass\'s belt, so a letter-glued value a row held is no term after it', async (ctx) => {
    const AN = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const v = `${Array.from({ length: 29 }, () => AN[Math.floor(Math.random() * AN.length)]!).join('')}7`;
    const box = makeHistoryBox('ccrc-hist-c61belt-', { role: 'fleet', shim: true });
    fs.mkdirSync(`${box.home}/.cc-secrets`, { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${box.home}/.cc-secrets/belt.env`, `ZQ_BELT=${v}\n`, { mode: 0o600 });
    seedFamily(box, { id: ID, project: 'demo', uuid: MAINT_U1, rows: [
      userRow({ uuid: MAINT_QUOKKA, ts: maintIso(MAINT_DAY), sessionId: MAINT_U1, text: `zebrafish ab${v}cd words` }),
    ] });
    expect(runSweep(box).code).toBe(0);
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    expect(maintMatch(box, `"ab${v}cd"`), 'CONTROL: the belt kept it out at ingest').toBe(0);
    // The row as an index with no belt wrote it (a B1 store, or a tick whose file was unreadable).
    writable(box, (db) => {
      const id = (db.prepare('SELECT blob_id FROM entries WHERE uuid = ?').get(MAINT_QUOKKA) as { blob_id: number }).blob_id;
      db.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(id);
      db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(id, `zebrafish ab${v}cd words`);
    });
    expect(maintMatch(box, `"ab${v}cd"`), 'CONTROL: the planted row holds the glued value').toBe(1);
    const r = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(lastResult(r.out), r.out).toEqual({ rc: 0 });
    expect(maintMatch(box, `"ab${v}cd"`), 'the rebuild indexed through the belt').toBe(0);
    expect(maintMatch(box, 'zebrafish'), 'and re-indexed the row').toBe(1);
    // The repair pass ends with stampBeltWitness (ruling R-rollback), so the due record carries the pass's witness `w`
    // beside v, rids and gen: read the three apart from it.
    const due = JSON.parse(maintMeta(box, 'fts_belt') ?? 'null') as { v: number; rids: number[]; gen: number[] | null; w?: string } | null;
    expect({ v: due?.v, rids: due?.rids, gen: due?.gen }, 'the rebuild leaves the belt due').toEqual({ v: 0, rids: [], gen: null });
    expect(typeof due?.w, 'the repair pass ends stamped with its own witness').toBe('string');
  }, HEAVY);

  it('C61: a violation present before the run is the baseline and passes; the rebuild drops the stale term and re-indexes the store', async (ctx) => {
    const box = healable('ccrc-hist-c61a-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();          // a Node without FTS5 has no index to heal
    writable(box, (db) => {
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare("INSERT INTO file_paths (path, file_id, last_seen_ms) VALUES ('/fk-pre', 2147483646, 0)").run();
    });
    plantStale(box);
    expect(maintMatch(box, 'staleword'), 'CONTROL: the stale term is in the index').toBe(1);
    const r = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(r.code, r.out).toBe(0);
    expect(lastResult(r.out)).toEqual({ rc: 0 });
    expect(r.out).toMatch(/history-sweep: repair: integrity_check ok; 1 foreign-key violation\(s\) already present, kept as the baseline/);
    expect(maintMatch(box, 'staleword'), 'a whole rebuild leaves no term the store does not hold').toBe(0);
    expect(maintMatch(box, 'zebrafish'), 'and re-indexes what it does hold').toBe(1);
    expect(maintQ(box, 'PRAGMA foreign_key_check'), 'repair never hides a violation it did not make').toHaveLength(1);
    expect(rebuilds(box).map((x) => x.completed_ms !== null)).toEqual([true]);
    expect(maintMeta(box, 'fts')).toBe('ready');
  }, HEAVY);

  it('C61: a chunk whose COMMIT fails on a new violation is refused repair-refused and rolled back, and with it the first chunk\'s drop: nothing is repaired', async (ctx) => {
    const box = healable('ccrc-hist-c61b-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    plantStale(box);
    const r = await maintPty(box, 'shim', ['--op', 'repair'], {
      preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_FK_INJECT: 'INSERT INTO blobs_fts (rowid, body)' },
    });
    expect(r.code, r.out).toBe(2);
    expect(lastResult(r.out)).toEqual({ rc: 2, reason: 'repair-refused' });
    expect(r.out).toMatch(/history-sweep: repair-refused: a rebuild chunk would have committed a foreign-key violation \(FOREIGN KEY constraint failed at COMMIT\); that chunk was rolled back, and nothing was rebuilt: the old index stands/);
    expect(maintMatch(box, 'staleword'), 'the old index stands: the refused chunk rolled its drop back too').toBe(1);
    expect(maintMatch(box, 'zebrafish')).toBe(1);
    expect(rebuilds(box), 'no rebuild was registered').toEqual([]);
    expect(maintQ(box, "SELECT path FROM file_paths WHERE path = '/fk-inject'")).toEqual([]);
    expect(maintMeta(box, 'fts')).toBe('ready');
  }, HEAVY);

  it('C61: a violation that appears during the rebuild is refused repair-refused at completion; the rebuild stays open and grep pending, a rerun refuses against the original baseline, and once the row is gone the next run finishes', async (ctx) => {
    const box = healable('ccrc-hist-c61c-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const pane = withPane(box, ID);
    const r = await maintPty(box, 'shim', ['--op', 'repair'], {
      preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_FK_PLANT: 'b.blob_id > ? AND b.z IS NOT NULL' },
    });
    expect(r.code, r.out).toBe(2);
    expect(lastResult(r.out)).toEqual({ rc: 2, reason: 'repair-refused' });
    expect(r.out).toMatch(/history-sweep: repair-refused: 1 new foreign-key violation\(s\) \(file_paths -> ingest_files\) since this rebuild's baseline; the rebuilt index stays pending/);
    expect(maintQ(box, "SELECT path FROM file_paths WHERE path = '/fk-plant'"), 'CONTROL: the seam committed its row').toHaveLength(1);
    expect(rebuilds(box).map((x) => x.completed_ms), 'the completion rolled back; the step is open').toEqual([null]);
    expect(maintMeta(box, 'fts')).toBe('fts-pending');
    const mid = runCli(box, ['grep', 'zebrafish', '--json'], { env: pane });
    expect([mid.code, mid.json?.['reason']], 'a refused completion keeps grep pending').toEqual([7, 'fts-pending']);
    const again = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(lastResult(again.out), `the original baseline still refuses it:\n${again.out}`).toEqual({ rc: 2, reason: 'repair-refused' });
    writable(box, (db) => { db.prepare("DELETE FROM file_paths WHERE path = '/fk-plant'").run(); });
    const done = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(done.code, done.out).toBe(0);
    expect(done.out).toMatch(/history-sweep: repair: resuming the index rebuild started \S+ at its merge phase/);
    expect(rebuilds(box).map((x) => x.completed_ms !== null)).toEqual([true]);
    expect(maintMeta(box, 'fts')).toBe('ready');
    expect(runCli(box, ['grep', 'zebrafish', '--json'], { env: pane }).code).toBe(0);
  }, 1.5 * HEAVY);

  it('an integrity_check that is not ok is refused repair-refused before anything is rebuilt', async (ctx) => {
    const box = healable('ccrc-hist-rpi-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    plantStale(box);
    const r = await maintPty(box, 'shim', ['--op', 'repair'], {
      preloads: [PRELOADS.statfs, PRELOADS.faults],
      env: { HISTORY_TEST_INTEGRITY: '*** in database main *** Page 7: btreeInitPage() returns error code 11' },
    });
    expect(r.code, r.out).toBe(2);
    expect(lastResult(r.out)).toEqual({ rc: 2, reason: 'repair-refused' });
    expect(r.out).toContain('history-sweep: integrity_check: *** in database main *** Page 7');
    expect(rebuilds(box)).toEqual([]);
    expect(maintMatch(box, 'staleword'), 'nothing was rebuilt').toBe(1);
  }, HEAVY);

  it('a dropped blobs_fts: grep answers fts-pending; doctor --repair through the CLI recreates and refills it', async (ctx) => {
    const box = healable('ccrc-hist-rpd-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    writable(box, (db) => { db.exec('DROP TABLE blobs_fts'); });
    const pane = withPane(box, ID);
    const before = runCli(box, ['grep', 'zebrafish', '--json'], { env: pane });
    expect(before.code, before.stderr).toBe(7);
    expect(before.json?.['reason']).toBe('fts-pending');
    const r = await maintPty(box, 'cli', ['doctor', '--repair']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('blobs_fts damaged or missing');
    const after = runCli(box, ['grep', 'zebrafish', '--json'], { env: pane });
    expect(after.code, after.stderr).toBe(0);
  }, HEAVY);

  it('a read beside an open write transaction answers from committed rows and never exits 1 (review focus 5)', async (ctx) => {
    const box = healable('ccrc-hist-rpw-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const pane = withPane(box, ID);
    writable(box, (db) => {
      db.exec('PRAGMA busy_timeout = 0');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO blobs_fts (rowid, body) VALUES (?, ?)').run(987_654_322, 'uncommittedword held by an open writer');
        const seen = runCli(box, ['grep', 'zebrafish', '--json'], { env: pane });
        expect(seen.code, seen.stderr).toBe(0);
        const unseen = runCli(box, ['grep', 'uncommittedword', '--json'], { env: pane });
        expect(unseen.code, 'an uncommitted row is not visible, and the reader neither waits it out nor fails').toBe(3);
      } finally {
        db.exec('ROLLBACK');
      }
    });
  }, HEAVY);

  it('a repair killed at its merge phase keeps grep at fts-pending, across a scheduled tick too; run again, it resumes there and finishes', async (ctx) => {
    const box = healable('ccrc-hist-rpe-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    plantStale(box);
    const killed = await maintPty(box, 'shim', ['--op', 'repair'], {
      preloads: [PRELOADS.statfs, PRELOADS.faults], env: { HISTORY_TEST_KILL_SQL: "VALUES ('merge'" },
    });
    expect(killed.signal === 9 || killed.code === 137, `killed at the merge statement:\n${killed.out}`).toBe(true);
    expect(rebuilds(box).map((x) => x.completed_ms), 'the rebuild is open').toEqual([null]);
    expect(runSweep(box).code).toBe(0);                          // a scheduled tick between two repair passes
    expect(maintMeta(box, 'fts'), 'the tick keeps the index pending while a rebuild is open').toBe('fts-pending');
    // B1's other writer of `ready` is deriveFts' completion: a ('fts', 1) backfill re-opened while the rebuild is open
    // (B1's resetFtsPending re-opens it so) completes in the next tick, and must leave the index pending too.
    const reopen = new DatabaseSync(historyPaths(box.home).dbFile);
    try {
      reopen.prepare("UPDATE derivation_state SET completed_ms = NULL WHERE step = 'fts' AND version = 1").run();
    } finally { reopen.close(); }
    expect(runSweep(box).code).toBe(0);
    expect(maintMeta(box, 'fts'), 'a backfill completing under an open rebuild keeps the index pending').toBe('fts-pending');
    const pane = withPane(box, ID);
    const mid = runCli(box, ['grep', 'zebrafish', '--json'], { env: pane });
    expect(mid.code, mid.stderr).toBe(7);
    expect(mid.json?.['reason']).toBe('fts-pending');
    const r = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/history-sweep: repair: resuming the index rebuild started \S+ at its merge phase/);
    expect(rebuilds(box).map((x) => x.completed_ms !== null)).toEqual([true]);
    expect(maintMatch(box, 'staleword')).toBe(0);
    const done = runCli(box, ['grep', 'zebrafish', '--json'], { env: pane });
    expect(done.code, done.stderr).toBe(0);
  }, 1.5 * HEAVY);

  it('RB6: while a recovery step is registered, doctor --repair answers recovering and rebuilds nothing', async () => {
    const box = healable('ccrc-hist-rb6rr-');
    maintRecovering(box);
    const r = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(r.code, r.out).toBe(2);
    expect(lastResult(r.out)).toEqual({ rc: 2, reason: 'recovering' });
    expect(rebuilds(box), 'no rebuild registered under a replay').toEqual([]);
  }, HEAVY);

  it('a completed repair re-measures B1\'s health counters: it resets what is cured, keeps what still stands, and never lowers an item count while any stands', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();                   // root reads a 000 file
    const box = healable('ccrc-hist-rcm-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const counts = (): Record<string, number> => Object.fromEntries(
      (maintQ(box, 'SELECT name, n FROM counters') as Array<{ name: string; n: number }>).map((r) => [r.name, Number(r.n)]));
    writable(box, (db) => {
      const put = db.prepare('INSERT INTO counters (name, n) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET n = excluded.n');
      for (const [name, n] of [['blob_undecodable', 2], ['drain_rejected', 2], ['spool_displaced', 1], ['spool_blocked', 3], ['spool_unreadable', 4]] as const) put.run(name, n);
    });
    // What stands now: one of the two refused files (the operator removed the other), an emptied planted area, no
    // blocked file, and one draining file this user cannot read.
    const dr = historyPaths(box.home).draining;
    fs.mkdirSync(path.join(dr, 'rejected'), { recursive: true, mode: 0o700 });
    const refused = path.join(dr, 'rejected', `${ID}.1700000000001.4242.jsonl`);
    fs.writeFileSync(refused, '\n', { mode: 0o600 });
    fs.mkdirSync(path.join(dr, 'planted', '1700000000002.4242'), { recursive: true, mode: 0o700 });
    const locked = path.join(dr, `${ID}.1700000000003.4242.jsonl`);
    fs.writeFileSync(locked, '\n', { mode: 0o000 });
    try {
      const r = await maintPty(box, 'shim', ['--op', 'repair']);
      expect(r.code, r.out).toBe(0);
      const c = counts();
      expect(c['blob_undecodable'], 'every blob decodes: cured').toBeUndefined();
      expect(c['drain_rejected'], 'one refused file still stands, and an item count is never lowered while any does').toBe(2);
      expect(c['spool_displaced'], 'nothing displaced stands: cured').toBeUndefined();
      expect(c['spool_blocked'], 'no blocked file stands: cured').toBeUndefined();
      expect(c['spool_unreadable'], 'the 000 file still stands').toBe(4);
      expect(r.out).toMatch(/history-sweep: repair: blob_undecodable 2 -> 0: nothing it counts stands now/);
      expect(r.out).toMatch(/history-sweep: repair: drain_rejected stays 2: 1 still stand/);
      expect(r.out).toMatch(/history-sweep: repair: spool_blocked 3 -> 0: nothing it counts stands now/);
      // The operator cures the rest: the refused file removed (its lines stay in the journal), the locked one readable.
      fs.rmSync(refused);
      fs.chmodSync(locked, 0o600);
      const again = await maintPty(box, 'shim', ['--op', 'repair']);
      expect(again.code, again.out).toBe(0);
      expect(counts()['drain_rejected']).toBeUndefined();
      expect(counts()['spool_unreadable']).toBeUndefined();
    } finally {
      if (fs.existsSync(locked)) fs.chmodSync(locked, 0o600);
    }
  }, 1.5 * HEAVY);

  it('a blob that no longer decodes is counted by the rebuild that read it, raising a count the store lost, and a spool it cannot measure is left as it is', async (ctx) => {
    const box = healable('ccrc-hist-rcb-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const counts = (): Record<string, number> => Object.fromEntries(
      (maintQ(box, 'SELECT name, n FROM counters') as Array<{ name: string; n: number }>).map((r) => [r.name, Number(r.n)]));
    writable(box, (db) => {
      db.prepare('UPDATE blobs SET z = ? WHERE blob_id = (SELECT blob_id FROM entries WHERE uuid = ?)').run(Buffer.from('not a brotli stream'), MAINT_QUOKKA);
      db.prepare("INSERT INTO counters (name, n) VALUES ('spool_blocked', 5) ON CONFLICT (name) DO UPDATE SET n = excluded.n").run();
    });
    // A link at .draining is never listed through (B1's D-4347), so the spool is unmeasured.
    const P = historyPaths(box.home);
    fs.mkdirSync(P.spool, { recursive: true, mode: 0o700 });
    fs.rmSync(P.draining, { recursive: true, force: true });
    fs.symlinkSync(path.join(box.home, 'no-such-dir'), P.draining);
    const r = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(r.code, r.out).toBe(0);
    expect(counts()['blob_undecodable'], 'one blob read and did not decode').toBe(1);
    const bid = maintQ<{ blob_id: number }>(box, 'SELECT blob_id FROM entries WHERE uuid = ?', MAINT_QUOKKA)[0]!.blob_id;
    expect(maintMeta(box, `fts_undecodable:${bid}`), 'the decoder mode that failed it is classified, as the backfill classifies it (D-4346 F3)').toBe('entry');
    expect(counts()['spool_blocked'], 'unmeasured, so never reset').toBe(5);
    expect(r.out).toMatch(/history-sweep: repair: blob_undecodable 0 -> 1: 1 stand now/);
    expect(r.out).toMatch(/history-sweep: repair: spool_blocked stays 5: what it counts could not be measured/);
    expect(maintMatch(box, 'zebrafish'), 'CONTROL: the blob that does not decode keeps no row').toBe(0);
  }, HEAVY);

  it('D-4591: an integrity_check row naming blobs_fts is index damage the repair heals: it rebuilds and passes', async (ctx) => {
    const box = healable('ccrc-hist-d4591a-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    plantStale(box);
    expect(maintMatch(box, 'staleword'), 'CONTROL: the stale term is in the index').toBe(1);
    const row = 'malformed inverted index for FTS5 table main.blobs_fts';
    const r = await maintPty(box, 'shim', ['--op', 'repair'], {
      preloads: [PRELOADS.statfs, PRELOADS.faults],
      env: { HISTORY_TEST_INTEGRITY: row },
    });
    expect(r.code, r.out).toBe(0);
    expect(lastResult(r.out)).toEqual({ rc: 0 });
    expect(r.out).toContain(`history-sweep: integrity_check: ${row} (index damage: the rebuild replaces it)`);
    expect(rebuilds(box).map((x) => x.completed_ms !== null), 'the rebuild ran to its end').toEqual([true]);
    expect(maintMatch(box, 'staleword'), 'a whole rebuild leaves no term the store does not hold').toBe(0);
    expect(maintMatch(box, 'zebrafish'), 'and re-indexes what it does hold').toBe(1);
    expect(maintMeta(box, 'fts')).toBe('ready');
  }, HEAVY);

  it('D-4591: real FTS5 damage (blobs_fts_idx gone) is healed, and integrity_check reads ok afterwards', async (ctx) => {
    const box = healable('ccrc-hist-d4591b-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const dbFile = historyPaths(box.home).dbFile;
    let raw: DatabaseSync | null = null;
    try {
      raw = new DatabaseSync(dbFile, { defensive: false });
      raw.exec('DROP TABLE blobs_fts_idx');
    } catch {
      try { raw?.close(); } catch { /* nothing to close */ }
      ctx.skip();                                  // a node:sqlite with no defensive option (the 22.16 floor) cannot plant it
    }
    raw!.close();
    const integrity = (): string[] => {
      const ro = new DatabaseSync(dbFile, { readOnly: true });
      try { return (ro.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>).map((x) => x.integrity_check); } finally { ro.close(); }
    };
    const damaged = integrity();
    expect(damaged, 'CONTROL: integrity_check names the damaged index').toHaveLength(1);
    expect(damaged[0]).toContain('blobs_fts');
    const r = await maintPty(box, 'shim', ['--op', 'repair']);
    expect(r.code, r.out).toBe(0);
    expect(lastResult(r.out)).toEqual({ rc: 0 });
    expect(integrity(), 'the repair replaced the damaged index').toEqual(['ok']);
    expect(maintMatch(box, 'zebrafish'), 'and it holds what the store holds').toBe(1);
  }, HEAVY);

  it('an integrity_check that cannot run (a vtab whose own tables are gone) is refused repair-refused with its remedies, never exit 1', async (ctx) => {
    const box = healable('ccrc-hist-d4591c-');
    if (maintMeta(box, 'fts') !== 'ready') ctx.skip();
    const r = await maintPty(box, 'shim', ['--op', 'repair'], {
      preloads: [PRELOADS.statfs, PRELOADS.faults],
      env: { HISTORY_TEST_INTEGRITY: 'throw:vtable constructor failed: blobs_fts' },
    });
    expect(r.code, r.out).toBe(2);
    expect(lastResult(r.out)).toEqual({ rc: 2, reason: 'repair-refused' });
    expect(r.out).toContain('history-sweep: integrity_check could not run: vtable constructor failed: blobs_fts');
    expect(r.out).toContain('ccrc history doctor --restore <file>');
    expect(rebuilds(box)).toEqual([]);
  }, HEAVY);
});
