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
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as pty from 'node-pty';
import { beltWidth, historyPaths, floorThreshold } from '../../ccd/history/lib.mjs';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { userRow, compactionSequence } from './historyFixtures.js';
import {
  makeHistoryBox, runSweep, runShim, runCli, plantSession, plantTranscript, openStoreRO, stubShim, holdLock,
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
